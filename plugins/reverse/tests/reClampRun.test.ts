// SPDX-License-Identifier: AGPL-3.0-only
// What a triple clamp's run asked of the part's side: a list of sketches
// alone asks nothing of the kernel, as a first sketch once stood five minutes
// behind one that did not answer; a part built after it, and one taken back
// and restored, still comes whole; and what a save and an export say of a plan
// left open. The kernel runs in this thread.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { boxMesh } from '../../../tests/helpers'
import { planOpenSaid, planSection } from '../app/rePlan'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 180_000 })

let headless: Headless
let session: ReverseSession
let builds = 0
const stops: (() => void)[] = []

class CountingClient extends ReClient {
  override build(...args: Parameters<ReClient['build']>): ReturnType<ReClient['build']> {
    builds++
    return super.build(...args)
  }
}

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new CountingClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box-clamp-run.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})

const plate = (name: string, offset: number) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z', offset }, sketch: { shapes: [{ kind: 'rectangle', from: [-10, -10], to: [10, 10] }] } })

describe('a list of sketches alone', () => {
  it('lands without asking the kernel', async () => {
    builds = 0
    await run('reverse.feature.add', { feature: plate('Plan', 0) })
    await run('reverse.feature.add', { feature: plate('Plan above', 5) })
    await session.settled()
    expect(builds).toBe(0)
    expect(useReverse.getState().bodies).toHaveLength(0)
    expect(useReverse.getState().features).toHaveLength(2)
  })

  it('builds the part once a solid comes, and whole again when it is restored', async () => {
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plan', regions: 'all', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' } })
    await session.settled()
    expect(builds).toBeGreaterThan(0)
    expect(useReverse.getState().bodies).toHaveLength(1)
    const made = useReverse.getState().bodies[0]
    expect(made.faces).toBe(6)
    expect(session.topologies.get(made.id)?.faces).toHaveLength(6)

    // Back to sketches alone, and the block restored: the kernel was not asked
    // in between, and still hands the body over.
    await run('reverse.feature.remove', { feature: 'Block' })
    await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(0)
    await run('history.undo', {})
    await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(1)
    // What the viewport and the picks read: it has to be there too.
    const again = useReverse.getState().bodies[0]
    expect(again.faces).toBe(6)
    expect(session.topologies.get(again.id)?.faces).toHaveLength(6)
  })
})

describe('a plan left open', () => {
  it('is said on a save and an export, and not once it is closed', async () => {
    expect(planOpenSaid()).toBeNull()
    await run('reverse.plan.set', { archetype: 'machined', regions: [{ name: 'Body' }, { name: 'Rounds' }], target: { withinT: 85 } })
    expect(planOpenSaid()).toMatch(/2 of 2 regions open \(Body, Rounds\), target 85 %/)
    expect(planSection.saveSays?.()).toEqual([planOpenSaid()])
    await run('reverse.plan.tick', { region: 'Body', feature: 'Block' })
    await run('reverse.plan.tick', { region: 'Rounds', skip: 'none on this part' })
    expect(planOpenSaid()).toBeNull()
    expect(planSection.saveSays?.()).toEqual([])
  })
})
