// SPDX-License-Identifier: AGPL-3.0-only
// The scan's noise smoothed out of it, never further than a set distance.
//
// A scanner's scatter is bumps across the surface — what makes a flat face
// read as orange peel, what a reduction has to keep triangles for, what a
// thickness map reads as a speckle. On a dense scan the bumps are many
// triangles across, so smoothing that works triangle by triangle (Laplacian,
// Taubin's λ|μ) barely touches them: it takes out what is finer than the
// mesh, and a scan's triangles are finer than its noise.
//
// So each point is moved onto a surface fitted to the scan around it instead,
// over a patch the size asked for: a quadric height field over the point's
// tangent plane, least squares, the nearer scan counting for more — moving
// least squares, in the form most scan software uses. A bump smaller than
// the patch has nothing in a quadric to fit it and is averaged out; the
// part's own shape — a face, a bore, a fillet larger than the patch — is what
// a quadric fits, and stays where it was: a sphere or a cylinder is not
// shrunk, as a Laplacian shrinks it. A patch is fitted to a few dozen of the
// scan's points drawn evenly from it, however dense the scan: more say
// nothing more about six coefficients, and would only take longer.
//
// Each point moves along its normal only, and is held within the limit of
// where the scanner put it: however far the fit is, no point of the surface
// ends up further than that from the scan it came from — the figure is a
// promise, not an estimate.
//
// A sharp edge is kept by fitting each side of it on its own: a point's patch
// takes only the scan whose normals are within 30° of its own, so a point on
// a face fits that face alone, right up to the edge. The strip along the edge
// itself, where the scan turns from one face to the other, has no side of its
// own — most of its patch turns away from it — and is left as it was: fitted
// across, it would be rounded over, which is exactly what a measurement must
// not be given. Either way, scan that faces away — the far side of a thin
// wall — is never part of a patch.
//
// A region marked by hand is smoothed alone: only its points move, and each
// by less the nearer it is to the region's edge — nothing at the edge, all of
// it the size in from it — so the smoothed patch runs into the scan around it
// without a step. The fits still take the scan on both sides of the edge.

import { buildAdjacency } from '../../../src/core/geometry/adjacency'
import { compactEdit, type EditedMesh } from './edit'
import { round125 } from './reduce'
import { triangleAreaSum } from '../../../src/core/geometry/centroid'

export interface SmoothSettings {
  /** Bumps smaller across than this are smoothed out, mm — the radius of the
   *  patch each point's surface is fitted over. */
  size: number
  /** How far any vertex may move from where it was, mm. */
  limit: number
  /** Fit each side of a sharp edge on its own, and leave the edge itself. */
  keepEdges: boolean
  /** Smooth only these vertices — a region marked by hand — fading out
   *  towards its edge; absent, the whole mesh. */
  region?: Uint32Array | null
}

export interface SmoothReport {
  settings: Omit<SmoothSettings, 'region'>
  /** How many vertices the marked region held — null for the whole mesh. */
  region: number | null
  /** Vertices smoothed, and those left as they were — on a sharp edge, or
   *  with too little scan around them to fit. */
  moved: number
  held: number
  /** How far they moved, mm: the furthest, the RMS, and how many went as far
   *  as the limit lets them. */
  maxMove: number
  rmsMove: number
  atLimit: number
}

/** Scan whose normal turns from a point's by more than this is the other
 *  side of a sharp edge, and not in the point's patch. */
const EDGE_COS = Math.cos((30 * Math.PI) / 180)

/** A point whose patch keeps less of the scan around it than this — the rest
 *  turned away past EDGE_COS — is on the strip along a sharp edge, and held.
 *  A point on a face beside the edge keeps half and more: its own side. */
const EDGE_SHARE = 0.35

/** A point with at least this much of its patch turned away, and on every
 *  side of it, is on an edge too — the ridge between two faces, or a
 *  corner. */
const TURNED_SHARE = 0.1

/** Fits over the scan as it stands after the one before: the second takes
 *  out what the first left of the bumps nearest the size. */
const PASSES = 2

/** How many of the scan's points a flat patch is fitted to. */
const PATCH_POINTS = 96

/** How large a bump smoothing takes out, to start with: a hundred-and-
 *  twenty-fifth of the part's diagonal, on the 1-2-5 steps — 2 mm on a part
 *  a hand's width across, the orange peel a scanner leaves — and never less
 *  than a few of the mesh's edges, which a patch needs to have points enough
 *  to fit. A fillet much tighter than that turns away inside the patch, and
 *  is left as it is while sharp edges are kept. */
export function defaultSmoothSize(bboxDiagonal: number, edgeLength = 0): number {
  return round125(Math.max(bboxDiagonal * 0.008, edgeLength * 2.5))
}

/** The mesh's mean edge length, from an even sample of its triangles. */
export function meanEdgeLength(positions: Float32Array, indices: Uint32Array, samples = 4096): number {
  const triangles = indices.length / 3
  if (triangles === 0) return 0
  const stride = Math.max(1, Math.floor(triangles / samples))
  let sum = 0
  let n = 0
  for (let t = 0; t < triangles; t += stride) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t * 3 + k] * 3
      const b = indices[t * 3 + ((k + 1) % 3)] * 3
      sum += Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2])
      n++
    }
  }
  return sum / n
}

/** How far smoothing may move the surface, to start with: a thousandth of
 *  the part's diagonal — well past the scatter of a good scan, so it only
 *  holds back a fit that has run off somewhere. */
export function defaultSmoothLimit(bboxDiagonal: number): number {
  return round125(bboxDiagonal * 1e-3)
}

export function smoothMesh(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  settings: SmoothSettings,
  onProgress?: (text: string) => void,
): EditedMesh & { report: SmoothReport } {
  const { size, limit, keepEdges } = settings
  if (!(size > 0)) throw new Error('The size must be more than zero.')
  if (!(limit > 0)) throw new Error('The limit must be more than zero.')

  const used = new Uint8Array(vertexCount)
  for (let i = 0; i < indices.length; i++) used[indices[i]] = 1
  const { offsets, list } = buildAdjacency(indices, vertexCount)
  const region = settings.region ?? null
  if (region && region.length === 0) throw new Error('Nothing is marked — mark the surface to smooth on the part first.')
  // How much of its fitted move each vertex makes: all of it, or, in a marked
  // region, a share that fades to nothing at the region's edge.
  const reach = region ? regionShares(positions, used, region, size, offsets, list) : null

  // The points a patch is fitted to: all of them where the scan is coarse
  // against the size, else an even draw of them — by a hash of the vertex
  // number, which is as good as random and the same every time.
  let usedCount = 0
  for (let v = 0; v < vertexCount; v++) usedCount += used[v]
  const perVertex = triangleAreaSum(positions, indices) / Math.max(1, usedCount)
  const share = Math.min(1, PATCH_POINTS / ((Math.PI * size * size) / Math.max(perVertex, 1e-12)))
  const cut = Math.floor(share * 0xffffffff)
  const sampled = new Uint8Array(vertexCount)

  let cur = positions.slice()
  let next = positions.slice()
  const normals = new Float32Array(positions.length)
  const held = new Uint8Array(vertexCount)
  const r2 = size * size
  const inv = 1 / size
  const minCos = keepEdges ? EDGE_COS : 0
  const m = new Float64Array(36)
  const b = new Float64Array(6)
  const phi = new Float64Array(6)

  for (let pass = 0; pass < PASSES; pass++) {
    onProgress?.(`Smoothing — pass ${pass + 1} of ${PASSES}…`)
    vertexNormals(cur, indices, normals)
    smoothNormals(normals, offsets, list, used)
    // Drawn afresh each pass, so what one draw leaves of the finest bumps the
    // next does not leave again in the same place.
    for (let v = 0; v < vertexCount; v++) sampled[v] = used[v] && hash32(v + pass * vertexCount) <= cut ? 1 : 0
    next.set(cur)
    const grid = cellGrid(cur, used, sampled, size)
    let candidates = new Int32Array(1024)
    const progressEvery = Math.max(1, Math.floor(grid.cells / 10))

    for (let cell = 0; cell < grid.cells; cell++) {
      if (cell % progressEvery === 0 && cell > 0) {
        onProgress?.(`Smoothing — pass ${pass + 1} of ${PASSES}, ${Math.round((100 * cell) / grid.cells)} %…`)
      }
      if (reach) {
        // Nothing in this cell moves: nothing to fit.
        let any = false
        for (let q = grid.vertexStart[cell]; q < grid.vertexStart[cell + 1] && !any; q++) any = reach[grid.vertices[q]] > 0
        if (!any) continue
      }
      // The points to fit, for every vertex in this cell: those in it and the
      // 26 around it, which is everything within the size of any of them.
      let count = 0
      const [cx, cy, cz] = grid.coords(cell)
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const other = grid.find(cx + dx, cy + dy, cz + dz)
            if (other < 0) continue
            const from = grid.sampleStart[other]
            const to = grid.sampleStart[other + 1]
            if (count + to - from > candidates.length) {
              const grown = new Int32Array(Math.max(candidates.length * 2, count + to - from))
              grown.set(candidates.subarray(0, count))
              candidates = grown
            }
            for (let k = from; k < to; k++) candidates[count++] = grid.samples[k]
          }
        }
      }

      for (let q = grid.vertexStart[cell]; q < grid.vertexStart[cell + 1]; q++) {
        const v = grid.vertices[q]
        const part = reach ? reach[v] : 1
        if (part === 0) continue
        const i = v * 3
        const px = cur[i], py = cur[i + 1], pz = cur[i + 2]
        const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2]
        if (nx === 0 && ny === 0 && nz === 0) {
          held[v] = 1
          continue
        }
        // The tangent plane's axes.
        let ux: number, uy: number, uz: number
        if (Math.abs(nx) < 0.9) {
          ux = 0; uy = nz; uz = -ny
        } else {
          ux = -nz; uy = 0; uz = nx
        }
        const ul = Math.hypot(ux, uy, uz)
        ux /= ul; uy /= ul; uz /= ul
        const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux

        // Least squares for h = c0 + c1 x + c2 y + c3 x² + c4 xy + c5 y², the
        // height over the tangent plane, in coordinates of the size so the
        // terms are alike in scale; the nearer points weigh more, and nothing
        // at the patch's edge, so the fit does not jump as points come and
        // go. Scan facing away is not the surface this point is on at all;
        // scan turned away past the edge angle is the other side of an edge.
        m.fill(0)
        b.fill(0)
        let facing = 0
        let kept = 0
        let points = 0
        // Where the scan turned away lies, seen from the point: its weight,
        // the weighted sum of where it is, and of how far out.
        let turned = 0
        let tx = 0
        let ty = 0
        let tr = 0
        for (let k = 0; k < count; k++) {
          const j = candidates[k] * 3
          const dx = cur[j] - px, dy = cur[j + 1] - py, dz = cur[j + 2] - pz
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 >= r2) continue
          const turn = nx * normals[j] + ny * normals[j + 1] + nz * normals[j + 2]
          if (turn <= 0) continue
          const f = 1 - d2 / r2
          const weight = f * f
          facing += weight
          const x = (dx * ux + dy * uy + dz * uz) * inv
          const y = (dx * wx + dy * wy + dz * wz) * inv
          if (turn < minCos) {
            turned += weight
            tx += weight * x
            ty += weight * y
            tr += weight * (x * x + y * y)
            continue
          }
          kept += weight
          points++
          const h = dx * nx + dy * ny + dz * nz
          phi[0] = 1
          phi[1] = x
          phi[2] = y
          phi[3] = x * x
          phi[4] = x * y
          phi[5] = y * y
          for (let r = 0; r < 6; r++) {
            const wr = weight * phi[r]
            b[r] += wr * h
            for (let s = 0; s <= r; s++) m[r * 6 + s] += wr * phi[s]
          }
        }
        // On the strip along an edge: most of the patch turned away, or scan
        // turned away on both sides of the point rather than off to one — a
        // point on a face beside an edge has the other face all on one side.
        const around = turned > TURNED_SHARE * facing && tx * tx + ty * ty < 0.25 * tr * turned
        if (points < 6 || kept < EDGE_SHARE * facing || around) {
          held[v] = 1
          continue
        }
        // A trace of ridge on everything but the height itself: a patch that
        // is a strip, or lopsided, has directions its points say nothing
        // about, and those are left flat rather than wild. Only a trace — any
        // more flattens the part's own curvature too, and shrinks a ball.
        const ridge = kept * 1e-7
        for (let r = 1; r < 6; r++) m[r * 6 + r] += ridge
        const height = solveHeight(m, b)
        if (height === null) {
          held[v] = 1
          continue
        }
        held[v] = 0
        let x = px + part * height * nx
        let y = py + part * height * ny
        let z = pz + part * height * nz
        // Held within the limit of where the scanner put it.
        const ox = x - positions[i], oy = y - positions[i + 1], oz = z - positions[i + 2]
        const d = Math.hypot(ox, oy, oz)
        if (d > limit) {
          const s = limit / d
          x = positions[i] + ox * s
          y = positions[i + 1] + oy * s
          z = positions[i + 2] + oz * s
        }
        next[i] = x
        next[i + 1] = y
        next[i + 2] = z
      }
    }
    const swap = cur
    cur = next
    next = swap
  }

  let moved = 0
  let heldCount = 0
  let maxMove = 0
  let sq = 0
  let atLimit = 0
  for (let v = 0; v < vertexCount; v++) {
    if (!used[v] || (reach && reach[v] === 0)) continue
    const i = v * 3
    const d = Math.hypot(cur[i] - positions[i], cur[i + 1] - positions[i + 1], cur[i + 2] - positions[i + 2])
    // Held is how the last pass left it; a point it held may have moved in
    // the one before, and counts as moved.
    if (held[v] && d === 0) {
      heldCount++
      continue
    }
    moved++
    if (d > maxMove) maxMove = d
    sq += d * d
    if (d >= limit * (1 - 1e-4)) atLimit++
  }
  const edited = compactEdit(cur, indices, vertexCount)
  return {
    ...edited,
    report: {
      settings: { size, limit, keepEdges },
      region: region ? region.length : null,
      moved,
      held: heldCount,
      maxMove,
      rmsMove: moved ? Math.sqrt(sq / moved) : 0,
      atLimit,
    },
  }
}

/**
 * How much of its move each vertex of a marked region makes: nothing at the
 * region's edge, rising smoothly to all of it the size in from there, and
 * nothing outside the region. The edge is the scan just outside it — the
 * vertices next to one inside — so a region that runs to the scan's own
 * open border moves right up to it.
 */
function regionShares(
  positions: Float32Array,
  used: Uint8Array,
  region: Uint32Array,
  size: number,
  offsets: Uint32Array,
  list: Uint32Array,
): Float32Array {
  const n = used.length
  const inside = new Uint8Array(n)
  for (let k = 0; k < region.length; k++) {
    const v = region[k]
    if (v < n && used[v]) inside[v] = 1
  }
  const edge = new Uint8Array(n)
  const either = new Uint8Array(n)
  for (let v = 0; v < n; v++) {
    if (!inside[v]) continue
    either[v] = 1
    for (let k = offsets[v], end = offsets[v + 1]; k < end; k++) {
      const u = list[k]
      if (!inside[u] && used[u]) {
        edge[u] = 1
        either[u] = 1
      }
    }
  }
  const share = new Float32Array(n)
  const grid = cellGrid(positions, either, edge, size)
  const r2 = size * size
  for (let cell = 0; cell < grid.cells; cell++) {
    const [cx, cy, cz] = grid.coords(cell)
    const near: number[] = []
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const other = grid.find(cx + dx, cy + dy, cz + dz)
          if (other < 0) continue
          for (let k = grid.sampleStart[other]; k < grid.sampleStart[other + 1]; k++) near.push(grid.samples[k])
        }
      }
    }
    for (let q = grid.vertexStart[cell]; q < grid.vertexStart[cell + 1]; q++) {
      const v = grid.vertices[q]
      if (!inside[v]) continue
      let d2 = r2
      for (const e of near) {
        const ex = positions[e * 3] - positions[v * 3]
        const ey = positions[e * 3 + 1] - positions[v * 3 + 1]
        const ez = positions[e * 3 + 2] - positions[v * 3 + 2]
        const d = ex * ex + ey * ey + ez * ez
        if (d < d2) d2 = d
      }
      const t = Math.sqrt(d2) / size
      share[v] = t * t * (3 - 2 * t)
    }
  }
  return share
}

/**
 * The scan's vertices and its sampled points, sorted into cubes the size
 * across — so everything within the size of a vertex is in its cube or one
 * of the 26 around it. Only the cubes the scan passes through are kept, by a
 * hash of their coordinates.
 */
function cellGrid(positions: Float32Array, used: Uint8Array, sampled: Uint8Array, size: number) {
  const n = used.length
  let lx = Infinity, ly = Infinity, lz = Infinity
  let hx = -Infinity, hy = -Infinity
  for (let v = 0; v < n; v++) {
    if (!used[v]) continue
    lx = Math.min(lx, positions[v * 3])
    ly = Math.min(ly, positions[v * 3 + 1])
    lz = Math.min(lz, positions[v * 3 + 2])
    hx = Math.max(hx, positions[v * 3])
    hy = Math.max(hy, positions[v * 3 + 1])
  }
  const inv = 1 / size
  const cellOf = new Int32Array(n).fill(-1)
  const cx: number[] = []
  const cy: number[] = []
  const cz: number[] = []
  const ids = new Map<number, number>()
  // Coordinates are counted from the corner, so they are small and
  // non-negative, and three of them pack into one exact number — with room
  // for the ring of cubes one past the far side, which a search looks in.
  const spanX = Math.floor((hx - lx) * inv) + 2
  const spanY = Math.floor((hy - ly) * inv) + 2
  const keyOf = (x: number, y: number, z: number) => x + spanX * (y + spanY * z)
  for (let v = 0; v < n; v++) {
    if (!used[v]) continue
    const x = Math.floor((positions[v * 3] - lx) * inv)
    const y = Math.floor((positions[v * 3 + 1] - ly) * inv)
    const z = Math.floor((positions[v * 3 + 2] - lz) * inv)
    const key = keyOf(x, y, z)
    let id = ids.get(key)
    if (id === undefined) {
      id = cx.length
      ids.set(key, id)
      cx.push(x)
      cy.push(y)
      cz.push(z)
    }
    cellOf[v] = id
  }
  const cells = cx.length
  const vertexStart = new Uint32Array(cells + 1)
  const sampleStart = new Uint32Array(cells + 1)
  for (let v = 0; v < n; v++) {
    const c = cellOf[v]
    if (c < 0) continue
    vertexStart[c + 1]++
    if (sampled[v]) sampleStart[c + 1]++
  }
  for (let c = 0; c < cells; c++) {
    vertexStart[c + 1] += vertexStart[c]
    sampleStart[c + 1] += sampleStart[c]
  }
  const vertices = new Uint32Array(vertexStart[cells])
  const samples = new Uint32Array(sampleStart[cells])
  const vAt = vertexStart.slice(0, cells)
  const sAt = sampleStart.slice(0, cells)
  for (let v = 0; v < n; v++) {
    const c = cellOf[v]
    if (c < 0) continue
    vertices[vAt[c]++] = v
    if (sampled[v]) samples[sAt[c]++] = v
  }
  return {
    cells,
    vertexStart,
    vertices,
    sampleStart,
    samples,
    coords: (c: number): [number, number, number] => [cx[c], cy[c], cz[c]],
    find: (x: number, y: number, z: number): number => {
      if (x < 0 || y < 0 || z < 0 || x >= spanX || y >= spanY) return -1
      return ids.get(keyOf(x, y, z)) ?? -1
    },
  }
}

/** A well-mixed 32-bit hash of a vertex number, unsigned. */
function hash32(v: number): number {
  let h = Math.imul(v ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * The first unknown of the symmetric 6 × 6 system whose lower triangle is in
 * `m`, by Cholesky — null when it is not positive definite, a patch too thin
 * to say anything. `m` and `b` are overwritten.
 */
function solveHeight(m: Float64Array, b: Float64Array): number | null {
  for (let r = 0; r < 6; r++) {
    for (let s = 0; s <= r; s++) {
      let sum = m[r * 6 + s]
      for (let k = 0; k < s; k++) sum -= m[r * 6 + k] * m[s * 6 + k]
      if (r === s) {
        if (!(sum > 1e-12)) return null
        m[r * 6 + r] = Math.sqrt(sum)
      } else {
        m[r * 6 + s] = sum / m[s * 6 + s]
      }
    }
  }
  // L y = b, then Lᵀ x = y, back to the first unknown.
  for (let r = 0; r < 6; r++) {
    let sum = b[r]
    for (let k = 0; k < r; k++) sum -= m[r * 6 + k] * b[k]
    b[r] = sum / m[r * 6 + r]
  }
  for (let r = 5; r >= 0; r--) {
    let sum = b[r]
    for (let k = r + 1; k < 6; k++) sum -= m[k * 6 + r] * b[k]
    b[r] = sum / m[r * 6 + r]
  }
  return Number.isFinite(b[0]) ? b[0] : null
}

/** Area-weighted unit vertex normals, into `out`; a vertex with no area
 *  round it keeps (0, 0, 0). */
export function vertexNormals(positions: Float32Array, indices: Uint32Array, out: Float32Array): void {
  out.fill(0)
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    // Written out rather than looped over the corners: this runs for every
    // triangle of a scan that has millions.
    out[a] += nx
    out[a + 1] += ny
    out[a + 2] += nz
    out[b] += nx
    out[b + 1] += ny
    out[b + 2] += nz
    out[c] += nx
    out[c + 1] += ny
    out[c + 2] += nz
  }
  normalizeAll(out)
}

/** The normals averaged over their neighbours, twice: a scan's own normals
 *  scatter by as much as its noise tilts the triangles, and a patch chosen
 *  by them would leave out good scan at random. Only neighbours facing
 *  within the edge angle are taken in, so a sharp edge's two faces are not
 *  blended into a band of normals that belong to neither. */
function smoothNormals(normals: Float32Array, offsets: Uint32Array, list: Uint32Array, used: Uint8Array): void {
  const tmp = new Float32Array(normals.length)
  for (let pass = 0; pass < 2; pass++) {
    for (let v = 0; v < used.length; v++) {
      const i = v * 3
      const ox = normals[i], oy = normals[i + 1], oz = normals[i + 2]
      let x = ox, y = oy, z = oz
      if (used[v]) {
        for (let k = offsets[v], end = offsets[v + 1]; k < end; k++) {
          const j = list[k] * 3
          if (ox * normals[j] + oy * normals[j + 1] + oz * normals[j + 2] < EDGE_COS) continue
          x += normals[j]
          y += normals[j + 1]
          z += normals[j + 2]
        }
      }
      tmp[i] = x
      tmp[i + 1] = y
      tmp[i + 2] = z
    }
    normalizeAll(tmp)
    normals.set(tmp)
  }
}

function normalizeAll(out: Float32Array): void {
  for (let i = 0; i < out.length; i += 3) {
    const len = Math.hypot(out[i], out[i + 1], out[i + 2])
    if (len > 0) {
      out[i] /= len
      out[i + 1] /= len
      out[i + 2] /= len
    }
  }
}
