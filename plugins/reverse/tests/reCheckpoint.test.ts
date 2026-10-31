// SPDX-License-Identifier: AGPL-3.0-only
// A run of changes that stands or falls together: history.checkpoint marks
// the history, three features are added, history.restore takes them all
// back and the part is as it was; restored again it undoes nothing; undone
// past the mark, it refuses and undoes nothing. And a change's answer says
// which steps its build played, each with its milliseconds.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, undoLabels, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const sketch = (name: string, x: number) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [x, 0], size: [8, 8], fixed: true }] } })
const extrude = (name: string) => ({ kind: 'extrude', sketchId: name, regions: 'all', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' })

describe('a checkpoint in the history', () => {
  it('takes every change since it back, and refuses once undone past', async () => {
    await run('reverse.feature.add', { features: [sketch('A', 0), extrude('A')], detail: 'none' })
    const mark = await run<{ checkpoint: string; steps: number }>('history.checkpoint')
    expect(mark.steps).toBe(1)
    await run('reverse.feature.add', { features: [sketch('B', 20), extrude('B')], detail: 'none' })
    await run('reverse.parameter.add', { name: 'w', expression: '3' })
    await run('reverse.feature.add', { feature: { kind: 'fillet', body: 'Solid 1', edges: [0], radius: 1 }, detail: 'none' })
    expect(useReverse.getState().features).toHaveLength(5)
    expect(undoLabels()).toHaveLength(4)

    const back = await run<{ undone: string[] }>('history.restore', { checkpoint: mark.checkpoint })
    expect(back.undone).toEqual(['Agent: add fillet', 'Agent: add parameter w', 'Agent: add 2 features'])
    expect(useReverse.getState().features.map((f) => f.name)).toEqual(['A', 'Extrude 1'])
    expect(useReverse.getState().parameters).toHaveLength(0)
    await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(1)
    // At the mark already: nothing to undo.
    expect((await run<{ undone: string[] }>('history.restore', { checkpoint: mark.checkpoint })).undone).toEqual([])
    // Undone past it: the mark is gone, and nothing is undone.
    await run('history.undo')
    const gone = await refused('history.restore', { checkpoint: mark.checkpoint })
    expect(gone.code).toBe('invalid_state')
    expect(useReverse.getState().features).toHaveLength(0)
    expect((await refused('history.restore', { checkpoint: 'cp999999' })).code).toBe('not_found')
  })

  it('says which steps a change’s build played, with their milliseconds', async () => {
    const out = await run<{ steps: { recomputed: number; played: { feature: string; ms: number }[] } }>('reverse.feature.add', { features: [sketch('C', 40), extrude('C')], detail: 'none' })
    expect(out.steps.recomputed).toBe(out.steps.played.length)
    expect(out.steps.played.map((p) => p.feature)).toEqual(['Extrude 1'])
    expect(out.steps.played[0].ms).toBeGreaterThan(0)
  })
})
