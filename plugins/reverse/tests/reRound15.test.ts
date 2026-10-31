// SPDX-License-Identifier: AGPL-3.0-only
// Round 15's water pump, through the commands: a pattern named in a boolean
// takes the original and every copy (the copies carry the pattern's ids, so
// going by the maker took one copy and answered ok), and named anywhere
// else is refused with every piece listed.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

interface Brief {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string; took?: number } | null
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

describe('a pattern named in a boolean', () => {
  it('joins the original blade and every copy to the hub, and refuses a fillet naming every piece', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Hub plan', plane: 'XY', sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 10 }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Hub', sketchId: 'Hub plan', extent: { kind: 'distance', from: 0, to: 6 }, op: 'new' } })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Blade plan', plane: 'XY', sketch: { shapes: [{ kind: 'rectangle', center: [14, 0], size: [12, 2] }] } } })
    const blade = await run<Brief>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Blade', sketchId: 'Blade plan', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' } })
    const pattern = await run<Brief>('reverse.feature.add', { feature: { kind: 'pattern', name: 'Blades', body: 'Blade', mode: 'circular', axis: { kind: 'world', axis: 'z' }, count: 7, step: 360 } })
    expect(pattern.result?.status).toBe('ok')
    const pieces = useReverse.getState().bodies.length - 1
    expect(pieces).toBe(7)

    // Anywhere but a boolean the pattern is refused, with the original's
    // id and every piece.
    const fillet = await refused('reverse.feature.add', { feature: { kind: 'fillet', body: 'Blades', edges: [0], radius: 0.3 } })
    expect(fillet.message).toMatch(new RegExp(`Blades is ${pieces} bodies — give ${blade.feature.id} for all its pieces in a boolean, or one of: `))
    expect(fillet.message.split(' or one of: ')[1].split('), ')).toHaveLength(pieces)

    const join = await run<Brief>('reverse.feature.add', { feature: { kind: 'boolean', name: 'Blades on', op: 'join', body: 'Hub', tool: 'Blades' } })
    expect(join.result?.status).toBe('ok')
    expect(join.result?.took).toBe(pieces)
    const bodies = useReverse.getState().bodies
    expect(bodies).toHaveLength(1)
    // The hub and each blade where it stands outside it: x 8…20 at y ±1,
    // about 2 mm of it inside r 10.
    const outside = (20 - Math.sqrt(99)) * 2 * 4
    expect(bodies[0].volume).toBeCloseTo(Math.PI * 100 * 6 + pieces * outside, -1)
  })
})
