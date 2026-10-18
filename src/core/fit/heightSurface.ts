// SPDX-License-Identifier: AGPL-3.0-only
// A sloped or gently curved patch of scan measured as a surface over its own
// plane: the best plane through the points sets a frame — origin at their
// centroid, w along its normal, u and v in it — and the patch is fitted as a
// height over (u, v), from a plane (h = a + b·u + c·v) through a bilinear
// patch (+ d·u·v, a hyperbolic paraboloid — a twisted ruled side) to a full
// quadric (+ d·u² + e·u·v + f·v², a dome, a bowl, a saddle, a cylinder's
// strip). Each is told by its RMS and worst miss, so the simplest that
// holds is plain; the quadric also by its principal curvatures and their
// directions at the patch's middle. Least squares on the heights, the
// frame's tilt taken out first — the patch's slope is in the frame, not in
// the coefficients, so a steep side fits as well as a flat one.

import type { Vec3 } from '../types'
import { add, cross, dot, normalize, scale } from '../vec'
import { orthoBasis, solveLinear, symmetricEigen3 } from './linalg'

export type SurfaceModel = 'plane' | 'bilinear' | 'quadric'

export const SURFACE_MODELS: readonly SurfaceModel[] = ['plane', 'bilinear', 'quadric']

/** The patch's own frame: a point of the surface is origin + u·basisU +
 *  v·basisV + h(u, v)·normal. */
export interface SurfaceFrame {
  origin: Vec3
  basisU: Vec3
  basisV: Vec3
  normal: Vec3
}

export interface SurfaceFitResult {
  model: SurfaceModel
  /** h(u, v)'s coefficients, by name: a, b (u), c (v), then d (uv) for the
   *  bilinear; d (u²), e (uv), f (v²) for the quadric. */
  coefficients: Record<string, number>
  /** The points' RMS distance off the surface along the normal, and the
   *  worst, mm. */
  rms: number
  worst: number
  /** The quadric's principal curvatures at the patch's middle (1/mm, k1
   *  the larger in size), their radii and directions in the world. */
  curvature?: { k1: number; k2: number; r1: number | null; r2: number | null; axis1: Vec3; axis2: Vec3; shape: 'flat' | 'cylinder' | 'dome' | 'saddle' }
}

/** The points' frame: their centroid, and the plane they scatter least
 *  off. Null for too few or for points in a line. */
export function patchFrame(points: ArrayLike<number>): SurfaceFrame | null {
  const n = Math.floor(points.length / 3)
  if (n < 3) return null
  let mx = 0, my = 0, mz = 0
  for (let i = 0; i < n; i++) {
    mx += points[i * 3]
    my += points[i * 3 + 1]
    mz += points[i * 3 + 2]
  }
  mx /= n
  my /= n
  mz /= n
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0
  for (let i = 0; i < n; i++) {
    const x = points[i * 3] - mx, y = points[i * 3 + 1] - my, z = points[i * 3 + 2] - mz
    xx += x * x
    xy += x * y
    xz += x * z
    yy += y * y
    yz += y * z
    zz += z * z
  }
  const { values, vectors } = symmetricEigen3([xx, xy, xz, xy, yy, yz, xz, yz, zz])
  if (!(values[1] > 1e-12 * Math.max(values[2], 1e-30))) return null
  const normal = normalize(vectors[0] as Vec3)
  if (!normal) return null
  const [basisU, basisV] = orthoBasis(normal)
  return { origin: [mx, my, mz], basisU, basisV, normal }
}

/** The terms of a model at (u, v), in the order of its coefficients. */
function terms(model: SurfaceModel, u: number, v: number): number[] {
  if (model === 'plane') return [1, u, v]
  if (model === 'bilinear') return [1, u, v, u * v]
  return [1, u, v, u * u, u * v, v * v]
}

const NAMES: Record<SurfaceModel, string[]> = { plane: ['a', 'b', 'c'], bilinear: ['a', 'b', 'c', 'd'], quadric: ['a', 'b', 'c', 'd', 'e', 'f'] }

/** One model fitted to the points in the frame. Null where the points do
 *  not pin its coefficients (all on a line across the patch). */
export function fitHeight(points: ArrayLike<number>, frame: SurfaceFrame, model: SurfaceModel): SurfaceFitResult | null {
  const n = Math.floor(points.length / 3)
  const k = NAMES[model].length
  if (n < k + 1) return null
  const ata = new Float64Array(k * k)
  const atb = new Float64Array(k)
  const local = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    const d: Vec3 = [points[i * 3] - frame.origin[0], points[i * 3 + 1] - frame.origin[1], points[i * 3 + 2] - frame.origin[2]]
    const u = dot(d, frame.basisU), v = dot(d, frame.basisV), h = dot(d, frame.normal)
    local[i * 3] = u
    local[i * 3 + 1] = v
    local[i * 3 + 2] = h
    const t = terms(model, u, v)
    for (let r = 0; r < k; r++) {
      atb[r] += t[r] * h
      for (let c = 0; c < k; c++) ata[r * k + c] += t[r] * t[c]
    }
  }
  const x = solveLinear(k, ata, atb)
  if (!x || ![...x].every(Number.isFinite)) return null
  let sum = 0
  let worst = 0
  for (let i = 0; i < n; i++) {
    const t = terms(model, local[i * 3], local[i * 3 + 1])
    let h = 0
    for (let r = 0; r < k; r++) h += t[r] * x[r]
    const e = local[i * 3 + 2] - h
    sum += e * e
    worst = Math.max(worst, Math.abs(e))
  }
  const coefficients = Object.fromEntries(NAMES[model].map((name, i) => [name, x[i]]))
  const out: SurfaceFitResult = { model, coefficients, rms: Math.sqrt(sum / n), worst }
  if (model === 'quadric') out.curvature = curvatureAt(frame, x[1], x[2], x[3], x[4], x[5])
  return out
}

/** The principal curvatures of h = a + b·u + c·v + d·u² + e·u·v + f·v² at
 *  (0, 0): the shape operator, the second fundamental form over the first,
 *  its eigenvalues and eigenvectors carried into the world. */
function curvatureAt(frame: SurfaceFrame, b: number, c: number, d: number, e: number, f: number): NonNullable<SurfaceFitResult['curvature']> {
  const W = Math.sqrt(1 + b * b + c * c)
  // First form E F G, second L M N.
  const E = 1 + b * b, F = b * c, G = 1 + c * c
  const L = (2 * d) / W, M = e / W, N = (2 * f) / W
  // S = I⁻¹ II, a 2 × 2.
  const det = E * G - F * F
  const s11 = (G * L - F * M) / det, s12 = (G * M - F * N) / det
  const s21 = (E * M - F * L) / det, s22 = (E * N - F * M) / det
  const tr = s11 + s22
  const dt = s11 * s22 - s12 * s21
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - dt))
  let ka = tr / 2 + disc, kb = tr / 2 - disc
  if (Math.abs(kb) > Math.abs(ka)) [ka, kb] = [kb, ka]
  // An eigenvector of S for k, in (u, v), carried onto the surface: x_u =
  // basisU + b·normal, x_v = basisV + c·normal.
  const dir = (k: number): Vec3 => {
    let p: [number, number] = Math.abs(s12) > 1e-12 ? [s12, k - s11] : Math.abs(s21) > 1e-12 ? [k - s22, s21] : k === ka ? (Math.abs(s11 - ka) < Math.abs(s22 - ka) ? [1, 0] : [0, 1]) : Math.abs(s11 - kb) < Math.abs(s22 - kb) ? [1, 0] : [0, 1]
    const xu = add(frame.basisU, scale(frame.normal, b))
    const xv = add(frame.basisV, scale(frame.normal, c))
    return normalize(add(scale(xu, p[0]), scale(xv, p[1]))) ?? frame.basisU
  }
  const axis1 = dir(ka)
  // The second square to the first in the tangent plane, as a symmetric
  // operator's are.
  const tangentNormal = normalize(cross(add(frame.basisU, scale(frame.normal, b)), add(frame.basisV, scale(frame.normal, c)))) ?? frame.normal
  const axis2 = normalize(cross(tangentNormal, axis1)) ?? dir(kb)
  const tiny = 1e-5
  const shape = Math.abs(ka) < tiny ? 'flat' : Math.abs(kb) < tiny ? 'cylinder' : ka * kb > 0 ? 'dome' : 'saddle'
  return { k1: ka, k2: kb, r1: Math.abs(ka) > tiny ? 1 / ka : null, r2: Math.abs(kb) > tiny ? 1 / kb : null, axis1, axis2, shape }
}

/** How much worse than the closest a simpler model may fit and still be
 *  the one taken: the RMS within this share of the lowest. */
const SIMPLEST_SHARE = 1.1

/** Every model asked for fitted, and the simplest that holds — whose RMS is
 *  within a tenth of the lowest. */
export function fitSurfaceModels(points: ArrayLike<number>, models: readonly SurfaceModel[] = SURFACE_MODELS): { frame: SurfaceFrame; fits: SurfaceFitResult[]; best: SurfaceModel | null } | null {
  const frame = patchFrame(points)
  if (!frame) return null
  const fits = models.map((m) => fitHeight(points, frame, m)).filter((f): f is SurfaceFitResult => f !== null)
  if (fits.length === 0) return { frame, fits, best: null }
  const lowest = Math.min(...fits.map((f) => f.rms))
  const order = SURFACE_MODELS.filter((m) => fits.some((f) => f.model === m))
  const best = order.find((m) => fits.find((f) => f.model === m)!.rms <= SIMPLEST_SHARE * lowest + 1e-9) ?? null
  return { frame, fits, best }
}
