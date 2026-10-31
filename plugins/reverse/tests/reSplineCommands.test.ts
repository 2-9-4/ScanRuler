// SPDX-License-Identifier: AGPL-3.0-only
// A spline through the commands, as an agent writes one: a sketch with a
// spline between two upright sides, held tangent where it meets them,
// extruded into a closed body; a fit point named by its place; and the
// tangent that has no joint to hold it refused, saying what it needs.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import type { SketchFeature } from '../core/features'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
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

/** A block 40 wide with a crowned top: two upright sides and a base, the
 *  top a spline from the right side's top to the left's. */
const crowned = (tangent: boolean) => ({
  kind: 'sketch',
  name: 'Crown',
  plane: { kind: 'world', axis: 'z' },
  sketch: {
    entities: [
      { id: 1, kind: 'line', a: [0, 0], b: [40, 0] },
      { id: 2, kind: 'line', a: [40, 0], b: [40, 15] },
      { id: 3, kind: 'spline', pts: [[40, 15], [28, 24], [12, 22], [0, 15]] },
      { id: 4, kind: 'line', a: [0, 15], b: [0, 0] },
    ],
    constraints: [
      { kind: 'coincident', p: { entity: 1, at: 'b' }, q: { entity: 2, at: 'a' } },
      { kind: 'coincident', p: { entity: 2, at: 'b' }, q: { entity: 3, at: 'a' } },
      { kind: 'coincident', p: { entity: 3, at: 'b' }, q: { entity: 4, at: 'a' } },
      { kind: 'coincident', p: { entity: 4, at: 'b' }, q: { entity: 1, at: 'a' } },
      { kind: 'distance', p: { entity: 3, at: 'p1' }, q: { datum: 'zx' }, value: 25 },
      ...(tangent ? [{ kind: 'tangent', a: 2, b: 3 }, { kind: 'tangent', a: 4, b: 3 }] : []),
    ],
  },
})

describe('a spline through the commands', () => {
  it('a crowned block: the spline tangent to its sides, a fit point dimensioned, extruded closed', async () => {
    await run('reverse.feature.add', { feature: crowned(true) })
    const sketch = useReverse.getState().features.find((f): f is SketchFeature => f.kind === 'sketch')!
    const top = sketch.sketch.entities.find((e) => e.kind === 'spline')
    expect(top?.kind).toBe('spline')
    if (top?.kind !== 'spline') return
    // Held square to the base where it leaves the right side: running up.
    expect(top.startDir).toBeDefined()
    expect(Math.abs(Math.cos(top.startDir!))).toBeLessThan(1e-6)
    expect(top.pts[1][1]).toBeCloseTo(25, 6)
    const made = await run<{ bodies: { count: number; changed?: { closed: boolean; volume: number }[] } }>('reverse.feature.add', { feature: { kind: 'extrude', sketchId: 'Crown', extent: { kind: 'distance', from: 0, to: 8 } } })
    expect(made.bodies.changed?.[0].closed).toBe(true)
    expect(made.bodies.changed![0].volume).toBeGreaterThan(40 * 15 * 8)
  })

  it('refuses a tangent with no joint to hold it at', async () => {
    const loose = crowned(false)
    loose.sketch.constraints = loose.sketch.constraints.filter((c) => !(c.kind === 'coincident' && c.q?.entity === 3))
    loose.sketch.constraints.push({ kind: 'tangent', a: 2, b: 3 } as never)
    expect((await refused('reverse.feature.add', { feature: loose })).message).toMatch(/held tangent where one of its ends/)
  })

  it('refuses a fit point the spline does not have', async () => {
    const wrong = crowned(true)
    wrong.sketch.constraints.push({ kind: 'distance', p: { entity: 3, at: 'p7' }, q: { datum: 'zx' }, value: 25 } as never)
    expect((await refused('reverse.feature.add', { feature: wrong })).message).toMatch(/has no point “p7” — it has a, b, p1, p2/)
  })
})
