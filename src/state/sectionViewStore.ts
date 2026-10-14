// SPDX-License-Identifier: AGPL-3.0-only
// The section view: the parts cut open at a plane, to look inside them. A
// way of looking, like the see-through and mesh switches beside it in the
// view bar — held for the session, never saved, no step of the history.
// The plane is laid across a coordinate plane or an element with a
// direction, as a section's is, slid along it, tilted by the gizmo's rings
// and flipped to take away the other half. Like a section, it is frozen
// where it was laid: re-fitting the element leaves it in place, choosing
// the element again moves it there.

import { create } from 'zustand'
import { rigidApply, rigidRotate, type Rigid } from '../core/deviation/rigid'
import {
  canCutAlong,
  cutAxisOf,
  isWorldAxis,
  sectionFrameAlong,
  transformAxis,
  WORLD_AXES,
  worldAxisDir,
  worldCutAxis,
  type CutAxis,
  type SectionFrame,
  type SectionRef,
} from '../core/section/frame'
import type { Vec3 } from '../core/types'
import { dot } from '../core/vec'
import { useStore } from './store'

interface SectionViewState {
  on: boolean
  /** What the plane is laid across: a coordinate plane, or an element. */
  ref: SectionRef
  /** The line the plane slides along: the reference's, or where the rings
   *  have turned it. Its direction is the way the gizmo's arrow points. */
  axis: CutAxis | null
  /** The reference's own direction — what a tilt is read against. */
  refDir: Vec3 | null
  /** How far along the line the plane lies, mm: for a coordinate plane
   *  square to its axis, the plane's coordinate. */
  offset: number
  /** Whether the half taken away is the one behind the arrow rather than the
   *  one it points into. */
  flipped: boolean
  /** The middle of what is on the stage, in the scan's frame, when it was
   *  opened — what a coordinate plane is laid through. */
  centre: Vec3

  /** Cut the parts open across the coordinate plane most square to `view`
   *  — the way the camera looks — through `centre`, the middle of what is on
   *  the stage, taking away the half toward the camera, so the cut faces
   *  it. */
  open: (view: Vec3, centre: Vec3) => void
  close: () => void
  /** Lay the plane across a coordinate plane or an element — through the
   *  middle of the stage, or the element's own centre — and, given `view`,
   *  take away the half toward the camera. Chosen again, a reference keeps
   *  its offset: that is how a tilted plane is squared up. */
  setRef: (ref: SectionRef, view?: Vec3) => void
  setOffset: (mm: number) => void
  /** The line turned by the rings — see core/section/frame turnAxis. */
  setAxis: (axis: CutAxis) => void
  flip: () => void
  /** The scan moved by a datum alignment: the plane goes with it. */
  move: (m: Rigid) => void
}

/** The line a reference gives — a coordinate axis's through `centre` — as
 *  the store has it now; null for an element with no direction to cut
 *  across. */
function refAxis(ref: SectionRef, centre: Vec3): CutAxis | null {
  if (isWorldAxis(ref)) return worldCutAxis(ref, centre)
  const el = useStore.getState().elements.find((e) => e.id === ref)
  return el?.fit && canCutAlong(el.kind) ? cutAxisOf(el.fit) : null
}

/** Whether the half the arrow points into is away from the camera — so the
 *  half to take away, the one toward it, is the other. */
const facesAway = (dir: Vec3, view: Vec3) => dot(dir, view) > 0

export const useSectionView = create<SectionViewState>()((set, get) => ({
  on: false,
  ref: 'z',
  axis: null,
  refDir: null,
  offset: 0,
  flipped: false,
  centre: [0, 0, 0],

  open: (view, centre) => {
    const a = view.map(Math.abs)
    const ref = WORLD_AXES[a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2]
    const axis = refAxis(ref, centre)!
    set({ on: true, ref, axis, refDir: axis.dir, offset: dot(centre, axis.dir), flipped: facesAway(axis.dir, view), centre })
  },

  close: () => set({ on: false }),

  setRef: (ref, view) => {
    const s = get()
    const axis = refAxis(ref, s.centre)
    if (!axis) return
    // The same reference again squares the plane up where it is; another
    // puts it through the middle of the stage, or the element's own centre.
    const offset = s.ref === ref && s.axis ? s.offset : isWorldAxis(ref) ? dot(s.centre, worldAxisDir(ref)) : 0
    set({ ref, axis, refDir: axis.dir, offset, flipped: view ? facesAway(axis.dir, view) : s.flipped })
  },

  setOffset: (mm) => {
    if (Number.isFinite(mm)) set({ offset: mm })
  },

  setAxis: (axis) => set({ axis }),

  flip: () => set((s) => ({ flipped: !s.flipped })),

  move: (m) =>
    set((s) => {
      if (!s.axis) return {}
      const out = new Float64Array(3)
      const turn = (v: Vec3): Vec3 => {
        rigidRotate(m, v[0], v[1], v[2], out)
        return [out[0], out[1], out[2]]
      }
      rigidApply(m, s.centre[0], s.centre[1], s.centre[2], out)
      const centre: Vec3 = [out[0], out[1], out[2]]
      return { axis: transformAxis(s.axis, m), refDir: s.refDir ? turn(s.refDir) : null, centre }
    }),
}))

/** Where the section view cuts, in the scan's frame: `cut` takes away the
 *  half its normal points to, as the viewport has it, and `gizmo` is the
 *  plane with its normal along the arrow. Null while it is off. */
export function sectionViewFrames(s: Pick<SectionViewState, 'on' | 'axis' | 'offset' | 'flipped'>): { cut: SectionFrame; gizmo: SectionFrame } | null {
  if (!s.on || !s.axis) return null
  const gizmo = sectionFrameAlong(s.axis, s.offset)
  if (!gizmo) return null
  const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]]
  // Turned over about its own X, so the sheet stays right-handed.
  const cut = s.flipped ? { ...gizmo, normal: neg(gizmo.normal), basisV: neg(gizmo.basisV) } : gizmo
  return { cut, gizmo }
}
