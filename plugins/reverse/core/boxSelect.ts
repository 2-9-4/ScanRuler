// SPDX-License-Identifier: AGPL-3.0-only
// Which pieces of a sketch a selection box takes, the two ways CAD sketchers
// read a box: a window, dragged rightward, takes what lies wholly inside it;
// a crossing box, dragged leftward, takes whatever it touches. The box is
// the screen rectangle laid on the sheet — four corners in sheet millimetres,
// in order round it — so a sheet shown turned still gets a true answer.
// Exact for lines and arcs: an arc's extremes towards each side of the box
// are its ends and the points of its circle square to that side, and an arc
// that ends outside the box and touches it crosses one of its sides.

import type { Vec2 } from '../../../src/core/flat/types'
import { arcPoint, entityPolyline, unwindAngle, type Sketch, type SketchEntity } from './sketch'

/** The pieces the box takes, by id, in the sketch's order. */
export function piecesInBox(sketch: Pick<Sketch, 'entities'>, corners: readonly Vec2[], crossing: boolean): number[] {
  const box = convex(corners)
  if (!box) return []
  return sketch.entities.filter((e) => (crossing ? touches(e, box) : inside(e, box))).map((e) => e.id)
}

/** A convex polygon turned counter-clockwise, with the inward normal of
 *  each side and its offset — null for a box with no area. */
interface Box {
  corners: Vec2[]
  sides: { n: Vec2; d: number }[]
}

function convex(corners: readonly Vec2[]): Box | null {
  if (corners.length < 3) return null
  let area = 0
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i]
    const q = corners[(i + 1) % corners.length]
    area += p[0] * q[1] - q[0] * p[1]
  }
  if (!(Math.abs(area) > 1e-12)) return null
  // Counter-clockwise, so the inward normal is the left of every side.
  const ring = area > 0 ? [...corners] : [...corners].reverse()
  const sides = ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length]
    const n: Vec2 = [-(q[1] - p[1]), q[0] - p[0]]
    const l = Math.hypot(n[0], n[1])
    const unit: Vec2 = [n[0] / l, n[1] / l]
    return { n: unit, d: unit[0] * p[0] + unit[1] * p[1] }
  })
  return { corners: ring, sides }
}

/** A hair of slack, so a piece drawn on the box's edge counts as in it. */
const EPS = 1e-9

function contains(box: Box, p: Vec2): boolean {
  return box.sides.every((s) => s.n[0] * p[0] + s.n[1] * p[1] >= s.d - EPS)
}

/** An arc or a circle as a start and a sweep running counter-clockwise. */
function round(e: SketchEntity): { c: Vec2; r: number; start: number; sweep: number } | null {
  if (e.kind === 'circle') return { c: e.c, r: e.r, start: 0, sweep: 2 * Math.PI }
  if (e.kind !== 'arc') return null
  return e.sweep >= 0 ? { c: e.c, r: e.r, start: e.start, sweep: e.sweep } : { c: e.c, r: e.r, start: e.start + e.sweep, sweep: -e.sweep }
}

function onSweep(a: { start: number; sweep: number }, angle: number): boolean {
  return a.sweep >= 2 * Math.PI || unwindAngle(angle, a.start) - a.start <= a.sweep + EPS
}

function inside(e: SketchEntity, box: Box): boolean {
  switch (e.kind) {
    case 'point':
      return contains(box, e.p)
    case 'line':
      return contains(box, e.a) && contains(box, e.b)
    case 'arc':
    case 'circle': {
      const a = round(e)!
      // Each side in turn: the arc's nearest approach to it is one of its
      // ends, or the point of its circle that lies furthest out that way.
      const ends = a.sweep >= 2 * Math.PI ? [] : [arcPoint(a, a.start), arcPoint(a, a.start + a.sweep)]
      return box.sides.every((s) => {
        const reach = (p: Vec2) => s.n[0] * p[0] + s.n[1] * p[1] >= s.d - EPS
        if (!ends.every(reach)) return false
        const out = Math.atan2(-s.n[1], -s.n[0])
        return !onSweep(a, out) || reach(arcPoint(a, out))
      })
    }
    case 'spline':
      // Finely sampled: a cubic bulges past its fit points by less than a
      // sample's sag.
      return entityPolyline(e, 192).every((p) => contains(box, p))
  }
}

function touches(e: SketchEntity, box: Box): boolean {
  switch (e.kind) {
    case 'point':
      return contains(box, e.p)
    case 'line':
      return contains(box, e.a) || contains(box, e.b) || sideCrossings(box).some(([p, q]) => segmentsMeet(e.a, e.b, p, q))
    case 'arc':
    case 'circle': {
      const a = round(e)!
      // A piece with a point in the box touches it; one with none in it
      // and still touching it crosses a side.
      if (contains(box, arcPoint(a, a.start))) return true
      if (a.sweep < 2 * Math.PI && contains(box, arcPoint(a, a.start + a.sweep))) return true
      return sideCrossings(box).some(([p, q]) => arcMeetsSegment(a, p, q))
    }
    case 'spline': {
      const pts = entityPolyline(e, 192)
      if (pts.some((p) => contains(box, p))) return true
      return sideCrossings(box).some(([p, q]) => pts.some((a, i) => i > 0 && segmentsMeet(pts[i - 1], a, p, q)))
    }
  }
}

function sideCrossings(box: Box): [Vec2, Vec2][] {
  return box.corners.map((p, i) => [p, box.corners[(i + 1) % box.corners.length]])
}

const cross = (o: Vec2, p: Vec2, q: Vec2) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])

/** Whether two segments meet, ends and touching included. */
function segmentsMeet(a: Vec2, b: Vec2, p: Vec2, q: Vec2): boolean {
  const d1 = cross(p, q, a)
  const d2 = cross(p, q, b)
  const d3 = cross(a, b, p)
  const d4 = cross(a, b, q)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const within = (o: Vec2, s: Vec2, t: Vec2) => Math.min(o[0], s[0]) - EPS <= t[0] && t[0] <= Math.max(o[0], s[0]) + EPS && Math.min(o[1], s[1]) - EPS <= t[1] && t[1] <= Math.max(o[1], s[1]) + EPS
  return (Math.abs(d1) <= EPS && within(p, q, a)) || (Math.abs(d2) <= EPS && within(p, q, b)) || (Math.abs(d3) <= EPS && within(a, b, p)) || (Math.abs(d4) <= EPS && within(a, b, q))
}

/** Whether an arc meets a segment: where the segment cuts the arc's circle,
 *  at a point the arc runs through. */
function arcMeetsSegment(a: { c: Vec2; r: number; start: number; sweep: number }, p: Vec2, q: Vec2): boolean {
  const d: Vec2 = [q[0] - p[0], q[1] - p[1]]
  const f: Vec2 = [p[0] - a.c[0], p[1] - a.c[1]]
  const A = d[0] * d[0] + d[1] * d[1]
  if (A === 0) return false
  const B = 2 * (f[0] * d[0] + f[1] * d[1])
  const C = f[0] * f[0] + f[1] * f[1] - a.r * a.r
  const disc = B * B - 4 * A * C
  if (disc < 0) return false
  const root = Math.sqrt(disc)
  for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
    if (t < -EPS || t > 1 + EPS) continue
    const at: Vec2 = [p[0] + d[0] * t, p[1] + d[1] * t]
    if (onSweep(a, Math.atan2(at[1] - a.c[1], at[0] - a.c[0]))) return true
  }
  return false
}
