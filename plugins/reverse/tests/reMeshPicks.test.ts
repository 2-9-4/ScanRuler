// SPDX-License-Identifier: AGPL-3.0-only
// Picks for a model rebuilt from a CAD-exported STL, where the agent reads
// each chamfer's and round's edge off the mesh as a point on it: an edge
// by a point anywhere along it (through), picks that may name nothing
// (optional), a round or chamfer that does what it can and says where it
// could not (skipFailing), and a failed one's places in its answer.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

interface Brief {
  feature: { id: number; name: string; status?: string; message?: string }
  result: { status: string; message?: string; note?: string; edges?: unknown[] } | null
  picked?: Record<string, unknown>[]
  failed?: { name: string; message: string; at?: number[][] }[]
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

const rect = (name: string, z: number, center: [number, number], size: [number, number]) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z', offset: z }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center, size, fixed: true }] } })
const extrude = (name: string, sketch: string, from: number, to: number, op = 'join') => ({ kind: 'extrude', name, sketchId: sketch, regions: 'all', extent: { kind: 'distance', from, to }, op })

/** A 20 x 20 x 10 block standing on a 40 x 40 x 1 plate. */
async function blockOnPlate() {
  await run('reverse.feature.add', { feature: rect('Plate plan', 0, [0, 0], [40, 40]) })
  const plate = await run<Brief>('reverse.feature.add', { feature: extrude('Plate', 'Plate plan', 0, 1, 'new') })
  expect(plate.result?.status, plate.result?.message).toBe('ok')
  await run('reverse.feature.add', { feature: rect('Block plan', 1, [0, 0], [20, 20]) })
  const block = await run<Brief>('reverse.feature.add', { feature: extrude('Block', 'Block plan', 0, 10) })
  expect(block.result?.status, block.result?.message).toBe('ok')
}

describe('picks read off a mesh', () => {
  it('takes an edge by a point anywhere along it, and lets an optional pick miss', async () => {
    await blockOnPlate()
    // The block's top front edge runs x -10..10 at y = -10, z = 11: a point
    // a quarter of the way along it, nowhere near its middle.
    const c = await run<Brief>('reverse.feature.add', {
      feature: {
        kind: 'chamfer', name: 'Top front', body: 'Plate', distance: 1, chain: false,
        edges: [{ through: { at: [-5, -10, 11] } }, { through: { at: [3, 3, 3] }, optional: true }],
      },
    })
    expect(c.result?.status, c.result?.message).toBe('ok')
    expect(c.result?.edges).toHaveLength(1)
    expect(c.picked?.some((p) => p.missed !== undefined)).toBe(true)
  })

  it('says so when every pick is optional and none names an edge', async () => {
    await blockOnPlate()
    await expect(run('reverse.feature.add', { feature: { kind: 'chamfer', body: 'Plate', distance: 1, edges: [{ through: { at: [3, 3, 3] }, optional: true }] } }))
      .rejects.toThrow(/None of the 1 edge picks/)
  })

  it('bevels what it can with skipFailing and says where it could not; without, fails saying where', async () => {
    await blockOnPlate()
    // The block's top edge takes 3 mm; the plate's 1 mm thick rim does not.
    const edges = [{ through: { at: [0, -10, 11] } }, { through: { at: [0, -20, 1] } }]
    const strict = await run<Brief>('reverse.feature.add', { feature: { kind: 'chamfer', name: 'Strict', body: 'Plate', distance: 3, chain: false, edges } })
    expect(strict.result?.status).toBe('failed')
    const where = strict.failed?.find((f) => f.name === 'Strict')?.at ?? []
    expect(where.length).toBeGreaterThan(0)
    expect(where.some((p) => Math.abs(p[1] + 20) < 1e-3 && Math.abs(p[2] - 1) < 1e-3)).toBe(true)
    await run('reverse.feature.remove', { feature: 'Strict' })
    const lenient = await run<Brief>('reverse.feature.add', { feature: { kind: 'chamfer', name: 'Lenient', body: 'Plate', distance: 3, chain: false, skipFailing: true, edges } })
    expect(lenient.result?.status, lenient.result?.message).toBe('ok')
    expect(lenient.result?.note).toMatch(/1 of the 2 chains left out/)
    expect(lenient.result?.edges).toHaveLength(1)
  })
})
