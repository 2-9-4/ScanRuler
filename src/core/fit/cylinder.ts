// SPDX-License-Identifier: AGPL-3.0-only
// The cylinder, found from its normals first: every normal of a cylinder is
// square to its axis, so the axis is the direction the normal cloud scatters
// least along, and the position and radius are then a circle fit in the plane
// across it. Candidates from two points with their normals compete with that
// estimate by median residual (LMedS); damped Gauss–Newton refines all five
// degrees of freedom, the axis tilted by two angles so it stays a unit vector
// and the axis point never wanders along the axis itself.

import type { Cylinder, Vec3 } from '../types'
import { fitCircle2d } from './circle2d'
import { clippedRefit } from './clip'
import { centroidOf, cross, normalizeOrZ, orthoBasis, projectOntoPlane, rmsOver, solveLinear, symmetricEigen3 } from './linalg'
import { curvedBeyondPlane } from './plane'
import { ransacConsensus } from './ransac'

/** Distance of a point from the cylinder surface (positive outside), and the
 *  unit radial direction there. NaN on the axis, where the radial direction
 *  is undefined. */
function radial(c: Cylinder, x: number, y: number, z: number): { e: number; wx: number; wy: number; wz: number; t: number } {
  const qx = x - c.px
  const qy = y - c.py
  const qz = z - c.pz
  const t = qx * c.ax + qy * c.ay + qz * c.az
  const wx = qx - t * c.ax
  const wy = qy - t * c.ay
  const wz = qz - t * c.az
  const rho = Math.sqrt(wx * wx + wy * wy + wz * wz)
  if (!(rho > 1e-12)) return { e: NaN, wx: 0, wy: 0, wz: 0, t }
  return { e: rho - c.r, wx: wx / rho, wy: wy / rho, wz: wz / rho, t }
}

export function cylinderResidual(c: Cylinder, x: number, y: number, z: number): number {
  return radial(c, x, y, z).e
}

function rms(positions: Float32Array, idx: ArrayLike<number>, c: Cylinder): number {
  return rmsOver(positions, idx, (x, y, z) => radial(c, x, y, z).e)
}

/** Axis direction from surface normals. Every normal of a cylinder is
 *  perpendicular to its axis, so the axis is the direction the normal cloud
 *  scatters least along — a far better starting guess than anything derived
 *  from the point positions alone. */
export function axisFromNormals(normals: Float32Array, idx: ArrayLike<number>): Vec3 | null {
  const n = idx.length
  if (n < 3) return null
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0
  for (let i = 0; i < n; i++) {
    const j = idx[i] * 3
    const x = normals[j], y = normals[j + 1], z = normals[j + 2]
    cxx += x * x
    cxy += x * y
    cxz += x * z
    cyy += y * y
    cyz += y * z
    czz += z * z
  }
  const { values, vectors } = symmetricEigen3([cxx, cxy, cxz, cxy, cyy, cyz, cxz, cyz, czz])
  // A patch that curves too little (an almost-flat sliver) leaves the two
  // smallest directions indistinguishable — the axis would be a coin toss.
  if (!(values[1] > 1e-6 * n)) return null
  return vectors[0]
}

/** Best circle in the plane perpendicular to a fixed axis — that is the
 *  cylinder's position and radius for that direction. Algebraic (Coope) fit
 *  followed by the 2D form of the orthogonal-distance fixed-point iteration. */
export function fitCylinderOnAxis(
  positions: Float32Array,
  idx: ArrayLike<number>,
  axis: Vec3,
): Cylinder | null {
  const n = idx.length
  if (n < 5) return null
  const d = normalizeOrZ(axis)
  const [u, v] = orthoBasis(d)

  const centre = centroidOf(positions, idx)
  const [mx, my, mz] = centre

  // Project onto the (u, v) plane through the centroid.
  const { pu, pv } = projectOntoPlane(positions, idx, centre, u, v)

  // The circle itself is the shared 2D kernel's job.
  const fit2d = fitCircle2d(pu, pv)
  if (!fit2d) return null
  const { cu, cv, r } = fit2d

  return {
    px: mx + cu * u[0] + cv * v[0],
    py: my + cu * u[1] + cv * v[1],
    pz: mz + cu * u[2] + cv * v[2],
    ax: d[0],
    ay: d[1],
    az: d[2],
    r,
  }
}

/** Geometric (orthogonal-distance) refinement of all five cylinder degrees of
 *  freedom by damped Gauss-Newton. The axis direction is perturbed inside the
 *  plane it is normal to (two angles), which keeps it a unit vector without a
 *  constraint equation, and the axis point slides in the same plane — the two
 *  degrees of freedom that would otherwise just walk along the axis are simply
 *  not in the parametrisation. */
export function refineCylinderGeometric(
  positions: Float32Array,
  idx: ArrayLike<number>,
  init: Cylinder,
  maxIter = 60,
): Cylinder {
  const n = idx.length
  if (n < 6) return init

  let c = { ...init }
  let cost = rms(positions, idx, c)
  if (!Number.isFinite(cost)) return init
  let lambda = 1e-6

  for (let iter = 0; iter < maxIter; iter++) {
    const [u, v] = orthoBasis([c.ax, c.ay, c.az])
    const jtj = new Float64Array(25)
    const jtf = new Float64Array(5)
    const row = new Float64Array(5)
    let m = 0

    for (let i = 0; i < n; i++) {
      const j = idx[i] * 3
      const { e, wx, wy, wz, t } = radial(c, positions[j], positions[j + 1], positions[j + 2])
      if (!Number.isFinite(e)) continue
      const su = wx * u[0] + wy * u[1] + wz * u[2]
      const sv = wx * v[0] + wy * v[1] + wz * v[2]
      row[0] = -su
      row[1] = -sv
      row[2] = -t * su
      row[3] = -t * sv
      row[4] = -1
      for (let a = 0; a < 5; a++) {
        jtf[a] += row[a] * e
        for (let b = a; b < 5; b++) jtj[a * 5 + b] += row[a] * row[b]
      }
      m++
    }
    if (m < 6) break
    for (let a = 0; a < 5; a++) for (let b = 0; b < a; b++) jtj[a * 5 + b] = jtj[b * 5 + a]

    let applied = false
    let converged = false
    for (let attempt = 0; attempt < 6; attempt++) {
      const mat = jtj.slice()
      for (let a = 0; a < 5; a++) mat[a * 5 + a] *= 1 + lambda
      const rhs = new Float64Array(5)
      for (let a = 0; a < 5; a++) rhs[a] = -jtf[a]
      const step = solveLinear(5, mat, rhs)
      if (!step) {
        lambda *= 10
        continue
      }
      const axis = normalizeOrZ([
        c.ax + step[2] * u[0] + step[3] * v[0],
        c.ay + step[2] * u[1] + step[3] * v[1],
        c.az + step[2] * u[2] + step[3] * v[2],
      ])
      const cand: Cylinder = {
        px: c.px + step[0] * u[0] + step[1] * v[0],
        py: c.py + step[0] * u[1] + step[1] * v[1],
        pz: c.pz + step[0] * u[2] + step[1] * v[2],
        ax: axis[0],
        ay: axis[1],
        az: axis[2],
        r: c.r + step[4],
      }
      if (!(cand.r > 0) || !Number.isFinite(cand.px)) {
        lambda *= 10
        continue
      }
      const candCost = rms(positions, idx, cand)
      if (Number.isFinite(candCost) && candCost <= cost) {
        converged = cost - candCost < 1e-12 * Math.max(cost, cand.r)
        c = cand
        cost = candCost
        lambda = Math.max(lambda * 0.3, 1e-9)
        applied = true
        break
      }
      lambda *= 10
    }
    if (!applied || converged) break
  }
  return c
}

export interface ClippedCylinderFit {
  cylinder: Cylinder
  /** RMS of the radial residuals over the used points. */
  sigma: number
  /** Peak-to-peak radial residual — the surface's cylindricity. */
  span: number
  /** The signed radial extremes `span` is the difference of: how far inside
   *  and outside the fitted wall the kept points reach — a bore's tightest
   *  and widest spot, doubled, are the min and max diameter. */
  min: number
  max: number
  used: Uint32Array
}

/** Gaussian best-fit with GOM-style "used points" clipping (see
 *  `clippedRefit`). Each round re-fits the circle on the previous round's
 *  axis and then refines geometrically, so the axis carries over between
 *  clipping rounds instead of restarting from `init`. */
export function fitCylinderClipped(
  positions: Float32Array,
  idx: Uint32Array | ArrayLike<number>,
  init: Cylinder,
  k: number,
): ClippedCylinderFit | null {
  let start = init
  const r = clippedRefit<Cylinder>(
    positions,
    idx,
    k,
    (used) => {
      const seeded = fitCylinderOnAxis(positions, used, [start.ax, start.ay, start.az]) ?? start
      const c = refineCylinderGeometric(positions, used, seeded)
      if (!(c.r > 0) || !Number.isFinite(c.r)) return null
      start = c
      return c
    },
    cylinderResidual,
  )
  return r && { cylinder: r.model, sigma: r.sigma, span: r.span, min: r.min, max: r.max, used: r.used }
}

export interface RansacCylinderResult {
  cylinder: Cylinder
  inliers: Uint32Array
  /** Robust noise estimate (1.4826 · median absolute residual). */
  sigma: number
}

/** Cylinder through two points with known surface normals: the axis is
 *  perpendicular to both normals, and in the plane across it the axis sits
 *  where the two (projected) normal lines meet. */
function cylinderFrom2(
  positions: Float32Array,
  normals: Float32Array,
  i0: number,
  i1: number,
): Cylinder | null {
  const a = i0 * 3
  const b = i1 * 3
  const n0: Vec3 = [normals[a], normals[a + 1], normals[a + 2]]
  const n1: Vec3 = [normals[b], normals[b + 1], normals[b + 2]]
  const axisRaw = cross(n0, n1)
  const len = Math.hypot(axisRaw[0], axisRaw[1], axisRaw[2])
  // Near-parallel normals say nothing about where the axis runs.
  if (!(len > 0.08)) return null
  const d = normalizeOrZ(axisRaw)
  const [u, v] = orthoBasis(d)

  const p0u = positions[a] * u[0] + positions[a + 1] * u[1] + positions[a + 2] * u[2]
  const p0v = positions[a] * v[0] + positions[a + 1] * v[1] + positions[a + 2] * v[2]
  const p1u = positions[b] * u[0] + positions[b + 1] * u[1] + positions[b + 2] * u[2]
  const p1v = positions[b] * v[0] + positions[b + 1] * v[1] + positions[b + 2] * v[2]
  const n0u = n0[0] * u[0] + n0[1] * u[1] + n0[2] * u[2]
  const n0v = n0[0] * v[0] + n0[1] * v[1] + n0[2] * v[2]
  const n1u = n1[0] * u[0] + n1[1] * u[1] + n1[2] * u[2]
  const n1v = n1[0] * v[0] + n1[1] * v[1] + n1[2] * v[2]

  // Intersect p0 + s·n0 with p1 + t·n1 in the (u, v) plane.
  const det = n0u * -n1v - -n1u * n0v
  if (Math.abs(det) < 1e-9) return null
  const du = p1u - p0u
  const dv = p1v - p0v
  const s = (du * -n1v - -n1u * dv) / det
  const cu = p0u + s * n0u
  const cv = p0v + s * n0v
  const r = Math.hypot(cu - p0u, cv - p0v)
  if (!(r > 0) || !Number.isFinite(r)) return null

  // Any point with the right (u, v) offset lies on the axis; anchor it at the
  // first sample so the axis passes near the patch.
  const alongU = cu - p0u
  const alongV = cv - p0v
  return {
    px: positions[a] + alongU * u[0] + alongV * v[0],
    py: positions[a + 1] + alongU * u[1] + alongV * v[1],
    pz: positions[a + 2] + alongU * u[2] + alongV * v[2],
    ax: d[0],
    ay: d[1],
    az: d[2],
    r,
  }
}

/** Robust cylinder estimate on a local patch: score the normal-covariance
 *  axis plus a batch of two-point-with-normals candidates by median absolute
 *  residual (LMedS), then refine on the consensus set. */
export function ransacCylinder(
  positions: Float32Array,
  normals: Float32Array,
  patch: Uint32Array,
  opts: { iterations?: number; seed?: number } = {},
): RansacCylinderResult | null {
  const core = ransacConsensus<Cylinder>(positions, patch, opts, (diag, rand) => {
    const n = patch.length
    // A radius wildly out of scale with the local patch is really a plane,
    // never the cylinder the user clicked.
    const plausible = (c: Cylinder) => c.r > diag * 0.01 && c.r <= diag * 60
    const normalAxis = axisFromNormals(normals, patch)
    const fromNormals = normalAxis && fitCylinderOnAxis(positions, patch, normalAxis)
    return {
      initial: fromNormals && plausible(fromNormals) ? fromNormals : null,
      generate: () => {
        const i0 = patch[(rand() * n) | 0]
        const i1 = patch[(rand() * n) | 0]
        if (i0 === i1) return null
        const c = cylinderFrom2(positions, normals, i0, i1)
        return c && plausible(c) ? c : null
      },
      residual: cylinderResidual,
    }
  })
  if (!core) return null

  const refined = fitCylinderClipped(positions, core.inliers, core.model, 3)
  if (!refined) return null
  // A plane fits a patch with no curvature as well — a flat face whose
  // normals scatter, as a scan's do, still yields candidates, and the
  // radius cap above is all that holds them.
  if (!curvedBeyondPlane(positions, refined.used, rms(positions, refined.used, refined.cylinder))) return null
  return {
    cylinder: refined.cylinder,
    inliers: refined.used,
    sigma: Math.max(refined.sigma, core.sigmaEst, 1e-9),
  }
}

// ---- One cylinder, or two -----------------------------------------------------

/** Two cylinders are taken over one when they leave this share of its RMS
 *  or less, part by this many times their own RMS over most of the region,
 *  and the smaller holds this share of the points — as splitTwoPlanes has
 *  it. */
const TWO_CYL_OVER_ONE = 0.75
const TWO_CYL_PARTED = 6
const TWO_CYL_SHARE = 0.08
/** How many points the split is searched on, and how many rounds of
 *  assigning each to the nearer cylinder and refitting both it runs. */
const TWO_CYL_SAMPLE = 4000
const TWO_CYL_ROUNDS = 6

export interface TwoCylinderSplit {
  /** The two cylinders, the larger part first, each with its points
   *  (indices into the `idx` given). */
  cylinders: [Cylinder, Cylinder]
  members: [Uint32Array, Uint32Array]
  /** RMS of each point off the nearer of the two, and off the one. */
  rmsTwo: number
  rmsOne: number
  /** How far apart the two lie over most of the region (the 90th
   *  percentile, at its points), mm. */
  parted: number
}

/** Every k-th of the points, to at most `most` of them. */
function thinned(idx: ArrayLike<number>, most: number): ArrayLike<number> {
  if (idx.length <= most) return idx
  const out = new Uint32Array(most)
  const step = idx.length / most
  for (let i = 0; i < most; i++) out[i] = idx[Math.floor(i * step)]
  return out
}

/** A cylinder on some points: fresh, from the axis their normals give (or
 *  the start's), else refined from the start. */
function cylinderOn(positions: Float32Array, normals: Float32Array, idx: ArrayLike<number>, start: Cylinder, fresh: boolean): Cylinder | null {
  const axis: Vec3 = (fresh && axisFromNormals(normals, idx)) || [start.ax, start.ay, start.az]
  const seeded = fresh ? fitCylinderOnAxis(positions, idx, axis) : start
  if (!seeded) return null
  const c = refineCylinderGeometric(positions, idx, seeded, 15)
  return c.r > 0 && Number.isFinite(c.r) && Number.isFinite(c.px) ? c : null
}

/** Whether a region fitted as one cylinder is two: an opening whose lip
 *  leans while its wall stands, or whose one side stands and the other
 *  leans, grows as one surface and fits as one cylinder tilted between
 *  them, its σ saying neither. So the points are split into two cylinders,
 *  each point to the nearer, refitted until the split stands, from several
 *  starts: bands along the axis (a lip above a wall), halves across it (one
 *  side against the other), and by how far the normals lean off square to
 *  the axis. The split is kept when the two lie clearly nearer to the
 *  points than the one, part by far more than the points scatter off them,
 *  both hold a real share, and a radius that changes smoothly along the
 *  axis — a cone, a barrel — does no better. Null when the region is one
 *  surface. */
export function splitTwoCylinders(positions: Float32Array, normals: Float32Array, idx: ArrayLike<number>, one: Cylinder): TwoCylinderSplit | null {
  if (idx.length < 120) return null
  const sample = thinned(idx, TWO_CYL_SAMPLE)
  const n = sample.length
  const [u, v] = orthoBasis([one.ax, one.ay, one.az])
  const t = new Float64Array(n)
  const cu = new Float64Array(n)
  const cv = new Float64Array(n)
  const lean = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const j = sample[i] * 3
    const r = radial(one, positions[j], positions[j + 1], positions[j + 2])
    t[i] = r.t
    cu[i] = r.wx * u[0] + r.wy * u[1] + r.wz * u[2]
    cv[i] = r.wx * v[0] + r.wy * v[1] + r.wz * v[2]
    lean[i] = Math.abs(normals[j] * one.ax + normals[j + 1] * one.ay + normals[j + 2] * one.az)
  }
  const quantile = (a: Float64Array, q: number) => {
    const s = Float64Array.from(a).sort()
    return s[Math.floor(q * (s.length - 1))]
  }
  const starts: Uint8Array[] = []
  for (const q of [0.3, 0.5, 0.7]) {
    const cut = quantile(t, q)
    starts.push(Uint8Array.from(t, (x) => (x > cut ? 1 : 0)))
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 4, du = Math.cos(a), dv = Math.sin(a)
    starts.push(Uint8Array.from(cu, (x, i) => (x * du + cv[i] * dv > 0 ? 1 : 0)))
  }
  const leanCut = quantile(lean, 0.5)
  starts.push(Uint8Array.from(lean, (x) => (x > leanCut ? 1 : 0)))

  let best: { cyl: [Cylinder, Cylinder]; rms: number } | null = null
  for (const side of starts) {
    let cyl: [Cylinder, Cylinder] | null = null
    for (let round = 0; round < TWO_CYL_ROUNDS; round++) {
      const parts: [number[], number[]] = [[], []]
      for (let i = 0; i < n; i++) parts[side[i]].push(sample[i])
      if (parts[0].length < 30 || parts[1].length < 30) {
        cyl = null
        break
      }
      const c0 = cylinderOn(positions, normals, parts[0], cyl ? cyl[0] : one, !cyl)
      const c1 = cylinderOn(positions, normals, parts[1], cyl ? cyl[1] : one, !cyl)
      if (!c0 || !c1) {
        cyl = null
        break
      }
      cyl = [c0, c1]
      let moved = 0
      for (let i = 0; i < n; i++) {
        const j = sample[i] * 3
        const x = positions[j], y = positions[j + 1], z = positions[j + 2]
        const s = Math.abs(radial(c1, x, y, z).e) < Math.abs(radial(c0, x, y, z).e) ? 1 : 0
        if (s !== side[i]) moved++
        side[i] = s
      }
      if (moved === 0) break
    }
    if (!cyl) continue
    let ss = 0
    for (let i = 0; i < n; i++) {
      const j = sample[i] * 3
      const x = positions[j], y = positions[j + 1], z = positions[j + 2]
      ss += Math.min(Math.abs(radial(cyl[0], x, y, z).e), Math.abs(radial(cyl[1], x, y, z).e)) ** 2
    }
    const rms = Math.sqrt(ss / n)
    if (Number.isFinite(rms) && (!best || rms < best.rms)) best = { cyl, rms }
  }
  if (!best) return null
  const [c0, c1] = best.cyl

  // Every point to the nearer, the RMS over all, how far apart the two lie
  // at each point, and the one's residual with a radius that changes
  // smoothly along the axis taken out: e ≈ a + b t + c t², least squares.
  const total = idx.length
  const side = new Uint8Array(total)
  const apart = new Float32Array(total)
  const eOne = new Float64Array(total)
  const tOne = new Float64Array(total)
  const m = new Float64Array(9)
  const rhs = new Float64Array(3)
  let ssOne = 0, ssTwo = 0, count1 = 0
  for (let i = 0; i < total; i++) {
    const j = idx[i] * 3
    const x = positions[j], y = positions[j + 1], z = positions[j + 2]
    const e0 = radial(c0, x, y, z).e
    const e1 = radial(c1, x, y, z).e
    const r = radial(one, x, y, z)
    if (!Number.isFinite(e0) || !Number.isFinite(e1) || !Number.isFinite(r.e)) continue
    if (Math.abs(e1) < Math.abs(e0)) {
      side[i] = 1
      count1++
    }
    apart[i] = Math.abs(e0 - e1)
    ssTwo += Math.min(e0 * e0, e1 * e1)
    ssOne += r.e * r.e
    eOne[i] = r.e
    tOne[i] = r.t
    const row = [1, r.t, r.t * r.t]
    for (let a = 0; a < 3; a++) {
      rhs[a] += row[a] * r.e
      for (let b = 0; b < 3; b++) m[a * 3 + b] += row[a] * row[b]
    }
  }
  const rmsOne = Math.sqrt(ssOne / total)
  const rmsTwo = Math.sqrt(ssTwo / total)
  if (!(rmsOne > 0) || !(rmsTwo < TWO_CYL_OVER_ONE * rmsOne)) return null
  if (Math.min(count1, total - count1) < Math.max(30, TWO_CYL_SHARE * total)) return null
  apart.sort()
  const parted = apart[Math.floor(0.9 * (total - 1))]
  if (!(parted >= TWO_CYL_PARTED * rmsTwo)) return null
  const coef = solveLinear(3, m, rhs)
  if (coef) {
    let ssSmooth = 0
    for (let i = 0; i < total; i++) ssSmooth += (eOne[i] - coef[0] - coef[1] * tOne[i] - coef[2] * tOne[i] * tOne[i]) ** 2
    if (!(rmsTwo < TWO_CYL_OVER_ONE * Math.sqrt(ssSmooth / total))) return null
  }

  const a: number[] = []
  const b: number[] = []
  for (let i = 0; i < total; i++) (side[i] ? b : a).push(i)
  const big = a.length >= b.length
  return {
    cylinders: big ? [c0, c1] : [c1, c0],
    members: big ? [Uint32Array.from(a), Uint32Array.from(b)] : [Uint32Array.from(b), Uint32Array.from(a)],
    rmsTwo,
    rmsOne,
    parted,
  }
}
