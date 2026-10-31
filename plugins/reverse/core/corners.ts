// SPDX-License-Identifier: AGPL-3.0-only
// Corners inferred, and a profile closed. Fitted pieces never meet by
// themselves: every fit stops short of the blend, a sharp corner needs its
// two lines carried on to their intersection, a fillet needs its arc's ends
// put exactly on the sides it joins, and the outer-skin trace of a thin wall
// has to be closed across the wall's end. So the pieces of a chain are
// walked in order, and wherever two neighbouring ends lie within the gap a
// corner is allowed, they are brought to one point and held there with a
// coincidence — plus a tangency where a line meets an arc it runs into, or
// two arcs blend. What is left open after that is the operator's to close:
// the Close command bridges the remaining gaps, carrying two lines on to
// their intersection where they have one and drawing a straight bridge
// where they have not.

import type { Vec2 } from '../../../src/core/flat/types'
import { add2, cross2, dot2, len2, normalize2, perp2, scale2, sub2 } from '../../../src/core/flat/vec2'
import {
  addConstraint,
  addEntity,
  anchorPoint,
  arcAngleOf,
  constraintEntities,
  entityOf,
  nearestOnEntity,
  TOUCH_MM,
  unwindAngle,
  type Anchor,
  type AnchorAt,
  type Sketch,
  type SketchArc,
  type SketchEntity,
  type SketchLine,
} from './sketch'
import type { PlacedSegment } from './segment'

/** The gap two ends may stand apart and still be one corner, millimetres,
 *  unless the caller says otherwise. */
export const CORNER_GAP_MM = 2
/** How near a line has to run to tangent to an arc's circle — as a share of
 *  the corner gap — to be taken as tangent, at the most. */
const TANGENT_SHARE = 0.5
/** And how near by angle: a line that crosses the circle at more than this
 *  is not tangent to it. Half the corner gap is a millimetre, and beside a
 *  round of two that is a line crossing at sixty degrees — held tangent, the
 *  solver bends the round off its points to make it so. The miss the angle
 *  stands for is r·(1 − cos), and never under twice the pieces' scatter, so
 *  a small round fitted through noise still takes its tangency. */
const TANGENT_DEG = 20
const TANGENT_COS = Math.cos((TANGENT_DEG * Math.PI) / 180)

/** How far off tangent a piece may run beside a round of radius `r`. */
function tangentSlack(r: number, scatter: number, tol: number): number {
  return Math.min(tol, Math.max(r * (1 - TANGENT_COS), 2 * scatter))
}

/** Two lines meeting at under this angle are as good as parallel: their
 *  intersection is far off, and the corner is the midpoint of their ends. */
const PARALLEL_DEG = 5
/** How far past its end a line may be carried to meet the other, as a
 *  multiple of the gap, before the meeting point is not this corner. */
const REACH_GAPS = 4

export interface CornerReport {
  /** How many corners were joined, and how many of those with a tangency. */
  joined: number
  tangent: number
  /** How many gaps were left open — wider than the corner gap. */
  open: number
}

/** Put an arc's end at an angle, keeping the other end where it is and the
 *  sweep as near what it was as the circle allows. */
function setArcEnd(arc: SketchArc, at: AnchorAt, angle: number): void {
  if (at === 'a') {
    const end = arc.start + arc.sweep
    const raw = unwindAngle(end, angle) - angle
    arc.start = angle
    arc.sweep = nearestSweep(raw, arc.sweep)
  } else {
    const raw = unwindAngle(angle, arc.start) - arc.start
    arc.sweep = nearestSweep(raw, arc.sweep)
  }
}

/** `raw` (in [0, 2π)) or a full turn either side of it, whichever is nearest
 *  the sweep the arc had — so an arc that was nearly a full turn does not
 *  snap to nearly nothing when its end moves across its start. */
function nearestSweep(raw: number, had: number): number {
  const two = 2 * Math.PI
  const candidates = [raw, raw + two, raw - two].filter((s) => s > 1e-6 && s <= two + 1e-9)
  let best = raw
  let bestD = Infinity
  for (const c of candidates) {
    const d = Math.abs(c - had)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** Move an entity's anchor to a point — a line's end outright, an arc's
 *  end to the angle the point lies at. */
function moveAnchor(e: SketchEntity, at: AnchorAt, p: Vec2): void {
  if (e.kind === 'line') {
    if (at === 'a') e.a = [p[0], p[1]]
    else e.b = [p[0], p[1]]
  } else if (e.kind === 'arc') {
    setArcEnd(e, at, arcAngleOf(e, p))
  } else if (e.kind === 'point') {
    e.p = [p[0], p[1]]
  }
}

/** Where two lines' carriers cross, or null when parallel. */
export function lineIntersection(a: SketchLine, b: SketchLine): Vec2 | null {
  const da = sub2(a.b, a.a)
  const db = sub2(b.b, b.a)
  const denom = cross2(da, db)
  const la = len2(da)
  const lb = len2(db)
  if (la < 1e-12 || lb < 1e-12) return null
  if (Math.abs(denom) / (la * lb) < Math.sin((PARALLEL_DEG * Math.PI) / 180)) return null
  const t = cross2(sub2(b.a, a.a), db) / denom
  return add2(a.a, scale2(da, t))
}

/** The points where a line's carrier crosses a circle. */
function lineCircle(l: SketchLine, c: Vec2, r: number): Vec2[] {
  const d = normalize2(sub2(l.b, l.a))
  if (!d) return []
  const off = dot2(sub2(c, l.a), perp2(d))
  if (Math.abs(off) > r) return []
  const foot = add2(l.a, scale2(d, dot2(sub2(c, l.a), d)))
  const h = Math.sqrt(Math.max(0, r * r - off * off))
  return h < 1e-9 ? [foot] : [add2(foot, scale2(d, h)), add2(foot, scale2(d, -h))]
}

/** The points where two circles cross. */
function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = len2(sub2(c2, c1))
  if (d < 1e-9 || d > r1 + r2 || d < Math.abs(r1 - r2)) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a))
  const u = scale2(sub2(c2, c1), 1 / d)
  const foot = add2(c1, scale2(u, a))
  const n = perp2(u)
  return h < 1e-9 ? [foot] : [add2(foot, scale2(n, h)), add2(foot, scale2(n, -h))]
}

function nearestTo(candidates: readonly Vec2[], p: Vec2): Vec2 | null {
  let best: Vec2 | null = null
  let bestD = Infinity
  for (const c of candidates) {
    const d = len2(sub2(c, p))
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** The point on a line's carrier and an arc's circle where they touch, if
 *  the line runs within `tol` of tangent — else null. */
function tangentPoint(l: SketchLine, arc: SketchArc, tol: number): Vec2 | null {
  const d = normalize2(sub2(l.b, l.a))
  if (!d) return null
  const off = dot2(sub2(arc.c, l.a), perp2(d))
  const slack = tangentSlack(arc.r, Math.max(arc.scatter ?? 0, l.scatter ?? 0), tol)
  if (Math.abs(Math.abs(off) - arc.r) > slack) return null
  return add2(l.a, scale2(d, dot2(sub2(arc.c, l.a), d)))
}

/** Where two arcs' circles touch if they run within `tol` of tangent. */
function arcsTangentPoint(a: SketchArc, b: SketchArc, tol: number): Vec2 | null {
  const d = len2(sub2(b.c, a.c))
  if (d < 1e-9) return null
  const u = scale2(sub2(b.c, a.c), 1 / d)
  const slack = tangentSlack(Math.min(a.r, b.r), Math.max(a.scatter ?? 0, b.scatter ?? 0), tol)
  if (Math.abs(d - (a.r + b.r)) <= slack) return add2(a.c, scale2(u, a.r))
  if (Math.abs(d - Math.abs(a.r - b.r)) <= slack) {
    return a.r >= b.r ? add2(a.c, scale2(u, a.r)) : add2(a.c, scale2(u, -a.r))
  }
  return null
}

/**
 * Join two ends: bring them to one point — the intersection of their
 * carriers where there is one within reach, the tangent point where a line
 * or an arc runs tangent into an arc, the midpoint otherwise — and hold them
 * with a coincidence, plus a tangency where one was found. Returns whether a
 * tangency was added.
 */
export function joinEnds(sketch: Sketch, p: Anchor, q: Anchor, gap: number): boolean {
  const ea = entityOf(sketch, p.entity)
  const eb = entityOf(sketch, q.entity)
  if (!ea || !eb) return false
  const pa = anchorPoint(ea, p.at)
  const pb = anchorPoint(eb, q.at)
  const mid: Vec2 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]
  const reach = Math.max(REACH_GAPS * gap, len2(sub2(pa, pb)) * 2)
  const within = (x: Vec2 | null) => x && len2(sub2(x, pa)) <= reach && len2(sub2(x, pb)) <= reach
  let meet: Vec2 = mid
  let tangent = false
  const tanTol = gap * TANGENT_SHARE

  if (ea.kind === 'line' && eb.kind === 'line') {
    const x = lineIntersection(ea, eb)
    if (within(x)) meet = x!
  } else if ((ea.kind === 'line' && eb.kind === 'arc') || (ea.kind === 'arc' && eb.kind === 'line')) {
    const line = (ea.kind === 'line' ? ea : eb) as SketchLine
    const arc = (ea.kind === 'arc' ? ea : eb) as SketchArc
    const t = tangentPoint(line, arc, tanTol)
    if (t && within(t)) {
      meet = t
      tangent = true
    } else {
      const x = nearestTo(lineCircle(line, arc.c, arc.r), mid)
      if (within(x)) meet = x!
    }
  } else if (ea.kind === 'arc' && eb.kind === 'arc') {
    const t = arcsTangentPoint(ea, eb, tanTol)
    if (t && within(t)) {
      meet = t
      tangent = true
    } else {
      const x = nearestTo(circleCircle(ea.c, ea.r, eb.c, eb.r), mid)
      if (within(x)) meet = x!
    }
  }
  moveAnchor(ea, p.at, meet)
  moveAnchor(eb, q.at, meet)
  addConstraint(sketch, { kind: 'coincident', p, q })
  if (tangent) addConstraint(sketch, { kind: 'tangent', a: p.entity, b: q.entity })
  return tangent
}

/** The pairs of ends that follow each other along the chain: each piece's
 *  last point to the next piece's first, and the last piece back to the
 *  first on a closed chain. */
function consecutive(order: readonly PlacedSegment[], closed: boolean): [Anchor, Anchor, boolean][] {
  const pairs: [Anchor, Anchor, boolean][] = []
  const count = closed ? order.length : order.length - 1
  for (let i = 0; i < count; i++) {
    const cur = order[i]
    const next = order[(i + 1) % order.length]
    if (order.length === 1 && !closed) break
    pairs.push([
      { entity: cur.id, at: cur.to },
      { entity: next.id, at: next.from },
      cur.joinNext === true,
    ])
  }
  return pairs
}

function gapOf(sketch: Sketch, p: Anchor, q: Anchor): number {
  const ea = entityOf(sketch, p.entity)
  const eb = entityOf(sketch, q.entity)
  if (!ea || !eb) return Infinity
  return len2(sub2(anchorPoint(ea, p.at), anchorPoint(eb, q.at)))
}

function alreadyJoined(sketch: Sketch, p: Anchor, q: Anchor): boolean {
  return sketch.constraints.some(
    (c) =>
      c.kind === 'coincident' &&
      ((c.p.entity === p.entity && c.p.at === p.at && c.q.entity === q.entity && c.q.at === q.at) ||
        (c.q.entity === p.entity && c.q.at === p.at && c.p.entity === q.entity && c.p.at === q.at)),
  )
}

/**
 * Walk the chain's pieces and join every pair of neighbouring ends within
 * `gap` millimetres of each other — and every pair the segmentation dropped
 * a piece between, whatever their gap: a blob cut out of a corner leaves
 * its sides further apart than a corner's ends stand by themselves. A single arc that is nearly a full circle
 * on a closed chain is closed on itself into a circle.
 */
export function inferCorners(
  sketch: Sketch,
  order: readonly PlacedSegment[],
  closed: boolean,
  gap = CORNER_GAP_MM,
): CornerReport {
  const report: CornerReport = { joined: 0, tangent: 0, open: 0 }
  if (order.length === 1 && closed) {
    const e = entityOf(sketch, order[0].id)
    if (e?.kind === 'arc') {
      // One arc round a closed chain is a circle.
      const idx = sketch.entities.findIndex((x) => x.id === e.id)
      sketch.entities[idx] = { id: e.id, kind: 'circle', c: e.c, r: e.r, points: e.points, scatter: e.scatter }
      report.joined = 1
    }
    return report
  }
  for (const [p, q, corner] of consecutive(order, closed)) {
    if (alreadyJoined(sketch, p, q)) continue
    const apart = gapOf(sketch, p, q)
    if (apart <= gap || (corner && Number.isFinite(apart))) {
      if (joinEnds(sketch, p, q, Math.max(gap, apart))) report.tangent++
      report.joined++
    } else report.open++
  }
  return report
}

/**
 * Close what corner inference left open: every remaining gap along the
 * chain — and, on an open chain, the gap from its last end back to its
 * first — is bridged. Two lines whose carriers cross ahead of both ends are
 * carried on to the crossing; anything else gets a straight bridge, a free
 * line coincident with both ends. Returns how many gaps were closed.
 */
export function closeChain(sketch: Sketch, order: readonly PlacedSegment[], gap = CORNER_GAP_MM): number {
  if (order.length === 0) return 0
  let closedGaps = 0
  // Every neighbouring pair, and the chain's two ends.
  const pairs = consecutive(order, true)
  for (const [p, q] of pairs) {
    if (alreadyJoined(sketch, p, q)) continue
    const ea = entityOf(sketch, p.entity)
    const eb = entityOf(sketch, q.entity)
    if (!ea || !eb) continue
    const pa = anchorPoint(ea, p.at)
    const pb = anchorPoint(eb, q.at)
    const d = len2(sub2(pa, pb))
    if (d <= gap) {
      joinEnds(sketch, p, q, gap)
      closedGaps++
      continue
    }
    if (ea.kind === 'line' && eb.kind === 'line') {
      const x = lineIntersection(ea, eb)
      // Ahead of both ends: carrying a line on means past the end it
      // stops at, not back through itself.
      if (x && ahead(ea, p.at, x) && ahead(eb, q.at, x)) {
        moveAnchor(ea, p.at, x)
        moveAnchor(eb, q.at, x)
        addConstraint(sketch, { kind: 'coincident', p, q })
        closedGaps++
        continue
      }
    }
    // A straight bridge.
    const id = addEntity(sketch, { kind: 'line', a: pa, b: pb } as Omit<SketchLine, 'id'>)
    addConstraint(sketch, { kind: 'coincident', p, q: { entity: id, at: 'a' } })
    addConstraint(sketch, { kind: 'coincident', p: { entity: id, at: 'b' }, q })
    closedGaps++
  }
  return closedGaps
}

/** Whether `x` lies past the given end of the line, looking out from the
 *  other end — so the line reaches it by growing, not by turning back. */
function ahead(l: SketchLine, at: AnchorAt, x: Vec2): boolean {
  const from = at === 'a' ? l.b : l.a
  const to = at === 'a' ? l.a : l.b
  const d = sub2(to, from)
  const ll = dot2(d, d)
  if (ll < 1e-12) return true
  return dot2(sub2(x, from), d) / ll >= 0.5
}

/**
 * Make a corner sharp: the fillet arc — or the chamfer's line — between two
 * lines is removed and the lines carried on to their intersection. Returns
 * false when the piece does not stand between two lines that cross.
 */
export function sharpenCorner(sketch: Sketch, arcId: number): boolean {
  const arc = entityOf(sketch, arcId)
  if (!arc || (arc.kind !== 'arc' && arc.kind !== 'line')) return false
  // The lines coincident with the arc's two ends.
  const neighbour = (at: AnchorAt): { line: SketchLine; end: AnchorAt } | null => {
    for (const c of sketch.constraints) {
      if (c.kind !== 'coincident') continue
      const other =
        c.p.entity === arcId && c.p.at === at ? c.q : c.q.entity === arcId && c.q.at === at ? c.p : null
      if (!other) continue
      const e = entityOf(sketch, other.entity)
      if (e?.kind === 'line') return { line: e, end: other.at }
    }
    return null
  }
  const na = neighbour('a')
  const nb = neighbour('b')
  if (!na || !nb || na.line.id === nb.line.id) return false
  const x = lineIntersection(na.line, nb.line)
  if (!x) return false
  moveAnchor(na.line, na.end, x)
  moveAnchor(nb.line, nb.end, x)
  sketch.entities = sketch.entities.filter((e) => e.id !== arcId)
  sketch.constraints = sketch.constraints.filter((c) => !constraintEntities(c).includes(arcId))
  addConstraint(sketch, {
    kind: 'coincident',
    p: { entity: na.line.id, at: na.end },
    q: { entity: nb.line.id, at: nb.end },
  })
  return true
}

/** An end of a sketch's outline that meets nothing, and the end of another
 *  piece nearest it — see openEnds. */
export interface OpenEnd {
  piece: number
  end: 'a' | 'b'
  at: Vec2
  /** The open end of another piece nearest it, or a joined end only within
   *  a near miss; null when there is neither. */
  nearest: { piece: number; end: 'a' | 'b' } | null
  /** How far that is, mm. */
  gap: number | null
}

/** How near an open end must lie to a joined end to be named as missing it, mm. */
const JOINED_MISS_MM = 1

/**
 * The ends of a sketch's outline that meet nothing — no other end within
 * `touch` (the distance a region closes across), no piece running through
 * them — each with the end of another piece nearest it and the gap, the
 * smallest gaps first: what a sketch that closes no region is told, so a
 * miss of microns is seen as one rather than as no region at all.
 * Construction pieces are no outline and are left out.
 */
export function openEnds(sketch: Pick<Sketch, 'entities'>, touch = TOUCH_MM): OpenEnd[] {
  const outline = sketch.entities.filter((e) => !e.construction && e.kind !== 'point')
  const ends = outline.flatMap((e) => (e.kind === 'line' || e.kind === 'arc' ? (['a', 'b'] as const).map((end) => ({ piece: e.id, end, at: anchorPoint(e, end) })) : []))
  const meets = (p: (typeof ends)[number]) => ends.some((q) => q !== p && len2(sub2(q.at, p.at)) <= touch) || outline.some((e) => e.id !== p.piece && nearestOnEntity(e, p.at).dist <= touch)
  const out: OpenEnd[] = []
  for (const p of ends) {
    if (meets(p)) continue
    let nearest: (typeof ends)[number] | null = null
    let gap = Infinity
    for (const q of ends) {
      if (q.piece === p.piece) continue
      const d = len2(sub2(q.at, p.at))
      // A joined end is nowhere to close to, unless this end all but reaches it.
      if (d > JOINED_MISS_MM && meets(q)) continue
      if (d < gap) {
        gap = d
        nearest = q
      }
    }
    out.push({ piece: p.piece, end: p.end, at: p.at, nearest: nearest && { piece: nearest.piece, end: nearest.end }, gap: nearest ? gap : null })
  }
  return out.sort((x, y) => (x.gap ?? Infinity) - (y.gap ?? Infinity))
}
