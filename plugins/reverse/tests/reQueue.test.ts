// SPDX-License-Identifier: AGPL-3.0-only
// The kernel worker's requests one at a time, a build or a preview that
// another of its kind overtook answered as skipped and never played.

import { describe, expect, it } from 'vitest'
import { requestQueue } from '../core/reQueue'
import type { ReAnswer, ReWorkerRequest } from '../core/reService'

describe('the kernel worker’s queue', () => {
  it('plays the requests in order, skips a build or a preview overtaken by another, and hands its STEP files on', async () => {
    const played: ReWorkerRequest[] = []
    const replies: { type: string; requestId: number }[] = []
    let running = 0
    let most = 0
    const handle = async (msg: ReWorkerRequest): Promise<ReAnswer> => {
      most = Math.max(most, ++running)
      played.push(msg)
      await new Promise((r) => setTimeout(r, 1))
      running--
      return { response: { type: 'scan-ok', requestId: msg.requestId }, transfer: [] }
    }
    const queue = requestQueue(handle, (msg) => replies.push(msg as { type: string; requestId: number }), () => Promise.resolve())
    const build = (requestId: number, stepFiles?: [string, string][]): ReWorkerRequest => ({ type: 'build', requestId, steps: [], sketches: [], ...(stepFiles ? { stepFiles } : {}) })
    const preview = (requestId: number): ReWorkerRequest => ({ type: 'preview', requestId, step: { kind: 'hole' } as never, sketch: null })
    // Two builds in a row, the first naming a file; a stage between the
    // second and the next build; two previews in a row.
    for (const msg of [build(1, [['a', 'A']]), build(2), { type: 'stage', requestId: 3, stepId: 1, bodyId: 1 } as ReWorkerRequest, preview(4), preview(5), build(6)]) queue.push(msg)
    await new Promise((r) => setTimeout(r, 50))
    expect(replies.map((r) => [r.requestId, r.type])).toEqual([
      [1, 'skipped'],
      [2, 'scan-ok'],
      [3, 'scan-ok'],
      [4, 'skipped'],
      [5, 'scan-ok'],
      [6, 'scan-ok'],
    ])
    expect(played.map((m) => m.requestId)).toEqual([2, 3, 5, 6])
    // The build that overtook the first is the first to name the file now.
    expect(played[0].type === 'build' && played[0].stepFiles).toEqual([['a', 'A']])
    // One at a time, though each waits on something.
    expect(most).toBe(1)

    // A request that comes in while one plays waits its turn.
    queue.push(build(7))
    queue.push({ type: 'check', requestId: 8, bodyId: 1, tinyArea: 0 })
    await new Promise((r) => setTimeout(r, 30))
    expect(replies.slice(6).map((r) => [r.requestId, r.type])).toEqual([
      [7, 'scan-ok'],
      [8, 'scan-ok'],
    ])
    expect(most).toBe(1)
  })
})
