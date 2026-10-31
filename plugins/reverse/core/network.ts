// SPDX-License-Identifier: AGPL-3.0-only
// A patch network read off the scan, stage by stage: its nodes taken onto
// the scan and its curves traced along it (networkCurve.ts), the regions
// the curves close read into cells (networkCells.ts), each four-sided cell
// mapped onto the square (networkMap.ts), and the patches fitted together
// (networkFit.ts). Pure geometry over the scan's triangles: the kernel's
// worker runs it for the build, a test runs it on a synthetic scan.
//
// The viewport's preview reads the network again at every edit, and an
// edit changes a curve or two and a cell or two: each curve's trace is
// kept by the points it was traced through, and each cell's points and
// their (u, v) by the triangles and corners they were mapped from, for the
// next read on the same scan — what the last few reads did not use is let
// go. The same input gives the same answer, kept or not; the map was half
// of a 30-patch read, and nearly all of it was a cell read before.

import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import type { EdgeRef, FaceRef, NetworkCurve, NetworkFeature, NetworkNode } from './features'
import { type GraphCurve, type GraphNode, type NetworkCells, readCells } from './networkCells'
import { type CurveFit, type CurvePoints, type CurveTrace, fitProvisional, traceCurve } from './networkCurve'
import { fitNetwork, type NetworkFitResult, type PatchInput } from './networkFit'
import { cellMesh, mapCell } from './networkMap'
import { type PolygonSplit, splitPolygons } from './networkSplit'

/** What a seed's cell came to: a patch — or, split from its centre, a
 *  patch a side (`patches`; `patch` is the first) — or why not. */
export type CellOutcome = { seed: Vec3; sides: number; patch: number; patches: number[] } | { seed: Vec3; refused: string; at?: Vec3 }

/** A network read off the scan: its traced curves — with the spokes and
 *  the side's middles of a split cell — its cells, and the patches fitted
 *  to them, or null where no cell could be filled. */
export interface NetworkReading {
  traced: TracedNetwork
  cells: NetworkCells
  outcomes: CellOutcome[]
  fit: NetworkFitResult | null
  /** The cells split from their centres: the spokes and the centres. */
  split: Pick<PolygonSplit, 'spokes' | 'centres'> | null
  ms: { trace: number; cells: number; map: number; fit: number }
}

/** How many reads back what was kept is still kept: a build reads every
 *  network of the history, the preview the one being edited. */
const KEPT_READS = 4

/** What the reads of networks on one scan keep for the next (see above). */
export class ReadCache {
  private read = 0
  private traces = new Map<string, { trace: CurveTrace; fit: CurveFit; used: number }>()
  private cells = new Map<string, { data: { xyz: Float64Array; uv: Float64Array } | string; used: number }>()

  /** A new read begins: what the last KEPT_READS did not use goes. */
  begin(): void {
    this.read++
    for (const store of [this.traces, this.cells] as Map<string, { used: number }>[]) {
      for (const [k, v] of store) if (v.used <= this.read - KEPT_READS) store.delete(k)
    }
  }

  /** The trace through `points`, and its provisional fit; the points of
   *  a kept one copied, the caller setting its ends. */
  trace(scan: ScanPaths, points: readonly Vec3[]): { trace: CurveTrace; fit: CurveFit } | null {
    const key = JSON.stringify(points)
    let had = this.traces.get(key)
    if (!had) {
      const trace = traceCurve(scan, points)
      if (trace.points.length < 6) return null
      trace.points.set(points[0], 0)
      trace.points.set(points[points.length - 1], trace.points.length - 3)
      had = { trace, fit: fitProvisional(trace, scan.edge), used: 0 }
      this.traces.set(key, had)
    }
    had.used = this.read
    return { trace: { ...had.trace, points: had.trace.points.slice() }, fit: had.fit }
  }

  /** A cell's points to fit and their (u, v) from its map, or why it has
   *  none; made by `make` where no read made them for the same triangles,
   *  holes and corners. */
  cell(triangles: Uint32Array, holes: readonly number[][], corners: readonly Vec3[], make: () => { xyz: Float64Array; uv: Float64Array } | string): { xyz: Float64Array; uv: Float64Array } | string {
    const key = cellKey(triangles, holes, corners)
    let had = this.cells.get(key)
    if (!had) {
      had = { data: make(), used: 0 }
      this.cells.set(key, had)
    }
    had.used = this.read
    return had.data
  }
}

/** A cell's input as a key: two 32-bit hashes of its triangles, its
 *  holes and its corners' coordinates, and their counts. */
function cellKey(triangles: Uint32Array, holes: readonly number[][], corners: readonly Vec3[]): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  const take = (x: number) => {
    a = Math.imul(a ^ x, 0x01000193)
    b = Math.imul(b ^ x, 0x5bd1e995) ^ (b >>> 15)
  }
  for (let i = 0; i < triangles.length; i++) take(triangles[i])
  for (const h of holes) {
    take(-1)
    for (const v of h) take(v)
  }
  const bits = new Uint32Array(Float64Array.from(corners.flat()).buffer)
  for (let i = 0; i < bits.length; i++) take(bits[i])
  return `${triangles.length}:${holes.length}:${corners.length}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`
}

const caches = new WeakMap<ScanPaths, ReadCache>()

function cacheOf(scan: ScanPaths): ReadCache {
  let c = caches.get(scan)
  if (!c) {
    c = new ReadCache()
    caches.set(scan, c)
  }
  return c
}

/** The network read off the scan, every stage (see above). */
export function readNetwork(scan: ScanPaths, f: Pick<NetworkFeature, 'nodes' | 'curves' | 'cells' | 'spans' | 'fit'>, bodies?: NetworkBodies): NetworkReading {
  const t0 = performance.now()
  const cache = cacheOf(scan)
  cache.begin()
  const traced = traceNetwork(scan, f.nodes, f.curves, bodies, cache)
  const t1 = performance.now()
  // A patch placed by its corners has them as its corners, not the rule's.
  const first = readCells(scan, traced.nodes, traced.curves, f.cells.map((c) => c.seed), f.cells.map((c) => (c.corners && c.corners.length >= 3 ? new Set(c.corners) : undefined)))
  // A cell of three, five or six sides split from its centre, and the
  // cells read again with the spokes and the sides' middles in (PN6).
  const split = splitPolygons(scan, traced, first.cells, f.cells.map((c) => c.centre))
  const graph = split ? split.traced : traced
  const cells = split ? { ...readCells(scan, graph.nodes, graph.curves, split.seeds, split.corners), faces: first.faces } : first
  const owner = split ? split.owner : first.cells.map((_, i) => i)
  const t2 = performance.now()
  const at = new Map(graph.nodes.map((n) => [n.id, n.at]))
  const patches: PatchInput[] = []
  const read = cells.cells.map((c): { patch: number } | { refused: string; at?: Vec3 } => {
    if (c.status !== 'ok') return { refused: c.message, ...(c.at ? { at: c.at } : {}) }
    if (c.sides.length !== 4) return { refused: `${c.sides.length} sides — split from its centre, it did not come out four-sided` }
    const corners = c.corners.map((id) => at.get(id)!)
    const data = cache.cell(c.triangles, c.holes, corners, () => {
      const mesh = cellMesh(scan, c.triangles, c.holes, corners)
      if (typeof mesh === 'string') return mesh
      const map = mapCell(mesh)
      if (typeof map === 'string') return map
      // The points to fit: the cell's scan vertices off its boundary —
      // those on it lie on the curves' side of the cut, on the fixed rows.
      const onLoop = new Uint8Array(mesh.scanVertex.length)
      for (const v of mesh.loop) onLoop[v] = 1
      const xyz: number[] = []
      const uv: number[] = []
      for (let v = 0; v < mesh.scanVertex.length; v++) {
        if (mesh.scanVertex[v] < 0 || onLoop[v]) continue
        xyz.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
        uv.push(map.uv[v * 2], map.uv[v * 2 + 1])
      }
      return { xyz: Float64Array.from(xyz), uv: Float64Array.from(uv) }
    })
    if (typeof data === 'string') return { refused: data }
    patches.push({ sides: c.sides, corners: c.corners, xyz: data.xyz, uv: data.uv, seed: c.seed })
    return { patch: patches.length - 1 }
  })
  // Each of the feature's cells from its own readings: one, or one a quad
  // of a split cell — refused if any is.
  const outcomes: CellOutcome[] = f.cells.map((cell, i) => {
    const sides = first.cells[i]?.status === 'ok' ? first.cells[i].sides.length : 0
    const why = split?.refused.get(i)
    if (why) return { seed: cell.seed, refused: `${sides} sides, and it could not be split from its centre: ${why}` }
    const mine = read.filter((_, k) => owner[k] === i)
    const bad = mine.find((r) => 'refused' in r)
    if (bad && 'refused' in bad) return { seed: cell.seed, refused: sides > 0 && sides !== 4 ? `split from its centre: ${bad.refused}` : bad.refused, ...(bad.at ? { at: bad.at } : {}) }
    const list = mine.map((r) => ('patch' in r ? r.patch : -1))
    if (list.length === 0) return { seed: cell.seed, refused: 'nothing came of it' }
    return { seed: cell.seed, sides, patch: list[0], patches: list }
  })
  const t3 = performance.now()
  // A piece of a curve split at a side's middle is a crease where the
  // curve is; a spoke is not.
  const crease = new Map(f.curves.map((c) => [c.id, c.crease === true]))
  const creaseOf = (id: number) => crease.get(id) ?? (split ? (split.originOf.has(id) ? (crease.get(split.originOf.get(id)!) ?? false) : false) : false)
  const fit =
    patches.length > 0
      ? fitNetwork({
          patches,
          curves: graph.curves.map((c) => ({ ...c, crease: creaseOf(c.id) })),
          nodes: graph.nodes,
          spans: f.spans,
          smoothness: f.fit.smoothness,
          robust: f.fit.robust,
          tolerance: f.fit.tolerance,
          spacing: scan.edge,
          // The patches beside a body's face: held tangent to it, by the
          // face's normals where it is asked; on its edge, either way.
          bodySides: f.curves.flatMap((c) =>
            c.side && bodies ? [{ curve: c.id, mode: c.side.mode, normals: (points: readonly Vec3[]) => bodies.normals(c.side!.body, c.side!.face, points) }] : [],
          ),
        })
      : null
  const t4 = performance.now()
  return { traced: graph, cells, outcomes, fit, split: split ? { spokes: split.spokes, centres: split.centres } : null, ms: { trace: t1 - t0, cells: t2 - t1, map: t3 - t2, fit: t4 - t3 } }
}

/** What a network reads off the bodies it rests on (PN11): the build's
 *  bodies as they stand before it — a body's edge as its points, from its
 *  first end; a face's normals at the points of it nearest those given.
 *  Null where the body, the edge or the face is not found. */
export interface NetworkBodies {
  edge(body: number, edge: EdgeRef): Float32Array | null
  normals(body: number, face: FaceRef, points: readonly Vec3[]): Vec3[] | null
}

/** The nodes on the scan and the curves traced between them; a curve whose
 *  node is gone is left out, by id. */
export interface TracedNetwork {
  nodes: GraphNode[]
  curves: GraphCurve[]
  /** Curves left out: their node is gone, or their trace is empty. */
  lost: number[]
  /** Why each curve on a body was left out, by id. */
  lostWhy?: Map<number, string>
}

/** How far apart the grips a curve along a body's edge is traced on the
 *  scan by lie, mm — about as far as a grip a person clicks. */
const EDGE_GRIP_MM = 3

/** A body edge's points no further apart than this, mm: a straight edge
 *  comes as its two ends, which a curve of several spans cannot be fitted
 *  to alone. */
const EDGE_STEP_MM = 0.5

/** A polyline with points put in along each piece so none is longer than
 *  `step`. */
function densified(points: Float32Array, step: number): Float32Array {
  const out: number[] = []
  const n = points.length / 3
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const d = Math.hypot(points[i * 3] - points[i * 3 - 3], points[i * 3 + 1] - points[i * 3 - 2], points[i * 3 + 2] - points[i * 3 - 1])
      const k = Math.ceil(d / step)
      for (let j = 1; j < k; j++) for (let c = 0; c < 3; c++) out.push(points[(i - 1) * 3 + c] + ((points[i * 3 + c] - points[(i - 1) * 3 + c]) * j) / k)
    }
    out.push(points[i * 3], points[i * 3 + 1], points[i * 3 + 2])
  }
  return Float32Array.from(out)
}

/** A polyline as points with their arc length. */
function polylinePoints(points: Float32Array): CurvePoints {
  const n = points.length / 3
  const at = new Float64Array(n)
  for (let i = 1; i < n; i++) at[i] = at[i - 1] + Math.hypot(points[i * 3] - points[i * 3 - 3], points[i * 3 + 1] - points[i * 3 - 2], points[i * 3 + 2] - points[i * 3 - 1])
  return { points, at, length: n > 0 ? at[n - 1] : 0 }
}

/** The point a share `t` of the way along a polyline, by arc length. */
function alongPolyline(p: CurvePoints, t: number): Vec3 {
  const want = Math.min(1, Math.max(0, t)) * p.length
  let i = 1
  while (i < p.at.length - 1 && p.at[i] < want) i++
  const span = p.at[i] - p.at[i - 1] || 1
  const f = Math.min(1, Math.max(0, (want - p.at[i - 1]) / span))
  return [0, 1, 2].map((k) => p.points[(i - 1) * 3 + k] + f * (p.points[i * 3 + k] - p.points[(i - 1) * 3 + k])) as Vec3
}

/** The index of a polyline's point nearest q. */
function nearestIndex(p: Float32Array, q: Vec3): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < p.length / 3; i++) {
    const d = Math.hypot(p[i * 3] - q[0], p[i * 3 + 1] - q[1], p[i * 3 + 2] - q[2])
    if (d < bestD) [bestD, best] = [d, i]
  }
  return best
}

/** The trace through `points` with its ends set on them, and its
 *  provisional fit; null where it is too short to be a curve. */
function traceEnds(scan: ScanPaths, points: readonly Vec3[]): { trace: CurveTrace; fit: CurveFit } | null {
  const trace = traceCurve(scan, points)
  if (trace.points.length < 6) return null
  trace.points.set(points[0], 0)
  trace.points.set(points[points.length - 1], trace.points.length - 3)
  return { trace, fit: fitProvisional(trace, scan.edge) }
}

/** Each node taken onto the scan — or onto the body edge or corner it is
 *  on — each curve traced from its node through its grips to its other
 *  node, and fitted at its own Auto for the directions it leaves its nodes
 *  by. A curve along a body's edge takes the edge's points between its two
 *  nodes, and is traced on the scan through grips along them. */
export function traceNetwork(scan: ScanPaths, nodes: readonly NetworkNode[], curves: readonly NetworkCurve[], bodies?: NetworkBodies, cache?: ReadCache): TracedNetwork {
  const placed = new Map<number, GraphNode>()
  for (const n of nodes) {
    let at: Vec3 | null = null
    if (n.on && bodies) {
      const edge = bodies.edge(n.on.body, 'edge' in n.on ? n.on.edge : n.on.vertex)
      if (edge && edge.length >= 6) {
        const p = polylinePoints(edge)
        at = 'edge' in n.on ? alongPolyline(p, n.on.t) : n.on.end === 0 ? [edge[0], edge[1], edge[2]] : [edge[edge.length - 3], edge[edge.length - 2], edge[edge.length - 1]]
      }
    }
    if (!at) {
      const c = scan.closestInside(n.at)
      at = c ? c.point : [...n.at]
    }
    placed.set(n.id, { id: n.id, at, ...(n.corner !== undefined ? { corner: n.corner } : {}) })
  }
  // A node a curve along a body's edge ends at is on that edge: taken from
  // the scan, where it was clicked, to the edge's nearest point — the scan's
  // noise off the edge would bend the curve off it at its end.
  const edges = new Map<number, Float32Array | null>()
  const edgeOf = (c: NetworkCurve): Float32Array | null => {
    if (!c.along) return null
    if (!edges.has(c.id)) {
      const found = bodies?.edge(c.along.body, c.along.edge) ?? null
      edges.set(c.id, found ? densified(found, EDGE_STEP_MM) : null)
    }
    return edges.get(c.id) ?? null
  }
  for (const c of curves) {
    const edge = edgeOf(c)
    if (!edge) continue
    for (const id of [c.from, c.to]) {
      const n = placed.get(id)
      const own = nodes.find((x) => x.id === id)
      if (!n || own?.on) continue
      const i = nearestIndex(edge, n.at)
      n.at = [edge[i * 3], edge[i * 3 + 1], edge[i * 3 + 2]]
    }
  }
  const traced: GraphCurve[] = []
  const lost: number[] = []
  const lostWhy = new Map<number, string>()
  for (const c of curves) {
    const a = placed.get(c.from)
    const b = placed.get(c.to)
    if (!a || !b) {
      lost.push(c.id)
      continue
    }
    let exact: CurvePoints | undefined
    let grips: Vec3[] = c.via
    if (c.along) {
      const edge = edgeOf(c)
      if (!edge || edge.length < 6) {
        lost.push(c.id)
        lostWhy.set(c.id, 'the body edge it runs along is not found on the body as built')
        continue
      }
      // The edge between the two nodes, run from the first.
      const i = nearestIndex(edge, a.at)
      const j = nearestIndex(edge, b.at)
      let pts: number[] = []
      if (i <= j) for (let k = i; k <= j; k++) pts.push(edge[k * 3], edge[k * 3 + 1], edge[k * 3 + 2])
      else for (let k = i; k >= j; k--) pts.push(edge[k * 3], edge[k * 3 + 1], edge[k * 3 + 2])
      if (i === j) pts = [...a.at, ...b.at]
      else {
        pts.splice(0, 3, ...a.at)
        pts.splice(pts.length - 3, 3, ...b.at)
      }
      exact = polylinePoints(Float32Array.from(pts))
      const count = Math.max(0, Math.floor(exact.length / EDGE_GRIP_MM) - 1)
      grips = Array.from({ length: count }, (_, k) => alongPolyline(exact!, (k + 1) / (count + 1)))
    }
    // The trace ends where the scan is nearest each node, which is where
    // the node was put: the curves meeting there meet exactly.
    const got = cache ? cache.trace(scan, [a.at, ...grips, b.at]) : traceEnds(scan, [a.at, ...grips, b.at])
    if (!got) {
      lost.push(c.id)
      continue
    }
    traced.push({ id: c.id, from: c.from, to: c.to, trace: got.trace, fit: exact ? fitProvisional(exact, scan.edge) : got.fit, ...(exact ? { exact } : {}) })
  }
  return { nodes: [...placed.values()], curves: traced, lost, ...(lostWhy.size > 0 ? { lostWhy } : {}) }
}
