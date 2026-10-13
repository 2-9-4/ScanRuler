// SPDX-License-Identifier: AGPL-3.0-only
// The 3-2-1 alignment being set up, as data: its draft, the proposal a search
// hands it, what each slot holds, and the preview of where the part would go.
// The actions that change it are the store's.

import { AlignmentError, type AlignSlot, type AxisDir, computeDatumAlignment, describeRigid, fitFromAlignPicks, translationToOrigin } from '../core/alignment'
import type { Rigid } from '../core/deviation/rigid'
import type { FitData, Vec3 } from '../core/types'
import type { Element } from './elementModel'

/** The 3-2-1 alignment being set up: per slot either an existing element or
 *  points picked straight on the scan (3 span the levelling plane, 2 the
 *  rotation line, 1 the origin), plus the global axis each direction becomes.
 *  Nothing moves until it is applied. */
export interface AlignDraft {
  primary: number | null
  primaryPicks: Vec3[]
  /** Surface normal at each primary pick, so the levelling plane knows which
   *  side of it is outside the part — see fitFromAlignPicks. */
  primaryPickNormals: Vec3[]
  primaryAxis: AxisDir
  secondary: number | null
  secondaryPicks: Vec3[]
  secondaryAxis: AxisDir
  origin: number | null
  originPicks: Vec3[]
  /** The slot currently collecting clicks on the scan, or null. */
  pickSlot: AlignSlot | null
  /** What an automatic proposal read off the scan, in a sentence — there
   *  while the slots hold what it filled in, gone once one is filled by hand. */
  proposal?: string
}

/** A proposed alignment as the picks of the three slots — see
 *  core/autoAlign autoAlignPicks. */
export interface AlignmentProposal {
  primary: Vec3[]
  primaryNormals: Vec3[]
  secondary: Vec3[]
  origin: Vec3
}

export function alignSlotPicks(ad: AlignDraft, slot: AlignSlot): Vec3[] {
  return slot === 'primary' ? ad.primaryPicks : slot === 'secondary' ? ad.secondaryPicks : ad.originPicks
}

/** The point a datum alignment centres on the origin, or null for none: only
 *  the *first* alignment centres, because a part fresh from the scanner sits
 *  at an arbitrary offset nobody wants to keep — while a part that has already
 *  been aligned or moved is exactly where its user put it. */
export function alignCenterOf(s: {
  appliedAlignment: Rigid | null
  modelCenter: Vec3
}): Vec3 | null {
  return s.appliedAlignment === null ? s.modelCenter : null
}

/** What an alignment draft would do to the part right now: the transform and
 *  how far it moves, or why it cannot be computed yet. Read by the panel for
 *  its preview numbers and by the viewport for the live preview, so the two
 *  can never disagree. Null with no error means the levelling slot is still
 *  empty — there is nothing to say yet. */
export interface AlignPreview {
  rigid: Rigid
  rotationDeg: number
  translation: number
}

export function alignmentPreview(
  ad: AlignDraft,
  elements: Element[],
  modelSize: number,
  centerOf: Vec3 | null = null,
): { preview: AlignPreview | null; error: string | null } {
  const slotFit = (slot: AlignSlot, ref: number | null): FitData | null => {
    if (ref !== null) return elements.find((e) => e.id === ref)?.fit ?? null
    return fitFromAlignPicks(
      slot,
      alignSlotPicks(ad, slot),
      modelSize,
      slot === 'primary' ? ad.primaryPickNormals : undefined,
    )
  }
  try {
    const primary = slotFit('primary', ad.primary)
    if (!primary) {
      // A zero point on its own is a valid alignment: the part keeps its
      // orientation and that point becomes 0, 0, 0.
      const origin = slotFit('origin', ad.origin)
      if (!origin) return { preview: null, error: null }
      const rigid = translationToOrigin(origin.center)
      return { preview: { rigid, ...describeRigid(rigid) }, error: null }
    }
    const secondary = slotFit('secondary', ad.secondary)
    const origin = slotFit('origin', ad.origin)
    const rigid = computeDatumAlignment(
      { fit: primary, axis: ad.primaryAxis },
      secondary ? { fit: secondary, axis: ad.secondaryAxis } : null,
      origin,
      centerOf,
    )
    return { preview: { rigid, ...describeRigid(rigid) }, error: null }
  } catch (e) {
    return {
      preview: null,
      error: e instanceof AlignmentError ? e.message : 'Alignment failed.',
    }
  }
}

/** The slot with the given element reference and its picks discarded — the
 *  two ways of filling a slot are exclusive. */
export function withSlotRef(ad: AlignDraft, slot: AlignSlot, id: number | null): AlignDraft {
  const base = { ...ad, pickSlot: ad.pickSlot === slot ? null : ad.pickSlot, proposal: undefined }
  if (slot === 'primary')
    return { ...base, primary: id, primaryPicks: [], primaryPickNormals: [] }
  if (slot === 'secondary') return { ...base, secondary: id, secondaryPicks: [] }
  return { ...base, origin: id, originPicks: [] }
}

export function withSlotPicks(
  ad: AlignDraft,
  slot: AlignSlot,
  picks: Vec3[],
  normals: Vec3[] = [],
): AlignDraft {
  const base = { ...ad, proposal: undefined }
  if (slot === 'primary')
    return { ...base, primary: null, primaryPicks: picks, primaryPickNormals: normals }
  if (slot === 'secondary') return { ...base, secondary: null, secondaryPicks: picks }
  return { ...base, origin: null, originPicks: picks }
}
