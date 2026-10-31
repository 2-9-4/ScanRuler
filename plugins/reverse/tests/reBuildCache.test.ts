// SPDX-License-Identifier: AGPL-3.0-only
// The builder's states by the steps that led to them, bounded by bytes: a
// radius edited three times and set back to the first plays nothing; the
// rollback bar moved to every place in the list and back is a state looked
// up each time; under a budget the states held come within it, the build
// standing's always kept; and a round's step reads the faces and edges of
// the body it is on once, however often the step looks.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { type Feature, type FilletFeature, type SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, addRectangle } from '../core/sketch'
import { extrudeAll, sketchOf } from './reKit'

const kernelPromise = ReKernel.load()

/** A plate with a hole, then a round on each of its upright corners —
 *  six features, eight steps with the sketches. */
async function plate(radius = 2): Promise<Feature[]> {
  const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [40, 20]))
  const circle = sketchOf(3, (s) => addEntity(s, { kind: 'circle', c: [20, 10], r: 3 }))
  const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new'), circle, extrudeAll(4, circle, -1, 6, 'cut', 2)]
  const probe = new Builder(await kernelPromise)
  const { steps, sketchOf: of } = request(base)
  probe.build(steps, of)
  const corners = probe.topologyOf(2)!.edges.filter((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99 && e.fingerprint.length > 4.9)
  probe.dispose()
  const rounds = corners.slice(0, 2).map((e, i): FilletFeature => ({ id: 5 + i, kind: 'fillet', name: `Round ${i + 1}`, body: 2, edges: [e.fingerprint], radius, visible: true }) as FilletFeature)
  return [...base, ...rounds]
}

function request(features: Feature[]) {
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const byId = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return { steps, sketchOf: (id: number) => byId.get(id) }
}

/** The last round's radius set. */
const withRadius = (features: Feature[], radius: number) => features.map((f, i) => (i === features.length - 1 ? ({ ...f, radius } as Feature) : f))

describe('the builder’s states by the steps that led to them', () => {
  it('plays nothing for a value set back, however many edits came between', async () => {
    const builder = new Builder(await kernelPromise)
    const features = await plate()
    const build = (fs: Feature[]) => {
      const r = request(fs)
      return builder.build(r.steps, r.sketchOf, true)
    }
    const n = request(features).steps.length
    const first = build(features)
    expect(builder.lastSteps).toMatchObject({ recomputed: n, restored: 0, of: n })
    for (const radius of [2.5, 3, 3.5]) {
      build(withRadius(features, radius))
      expect(builder.lastSteps).toMatchObject({ recomputed: 1, restored: n - 1, of: n })
    }
    const back = build(features)
    expect(builder.lastSteps).toMatchObject({ recomputed: 0, restored: n, of: n })
    expect(back.bodies[0].volume).toBeCloseTo(first.bodies[0].volume, 6)
    // The radius before it, too.
    build(withRadius(features, 3))
    expect(builder.lastSteps.recomputed).toBe(0)
    builder.dispose()
  })

  it('moves the rollback bar anywhere and back as a state looked up', async () => {
    const builder = new Builder(await kernelPromise)
    const features = await plate()
    const full = request(features)
    builder.build(full.steps, full.sketchOf, true)
    for (let n = full.steps.length - 1; n >= 0; n--) {
      builder.build(full.steps.slice(0, n), full.sketchOf, true)
      expect(builder.lastSteps).toMatchObject({ recomputed: 0, restored: n, of: n })
    }
    builder.build(full.steps, full.sketchOf, true)
    expect(builder.lastSteps.recomputed).toBe(0)
    builder.dispose()
  })

  it('keeps what it holds within its budget, the build standing whatever it holds', async () => {
    const builder = new Builder(await kernelPromise)
    const features = await plate()
    const build = (fs: Feature[]) => {
      const r = request(fs)
      return builder.build(r.steps, r.sketchOf, true)
    }
    const n = request(features).steps.length
    build(features)
    const one = builder.cacheHeld()
    expect(one.bytes).toBeGreaterThan(0)
    for (const radius of [2.5, 3, 3.5, 4]) build(withRadius(features, radius))
    const five = builder.cacheHeld()
    expect(five.bytes).toBeGreaterThan(one.bytes)
    // A byte under it: the build standing — 3.5 again — is kept, and the
    // oldest used of the others goes, the first radius, 2; the rest stay.
    builder.cacheBudget = five.bytes - 1
    build(withRadius(features, 3.5))
    expect(builder.lastSteps.recomputed).toBe(0)
    expect(builder.cacheHeld().bytes).toBeLessThanOrEqual(builder.cacheBudget)
    builder.cacheBudget = Infinity
    for (const radius of [2.5, 3, 4]) {
      build(withRadius(features, radius))
      expect(builder.lastSteps.recomputed).toBe(0)
    }
    build(features)
    expect(builder.lastSteps).toMatchObject({ recomputed: 1, restored: n - 1, of: n })
    // Nothing at all: the build standing alone.
    builder.cacheBudget = 0
    build(withRadius(features, 4))
    expect(builder.cacheHeld().states).toBe(n)
    build(features)
    expect(builder.lastSteps).toMatchObject({ recomputed: 1, restored: n - 1, of: n })
    builder.dispose()
  })

  it('reads the faces and edges of the body a round is on once', async () => {
    const kernel = await kernelPromise
    let edges = 0
    let faces = 0
    const counted = new Proxy(kernel, {
      get(target, name, receiver) {
        const v = Reflect.get(target, name, receiver) as unknown
        if (typeof v !== 'function') return v
        return (...args: unknown[]) => {
          if (name === 'edges') edges++
          if (name === 'faces') faces++
          return (v as (...a: unknown[]) => unknown).apply(target, args)
        }
      },
    })
    const builder = new Builder(counted)
    const features = await plate()
    const base = request(features.slice(0, -1))
    builder.build(base.steps, base.sketchOf, true)
    edges = 0
    faces = 0
    const full = request(features)
    builder.build(full.steps, full.sketchOf, true)
    // The round's picks read the body before it once — the step looks at
    // its edges twice — and the body after it is read once to hand it over.
    expect(builder.lastSteps.recomputed).toBe(1)
    expect(edges).toBe(2)
    expect(faces).toBe(2)
    builder.dispose()
  })
})
