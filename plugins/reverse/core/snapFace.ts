// SPDX-License-Identifier: AGPL-3.0-only
// A face of a body snapped onto the scan: the part is modelled roughly, a
// face is picked, the scan is clicked where that face should lie, and the
// element fitted there — a plane for a flat face, a cylinder for a round
// one — says how far the face has to move. This module is that reading:
// the offset a Move face feature is made with, and how well the scan's
// face agrees with the body's, for the box to say so. Where a flat face of
// the scan leans to the body's by more than the fit's noise can explain,
// the reading also holds the draft that would lay it on — a moulded wall
// modelled square. Plain geometry, no kernel — the worker fits, the kernel
// moves.

import type { FitData, PlaneFit, Vec3 } from '../../../src/core/types'
import { add, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { FaceFingerprint } from './topo'

/** The draft that lays a moved flat face on the scan's leaning plane: a
 *  Draft feature's neutral plane and angle, made after the move. */
export interface SnapDraft {
  /** Degrees the face leans, as a Draft feature reads it: positive leans
   *  the face in as it goes along `pull`. */
  angleDeg: number
  /** A point of the neutral plane: the moved face's middle, where the
   *  scan's plane crosses it. The line the face hinges on runs through it,
   *  along the face and across the tilt. */
  origin: Vec3
  /** The neutral plane's normal: in the face, the way the scan's plane
   *  leans into the body. */
  pull: Vec3
  /** The tilt the fit's own scatter could account for, degrees — what the
   *  offered angle had to clear. */
  noiseDeg: number
}

/** What the scan says about a face. */
export interface SnapReading {
  /** Millimetres the face moves: along its outward normal for a plane, the
   *  change of radius for a cylinder. */
  offset: number
  /** The angle between the body's face and the scan's — between the normals
   *  of two planes, the axes of two cylinders — degrees. A move cannot take
   *  it out; the box says how big it is. */
  tiltDeg: number
  /** How far the scan's cylinder axis stands off the body's, at the face's
   *  middle, millimetres; absent for a plane. The move keeps the axis. */
  axisShift?: number
  /** The scatter of the scan's points about the fitted element. */
  sigma: number
  /** For a flat face whose tilt is real — above the noise floor — the draft
   *  that would take it out after the move; absent where the move alone
   *  lays the face on the scan, or for a round face. */
  draft?: SnapDraft
}

/** The element the worker should fit for a face, or null for a face that
 *  cannot be moved onto the scan. */
export function snapFitKind(face: FaceFingerprint): 'plane' | 'cylinder' | null {
  return face.kind === 'plane' || face.kind === 'cylinder' ? face.kind : null
}

/** Past this the scan's face is not the body's face turned a little but
 *  another face altogether — the click landed on a neighbour. */
const SNAP_MAX_TILT_DEG = 20

/** Below this a tilt is not a draft, whatever the fit says: a tenth of a
 *  degree over a 50 mm wall is 0.09 mm, the scan's own scatter. */
const SNAP_DRAFT_MIN_DEG = 0.2

/** How many times the fit's own angular noise a tilt must clear to be
 *  read as a draft rather than as the patch's scatter. */
const DRAFT_NOISE_FACTOR = 4

/**
 * The tilt of a fitted plane that its scatter alone could produce,
 * degrees: the slope of a line fitted through `n` points spread over a
 * length `span` with scatter σ is uncertain by σ·√(12/n)/span.
 */
function planeNoiseDeg(fit: PlaneFit, along: Vec3): number {
  const half = Math.abs(dot(along, fit.basisU)) * fit.extentU + Math.abs(dot(along, fit.basisV)) * fit.extentV
  const span = 2 * half
  if (!(span > 1e-6) || !(fit.sigma > 0)) return 0
  const n = Math.max(3, fit.usedPoints)
  return (Math.atan((fit.sigma * Math.sqrt(12 / n)) / span) * 180) / Math.PI
}

/**
 * The draft that lays a flat face, once moved onto the scan's plane at its
 * middle, along that plane: `n` the face's outward normal, `m` the fitted
 * normal turned to n's side, `tiltDeg` between them. A face leaning in as
 * it goes along the pull is a positive draft, so the pull is the fitted
 * normal's part in the face — the way the scan's plane dips into the body.
 * Null where the tilt is within what the fit's noise explains.
 */
function planeDraft(face: FaceFingerprint, fit: PlaneFit, n: Vec3, m: Vec3, offset: number, tiltDeg: number): SnapDraft | null {
  const pull = normalize(sub(m, scale(n, dot(n, m))))
  if (!pull) return null
  const noiseDeg = planeNoiseDeg(fit, pull)
  if (tiltDeg < Math.max(SNAP_DRAFT_MIN_DEG, DRAFT_NOISE_FACTOR * noiseDeg)) return null
  return { angleDeg: Math.round(tiltDeg * 100) / 100, origin: add(face.centroid, scale(n, offset)), pull, noiseDeg }
}

/**
 * The move that lays a face on the element fitted to the scan, or the
 * reason there is none. A plane is met along the face's own normal through
 * its middle, so a slightly tilted scan face puts the body's face through
 * its centre rather than at its nearest corner.
 */
export function snapReading(face: FaceFingerprint, fit: FitData): SnapReading | string {
  if (face.kind === 'plane') {
    if (fit.kind !== 'plane') return 'A flat face snaps onto a plane of the scan.'
    const n = normalize(face.dir)
    const m = normalize(fit.normal)
    if (!n || !m) return 'The face has no direction.'
    const along = dot(n, m)
    const tiltDeg = (Math.acos(Math.min(1, Math.abs(along))) * 180) / Math.PI
    if (tiltDeg > SNAP_MAX_TILT_DEG) return `The scan's face there is turned ${tiltDeg.toFixed(0)}° to this one — click the face of the scan that matches it.`
    const offset = dot(sub(fit.center, face.centroid), m) / along
    const draft = planeDraft(face, fit, n, along < 0 ? scale(m, -1) : m, offset, tiltDeg)
    return { offset, tiltDeg, sigma: fit.sigma, ...(draft ? { draft } : {}) }
  }
  if (face.kind === 'cylinder') {
    if (fit.kind !== 'cylinder') return 'A round face snaps onto a cylinder of the scan.'
    if (face.radius === undefined || !face.center) return 'The round face has no axis to keep.'
    const a = normalize(face.dir)
    const b = normalize(fit.axis)
    if (!a || !b) return 'The face has no axis.'
    const tiltDeg = (Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI
    if (tiltDeg > SNAP_MAX_TILT_DEG) return `The scan's cylinder there is turned ${tiltDeg.toFixed(0)}° to this one — click the round face of the scan that matches it.`
    const between: Vec3 = sub(fit.center, face.center)
    const axisShift = len(sub(between, scale(a, dot(between, a))))
    return { offset: fit.radius - face.radius, tiltDeg, axisShift, sigma: fit.sigma }
  }
  return 'Only a flat or a cylindrical face can be snapped onto the scan.'
}
