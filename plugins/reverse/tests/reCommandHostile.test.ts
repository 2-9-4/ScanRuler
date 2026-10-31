// SPDX-License-Identifier: AGPL-3.0-only
// The workspace's commands fed junk (tests/hostileKit.ts): with a part to
// work on — a block, built again before each command's sweep for those that
// take it away — each must refuse with a CommandError or answer, never
// throw anything else or hang.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../../src/commands/registry'
import { startHeadless, type Headless } from '../../../tests/commandKit'
import { hostileSweep } from '../../../tests/hostileKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 1_200_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await session.startKernel()
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})

/** A block, a parameter and a note: something for every command to name. */
async function part() {
  await session.settled().catch(() => {})
  if (useReverse.getState().bodies.length > 0) return
  await runCommand('reverse.feature.clear', {}).catch(() => {})
  await runCommand('reverse.feature.add', {
    features: [
      { kind: 'sketch', name: 'Junk base', plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [20, 12], fixed: true }] } },
      { kind: 'extrude', sketchId: 'Junk base', regions: 'all', extent: { kind: 'distance', from: 0, to: 6 }, op: 'new' },
    ],
    detail: 'none',
  }).catch(() => {})
  await session.settled().catch(() => {})
}

describe('the workspace’s commands fed junk', () => {
  it('refuse it with a CommandError or answer — never throw anything else, never hang', async () => {
    const { findings, calls, answered } = await hostileSweep({ include: (name) => name.startsWith(`${plugin.id}.`), before: () => part(), perCallMs: 60_000 })
    expect(calls).toBeGreaterThan(1000)
    expect(answered).toBeGreaterThan(0)
    expect(findings).toEqual([])
  })
})
