// SPDX-License-Identifier: AGPL-3.0-only
// The display units are the screen's, not the agent's: session.state says
// which the person sees under ui.units, and every figure in it and in the
// answers stays millimetres when the screen shows inches. On a 40 mm box,
// in the in-process worker — see commandKit.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { usePrefs } from '../src/state/prefsStore'
import { boxMesh } from './helpers'
import { run, startHeadless, stlBytes, type Headless } from './commandKit'

const BOX = stlBytes(boxMesh(40, 40))

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
  await run('scan.open', { bytes: BOX, name: 'box.stl', discard: true })
})
afterAll(() => headless.stop())
afterEach(() => usePrefs.getState().setUnits('mm'))

type State = {
  ui: { units: string }
  scan: { bounds: { min: number[]; max: number[] } }
  dimensions: { value: number | null; label: string }[]
}

describe('the display units in the agent’s readout', () => {
  it('says what the screen shows lengths in', async () => {
    expect((await run<State>('session.state')).ui).toEqual({ units: 'mm' })
    usePrefs.getState().setUnits('in')
    expect((await run<State>('session.state')).ui).toEqual({ units: 'in' })
  })

  it('answers in millimetres while the screen shows inches', async () => {
    await run('element.fit', { kind: 'plane', at: { point: [0, 0, 20] } })
    await run('element.fit', { kind: 'plane', at: { point: [0, 0, -20] } })
    await run('dimension.add', { refs: ['Plane 1', 'Plane 2'] })
    const inMm = await run<State>('session.state')
    usePrefs.getState().setUnits('in')
    const inIn = await run<State>('session.state')
    const { min, max } = inIn.scan.bounds
    expect(max[2] - min[2]).toBeCloseTo(40, 3)
    expect(inIn.dimensions[0].value).toBeCloseTo(40, 3)
    expect(inIn.dimensions).toEqual(inMm.dimensions)
  })
})
