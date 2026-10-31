// SPDX-License-Identifier: AGPL-3.0-only
// The ghost and its grips: the preview a box shows, a grip dragged on the
// part and the number field it opens, typed into.

import type { StoreApi } from 'zustand'
import type { Vec3 } from '../../../src/core/types'
import { extentEndsOnPart, type ExtrudeExtent, revolveMaxDeg } from '../core/features'
import { dragExtrudeExtent, dragLength, dragRevolveAngle, dragTaper, isMoveGripSide, MAX_TAPER_DEG, moveGripSlot, taperSpan } from '../core/preview'
import { moveSlotPath, revolveAngle } from './reDrafts'
import { gripSlotPaths, unlinkSlots } from './reFeatureHelpers'
import { faceExtrudeOp } from './reSketchDraft'
import type { ReState } from './reStore'

type StoreSet = StoreApi<ReState>['setState']
type StoreGet = StoreApi<ReState>['getState']

/** Where a feature grip's drag started from, for the duration of it. */
let gripStart: { extent: ExtrudeExtent } | { angleDeg: number } | { length: number } | { taperDeg: number; run: number } | null = null

export const gripSlice = (set: StoreSet, get: StoreGet): Pick<ReState, 'preview' | 'setPreview' | 'gripDrag' | 'gripField' | 'setGripField' | 'setGripValue'> => ({
  preview: { status: 'idle' },
  setPreview: (preview) => set({ preview }),
  gripDrag: (side, delta, phase) => {
    const s = get()
    const md = s.featureDraft
    if (md?.kind === 'moveBody' && isMoveGripSide(side)) {
      // An arrow carries the bodies along its axis, a ring turns them about
      // its own: whole hundredths of a millimetre, whole degrees — what is
      // dragged to is read off the box, and typed where it has to be exact.
      const { field, axis } = moveGripSlot(side)
      if (phase === 'start') {
        gripStart = { length: md[field][axis] }
        set({ gripField: side })
      } else if (phase === 'move' && gripStart && 'length' in gripStart) {
        const next = [...md[field]] as Vec3
        next[axis] = field === 'translate' ? Math.round((gripStart.length + delta) * 100) / 100 : Math.round(gripStart.length + delta)
        set({ featureDraft: unlinkSlots({ ...md, [field]: next }, [moveSlotPath(side)]) })
      } else if (phase === 'end') gripStart = null
      return
    }
    if (s.extrudeDraft && side === 'taper') {
      // The taper the arrow's pull out along the far edge leans to: the
      // grip stands on the edge, the run from where the taper starts away.
      if (phase === 'start') {
        const span = taperSpan(s.extrudeDraft.extent)
        gripStart = span ? { taperDeg: -s.extrudeDraft.draftDeg, run: Math.abs(span.end - span.start) } : null
        set({ gripField: side })
      } else if (phase === 'move' && gripStart && 'taperDeg' in gripStart) {
        const taper = dragTaper(gripStart.taperDeg, gripStart.run, delta)
        set({ extrudeDraft: unlinkSlots({ ...s.extrudeDraft, draftDeg: taper === 0 ? 0 : -taper }, ['taper']) })
      } else if (phase === 'end') gripStart = null
      return
    }
    if (s.extrudeDraft) {
      if (phase === 'start') {
        gripStart = { extent: s.extrudeDraft.extent }
        set({ gripField: side })
      } else if (phase === 'move' && gripStart && 'extent' in gripStart) {
        // Whole hundredths: a dragged number is read off the panel, and a
        // dozen decimals there read as noise.
        const next = dragExtrudeExtent(gripStart.extent, side, delta)
        const tidy = (v: number) => Math.round(v * 100) / 100
        const extent: ExtrudeExtent =
          next.kind === 'distance'
            ? { ...next, from: tidy(next.from), to: tidy(next.to) }
            : next.kind === 'symmetric'
              ? { ...next, total: tidy(next.total) }
              : extentEndsOnPart(next)
                ? { ...next, from: tidy(next.from) }
                : next
        set({ extrudeDraft: unlinkSlots(faceExtrudeOp({ ...s.extrudeDraft, extent }), gripSlotPaths(side, s.extrudeDraft)) })
      } else if (phase === 'end') gripStart = null
      return
    }
    if (s.revolveDraft && side === 'turn') {
      if (phase === 'start') {
        gripStart = { angleDeg: s.revolveDraft.angleDeg }
        set({ gripField: side })
      } else if (phase === 'move' && gripStart && 'angleDeg' in gripStart) {
        set({ revolveDraft: unlinkSlots({ ...s.revolveDraft, angleDeg: dragRevolveAngle(gripStart.angleDeg, delta, revolveMaxDeg(s.revolveDraft.pitch)) }, gripSlotPaths('turn', null)) })
      } else if (phase === 'end') gripStart = null
    }
    const d = s.featureDraft
    if (d && d.kind === 'moveFace' && side === 'move') {
      if (phase === 'start') {
        gripStart = { length: d.offset }
        set({ gripField: side })
      } else if (phase === 'move' && gripStart && 'length' in gripStart) {
        // Signed: the arrow pulls the face out and pushes it in.
        set({ featureDraft: unlinkSlots({ ...d, offset: Math.round((gripStart.length + delta) * 100) / 100, reading: null }, ['offset']) })
      } else if (phase === 'end') gripStart = null
      return
    }
    if (d && (side === 'radius' || side === 'thickness')) {
      const current = d.kind === 'fillet' ? d.radius : d.kind === 'chamfer' ? d.distance : d.kind === 'shell' ? d.thickness : null
      if (current === null) return
      if (phase === 'start') {
        gripStart = { length: current }
        set({ gripField: side })
      } else if (phase === 'move' && gripStart && 'length' in gripStart) {
        const v = Math.round(dragLength(gripStart.length, delta) * 100) / 100
        if (d.kind === 'fillet') set({ featureDraft: unlinkSlots({ ...d, radius: v, radiusTyped: true }, ['radius']) })
        else if (d.kind === 'chamfer') set({ featureDraft: unlinkSlots({ ...d, distance: v }, ['distance']) })
        else if (d.kind === 'shell') set({ featureDraft: unlinkSlots({ ...d, thickness: v, thicknessFrom: 'typed' as const }, ['thickness']) })
      } else if (phase === 'end') gripStart = null
    }
  },
  gripField: null,
  setGripField: (gripField) => set({ gripField }),
  setGripValue: (side, value) =>
    set((s) => {
      if (!Number.isFinite(value)) return {}
      // A number typed on the grip stands on its own: the expression
      // behind it, if any, is let go.
      if (s.extrudeDraft && side === 'taper') return { extrudeDraft: unlinkSlots({ ...s.extrudeDraft, draftDeg: value === 0 ? 0 : -Math.max(-MAX_TAPER_DEG, Math.min(MAX_TAPER_DEG, value)) }, ['taper']) }
      if (s.extrudeDraft && side !== 'turn') {
        const e = s.extrudeDraft.extent
        const extent: ExtrudeExtent | null =
          e.kind === 'distance'
            ? side === 'extrudeFrom'
              ? { ...e, from: value }
              : { ...e, to: value }
            : e.kind === 'symmetric'
              ? { ...e, total: Math.abs(value) }
              : extentEndsOnPart(e) && side === 'extrudeFrom'
                ? { ...e, from: value }
                : null
        return extent ? { extrudeDraft: unlinkSlots(faceExtrudeOp({ ...s.extrudeDraft, extent }), gripSlotPaths(side, s.extrudeDraft)) } : {}
      }
      if (s.revolveDraft && side === 'turn') return { revolveDraft: unlinkSlots({ ...s.revolveDraft, angleDeg: revolveAngle(value, s.revolveDraft.pitch) }, gripSlotPaths('turn', null)) }
      const d = s.featureDraft
      if (d && side === 'radius' && d.kind === 'fillet') return { featureDraft: unlinkSlots({ ...d, radius: Math.abs(value), radiusTyped: true }, ['radius']) }
      if (d && side === 'radius' && d.kind === 'chamfer') return { featureDraft: unlinkSlots({ ...d, distance: Math.abs(value) }, ['distance']) }
      if (d && side === 'thickness' && d.kind === 'shell') return { featureDraft: unlinkSlots({ ...d, thickness: Math.abs(value), thicknessFrom: 'typed' as const }, ['thickness']) }
      if (d && side === 'move' && d.kind === 'moveFace') return { featureDraft: unlinkSlots({ ...d, offset: value, reading: null }, ['offset']) }
      if (d && d.kind === 'moveBody' && isMoveGripSide(side)) {
        const { field, axis } = moveGripSlot(side)
        const next = [...d[field]] as Vec3
        next[axis] = value
        return { featureDraft: unlinkSlots({ ...d, [field]: next }, [moveSlotPath(side)]) }
      }
      return {}
    }),
})
