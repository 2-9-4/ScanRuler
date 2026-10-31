// SPDX-License-Identifier: AGPL-3.0-only
// Loft, sweep and join failures that say what and where (round 15): a
// section crossing itself refused with its regions' areas, a ring lofted
// as one; a sliver piece and a run-off section refused before the kernel
// tries them; a sketch further down the list or suppressed named as such,
// not "gone"; a sweep's start refusal giving the path's start, its way and
// the plane to sketch on; a profile no longer closed naming its open ends;
// a join that left no closed solid saying what it tried and whether the
// tool is sound alone; and a sketch's answer listing the ends that just
// miss each other.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec2 } from '../../../src/core/flat/types'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { Builder } from '../core/build'
import type { BooleanFeature, Feature, LoftFeature, SketchFeature, SweepFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { loftProfile, sweepGeometry } from '../core/profiles'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { ReClient } from '../core/reClient'
import { addEntity, addRectangle, type Sketch, type SketchLine } from '../core/sketch'
import plugin from '../plugin'
import { build, ctx, extrudeAll, rectangleSketch, sketchOf } from './reKit'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** A sketch on the XY plane at height z, drawn by `draw`. */
function sketchAt(id: number, name: string, z: number, draw: (s: Sketch) => void): SketchFeature {
  const s = sketchOf(id, draw)
  const frame: SectionFrame = { ...s.frame, origin: [0, 0, z] }
  return { ...s, name, plane: { kind: 'world', axis: 'z', offset: z }, frame }
}
const square = (id: number, name: string, z: number, side: number) => sketchAt(id, name, z, (s) => addRectangle(s, [-side / 2, -side / 2], [side / 2, side / 2]))
const loft = (id: number, sketches: number[]): LoftFeature => ({ id, kind: 'loft', name: `Loft ${id}`, sketches, ruled: false, op: 'new', visible: true })
const failures = (features: Feature[]) => resolveFeatures(features, ctx, (f) => findRegions(f.sketch)).flatMap((s) => (s.kind === 'failed' ? [{ id: s.id, message: s.message }] : []))

describe('a loft’s sections checked before the kernel', () => {
  it('refuses a section that crosses itself, giving the areas, and lofts a ring as one', () => {
    const bow = sketchAt(1, 'Bow', 0, (s) => {
      const corners: Vec2[] = [[0, 0], [10, 10], [10, 0], [0, 10]]
      corners.forEach((p, i) => addEntity(s, { kind: 'line', a: p, b: corners[(i + 1) % 4] }))
    })
    expect(loftProfile(bow, findRegions(bow.sketch))).toMatch(/^Bow's pieces close 2 regions \(areas 25, 25 mm²\) — the profile crosses itself or is cut across, and the loft would take the largest alone\./)
    expect(loftProfile(bow, findRegions(bow.sketch), 'the sweep')).toMatch(/the sweep would take the largest alone/)
    const ring = sketchAt(2, 'Ring', 0, (s) => {
      addRectangle(s, [-10, -10], [10, 10])
      addEntity(s, { kind: 'circle', c: [0, 0], r: 4 })
    })
    const profile = loftProfile(ring, findRegions(ring.sketch))
    expect(typeof profile === 'string' ? profile : profile.holes.length).toBe(1)
  })

  it('refuses a sliver piece and a section run far off, and lofts a steady funnel', () => {
    // A side split 0.01 mm from its corner: the kernel's NCollection_DataMap::Find.
    const sliver = sketchAt(2, 'Mid', 10, (s) => {
      const corners: Vec2[] = [[-5, -5], [-4.99, -5], [5, -5], [5, 5], [-5, 5]]
      corners.forEach((p, i) => addEntity(s, { kind: 'line', a: p, b: corners[(i + 1) % corners.length] }))
    })
    expect(failures([square(1, 'Low', 0, 10), sliver, square(3, 'High', 20, 10), loft(4, [1, 2, 3])])).toEqual([
      { id: 4, message: expect.stringMatching(/^Mid's piece 1 \(a line\) is 0\.01 mm long — under 0\.05 mm: no piece of a section/) },
    ])
    // A middle section ten times its neighbours, and a last one past the
    // loft's own growth.
    expect(failures([square(1, 'Low', 0, 10), square(2, 'Mid', 10, 100), square(3, 'High', 20, 10), loft(4, [1, 2, 3])])[0].message).toMatch(/^Mid spans 141\.4 mm across, its neighbours 14\.1 and 14\.1 mm — a piece of it runs far off/)
    expect(failures([square(1, 'Low', 0, 10), square(2, 'Mid', 10, 11), square(3, 'High', 20, 100), loft(4, [1, 2, 3])])[0].message).toMatch(/^High spans 141\.4 mm across/)
    expect(failures([square(1, 'Low', 0, 10), square(2, 'Mid', 10, 20), square(3, 'High', 20, 40), loft(4, [1, 2, 3])])).toEqual([])
    expect(failures([square(1, 'Low', 0, 5), square(2, 'High', 10, 100), loft(4, [1, 2])])).toEqual([])
  })
})

describe('a sketch the feature cannot have', () => {
  it('names a sketch further down the list, or suppressed, rather than calling it gone', () => {
    const low = square(1, 'Low', 0, 10)
    const high = square(2, 'Top', 20, 10)
    expect(failures([low, loft(3, [1, 2]), high])[0].message).toMatch(/^Sketch 2 \(Top\) stands after this loft — a feature takes only the sketches above it\. Move it above:/)
    expect(failures([low, { ...high, suppressed: true }, loft(3, [1, 2])])[0].message).toMatch(/^Sketch 2 \(Top\) is suppressed — build it again/)
    expect(failures([extrudeAll(3, high, 0, 5), high])[0].message).toMatch(/^Sketch 2 \(Top\) stands after this extrude/)
    const sweep: SweepFeature = { id: 3, kind: 'sweep', name: 'Sweep', profile: 1, path: 2, op: 'new', visible: true }
    expect(failures([low, sweep, high])[0].message).toMatch(/^Sketch 2 \(Top\) stands after this sweep/)
    expect(failures([low, loft(3, [1, 9])])[0].message).toBe('A sketch this loft runs through is gone.')
  })
})

describe('a sweep refused for where it starts', () => {
  it('gives the path’s start and way, and the plane square to it there', () => {
    const profile = square(1, 'Ring section', 0, 4)
    const along = sketchAt(2, 'Path', 0, (s) => addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] }))
    expect(sweepGeometry(profile, findRegions(profile.sketch), along)).toBe(
      'Ring section\'s plane stands 90.0° off square to the path where it starts — Path starts at (0, 0, 0) and leaves along (1, 0, 0); sketch the profile on a plane through that point square to that way — the plane { kind: "world", axis: "x", offset: 0 } is square to it there.',
    )
    const slant = sketchAt(2, 'Path', 0, (s) => addEntity(s, { kind: 'line', a: [0, 0], b: [10, 5] }))
    expect(sweepGeometry(profile, findRegions(profile.sketch), slant)).toMatch(/leaves along \(0\.894, 0\.447, 0\); .* no coordinate plane is square to it there/)
  })
})

describe('a profile no longer closed', () => {
  it('names its open ends, the gap and the end each misses', () => {
    const before = rectangleSketch(1, 20, 10)
    const extrude = extrudeAll(2, before, 0, 5)
    const after = structuredClone(before)
    // One side's end moved 0.099 mm out from the corner, off both sides.
    const side = after.sketch.entities[1] as SketchLine
    const out = [Math.sign(side.b[0] - 10), Math.sign(side.b[1] - 5)]
    side.b = [side.b[0] + (out[0] * 0.099) / Math.SQRT2, side.b[1] + (out[1] * 0.099) / Math.SQRT2]
    expect(failures([after, extrude])[0]?.message).toMatch(/^The picked profiles are no longer closed — the sketch changed under them\. Its open ends: piece \d end [ab] is 0\.099 mm from piece \d end [ab] — put the ends together/)
  })
})

describe('a join that left no closed solid', () => {
  /** A block and a boss through its top, each a body, joined by a boolean. */
  function blockAndBoss(): Feature[] {
    const block = sketchOf(1, (s) => addRectangle(s, [0, 0], [20, 20]))
    const boss = sketchOf(3, (s) => addRectangle(s, [5, 5], [15, 15]))
    const join: BooleanFeature = { id: 5, kind: 'boolean', name: 'Join', op: 'join', body: 2, tool: 4, visible: true }
    return [block, extrudeAll(2, block, 0, 10, 'new'), boss, extrudeAll(4, boss, 5, 15, 'new'), join]
  }

  /** The kernel with every fuse coming back open — every way it is
   *  played — and, once fusing has begun, the boss (1000 mm³) unsound
   *  alone when `boss` says so. */
  async function openFuse(boss: () => boolean): Promise<ReKernel> {
    const kernel = await kernelPromise
    const fused = new Set<unknown>()
    let fusing = false
    return new Proxy(kernel, {
      get(target, name, receiver) {
        const v = Reflect.get(target, name, receiver) as unknown
        if (typeof v !== 'function') return v
        if (name === 'fuseTracked')
          return (a: never, b: never) => {
            fusing = true
            const r = target.fuseTracked(a, b)
            fused.add(r.shape)
            return r
          }
        if (name === 'isClosedSolid') return (s: never) => !fused.has(s) && !(fusing && boss() && Math.abs(target.volume(s) - 1000) < 1e-6) && target.isClosedSolid(s)
        return (v as (...a: unknown[]) => unknown).bind(target)
      },
    }) as ReKernel
  }

  it('says it tried exact, keeping splits and both fuzzy values, and whether the tool alone is sound', async () => {
    let broken = false
    const builder = new Builder(await openFuse(() => broken))
    const sound = (await build(builder, blockAndBoss())).results.find((r) => r.id === 5)!
    expect(sound.status).toBe('failed')
    expect(sound.message).toMatch(/^The boolean left no closed solid — tried exact, keeping splits, fuzzy 0\.0001 mm and fuzzy 0\.001 mm; both bodies check valid alone, so the trouble is where they meet/)
    broken = true
    const unsound = (await build(new Builder(await openFuse(() => broken)), blockAndBoss())).results.find((r) => r.id === 5)!
    expect(unsound.message).toMatch(/; Extrude 4 is no valid closed solid alone — mend it first \(reverse\.body\.check\)\.$/)
    builder.dispose()
  })

  it('says the same for an extrude joined to what it touches', async () => {
    const block = sketchOf(1, (s) => addRectangle(s, [0, 0], [20, 20]))
    const boss = sketchOf(3, (s) => addRectangle(s, [5, 5], [15, 15]))
    const builder = new Builder(await openFuse(() => false))
    const joined = (await build(builder, [block, extrudeAll(2, block, 0, 10, 'new'), boss, extrudeAll(4, boss, 5, 15, 'join')])).results.find((r) => r.id === 4)!
    expect(joined.message).toMatch(/^Joining left no closed solid — tried exact, keeping splits, fuzzy 0\.0001 mm and fuzzy 0\.001 mm; both bodies check valid alone/)
    builder.dispose()
  })
})

describe('a sketch’s answer', () => {
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

  it('lists ends a tenth of a millimetre apart that leave a profile open, beside the regions it closes', async () => {
    type Answer = { regions: { area: number }[]; nearMiss?: { piece: number; end: string; nearest: { piece: number; end: string }; gap: number }[]; open?: unknown }
    // A closed square, and a triangle whose last side ends 0.099 mm off its corner.
    const square = { kind: 'rectangle', center: [0, 0], size: [10, 10] }
    const entities = [
      { id: 101, kind: 'line', a: [20, 0], b: [30, 0] },
      { id: 102, kind: 'line', a: [30, 0], b: [25, 8] },
      { id: 103, kind: 'line', a: [25, 8], b: [20, 0.099] },
    ]
    const out = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Web', plane: 'XY', sketch: { shapes: [square], entities } } })
    expect(out.regions).toHaveLength(1)
    expect(out.open).toBeUndefined()
    expect(out.nearMiss).toEqual([{ piece: 101, end: 'a', nearest: { piece: 103, end: 'b' }, gap: 0.099 }])
    // Every end met: nothing listed.
    const closed = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Square', plane: 'XY', sketch: { shapes: [square] } } })
    expect(closed.nearMiss).toBeUndefined()
  })
})
