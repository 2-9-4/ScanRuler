// SPDX-License-Identifier: AGPL-3.0-only
// A helper kernel's worker, made by the kernel's worker (reWorker.ts) when
// a build has groups of steps to share out — see reHelper.ts. Its kernel
// is loaded from the same wasm file as the main one.

import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import { reply } from '../../../src/core/workerRpc'
import { createHelperService, type HelperRequest } from './reHelper'

// What it is at told as it goes, between the answers (reEvents.ts).
const service = createHelperService(async () => (await import('./kernel')).ReKernel.load(wasmUrl), (e) => reply(e))

// One group at a time, in the order they came.
let queue: Promise<void> = Promise.resolve()
self.onmessage = (ev: MessageEvent<HelperRequest>) => {
  queue = queue.then(async () => {
    const { response, transfer } = await service.handle(ev.data)
    reply(response, transfer)
  })
}
