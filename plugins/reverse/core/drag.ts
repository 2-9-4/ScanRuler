// SPDX-License-Identifier: AGPL-3.0-only
// Moving the pieces of a sketch by hand: an end or a centre dragged to a
// new spot, a whole piece carried along, and the sketch turned so that an
// edge the scanner left crooked lies along the sheet. Pure geometry on one
// piece; the solver settles what the move does to the rest — but for a
// shape defined in all but its place, which the hand carries whole.

import type { Vec2 } from '../../../src/core/flat/types'
import { add2, sub2 } from '../../../src/core/flat/vec2'
import { addConstraint, addEntity, anchorPoint, constraintEntities, entityOf, splinePointIndex, type AnchorAt, type Constraint, type Sketch, type SketchEntity } from './sketch'
import { solveSketch } from './solver'

const TWO_PI = 2 * Math.PI

/** An angle brought into (0, 2π] — an arc's sweep, which is never nothing. */
function positiveSweep(a: number): number {
  const s = ((a % TWO_PI) + TWO_PI) % TWO_PI
  return s === 0 ? TWO_PI : s
}

/** The piece with its anchor moved to `p`: a line's end goes there, an
 *  arc's end swings round its centre to the angle of `p` — the radius
 *  stays, so the other end stays — and a centre carries the piece. */
export function moveAnchor(e: SketchEntity, at: AnchorAt, p: Vec2): SketchEntity {
  switch (e.kind) {
    case 'line':
      if (at === 'a') return { ...e, a: p }
      if (at === 'b') return { ...e, b: p }
      return translateEntity(e, sub2(p, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]))
    case 'arc': {
      if (at === 'center') return translateEntity(e, sub2(p, e.c))
      const angle = Math.atan2(p[1] - e.c[1], p[0] - e.c[0])
      if (at === 'a') {
        const end = e.start + e.sweep
        return { ...e, start: angle, sweep: positiveSweep(end - angle) }
      }
      return { ...e, sweep: positiveSweep(angle - e.start) }
    }
    case 'circle':
      return translateEntity(e, sub2(p, e.c))
    case 'spline': {
      // A fit point goes where the hand is, the curve bending through it.
      const i = splinePointIndex(e, at)
      if (i === null) return translateEntity(e, sub2(p, anchorPoint(e, at)))
      return { ...e, pts: e.pts.map((q, k) => (k === i ? p : q)) }
    }
    case 'point':
      return { ...e, p }
  }
}

/** The piece carried by `delta`, slice points and all. */
export function translateEntity(e: SketchEntity, delta: Vec2): SketchEntity {
  const points = 'points' in e && e.points ? e.points.map((q) => add2(q, delta)) : undefined
  switch (e.kind) {
    case 'line':
      return { ...e, a: add2(e.a, delta), b: add2(e.b, delta), ...(points ? { points } : {}) }
    case 'arc':
    case 'circle':
      return { ...e, c: add2(e.c, delta), ...(points ? { points } : {}) }
    case 'spline':
      return { ...e, pts: e.pts.map((q) => add2(q, delta)), ...(points ? { points } : {}) }
    case 'point':
      return { ...e, p: add2(e.p, delta) }
  }
}

/** The piece without its slice points: what a dragged fitted piece
 *  becomes, since a hand that moves it has overruled the scan. */
export function detached(e: SketchEntity): SketchEntity {
  if (!('points' in e)) return e
  const { points: _points, scatter: _scatter, ...rest } = e
  return rest as SketchEntity
}

function rotate(p: Vec2, c: number, s: number): Vec2 {
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}

/** The piece turned by `angle` radians about the sheet origin. */
export function rotateEntity(e: SketchEntity, angle: number): SketchEntity {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const points = 'points' in e && e.points ? e.points.map((q) => rotate(q, c, s)) : undefined
  switch (e.kind) {
    case 'line':
      return { ...e, a: rotate(e.a, c, s), b: rotate(e.b, c, s), ...(points ? { points } : {}) }
    case 'arc':
      return { ...e, c: rotate(e.c, c, s), start: e.start + angle, ...(points ? { points } : {}) }
    case 'circle':
      return { ...e, c: rotate(e.c, c, s), ...(points ? { points } : {}) }
    case 'spline':
      return {
        ...e,
        pts: e.pts.map((q) => rotate(q, c, s)),
        ...(e.startDir !== undefined ? { startDir: e.startDir + angle } : {}),
        ...(e.endDir !== undefined ? { endDir: e.endDir + angle } : {}),
        ...(points ? { points } : {}),
      }
    case 'point':
      return { ...e, p: rotate(e.p, c, s) }
  }
}

/** Turn the whole sketch in place by `angle` about the sheet origin —
 *  what aligning the sheet to one of its lines does to the drawing, the
 *  frame turning the other way underneath. */
export function rotateSketch(sketch: Sketch, angle: number): void {
  sketch.entities = sketch.entities.map((e) => rotateEntity(e, angle))
}

/** Whether a relation or a dimension ties its piece to the sheet itself —
 *  a coordinate plane's line, an axis — rather than to another piece. */
function onSheet(c: Constraint): boolean {
  switch (c.kind) {
    case 'pointOn':
    case 'collinear':
      return 'datum' in c.on
    case 'symmetric':
      return typeof c.about === 'string' || 'datum' in c.about
    case 'distance':
      return 'datum' in c.q
    default:
      return false
  }
}

/** The pieces a drag carries along whole, or null when the solver is to
 *  share the move out. A shape its relations and dimensions leave nothing
 *  but its place on the sheet — a rectangle with its width and height, not
 *  yet put anywhere — can follow the hand only whole: every piece joined to
 *  the one in the hand, through relations and dimensions, is carried by the
 *  hand's move as it is, rather than eased after it by the solver a step
 *  behind. Not a shape held anywhere — a fixed, projected or fitted piece,
 *  a relation to a coordinate plane — nor one with a freedom left besides
 *  its place, which the drag is there to use. */
export function rigidCluster(sketch: Sketch, grab: { entity: number; at: AnchorAt | 'body' }): number[] | null {
  // The shape: what is joined to the piece in the hand.
  const shape = new Set([grab.entity])
  for (let grew = true; grew; ) {
    grew = false
    for (const c of sketch.constraints) {
      const ids = constraintEntities(c)
      if (!ids.some((i) => shape.has(i)) || ids.every((i) => shape.has(i))) continue
      for (const i of ids) shape.add(i)
      grew = true
    }
  }
  const pieces = sketch.entities.filter((e) => shape.has(e.id))
  if (pieces.some((e) => e.fixed || e.projected || ('points' in e && e.points && e.points.length > 0))) return null
  const own = sketch.constraints.filter((c) => constraintEntities(c).some((i) => shape.has(i)))
  if (own.some(onSheet)) return null
  // Defined but for its place: held where the hand has it — the end or the
  // centre at its spot, a piece where it lies — nothing of it is left loose.
  const probe: Sketch = { entities: pieces.map((e) => (e.id === grab.entity && grab.at === 'body' ? { ...e, fixed: true } : { ...e })), constraints: own.map((c) => ({ ...c })), nextId: sketch.nextId }
  if (grab.at !== 'body') {
    const e = entityOf(probe, grab.entity)
    if (!e) return null
    const pin = addEntity(probe, { kind: 'point', p: anchorPoint(e, grab.at), fixed: true })
    addConstraint(probe, { kind: 'coincident', p: { entity: grab.entity, at: grab.at }, q: { entity: pin, at: 'center' } })
  }
  const loose = new Set(solveSketch(probe).underConstrained)
  return pieces.some((e) => loose.has(e.id)) ? null : pieces.map((e) => e.id)
}
