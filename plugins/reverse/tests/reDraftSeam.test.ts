// SPDX-License-Identifier: AGPL-3.0-only
// Two things the third fan's run laid at the kernel's door, as the kernel has
// them: a taper through the sketch plane is two faces a side, said; two lines
// end to end in a revolved profile are two faces, said, and stay two through a
// revolve. Whether either stops a round is the shape's: on a plain blade
// across a cone, 2026-10-30 (occt-wasm 5.7.1), R 0.8 to 2 — two ways from z −6
// rounded at all four, one way from z +12 at two, from z +18 at none.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { boxMesh } from '../../../tests/helpers'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 180_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box-seam.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})

const radial = { kind: 'radial', axis: { kind: 'world', axis: 'z' }, angleDeg: 0 }
const dishOf = (top: unknown[]) => ({
  kind: 'sketch',
  name: 'Dish profile',
  plane: radial,
  sketch: {
    entities: [
      ...top,
      { kind: 'line', id: 2, a: [70, -15], b: [70, -18] },
      { kind: 'line', id: 3, a: [70, -18], b: [30, 2] },
      { kind: 'line', id: 4, a: [30, 2], b: [30, 5] },
    ],
  },
})
const dish = { kind: 'revolve', name: 'Dish', sketchId: 'Dish profile', regions: 'all', axis: { kind: 'world', axis: 'z' }, angleDeg: 360, op: 'new' }

const facesOf = async (body: string) => (await run<{ bodies: { of: { faces: number } }[] }>('reverse.body.describe', { body, edges: false })).bodies[0].of.faces

describe('a taper through the sketch plane', () => {
  it('is two faces a side, and one extrude is one', async () => {
    const blade = async (at: number, from: number, to: number) => {
      await run('reverse.feature.clear', {})
      await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plan', plane: { kind: 'world', axis: 'z', offset: at }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [50, 0], size: [30, 3], fixed: true }] } } })
      const made = await run<{ draftBothWays?: string }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Blade', sketchId: 'Plan', regions: 'all', extent: { kind: 'distance', from, to }, draftDeg: -3, op: 'new' } })
      return { said: made.draftBothWays, faces: await facesOf('Blade') }
    }
    const one = await blade(12, 0, -30)
    expect(one).toEqual({ said: undefined, faces: 6 })
    const two = await blade(-6, -18, 8)
    expect(two.said).toMatch(/two faces meeting at that plane/)
    expect(two.faces).toBe(10)
  })
})

describe('two lines end to end in a revolved profile', () => {
  it('are said, and are two faces where one line is one', async () => {
    await run('reverse.feature.clear', {})
    await run('reverse.feature.add', { feature: dishOf([{ kind: 'line', id: 1, a: [30, 5], b: [70, -15] }]) })
    await run('reverse.feature.add', { feature: dish })
    const whole = await facesOf('Dish')

    await run('reverse.feature.clear', {})
    const split = await run<{ collinearPieces?: { pieces: number[]; at: number[] }[]; collinearFix?: string }>('reverse.feature.add', { feature: dishOf([{ kind: 'line', id: 1, a: [30, 5], b: [50, -5] }, { kind: 'line', id: 5, a: [50, -5], b: [70, -15] }]) })
    expect(split.collinearPieces).toEqual([{ pieces: [1, 5], at: [50, -5] }])
    expect(split.collinearFix).toMatch(/Draw one line/)
    await run('reverse.feature.add', { feature: dish })
    expect(await facesOf('Dish')).toBe(whole + 1)
    // Said once: an edit of its name says nothing of it again.
    expect((await run<{ collinearPieces?: unknown }>('reverse.feature.update', { feature: 'Dish profile', set: { name: 'Dish profile 2' } })).collinearPieces).toBeUndefined()
  })
})
