// SPDX-License-Identifier: AGPL-3.0-only
// Round 12's L8 through the commands: many edits built once. Nine stations
// of a loft edited in one reverse.feature.update { features } cost one
// build, and the answer gives each edit what it picked; the first edit
// refused stops the rest, those before it built. A batch's changes run
// deferred hold their builds back for the last of them — or for a command
// of another kind, which finds the part built. In the kernel in this
// thread, with no scan — as reBuild.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../../src/commands/registry'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
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
  await session.startKernel()
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Row { id: number; name?: string; status: string; result?: { status: string } | null; picked?: Record<string, unknown>[] }
interface Many { updated: Row[]; stopped?: { index: number; code: string; kept: string[] }; rollback: unknown; bodies?: { count: number; changed?: { id: number; volume: number }[] }; failed?: unknown[]; build?: string; steps?: { recomputed: number } }

const plane = (z: number) => ({ kind: 'world', axis: 'z', offset: z })

const station = (i: number, z: number, size: number) => ({ kind: 'sketch', name: `Station ${i}`, plane: plane(z), sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [size, size], fixed: true }] } })

/** A loft through nine square stations, 5 mm apart up Z, narrowing. */
async function hump(): Promise<void> {
  await run('reverse.feature.add', { features: Array.from({ length: 9 }, (_, i) => station(i + 1, 5 * i, 20 - i)) })
  const loft = await run<{ result: { status: string; message?: string } }>('reverse.feature.add', { feature: { kind: 'loft', name: 'Hump', sketches: Array.from({ length: 9 }, (_, i) => `Station ${i + 1}`), op: 'new' } })
  expect(loft.result.status, loft.result.message).toBe('ok')
}

/** Count the builds the kernel is asked for while `job` runs. */
async function builds<T>(job: () => Promise<T>): Promise<{ out: T; asked: number }> {
  const client = session.client()!
  const spy = vi.spyOn(client, 'build')
  try {
    const out = await job()
    return { out, asked: spy.mock.calls.length }
  } finally {
    spy.mockRestore()
  }
}

const volume = () => useReverse.getState().bodies.reduce((v, b) => v + b.volume, 0)

describe('L8: one rebuild for many edits', () => {
  it('nine station edits in features cost one build, and each edit is answered', async () => {
    await hump()
    const was = volume()
    const { out, asked } = await builds(() =>
      run<Many>('reverse.feature.update', { features: Array.from({ length: 9 }, (_, i) => ({ feature: `Station ${i + 1}`, set: { offset: 5 * i * 1.2 } })) }),
    )
    expect(asked).toBe(1)
    expect(out.updated).toHaveLength(9)
    for (const row of out.updated) expect(row.status).toBe('ok')
    expect(out.stopped).toBeUndefined()
    expect(out.failed).toBeUndefined()
    expect(out.build).toBeUndefined()
    // The loft is the taller for it: 1.2 times.
    expect(volume() / was).toBeCloseTo(1.2, 3)
    expect(out.bodies?.changed).toHaveLength(1)
    // One undo step for them all.
    await run('history.undo')
    await session.settled()
    expect(volume()).toBeCloseTo(was, 6)
  })

  it('each edit keeps what it picked, at every detail', async () => {
    await run('reverse.feature.add', { feature: station(1, 0, 20) })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Station 1', regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' } })
    await run('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body: 'Block', edges: [{ between: [[0, 0, 1], [1, 0, 0]] }], radius: 1 } })
    await run('reverse.feature.add', { feature: { kind: 'chamfer', name: 'Bevel', body: 'Block', edges: [{ between: [[0, 0, 1], [-1, 0, 0]] }], distance: 1 } })
    const { out, asked } = await builds(() =>
      run<Many>('reverse.feature.update', {
        features: [
          { feature: 'Round', set: { edges: [{ between: [[0, 0, 1], [0, 1, 0]] }] } },
          { feature: 'Bevel', set: { edges: [{ between: [[0, 0, 1], [0, -1, 0]] }], distance: 0.5 } },
        ],
        detail: 'none',
      }),
    )
    expect(asked).toBe(1)
    expect(out.updated.map((r) => r.id)).toHaveLength(2)
    for (const row of out.updated) expect((row.picked?.[0] as { edges?: unknown[] })?.edges).toHaveLength(1)
    expect(out.bodies).toBeUndefined()
    expect(out.rollback).toBeDefined()
  })

  it('the first edit refused stops the rest; those before it stand, built once', async () => {
    await hump()
    const { out, asked } = await builds(() =>
      run<Many>('reverse.feature.update', {
        features: [
          { feature: 'Station 9', set: { offset: 50 } },
          { feature: 'Station 8', set: { kind: 'extrude' } },
          { feature: 'Station 7', set: { offset: 36 } },
        ],
      }),
    )
    expect(asked).toBe(1)
    expect(out.updated.map((r) => r.name)).toEqual(['Station 9'])
    expect(out.stopped).toMatchObject({ index: 1, code: 'invalid_input', kept: ['Station 9'] })
    const f = useReverse.getState().features.find((x) => x.name === 'Station 7') as { plane: { offset: number } }
    expect(f.plane.offset).toBe(30)
  })

  it('takes feature and set, or features — not both, nor neither', async () => {
    await hump()
    expect((await refused('reverse.feature.update', { feature: 'Station 1', set: {}, features: [{ feature: 'Station 2', set: {} }] })).code).toBe('invalid_input')
    expect((await refused('reverse.feature.update', { feature: 'Station 1' })).code).toBe('invalid_input')
    expect((await refused('reverse.feature.update', { features: [{ feature: 'Station 1', set: { name: 'Station 2' } }] })).code).toBe('invalid_input')
  })
})

describe('L8: a batch’s changes built at its end', () => {
  it('changes run deferred hold their builds back; the last, not deferred, builds them all once', async () => {
    await hump()
    const was = volume()
    const { out, asked } = await builds(async () => {
      const answers: Record<string, unknown>[] = []
      for (let i = 0; i < 9; i++) {
        const deferred = i < 8
        answers.push((await runCommand('reverse.feature.update', { feature: `Station ${i + 1}`, set: { offset: 5 * i * 1.2 }, detail: 'none' }, undefined, undefined, deferred)) as Record<string, unknown>)
      }
      return answers
    })
    expect(asked).toBe(1)
    expect(out.slice(0, 8).every((a) => a.build === 'held')).toBe(true)
    expect(out[8].build).toBeUndefined()
    expect(session.held()).toBe(false)
    expect(volume() / was).toBeCloseTo(1.2, 3)
  })

  it('a command of another kind finds the held changes built', async () => {
    await hump()
    const was = volume()
    const { asked } = await builds(async () => {
      await runCommand('reverse.feature.update', { feature: 'Station 9', set: { offset: 48 } }, undefined, undefined, true)
      await runCommand('reverse.feature.update', { feature: 'Station 8', set: { offset: 42 } }, undefined, undefined, true)
      expect(session.held()).toBe(true)
      await run('session.state')
    })
    expect(asked).toBe(1)
    expect(session.held()).toBe(false)
    expect(volume()).toBeGreaterThan(was)
  })

  it('a read of the part between deferred changes builds what they held', async () => {
    await hump()
    await runCommand('reverse.feature.update', { feature: 'Station 9', set: { offset: 48 } }, undefined, undefined, true)
    expect(session.held()).toBe(true)
    const listed = await run<{ bodies: { volume: number }[] }>('reverse.build')
    expect(session.held()).toBe(false)
    expect(listed.bodies[0].volume).toBeCloseTo(volume(), 6)
  })
})
