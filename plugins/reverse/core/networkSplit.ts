// SPDX-License-Identifier: AGPL-3.0-only
// A cell of three, five or six sides split into four-sided ones from its
// centre (PN6).
//
// The cell is mapped onto a regular polygon of as many corners
// (networkMap.ts); its centre is the scan point at the polygon's middle, or
// where the operator dragged it. Each side is split at its middle by arc
// length with a node — a T-node for the cell on its other side, whose side
// then runs through it straight on — and a spoke runs from the centre to
// each: n four-sided cells, meeting at a corner of n patches at the centre,
// where the fit reports the angle instead of holding it (networkFit.ts).
//
// The spokes and the nodes are made for the build and are not the
// feature's: they are made again from the cell's sides every build, so they
// follow the sides when a curve moves, and only the centre a hand dragged is
// kept, on the cell. Their ids are counted from DERIVED_IDS on, in the
// order the cells and their sides come, so the same network gives the same
// ids build after build — what a strip's span count is keyed by.

import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import type { TracedNetwork } from './network'
import type { CellReading, CellSide, GraphCurve, GraphNode } from './networkCells'
import { type CurveTrace, fitProvisional, traceCurve } from './networkCurve'
import { type CellMap, type CellMesh, cellMesh, mapCell, polygonCorners } from './networkMap'

/** Where the ids of the nodes and curves made for a split start. */
export const DERIVED_IDS = 1_000_000
/** How near the middle of a side a node already on it may be, as a share
 *  of the side's length, for it to be the middle — a side two split cells
 *  share is split once. */
const REUSE_SHARE = 0.02

export interface PolygonSplit {
  traced: TracedNetwork
  /** Every seed the cells are read by again: a cell's own where it was not
   *  split, one in each of its quads where it was. */
  seeds: Vec3[]
  /** By seed: which of the feature's cells it is for. */
  owner: number[]
  /** By seed: a quad's four corners, which the corner rule is not asked
   *  for — off its middle, a centre opens past the rule's 150° on a quad. */
  corners: (ReadonlySet<number> | undefined)[]
  /** The spokes and centres made, by the feature's cell, for drawing. */
  spokes: { cell: number; curve: number; points: Float32Array }[]
  centres: { cell: number; at: Vec3 }[]
  /** Cells that could not be split, and why. */
  refused: Map<number, string>
  /** A piece of a curve split at a side's middle: the curve it is of. */
  originOf: Map<number, number>
}

/** The point of a mapped cell at (u, v) of its polygon, or null off it. */
export function pointAtUv(mesh: CellMesh, map: CellMap, u: number, v: number): Vec3 | null {
  const t = mesh.triangles
  const uv = map.uv
  const p = mesh.positions
  for (let f = 0; f < t.length / 3; f++) {
    const a = t[f * 3], b = t[f * 3 + 1], c = t[f * 3 + 2]
    const x0 = uv[a * 2], y0 = uv[a * 2 + 1]
    const x1 = uv[b * 2] - x0, y1 = uv[b * 2 + 1] - y0
    const x2 = uv[c * 2] - x0, y2 = uv[c * 2 + 1] - y0
    const det = x1 * y2 - x2 * y1
    if (!(Math.abs(det) > 1e-18)) continue
    const s = ((u - x0) * y2 - x2 * (v - y0)) / det
    const r = (x1 * (v - y0) - (u - x0) * y1) / det
    if (s < -1e-9 || r < -1e-9 || s + r > 1 + 1e-9) continue
    const w = 1 - s - r
    return [0, 1, 2].map((k) => w * p[a * 3 + k] + s * p[b * 3 + k] + r * p[c * 3 + k]) as Vec3
  }
  return null
}

/** A trace's points from `from` to `to`, its arc length counted again from
 *  the first. */
function sliceTrace(t: CurveTrace, from: number, to: number): CurveTrace {
  const at = t.at.slice(from, to + 1)
  const base = at[0]
  for (let i = 0; i < at.length; i++) at[i] -= base
  return {
    points: t.points.slice(from * 3, (to + 1) * 3),
    on: t.on.slice(from * 2, (to + 1) * 2),
    at,
    length: at[at.length - 1],
    grips: [0, ...t.grips.filter((g) => g > from && g < to).map((g) => g - from), to - from],
    runs: t.runs.filter((r) => r.to > from && r.from < to).map((r) => ({ ...r, from: Math.max(r.from, from) - from, to: Math.min(r.to, to) - from })),
  }
}

/** The network's cells of three, five or six sides split — see above — or
 *  null when there is none. */
export function splitPolygons(scan: ScanPaths, traced: TracedNetwork, cells: readonly CellReading[], centresGiven: readonly (Vec3 | undefined)[]): PolygonSplit | null {
  if (!cells.some((c) => c.status === 'ok' && c.sides.length !== 4)) return null
  const nodes: GraphNode[] = traced.nodes.map((n) => ({ ...n }))
  const curves = new Map<number, GraphCurve>(traced.curves.map((c) => [c.id, c]))
  /** Each curve of the network as it is now cut: its pieces in order. */
  const pieces = new Map<number, number[]>(traced.curves.map((c) => [c.id, [c.id]]))
  const nodeAt = (id: number) => nodes.find((n) => n.id === id)!.at
  let next = DERIVED_IDS
  const seeds: Vec3[] = []
  const owner: number[] = []
  const quadCorners: (ReadonlySet<number> | undefined)[] = []
  const spokes: PolygonSplit['spokes'] = []
  const centres: PolygonSplit['centres'] = []
  const refused = new Map<number, string>()

  /** A side's pieces in its order, each forwards or backwards. */
  const sidePieces = (side: CellSide): { curve: number; forward: boolean }[] =>
    side.edges.flatMap((h) => {
      const list = pieces.get(h.curve) ?? [h.curve]
      return (h.forward ? list : [...list].reverse()).map((curve) => ({ curve, forward: h.forward }))
    })

  /** The node at a side's middle by arc length: one already there within
   *  REUSE_SHARE of it, or a new one splitting the piece it falls on. */
  const middleOf = (side: CellSide): number => {
    const parts = sidePieces(side)
    const lengths = parts.map((p) => curves.get(p.curve)!.trace.length)
    const total = lengths.reduce((a, b) => a + b, 0)
    let acc = 0
    // A node between two pieces near enough the middle is it.
    for (let k = 0; k + 1 < parts.length; k++) {
      acc += lengths[k]
      if (Math.abs(acc - total / 2) <= REUSE_SHARE * total) {
        const c = curves.get(parts[k].curve)!
        return parts[k].forward ? c.to : c.from
      }
    }
    acc = 0
    for (let k = 0; k < parts.length; k++) {
      if (acc + lengths[k] < total / 2 && k + 1 < parts.length) {
        acc += lengths[k]
        continue
      }
      const part = parts[k]
      const c = curves.get(part.curve)!
      const t = c.trace
      const along = part.forward ? total / 2 - acc : t.length - (total / 2 - acc)
      let i = 1
      while (i < t.at.length - 2 && t.at[i] < along) i++
      // The trace's own point there: it lies on the scan, on a triangle's
      // edge, and both halves keep it — the edges the curve crossed stay
      // crossed.
      const node = next++
      const second = next++
      const at: Vec3 = [t.points[i * 3], t.points[i * 3 + 1], t.points[i * 3 + 2]]
      nodes.push({ id: node, at })
      const a = sliceTrace(t, 0, i)
      const b = sliceTrace(t, i, t.at.length - 1)
      curves.set(c.id, { ...c, to: node, trace: a, fit: fitProvisional(a, scan.edge) })
      curves.set(second, { id: second, from: node, to: c.to, trace: b, fit: fitProvisional(b, scan.edge) })
      for (const [original, list] of pieces) {
        const at2 = list.indexOf(c.id)
        if (at2 >= 0) {
          list.splice(at2 + 1, 0, second)
          pieces.set(original, list)
          break
        }
      }
      return node
    }
    return parts.length > 0 ? curves.get(parts[parts.length - 1].curve)!.to : -1
  }

  cells.forEach((cell, index) => {
    if (cell.status !== 'ok' || cell.sides.length === 4) {
      seeds.push(cell.seed)
      owner.push(index)
      // A four-sided cell keeps the corners it was read with: a side's
      // middle put in by a neighbour's split is a T-node on it, not a
      // corner, and a corner given turns as little as it likes.
      quadCorners.push(cell.status === 'ok' ? new Set(cell.corners) : undefined)
      return
    }
    const n = cell.sides.length
    const mesh = cellMesh(scan, cell.triangles, cell.holes, cell.corners.map(nodeAt))
    const map = typeof mesh === 'string' ? mesh : mapCell(mesh)
    if (typeof mesh === 'string' || typeof map === 'string') {
      refused.set(index, typeof mesh === 'string' ? mesh : (map as string))
      seeds.push(cell.seed)
      owner.push(index)
      quadCorners.push(undefined)
      return
    }
    // The centre: dragged, or the polygon's middle.
    const given = centresGiven[index]
    const middle = given ?? pointAtUv(mesh, map, 0.5, 0.5)
    const onScan = middle ? scan.closestInside(middle) : null
    if (!onScan) {
      refused.set(index, 'its centre is off the scan')
      seeds.push(cell.seed)
      owner.push(index)
      quadCorners.push(undefined)
      return
    }
    const centre = next++
    nodes.push({ id: centre, at: onScan.point })
    centres.push({ cell: index, at: onScan.point })
    const mids = cell.sides.map(middleOf)
    for (let k = 0; k < n; k++) {
      const id = next++
      const trace = traceCurve(scan, [onScan.point, nodeAt(mids[k])])
      if (trace.points.length < 6) continue
      trace.points.set(onScan.point, 0)
      trace.points.set(nodeAt(mids[k]), trace.points.length - 3)
      curves.set(id, { id, from: centre, to: mids[k], trace, fit: fitProvisional(trace, scan.edge) })
      spokes.push({ cell: index, curve: id, points: trace.points })
    }
    // A seed in each quad: the middle of its four corners on the polygon —
    // the centre, the side's middle before the corner, the corner and the
    // side's middle after it.
    const poly = polygonCorners(n)
    const mid = (k: number): [number, number] => {
      const a = poly[((k % n) + n) % n]
      const b = poly[(((k + 1) % n) + n) % n]
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    }
    for (let k = 0; k < n; k++) {
      const quad = [[0.5, 0.5], mid(k - 1), poly[k], mid(k)]
      const u = quad.reduce((s, q) => s + q[0], 0) / 4
      const v = quad.reduce((s, q) => s + q[1], 0) / 4
      const seed = pointAtUv(mesh, map, u, v)
      if (!seed) continue
      seeds.push(scan.closestInside(seed)?.point ?? seed)
      owner.push(index)
      quadCorners.push(new Set([centre, mids[(k - 1 + n) % n], cell.corners[k], mids[k]]))
    }
  })
  const originOf = new Map<number, number>()
  for (const [original, list] of pieces) for (const id of list) if (id !== original) originOf.set(id, original)
  return { traced: { nodes, curves: [...curves.values()], lost: traced.lost }, seeds, owner, corners: quadCorners, spokes, centres, refused, originOf }
}
