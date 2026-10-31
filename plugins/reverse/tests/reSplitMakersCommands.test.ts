// SPDX-License-Identifier: AGPL-3.0-only
// A split's faces through the commands: a box split by a sheet keeps the
// faces the split cut through as its extrude's, so a madeBy pick of the
// extrude still finds them; and a madeBy pick that finds nothing — every
// face made anew by an offset since — says who made the faces there are,
// and which feature took the named one's over. On a 40 mm box scanned in
// the in-process worker, the kernel in this thread.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

interface Brief { result: { status: string; message?: string } | null }
interface Described { bodies: { faceList: { index: number; madeBy: { id: number; name: string | null } }[] }[] }

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

const add = async (feature: Record<string, unknown>) => {
  const r = await run<Brief>('reverse.feature.add', { feature })
  if (feature.kind !== 'sketch') expect(r.result?.status, r.result?.message).toBe('ok')
}

describe('a split’s faces through the commands', () => {
  it('keeps the extrude’s faces the split cut through, and says who took them over where a madeBy finds none', async () => {
    await add({ kind: 'sketch', name: 'Plan', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [20, 20], fixed: true }] } })
    await add({ kind: 'extrude', name: 'Raw', sketchId: 'Plan', regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' })
    await add({ kind: 'sketch', name: 'Cut line', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { entities: [{ id: 1, kind: 'line', a: [4, -30], b: [4, 30], fixed: true }] } })
    await add({ kind: 'sheet', name: 'Cut sheet', sketchId: 'Cut line', from: -5, to: 15 })
    await add({ kind: 'split', name: 'Behind', body: 'Raw', tools: ['Cut sheet'], keep: 'largest' })
    const faces = (await run<Described>('reverse.body.describe', { body: 'Raw', edges: false })).bodies[0].faceList
    expect(faces.filter((f) => f.madeBy.name === 'Raw')).toHaveLength(5)
    expect(faces.filter((f) => f.madeBy.name === 'Behind')).toHaveLength(1)
    // Every face made anew: the extrude made none of them now.
    await add({ kind: 'offsetBody', name: 'Grown', body: 'Raw', distance: 1, keep: false })
    const e = await refused('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body: 'Raw', edges: [{ sides: { madeBy: ['Raw', 'Behind'] } }], radius: 0.5 } })
    expect(e.code).toBe('not_found')
    expect(e.message).toMatch(/ — Raw and Behind made none of Solid 1’s faces as it stands: they are Grown’s \(\d+\)\. Raw’s faces are Grown’s since the offset\. Behind’s faces are Grown’s since the offset\. reverse\.body\.describe/)
  })
})
