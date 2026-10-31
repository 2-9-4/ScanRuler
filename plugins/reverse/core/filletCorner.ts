// SPDX-License-Identifier: AGPL-3.0-only
// A corner of the sketch made round: two lines cut back to where an arc of
// the asked radius touches them, the arc put between, held to both with a
// coincidence and a tangency, and its radius made a dimension — so the round
// is a number to type, as CAD's sketch fillet is. The opposite of
// sharpenCorner (corners.ts), which reads the same four relations to take a
// round out again.
//
// The two lines need not meet yet. A fit often leaves a corner as a short
// chord across the round, or the operator has deleted that chord and the two
// ends stand off the corner: the round then starts from where the ends are —
// a chord cut where the blend begins is as good a first radius as the scan
// offers — and a piece that bridged the two ends is replaced by the arc.
//
// A chamfer is the same cut with a straight piece put across (chamferLines).

import type { Vec2 } from '../../../src/core/flat/types'
import { add2, dot2, len2, normalize2, perp2, scale2, sub2 } from '../../../src/core/flat/vec2'
import { lineIntersection } from './corners'
import { nominalOf } from './nominal'
import { addConstraint, addEntity, entityOf, lineDir, removeEntities, type Anchor, type AnchorAt, type DimPlace, type Sketch, type SketchLine } from './sketch'

export interface FilletResult {
  /** The arc put in, and the radius dimension on it. */
  arc: number
  dimension: number
  radius: number
}

/** An end counts as at the corner within this, millimetres. */
const AT_CORNER_MM = 1e-6
/** The share of the shorter line a round with no radius to go by takes. */
const DEFAULT_SHARE = 0.25

function sameAnchor(a: Anchor, b: Anchor): boolean {
  return a.entity === b.entity && a.at === b.at
}

/** The anchors held coincident with `p`, directly. */
function joinedTo(sketch: Sketch, p: Anchor): Anchor[] {
  const out: Anchor[] = []
  for (const c of sketch.constraints) {
    if (c.kind !== 'coincident') continue
    if (sameAnchor(c.p, p)) out.push(c.q)
    else if (sameAnchor(c.q, p)) out.push(c.p)
  }
  return out
}

/** The piece whose two ends are joined to the two given ends — the chord a
 *  fit left across the corner — or null. */
function bridgeBetween(sketch: Sketch, p: Anchor, q: Anchor): number | null {
  for (const j of joinedTo(sketch, p)) {
    if (j.entity === q.entity || (j.at !== 'a' && j.at !== 'b')) continue
    const other: Anchor = { entity: j.entity, at: j.at === 'a' ? 'b' : 'a' }
    if (joinedTo(sketch, other).some((x) => sameAnchor(x, q))) return j.entity
  }
  return null
}

/** The two lines that meet at an end — the end's own and the one joined to
 *  it there — or null when the end is not a corner between two lines. */
export function cornerLinesAt(sketch: Sketch, p: Anchor): [number, number] | null {
  const own = entityOf(sketch, p.entity)
  if (!own || own.kind !== 'line' || p.at === 'center') return null
  for (const j of joinedTo(sketch, p)) {
    const e = entityOf(sketch, j.entity)
    if (e?.kind === 'line' && e.id !== own.id && j.at !== 'center') return [own.id, e.id]
  }
  return null
}

/**
 * Round the corner between two lines. `radius` is the one asked for; without
 * it the round takes the radius the standing-off ends suggest, or a quarter
 * of the shorter line. Returns what was made, or in words why nothing was.
 * `room` is how far along each line the round may touch, where the caller
 * knows better than the lines as they now stand — a shape rounding all its
 * corners measures it on the sides before the first one was cut back.
 */
export function filletLines(sketch: Sketch, idA: number, idB: number, radius?: number, room?: number): FilletResult | string {
  const la = entityOf(sketch, idA)
  const lb = entityOf(sketch, idB)
  if (!la || !lb || la.kind !== 'line' || lb.kind !== 'line' || la.id === lb.id) return 'A round goes between two lines.'
  if (la.projected || lb.projected) return 'A projected piece stays as the part made it — it cannot be cut back for a round.'
  const x = lineIntersection(la, lb)
  if (!x) return 'The two lines are parallel — no round fits between them.'

  // Each line seen from the corner: the end that is cut back, the end that
  // stays, and the way the line runs from the corner.
  const seen = (l: SketchLine) => {
    const near: AnchorAt = len2(sub2(l.a, x)) <= len2(sub2(l.b, x)) ? 'a' : 'b'
    const nearP = near === 'a' ? l.a : l.b
    const farP = near === 'a' ? l.b : l.a
    const dir = normalize2(sub2(farP, x))
    return dir ? { near, dir, off: dot2(sub2(nearP, x), dir), reach: len2(sub2(farP, x)) } : null
  }
  const a = seen(la)
  const b = seen(lb)
  if (!a || !b) return 'A line ends on the corner itself — there is nothing of it to round into.'
  const half = Math.acos(Math.max(-1, Math.min(1, dot2(a.dir, b.dir)))) / 2
  const tanHalf = Math.tan(half)
  const bisector = normalize2(add2(a.dir, b.dir))
  if (!(tanHalf > 1e-6) || !Number.isFinite(tanHalf) || !bisector) return 'The two lines run on in one line — there is no corner to round.'

  // How far from the corner the round touches the lines.
  const fits = room ?? 0.95 * Math.min(a.reach, b.reach)
  let touch: number
  if (radius !== undefined) {
    if (!(radius > 0)) return 'A round needs a radius above zero.'
    touch = radius / tanHalf
    // units-ok: only a command's size reaches this; the sketch editor retries without one
    if (touch > fits) return `A round of ${radius} mm does not fit on these lines.`
  } else {
    const standOff = (Math.max(0, a.off) + Math.max(0, b.off)) / 2
    if (standOff > AT_CORNER_MM) touch = Math.min(standOff, fits)
    else {
      const guess = DEFAULT_SHARE * Math.min(a.reach, b.reach) * tanHalf
      touch = Math.min((nominalOf(guess, 'radius') ?? guess) / tanHalf, fits)
    }
  }
  const r = touch * tanHalf

  const endA: Anchor = { entity: la.id, at: a.near }
  const endB: Anchor = { entity: lb.id, at: b.near }
  const bridge = bridgeBetween(sketch, endA, endB)
  if (bridge !== null) removeEntities(sketch, [bridge])
  // The join that made the corner sharp goes; the arc takes its place.
  sketch.constraints = sketch.constraints.filter(
    (c) => !(c.kind === 'coincident' && ((sameAnchor(c.p, endA) && sameAnchor(c.q, endB)) || (sameAnchor(c.p, endB) && sameAnchor(c.q, endA)))),
  )

  const ta = add2(x, scale2(a.dir, touch))
  const tb = add2(x, scale2(b.dir, touch))
  const c = add2(x, scale2(bisector, r / Math.sin(half)))
  const put = (l: SketchLine, at: AnchorAt, p: Vec2) => {
    if (at === 'a') l.a = [p[0], p[1]]
    else l.b = [p[0], p[1]]
  }
  put(la, a.near, ta)
  put(lb, b.near, tb)

  // Counter-clockwise the short way round, from whichever tangent point
  // that starts at.
  const angA = Math.atan2(ta[1] - c[1], ta[0] - c[0])
  const angB = Math.atan2(tb[1] - c[1], tb[0] - c[0])
  let sweep = angB - angA
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep <= -Math.PI) sweep += 2 * Math.PI
  const fromA = sweep > 0
  const arc = addEntity(sketch, { kind: 'arc', c, r, start: fromA ? angA : angB, sweep: Math.abs(sweep) })
  addConstraint(sketch, { kind: 'coincident', p: endA, q: { entity: arc, at: fromA ? 'a' : 'b' } })
  addConstraint(sketch, { kind: 'coincident', p: endB, q: { entity: arc, at: fromA ? 'b' : 'a' } })
  addConstraint(sketch, { kind: 'tangent', a: la.id, b: arc })
  addConstraint(sketch, { kind: 'tangent', a: lb.id, b: arc })
  const dimension = addConstraint(sketch, { kind: 'radius', entity: arc, value: r })
  return { arc, dimension, radius: r }
}

export interface ChamferResult {
  /** The line put across the corner, and the two dimensions that hold it:
   *  how far each of its ends stands off the other line of the corner. */
  line: number
  dimensions: [number, number]
  /** How far along each line the corner was cut back. */
  setback: number
}

/**
 * Cut the corner between two lines off with a straight piece. `setback` is
 * how far along each line the cut starts; without it the standing-off ends
 * say, or a quarter of the shorter line. The piece is held by two
 * dimensions, each from one of its ends to the other line of the corner —
 * on a square corner both read the setback itself, the 2 × 2 a drawing
 * carries, and typing over one makes the chamfer an uneven one. Returns what
 * was made, or in words why nothing was.
 */
export function chamferLines(sketch: Sketch, idA: number, idB: number, setback?: number): ChamferResult | string {
  const la = entityOf(sketch, idA)
  const lb = entityOf(sketch, idB)
  if (!la || !lb || la.kind !== 'line' || lb.kind !== 'line' || la.id === lb.id) return 'A chamfer goes between two lines.'
  if (la.projected || lb.projected) return 'A projected piece stays as the part made it — it cannot be cut back for a chamfer.'
  const x = lineIntersection(la, lb)
  if (!x) return 'The two lines are parallel — no chamfer fits between them.'

  const seen = (l: SketchLine) => {
    const near: AnchorAt = len2(sub2(l.a, x)) <= len2(sub2(l.b, x)) ? 'a' : 'b'
    const nearP = near === 'a' ? l.a : l.b
    const farP = near === 'a' ? l.b : l.a
    const dir = normalize2(sub2(farP, x))
    return dir ? { near, dir, off: dot2(sub2(nearP, x), dir), reach: len2(sub2(farP, x)) } : null
  }
  const a = seen(la)
  const b = seen(lb)
  if (!a || !b) return 'A line ends on the corner itself — there is nothing of it to cut back.'
  const sin = Math.abs(a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0])
  if (!(sin > 1e-6)) return 'The two lines run on in one line — there is no corner to chamfer.'

  const room = 0.95 * Math.min(a.reach, b.reach)
  let cut: number
  if (setback !== undefined) {
    if (!(setback > 0)) return 'A chamfer needs a distance above zero.'
    // units-ok: only a command's size reaches this; the sketch editor retries without one
    if (setback > room) return `A chamfer of ${setback} mm does not fit on these lines.`
    cut = setback
  } else {
    const standOff = (Math.max(0, a.off) + Math.max(0, b.off)) / 2
    if (standOff > AT_CORNER_MM) cut = Math.min(standOff, room)
    else {
      const guess = DEFAULT_SHARE * Math.min(a.reach, b.reach)
      cut = Math.min(nominalOf(guess, 'length') ?? guess, room)
    }
  }

  const endA: Anchor = { entity: la.id, at: a.near }
  const endB: Anchor = { entity: lb.id, at: b.near }
  const bridge = bridgeBetween(sketch, endA, endB)
  if (bridge !== null) removeEntities(sketch, [bridge])
  sketch.constraints = sketch.constraints.filter(
    (c) => !(c.kind === 'coincident' && ((sameAnchor(c.p, endA) && sameAnchor(c.q, endB)) || (sameAnchor(c.p, endB) && sameAnchor(c.q, endA)))),
  )

  const ta = add2(x, scale2(a.dir, cut))
  const tb = add2(x, scale2(b.dir, cut))
  if (a.near === 'a') la.a = [ta[0], ta[1]]
  else la.b = [ta[0], ta[1]]
  if (b.near === 'a') lb.a = [tb[0], tb[1]]
  else lb.b = [tb[0], tb[1]]

  const line = addEntity(sketch, { kind: 'line', a: [ta[0], ta[1]], b: [tb[0], tb[1]] })
  addConstraint(sketch, { kind: 'coincident', p: endA, q: { entity: line, at: 'a' } })
  addConstraint(sketch, { kind: 'coincident', p: endB, q: { entity: line, at: 'b' } })
  // Each distance is written outside the corner, clear of the pieces: its
  // line stood off the measured stretch, away from the other line's run.
  const outside = (from: Vec2, onto: SketchLine, run: Vec2): DimPlace | undefined => {
    const n = perp2(lineDir(onto) ?? [1, 0])
    const d = normalize2(scale2(n, -dot2(sub2(from, onto.a), n)))
    if (!d) return undefined
    return { off: -Math.sign(dot2(run, perp2(d)) || 1) * cut, along: 0 }
  }
  const first = addConstraint(sketch, { kind: 'distance', p: { entity: line, at: 'a' }, q: { line: lb.id }, value: cut * sin, place: outside(ta, lb, b.dir) })
  const second = addConstraint(sketch, { kind: 'distance', p: { entity: line, at: 'b' }, q: { line: la.id }, value: cut * sin, place: outside(tb, la, a.dir) })
  return { line, dimensions: [first, second], setback: cut }
}
