// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.volume_compare on the 40 mm box scan: a body built 10 mm
// short reads the top slab as missing, a lump of about its volume, named by
// the body's top face and the extrude that made it; one built 6 mm tall
// reads it as excess. In the in-process worker, the kernel in this thread —
// as reCommandsScan.test.ts runs them.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec3 = [number, number, number]
type Volume = {
  bodies: { id: number; name: string }[]
  cell: number
  modelVolume: number
  totals: Record<'excess' | 'missing' | 'unsure', { volume: number; share: number }>
  regions: { kind: string; volume: number; maxDepth: number; shape: string; box: { min: Vec3; max: Vec3 }; body: { id: number; name: string } | null; face: { index: number; kind: string; madeBy: { id: number; name: string | null } } | null }[]
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

/** A box body 40 mm across, its bottom on the scan's, `height` tall. */
async function boxBody(height: number) {
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plate', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } } })
  await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plate', regions: 'all', extent: { kind: 'distance', from: 0, to: height }, op: 'new' } })
}

describe('reverse.body.volume_compare', () => {
  it('reads a body built short as material missing, named by the face and the feature', async () => {
    await boxBody(30)
    const v = await run<Volume>('reverse.body.volume_compare', { cell: 1 })
    expect(v.bodies).toHaveLength(1)
    const r = v.regions[0]
    expect(r.kind).toBe('missing')
    // The top 10 mm of the box: 16 000 mm³.
    expect(r.volume).toBeGreaterThan(16_000 * 0.85)
    expect(r.volume).toBeLessThan(16_000 * 1.15)
    expect(r.shape).toBe('lump')
    expect(r.maxDepth).toBeGreaterThan(4)
    expect(r.box.min[2]).toBeGreaterThan(9)
    expect(r.face?.madeBy.name).toBe('Block')
    expect(r.face?.kind).toBe('plane')
    expect(v.totals.excess.volume).toBeLessThan(100)
  })

  it('reads a body built tall as excess', async () => {
    await boxBody(46)
    const v = await run<Volume>('reverse.body.volume_compare', { cell: 1, kinds: ['excess'] })
    expect(v.regions[0].kind).toBe('excess')
    expect(v.regions[0].volume).toBeGreaterThan(9_600 * 0.85)
    expect(v.regions[0].volume).toBeLessThan(9_600 * 1.15)
    expect((await refused('reverse.body.volume_compare', { within: { min: [0, 0, 0], max: [0, 1, 1] } })).code).toBe('invalid_input')
  })
})
