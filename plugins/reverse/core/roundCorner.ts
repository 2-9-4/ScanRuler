// SPDX-License-Identifier: AGPL-3.0-only
// A corner of a fitted sketch made round where the scan is round: an arc
// tangent to two pieces — lines or arcs, in any pair — the pieces cut back
// to where it touches them, held to both by coincidences and tangencies.
// With a radius the round is that radius, a dimension. Without one it is
// the scan's: the slice points about the corner that the two pieces carried
// (a segmenter that missed the round merged them in) move onto the arc, and
// the solver fits it to them with the tangencies held — "this corner is a
// tangent blend", said once, and ScanRuler finds how large.
//
// filletLines (filletCorner.ts) is the panel's sketch fillet for two lines,
// a radius typed; this is the agent's, for the pieces a fit leaves, read off
// the scan.

import type { Vec2 } from '../../../src/core/flat/types'
import { add2, dot2, len2, normalize2, perp2, scale2, sub2 } from '../../../src/core/flat/vec2'
import { addConstraint, addEntity, anchorPoint, arcAngleOf, type Anchor, type AnchorAt, entityOf, nearestOnEntity, removeEntities, type Sketch, type SketchArc, type SketchEntity, type SketchLine, unwindAngle } from './sketch'

export interface RoundCorner {
  /** The arc put in, and the radius dimension on it when one was asked. */
  arc: number
  dimension?: number
  /** The radius it was put in at — the solve may move it. */
  radius: number
  /** How many slice points moved onto the arc. */
  points: number
  /** Without a radius given, what the points said of it: `read`, a round
   *  found among them; `limit`, the best fit at either end of the radii
   *  searched — the points hold no round, only a sharp corner or a stray;
   *  `none`, too few points off the two pieces to search, the radius a
   *  guess from the pieces' size. */
  found?: 'read' | 'limit' | 'none'
}

type Piece = SketchLine | SketchArc

/** An end counts as joined to another within this, millimetres. */
const JOIN_MM = 1e-6

/** The anchors held coincident with `p`, directly. */
function joinedTo(sketch: Sketch, p: Anchor): Anchor[] {
  const out: Anchor[] = []
  for (const c of sketch.constraints) {
    if (c.kind !== 'coincident') continue
    if (c.p.entity === p.entity && c.p.at === p.at) out.push(c.q)
    else if (c.q.entity === p.entity && c.q.at === p.at) out.push(c.p)
  }
  return out
}

/** A piece seen from the corner: the end that is cut back, and the way the
 *  piece runs away from the corner there. */
interface Seen {
  piece: Piece
  near: AnchorAt
  at: Vec2
  dir: Vec2
}

function seen(piece: Piece, near: AnchorAt): Seen | null {
  const at = anchorPoint(piece, near)
  let dir: Vec2 | null
  if (piece.kind === 'line') dir = normalize2(sub2(anchorPoint(piece, near === 'a' ? 'b' : 'a'), at))
  else {
    // An arc runs counter-clockwise from a: at a it heads along the
    // tangent ccw, at b back clockwise.
    const radial = normalize2(sub2(at, piece.c))
    dir = radial ? (near === 'a' ? perp2(radial) : scale2(perp2(radial), -1)) : null
  }
  return dir ? { piece, near, at, dir } : null
}

/** The ends of `a` and `b` that make the corner: the pair held coincident,
 *  else the nearest pair. */
function cornerEnds(sketch: Sketch, a: Piece, b: Piece): [AnchorAt, AnchorAt] {
  for (const ea of ['a', 'b'] as const) for (const j of joinedTo(sketch, { entity: a.id, at: ea })) if (j.entity === b.id && (j.at === 'a' || j.at === 'b')) return [ea, j.at]
  let best: [AnchorAt, AnchorAt] = ['a', 'a']
  let d = Infinity
  for (const ea of ['a', 'b'] as const) {
    for (const eb of ['a', 'b'] as const) {
      const dd = len2(sub2(anchorPoint(a, ea), anchorPoint(b, eb)))
      if (dd < d) {
        d = dd
        best = [ea, eb]
      }
    }
  }
  return best
}

/** The centre of the circle of radius r tangent to a piece's carrier on the
 *  corner's inside: offset curves met. A line's offset is a line; an arc's
 *  a circle r nearer its centre or farther, as the inside lies. */
type Offset = { kind: 'line'; p: Vec2; d: Vec2 } | { kind: 'circle'; c: Vec2; r: number }

function offsetOf(s: Seen, other: Seen, r: number): Offset | null {
  // The inside of the corner from this piece: the side the other runs to.
  if (s.piece.kind === 'line') {
    const n = perp2(s.dir)
    const side = dot2(n, other.dir) >= 0 ? 1 : -1
    return { kind: 'line', p: add2(s.at, scale2(n, side * r)), d: s.dir }
  }
  const arc = s.piece
  const towardCentre = normalize2(sub2(arc.c, s.at))
  if (!towardCentre) return null
  const inward = dot2(towardCentre, other.dir) >= 0
  const R = inward ? arc.r - r : arc.r + r
  return R > 0 ? { kind: 'circle', c: arc.c, r: R } : null
}

function meet(a: Offset, b: Offset): Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const den = a.d[0] * b.d[1] - a.d[1] * b.d[0]
    if (Math.abs(den) < 1e-12) return []
    const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den
    return [add2(a.p, scale2(a.d, t))]
  }
  if (a.kind === 'circle' && b.kind === 'line') return meet(b, a)
  if (a.kind === 'line' && b.kind === 'circle') {
    const f = sub2(a.p, b.c)
    const B = dot2(f, a.d)
    const C = dot2(f, f) - b.r * b.r
    const disc = B * B - C
    if (disc < 0) return []
    const q = Math.sqrt(disc)
    return [add2(a.p, scale2(a.d, -B - q)), add2(a.p, scale2(a.d, -B + q))]
  }
  const ca = a as { c: Vec2; r: number }
  const cb = b as { c: Vec2; r: number }
  const dv = sub2(cb.c, ca.c)
  const d = len2(dv)
  if (d < 1e-12 || d > ca.r + cb.r || d < Math.abs(ca.r - cb.r)) return []
  const x = (d * d + ca.r * ca.r - cb.r * cb.r) / (2 * d)
  const h = Math.sqrt(Math.max(0, ca.r * ca.r - x * x))
  const u = scale2(dv, 1 / d)
  const m = add2(ca.c, scale2(u, x))
  const n = perp2(u)
  return [add2(m, scale2(n, h)), add2(m, scale2(n, -h))]
}

/** Where a circle centred `c` touches a piece's carrier. */
function touchOn(piece: Piece, c: Vec2): Vec2 {
  if (piece.kind === 'line') {
    const d = normalize2(sub2(piece.b, piece.a))!
    return add2(piece.a, scale2(d, dot2(sub2(c, piece.a), d)))
  }
  const u = normalize2(sub2(c, piece.c)) ?? [1, 0]
  return add2(piece.c, scale2(u, piece.r))
}

/** The round of radius r between the two pieces as they stand: its centre
 *  and the two tangent points — the candidate nearest the corner, on the
 *  pieces' kept side of each tangent point — or null. */
function tangentCircle(a: Seen, b: Seen, corner: Vec2, r: number): { c: Vec2; ta: Vec2; tb: Vec2 } | null {
  const oa = offsetOf(a, b, r)
  const ob = offsetOf(b, a, r)
  if (!oa || !ob) return null
  let best: { c: Vec2; ta: Vec2; tb: Vec2 } | null = null
  let d = Infinity
  for (const c of meet(oa, ob)) {
    const ta = touchOn(a.piece, c)
    const tb = touchOn(b.piece, c)
    const dd = len2(sub2(c, corner))
    if (dd < d) {
      d = dd
      best = { c, ta, tb }
    }
  }
  return best
}

/** The corner itself: where the two pieces' ends meet, or the middle of
 *  the gap between them. */
const cornerOf = (a: Seen, b: Seen): Vec2 => scale2(add2(a.at, b.at), 0.5)

/** A piece cut back so that its near end lands at `p`. */
function trimTo(s: Seen, p: Vec2): void {
  const piece = s.piece
  if (piece.kind === 'line') {
    if (s.near === 'a') piece.a = [p[0], p[1]]
    else piece.b = [p[0], p[1]]
    return
  }
  const end = piece.start + piece.sweep
  const angle = arcAngleOf(piece, p)
  if (s.near === 'a') {
    const start = unwindAngle(angle, end - 2 * Math.PI)
    piece.sweep = end - start
    piece.start = start
  } else piece.sweep = unwindAngle(angle, piece.start) - piece.start
}

/** The arc from tangent point ta to tb the short way round about c, as a
 *  sketch arc (counter-clockwise from its a). */
function shortArc(c: Vec2, r: number, ta: Vec2, tb: Vec2): { start: number; sweep: number; fromA: boolean } {
  const angA = Math.atan2(ta[1] - c[1], ta[0] - c[0])
  const angB = Math.atan2(tb[1] - c[1], tb[0] - c[0])
  let sweep = angB - angA
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep <= -Math.PI) sweep += 2 * Math.PI
  const fromA = sweep > 0
  void r
  return { start: fromA ? angA : angB, sweep: Math.abs(sweep), fromA }
}

/** The radius the slice points about the corner suggest: the points of
 *  either piece within `window` of the corner that stand off their own
 *  piece by over three scatters — the round's — and the tangent circle
 *  whose arc they lie nearest, searched over the radii that fit — and
 *  whether the best lay at either end of the search, which is no reading. */
function radiusFromPoints(a: Seen, b: Seen, corner: Vec2, window: number, scatter: number): { r: number; atLimit: boolean } | null {
  const pts: Vec2[] = []
  let off = 0
  for (const s of [a, b]) {
    for (const p of s.piece.points ?? []) {
      if (len2(sub2(p, corner)) > window) continue
      pts.push(p)
      if (nearestOnEntity(s.piece, p).dist > 3 * scatter) off++
    }
  }
  if (off < 3) return null
  const cost = (r: number): number => {
    const t = tangentCircle(a, b, corner, r)
    if (!t) return Infinity
    let sum = 0
    for (const p of pts) {
      const onArc = Math.abs(len2(sub2(p, t.c)) - r)
      const onA = distToRay(p, t.ta, a)
      const onB = distToRay(p, t.tb, b)
      const d = Math.min(onArc, onA, onB, 5 * scatter)
      sum += d * d
    }
    return sum
  }
  let best: number | null = null
  let at = -1
  let bestCost = Infinity
  const lo = Math.max(scatter, 0.02)
  const hi = window
  for (let i = 0; i <= RADIUS_STEPS; i++) {
    const r = lo * Math.pow(hi / lo, i / RADIUS_STEPS)
    const c = cost(r)
    if (c < bestCost) {
      bestCost = c
      best = r
      at = i
    }
  }
  return best === null ? null : { r: best, atLimit: at === 0 || at === RADIUS_STEPS }
}

/** How many radii the search tries, from the scatter (0.02 mm at least)
 *  to the room the pieces leave, evenly on a log scale. */
const RADIUS_STEPS = 120

/** Distance from p to a piece's kept part from tangent point t on. */
function distToRay(p: Vec2, t: Vec2, s: Seen): number {
  if (s.piece.kind === 'line') {
    const along = Math.max(0, dot2(sub2(p, t), s.dir))
    return len2(sub2(p, add2(t, scale2(s.dir, along))))
  }
  return Math.abs(len2(sub2(p, s.piece.c)) - s.piece.r)
}

/**
 * Round the corner between pieces `idA` and `idB` of a sketch. Returns what
 * was made, or in words why nothing was. The sketch is changed in place;
 * solve it after.
 */
export function roundCorner(sketch: Sketch, idA: number, idB: number, radius?: number): RoundCorner | string {
  const pa = entityOf(sketch, idA)
  const pb = entityOf(sketch, idB)
  const kinds = (e: SketchEntity | undefined): e is Piece => e?.kind === 'line' || e?.kind === 'arc'
  if (!kinds(pa) || !kinds(pb) || pa.id === pb.id) return `A round goes between two lines or arcs — ${idA} and ${idB} are not.`
  if (pa.projected || pb.projected) return 'A projected piece stays as the part made it — it cannot be cut back for a round.'
  if (radius !== undefined && !(radius > 0)) return 'A round needs a radius above zero.'
  // Nothing of the scan to read a radius from: pieces drawn, or moved in
  // by an inset, which lets their points go (the scan's are the other
  // skin's).
  if (radius === undefined && !pa.points?.length && !pb.points?.length) return `Pieces ${idA} and ${idB} carry no slice points — drawn, or moved by an inset, which lets them go — so the scan’s round is not there to read: give radius.`
  const [ea, eb] = cornerEnds(sketch, pa, pb)
  const a = seen(pa, ea)
  const b = seen(pb, eb)
  if (!a || !b) return 'A piece is too short to round into.'
  const corner = cornerOf(a, b)
  const reach = (s: Seen) => (s.piece.kind === 'line' ? len2(sub2(s.piece.a, s.piece.b)) : s.piece.r * s.piece.sweep)
  const room = 0.95 * Math.min(reach(a), reach(b))
  const scatter = Math.max(pa.scatter ?? 0, pb.scatter ?? 0, 0.01)

  let r = radius
  let found: RoundCorner['found']
  if (r === undefined) {
    const read = radiusFromPoints(a, b, corner, room, scatter)
    r = read?.r
    found = read ? (read.atLimit ? 'limit' : 'read') : 'none'
    if (r === undefined) {
      // No round shows in the points: a quarter of the shorter piece, or
      // the gap the ends stand apart by.
      const gap = len2(sub2(a.at, b.at))
      r = gap > JOIN_MM ? gap / 2 : 0.25 * room
    }
  }
  const t = tangentCircle(a, b, corner, r)
  // units-ok: a command's answer only
  if (!t) return `No round of ${r.toPrecision(3)} mm is tangent to both pieces here.`
  // The tangent points must lie on the pieces, not past their far ends.
  // units-ok: a command's answer only
  if (len2(sub2(t.ta, corner)) > room + len2(sub2(a.at, corner)) || len2(sub2(t.tb, corner)) > room + len2(sub2(b.at, corner))) return `A round of ${r.toPrecision(3)} mm does not fit on these pieces.`

  // The join that made the corner sharp goes, and a piece bridging the two
  // ends (a chord a fit left) — its points go to the round.
  const endA: Anchor = { entity: pa.id, at: ea }
  const endB: Anchor = { entity: pb.id, at: eb }
  const moved: Vec2[] = []
  for (const j of joinedTo(sketch, endA)) {
    if (j.entity === pb.id || (j.at !== 'a' && j.at !== 'b')) continue
    const other: Anchor = { entity: j.entity, at: j.at === 'a' ? 'b' : 'a' }
    if (joinedTo(sketch, other).some((x) => x.entity === endB.entity && x.at === endB.at)) {
      const bridge = entityOf(sketch, j.entity)
      if (bridge && 'points' in bridge && bridge.points) moved.push(...bridge.points)
      removeEntities(sketch, [j.entity])
      break
    }
  }
  sketch.constraints = sketch.constraints.filter(
    (c) => !(c.kind === 'coincident' && ((c.p.entity === endA.entity && c.p.at === endA.at && c.q.entity === endB.entity && c.q.at === endB.at) || (c.p.entity === endB.entity && c.p.at === endB.at && c.q.entity === endA.entity && c.q.at === endA.at))),
  )
  trimTo(a, t.ta)
  trimTo(b, t.tb)
  const arcShape = shortArc(t.c, r, t.ta, t.tb)
  const arcId = addEntity(sketch, { kind: 'arc', c: t.c, r, start: arcShape.start, sweep: arcShape.sweep })
  addConstraint(sketch, { kind: 'coincident', p: endA, q: { entity: arcId, at: arcShape.fromA ? 'a' : 'b' } })
  addConstraint(sketch, { kind: 'coincident', p: endB, q: { entity: arcId, at: arcShape.fromA ? 'b' : 'a' } })
  addConstraint(sketch, { kind: 'tangent', a: pa.id, b: arcId })
  addConstraint(sketch, { kind: 'tangent', a: pb.id, b: arcId })
  const arc = entityOf(sketch, arcId) as SketchArc
  if (radius !== undefined) {
    const dimension = addConstraint(sketch, { kind: 'radius', entity: arcId, value: radius })
    return { arc: arcId, dimension, radius, points: 0 }
  }
  // The scan's round: the points nearer the arc than their own piece go to
  // it, the bridge's with them.
  arc.points = moved
  arc.scatter = scatter
  reassignCornerPoints(sketch, pa.id, pb.id, arcId)
  if ((arc.points?.length ?? 0) < 3) {
    // Too few points to fit: held at the radius found, said so.
    const dimension = addConstraint(sketch, { kind: 'radius', entity: arcId, value: r })
    return { arc: arcId, dimension, radius: r, points: arc.points?.length ?? 0, found }
  }
  return { arc: arcId, radius: r, points: arc.points!.length, found }
}

/** Why a round's radius is no reading of the scan, in words — or null for
 *  one that is: under three points on the arc, or a search that found its
 *  best at either end of the radii it tried, or found nothing to search. */
export function roundUnread(points: number, found: RoundCorner['found']): string | null {
  if (found === undefined) return null
  const fix = 'give radius, or re-fit the corner so its pieces carry its slice points'
  if (points < 3) return `${points} point${points === 1 ? '' : 's'} on the round — radius not read; ${fix}`
  if (found === 'limit') return `the points fit best at the end of the radii searched — radius not read; ${fix}`
  if (found === 'none') return `no round shows in the points about the corner — radius not read; ${fix}`
  return null
}

/** The slice points of the two pieces and the round between them shared
 *  out again by which each now lies nearest — after a solve has moved the
 *  tangent points. Returns how many changed hands. */
export function reassignCornerPoints(sketch: Sketch, idA: number, idB: number, arcId: number): number {
  const ids = [idA, idB, arcId]
  const pieces = ids.map((id) => entityOf(sketch, id)).filter((e): e is Piece => e?.kind === 'line' || e?.kind === 'arc')
  if (pieces.length !== 3) return 0
  const all: { p: Vec2; from: number }[] = []
  for (const piece of pieces) for (const p of piece.points ?? []) all.push({ p, from: piece.id })
  const out = new Map<number, Vec2[]>(pieces.map((x) => [x.id, []]))
  let changed = 0
  for (const { p, from } of all) {
    let best = from
    let d = Infinity
    for (const piece of pieces) {
      const dd = nearestOnEntity(piece, p).dist
      if (dd < d - 1e-9) {
        d = dd
        best = piece.id
      }
    }
    if (best !== from) changed++
    out.get(best)!.push(p)
  }
  for (const piece of pieces) {
    const pts = out.get(piece.id)!
    if (pts.length > 0 || piece.points) piece.points = pts
  }
  return changed
}

/** How well the slice points pin a round's radius with the round held
 *  tangent to its two pieces as they stand: the points' scatter over the
 *  root of their summed squared sensitivity to the radius, the sensitivity
 *  taken by building the tangent round a hair larger and smaller. Null
 *  where the round has too few points. */
export function roundRadiusSigma(sketch: Sketch, idA: number, idB: number, arcId: number): number | null {
  const pa = entityOf(sketch, idA)
  const pb = entityOf(sketch, idB)
  const arc = entityOf(sketch, arcId)
  if (!(pa?.kind === 'line' || pa?.kind === 'arc') || !(pb?.kind === 'line' || pb?.kind === 'arc') || arc?.kind !== 'arc') return null
  const pts = arc.points ?? []
  if (pts.length < 3) return null
  // The pieces seen from the round's ends.
  const ends = (piece: Piece): AnchorAt => {
    const a = len2(sub2(anchorPoint(piece, 'a'), arc.c)) - arc.r
    const b = len2(sub2(anchorPoint(piece, 'b'), arc.c)) - arc.r
    return Math.abs(a) <= Math.abs(b) ? 'a' : 'b'
  }
  const sa = seen(pa, ends(pa))
  const sb = seen(pb, ends(pb))
  if (!sa || !sb) return null
  const corner = cornerOf(sa, sb)
  const h = Math.max(1e-4, arc.r * 1e-3)
  const up = tangentCircle(sa, sb, corner, arc.r + h)
  const down = tangentCircle(sa, sb, corner, arc.r - h)
  if (!up || !down) return null
  let jj = 0
  let ss = 0
  for (const p of pts) {
    const res = (c: Vec2, r: number) => len2(sub2(p, c)) - r
    const j = (res(up.c, arc.r + h) - res(down.c, arc.r - h)) / (2 * h)
    jj += j * j
    const e = res(arc.c, arc.r)
    ss += e * e
  }
  const n = pts.length
  const scatter = Math.max(Math.sqrt(ss / Math.max(1, n - 1)), arc.scatter ?? 0)
  return jj > 1e-12 ? scatter / Math.sqrt(jj) : null
}
