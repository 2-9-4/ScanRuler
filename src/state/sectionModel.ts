// SPDX-License-Identifier: AGPL-3.0-only
// Sections — the scan cut by a plane, along an element or a coordinate plane —
// as the store keeps them, and the draft one is set up in.

import { type CutAxis, frameKey, type SectionFrame, sectionFrameAlong, type SectionRef } from '../core/section/frame'
import type { SectionCut } from '../core/section/slice'
import type { Vec3 } from '../core/types'
import { elementColor } from './elementModel'

/**
 * A section: the scan cut with a plane, to be measured in the 2D workspace.
 *
 * The plane is frozen when the section is made — see core/section/frame —
 * so a section is a record of where the scan was cut, not a construction on
 * the element it was cut along. It keeps that element and the offset for
 * the editor and the report, and the polylines the cut produced; a datum
 * alignment carries frame and polylines along with the part.
 */
export interface Section {
  id: number
  name: string
  color: string
  visible: boolean
  frame: SectionFrame
  /** What it was cut across — an element, if that still exists, or a
   *  coordinate plane — and how far along its direction. */
  ref: SectionRef | null
  offset: number
  /** The direction the reference gave when the section was made, so the
   *  record can say how far the plane was turned off it by hand — see
   *  turnAxis and tiltOf in core/section/frame. Moves with the part. */
  refDir?: Vec3
  /** The polylines, once the worker has cut them; the frame they were cut
   *  in, as frameKey — a cut that no longer matches its frame is re-taken. */
  cut?: SectionCut
  cutKey?: string
  message?: string
}

/** A section in the making, or one re-opened: the line it slides along
 *  (off the reference, or off its own frozen plane), the offset, and the
 *  cut the worker has taken for the plane those give. */
export interface SectionDraft {
  ref: SectionRef | null
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

/** The draft's frame and status, re-derived after any change: ready when the
 *  cut in hand was taken in the very frame the draft now names. */
export function settleSectionDraft(d: SectionDraft): SectionDraft {
  const frame = d.axis ? sectionFrameAlong(d.axis, d.offset, d.seedU) : null
  if (!frame) return { ...d, frame: null, status: 'empty', message: undefined }
  const ready = d.cut !== undefined && d.cutKey === frameKey(frame)
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
