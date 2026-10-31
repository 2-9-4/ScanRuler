// SPDX-License-Identifier: AGPL-3.0-only
// The feature list played back for the camera: the rollback bar put over
// the first feature — the scan alone, or the bare stage — and moved down
// one feature at a time, each step held for a moment once its build has
// landed, until the part stands whole and the bar goes back where it stood.
// A recording of the viewport tells how the part was built, feature by
// feature. Paused, the keys step it by hand. With the sketches skipped only
// the steps that change the geometry are shown: a profile goes straight to
// the body made of it.
//
// The bar moves through the store's playback actions, not rollTo: a
// playback is neither an undo step nor a change to the file. Anything else
// that moves the bar or changes the list — an editor opened, an undo, a
// feature deleted, a project loaded — ends it where it stands.

import { useStore } from '../../../src/state/store'
import type { Feature } from '../core/features'
import { useRePrefs } from '../state/rePrefs'
import { reEditorOpen, useReverse } from '../state/reStore'
import { reverseSession } from './reSession'

/** The clock's run: a pause, a step by hand or a stop starts another, and
 *  the step the one before was waiting on is let go. */
let run = 0
let unwatch: (() => void) | null = null

const re = () => useReverse.getState()
interface Lists { features: Feature[]; rolledBack: Feature[] }
const total = (s: Lists) => s.features.length + s.rolledBack.length
const idsOf = (s: Lists) => [...s.features, ...s.rolledBack].map((f) => f.id).join(',')

/** The steps a playback of the list shows, as the number of features each
 *  builds: the start, before any, and then one a feature — or, with the
 *  sketches skipped, one a feature that is not a sketch, a sketch changing
 *  no geometry. Sketches at the end of the list are then no step at all. */
export function playbackSteps(all: readonly Feature[], skipSketches: boolean): number[] {
  const steps = [0]
  for (let n = 1; n <= all.length; n++) if (!skipSketches || all[n - 1].kind !== 'sketch') steps.push(n)
  return steps
}

/** The steps of the list as it stands, by the operator's choice. */
const stepsNow = (): number[] => {
  const s = re()
  return playbackSteps([...s.features, ...s.rolledBack], useRePrefs.getState().playbackSkipSketches)
}

/** The step `by` shown steps on from `at` — back for a negative — as far
 *  as the list goes; null with none that way. */
export function playbackStepFrom(at: number, by: number, steps: readonly number[] = stepsNow()): number | null {
  const way = by > 0 ? steps.filter((n) => n > at) : steps.filter((n) => n < at).reverse()
  return way.length === 0 ? null : way[Math.min(Math.abs(by), way.length) - 1]
}

/** End the playback if anything but the playback moves the bar or changes
 *  the list under it. */
function watch(): void {
  unwatch?.()
  let ids = idsOf(re())
  unwatch = useReverse.subscribe((s, prev) => {
    const p = s.playback
    if (!p) {
      release()
      return
    }
    if (s.features !== prev.features || s.rolledBack !== prev.rolledBack) {
      const now = idsOf(s)
      if (now !== ids || s.features.length !== p.at) {
        ids = now
        stopPlayback(false)
        return
      }
    }
    if (reEditorOpen(s)) stopPlayback(false)
  })
}

function release(): void {
  run++
  unwatch?.()
  unwatch = null
}

/** Wait for the step to be built, hold it, and move on — or, at the last
 *  step, end. Lets go as soon as another run has begun. */
async function tick(token: number): Promise<void> {
  try {
    await reverseSession()?.settled()
  } catch (e) {
    if (token !== run) return
    stopPlayback(false)
    useStore.getState().setError(`The playback stopped: ${e instanceof Error ? e.message : String(e)}`)
    return
  }
  if (token !== run) return
  await new Promise((resolve) => setTimeout(resolve, useRePrefs.getState().playbackStepMs))
  if (token !== run) return
  const p = re().playback
  if (!p?.playing) return
  const next = playbackStepFrom(p.at, 1)
  if (next === null) {
    stopPlayback()
    return
  }
  re().playbackTo(next, true)
  void tick(token)
}

/** Play the list from the top: the bar over the first feature, then down
 *  it a step at a time. False when there is nothing to play, or an editor
 *  is open. */
export function startPlayback(): boolean {
  const s = re()
  if (s.playback || reEditorOpen(s) || total(s) === 0) return false
  s.playbackTo(0, true)
  watch()
  void tick(++run)
  return true
}

/** Hold the playback at the step it shows. */
export function pausePlayback(): void {
  const p = re().playback
  if (!p?.playing) return
  run++
  re().playbackTo(p.at, false)
}

/** Carry on from the step shown — or, paused at the end, from the top. */
export function resumePlayback(): void {
  const s = re()
  const p = s.playback
  if (!p || p.playing) return
  s.playbackTo(playbackStepFrom(p.at, 1) === null ? 0 : p.at, true)
  void tick(++run)
}

/** Steps down the list or back up it, by hand — the shown ones, as far as
 *  the list goes: the playback held there. */
export function stepPlayback(by: number): void {
  const p = re().playback
  if (!p) return
  run++
  re().playbackTo(playbackStepFrom(p.at, by) ?? p.at, false)
}

/** End the playback: the bar back where it stood when it began, or — with
 *  `restore` false — left where it stands. */
export function stopPlayback(restore = true): void {
  release()
  re().endPlayback(restore)
}

/** What the agent is told while the list plays: the bar is not where the
 *  part ends, and a feature added now would go in at the step shown. */
export function playbackBusy(): string | null {
  return re().playback ? 'the feature list is being played back — stop it in the panel first' : null
}
