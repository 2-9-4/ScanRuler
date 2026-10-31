// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.fillet_try: a round tried at a list of sizes on the body as it
// stood before it, nothing after it played and nothing kept — here on a plate
// with a hole cut after the round. And a round that built in the build before
// and fails now, saying which features before it changed.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listCommands } from '../../../src/commands/registry'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { Builder } from '../core/build'
import type { ChamferFeature, Feature, FilletFeature, SketchFeature } from '../core/features'
import { ReKernel, type Shape } from '../core/kernel'
import { KernelTrap } from '../core/kernelOps'
import { ReClient } from '../core/reClient'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addRectangle, type Sketch } from '../core/sketch'
import plugin from '../plugin'
import { build, ctx, extrudeAll, sketchOf } from './reKit'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 120_000 })

/** The plate's sketch: 30 by `high`, a corner at the origin. */
const plate = (high = 20) => sketchOf(1, (s) => addRectangle(s, [0, 0], [30, high]))

/** The plate 5 thick, and the fingerprint of its upright edge at the origin. */
async function plateAndCorner(k: ReKernel) {
  const outline = plate()
  const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new')]
  const builder = new Builder(k)
  await build(builder, base)
  const uprights = builder.topologyOf(2)!.edges.filter((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99)
  const corner = uprights.find((e) => Math.hypot(e.fingerprint.mid[0], e.fingerprint.mid[1]) < 1e-6)!
  return { builder, base, uprights, corner }
}

/** A pocket cut through the plate, played after the round: its sketch, and
 *  the cut on the plate. */
function pocket(sketchId: number, cutId: number): Feature[] {
  const outline = sketchOf(sketchId, (s) => addRectangle(s, [14, 8], [18, 12]))
  return [outline, extrudeAll(cutId, outline, -1, 6, 'cut', 2)]
}

/** The features built with their keys kept, as the worker builds them. */
function buildKept(builder: Builder, features: Feature[]) {
  const steps = resolveFeatures(features, ctx, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return builder.build(steps, (id) => sketches.get(id), true)
}

describe('a round tried at other sizes', () => {
  it('answers each size on the body before it, plays nothing after it and keeps nothing', async () => {
    const k = await ReKernel.load()
    const { builder, base, uprights } = await plateAndCorner(k)
    const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: uprights.map((e) => e.fingerprint), radius: 3, chain: false, visible: true }
    const features = [...base, round, ...pocket(4, 5)]
    const first = buildKept(builder, features)
    expect(first.results.every((r) => r.status === 'ok')).toBe(true)
    const volume = first.bodies[0].volume
    const held = builder.cacheHeld()

    // The kernel's rounds are watched: only the plate as it stood before.
    const seen: Shape[] = []
    const real = k.filletTracked.bind(k)
    k.filletTracked = (solid: Shape, hashes: readonly number[], r: number) => {
      seen.push(solid)
      return real(solid, hashes, r)
    }
    const cuts = vi.spyOn(k, 'cutTracked')
    const { tries, crashed } = builder.filletTry(3, [2, 4, 12])
    expect(crashed).toBeUndefined()
    expect(tries.map((t) => t.builds)).toEqual([true, true, false])
    expect(tries[0]).toMatchObject({ size: 2, tried: true, closed: true, valid: true, faces: 10 })
    expect(tries[0].ms).toBeGreaterThan(0)
    expect(tries[2].message).toBeTruthy()
    expect(cuts).not.toHaveBeenCalled()
    expect(new Set(seen).size).toBe(1)
    k.filletTracked = real

    // Nothing changed: the next build plays nothing, comes out the same.
    expect(builder.cacheHeld()).toEqual(held)
    const again = buildKept(builder, features)
    expect(again.steps.recomputed).toBe(0)
    expect(again.all[0].key).toBe(first.all[0].key)

    // And a build at a size tried comes out as one from nothing does.
    const chosen = features.map((f) => (f.id === 3 ? { ...round, radius: 4 } : f))
    const here = buildKept(builder, chosen)
    const fresh = buildKept(new Builder(await ReKernel.load()), chosen)
    expect(here.bodies[0].volume).toBeCloseTo(fresh.bodies[0].volume, 6)
    expect(here.bodies[0].faces).toBe(fresh.bodies[0].faces)
    expect(fresh.bodies[0].volume).toBeLessThan(volume)
    builder.dispose()
  })

  it('tries a round that failed in the build, on the body it failed on', async () => {
    const k = await ReKernel.load()
    const { builder, base, uprights } = await plateAndCorner(k)
    const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: uprights.map((e) => e.fingerprint), radius: 12, chain: false, visible: true }
    const out = buildKept(builder, [...base, round])
    expect(out.results.find((r) => r.id === 3)?.status).toBe('failed')
    const { tries } = builder.filletTry(3, [12, 9])
    expect(tries.map((t) => t.builds)).toEqual([false, true])
    builder.dispose()
  })

  it('tries a chamfer by its distance, one by two distances in proportion', async () => {
    const k = await ReKernel.load()
    const { builder, base, corner } = await plateAndCorner(k)
    const bevel: ChamferFeature = { id: 3, kind: 'chamfer', name: 'Bevel', body: 2, edges: [corner.fingerprint], distance: 1, chain: false, visible: true }
    buildKept(builder, [...base, bevel])
    expect(builder.filletTry(3, [2, 40]).tries.map((t) => t.builds)).toEqual([true, false])
    const sided: ChamferFeature = { ...bevel, mode: 'twoDistances', distance2: 2 }
    buildKept(builder, [...base, sided])
    const tries = vi.spyOn(builder, 'chamferSided')
    expect(builder.filletTry(3, [2]).tries[0].builds).toBe(true)
    const asked = tries.mock.calls[0][0] as Extract<ChamferFeature, object>
    expect(asked.distance).toBe(2)
    expect(asked.distance2).toBe(4)
    builder.dispose()
  })

  it('begins no size past its time, and stops at a kernel that traps', async () => {
    const k = await ReKernel.load()
    const { builder, base, corner } = await plateAndCorner(k)
    const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius: 2, chain: false, visible: true }
    buildKept(builder, [...base, round])
    const real = k.filletTracked.bind(k)
    k.filletTracked = (solid: Shape, hashes: readonly number[], r: number) => {
      const until = performance.now() + 60
      while (performance.now() < until) {
        // A round that takes its time.
      }
      return real(solid, hashes, r)
    }
    const timed = builder.filletTry(3, [1, 2, 3, 4], 100).tries
    expect(timed[0].tried).toBe(true)
    expect(timed.at(-1)).toEqual({ size: 4, tried: false })
    k.filletTracked = () => {
      throw new KernelTrap('Filleting: null function or function signature mismatch')
    }
    const trapped = builder.filletTry(3, [1, 2])
    expect(trapped.crashed).toMatch(/null function/)
    expect(trapped.tries.map((t) => t.tried)).toEqual([true, false])
    k.filletTracked = real
    builder.dispose()
  })

  it('refuses what it cannot try, by what is wrong', async () => {
    const k = await ReKernel.load()
    const { builder, base, corner } = await plateAndCorner(k)
    const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius: 2, chain: false, visible: true }
    buildKept(builder, base)
    expect(() => builder.filletTry(3, [1])).toThrow(/did not run in the last build/)
    expect(() => builder.filletTry(2, [1])).toThrow(/Only a fillet or a chamfer/)
    buildKept(builder, [...base, { ...round, variable: [{ edge: corner.fingerprint, radius: [1, 2] }] }])
    expect(() => builder.filletTry(3, [1])).toThrow(/varying radius/)
    builder.dispose()
  })
})

describe('reverse.body.fillet_try', () => {
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

  type Tried = { feature: { name: string }; tries: { size: number; builds?: boolean; closed?: boolean; valid?: boolean; faces?: number; ms?: number; message?: string }[]; largest: number | null; status: string }

  async function rounded() {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plate', plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [15, 10], size: [30, 20], fixed: true }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plate', regions: 'all', extent: { kind: 'distance', from: 0, to: 5 }, op: 'new' } })
    await run('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body: 'Block', edges: [{ between: [[1, 0, 0], [0, 1, 0]] }, { between: [[1, 0, 0], [0, -1, 0]] }, { between: [[-1, 0, 0], [0, 1, 0]] }, { between: [[-1, 0, 0], [0, -1, 0]] }], radius: 3 } })
  }

  it('answers per size and the largest that builds, and changes nothing', async () => {
    await rounded()
    const before = await run<{ features: { name: string; radius?: number }[] }>('reverse.feature.list', {})
    const t = await run<Tried>('reverse.body.fillet_try', { feature: 'Round', radii: [2, 4, 12] })
    expect(t.feature.name).toBe('Round')
    expect(t.tries.map((x) => x.builds)).toEqual([true, true, false])
    expect(t.tries[0]).toMatchObject({ closed: true, valid: true, faces: 10 })
    expect(t.largest).toBe(4)
    expect(t.status).toMatch(/^Builds at 2, 4\. Fails at 12\. Nothing was kept/)
    expect(await run('reverse.feature.list', {})).toEqual(before)
    expect(listCommands().find((c) => c.name === 'reverse.body.fillet_try')).toMatchObject({ readOnly: true, long: true })
  })

  it('refuses another feature, and a list past the bound', async () => {
    await rounded()
    expect((await refused('reverse.body.fillet_try', { feature: 'Block', radii: [1] })).code).toBe('invalid_input')
    expect((await refused('reverse.body.fillet_try', { feature: 'Round', radii: [1, 2, 3, 4, 5, 6, 7, 8, 9] })).code).toBe('invalid_input')
    expect((await refused('reverse.body.fillet_try', { feature: 'Round', radii: [] })).code).toBe('invalid_input')
    expect((await refused('reverse.body.fillet_try', { feature: 'Round', radii: [-1] })).code).toBe('invalid_input')
  })
})

describe('a round that built in the build before and fails now', () => {
  it('names the features before it that changed since, once', async () => {
    const k = await ReKernel.load()
    const { builder, base, corner } = await plateAndCorner(k)
    // R15 fits the plate 20 high, not 12: the outline changed, not the round. A
    // sketch changed is said by the feature that reads it.
    const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius: 15, chain: false, visible: true }
    const named = (f: Feature, name: string) => ({ ...f, name }) as Feature
    const as = (high: number, r = round) => [named(plate(high), 'Plate'), named(base[1], 'Block'), r]
    expect(buildKept(builder, as(20)).results.find((x) => x.id === 3)?.status).toBe('ok')
    const failed = buildKept(builder, as(12)).results.find((x) => x.id === 3)!
    expect(failed.status).toBe('failed')
    expect(failed.message).toMatch(/It built in the last build; changed before it since: Block\.$/)
    // Failing as it did: nothing new to say, and the kept result is as it was.
    expect(buildKept(builder, as(12)).results.find((x) => x.id === 3)?.message).not.toMatch(/It built in the last build/)
    builder.dispose()
  })

  it('names nothing where only the round changed', async () => {
    const k = await ReKernel.load()
    const { builder, base, corner } = await plateAndCorner(k)
    const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius: 2, chain: false, visible: true }
    buildKept(builder, [...base, round])
    const failed = buildKept(builder, [...base, { ...round, radius: 40 }]).results.find((x) => x.id === 3)!
    expect(failed.status).toBe('failed')
    expect(failed.message).not.toMatch(/It built in the last build/)
    builder.dispose()
  })
})
