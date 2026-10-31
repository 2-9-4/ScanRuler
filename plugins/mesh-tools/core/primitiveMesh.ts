// SPDX-License-Identifier: AGPL-3.0-only
// A measured element that is a solid — a fitted cylinder, cone or sphere — as
// a closed triangle mesh, for the Boolean to cut or add with as it is, without
// its being made a body in another workspace first. Meshed the way a CAD
// body's mesh comes, face by face: a rim's vertices once for the wall and once
// for the end, so the ends are drawn flat against a round wall, and the
// boolean welds them (booleanMesh). Wound outward, as a solid's is.

import type { FitData, Vec3 } from '../../../src/core/types'
import { addScaled, cross, normalize } from '../../../src/core/vec'
import type { Triangles } from './boolean'

/** Under this a radius is a point: the apex of a cone fitted to its tip. */
const APEX = 1e-9

/** The segments round a circle of radius `r` for every chord to lie within
 *  `chord` millimetres of the round — what a bore is cut to. At least 24, so
 *  a pin is still round; at most 720, so a large sphere stays a mesh. */
export function segmentsFor(r: number, chord: number): number {
  const s = Math.min(Math.max(chord / r, 1e-12), 1)
  const n = Math.ceil(Math.PI / Math.acos(1 - s))
  return Math.min(Math.max(n, 24), 720)
}

/** Two directions square to `axis` and to each other, turning the right way
 *  round it: u × v is the axis. */
function frame(axis: Vec3): { a: Vec3; u: Vec3; v: Vec3 } {
  const a = normalize(axis) ?? [0, 0, 1]
  const u = normalize(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) ?? [1, 0, 0]
  return { a, u, v: cross(a, u) }
}

class Builder {
  readonly p: number[] = []
  readonly idx: number[] = []

  point(q: Vec3): number {
    this.p.push(q[0], q[1], q[2])
    return this.p.length / 3 - 1
  }

  /** A circle of `n` vertices round `c`, the first on u. */
  ring(c: Vec3, r: number, u: Vec3, v: Vec3, n: number): number {
    const first = this.p.length / 3
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n
      this.point(addScaled(addScaled(c, u, r * Math.cos(t)), v, r * Math.sin(t)))
    }
    return first
  }

  done(): Triangles {
    return { positions: new Float32Array(this.p), indices: new Uint32Array(this.idx) }
  }
}

/** A cylinder or a cone between two radii: `r0` at the end `length / 2`
 *  back along the axis from `center`, `r1` at the end as far forward. A
 *  radius of nothing is an apex, with no end face. */
function frustum(center: Vec3, axis: Vec3, length: number, r0: number, r1: number, chord: number): Triangles | null {
  if (!(length > 0) || !(r0 >= 0) || !(r1 >= 0)) return null
  const tip0 = r0 <= APEX
  const tip1 = r1 <= APEX
  if (tip0 && tip1) return null
  const { a, u, v } = frame(axis)
  const n = segmentsFor(Math.max(r0, r1), chord)
  const back = addScaled(center, a, -length / 2)
  const front = addScaled(center, a, length / 2)
  const m = new Builder()
  // The wall, a quad per segment, or a triangle at an apex.
  const b = tip0 ? m.point(back) : m.ring(back, r0, u, v, n)
  const f = tip1 ? m.point(front) : m.ring(front, r1, u, v, n)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const bi = tip0 ? b : b + i
    const bj = tip0 ? b : b + j
    const fi = tip1 ? f : f + i
    const fj = tip1 ? f : f + j
    if (!tip0) m.idx.push(bi, bj, fj)
    if (!tip1) m.idx.push(bi, fj, fi)
  }
  // The ends, fanned from their middles: the front facing forward, the back
  // back.
  if (!tip1) {
    const c = m.point(front)
    const r = m.ring(front, r1, u, v, n)
    for (let i = 0; i < n; i++) m.idx.push(c, r + i, r + ((i + 1) % n))
  }
  if (!tip0) {
    const c = m.point(back)
    const r = m.ring(back, r0, u, v, n)
    for (let i = 0; i < n; i++) m.idx.push(c, r + ((i + 1) % n), r + i)
  }
  return m.done()
}

/** A sphere, in rings of latitude between its poles. */
function sphere(center: Vec3, radius: number, chord: number): Triangles | null {
  if (!(radius > APEX)) return null
  const { a, u, v } = frame([0, 0, 1])
  const n = segmentsFor(radius, chord)
  const bands = Math.max(4, Math.ceil(n / 2))
  const m = new Builder()
  const north = m.point(addScaled(center, a, radius))
  const rings: number[] = []
  for (let k = 1; k < bands; k++) {
    const phi = (Math.PI * k) / bands
    rings.push(m.ring(addScaled(center, a, radius * Math.cos(phi)), radius * Math.sin(phi), u, v, n))
  }
  const south = m.point(addScaled(center, a, -radius))
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    m.idx.push(north, rings[0] + i, rings[0] + j)
    for (let k = 0; k + 1 < rings.length; k++) {
      const up = rings[k]
      const down = rings[k + 1]
      m.idx.push(up + i, down + i, down + j, up + i, down + j, up + j)
    }
    const last = rings[rings.length - 1]
    m.idx.push(south, last + j, last + i)
  }
  return m.done()
}

/** The closed mesh of a fitted cylinder, cone or sphere, to `chord`
 *  millimetres; null for a kind with no volume, or a fit with none. */
export function elementSolid(fit: FitData, chord: number): Triangles | null {
  switch (fit.kind) {
    case 'cylinder':
      return frustum(fit.center, fit.axis, fit.length, fit.radius, fit.radius, chord)
    case 'cone':
      // The axis points the way the radius grows: the small end behind.
      return frustum(fit.center, fit.axis, fit.length, fit.radius1, fit.radius2, chord)
    case 'sphere':
      return sphere(fit.center, fit.radius, chord)
    default:
      return null
  }
}
