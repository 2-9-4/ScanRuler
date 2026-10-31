// SPDX-License-Identifier: AGPL-3.0-only
// What a kernel tells of its work while it does it, beside its answers: the
// step of a build it is about to play, and the kernel call it is about to
// make. A wasm call cannot be interrupted, nor can the worker say anything
// while it is in one — so what it said last is where it is: what the page
// names a build that does not finish by, and stops (ReClient.playing,
// reSession.ts stop). The kernel's worker tells its own and passes on its
// helpers' (reWorker.ts, reHelper.ts).

import type { Builder } from './build'
import { hearCalls } from './kernelOps'

/** The step of a build about to be played — null once the steps given are
 *  played — or the kernel call about to be made, by the name its errors go
 *  by ("Splitting"). */
export type KernelEvent = { event: 'step'; id: number | null } | { event: 'call'; what: string }

/** The same as the kernel's worker posts it to the page: with the request
 *  it is working on, and `helper`, the helper kernel it came from
 *  (reParallel.ts), when not its own. */
export type ReWorkerEvent = KernelEvent & { requestId: number; helper?: number }

/** Whether a message from a worker is one of these, not an answer. */
export const isKernelEvent = (data: unknown): data is KernelEvent =>
  typeof data === 'object' && data !== null && ((data as { event?: unknown }).event === 'step' || (data as { event?: unknown }).event === 'call')

/** How long a kernel call's name is not told again while the calls after it
 *  bear the same, ms: once a second is enough to say the kernel is at it. */
const CALL_TOLD_MS = 1000

/** A teller of a kernel's events to `tell`: each step, and each kernel call
 *  whose name is not the one told last in the step, or was told over a
 *  second ago — a run of a thousand calls of one kind costs a message a
 *  second. `hook` puts it on a builder, and on the kernel's calls in this
 *  thread. */
export function kernelTeller(tell: (e: KernelEvent) => void) {
  let last: string | null = null
  let at = 0
  const call = (what: string) => {
    const now = performance.now()
    if (what === last && now - at < CALL_TOLD_MS) return
    last = what
    at = now
    tell({ event: 'call', what })
  }
  return {
    hook(builder: Builder): void {
      builder.onStep = (id) => {
        last = null
        tell({ event: 'step', id })
      }
      hearCalls(call)
    },
  }
}
