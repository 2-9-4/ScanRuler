// SPDX-License-Identifier: AGPL-3.0-only
// Edges on a curved face: a Ø6 bore down through the top of an R40 drum,
// its rim chamfered C1 — the shield's holes on the lamp. The rim where the
// bore meets the drum is no circle: a coaxial pick takes it as the edges
// round the bore's face (not its seam), and a chamfer read across it is
// read against the drum's tangent at the corner, over a reach short
// enough for the drum to stay within 0.05 mm of it — the reader took a
// chamfer between straight traces only, and the drum's is an arc.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 300_000 })

type A = Record<string, any>

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

/** The drum: R40 along y, 30 long; the bore Ø6 down z from its top to
 *  z 5. */
async function drum() {
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Drum sk', plane: { kind: 'world', axis: 'y', offset: -15 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 1 }] } }, detail: 'none' })
  // The drum's axis through (0, −15, −30): where that lies in the sketch.
  const fr = (useReverse.getState().features.find((x) => x.name === 'Drum sk') as A).frame
  const d = [0, -15, -30].map((x, k) => x - fr.origin[k])
  const uv = [d[0] * fr.basisU[0] + d[1] * fr.basisU[1] + d[2] * fr.basisU[2], d[0] * fr.basisV[0] + d[1] * fr.basisV[1] + d[2] * fr.basisV[2]]
  await run('reverse.sketch.edit', { sketch: 'Drum sk', remove: { pieces: [1] }, add: { entities: [{ kind: 'circle', c: uv, r: 40 }] } })
  await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Drum', sketchId: 'Drum sk', regions: 'all', extent: { kind: 'distance', from: 0, to: 30 }, op: 'new' }, detail: 'none' })
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Bore sk', plane: { kind: 'world', axis: 'z', offset: 20 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 3 }] } }, detail: 'none' })
  await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Bore', sketchId: 'Bore sk', regions: 'all', extent: { kind: 'distance', from: 0, to: -15 }, op: 'cut' }, detail: 'none' })
  await session.settled()
}

describe('edges on a curved face', () => {
  it('coaxial takes the bore’s rims, where it meets the drum too, and not its seam', async () => {
    await drum()
    const d = await run<A>('reverse.body.describe', { body: 'Drum', where: { coaxial: { at: [0, 0, 0], dir: [0, 0, 1] } } })
    const edges = d.bodies[0].edgeList as A[]
    // The top rim, on the drum, in the pieces the drum's and the bore's
    // seams cut it in — all the way round — and the bottom's circle.
    const rim = edges.filter((e) => e.kind !== 'circle')
    expect(rim.length).toBeGreaterThan(0)
    expect(rim.reduce((s, e) => s + e.length, 0)).toBeCloseTo(6 * Math.PI, 1)
    expect(rim.every((e) => e.mid[2] > 9)).toBe(true)
    expect(edges.filter((e) => e.kind === 'circle').map((e) => e.radius)).toEqual([3])
    expect(edges.some((e) => e.kind === 'line')).toBe(false)
  })

  it('reads the rim’s C1 against the drum’s tangent, within 0.05', async () => {
    await drum()
    // The scan: the same part with the rim chamfered C1, the model's mesh.
    const top = { box: { min: [-4, -4, 9], max: [4, 4, 11] } }
    await run('reverse.feature.add', { feature: { kind: 'chamfer', name: 'C1', body: 'Drum', edges: [top], distance: 1 } })
    await session.settled()
    const m = session.meshes.get(useReverse.getState().bodies[0].id)!
    const soup = new Float32Array(m.indices.length * 3)
    for (let i = 0; i < m.indices.length; i++) for (let k = 0; k < 3; k++) soup[i * 3 + k] = m.positions[m.indices[i] * 3 + k]
    await run('scan.open', { bytes: stlBytes(soup), name: 'drum.stl', discard: true })
    await run('reverse.feature.update', { feature: 'C1', set: { suppressed: true } })
    await session.settled()
    const read = await run<A>('reverse.body.fillet_read', { body: 'Drum', edges: [{ ...top, minLength: 5 }], shape: 'chamfer' })
    const rim = read.edges.find((e: A) => e.mid[2] > 9)
    expect(rim.chamfer).toBe(true)
    expect(Math.abs(rim.distance - 1)).toBeLessThanOrEqual(0.05)
    expect(rim.nominal).toBe(1)
  })
})
