// SPDX-License-Identifier: AGPL-3.0-only
// Where Cut takes the plane: across one of the scan's coordinate axes — after
// a datum alignment, the datum's, so "Z 0.5" is half a millimetre above the
// face the part was set on — or across an element with a direction, the way
// a section is taken (see section/frame). Until an offset is typed, the plane
// goes through the middle of the part, where the preview shows it cutting
// something.

import {
  cutAxisOf,
  isWorldAxis,
  sectionFrameAlong,
  worldCutAxis,
  worldPlaneName,
  type CutAxis,
  type SectionFrame,
  type SectionRef,
} from '../../../src/core/section/frame'
import type { FitData, Vec3 } from '../../../src/core/types'
import { dot, normalize, scale, sub } from '../../../src/core/vec'
import { round3 } from '../../../src/core/round'
import { lengthInputText, unitWord, type DisplayUnits } from '../../../src/core/units'

export interface CutPlane {
  /** The plane as the scene and the worker take a cut: its normal points to
   *  the side that goes. */
  frame: SectionFrame
  /** How far along the reference it lies, mm — the typed offset, or the
   *  one through the part's middle. For a coordinate plane, its coordinate. */
  offset: number
  /** How the list of edits names it: "XY plane, Z 1.5 mm" — in `units`, mm
   *  unless asked, which is how the list keeps it and a command answers. */
  label: string
}

export function cutPlaneOf(
  ref: SectionRef,
  offset: number,
  offsetAuto: boolean,
  keep: 'plus' | 'minus',
  elements: readonly { id: number; name: string; fit?: FitData | null }[],
  centre: Vec3,
  units: DisplayUnits = 'mm',
): CutPlane | null {
  let axis: CutAxis | null = null
  let name: string
  if (isWorldAxis(ref)) {
    // Through the origin, so the offset along it is the plane's coordinate.
    axis = worldCutAxis(ref)
    name = worldPlaneName(ref)
  } else {
    const el = elements.find((e) => e.id === ref)
    axis = el?.fit ? cutAxisOf(el.fit) : null
    name = el?.name ?? ''
  }
  const dir = axis && normalize(axis.dir)
  if (!axis || !dir) return null
  const off = offsetAuto ? round3(dot(sub(centre, axis.origin), dir)) : offset
  const frame = sectionFrameAlong(axis, off)
  if (!frame) return null
  // The figure as the offset's field shows it.
  const at = (mm: number) => `${lengthInputText(mm, units)} ${unitWord(units)}`
  const label = isWorldAxis(ref)
    ? `${name}, ${ref.toUpperCase()} ${at(off)}`
    : off === 0
      ? name
      : `${name} ${off > 0 ? '+' : '−'}${at(Math.abs(off))}`
  // Kept: the side the direction points to, for 'plus' — so the side that
  // goes is the other, and the normal turns round (V with it, to keep the
  // frame right-handed).
  const goes: SectionFrame =
    keep === 'plus'
      ? { origin: frame.origin, normal: scale(frame.normal, -1), basisU: frame.basisU, basisV: scale(frame.basisV, -1) }
      : frame
  return { frame: goes, offset: off, label }
}
