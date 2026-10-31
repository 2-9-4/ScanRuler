// SPDX-License-Identifier: AGPL-3.0-only
// What two runs on real parts asked of the plan and the map: a round built
// into a profile, credited by the arc that holds it; one region of the plan
// changed alone; a region inferred where the scan saw nothing, its missing
// material told apart from the places and the verdict; and a picture's wait
// for the map, kept in one place. The kernel runs in this thread.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { boxMesh } from '../../../tests/helpers'
import { Builder } from '../core/build'
import { mergePlaces } from '../core/reviewPlaces'
import { ReClient } from '../core/reClient'
import { askMap, forgetMapWait, mapMark, mapRead, mapWhyNow, settleMap } from '../app/reMapRead'
import { planSection, planVerdict, setAsideInferred, usePlan } from '../app/rePlan'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { useRePrefs } from '../state/rePrefs'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 180_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box-round23.stl', discard: true })
  // A block, and a plate with a rounded corner: an arc of R2.4 in its sketch.
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plate', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } } })
  await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plate', regions: 'all', extent: { kind: 'distance', from: 0, to: 40 }, op: 'new' } })
  const r = 2.4
  await run('reverse.feature.add', {
    feature: {
      kind: 'sketch',
      name: 'Profile',
      plane: { kind: 'world', axis: 'z', offset: 20 },
      sketch: {
        entities: [
          { kind: 'line', id: 1, a: [0, 0], b: [10 - r, 0] },
          { kind: 'arc', id: 2, c: [10 - r, r], r, start: -Math.PI / 2, sweep: Math.PI / 2 },
          { kind: 'line', id: 3, a: [10, r], b: [10, 10] },
          { kind: 'line', id: 4, a: [10, 10], b: [0, 10] },
          { kind: 'line', id: 5, a: [0, 10], b: [0, 0] },
        ],
      },
    },
  })
  await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Foot', sketchId: 'Profile', regions: 'all', extent: { kind: 'distance', from: 0, to: 5 }, op: 'new' } })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})

const collect = () => JSON.parse(JSON.stringify(planSection.collect({ sources: {} as never, scanSaved: true, addMember: () => {} }) ?? null))
const prepare = (part: unknown) => planSection.prepare(part, { manifest: {} as never, members: new Map() })

const failingRound = async (name: string, radius: number) => {
  await run('reverse.feature.add', { feature: { kind: 'fillet', name, body: 'Block', edges: [0], radius: 60 } })
  await run('reverse.feature.remove', { feature: name })
  // As it would stand had it failed at this radius.
  usePlan.setState((s) => ({ removed: s.removed.map((r) => (r.name === name ? { ...r, radius } : r)) }))
}

describe('a round built into a profile', () => {
  it('is credited by the arc of about its radius, and names the arc', async () => {
    await run('reverse.plan.set', { archetype: 'machined', regions: [{ name: 'All' }], target: { withinT: 90 } })
    await run('reverse.plan.tick', { region: 'All', feature: 'Block' })
    await failingRound('Foot round', 2.4)
    expect(usePlan.getState().removed.at(-1)?.radius).toBe(2.4)
    const said = await run<{ replaced: { arc: { sketch: string; piece: number; radius: number; roundWas: number } }; unbuilt: string[] }>('reverse.plan.replace', { removed: 'Foot round', by: 'Foot', reason: 'drawn as an arc in the profile' })
    expect(said.replaced.arc).toEqual({ sketch: 'Profile', piece: 2, radius: 2.4, roundWas: 2.4 })
    expect(said.unbuilt).toEqual([])
    const v = planVerdict(session, { withinT: 95 })!
    expect(v.met).toBe(true)
    expect(v.removed).toEqual([expect.objectContaining({ name: 'Foot round', replaced: { by: 'Foot', reason: 'drawn as an arc in the profile', arc: { sketch: 'Profile', piece: 2, radius: 2.4 } } })])
  })

  it('stays owed once the arc has left the sketch', async () => {
    const features = useReverse.getState().features
    useReverse.setState({ features: features.map((f) => (f.kind === 'sketch' && f.name === 'Profile' ? { ...f, sketch: { ...f.sketch, entities: f.sketch.entities.map((e) => (e.kind === 'arc' ? { ...e, r: 9 } : e)) } } : f)) })
    expect(planVerdict(session, { withinT: 95 })).toMatchObject({ met: false, unbuilt: ['Foot round'] })
    useReverse.setState({ features })
    expect(planVerdict(session, { withinT: 95 })).toMatchObject({ met: true })
    usePlan.setState({ removed: [] })
  })

  it('refuses with no arc near its radius, naming the route; a chamfer has no arc', async () => {
    await failingRound('Big round', 9)
    const off = await refused('reverse.plan.replace', { removed: 'Big round', by: 'Foot', reason: 'x' })
    expect(off.code).toBe('invalid_input')
    expect(off.message).toMatch(/Foot an extrude, whose sketch holds no arc of about R9/)
    expect(off.message).toMatch(/whose own sketch holds an arc of about its radius/)
    // A block's sketch has no arc at all.
    const none = await refused('reverse.plan.replace', { removed: 'Big round', by: 'Block', reason: 'x' })
    expect(none.message).toMatch(/Block an extrude, whose sketch holds no arc of about R9:/)
    expect(planVerdict(session, { withinT: 95 })).toMatchObject({ met: false, unbuilt: ['Big round'] })
    usePlan.setState({ removed: [{ name: 'Edge', kind: 'chamfer', message: 'failed', at: 'a' }] })
    expect((await refused('reverse.plan.replace', { removed: 'Edge', by: 'Foot', reason: 'x' })).message).toMatch(/^Edge is a chamfer, and Foot an extrude: a round/)
    usePlan.setState({ removed: [] })
  })

  it('takes a record saved without a radius by the smallest arc, and says so', async () => {
    usePlan.setState({ removed: [{ name: 'Old round', kind: 'fillet', message: 'failed', at: 'a' }] })
    const said = await run<{ replaced: { arc: { radius: number; note: string } } }>('reverse.plan.replace', { removed: 'Old round', by: 'Foot', reason: 'an arc now' })
    expect(said.replaced.arc.note).toMatch(/kept no radius/)
    // Its arc comes back through a project, and an older one with none.
    const part = collect()
    prepare({ ...part, removed: [{ name: 'Older', kind: 'fillet', message: 'failed', at: 'a' }] })
    prepare(part)()
    expect(usePlan.getState().removed[0].replaced?.arc?.sketch).toBe('Profile')
    expect(() => prepare({ removed: [{ name: 'x', kind: 'fillet', message: 'm', at: 'a', radius: 'big' }] })).toThrow(/plan\.removed\.radius/)
    usePlan.setState({ removed: [] })
  })
})

describe('reverse.plan.update', () => {
  it('changes one region, keeping its ticks and the rest, by plan.set’s checks', async () => {
    await run('reverse.plan.set', { archetype: 'machined', regions: [{ name: 'Wall', route: 'extrude', at: { min: [0, 0, 0], max: [1, 1, 1] } }, { name: 'Tab', function: 'locates' }], target: { withinT: 88, tolerance: 0.4 } })
    await run('reverse.plan.tick', { region: 'Wall', feature: 'Block' })
    const wider = { min: [-5, -5, -5], max: [5, 5, 5] }
    const said = await run<{ region: { name: string; route: string; at: unknown; done: string }; open: string[] }>('reverse.plan.update', { region: 'wall', set: { at: wider } })
    expect(said.region).toMatchObject({ name: 'Wall', route: 'extrude', at: wider, done: 'Block' })
    expect(said.open).toEqual(['Tab'])
    const plan = usePlan.getState().plan!
    expect(plan.target).toMatchObject({ withinT: 88, tolerance: 0.4 })
    expect(plan.regions[0].feature?.name).toBe('Block')
    expect(plan.regions[1]).toEqual({ name: 'Tab', function: 'locates' })

    await run('reverse.plan.update', { region: 'Tab', set: { name: 'Tab 1', function: '', route: 'cut' } })
    expect(usePlan.getState().plan!.regions[1]).toEqual({ name: 'Tab 1', route: 'cut' })

    expect((await refused('reverse.plan.update', { region: 'Nope', set: { route: 'x' } })).code).toBe('not_found')
    expect((await refused('reverse.plan.update', { region: 'Wall', set: {} })).message).toMatch(/give a field/)
    expect((await refused('reverse.plan.update', { region: 'Wall', set: { name: 'tab 1' } })).message).toMatch(/Two regions/)
    expect((await refused('reverse.plan.update', { region: 'Wall', set: { at: { min: [1, 0, 0], max: [0, 1, 1] } } })).message).toMatch(/min lies past/)
    expect((await refused('reverse.plan.update', { region: 'Wall', set: { at: [0, 0, 0], inferred: true } })).message).toMatch(/inferred needs at as a box/)
    expect((await refused('reverse.plan.update', { region: 'Tab 1', set: { inferred: true } })).message).toMatch(/inferred needs at as a box/)
    // Refused, nothing changed.
    expect(usePlan.getState().plan!.regions[1]).toEqual({ name: 'Tab 1', route: 'cut' })
    expect((await refused('reverse.plan.update', { region: 'Wall', set: { nope: 1 } })).code).toBe('invalid_input')

    usePlan.setState({ plan: null })
    expect((await refused('reverse.plan.update', { region: 'Wall', set: { route: 'x' } })).code).toBe('invalid_state')
  })
})

describe('a region inferred where the scan saw nothing', () => {
  const box = (min: number[], max: number[]) => ({ min, max }) as never
  const lump = (centroid: number[], volume: number, half = 5) => ({ kind: 'missing' as const, volume, maxDepth: 3, centroid: centroid as never, box: box(centroid.map((c) => c - half), centroid.map((c) => c + half)), face: null })
  const bore = { min: [-20, -20, -40], max: [20, 20, 40] }

  it('sets its missing material aside by name, and only that', async () => {
    await run('reverse.plan.set', { archetype: 'turned', regions: [{ name: 'Bore', inferred: true, at: bore }, { name: 'Boss', at: [60, 0, 0] }], target: { withinT: 90 } })
    const excess = { ...lump([0, 0, 10], 800), kind: 'excess' as const }
    const places = mergePlaces([lump([0, 0, 0], 50_000), lump([0, 0, 30], 300), lump([60, 0, 0], 700), excess], [], 0.4)
    const { ranked, inferred } = setAsideInferred(session, places)
    expect(inferred).toEqual([{ region: 'Bore', mm3: 50_300, places: 2 }])
    // The excess in the bore stays: nothing says that was inferred.
    expect(ranked.map((p) => [p.kind, p.mm3])).toEqual([['excess', 800], ['missing', 700]])
  })

  it('keeps a lump that reaches out of the box, and one only near it', () => {
    const places = mergePlaces([lump([0, 0, 0], 9_000, 60), lump([23, 0, 0], 100, 2)], [], 0.4)
    expect(setAsideInferred(session, places).inferred).toEqual([])
    expect(setAsideInferred(session, places).ranked).toHaveLength(2)
  })

  it('behaves as before with no such region', async () => {
    await run('reverse.plan.update', { region: 'Bore', set: { inferred: false } })
    expect(usePlan.getState().plan!.regions[0].inferred).toBeUndefined()
    const places = mergePlaces([lump([0, 0, 0], 50_000)], [], 0.4)
    expect(setAsideInferred(session, places)).toEqual({ ranked: places, inferred: [] })
    await run('reverse.plan.update', { region: 'Bore', set: { inferred: true } })
  })

  it('does not hold the material missing there against the verdict, and says so', async () => {
    await run('reverse.plan.tick', { region: 'Bore', feature: 'Block' })
    await run('reverse.plan.tick', { region: 'Boss', feature: 'Block' })
    const skin = { at: [0, 0, 39] as [number, number, number], depth: 12, outside: true }
    const v = planVerdict(session, { withinT: 95, featurePatches: [skin] })!
    expect(v.met).toBe(true)
    expect(v.regions).toEqual({ open: [], skipped: [], inferred: ['Bore'] })
    expect(v.featurePatches).toEqual({ overT: 0, inInferred: 1 })
    expect(v.next).toMatch(/^target met, every region done or skipped; Bore inferred where the scan saw nothing/)

    // Material too much there, or no side known, or past the box, still stands.
    const inside = planVerdict(session, { withinT: 95, featurePatches: [{ ...skin, outside: false }] })!
    expect(inside).toMatchObject({ met: false, featurePatches: { overT: 1 } })
    expect(planVerdict(session, { withinT: 95, featurePatches: [{ at: skin.at, depth: 12 }] })).toMatchObject({ met: false })
    expect(planVerdict(session, { withinT: 95, featurePatches: [{ ...skin, at: [0, 0, 43] }] })).toMatchObject({ met: false })
    // The share is the share.
    expect(planVerdict(session, { withinT: 80, featurePatches: [skin] })).toMatchObject({ met: false })
  })

  it('is said in the readout and comes back through a project', async () => {
    expect((await run<{ region: { inferred: boolean } }>('reverse.plan.update', { region: 'Bore', set: { route: 'cut through' } })).region.inferred).toBe(true)
    const part = collect()
    usePlan.setState({ plan: null })
    prepare(part)()
    expect(usePlan.getState().plan!.regions[0].inferred).toBe(true)
    part.plan.regions[0].inferred = 'yes'
    expect(() => prepare(part)).toThrow(/plan\.regions\.inferred/)
    usePlan.setState({ plan: null, removed: [] })
  })
})

describe('a picture’s wait for the map', () => {
  const mapAt = (range: number, tick: number) => ({ source: 'bodies' as const, points: 10, within: 9, farInside: 0, range, tick })

  it('lands on the store, with no frame asked for: a hidden tab has none', async () => {
    const frames = vi.fn()
    const was = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = frames
    useReverse.getState().setBodyMap(true)
    useReverse.setState({ mapReport: null })
    const asked = mapRead(0.4, null, 5_000)
    expect(useReverse.getState().mapReport).toBeNull()
    useReverse.setState({ mapReport: mapAt(0.4, 3) })
    expect(await asked).toBe(true)
    expect(frames).not.toHaveBeenCalled()
    globalThis.requestAnimationFrame = was
  })

  it('takes one read since when told, and the range asked', async () => {
    useReverse.getState().setBodyMap(true)
    useReverse.setState({ mapReport: mapAt(0.4, 3) })
    expect(await mapRead(0.4, null, 50)).toBe(true)
    const before = mapMark()
    expect(before).toBe(3)
    expect(await mapRead(0.4, before, 50)).toBe(false)
    expect(await mapRead(0.2, null, 50)).toBe(false)
  })

  it('gives up within its bound and says how far it got; a key off ends it at once', async () => {
    useReverse.getState().setBodyMap(true)
    useReverse.setState({ mapReport: null })
    forgetMapWait()
    expect(mapWhyNow()).toMatch(/still being read — try the picture again/)
    const started = Date.now()
    expect(await mapRead(0.4, null, 60)).toBe(false)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(mapWhyNow()).toMatch(/was not read after \d+ s: .*ask again in a while/)
    forgetMapWait()
    expect(mapWhyNow()).toMatch(/try the picture again/)

    useReverse.getState().setBodyMap(false)
    const off = Date.now()
    expect(await mapRead(0.4, null, 20_000)).toBe(false)
    expect(Date.now() - off).toBeLessThan(2_000)
  })

  it('by the key: turned on, it waits for a reading after that', async () => {
    useReverse.setState({ mapReport: { ...mapAt(useRePrefs.getState().liveMapRange, 7) } })
    useReverse.getState().setBodyMap(false)
    askMap(true)
    expect(useReverse.getState().bodyMap).toBe(true)
    const waiting = settleMap(5_000)
    let over = false
    void waiting.then(() => (over = true))
    await new Promise((r) => setTimeout(r, 60))
    expect(over).toBe(false)
    useReverse.setState({ mapReport: mapAt(useRePrefs.getState().liveMapRange, 8) })
    await waiting
    useReverse.getState().setBodyMap(false)
    useReverse.setState({ mapReport: null })
  })

  it('in the worker, reads the map once while nothing changes', async () => {
    const ids = [useReverse.getState().bodies[0].id]
    const meshes = vi.spyOn(Builder.prototype, 'meshes')
    const first = await session.bodiesMap(ids, 0.31)
    const read = meshes.mock.calls.length
    expect(read).toBeGreaterThan(0)
    const again = await session.bodiesMap(ids, 0.31)
    expect(meshes.mock.calls.length).toBe(read)
    expect(again?.values).toEqual(first?.values)
    expect(again?.subset).toEqual(first?.subset)
    // Another range, or the bodies built otherwise, is read.
    await session.bodiesMap(ids, 0.32)
    expect(meshes.mock.calls.length).toBeGreaterThan(read)
    const counted = meshes.mock.calls.length
    await run('reverse.feature.add', { feature: { kind: 'fillet', name: 'New edge', body: 'Block', edges: [0], radius: 1 } })
    await session.bodiesMap([useReverse.getState().bodies.find((b) => b.name === 'Block' || b.id === ids[0])!.id], 0.32)
    expect(meshes.mock.calls.length).toBeGreaterThan(counted)
    meshes.mockRestore()
  })
})
