// SPDX-License-Identifier: AGPL-3.0-only
// Flat regions on the scan: what one grown plane holds, and every flat face
// found at once.
//
// A plane fit from a click answers its fit; planeRegionReport adds the
// region it grew — how much surface, where, how far its normals stray — and
// whether that region is two surfaces rather than one (see splitTwoPlanes).
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

import type { MeshGraph, Plane, Vec3 } from '../types'
import { symmetricEigen3 } from './linalg'
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
}

/** What a grown region holds: its area and box, and — given the plane's
 *  normal — how far its normals stray from it and whether its points lie on
 *  two surfaces. `seed`, a vertex the region was grown from, says which of
 *  the two is the one meant; without it the smaller is the second. */
export function planeRegionReport(
  g: MeshGraph,
  region: Uint32Array,
  plane?: { normal: Vec3; seed?: number },
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
  if (!plane || region.length === 0) return out

  const [nx, ny, nz] = plane.normal
  const tilt = new Float32Array(region.length)
  for (let i = 0; i < region.length; i++) {
    const j = region[i] * 3
    tilt[i] = Math.acos(Math.min(1, Math.abs(nrm[j] * nx + nrm[j + 1] * ny + nrm[j + 2] * nz)))
  }
  tilt.sort()
  out.normalSpreadDeg = tilt[Math.min(tilt.length - 1, Math.floor(0.95 * tilt.length))] / DEG

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
