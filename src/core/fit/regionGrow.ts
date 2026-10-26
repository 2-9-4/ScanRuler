// SPDX-License-Identifier: AGPL-3.0-only
// From a click to the whole surface. A patch round the seed gives the robust
// estimate (see ransac.ts), retried on a larger patch when it is too small or
// too flat; the region then grows from the seed, the model refitted every
// round, and a vertex joins only inside the noise band and with a normal that
// agrees with the model's — the normal test is what stops it at an edge
// rather than leaking onto the next face. The rings of a scan's rounded edge
// that still get in are peeled off the rim afterwards. A plain flood bounded
// by the turn between neighbouring normals sits beside it, fitting nothing.

import type { Cone, Cylinder, MeshGraph, Plane, Sphere, Torus } from '../types'
import { acquireStamps } from '../geometry/scratch'
import { coneNormalAlign, coneNormalSigned, coneResidual, fitConeClipped } from './cone'
import { cylinderResidual, fitCylinderClipped } from './cylinder'
import { fitPlaneClipped, planeResidual } from './plane'
import { fitSphereClipped } from './sphere'
import { fitTorusClipped, torusNormalAlign, torusResidual } from './torus'
import { inBox, type FitGuide } from './guide'

/** Vertices whose fit uses a strided subsample beyond this size; the region
 *  itself is still complete, only the per-round solve is capped. */
const FIT_SUBSAMPLE = 60_000

const COS_SPHERE_MAX = Math.cos((38 * Math.PI) / 180)
const COS_CYLINDER_MAX = Math.cos((32 * Math.PI) / 180)
const COS_CONE_MAX = Math.cos((32 * Math.PI) / 180)
const COS_PLANE_MAX = Math.cos((25 * Math.PI) / 180)

/** A rim ring is peeled while its normals turn away from the model by at
 *  least this multiple of the surface's own noise tilt (the median over the
 *  region) — twice the noise is a surface starting to curve away, not noise. */
const PEEL_TILT_FACTOR = 2
/** …and by at least this much in absolute terms, so a perfectly tessellated
 *  mesh (noise tilt zero) does not peel on rounding error. */
const PEEL_TILT_FLOOR = (0.5 * Math.PI) / 180
/** Rings peeled at most — the rounding of a scanned edge is a couple of
 *  vertex rings wide; anything beyond is not an edge. */
const MAX_PEEL_RINGS = 6

/** Collect up to `limit` vertices connected to the seeds — no membership
 *  criterion, plain surface BFS. Used to gather the RANSAC patch. */
export function collectPatch(g: MeshGraph, seeds: ArrayLike<number>, limit: number): Uint32Array {
  const { stamp, gen } = acquireStamps(g, g.vertexCount)
  const queue: number[] = []
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]
    if (stamp[s] !== gen) {
      stamp[s] = gen
      queue.push(s)
    }
  }
  let head = 0
  while (head < queue.length && queue.length < limit) {
    const v = queue[head++]
    const end = g.adjOffsets[v + 1]
    for (let e = g.adjOffsets[v]; e < end; e++) {
      const nb = g.adjList[e]
      if (stamp[nb] === gen) continue
      stamp[nb] = gen
      queue.push(nb)
      if (queue.length >= limit) break
    }
  }
  return Uint32Array.from(queue)
}

/** The patch sizes a fit from a click tries in turn — the next when the one
 *  before was too small or too flat to pin the surface down. */
const SEED_PATCHES = [1500, 6000, 24000]

/** The seeds that grew nothing, of a region grown from them: a click on
 *  another surface than the one the estimate found, among several clicks
 *  — its vertices are in the region only as the places the growing
 *  started from, standing alone. Seeds joined to one another (a click's
 *  triangle) go together, and stay while one of them meets a vertex of the
 *  region that is no seed. */
export function strandedSeeds(g: MeshGraph, region: Uint32Array, seeds: ArrayLike<number>): Set<number> {
  const { stamp, gen } = acquireStamps(g, g.vertexCount)
  for (let i = 0; i < region.length; i++) stamp[region[i]] = gen
  const isSeed = new Set<number>()
  for (let i = 0; i < seeds.length; i++) if (stamp[seeds[i]] === gen) isSeed.add(seeds[i])
  const stranded = new Set<number>()
  const seen = new Set<number>()
  for (const s of isSeed) {
    if (seen.has(s)) continue
    seen.add(s)
    const joined = [s]
    let grew = false
    for (let k = 0; k < joined.length; k++) {
      const v = joined[k]
      const end = g.adjOffsets[v + 1]
      for (let e = g.adjOffsets[v]; e < end; e++) {
        const nb = g.adjList[e]
        if (stamp[nb] !== gen) continue
        if (!isSeed.has(nb)) grew = true
        else if (!seen.has(nb)) {
          seen.add(nb)
          joined.push(nb)
        }
      }
    }
    if (!grew) for (const v of joined) stranded.add(v)
  }
  return stranded
}

/**
 * A fit from a click, the steps every kind shares: a patch round the seeds,
 * a robust estimate on it, the region that estimate grows to — 60 points at
 * least, seeds that grew nothing left out of it (strandedSeeds) — and the
 * kind's own best fit and checks. A step that comes back null moves on to
 * the next patch size; null when none is left.
 */
export function seededFit<C, G extends { region: Uint32Array }, R>(
  g: MeshGraph,
  seeds: number[],
  steps: {
    /** The robust estimate on the patch; `seed` drives its sampling. */
    estimate(patch: Uint32Array, seed: number): C | null
    grow(estimate: C): G | null
    finish(grown: G): R | null
  },
): R | null {
  for (const patchSize of SEED_PATCHES) {
    const patch = collectPatch(g, seeds, patchSize)
    if (patch.length < 30) break
    const cand = steps.estimate(patch, (seeds[0] ?? 1) + patchSize)
    if (!cand) continue
    let grown = steps.grow(cand)
    if (!grown || grown.region.length < 60) continue
    // Clicks on two surfaces grow the one the estimate found; the other's
    // seeds would stand in its region alone, in its box, extents and fit.
    const stranded = seeds.length > 1 ? strandedSeeds(g, grown.region, seeds) : null
    if (stranded?.size) grown = { ...grown, region: grown.region.filter((v) => !stranded.has(v)) }
    if (grown.region.length < 60) continue
    const fit = steps.finish(grown)
    if (fit) return fit
  }
  return null
}

/** Flood from a seed over every edge whose two vertex normals turn by less
 *  than `maxAngleDeg` — QuickSurface's click-and-grow, with the angle as the
 *  slider. Unlike the model-guided growing below, nothing is fitted and
 *  nothing peeled: the region is whatever the surface reaches without a
 *  crease, which on a tessellated part is exactly one face and on a scan is
 *  a patch the angle bounds. `limit` caps the flood so a degree set wide
 *  cannot take the whole part before the hand can react. */
export function floodByNormal(g: MeshGraph, seed: number, maxAngleDeg: number, limit = g.vertexCount): Uint32Array {
  if (seed < 0 || seed >= g.vertexCount) return new Uint32Array(0)
  const cosMin = Math.cos((Math.max(0, maxAngleDeg) * Math.PI) / 180)
  const n = g.normals
  const { stamp, gen } = acquireStamps(g, g.vertexCount)
  const queue: number[] = [seed]
  stamp[seed] = gen
  let head = 0
  while (head < queue.length && queue.length < limit) {
    const v = queue[head++]
    const vx = n[v * 3], vy = n[v * 3 + 1], vz = n[v * 3 + 2]
    const end = g.adjOffsets[v + 1]
    for (let e = g.adjOffsets[v]; e < end; e++) {
      const nb = g.adjList[e]
      if (stamp[nb] === gen) continue
      if (vx * n[nb * 3] + vy * n[nb * 3 + 1] + vz * n[nb * 3 + 2] < cosMin) continue
      stamp[nb] = gen
      queue.push(nb)
      if (queue.length >= limit) break
    }
  }
  return Uint32Array.from(queue)
}

/** What one geometry needs to contribute to the shared growing loop. */
interface GrowSpec<T> {
  /** Smallest |cos| between a vertex normal and the model's surface normal
   *  that still counts as the same surface. */
  cosMax: number
  /** Half-width of the acceptance band around the surface. */
  band: (m: T, sigma: number) => number
  /** Distance of a vertex from the model surface; NaN where undefined. */
  residual: (m: T, x: number, y: number, z: number) => number
  /** |cos| between the vertex normal and the model's surface normal there. */
  align: (m: T, x: number, y: number, z: number, nx: number, ny: number, nz: number) => number
  /** The same cosine signed: positive where the vertex normal points away
   *  from the axis or centre (a convex surface), for a guide's side. */
  signed?: (m: T, x: number, y: number, z: number, nx: number, ny: number, nz: number) => number
  refit: (
    positions: Float32Array,
    idx: Uint32Array,
    m: T,
  ) => { model: T; sigma: number } | null
}

export interface GrowResult<T> {
  region: Uint32Array
  model: T
  sigma: number
}

/** Peel the transition off the rim of a grown region: a scan rounds every
 *  edge over a few vertex rings, and the growing test lets the first of them
 *  in — their distance is still inside the band and their normals still
 *  within the coarse angle that has to tolerate scan noise. Those rings sit
 *  systematically off the surface (into the part on a rounded edge, out of
 *  it at a burr or a bore's flared mouth) and their normals turn away from
 *  the model far more than the noise on the surface proper does. So the rim
 *  ring goes while its median tilt exceeds the region's median tilt by
 *  `PEEL_TILT_FACTOR`, ring by ring, until a ring looks like the interior.
 *  Never below half the grown region, so a small face is not eaten from the
 *  outside in. `stamp[v] === gen` marks membership on the way in and is
 *  cleared for what is peeled; returns the vertices that stay. */
function peelTransition(
  g: MeshGraph,
  stamp: Int32Array,
  gen: number,
  queue: number[],
  alignAt: (v: number) => number,
): number[] {
  const n = queue.length
  if (n < 60) return queue
  const all = new Float32Array(n)
  for (let i = 0; i < n; i++) all[i] = alignAt(queue[i])
  all.sort()
  // The largest |cos| is the smallest tilt: the median of one is the median
  // of the other.
  const noiseTilt = Math.acos(Math.min(1, all[n >> 1]))
  const limit = Math.cos(Math.max(PEEL_TILT_FACTOR * noiseTilt, noiseTilt + PEEL_TILT_FLOOR))
  const keepAtLeast = Math.max(60, n >> 1)

  let ring: number[] = []
  for (let i = 0; i < n; i++) {
    const v = queue[i]
    const end = g.adjOffsets[v + 1]
    for (let e = g.adjOffsets[v]; e < end; e++) {
      if (stamp[g.adjList[e]] !== gen) {
        ring.push(v)
        break
      }
    }
  }

  let remaining = n
  for (let k = 0; k < MAX_PEEL_RINGS && ring.length > 0; k++) {
    if (remaining - ring.length < keepAtLeast) break
    const ringAlign = new Float32Array(ring.length)
    for (let i = 0; i < ring.length; i++) ringAlign[i] = alignAt(ring[i])
    ringAlign.sort()
    if (ringAlign[ring.length >> 1] >= limit) break

    // gen is positive, so neither 0 nor -gen ever reads as a member.
    for (const v of ring) stamp[v] = 0
    remaining -= ring.length
    const next: number[] = []
    for (const v of ring) {
      const end = g.adjOffsets[v + 1]
      for (let e = g.adjOffsets[v]; e < end; e++) {
        const nb = g.adjList[e]
        if (stamp[nb] === gen) {
          stamp[nb] = -gen
          next.push(nb)
        }
      }
    }
    for (const v of next) stamp[v] = gen
    ring = next
  }

  if (remaining === n) return queue
  const kept: number[] = []
  for (let i = 0; i < n; i++) if (stamp[queue[i]] === gen) kept.push(queue[i])
  return kept
}

/** Grow the element's surface region from the seed while the model is refit
 *  every round. Membership needs BOTH a distance inside the current noise band
 *  AND a surface normal agreeing with the model's — the normal test is what
 *  stops the region from leaking across an edge onto a neighbouring face, or
 *  onto the connecting rod at a sphere's neck. The BFS restarts from the seed
 *  each round with the improved model, capped at 3× the previous region size
 *  so a bad early model cannot flood the whole mesh before the fit corrects
 *  it. What the finished region holds of the edges' rounding is peeled off
 *  its rim at the end (see `peelTransition`) — after the growing, not inside
 *  it, so the band that decides where a surface ends stays the one tuned
 *  against GOM's selections and is not tightened by its own trimming. */
function growRegion<T>(
  g: MeshGraph,
  seeds: ArrayLike<number>,
  init: T,
  initSigma: number,
  initCount: number,
  spec: GrowSpec<T>,
  guide?: FitGuide,
): GrowResult<T> | null {
  const { positions, normals } = g
  // A side asks for the signed test: a vertex whose normal faces the wrong
  // way — the outside of a cup grown from its inside — does not join.
  const signed = spec.signed
  const sideSign = guide?.side && signed ? (guide.side === 'outside' ? 1 : -1) : 0
  let model = init
  let sigma = Math.max(initSigma, 1e-6)
  let prev = Math.max(initCount, 50)
  /** The last round's region as grown, with the stamps that mark it. */
  let last: { queue: number[]; stamp: Int32Array; gen: number; hitCap: boolean } | null = null

  for (let round = 0; round < 30; round++) {
    const band = spec.band(model, sigma)
    const cap = Math.max(6000, prev * 3)
    const { stamp, gen } = acquireStamps(g, g.vertexCount)
    const queue: number[] = []
    let hitCap = false

    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i]
      if (stamp[seed] !== gen) {
        stamp[seed] = gen
        queue.push(seed)
      }
    }

    let head = 0
    outer: while (head < queue.length) {
      const v = queue[head++]
      const end = g.adjOffsets[v + 1]
      for (let e = g.adjOffsets[v]; e < end; e++) {
        const nb = g.adjList[e]
        if (stamp[nb] === gen) continue
        const j = nb * 3
        const x = positions[j], y = positions[j + 1], z = positions[j + 2]
        const res = spec.residual(model, x, y, z)
        // NaN (undefined residual) fails this test, as it should.
        if (!(Math.abs(res) <= band)) continue
        const a = sideSign
          ? sideSign * signed!(model, x, y, z, normals[j], normals[j + 1], normals[j + 2])
          : spec.align(model, x, y, z, normals[j], normals[j + 1], normals[j + 2])
        if (a < spec.cosMax) continue
        if (guide?.within && !inBox(guide, x, y, z)) continue
        stamp[nb] = gen
        queue.push(nb)
        if (queue.length >= cap) {
          hitCap = true
          break outer
        }
      }
    }

    const region = Uint32Array.from(queue)
    if (region.length < 10) return null

    let fitIdx: Uint32Array = region
    if (region.length > FIT_SUBSAMPLE) {
      const stride = region.length / FIT_SUBSAMPLE
      fitIdx = new Uint32Array(FIT_SUBSAMPLE)
      for (let i = 0; i < FIT_SUBSAMPLE; i++) fitIdx[i] = region[Math.floor(i * stride)]
    }
    const fit = spec.refit(positions, fitIdx, model)
    if (!fit) return null

    const growth = Math.abs(region.length - prev)
    model = fit.model
    sigma = Math.max(fit.sigma, 1e-6)
    last = { queue, stamp, gen, hitCap }
    if (!hitCap && round >= 3 && growth <= Math.max(3, 0.002 * prev)) break
    prev = region.length
  }

  if (!last) return null
  // A capped region stops mid-surface; its rim is the BFS front, not an
  // edge, so there is nothing to peel.
  const m = model
  const alignAt = (v: number): number => {
    const j = v * 3
    return spec.align(m, positions[j], positions[j + 1], positions[j + 2], normals[j], normals[j + 1], normals[j + 2])
  }
  const kept = last.hitCap ? last.queue : peelTransition(g, last.stamp, last.gen, last.queue, alignAt)
  return { region: Uint32Array.from(kept), model, sigma }
}

const SPHERE_SPEC: GrowSpec<Sphere> = {
  cosMax: COS_SPHERE_MAX,
  band: (s, sigma) => Math.max(3.5 * sigma, 0.004 * s.r),
  residual: (s, x, y, z) => {
    const d = Math.sqrt((x - s.cx) ** 2 + (y - s.cy) ** 2 + (z - s.cz) ** 2)
    return d < 1e-12 ? NaN : d - s.r
  },
  align: (s, x, y, z, nx, ny, nz) => {
    const dx = x - s.cx, dy = y - s.cy, dz = z - s.cz
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    return Math.abs((dx * nx + dy * ny + dz * nz) / d)
  },
  signed: (s, x, y, z, nx, ny, nz) => {
    const dx = x - s.cx, dy = y - s.cy, dz = z - s.cz
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    return d > 1e-12 ? (dx * nx + dy * ny + dz * nz) / d : 0
  },
  refit: (positions, idx) => {
    const fit = fitSphereClipped(positions, idx, 3)
    return fit && { model: fit.sphere, sigma: fit.sigma }
  },
}

/** Grow the spherical surface around the seed. */
export function growSphereRegion(
  g: MeshGraph,
  seeds: ArrayLike<number>,
  init: Sphere,
  initSigma: number,
  initCount: number,
  guide?: FitGuide,
): GrowResult<Sphere> | null {
  return growRegion(g, seeds, init, initSigma, initCount, SPHERE_SPEC, guide)
}

/** Grow the cylindrical surface around the seed. The region is free to run
 *  the full length of the cylinder — it is the radial band and the radial
 *  normal check that stop it at the end faces. */
export function growCylinderRegion(
  g: MeshGraph,
  seeds: ArrayLike<number>,
  init: Cylinder,
  initSigma: number,
  initCount: number,
  guide?: FitGuide,
): GrowResult<Cylinder> | null {
  const radial = (c: Cylinder, x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const qx = x - c.px, qy = y - c.py, qz = z - c.pz
    const t = qx * c.ax + qy * c.ay + qz * c.az
    const wx = qx - t * c.ax, wy = qy - t * c.ay, wz = qz - t * c.az
    const rho = Math.sqrt(wx * wx + wy * wy + wz * wz)
    if (!(rho > 1e-12)) return 0
    return (wx * nx + wy * ny + wz * nz) / rho
  }
  return growRegion(g, seeds, init, initSigma, initCount, {
    cosMax: COS_CYLINDER_MAX,
    band: (c, sigma) => Math.max(3.5 * sigma, 0.004 * c.r),
    residual: (c, x, y, z) => cylinderResidual(c, x, y, z),
    align: (c, x, y, z, nx, ny, nz) => Math.abs(radial(c, x, y, z, nx, ny, nz)),
    signed: radial,
    refit: (positions, idx, c) => {
      const fit = fitCylinderClipped(positions, idx, c, 3)
      return fit && { model: fit.cylinder, sigma: fit.sigma }
    },
  }, guide)
}

/** Grow the toroidal surface around the seed — a fillet's round, a bend.
 *  The band floor hangs off the tube radius, the smaller of the two, since
 *  that is the curvature the scan resolves the surface against. */
export function growTorusRegion(
  g: MeshGraph,
  seeds: ArrayLike<number>,
  init: Torus,
  initSigma: number,
  initCount: number,
  guide?: FitGuide,
): GrowResult<Torus> | null {
  return growRegion(g, seeds, init, initSigma, initCount, {
    cosMax: COS_CYLINDER_MAX,
    band: (t, sigma) => Math.max(3.5 * sigma, 0.004 * t.r),
    residual: torusResidual,
    align: torusNormalAlign,
    refit: (positions, idx, t) => {
      const fit = fitTorusClipped(positions, idx, 3, t)
      return fit && { model: fit.torus, sigma: fit.sigma }
    },
  }, guide)
}

/** Grow the conical surface around the seed. Same shape of spec as the
 *  cylinder's — the band floor hangs off the anchor radius, which sits at the
 *  clicked patch and so tracks the size of the surface actually under the
 *  region. */
export function growConeRegion(
  g: MeshGraph,
  seeds: ArrayLike<number>,
  init: Cone,
  initSigma: number,
  initCount: number,
  guide?: FitGuide,
): GrowResult<Cone> | null {
  return growRegion(g, seeds, init, initSigma, initCount, {
    cosMax: COS_CONE_MAX,
    band: (c, sigma) => Math.max(3.5 * sigma, 0.004 * c.r),
    residual: coneResidual,
    align: coneNormalAlign,
    signed: coneNormalSigned,
    refit: (positions, idx, c) => {
      const fit = fitConeClipped(positions, idx, c, 3)
      return fit && { model: fit.cone, sigma: fit.sigma }
    },
  }, guide)
}

/** Grow the flat surface around the seed. A plane has no size of its own, so
 *  the band floor is tied to the model's overall scale rather than a radius. */
export function growPlaneRegion(
  g: MeshGraph,
  seeds: ArrayLike<number>,
  init: Plane,
  initSigma: number,
  initCount: number,
  guide?: FitGuide,
): GrowResult<Plane> | null {
  const floor = 2e-4 * g.bboxDiag
  return growRegion(g, seeds, init, initSigma, initCount, {
    cosMax: COS_PLANE_MAX,
    band: (_p, sigma) => Math.max(3.5 * sigma, floor),
    residual: (p, x, y, z) => planeResidual(p, x, y, z),
    align: (p, _x, _y, _z, nx, ny, nz) => Math.abs(p.nx * nx + p.ny * ny + p.nz * nz),
    refit: (positions, idx) => {
      const fit = fitPlaneClipped(positions, idx, 3)
      return fit && { model: fit.plane, sigma: fit.sigma }
    },
  }, guide)
}
