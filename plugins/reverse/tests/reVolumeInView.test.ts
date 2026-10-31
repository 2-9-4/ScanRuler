// SPDX-License-Identifier: AGPL-3.0-only
// The volume compare kept in view: reverse.body.compare and
// compare_in_deviation carry the last volume compare beside their own
// reading — that none was run yet; its totals and largest region while the
// bodies are as it found them; and, once the body changed, since which
// step it was not run and what it said then. On the 40 mm box scan, as
// reVolumeCompare.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installCompareInDeviation, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Kept = { at: string; excess: { volume: number; share: number }; missing: { volume: number; share: number }; largest: { kind: string; volume: number; face?: { madeBy: string | null } }[] }

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box-in-view.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

describe('the volume compare kept in view', () => {
  it('a compare says none was run, then carries its totals, then says since which step it is owed', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plate', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plate', regions: 'all', extent: { kind: 'distance', from: 0, to: 30 }, op: 'new' } })
    const first = await run<{ volume: unknown }>('reverse.body.compare')
    expect(first.volume).toMatch(/^not compared yet — reverse\.body\.volume_compare/)

    const v = await run<{ totals: { excess: { volume: number }; missing: { volume: number } } }>('reverse.body.volume_compare', { cell: 1 })
    const kept = (await run<{ volume: Kept }>('reverse.body.compare')).volume
    expect(kept.at).toBe('step 2, Block')
    expect(kept.missing.volume).toBe(v.totals.missing.volume)
    expect(kept.excess.volume).toBe(v.totals.excess.volume)
    expect(kept.largest[0]).toMatchObject({ kind: 'missing', face: { madeBy: 'Block' } })
    expect(kept.largest[0].volume).toBeGreaterThan(16_000 * 0.85)

    // compare_in_deviation carries it too.
    const stop = installCompareInDeviation(async () => {})
    try {
      const inDeviation = await run<{ volume: Kept }>('reverse.body.compare_in_deviation', { ways: 'scan' })
      expect(inDeviation.volume).toMatchObject({ at: 'step 2, Block', missing: { volume: v.totals.missing.volume } })
    } finally {
      stop()
    }

    // The block made taller: the volume compare is owed, and says what it
    // read then.
    await run('reverse.feature.update', { feature: 'Block', set: { extent: { kind: 'distance', from: 0, to: 40 } } })
    const owed = (await run<{ volume: string }>('reverse.body.compare')).volume
    expect(owed).toBe(`volume not compared since step 2, Block (excess ${v.totals.excess.volume} / missing ${v.totals.missing.volume} mm³ then) — reverse.body.volume_compare`)
  })
})
