// SPDX-License-Identifier: AGPL-3.0-only
// A cone from a click or from a painted selection, ready to be an element:
// the cylinder's seed-and-grow pipeline with the cone's estimators in it,
// the checks that turn down a flat or a stray patch passing for a taper, and
// the report — the radius at the middle and at both ends read off the taper,
// the half-angle in degrees, the arc of the surface the scan covers.

import type { AxialWindow, Cone, ConeFit, FitBase, FitSettings, MeshGraph } from '../types'
import { coneAxisFromNormals, coneResidual, fitConeClipped, fitConeOnAxis, ransacCone } from './cone'
import { FitError } from './errors'
import { axisAgrees, guidedEstimate, guidedSeeds, guideRefusal, hasGuide, judgeRound, type FitGuide, type GuideSeen } from './guide'
import { axialExtents } from './extents'
import { growConeRegion, seededFit } from './regionGrow'
import { requireSelection } from './selection'

/** The fitted extent turned into the reported geometry: the axis point moves
 *  to the middle of the surface, and the radii at the middle and both ends are
 *  read off the taper. Null when the extent is degenerate or the surface sits
 *  on the wrong side of the apex. */
function coneReport(
  positions: Float32Array,
  region: Uint32Array,
  c: Cone,
): Omit<ConeFit, keyof FitBase | 'kind'> | null {
  const { coverage, minT, maxT } = axialExtents(positions, region, c)
  const length = maxT - minT
  if (!(length > 0)) return null
  const tan = Math.tan(c.phi)
  const mid = (minT + maxT) / 2
  const radius = c.r + mid * tan
  if (!(radius > 0) || !Number.isFinite(radius)) return null
  return {
    center: [c.px + mid * c.ax, c.py + mid * c.ay, c.pz + mid * c.az],
    axis: [c.ax, c.ay, c.az],
    halfAngle: (c.phi * 180) / Math.PI,
    radius,
    // The small end can graze the apex; a hair of numerical overshoot past it
    // is not a negative radius.
    radius1: Math.max(0, c.r + minT * tan),
    radius2: c.r + maxT * tan,
    length,
    coverage,
  }
}

/** The cone's outward surface normal at a point, for a guide's side. */
function coneOutward(c: Cone) {
  const cos = Math.cos(c.phi)
  const sin = Math.sin(c.phi)
  return (x: number, y: number, z: number): [number, number, number] | null => {
    const qx = x - c.px, qy = y - c.py, qz = z - c.pz
    const t = qx * c.ax + qy * c.ay + qz * c.az
    const wx = qx - t * c.ax, wy = qy - t * c.ay, wz = qz - t * c.az
    const rho = Math.hypot(wx, wy, wz)
    if (!(rho > 1e-12)) return null
    return [(cos * wx) / rho - sin * c.ax, (cos * wy) / rho - sin * c.ay, (cos * wz) / rho - sin * c.az]
  }
}

/** Full auto-fit pipeline from a single user click — the cylinder's pipeline
 *  with the cone estimators plugged in:
 *  1. BFS a local patch around the seed,
 *  2. robust LMedS cone estimate on the patch (normal-plane axis plus
 *     three-point-with-normals candidates),
 *  3. model-guided region growing across the whole conical surface,
 *  4. final Gaussian best-fit with the user's "used points" sigma preset.
 *  Retried with a larger patch when the local neighborhood is too small or too
 *  flat to pin the axis down. */
export function fitConeFromSeed(
  g: MeshGraph,
  seeds: number[],
  settings: FitSettings,
  _window?: AxialWindow,
  guide?: FitGuide,
): ConeFit & { region: Uint32Array } {
  const guided = hasGuide(guide) ? guide : null
  const seen: GuideSeen[] = []
  const fit = seededFit(g, seeds, {
    estimate: (patch, seed) =>
      guided
        ? guidedEstimate(
            g,
            patch,
            guided,
            (p) => ransacCone(g.positions, g.normals, p, { seed }),
            (c) =>
              !axisAgrees(guided, [c.cone.ax, c.cone.ay, c.cone.az])
                ? { radius: c.cone.r, why: 'axis off' }
                : judgeRound(g, guided, c.cone.r, c.inliers, coneOutward(c.cone), true),
            (c, v) => {
              const j = v * 3
              return Math.abs(coneResidual(c.cone, g.positions[j], g.positions[j + 1], g.positions[j + 2])) <= Math.max(3 * c.sigma, 0.01 * c.cone.r)
            },
            seen,
          )
        : ransacCone(g.positions, g.normals, patch, { seed }),
    grow: (cand) => {
      const from = guided ? guidedSeeds(g, cand.inliers, guided, coneOutward(cand.cone)) : seeds
      return from.length ? growConeRegion(g, from, cand.cone, cand.sigma, cand.inliers.length, guided ?? undefined) : null
    },
    finish: (grown) => {
      const fin = fitConeClipped(g.positions, grown.region, grown.model, settings.sigma)
      if (!fin) return null
      const c = fin.cone
      if (!Number.isFinite(c.r) || c.r <= 0) return null
      // Steeper than ~83° is a face, not a taper — the plane tool's territory.
      if (!(Math.abs(c.phi) < 1.45)) return null

      const report = coneReport(g.positions, grown.region, c)
      if (!report) return null
      // Out of scale with the model, or noisier than 3% of the mid radius: this
      // was a flat patch or a junk region, not a cone.
      if (report.radius2 > 0.8 * g.bboxDiag) return null
      if (fin.sigma > 0.03 * report.radius) return null
      // Under ~30° of arc the circle through the points is barely curved, so
      // the radius and the axis position are guesses.
      if (!(report.coverage >= 29)) return null
      if (guided) {
        const no = !axisAgrees(guided, report.axis)
          ? { radius: report.radius, why: 'axis off' }
          : judgeRound(g, guided, report.radius, grown.region, coneOutward(c), false)
        if (no) {
          seen.push(no)
          return null
        }
      }
      return coneOutput(report, fin, grown.region)
    },
  })
  if (fit) return fit
  if (guided) throw new FitError(guideRefusal('cone', guided, seen))
  throw new FitError(
    "Couldn't fit a cone at this point — try clicking in the middle of the tapered surface, away from its edges.",
  )
}

/** Best-fit cone on a hand-painted selection. The axis still has to be
 *  guessed before the six-parameter fit can be refined: the normal-plane axis
 *  is the cheap and accurate answer for a clean selection, and a robust LMedS
 *  estimate takes over when the marked surface is noisy enough that the
 *  normals alone cannot pin the direction down. */
export function fitConeOnSelection(
  g: MeshGraph,
  selection: Uint32Array,
  settings: FitSettings,
): ConeFit & { region: Uint32Array } {
  requireSelection(selection, 'conical surface')

  const axis = coneAxisFromNormals(g.normals, selection)
  let init: Cone | null = axis ? fitConeOnAxis(g.positions, selection, axis) : null
  if (!init) init = ransacCone(g.positions, g.normals, selection, { seed: 0x5eed })?.cone ?? null
  if (!init) {
    throw new FitError(
      "Couldn't find an axis in the marked surface — it curves too little to be told from a plane. Mark more of the way around the cone.",
    )
  }

  const fin = fitConeClipped(g.positions, selection, init, settings.sigma)
  if (!fin || !Number.isFinite(fin.cone.r) || fin.cone.r <= 0 || !(Math.abs(fin.cone.phi) < 1.45)) {
    throw new FitError("Couldn't fit a cone to the marked surface.")
  }
  const report = coneReport(g.positions, selection, fin.cone)
  if (!report) throw new FitError("Couldn't measure the extent of the marked surface.")
  return coneOutput(report, fin, selection)
}

/** The cone fitted to `region`, as an element takes it. */
function coneOutput(
  report: NonNullable<ReturnType<typeof coneReport>>,
  fin: NonNullable<ReturnType<typeof fitConeClipped>>,
  region: Uint32Array,
): ConeFit & { region: Uint32Array } {
  return {
    kind: 'cone',
    ...report,
    sigma: fin.sigma,
    usedPoints: fin.used.length,
    regionSize: region.length,
    formError: fin.span,
    residualMin: fin.min,
    residualMax: fin.max,
    region,
  }
}
