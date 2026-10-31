// SPDX-License-Identifier: AGPL-3.0-only
// The map against the bodies as a picture waits for it. The workspace's effect
// asks the CAD worker for it once the key is on, and what the worker reads
// lands in the store (mapReport); a picture taken before that, with the key
// put back after it, shows no map and lets the reading go. So what asks for a
// map in a picture — reverse.body.review, view.render's show: { map: true } —
// waits here, on the store: no frame is needed, and a hidden tab's answers
// land all the same.

import { waitFor } from '../../../src/commands/core/common'
import { useStore } from '../../../src/state/store'
import { useRePrefs } from '../state/rePrefs'
import { re } from './reCommandCore'

/** The map's tick as it stands: mapRead's `after`, to be told one read since. */
export const mapMark = (): number => re().mapReport?.tick ?? -1

/** Whether an editor's ghost stands in for the bodies: the map is read against
 *  it, if at all, while it is up. */
function ghostUp(): boolean {
  const s = re()
  return Boolean(s.extrudeDraft || s.revolveDraft || s.featureDraft) && s.preview.status !== 'idle'
}

/** Whether a wait for the map is over with none to come: the key off, no body
 *  to read against, or a ghost in their place. */
function noMapToCome(): boolean {
  const s = re()
  return !s.bodyMap || !s.bodies.some((b) => b.visible) || ghostUp()
}

/** How long the last wait went unanswered, ms; null when none did. */
let unread: number | null = null

/**
 * Wait for the map against the bodies read at this range — one read since
 * `after` (mapMark) where one on the scan already will not do — `ms` at most.
 * Whether it is there; it never throws, a picture goes on without it and
 * mapWhyNow says how far it got.
 */
export async function mapRead(range: number, after: number | null, ms: number): Promise<boolean> {
  const started = Date.now()
  const there = () => {
    const m = re().mapReport
    return Boolean(m && m.source === 'bodies' && Math.abs(m.range - range) < 1e-9 && (after === null || m.tick > after))
  }
  await waitFor(() => there() || noMapToCome(), 'the map', ms).catch(() => null)
  const read = there()
  unread = read || noMapToCome() ? null : Date.now() - started
  return read
}

/** The tick the map key was turned on at, for the wait after it; null while
 *  it was on already. */
let askedAt: number | null = null

/** The map key turned, as a picture or view.set turns it. */
export function askMap(on: boolean): void {
  askedAt = on && !re().bodyMap ? mapMark() : null
  re().setBodyMap(on)
}

/** The wait of a picture that asked for the map: the map at the range the
 *  workspace reads at, `ms` at most. */
export async function settleMap(ms: number): Promise<void> {
  await mapRead(useRePrefs.getState().liveMapRange, askedAt, ms)
  askedAt = null
}

/** The wait is over with the picture: what it says goes with it. */
export function forgetMapWait(): void {
  unread = null
}

/** Why a picture has no map though the key is on: how far the reading got
 *  where a picture waited for it, and that it is still being read where none
 *  did. */
export function mapWhyNow(): string {
  if (ghostUp()) return 'an editor is open with its ghost up: no map against the bodies is read while it is — save or cancel it'
  if (unread === null) return 'the map against the bodies is still being read — try the picture again'
  const s = re()
  const far = s.building ? 'the bodies were still building, and the map is read after them' : s.kernelStatus !== 'ready' ? 'the CAD kernel was not ready' : `the CAD worker was still on it, ${useStore.getState().vertexCount.toLocaleString('en-US')} scan vertices`
  return `the map against the bodies was not read after ${Math.round(unread / 1000)} s: ${far} — the picture is without it. What the worker reads is kept while the bodies stand: ask again in a while`
}
