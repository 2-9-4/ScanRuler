// SPDX-License-Identifier: AGPL-3.0-only
// A STEP file imported and its part put in place through the commands, as
// an agent does it: a block written out as a STEP file under its body's
// name, read back as a body of that name, turned and carried by a Move
// whose distance a parameter drives, copied beside itself, and the copy
// undone. The kernel runs in this thread through the worker's own service.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'

type Vec3 = [number, number, number]
interface Body { id: number; name: string; volume: number; bounds: { min: Vec3; max: Vec3; size: Vec3 } }
interface Brief { feature: { id: number; name: string; kind: string; status: string }; result: { status: string; message?: string } | null; bodies: { count: number; changed?: Body[] } }

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

/** A 20 × 10 × 5 block at the origin, as a STEP file whose part is named
 *  Bracket. */
async function bracketStep(): Promise<Uint8Array> {
  await run('reverse.feature.add', {
    features: [
      { kind: 'sketch', name: 'Outline', plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [0, 0], to: [20, 10], fixed: true }] } },
      { kind: 'extrude', sketchId: 'Outline', extent: { kind: 'distance', from: 0, to: 5 }, op: 'new' },
    ],
  })
  await run('reverse.body.set', { body: 'Solid 1', name: 'Bracket' })
  const step = await run<{ file: { bytes: Uint8Array } }>('reverse.export.step')
  await run('reverse.feature.clear')
  return step.file.bytes
}

describe('a STEP file imported and moved through the commands', () => {
  it('reads the part in under its name, moves it by a parameter, copies it and undoes the copy', async () => {
    const bytes = await bracketStep()
    const imported = await run<Brief>('reverse.import.step', { bytes, name: 'bracket.step' })
    expect(imported.feature).toMatchObject({ kind: 'import', name: 'bracket', status: 'ok' })
    expect(imported.bodies.changed?.map((b) => b.name)).toEqual(['Bracket'])
    expect(imported.bodies.changed?.[0].volume).toBeCloseTo(1000, 3)

    await run('reverse.parameter.add', { name: 'shift', expression: '25' })
    const moved = await run<Brief>('reverse.feature.add', { feature: { kind: 'moveBody', bodies: ['Bracket'], translate: [0, 0, 0], rotate: [0, 0, 90], exprs: { 'translate.x': 'shift' } } })
    expect(moved.feature).toMatchObject({ kind: 'moveBody', status: 'ok' })
    // Turned a quarter about Z through its middle (10, 5, 2.5) — 10 wide
    // in X, 20 in Y — then 25 along X.
    const at = (b: Body) => [...b.bounds.min, ...b.bounds.max].map((v) => Math.round(v * 1000) / 1000)
    expect(at(moved.bodies.changed![0])).toEqual([30, -5, 0, 40, 15, 5])

    await run('reverse.parameter.set', { parameter: 'shift', expression: '40' })
    const list = await run<{ bodies: Body[] }>('reverse.build')
    expect(at(list.bodies.find((b) => b.name === 'Bracket')!)).toEqual([45, -5, 0, 55, 15, 5])

    const copied = await run<Brief>('reverse.feature.add', { feature: { kind: 'moveBody', bodies: ['Bracket'], translate: [0, 30, 0], copy: true } })
    expect(copied.bodies.changed?.map((b) => b.name)).toEqual(['Bracket (2)'])
    expect(useReverse.getState().bodies.map((b) => b.name)).toEqual(['Bracket', 'Bracket (2)'])
    await run('history.undo')
    expect(useReverse.getState().bodies.map((b) => b.name)).toEqual(['Bracket'])

    // What the box would refuse, the command refuses with why.
    expect((await refused('reverse.feature.add', { feature: { kind: 'moveBody', bodies: ['Bracket'] } })).message).toMatch(/moves nothing/)
    expect((await refused('reverse.import.step', { bytes: new TextEncoder().encode('solid stl'), name: 'part.stl' })).message).toMatch(/not a STEP file/)
    expect((await refused('reverse.feature.add', { feature: { kind: 'import' } })).message).toMatch(/reverse.import.step/)
  }, 60_000)
})
