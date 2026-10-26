// SPDX-License-Identifier: AGPL-3.0-only
// A cylinder from a click or from a painted selection, ready to be an
// element: patch, robust estimate, a region grown along the whole wall, the
// clipped best fit, and the checks that turn down a flat or a stray region
// passing for one. The fit can also be confined to a span along the axis;
// the reported length then stays the whole surface's, so the span is a fixed
// distance in from the feature's ends rather than creeping inward with every
// refit, while axis, radius and sigma come from the kept surface alone.

import type { AxialWindow, Cylinder, CylinderFit, FitSettings, FitTold, MeshGraph } from '../types'
import {
  axisFromNormals,
  cylinderResidual as cylinderResidualAt,
  fitCylinderClipped,
  fitCylinderOnAxis,
  ransacCylinder,
  type ClippedCylinderFit,
} from './cylinder'
import { FitError } from './errors'
import { solveLinear } from './linalg'
import { axialExtents } from './extents'
import { axisAgrees, axisOff, guidedEstimate, guidedSeeds, guideRefusal, hasGuide, judgeRound, keepWhere, radialOff, type FitGuide, type GuideSeen } from './guide'
import { growCylinderRegion, seededFit } from './regionGrow'
import { MIN_SELECTED, requireSelection } from './selection'

type CylinderResult = CylinderFit & { region: Uint32Array; told?: FitTold }

/** The fit as it is reported: the axis, the radius and the residual numbers
 *  off the finished best fit, the arc and the point counts off the surface
 *  it ran on, the middle and the length off how far `extent` reaches along
 *  the axis. The two surfaces are the same one unless the fit was confined
 *  to a window — then the length still says how much of the feature the scan
 *  covered, while everything else is the kept surface's own. */
function cylinderResult(
  positions: Float32Array,
  fin: ClippedCylinderFit,
  used: Uint32Array,
  extent: Uint32Array,
): CylinderResult | null {
  const c = fin.cylinder
  const onUsed = axialExtents(positions, used, c)
  const span = extent === used ? onUsed : axialExtents(positions, extent, c)
  const length = span.maxT - span.minT
  if (!(length > 0)) return null
  const mid = (span.minT + span.maxT) / 2
  return {
    kind: 'cylinder',
    center: [c.px + mid * c.ax, c.py + mid * c.ay, c.pz + mid * c.az],
    axis: [c.ax, c.ay, c.az],
    radius: c.r,
    length,
    coverage: onUsed.coverage,
    sigma: fin.sigma,
    usedPoints: fin.used.length,
    regionSize: used.length,
    formError: fin.span,
    residualMin: fin.min,
    residualMax: fin.max,
    region: used,
  }
}

/**
 * The fit again, on only the surface inside the drawn span.
 *
 * The span is measured off the fit already in hand — its two ends, moved by
 * the window — so what is kept is exactly what the user sees kept when an end
 * grip is pulled in. The best fit then starts from that fit and runs on the
 * kept vertices alone. What comes back keeps the length of the whole surface
 * (measured along the new axis), so the window stays a fixed pair of numbers
 * off the feature's ends rather than creeping in with every re-fit, while the
 * axis, the radius, the sigma and the point counts are the kept surface's own.
 *
 * A window that only reaches outward takes nothing away, and the fit stands.
 */
function fitInsideWindow(
  g: MeshGraph,
  full: CylinderResult,
  window: AxialWindow,
  settings: FitSettings,
): CylinderResult {
  if (!(window.start < 0) && !(window.end < 0)) return full
  const region = full.region
  const [ax, ay, az] = full.axis
  const [cx, cy, cz] = full.center
  const half = full.length / 2
  const lo = -half - window.start
  const hi = half + window.end

  const kept: number[] = []
  for (let i = 0; i < region.length; i++) {
    const j = region[i] * 3
    const t =
      (g.positions[j] - cx) * ax + (g.positions[j + 1] - cy) * ay + (g.positions[j + 2] - cz) * az
    if (t >= lo && t <= hi) kept.push(region[i])
  }
  if (kept.length < MIN_SELECTED) {
    throw new FitError(
      `Only ${kept.length} of the ${region.length} points lie inside the span — a fit needs at least ${MIN_SELECTED}. Pull the ends back out, or switch the option off.`,
    )
  }
  const used = Uint32Array.from(kept)

  const init: Cylinder = { px: cx, py: cy, pz: cz, ax, ay, az, r: full.radius }
  const fin = fitCylinderClipped(g.positions, used, init, settings.sigma)
  if (!fin || !Number.isFinite(fin.cylinder.r) || fin.cylinder.r <= 0) {
    throw new FitError("Couldn't fit a cylinder to the surface inside the span.")
  }
  const result = cylinderResult(g.positions, fin, used, region)
  if (!result) throw new FitError("Couldn't measure the length of the surface inside the span.")
  return result
}

/** A surface the search found and turned down, with what it saw of it. */
interface TurnedDown {
  radius: number
  sigma: number
  /** How far the region it grew reaches along the axis, mm. */
  length: number
  coverage: number
  why: 'noise' | 'arc' | 'scale'
}

/** What a surface turned down was, in the words a refusal lists it with —
 *  the numbers first, then what they suggest. */
function turnedDownAs(s: TurnedDown): string {
  const over = `σ ${s.sigma.toFixed(2)} over ${s.length.toFixed(1)} mm along the axis`
  if (s.why === 'noise') return `${over} — two surfaces? give within, or seed nearer one end`
  if (s.why === 'arc') return `${over}, ${Math.round(s.coverage)}° of arc — too little of the round to pin it; seed where more of it was scanned`
  return 'out of scale with the part — a flat, not a round'
}

/** Full auto-fit pipeline from a single user click:
 *  1. BFS a local patch around the seed,
 *  2. robust LMedS cylinder estimate on the patch (normal-covariance axis plus
 *     two-point-with-normals candidates),
 *  3. model-guided region growing across the whole cylindrical surface,
 *  4. final Gaussian best-fit with the user's "used points" sigma preset.
 *  Retried with a larger patch when the local neighborhood is too small or too
 *  flat to pin the axis down.
 *
 *  A region noisier than the radius allows has most often run on past a
 *  step — a bore half a millimetre wider below a flange: the band is
 *  refitted from each round's σ, so it widens with the region and takes
 *  both. Such a region is parted along the axis where two cylinders fit it
 *  best (see partAlong), the part the seed is on fitted on its own, and the
 *  other answered as `told.second`. What is turned down on the way is listed
 *  in the refusal when nothing stands. */
export function fitCylinderFromSeed(
  g: MeshGraph,
  seeds: number[],
  settings: FitSettings,
  window?: AxialWindow,
  guide?: FitGuide,
): CylinderResult {
  const guided = hasGuide(guide) ? guide : null
  const seen: GuideSeen[] = []
  const turned: TurnedDown[] = []
  const radial = (c: Cylinder) => radialOff(c.px, c.py, c.pz, c.ax, c.ay, c.az)

  /** The best fit on a grown region with the checks every surface passes,
   *  or what was seen when it is turned down. */
  const judge = (region: Uint32Array, model: Cylinder): { result: CylinderResult; fin: ClippedCylinderFit } | TurnedDown | null => {
    const fin = fitCylinderClipped(g.positions, region, model, settings.sigma)
    if (!fin) return null
    const c = fin.cylinder
    if (!Number.isFinite(c.r) || c.r <= 0) return null
    const span = axialExtents(g.positions, region, c)
    const seenAs = (why: TurnedDown['why']): TurnedDown => ({ radius: c.r, sigma: fin.sigma, length: span.maxT - span.minT, coverage: span.coverage, why })
    // Out of scale with the model, or noisier than 3% of the radius: this was
    // a flat patch or a junk region, not a cylinder.
    if (c.r > 0.8 * g.bboxDiag) return seenAs('scale')
    if (fin.sigma > 0.03 * c.r) return seenAs('noise')
    const result = cylinderResult(g.positions, fin, region, region)
    // Under ~30° of arc the circle through the points is barely curved, so
    // the radius and the axis position are guesses.
    if (!result || !(result.coverage >= 29)) return seenAs('arc')
    return { result, fin }
  }

  /** The guide's verdict on a fit that passed the checks: null when it
   *  stands. */
  const guideSays = (result: CylinderResult, c: Cylinder, region: Uint32Array): GuideSeen | null =>
    !guided
      ? null
      : !axisAgrees(guided, result.axis)
        ? axisOff(guided, c.r, result.axis, result.center, region.length)
        : judgeRound(g, guided, c.r, region, radial(c), false)

  /** A region that read as two surfaces, parted along the axis: the seed's
   *  part fitted and checked, moved in from the cut toward the seed while
   *  its fit is still too noisy — the step's own rounding, a wall that
   *  tapers into it — with the other part as `told.second`. */
  const parted = (wide: Uint32Array, model: Cylinder, first: TurnedDown): CylinderResult | null => {
    const seed = seeds[0]
    if (seed === undefined) return null
    const part = partAlong(g.positions, wide, model, first.sigma, seed)
    if (!part) return null
    for (const cut of part.cuts) {
      const near = part.nearAt(cut)
      if (near.length < MIN_SELECTED) break
      const j = judge(near, model)
      if (!j || !('result' in j)) continue
      if (guideSays(j.result, j.fin.cylinder, near)) return null
      const r = j.result
      const [cx, cy, cz] = r.center
      const [ax, ay, az] = r.axis
      const ends = axialExtents(g.positions, part.far, { px: cx, py: cy, pz: cz, ax, ay, az })
      const second = { radius: part.farFit.cylinder.r, band: [ends.minT, ends.maxT] as [number, number], share: part.far.length / wide.length }
      r.told = {
        note:
          `Grown freely the surface read σ ${first.sigma.toFixed(2)} over ${first.length.toFixed(1)} mm — two surfaces along the axis. ` +
          `Parted where two cylinders fit it best: R${r.radius.toFixed(3)} over ${r.length.toFixed(1)} mm where the seed is (σ ${r.sigma.toFixed(3)}); ` +
          `R${second.radius.toFixed(3)} from ${second.band[0].toFixed(1)} to ${second.band[1].toFixed(1)} mm along the axis from its centre (second). Give within to fit the other.`,
        second,
      }
      return r
    }
    return null
  }

  const fit = seededFit(g, seeds, {
    estimate: (patch, seed) =>
      guided
        ? guidedEstimate(
            g,
            patch,
            guided,
            (p) => ransacCylinder(g.positions, g.normals, p, { seed }),
            (c) =>
              !axisAgrees(guided, [c.cylinder.ax, c.cylinder.ay, c.cylinder.az])
                ? axisOff(guided, c.cylinder.r, [c.cylinder.ax, c.cylinder.ay, c.cylinder.az], [c.cylinder.px, c.cylinder.py, c.cylinder.pz], c.inliers.length)
                : judgeRound(g, guided, c.cylinder.r, c.inliers, radial(c.cylinder), true),
            (c, v) => {
              const j = v * 3
              const e = cylinderResidualAt(c.cylinder, g.positions[j], g.positions[j + 1], g.positions[j + 2])
              return Math.abs(e) <= Math.max(3 * c.sigma, 0.01 * c.cylinder.r)
            },
            seen,
          )
        : ransacCylinder(g.positions, g.normals, patch, { seed }),
    grow: (cand) => {
      const from = guided ? guidedSeeds(g, cand.inliers, guided, radial(cand.cylinder)) : seeds
      return from.length ? growCylinderRegion(g, from, cand.cylinder, cand.sigma, cand.inliers.length, guided ?? undefined) : null
    },
    finish: (grown) => {
      const j = judge(grown.region, grown.model)
      if (!j) return null
      let result: CylinderResult | null = null
      if (!('result' in j)) {
        result = j.why === 'noise' ? parted(grown.region, grown.model, j) : null
        if (!result) {
          // Remembered for the refusal — with a guide in the guide's list.
          turned.push(j)
          if (guided) seen.push({ radius: j.radius, why: turnedDownAs(j) })
          return null
        }
      } else {
        const no = guideSays(j.result, j.fin.cylinder, grown.region)
        if (no) {
          seen.push(no)
          return null
        }
        result = j.result
      }

      // The surface has been found; confining the fit to part of it is a
      // separate matter, and one a bigger patch could not help with.
      if (!window) return result
      const inside = fitInsideWindow(g, result, window, settings)
      return result.told ? { ...inside, told: result.told } : inside
    },
  })
  if (fit) return fit
  if (guided) throw new FitError(guideRefusal('cylinder', guided, seen))
  // The rounds first, then the flats; one line per size.
  const found = [...new Map(turned.map((t) => [t.radius.toFixed(2), t])).values()]
    .sort((a, b) => Number(a.why === 'scale') - Number(b.why === 'scale'))
    .slice(0, 3)
  const said = found.length ? ` Found ${found.map((t) => `R${t.radius.toFixed(2)} (${turnedDownAs(t)})`).join(', ')}.` : ''
  throw new FitError(`Couldn't fit a cylinder at this point.${said} Try clicking on a clearly curved part of the cylindrical surface.`)
}

/** The cuts along the axis a region is tried parted at: this many over its
 *  length, but never closer than this share of the radius. */
const PART_CUTS = 64
const PART_STEP_OF_R = 0.05
/** Points each side of a cut is fitted on during the search, at most; the
 *  part kept is fitted on all of its own. */
const PART_SAMPLE = 3000
/** Two parts are taken over one when they leave this share of its σ or
 *  less, and of the σ left once a radius changing smoothly along the axis
 *  is taken out. */
const PART_GAIN = 0.7

/**
 * A region that is two cylinders one after the other along the axis — a
 * bore and a counterbore, a bore that steps wider into a boss — parted at
 * the cut where a cylinder fitted on each side leaves the least scatter.
 * Unlike splitTwoCylinders, which gives each point to the nearer of two
 * cylinders, this holds when the wider one is off centre and its wall meets
 * the narrower one's down one side. Null when no cut leaves under PART_GAIN
 * of the one cylinder's σ.
 *
 * `cuts` runs from the best cut toward the seed, a step at a time, and
 * `nearAt` gives the seed's part at one — for the caller to take the first
 * that fits as one surface; `far` is the other part at the best cut, with
 * its fit.
 */
function partAlong(
  positions: Float32Array,
  region: Uint32Array,
  model: Cylinder,
  sigmaOne: number,
  seed: number,
): { cuts: number[]; nearAt: (cut: number) => Uint32Array; far: Uint32Array; farFit: ClippedCylinderFit } | null {
  const c = model
  const along = (v: number) => (positions[v * 3] - c.px) * c.ax + (positions[v * 3 + 1] - c.py) * c.ay + (positions[v * 3 + 2] - c.pz) * c.az
  const t = Float64Array.from(region, along)
  const ts = along(seed)
  let lo = Infinity, hi = -Infinity
  for (const x of t) {
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  const step = Math.max((hi - lo) / PART_CUTS, PART_STEP_OF_R * c.r)
  const stride = Math.max(1, Math.floor(region.length / PART_SAMPLE))
  const sides = (cut: number, every: number) => {
    const near: number[] = []
    const far: number[] = []
    const up = ts > cut
    for (let i = 0; i < region.length; i += every) (t[i] > cut === up ? near : far).push(region[i])
    return { near: Uint32Array.from(near), far: Uint32Array.from(far) }
  }
  let best: { cut: number; rms: number } | null = null
  for (let cut = lo + 2 * step; cut <= hi - 2 * step; cut += step) {
    const { near, far } = sides(cut, stride)
    if (near.length < 30 || far.length < 30) continue
    const a = fitCylinderClipped(positions, near, c, 3)
    const b = fitCylinderClipped(positions, far, c, 3)
    if (!a || !b) continue
    const rms = Math.sqrt((a.sigma ** 2 * near.length + b.sigma ** 2 * far.length) / (near.length + far.length))
    if (Number.isFinite(rms) && (!best || rms < best.rms)) best = { cut, rms }
  }
  // A radius that changes smoothly along the axis — a taper, a cone fitted
  // as a cylinder — parts as well as a step does; a quadratic in t takes
  // that out, and the parts must beat it too.
  const m = new Float64Array(9)
  const rhs = new Float64Array(3)
  const e = new Float64Array(region.length)
  for (let i = 0; i < region.length; i++) {
    const j = region[i] * 3
    e[i] = cylinderResidualAt(c, positions[j], positions[j + 1], positions[j + 2])
    const row = [1, t[i], t[i] * t[i]]
    for (let a = 0; a < 3; a++) {
      rhs[a] += row[a] * e[i]
      for (let b = 0; b < 3; b++) m[a * 3 + b] += row[a] * row[b]
    }
  }
  const k = solveLinear(3, m, rhs)
  let ss = 0
  if (k) for (let i = 0; i < region.length; i++) ss += (e[i] - k[0] - k[1] * t[i] - k[2] * t[i] * t[i]) ** 2
  const smooth = k ? Math.sqrt(ss / region.length) : sigmaOne
  if (!best || !(best.rms < PART_GAIN * Math.min(sigmaOne, smooth))) return null
  const at = sides(best.cut, 1)
  const farFit = at.far.length >= MIN_SELECTED ? fitCylinderClipped(positions, at.far, c, 3) : null
  if (!farFit) return null
  const toward = ts > best.cut ? 1 : -1
  const cuts: number[] = []
  for (let cut = best.cut; toward * (ts - cut) > step; cut += toward * step) cuts.push(cut)
  const nearAt = (cut: number) => keepWhere(region, (v) => toward * (along(v) - cut) > 0)
  return { cuts, nearAt, far: at.far, farFit }
}

/** Best-fit cylinder on a hand-painted selection. The axis still has to be
 *  guessed before the five-parameter fit can be refined: the normal-covariance
 *  axis is the cheap and accurate answer for a clean selection, and a robust
 *  LMedS estimate takes over when the marked surface is noisy enough that the
 *  normals alone cannot pin the direction down. */
export function fitCylinderOnSelection(
  g: MeshGraph,
  selection: Uint32Array,
  settings: FitSettings,
  window?: AxialWindow,
): CylinderResult {
  requireSelection(selection, 'cylindrical surface')

  const axis = axisFromNormals(g.normals, selection)
  let init: Cylinder | null = axis ? fitCylinderOnAxis(g.positions, selection, axis) : null
  if (!init) init = ransacCylinder(g.positions, g.normals, selection, { seed: 0x5eed })?.cylinder ?? null
  if (!init) {
    throw new FitError(
      "Couldn't find an axis in the marked surface — it curves too little to be told from a plane. Mark more of the way around the cylinder.",
    )
  }

  const fin = fitCylinderClipped(g.positions, selection, init, settings.sigma)
  if (!fin || !Number.isFinite(fin.cylinder.r) || fin.cylinder.r <= 0) {
    throw new FitError("Couldn't fit a cylinder to the marked surface.")
  }
  const result = cylinderResult(g.positions, fin, selection, selection)
  if (!result) throw new FitError("Couldn't measure the length of the marked surface.")
  return window ? fitInsideWindow(g, result, window, settings) : result
}
