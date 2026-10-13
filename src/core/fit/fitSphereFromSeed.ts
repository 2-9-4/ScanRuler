// SPDX-License-Identifier: AGPL-3.0-only
// A sphere from a click or from a painted selection, ready to be an element.
// The clicked path turns down what only passes for a ball — a flat, a rod, a
// stray region — by its size against the part's and its noise against its
// radius; a painted selection is taken as given.

import type { FitSettings, MeshGraph, SphereFitOutput } from '../types'
import { FitError } from './errors'
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
): SphereFitOutput {
  const fit = seededFit(g, seeds, {
    estimate: (patch, seed) => ransacSphere(g.positions, patch, { seed }),
    grow: (cand) => growSphereRegion(g, seeds, cand.sphere, cand.sigma, cand.inliers.length),
    finish: (grown) => {
      const fin = fitSphereClipped(g.positions, grown.region, settings.sigma)
      if (!fin) return null
      const { sphere } = fin
      if (!Number.isFinite(sphere.r) || sphere.r <= 0) return null
      // A "sphere" larger than the model or noisier than 3% of its radius is a
      // misfit (flat area, rod, junk region) — try a larger patch or fail.
      if (sphere.r > 0.8 * g.bboxDiag) return null
      if (fin.sigma > 0.03 * sphere.r) return null
      return sphereOutput(fin, grown.region)
    },
  })
  if (fit) return fit
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
  const fin = fitSphereClipped(g.positions, selection, settings.sigma)
  if (!fin || !Number.isFinite(fin.sphere.r) || fin.sphere.r <= 0) {
    throw new FitError(
      "Couldn't fit a sphere to the marked surface — it curves too little to place a centre. Mark more of the ball.",
    )
  }
  return sphereOutput(fin, selection)
}

/** The sphere fitted to `region`, as an element takes it. */
function sphereOutput(fin: NonNullable<ReturnType<typeof fitSphereClipped>>, region: Uint32Array): SphereFitOutput {
  const { sphere } = fin
  return {
    kind: 'sphere',
    center: [sphere.cx, sphere.cy, sphere.cz],
    radius: sphere.r,
    sigma: fin.sigma,
    usedPoints: fin.used.length,
    regionSize: region.length,
    formError: fin.span,
    residualMin: fin.min,
    residualMax: fin.max,
    region,
  }
}
