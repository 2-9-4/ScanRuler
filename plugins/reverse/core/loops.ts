// SPDX-License-Identifier: AGPL-3.0-only
// The loops a profile is drawn from: a polygon or a rectangle as pieces, an
// arc as a piece, the points along a piece, and a loop's middle.

import type { Vec3 } from '../../../src/core/types'
import { add, addScaled, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import { circleThrough } from './kernelMath'
import type { LoopPiece } from './kernelTypes'
import { bsplineSamples } from './sketchSpline'

/** A closed loop's pieces from a run of corner points, for the callers that
 *  build a straight-sided profile — a rectangle, a polygon. */
export function polygonLoop(points: readonly Vec3[]): LoopPiece[] {
  return points.map((p, i) => ({ kind: 'line', a: p, b: points[(i + 1) % points.length] }))
}

/** A rectangle's loop in the plane through `origin` spanned by unit `u` and
 *  `v`, `w` by `h` millimetres from the origin corner. */
export function rectangleLoop(origin: Vec3, u: Vec3, v: Vec3, w: number, h: number): LoopPiece[] {
  const p0 = origin
  const p1 = addScaled(origin, u, w)
  const p2 = addScaled(p1, v, h)
  const p3 = addScaled(origin, v, h)
  return polygonLoop([p0, p1, p2, p3])
}

/** Points along a loop's piece, its ends included: a line's two ends, an
 *  arc or a circle every `step` radians at most (a circle's last point is
 *  its first). */
export function piecePoints(piece: LoopPiece, step = Math.PI / 64): Vec3[] {
  if (piece.kind === 'line') return [piece.a, piece.b]
  if (piece.kind === 'spline') return bsplineSamples(piece, Math.max(16, 8 * (piece.knots.length - 1))) as Vec3[]
  const circle =
    piece.kind === 'circle'
      ? { center: piece.center, radius: piece.radius, axis: normalize(piece.normal) ?? ([0, 0, 1] as Vec3) }
      : circleThrough(piece.a, piece.m, piece.b)
  if (!circle) return piece.kind === 'arc' ? [piece.a, piece.m, piece.b] : [piece.center]
  const { center, radius, axis } = circle
  const start = piece.kind === 'arc' ? piece.a : addScaled(center, normalize(cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) ?? [1, 0, 0], radius)
  const u = normalize(sub(start, center)) ?? [1, 0, 0]
  const v = cross(axis, u)
  // The axis circleThrough gives runs a → m → b counter-clockwise, so the
  // arc's sweep is b's angle about it.
  const angleOf = (p: Vec3) => {
    const a = Math.atan2(dot(sub(p, center), v), dot(sub(p, center), u))
    return a <= 0 ? a + 2 * Math.PI : a
  }
  const sweep = piece.kind === 'arc' ? angleOf(piece.b) : 2 * Math.PI
  const n = Math.max(2, Math.ceil(sweep / step))
  const out: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const t = (sweep * i) / n
    out.push(add(center, addScaled(scale(u, radius * Math.cos(t)), v, radius * Math.sin(t))))
  }
  return out
}

/** The middle of a loop by its length — of a ring, its centre — as the
 *  kernel takes a wire's centre of mass, near enough. */
export function loopMiddle(loop: readonly LoopPiece[]): Vec3 {
  let sum: Vec3 = [0, 0, 0]
  let total = 0
  for (const piece of loop) {
    const pts = piecePoints(piece)
    for (let i = 0; i + 1 < pts.length; i++) {
      const l = len(sub(pts[i + 1], pts[i]))
      sum = addScaled(sum, add(pts[i], pts[i + 1]), l / 2)
      total += l
    }
  }
  if (total > 0) return scale(sum, 1 / total)
  const first = loop[0]
  return first ? (first.kind === 'circle' ? first.center : first.kind === 'spline' ? first.poles[0] : first.a) : [0, 0, 0]
}

/** The arc through `a` and `b` about `center`, with the midpoint that names
 *  it: the shorter or the longer way round as `sweep` (radians, positive)
 *  says, counter-clockwise about `normal`. */
export function arcPiece(center: Vec3, normal: Vec3, a: Vec3, b: Vec3, sweep: number): LoopPiece {
  const n = normalize(normal) ?? [0, 0, 1]
  const ra = sub(a, center)
  const r = len(ra)
  const u = normalize(ra) ?? [1, 0, 0]
  const v = cross(n, u)
  const half = sweep / 2
  const m = add(center, addScaled(scale(u, r * Math.cos(half)), v, r * Math.sin(half)))
  return { kind: 'arc', a, m, b }
}
