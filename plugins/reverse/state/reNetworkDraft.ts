// SPDX-License-Identifier: AGPL-3.0-only
// A patch network's draft edited: a patch placed by its corners — on the
// scan, on the network's nodes, curves and grips — and filled at once, an
// edge dragged out into the next patch, curves made between two points,
// grips moved, put in and taken out, a curve made a crease, a strip's span
// count set, a region filled, a patch deleted — each a pure step from one draft to the next,
// the one before kept for the editor's own undo. The viewport's layer, the
// box and the agent's commands all edit through these.

import type { Vec3 } from '../../../src/core/types'
import type { EdgeRef, FaceRef, NetworkCell, NetworkCurve, NetworkFeature, NetworkFitParams, NetworkNode } from '../core/features'
import type { NetworkReport } from '../core/networkBody'
import type { NetworkData, NetworkDraft, NetworkStart, PlacedCorner, SuggestedCrease } from './reTypes'

/** The fit a new network opens with. Its smoothness is a tenth of Fit
 *  Surface's: what it fairs is the departure from the Coons surface of a
 *  patch's sides, and on a large, strongly bent patch that surface is not
 *  the part's — six patches round a sphere of R 40 at 0.02 mm noise, 49 mm
 *  a side with 120° corners, came out 0.040 mm RMS off the true sphere at
 *  0.01 (0.17 at worst) and 0.012 at 0.001 (0.065). Every other test fitted
 *  closer to its true surface at 0.001 too: a 2 × 2 cap, split cells, a
 *  270° strip. At 0 the corners of three open to 13°. */
export const DEFAULT_NETWORK_FIT: NetworkFitParams = { smoothness: 0.001 }

/** How many edits the editor's undo keeps. */
const HISTORY = 200

/** A chain of curves already joining two corners is a patch's side when it
 *  is no longer than this times their distance apart — the two halves of a
 *  side a neighbour's corner split, not the way round another patch — and
 *  of at most CHAIN_CURVES curves. */
const CHAIN_SLACK = 1.25
const CHAIN_CURVES = 4

export function emptyNetworkDraft(): NetworkDraft {
  return { nodes: [], curves: [], cells: [], spans: {}, fit: { ...DEFAULT_NETWORK_FIT }, nextId: 1, placing: null, history: [], future: [], picked: null, tool: 'draw', suggested: null }
}

/** A draft of a network feature, to edit it. */
export function networkDraftOf(f: NetworkFeature): NetworkDraft {
  const ids = [...f.nodes.map((n) => n.id), ...f.curves.map((c) => c.id)]
  return { ...cloneData(f), nextId: Math.max(0, ...ids) + 1, placing: null, history: [], future: [], picked: null, tool: 'draw', suggested: null }
}

/** The network's data alone, copied. */
export function cloneData(d: NetworkData): NetworkData {
  return {
    nodes: d.nodes.map((n) => ({ ...n, at: [...n.at] as Vec3, ...(n.on ? { on: { ...n.on } } : {}) })),
    curves: d.curves.map((c) => ({ ...c, via: c.via.map((p) => [...p] as Vec3) })),
    cells: d.cells.map((c) => ({ ...c, seed: [...c.seed] as Vec3, ...(c.centre ? { centre: [...c.centre] as Vec3 } : {}), ...(c.corners ? { corners: [...c.corners] } : {}) })),
    spans: { ...d.spans },
    fit: { ...d.fit },
  }
}

const dataOf = (d: NetworkData): NetworkData => ({ nodes: d.nodes, curves: d.curves, cells: d.cells, spans: d.spans, fit: d.fit })

/** The draft with `next` for its data, the data before kept for undo. */
function edited<D extends NetworkDraft>(d: D, next: Partial<NetworkData>, extra: Partial<NetworkDraft> = {}): D {
  return { ...d, ...next, ...extra, history: [...d.history.slice(-(HISTORY - 1)), dataOf(d)], future: [] }
}

/** Several steps made one: `after`, with `before`'s data the one undo
 *  takes it back to. */
function oneStep<D extends NetworkDraft>(before: D, after: D): D {
  return { ...after, history: [...before.history.slice(-(HISTORY - 1)), dataOf(before)], future: [] }
}

export function undoNetwork<D extends NetworkDraft>(d: D): D {
  const last = d.history[d.history.length - 1]
  if (!last) return d
  return { ...d, ...last, placing: null, history: d.history.slice(0, -1), future: [...d.future, dataOf(d)] }
}

export function redoNetwork<D extends NetworkDraft>(d: D): D {
  const next = d.future[d.future.length - 1]
  if (!next) return d
  return { ...d, ...next, placing: null, history: [...d.history, dataOf(d)], future: d.future.slice(0, -1) }
}

/** A curve made from one point to another through grips: an end at a
 *  point of the scan becomes a node. A curve back to its own start with
 *  fewer than two grips is no curve. */
export function addCurve<D extends NetworkDraft>(d: D, from: NetworkStart, via: readonly Vec3[], to: NetworkStart): D {
  let nextId = d.nextId
  const nodes = [...d.nodes]
  const nodeOf = (s: NetworkStart): number => {
    if ('node' in s) return s.node
    const id = nextId++
    nodes.push({ id, at: [...s.at] as Vec3 })
    return id
  }
  const a = nodeOf(from)
  const b = nodeOf(to)
  if (a === b && via.length < 2) return d
  const curve: NetworkCurve = { id: nextId++, from: a, to: b, via: via.map((p) => [...p] as Vec3) }
  return edited(d, { nodes, curves: [...d.curves, curve] }, { nextId })
}

// ---- a patch placed by its corners ------------------------------------------

/** A corner put down on the patch being placed — the first starts it. */
export function placeCorner<D extends NetworkDraft>(d: D, corner: PlacedCorner): D {
  const corners = d.placing?.corners ?? []
  return { ...d, placing: { corners: [...corners, corner] } }
}

/** The last corner put down taken back; with none left, the patch let go. */
export function unplaceCorner<D extends NetworkDraft>(d: D): D {
  const corners = d.placing?.corners ?? []
  return { ...d, placing: corners.length > 1 ? { corners: corners.slice(0, -1) } : null }
}

/** The patch being placed let go. */
export function dropPlacing<D extends NetworkDraft>(d: D): D {
  return { ...d, placing: null }
}

/** Where a placed corner is. */
export function cornerPoint(d: NetworkData, c: PlacedCorner): Vec3 | null {
  if ('node' in c) return d.nodes.find((n) => n.id === c.node)?.at ?? null
  return c.at
}

/** The patch being placed made: closed, a patch of its corners filled at
 *  `seed`; open, the curves between them alone — a line from one point to
 *  another. One step of the undo. */
export function commitPlacing<D extends NetworkDraft>(d: D, opts: { closed: boolean; seed: Vec3 | null }): D {
  const corners = d.placing?.corners ?? []
  const cleared = { ...d, placing: null }
  if (corners.length < 2) return cleared
  return addPatch(cleared, corners, opts)
}

/** A patch made of its corners in order: each a node — an existing one, a
 *  new one on the scan, or one splitting a curve where it was put — and
 *  each corner joined to the next by the curve already joining them, or a
 *  chain of curves the next corner's way (a side a neighbour's corner
 *  split), or else a new curve along the scan (through `vias[i]`, for the
 *  side from corner i, where given). Closed, the last corner is joined to
 *  the first, and the region they close is filled at `seed` with them for
 *  its corners. One step of the undo. */
export function addPatch<D extends NetworkDraft>(d: D, corners: readonly PlacedCorner[], opts: { closed: boolean; seed: Vec3 | null; vias?: readonly (readonly Vec3[] | undefined)[] }): D {
  let x: D = d
  // The pieces each curve split here became, to find a later corner on.
  const pieces = new Map<number, number[]>()
  const piecesOf = (id: number) => pieces.get(id) ?? [id]
  const ids: number[] = []
  // The vias by side, kept to the corners that became nodes.
  const vias: (readonly Vec3[] | undefined)[] = []
  corners.forEach((c, i) => {
    let node: number | null = null
    if ('node' in c) node = x.nodes.some((n) => n.id === c.node) ? c.node : null
    else if (!('curve' in c)) {
      const id = x.nextId
      x = { ...x, nodes: [...x.nodes, { id, at: [...c.at] as Vec3 }], nextId: id + 1 }
      node = id
    } else {
      // On a curve, or one of its grips: split there — on the piece it
      // lies on, if a corner before this one split the curve already.
      const found = nearestPiece(x, piecesOf(c.curve), c.at, 'grip' in c)
      const s = found ? (found.grip !== null ? splitAtGrip(x, found.curve, found.grip) : splitCurve(x, found.curve, found.run, c.at)) : null
      if (s) {
        x = s.draft
        node = s.node
        pieces.set(c.curve, [...piecesOf(c.curve), s.second])
      }
    }
    if (node === null || ids[ids.length - 1] === node) return
    ids.push(node)
    vias.push(opts.vias?.[i])
  })
  if (opts.closed && ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop()
  if (ids.length < 2) return oneStep(d, x)
  const at = new Map(x.nodes.map((n) => [n.id, n.at]))
  const sides = opts.closed && ids.length > 2 ? ids.length : ids.length - 1
  let nextId = x.nextId
  const curves = [...x.curves]
  for (let i = 0; i < sides; i++) {
    const a = ids[i]
    const b = ids[(i + 1) % ids.length]
    if (chainBetween(curves, at, a, b)) continue
    curves.push({ id: nextId++, from: a, to: b, via: (vias[i] ?? []).map((p) => [...p] as Vec3) })
  }
  let cells = x.cells
  if (opts.closed && ids.length > 2 && opts.seed) {
    // A patch placed again on the same corners is the one there.
    const key = [...ids].sort((p, q) => p - q).join(',')
    const had = cells.some((c) => c.corners && [...c.corners].sort((p, q) => p - q).join(',') === key)
    if (!had) cells = [...cells, { seed: [...opts.seed] as Vec3, corners: ids }]
  }
  return oneStep(d, { ...x, curves, cells, nextId })
}

/** The polyline a curve is drawn through: its ends and grips. */
function polylineOf(c: NetworkCurve, at: ReadonlyMap<number, Vec3>): Vec3[] {
  const a = at.get(c.from)
  const b = at.get(c.to)
  return a && b ? [a, ...c.via, b] : []
}

const distance = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])

function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2)) : 0
  return distance(p, [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]])
}

/** Which of a curve's pieces a point lies on — by the polyline of its ends
 *  and grips — the run it is on, and, for a grip, its index. */
function nearestPiece(d: NetworkData, ids: readonly number[], p: Vec3, grip: boolean): { curve: number; run: number; grip: number | null } | null {
  const at = new Map(d.nodes.map((n) => [n.id, n.at]))
  let best: { curve: number; run: number; grip: number | null } | null = null
  let bestD = Infinity
  for (const id of ids) {
    const c = d.curves.find((x) => x.id === id)
    if (!c) continue
    if (grip) {
      const k = c.via.findIndex((v) => distance(v, p) < 1e-6)
      if (k >= 0) return { curve: id, run: k, grip: k }
    }
    const line = polylineOf(c, at)
    for (let k = 0; k + 1 < line.length; k++) {
      const dist = segmentDistance(p, line[k], line[k + 1])
      if (dist < bestD) [bestD, best] = [dist, { curve: id, run: k, grip: null }]
    }
  }
  return best
}

/** Whether a curve, or a short chain of them the straight way, already
 *  joins two nodes. */
function chainBetween(curves: readonly NetworkCurve[], at: ReadonlyMap<number, Vec3>, a: number, b: number): boolean {
  if (curves.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))) return true
  const pa = at.get(a)
  const pb = at.get(b)
  if (!pa || !pb) return false
  const limit = CHAIN_SLACK * distance(pa, pb)
  const lengthOf = (c: NetworkCurve) => {
    const line = polylineOf(c, at)
    let l = 0
    for (let k = 0; k + 1 < line.length; k++) l += distance(line[k], line[k + 1])
    return l
  }
  const walk = (node: number, seen: Set<number>, length: number, depth: number): boolean => {
    if (node === b) return true
    if (depth >= CHAIN_CURVES) return false
    for (const c of curves) {
      const next = c.from === node ? c.to : c.to === node ? c.from : null
      if (next === null || seen.has(next)) continue
      const l = length + lengthOf(c)
      if (l > limit) continue
      seen.add(next)
      if (walk(next, seen, l, depth + 1)) return true
      seen.delete(next)
    }
    return false
  }
  return walk(a, new Set([a]), 0, 0)
}

/** A curve split at a point along it — on its run after grip `run` (0 is
 *  the run from its first end) — by a new node there: the curve keeps its
 *  id up to the node, a new one (`second`) goes on from it. */
export function splitCurve<D extends NetworkDraft>(d: D, curveId: number, run: number, at: Vec3): { draft: D; node: number; second: number } | null {
  const c = d.curves.find((x) => x.id === curveId)
  if (!c) return null
  const r = Math.max(0, Math.min(c.via.length, run))
  return splitWith(d, c, [...at] as Vec3, c.via.slice(0, r), c.via.slice(r))
}

/** A curve split at one of its grips, the grip made the node there. */
export function splitAtGrip<D extends NetworkDraft>(d: D, curveId: number, index: number): { draft: D; node: number; second: number } | null {
  const c = d.curves.find((x) => x.id === curveId)
  if (!c || index < 0 || index >= c.via.length) return null
  return splitWith(d, c, [...c.via[index]] as Vec3, c.via.slice(0, index), c.via.slice(index + 1))
}

function splitWith<D extends NetworkDraft>(d: D, c: NetworkCurve, at: Vec3, first: Vec3[], rest: Vec3[]): { draft: D; node: number; second: number } {
  const node = d.nextId
  const second = d.nextId + 1
  const a: NetworkCurve = { ...c, to: node, via: first }
  const b: NetworkCurve = { ...c, id: second, from: node, via: rest }
  const nodes: NetworkNode[] = [...d.nodes, { id: node, at }]
  const curves = d.curves.flatMap((x) => (x.id === c.id ? [a, b] : [x]))
  // The second half runs in the same strip as the first did.
  const spans = { ...d.spans }
  if (spans[String(c.id)] !== undefined) spans[String(second)] = spans[String(c.id)]
  return { draft: edited(d, { nodes, curves, spans }, { nextId: d.nextId + 2 }), node, second }
}

/** Cells' seeds put elsewhere — their patches' middles after a corner
 *  moved — as part of the step that moved it, not one of their own. */
export function setCellSeeds<D extends NetworkDraft>(d: D, seeds: readonly { index: number; seed: Vec3 }[]): D {
  if (seeds.length === 0) return d
  const by = new Map(seeds.map((s) => [s.index, s.seed]))
  return { ...d, cells: d.cells.map((c, i) => (by.has(i) ? { ...c, seed: [...by.get(i)!] as Vec3 } : c)) }
}

/** The cells with their corners kept to the nodes there still are: a cell
 *  left with fewer than three is read by the rule again. */
function cellsWithNodes(cells: readonly NetworkCell[], nodes: readonly NetworkNode[]): NetworkCell[] {
  const alive = new Set(nodes.map((n) => n.id))
  return cells.map((c) => {
    if (!c.corners || c.corners.every((id) => alive.has(id))) return c
    const kept = c.corners.filter((id) => alive.has(id))
    const { corners: _c, ...rest } = c
    void _c
    return kept.length >= 3 ? { ...rest, corners: kept } : rest
  })
}

/** A node moved — onto the scan where it was dragged to. */
export function moveNode<D extends NetworkDraft>(d: D, id: number, at: Vec3, record = true): D {
  const nodes = d.nodes.map((n) => (n.id === id ? { ...n, at: [...at] as Vec3 } : n))
  return record ? edited(d, { nodes }) : { ...d, nodes }
}

/** A curve's grip moved. */
export function moveGrip<D extends NetworkDraft>(d: D, curveId: number, index: number, at: Vec3, record = true): D {
  const curves = d.curves.map((c) => (c.id === curveId ? { ...c, via: c.via.map((p, i) => (i === index ? ([...at] as Vec3) : p)) } : c))
  return record ? edited(d, { curves }) : { ...d, curves }
}

/** A cell's seed or centre moved. */
export function moveCell<D extends NetworkDraft>(d: D, index: number, what: 'seed' | 'centre', at: Vec3, record = true): D {
  const cells = d.cells.map((c, i) => (i === index ? { ...c, [what]: [...at] as Vec3 } : c))
  return record ? edited(d, { cells }) : { ...d, cells }
}

/** A split cell's centre back at its polygon's middle. */
export function resetCentre<D extends NetworkDraft>(d: D, index: number): D {
  const cells = d.cells.map((c, i) => (i === index && c.centre ? (({ centre: _c, ...rest }) => (void _c, rest))(c) : c))
  return edited(d, { cells })
}

/** The draft as it stood before a drag began, put in the history once the
 *  drag is done — the drag's moves themselves are not steps. */
export function recordDrag<D extends NetworkDraft>(d: D, before: NetworkData): D {
  return { ...d, history: [...d.history.slice(-(HISTORY - 1)), before], future: [] }
}

/** A curve along the whole of a body's edge (PN11), its ends nodes on the
 *  edge's corners — the network's own where one is within a hair — and the
 *  patch beside it meeting the face given on its edge, to be made tangent
 *  in the box. */
export function addEdgeCurve<D extends NetworkDraft>(d: D, body: number, edge: EdgeRef, ends: [Vec3, Vec3], face: FaceRef | null): D {
  let nextId = d.nextId
  const nodes = [...d.nodes]
  const nodeAt = (at: Vec3, end: 0 | 1): number => {
    const near = nodes.find((n) => Math.hypot(n.at[0] - at[0], n.at[1] - at[1], n.at[2] - at[2]) <= EDGE_NODE_MM)
    if (near) return near.id
    const id = nextId++
    nodes.push({ id, at: [...at] as Vec3, on: { body, vertex: edge, end } })
    return id
  }
  const from = nodeAt(ends[0], 0)
  const to = nodeAt(ends[1], 1)
  if (from === to) return d
  const curve: NetworkCurve = { id: nextId++, from, to, via: [], along: { body, edge }, ...(face ? { side: { body, face, mode: 'contact' as const } } : {}) }
  return edited(d, { nodes, curves: [...d.curves, curve] }, { nextId })
}

/** How near a node a body edge's end may be and be that node, mm. */
const EDGE_NODE_MM = 0.5

/** The patch beside a curve on a body: meeting the face on its edge
 *  (contact) or tangent to it, or — null — beside no face. */
export function setSide<D extends NetworkDraft>(d: D, curveId: number, side: NetworkCurve['side'] | null): D {
  const curves = d.curves.map((c) => (c.id === curveId ? (side ? { ...c, side } : (({ side: _s, ...rest }) => (void _s, rest))(c)) : c))
  return edited(d, { curves })
}

/** A grip put into a curve on its run after grip `run`. */
export function insertGrip<D extends NetworkDraft>(d: D, curveId: number, run: number, at: Vec3, record = true): D {
  const curves = d.curves.map((c) => {
    if (c.id !== curveId) return c
    const via = [...c.via]
    via.splice(Math.max(0, Math.min(via.length, run)), 0, [...at] as Vec3)
    return { ...c, via }
  })
  return record ? edited(d, { curves }) : { ...d, curves }
}

/** A grip taken out of a curve. */
export function removeGrip<D extends NetworkDraft>(d: D, curveId: number, index: number): D {
  const curves = d.curves.map((c) => (c.id === curveId ? { ...c, via: c.via.filter((_, i) => i !== index) } : c))
  return edited(d, { curves })
}

/** A curve deleted, and the nodes no other curve ends at with it. */
export function removeCurve<D extends NetworkDraft>(d: D, curveId: number): D {
  const curves = d.curves.filter((c) => c.id !== curveId)
  const used = new Set(curves.flatMap((c) => [c.from, c.to]))
  const nodes = d.nodes.filter((n) => used.has(n.id))
  const spans = { ...d.spans }
  delete spans[String(curveId)]
  return edited(d, { curves, nodes, spans, cells: cellsWithNodes(d.cells, nodes) })
}

/** A node deleted, with every curve that ends at it. */
export function removeNode<D extends NetworkDraft>(d: D, nodeId: number): D {
  const gone = new Set(d.curves.filter((x) => x.from === nodeId || x.to === nodeId).map((c) => c.id))
  const curves = d.curves.filter((c) => !gone.has(c.id))
  const used = new Set(curves.flatMap((c) => [c.from, c.to]))
  const nodes = d.nodes.filter((n) => n.id !== nodeId && used.has(n.id))
  const spans = Object.fromEntries(Object.entries(d.spans).filter(([k]) => !gone.has(Number(k))))
  return edited(d, { curves, nodes, spans, cells: cellsWithNodes(d.cells, nodes) })
}

/** A curve made a crease, or tangent again. */
export function toggleCrease<D extends NetworkDraft>(d: D, curveId: number): D {
  const curves = d.curves.map((c) => (c.id === curveId ? (c.crease ? (({ crease: _c, ...rest }) => (void _c, rest))(c) : { ...c, crease: true }) : c))
  return edited(d, { curves })
}

/** The creases the scan suggests, to offer — or, null, put away. */
export function setSuggested<D extends NetworkDraft>(d: D, suggested: SuggestedCrease[] | null): D {
  return { ...d, suggested }
}

/** Suggested creases taken as crease curves, by their index among those
 *  offered, and no longer offered. An end becomes the network's node there
 *  — one a suggestion taken already put there, or one within
 *  EDGE_NODE_MM of it — or a new one. One step of the undo. */
export function acceptCreases<D extends NetworkDraft>(d: D, indices: readonly number[]): D {
  const offered = d.suggested ?? []
  const take = new Set(indices.filter((i) => i >= 0 && i < offered.length))
  if (take.size === 0) return d
  let nextId = d.nextId
  const nodes = [...d.nodes]
  const nodeAt = (at: Vec3): number => {
    let best: NetworkNode | null = null
    let bestD = EDGE_NODE_MM
    for (const n of nodes) {
      const dist = Math.hypot(n.at[0] - at[0], n.at[1] - at[1], n.at[2] - at[2])
      if (dist <= bestD) [bestD, best] = [dist, n]
    }
    if (best) return best.id
    const id = nextId++
    nodes.push({ id, at: [...at] as Vec3 })
    return id
  }
  const curves = [...d.curves]
  for (const i of [...take].sort((a, b) => a - b)) {
    const s = offered[i]
    const from = nodeAt(s.from)
    const to = nodeAt(s.to)
    if (from === to && s.via.length < 2) continue
    curves.push({ id: nextId++, from, to, via: s.via.map((p) => [...p] as Vec3), crease: true })
  }
  const left = offered.filter((_, i) => !take.has(i))
  return edited(d, { nodes, curves }, { nextId, suggested: left.length > 0 ? left : null })
}

/** A strip's span count set — keyed by the lowest id among its curves,
 *  every other key of the strip taken away — or, null, back to Auto. */
export function setStripSpans<D extends NetworkDraft>(d: D, stripCurves: readonly number[], spans: number | null): D {
  const next = { ...d.spans }
  for (const c of stripCurves) delete next[String(c)]
  if (spans !== null && stripCurves.length > 0) next[String(Math.min(...stripCurves))] = Math.round(spans)
  return edited(d, { spans: next })
}

/** A region filled, by a point inside it. */
export function addSeed<D extends NetworkDraft>(d: D, at: Vec3): D {
  return edited(d, { cells: [...d.cells, { seed: [...at] as Vec3 }] })
}

/** Regions filled by their seeds, all at once — Fill all. */
export function addSeeds<D extends NetworkDraft>(d: D, seeds: readonly Vec3[]): D {
  if (seeds.length === 0) return d
  return edited(d, { cells: [...d.cells, ...seeds.map((s) => ({ seed: [...s] as Vec3 }))] })
}

/** A filled region emptied. */
export function removeSeed<D extends NetworkDraft>(d: D, index: number): D {
  return edited(d, { cells: d.cells.filter((_, i) => i !== index) })
}

/** A patch deleted: its cell, the curves of its own round it — `own`, the
 *  ones no other patch runs along — and the nodes no curve ends at once
 *  they are gone. One step. */
export function removePatch<D extends NetworkDraft>(d: D, index: number, own: readonly number[]): D {
  const gone = new Set(own)
  const curves = d.curves.filter((c) => !gone.has(c.id))
  const used = new Set(curves.flatMap((c) => [c.from, c.to]))
  const nodes = d.nodes.filter((n) => used.has(n.id))
  const spans = Object.fromEntries(Object.entries(d.spans).filter(([k]) => !gone.has(Number(k))))
  const cells = cellsWithNodes(d.cells.filter((_, i) => i !== index), nodes)
  return edited(d, { curves, nodes, spans, cells }, { picked: null })
}

/** The patch a report names deleted (removePatch): the cell it is of — a
 *  split cell's patches go together — with those of the curves round it
 *  that are the draft's and no other patch of the report runs along. */
export function removeReportedPatch<D extends NetworkDraft>(d: D, report: Pick<NetworkReport, 'patches' | 'cells'>, patch: number): D {
  const cell = report.cells.findIndex((c) => 'patches' in c && c.patches.includes(patch))
  const outcome = report.cells[cell]
  if (!outcome || !('patches' in outcome)) return d
  const mine = new Set(outcome.patches)
  const others = new Set(report.patches.flatMap((p, i) => (mine.has(i) ? [] : p.sides.flat())))
  const known = new Set(d.curves.map((c) => c.id))
  const own = [...new Set([...mine].flatMap((i) => report.patches[i]?.sides.flat() ?? []))].filter((id) => known.has(id) && !others.has(id))
  return removePatch(d, cell, own)
}

/** The network's fit changed. */
export function setNetworkFit<D extends NetworkDraft>(d: D, fit: Partial<NetworkFitParams>): D {
  return edited(d, { fit: { ...d.fit, ...fit } })
}

/** Whether a network draft has anything to build. */
export function networkReady(d: NetworkData): boolean {
  return d.curves.length > 0 && d.cells.length > 0
}
