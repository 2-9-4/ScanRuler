// SPDX-License-Identifier: AGPL-3.0-only
// The kernel in this thread, for Node, which has no workers: a transport
// for ReClient that hands each request to the kernel worker's own service
// (reService.ts) and gives back its answer — the tests drive the workspace
// through it, and the app run headless (plugin.ts headless) builds through
// it, exactly as the page does. Nothing is transferred: both ends are in
// one thread.

import type { ReTransport } from './reClient'
import type { ReKernel } from './kernel'
import { createReService } from './reService'
import type { HelperPool } from './reParallel'

/** Manifold in this thread, as Node finds its WebAssembly by itself. */
export async function loadManifold() {
  const { default: Module } = await import('manifold-3d')
  const wasm = await Module()
  wasm.setup()
  return wasm
}

export function localKernel(load: () => Promise<ReKernel> = async () => (await import('./kernel')).ReKernel.load(), helpers?: HelperPool): ReTransport {
  let disposed = false
  const transport: ReTransport = {
    onFailure: null,
    onEvent: null,
    async request<T>(msg: { requestId: number }): Promise<T> {
      if (disposed) throw new Error('The CAD kernel was shut down.')
      const { response } = await service.handle(msg as Parameters<typeof service.handle>[0])
      if (response.type === 'error') throw new Error(response.message)
      return response as T
    },
    dispose() {
      disposed = true
    },
  }
  // What the kernel is at, told as the worker tells it — none once let go.
  const service = createReService(load, loadManifold, helpers, (e) => {
    if (!disposed) transport.onEvent?.(e)
  })
  return transport
}
