// SPDX-License-Identifier: AGPL-3.0-only
// The B-splines of a patch network: cubic, clamped, with uniform knots over
// [0, 1] — a curve of `spans` spans has spans + 3 poles, a patch of nu × nv
// spans (nu + 3) × (nv + 3), row-major with u along the rows' index. Two
// curves or two patch sides with the same span count have the same knots,
// so a side whose poles are a curve's poles is that curve exactly. The
// basis and its first derivative are Cox–de Boor's (Piegl and Tiller,
// The NURBS Book, A2.3); the knots are Fit Surface's.

import type { Vec3 } from '../../../src/core/types'
import { clampedKnots } from './surfaceFit'

export const DEGREE = 3

/** By span count: an array, not a map — it is read twice a patch point. */
const knotCache: (Float64Array | undefined)[] = []

/** The clamped uniform knots of a cubic of `spans` spans over [0, 1]. */
export function knotsOf(spans: number): Float64Array {
  let k = knotCache[spans]
  if (!k) {
    k = clampedKnots(spans + DEGREE, DEGREE, 0, 1)
    knotCache[spans] = k
  }
  return k
}

/** findSpan's span of t in knotsOf(spans), without its search: the knots
 *  inside are i / spans, so it is DEGREE + ⌊t spans⌋ — a step off where t
 *  lies within rounding of a knot, which the knots themselves put right.
 *  The ends, and NaN, as findSpan has them. */
function spanOf(k: Float64Array, spans: number, t: number): number {
  if (!(t < 1)) return spans + DEGREE - 1
  if (t <= 0) return DEGREE
  let s = Math.min(spans + DEGREE - 1, DEGREE + Math.floor(t * spans))
  while (t < k[s]) s--
  while (t >= k[s + 1]) s++
  return s
}

/** The four basis functions non-zero at t and their first derivatives,
 *  written to n0 and n1; the span they are of — so pole span − 3 + i
 *  takes n0[i]. A2.3 written out for the cubic, without its arrays: the
 *  fit evaluates it a few million times a pass, two to a patch point. Its
 *  steps are the loop's, in its order, so its numbers are the loop's to
 *  the bit — where the loop adds a product to a zero, the product is never
 *  −0 (every knot difference here is ≥ +0), and the sum is the product. */
export function basisWithDerivative(spans: number, t: number, n0: Float64Array, n1: Float64Array): number {
  const k = knotsOf(spans)
  const tt = Math.min(1, Math.max(0, t))
  const s = spanOf(k, spans, tt)
  const l1 = tt - k[s], l2 = tt - k[s - 1], l3 = tt - k[s - 2]
  const r1 = k[s + 1] - tt, r2 = k[s + 2] - tt, r3 = k[s + 3] - tt
  // Degree 1 (e), degree 2 (f), then degree 3 over the knot differences
  // a, b, c — ndu[3][0 … 2].
  let temp = 1 / (r1 + l1)
  const e0 = r1 * temp
  const e1 = l1 * temp
  temp = e0 / (r1 + l2)
  const f0 = r1 * temp
  let saved = l2 * temp
  temp = e1 / (r2 + l1)
  const f1 = saved + r2 * temp
  const f2 = l1 * temp
  const a = r1 + l3, b = r2 + l2, c = r3 + l1
  temp = f0 / a
  n0[0] = r1 * temp
  saved = l3 * temp
  temp = f1 / b
  n0[1] = saved + r2 * temp
  saved = l2 * temp
  temp = f2 / c
  n0[2] = saved + r3 * temp
  n0[3] = l1 * temp
  // The derivatives from the degree-2 functions: 3 (f[r − 1] / a[r − 1] −
  // f[r] / a[r]), the loop's 0 − x kept where x may be +0.
  const fa = f0 / a, fb = f1 / b, fc = f2 / c
  n1[0] = 3 * (0 - fa)
  n1[1] = 3 * (fa - fb)
  n1[2] = 3 * (fb - fc)
  n1[3] = 3 * fc
  return s
}

const leftAt = new Float64Array(DEGREE + 1)
const rightAt = new Float64Array(DEGREE + 1)

/** The basis functions alone, as basisWithDerivative's first half — the
 *  Cox–de Boor recurrence of surfaceFit's basisFunctions without its two
 *  arrays a call: the fit evaluates it half a million times a pass. */
export function basisAt(spans: number, t: number, out: Float64Array): number {
  const knots = knotsOf(spans)
  const tt = Math.min(1, Math.max(0, t))
  const s = spanOf(knots, spans, tt)
  out[0] = 1
  for (let j = 1; j <= DEGREE; j++) {
    leftAt[j] = tt - knots[s + 1 - j]
    rightAt[j] = knots[s + j] - tt
    let saved = 0
    for (let r = 0; r < j; r++) {
      const temp = out[r] / (rightAt[r + 1] + leftAt[j - r])
      out[r] = saved + rightAt[r + 1] * temp
      saved = leftAt[j - r] * temp
    }
    out[j] = saved
  }
  return s
}

const b0 = new Float64Array(4)
const b1 = new Float64Array(4)

/** A curve's point at t, poles flat (x, y, z per pole). */
export function curvePoint(poles: ArrayLike<number>, spans: number, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const s = basisAt(spans, t, b0)
  out[0] = out[1] = out[2] = 0
  for (let i = 0; i <= DEGREE; i++) {
    const at = (s - DEGREE + i) * 3
    out[0] += b0[i] * poles[at]
    out[1] += b0[i] * poles[at + 1]
    out[2] += b0[i] * poles[at + 2]
  }
  return out
}

/** A curve's derivative at t. */
export function curveDerivative(poles: ArrayLike<number>, spans: number, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const s = basisWithDerivative(spans, t, b0, b1)
  out[0] = out[1] = out[2] = 0
  for (let i = 0; i <= DEGREE; i++) {
    const at = (s - DEGREE + i) * 3
    out[0] += b1[i] * poles[at]
    out[1] += b1[i] * poles[at + 1]
    out[2] += b1[i] * poles[at + 2]
  }
  return out
}

/** A patch: its spans each way and its poles, (nu + 3) rows of (nv + 3),
 *  x, y, z each. */
export interface PatchNet {
  nu: number
  nv: number
  poles: Float64Array
}

const u0 = new Float64Array(4)
const u1 = new Float64Array(4)
const v0 = new Float64Array(4)
const v1 = new Float64Array(4)

/** A patch's point and first derivatives at (u, v), into p, du, dv. */
export function patchPoint(net: PatchNet, u: number, v: number, p: Vec3, du?: Vec3, dv?: Vec3): void {
  const su = basisWithDerivative(net.nu, u, u0, u1)
  const sv = basisWithDerivative(net.nv, v, v0, v1)
  const cols = net.nv + DEGREE
  const poles = net.poles
  // The sums in locals, written out once; the derivatives' are cheap
  // beside the basis and summed whether asked for or not.
  let px = 0, py = 0, pz = 0
  let ux = 0, uy = 0, uz = 0
  let vx = 0, vy = 0, vz = 0
  for (let a = 0; a <= DEGREE; a++) {
    const row = (su - DEGREE + a) * cols
    const ua = u0[a]
    const ud = u1[a]
    for (let b = 0; b <= DEGREE; b++) {
      const at = (row + sv - DEGREE + b) * 3
      const x = poles[at], y = poles[at + 1], z = poles[at + 2]
      const w = ua * v0[b]
      px += w * x
      py += w * y
      pz += w * z
      const wu = ud * v0[b]
      ux += wu * x
      uy += wu * y
      uz += wu * z
      const wv = ua * v1[b]
      vx += wv * x
      vy += wv * y
      vz += wv * z
    }
  }
  p[0] = px
  p[1] = py
  p[2] = pz
  if (du) {
    du[0] = ux
    du[1] = uy
    du[2] = uz
  }
  if (dv) {
    dv[0] = vx
    dv[1] = vy
    dv[2] = vz
  }
}

/** The patch's unit normal at (u, v): du × dv. */
export function patchNormal(net: PatchNet, u: number, v: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const p: Vec3 = [0, 0, 0]
  const du: Vec3 = [0, 0, 0]
  const dv: Vec3 = [0, 0, 0]
  patchPoint(net, u, v, p, du, dv)
  out[0] = du[1] * dv[2] - du[2] * dv[1]
  out[1] = du[2] * dv[0] - du[0] * dv[2]
  out[2] = du[0] * dv[1] - du[1] * dv[0]
  const l = Math.hypot(out[0], out[1], out[2]) || 1
  out[0] /= l
  out[1] /= l
  out[2] /= l
  return out
}

/** The Greville abscissae of a cubic of `spans` spans: where each pole
 *  "is" along [0, 1]. */
export function grevilleOf(spans: number): Float64Array {
  const knots = knotsOf(spans)
  const n = spans + DEGREE
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = (knots[i + 1] + knots[i + 2] + knots[i + 3]) / 3
  return out
}

/** The weights of the `order`-th divided difference over x[from …], scaled
 *  by order! so it reads as the derivative (as surfaceFit's). */
export function dividedWeights(x: ArrayLike<number>, from: number, order: number): number[] {
  let fact = 1
  for (let k = 2; k <= order; k++) fact *= k
  const w: number[] = []
  for (let k = 0; k <= order; k++) {
    let denom = 1
    for (let j = 0; j <= order; j++) if (j !== k) denom *= x[from + k] - x[from + j]
    w.push(fact / denom)
  }
  return w
}
