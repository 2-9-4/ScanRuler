// SPDX-License-Identifier: AGPL-3.0-only
// The kernel worker's requests, one at a time, in the order they came — and
// a build or a preview that another of its kind has already overtaken left
// unplayed. A build of a slow part takes minutes, and every change made
// meanwhile asks for another: played one after the other, each of them
// whole, the part the user sees last waited for every build before it. The
// page has no use for an overtaken answer (ReClient hands back null for it),
// so a build followed straight by another build is answered as skipped, and
// a preview followed by a preview the same; anything else between them —
// a stage, an export — still sees the build it was asked after.

import type { ReAnswer, ReWorkerRequest } from './reService'

/** What a request that was skipped is answered with. */
export interface Skipped {
  type: 'skipped'
  requestId: number
}

/** Whether `next` asks anew what `msg` asks, so `msg` need not be played. */
export function overtaken(msg: ReWorkerRequest, next: ReWorkerRequest | undefined): boolean {
  return next !== undefined && next.type === msg.type && (msg.type === 'build' || msg.type === 'preview')
}

/** Runs the requests handed to `push` one at a time through `handle`,
 *  answering each through `reply` — an overtaken one as skipped, its STEP
 *  files passed on to the request that overtook it, which may be the first
 *  to name them. `yieldNow` lets the requests that came in meanwhile be
 *  pushed before the next is taken. */
export function requestQueue(handle: (msg: ReWorkerRequest) => Promise<ReAnswer>, reply: (msg: unknown, transfer?: Transferable[]) => void, yieldNow: () => Promise<void>) {
  const queue: ReWorkerRequest[] = []
  let running = false
  const drain = async () => {
    running = true
    try {
      for (;;) {
        await yieldNow()
        const msg = queue.shift()
        if (!msg) return
        const next = queue[0]
        if (overtaken(msg, next)) {
          if ((msg.type === 'build' || msg.type === 'preview') && msg.stepFiles?.length) {
            const later = next as typeof msg
            later.stepFiles = [...msg.stepFiles, ...(later.stepFiles ?? [])]
          }
          reply({ type: 'skipped', requestId: msg.requestId } satisfies Skipped)
          continue
        }
        // Every request answered: a handler that throws, or an answer that
        // cannot be sent (a buffer gone already), is answered as an error —
        // a request left unanswered holds every change behind it for good.
        let answered: ReAnswer
        try {
          answered = await handle(msg)
        } catch (e) {
          answered = { response: { type: 'error', requestId: msg.requestId, message: e instanceof Error ? e.message : String(e) }, transfer: [] }
        }
        try {
          reply(answered.response, answered.transfer)
        } catch (e) {
          reply({ type: 'error', requestId: msg.requestId, message: `The answer could not be sent: ${e instanceof Error ? e.message : String(e)}` })
        }
      }
    } finally {
      running = false
    }
  }
  return {
    push(msg: ReWorkerRequest): void {
      queue.push(msg)
      if (!running) void drain()
    },
  }
}
