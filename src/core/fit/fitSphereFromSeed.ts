// SPDX-License-Identifier: AGPL-3.0-only
// A sphere from a click or from a painted selection, ready to be an element.
// The clicked path turns down what only passes for a ball — a flat, a rod, a
// stray region — by its size against the part's and its noise against its
// radius; a painted selection is taken as given. Either fits with a known
// diameter held when the settings carry one, and turns it down when the
// surface plainly is not a ball of that size.

import type { AxialWindow, FitSettings, MeshGraph, SphereFitOutput } from '../types'
import { FitError } from './errors'
import { guidedEstimate, guidedSeeds, guideRefusal, hasGuide, judgeRound, radialFrom, type FitGuide, type GuideSeen } from './guide'
import { growSphereRegion, seededFit } from './regionGrow'
import { ransacSphere } from './ransac'
import { requireSelection } from './selection'
import { fitSphereClipped } from './sphere'

export { FitError }

/** Full auto-fit pipeline from a single user click:
 *  1. BFS a local patch around the seed,
 *  2. robust RANSAC/LMedS sphere estimate on the patch,
 *  3. model-guided region growing across the whole sphere surface,
 *  4. final Gaussian best-fit with the user's "used points" sigma preset.
 *  Retried with a larger patch when the local neighborhood is too small or
 *  too flat to pin the sphere down. */
export function fitSphereFromSeed(
  g: MeshGraph,
  seeds: number[],
  settings: FitSettings,
  _window?: AxialWindow,
  guide?: FitGuide,
): SphereFitOutput {
  const guided = hasGuide(guide) ? guide : null
  const seen: GuideSeen[] = []
  const held: HeldFit[] = []
  const fit = seededFit(g, seeds, {
    estimate: (patch, seed) =>
      guided
        ? guidedEstimate(
            g,
            patch,
            guided,
            (p) => ransacSphere(g.positions, p, { seed }),
            (c) => judgeRound(g, guided, c.sphere.r, c.inliers, radialFrom(c.sphere.cx, c.sphere.cy, c.sphere.cz), true),
            (c, v) => {
              const s = c.sphere
              const d = Math.hypot(g.positions[v * 3] - s.cx, g.positions[v * 3 + 1] - s.cy, g.positions[v * 3 + 2] - s.cz)
              return Math.abs(d - s.r) <= Math.max(3 * c.sigma, 0.01 * s.r)
            },
            seen,
          )
        : ransacSphere(g.positions, patch, { seed }),
    grow: (cand) => {
      const from = guided ? guidedSeeds(g, cand.inliers, guided, radialFrom(cand.sphere.cx, cand.sphere.cy, cand.sphere.cz)) : seeds
      return from.length ? growSphereRegion(g, from, cand.sphere, cand.sigma, cand.inliers.length, guided ?? undefined) : null
    },
    finish: (grown) => {
      const fin = fitSphereClipped(g.positions, grown.region, settings.sigma, heldRadius(settings))
      if (!fin) return null
      const { sphere } = fin
      if (!Number.isFinite(sphere.r) || sphere.r <= 0) return null
      // A known diameter far off what the surface fits freely is said as
      // such, before its residuals turn it down as no ball at all.
      if (heldTooFar(fin)) {
        held.push(fin)
        return null
      }
      // A "sphere" larger than the model or noisier than 3% of its radius is a
      // misfit (flat area, rod, junk region) — try a larger patch or fail.
      if (sphere.r > 0.8 * g.bboxDiag) return null
      if (fin.sigma > 0.03 * sphere.r) return null
      if (guided) {
        const no = judgeRound(g, guided, sphere.r, grown.region, radialFrom(sphere.cx, sphere.cy, sphere.cz), false)
        if (no) {
          seen.push(no)
          return null
        }
      }
      return sphereOutput(fin, grown.region)
    },
  })
  if (fit) return fit
  if (held.length) throw new FitError(heldRefusal(held[held.length - 1]))
  if (guided) throw new FitError(guideRefusal('sphere', guided, seen))
  throw new FitError("Couldn't fit a sphere at this point — try clicking nearer the middle of a sphere.")
}

/** Best-fit sphere on a hand-painted selection — the marked points as given,
 *  with the user's outlier cut-off and nothing else in the way. */
export function fitSphereOnSelection(
  g: MeshGraph,
  selection: Uint32Array,
  settings: FitSettings,
): SphereFitOutput {
  requireSelection(selection, 'sphere')
  const fin = fitSphereClipped(g.positions, selection, settings.sigma, heldRadius(settings))
  if (!fin || !Number.isFinite(fin.sphere.r) || fin.sphere.r <= 0) {
    throw new FitError(
      "Couldn't fit a sphere to the marked surface — it curves too little to place a centre. Mark more of the ball.",
    )
  }
  if (heldTooFar(fin)) throw new FitError(heldRefusal(fin))
  return sphereOutput(fin, selection)
}

type HeldFit = NonNullable<ReturnType<typeof fitSphereClipped>>

/** The radius the settings hold, if they hold one. */
function heldRadius(settings: FitSettings): number | undefined {
  const d = settings.knownDiameter
  return d !== undefined && Number.isFinite(d) && d > 0 ? d / 2 : undefined
}

/** A known diameter further off the one the surface fits freely than this —
 *  a millimetre, or a tenth of it on a large ball — is the wrong ball or a
 *  typo, not a scan reading a little off. */
function heldLimit(diameter: number): number {
  return Math.max(1, 0.1 * diameter)
}

function heldTooFar(fin: HeldFit): boolean {
  if (!fin.free) return false
  return Math.abs(2 * fin.free.r - 2 * fin.sphere.r) > heldLimit(2 * fin.sphere.r)
}

function heldRefusal(fin: HeldFit): string {
  const known = 2 * fin.sphere.r
  const free = fin.free ? 2 * fin.free.r : NaN
  return `The surface here fits a sphere of Ø ${free.toFixed(3)} mm, too far from the known Ø ${known.toFixed(3)} mm to hold it — check the diameter, or that this is the ball meant.`
}

/** The sphere fitted to `region`, as an element takes it. */
function sphereOutput(fin: NonNullable<ReturnType<typeof fitSphereClipped>>, region: Uint32Array): SphereFitOutput {
  const { sphere, free } = fin
  return {
    kind: 'sphere',
    center: [sphere.cx, sphere.cy, sphere.cz],
    radius: sphere.r,
    ...(free
      ? { held: { freeDiameter: 2 * free.r, shift: Math.hypot(free.cx - sphere.cx, free.cy - sphere.cy, free.cz - sphere.cz) } }
      : {}),
    sigma: fin.sigma,
    usedPoints: fin.used.length,
    regionSize: region.length,
    formError: fin.span,
    residualMin: fin.min,
    residualMax: fin.max,
    region,
  }
}
