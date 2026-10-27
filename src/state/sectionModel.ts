// SPDX-License-Identifier: AGPL-3.0-only
// Sections — the scan cut by a plane, along an element or a coordinate plane —
// as the store keeps them, and the draft one is set up in.

import { type CutAxis, frameKey, type SectionFrame, sectionFrameAlong, sectionPlane, type SectionPlaneRef } from '../core/section/frame'
import { SHADOW_SMOOTH_DEG, SHADOW_TOLERANCE } from '../core/section/shadow'
import type { SectionCut } from '../core/section/slice'
import type { ElementKind, FitData, Vec3 } from '../core/types'
import { elementColor } from './elementModel'

/** What a section is of the scan: a cut, where the plane passes through it,
 *  or a shadow, the whole part projected along the plane's normal onto it —
 *  its widest outline, every indentation filled. */
export type SectionKind = 'cut' | 'shadow'

/** What a section is taken as, beside its plane — the kind, and for a
 *  shadow the play and tolerance its contour is read with and whether it is
 *  extruded. Absent fields are a cut's, so every saved section reads as one. */
export interface SectionSpec {
  kind?: SectionKind
  /** A shadow's contour lies this far outside the part, mm: positive is a
   *  clearance, negative a press fit. SHADOW_PLAY when absent. */
  play?: number
  /** What a shadow's contour is read to as lines and arcs, mm; its raster
   *  cell is half of it. SHADOW_TOLERANCE when absent. */
  tolerance?: number
  /** A shadow's corners turning by less than this are rounded, degrees; 0
   *  keeps every corner sharp. SHADOW_SMOOTH_DEG when absent. */
  smoothDeg?: number
  /** A shadow stood up as a block through the part's thickness, drawn in 3D
   *  and written to STEP as a solid. On when absent. */
  extrude?: boolean
}

export const isShadow = (s: SectionSpec | null | undefined): boolean => s?.kind === 'shadow'

/** A new shadow's play, mm: a millimetre of clearance all round — what a
 *  bin or a cutout for the part wants to start from. */
export const SHADOW_PLAY = 1

/** A shadow's play, tolerance, smoothing angle and whether it is extruded,
 *  the defaults filled in: a millimetre of play, read to a tenth, corners
 *  under 30° rounded, stood up as a block. */
export function shadowParams(s: SectionSpec): { play: number; tolerance: number; smoothDeg: number; extrude: boolean } {
  const play = s.play !== undefined && Number.isFinite(s.play) ? s.play : SHADOW_PLAY
  const tolerance = s.tolerance !== undefined && s.tolerance > 0 ? s.tolerance : SHADOW_TOLERANCE
  const smoothDeg = s.smoothDeg !== undefined && s.smoothDeg >= 0 ? Math.min(s.smoothDeg, 180) : SHADOW_SMOOTH_DEG
  return { play, tolerance, smoothDeg, extrude: s.extrude ?? true }
}

/** Whether a section stands as a block: a shadow, extruded. */
export const isExtruded = (s: SectionSpec): boolean => isShadow(s) && shadowParams(s).extrude

/** The key a section's cut has to match: the frame's, and for a shadow what
 *  it was read with too, so changing either takes it again. A cut's is the
 *  frame's alone, as it always was. */
export function sectionKeyOf(frame: SectionFrame, spec: SectionSpec): string {
  if (!isShadow(spec)) return frameKey(frame)
  const { play, tolerance, smoothDeg } = shadowParams(spec)
  return `${frameKey(frame)}|shadow|${play}|${tolerance}|${smoothDeg}`
}

/** The spec's own fields, a cut's left out — what a section carries, so a
 *  cut is saved as it always was. */
export function specFields(s: SectionSpec): SectionSpec {
  if (!isShadow(s)) return {}
  return {
    kind: 'shadow',
    ...(s.play !== undefined ? { play: s.play } : {}),
    ...(s.tolerance !== undefined ? { tolerance: s.tolerance } : {}),
    ...(s.smoothDeg !== undefined ? { smoothDeg: s.smoothDeg } : {}),
    ...(s.extrude !== undefined ? { extrude: s.extrude } : {}),
  }
}

/**
 * A section: the scan cut with a plane, to be measured in the 2D workspace.
 *
 * The plane is frozen when the section is made — see core/section/frame —
 * so a section is a record of where the scan was cut, not a construction on
 * the element it was cut along. It keeps that element and the offset for
 * the editor and the report, and the polylines the cut produced; a datum
 * alignment carries frame and polylines along with the part.
 */
export interface Section extends SectionSpec {
  id: number
  name: string
  color: string
  visible: boolean
  frame: SectionFrame
  /** What it was cut across — an element, if that still exists, or a
   *  coordinate plane — or the axis it was laid through and the angle
   *  about it; and how far along its direction. */
  ref: SectionPlaneRef | null
  offset: number
  /** The direction the reference gave when the section was made, so the
   *  record can say how far the plane was turned off it by hand — see
   *  turnAxis and tiltOf in core/section/frame. Moves with the part. */
  refDir?: Vec3
  /** The polylines, once the worker has cut them; the frame they were cut
   *  in, as sectionKeyOf — a cut that no longer matches its frame is
   *  re-taken. */
  cut?: SectionCut
  cutKey?: string
  message?: string
}

/** A section in the making, or one re-opened: the line it slides along
 *  (off the reference, or off its own frozen plane), the offset, and the
 *  cut the worker has taken for the plane those give. */
export interface SectionDraft extends SectionSpec {
  ref: SectionPlaneRef | null
  offset: number
  /** The line the plane slides along: the reference's, or where the gizmo's
   *  rings have turned it to. */
  axis: CutAxis | null
  /** The reference's own direction — what the tilt is read against. */
  refDir?: Vec3
  /** The in-plane X to keep — an edited section's own, so nudging it does
   *  not turn the sheet under the measurements taken on it. */
  seedU?: Vec3
  /** Derived from axis and offset; null until there is an axis. */
  frame: SectionFrame | null
  status: 'empty' | 'slicing' | 'ready' | 'failed'
  cut?: SectionCut
  cutKey?: string
  message?: string
  editId?: number
  name?: string
}

/** Something a dimension can take as a reference: a measured element, or a
 *  section standing in as the plane it was cut on — see sectionPlane. The
 *  two share one id counter, so an id names one or the other. */
export interface MeasureRef {
  id: number
  name: string
  kind: ElementKind
  color: string
  fit?: FitData
  /** A section rather than an element. */
  section?: boolean
}

/** The sections as planes a dimension can be taken from. A section whose
 *  cut is still being taken has its frame all the same. */
export function sectionMeasureRefs(sections: readonly Section[]): MeasureRef[] {
  return sections.map((sec) => ({
    id: sec.id,
    name: sec.name,
    kind: 'plane' as const,
    color: sec.color,
    fit: sectionPlane(sec.frame, sec.cut),
    section: true,
  }))
}

/** Everything a dimension can reference, elements first. Tolerances keep to
 *  the elements: a section has no surface for a form to be read off. */
export function dimensionRefsOf(
  elements: readonly MeasureRef[],
  sections: readonly Section[],
): MeasureRef[] {
  return sections.length === 0 ? [...elements] : [...elements, ...sectionMeasureRefs(sections)]
}

/** The draft's frame and status, re-derived after any change: ready when the
 *  cut in hand was taken in the very frame the draft now names. */
export function settleSectionDraft(d: SectionDraft): SectionDraft {
  const frame = d.axis ? sectionFrameAlong(d.axis, d.offset, d.seedU) : null
  if (!frame) return { ...d, frame: null, status: 'empty', message: undefined }
  const ready = d.cut !== undefined && d.cutKey === sectionKeyOf(frame, d)
  return { ...d, frame, status: ready ? 'ready' : 'slicing', message: undefined }
}

/** Whether the section draft can be created as it stands: cut in the frame it
 *  names, and cutting something — a plane that misses the scan is nothing to
 *  measure. What the Create button and the Enter key both read. */
export function sectionDraftReady(d: SectionDraft | null): boolean {
  return d !== null && d.status === 'ready' && d.cut !== undefined && d.cut.offsets.length > 1
}

/** The colour the open section draft is drawn in: an edited section keeps
 *  its own, a new one takes the next in the palette — the same rule as an
 *  element draft, off the same counter, so nothing on screen shares a tint. */
export function sectionDraftColorOf(s: {
  sectionDraft: SectionDraft | null
  sections: Section[]
  nextNumber: number
}): string {
  const id = s.sectionDraft?.editId
  const sec = id === undefined ? undefined : s.sections.find((x) => x.id === id)
  return sec?.color ?? elementColor(s.nextNumber)
}
