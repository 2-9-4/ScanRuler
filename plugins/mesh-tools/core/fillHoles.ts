// SPDX-License-Identifier: AGPL-3.0-only
// Holes in the scan closed with patches that carry the surface across them.
//
// A scanner leaves holes where it could not see: the bottom of a blind bore,
// the inside of a sharp corner, a shiny spot, the pin the part stood on. A
// slicer wants a closed mesh, and a hole in a face reads as missing material
// on every map. The method is the one most mesh tools use, after Liepa's
// "Filling holes in meshes" (2003), in three steps:
//
//   Triangulate — the rim is closed with triangles between its own vertices,
//      chosen over all the ways it can be done for the patch that bends least:
//      the largest angle between neighbouring triangles, the rim's triangles
//      on the scan included, as small as it can be, and of the patches that
//      share it the smallest in area. A dynamic program finds it exactly, in
//      the cube of the rim's length; a rim too long for that is laid flat
//      across the plane it lies nearest, as long as it does not cross itself
//      seen from there.
//   Refine — the patch is given points where its triangles are much larger
//      than the scan's around the rim, one in the middle of each, and its
//      edges are flipped towards well-shaped triangles, until it is as dense
//      as the surface it continues.
//   Fair — the new points are moved to make the patch smooth: Curved asks for
//      it to continue the surface's bending across the hole (a least-squares
//      bi-Laplacian that reaches one ring out onto the scan, so the patch
//      meets it at its slope); Flat asks only for the tightest patch across
//      the rim (a membrane), which is flat wherever the rim is.
//
// A hole is judged by its size across — its rim's bounding box, the same
// measure an island is judged by — so a scan's own open border, which is as
// large as the part, is never taken for one. Every vertex of the scan stays
// where and what it was; the patches only add.

import { Vector2 } from 'three'
import { buildAdjacency } from '../../../src/core/geometry/adjacency'
import { orthoBasis } from '../../../src/core/fit/linalg'
import type { Vec3 } from '../../../src/core/types'
import { round125 } from './reduce'
import { boundaryLoops, loopSize, type BoundaryLoop } from './boundary'
import { compactEdit, type EditedMesh } from './edit'
import { fillPlanarLoops, selfCrossing } from './planar'

export type FillMode = 'curved' | 'flat'

/** The size under which a rim is a hole to fill: a twentieth of the part's
 *  diagonal, on the 1-2-5 steps — 10 mm for a part a hand's width across.
 *  Large enough for the holes a scanner leaves, a bore's bottom or a pin's
 *  footprint; well short of the opening a part scanned standing on its base
 *  leaves, which is as large as the part. */
export function defaultHoleSize(bboxDiagonal: number): number {
  return round125(bboxDiagonal * 0.05)
}

export interface HoleSurvey {
  /** Rims in the scan — holes, and open borders. */
  rims: number
  /** Of them, the ones smaller across than the size: the holes to fill. */
  holes: number
  /** Across the largest hole, and the smallest rim left open, mm. */
  largestHole: number | null
  smallestOpen: number | null
}

export interface HoleMarks {
  /** The holes' rims as line segments, six floats an edge, and the middle of
   *  each hole, three floats — where the viewport rings it. */
  holes: Float32Array
  centres: Float32Array
  /** The rims left open, as segments the same way. */
  open: Float32Array
}

/** The scan's rims, sorted into holes under `maxSize` and the rest. */
export function surveyHoles(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  maxSize: number,
): { survey: HoleSurvey; marks: HoleMarks } {
  const { loops } = boundaryLoops(indices, vertexCount)
  const holeSegments: number[] = []
  const openSegments: number[] = []
  const centres: number[] = []
  let holes = 0
  let largestHole: number | null = null
  let smallestOpen: number | null = null
  for (const loop of loops) {
    const size = loopSize(positions, loop.vertices)
    const isHole = size < maxSize
    const out = isHole ? holeSegments : openSegments
    const n = loop.vertices.length
    for (let i = 0; i < n; i++) {
      const a = loop.vertices[i] * 3
      const b = loop.vertices[(i + 1) % n] * 3
      out.push(positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2])
    }
    if (isHole) {
      holes++
      centres.push(...loopMiddle(positions, loop.vertices))
      if (largestHole === null || size > largestHole) largestHole = size
    } else if (smallestOpen === null || size < smallestOpen) {
      smallestOpen = size
    }
  }
  return {
    survey: { rims: loops.length, holes, largestHole, smallestOpen },
    marks: {
      holes: new Float32Array(holeSegments),
      centres: new Float32Array(centres),
      open: new Float32Array(openSegments),
    },
  }
}

/** The middle of a rim: the mean of its vertices — where the viewport rings
 *  a hole, and how a click on the ring finds it again. */
function loopMiddle(positions: Float32Array, loop: ArrayLike<number>): Vec3 {
  let cx = 0, cy = 0, cz = 0
  const n = loop.length
  for (let i = 0; i < n; i++) {
    const v = loop[i] * 3
    cx += positions[v]
    cy += positions[v + 1]
    cz += positions[v + 2]
  }
  return [cx / n, cy / n, cz / n]
}

export interface FillReport {
  /** Holes closed, and the triangles and points the patches took. */
  filled: number
  triangles: number
  vertices: number
  /** Holes under the size that could not be closed — a long rim that
   *  crosses itself seen from every side it could be laid flat from. */
  failed: number
  /** Rims past the size, left open. */
  left: number
}

/** Rims up to this many edges are triangulated by the exact search — the
 *  cube of it in time, a few hundred milliseconds at the most. */
const SEARCH_LIMIT = 500

/** A patch never takes more points than this — a runaway refinement of a
 *  hole far past anything the size would let through. */
const MAX_PATCH_POINTS = 250_000

/** Close every hole smaller across than `maxSize` — or, `at` given, only the
 *  one of them whose middle (as surveyHoles gives it) is nearest there. */
export function fillHoles(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  maxSize: number,
  mode: FillMode,
  onProgress?: (text: string) => void,
  at?: Vec3,
): EditedMesh & { report: FillReport } {
  if (!(maxSize > 0)) throw new Error('The size must be more than zero.')
  const { loops } = boundaryLoops(indices, vertexCount)
  let holes = loops.filter((l) => loopSize(positions, l.vertices) < maxSize)
  if (holes.length === 0) throw new Error('No hole in the scan is smaller than that.')
  if (at) {
    let best: BoundaryLoop | null = null
    let bestDistance = Infinity
    for (const loop of holes) {
      const [cx, cy, cz] = loopMiddle(positions, loop.vertices)
      const d = Math.hypot(cx - at[0], cy - at[1], cz - at[2])
      if (d < bestDistance) {
        best = loop
        bestDistance = d
      }
    }
    holes = [best!]
  }
  const adjacency = buildAdjacency(indices, vertexCount)

  const extra: number[] = []
  const added: number[] = []
  let filled = 0
  let failed = 0
  holes.forEach((loop, h) => {
    if (h % 25 === 0) onProgress?.(`Filling holes — ${h.toLocaleString('en-US')} of ${holes.length.toLocaleString('en-US')}…`)
    const patch = patchFor(positions, loop, adjacency, mode)
    if (!patch) {
      failed++
      return
    }
    // Patch-local numbers onto the mesh's: the rim's own vertices, then the
    // new points after everything added so far.
    const n = loop.vertices.length
    const base = vertexCount + extra.length / 3
    for (let i = n * 3; i < patch.pos.length; i++) extra.push(patch.pos[i])
    for (const v of patch.tris) added.push(v < n ? loop.vertices[v] : base + v - n)
    filled++
  })
  if (filled === 0) throw new Error('None of the holes could be closed — every rim crosses itself too much to lay a patch across.')

  const all = new Float32Array(positions.length + extra.length)
  all.set(positions)
  all.set(extra, positions.length)
  const out = new Uint32Array(indices.length + added.length)
  out.set(indices)
  out.set(added, indices.length)
  const edited = compactEdit(all, out, vertexCount)
  return {
    ...edited,
    report: {
      filled,
      triangles: added.length / 3,
      vertices: extra.length / 3,
      failed,
      left: loops.length - holes.length,
    },
  }
}

/** A patch across one rim, in its own numbering: the rim's vertices first,
 *  in loop order, then the points it adds. */
interface Patch {
  pos: number[]
  tris: number[]
}

function patchFor(
  positions: Float32Array,
  loop: BoundaryLoop,
  adjacency: { offsets: Uint32Array; list: Uint32Array },
  mode: FillMode,
): Patch | null {
  const n = loop.vertices.length
  const pos: number[] = []
  for (let i = 0; i < n; i++) {
    const v = loop.vertices[i] * 3
    pos.push(positions[v], positions[v + 1], positions[v + 2])
  }
  let tris: number[] | null
  if (n === 3) tris = [0, 2, 1]
  else if (n <= SEARCH_LIMIT) tris = searchTriangulation(pos, positions, loop)
  else tris = flatTriangulation(pos, n)
  if (!tris || tris.length === 0) return null

  // How dense the scan is along the rim: the mean of the two rim edges at
  // each of its vertices.
  const sigma: number[] = []
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n
    const q = (i + 1) % n
    sigma.push((dist(pos, p, i) + dist(pos, i, q)) / 2)
  }
  const mesh = new PatchMesh(pos, tris)
  refine(mesh, sigma)
  const free = mesh.pos.length / 3 - n
  fair(mesh, n, positions, loop.vertices, adjacency, mode, Math.min(MAX_FAIR_ITERATIONS, 50 + 2 * free))
  return { pos: mesh.pos, tris: mesh.tris }
}

/** The fairing solver's passes at the most. A large patch is smooth long
 *  before it has fully converged, and what is left is the last shade of
 *  its bulge; passes cost the patch's size each. */
const MAX_FAIR_ITERATIONS = 600

// ---- Triangulate ------------------------------------------------------------

/**
 * The triangulation of the rim that bends least (Liepa's min–max dihedral,
 * then least area), by dynamic programming over its sub-polygons. Triangles
 * come back as patch-local triples, each wound to walk the rim's edges the
 * other way from the scan's triangle on them, as a patch joined to the scan
 * must.
 */
function searchTriangulation(pos: number[], positions: Float32Array, loop: BoundaryLoop): number[] {
  const n = loop.vertices.length
  // The scan's triangle on each rim edge i → i+1, by its unit normal.
  const rim = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const o = loop.opposite[i] * 3
    unitNormal(
      pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2],
      pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2],
      positions[o], positions[o + 1], positions[o + 2],
      rim, i * 3,
    )
  }
  const cell = (i: number, j: number) => i * n + j
  // The worst — smallest — cosine between neighbouring triangles inside the
  // best patch across i..j, its area, the vertex its top triangle takes, and
  // that triangle's unit normal.
  const worst = new Float64Array(n * n).fill(1)
  const area = new Float64Array(n * n)
  const best = new Int32Array(n * n).fill(-1)
  const normal = new Float64Array(n * n * 3)
  const nt = new Float64Array(3)
  const cosWith = (buf: Float64Array, at: number) =>
    buf[at] === 0 && buf[at + 1] === 0 && buf[at + 2] === 0 ? 1 : nt[0] * buf[at] + nt[1] * buf[at + 1] + nt[2] * buf[at + 2]

  for (let span = 2; span < n; span++) {
    for (let i = 0; i + span < n; i++) {
      const j = i + span
      let bestCos = -Infinity
      let bestArea = Infinity
      let bestK = -1
      let bx = 0, by = 0, bz = 0
      for (let k = i + 1; k < j; k++) {
        // The triangle (i, j, k), wound against the rim.
        const a2 = unitNormal(
          pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2],
          pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2],
          pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2],
          nt, 0,
        )
        let c = a2 > 0 ? 1 : -1
        c = Math.min(c, worst[cell(i, k)], worst[cell(k, j)])
        c = Math.min(c, k === i + 1 ? cosWith(rim, i * 3) : cosWith(normal, cell(i, k) * 3))
        c = Math.min(c, j === k + 1 ? cosWith(rim, k * 3) : cosWith(normal, cell(k, j) * 3))
        if (i === 0 && j === n - 1) c = Math.min(c, cosWith(rim, (n - 1) * 3))
        const ar = area[cell(i, k)] + area[cell(k, j)] + a2 / 2
        if (c > bestCos + 1e-12 || (c >= bestCos - 1e-12 && ar < bestArea)) {
          bestCos = c
          bestArea = ar
          bestK = k
          bx = nt[0]
          by = nt[1]
          bz = nt[2]
        }
      }
      const at = cell(i, j)
      worst[at] = bestCos
      area[at] = bestArea
      best[at] = bestK
      normal[at * 3] = bx
      normal[at * 3 + 1] = by
      normal[at * 3 + 2] = bz
    }
  }

  const tris: number[] = []
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length > 0) {
    const [i, j] = stack.pop()!
    if (j - i < 2) continue
    const k = best[cell(i, j)]
    tris.push(i, j, k)
    stack.push([i, k], [k, j])
  }
  return tris
}

/** A long rim laid flat across the plane it lies nearest (Newell's), and
 *  ear-clipped there — or null where it crosses itself seen from there. */
function flatTriangulation(pos: number[], n: number): number[] | null {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const [x0, y0, z0] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
    const [x1, y1, z1] = [pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]]
    nx += (y0 - y1) * (z0 + z1)
    ny += (z0 - z1) * (x0 + x1)
    nz += (x0 - x1) * (y0 + y1)
  }
  const len = Math.hypot(nx, ny, nz)
  if (!(len > 0)) return null
  const [u, v] = orthoBasis([nx / len, ny / len, nz / len] as Vec3)
  const flat: Vector2[] = []
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    flat.push(new Vector2(x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]))
  }
  if (selfCrossing(flat)) return null
  const loop = Array.from({ length: n }, (_, i) => i)
  const fill = fillPlanarLoops(pos, [loop], u, v)
  return fill.faces > 0 ? fill.triangles : null
}

// ---- Refine -------------------------------------------------------------------

/** A patch's triangles with its half-edges indexed, for splitting and
 *  flipping in place. */
class PatchMesh {
  pos: number[]
  tris: number[]
  private edges = new Map<number, number>()

  constructor(pos: number[], tris: number[]) {
    this.pos = pos
    this.tris = tris
    for (let t = 0; t < tris.length / 3; t++) this.index(t, true)
  }

  get triangleCount(): number {
    return this.tris.length / 3
  }

  /** The triangle walking a → b, or undefined. */
  walking(a: number, b: number): number | undefined {
    return this.edges.get(a * EDGE_KEY + b)
  }

  set(t: number, a: number, b: number, c: number): void {
    if (t * 3 < this.tris.length) this.index(t, false)
    this.tris[t * 3] = a
    this.tris[t * 3 + 1] = b
    this.tris[t * 3 + 2] = c
    this.index(t, true)
  }

  add(a: number, b: number, c: number): void {
    this.set(this.triangleCount, a, b, c)
  }

  /** The corner of triangle `t` that is neither `a` nor `b`. */
  third(t: number, a: number, b: number): number {
    for (let k = 0; k < 3; k++) {
      const v = this.tris[t * 3 + k]
      if (v !== a && v !== b) return v
    }
    return -1
  }

  private index(t: number, on: boolean): void {
    for (let k = 0; k < 3; k++) {
      const a = this.tris[t * 3 + k]
      const b = this.tris[t * 3 + ((k + 1) % 3)]
      if (on) this.edges.set(a * EDGE_KEY + b, t)
      else if (this.edges.get(a * EDGE_KEY + b) === t) this.edges.delete(a * EDGE_KEY + b)
    }
  }
}

const EDGE_KEY = 2 ** 21

/**
 * Liepa's refinement: a triangle whose middle lies further from each of its
 * corners than the density there calls for — by a factor of √2 — is split
 * at its middle, and the edges around it flipped where that makes better
 * triangles, until none is left too large.
 */
function refine(mesh: PatchMesh, sigma: number[]): void {
  const alpha = Math.SQRT2
  for (let round = 0; round < 64; round++) {
    let splits = 0
    const count = mesh.triangleCount
    for (let t = 0; t < count; t++) {
      if (mesh.pos.length / 3 >= MAX_PATCH_POINTS) return
      const a = mesh.tris[t * 3], b = mesh.tris[t * 3 + 1], c = mesh.tris[t * 3 + 2]
      const p = mesh.pos
      const gx = (p[a * 3] + p[b * 3] + p[c * 3]) / 3
      const gy = (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3
      const gz = (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3
      const sg = (sigma[a] + sigma[b] + sigma[c]) / 3
      let split = true
      for (const m of [a, b, c]) {
        const d = alpha * Math.hypot(gx - p[m * 3], gy - p[m * 3 + 1], gz - p[m * 3 + 2])
        if (!(d > sg && d > sigma[m])) {
          split = false
          break
        }
      }
      if (!split) continue
      const g = p.length / 3
      p.push(gx, gy, gz)
      sigma.push(sg)
      mesh.set(t, a, b, g)
      mesh.add(b, c, g)
      mesh.add(c, a, g)
      flipIfBetter(mesh, a, b)
      flipIfBetter(mesh, b, c)
      flipIfBetter(mesh, c, a)
      splits++
    }
    relaxAll(mesh)
    if (splits === 0) return
  }
}

/** Every edge of the patch tested once, and the four around each flip tested
 *  again — a flip can only make its neighbours worth flipping — until none
 *  flips, or a budget runs out on a patch that would go round in circles. */
function relaxAll(mesh: PatchMesh): void {
  const queue: number[] = []
  for (let t = 0; t < mesh.triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.tris[t * 3 + k]
      const b = mesh.tris[t * 3 + ((k + 1) % 3)]
      if (a < b) queue.push(a, b)
    }
  }
  let budget = 8 * queue.length
  while (queue.length > 0 && budget-- > 0) {
    const b = queue.pop()!
    const a = queue.pop()!
    const t1 = mesh.walking(a, b)
    const t2 = mesh.walking(b, a)
    if (t1 === undefined || t2 === undefined) continue
    const c = mesh.third(t1, a, b)
    const d = mesh.third(t2, a, b)
    if (flipIfBetter(mesh, a, b)) queue.push(a, c, c, b, b, d, d, a)
  }
}

/**
 * Flip the edge a–b to the other diagonal of the two triangles on it when
 * their corners across it see it at more than a straight angle together —
 * the Delaunay test — and the flip neither folds the surface nor doubles an
 * edge. An edge on the rim has one triangle in the patch and never flips.
 */
function flipIfBetter(mesh: PatchMesh, a: number, b: number): boolean {
  const t1 = mesh.walking(a, b)
  const t2 = mesh.walking(b, a)
  if (t1 === undefined || t2 === undefined) return false
  const c = mesh.third(t1, a, b)
  const d = mesh.third(t2, a, b)
  if (c < 0 || d < 0 || c === d) return false
  if (mesh.walking(c, d) !== undefined || mesh.walking(d, c) !== undefined) return false
  const p = mesh.pos
  if (angleAt(p, c, a, b) + angleAt(p, d, a, b) <= Math.PI + 1e-9) return false
  // Before and after, by the triangles' normals: the flip must keep the two
  // facing the same way, and the way the pair faced.
  const before = FLIP_BEFORE
  const after = FLIP_AFTER
  unitNormalOf(p, a, b, c, before, 0)
  unitNormalOf(p, b, a, d, before, 3)
  const ok1 = unitNormalOf(p, d, b, c, after, 0)
  const ok2 = unitNormalOf(p, c, a, d, after, 3)
  if (!ok1 || !ok2) return false
  if (after[0] * after[3] + after[1] * after[4] + after[2] * after[5] <= 0) return false
  const sx = before[0] + before[3], sy = before[1] + before[4], sz = before[2] + before[5]
  if ((after[0] + after[3]) * sx + (after[1] + after[4]) * sy + (after[2] + after[5]) * sz <= 0) return false
  mesh.set(t1, d, b, c)
  mesh.set(t2, c, a, d)
  return true
}

/** Scratch for flipIfBetter, which runs for every edge of every patch. */
const FLIP_BEFORE = new Float64Array(6)
const FLIP_AFTER = new Float64Array(6)

// ---- Fair ---------------------------------------------------------------------

/**
 * Move the patch's new points to make it smooth, the rim and the scan around
 * it held where they are: least squares on the umbrella Laplacian — every
 * point the mean of its neighbours — over the new points alone for Flat, and
 * over the rim's vertices as well for Curved, whose neighbours reach one ring
 * out onto the scan and so carry its slope into the patch. Solved by
 * conjugate gradients on the normal equations, a coordinate at a time.
 */
function fair(
  mesh: PatchMesh,
  rimCount: number,
  positions: Float32Array,
  rim: Uint32Array,
  adjacency: { offsets: Uint32Array; list: Uint32Array },
  mode: FillMode,
  iterations: number,
): void {
  const local = mesh.pos.length / 3
  const free = local - rimCount
  if (free <= 0) return

  // Everything the rows reach, in one numbering: the patch's points, then the
  // scan's vertices one ring out, fixed.
  const x = mesh.pos.slice()
  const ring = new Map<number, number>()
  const rimLocal = new Map<number, number>()
  for (let i = 0; i < rimCount; i++) rimLocal.set(rim[i], i)
  const neighbours: Set<number>[] = Array.from({ length: local }, () => new Set<number>())
  for (let t = 0; t < mesh.triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.tris[t * 3 + k]
      const b = mesh.tris[t * 3 + ((k + 1) % 3)]
      neighbours[a].add(b)
      neighbours[b].add(a)
    }
  }
  const rows: number[] = []
  for (let v = rimCount; v < local; v++) rows.push(v)
  if (mode === 'curved') {
    for (let i = 0; i < rimCount; i++) {
      const g = rim[i]
      for (let k = adjacency.offsets[g]; k < adjacency.offsets[g + 1]; k++) {
        const u = adjacency.list[k]
        let id = rimLocal.get(u)
        if (id === undefined) {
          id = ring.get(u)
          if (id === undefined) {
            id = x.length / 3
            ring.set(u, id)
            x.push(positions[u * 3], positions[u * 3 + 1], positions[u * 3 + 2])
          }
        }
        neighbours[i].add(id)
      }
      rows.push(i)
    }
  }
  const isFree = (v: number) => v >= rimCount && v < local
  const rowNbrs = rows.map((r) => Int32Array.from(neighbours[r]))

  // A x (rows ← free) and Aᵀ y (free ← rows); the free points are numbered
  // from zero in both.
  const applyA = (xf: Float64Array, y: Float64Array) => {
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r]
      const nb = rowNbrs[r]
      let s = 0
      for (let k = 0; k < nb.length; k++) if (isFree(nb[k])) s += xf[nb[k] - rimCount]
      y[r] = (isFree(v) ? xf[v - rimCount] : 0) - s / nb.length
    }
  }
  const applyAt = (y: Float64Array, z: Float64Array) => {
    z.fill(0)
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r]
      const nb = rowNbrs[r]
      if (isFree(v)) z[v - rimCount] += y[r]
      const w = y[r] / nb.length
      for (let k = 0; k < nb.length; k++) if (isFree(nb[k])) z[nb[k] - rimCount] -= w
    }
  }

  const ay = new Float64Array(rows.length)
  const normal = (xf: Float64Array, out: Float64Array) => {
    applyA(xf, ay)
    applyAt(ay, out)
  }
  // The diagonal of AᵀA, to precondition with: each row's coefficients
  // squared, summed onto the free points they fall on.
  const diagonal = new Float64Array(free)
  for (let r = 0; r < rows.length; r++) {
    const v = rows[r]
    const nb = rowNbrs[r]
    if (isFree(v)) diagonal[v - rimCount] += 1
    const w = 1 / (nb.length * nb.length)
    for (let k = 0; k < nb.length; k++) if (isFree(nb[k])) diagonal[nb[k] - rimCount] += w
  }
  for (let axis = 0; axis < 3; axis++) {
    // The fixed points' share of each row, moved to the right-hand side.
    const c = new Float64Array(rows.length)
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r]
      const nb = rowNbrs[r]
      let s = 0
      for (let k = 0; k < nb.length; k++) if (!isFree(nb[k])) s += x[nb[k] * 3 + axis]
      c[r] = (isFree(v) ? 0 : x[v * 3 + axis]) - s / nb.length
    }
    const b = new Float64Array(free)
    applyAt(c, b)
    for (let i = 0; i < free; i++) b[i] = -b[i]

    const xf = new Float64Array(free)
    for (let i = 0; i < free; i++) xf[i] = x[(rimCount + i) * 3 + axis]
    conjugateGradient(normal, b, xf, diagonal, iterations)
    for (let i = 0; i < free; i++) mesh.pos[(rimCount + i) * 3 + axis] = xf[i]
  }
}

/** Conjugate gradients, preconditioned by the matrix's diagonal, from the
 *  `x` given and for at most `maxIterations` passes. */
function conjugateGradient(
  apply: (x: Float64Array, out: Float64Array) => void,
  b: Float64Array,
  x: Float64Array,
  diagonal: Float64Array,
  maxIterations: number,
): void {
  const n = b.length
  const r = new Float64Array(n)
  const z = new Float64Array(n)
  const p = new Float64Array(n)
  const ap = new Float64Array(n)
  const inv = new Float64Array(n)
  for (let i = 0; i < n; i++) inv[i] = diagonal[i] > 0 ? 1 / diagonal[i] : 1
  apply(x, ap)
  let rz = 0
  let rr = 0
  let bb = 0
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - ap[i]
    z[i] = r[i] * inv[i]
    p[i] = z[i]
    rz += r[i] * z[i]
    rr += r[i] * r[i]
    bb += b[i] * b[i]
  }
  const stop = Math.max(bb, 1e-30) * 1e-20
  for (let it = 0; it < maxIterations && rr > stop; it++) {
    apply(p, ap)
    let pap = 0
    for (let i = 0; i < n; i++) pap += p[i] * ap[i]
    if (!(pap > 0)) return
    const alpha = rz / pap
    let nextRz = 0
    rr = 0
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]
      r[i] -= alpha * ap[i]
      z[i] = r[i] * inv[i]
      nextRz += r[i] * z[i]
      rr += r[i] * r[i]
    }
    const beta = nextRz / rz
    rz = nextRz
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]
  }
}

// ---- small geometry -----------------------------------------------------------

function dist(p: number[], a: number, b: number): number {
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2])
}

/** The angle at corner `c` of the triangle c, a, b. */
function angleAt(p: number[], c: number, a: number, b: number): number {
  const ux = p[a * 3] - p[c * 3], uy = p[a * 3 + 1] - p[c * 3 + 1], uz = p[a * 3 + 2] - p[c * 3 + 2]
  const vx = p[b * 3] - p[c * 3], vy = p[b * 3 + 1] - p[c * 3 + 1], vz = p[b * 3 + 2] - p[c * 3 + 2]
  const lu = Math.hypot(ux, uy, uz)
  const lv = Math.hypot(vx, vy, vz)
  if (!(lu > 0 && lv > 0)) return 0
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (lu * lv))))
}

function unitNormalOf(p: number[], a: number, b: number, c: number, out: Float64Array, at: number): boolean {
  return (
    unitNormal(
      p[a * 3], p[a * 3 + 1], p[a * 3 + 2],
      p[b * 3], p[b * 3 + 1], p[b * 3 + 2],
      p[c * 3], p[c * 3 + 1], p[c * 3 + 2],
      out, at,
    ) > 0
  )
}

/** The unit normal of triangle a, b, c into `out` at `at` — zeros for a
 *  degenerate one — and twice its area. */
function unitNormal(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: Float64Array, at: number,
): number {
  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz)
  if (!(len > 1e-300)) {
    out[at] = out[at + 1] = out[at + 2] = 0
    return 0
  }
  out[at] = nx / len
  out[at + 1] = ny / len
  out[at + 2] = nz / len
  return len
}
