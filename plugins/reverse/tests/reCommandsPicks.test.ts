// SPDX-License-Identifier: AGPL-3.0-only
// Round 9 through the commands: picks by intent — exclude, a face's outer
// or inner loop, coaxial — and what each pick landed on told back; the
// comparison and the description sized to the question; where a feature's
// picture cuts it when it lies in several places; feature names kept apart;
// thread sizes as designations. On a 40 mm box scanned in the in-process
// worker, the kernel in this thread — as reCommandsScan.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { featureNamed } from '../app/reCommandCore'
import { featureCut } from '../app/reCompareFeature'
import { readDesignation } from '../app/reFeatureInput'
import { createReverseSession, installCompareInDeviation, installReverseSession, type ReverseSession } from '../app/reSession'
import { useDeviation } from '../../../src/state/deviationStore'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec3 = [number, number, number]
interface Body { id: number; name: string; closed: boolean; volume: number }
interface Brief { feature: { id: number; name: string; kind: string; pitch?: number; diameter?: number }; result: { status: string; message?: string } | null; bodies: { count: number; changed?: Body[] }; picked?: Record<string, unknown>[] }
interface Face { index: number; kind: string; radius?: number; centroid: Vec3; madeBy: { id: number; name: string | null } }
interface Edge { index: number; kind: string; length: number; radius?: number; mid: Vec3; faces: number[] }
interface Described { bodies: { matched: { faces: number; edges?: number }; of: { faces: number; edges?: number }; faceList: Face[]; edgeList?: Edge[] }[] }

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

const rectangle = (name: string, z: number, center: [number, number], size: [number, number]) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z', offset: z }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center, size, fixed: true }] } })

const extrude = (name: string, sketch: string, from: number, to: number, op = 'join') => ({ kind: 'extrude', name, sketchId: sketch, regions: 'all', extent: { kind: 'distance', from, to }, op })

const describeBody = (input: Record<string, unknown>) => run<Described>('reverse.body.describe', input)

/** A 20 × 20 × 10 block on the XY plane with a Ø6 bore down its middle. */
async function boredBlock() {
  await run('reverse.feature.add', { feature: rectangle('Plan', 0, [0, 0], [20, 20]) })
  const block = await run<Brief>('reverse.feature.add', { feature: extrude('Block', 'Plan', 0, 10, 'new') })
  expect(block.result?.status, block.result?.message).toBe('ok')
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Bore circle', plane: { kind: 'world', axis: 'z', offset: 10 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 3, fixed: true }] } } })
  const bore = await run<Brief>('reverse.feature.add', { feature: extrude('Bore', 'Bore circle', 0, -12, 'cut') })
  expect(bore.result?.status, bore.result?.message).toBe('ok')
  const top = (await describeBody({ body: 'Block', edges: false, where: { kind: 'plane', between: [[0, 0, 1]] } })).bodies[0].faceList
  expect(top).toHaveLength(1)
  return { top: top[0].index }
}

describe('picks by intent', () => {
  it('takes a face’s outer loop apart from its holes, leaves out what is excluded, and finds what lies on an axis', async () => {
    const { top } = await boredBlock()
    const edges = async (where: Record<string, unknown>) => (await describeBody({ body: 'Block', where })).bodies[0].edgeList!
    const outer = await edges({ faces: [top], loop: 'outer' })
    expect(outer).toHaveLength(4)
    expect(outer.every((e) => e.kind === 'line' && Math.abs(e.length - 20) < 1e-6)).toBe(true)
    const inner = await edges({ faces: [top], loop: 'inner' })
    expect(inner.length).toBeGreaterThan(0)
    expect(inner.every((e) => e.kind === 'circle' && Math.abs(e.radius! - 3) < 1e-6)).toBe(true)
    // One normal takes the rim and the bore's edges alike (a bore's axis
    // counts as its normal); exclude parts them.
    const round = await edges({ between: [[0, 0, 1]] })
    const ids = round.map((e) => e.index)
    expect([...outer, ...inner].every((e) => ids.includes(e.index))).toBe(true)
    const lines = await edges({ between: [[0, 0, 1]], exclude: { kind: 'circle' } })
    expect(lines).toHaveLength(round.filter((e) => e.kind !== 'circle').length)
    expect(lines.some((e) => e.kind === 'circle')).toBe(false)
    expect(await edges({ between: [[0, 0, 1]], exclude: [outer[0].index, outer[1].index] })).toHaveLength(round.length - 2)
    // Coaxial: the bore's circle edges, top and bottom, and its wall.
    const onAxis = (await describeBody({ body: 'Block', where: { coaxial: { at: [0, 0, 5], dir: [0, 0, -1] } } })).bodies[0]
    expect(onAxis.faceList.map((f) => f.kind)).toEqual(['cylinder'])
    expect(onAxis.edgeList!.length).toBeGreaterThanOrEqual(2)
    expect(onAxis.edgeList!.every((e) => e.kind === 'circle')).toBe(true)
    expect(new Set(onAxis.edgeList!.map((e) => Math.round(e.mid[2])))).toEqual(new Set([0, 10]))
    const offAxis = (await describeBody({ body: 'Block', where: { coaxial: { at: [0.5, 0, 0], dir: [0, 0, 1] } } })).bodies[0]
    expect(offAxis.matched).toEqual({ faces: 0, edges: 0 })
    expect((await describeBody({ body: 'Block', where: { coaxial: { at: [0.04, 0, 0], dir: [0, 0, 1] } } })).bodies[0].matched.faces).toBe(1)
    // A loop of a round face, of no face, or of faces: refused, saying why.
    const wall = onAxis.faceList[0].index
    expect((await refused('reverse.body.describe', { body: 'Block', where: { faces: [wall], loop: 'outer' } })).message).toMatch(/flat face’s boundary/)
    expect((await refused('reverse.body.describe', { body: 'Block', where: { loop: 'outer' } })).message).toMatch(/give that face alone/)
  })

  it('a change answer says what each pick by index or query landed on', async () => {
    const { top } = await boredBlock()
    const rim = await run<Brief>('reverse.feature.add', { feature: { kind: 'fillet', body: 'Block', edges: [{ faces: [top], loop: 'outer' }], radius: 1 } })
    expect(rim.result?.status, rim.result?.message).toBe('ok')
    expect(rim.picked).toHaveLength(1)
    expect(rim.picked![0]).toMatchObject({ where: true })
    expect(rim.picked![0].edges).toHaveLength(4)
    const bottom = (await describeBody({ body: 'Block', where: { kind: 'line', between: [[0, 0, -1], [1, 0, 0]] } })).bodies[0].edgeList![0]
    const one = await run<Brief>('reverse.feature.add', { feature: { kind: 'chamfer', body: 'Block', edges: [bottom.index], distance: 0.5, chain: false } })
    expect(one.result?.status, one.result?.message).toBe('ok')
    expect(one.picked).toEqual([{ edge: bottom.index, kind: 'line', length: 20, mid: bottom.mid.map((v) => Math.round(v * 1000) / 1000) }])
    // Nothing told with detail none.
    const none = await run<Record<string, unknown>>('reverse.feature.update', { feature: one.feature.id, set: { distance: 0.6 }, detail: 'none' })
    expect(none.picked).toBeUndefined()
  })

  it('takes a query wrapped in where as the query itself, and names the pick by its branch when it fits none', async () => {
    const { top } = await boredBlock()
    // Round 15: the guides wrote { where: { sides: … } } for an edge pick.
    const roots = await run<Brief>('reverse.feature.add', { feature: { kind: 'fillet', body: 'Block', edges: [{ where: { sides: { madeBy: ['Block', 'Bore'] } } }], radius: 0.5 } })
    expect(roots.result?.status, roots.result?.message).toBe('ok')
    expect(roots.picked![0]).toMatchObject({ where: true })
    expect(roots.picked![0].edges).toHaveLength(2)
    const open = await run<Brief>('reverse.feature.add', { feature: { kind: 'shell', body: 'Block', faces: [{ where: { faces: [top] }, optional: false }], thickness: 1 } })
    expect(open.result?.status, open.result?.message).toBe('ok')
    expect((await describeBody({ body: 'Block', edges: false, where: { where: { kind: 'cylinder' } } })).bodies[0].matched.faces).toBeGreaterThan(0)
    // A term both in where and beside it: refused, naming how a pick is written.
    const twice = await refused('reverse.feature.add', { feature: { kind: 'chamfer', body: 'Block', edges: [{ where: { kind: 'line' }, kind: 'circle' }], distance: 0.2 } })
    expect(twice.message).toMatch(/edges: \[\{ sides: \{ madeBy: \[\.\.\.\] \} \}\].*kind stands both in where and beside it/)
    // A misspelt where is refused as a query, not as an index it never was.
    const misspelt = await refused('reverse.feature.add', { feature: { kind: 'chamfer', body: 'Block', edges: [{ wher: { kind: 'line' } }], distance: 0.2 } })
    expect(misspelt.message).toMatch(/expected one of integer, fingerprint, where/)
    expect(misspelt.message).toMatch(/edges\[0\]\.wher: not a known field/)
    expect(misspelt.message).not.toMatch(/finite number/)
  })

  it('body.describe leaves a feature’s faces out by exclude', async () => {
    await boredBlock()
    const all = (await describeBody({ body: 'Block', edges: false })).bodies[0]
    const less = (await describeBody({ body: 'Block', edges: false, exclude: { madeBy: 'Bore' } })).bodies[0]
    expect(all.faceList.some((f) => f.madeBy.name === 'Bore')).toBe(true)
    expect(less.faceList.some((f) => f.madeBy.name === 'Bore')).toBe(false)
    expect(less.matched.faces).toBe(all.faceList.length - all.faceList.filter((f) => f.madeBy.name === 'Bore').length)
    expect(less.of.faces).toBe(all.of.faces)
  })
})

describe('the comparison sized to the question', () => {
  it('caps byFeature, worst first, and gives a patch’s vertices only on asking', async () => {
    await run('reverse.feature.add', { feature: rectangle('Box plan', -20, [0, 0], [38, 40]) })
    await run('reverse.feature.add', { feature: extrude('Box', 'Box plan', 0, 40, 'new') })
    await run('reverse.feature.add', { feature: rectangle('Pocket plan', 20, [0, 0], [10, 10]) })
    const pocket = await run<Brief>('reverse.feature.add', { feature: extrude('Pocket', 'Pocket plan', 0, -5, 'cut') })
    expect(pocket.result?.status, pocket.result?.message).toBe('ok')
    type Compare = { byFeature?: { name: string; outside: number; inside: number }[]; featuresFound?: number; patches: Record<string, unknown>[]; far?: { inside: { patches: Record<string, unknown>[] } } }
    const all = await run<Compare>('reverse.body.compare', { range: 0.1 })
    expect(all.byFeature!.map((g) => g.name).sort()).toEqual(['Box', 'Pocket'])
    expect(all.featuresFound).toBeUndefined()
    const worst = Math.max(...all.byFeature!.map((g) => Math.max(g.outside, -g.inside)))
    const one = await run<Compare>('reverse.body.compare', { range: 0.1, features: 1 })
    expect(one.byFeature).toHaveLength(1)
    expect(Math.max(one.byFeature![0].outside, -one.byFeature![0].inside)).toBe(worst)
    expect(one.featuresFound).toBe(2)
    expect((await run<Compare>('reverse.body.compare', { range: 0.1, features: 0 })).byFeature).toBeUndefined()
    expect(all.patches.length).toBeGreaterThan(0)
    expect(all.patches.every((p) => !('vertices' in p))).toBe(true)
    const asked = await run<Compare>('reverse.body.compare', { range: 0.1, patchVertices: true })
    expect(asked.patches.every((p) => Array.isArray(p.vertices) && (p.vertices as number[]).length > 0)).toBe(true)
  })

  it('cuts a feature in two places at the largest, or at the one nearest at', async () => {
    await run('reverse.feature.add', { feature: rectangle('Box plan', -20, [0, 0], [40, 40]) })
    await run('reverse.feature.add', { feature: extrude('Box', 'Box plan', 0, 40, 'new') })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Rib plan', plane: { kind: 'world', axis: 'z', offset: 20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [-10, 0], size: [4, 16], fixed: true }, { kind: 'rectangle', id: 10, center: [10, 0], size: [4, 16], fixed: true }] } } })
    const ribs = await run<Brief>('reverse.feature.add', { feature: extrude('Ribs', 'Rib plan', 0, 3) })
    expect(ribs.result?.status, ribs.result?.message).toBe('ok')
    const f = featureNamed('Ribs')
    const cut = featureCut(session, f)
    expect(cut.places).toHaveLength(2)
    // The largest face of a rib is its top, 4 × 16: cut across its length,
    // the plane standing on it through its middle.
    expect(cut.plane.origin[2]).toBeCloseTo(23, 6)
    expect(Math.abs(cut.plane.normal[1])).toBeCloseTo(1, 6)
    expect(Math.abs(cut.plane.origin[0])).toBeCloseTo(10, 6)
    for (const x of [-10, 10]) {
      const at = featureCut(session, f, [x, 3, 22])
      expect(at.place.centroid[0]).toBeCloseTo(x, 1)
      expect(at.plane.origin[0]).toBeCloseTo(x, 6)
    }
    // Without the browser the picture itself is refused, as before.
    expect((await refused('reverse.body.compare', { feature: 'Ribs', picture: true, at: [10, 0, 22] })).code).toBe('unavailable')
    expect((await refused('reverse.body.compare', { at: [10, 0, 22] })).code).toBe('invalid_input')
  })
})

describe('feature names kept apart', () => {
  it('refuses a name another feature has, at add, in a batch, at update and on a sketch’s rename', async () => {
    await run('reverse.feature.add', { feature: rectangle('Plate', 0, [0, 0], [10, 10]) })
    const again = await refused('reverse.feature.add', { feature: rectangle(' plate ', 5, [0, 0], [10, 10]) })
    expect(again.code).toBe('invalid_input')
    expect(again.message).toMatch(/^Feature 1 is already named “Plate” — .*“plate 2”, say\./)
    // A batch with a name taken, or two alike, adds nothing.
    const batch = await refused('reverse.feature.add', { features: [rectangle('Other', 5, [0, 0], [4, 4]), rectangle('Rib', 6, [0, 0], [4, 4]), rectangle('rib', 7, [0, 0], [4, 4])] })
    expect(batch.message).toMatch(/Two features in this batch are named “rib”.*nothing was added/)
    const taken = await refused('reverse.feature.add', { features: [rectangle('Other', 5, [0, 0], [4, 4]), rectangle('Plate', 6, [0, 0], [4, 4])] })
    expect(taken.message).toMatch(/already named “Plate”/)
    expect(useReverse.getState().features.map((f) => f.name)).toEqual(['Plate'])
    await run('reverse.feature.add', { feature: extrude('Slab', 'Plate', 0, 2, 'new') })
    expect((await refused('reverse.feature.update', { feature: 'Slab', set: { name: 'PLATE' } })).message).toMatch(/already named “Plate”/)
    expect((await refused('reverse.sketch.edit', { sketch: 'Plate', name: 'slab' })).message).toMatch(/already named “Slab”/)
    // Its own name, another case: a rename like any.
    await run('reverse.feature.update', { feature: 'Slab', set: { name: 'SLAB' } })
    expect(useReverse.getState().features.map((f) => f.name)).toEqual(['Plate', 'SLAB'])
  })
})

describe('thread sizes as designations', () => {
  it('reads a pitch from the size, and refuses a pitch that says otherwise', async () => {
    expect(readDesignation('M10x1')).toEqual({ size: 'M10', pitch: 1 })
    expect(readDesignation('M10 × 1.25')).toEqual({ size: 'M10', pitch: 1.25 })
    expect(readDesignation('m10X1')).toEqual({ size: 'm10', pitch: 1 })
    expect(readDesignation('M10')).toEqual({ size: 'M10' })
    expect(readDesignation('Ø16×3.5 print')).toEqual({ size: 'Ø16', pitch: 3.5, standard: 'print45' })
    const unc = readDesignation('1/4-20 UNC')
    expect(unc.size).toBe('1/4')
    expect(unc.standard).toBe('unc')
    expect(unc.pitch).toBeCloseTo(25.4 / 20, 9)
    expect(readDesignation('#10-32', 'unf')).toMatchObject({ size: '#10' })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Pin circle', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 5, fixed: true }] } } })
    await run('reverse.feature.add', { feature: extrude('Pin', 'Pin circle', 0, 12, 'new') })
    const face = { kind: 'cylinder' }
    for (const [size, pitch] of [['M10x1', 1], ['M10 × 1.25', 1.25], ['M10', 1.5]] as const) {
      const t = await run<Brief>('reverse.feature.add', { feature: { kind: 'thread', body: 'Pin', face, size }, detail: 'full' })
      expect(t.result?.status, t.result?.message).toBe('ok')
      expect(t.feature).toMatchObject({ diameter: 10, pitch })
      await run('reverse.feature.remove', { feature: t.feature.id })
    }
    const both = await refused('reverse.feature.add', { feature: { kind: 'thread', body: 'Pin', face, size: 'M10x1', pitch: 1.5 } })
    expect(both.message).toMatch(/says a pitch of 1 mm and pitch says 1\.5/)
    // The same pitch twice is no conflict.
    expect((await run<Brief>('reverse.feature.add', { feature: { kind: 'thread', body: 'Pin', face, size: 'M10×1', pitch: 1 }, detail: 'full' })).feature).toMatchObject({ pitch: 1 })
  })
})

describe('compare_in_deviation’s reading', () => {
  it('sets tolerance, range and maxDistance as deviation.settings does, before the map is measured, and answers what it used', async () => {
    await boredBlock()
    const before = useDeviation.getState()
    const kept = { tolerance: before.tolerance, range: before.range, maxDistance: before.maxDistance }
    let seen: { tolerance: number; range: number; maxDistance: number } | null = null
    const stop = installCompareInDeviation(async () => {
      const d = useDeviation.getState()
      seen = { tolerance: d.tolerance, range: d.range, maxDistance: d.maxDistance }
    })
    try {
      const r = await run<{ reading: Record<string, unknown> }>('reverse.body.compare_in_deviation', { ways: 'scan', tolerance: 0.2, range: 0.5, maxDistance: 4 })
      expect(seen).toEqual({ tolerance: 0.2, range: 0.5, maxDistance: 4 })
      expect(r.reading).toEqual({ tolerance: 0.2, range: 0.5, maxDistance: 4, maxDistanceAuto: false })
      // Left out, the reading stands as it was, and is answered.
      const again = await run<{ reading: Record<string, unknown> }>('reverse.body.compare_in_deviation', { ways: 'scan' })
      expect(again.reading).toMatchObject({ tolerance: 0.2, range: 0.5, maxDistance: 4 })
      expect((await refused('reverse.body.compare_in_deviation', { tolerance: 0 })).code).toBe('invalid_input')
    } finally {
      stop()
      await run('deviation.settings', kept)
    }
  })
})
