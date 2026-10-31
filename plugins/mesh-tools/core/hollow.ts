// SPDX-License-Identifier: AGPL-3.0-only
// A closed part hollowed: its outside left as scanned, and an inner wall
// the thickness in from it all round, facing into a sealed cavity — what a
// resin print is hollowed with, or a cast's core.
//
// The inner wall is not the scan moved in. Moved point by point, a surface
// folds through itself wherever the part is thinner than twice the wall or
// curves tighter than it, and a scan does both somewhere. It is the surface
// the thickness in from the part's own, read off the part's distance field:
// where the part is thinner than twice the wall there is nothing that far in,
// and the part stays solid there; a boss on a thick base keeps its own small
// cavity or none. It never comes nearer the outside than the thickness, so
// the two never cross, and it is closed by how it is made.
//
// The field is read on a grid a third of the thickness across — coarser on
// a part too large for that many points — in four steps. Which grid points
// are inside the part: each column of them along Z crosses the surface at
// points where it enters and leaves, counted by the way each triangle faces.
// How far in each one is, roughly: a distance transform (Felzenszwalb &
// Huttenlocher's, exact on the grid) from every point outside and every
// point next to the surface. Exactly, in a band round where the inner wall
// will be: the distance to the nearest triangle, from the same search the
// deviation maps use. And the wall itself, where the distance crosses the
// thickness: marching tetrahedra on the grid's cubes, each cut into six that
// meet face to face, so the wall closes. Specks of cavity smaller than a
// couple of grid cells across — a thick spot just past twice the wall — are
// left solid, and the wall is reduced to within a sixteenth of a cell of
// itself, a wall that needs no scan's density.

import type { MeshoptSimplifier as Simplifier } from 'meshoptimizer/simplifier'
import { emptyHit, type ClosestHit } from '../../../src/core/deviation/surface'
import { closedness } from './boolean'
import { compactEdit, type EditedMesh } from './edit'
import { compactMesh, round125 } from './reduce'
import { vertexComponents } from '../../../src/core/geometry/unionFind'
import { tetraVolume6 } from '../../../src/core/geometry/centroid'

/** What the field is measured against: the nearest point of the part's
 *  surface, within a distance — NominalSurface. */
export interface DistanceSurface {
  closest(x: number, y: number, z: number, out: ClosestHit, maxDistance?: number): boolean
}

export interface HollowReport {
  thickness: number
  /** The grid the distance field was read on, mm. */
  cell: number
  /** Cavities sealed in the part, the material they took out, mm³, and the
   *  part's enclosed volume before. */
  cavities: number
  removed: number
  volumeBefore: number
  /** Triangles the inner wall brought. */
  triangles: number
}

/** A wall thickness a person would start from: a hundred-and-twenty-fifth
 *  of the part's diagonal, on the 1-2-5 steps — 2 mm on a part a hand's
 *  width across. */
export function defaultWallThickness(bboxDiagonal: number): number {
  return round125(bboxDiagonal * 0.008)
}

/** The most grid points the field is read at — about 60 MB of it. A larger
 *  part is read on a coarser grid. */
const MAX_POINTS = 12_000_000

/** The grid's origin is moved off the part's own corner by these shares of
 *  a cell — a different one on each axis, so no column runs exactly through
 *  a vertex or along an edge of a mesh drawn on round numbers, a face's
 *  diagonal included: with the same share on X and Y, the columns on the
 *  grid's own diagonal run along it, cross nothing, and read as outside. */
const JITTER = [0.381966, 0.2763932, 0.1458980]

/** The inner wall is reduced to within this share of a cell of where the
 *  grid put it: lighter by an order of magnitude, its volume within a few
 *  parts in a thousand. */
const REDUCE_SHARE = 1 / 16

/** A distance the transform has not reached, in squared cells. */
const FAR = 1e20

/** Cavities smaller than this many cubic cells are left solid. */
const MIN_CAVITY_CELLS = 8

/**
 * The part hollowed with a wall `thickness` thick: the outside as it is,
 * every vertex kept, and the inner wall's triangles after them. `surface` is
 * the part's own, for the exact distances; `simplifier`, when given, reduces
 * the inner wall. Throws when the mesh is not closed, or nowhere thick
 * enough to hollow.
 */
export function hollowMesh(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  thickness: number,
  surface: DistanceSurface,
  simplifier: typeof Simplifier | null,
  onProgress?: (text: string) => void,
): EditedMesh & { report: HollowReport } {
  if (!(thickness > 0) || !Number.isFinite(thickness)) throw new Error('The wall thickness must be more than zero.')
  const shut = closedness(indices, vertexCount)
  if (shut.open > 0) {
    throw new Error(
      `The mesh is not closed — ${shut.open.toLocaleString('en-US')} open edge${shut.open === 1 ? '' : 's'}. Hollowing needs a closed part: close it with Fill holes first.`,
    )
  }
  const triangles = indices.length / 3
  const volumeBefore = signedVolume(positions, indices)
  if (!(volumeBefore > 0)) throw new Error('The mesh encloses no volume — is it turned inside out?')

  // ---- the grid ---------------------------------------------------------------
  let lx = Infinity, ly = Infinity, lz = Infinity
  let hx = -Infinity, hy = -Infinity, hz = -Infinity
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3
    lx = Math.min(lx, positions[v]); hx = Math.max(hx, positions[v])
    ly = Math.min(ly, positions[v + 1]); hy = Math.max(hy, positions[v + 1])
    lz = Math.min(lz, positions[v + 2]); hz = Math.max(hz, positions[v + 2])
  }
  let h = thickness / 3
  const dims = (cell: number) => [
    Math.ceil((hx - lx) / cell + 1 + JITTER[0]) + 2,
    Math.ceil((hy - ly) / cell + 1 + JITTER[1]) + 2,
    Math.ceil((hz - lz) / cell + 1 + JITTER[2]) + 2,
  ]
  let [nx, ny, nz] = dims(h)
  while (nx * ny * nz > MAX_POINTS) {
    h *= 1.1
    ;[nx, ny, nz] = dims(h)
  }
  const ox = lx - h * (1 + JITTER[0])
  const oy = ly - h * (1 + JITTER[1])
  const oz = lz - h * (1 + JITTER[2])
  const plane = nx * ny
  const total = plane * nz

  // ---- inside: each column along Z, entered and left ---------------------------
  onProgress?.('Hollowing — finding the inside of the part…')
  const inside = insideGrid(positions, indices, nx, ny, nz, ox, oy, oz, h)

  // ---- roughly how far in: a distance transform from outside and the surface
  onProgress?.('Hollowing — measuring how far in each point is…')
  const field = new Float32Array(total)
  for (let g = 0; g < total; g++) field[g] = inside[g] ? FAR : 0
  // The grid points next to the surface, from points spread over every
  // triangle no further apart than half a cell: a crack narrower than a
  // cell, which no grid point falls into, still counts as surface.
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    const longest = Math.max(
      Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]),
      Math.hypot(positions[c] - positions[b], positions[c + 1] - positions[b + 1], positions[c + 2] - positions[b + 2]),
      Math.hypot(positions[a] - positions[c], positions[a + 1] - positions[c + 1], positions[a + 2] - positions[c + 2]),
    )
    const steps = Math.max(1, Math.ceil((2 * longest) / h))
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; i + j <= steps; j++) {
        const u = i / steps, w = j / steps, s = 1 - u - w
        const x = s * positions[a] + u * positions[b] + w * positions[c]
        const y = s * positions[a + 1] + u * positions[b + 1] + w * positions[c + 1]
        const z = s * positions[a + 2] + u * positions[b + 2] + w * positions[c + 2]
        const gi = Math.round((x - ox) / h), gj = Math.round((y - oy) / h), gk = Math.round((z - oz) / h)
        field[gi + nx * (gj + ny * gk)] = 0
      }
    }
  }
  distanceTransform(field, nx, ny, nz)

  // ---- exactly how far, in a band round the wall ---------------------------------
  // The transform is out by no more than its seeds are from the surface —
  // under a cell either way. A cube the wall crosses has every corner within
  // a body diagonal of it, so the band takes in every corner the wall's
  // place is read from.
  const slack = Math.sqrt(3) * h + 1.5 * h
  const lo = thickness - slack
  const hi = thickness + slack
  const reach = hi + h
  const hit = emptyHit()
  let banded = 0
  for (let g = 0; g < total; g++) {
    if (!inside[g]) {
      field[g] = -thickness
      continue
    }
    const rough = Math.sqrt(field[g]) * h
    if (rough < lo || rough > hi) {
      field[g] = rough - thickness
      continue
    }
    if (banded++ % 200_000 === 0) onProgress?.(`Hollowing — measuring the wall, ${Math.round((100 * g) / total)} %…`)
    const i = g % nx, j = ((g / nx) | 0) % ny, k = (g / plane) | 0
    const found = surface.closest(ox + i * h, oy + j * h, oz + k * h, hit, reach)
    field[g] = (found ? hit.distance : reach) - thickness
  }

  // ---- the wall: where the distance crosses the thickness ----------------------------
  onProgress?.('Hollowing — building the inner wall…')
  const wall = marchTetrahedra(field, nx, ny, nz, ox, oy, oz, h)
  const kept = dropSpecks(wall.positions, wall.indices, MIN_CAVITY_CELLS * h * h * h)
  if (kept.cavities === 0) {
    throw new Error(
      // units-ok: built in the worker, also the agent's answer
      `Nothing to hollow — the part is nowhere thicker than twice the wall, ${round(2 * thickness)} mm. Take a thinner wall.`,
    )
  }
  let inner: { positions: Float32Array; indices: Uint32Array } = { positions: wall.positions, indices: kept.indices }
  if (simplifier) {
    onProgress?.('Hollowing — reducing the inner wall…')
    const [reduced] = simplifier.simplify(kept.indices, wall.positions, 3, 0, h * REDUCE_SHARE, ['ErrorAbsolute'])
    if (reduced.length > 0) inner = compactMesh(wall.positions, reduced)
  } else inner = compactMesh(wall.positions, kept.indices)
  const removed = -signedVolume(inner.positions, inner.indices)

  // ---- the part and its wall, one mesh --------------------------------------------------
  const all = new Float32Array(positions.length + inner.positions.length)
  all.set(positions)
  all.set(inner.positions, positions.length)
  const out = new Uint32Array(indices.length + inner.indices.length)
  out.set(indices)
  for (let i = 0; i < inner.indices.length; i++) out[indices.length + i] = inner.indices[i] + vertexCount
  const edited = compactEdit(all, out, vertexCount)
  return {
    ...edited,
    report: { thickness, cell: h, cavities: kept.cavities, removed, volumeBefore, triangles: inner.indices.length / 3 },
  }
}

const round = (x: number) => Number(x.toPrecision(3))

/** The volume a closed mesh wound outward encloses, mm³ — negative for one
 *  wound inward, as a cavity's wall is. */
export function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let v = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    v +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
  }
  return v / 6
}

/**
 * Which grid points are inside the mesh: 1 each. Every column of points
 * along Z is crossed by the triangles over it — entering the part through
 * one that faces down, leaving through one that faces up — and a point is
 * inside where more have been entered than left below it.
 */
function insideGrid(
  positions: Float32Array,
  indices: Uint32Array,
  nx: number,
  ny: number,
  nz: number,
  ox: number,
  oy: number,
  oz: number,
  h: number,
): Uint8Array {
  const columns = nx * ny
  // Twice over the triangles: first how many crossings each column has,
  // then the crossings themselves, packed column by column.
  const start = new Uint32Array(columns + 1)
  const visit = (fill: ((column: number, z: number, enter: boolean) => void) | null) => {
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
      const ax = positions[a], ay = positions[a + 1]
      const bx = positions[b], by = positions[b + 1]
      const cx = positions[c], cy = positions[c + 1]
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (area === 0) continue
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - ox) / h))
      const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - ox) / h))
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - oy) / h))
      const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - oy) / h))
      for (let j = j0; j <= j1; j++) {
        const py = oy + j * h
        for (let i = i0; i <= i1; i++) {
          const px = ox + i * h
          const wc = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
          const wa = (cx - bx) * (py - by) - (cy - by) * (px - bx)
          const wb = (ax - cx) * (py - cy) - (ay - cy) * (px - cx)
          if (area > 0 ? wa <= 0 || wb <= 0 || wc <= 0 : wa >= 0 || wb >= 0 || wc >= 0) continue
          const column = i + nx * j
          if (!fill) {
            start[column + 1]++
            continue
          }
          const z = (wa * positions[a + 2] + wb * positions[b + 2] + wc * positions[c + 2]) / area
          // Facing up — wound anticlockwise seen from above — is a way out.
          fill(column, z, area < 0)
        }
      }
    }
  }
  visit(null)
  for (let c = 0; c < columns; c++) start[c + 1] += start[c]
  const zs = new Float64Array(start[columns])
  const enters = new Int8Array(start[columns])
  const at = start.slice(0, columns)
  visit((column, z, enter) => {
    const k = at[column]++
    zs[k] = z
    enters[k] = enter ? 1 : -1
  })

  const inside = new Uint8Array(columns * nz)
  for (let column = 0; column < columns; column++) {
    const from = start[column], to = start[column + 1]
    if (to - from < 2) continue
    // A handful each: sorted in place by insertion.
    for (let p = from + 1; p < to; p++) {
      const z = zs[p], e = enters[p]
      let q = p - 1
      while (q >= from && zs[q] > z) {
        zs[q + 1] = zs[q]
        enters[q + 1] = enters[q]
        q--
      }
      zs[q + 1] = z
      enters[q + 1] = e
    }
    let p = from
    let winding = 0
    for (let k = 0; k < nz; k++) {
      const z = oz + k * h
      while (p < to && zs[p] < z) winding += enters[p++]
      if (winding > 0) inside[column + columns * k] = 1
    }
  }
  return inside
}

/**
 * The squared distance, in cells, from every grid point to the nearest one
 * at zero — in place, Felzenszwalb & Huttenlocher's transform one axis at a
 * time.
 */
function distanceTransform(field: Float32Array, nx: number, ny: number, nz: number): void {
  const n = Math.max(nx, ny, nz)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const line = (start: number, stride: number, count: number) => {
    let any = false
    for (let q = 0; q < count; q++) {
      f[q] = field[start + q * stride]
      if (f[q] < FAR) any = true
    }
    if (!any) return
    transform1d(f, count, d, v, z)
    for (let q = 0; q < count; q++) field[start + q * stride] = d[q]
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) line(nx * (j + ny * k), 1, nx)
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) line(i + nx * ny * k, nx, ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) line(i + nx * j, nx * ny, nz)
}

/** One line of the transform: the lower envelope of the parabolas rooted at
 *  each point's value. */
function transform1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    if (f[q] >= FAR) continue
    if (f[v[k]] >= FAR) {
      // Only far points so far: this one starts the envelope.
      v[0] = q
      k = 0
      z[0] = -Infinity
      z[1] = Infinity
      continue
    }
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const r = q - v[k]
    d[q] = f[v[k]] >= FAR ? FAR : r * r + f[v[k]]
  }
}

/** The six tetrahedra of a cube, Kuhn's: each runs from the cube's lowest
 *  corner to its highest along the edges in one order of the axes, so two
 *  cubes side by side cut their shared face the same way. Corners by bits —
 *  1 is +X, 2 +Y, 4 +Z. */
const TETS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 3, 7],
  [0, 1, 5, 7],
  [0, 2, 3, 7],
  [0, 2, 6, 7],
  [0, 4, 5, 7],
  [0, 4, 6, 7],
]

/** A Float32Array or Uint32Array that grows as it is written. */
class Grow<T extends Float32Array | Uint32Array> {
  length = 0
  constructor(public data: T) {}
  push(x: number): void {
    if (this.length === this.data.length) {
      const bigger = new (this.data.constructor as { new (n: number): T })(this.data.length * 2)
      bigger.set(this.data)
      this.data = bigger
    }
    this.data[this.length++] = x
  }
  done(): T {
    return this.data.slice(0, this.length) as T
  }
}

/**
 * The surface where `field` crosses zero, by marching tetrahedra: one vertex
 * on each grid edge it crosses, shared by every triangle on that edge, and
 * every triangle facing the side where the field is positive.
 */
function marchTetrahedra(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  ox: number,
  oy: number,
  oz: number,
  h: number,
): { positions: Float32Array; indices: Uint32Array } {
  const plane = nx * ny
  const total = plane * nz
  const corner = [0, 1, nx, nx + 1, plane, plane + 1, plane + nx, plane + nx + 1]
  const positions = new Grow(new Float32Array(1 << 16))
  const indices = new Grow(new Uint32Array(1 << 16))
  const onEdge = new Map<number, number>()
  const px = (g: number) => ox + (g % nx) * h
  const py = (g: number) => oy + (((g / nx) | 0) % ny) * h
  const pz = (g: number) => oz + ((g / plane) | 0) * h

  const vertexOn = (a: number, b: number): number => {
    const key = a < b ? a * total + b : b * total + a
    let id = onEdge.get(key)
    if (id !== undefined) return id
    const fa = field[a]
    const fb = field[b]
    const s = fa / (fa - fb)
    id = positions.length / 3
    positions.push(px(a) + s * (px(b) - px(a)))
    positions.push(py(a) + s * (py(b) - py(a)))
    positions.push(pz(a) + s * (pz(b) - pz(a)))
    onEdge.set(key, id)
    return id
  }
  // Emit a triangle facing `dx, dy, dz` — towards the positive side.
  const emit = (a: number, b: number, c: number, dx: number, dy: number, dz: number) => {
    const p = positions.data
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
    const dot = (uy * vz - uz * vy) * dx + (uz * vx - ux * vz) * dy + (ux * vy - uy * vx) * dz
    indices.push(a)
    if (dot >= 0) {
      indices.push(b)
      indices.push(c)
    } else {
      indices.push(c)
      indices.push(b)
    }
  }

  const g = new Int32Array(8)
  const pos: number[] = []
  const neg: number[] = []
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const origin = i + nx * j + plane * k
        let above = 0
        for (let c = 0; c < 8; c++) {
          g[c] = origin + corner[c]
          if (field[g[c]] > 0) above++
        }
        if (above === 0 || above === 8) continue
        for (const tet of TETS) {
          pos.length = 0
          neg.length = 0
          for (const c of tet) (field[g[c]] > 0 ? pos : neg).push(g[c])
          if (pos.length === 0 || neg.length === 0) continue
          // Which way is out of the material: from the corners below zero
          // to those above.
          let dx = 0, dy = 0, dz = 0
          for (const p of pos) {
            dx += px(p) / pos.length
            dy += py(p) / pos.length
            dz += pz(p) / pos.length
          }
          for (const q of neg) {
            dx -= px(q) / neg.length
            dy -= py(q) / neg.length
            dz -= pz(q) / neg.length
          }
          if (pos.length === 1 || neg.length === 1) {
            const [lone, others] = pos.length === 1 ? [pos[0], neg] : [neg[0], pos]
            emit(vertexOn(lone, others[0]), vertexOn(lone, others[1]), vertexOn(lone, others[2]), dx, dy, dz)
          } else {
            const a = vertexOn(pos[0], neg[0])
            const b = vertexOn(pos[0], neg[1])
            const c = vertexOn(pos[1], neg[1])
            const d = vertexOn(pos[1], neg[0])
            emit(a, b, c, dx, dy, dz)
            emit(a, c, d, dx, dy, dz)
          }
        }
      }
    }
  }
  return { positions: positions.done(), indices: indices.done() }
}

/**
 * The inner wall's pieces — each the wall of one cavity — without those
 * enclosing less than `minVolume`: the triangles kept, and how many
 * cavities they wall.
 */
function dropSpecks(positions: Float32Array, indices: Uint32Array, minVolume: number): { indices: Uint32Array; cavities: number } {
  // The roots are only keys here, so which corner's root wins does not matter.
  const { find } = vertexComponents(indices, positions.length / 3)
  // Each piece's volume, from its triangles — negative, as it faces in.
  const volume = new Map<number, number>()
  for (let t = 0; t < indices.length; t += 3) {
    const v = tetraVolume6(positions, indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3)
    const root = find(indices[t])
    volume.set(root, (volume.get(root) ?? 0) + v / 6)
  }
  let cavities = 0
  for (const v of volume.values()) if (-v >= minVolume) cavities++
  const out = new Grow(new Uint32Array(Math.max(16, indices.length)))
  for (let t = 0; t < indices.length; t += 3) {
    if (-(volume.get(find(indices[t])) ?? 0) < minVolume) continue
    out.push(indices[t])
    out.push(indices[t + 1])
    out.push(indices[t + 2])
  }
  return { indices: out.done(), cavities }
}
