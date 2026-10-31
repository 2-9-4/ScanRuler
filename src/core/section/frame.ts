// SPDX-License-Identifier: AGPL-3.0-only
// Where a section cuts: the plane, and the two in-plane axes the 2D sheet is
// laid out along.
//
// A section is taken along an element that has a direction — a plane's
// normal, the axis of a cylinder, cone or line, a circle's normal — moved
// along that direction by an offset; or through an axis, at an angle about
// it, as a half section of a turned part. The frame is frozen the moment the
// section is made: the reference element is remembered for the editor and
// the record, but re-fitting or deleting it afterwards leaves the cut where
// it was. What does move the frame is the part itself — a datum alignment
// carries it along with the scan it was cut from.
//
// The in-plane X axis is chosen once and kept: a plane hands over its own
// patch axes, everything else gets a deterministic perpendicular. An edit
// re-projects the axis it already had, so a section that is nudged by a
// millimetre does not turn its sheet under the measurements taken on it. A
// plane through an axis has its X along the radius whatever it had before.
// U × V = normal, so laid flat the sheet is seen from the side the normal
// points to — for a plane fitted on a face, from outside the part.

import { orthoBasis } from '../fit/linalg'
import { rigidApply, rigidFromAxisAngle, rigidRotate, type Rigid } from '../deviation/rigid'
import type { ElementKind, FitData, Vec3 } from '../types'
import { addScaled, angleBetween, cross, dot, normalize } from '../vec'
import { fmtLen, type DisplayUnits } from '../units'

export interface SectionFrame {
  origin: Vec3
  normal: Vec3
  basisU: Vec3
  basisV: Vec3
}

/** The kinds a section can be taken along: the ones with a direction. A
 *  sphere and a point have none to cut across. */
export const SECTION_REF_KINDS: readonly ElementKind[] = ['plane', 'cylinder', 'cone', 'line', 'circle']

export function canCutAlong(kind: ElementKind): boolean {
  return SECTION_REF_KINDS.includes(kind)
}

/** One of the scan's own coordinate axes — after a datum alignment, the
 *  datum's. */
export type WorldAxis = 'x' | 'y' | 'z'

/** A plane through an axis rather than across it: the axis of an element, by
 *  id, or a coordinate axis through the origin, and the angle turned about
 *  it — see radialFrame. */
export interface RadialRef {
  axis: number | WorldAxis
  angleDeg: number
}

/** What a section is taken across: an element, by id, or a coordinate axis
 *  — the plane square to it, the way a CAD sketch is put on the XY plane. */
export type SectionRef = number | WorldAxis

/** What a section's plane is laid by: across a SectionRef, or through an
 *  axis at an angle about it. */
export type SectionPlaneRef = SectionRef | RadialRef

export const WORLD_AXES: readonly WorldAxis[] = ['x', 'y', 'z']

export function isWorldAxis(ref: unknown): ref is WorldAxis {
  return ref === 'x' || ref === 'y' || ref === 'z'
}

export function isRadialRef(ref: unknown): ref is RadialRef {
  return typeof ref === 'object' && ref !== null && 'axis' in ref && 'angleDeg' in ref
}

/** The element a reference names, if it names one: the one cut across, or
 *  the one whose axis a plane is laid through. */
export function sectionRefElement(ref: SectionPlaneRef | null): number | null {
  if (typeof ref === 'number') return ref
  return isRadialRef(ref) && typeof ref.axis === 'number' ? ref.axis : null
}

export function worldAxisDir(axis: WorldAxis): Vec3 {
  return axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1]
}

/** The coordinate plane across an axis, named as CAD names it: the XY plane
 *  is the one the Z axis stands on. */
export function worldPlaneName(axis: WorldAxis): string {
  return axis === 'x' ? 'YZ plane' : axis === 'y' ? 'XZ plane' : 'XY plane'
}

/**
 * The line a section slides along a coordinate axis, parallel to it through
 * `through` — the part's centre, so the plane's gizmo sits on the part
 * rather than at the world origin, which a scan may lie nowhere near. The
 * line starts where it crosses the coordinate plane through the origin, so
 * the offset along it is the plane's coordinate on that axis. The in-plane
 * X is the next axis round, and the sheet's Y the one after — a right-handed
 * frame with the sheet seen from the axis's positive end.
 */
export function worldCutAxis(axis: WorldAxis, through: Vec3 = [0, 0, 0]): CutAxis {
  const dir = worldAxisDir(axis)
  const basisU: Vec3 = axis === 'x' ? [0, 1, 0] : axis === 'y' ? [0, 0, 1] : [1, 0, 0]
  return { origin: addScaled(through, dir, -dot(through, dir)), dir, basisU }
}

/** What a reference reads as in the list and the report: the element's
 *  name, a coordinate plane's, or null for an element since deleted. */
export function sectionRefName(
  ref: SectionPlaneRef | null,
  elements: readonly { id: number; name: string }[],
): string | null {
  if (ref === null) return null
  if (isWorldAxis(ref)) return worldPlaneName(ref)
  if (isRadialRef(ref)) {
    const axis = isWorldAxis(ref.axis) ? `the ${ref.axis.toUpperCase()} axis` : elements.find((e) => e.id === ref.axis)?.name
    return axis ? `${axis}, radial at ${round3(ref.angleDeg)}°` : null
  }
  return elements.find((e) => e.id === ref)?.name ?? null
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** The line a section slides along: a point on it, the direction the offset
 *  counts positive in, and — from a plane — the in-plane X its patch is
 *  measured along. */
export interface CutAxis {
  origin: Vec3
  dir: Vec3
  basisU?: Vec3
}

/** The line a section slides along, off the element it is taken along. Null
 *  for the kinds with no direction. */
export function cutAxisOf(fit: FitData): CutAxis | null {
  switch (fit.kind) {
    case 'plane':
      return { origin: fit.center, dir: fit.normal, basisU: fit.basisU }
    case 'cylinder':
    case 'cone':
      return { origin: fit.center, dir: fit.axis }
    case 'line':
      return { origin: fit.center, dir: fit.dir }
    case 'circle':
      return { origin: fit.center, dir: fit.normal }
    default:
      return null
  }
}

/** The kinds a plane can be laid through the axis of. */
export const RADIAL_AXIS_KINDS: readonly ElementKind[] = ['cylinder', 'cone', 'line', 'circle']

/** An element's axis as a line: a cylinder's or cone's axis, a line itself,
 *  a circle's normal through its centre. Null for the kinds with none. */
export function axisLineOf(fit: FitData): { origin: Vec3; dir: Vec3 } | null {
  switch (fit.kind) {
    case 'cylinder':
    case 'cone':
      return { origin: fit.center, dir: fit.axis }
    case 'line':
      return { origin: fit.center, dir: fit.dir }
    case 'circle':
      return { origin: fit.center, dir: fit.normal }
    default:
      return null
  }
}

/**
 * The frame of a plane through an axis, turned `angleDeg` about it: U runs
 * out along the radius, V up the axis and the normal is U × V — a half
 * section with the radius to the right and the axis up, at every angle,
 * never seen from behind. Up the axis is towards the + end of the
 * coordinate axis it lies nearest, whichever way a fit happened to point
 * it, so a bore fitted pointing down still has V = +Z. Zero degrees is the
 * coordinate axis next round from that one (X about Z, Y about X, Z about
 * Y, as the coordinate planes take their X) laid square to the axis, and
 * the angle turns from it by the right hand about the axis — about Z, from
 * +X towards +Y. The origin is the one given, a point on the axis, so u is
 * the distance out from the axis.
 */
export function radialFrame(axis: { origin: Vec3; dir: Vec3 }, angleDeg: number): SectionFrame | null {
  let up = normalize(axis.dir)
  if (!up || !Number.isFinite(angleDeg)) return null
  let k = 0
  for (let i = 1; i < 3; i++) if (Math.abs(up[i]) > Math.abs(up[k])) k = i
  if (up[k] < 0) up = [-up[0], -up[1], -up[2]]
  const zero = inPlaneX(up, sketchXAxis(up))
  const quarter = cross(up, zero)
  const a = (angleDeg * Math.PI) / 180
  const basisU = normalize(addScaled([zero[0] * Math.cos(a), zero[1] * Math.cos(a), zero[2] * Math.cos(a)], quarter, Math.sin(a)))!
  return { origin: axis.origin, normal: cross(basisU, up), basisU, basisV: up }
}

/** The line a plane through an axis slides along: its normal, from the
 *  point on the axis — so offset 0 is the plane through the axis. */
export function radialCutAxis(axis: { origin: Vec3; dir: Vec3 }, angleDeg: number): CutAxis | null {
  const f = radialFrame(axis, angleDeg)
  return f && { origin: f.origin, dir: f.normal, basisU: f.basisU }
}

/** The line a reference gives as the elements stand now — a coordinate
 *  axis's through `centre`, a radial plane's about its axis (a coordinate
 *  axis's through the origin) — or null where the element is gone or has
 *  no direction. */
export function sectionRefAxis(
  ref: SectionPlaneRef,
  elements: readonly { id: number; kind: ElementKind; fit?: FitData | null }[],
  centre: Vec3,
): CutAxis | null {
  if (isWorldAxis(ref)) return worldCutAxis(ref, centre)
  if (isRadialRef(ref)) {
    const { axis } = ref
    if (isWorldAxis(axis)) return radialCutAxis({ origin: [0, 0, 0], dir: worldAxisDir(axis) }, ref.angleDeg)
    const fit = elements.find((e) => e.id === axis)?.fit
    const line = fit ? axisLineOf(fit) : null
    return line && radialCutAxis(line, ref.angleDeg)
  }
  const el = elements.find((e) => e.id === ref)
  return el?.fit && canCutAlong(el.kind) ? cutAxisOf(el.fit) : null
}

/**
 * The frame a section takes along `fit`, `offset` millimetres along its
 * direction. `seedU` is an in-plane X to keep if one is already in use — it
 * is projected onto the new plane, and only a seed that has gone
 * perpendicular to it falls back to a fresh choice.
 */
export function sectionFrameFrom(fit: FitData, offset: number, seedU?: Vec3): SectionFrame | null {
  const axis = cutAxisOf(fit)
  return axis && sectionFrameAlong(axis, offset, seedU)
}

/** The frame `offset` millimetres along an axis already in hand. */
export function sectionFrameAlong(axis: CutAxis, offset: number, seedU?: Vec3): SectionFrame | null {
  const normal = normalize(axis.dir)
  if (!normal) return null
  const origin = addScaled(axis.origin, normal, Number.isFinite(offset) ? offset : 0)
  const basisU = inPlaneX(normal, seedU ?? axis.basisU)
  return { origin, normal, basisU, basisV: cross(normal, basisU) }
}

/** The offset along an axis that puts the plane through `p` — a point
 *  clicked on the scan. Null for an axis with no direction. */
export function offsetThrough(axis: CutAxis, p: Vec3): number | null {
  const normal = normalize(axis.dir)
  if (!normal) return null
  return dot([p[0] - axis.origin[0], p[1] - axis.origin[1], p[2] - axis.origin[2]], normal)
}

/**
 * The frame a sketch takes on a plane — the rule FreeCAD, Fusion, Onshape
 * and SolidWorks converged on: the sheet's zero is the part's origin
 * projected square onto the plane, and the sheet's X is a coordinate axis
 * flattened into it. So a sketch on the XY plane has the part's own X and
 * Y, and one on a face at z = 20 has them too, its zero straight above the
 * origin — not the face's centre, which moves with every edit of the face.
 * Which axis: the one next round from the axis the normal is nearest, as
 * the coordinate planes have it (Z's plane gets X, X's gets Y, Y's gets Z),
 * so a right-handed sheet seen from the side the normal points to. `seedU`
 * keeps an X already in use, flattened into the plane.
 */
export function sketchFrameOn(plane: { origin: Vec3; normal: Vec3 }, seedU?: Vec3): SectionFrame | null {
  const normal = normalize(plane.normal)
  if (!normal) return null
  // The foot of the world origin on the plane: along the normal by the
  // plane's distance from it.
  const origin = addScaled([0, 0, 0], normal, dot(plane.origin, normal))
  const basisU = inPlaneX(normal, seedU ?? sketchXAxis(normal))
  return { origin, normal, basisU, basisV: cross(normal, basisU) }
}

/** The coordinate axis a sketch's X is taken from: the one next round from
 *  the axis the normal is nearest. Never the nearest itself, which may lie
 *  along the normal and have nothing in the plane. */
export function sketchXAxis(normal: Vec3): Vec3 {
  const a = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])]
  const nearest = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2
  const next = (nearest + 1) % 3
  return next === 0 ? [1, 0, 0] : next === 1 ? [0, 1, 0] : [0, 0, 1]
}

/** How far off the normal a coordinate axis has to lie to be turned up a
 *  sheet: its share in the plane, about 6°. */
const UP_MIN_SHARE = 0.1

/**
 * A frame turned in its own plane so that a coordinate axis runs up it —
 * as near as the plane lets it — for a picture of a side view with Z up:
 * V is the axis flattened into the plane, U the direction square to it
 * that runs towards the + end of the coordinate axis it lies nearest, and
 * the normal U × V, the frame's own or its reverse. The plane and the
 * origin stay; the sheet is seen from whichever side puts that + to the
 * right, as CAD's front view of the XZ plane has X right and Z up. Null
 * where the axis lies along the normal and has no way up the sheet. The
 * frames sections and sketches take are not turned: this is a picture's.
 */
export function frameTurnedUp(frame: SectionFrame, up: WorldAxis): SectionFrame | null {
  const normal = normalize(frame.normal)
  if (!normal) return null
  const want = worldAxisDir(up)
  const flat = addScaled(want, normal, -dot(want, normal))
  if (Math.hypot(flat[0], flat[1], flat[2]) < UP_MIN_SHARE) return null
  const basisV = normalize(flat)!
  let basisU = cross(basisV, normal)
  let k = 0
  for (let i = 1; i < 3; i++) if (Math.abs(basisU[i]) > Math.abs(basisU[k])) k = i
  if (basisU[k] < 0) basisU = [-basisU[0], -basisU[1], -basisU[2]]
  return { origin: frame.origin, normal: cross(basisU, basisV), basisU, basisV }
}

/** The axis a frozen frame slides along, given the offset it was taken at —
 *  what an edit works from when the element it was cut along is gone, or has
 *  since been re-fitted somewhere else: the section stays exactly where it
 *  is until the offset or the reference is actually changed. */
export function axisOfFrame(frame: SectionFrame, offset: number): CutAxis {
  return {
    origin: addScaled(frame.origin, frame.normal, -(Number.isFinite(offset) ? offset : 0)),
    dir: frame.normal,
    basisU: frame.basisU,
  }
}

/**
 * The line turned by hand: the gizmo's ring rotates the plane `degrees`
 * about `about` — a unit direction lying in the plane — through the plane's
 * own origin, the point the gizmo sits on. The plane pivots where the hand
 * is and keeps its offset, so the line it slides along is moved to keep
 * both: it leaves the element it was taken along, which is why a turned
 * section carries its reference's direction separately — see tiltOf.
 */
export function turnAxis(axis: CutAxis, offset: number, about: Vec3, degrees: number): CutAxis {
  const dir = normalize(axis.dir)
  if (!dir || !Number.isFinite(degrees)) return axis
  const off = Number.isFinite(offset) ? offset : 0
  const pivot = addScaled(axis.origin, dir, off)
  const m = rigidFromAxisAngle(about, (degrees * Math.PI) / 180)
  const out = new Float64Array(3)
  rigidRotate(m, dir[0], dir[1], dir[2], out)
  const turned: Vec3 = [out[0], out[1], out[2]]
  let basisU = axis.basisU
  if (basisU) {
    rigidRotate(m, basisU[0], basisU[1], basisU[2], out)
    basisU = [out[0], out[1], out[2]]
  }
  return { origin: addScaled(pivot, turned, -off), dir: turned, basisU }
}

/** How far a plane has been turned off the direction it was taken across,
 *  in degrees — zero for one still square to its reference, and for one
 *  whose reference gave no direction to compare with. */
export function tiltOf(refDir: Vec3 | null | undefined, normal: Vec3): number {
  if (!refDir) return 0
  const a = normalize(refDir)
  const b = normalize(normal)
  if (!a || !b) return 0
  const deg = angleBetween(a, b)
  // The hair a rotation and its inverse leave behind is not a tilt.
  return deg < 0.005 ? 0 : deg
}

/** A point of the world on a sheet: its [u, v], and how far it lies off
 *  the plane along the normal — what a place given in world coordinates
 *  is on a picture or a map laid on that sheet. */
export function pointOnSheet(frame: SectionFrame, p: Vec3): { at: [number, number]; off: number } {
  const d: Vec3 = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]]
  return { at: [dot(d, frame.basisU), dot(d, frame.basisV)], off: dot(d, frame.normal) }
}

/** A box of the world laid on a sheet: the box round its eight corners in
 *  the sheet's [u, v] and the height along its normal — [u, v, height]
 *  min and max, which takes in all of the world box and, where the sheet
 *  is turned off the world's axes, some room round it. */
export function boxOnSheet(frame: SectionFrame, box: { min: Vec3; max: Vec3 }): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let c = 0; c < 8; c++) {
    const corner: Vec3 = [c & 1 ? box.max[0] : box.min[0], c & 2 ? box.max[1] : box.min[1], c & 4 ? box.max[2] : box.min[2]]
    const { at, off } = pointOnSheet(frame, corner)
    const q = [at[0], at[1], off]
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], q[k])
      max[k] = Math.max(max[k], q[k])
    }
  }
  return { min, max }
}

/** The axis carried through a rigid motion of the scan. */
export function transformAxis(axis: CutAxis, m: Rigid): CutAxis {
  const out = new Float64Array(3)
  rigidApply(m, axis.origin[0], axis.origin[1], axis.origin[2], out)
  const origin: Vec3 = [out[0], out[1], out[2]]
  rigidRotate(m, axis.dir[0], axis.dir[1], axis.dir[2], out)
  const dir: Vec3 = [out[0], out[1], out[2]]
  if (!axis.basisU) return { origin, dir }
  rigidRotate(m, axis.basisU[0], axis.basisU[1], axis.basisU[2], out)
  return { origin, dir, basisU: [out[0], out[1], out[2]] }
}

/** A unit vector in the plane, as close to `want` as the plane allows. */
function inPlaneX(normal: Vec3, want: Vec3 | undefined): Vec3 {
  if (want) {
    const flat = normalize(addScaled(want, normal, -dot(want, normal)))
    if (flat) return flat
  }
  return orthoBasis(normal)[0]
}

/** The frame carried through a rigid motion of the scan. */
export function transformFrame(frame: SectionFrame, m: Rigid): SectionFrame {
  const out = new Float64Array(3)
  const move = (p: Vec3): Vec3 => {
    rigidApply(m, p[0], p[1], p[2], out)
    return [out[0], out[1], out[2]]
  }
  const turn = (d: Vec3): Vec3 => {
    rigidRotate(m, d[0], d[1], d[2], out)
    return [out[0], out[1], out[2]]
  }
  return {
    origin: move(frame.origin),
    normal: turn(frame.normal),
    basisU: turn(frame.basisU),
    basisV: turn(frame.basisV),
  }
}

/**
 * A section as the plane a dimension measures from — a cut is a plane, and
 * one put square through a rim is often the only plane there is to take a
 * distance or an angle off. The patch is what the cut covers, so a distance
 * that lands off the cut is warned about as one off a fitted plane's patch
 * is. A section has no surface of its own: no residuals, no form error, so
 * no range either. The normal is the frame's — which side it points to is
 * the side the sheet is seen from, nothing about the material.
 */
export function sectionPlane(
  frame: SectionFrame,
  cut?: { points: Float32Array } | null,
): Extract<FitData, { kind: 'plane' }> {
  const { origin, normal, basisU, basisV } = frame
  let center = origin
  let extentU = 0
  let extentV = 0
  const pts = cut?.points
  if (pts && pts.length >= 3) {
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (let i = 0; i + 2 < pts.length; i += 3) {
      const d: Vec3 = [pts[i] - origin[0], pts[i + 1] - origin[1], pts[i + 2] - origin[2]]
      const u = dot(d, basisU)
      const v = dot(d, basisV)
      if (u < u0) u0 = u
      if (u > u1) u1 = u
      if (v < v0) v0 = v
      if (v > v1) v1 = v
    }
    center = addScaled(addScaled(origin, basisU, (u0 + u1) / 2), basisV, (v0 + v1) / 2)
    extentU = (u1 - u0) / 2
    extentV = (v1 - v0) / 2
  }
  return { kind: 'plane', center, normal, basisU, basisV, extentU, extentV, sigma: 0, usedPoints: 0, regionSize: 0 }
}

/** A string that changes whenever the frame does, to a tenth of a micron —
 *  what tells a cut taken in one frame apart from the frame now in force. */
export function frameKey(frame: SectionFrame): string {
  const v = (a: Vec3) => a.map((x) => x.toFixed(4)).join(',')
  return `${v(frame.origin)}|${v(frame.normal)}|${v(frame.basisU)}`
}

/** "along Plane 1, +2.000 mm" — for the list row, the report and the sheet.
 *  A plane turned off its reference by the gizmo says by how much: "along
 *  Plane 1, +2.000 mm, tilted 4.3°". A shadow says it is one, and no offset
 *  — it is drawn in the middle of the part: "shadow onto Plane 1". The
 *  offset is written in `units`. */
export function describeCut(refName: string | null, offset: number, tilt = 0, kind: 'cut' | 'shadow' = 'cut', units: DisplayUnits = 'mm'): string {
  const mm = `${offset >= 0 ? '+' : '−'}${fmtLen(Math.abs(offset), units, 3)}`
  const turned = tilt > 0 ? `, tilted ${tilt.toFixed(1)}°` : ''
  if (kind === 'shadow') return refName ? `shadow onto ${refName}${turned}` : `shadow onto a deleted element${turned}`
  return refName ? `along ${refName}, ${mm}${turned}` : `${mm} from a deleted element${turned}`
}
