// SPDX-License-Identifier: AGPL-3.0-only
// The handful of 2D vector operations the flat workspace leans on. Kept as
// plain functions over [x, y] tuples, like core/vec.ts does for 3D.

import type { Vec2 } from './types'

export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const scale2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s]
export const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]
export const len2 = (a: Vec2): number => Math.hypot(a[0], a[1])
export const mid2 = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/** The left-hand perpendicular — `dir` rotated a quarter turn CCW. */
export const perp2 = (a: Vec2): Vec2 => [-a[1], a[0]]

/** Cross product's z component — the signed area spanned by the two. */
export const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0]

export function normalize2(a: Vec2): Vec2 | null {
  const l = len2(a)
  if (!(l > 1e-12)) return null
  return [a[0] / l, a[1] / l]
}

/** Angle between two directions regardless of either's sign, 0–90°. */
export function acuteAngle2(a: Vec2, b: Vec2): number {
  const c = Math.abs(dot2(a, b)) / (len2(a) * len2(b))
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI
}

/** Foot of the perpendicular from `p` onto the line through `origin` along
 *  unit `dir`, and how far along the line it lands. */
export function footOnLine2(p: Vec2, origin: Vec2, dir: Vec2): { foot: Vec2; t: number } {
  const t = dot2(sub2(p, origin), dir)
  return { foot: add2(origin, scale2(dir, t)), t }
}

/** How far `p` lies from the segment a–b: from its nearest point, an end
 *  where the foot falls past one. */
export function distToSegment2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** The area a closed polygon encloses by the shoelace sum, positive
 *  counter-clockwise. */
export function signedArea2(poly: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) a += cross2(poly[i], poly[(i + 1) % poly.length])
  return a / 2
}

/** The centroid of a simple polygon by the shoelace sum, falling back to
 *  the vertex mean for a sliver with no area. */
export function polygonCentroid2(poly: readonly (readonly [number, number])[]): [number, number] {
  let a = 0
  let cx = 0
  let cy = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % n]
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-12) {
    let mx = 0
    let my = 0
    for (const [x, y] of poly) {
      mx += x
      my += y
    }
    return n > 0 ? [mx / n, my / n] : [0, 0]
  }
  return [cx / (3 * a), cy / (3 * a)]
}
