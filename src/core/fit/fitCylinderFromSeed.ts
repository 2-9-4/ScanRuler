// SPDX-License-Identifier: AGPL-3.0-only
// A cylinder from a click or from a painted selection, ready to be an
// element: patch, robust estimate, a region grown along the whole wall, the
// clipped best fit, and the checks that turn down a flat or a stray region
// passing for one. The fit can also be confined to a span along the axis;
// the reported length then stays the whole surface's, so the span is a fixed
// distance in from the feature's ends rather than creeping inward with every
// refit, while axis, radius and sigma come from the kept surface alone.

import type { AxialWindow, Cylinder, CylinderFit, FitSettings, MeshGraph } from '../types'
import {
  axisFromNormals,
  cylinderResidual as cylinderResidualAt,
  fitCylinderClipped,
  fitCylinderOnAxis,
  ransacCylinder,
  type ClippedCylinderFit,
} from './cylinder'
import { FitError } from './errors'
import { axialExtents } from './extents'
import { axisAgrees, guidedEstimate, guidedSeeds, guideRefusal, hasGuide, judgeRound, radialOff, type FitGuide, type GuideSeen } from './guide'
import { growCylinderRegion, seededFit } from './regionGrow'
import { MIN_SELECTED, requireSelection } from './selection'

type CylinderResult = CylinderFit & { region: Uint32Array }

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

/** Full auto-fit pipeline from a single user click:
 *  1. BFS a local patch around the seed,
 *  2. robust LMedS cylinder estimate on the patch (normal-covariance axis plus
 *     two-point-with-normals candidates),
 *  3. model-guided region growing across the whole cylindrical surface,
 *  4. final Gaussian best-fit with the user's "used points" sigma preset.
 *  Retried with a larger patch when the local neighborhood is too small or too
 *  flat to pin the axis down. */
export function fitCylinderFromSeed(
  g: MeshGraph,
  seeds: number[],
  settings: FitSettings,
  window?: AxialWindow,
  guide?: FitGuide,
): CylinderResult {
  const guided = hasGuide(guide) ? guide : null
  const seen: GuideSeen[] = []
  const radial = (c: Cylinder) => radialOff(c.px, c.py, c.pz, c.ax, c.ay, c.az)
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
                ? { radius: c.cylinder.r, why: 'axis off' }
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
      const fin = fitCylinderClipped(g.positions, grown.region, grown.model, settings.sigma)
      if (!fin) return null
      const c = fin.cylinder
      if (!Number.isFinite(c.r) || c.r <= 0) return null
      // Out of scale with the model, or noisier than 3% of the radius: this was
      // a flat patch or a junk region, not a cylinder.
      if (c.r > 0.8 * g.bboxDiag) return null
      if (fin.sigma > 0.03 * c.r) return null

      const result = cylinderResult(g.positions, fin, grown.region, grown.region)
      // Under ~30° of arc the circle through the points is barely curved, so
      // the radius and the axis position are guesses.
      if (!result || !(result.coverage >= 29)) return null
      if (guided) {
        const no = !axisAgrees(guided, result.axis)
          ? { radius: c.r, why: 'axis off' }
          : judgeRound(g, guided, c.r, grown.region, radial(c), false)
        if (no) {
          seen.push(no)
          return null
        }
      }

      // The surface has been found; confining the fit to part of it is a
      // separate matter, and one a bigger patch could not help with.
      return window ? fitInsideWindow(g, result, window, settings) : result
    },
  })
  if (fit) return fit
  if (guided) throw new FitError(guideRefusal('cylinder', guided, seen))
  throw new FitError(
    "Couldn't fit a cylinder at this point — try clicking on a clearly curved part of the cylindrical surface.",
  )
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
