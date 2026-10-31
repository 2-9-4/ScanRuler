// SPDX-License-Identifier: AGPL-3.0-only
// A shadow section through the commands: extracted by name as its block, a
// cut section refused for it, and a sketch added on the shadow starting
// with its outline. In the kernel in this thread, with no scan — the
// section put in the store as 3D Measure would have taken it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../../src/state/store'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import type { SketchFeature } from '../core/features'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'
import { XY } from './reKit'

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

type Answer = { result?: { status: string; message?: string }; bodies: { changed?: { volume: number }[] } }

/** A 30 × 10 shadow with a Ø4 hole, 6 mm thick. */
const shadow = {
  loops: [
    {
      hole: false,
      pieces: [
        { kind: 'line', from: [0, 0], to: [30, 0] },
        { kind: 'line', from: [30, 0], to: [30, 10] },
        { kind: 'line', from: [30, 10], to: [0, 10] },
        { kind: 'line', from: [0, 10], to: [0, 0] },
      ],
    },
    { hole: true, pieces: [{ kind: 'circle', center: [15, 5], radius: 2 }] },
  ],
  area: 300 - Math.PI * 4,
  play: 1,
  tolerance: 0.1,
  smoothDeg: 0,
  margin: { min: 1, max: 1.1 },
  cell: 0.05,
  widened: false,
  extent: { min: 0, max: 6 },
  frame: XY,
}
const cut = (s?: object) => ({ points: new Float32Array(0), offsets: new Uint32Array(1), normals: new Float32Array(0), ...(s ? { shadow: s } : {}) })

describe('a shadow section through the commands', () => {
  it('extracts a shadow by name as its block, refuses a cut, and sketches on one with its outline in', async () => {
    useStore.setState({
      sections: [
        { id: 41, name: 'Outline', color: '#f80', visible: true, kind: 'shadow', frame: XY, ref: null, offset: 0, cut: cut(shadow) },
        { id: 42, name: 'Plan', color: '#08f', visible: true, frame: XY, ref: null, offset: 0, cut: cut() },
      ] as unknown as ReturnType<typeof useStore.getState>['sections'],
    })
    const block = await run<Answer>('reverse.feature.add', { feature: { kind: 'extract', name: 'Insert', section: 'Outline' } })
    expect(block.result?.status, block.result?.message).toBe('ok')
    expect(block.bodies.changed![0].volume).toBeCloseTo((300 - Math.PI * 4) * 6, 1)
    expect((useReverse.getState().features.find((f) => f.name === 'Insert') as { section?: number }).section).toBe(41)

    expect((await refused('reverse.feature.add', { feature: { kind: 'extract', section: 'Plan' } })).message).toMatch(/Plan is a cut/)
    expect((await refused('reverse.feature.add', { feature: { kind: 'extract', element: 1, section: 'Outline' } })).message).toMatch(/not both/)

    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'On the shadow', plane: { kind: 'section', name: 'Outline' }, sketch: {} } })
    const sketch = useReverse.getState().features.find((f): f is SketchFeature => f.kind === 'sketch' && f.name === 'On the shadow')!
    expect(sketch.sketch.entities.map((e) => e.kind).sort()).toEqual(['circle', 'line', 'line', 'line', 'line'])
    // A piece handed in by id keeps it, the outline's ids past it; project:
    // false leaves the outline out.
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'With a pin', plane: { kind: 'section', name: 'Outline' }, sketch: { entities: [{ id: 1, kind: 'circle', c: [5, 5], r: 1 }] } } })
    const pinned = useReverse.getState().features.find((f): f is SketchFeature => f.kind === 'sketch' && f.name === 'With a pin')!
    expect(pinned.sketch.entities.length).toBe(6)
    expect(pinned.sketch.entities.find((e) => e.id === 1)).toMatchObject({ kind: 'circle', r: 1 })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Bare', plane: { kind: 'section', name: 'Outline' }, sketch: { entities: [{ kind: 'circle', c: [5, 5], r: 1 }], project: false } } })
    expect(useReverse.getState().features.find((f): f is SketchFeature => f.kind === 'sketch' && f.name === 'Bare')!.sketch.entities.length).toBe(1)
    useStore.setState({ sections: [] })
  })
})
