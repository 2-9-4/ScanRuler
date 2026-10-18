// SPDX-License-Identifier: AGPL-3.0-only
// The app's commands fed junk (hostileKit.ts; a plugin sweeps its own),
// with a scan open — put back before each command's sweep for those that
// let it go: each must refuse with a CommandError or answer, never throw
// anything else or hang.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../src/commands/registry'
import { useStore } from '../src/state/store'
import { boxMesh } from './helpers'
import { startHeadless, stlBytes, type Headless } from './commandKit'
import { hostileSweep } from './hostileKit'

vi.setConfig({ testTimeout: 600_000 })

const BOX = stlBytes(boxMesh(40, 40))
let headless: Headless

beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

describe('the app’s commands fed junk', () => {
  it('refuse it with a CommandError or answer — never throw anything else, never hang', async () => {
    const { findings, calls, answered } = await hostileSweep({
      before: async () => {
        if (!useStore.getState().fileName) await runCommand('scan.open', { bytes: BOX, name: 'box.stl', discard: true }).catch(() => {})
      },
    })
    expect(calls).toBeGreaterThan(1000)
    expect(answered).toBeGreaterThan(0)
    expect(findings).toEqual([])
  })
})
