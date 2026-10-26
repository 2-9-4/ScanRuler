// SPDX-License-Identifier: AGPL-3.0-only
// Flat regions on the scan: what one grown plane holds, and every flat face
// found at once.
//
// A plane fit from a click answers its fit; planeRegionReport adds the
// region it grew — how much surface, where, how far its normals stray — and
// whether that region is two surfaces rather than one (see splitTwoPlanes;
// a cylinder's region, splitTwoCylinders).
//
// segmentPlanes grows regions over the whole scan, or the part of it inside
// a box, the way a person would click face after face: from the flattest
// place nobody has claimed yet, a vertex joining while it lies inside the
// noise band of the region's plane and its normal agrees with the plane's.
// The plane is refitted from running sums as the region grows, so a region
// of any size costs one pass over its vertices. Each vertex goes to one
// region at most; regions too small or too rough are given back, and their
// vertices may join a later one but never seed one. Regions meet across the
// rounding of the edge between them, which no plane claims, so their
// neighbours are found by letting each region spread a few rings into the
// unclaimed vertices round it and seeing which fronts meet.

import type { Cylinder, MeshGraph, Plane, Vec3 } from '../types'
import { cylinderResidual, splitTwoCylinders } from './cylinder'
import { fitHeight } from './heightSurface'
import { orthoBasis, symmetricEigen3 } from './linalg'
import { planeResidual, splitTwoPlanes } from './plane'

const DEG = Math.PI / 180

/** Each vertex's share of the scan's surface: a third of every triangle it
 *  is a corner of. Kept per graph — the triangles never change under it, and
 *  a rigid alignment leaves their areas as they are. */
const areaCache = new WeakMap<MeshGraph, Float32Array>()

export function vertexAreas(g: MeshGraph): Float32Array {
  const kept = areaCache.get(g)
  if (kept) return kept
  const { positions: p, indices } = g
  const out = new Float32Array(g.vertexCount)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    const third = Math.sqrt(cx * cx + cy * cy + cz * cz) / 6
    out[indices[t]] += third
    out[indices[t + 1]] += third
    out[indices[t + 2]] += third
  }
  areaCache.set(g, out)
  return out
}

// ---- What a grown region holds ----------------------------------------------

export interface SecondSurface {
  /** The region's points on it, and their share of the region. */
  count: number
  share: number
  centroid: Vec3
  min: Vec3
  max: Vec3
  /** Between the two planes, degrees. */
  angleDeg: number
  /** How far the second one's centroid lies off the first plane, along the
   *  normal the region is reported with, mm. */
  offset: number
  /** RMS off the nearer of two planes, and off the one, mm. */
  rmsTwo: number
  rmsOne: number
  /** How far apart the two planes lie over most of the region, mm. */
  parted: number
}

export interface PlaneRegionReport {
  vertices: number
  /** mm²: the region's share of the scan's surface. */
  area: number
  min: Vec3
  max: Vec3
  /** The angle 95 % of the region's vertex normals lie within of the
   *  plane's normal, degrees. Only with a normal to measure from. */
  normalSpreadDeg?: number
  /** The region seen as two planes: the one the seed is not on. */
  second?: SecondSurface
  /** A cylinder's region seen as two cylinders: the one the seed is not
   *  on. Only with the cylinder given. */
  secondCylinder?: SecondCylinder
  /** The share of the rectangle the region spans in its plane that it
   *  fills: a face fills most of it, the crown of a bead or a round running
   *  across a part a sliver. Only with a normal to measure from. */
  fill?: number
  /** How curved the region is: the sagitta of a quadric height fitted over
   *  it in the plane's frame — how far the quadric's curved part rises and
   *  falls across the region's points, mm — and the RMS the quadric leaves,
   *  mm (the noise, and relief no quadric follows). Only with a normal to
   *  measure from. See looksLikeCrown. */
  curve?: { sagitta: number; sigma: number }
  /** Where a bore's axis meets the scan at an end of its wall — see
   *  closedAlong. Only with the cylinder given, and a bore. */
  closed?: BoreClosed
}

export interface BoreClosed {
  /** Where the axis, cast from the middle of the wall toward one end, meets
   *  the scan, and where it leaves it again (when it does), mm along the
   *  fitted axis from the fit's centre. */
  from: number
  to?: number
  /** The point it meets the scan at. */
  at: Vec3
}

export interface SecondCylinder {
  /** The region's points on it, and their share of the region. */
  count: number
  share: number
  centroid: Vec3
  min: Vec3
  max: Vec3
  /** Where its points lie along the fitted axis, from the fit's centre, mm. */
  band: [number, number]
  /** Between the two cylinders' axes, degrees. */
  angleDeg: number
  /** The radius of the one the seed is on, and of the second, mm. */
  radius: number
  radiusSecond: number
  /** How far each part's normals lean off square to the fitted axis, RMS,
   *  degrees: the seed's part, then the second. */
  leanDeg: [number, number]
  /** RMS off the nearer of two cylinders, and off the one, mm. */
  rmsTwo: number
  rmsOne: number
}

/** A region a cylinder was fitted on, as two cylinders — see
 *  splitTwoCylinders — reported along the fit's axis: the part the seed is
 *  not on (the smaller without a seed). Null when it is one surface. */
export function secondCylinder(
  g: MeshGraph,
  region: Uint32Array,
  fit: { center: Vec3; axis: Vec3; radius: number; seed?: number },
): SecondCylinder | null {
  const { positions: p, normals: nrm } = g
  const al = Math.hypot(fit.axis[0], fit.axis[1], fit.axis[2])
  if (!(al > 0) || !(fit.radius > 0)) return null
  const a: Vec3 = [fit.axis[0] / al, fit.axis[1] / al, fit.axis[2] / al]
  const one: Cylinder = { px: fit.center[0], py: fit.center[1], pz: fit.center[2], ax: a[0], ay: a[1], az: a[2], r: fit.radius }
  const split = splitTwoCylinders(p, nrm, region, one)
  if (!split) return null
  let first = 0
  if (fit.seed !== undefined && fit.seed < g.vertexCount) {
    const j = fit.seed * 3
    const r0 = Math.abs(cylinderResidual(split.cylinders[0], p[j], p[j + 1], p[j + 2]))
    const r1 = Math.abs(cylinderResidual(split.cylinders[1], p[j], p[j + 1], p[j + 2]))
    if (r1 < r0) first = 1
  }
  const second = 1 - first
  const leanOf = (members: Uint32Array) => {
    let ss = 0
    for (let i = 0; i < members.length; i++) {
      const j = region[members[i]] * 3
      const s = nrm[j] * a[0] + nrm[j + 1] * a[1] + nrm[j + 2] * a[2]
      ss += Math.asin(Math.max(-1, Math.min(1, s))) ** 2
    }
    return members.length ? Math.sqrt(ss / members.length) / DEG : 0
  }
  const members = split.members[second]
  const c: Vec3 = [0, 0, 0]
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  let t0 = Infinity, t1 = -Infinity
  for (let i = 0; i < members.length; i++) {
    const j = region[members[i]] * 3
    for (let k = 0; k < 3; k++) {
      const x = p[j + k]
      c[k] += x / members.length
      if (x < lo[k]) lo[k] = x
      if (x > hi[k]) hi[k] = x
    }
    const t = (p[j] - fit.center[0]) * a[0] + (p[j + 1] - fit.center[1]) * a[1] + (p[j + 2] - fit.center[2]) * a[2]
    if (t < t0) t0 = t
    if (t > t1) t1 = t
  }
  const A = split.cylinders[first]
  const B = split.cylinders[second]
  return {
    count: members.length,
    share: members.length / region.length,
    centroid: c,
    min: lo,
    max: hi,
    band: [t0, t1],
    angleDeg: Math.acos(Math.min(1, Math.abs(A.ax * B.ax + A.ay * B.ay + A.az * B.az))) / DEG,
    radius: A.r,
    radiusSecond: B.r,
    leanDeg: [leanOf(split.members[first]), leanOf(members)],
    rmsTwo: split.rmsTwo,
    rmsOne: split.rmsOne,
  }
}

/** How many of a region's points its quadric is fitted on, at most. */
const CURVE_SAMPLE = 4000

/** A region's quadric h = a + b·u + c·v + d·u² + e·u·v + f·v² over the
 *  plane's frame (origin at the points' centroid): the sagitta of its
 *  curved part across the points — the spread of d·u² + e·u·v + f·v² over
 *  them, which for a strip of a round of radius R and width w is w²/8R —
 *  and the RMS it leaves. Null for too few points. */
function curveOf(p: Float32Array, region: Uint32Array, normal: Vec3, basisU: Vec3, basisV: Vec3): { sagitta: number; sigma: number } | null {
  const step = Math.max(1, Math.ceil(region.length / CURVE_SAMPLE))
  const n = Math.floor((region.length - 1) / step) + 1
  if (n < 12) return null
  const packed = new Float64Array(n * 3)
  const origin: Vec3 = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    const j = region[i * step] * 3
    for (let k = 0; k < 3; k++) {
      packed[i * 3 + k] = p[j + k]
      origin[k] += p[j + k] / n
    }
  }
  const quadric = fitHeight(packed, { origin, basisU, basisV, normal }, 'quadric')
  if (!quadric) return null
  const { d, e, f } = quadric.coefficients
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    const x = packed[i * 3] - origin[0], y = packed[i * 3 + 1] - origin[1], z = packed[i * 3 + 2] - origin[2]
    const u = x * basisU[0] + y * basisU[1] + z * basisU[2]
    const v = x * basisV[0] + y * basisV[1] + z * basisV[2]
    const q = d * u * u + e * u * v + f * v * v
    if (q < lo) lo = q
    if (q > hi) hi = q
  }
  return { sagitta: hi - lo, sigma: quadric.rms }
}

/** A plane's region whose normals spread wider than this, degrees, or that
 *  fills less of the rectangle it spans than this share, may be no face:
 *  the crown of a bead or a round grows a ring or a strip of points whose
 *  normals turn across it. */
export const PLANE_SPREAD_DEG = 10
export const PLANE_FILL = 0.15
/** How many times the RMS a quadric leaves its curved part has to rise
 *  across the region for the region to count as curved. */
const CURVED_SIGMAS = 3

/** Whether a plane's region looks like the crown of a bead or a round, not
 *  a face: a sliver of the rectangle it spans, or its normals spread wide
 *  and the region curved — a quadric over it rising more across it than
 *  three times what the quadric leaves. A spread alone does not tell: a
 *  flat face with relief on it (lettering, a label) spreads its normals as
 *  wide, and no quadric follows relief, so its sagitta stays within what is
 *  left. The RMS left, not the plane's own: on a round the curve is the
 *  plane's RMS, and its sagitta always about 3.4 times that. */
export function looksLikeCrown(r: Pick<PlaneRegionReport, 'normalSpreadDeg' | 'fill' | 'curve'>): boolean {
  if ((r.fill ?? 1) < PLANE_FILL) return true
  if (!((r.normalSpreadDeg ?? 0) > PLANE_SPREAD_DEG)) return false
  return r.curve ? r.curve.sagitta > CURVED_SIGMAS * r.curve.sigma : true
}

/** What a grown region holds: its area and box, and — given the plane's
 *  normal — how far its normals stray from it and whether its points lie on
 *  two surfaces. `seed`, a vertex the region was grown from, says which of
 *  the two is the one meant; without it the smaller is the second. */
export function planeRegionReport(
  g: MeshGraph,
  region: Uint32Array,
  plane?: { normal: Vec3; seed?: number },
  cylinder?: { center: Vec3; axis: Vec3; radius: number; seed?: number },
): PlaneRegionReport {
  const { positions: p, normals: nrm } = g
  const areas = vertexAreas(g)
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let area = 0
  for (let i = 0; i < region.length; i++) {
    const v = region[i]
    area += areas[v]
    for (let k = 0; k < 3; k++) {
      const x = p[v * 3 + k]
      if (x < min[k]) min[k] = x
      if (x > max[k]) max[k] = x
    }
  }
  const out: PlaneRegionReport = { vertices: region.length, area, min, max }
  if (cylinder && region.length > 0) {
    const second = secondCylinder(g, region, cylinder)
    if (second) out.secondCylinder = second
    const closed = closedAlong(g, region, cylinder)
    if (closed) out.closed = closed
  }
  if (!plane || region.length === 0) return out

  const [nx, ny, nz] = plane.normal
  const tilt = new Float32Array(region.length)
  for (let i = 0; i < region.length; i++) {
    const j = region[i] * 3
    tilt[i] = Math.acos(Math.min(1, Math.abs(nrm[j] * nx + nrm[j + 1] * ny + nrm[j + 2] * nz)))
  }
  tilt.sort()
  out.normalSpreadDeg = tilt[Math.min(tilt.length - 1, Math.floor(0.95 * tilt.length))] / DEG
  // The rectangle is the region's own, along its longest run in the plane,
  // so a strip lying across the plane's axes still fills its rectangle.
  const [e1, e2] = orthoBasis([nx, ny, nz])
  const pu = new Float64Array(region.length)
  const pw = new Float64Array(region.length)
  let su = 0, sw = 0
  for (let i = 0; i < region.length; i++) {
    const j = region[i] * 3
    pu[i] = p[j] * e1[0] + p[j + 1] * e1[1] + p[j + 2] * e1[2]
    pw[i] = p[j] * e2[0] + p[j + 1] * e2[1] + p[j + 2] * e2[2]
    su += pu[i]
    sw += pw[i]
  }
  su /= region.length
  sw /= region.length
  let cuu = 0, cuw = 0, cww = 0
  for (let i = 0; i < region.length; i++) {
    const du = pu[i] - su, dw = pw[i] - sw
    cuu += du * du
    cuw += du * dw
    cww += dw * dw
  }
  const turn = 0.5 * Math.atan2(2 * cuw, cuu - cww)
  const cs = Math.cos(turn), sn = Math.sin(turn)
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
  for (let i = 0; i < region.length; i++) {
    const x = pu[i] * cs + pw[i] * sn
    const y = -pu[i] * sn + pw[i] * cs
    if (x < a0) a0 = x
    if (x > a1) a1 = x
    if (y < b0) b0 = y
    if (y > b1) b1 = y
  }
  const spanned = (a1 - a0) * (b1 - b0)
  if (spanned > 0) out.fill = Math.min(1, area / spanned)
  const curve = curveOf(p, region, [nx, ny, nz], e1, e2)
  if (curve) out.curve = curve

  const split = splitTwoPlanes(p, nrm, region)
  if (!split) return out

  // The part the seed lies on is the surface meant; the other is the second.
  let first = 0
  if (plane.seed !== undefined && plane.seed < g.vertexCount) {
    const j = plane.seed * 3
    const r0 = Math.abs(planeResidual(split.planes[0], p[j], p[j + 1], p[j + 2]))
    const r1 = Math.abs(planeResidual(split.planes[1], p[j], p[j + 1], p[j + 2]))
    if (r1 < r0) first = 1
  }
  const second = 1 - first
  const members = split.members[second]
  const c: Vec3 = [0, 0, 0]
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < members.length; i++) {
    const j = region[members[i]] * 3
    for (let k = 0; k < 3; k++) {
      const x = p[j + k]
      c[k] += x / members.length
      if (x < lo[k]) lo[k] = x
      if (x > hi[k]) hi[k] = x
    }
  }
  const a = split.planes[first]
  const b = split.planes[second]
  // Measured along the reported normal, so "above" is out of the part.
  const along = a.nx * nx + a.ny * ny + a.nz * nz >= 0 ? 1 : -1
  out.second = {
    count: members.length,
    share: members.length / region.length,
    centroid: c,
    min: lo,
    max: hi,
    angleDeg: Math.acos(Math.min(1, Math.abs(a.nx * b.nx + a.ny * b.ny + a.nz * b.nz))) / DEG,
    offset: along * planeResidual(a, c[0], c[1], c[2]),
    rmsTwo: split.rmsTwo,
    rmsOne: split.rmsOne,
    parted: split.parted,
  }
  return out
}

// ---- A bore closed at an end -------------------------------------------------

/** A cap counts as closing the bore when the axis meets it within this many
 *  radii past the end of the wall — the wall's own rounding into it is
 *  peeled off the region, so the region stops a little short. */
const CLOSED_REACH_OF_R = 1

/**
 * Whether a bore is closed at an end, read by casting its axis from the
 * middle of the wall toward each end: on the axis inside a bore there is
 * only air, so the first triangle the axis meets lies at or past an end — a
 * floor, a cap, or the skin a scan wrapped across a hole it did not see
 * through. One that lies within CLOSED_REACH_OF_R radii of the wall's end
 * closes the bore there; the next one along says where the material that
 * closes it ends. When both ends are closed, the one nearer its wall's end.
 * Null for a shaft (the region's normals face away from the axis) or a bore
 * open at both ends.
 */
export function closedAlong(g: MeshGraph, region: Uint32Array, fit: { center: Vec3; axis: Vec3; radius: number }): BoreClosed | null {
  const { positions: p, normals: n, indices } = g
  const al = Math.hypot(fit.axis[0], fit.axis[1], fit.axis[2])
  if (!(al > 0) || !(fit.radius > 0) || region.length === 0) return null
  const a: Vec3 = [fit.axis[0] / al, fit.axis[1] / al, fit.axis[2] / al]
  const [cx, cy, cz] = fit.center
  // A bore: its wall's normals face the axis.
  let toward = 0
  let seen = 0
  let t0 = Infinity
  let t1 = -Infinity
  for (let i = 0; i < region.length; i++) {
    const j = region[i] * 3
    const qx = p[j] - cx, qy = p[j + 1] - cy, qz = p[j + 2] - cz
    const t = qx * a[0] + qy * a[1] + qz * a[2]
    if (t < t0) t0 = t
    if (t > t1) t1 = t
    const dot = (qx - t * a[0]) * n[j] + (qy - t * a[1]) * n[j + 1] + (qz - t * a[2]) * n[j + 2]
    seen++
    if (dot < 0) toward++
  }
  if (toward < 0.6 * seen) return null

  // Every place the axis line crosses the scan, as t along it: a triangle
  // is crossed when the axis lies inside it seen down the axis.
  const [u, v] = orthoBasis(a)
  const count = g.vertexCount
  const pu = new Float32Array(count)
  const pv = new Float32Array(count)
  const pt = new Float32Array(count)
  for (let k = 0; k < count; k++) {
    const j = k * 3
    const qx = p[j] - cx, qy = p[j + 1] - cy, qz = p[j + 2] - cz
    pu[k] = qx * u[0] + qy * u[1] + qz * u[2]
    pv[k] = qx * v[0] + qy * v[1] + qz * v[2]
    pt[k] = qx * a[0] + qy * a[1] + qz * a[2]
  }
  const hits: number[] = []
  for (let f = 0; f + 2 < indices.length; f += 3) {
    const i0 = indices[f], i1 = indices[f + 1], i2 = indices[f + 2]
    const u0 = pu[i0], u1 = pu[i1], u2 = pu[i2]
    if ((u0 > 0 && u1 > 0 && u2 > 0) || (u0 < 0 && u1 < 0 && u2 < 0)) continue
    const v0 = pv[i0], v1 = pv[i1], v2 = pv[i2]
    if ((v0 > 0 && v1 > 0 && v2 > 0) || (v0 < 0 && v1 < 0 && v2 < 0)) continue
    // The origin's barycentric weights in the triangle seen down the axis.
    const d = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
    if (!(Math.abs(d) > 1e-18)) continue
    const w1 = ((0 - u0) * (v2 - v0) - (u2 - u0) * (0 - v0)) / d
    const w2 = ((u1 - u0) * (0 - v0) - (0 - u0) * (v1 - v0)) / d
    const w0 = 1 - w1 - w2
    if (w0 < 0 || w1 < 0 || w2 < 0) continue
    hits.push(w0 * pt[i0] + w1 * pt[i1] + w2 * pt[i2])
  }
  hits.sort((x, y) => x - y)

  const mid = (t0 + t1) / 2
  const reach = CLOSED_REACH_OF_R * fit.radius
  const at = (t: number): Vec3 => [cx + t * a[0], cy + t * a[1], cz + t * a[2]]
  /** The first crossing past the middle one way, the next after it, and how
   *  far past the wall's end the first lies. */
  const end = (sign: 1 | -1) => {
    const ahead = sign > 0 ? hits.filter((t) => t > mid) : hits.filter((t) => t < mid).reverse()
    if (!ahead.length) return null
    const from = ahead[0]
    const past = sign * (from - (sign > 0 ? t1 : t0))
    if (past > reach) return null
    const to = ahead.find((t) => sign * (t - from) > 1e-4)
    return { past, closed: { from, ...(to !== undefined ? { to } : {}), at: at(from) } as BoreClosed }
  }
  const up = end(1)
  const down = end(-1)
  const best = up && down ? (up.past <= down.past ? up : down) : up ?? down
  return best ? best.closed : null
}

// ---- Every flat face at once -------------------------------------------------

export interface SegmentOptions {
  /** Only the scan inside this box. */
  box?: { min: Vec3; max: Vec3 }
  /** Regions smaller than this are given back, mm². */
  minArea: number
  /** A region rougher than this off its plane is not flat, mm. */
  maxRms: number
  /** How far a vertex normal may lean off the region's plane and join. */
  maxDeg: number
}

export interface SegmentedPlane {
  /** Out of the part, by a vote of the region's vertex normals. */
  normal: Vec3
  /** The region's centroid, on its plane. */
  point: Vec3
  /** RMS of the region's points off its plane, mm. */
  sigma: number
  area: number
  min: Vec3
  max: Vec3
  count: number
  /** The regions it meets, by id (1 is the largest), with the angle between
   *  the two planes' outward normals. */
  neighbours: { id: number; deg: number }[]
}

export interface Segmentation {
  /** The largest first; region k is id k + 1. */
  regions: SegmentedPlane[]
  /** Every region's vertices one after the other, region k's from
   *  offsets[k] to offsets[k + 1]. */
  vertices: Uint32Array
  offsets: Uint32Array
  /** Vertices looked at (inside the box), and how many the regions hold. */
  considered: number
  claimed: number
}

/** The points a region starts from: the seed and its nearest neighbours that
 *  face its way. Fewer than the least, and the place is too ragged to seed. */
const PATCH = 30
const PATCH_LEAST = 12
/** A region holds this many vertices at least. */
const REGION_LEAST = 20
/** The band a vertex joins inside, in the region's own σ… */
const BAND_SIGMAS = 3.5
/** …and never wider than this many times maxRms, so a region cannot widen
 *  its way across a shallow crease, nor round a curve until it is rougher
 *  than maxRms and given back whole. */
const BAND_MAX_RMS = 2
/** The plane is refitted when the region has grown by this factor. */
const REFIT_GROWTH = 1.25
/** How many rings round its rim a region spreads to meet its neighbours. */
const MEET_RINGS = 6
/** Edges two regions' fronts meet across, at least, to be neighbours. */
const MEET_EDGES = 3
/** Seeds are ordered by flatness in this many steps. */
const SEED_BUCKETS = 4096

/** Running sums over a region's points, about a fixed origin near them so
 *  the squares keep their precision far from the world's origin. */
class Moments {
  n = 0
  private s = new Float64Array(9)
  constructor(private ox: number, private oy: number, private oz: number) {}
  add(x: number, y: number, z: number): void {
    const a = x - this.ox, b = y - this.oy, c = z - this.oz
    const s = this.s
    this.n++
    s[0] += a
    s[1] += b
    s[2] += c
    s[3] += a * a
    s[4] += a * b
    s[5] += a * c
    s[6] += b * b
    s[7] += b * c
    s[8] += c * c
  }
  /** The best plane through the points so far, its normal turned towards
   *  `toward`, with their RMS off it; null while they lie on a line. */
  plane(toward: Vec3): { plane: Plane; centroid: Vec3; sigma: number } | null {
    const n = this.n
    if (n < 3) return null
    const s = this.s
    const mx = s[0] / n, my = s[1] / n, mz = s[2] / n
    const cxx = s[3] / n - mx * mx, cxy = s[4] / n - mx * my, cxz = s[5] / n - mx * mz
    const cyy = s[6] / n - my * my, cyz = s[7] / n - my * mz, czz = s[8] / n - mz * mz
    const { values, vectors } = symmetricEigen3([cxx, cxy, cxz, cxy, cyy, cyz, cxz, cyz, czz])
    if (!(values[1] > 1e-12 * Math.max(values[2], 1e-30))) return null
    let [nx, ny, nz] = vectors[0]
    if (nx * toward[0] + ny * toward[1] + nz * toward[2] < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const centroid: Vec3 = [mx + this.ox, my + this.oy, mz + this.oz]
    return {
      plane: { nx, ny, nz, d: nx * centroid[0] + ny * centroid[1] + nz * centroid[2] },
      centroid,
      sigma: Math.sqrt(Math.max(0, values[0])),
    }
  }
}

/** Grow planar regions over the scan, the largest first — see the top of
 *  the file. */
export function segmentPlanes(g: MeshGraph, opts: SegmentOptions): Segmentation {
  const { positions: P, normals: N, adjOffsets, adjList, vertexCount: n } = g
  const cosMax = Math.cos(Math.min(89, Math.max(0.1, opts.maxDeg)) * DEG)
  const maxRms = Math.max(opts.maxRms, 1e-9)
  const bandFloor = Math.max(1e-5 * g.bboxDiag, 1e-7)
  const bandOf = (sigma: number) => Math.min(BAND_MAX_RMS * maxRms, Math.max(BAND_SIGMAS * sigma, bandFloor))
  const areas = vertexAreas(g)

  // Inside the box, or everywhere.
  let allowed: Uint8Array | null = null
  let considered = n
  if (opts.box) {
    const { min, max } = opts.box
    allowed = new Uint8Array(n)
    considered = 0
    for (let v = 0; v < n; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]
      if (x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2]) {
        allowed[v] = 1
        considered++
      }
    }
  }
  const inside = (v: number) => !allowed || allowed[v] === 1

  // How much the normals turn round each vertex, smoothed over its ring:
  // the flattest places seed first.
  const turn = new Float32Array(n)
  for (let v = 0; v < n; v++) {
    const end = adjOffsets[v + 1]
    const deg = end - adjOffsets[v]
    if (deg === 0) {
      turn[v] = 1
      continue
    }
    let sum = 0
    for (let e = adjOffsets[v]; e < end; e++) {
      const w = adjList[e]
      sum += 1 - (N[v * 3] * N[w * 3] + N[v * 3 + 1] * N[w * 3 + 1] + N[v * 3 + 2] * N[w * 3 + 2])
    }
    turn[v] = sum / deg
  }
  const seedLimit = 1 - cosMax
  const keys = new Int32Array(n).fill(-1)
  const bucketCount = new Uint32Array(SEED_BUCKETS + 1)
  for (let v = 0; v < n; v++) {
    if (!inside(v)) continue
    let sum = turn[v]
    const end = adjOffsets[v + 1]
    for (let e = adjOffsets[v]; e < end; e++) sum += turn[adjList[e]]
    const rough = sum / (end - adjOffsets[v] + 1)
    if (!(rough <= seedLimit)) continue
    const key = Math.min(SEED_BUCKETS - 1, Math.floor(Math.sqrt(rough / seedLimit) * SEED_BUCKETS))
    keys[v] = key
    bucketCount[key + 1]++
  }
  for (let k = 0; k < SEED_BUCKETS; k++) bucketCount[k + 1] += bucketCount[k]
  const order = new Uint32Array(bucketCount[SEED_BUCKETS])
  const fill = bucketCount.slice(0, SEED_BUCKETS)
  for (let v = 0; v < n; v++) if (keys[v] >= 0) order[fill[keys[v]]++] = v

  const label = new Int32Array(n)
  const noSeed = new Uint8Array(n)
  interface Grown { id: number; members: number[]; normal: Vec3; point: Vec3; sigma: number; area: number }
  const kept: Grown[] = []
  let nextId = 1

  const giveBack = (members: number[]) => {
    for (const v of members) {
      label[v] = 0
      noSeed[v] = 1
    }
  }

  for (let o = 0; o < order.length; o++) {
    const s = order[o]
    if (label[s] !== 0 || noSeed[s]) continue
    const id = nextId++
    const sn: Vec3 = [N[s * 3], N[s * 3 + 1], N[s * 3 + 2]]

    // The patch it starts from.
    const members: number[] = [s]
    label[s] = id
    for (let head = 0; head < members.length && members.length < PATCH; head++) {
      const v = members[head]
      const end = adjOffsets[v + 1]
      for (let e = adjOffsets[v]; e < end && members.length < PATCH; e++) {
        const w = adjList[e]
        if (label[w] !== 0 || !inside(w)) continue
        if (N[w * 3] * sn[0] + N[w * 3 + 1] * sn[1] + N[w * 3 + 2] * sn[2] < cosMax) continue
        label[w] = id
        members.push(w)
      }
    }
    const m = new Moments(P[s * 3], P[s * 3 + 1], P[s * 3 + 2])
    for (const v of members) m.add(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])
    let fit = members.length >= PATCH_LEAST ? m.plane(sn) : null
    if (!fit || fit.sigma > maxRms) {
      giveBack(members)
      continue
    }

    // The region, the plane refitted as it grows.
    let band = bandOf(fit.sigma)
    let fittedAt = members.length
    for (let head = 0; head < members.length; head++) {
      const v = members[head]
      const pl = fit.plane
      const end = adjOffsets[v + 1]
      for (let e = adjOffsets[v]; e < end; e++) {
        const w = adjList[e]
        if (label[w] !== 0 || !inside(w)) continue
        const j = w * 3
        if (N[j] * pl.nx + N[j + 1] * pl.ny + N[j + 2] * pl.nz < cosMax) continue
        if (!(Math.abs(planeResidual(pl, P[j], P[j + 1], P[j + 2])) <= band)) continue
        label[w] = id
        members.push(w)
        m.add(P[j], P[j + 1], P[j + 2])
      }
      if (members.length >= REFIT_GROWTH * fittedAt + 8) {
        const next = m.plane([pl.nx, pl.ny, pl.nz])
        if (next) {
          fit = next
          band = bandOf(fit.sigma)
        }
        fittedAt = members.length
      }
    }

    // The plane settled: what it took in early, under a plane that has
    // since turned, and that now lies off it goes back.
    const settled = m.plane([fit.plane.nx, fit.plane.ny, fit.plane.nz]) ?? fit
    const finalBand = bandOf(settled.sigma)
    const stay: number[] = []
    const off: number[] = []
    const fm = new Moments(P[s * 3], P[s * 3 + 1], P[s * 3 + 2])
    let area = 0
    let vote = 0
    for (const v of members) {
      const j = v * 3
      if (Math.abs(planeResidual(settled.plane, P[j], P[j + 1], P[j + 2])) <= finalBand) {
        stay.push(v)
        fm.add(P[j], P[j + 1], P[j + 2])
        area += areas[v]
        vote += N[j] * settled.plane.nx + N[j + 1] * settled.plane.ny + N[j + 2] * settled.plane.nz
      } else off.push(v)
    }
    giveBack(off)
    const final = fm.plane([settled.plane.nx, settled.plane.ny, settled.plane.nz])
    if (!final || stay.length < REGION_LEAST || area < opts.minArea || final.sigma > maxRms) {
      giveBack(stay)
      continue
    }
    const sign = vote >= 0 ? 1 : -1
    kept.push({
      id,
      members: stay,
      normal: [sign * final.plane.nx, sign * final.plane.ny, sign * final.plane.nz],
      point: final.centroid,
      sigma: final.sigma,
      area,
    })
  }

  // The largest first, numbered from 1 in that order.
  kept.sort((a, b) => b.area - a.area)
  const renumber = new Map<number, number>()
  kept.forEach((r, k) => renumber.set(r.id, k + 1))
  for (let v = 0; v < n; v++) if (label[v] !== 0) label[v] = renumber.get(label[v]) ?? 0

  // Each region spreads a few rings into the unclaimed vertices round it;
  // where two fronts meet, or two regions touch, they are neighbours.
  const owner = Int32Array.from(label)
  const ring = new Uint8Array(n)
  const front: number[] = []
  for (let v = 0; v < n; v++) if (owner[v] !== 0) front.push(v)
  const meets = new Map<number, number>()
  const meet = (a: number, b: number) => {
    const key = a < b ? a * 1e6 + b : b * 1e6 + a
    meets.set(key, (meets.get(key) ?? 0) + 1)
  }
  for (let head = 0; head < front.length; head++) {
    const v = front[head]
    if (ring[v] >= MEET_RINGS) continue
    const end = adjOffsets[v + 1]
    for (let e = adjOffsets[v]; e < end; e++) {
      const w = adjList[e]
      if (owner[w] !== 0 || !inside(w)) continue
      owner[w] = owner[v]
      ring[w] = ring[v] + 1
      front.push(w)
    }
  }
  for (let v = 0; v < n; v++) {
    const own = owner[v]
    if (own === 0) continue
    const end = adjOffsets[v + 1]
    for (let e = adjOffsets[v]; e < end; e++) {
      const w = adjList[e]
      if (w > v && owner[w] !== 0 && owner[w] !== own) meet(own, owner[w])
    }
  }

  const regions: SegmentedPlane[] = kept.map((r) => {
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (const v of r.members) {
      for (let k = 0; k < 3; k++) {
        const x = P[v * 3 + k]
        if (x < min[k]) min[k] = x
        if (x > max[k]) max[k] = x
      }
    }
    return { normal: r.normal, point: r.point, sigma: r.sigma, area: r.area, min, max, count: r.members.length, neighbours: [] }
  })
  for (const [key, edges] of meets) {
    if (edges < MEET_EDGES) continue
    const a = Math.floor(key / 1e6)
    const b = key - a * 1e6
    const na = regions[a - 1].normal, nb = regions[b - 1].normal
    const deg = Math.acos(Math.max(-1, Math.min(1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]))) / DEG
    regions[a - 1].neighbours.push({ id: b, deg })
    regions[b - 1].neighbours.push({ id: a, deg })
  }
  for (const r of regions) r.neighbours.sort((x, y) => x.id - y.id)

  const offsets = new Uint32Array(kept.length + 1)
  kept.forEach((r, k) => (offsets[k + 1] = offsets[k] + r.members.length))
  const vertices = new Uint32Array(offsets[kept.length])
  kept.forEach((r, k) => vertices.set(r.members, offsets[k]))
  return { regions, vertices, offsets, considered, claimed: vertices.length }
}
