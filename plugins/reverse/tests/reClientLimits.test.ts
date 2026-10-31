// SPDX-License-Identifier: AGPL-3.0-only
// The kernel's requests other than a build have a time limit, so one the
// worker never answers fails what waits on it rather than hold it for good.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerRpc } from '../../../src/core/workerRpc'
import { ReClient, type ReTransport } from '../core/reClient'

class SilentWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage(): void {}
  terminate(): void {}
}

afterEach(() => vi.useRealTimers())

describe('the kernel client’s time limits', () => {
  it('limits a read and leaves a build to the session', async () => {
    const asked: { type: string; limitMs?: number }[] = []
    const transport: ReTransport = {
      onFailure: null,
      dispose() {},
      request<T>(msg: { requestId: number }, _transfer: Transferable[], limitMs?: number): Promise<T> {
        const type = (msg as unknown as { type: string }).type
        asked.push({ type, limitMs })
        if (type === 'build') return Promise.resolve({ type: 'skipped', requestId: msg.requestId } as T)
        if (type === 'stage') return Promise.resolve({ type: 'stage-ok', requestId: msg.requestId, stage: null } as T)
        return Promise.resolve({ type: 'check-ok', requestId: msg.requestId, check: null } as T)
      },
    }
    const client = new ReClient(transport)
    await client.build([], new Map())
    await client.stage(1, 1)
    await client.check(1, 0.01)
    expect(asked.map((a) => [a.type, a.limitMs])).toEqual([
      ['build', undefined],
      ['stage', 60_000],
      ['check', 60_000],
    ])
  })

  it('fails a stage the worker never answers, saying which request it was', async () => {
    vi.useFakeTimers()
    const client = new ReClient(new WorkerRpc(() => new SilentWorker() as unknown as Worker, 'CAD kernel worker'))
    const stage = expect(client.stage(3, 1)).rejects.toThrow('CAD kernel worker did not answer the "stage" request in 60 s')
    await vi.advanceTimersByTimeAsync(60_001)
    await stage
    client.dispose()
  })
})
