// SPDX-License-Identifier: AGPL-3.0-only
// A path along the scan's surface between two points on it.
//
// The path is a plane section: the plane through the two points that holds
// the scan's mean normal there, cut through the triangles in a tube round
// the segment between them, and of the section's chains the piece that runs
// from the one point to the other. On a smooth surface that is the curve a
// person means by "from here to there along the part" — a straight line on
// a plane, an arc of a circle across a cylinder, a great circle on a sphere
// — and it is cheap: only the triangles in the tube are cut. Each point of
// the section lies on a triangle edge, and the path says which, so what is
// on either side of it can be told by the triangles.
//
// Where the section does not join the two points — a hole in the scan
// between them, a fold the plane leaves by another sheet — the path falls
// back to the shortest way along the mesh's edges (A*, the edges' lengths
// their weights), which goes round a hole rather than across it.
//
// The scan is prepared once (ScanPaths): its triangles in a grid by place,
// for the tube and the nearest point; the vertices' adjacency, which of
// them are joined at all and the search's arrays for the fallback, made the
// first time it is needed. Pure typed-array code: the
// viewport traces a path to the cursor with it, a worker with the same
// points gets the same path.

import type { Vec3 } from '../types'
import { buildAdjacency } from './adjacency'

/** How a point of a path lies on the mesh, as `on` pairs it: on the edge
 *  between vertices i < j, at vertex v (v, v), or inside triangle t
 *  (-1, t) — a path's own ends. */
export type PathPlace = { edge: [number, number] } | { vertex: number } | { triangle: number }

export interface ScanPath {
  /** x, y, z per point, from the first point to the second. */
  points: Float32Array
  /** Two numbers per point: where it lies on the mesh (see PathPlace). */
  on: Int32Array
  /** Along the path, mm. */
  length: number
  /** A plane section, or the fallback along the mesh's edges. */
  way: 'section' | 'edges'
  /** The triangles the two ends lie in. */
  ends: [number, number]
}

export interface ScanPoint {
  point: Vec3
  triangle: number
  /** The triangle's own normal. */
  normal: Vec3
  distance: number
}

/** How many triangles a grid cell holds on average, about. */
const PER_CELL = 2
/** The most cells the grid is allowed, whatever the triangles. */
const MAX_CELLS = 2_000_000
/** The tube's radius about the segment between the points: this share of
 *  the segment's length, and so many edges more — enough for the arc of a
 *  quarter of a cylinder between two points on it. */
const TUBE_SHARE = 0.75
const TUBE_EDGES = 3
/** The radius the scan's normal at a point is averaged over, in edges. */
const NORMAL_EDGES = 3
/** How far a path's end may lie off the section, in edges, for the
 *  section to be taken as passing through it. */
const END_SLACK_EDGES = 0.5

/** A scan prepared for paths: see above. */
export class ScanPaths {
  readonly positions: Float32Array
  readonly indices: Uint32Array
  readonly triangleCount: number
  /** The mesh's mean edge, mm — what the tolerances count in. */
  readonly edge: number
  private min: Vec3
  private cell: number
  private dims: [number, number, number]
  private offsets: Uint32Array
  private list: Uint32Array
  /** Per cell, the largest side of the boxes of the triangles in it — how
   *  far past the cell they reach; per column of cells along z, and per
   *  slab of them across x, the largest of their cells'. */
  private reach: Float32Array
  private columnReach: Float32Array
  private slabReach: Float32Array
  private stamp: Uint32Array
  private query = 0
  private adjacency: { offsets: Uint32Array; list: Uint32Array } | null = null
  private search: EdgeSearch | null = null

  constructor(positions: Float32Array, indices: Uint32Array) {
    this.positions = positions
    this.indices = indices
    this.triangleCount = Math.floor(indices.length / 3)
    const p = positions
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k]
        if (p[i + k] > max[k]) max[k] = p[i + k]
      }
    }
    if (!(min[0] <= max[0])) {
      min.fill(0)
      max.fill(0)
    }
    // The mean edge, from a sample of the triangles.
    const step = Math.max(1, Math.floor(this.triangleCount / 5000))
    let sum = 0
    let count = 0
    for (let t = 0; t < this.triangleCount; t += step) {
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
      sum += Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]) + Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1], p[c + 2] - p[b + 2]) + Math.hypot(p[a] - p[c], p[a + 1] - p[c + 1], p[a + 2] - p[c + 2])
      count += 3
    }
    this.edge = count > 0 ? sum / count : 1
    // Cells a couple of edges across, as many as the cap allows.
    const span: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    let cell = Math.max(this.edge * Math.sqrt(PER_CELL), 1e-6)
    const cellsAt = (h: number) => (Math.floor(span[0] / h) + 1) * (Math.floor(span[1] / h) + 1) * (Math.floor(span[2] / h) + 1)
    while (cellsAt(cell) > MAX_CELLS) cell *= 1.25
    this.cell = cell
    this.min = min
    this.dims = [Math.floor(span[0] / cell) + 1, Math.floor(span[1] / cell) + 1, Math.floor(span[2] / cell) + 1]
    const cells = this.dims[0] * this.dims[1] * this.dims[2]
    // Two passes: count each triangle into the cells its box touches,
    // then place it — and note how far past each cell its triangles reach,
    // a hair over so that the float's rounding never takes it under
    // (trianglesCrossing counts on it).
    const offsets = new Uint32Array(cells + 1)
    /** The triangle's cells, written to out; its box's largest side. */
    const boxOf = (t: number, out: Int32Array): number => {
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
      let side = 0
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(p[a + k], p[b + k], p[c + k])
        const hi = Math.max(p[a + k], p[b + k], p[c + k])
        out[k] = Math.min(this.dims[k] - 1, Math.max(0, Math.floor((lo - min[k]) / cell)))
        out[k + 3] = Math.min(this.dims[k] - 1, Math.max(0, Math.floor((hi - min[k]) / cell)))
        side = Math.max(side, hi - lo)
      }
      return side
    }
    const box = new Int32Array(6)
    for (let t = 0; t < this.triangleCount; t++) {
      boxOf(t, box)
      for (let x = box[0]; x <= box[3]; x++) for (let y = box[1]; y <= box[4]; y++) for (let z = box[2]; z <= box[5]; z++) offsets[(x * this.dims[1] + y) * this.dims[2] + z + 1]++
    }
    for (let i = 0; i < cells; i++) offsets[i + 1] += offsets[i]
    const list = new Uint32Array(offsets[cells])
    const cursor = offsets.slice(0, cells)
    const reach = new Float32Array(cells)
    for (let t = 0; t < this.triangleCount; t++) {
      const side = boxOf(t, box) * (1 + 1e-6)
      for (let x = box[0]; x <= box[3]; x++) {
        for (let y = box[1]; y <= box[4]; y++) {
          for (let z = box[2]; z <= box[5]; z++) {
            const cellId = (x * this.dims[1] + y) * this.dims[2] + z
            list[cursor[cellId]++] = t
            if (side > reach[cellId]) reach[cellId] = side
          }
        }
      }
    }
    const [nx, ny, nz] = this.dims
    const columnReach = new Float32Array(nx * ny)
    const slabReach = new Float32Array(nx)
    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        const col = x * ny + y
        let r = 0
        for (let z = 0; z < nz; z++) r = Math.max(r, reach[col * nz + z])
        columnReach[col] = r
        slabReach[x] = Math.max(slabReach[x], r)
      }
    }
    this.offsets = offsets
    this.list = list
    this.reach = reach
    this.columnReach = columnReach
    this.slabReach = slabReach
    this.stamp = new Uint32Array(this.triangleCount)
  }

  /** Every triangle whose box may meet the box [lo, hi], each once. */
  trianglesIn(lo: Vec3, hi: Vec3): number[] {
    const out: number[] = []
    const q = this.nextQuery()
    const c0: number[] = []
    const c1: number[] = []
    for (let k = 0; k < 3; k++) {
      c0.push(Math.max(0, Math.floor((lo[k] - this.min[k]) / this.cell)))
      c1.push(Math.min(this.dims[k] - 1, Math.floor((hi[k] - this.min[k]) / this.cell)))
    }
    for (let x = c0[0]; x <= c1[0]; x++) {
      for (let y = c0[1]; y <= c1[1]; y++) {
        for (let z = c0[2]; z <= c1[2]; z++) {
          const cellId = (x * this.dims[1] + y) * this.dims[2] + z
          for (let i = this.offsets[cellId]; i < this.offsets[cellId + 1]; i++) {
            const t = this.list[i]
            if (this.stamp[t] === q) continue
            this.stamp[t] = q
            out.push(t)
          }
        }
      }
    }
    return out
  }

  /**
   * The triangles of trianglesIn(lo, hi) that the plane m·x = d0 crosses —
   * a corner on either side of it, a corner on it counted on the side m
   * points to — each once and in the order trianglesIn gives them; found from
   * the cells the plane passes near, not from every cell of the box. A box
   * n cells wide has n³ of them, and a plane comes near some n² of those.
   *
   * A triangle in a cell overlaps it, and one the plane crosses has a point
   * on the plane; so that point lies inside the cell grown each way by the
   * triangle's box's largest side, which is at most the cell's reach. The
   * plane then passes within (cell/2 + reach)·(|mx| + |my| + |mz|) of the
   * cell's centre, and a cell farther off holds none of the triangles
   * wanted. The cells are visited x, y, z, as trianglesIn visits them, the
   * z steps of each column worked out from the column's reach, the y steps
   * of each slab from the slab's. Every cell a crossed triangle is in passes,
   * so each comes out at the first of its cells in the box, as from
   * trianglesIn.
   */
  trianglesCrossing(lo: Vec3, hi: Vec3, m: Vec3, d0: number): number[] {
    const out: number[] = []
    const q = this.nextQuery()
    const p = this.positions
    const idx = this.indices
    const { min, cell, offsets, list, stamp, reach } = this
    const ny = this.dims[1]
    const nz = this.dims[2]
    const c0: number[] = []
    const c1: number[] = []
    for (let k = 0; k < 3; k++) {
      c0.push(Math.max(0, Math.floor((lo[k] - min[k]) / cell)))
      c1.push(Math.min(this.dims[k] - 1, Math.floor((hi[k] - min[k]) / cell)))
    }
    const mx = m[0], my = m[1], mz = m[2]
    const l1 = Math.abs(mx) + Math.abs(my) + Math.abs(mz)
    // Half a cell, and a thousandth of one more for the rounding in the
    // cells' indices and in the sums along m.
    const half = cell * (0.5 + 1e-3)
    // m·x along z at the box's first and last cells, for each slab's y steps.
    const zA = mz * (min[2] + (c0[2] + 0.5) * cell)
    const zB = mz * (min[2] + (c1[2] + 0.5) * cell)
    const zLo = Math.min(zA, zB)
    const zHi = Math.max(zA, zB)
    const steps = new Float64Array(2)
    for (let x = c0[0]; x <= c1[0]; x++) {
      if (!(this.slabReach[x] > 0)) continue
      const fx = mx * (min[0] + (x + 0.5) * cell) - d0
      const slabFar = (half + this.slabReach[x]) * l1
      stepsWithin(fx + my * (min[1] + 0.5 * cell), my * cell, -slabFar - zHi, slabFar - zLo, c0[1], c1[1], steps)
      const y0 = steps[0]
      const y1 = steps[1]
      for (let y = y0; y <= y1; y++) {
        const col = x * ny + y
        if (!(this.columnReach[col] > 0)) continue
        const fy = fx + my * (min[1] + (y + 0.5) * cell)
        const columnFar = (half + this.columnReach[col]) * l1
        stepsWithin(fy + mz * (min[2] + 0.5 * cell), mz * cell, -columnFar, columnFar, c0[2], c1[2], steps)
        const z1 = steps[1]
        for (let z = steps[0]; z <= z1; z++) {
          const cellId = col * nz + z
          const start = offsets[cellId]
          const end = offsets[cellId + 1]
          if (start === end || Math.abs(fy + mz * (min[2] + (z + 0.5) * cell)) > (half + reach[cellId]) * l1) continue
          for (let i = start; i < end; i++) {
            const t = list[i]
            if (stamp[t] === q) continue
            stamp[t] = q
            // The sign test sectionPath makes, the sums the same way round.
            const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
            const sa = mx * p[a] + my * p[a + 1] + mz * p[a + 2] - d0 >= 0
            const sb = mx * p[b] + my * p[b + 1] + mz * p[b + 2] - d0 >= 0
            const sc = mx * p[c] + my * p[c + 1] + mz * p[c + 2] - d0 >= 0
            if (sa !== sb || sb !== sc) out.push(t)
          }
        }
      }
    }
    return out
  }

  /** The nearest point of the scan to `p`, or null on an empty scan. */
  closest(p: Vec3): ScanPoint | null {
    if (this.triangleCount === 0) return null
    const span = Math.max(this.dims[0], this.dims[1], this.dims[2]) * this.cell
    const near: Vec3 = [0, 0, 0]
    for (let r = this.cell; ; r *= 2) {
      let best = Infinity
      let bestT = -1
      const at: Vec3 = [0, 0, 0]
      for (const t of this.trianglesIn([p[0] - r, p[1] - r, p[2] - r], [p[0] + r, p[1] + r, p[2] + r])) {
        const d = this.closestOnTriangle(t, p, near)
        if (d < best) {
          best = d
          bestT = t
          at[0] = near[0]
          at[1] = near[1]
          at[2] = near[2]
        }
      }
      // A triangle nearer than r lies in the cube searched; past the
      // whole grid there is no more to search.
      if ((bestT >= 0 && best <= r) || r > 2 * span + this.distanceToGrid(p)) {
        if (bestT < 0) return null
        return { point: at, triangle: bestT, normal: this.triangleNormal(bestT), distance: best }
      }
    }
  }

  /** The nearest point of the scan to `p`, taken a hair inside its
   *  triangle where it lies on the triangle's edge or corner — so that a
   *  point on the scan lies in one triangle, and every path that ends at it
   *  ends in that one. A hair is a ten-thousandth of the triangle's
   *  size: tens of nanometres on a scan. */
  closestInside(p: Vec3): ScanPoint | null {
    const c = this.closest(p)
    if (!c) return null
    const pos = this.positions
    const t = c.triangle
    const corners = [0, 1, 2].map((k) => this.indices[t * 3 + k] * 3)
    const at = (k: number): Vec3 => [pos[corners[k]], pos[corners[k] + 1], pos[corners[k] + 2]]
    const [a, b, d] = [at(0), at(1), at(2)]
    // Barycentric coordinates by areas along the triangle's normal.
    const n = this.triangleCross(t)
    const nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2]
    if (!(nn > 0)) return c
    const w = (u: Vec3, v: Vec3) => {
      const e1 = [v[0] - u[0], v[1] - u[1], v[2] - u[2]]
      const e2 = [c.point[0] - u[0], c.point[1] - u[1], c.point[2] - u[2]]
      return ((e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2]) / nn
    }
    const bary = [w(b, d), w(d, a), w(a, b)]
    const hair = 1e-4
    if (Math.min(...bary) >= hair) return c
    const held = bary.map((x) => Math.max(x, hair))
    const sum = held[0] + held[1] + held[2]
    const point: Vec3 = [0, 1, 2].map((k) => (held[0] * a[k] + held[1] * b[k] + held[2] * d[k]) / sum) as Vec3
    return { ...c, point, distance: Math.hypot(point[0] - p[0], point[1] - p[1], point[2] - p[2]) }
  }

  /** The scan's normal about a point on it: the triangles' normals within
   *  a few edges, by area. */
  normalAt(p: Vec3, triangle: number): Vec3 {
    const r = NORMAL_EDGES * this.edge
    const n: Vec3 = [0, 0, 0]
    const q: Vec3 = [0, 0, 0]
    for (const t of this.trianglesIn([p[0] - r, p[1] - r, p[2] - r], [p[0] + r, p[1] + r, p[2] + r])) {
      if (this.closestOnTriangle(t, p, q) > r) continue
      const w = this.triangleCross(t)
      n[0] += w[0]
      n[1] += w[1]
      n[2] += w[2]
    }
    const l = Math.hypot(n[0], n[1], n[2])
    return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : this.triangleNormal(triangle)
  }

  /** The vertices' adjacency (CSR), made once. */
  neighbours(): { offsets: Uint32Array; list: Uint32Array } {
    if (!this.adjacency) this.adjacency = buildAdjacency(this.indices, this.positions.length / 3)
    return this.adjacency
  }

  /**
   * The vertices of the shortest way along the mesh's edges from vertex
   * `from` to vertex `to`, both included, or null where no edges join them
   * — told at once, from the pieces of the mesh, rather than by searching
   * the whole of from's piece.
   *
   * A*: the vertices are taken in the order of the way to them so far plus
   * the straight distance on to `to`. That distance is never more than the
   * way left along the edges, so the first way to reach `to` is a shortest
   * one; and the search covers an ellipse round the two vertices instead of
   * Dijkstra's disk of everything within the way's length of `from`. The
   * straight distance is taken a hair under, so that the rounding never puts
   * it past the way along the edges. The ways' lengths are the edges' summed
   * from `from` as Dijkstra summed them, so the shortest comes out the same
   * to the last bit; where two ways to a vertex tie, the one through the
   * vertex nearer `from` is kept, as Dijkstra, taking the nearer first, kept
   * it. Only where those two are as near as each other can the way differ
   * from Dijkstra's, and then it is as short.
   */
  edgeRoute(from: number, to: number): number[] | null {
    const s = this.edgeSearch()
    if (s.piece[from] !== s.piece[to]) return null
    if (from === to) return [from]
    const p = this.positions
    const { offsets, list } = this.neighbours()
    const { g, back, state, mark, heap } = s
    // Two stamps a search: seen, so that g holds, and done with.
    if (s.query >= 0xfffffff0) {
      state.fill(0)
      s.query = 0
    }
    s.query += 2
    const seen = s.query
    const done = s.query + 1
    const tx = p[to * 3], ty = p[to * 3 + 1], tz = p[to * 3 + 2]
    const hair = 1 - 1e-9
    heap.clear()
    g[from] = 0
    state[from] = seen
    const fx = p[from * 3] - tx, fy = p[from * 3 + 1] - ty, fz = p[from * 3 + 2] - tz
    heap.push(from, hair * Math.sqrt(fx * fx + fy * fy + fz * fz))
    let found = false
    while (heap.size > 0) {
      const v = heap.pop()
      if (state[v] === done) continue
      state[v] = done
      if (v === to) {
        found = true
        break
      }
      if (s.expansion === 0xffffffff) {
        mark.fill(0)
        s.expansion = 0
      }
      const e = ++s.expansion
      const gv = g[v]
      const vx = p[v * 3], vy = p[v * 3 + 1], vz = p[v * 3 + 2]
      for (let k = offsets[v]; k < offsets[v + 1]; k++) {
        const w = list[k]
        // An edge is listed once for each triangle on it: one look will do.
        if (mark[w] === e) continue
        mark[w] = e
        const known = state[w] >= seen
        // No way through v comes to w sooner than one already has.
        if (known && g[w] <= gv) continue
        const wx = p[w * 3], wy = p[w * 3 + 1], wz = p[w * 3 + 2]
        const nd = gv + Math.hypot(wx - vx, wy - vy, wz - vz)
        if (!known || nd < g[w]) {
          g[w] = nd
          back[w] = v
          // A vertex done with is taken up again if a way to it turns out
          // shorter — which, with the hair, does not happen.
          state[w] = seen
          const dx = wx - tx, dy = wy - ty, dz = wz - tz
          heap.push(w, nd + hair * Math.sqrt(dx * dx + dy * dy + dz * dz))
        } else if (nd === g[w] && gv < g[back[w]]) back[w] = v
      }
    }
    if (!found) return null
    const route: number[] = []
    for (let v = to; ; v = back[v]) {
      route.push(v)
      if (v === from) break
    }
    return route.reverse()
  }

  /** What the edge search needs made now rather than at the first search
   *  that falls back to the edges — a tenth of a second on two million
   *  triangles — for a caller with time in hand, such as one that has just
   *  prepared the scan and traces paths under a hand next. */
  prepareEdgeRoutes(): void {
    this.edgeSearch()
  }

  /** The arrays the edge search keeps between searches, and the pieces of
   *  the mesh — the vertices edges join, labelled — made once. */
  private edgeSearch(): EdgeSearch {
    if (this.search) return this.search
    const count = this.positions.length / 3
    const { offsets, list } = this.neighbours()
    const piece = new Int32Array(count).fill(-1)
    const queue = new Int32Array(count)
    let pieces = 0
    for (let start = 0; start < count; start++) {
      if (piece[start] >= 0) continue
      piece[start] = pieces
      let head = 0
      let tail = 0
      queue[tail++] = start
      while (head < tail) {
        const v = queue[head++]
        for (let k = offsets[v]; k < offsets[v + 1]; k++) {
          const w = list[k]
          if (piece[w] < 0) {
            piece[w] = pieces
            queue[tail++] = w
          }
        }
      }
      pieces++
    }
    // The queue, done with, serves as the way back.
    this.search = { piece, g: new Float64Array(count), back: queue, state: new Uint32Array(count), mark: new Uint32Array(count), heap: new Heap(), query: 0, expansion: 0 }
    return this.search
  }

  triangleNormal(t: number): Vec3 {
    const n = this.triangleCross(t)
    const l = Math.hypot(n[0], n[1], n[2])
    return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 1]
  }

  /** Twice the triangle's area along its normal. */
  private triangleCross(t: number): Vec3 {
    const p = this.positions
    const a = this.indices[t * 3] * 3, b = this.indices[t * 3 + 1] * 3, c = this.indices[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  }

  /** How far `p` is from triangle t, its nearest point written to `out`. */
  closestOnTriangle(t: number, p: Vec3, out: Vec3): number {
    const pos = this.positions
    const ia = this.indices[t * 3] * 3, ib = this.indices[t * 3 + 1] * 3, ic = this.indices[t * 3 + 2] * 3
    closestOnTriangle(p, pos[ia], pos[ia + 1], pos[ia + 2], pos[ib], pos[ib + 1], pos[ib + 2], pos[ic], pos[ic + 1], pos[ic + 2], out)
    return Math.hypot(out[0] - p[0], out[1] - p[1], out[2] - p[2])
  }

  private distanceToGrid(p: Vec3): number {
    let d = 0
    for (let k = 0; k < 3; k++) {
      const lo = this.min[k]
      const hi = this.min[k] + this.dims[k] * this.cell
      d = Math.max(d, lo - p[k], p[k] - hi)
    }
    return Math.max(0, d)
  }

  private nextQuery(): number {
    this.query++
    if (this.query === 0xffffffff) {
      this.stamp.fill(0)
      this.query = 1
    }
    return this.query
  }
}

/** Of the whole numbers k0 … k1, the first and the last k for which
 *  at + step·k may lie in [a, b], written to out — rounded outwards, and
 *  out[0] > out[1] where there are none. */
function stepsWithin(at: number, step: number, a: number, b: number, k0: number, k1: number, out: Float64Array): void {
  if (step === 0) {
    const all = at >= a && at <= b
    out[0] = all ? k0 : 1
    out[1] = all ? k1 : 0
    return
  }
  const u = (a - at) / step
  const v = (b - at) / step
  out[0] = Math.max(k0, Math.floor(Math.min(u, v)))
  out[1] = Math.min(k1, Math.ceil(Math.max(u, v)))
}

/** The nearest point of triangle abc to p (Ericson, Real-Time Collision
 *  Detection §5.1.5). */
function closestOnTriangle(p: Vec3, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, out: Vec3): void {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const set = (x: number, y: number, z: number) => {
    out[0] = x
    out[1] = y
    out[2] = z
  }
  if (d1 <= 0 && d2 <= 0) return set(ax, ay, az)
  const bpx = p[0] - bx, bpy = p[1] - by, bpz = p[2] - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return set(bx, by, bz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return set(ax + v * abx, ay + v * aby, az + v * abz)
  }
  const cpx = p[0] - cx, cpy = p[1] - cy, cpz = p[2] - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return set(cx, cy, cz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return set(ax + w * acx, ay + w * acy, az + w * acz)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return set(bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz))
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  set(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}

/** Where a point of a path lies, read from its `on` pair. */
export function placeOf(on: Int32Array, i: number): PathPlace {
  const a = on[i * 2]
  const b = on[i * 2 + 1]
  if (a < 0) return { triangle: b }
  return a === b ? { vertex: a } : { edge: [a, b] }
}

/**
 * The path along the scan from `a` to `b`, both on or near it: the plane
 * section between them, or the shortest way along the edges where the
 * section does not join them (see above). `normal` is the direction the
 * plane holds — absent, the scan's mean normal at the two points. Each
 * point is taken to the scan first, inside its triangle (closestInside):
 * paths that meet at a point all end in its one triangle, through its
 * edges, so the edges they cross close round it.
 */
export function tracePath(scan: ScanPaths, a: Vec3, b: Vec3, normal?: Vec3): ScanPath {
  const ca = scan.closestInside(a)
  const cb = scan.closestInside(b)
  if (!ca || !cb) return { points: new Float32Array(0), on: new Int32Array(0), length: 0, way: 'section', ends: [-1, -1] }
  const pa = ca.point
  const pb = cb.point
  const d: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]
  const dl = Math.hypot(d[0], d[1], d[2])
  if (ca.triangle === cb.triangle || dl < 1e-9) {
    return { points: Float32Array.from([...pa, ...pb]), on: Int32Array.from([-1, ca.triangle, -1, cb.triangle]), length: dl, way: 'section', ends: [ca.triangle, cb.triangle] }
  }
  let n = normal
  if (!n) {
    const na = scan.normalAt(pa, ca.triangle)
    const nb = scan.normalAt(pb, cb.triangle)
    n = [na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]]
    if (Math.hypot(n[0], n[1], n[2]) < 1e-6) n = na
  }
  // The plane through both points holding the normal: square to d × n.
  const m: Vec3 = [d[1] * n[2] - d[2] * n[1], d[2] * n[0] - d[0] * n[2], d[0] * n[1] - d[1] * n[0]]
  const ml = Math.hypot(m[0], m[1], m[2])
  const nl = Math.hypot(n[0], n[1], n[2])
  // The normal along the segment — a jump straight off the surface — holds
  // no plane; nor does a plane all but square to the surface at an end.
  const section = ml > 1e-3 * dl * nl ? sectionPath(scan, pa, pb, ca.triangle, cb.triangle, [m[0] / ml, m[1] / ml, m[2] / ml], dl) : null
  return section ?? edgePath(scan, pa, pb, ca.triangle, cb.triangle)
}

/** The plane section's piece from pa to pb, or null where it does not
 *  join them inside the tube. */
function sectionPath(scan: ScanPaths, pa: Vec3, pb: Vec3, ta: number, tb: number, m: Vec3, dl: number): ScanPath | null {
  const p = scan.positions
  const idx = scan.indices
  const radius = TUBE_SHARE * dl + TUBE_EDGES * scan.edge
  const lo: Vec3 = [0, 0, 0]
  const hi: Vec3 = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(pa[k], pb[k]) - radius
    hi[k] = Math.max(pa[k], pb[k]) + radius
  }
  const d0 = m[0] * pa[0] + m[1] * pa[1] + m[2] * pa[2]
  const dist = (v: number) => m[0] * p[v * 3] + m[1] * p[v * 3 + 1] + m[2] * p[v * 3 + 2] - d0
  const ax = pb[0] - pa[0], ay = pb[1] - pa[1], az = pb[2] - pa[2]
  const aa = ax * ax + ay * ay + az * az
  /** How far a point is from the segment pa–pb. */
  const offSegment = (x: number, y: number, z: number) => {
    const t = Math.max(0, Math.min(1, ((x - pa[0]) * ax + (y - pa[1]) * ay + (z - pa[2]) * az) / aa))
    return Math.hypot(x - pa[0] - t * ax, y - pa[1] - t * ay, z - pa[2] - t * az)
  }
  // The crossing points, one per mesh edge — the lower vertex first, so
  // the same edge gives the same point whichever triangle asks — and a
  // vertex on the plane taken to its positive side, so every crossing is
  // on an edge and a triangle crossed is crossed on two of them.
  const pointOf = new Map<number, number>()
  const pts: number[] = []
  const edgeOf: number[] = []
  const vertexCount = p.length / 3
  const cross = (i: number, j: number): number => {
    const lo2 = Math.min(i, j)
    const hi2 = Math.max(i, j)
    const key = lo2 * vertexCount + hi2
    const had = pointOf.get(key)
    if (had !== undefined) return had
    const di = dist(lo2)
    const dj = dist(hi2)
    const t = di / (di - dj)
    const at = pts.length / 3
    pts.push(p[lo2 * 3] + t * (p[hi2 * 3] - p[lo2 * 3]), p[lo2 * 3 + 1] + t * (p[hi2 * 3 + 1] - p[lo2 * 3 + 1]), p[lo2 * 3 + 2] + t * (p[hi2 * 3 + 2] - p[lo2 * 3 + 2]))
    edgeOf.push(lo2, hi2)
    pointOf.set(key, at)
    return at
  }
  const segA: number[] = []
  const segB: number[] = []
  const segTri: number[] = []
  // Only the tube's triangles the plane crosses, from the cells it passes
  // near: a box round a long path holds much of the scan, the plane cuts a
  // sliver of it. They come in the box's order, so where the order tells —
  // an edge more than two triangles share, two segments equally near an end —
  // the path is the one the whole box gives.
  for (const t of scan.trianglesCrossing(lo, hi, m, d0)) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2]
    const sa = dist(a) >= 0, sb = dist(b) >= 0, sc = dist(c) >= 0
    if (sa === sb && sb === sc) continue
    const cx = (p[a * 3] + p[b * 3] + p[c * 3]) / 3, cy = (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3, cz = (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3
    if (offSegment(cx, cy, cz) > radius) continue
    const ends: number[] = []
    if (sa !== sb) ends.push(cross(a, b))
    if (sb !== sc) ends.push(cross(b, c))
    if (sc !== sa) ends.push(cross(c, a))
    segA.push(ends[0])
    segB.push(ends[1])
    segTri.push(t)
  }
  if (segA.length === 0) return null
  const count = pts.length / 3
  const segsAt: number[][] = Array.from({ length: count }, () => [])
  for (let s = 0; s < segA.length; s++) {
    segsAt[segA[s]].push(s)
    segsAt[segB[s]].push(s)
  }
  // The segments the two ends lie on: their own triangles', or the nearest.
  const slack = END_SLACK_EDGES * scan.edge
  const segmentAt = (q: Vec3, tri: number): number => {
    let best = -1
    let bestD = Infinity
    for (let s = 0; s < segA.length; s++) {
      if (segTri[s] === tri) return s
      const d = pointSegment(q, pts, segA[s], segB[s])
      if (d < bestD) [bestD, best] = [d, s]
    }
    return bestD <= slack ? best : -1
  }
  const sa = segmentAt(pa, ta)
  const sb = segmentAt(pb, tb)
  if (sa < 0 || sb < 0) return null
  // Walk the chain from pa's segment each way; the walk that comes to pb's
  // is the path, the shorter where both do (a closed section).
  const walk = (first: number): number[] | null => {
    const out: number[] = []
    const seen = new Set<number>([sa])
    let point = first
    let seg = sa
    for (;;) {
      if (seg === sb) return out
      out.push(point)
      const next = segsAt[point].find((s) => s !== seg && !seen.has(s))
      if (next === undefined) return null
      seen.add(next)
      seg = next
      point = segA[seg] === point ? segB[seg] : segA[seg]
    }
  }
  const lengthOf = (route: number[]) => {
    let l = 0
    let prev = pa
    for (const i of route) {
      const q: Vec3 = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]
      l += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])
      prev = q
    }
    return l + Math.hypot(pb[0] - prev[0], pb[1] - prev[1], pb[2] - prev[2])
  }
  let route: number[] | null
  if (sa === sb) route = []
  else {
    const one = walk(segA[sa])
    const other = walk(segB[sa])
    route = one && other ? (lengthOf(one) <= lengthOf(other) ? one : other) : (one ?? other)
  }
  if (!route) return null
  const points = new Float32Array((route.length + 2) * 3)
  const on = new Int32Array((route.length + 2) * 2)
  points.set(pa, 0)
  on[0] = -1
  on[1] = ta
  route.forEach((i, k) => {
    points[(k + 1) * 3] = pts[i * 3]
    points[(k + 1) * 3 + 1] = pts[i * 3 + 1]
    points[(k + 1) * 3 + 2] = pts[i * 3 + 2]
    on[(k + 1) * 2] = edgeOf[i * 2]
    on[(k + 1) * 2 + 1] = edgeOf[i * 2 + 1]
  })
  points.set(pb, (route.length + 1) * 3)
  on[(route.length + 1) * 2] = -1
  on[(route.length + 1) * 2 + 1] = tb
  return { points, on, length: lengthOf(route), way: 'section', ends: [ta, tb] }
}

/** How far q is from the segment between points i and j of pts. */
function pointSegment(q: Vec3, pts: number[], i: number, j: number): number {
  const x0 = pts[i * 3], y0 = pts[i * 3 + 1], z0 = pts[i * 3 + 2]
  const dx = pts[j * 3] - x0, dy = pts[j * 3 + 1] - y0, dz = pts[j * 3 + 2] - z0
  const dd = dx * dx + dy * dy + dz * dz
  const t = dd > 0 ? Math.max(0, Math.min(1, ((q[0] - x0) * dx + (q[1] - y0) * dy + (q[2] - z0) * dz) / dd)) : 0
  return Math.hypot(q[0] - x0 - t * dx, q[1] - y0 - t * dy, q[2] - z0 - t * dz)
}

/** What ScanPaths.edgeRoute keeps between searches: per vertex, its piece
 *  of the mesh, the way's length to it, the vertex it was come to from, its
 *  stamp (seen or done with, by which search) and the vertex taken up when
 *  it was last looked at, by count; the heap, and the stamps' counters. */
interface EdgeSearch {
  piece: Int32Array
  g: Float64Array
  back: Int32Array
  state: Uint32Array
  mark: Uint32Array
  heap: Heap
  query: number
  expansion: number
}

/** The shortest way along the mesh's edges from the nearest corner of ta
 *  to the nearest of tb, the two ends added (ScanPaths.edgeRoute). The ends
 *  lie in their triangles; the corners are where the path joins the edges.
 *  With no way between them, the straight segment, marked as edges, is all
 *  there is. */
function edgePath(scan: ScanPaths, pa: Vec3, pb: Vec3, ta: number, tb: number): ScanPath {
  const p = scan.positions
  const idx = scan.indices
  const corner = (q: Vec3, t: number) => {
    let best = idx[t * 3]
    let bestD = Infinity
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]
      const d = Math.hypot(p[v * 3] - q[0], p[v * 3 + 1] - q[1], p[v * 3 + 2] - q[2])
      if (d < bestD) [bestD, best] = [d, v]
    }
    return best
  }
  const route = scan.edgeRoute(corner(pa, ta), corner(pb, tb)) ?? []
  const points = new Float32Array((route.length + 2) * 3)
  const on = new Int32Array((route.length + 2) * 2)
  points.set(pa, 0)
  on[0] = -1
  on[1] = ta
  let length = 0
  let prev = pa
  route.forEach((v, k) => {
    const q: Vec3 = [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]
    points.set(q, (k + 1) * 3)
    on[(k + 1) * 2] = v
    on[(k + 1) * 2 + 1] = v
    length += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])
    prev = q
  })
  points.set(pb, (route.length + 1) * 3)
  on[(route.length + 1) * 2] = -1
  on[(route.length + 1) * 2 + 1] = tb
  length += Math.hypot(pb[0] - prev[0], pb[1] - prev[1], pb[2] - prev[2])
  return { points, on, length, way: 'edges', ends: [ta, tb] }
}

/** A binary min-heap of (vertex, key) on typed arrays, grown as it fills. */
class Heap {
  private ids = new Int32Array(1024)
  private keys = new Float64Array(1024)
  size = 0

  clear(): void {
    this.size = 0
  }

  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2)
      ids.set(this.ids)
      this.ids = ids
      const keys = new Float64Array(this.size * 2)
      keys.set(this.keys)
      this.keys = keys
    }
    const ids = this.ids
    const keys = this.keys
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      ids[i] = ids[parent]
      keys[i] = keys[parent]
      i = parent
    }
    ids[i] = id
    keys[i] = key
  }

  /** The vertex with the least key, taken off. */
  pop(): number {
    const ids = this.ids
    const keys = this.keys
    const top = ids[0]
    const n = --this.size
    if (n > 0) {
      const lastId = ids[n]
      const lastKey = keys[n]
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && keys[r] < keys[l] ? r : l
        if (keys[c] >= lastKey) break
        ids[i] = ids[c]
        keys[i] = keys[c]
        i = c
      }
      ids[i] = lastId
      keys[i] = lastKey
    }
    return top
  }
}
