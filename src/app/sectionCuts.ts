// SPDX-License-Identifier: AGPL-3.0-only
// Keeping every section's cut in step with its plane: the draft's, as the
// offset is dragged, and the finished ones', which arrive from a project
// with their planes but not their polylines. The store says what plane each
// wants (sectionKeyOf) and what plane its cut was taken in (cutKey); this
// asks the worker for whatever is missing — a cut or a shadow, by the
// section's kind — whenever the store changes, with the panel open or
// without it, as a command makes a section too. A shadow only slid along
// its normal is the same outline on a plane further along, and is moved
// there rather than taken again.
//
// Only the latest plane counts for the draft. A grip drag moves it every
// frame, and a cut takes a few milliseconds on a big scan, so at most one
// request is in flight and the draft's plane is read again when it lands —
// a stale answer is kept on screen as the preview until the fresh one
// replaces it, but never makes the draft ready.

import type { RefObject } from 'react'
import { EDGE_MIN_FEATURE_MM } from '../core/flat/edges'
import type { SectionFrame } from '../core/section/frame'
import { shiftShadow } from '../core/section/shadow'
import type { SectionCut } from '../core/section/slice'
import type { MeshWorkerClient } from '../core/workerClient'
import { isShadow, sectionKeyOf, shadowParams, type SectionSpec } from '../state/sectionModel'
import { useStore } from '../state/store'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type State = ReturnType<typeof useStore.getState>

/** The draft's plane, as the key its cut has to match. */
const draftKeyOf = (s: State) => (s.sectionDraft?.frame ? sectionKeyOf(s.sectionDraft.frame, s.sectionDraft) : null)

/** Which sections are missing a cut for the plane they now have — one string,
 *  so a change of that set is told from any other change of the store. */
const wantingOf = (s: State) =>
  s.sections
    .filter((sec) => !sec.message && (!sec.cut || sec.cutKey !== sectionKeyOf(sec.frame, sec)))
    .map((sec) => sec.id)
    .join(',')

export function sectionCuts(clientRef: RefObject<MeshWorkerClient | null>) {
  /** What a section of this kind is on this plane: the cut through the
   *  scan, or its shadow — slid from the shadow in hand where only the
   *  offset has changed. */
  const take = async (frame: SectionFrame, spec: SectionSpec, held?: SectionCut): Promise<SectionCut> => {
    if (!isShadow(spec)) return clientRef.current!.section(frame.origin, frame.normal, EDGE_MIN_FEATURE_MM)
    const { play, tolerance, smoothDeg } = shadowParams(spec)
    const sh = held?.shadow
    const same = sh && sh.play === play && sh.tolerance === tolerance && sh.smoothDeg === smoothDeg
    const moved = same ? shiftShadow(held, frame) : null
    return moved ?? clientRef.current!.shadow(frame, tolerance, play, smoothDeg)
  }

  // ---- the draft -------------------------------------------------------------
  let draftJob: Promise<void> | null = null
  /** Cut the draft's plane until the cut in hand is for the plane it has now.
   *  A second call while one runs waits for the same one. */
  const pumpDraft = (): Promise<void> => {
    if (draftJob) return draftJob
    const job = (async () => {
      for (;;) {
        const d = useStore.getState().sectionDraft
        if (!d?.frame || d.status === 'failed') return
        const key = sectionKeyOf(d.frame, d)
        if (d.cutKey === key) return
        const scanVersion = clientRef.current!.scanVersion
        try {
          const cut = await take(d.frame, d, d.cut)
          if (scanVersion !== clientRef.current!.scanVersion || !useStore.getState().sectionDraft) return
          useStore.getState().resolveSectionDraft(key, cut)
        } catch (e) {
          if (scanVersion !== clientRef.current!.scanVersion || !useStore.getState().sectionDraft) return
          useStore.getState().failSectionDraft(message(e))
          return
        }
      }
    })()
    // Settled — however quickly, even before this line — the next call
    // starts afresh.
    draftJob = job
    const done = () => { if (draftJob === job) draftJob = null }
    job.then(done, done)
    return job
  }

  // ---- the sections -------------------------------------------------------
  const inFlight = new Set<number>()
  const pumpSections = () => {
    for (const sec of useStore.getState().sections) {
      const key = sectionKeyOf(sec.frame, sec)
      if (sec.message || (sec.cut && sec.cutKey === key)) continue
      if (inFlight.has(sec.id)) continue
      inFlight.add(sec.id)
      const scanVersion = clientRef.current!.scanVersion
      take(sec.frame, sec, sec.cut)
        .then((cut) => { if (scanVersion === clientRef.current!.scanVersion) useStore.getState().resolveSection(sec.id, key, cut) })
        .catch((e) => { if (scanVersion === clientRef.current!.scanVersion) useStore.getState().failSection(sec.id, message(e)) })
        .finally(() => {
          inFlight.delete(sec.id)
          // The part may have been aligned while the cut was being taken, in
          // which case the answer was for a plane the section no longer has.
          pumpSections()
        })
    }
  }

  /** Cut whatever is missing now, and again whenever the store changes what
   *  is missing. The returned function stops watching. */
  const watch = () => {
    void pumpDraft()
    pumpSections()
    return useStore.subscribe((s, prev) => {
      if (draftKeyOf(s) !== draftKeyOf(prev)) void pumpDraft()
      if (wantingOf(s) !== wantingOf(prev)) pumpSections()
    })
  }

  return { pumpDraft, pumpSections, watch }
}
