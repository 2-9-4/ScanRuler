// SPDX-License-Identifier: AGPL-3.0-only
// The CAD kernel's worker. Its own worker rather than a job on the mesh
// worker: the kernel is a 5 MB download and a second of compilation that
// only the Reverse engineer workspace ever needs, so it is fetched when that
// workspace is entered and not before — and a rebuild must not queue behind
// a wall-thickness measurement, nor the other way round. What it does with
// each request, and the protocol, are reService.ts.

import { createReService, type ReWorkerRequest } from './reService'
import { requestQueue } from './reQueue'
import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import manifoldUrl from 'manifold-3d/manifold.wasm?url'
import { reply, WorkerRpc } from '../../../src/core/workerRpc'
import type { HelperPool } from './reParallel'
import { isKernelEvent } from './reEvents'
import type { HelperResponse } from './reHelper'

export type { ReWorkerRequest, ReWorkerResponse } from './reService'

/** Helper kernels for a build's groups of steps (reParallel.ts): two, where
 *  the machine has the cores for them beside this worker and the page —
 *  each a kernel of its own, a few hundred megabytes once it has built. The
 *  worker of each is made the first time a build hands it a group, and made
 *  again after one that failed. */
function helperPool(): HelperPool {
  const size = Math.max(0, Math.min(2, (self.navigator.hardwareConcurrency || 2) - 2))
  const rpcs: (WorkerRpc | null)[] = []
  let next = 1
  const pool: HelperPool = {
    size,
    request(helper, msg, transfer) {
      let rpc = rpcs[helper]
      // What the helper is at, heard between its answers and passed on.
      if (!rpc || rpc.dead) rpc = rpcs[helper] = new WorkerRpc(() => new Worker(new URL('./reHelperWorker.ts', import.meta.url), { type: 'module' }), `CAD helper ${helper}`, (data) => {
        if (!isKernelEvent(data)) return false
        pool.onEvent?.(helper, data)
        return true
      })
      return rpc.request<HelperResponse>({ ...msg, requestId: next++ }, transfer)
    },
  }
  return pool
}

// The adapter is the one module that knows the package; it is loaded here,
// on demand, and the binary is fetched from the URL the bundler gave the
// wasm file — a separate, replaceable file, as its licence wants.
// Manifold, the mesh boolean the bodies' overlaps are worked out with, the
// same way, the first time they are asked for.
// What the kernels are at, told to the page between the answers
// (reEvents.ts): the page names a build that does not finish by it.
const service = createReService(
  async () => (await import('./kernel')).ReKernel.load(wasmUrl),
  async () => {
    const { default: Module } = await import('manifold-3d')
    const wasm = await Module({ locateFile: () => manifoldUrl })
    wasm.setup()
    return wasm
  },
  helperPool(),
  (e) => reply(e),
)

// One request at a time, a build or a preview overtaken by another left
// unplayed (reQueue.ts). Between two requests the worker lets the messages
// that came in meanwhile arrive, so it knows what has been overtaken.
const channel = new MessageChannel()
const waiting: (() => void)[] = []
channel.port1.onmessage = () => waiting.shift()?.()
const queue = requestQueue(
  (msg) => service.handle(msg),
  reply,
  () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve)
      channel.port2.postMessage(null)
    }),
)

self.onmessage = (ev: MessageEvent<ReWorkerRequest>) => queue.push(ev.data)
