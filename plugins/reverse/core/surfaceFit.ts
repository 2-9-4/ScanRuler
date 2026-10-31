// SPDX-License-Identifier: AGPL-3.0-only
// Fit Surface: a smooth B-spline through a region of the scan.
//
// A scanned freeform patch is a cloud of noisy points; what the trim wants
// is one smooth surface that reaches a little past them. The fit here is
// the standard one: the region's principal frame is the base plane, every
// point becomes (u, v, height) over it, and a tensor-product B-spline of
// degree 3 with a U × V control net is solved for its heights by linear
// least squares — the net's u and v are fixed at the Greville abscissae, so
// the surface's own (x, y) reproduce the plane's (u, v) exactly and only
// the heights are unknown. A thin-plate term on second differences of the
// net keeps the surface fair where the region is thin or noisy; its weight
// is the smoothness slider times the region's area, so one setting means
// the same on a 10 mm boss and a 200 mm panel. Dense
// Cholesky is enough: the largest net in use is 20 × 20, four hundred
// unknowns.
//
// The height field is the limitation: a patch that folds back over its
// plane — more than half a cylinder — is not one surface over it. Those
// are primitives, and Measure fits them; this is for the rest.
//
// The kernel does not take a control net. Its bsplineSurface is OCCT's
// GeomAPI_PointsToBSplineSurface: a surface *through a regular grid of
// points*, within a thousandth of a millimetre. So the fitted surface is
// sampled on a grid a few times denser than its net (`gridOf`) and that
// grid is what the kernel gets — the fit does the smoothing of the scan's
// noise, the kernel makes the exact B-rep surface through the fit.

import { principalFrame } from '../../../src/core/deviation/prealign'
import { choleskySolve, solveLinear, symmetricEigen3 } from '../../../src/core/fit/linalg'
import type { Vec3 } from '../../../src/core/types'
import type { SurfaceFitParams } from './features'

/** The smallest and largest net per side; Auto chooses within them. */
export const NET_MIN = 3
export const NET_MAX = 20
/** The defaults a new Fit Surface opens with — the interview's numbers. */
export const DEFAULT_SURFACE_FIT: SurfaceFitParams = { net: null, degree: 3, expandPct: 35, smoothness: 0.01 }
/** How many grid samples per net span go to the kernel. Three per span
 *  puts the grid well inside what a cubic through it can carry without
 *  wobbling between the samples. */
const GRID_PER_SPAN = 3
/** The denser grids tried when the kernel's surface through the first
 *  does not follow it. The kernel approximates the grid, up to degree 8,
 *  and on some grids that comes back swinging between the samples: the
 *  water pump's underside at three a span came back with twice the area
 *  and 50 mm off the fit, meshed to 780 k triangles; at two a span, 320 m
 *  tall. Five a span and more followed it within a micron every time. */
export const GRID_RETRIES = [6, 8]
/** How much more area than the grid's own facets the kernel's surface
 *  through it may have and still follow it: a smooth fit sampled three a
 *  span has well under 0.1 % more; a surface swinging off it, from 50 %
 *  to a millionfold. */
export const GRID_AREA_SLACK = 1.02
/** How many more triangles the kernel's mesher lays than the fewest of
 *  the edge it may lay (meshTriangles). */
const MESH_SURPLUS = 3
/** What a slider of 1 means against the data, chosen so that the default
 *  of 0.01 moves a 30 mm cylinder fitted through 2,400 points by microns
 *  and still holds a 20 × 20 net over 121 noisy points to a fair plane. */
const SMOOTHNESS_SCALE = 1e-2
/** The net of Auto's pilot fit, per side. */
const PILOT_NET = 6
/** The pull toward the region's plane in the cells with no points within
 *  reach (fitSurface): its weight, as a share of the points of an average
 *  cell with points; how many cells off a point a cell is still within
 *  reach; and the samples a side that stand in for points in a pulled
 *  cell. */
export const PULL = 0.01
const PULL_REACH = 1
const PULL_SAMPLES = 3
/** How far the pull may move the surface at a point, as a share of the
 *  RMS the fit without it leaves — never held under PULL_FLOOR mm, the
 *  noise of a clean CAD tessellation being next to none — and how many
 *  weights it tries for that. */
const PULL_MOVE = 0.5
const PULL_FLOOR = 0.01
const PULL_ROUNDS = 3

export interface SurfaceFitResult {
  /** The base frame: origin, the two in-plane axes and the normal. */
  origin: Vec3
  axisU: Vec3
  axisV: Vec3
  normal: Vec3
  /** The (u, v) range the surface covers, the margin included. */
  uRange: [number, number]
  vRange: [number, number]
  degree: number
  /** The clamped knot vectors and the net's heights, row-major (u rows). */
  knotsU: Float64Array
  knotsV: Float64Array
  nu: number
  nv: number
  heights: Float64Array
  /** The fit's residuals in the plane's normal: RMS and largest, mm. */
  rms: number
  max: number
  /** The net Auto chose, or the one asked for. */
  net: { u: number; v: number }
  /** The region's points over the plane, (u, v) pairs: where the surface
   *  has the scan under it as fitted — what is read past it, and what a
   *  split within the region cuts inside (surfaceRegion.ts). Set by
   *  fitSurfaceReported; absent on a fit made otherwise. */
  footprint?: Float32Array
}

/** A clamped uniform knot vector of degree `p` with `n` control points
 *  over [a, b]. */
export function clampedKnots(n: number, p: number, a: number, b: number): Float64Array {
  const m = n + p + 1
  const knots = new Float64Array(m)
  const inner = n - p - 1
  for (let i = 0; i <= p; i++) knots[i] = a
  for (let i = 1; i <= inner; i++) knots[p + i] = a + ((b - a) * i) / (inner + 1)
  for (let i = m - p - 1; i < m; i++) knots[i] = b
  return knots
}

/** The Greville abscissae: where a control point "is" along the axis; the
 *  B-spline through them reproduces a straight line exactly. */
export function greville(knots: Float64Array, n: number, p: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 1; k <= p; k++) s += knots[i + k]
    out[i] = s / p
  }
  return out
}

/** The knot span holding t, so that knots[span] <= t < knots[span + 1],
 *  with t at the end taken into the last span. */
export function findSpan(knots: Float64Array, n: number, p: number, t: number): number {
  if (t >= knots[n]) return n - 1
  if (t <= knots[p]) return p
  let lo = p
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t < knots[mid]) hi = mid
    else lo = mid
  }
  return lo
}

/** The p + 1 basis functions that are non-zero at t, in the span — the
 *  Cox–de Boor recurrence. */
export function basisFunctions(knots: Float64Array, span: number, p: number, t: number, out: Float64Array): void {
  const left = new Float64Array(p + 1)
  const right = new Float64Array(p + 1)
  out[0] = 1
  for (let j = 1; j <= p; j++) {
    left[j] = t - knots[span + 1 - j]
    right[j] = knots[span + j] - t
    let saved = 0
    for (let r = 0; r < j; r++) {
      const temp = out[r] / (right[r + 1] + left[j - r])
      out[r] = saved + right[r + 1] * temp
      saved = left[j - r] * temp
    }
    out[j] = saved
  }
}

/** The net Auto chooses: the region's extent over eight times its scatter,
 *  per side, within the limits — enough spans to follow the shape the
 *  points resolve, not so many that the net fits the noise. */
export function autoNet(extentU: number, extentV: number, scatter: number): { u: number; v: number } {
  const per = (extent: number) => Math.max(NET_MIN, Math.min(NET_MAX, Math.round(extent / (8 * Math.max(scatter, 1e-3)))))
  return { u: per(extentU), v: per(extentV) }
}

/** The plane a surface is fitted over: the region's principal frame, or —
 *  given a height direction — that direction as its normal, the in-plane
 *  axes the principal ones laid square to it. */
export function heightFrame(axes: readonly Vec3[], normal?: Vec3): [Vec3, Vec3, Vec3] {
  const len = normal ? Math.hypot(normal[0], normal[1], normal[2]) : 0
  if (!normal || !(len > 1e-12)) return [axes[0], axes[1], axes[2]]
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len]
  const square = (a: Vec3): Vec3 => {
    const d = a[0] * n[0] + a[1] * n[1] + a[2] * n[2]
    return [a[0] - d * n[0], a[1] - d * n[1], a[2] - d * n[2]]
  }
  // The longer principal axis, unless it runs nearly along the normal.
  let u = square(axes[0])
  if (Math.hypot(...u) < 0.3) u = square(axes[1])
  const lu = Math.hypot(...u)
  u = [u[0] / lu, u[1] / lu, u[2] / lu]
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
  return [u, v, n]
}

/** A surface fitted through the points, xyz flat. `scatter` is the scan's
 *  own noise in millimetres, for Auto's net; the plane residual's spread is
 *  used when it is null. `pull` is the pull toward the plane the cells
 *  with no points near start from (PULL; 0 fits without it). */
export function fitSurface(xyz: Float32Array | Float64Array, params: SurfaceFitParams, scatter: number | null = null, pull = PULL): SurfaceFitResult {
  const n = Math.floor(xyz.length / 3)
  if (n < 4) throw new Error('Too few points to fit a surface through.')
  const frame = principalFrame(xyz)
  const [au, av, an] = heightFrame(frame.axes, params.normal)
  const c = frame.centroid
  const p = Math.max(1, Math.min(5, Math.round(params.degree)))

  // Every point over the plane.
  const u = new Float64Array(n)
  const v = new Float64Array(n)
  const h = new Float64Array(n)
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3] - c[0], y = xyz[i * 3 + 1] - c[1], z = xyz[i * 3 + 2] - c[2]
    u[i] = x * au[0] + y * au[1] + z * au[2]
    v[i] = x * av[0] + y * av[1] + z * av[2]
    h[i] = x * an[0] + y * an[1] + z * an[2]
    if (u[i] < uMin) uMin = u[i]
    if (u[i] > uMax) uMax = u[i]
    if (v[i] < vMin) vMin = v[i]
    if (v[i] > vMax) vMax = v[i]
  }
  const extentU = Math.max(uMax - uMin, 1e-6)
  const extentV = Math.max(vMax - vMin, 1e-6)
  // The margin: the surface reaches past the region by a share of its
  // extent, half on each side.
  const margin = Math.max(0, params.expandPct) / 200
  const uRange: [number, number] = [uMin - extentU * margin, uMax + extentU * margin]
  const vRange: [number, number] = [vMin - extentV * margin, vMax + extentV * margin]

  // Auto's net wants the scan's noise, which the plane residual's spread
  // is not on a curved patch — there it is the sag. With no scatter given,
  // a pilot fit on a coarse net reads the noise off its own residual:
  // what a coarse smooth surface cannot follow is noise, or detail Auto
  // then gives the net enough spans to follow.
  const noise = scatter ?? (params.net ? Math.sqrt(frame.spread[2]) : fitSurface(xyz, { ...params, net: { u: PILOT_NET, v: PILOT_NET } }, 0, 0).rms)
  const net = params.net ? { u: clampNet(params.net.u, p), v: clampNet(params.net.v, p) } : autoNet(extentU, extentV, noise)
  const nu = Math.max(net.u, p + 1)
  const nv = Math.max(net.v, p + 1)
  const knotsU = clampedKnots(nu, p, uRange[0], uRange[1])
  const knotsV = clampedKnots(nv, p, vRange[0], vRange[1])

  // Normal equations over the heights, assembled point by point from the
  // (p + 1)² basis products each point touches.
  const m = nu * nv
  const ata = new Float64Array(m * m)
  const atb = new Float64Array(m)
  const bu = new Float64Array(p + 1)
  const bv = new Float64Array(p + 1)
  const cols = new Int32Array((p + 1) * (p + 1))
  const vals = new Float64Array((p + 1) * (p + 1))
  for (let i = 0; i < n; i++) {
    const su = findSpan(knotsU, nu, p, u[i])
    const sv = findSpan(knotsV, nv, p, v[i])
    basisFunctions(knotsU, su, p, u[i], bu)
    basisFunctions(knotsV, sv, p, v[i], bv)
    let k = 0
    for (let a = 0; a <= p; a++) {
      const row = (su - p + a) * nv
      for (let b = 0; b <= p; b++) {
        cols[k] = row + (sv - p + b)
        vals[k] = bu[a] * bv[b]
        k++
      }
    }
    for (let a = 0; a < k; a++) {
      const ca = cols[a]
      const va = vals[a]
      atb[ca] += va * h[i]
      const rowA = ca * m
      for (let b = 0; b < k; b++) ata[rowA + cols[b]] += va * vals[b]
    }
  }

  // The fairness term. A thin-plate energy (second differences) was tried
  // first and thrown out: it prefers a plane, so with no data in the
  // margin it flattened the extrapolation there — a 30 mm cylinder's
  // reach was 0.7 mm off at the margin's edge, where the surface has to
  // meet its neighbour for the trim. What is penalised instead is the
  // *change* of curvature: third divided differences of the net's heights
  // over the Greville abscissae (divided, because a clamped net's ends
  // are not evenly spaced and a plain difference would bend a quadratic
  // there), along u, along v and mixed, each weighted by its cell's area.
  // Their null space holds every quadratic, so a cylinder, a sphere or a
  // saddle extrapolates as itself, while noise and a net finer than its
  // points are still faired. The energy has the units of 1/length², so
  // the weight is the slider times the region's area squared: a slider of
  // 0.01 means the same on a 10 mm boss and a 200 mm panel.
  const lambda = Math.max(0, params.smoothness) * (extentU * extentV) ** 2 * SMOOTHNESS_SCALE
  const xu = greville(knotsU, nu, p)
  const xv = greville(knotsV, nv, p)
  const area = ((uRange[1] - uRange[0]) / Math.max(1, nu - 1)) * ((vRange[1] - vRange[0]) / Math.max(1, nv - 1))
  const addStencil = (idx: number[], w: number[], scale: number) => {
    for (let a = 0; a < idx.length; a++) {
      for (let b = 0; b < idx.length; b++) ata[idx[a] * m + idx[b]] += lambda * scale * w[a] * w[b]
    }
  }
  const at = (i: number, j: number) => i * nv + j
  /** A stencil that is the product of a divided difference along u and
   *  one along v, over the net's block at (i, j). */
  const cross = (i: number, j: number, wu: number[], wv: number[], scale: number) => {
    const idx: number[] = []
    const w: number[] = []
    for (let a = 0; a < wu.length; a++) {
      for (let b = 0; b < wv.length; b++) {
        idx.push(at(i + a, j + b))
        w.push(wu[a] * wv[b])
      }
    }
    addStencil(idx, w, scale)
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      if (i + 3 < nu) cross(i, j, dividedWeights(xu, i, 3), [1], area)
      if (j + 3 < nv) cross(i, j, [1], dividedWeights(xv, j, 3), area)
      if (i + 2 < nu && j + 1 < nv) cross(i, j, dividedWeights(xu, i, 2), dividedWeights(xv, j, 1), 3 * area)
      if (i + 1 < nu && j + 2 < nv) cross(i, j, dividedWeights(xu, i, 1), dividedWeights(xv, j, 2), 3 * area)
    }
  }
  // A whisper on the diagonal keeps a net span no point falls in — out in
  // the margin — from making the system singular where the bending term
  // alone does not reach it.
  let diag = 0
  for (let i = 0; i < m; i++) diag += ata[i * m + i]
  for (let i = 0; i < m; i++) ata[i * m + i] += 1e-12 * Math.max(diag / m, 1e-12)
  /** The heights with `extra` added to the system `weight` times. The
   *  solvers work on a copy: the system is solved again with the pull. */
  const solve = (extra: Float64Array | null, weight: number) => {
    const a = Float64Array.from(ata)
    if (extra) for (let i = 0; i < m * m; i++) a[i] += weight * extra[i]
    return choleskySolve(m, a, atb) ?? solveLinear(m, a, atb)
  }
  let heights = solve(null, 0)
  if (!heights) throw new Error('The surface fit is singular — the region is too thin for this net.')

  // The pull. The fairness term leaves every quadratic free, so a cell
  // with no points near it goes on as whatever the last points' edge
  // bent into: a patchy region — a circle in its square box, a boss the
  // robust fit dropped — had its empty corners curl 100 mm off a part
  // 20 mm tall. The cells more than PULL_REACH cells from every cell with
  // a point are pulled toward the region's plane (height 0), by samples
  // standing in for points: `pull` times the points of an average cell
  // with points between them to begin with, and less where that moves
  // the surface at any point by more than PULL_MOVE of the residual the
  // fit leaves anyway — the cells with points stay where the points put
  // them, within their noise, and the empty ones settle back toward the
  // plane within a few cells. When no weight tried does that, the fit
  // goes without the pull, and runAway is the backstop.
  const towardPlane = pull > 0 ? pullSystem(u, v, knotsU, knotsV, nu, nv, p) : null
  if (towardPlane) {
    const free = heights
    const diff = new Float64Array(m)
    let sq = 0
    for (let i = 0; i < n; i++) sq += (h[i] - evalHeight(knotsU, knotsV, nu, nv, p, free, u[i], v[i], bu, bv)) ** 2
    const allowed = Math.max(PULL_MOVE * Math.sqrt(sq / n), PULL_FLOOR)
    let weight = pull * (n / Math.max(1, towardPlane.cells))
    for (let round = 0; round < PULL_ROUNDS; round++) {
      const held = solve(towardPlane.system, weight)
      if (!held) break
      for (let k = 0; k < m; k++) diff[k] = held[k] - free[k]
      let moved = 0
      for (let i = 0; i < n; i++) moved = Math.max(moved, Math.abs(evalHeight(knotsU, knotsV, nu, nv, p, diff, u[i], v[i], bu, bv)))
      if (moved <= allowed) {
        heights = held
        break
      }
      // The surface moves far less than in proportion to the weight —
      // about as its fourth root, from 1e-4 to 0.1 on a bowl — so the
      // weight comes down by the overshoot's fourth power.
      weight *= ((0.8 * allowed) / moved) ** 4
    }
  }

  // Residuals along the normal.
  let sumSq = 0
  let max = 0
  for (let i = 0; i < n; i++) {
    const r = h[i] - evalHeight(knotsU, knotsV, nu, nv, p, heights, u[i], v[i], bu, bv)
    sumSq += r * r
    if (Math.abs(r) > max) max = Math.abs(r)
  }
  return {
    origin: c,
    axisU: au,
    axisV: av,
    normal: an,
    uRange,
    vRange,
    degree: p,
    knotsU,
    knotsV,
    nu,
    nv,
    heights,
    rms: Math.sqrt(sumSq / n),
    max,
    net: { u: nu, v: nv },
  }
}

/** How many of a fit's worst points its report names. */
const WORST_POINTS = 5
/** A robust fit leaves out the points further off than this many robust
 *  sigmas (1.4826 times the residuals' median absolute deviation), and
 *  never closer than ROBUST_FLOOR mm — a clean CAD tessellation has next
 *  to no scatter to measure by. It fits again at most ROBUST_ROUNDS times. */
const ROBUST_SIGMAS = 3
const ROBUST_FLOOR = 0.01
const ROBUST_ROUNDS = 3

/** Each point's distance from the fitted surface along its normal, signed
 *  (positive on the normal's side), mm. */
export function surfaceResiduals(fit: SurfaceFitResult, xyz: Float32Array | Float64Array): Float64Array {
  const n = Math.floor(xyz.length / 3)
  const out = new Float64Array(n)
  const bu = new Float64Array(fit.degree + 1)
  const bv = new Float64Array(fit.degree + 1)
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3] - fit.origin[0], y = xyz[i * 3 + 1] - fit.origin[1], z = xyz[i * 3 + 2] - fit.origin[2]
    const uu = x * fit.axisU[0] + y * fit.axisU[1] + z * fit.axisU[2]
    const vv = x * fit.axisV[0] + y * fit.axisV[1] + z * fit.axisV[2]
    const hh = x * fit.normal[0] + y * fit.normal[1] + z * fit.normal[2]
    out[i] = hh - evalHeight(fit.knotsU, fit.knotsV, fit.nu, fit.nv, fit.degree, fit.heights, uu, vv, bu, bv)
  }
  return out
}

/** The way a region was read off the scan facing (region.normal), where
 *  it was: its normals lie within `withinDeg` of `dir` by construction —
 *  30° where not given, as the region's query has it. */
export interface RegionFacing {
  dir: Vec3
  withinDeg?: number
}
const FACING_DEG = 30

/**
 * Points of a region the fit could not take as its surface's, named so
 * they can be left out: a second sheet over or under the one fitted along
 * its height direction, or a group of the points a robust fit left out
 * far off it. How many of the region's points, the box round them — wide
 * enough to give back as one of region.exclude's boxes — how far off the
 * surface they lie, mm, least and most, and why, in words.
 */
export interface Stray {
  points: number
  box: { min: Vec3; max: Vec3 }
  offMm: [number, number]
  why: string
}

/** A refusal of a fit that names its strays. */
export class StraysRefusal extends Error {
  constructor(
    message: string,
    readonly strays: Stray[],
  ) {
    super(message)
  }
}

/**
 * A surface fitted through the points as fitSurface fits it, with what an
 * answer says of it: the worst points the surface misses, and — asked for
 * a robust fit (params.robust) — how many points it left out. A robust fit
 * fits, leaves out the points past three robust sigmas, and fits the rest
 * again, until nothing more is left out: a rib, a boss or a ragged edge
 * caught in the region does not pull the surface off the skin. A fit that
 * runs away, and a robust fit, name the strays (strayGroups) — a fit that
 * runs away is refused with them (StraysRefusal). `facing` is the way the
 * region was read facing, where it was.
 */
export function fitSurfaceReported(
  xyz: Float32Array | Float64Array,
  params: SurfaceFitParams,
  facing?: RegionFacing,
): { fit: SurfaceFitResult; worst: { at: [number, number, number]; off: number }[]; dropped: number; strays?: Stray[] } {
  let points = xyz
  let fit = fitSurface(points, params)
  let dropped = 0
  // The last round's centre and limit: what the robust fit's dropped
  // points are told by.
  let robustAt: { med: number; limit: number } | null = null
  for (let round = 0; params.robust && round < ROBUST_ROUNDS; round++) {
    const r = surfaceResiduals(fit, points)
    const sorted = Float64Array.from(r).sort()
    const med = sorted[sorted.length >> 1]
    const dev = Float64Array.from(r, (x) => Math.abs(x - med)).sort()
    const limit = Math.max(ROBUST_SIGMAS * 1.4826 * dev[dev.length >> 1], ROBUST_FLOOR)
    robustAt = { med, limit }
    const keep: number[] = []
    for (let i = 0; i < r.length; i++) if (Math.abs(r[i] - med) <= limit) keep.push(i)
    if (keep.length === r.length || keep.length < 16) break
    const next = new Float64Array(keep.length * 3)
    keep.forEach((i, k) => next.set([points[i * 3], points[i * 3 + 1], points[i * 3 + 2]], k * 3))
    dropped += r.length - keep.length
    points = next
    fit = fitSurface(points, params)
  }
  const away = runAway(fit, xyz, params.expandPct, params.normal, facing)
  if (away) {
    const strays = strayGroups(fit, xyz, robustAt)
    throw new StraysRefusal(`${away}${straysWords(strays)}`, strays)
  }
  const r = surfaceResiduals(fit, points)
  const order = Array.from(r.keys()).sort((a, b) => Math.abs(r[b]) - Math.abs(r[a])).slice(0, WORST_POINTS)
  const worst = order.map((i) => ({ at: [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]] as [number, number, number], off: r[i] }))
  const strays = params.robust ? strayGroups(fit, xyz, robustAt) : []
  // The whole region, the points a robust fit left out among them: its
  // outline is the region's as it was marked.
  fit.footprint = footprintOf(fit, xyz)
  return { fit, worst, dropped, ...(strays.length > 0 ? { strays } : {}) }
}

/** The points over a fit's plane, (u, v) pairs (SurfaceFitResult
 *  footprint). */
export function footprintOf(fit: Pick<SurfaceFitResult, 'origin' | 'axisU' | 'axisV'>, xyz: ArrayLike<number>): Float32Array {
  const n = Math.floor(xyz.length / 3)
  const out = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3] - fit.origin[0], y = xyz[i * 3 + 1] - fit.origin[1], z = xyz[i * 3 + 2] - fit.origin[2]
    out[i * 2] = x * fit.axisU[0] + y * fit.axisU[1] + z * fit.axisU[2]
    out[i * 2 + 1] = x * fit.axisV[0] + y * fit.axisV[1] + z * fit.axisV[2]
  }
  return out
}

/** The cells a second sheet is looked for in are about this wide, mm — and
 *  never narrower than twice the points' spacing, so each holds a few — and
 *  a cell holds two sheets where its points' heights part by more than
 *  SHEET_GAP_MM. A cell's sheet is told from the second by the heights of
 *  the cells with one sheet within SHEET_REACH cells of it. */
const SHEET_CELL_MM = 2
const SHEET_GAP_MM = 1
const SHEET_REACH = 2
/** A robust fit's dropped points further off its surface than this, mm,
 *  and twice its limit, are strays — what lies nearer is the skin's own
 *  scatter at an edge — clustered on a grid this many mm wide. */
const STRAY_FAR_MM = 1
const STRAY_VOXEL_MM = 5
/** A group of fewer points than this is scatter, not a stray. */
const STRAY_MIN_POINTS = 10
/** How many strays are named, the largest first; and the share of the
 *  region a stray's box may hold. */
const STRAYS_NAMED = 6
const STRAY_MOST = 0.8
/** How far a stray's box reaches past its points, mm: the region's points
 *  are every k-th of the scan's (SURFACE_REGION_LIMIT), and the box given
 *  back as an exclude has to take the scan's points between them too. */
const STRAY_PAD_MM = 1

/**
 * The strays of a region against the surface fitted through it, the
 * largest first (Stray): two cheap reads of the points, made where a fit is
 * refused or a robust fit is answered.
 *  - Second sheets (secondSheets): the points' heights off the fit, in
 *    cells about 2 mm wide over its plane, a cell whose heights part by
 *    more than a millimetre holding two surfaces — the inside of a cup
 *    under its rim, a gutter beside a flange — which no height field is.
 *    The cells' far sheets are flood-joined into groups.
 *  - With `robust`, the robust fit's last centre and limit: the points it
 *    left out far off the surface, clustered on a 5 mm grid.
 */
export function strayGroups(fit: SurfaceFitResult, xyz: ArrayLike<number>, robust: { med: number; limit: number } | null): Stray[] {
  // A second sheet's points the robust fit left out too are named once,
  // as the sheet.
  const named = new Set<number>()
  const sheets = secondSheets(fit, xyz, named)
  const out = [...sheets, ...(robust ? farPoints(fit, xyz, robust, named) : [])]
  // A box that would leave out most of the region is no stray's — a rim
  // the fit does not follow, all the way round — and is not named.
  const n = Math.floor(xyz.length / 3)
  const most = (s: Stray) => {
    let within = 0
    for (let i = 0; i < n; i++) if ([0, 1, 2].every((k) => xyz[i * 3 + k] >= s.box.min[k] && xyz[i * 3 + k] <= s.box.max[k])) within++
    return within > STRAY_MOST * n
  }
  return out
    .sort((a, b) => b.points - a.points)
    .filter((s) => !most(s))
    .slice(0, STRAYS_NAMED)
}

/** A range of millimetres as a stray's words give it. */
const rangeMm = (lo: number, hi: number) => (r1(lo) === r1(hi) ? `${r1(lo)}` : `${r1(lo)}–${r1(hi)}`)

/** A box round some of the points, STRAY_PAD_MM wider every way, its
 *  numbers rounded outward to a tenth. */
function strayBox(xyz: ArrayLike<number>, members: readonly number[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const i of members) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], xyz[i * 3 + k])
      max[k] = Math.max(max[k], xyz[i * 3 + k])
    }
  }
  return {
    min: min.map((x) => Math.floor((x - STRAY_PAD_MM) * 10) / 10 + 0) as Vec3,
    max: max.map((x) => Math.ceil((x + STRAY_PAD_MM) * 10) / 10 + 0) as Vec3,
  }
}

const r1 = (x: number) => Math.round(x * 10) / 10

/** The groups of keys joined by `near`, each key once: a flood fill over
 *  the cells of a grid. */
function floodGroups<K>(keys: Iterable<K>, near: (key: K) => K[]): K[][] {
  const left = new Set(keys)
  const groups: K[][] = []
  for (const start of [...left]) {
    if (!left.has(start)) continue
    left.delete(start)
    const group = [start]
    for (let at = 0; at < group.length; at++) {
      for (const n of near(group[at])) {
        if (!left.has(n)) continue
        left.delete(n)
        group.push(n)
      }
    }
    groups.push(group)
  }
  return groups
}

/** The second sheets along a fit's height direction (strayGroups). */
function secondSheets(fit: SurfaceFitResult, xyz: ArrayLike<number>, named: Set<number>): Stray[] {
  const n = Math.floor(xyz.length / 3)
  if (n < 4) return []
  const u = new Float64Array(n)
  const v = new Float64Array(n)
  // Each point's height off the fit, not over its plane: a steep slope
  // across a cell is no gap between its heights, where it is followed.
  const h = new Float64Array(n)
  const bu = new Float64Array(fit.degree + 1)
  const bv = new Float64Array(fit.degree + 1)
  let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3] - fit.origin[0], y = xyz[i * 3 + 1] - fit.origin[1], z = xyz[i * 3 + 2] - fit.origin[2]
    u[i] = x * fit.axisU[0] + y * fit.axisU[1] + z * fit.axisU[2]
    v[i] = x * fit.axisV[0] + y * fit.axisV[1] + z * fit.axisV[2]
    h[i] = x * fit.normal[0] + y * fit.normal[1] + z * fit.normal[2] - evalHeight(fit.knotsU, fit.knotsV, fit.nu, fit.nv, fit.degree, fit.heights, u[i], v[i], bu, bv)
    uLo = Math.min(uLo, u[i])
    uHi = Math.max(uHi, u[i])
    vLo = Math.min(vLo, v[i])
    vHi = Math.max(vHi, v[i])
  }
  const spacing = Math.sqrt(Math.max((uHi - uLo) * (vHi - vLo), 1e-12) / n)
  const size = Math.max(SHEET_CELL_MM, 2 * spacing)
  const cols = Math.floor((vHi - vLo) / size) + 1
  const cellOf = (i: number) => Math.floor((u[i] - uLo) / size) * cols + Math.floor((v[i] - vLo) / size)
  const cells = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const c = cellOf(i)
    const list = cells.get(c)
    if (list) list.push(i)
    else cells.set(c, [i])
  }
  const median = (list: readonly number[]) => {
    const s = list.map((i) => h[i]).sort((a, b) => a - b)
    return s[s.length >> 1]
  }
  // Each cell's one sheet's height, or its two sheets split at the widest
  // gap between its heights.
  const single = new Map<number, number>()
  const parted = new Map<number, [number[], number[]]>()
  for (const [c, list] of cells) {
    list.sort((a, b) => h[a] - h[b])
    let gap = 0, at = 0
    for (let j = 1; j < list.length; j++) if (h[list[j]] - h[list[j - 1]] > gap) [gap, at] = [h[list[j]] - h[list[j - 1]], j]
    if (gap > SHEET_GAP_MM) parted.set(c, [list.slice(0, at), list.slice(at)])
    else single.set(c, median(list))
  }
  if (parted.size === 0) return []
  // The far sheet of each parted cell: the one further from the heights
  // of the cells round it with one sheet — or, with none round it, from
  // the fit, which a robust fit lays on the sheet it keeps. Each far
  // point's height off the sheet kept.
  const far = new Map<number, { members: number[]; off: number[] }>()
  for (const [c, [under, over]] of parted) {
    const cu = Math.floor(c / cols), cv = c % cols
    const round: number[] = []
    for (let a = -SHEET_REACH; a <= SHEET_REACH; a++) {
      for (let b = -SHEET_REACH; b <= SHEET_REACH; b++) {
        const hh = cv + b >= 0 && cv + b < cols ? single.get((cu + a) * cols + cv + b) : undefined
        if (hh !== undefined) round.push(hh)
      }
    }
    const mu = median(under), mo = median(over)
    round.sort((a, b) => a - b)
    const ref = round.length > 0 ? round[round.length >> 1] : 0
    const underFar = Math.abs(mu - ref) > Math.abs(mo - ref)
    const [members, kept] = underFar ? [under, mo] : [over, mu]
    far.set(c, { members, off: members.map((i) => h[i] - kept) })
  }
  // Cells side by side are one stray, whatever their heights: the inside
  // of a cup seen along a tilted height direction runs on in steps a
  // sheet's height apart, and is one box to leave out.
  const groups = floodGroups(far.keys(), (c) => {
    const cu = Math.floor(c / cols), cv = c % cols
    const out: number[] = []
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((a || b) && cv + b >= 0 && cv + b < cols && far.has((cu + a) * cols + cv + b)) out.push((cu + a) * cols + cv + b)
    return out
  })
  const strays: Stray[] = []
  for (const group of groups) {
    const members = group.flatMap((c) => far.get(c)!.members)
    if (members.length < STRAY_MIN_POINTS) continue
    for (const i of members) named.add(i)
    // units-ok: build message, also the agent's answer
    strays.push(strayOf(xyz, members, group.flatMap((c) => far.get(c)!.off), (mm, side) => `a second sheet ${mm} mm ${side} the one fitted, along its height direction — no height field holds both`))
  }
  return strays
}

/** A stray of the points `members`, each `offs` off the surface (signed
 *  along its normal), worded by `why` from the range and the side most
 *  of them lie on. */
function strayOf(xyz: ArrayLike<number>, members: readonly number[], offs: readonly number[], why: (mm: string, side: 'under' | 'over') => string): Stray {
  let lo = Infinity, hi = 0, under = 0
  for (const x of offs) {
    lo = Math.min(lo, Math.abs(x))
    hi = Math.max(hi, Math.abs(x))
    if (x < 0) under++
  }
  return { points: members.length, box: strayBox(xyz, members), offMm: [r1(lo), r1(hi)], why: why(rangeMm(lo, hi), under > offs.length / 2 ? 'under' : 'over') }
}

/** The points a robust fit left out far off its surface, in groups
 *  (strayGroups). */
function farPoints(fit: SurfaceFitResult, xyz: ArrayLike<number>, robust: { med: number; limit: number }, named: ReadonlySet<number>): Stray[] {
  const r = surfaceResiduals(fit, xyz as Float64Array)
  const beyond = Math.max(STRAY_FAR_MM, 2 * robust.limit)
  const voxels = new Map<string, number[]>()
  for (let i = 0; i < r.length; i++) {
    if (!(Math.abs(r[i] - robust.med) > beyond) || named.has(i)) continue
    const key = `${Math.floor(xyz[i * 3] / STRAY_VOXEL_MM)},${Math.floor(xyz[i * 3 + 1] / STRAY_VOXEL_MM)},${Math.floor(xyz[i * 3 + 2] / STRAY_VOXEL_MM)}`
    const list = voxels.get(key)
    if (list) list.push(i)
    else voxels.set(key, [i])
  }
  const groups = floodGroups(voxels.keys(), (key) => {
    const [x, y, z] = key.split(',').map(Number)
    const out: string[] = []
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) out.push(`${x + a},${y + b},${z + c}`)
    return out
  })
  const strays: Stray[] = []
  for (const group of groups) {
    const members = group.flatMap((key) => voxels.get(key)!)
    if (members.length < STRAY_MIN_POINTS) continue
    // units-ok: build message, also the agent's answer
    strays.push(strayOf(xyz, members, members.map((i) => r[i]), (mm, side) => `left out by the robust fit, ${mm} mm ${side} its surface`))
  }
  return strays
}

/** The strays as a refusal ends on them: the largest named, the rest
 *  counted — or nothing, for none. */
function straysWords(strays: readonly Stray[]): string {
  if (strays.length === 0) return ''
  const at = (b: Stray['box']) => `(${b.min.join(', ')})–(${b.max.join(', ')})`
  const named = strays.slice(0, 2).map((s) => `${s.points} points ${s.why.replace(/ — .*$/, '')} in ${at(s.box)}`)
  const more = strays.length > 2 ? `, and ${strays.length - 2} more` : ''
  return ` Strays (strays): ${named.join('; ')}${more} — give their boxes in region.exclude and fit again.`
}

/** How far past its points' heights a fitted surface may stand, beyond
 *  its margin, as a share of the region's extent (runAway). */
const RUNAWAY_SHARE = 0.25
/** How far a region's normals may turn from its height direction, degrees
 *  (the 95th percentile), and still be one height field over it: past it,
 *  the region bends round — a shell over a shoulder. */
export const HEIGHT_FIELD_DEG = 70
/** How many of a region's points its normals' spread is read at, at most. */
const SPREAD_POINTS = 5000

/** How far a region's normals turn from a height direction: each normal
 *  a plane through the points within a few spacings of a point (their
 *  least scatter), its angle from the direction either way round, degrees
 *  — the 95th percentile. Read off the points, not off a fit that may have
 *  run away from them. Not the most: a plane through a rim's or a thin
 *  strip's points turns any way, 89° on a region that fits at 0.06 mm. */
export function normalSpread(xyz: ArrayLike<number>, normal: Vec3): { p95: number } {
  const n = Math.floor(xyz.length / 3)
  if (n < 4) return { p95: 0 }
  // The points' spacing, from the area of the two longer sides of their box.
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], xyz[i * 3 + k])
    hi[k] = Math.max(hi[k], xyz[i * 3 + k])
  }
  const sides = [0, 1, 2].map((k) => hi[k] - lo[k]).sort((a, b) => b - a)
  const reach = 3 * Math.sqrt(Math.max(sides[0] * sides[1], 1e-12) / n)
  const key = (x: number, y: number, z: number) => `${Math.floor(x / reach)},${Math.floor(y / reach)},${Math.floor(z / reach)}`
  const cells = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const k = key(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2])
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  }
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1
  const step = Math.max(1, Math.ceil(n / SPREAD_POINTS))
  const angles: number[] = []
  const c = new Float64Array(9)
  for (let i = 0; i < n; i += step) {
    const px = xyz[i * 3], py = xyz[i * 3 + 1], pz = xyz[i * 3 + 2]
    const cx = Math.floor(px / reach), cy = Math.floor(py / reach), cz = Math.floor(pz / reach)
    const near: number[] = []
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      for (const j of cells.get(`${cx + a},${cy + b},${cz + d}`) ?? []) if (Math.hypot(xyz[j * 3] - px, xyz[j * 3 + 1] - py, xyz[j * 3 + 2] - pz) <= reach) near.push(j)
    }
    if (near.length < 6) continue
    let mx = 0, my = 0, mz = 0
    for (const j of near) {
      mx += xyz[j * 3]
      my += xyz[j * 3 + 1]
      mz += xyz[j * 3 + 2]
    }
    mx /= near.length
    my /= near.length
    mz /= near.length
    c.fill(0)
    for (const j of near) {
      const x = xyz[j * 3] - mx, y = xyz[j * 3 + 1] - my, z = xyz[j * 3 + 2] - mz
      c[0] += x * x
      c[1] += x * y
      c[2] += x * z
      c[4] += y * y
      c[5] += y * z
      c[8] += z * z
    }
    c[3] = c[1]
    c[6] = c[2]
    c[7] = c[5]
    const m = symmetricEigen3(c).vectors[0]
    const cos = Math.abs(m[0] * normal[0] + m[1] * normal[1] + m[2] * normal[2]) / len
    angles.push((Math.acos(Math.min(1, cos)) * 180) / Math.PI)
  }
  if (angles.length === 0) return { p95: 0 }
  angles.sort((a, b) => a - b)
  return { p95: angles[Math.min(angles.length - 1, Math.floor(0.95 * angles.length))] }
}

/**
 * Why a fitted surface is no surface of its points, or null: where it
 * leaves the points' height range over its plane by more than its margin
 * plus a quarter of the region's extent — the margin, because a surface
 * sloping at 45° stands that far past its points at the margin's edge;
 * the quarter, for the bend a curved patch carries on with. A fit that
 * stands further off has run away where the points run out, and the
 * answer names the spot, and the last point before it. The pull toward
 * the plane (fitSurface) keeps a fit from it; this is the backstop, and
 * what keeps a surface a hundred times its region's size from going on
 * to the kernel and its mesher. `facing`: the way the region was read
 * facing, which bounds its normals — said in place of their spread.
 */
export function runAway(fit: SurfaceFitResult, xyz: Float32Array | Float64Array, expandPct: number, asked?: Vec3, facing?: RegionFacing): string | null {
  const n = Math.floor(xyz.length / 3)
  if (n === 0) return null
  const pu = new Float64Array(n)
  const pv = new Float64Array(n)
  let hLo = Infinity, hHi = -Infinity, uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3] - fit.origin[0], y = xyz[i * 3 + 1] - fit.origin[1], z = xyz[i * 3 + 2] - fit.origin[2]
    pu[i] = x * fit.axisU[0] + y * fit.axisU[1] + z * fit.axisU[2]
    pv[i] = x * fit.axisV[0] + y * fit.axisV[1] + z * fit.axisV[2]
    const hh = x * fit.normal[0] + y * fit.normal[1] + z * fit.normal[2]
    hLo = Math.min(hLo, hh)
    hHi = Math.max(hHi, hh)
    uLo = Math.min(uLo, pu[i])
    uHi = Math.max(uHi, pu[i])
    vLo = Math.min(vLo, pv[i])
    vHi = Math.max(vHi, pv[i])
  }
  const extent = Math.max(uHi - uLo, vHi - vLo)
  const allowed = (extent * Math.max(0, expandPct)) / 200 + RUNAWAY_SHARE * extent
  // The surface sampled as the kernel gets it.
  const rows = Math.max(4, (fit.nu - 1) * GRID_PER_SPAN + 1)
  const cols = Math.max(4, (fit.nv - 1) * GRID_PER_SPAN + 1)
  let worst = 0, wu = 0, wv = 0, wh = 0
  for (let r = 0; r < rows; r++) {
    const uu = fit.uRange[0] + ((fit.uRange[1] - fit.uRange[0]) * r) / (rows - 1)
    for (let c = 0; c < cols; c++) {
      const vv = fit.vRange[0] + ((fit.vRange[1] - fit.vRange[0]) * c) / (cols - 1)
      const hh = evalHeight(fit.knotsU, fit.knotsV, fit.nu, fit.nv, fit.degree, fit.heights, uu, vv)
      const off = Math.max(hh - hHi, hLo - hh)
      if (off > worst) [worst, wu, wv, wh] = [off, uu, vv, hh]
    }
  }
  if (!(worst > allowed)) return null
  // The last point before the spot: the nearest over the plane.
  let last = 0, best = Infinity
  for (let i = 0; i < n; i++) {
    const d = (pu[i] - wu) ** 2 + (pv[i] - wv) ** 2
    if (d < best) [best, last] = [d, i]
  }
  const at = (uu: number, vv: number, hh: number) => [0, 1, 2].map((k) => (fit.origin[k] + uu * fit.axisU[k] + vv * fit.axisV[k] + hh * fit.normal[k]).toFixed(1)).join(', ')
  const lastAt = [xyz[last * 3], xyz[last * 3 + 1], xyz[last * 3 + 2]].map((x) => x.toFixed(1)).join(', ')
  // The height direction it was fitted along, and how far the region
  // turns from it: past HEIGHT_FIELD_DEG no height field holds it. A
  // region read facing a way has its normals within the query's angle of
  // that by construction — what is said then, not a spread that reads the
  // query's own angle back.
  const spread = normalSpread(xyz, fit.normal)
  const dirOf = (d: readonly number[]) => `[${d.map((x) => (Math.round(x * 1000) / 1000 + 0).toString()).join(', ')}]`
  const normal = dirOf(fit.normal)
  const faced = facing ? (() => {
    const len = Math.hypot(...facing.dir) || 1
    const dir = facing.dir.map((x) => x / len)
    const within = facing.withinDeg ?? FACING_DEG
    const apart = (Math.acos(Math.min(1, Math.abs(dir[0] * fit.normal[0] + dir[1] * fit.normal[1] + dir[2] * fit.normal[2]))) * 180) / Math.PI
    return { dir, within, apart }
  })() : null
  const along = faced
    ? `Its height direction was ${normal} (${asked ? 'fit.normal' : 'the region’s principal normal'}); the region was read facing ${dirOf(faced.dir)} within ${r1(faced.within)}°, so its normals are within ${r1(faced.within)}° of that by construction${faced.apart >= 1 ? `, ${Math.round(faced.apart)}° off the height direction` : ''}.`
    : `Its height direction was ${normal} (${asked ? 'fit.normal' : 'the region’s principal normal'}); 95 % of the region’s normals are within ${Math.round(spread.p95)}° of it.`
  const bends = spread.p95 > HEIGHT_FIELD_DEG && !(faced && faced.within + faced.apart <= HEIGHT_FIELD_DEG)
  const direction = asked ? '' : faced && faced.apart >= 1 ? ` — or give fit.normal: ${dirOf(faced.dir)}, the way the region was read facing, for its height direction` : ' — or give fit.normal, the way the region faces, for its height direction'
  const advice = bends
    ? 'The region bends round past what one height field holds — split it, or loft through stations.'
    : `Fit a coarser net, keep the region to one surface (a box closer round it, or exclude what stands off it), or take less margin${direction}.`
  return (
    // units-ok: build message, also the agent's answer
    `The surface runs away from its points: it stands ${r1(worst)} mm ${wh > hHi ? 'above the highest' : 'below the lowest'} of them at (${at(wu, wv, wh)}), ` +
    // units-ok: build message, also the agent's answer
    `${r1(Math.sqrt(best))} mm past where the region's points run out at (${lastAt}) — more than the margin and a quarter of the region's ${r1(extent)} mm allow. ` +
    `${along} ${advice}`
  )
}

/**
 * About how many triangles the kernel's mesher makes of a fitted surface
 * at a chord (and its angle, as ReKernel.mesh takes them), read off the
 * fit before the surface is made. Over a sampling a few times finer than
 * the net, each patch takes the edge the mesher may lay where it bends
 * most — the chord's sqrt(8 · chord / κ), or the angle's angle / κ where
 * that is shorter — the same both ways, as the mesher keeps its triangles
 * from growing long and thin along the way a surface does not bend, and
 * MESH_SURPLUS times the triangles of that edge that fill the patch: the
 * mesher lays more than the fewest that would do. Within a factor of two
 * or so of what it makes (tests/reSurfaceRunaway): enough to refuse a
 * surface that bends so often it would mesh for minutes.
 */
export function meshTriangles(fit: SurfaceFitResult, chord: number, angle = 0.15): number {
  const su = Math.max(4, (fit.nu - 1) * 4)
  const sv = Math.max(4, (fit.nv - 1) * 4)
  const du = (fit.uRange[1] - fit.uRange[0]) / su
  const dv = (fit.vRange[1] - fit.vRange[0]) / sv
  const whole = Math.min(fit.uRange[1] - fit.uRange[0], fit.vRange[1] - fit.vRange[0])
  const h = (uu: number, vv: number) => evalHeight(fit.knotsU, fit.knotsV, fit.nu, fit.nv, fit.degree, fit.heights, uu, vv)
  let total = 0
  for (let a = 0; a < su; a++) {
    const uu = fit.uRange[0] + du * (a + 0.5)
    for (let b = 0; b < sv; b++) {
      const vv = fit.vRange[0] + dv * (b + 0.5)
      const h0 = h(uu, vv)
      const hu = (h(uu + du / 2, vv) - h(uu - du / 2, vv)) / du
      const hv = (h(uu, vv + dv / 2) - h(uu, vv - dv / 2)) / dv
      const huu = (h(uu + du / 2, vv) - 2 * h0 + h(uu - du / 2, vv)) / ((du * du) / 4)
      const hvv = (h(uu, vv + dv / 2) - 2 * h0 + h(uu, vv - dv / 2)) / ((dv * dv) / 4)
      const w = Math.sqrt(1 + hu * hu + hv * hv)
      // The normal curvature along each parameter line; the larger rules.
      const k = Math.max(Math.abs(huu) / (w * (1 + hu * hu)), Math.abs(hvv) / (w * (1 + hv * hv)))
      const edge = Math.min(whole, k > 1e-12 ? Math.min(Math.sqrt((8 * chord) / k), angle / k) : Infinity)
      total += (2 * du * dv * w) / (edge * edge)
    }
  }
  return Math.round(MESH_SURPLUS * total)
}

/** The pull's system (fitSurface): for each net cell further than
 *  PULL_REACH cells from every cell with a point, PULL_SAMPLES² samples
 *  at height 0, each weighing a PULL_SAMPLES²-th of one point — or null
 *  when every cell has points within reach. `cells` is how many cells
 *  have points, for the weight of an average one. */
function pullSystem(
  u: Float64Array,
  v: Float64Array,
  knotsU: Float64Array,
  knotsV: Float64Array,
  nu: number,
  nv: number,
  p: number,
): { system: Float64Array; cells: number } | null {
  const cu = nu - p
  const cv = nv - p
  const held = new Uint8Array(cu * cv)
  for (let i = 0; i < u.length; i++) held[(findSpan(knotsU, nu, p, u[i]) - p) * cv + (findSpan(knotsV, nv, p, v[i]) - p)] = 1
  let cells = 0
  for (const x of held) cells += x
  const near = (a: number, b: number) => {
    for (let i = Math.max(0, a - PULL_REACH); i <= Math.min(cu - 1, a + PULL_REACH); i++) {
      for (let j = Math.max(0, b - PULL_REACH); j <= Math.min(cv - 1, b + PULL_REACH); j++) if (held[i * cv + j]) return true
    }
    return false
  }
  const m = nu * nv
  const system = new Float64Array(m * m)
  const bu = new Float64Array(p + 1)
  const bv = new Float64Array(p + 1)
  const w = 1 / (PULL_SAMPLES * PULL_SAMPLES)
  let pulled = false
  for (let a = 0; a < cu; a++) {
    for (let b = 0; b < cv; b++) {
      if (near(a, b)) continue
      pulled = true
      for (let s = 0; s < PULL_SAMPLES; s++) {
        basisFunctions(knotsU, p + a, p, knotsU[p + a] + ((knotsU[p + a + 1] - knotsU[p + a]) * (s + 0.5)) / PULL_SAMPLES, bu)
        for (let t = 0; t < PULL_SAMPLES; t++) {
          basisFunctions(knotsV, p + b, p, knotsV[p + b] + ((knotsV[p + b + 1] - knotsV[p + b]) * (t + 0.5)) / PULL_SAMPLES, bv)
          for (let a1 = 0; a1 <= p; a1++) {
            for (let b1 = 0; b1 <= p; b1++) {
              const row = ((a + a1) * nv + b + b1) * m
              const va = w * bu[a1] * bv[b1]
              for (let a2 = 0; a2 <= p; a2++) {
                for (let b2 = 0; b2 <= p; b2++) system[row + (a + a2) * nv + b + b2] += va * bu[a2] * bv[b2]
              }
            }
          }
        }
      }
    }
  }
  return pulled ? { system, cells } : null
}

/** The weights of the `order`-th divided difference over the nodes
 *  x[from … from + order], scaled by order! so it reads as the derivative
 *  — zero on every polynomial below that order, at any spacing. */
function dividedWeights(x: ArrayLike<number>, from: number, order: number): number[] {
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

function clampNet(count: number, p: number): number {
  return Math.max(Math.max(NET_MIN, p + 1), Math.min(NET_MAX, Math.round(count)))
}

/** The fitted height at (u, v). */
function evalHeight(
  knotsU: Float64Array,
  knotsV: Float64Array,
  nu: number,
  nv: number,
  p: number,
  heights: Float64Array,
  uu: number,
  vv: number,
  bu = new Float64Array(p + 1),
  bv = new Float64Array(p + 1),
): number {
  const su = findSpan(knotsU, nu, p, uu)
  const sv = findSpan(knotsV, nv, p, vv)
  basisFunctions(knotsU, su, p, uu, bu)
  basisFunctions(knotsV, sv, p, vv, bv)
  let s = 0
  for (let a = 0; a <= p; a++) {
    const row = (su - p + a) * nv
    for (let b = 0; b <= p; b++) s += bu[a] * bv[b] * heights[row + (sv - p + b)]
  }
  return s
}

/** The fitted point at (u, v), in the part's frame. */
export function evalSurface(fit: SurfaceFitResult, uu: number, vv: number): Vec3 {
  const hh = evalHeight(fit.knotsU, fit.knotsV, fit.nu, fit.nv, fit.degree, fit.heights, uu, vv)
  return [
    fit.origin[0] + uu * fit.axisU[0] + vv * fit.axisV[0] + hh * fit.normal[0],
    fit.origin[1] + uu * fit.axisU[1] + vv * fit.axisV[1] + hh * fit.normal[1],
    fit.origin[2] + uu * fit.axisU[2] + vv * fit.axisV[2] + hh * fit.normal[2],
  ]
}

/** The fitted surface sampled on a regular grid for the kernel: `rows`
 *  along u, `cols` along v, the points row-major and flat — `perSpan`
 *  samples a net span, GRID_PER_SPAN unless the kernel's surface through
 *  those did not follow the fit (GRID_RETRIES). */
export function gridOf(fit: SurfaceFitResult, perSpan = GRID_PER_SPAN): { points: Float64Array; rows: number; cols: number } {
  const rows = Math.max(4, (fit.nu - 1) * perSpan + 1)
  const cols = Math.max(4, (fit.nv - 1) * perSpan + 1)
  const points = new Float64Array(rows * cols * 3)
  for (let r = 0; r < rows; r++) {
    const uu = fit.uRange[0] + ((fit.uRange[1] - fit.uRange[0]) * r) / (rows - 1)
    for (let cc = 0; cc < cols; cc++) {
      const vv = fit.vRange[0] + ((fit.vRange[1] - fit.vRange[0]) * cc) / (cols - 1)
      const q = evalSurface(fit, uu, vv)
      points.set(q, (r * cols + cc) * 3)
    }
  }
  return { points, rows, cols }
}

/** The area of a grid's facets, two triangles a cell: what the kernel's
 *  surface through the grid should have, near enough. */
export function gridArea(grid: { points: Float64Array; rows: number; cols: number }): number {
  const g = grid.points
  let area = 0
  for (let r = 0; r + 1 < grid.rows; r++) {
    for (let c = 0; c + 1 < grid.cols; c++) {
      const a = (r * grid.cols + c) * 3
      const b = a + 3
      const d = a + grid.cols * 3
      const e = d + 3
      for (const [p, q, o] of [[a, b, e], [a, e, d]]) {
        const x0 = g[q] - g[p], x1 = g[q + 1] - g[p + 1], x2 = g[q + 2] - g[p + 2]
        const y0 = g[o] - g[p], y1 = g[o + 1] - g[p + 1], y2 = g[o + 2] - g[p + 2]
        area += 0.5 * Math.hypot(x1 * y2 - x2 * y1, x2 * y0 - x0 * y2, x0 * y1 - x1 * y0)
      }
    }
  }
  return area
}

/** The (u, v) a surface needs to span to reach over a body — its points
 *  (x, y, z flat: its mesh's) in the surface's frame, `margin` mm wider
 *  either way, and its own range — or null where it spans that already.
 *  Over the body's points, not its box's corners: a body standing askew to
 *  the surface has corners of its box far past itself — on the lamp's
 *  outline prism u −120…97 where the prism needs −90…68 — and a freeform
 *  carried on that far came back from the kernel kilometres wide. */
export function reachOver(fit: Pick<SurfaceFitResult, 'origin' | 'axisU' | 'axisV' | 'uRange' | 'vRange'>, points: ArrayLike<number>, margin: number): { u: [number, number]; v: [number, number] } | null {
  let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity
  for (let i = 0; i + 2 < points.length; i += 3) {
    const d: Vec3 = [points[i] - fit.origin[0], points[i + 1] - fit.origin[1], points[i + 2] - fit.origin[2]]
    const u = d[0] * fit.axisU[0] + d[1] * fit.axisU[1] + d[2] * fit.axisU[2]
    const v = d[0] * fit.axisV[0] + d[1] * fit.axisV[1] + d[2] * fit.axisV[2]
    uLo = Math.min(uLo, u)
    uHi = Math.max(uHi, u)
    vLo = Math.min(vLo, v)
    vHi = Math.max(vHi, v)
  }
  const u: [number, number] = [Math.min(fit.uRange[0], uLo - margin), Math.max(fit.uRange[1], uHi + margin)]
  const v: [number, number] = [Math.min(fit.vRange[0], vLo - margin), Math.max(fit.vRange[1], vHi + margin)]
  if (u[0] === fit.uRange[0] && u[1] === fit.uRange[1] && v[0] === fit.vRange[0] && v[1] === fit.vRange[1]) return null
  return { u, v }
}

/** The height of a fitted surface at (u, v) as a split carries it on
 *  (reachingGridOf): the fit's own within its range; past its edge, flat
 *  along the slope it has there, read just inside it. */
export function carriedHeight(fit: SurfaceFitResult, uu: number, vv: number): number {
  const eu = (fit.uRange[1] - fit.uRange[0]) * 1e-4
  const ev = (fit.vRange[1] - fit.vRange[0]) * 1e-4
  const h = (a: number, b: number) => evalHeight(fit.knotsU, fit.knotsV, fit.nu, fit.nv, fit.degree, fit.heights, a, b)
  const cu = Math.min(fit.uRange[1], Math.max(fit.uRange[0], uu))
  const cv = Math.min(fit.vRange[1], Math.max(fit.vRange[0], vv))
  const at = h(cu, cv)
  if (cu === uu && cv === vv) return at
  const du = cu === uu ? 0 : (cu === fit.uRange[1] ? at - h(cu - eu, cv) : h(cu + eu, cv) - at) / eu
  const dv = cv === vv ? 0 : (cv === fit.vRange[1] ? at - h(cu, cv - ev) : h(cu, cv + ev) - at) / ev
  return at + du * (uu - cu) + dv * (vv - cv)
}

/** How many samples a side the grid of a surface carried on takes at
 *  most. */
const REACH_SAMPLES = 96

/**
 * The fitted surface sampled for the kernel, carried on past its own range
 * to span `u` and `v`. Past its edge it does not go on as its polynomial —
 * that curls away from the data the further out it is taken — but flat,
 * along the slope it has at the edge: the plane tangent to it there,
 * carried out. What a split cuts a body with when the surface as fitted
 * stops short of the body's sides. The samples are evenly spaced, at
 * gridOf's spacing where REACH_SAMPLES allows: the kernel spaces its
 * parameters by the samples' count, not their distance, and a grid that
 * spreads out past the edge came back from it bulging between them.
 * `perSpan` as gridOf's: denser where the kernel's surface through the
 * first grid did not follow it.
 */
export function reachingGridOf(fit: SurfaceFitResult, u: [number, number], v: [number, number], perSpan = GRID_PER_SPAN): { points: Float64Array; rows: number; cols: number } {
  const inner = gridOf(fit, perSpan)
  const along = (range: [number, number], reach: [number, number], n: number): number[] => {
    const step = (range[1] - range[0]) / (n - 1)
    const count = Math.min(REACH_SAMPLES, Math.max(n, Math.ceil((reach[1] - reach[0]) / step) + 1))
    return Array.from({ length: count }, (_, i) => reach[0] + ((reach[1] - reach[0]) * i) / (count - 1))
  }
  const us = along(fit.uRange, u, inner.rows)
  const vs = along(fit.vRange, v, inner.cols)
  const points = new Float64Array(us.length * vs.length * 3)
  us.forEach((uu, r) => {
    vs.forEach((vv, c) => {
      const hh = carriedHeight(fit, uu, vv)
      const o = (r * vs.length + c) * 3
      for (let k = 0; k < 3; k++) points[o + k] = fit.origin[k] + uu * fit.axisU[k] + vv * fit.axisV[k] + hh * fit.normal[k]
    })
  })
  return { points, rows: us.length, cols: vs.length }
}
