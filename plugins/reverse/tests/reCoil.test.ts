// SPDX-License-Identifier: AGPL-3.0-only
// A revolve with a pitch: the profile screwed about the axis, climbing the
// pitch every turn — a coil of as many turns as the angle holds, the hand
// and the way it climbs as asked, a hole in the profile a hole all the way
// along, and a thread cut into a bar. A profile that would run into its
// next turn, or that touches the axis, is refused, and a plain revolve still
// stops at a full turn.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import { profilesMeetAxis, profileSpan, type Feature, type RevolveFeature, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, addRectangle, emptySketch, type Sketch } from '../core/sketch'
import type { SectionFrame } from '../../../src/core/section/frame'
import { ctx } from './reKit'

// Kernel builds and real-scan fits run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** The XZ plane, seen from −Y: the sheet's X is the part's X, its Y the
 *  part's Z — a profile drawn here turns about Z, the way a lathe part's
 *  section is drawn. */
const XZ: SectionFrame = { origin: [0, 0, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] }

/** A sketch on the XZ plane holding a rectangle from `a` to `b` on the
 *  sheet. */
function profileSketch(a: [number, number], b: [number, number]): SketchFeature {
  const sketch = emptySketch()
  addRectangle(sketch, a, b)
  return { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'y', offset: 0 }, frame: XZ, sketch, visible: true }
}

function coil(sketch: SketchFeature, angleDeg: number, pitch: number, extra: Partial<RevolveFeature> = {}): RevolveFeature {
  return { id: 2, kind: 'revolve', name: 'Coil', sketchId: sketch.id, regions: findRegions(sketch.sketch).map((r) => r.key), axis: { kind: 'world', axis: 'z' }, angleDeg, pitch, op: 'new', visible: true, ...extra }
}

async function build(features: Feature[]) {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, ctx, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return { result: builder.build(steps, (id) => sketches.get(id)), builder, k, steps }
}

/** A section of area A whose middle is R off the axis, screwed through
 *  `turns`: Pappus — the climb along the axis adds nothing. */
const pappus = (area: number, radius: number, turns: number) => area * 2 * Math.PI * radius * turns

describe('a revolve with a pitch', () => {
  it('coils on past a full turn, climbing the pitch every turn', async () => {
    // 4 × 2 at 8..12 from the Z axis, 5 mm a turn, three turns.
    const s = profileSketch([8, -1], [12, 1])
    const { result, builder, k } = await build([s, coil(s, 1080, 5)])
    expect(result.results[0].status).toBe('ok')
    const body = result.bodies[0]
    expect(body.closed).toBe(true)
    expect(Math.abs(body.volume - pappus(8, 10, 3)) / pappus(8, 10, 3)).toBeLessThan(1e-5)
    // Each side of the section is one face however many turns: four sides
    // and the two ends.
    expect(body.faces).toBe(6)
    const b = k.bounds(builder.body(2)!)
    expect(b.min[2]).toBeCloseTo(-1, 3)
    expect(b.max[2]).toBeCloseTo(16, 3)
    expect(b.max[0]).toBeCloseTo(12, 2)
    builder.dispose()
  })

  it('turns as a right-hand screw, or a left-hand one, and climbs the other way with a negative pitch', async () => {
    const s = profileSketch([8, -1], [12, 1])
    const right = await build([s, coil(s, 720, 5)])
    const left = await build([s, coil(s, 720, 5, { leftHanded: true })])
    const down = await build([s, coil(s, 720, -5)])
    // A quarter turn on, the profile's middle has climbed a quarter pitch:
    // to +Y turning counter-clockwise about +Z, to −Y the other hand.
    const at = (r: Awaited<ReturnType<typeof build>>, p: [number, number, number]) => r.k.containsPoint(r.builder.body(2)!, p)
    expect(at(right, [0, 10, 1.25])).toBe(true)
    expect(at(right, [0, -10, 1.25])).toBe(false)
    expect(at(left, [0, -10, 1.25])).toBe(true)
    expect(at(left, [0, 10, 1.25])).toBe(false)
    expect(left.result.bodies[0].volume).toBeCloseTo(right.result.bodies[0].volume, 6)
    // Climbing down, still right-handed: counter-clockwise seen down the
    // way it climbs, which is clockwise about +Z.
    expect(at(down, [0, -10, -1.25])).toBe(true)
    const b = down.k.bounds(down.builder.body(2)!)
    expect(b.max[2]).toBeCloseTo(1, 3)
    expect(b.min[2]).toBeCloseTo(-11, 3)
    for (const r of [right, left, down]) r.builder.dispose()
  })

  it('runs a hole in the profile the whole way along', async () => {
    const sketch = emptySketch()
    addEntity(sketch, { kind: 'circle', c: [10, 0], r: 2.5 })
    addEntity(sketch, { kind: 'circle', c: [10, 0], r: 1.5 })
    const s: SketchFeature = { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'y', offset: 0 }, frame: XZ, sketch, visible: true }
    const tube = findRegions(sketch).find((r) => r.holes.length > 0)!
    const { result, builder } = await build([s, { ...coil(s, 1080, 6), regions: [tube.key] }])
    expect(result.results[0].status).toBe('ok')
    const want = pappus(Math.PI * (2.5 ** 2 - 1.5 ** 2), 10, 3)
    expect(Math.abs(result.bodies[0].volume - want) / want).toBeLessThan(1e-4)
    builder.dispose()
  })

  it('cuts a thread into a bar', async () => {
    // A Ø10 bar 20 long up Z, and a 60° vee 0.9 deep reaching past its
    // surface, 1.5 mm a turn, twelve turns.
    const bar = emptySketch()
    addEntity(bar, { kind: 'circle', c: [0, 0], r: 5 })
    const barSketch: SketchFeature = { id: 1, kind: 'sketch', name: 'Bar', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, sketch: bar, visible: true }
    const vee = emptySketch()
    const h = 0.65
    const pts: [number, number][] = [[5.3, 1 - h], [5.3, 1 + h], [5.3 - 1.2, 1]]
    for (let i = 0; i < 3; i++) addEntity(vee, { kind: 'line', a: pts[i], b: pts[(i + 1) % 3] })
    const veeSketch: SketchFeature = { id: 3, kind: 'sketch', name: 'Vee', plane: { kind: 'world', axis: 'y', offset: 0 }, frame: XZ, sketch: vee, visible: true }
    const { result, builder } = await build([
      barSketch,
      { id: 2, kind: 'extrude', name: 'Bar', sketchId: 1, regions: findRegions(bar).map((r) => r.key), extent: { kind: 'distance', from: 0, to: 20 }, op: 'new', visible: true },
      veeSketch,
      { id: 4, kind: 'revolve', name: 'Thread', sketchId: 3, regions: findRegions(vee).map((r) => r.key), axis: { kind: 'world', axis: 'z' }, angleDeg: 360 * 12, pitch: 1.5, op: 'cut', visible: true },
    ])
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(result.bodies.length).toBe(1)
    expect(result.bodies[0].closed).toBe(true)
    const cylinder = Math.PI * 25 * 20
    expect(result.bodies[0].volume).toBeLessThan(cylinder * 0.95)
    expect(result.bodies[0].volume).toBeGreaterThan(cylinder * 0.7)
    builder.dispose()
  })

  it('refuses a profile that would run into its next turn, and one on the axis', async () => {
    const tall = profileSketch([8, -2], [12, 2])
    const crowded = await build([tall, coil(tall, 720, 3)])
    expect(crowded.result.results[0].status).toBe('failed')
    expect(crowded.result.results[0].message).toMatch(/reaches 4\.000 mm along the axis — as far as the pitch of 3\.000 mm or further/)
    // Under one turn it never meets itself.
    const half = await build([tall, coil(tall, 180, 3)])
    expect(half.result.results[0].status).toBe('ok')
    const onAxis = profileSketch([0, -1], [4, 1])
    const touching = await build([onAxis, coil(onAxis, 720, 5)])
    expect(touching.result.results[0].message).toMatch(/touches or crosses the axis/)
    // Across it, the ends of every side well clear of it.
    const across = profileSketch([-1, -1], [3, 1])
    const crossing = await build([across, coil(across, 720, 5)])
    expect(crossing.result.results[0].message).toMatch(/touches or crosses the axis/)
    crowded.builder.dispose()
    half.builder.dispose()
    touching.builder.dispose()
    crossing.builder.dispose()
  })

  it('keeps a plain revolve to a full turn', async () => {
    const s = profileSketch([8, -1], [12, 1])
    const { steps } = await build([s, coil(s, 720, 0)])
    expect(steps[0]).toMatchObject({ kind: 'failed', message: expect.stringMatching(/360° at most — give it a pitch/) })
    const plain = await build([s, coil(s, 360, 0)])
    expect(plain.result.results[0].status).toBe('ok')
    expect(plain.result.bodies[0].volume).toBeCloseTo(pappus(8, 10, 1), 3)
    plain.builder.dispose()
  })

  it('measures how far profiles reach along an axis, and whether they meet it', () => {
    const profilesOf = (s: SketchFeature) => {
      const step = resolveFeatures([s, coil(s, 360, 5)], ctx, (f) => findRegions(f.sketch))[0]
      if (step.kind !== 'revolve') throw new Error('expected a revolve step')
      return step.profiles
    }
    const clear = profilesOf(profileSketch([8, -1], [12, 2]))
    const span = profileSpan(clear, [0, 0, 0], [0, 0, 1])
    expect(span.min).toBeCloseTo(-1, 9)
    expect(span.max).toBeCloseTo(2, 9)
    // The Z axis runs in the sketch's plane, clear of it, on it, across it.
    expect(profilesMeetAxis(clear, [0, 0, 0], [0, 0, 1])).toBe(false)
    expect(profilesMeetAxis(profilesOf(profileSketch([0, -1], [4, 1])), [0, 0, 0], [0, 0, 1])).toBe(true)
    expect(profilesMeetAxis(profilesOf(profileSketch([-1, -1], [3, 1])), [0, 0, 0], [0, 0, 1])).toBe(true)
    // An axis through the plane: outside the profile, inside it, inside a hole.
    expect(profilesMeetAxis(clear, [0, 0, 0], [0, 1, 0])).toBe(false)
    expect(profilesMeetAxis(clear, [10, 0, 0], [0, 1, 0])).toBe(true)
    const ring = emptySketch()
    addEntity(ring, { kind: 'circle', c: [10, 0], r: 3 })
    addEntity(ring, { kind: 'circle', c: [10, 0], r: 1 })
    const washer: SketchFeature = { ...profileSketch([0, 0], [1, 1]), sketch: ring }
    const annulus = resolveFeatures([washer, { ...coil(washer, 360, 5), regions: [findRegions(ring).find((r) => r.holes.length > 0)!.key] }], ctx, (f) => findRegions(f.sketch))[0]
    if (annulus.kind !== 'revolve') throw new Error('expected a revolve step')
    expect(profilesMeetAxis(annulus.profiles, [10, 0, 0], [0, 1, 0])).toBe(false)
    expect(profilesMeetAxis(annulus.profiles, [12, 0, 0], [0, 1, 0])).toBe(true)
    expect(profilesMeetAxis(annulus.profiles, [11, 0, 0], [0, 1, 0])).toBe(true)
  })
})
