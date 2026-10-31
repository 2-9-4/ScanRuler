// SPDX-License-Identifier: AGPL-3.0-only
// A pattern's copies know what they copy: a blade patterned round a dish
// and joined to it keeps its copies' faces as the blade's, each marked with
// its copy, so the edges where the blades meet the dish are picked by the
// two features that made the faces either side. A round the kernel traps
// on says once which edges it was given; a step on a body the kernel's
// check fails already says so rather than blaming itself; an extrude to the
// next face whose taper closes says which edge broke.

import { beforeEach, describe, expect, it } from 'vitest'
// The plugin first: the command modules load in its order.
import '../plugin'
import { Builder } from '../core/build'
import type { BooleanFeature, ExtrudeFeature, Feature, FilletFeature, PatternFeature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { KernelError } from '../core/kernelOps'
import { createReService, type ReWorkerResponse } from '../core/reService'
import { resolveFeatures } from '../core/resolve'
import { findRegions } from '../core/regions'
import { addEntity } from '../core/sketch'
import { whereIndices } from '../app/reCommandCore'
import { useReverse } from '../state/reStore'
import { build, extrudeAll, rectangleSketch, sketchOf } from './reKit'
import { loadManifold } from './reLocal'
import { resetReverse } from './reReset'

const kernelPromise = ReKernel.load()

const BLADES = 6

/** A dish Ø80 × 5 and a 20 × 2 blade standing on it, sunk 1 mm in,
 *  patterned round the axis and joined to the dish. */
function fan(): Feature[] {
  const disc = sketchOf(1, (s) => addEntity(s, { kind: 'circle', c: [0, 0], r: 40 }))
  const blade = rectangleSketch(3, 20, 2, [15, -1])
  const pattern: PatternFeature = { id: 5, kind: 'pattern', name: 'Blades', body: 4, mode: 'circular', axis: { kind: 'world', axis: 'z' }, count: BLADES, step: 360, visible: true }
  const join: BooleanFeature = { id: 6, kind: 'boolean', name: 'Join', op: 'join', body: 2, tool: 4, visible: true }
  return [disc, { ...extrudeAll(2, disc, 0, 5), name: 'Dish' }, blade, { ...extrudeAll(4, blade, 4, 15), name: 'Blade' }, pattern, join]
}

function request(features: Feature[]) {
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch] as [number, typeof f.sketch])
  const byId = new Map(sketches)
  return { steps, sketches, sketchOf: (id: number) => byId.get(id) }
}

beforeEach(resetReverse)

describe('pattern copies', () => {
  it('keep the maker of the faces they copy, marked with their copy, so the blade roots are picked by both makers', async () => {
    const builder = new Builder(await kernelPromise)
    const features = fan()
    const out = await build(builder, features)
    expect(out.results.every((r) => r.status === 'ok'), JSON.stringify(out.results)).toBe(true)
    const t = builder.topologyOf(2)!
    // The blade's four walls and its top in every copy, the blade's.
    const copies = t.faces.filter((f) => f.copy)
    expect(copies).toHaveLength((BLADES - 1) * 5)
    expect(copies.every((f) => f.fingerprint.origin === 4 && f.copy!.pattern === 5)).toBe(true)
    for (let i = 1; i < BLADES; i++) expect(copies.filter((f) => f.copy!.instance === i)).toHaveLength(5)
    expect(t.faces.filter((f) => f.fingerprint.origin === 4)).toHaveLength(BLADES * 5)
    expect(t.faces.some((f) => f.fingerprint.origin === 5)).toBe(false)

    useReverse.setState({ features })
    const roots = whereIndices({ sides: { madeBy: ['Blade', 'Dish'] } }, t, { name: 'Dish' }, 'edge')
    expect(roots).toHaveLength(BLADES * 4)
    expect(roots.every((i) => Math.abs(t.edges[i].fingerprint.mid[2] - 5) < 1e-6)).toBe(true)
    // Between the blade's own faces: its upright corners and its top's rim.
    expect(whereIndices({ sides: { madeBy: ['Blade', 'Blade'] } }, t, { name: 'Dish' }, 'edge')).toHaveLength(BLADES * 8)
    expect(() => whereIndices({ sides: { madeBy: ['Blade', 'Dish'] } }, t, { name: 'Dish' }, 'face')).toThrow(/sides picks edges/)
    expect(() => whereIndices({ sides: { madeBy: ['Blade'] } }, t, { name: 'Dish' }, 'edge')).toThrow(/names two features/)
    builder.dispose()
  })

  it('a round the kernel traps on is asked once and says which edges it was given', async () => {
    // The roots, as a round picks them.
    const probe = new Builder(await kernelPromise)
    const r0 = request(fan())
    probe.build(r0.steps, r0.sketchOf)
    const t = probe.topologyOf(2)!
    const origin = new Map(t.faces.map((f) => [f.hash, f.fingerprint.origin]))
    const roots = t.edges.filter((e) => e.faces.map((h) => origin.get(h)).sort().join() === '2,4')
    expect(roots).toHaveLength(BLADES * 4)
    probe.dispose()
    const round: FilletFeature = { id: 7, kind: 'fillet', name: 'Roots', body: 2, edges: roots.map((e) => e.fingerprint), radius: 1, chain: false, skipFailing: true, visible: true }

    let loads = 0
    let calls = 0
    const kernels: ReKernel[] = []
    const load = async () => {
      loads++
      const k = await ReKernel.load()
      const raw = (k as unknown as { occt: Record<string, (...a: unknown[]) => unknown> }).occt
      const fillet = raw.filletWithHistory.bind(raw)
      const first = kernels.length === 0
      raw.filletWithHistory = (...a: unknown[]) => {
        if (first) {
          calls++
          throw new WebAssembly.RuntimeError('memory access out of bounds')
        }
        return fillet(...a)
      }
      kernels.push(k)
      return k
    }
    const service = createReService(load, loadManifold)
    const r = request([...fan(), round])
    const { response } = await service.handle({ type: 'build', requestId: 1, steps: r.steps, sketches: r.sketches })
    const done = response as Extract<ReWorkerResponse, { type: 'build-ok' }>
    expect(done.type).toBe('build-ok')
    // The trap went on at once: the round was not tried again at another
    // size or chain by chain on the broken kernel.
    expect(calls).toBe(1)
    expect(loads).toBe(2)
    const failed = done.results.find((x) => x.id === 7)!
    expect(failed.status).toBe('failed')
    expect(failed.message).toMatch(/^The CAD kernel crashed on this step \(.*memory access out of bounds.*\)/)
    expect(failed.message).toContain(`It was to round ${BLADES * 4} edges between faces made by Dish and Blade (${BLADES * 4}), at (`)
    expect(failed.message).toMatch(/Change the step to try it again\.$/)
  })

  it('a step on a body the kernel check fails says so, naming the step that last changed it', async () => {
    const k = await ReKernel.load()
    const builder = new Builder(k)
    k.isValid = () => false
    k.pattern = () => {
      throw new KernelError('Patterning: the pattern made nothing.')
    }
    const out = await build(builder, fan().slice(0, 5))
    const failed = out.results.find((x) => x.id === 5)!
    expect(failed.status).toBe('failed')
    expect(failed.message).toBe('Patterning: the pattern made nothing — the body it works on already fails the kernel check (last changed by Blade): mend that step — reverse.body.check { before: "Blades" } says what is wrong with it as it stood.')
    builder.dispose()
  })

  it('an extrude to the next face whose taper closes says which edge broke', async () => {
    const builder = new Builder(await kernelPromise)
    const plate = rectangleSketch(1, 60, 60, [-30, -30])
    const rib = rectangleSketch(3, 20, 2, [-10, -1])
    const up: ExtrudeFeature = { id: 4, kind: 'extrude', name: 'Rib', sketchId: 3, regions: findRegions(rib.sketch).map((x) => x.key), extent: { kind: 'toNext', from: 0 }, draftDeg: 30, op: 'new', visible: true }
    const out = await build(builder, [plate, extrudeAll(2, plate, 20, 30), rib, up])
    const failed = out.results.find((x) => x.id === 4)!
    expect(failed.status).toBe('failed')
    expect(failed.message).toMatch(/The taper closes the profile .* the edges? through \(/)
    builder.dispose()
  })
})
