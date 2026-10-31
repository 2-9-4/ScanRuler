// SPDX-License-Identifier: AGPL-3.0-only
// Round 14's fridge bracket, through the commands: four snap tabs from one
// `new` extrude joined to the body by the extrude's name (a boolean takes
// every piece); a sketch whose fixed sides meet a hundredth apart closing a
// region (the ends snapped, fixed or not, in feature.add as in sketch.edit);
// and coordinate planes by name — "ZX", "YZ" — wherever a Reverse engineer
// plane is asked for.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec2 = [number, number]
interface Brief {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string } | null
  bodies: { count: number; changed?: { id: number; name: string; volume: number }[] }
  regions?: { at: Vec2; area: number }[]
  snapped?: { piece: number; at: string; to: { piece: number; at: string }; by: number; fixed?: true }[]
}

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

const rect = (center: Vec2, size: Vec2) => ({ kind: 'rectangle', center, size })

describe('a feature that made several bodies, named in a boolean', () => {
  it('joins all four tabs of one new extrude to the body by the extrude’s name', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plate plan', plane: 'XY', sketch: { shapes: [rect([0, 0], [40, 20])] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Plate', sketchId: 'Plate plan', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' } })
    // Four tabs standing on the plate's corners, apart from one another.
    const corners: Vec2[] = [[-16, -6], [16, -6], [16, 6], [-16, 6]]
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Tab plan', plane: 'XY', sketch: { shapes: corners.map((c) => rect(c, [4, 4])) } } })
    const tabs = await run<Brief>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Tabs', sketchId: 'Tab plan', regions: 'all', extent: { kind: 'distance', from: 2, to: 10 }, op: 'new' } })
    expect(tabs.result?.status).toBe('ok')
    expect(useReverse.getState().bodies).toHaveLength(5)

    // Elsewhere one of them is asked for, and the answer says how to take all.
    const fillet = await refused('reverse.feature.add', { feature: { kind: 'fillet', body: 'Tabs', edges: [0], radius: 0.5 } })
    expect(fillet.message).toMatch(new RegExp(`Tabs made 4 bodies — give ${tabs.feature.id} for all its pieces in a boolean, or one of: `))

    const join = await run<Brief>('reverse.feature.add', { feature: { kind: 'boolean', name: 'Tabs on', op: 'join', body: 'Plate', tool: 'Tabs' } })
    expect(join.result?.status).toBe('ok')
    const bodies = useReverse.getState().bodies
    expect(bodies).toHaveLength(1)
    // The plate and each tab's 6 mm above it.
    expect(bodies[0].volume).toBeCloseTo(40 * 20 * 4 + 4 * 4 * 4 * 6, 3)
  })
})

describe('ends a hair apart in a sketch added whole', () => {
  it('closes a region of fixed sides meeting 0.01 mm apart, and says what moved', async () => {
    const made = await run<Brief>('reverse.feature.add', {
      feature: {
        kind: 'sketch',
        name: 'Latch box',
        plane: { kind: 'world', axis: 'z' },
        sketch: {
          entities: [
            { id: 1, kind: 'line', a: [0, 0], b: [20, 0], fixed: true },
            { id: 2, kind: 'line', a: [20.01, 0], b: [20, 10], fixed: true },
            { id: 3, kind: 'line', a: [20, 10.01], b: [0, 10], fixed: true },
            { id: 4, kind: 'line', a: [0, 9.99], b: [0, 0.01], fixed: true },
          ],
        },
      },
    })
    expect(made.regions).toHaveLength(1)
    expect(made.regions![0].area).toBeCloseTo(200, 1)
    expect(made.snapped?.length).toBe(4)
    expect(made.snapped!.every((s) => s.fixed === true && s.by <= 0.05)).toBe(true)

    // The same sketch edited whole (feature.update) keeps it closed, and a
    // polyline repeating its first corner closes on it.
    const poly = await run<Brief>('reverse.feature.update', { feature: 'Latch box', set: { sketch: { shapes: [{ kind: 'polyline', points: [[0, 0], [20, 0], [20, 10], [0, 10], [0.02, 0.01]] }] } } })
    expect(poly.result?.status ?? 'ok').not.toBe('failed')
    const listed = await run<{ regions: { area: number }[]; sketch: { entities: { kind: string }[] } }>('reverse.feature.list', { feature: 'Latch box' })
    expect(listed.regions).toHaveLength(1)
    expect(listed.sketch.entities.filter((e) => e.kind === 'line')).toHaveLength(4)
  })
})

describe('coordinate planes by name', () => {
  it('takes "ZX", "XZ" and "YZ" as the world planes they are', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'On ZX', plane: 'ZX', sketch: { shapes: [rect([5, 5], [4, 4])] } } })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'On xz plane', plane: 'xz plane', sketch: { shapes: [rect([5, 5], [4, 4])] } } })
    const planes = useReverse.getState().features.filter((f) => f.kind === 'sketch').map((f) => (f as { plane: unknown }).plane)
    expect(planes).toEqual([
      { kind: 'world', axis: 'y', offset: 0 },
      { kind: 'world', axis: 'y', offset: 0 },
    ])
    const described = await run<{ plane: string }>('reverse.plane.describe', { plane: 'YZ' })
    expect(described.plane).toMatch(/YZ/)

    // A body mirrored across a plane by name.
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'On ZX', extent: { kind: 'distance', from: 0, to: 3 }, op: 'new' } })
    const mirrored = await run<Brief>('reverse.feature.add', { feature: { kind: 'mirror', name: 'Mirrored', body: 'Block', plane: 'YZ', join: false } })
    expect(mirrored.result?.status).toBe('ok')
    const mirror = useReverse.getState().features.find((f) => f.name === 'Mirrored') as unknown as { plane: unknown }
    expect(mirror.plane).toEqual({ kind: 'world', axis: 'x', offset: 0 })

    expect((await refused('reverse.feature.add', { feature: { kind: 'sketch', plane: 'QQ', sketch: { shapes: [rect([0, 0], [1, 1])] } } })).message).toMatch(/no coordinate plane/)
  })
})
