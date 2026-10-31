// SPDX-License-Identifier: AGPL-3.0-only
// The cells of a patch network: the regions of the scan its curves close.
//
// Two readings of the same network meet here. The curves as a graph — the
// nodes, and the curves leaving each in the order they leave it round the
// scan's normal there — have faces: walk along a curve, and at each node
// take the next curve clockwise from the one arrived by, and the walk goes
// round the face on its left. That gives a face's sides in order and its
// corners, but says nothing about which triangles it covers. The curves as
// cuts in the scan do: each trace marks the triangle edges it crosses (a
// section's point lies on one; a run along the edges marks the edges it
// runs along), and the triangles are flooded without crossing a marked
// edge. Each piece of the flood is a region; the curve on either side of
// the edges round it says which face of the graph it is.
//
// A face is a cell when its piece is closed — the flood stays inside the
// box round the curves and meets the scan's rim only round holes wholly
// inside it, which the map fills with a fan — and it has three to six
// sides. A node is a corner of the face where the boundary turns more than
// 30° there, unless the node says otherwise: a T-node on a straight run,
// where a neighbour was split, is not one.

import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import type { CurveFit, CurvePoints, CurveTrace } from './networkCurve'
import { endTangent } from './networkCurve'

/** How far the boundary turns at a node for the node to be a corner, deg. */
export const CORNER_DEG = 30
/** The fewest and most sides a cell is filled with. */
export const SIDES_MIN = 3
export const SIDES_MAX = 6
/** How far past the box round the curves a piece may reach before it is
 *  taken for the outside of the network: this share of the box's diagonal
 *  — a cell bulges past the curves round it, a dome above its rim. */
const BOX_MARGIN = 0.5
/** The same for the regions no seed fills, which Fill all offers: a dome
 *  that bulges further past its curves is filled by a click in it. */
const UNFILLED_MARGIN = 0.25
/** The share of the edges round a piece that have to agree on its face. */
const FACE_AGREEMENT = 0.9
/** A piece of fewer triangles than this is a crumb between curves at a
 *  node, not a cell. */
const CRUMB_TRIANGLES = 12

/** A node as the cells read it: where it is on the scan. */
export interface GraphNode {
  id: number
  at: Vec3
  corner?: boolean
}

/** A curve as the cells read it: its ends, its trace, and a fit for the
 *  directions it leaves its ends by. A curve along a body's edge has the
 *  edge's own points (`exact`), which it is fitted to; its trace on the
 *  scan is what cuts the cells. */
export interface GraphCurve {
  id: number
  from: number
  to: number
  trace: CurveTrace
  fit: CurveFit
  exact?: CurvePoints
}

/** A curve run one way: forward from its `from` to its `to`. */
export interface HalfEdge {
  curve: number
  forward: boolean
}

/** A face of the curve graph: the half-edges round it with it on their
 *  left, in order, and the node each arrives at. */
export interface GraphFace {
  edges: HalfEdge[]
  nodes: number[]
}

/** A cell's side: the curves along it from one corner to the next. */
export interface CellSide {
  edges: HalfEdge[]
}

/** A filled cell, or why the region is not one. */
export type CellReading =
  | {
      status: 'ok'
      seed: Vec3
      face: number
      /** The corners' nodes, in order round the cell with it on the left. */
      corners: number[]
      sides: CellSide[]
      /** The scan's triangles in the cell. */
      triangles: Uint32Array
      /** The rim loops of scan holes wholly inside it, by scan vertex. */
      holes: number[][]
    }
  | { status: 'refused'; seed: Vec3; message: string; at?: Vec3 }

/** The graph's faces, and the scan read into regions. */
export interface NetworkCells {
  faces: GraphFace[]
  cells: CellReading[]
  /** Closed regions of three to six sides no seed fills, with a point
   *  inside each: what Fill all fills. */
  unfilled: { seed: Vec3; sides: number }[]
}

interface Marks {
  /** By edge key: the marks on that edge. */
  byEdge: Map<number, number[]>
  curve: number[]
  /** Where the curve crossed or ran along the edge, and which way. */
  at: number[]
  dir: number[]
}

/** The triangles round each vertex (CSR), made once a scan. */
const incidenceOf = new WeakMap<ScanPaths, { offsets: Uint32Array; list: Uint32Array }>()

function incidence(scan: ScanPaths): { offsets: Uint32Array; list: Uint32Array } {
  let inc = incidenceOf.get(scan)
  if (inc) return inc
  const vertexCount = scan.positions.length / 3
  const offsets = new Uint32Array(vertexCount + 1)
  const idx = scan.indices
  for (let i = 0; i < idx.length; i++) offsets[idx[i] + 1]++
  for (let v = 0; v < vertexCount; v++) offsets[v + 1] += offsets[v]
  const list = new Uint32Array(idx.length)
  const cursor = offsets.slice(0, vertexCount)
  for (let i = 0; i < idx.length; i++) list[cursor[idx[i]]++] = Math.floor(i / 3)
  inc = { offsets, list }
  incidenceOf.set(scan, inc)
  return inc
}

/** The triangles across edge (a, b) from t: one on a manifold edge, none
 *  on the rim. */
function across(scan: ScanPaths, inc: { offsets: Uint32Array; list: Uint32Array }, t: number, a: number, b: number, out: number[]): void {
  out.length = 0
  const idx = scan.indices
  for (let k = inc.offsets[a]; k < inc.offsets[a + 1]; k++) {
    const u = inc.list[k]
    if (u === t) continue
    if (idx[u * 3] === b || idx[u * 3 + 1] === b || idx[u * 3 + 2] === b) out.push(u)
  }
}

/** Every edge the curves cross or run along, with the curve and its
 *  direction there; and the triangles a run along the edges starts or
 *  ends in, all of whose edges are marked — the run joins its end through
 *  the triangle's inside, which would otherwise be a way round it. */
function markEdges(scan: ScanPaths, curves: readonly GraphCurve[]): Marks {
  const vertexCount = scan.positions.length / 3
  const marks: Marks = { byEdge: new Map(), curve: [], at: [], dir: [] }
  const key = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a)
  const mark = (a: number, b: number, curve: number, p: Vec3 | null, d: Vec3 | null) => {
    const k = key(a, b)
    const m = marks.curve.length
    marks.curve.push(curve)
    marks.at.push(...(p ?? [NaN, NaN, NaN]))
    marks.dir.push(...(d ?? [NaN, NaN, NaN]))
    const list = marks.byEdge.get(k)
    if (list) list.push(m)
    else marks.byEdge.set(k, [m])
  }
  const p = scan.positions
  for (const c of curves) {
    const t = c.trace
    const n = t.points.length / 3
    const pt = (i: number): Vec3 => [t.points[i * 3], t.points[i * 3 + 1], t.points[i * 3 + 2]]
    for (const run of t.runs) {
      if (run.way === 'section') {
        for (let i = Math.max(run.from, 1); i <= Math.min(run.to, n - 2); i++) {
          const a = t.on[i * 2]
          const b = t.on[i * 2 + 1]
          if (a < 0 || a === b) continue
          const q0 = pt(i - 1)
          const q1 = pt(i + 1)
          mark(a, b, c.id, pt(i), [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]])
        }
      } else {
        for (let i = run.from; i < run.to; i++) {
          const a = t.on[i * 2]
          const b = t.on[(i + 1) * 2]
          if (a < 0 || b < 0 || a !== t.on[i * 2 + 1] || b !== t.on[(i + 1) * 2 + 1] || a === b) continue
          mark(a, b, c.id, [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]], [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]])
        }
        for (const tri of run.ends) {
          if (tri < 0) continue
          const v = [scan.indices[tri * 3], scan.indices[tri * 3 + 1], scan.indices[tri * 3 + 2]]
          for (let e = 0; e < 3; e++) mark(v[e], v[(e + 1) % 3], c.id, null, null)
        }
      }
    }
  }
  return marks
}

/** The graph's faces from the order the curves leave each node in. */
export function graphFaces(scan: ScanPaths, nodes: readonly GraphNode[], curves: readonly GraphCurve[]): GraphFace[] {
  // At each node, the curves leaving it — a curve from a node to itself
  // twice — by their angle round the scan's normal there.
  type Leaving = { edge: HalfEdge; angle: number }
  const around = new Map<number, Leaving[]>()
  const nodeAt = new Map(nodes.map((n) => [n.id, n]))
  const add = (node: number, edge: HalfEdge, dir: Vec3) => {
    const n = nodeAt.get(node)
    if (!n) return
    const c = scan.closest(n.at)
    const normal = c ? scan.normalAt(c.point, c.triangle) : ([0, 0, 1] as Vec3)
    const e1 = perpendicular(normal)
    const e2: Vec3 = [normal[1] * e1[2] - normal[2] * e1[1], normal[2] * e1[0] - normal[0] * e1[2], normal[0] * e1[1] - normal[1] * e1[0]]
    const angle = Math.atan2(dir[0] * e2[0] + dir[1] * e2[1] + dir[2] * e2[2], dir[0] * e1[0] + dir[1] * e1[1] + dir[2] * e1[2])
    const list = around.get(node) ?? []
    list.push({ edge, angle })
    around.set(node, list)
  }
  for (const c of curves) {
    const out = endTangent(c.fit, 0)
    const into = endTangent(c.fit, 1)
    add(c.from, { curve: c.id, forward: true }, out)
    add(c.to, { curve: c.id, forward: false }, [-into[0], -into[1], -into[2]])
  }
  for (const list of around.values()) list.sort((a, b) => a.angle - b.angle)
  const keyOf = (h: HalfEdge) => `${h.curve}${h.forward ? '+' : '-'}`
  const curveOf = new Map(curves.map((c) => [c.id, c]))
  const arrives = (h: HalfEdge) => {
    const c = curveOf.get(h.curve)!
    return h.forward ? c.to : c.from
  }
  /** The half-edge after h round its face: at the node h arrives at, the
   *  curve next clockwise from the one h came by. */
  const next = (h: HalfEdge): HalfEdge | null => {
    const list = around.get(arrives(h))
    if (!list) return null
    const back = list.findIndex((l) => l.edge.curve === h.curve && l.edge.forward === !h.forward)
    if (back < 0) return null
    return list[(back - 1 + list.length) % list.length].edge
  }
  const seen = new Set<string>()
  const faces: GraphFace[] = []
  for (const c of curves) {
    for (const forward of [true, false]) {
      const start: HalfEdge = { curve: c.id, forward }
      if (seen.has(keyOf(start))) continue
      const edges: HalfEdge[] = []
      const nodesOf: number[] = []
      let h: HalfEdge | null = start
      for (let guard = 0; h && !seen.has(keyOf(h)) && guard < 4 * curves.length + 4; guard++) {
        seen.add(keyOf(h))
        edges.push(h)
        nodesOf.push(arrives(h))
        h = next(h)
      }
      if (edges.length > 0) faces.push({ edges, nodes: nodesOf })
    }
  }
  return faces
}

function perpendicular(n: Vec3): Vec3 {
  const a: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const d = a[0] * n[0] + a[1] * n[1] + a[2] * n[2]
  const u: Vec3 = [a[0] - d * n[0], a[1] - d * n[1], a[2] - d * n[2]]
  const l = Math.hypot(u[0], u[1], u[2]) || 1
  return [u[0] / l, u[1] / l, u[2] / l]
}

/** A face's corners and sides, or why it has none to fill: its corners
 *  are the nodes where it turns more than CORNER_DEG, or as a node says —
 *  or, given, exactly the nodes of `corners` (a quad of a split cell). */
export function faceSides(face: GraphFace, nodes: readonly GraphNode[], curves: readonly GraphCurve[], cornersGiven?: ReadonlySet<number>): { corners: number[]; sides: CellSide[] } | { message: string; at?: Vec3 } {
  const curveOf = new Map(curves.map((c) => [c.id, c]))
  const nodeOf = new Map(nodes.map((n) => [n.id, n]))
  const m = face.edges.length
  // A curve run both ways round one face ends inside it, at a node only
  // that curve reaches.
  if (face.edges.some((h) => face.edges.some((g) => g.curve === h.curve && g.forward !== h.forward))) {
    const valence = new Map<number, number>()
    for (const c of curves) {
      valence.set(c.from, (valence.get(c.from) ?? 0) + 1)
      valence.set(c.to, (valence.get(c.to) ?? 0) + 1)
    }
    const dangling = face.nodes.map((id) => nodeOf.get(id)).find((n) => n && valence.get(n.id) === 1)
    return { message: `a curve ends inside it${dangling ? ` at ${where(dangling.at)}` : ''} — take it on to another curve, or delete it`, ...(dangling ? { at: dangling.at } : {}) }
  }
  const leave = (h: HalfEdge): Vec3 => {
    const c = curveOf.get(h.curve)!
    if (h.forward) return endTangent(c.fit, 0)
    const t = endTangent(c.fit, 1)
    return [-t[0], -t[1], -t[2]]
  }
  const corners: number[] = []
  const cornerAfter: number[] = []
  for (let i = 0; i < m; i++) {
    const h = face.edges[i]
    const g = face.edges[(i + 1) % m]
    const node = face.nodes[i]
    // Arriving along h is leaving by its reverse, backwards.
    const back = leave({ curve: h.curve, forward: !h.forward })
    const out = leave(g)
    const cos = -(back[0] * out[0] + back[1] * out[1] + back[2] * out[2])
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
    const given = cornersGiven ? cornersGiven.has(node) : nodeOf.get(node)?.corner
    if (given ?? turn > CORNER_DEG) {
      corners.push(node)
      cornerAfter.push(i)
    }
  }
  if (corners.length === 0) return { message: 'one side — a closed curve with no corner; add a node where it turns' }
  // The sides run from each corner to the next.
  const sides: CellSide[] = []
  for (let k = 0; k < cornerAfter.length; k++) {
    const from = cornerAfter[k]
    const to = cornerAfter[(k + 1) % cornerAfter.length]
    const edges: HalfEdge[] = []
    for (let i = (from + 1) % m; ; i = (i + 1) % m) {
      edges.push(face.edges[i])
      if (i === to) break
    }
    sides.push({ edges })
  }
  // The first corner is the node the last side arrives at.
  const ordered = cornerAfter.map((i) => face.nodes[i])
  return { corners: ordered, sides }
}

/** A point as a refusal names it. */
function where(p: Vec3): string {
  return `(${p.map((x) => (Math.round(x * 10) / 10).toFixed(1)).join(', ')})`
}

/** The network's cells: the faces, each seed's region read (see above), and
 *  the closed regions no seed fills. */
export function readCells(scan: ScanPaths, nodes: readonly GraphNode[], curves: readonly GraphCurve[], seeds: readonly Vec3[], cornersOf: readonly (ReadonlySet<number> | undefined)[] = []): NetworkCells {
  const faces = graphFaces(scan, nodes, curves)
  if (curves.length === 0) return { faces, cells: seeds.map((seed) => ({ status: 'refused', seed, message: 'no curves close it' })), unfilled: [] }
  const inc = incidence(scan)
  const marks = markEdges(scan, curves)
  const idx = scan.indices
  const pos = scan.positions
  const vertexCount = pos.length / 3
  const edgeKey = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a)
  // The box round the curves, grown by the margin.
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const c of curves) {
    const p = c.trace.points
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k])
        hi[k] = Math.max(hi[k], p[i + k])
      }
    }
  }
  const diagonal = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  const margin = BOX_MARGIN * diagonal + 4 * scan.edge
  const near = UNFILLED_MARGIN * diagonal + 4 * scan.edge
  const nearLo: Vec3 = [lo[0] - near, lo[1] - near, lo[2] - near]
  const nearHi: Vec3 = [hi[0] + near, hi[1] + near, hi[2] + near]
  for (let k = 0; k < 3; k++) {
    lo[k] -= margin
    hi[k] += margin
  }
  const boxTest = (a: Vec3, b: Vec3) => (t: number) => {
    for (let k = 0; k < 3; k++) {
      const c = (pos[idx[t * 3] * 3 + k] + pos[idx[t * 3 + 1] * 3 + k] + pos[idx[t * 3 + 2] * 3 + k]) / 3
      if (c < a[k] || c > b[k]) return false
    }
    return true
  }
  const inBox = boxTest(lo, hi)
  const inNear = boxTest(nearLo, nearHi)
  const keyOf = (h: HalfEdge) => `${h.curve}${h.forward ? '+' : '-'}`
  const faceOf = new Map<string, number>()
  faces.forEach((f, i) => f.edges.forEach((h) => faceOf.set(keyOf(h), i)))

  /** A piece of the flood: its triangles, whether it reached past the box
   *  and where, the rim edges it met, and the votes of the marked edges
   *  round it for the half-edges it lies left of. */
  interface Piece {
    triangles: number[]
    leaked: Vec3 | null
    rim: [number, number][]
    votes: Map<string, number>
  }
  const label = new Int32Array(scan.triangleCount).fill(-1)
  const pieces: Piece[] = []
  const nb: number[] = []
  /** A piece flooded from a triangle, inside `within`; `stop`: given up the
   *  moment it leaks, a piece left open being no cell whatever else it
   *  holds — and one that runs into a piece given up so is open too. */
  const flood = (start: number, within: (t: number) => boolean = inBox, stop = false): number => {
    const id = pieces.length
    const piece: Piece = { triangles: [], leaked: null, rim: [], votes: new Map() }
    pieces.push(piece)
    const queue = [start]
    label[start] = id
    while (queue.length > 0 && !(stop && piece.leaked)) {
      const t = queue.pop()!
      piece.triangles.push(t)
      for (let e = 0; e < 3; e++) {
        const a = idx[t * 3 + e]
        const b = idx[t * 3 + ((e + 1) % 3)]
        const w = idx[t * 3 + ((e + 2) % 3)]
        const marked = marks.byEdge.get(edgeKey(a, b))
        if (marked) {
          for (const m of marked) {
            const d: Vec3 = [marks.dir[m * 3], marks.dir[m * 3 + 1], marks.dir[m * 3 + 2]]
            if (Number.isNaN(d[0])) continue
            // Left of the curve, seen from outside: on the side n × d.
            const n = scan.triangleNormal(t)
            const left: Vec3 = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]]
            const side = (pos[w * 3] - marks.at[m * 3]) * left[0] + (pos[w * 3 + 1] - marks.at[m * 3 + 1]) * left[1] + (pos[w * 3 + 2] - marks.at[m * 3 + 2]) * left[2]
            const k = keyOf({ curve: marks.curve[m], forward: side > 0 })
            piece.votes.set(k, (piece.votes.get(k) ?? 0) + 1)
          }
          continue
        }
        across(scan, inc, t, a, b, nb)
        if (nb.length === 0) {
          piece.rim.push([a, b])
          continue
        }
        for (const u of nb) {
          if (label[u] >= 0) {
            if (label[u] !== id && pieces[label[u]].leaked && !piece.leaked) piece.leaked = pieces[label[u]].leaked
            continue
          }
          if (!within(u)) {
            if (!piece.leaked) piece.leaked = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]]
            continue
          }
          label[u] = id
          queue.push(u)
        }
      }
    }
    return id
  }

  /** Where a region is open: the node nearest it that ends one curve
   *  alone, or where the flood left the box. */
  const curveCount = new Map<number, number>()
  for (const c of curves) {
    curveCount.set(c.from, (curveCount.get(c.from) ?? 0) + 1)
    curveCount.set(c.to, (curveCount.get(c.to) ?? 0) + 1)
  }
  const openAt = (near: Vec3, fallback: Vec3): Vec3 => {
    let best: Vec3 | null = null
    let bestD = Infinity
    for (const n of nodes) {
      if ((curveCount.get(n.id) ?? 0) !== 1) continue
      const d = Math.hypot(n.at[0] - near[0], n.at[1] - near[1], n.at[2] - near[2])
      if (d < bestD) [bestD, best] = [d, n.at]
    }
    return best ?? fallback
  }

  /** The rim loops a piece meets, and whether each is wholly inside it. */
  const holesOf = (piece: Piece): number[][] | null => {
    if (piece.rim.length === 0) return []
    const nextOf = new Map<number, number[]>()
    for (const [a, b] of piece.rim) {
      const l = nextOf.get(a) ?? []
      l.push(b)
      nextOf.set(a, l)
    }
    const used = new Set<string>()
    const loops: number[][] = []
    for (const [a0, b0] of piece.rim) {
      if (used.has(`${a0}>${b0}`)) continue
      const loop = [a0]
      let a = a0
      let b = b0
      for (;;) {
        used.add(`${a}>${b}`)
        if (b === a0) break
        loop.push(b)
        const options = (nextOf.get(b) ?? []).filter((x) => !used.has(`${b}>${x}`))
        if (options.length === 0) return null
        a = b
        b = options[0]
      }
      // A hole runs round with the region on its left and itself on the
      // right: clockwise seen from outside, a turn of −360°. A loop that
      // turns the other way round holds the region in: the scan's own edge
      // is the region's boundary, not a hole in it.
      if (turning(loop) > 0) return null
      loops.push(loop)
    }
    return loops
  }
  /** A loop's signed turning round the scan's normal, radians. */
  const turning = (loop: readonly number[]): number => {
    let sum = 0
    const m = loop.length
    for (let i = 0; i < m; i++) {
      const p = loop[(i - 1 + m) % m] * 3
      const q = loop[i] * 3
      const r = loop[(i + 1) % m] * 3
      const a: Vec3 = [pos[q] - pos[p], pos[q + 1] - pos[p + 1], pos[q + 2] - pos[p + 2]]
      const b: Vec3 = [pos[r] - pos[q], pos[r + 1] - pos[q + 1], pos[r + 2] - pos[q + 2]]
      const n = scan.normalAt([pos[q], pos[q + 1], pos[q + 2]], 0)
      const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
      sum += Math.atan2(c[0] * n[0] + c[1] * n[1] + c[2] * n[2], a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
    }
    return sum
  }

  // The triangles a curve ends in alone: a region that holds one runs out
  // through the gap there.
  const danglingIn = new Map<number, Vec3>()
  for (const n of nodes) {
    if ((curveCount.get(n.id) ?? 0) !== 1) continue
    const c = scan.closestInside(n.at)
    if (c) danglingIn.set(c.triangle, n.at)
  }
  const gapIn = (piece: Piece): Vec3 | null => {
    for (const t of piece.triangles) {
      const at = danglingIn.get(t)
      if (at) return at
    }
    return null
  }
  const read = (piece: Piece, seed: Vec3, corners?: ReadonlySet<number>): CellReading => {
    if (piece.leaked) {
      const at = gapIn(piece) ?? openAt(seed, piece.leaked)
      return { status: 'refused', seed, message: `not closed — open at ${where(at)}`, at }
    }
    const holes = holesOf(piece)
    if (holes === null) {
      const gap = gapIn(piece)
      if (gap) return { status: 'refused', seed, message: `not closed — open at ${where(gap)}`, at: gap }
      return { status: 'refused', seed, message: 'the scan’s rim runs through it', at: [pos[piece.rim[0][0] * 3], pos[piece.rim[0][0] * 3 + 1], pos[piece.rim[0][0] * 3 + 2]] }
    }
    let total = 0
    const byFace = new Map<number, number>()
    for (const [k, v] of piece.votes) {
      total += v
      const f = faceOf.get(k)
      if (f !== undefined) byFace.set(f, (byFace.get(f) ?? 0) + v)
    }
    let face = -1
    let best = 0
    for (const [f, v] of byFace) if (v > best) [best, face] = [v, f]
    if (face < 0 || best < FACE_AGREEMENT * total) {
      // The votes split between faces: two curves cross with no node.
      return { status: 'refused', seed, message: 'two curves cross where no node joins them — snap one to the other' }
    }
    const sides = faceSides(faces[face], nodes, curves, corners)
    if ('message' in sides) return { status: 'refused', seed, message: sides.message, ...(sides.at ? { at: sides.at } : {}) }
    const count = sides.corners.length
    if (count < SIDES_MIN) return { status: 'refused', seed, message: count === 2 ? 'two sides' : 'one side' }
    if (count > SIDES_MAX) return { status: 'refused', seed, message: `${count} sides — split it with a curve` }
    return { status: 'ok', seed, face, corners: sides.corners, sides: sides.sides, triangles: Uint32Array.from(piece.triangles), holes }
  }

  // Each seed's region.
  const cells: CellReading[] = []
  const seeded = new Set<number>()
  for (const [k, seed] of seeds.entries()) {
    const c = scan.closest(seed)
    if (!c) {
      cells.push({ status: 'refused', seed, message: 'not on the scan' })
      continue
    }
    const id = label[c.triangle] >= 0 ? label[c.triangle] : flood(c.triangle)
    const piece = pieces[id]
    const reading = read(piece, seed, cornersOf[k])
    // A second seed in a region filled already fills nothing more.
    if (seeded.has(id) && reading.status === 'ok') {
      cells.push({ status: 'refused', seed, message: 'filled already by another seed' })
      continue
    }
    seeded.add(id)
    cells.push(reading)
  }
  // The rest of the regions round the curves, for Fill all: every closed
  // one of three to six sides — but the largest on a closed scan, which is
  // the network's outside. Each touches a curve, so each is flooded from
  // a triangle beside one, in the nearer box and given up as soon as it
  // leaks: flooded to the seeds' box, the network's outside alone was
  // most of the scan round it — 0.2 s of every read on a 2-million-
  // triangle scan, for a count that is nearly always nought.
  for (const k of marks.byEdge.keys()) {
    const a = Math.floor(k / vertexCount)
    const b = k - a * vertexCount
    for (let i = inc.offsets[a]; i < inc.offsets[a + 1]; i++) {
      const t = inc.list[i]
      if (label[t] >= 0 || !inNear(t)) continue
      if (idx[t * 3] === b || idx[t * 3 + 1] === b || idx[t * 3 + 2] === b) flood(t, inNear, true)
    }
  }
  const candidates: { id: number; size: number; sides: number; seeded: boolean }[] = []
  pieces.forEach((piece, id) => {
    if (piece.triangles.length < CRUMB_TRIANGLES && !seeded.has(id)) return
    const r = read(piece, [0, 0, 0])
    if (r.status === 'ok') candidates.push({ id, size: piece.triangles.length, sides: r.corners.length, seeded: seeded.has(id) })
  })
  // On a closed scan the outside of the network is closed too; it is the
  // largest region, unless a seed was put in it.
  if (scanIsClosed(scan, inc) && candidates.length > 0) {
    const largest = candidates.reduce((a, b) => (b.size > a.size ? b : a))
    candidates.splice(candidates.indexOf(largest), 1)
  }
  const unfilled = candidates.filter((c) => !c.seeded).map((c) => ({ seed: insidePoint(scan, pieces[c.id].triangles), sides: c.sides }))
  return { faces, cells, unfilled }
}

const closedScans = new WeakMap<ScanPaths, boolean>()

/** Whether the scan has no rim: every edge has a triangle on both sides. */
function scanIsClosed(scan: ScanPaths, inc: { offsets: Uint32Array; list: Uint32Array }): boolean {
  const had = closedScans.get(scan)
  if (had !== undefined) return had
  const idx = scan.indices
  const nb: number[] = []
  let closed = true
  for (let t = 0; t < scan.triangleCount && closed; t++) {
    for (let e = 0; e < 3; e++) {
      across(scan, inc, t, idx[t * 3 + e], idx[t * 3 + ((e + 1) % 3)], nb)
      if (nb.length === 0) {
        closed = false
        break
      }
    }
  }
  closedScans.set(scan, closed)
  return closed
}

/** A point well inside a region: the middle of its triangle nearest the
 *  region's centroid, of those more than a few edges from its boundary. */
function insidePoint(scan: ScanPaths, triangles: readonly number[]): Vec3 {
  const idx = scan.indices
  const pos = scan.positions
  const mid = (t: number): Vec3 => {
    const out: Vec3 = [0, 0, 0]
    for (let k = 0; k < 3; k++) out[k] = (pos[idx[t * 3] * 3 + k] + pos[idx[t * 3 + 1] * 3 + k] + pos[idx[t * 3 + 2] * 3 + k]) / 3
    return out
  }
  const c: Vec3 = [0, 0, 0]
  for (const t of triangles) {
    const m = mid(t)
    c[0] += m[0]
    c[1] += m[1]
    c[2] += m[2]
  }
  c[0] /= triangles.length
  c[1] /= triangles.length
  c[2] /= triangles.length
  let best = triangles[0]
  let bestD = Infinity
  for (const t of triangles) {
    const m = mid(t)
    const d = Math.hypot(m[0] - c[0], m[1] - c[1], m[2] - c[2])
    if (d < bestD) [bestD, best] = [d, t]
  }
  return mid(best)
}
