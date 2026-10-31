// SPDX-License-Identifier: AGPL-3.0-only
// The kernel in this thread for the tests: the transport itself is
// core/reLocal.ts, which the app run headless uses too; here beside it,
// helper kernels in this thread for the sharing out of a build.

import type { ReKernel } from '../core/kernel'
import { createHelperService, type HelperRequest } from '../core/reHelper'
import type { HelperPool } from '../core/reParallel'

export { loadManifold, localKernel } from '../core/reLocal'

/** Helper kernels in this thread (reHelper.ts), each a kernel of its own,
 *  every message cloned as a worker's would be — the sharing out of a
 *  build tested as the page does it, but one helper after the other. */
export function localHelpers(count: number, { load = async () => (await import('../core/kernel')).ReKernel.load(), minMs }: { load?: () => Promise<ReKernel>; minMs?: number } = {}): HelperPool & { asked: number[] } {
  const services = Array.from({ length: count }, () => createHelperService(load))
  const asked: number[] = []
  return {
    size: count,
    asked,
    ...(minMs !== undefined ? { minMs } : {}),
    async request(helper, msg) {
      // The groups asked for, by helper; not the start of its kernel.
      if (msg.type === 'part') asked.push(helper)
      const { response } = await services[helper - 1].handle(structuredClone({ ...msg, requestId: 0 }) as HelperRequest)
      if (response.type === 'error') throw new Error(response.message)
      return structuredClone(response)
    },
  }
}
