// SPDX-License-Identifier: AGPL-3.0-only
// The plane — unlike the curved shapes, its Gaussian best fit is exact: the
// centroid, and as normal the direction the points scatter least along, with
// no iteration. Its robust start scores three-point planes by median residual
// (LMedS), so a patch straddling an edge settles on the face holding most of
// it, where a least-squares plane would be dragged towards the other face.
// Settling on it says nothing of the other face, though, so a grown region
// can be split into two planes to see whether it holds two (splitTwoPlanes).

import type { Plane } from '../types'
import { clippedRefit } from './clip'
import { centroidOf, orthoBasis, rmsOver, symmetricEigen3 } from './linalg'
import { fitHeight, patchFrame } from './heightSurface'
import { ransacConsensus } from './ransac'

/** Signed distance of a point from the plane (positive on the normal side). */
export function planeResidual(p: Plane, x: number, y: number, z: number): number {
  return p.nx * x + p.ny * y + p.nz * z - p.d
}

/** Total-least-squares plane: the centroid, plus the direction the points
 *  scatter least along as the normal. Exact — this *is* the Gaussian best-fit
 *  for a plane, so no iterative refinement step is needed. */
export function fitPlaneTLS(positions: Float32Array, idx: ArrayLike<number>): Plane | null {
  const n = idx.length
  if (n < 3) return null

  const [mx, my, mz] = centroidOf(positions, idx)

  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0
  for (let i = 0; i < n; i++) {
    const j = idx[i] * 3
    const x = positions[j] - mx
    const y = positions[j + 1] - my
    const z = positions[j + 2] - mz
    cxx += x * x
    cxy += x * y
    cxz += x * z
    cyy += y * y
    cyz += y * z
    czz += z * z
  }

  const { values, vectors } = symmetricEigen3([cxx, cxy, cxz, cxy, cyy, cyz, cxz, cyz, czz])
  // Collinear points leave the normal free to spin around the line they lie
  // on: the two smallest scatter directions are then equally small.
  if (!(values[1] > 1e-12 * values[2]) || !(values[2] > 0)) return null

  const [nx, ny, nz] = vectors[0]
  if (!Number.isFinite(nx)) return null
  return { nx, ny, nz, d: nx * mx + ny * my + nz * mz }
}

/** How much nearer than the best plane a curved fit has to lie to its
 *  points for the curvature to be there at all, as the plane's RMS over
 *  the fit's. On a flat patch the curved shape's spare parameters buy
 *  next to nothing, and the ratio is 1; a cylinder whose arc rises 1.5σ
 *  off its chord scores about 1.1. */
const CURVED_OVER_FLAT = 1.1

/** Whether a curved fit tells its points from a plane: whether it lies
 *  clearly nearer to them than the best plane through them does. A patch
 *  it does not has no curvature to work with, and the radius it was fitted
 *  is the noise's. */
export function curvedBeyondPlane(positions: Float32Array, idx: ArrayLike<number>, curvedRms: number): boolean {
  const plane = fitPlaneTLS(positions, idx)
  if (!plane) return true
  return rmsOver(positions, idx, (x, y, z) => planeResidual(plane, x, y, z)) >= CURVED_OVER_FLAT * curvedRms
}

export interface ClippedPlaneFit {
  plane: Plane
  /** RMS of the point-to-plane distances over the used points. */
  sigma: number
  /** Peak-to-peak distance over the used points — the patch's flatness. */
  span: number
  /** The signed extremes `span` is the difference of: how far below and
   *  above the fit the kept points reach, along the fitted normal. */
  min: number
  max: number
  used: Uint32Array
}

/** Gaussian best-fit with GOM-style "used points" clipping (see
 *  `clippedRefit`), each round an exact TLS fit. */
export function fitPlaneClipped(
  positions: Float32Array,
  idx: Uint32Array | ArrayLike<number>,
  k: number,
): ClippedPlaneFit | null {
  const r = clippedRefit<Plane>(positions, idx, k, (used) => fitPlaneTLS(positions, used), planeResidual)
  return r && { plane: r.model, sigma: r.sigma, span: r.span, min: r.min, max: r.max, used: r.used }
}

/** How much nearer two planes have to lie to a region's points than one
 *  does, as their RMS over the one plane's, for the region to be read as two
 *  surfaces. Noise alone, split down the middle into two planes either side
 *  of it, comes to about 0.6 — two planes for one surface buy that much from
 *  nothing. */
const TWO_OVER_ONE = 0.75
/** So the two planes have to part as well: over most of the region (the
 *  90th percentile) lie this many times their RMS apart, at least. Noise
 *  split in two gives planes about three times their RMS apart everywhere,
 *  smoothed noise in blobs not much more; a crease parts them more and more
 *  away from the line they meet on, a step by its height. */
const PARTED_RMS = 6
/** The share of the points the smaller of the two has to hold, at least —
 *  a few strays off a face are outliers, not a second face. */
const SECOND_SHARE = 0.08
/** Assignment rounds the two-plane split runs from each start, on at most
 *  this many of the points. */
const SPLIT_ROUNDS = 12
const SPLIT_SAMPLE = 20_000
/** How many points the quadric is fitted on. */
const QUADRIC_SAMPLE = 4000

export interface TwoPlaneSplit {
  /** The two planes, the larger part first, each with its points (indices
   *  into the `idx` given, not vertex numbers). */
  planes: [Plane, Plane]
  members: [Uint32Array, Uint32Array]
  /** RMS of each point off the nearer of the two, and off the one plane. */
  rmsTwo: number
  rmsOne: number
  /** How far apart the two planes lie over most of the region (the 90th
   *  percentile, at its points), mm. */
  parted: number
}

/** Every k-th of the points, to at most `most` of them. */
function strided(idx: ArrayLike<number>, most: number): ArrayLike<number> {
  if (idx.length <= most) return idx
  const out = new Uint32Array(most)
  const step = idx.length / most
  for (let i = 0; i < most; i++) out[i] = idx[Math.floor(i * step)]
  return out
}

/** Whether a region fitted as one plane is two: a seed near a shallow crease
 *  grows across it, and a step lower than the band joins its two levels. A
 *  plane through such a region settles between the two, or — robustly, as
 *  ransacPlane does — on the larger, and its σ alone says neither. So the
 *  points are split into two planes, each point to the nearer, refitted until
 *  the split stands, from two starts: by which side of the one plane a point
 *  lies (a step) and by which way its normal leans across it (a crease). The
 *  split is kept when the two planes lie clearly nearer to the points than
 *  the one, part by far more than the points scatter off them, both hold a
 *  real share of the points, and a quadric does no better — a surface that
 *  bows is curved, not two. Null when the region is one surface. `normals`
 *  are the vertex normals beside `positions`. */
export function splitTwoPlanes(
  positions: Float32Array,
  normals: Float32Array,
  idx: ArrayLike<number>,
): TwoPlaneSplit | null {
  if (idx.length < 60) return null
  const sample = strided(idx, SPLIT_SAMPLE)
  const n = sample.length
  const one = fitPlaneTLS(positions, sample)
  if (!one) return null
  const residual = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const j = sample[i] * 3
    residual[i] = planeResidual(one, positions[j], positions[j + 1], positions[j + 2])
  }

  // The way the normals lean across the one plane: the in-plane direction
  // their tangential parts scatter along most.
  const [u, v] = orthoBasis([one.nx, one.ny, one.nz])
  const tu = new Float64Array(n)
  const tv = new Float64Array(n)
  let mu = 0, mv = 0
  for (let i = 0; i < n; i++) {
    const j = sample[i] * 3
    tu[i] = normals[j] * u[0] + normals[j + 1] * u[1] + normals[j + 2] * u[2]
    tv[i] = normals[j] * v[0] + normals[j + 1] * v[1] + normals[j + 2] * v[2]
    mu += tu[i]
    mv += tv[i]
  }
  mu /= n
  mv /= n
  let suu = 0, suv = 0, svv = 0
  for (let i = 0; i < n; i++) {
    const a = tu[i] - mu, b = tv[i] - mv
    suu += a * a
    suv += a * b
    svv += b * b
  }
  const angle = 0.5 * Math.atan2(2 * suv, suu - svv)
  const lu = Math.cos(angle), lv = Math.sin(angle)

  const starts: Uint8Array[] = [new Uint8Array(n), new Uint8Array(n)]
  for (let i = 0; i < n; i++) {
    starts[0][i] = residual[i] > 0 ? 1 : 0
    starts[1][i] = (tu[i] - mu) * lu + (tv[i] - mv) * lv > 0 ? 1 : 0
  }
  let best: { planes: [Plane, Plane]; rms: number } | null = null
  for (const side of starts) {
    const r = refineSplit(positions, sample, side)
    if (r && (!best || r.rms < best.rms)) best = r
  }
  if (!best) return null
  const [p0, p1] = best.planes

  // Every point of the region to the nearer plane, the RMS over all, and
  // how far apart the planes lie at each point — measured along the one
  // plane's normal with the two turned the same way.
  const total = idx.length
  const side = new Uint8Array(total)
  const apart = new Float32Array(total)
  const turn = p0.nx * p1.nx + p0.ny * p1.ny + p0.nz * p1.nz >= 0 ? 1 : -1
  let ssOne = 0, ssTwo = 0, count1 = 0
  for (let i = 0; i < total; i++) {
    const j = idx[i] * 3
    const x = positions[j], y = positions[j + 1], z = positions[j + 2]
    const s0 = planeResidual(p0, x, y, z)
    const s1 = turn * planeResidual(p1, x, y, z)
    const r0 = Math.abs(s0)
    const r1 = Math.abs(s1)
    if (r1 < r0) {
      side[i] = 1
      count1++
    }
    apart[i] = Math.abs(s0 - s1)
    ssTwo += Math.min(r0, r1) ** 2
    ssOne += planeResidual(one, x, y, z) ** 2
  }
  const rmsOne = Math.sqrt(ssOne / total)
  const rmsTwo = Math.sqrt(ssTwo / total)
  if (!(rmsOne > 0) || !(rmsTwo < TWO_OVER_ONE * rmsOne)) return null
  if (Math.min(count1, total - count1) < Math.max(30, SECOND_SHARE * total)) return null

  apart.sort()
  const parted = apart[Math.floor(0.9 * (total - 1))]
  if (!(parted >= PARTED_RMS * rmsTwo)) return null

  // A bowed surface splits into two planes well too; a quadric over the
  // region tells it from a crease, which no quadric follows as closely as
  // two planes do.
  const few = strided(idx, QUADRIC_SAMPLE)
  const packed = new Float64Array(few.length * 3)
  let ssFew = 0
  for (let k = 0; k < few.length; k++) {
    const j = few[k] * 3
    const x = positions[j], y = positions[j + 1], z = positions[j + 2]
    packed[k * 3] = x
    packed[k * 3 + 1] = y
    packed[k * 3 + 2] = z
    ssFew += Math.min(Math.abs(planeResidual(p0, x, y, z)), Math.abs(planeResidual(p1, x, y, z))) ** 2
  }
  const frame = patchFrame(packed)
  const quadric = frame && fitHeight(packed, frame, 'quadric')
  if (quadric && quadric.rms <= Math.sqrt(ssFew / few.length)) return null

  const a: number[] = []
  const b: number[] = []
  for (let i = 0; i < total; i++) (side[i] ? b : a).push(i)
  const big = a.length >= b.length
  return {
    planes: big ? [p0, p1] : [p1, p0],
    members: big ? [Uint32Array.from(a), Uint32Array.from(b)] : [Uint32Array.from(b), Uint32Array.from(a)],
    rmsTwo,
    rmsOne,
    parted,
  }
}

/** Two planes from a first split of the points (side 0 or 1 each), each
 *  point then moved to the nearer plane and both refitted, until no point
 *  moves. Null when a side empties. */
function refineSplit(
  positions: Float32Array,
  idx: ArrayLike<number>,
  start: Uint8Array,
): { side: Uint8Array; planes: [Plane, Plane]; rms: number } | null {
  const n = idx.length
  const side = Uint8Array.from(start)
  let planes: [Plane, Plane] | null = null
  let rms = Infinity
  for (let round = 0; round < SPLIT_ROUNDS; round++) {
    const groups: number[][] = [[], []]
    for (let i = 0; i < n; i++) groups[side[i]].push(idx[i])
    if (groups[0].length < 3 || groups[1].length < 3) return null
    const p0 = fitPlaneTLS(positions, groups[0])
    const p1 = fitPlaneTLS(positions, groups[1])
    if (!p0 || !p1) return null
    planes = [p0, p1]
    let moved = 0
    let ss = 0
    for (let i = 0; i < n; i++) {
      const j = idx[i] * 3
      const x = positions[j], y = positions[j + 1], z = positions[j + 2]
      const r0 = Math.abs(planeResidual(p0, x, y, z))
      const r1 = Math.abs(planeResidual(p1, x, y, z))
      const s = r1 < r0 ? 1 : 0
      if (s !== side[i]) {
        side[i] = s
        moved++
      }
      ss += Math.min(r0, r1) ** 2
    }
    rms = Math.sqrt(ss / n)
    if (moved === 0) break
  }
  return planes && { side, planes, rms }
}

export interface RansacPlaneResult {
  plane: Plane
  inliers: Uint32Array
  /** Robust noise estimate (1.4826 · median absolute residual). */
  sigma: number
}

/** Robust plane estimate on a local patch: sample 3-point candidate planes,
 *  score by median absolute residual (LMedS — no threshold parameter needed),
 *  then refine on the consensus set with a 3-sigma clipped Gaussian fit. A
 *  patch straddling an edge would drag a plain least-squares plane off the
 *  surface the user clicked; the median score ignores the smaller side. */
export function ransacPlane(
  positions: Float32Array,
  patch: Uint32Array,
  opts: { iterations?: number; seed?: number } = {},
): RansacPlaneResult | null {
  const core = ransacConsensus<Plane>(positions, patch, opts, (diag, rand) => {
    const n = patch.length
    // Three sampled points must span a real triangle to define a plane; the
    // area of a sliver is what makes the normal noise-dominated.
    const minArea = diag * diag * 1e-4
    return {
      generate: () => {
        const i0 = patch[(rand() * n) | 0]
        const i1 = patch[(rand() * n) | 0]
        const i2 = patch[(rand() * n) | 0]
        if (i0 === i1 || i0 === i2 || i1 === i2) return null
        const a = i0 * 3, b = i1 * 3, c = i2 * 3
        const ux = positions[b] - positions[a]
        const uy = positions[b + 1] - positions[a + 1]
        const uz = positions[b + 2] - positions[a + 2]
        const vx = positions[c] - positions[a]
        const vy = positions[c + 1] - positions[a + 1]
        const vz = positions[c + 2] - positions[a + 2]
        let nx = uy * vz - uz * vy
        let ny = uz * vx - ux * vz
        let nz = ux * vy - uy * vx
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
        if (!(len > minArea)) return null
        nx /= len
        ny /= len
        nz /= len
        return {
          nx,
          ny,
          nz,
          d: nx * positions[a] + ny * positions[a + 1] + nz * positions[a + 2],
        }
      },
      residual: planeResidual,
    }
  })
  if (!core) return null

  const refined = fitPlaneClipped(positions, core.inliers, 3)
  if (!refined) return null
  return {
    plane: refined.plane,
    inliers: refined.used,
    sigma: Math.max(refined.sigma, core.sigmaEst, 1e-9),
  }
}
