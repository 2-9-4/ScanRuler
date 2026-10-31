// SPDX-License-Identifier: AGPL-3.0-only
// The boolean guard: what a join, a cut and a Combine's volume must come
// to, read on numbers; then in the builder, with a kernel whose fuse comes
// back short once — closed and valid, a piece lost — the join is played
// again and taken with a warning on its row, and refused, saying why, when
// it comes back short every time. And a pick found again by where it lies
// on a face another feature made says so on its row.

import { describe, expect, it } from 'vitest'
import { volumeRefusal } from '../core/booleanGuard'
import { Builder } from '../core/build'
import type { Feature, FilletFeature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addRectangle } from '../core/sketch'
import { extrudeAll, sketchOf } from './reKit'

const kernelPromise = ReKernel.load()

function request(features: Feature[]) {
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const byId = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return { steps, sketchOf: (id: number) => byId.get(id) }
}

/** A block and a boss joined onto its top. */
function blockAndBoss(): Feature[] {
  const block = sketchOf(1, (s) => addRectangle(s, [0, 0], [20, 20]))
  const boss = sketchOf(3, (s) => addRectangle(s, [5, 5], [15, 15]))
  return [block, extrudeAll(2, block, 0, 10, 'new'), boss, extrudeAll(4, boss, 10, 15, 'join')]
}

describe('the boolean guard', () => {
  it('holds a boolean’s volume to what it must come to', () => {
    expect(volumeRefusal({ kind: 'join', parts: [100, 50], result: 140 })).toBeNull()
    expect(volumeRefusal({ kind: 'join', parts: [100, 50], result: 90 })).toMatch(/^the join lost volume/)
    expect(volumeRefusal({ kind: 'join', parts: [100, 50], result: 151 })).toMatch(/^the join made volume/)
    expect(volumeRefusal({ kind: 'cut', body: 100, result: 99 })).toBeNull()
    expect(volumeRefusal({ kind: 'cut', body: 100, result: 101 })).toMatch(/^the cut gained volume/)
    // The identity: the two bodies less what they share, within 0.2 %.
    expect(volumeRefusal({ kind: 'union', body: 100, tool: 50, common: 20, result: 130.2 })).toBeNull()
    expect(volumeRefusal({ kind: 'union', body: 100, tool: 50, common: 20, result: 125 })).toMatch(/less what they share/)
    expect(volumeRefusal({ kind: 'subtract', body: 100, tool: 50, common: 20, result: 80 })).toBeNull()
    expect(volumeRefusal({ kind: 'subtract', body: 100, tool: 50, common: 20, result: 70 })).toMatch(/^the cut left 70 mm³/)
    expect(volumeRefusal({ kind: 'subtract', body: 100, tool: 10, result: 50 })).toMatch(/more than the tool holds/)
    expect(volumeRefusal({ kind: 'intersect', body: 100, tool: 50, result: 60 })).toMatch(/more than the smaller holds/)
  })

  it('plays a join that lost volume again and takes it with a warning, or refuses it saying why', async () => {
    const kernel = await kernelPromise
    let short = 1
    // The fuse comes back as the body alone — closed, valid, the boss lost.
    const k = new Proxy(kernel, {
      get(target, name, receiver) {
        const v = Reflect.get(target, name, receiver) as unknown
        if (name !== 'fuseTracked' || typeof v !== 'function') return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
        return (a: number, b: number) => {
          if (short > 0) {
            short--
            return { shape: target.copy(a as never), history: new Map() }
          }
          return (v as (...x: unknown[]) => unknown).call(target, a, b)
        }
      },
    })
    const builder = new Builder(k as ReKernel)
    const r = request(blockAndBoss())
    const once = builder.build(r.steps, r.sketchOf)
    const join = once.results.find((x) => x.id === 4)!
    expect(join.status).toBe('ok')
    expect(join.warning).toMatch(/^Joining was played again the kernel's other way: the first result the join lost volume/)
    expect(once.bodies[0].volume).toBeCloseTo(20 * 20 * 10 + 10 * 10 * 5, 6)

    short = 99
    const never = new Builder(k as ReKernel).build(r.steps, r.sketchOf)
    const refused = never.results.find((x) => x.id === 4)!
    expect(refused.status).toBe('failed')
    expect(refused.message).toMatch(/^Joining cannot stand: the join lost volume/)
    builder.dispose()
  })

  it('says on a feature’s row when a pick was found by where it lies, not by the feature that made it', async () => {
    const builder = new Builder(await kernelPromise)
    const base = blockAndBoss().slice(0, 2)
    const r = request(base)
    builder.build(r.steps, r.sketchOf)
    const edge = builder.topologyOf(2)!.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99)!
    const round = (origin: number): FilletFeature => ({ id: 5, kind: 'fillet', name: 'Round', body: 2, edges: [{ ...edge.fingerprint, origin }], radius: 1, visible: true }) as FilletFeature
    const honest = request([...base, round(edge.fingerprint.origin)])
    expect(builder.build(honest.steps, honest.sketchOf).results.find((x) => x.id === 5)?.warning).toBeUndefined()
    // The pick says another feature made the edge: found by its place.
    const moved = request([...base, round(edge.fingerprint.origin + 40)])
    const result = builder.build(moved.steps, moved.sketchOf).results.find((x) => x.id === 5)!
    expect(result.status).toBe('ok')
    expect(result.warning).toMatch(/found again by where it lies, not by its maker/)
    builder.dispose()
  })
})
