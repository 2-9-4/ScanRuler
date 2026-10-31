// SPDX-License-Identifier: AGPL-3.0-only
// An extrude's taper: the profile's outline moved in or out as the sides
// lean — where it holds and where it breaks (a rectangle closing, a neck
// pinching off, a slot or a hole closing) — and the taper through the
// kernel: the sketch's own outline is the section at the sketch plane
// whichever way the extrude runs, an extent reaching both ways leans both
// ways from it, a plane is reached by a prism that leans to it, and a taper
// that would close the profile is refused, saying where.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { type ExtrudeFeature, type Feature, type ResolveContext, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel, rectangleLoop } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, type Sketch } from '../core/sketch'
import { signedArea2 as signedArea } from '../../../src/core/flat/vec2'
import { faceOutline, insetHolds, taperReach, type Loop2 } from '../core/taper'
import type { PlaneFit } from '../../../src/core/types'
import { rectangleSketch, XY } from './reKit'

const kernelPromise = ReKernel.load()

const NO_STATS = { sigma: 0, usedPoints: 0, regionSize: 0 }
const rad = (deg: number) => (deg * Math.PI) / 180

const rect = (x0: number, y0: number, x1: number, y1: number): Loop2 => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const ring = (r: number, n = 64): Loop2 => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)])

describe('the outline a taper moves', () => {
  it('holds a rectangle until its narrow side closes', () => {
    const r = [rect(0, 0, 40, 20)]
    expect(insetHolds(r, 0)).toBe(true)
    expect(insetHolds(r, 9.9)).toBe(true)
    expect(insetHolds(r, 10.1)).toBe(false)
    // Leaning out, a convex outline only grows.
    expect(insetHolds(r, -500)).toBe(true)
  })

  it('catches a neck that pinches off though no edge shrinks away', () => {
    // Two 20 mm squares joined by a neck 2 mm wide: every edge keeps its
    // length moved in by 1.5, but the neck's two walls pass each other.
    const dumbbell: Loop2 = [[0, 0], [20, 0], [20, 9], [30, 9], [30, 0], [50, 0], [50, 20], [30, 20], [30, 11], [20, 11], [20, 20], [0, 20]]
    expect(insetHolds([dumbbell], 0.9)).toBe(true)
    expect(insetHolds([dumbbell], 1.1)).toBe(false)
  })

  it('catches a slot or a hole closing as the sides lean out', () => {
    const slotted: Loop2 = [[0, 0], [20, 0], [20, 20], [11, 20], [11, 5], [9, 5], [9, 20], [0, 20]]
    expect(insetHolds([slotted], -0.9)).toBe(true)
    expect(insetHolds([slotted], -1.1)).toBe(false)
    // A plate with a round hole of radius 3, the hole run clockwise.
    const plate = [rect(-20, -10, 20, 10), ring(3).reverse()]
    expect(insetHolds(plate, -2.9)).toBe(true)
    expect(insetHolds(plate, -3.1)).toBe(false)
    // Leaning in, the hole opens and the wall round it thins: 7 mm of it.
    expect(insetHolds(plate, 3.4)).toBe(true)
    expect(insetHolds(plate, 3.6)).toBe(false)
  })

  it('closes a round where its radius runs out', () => {
    expect(insetHolds([ring(5)], 4.9)).toBe(true)
    expect(insetHolds([ring(5)], 5.1)).toBe(false)
  })

  it('finds how far a taper can run', () => {
    // 45°: the 20 mm side closes 10 mm out.
    expect(taperReach([rect(0, 0, 40, 20)], 1, 30)).toBeCloseTo(10, 2)
    expect(taperReach([rect(0, 0, 40, 20)], 1, 8)).toBe(8)
    expect(taperReach([rect(0, 0, 40, 20)], -1, 30)).toBe(30)
  })

  it('reads a face’s loops off the kernel’s edges, the face on their left', async () => {
    const k = await kernelPromise
    const face = k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], 40, 20), holes: [[{ kind: 'circle', center: [20, 10, 0], normal: [0, 0, 1], radius: 3 }]] })
    const loops = faceOutline(k.edges(face, 0.01), [0, 0, 0], [1, 0, 0], [0, 1, 0])
    k.release(face)
    expect(loops.length).toBe(2)
    const areas = loops.map((l) => signedArea(l.points)).sort((a, b) => b - a)
    expect(areas[0]).toBeCloseTo(800, 3)
    expect(areas[1]).toBeCloseTo(-Math.PI * 9, 0)
    // Seen from the other side, the same loops come back the same way round.
    const flipped = faceOutline(k.edges(k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], 40, 20), holes: [] }), 0.01), [0, 0, 0], [0, 1, 0], [1, 0, 0])
    expect(signedArea(flipped[0].points)).toBeCloseTo(800, 3)
  })
})

function tapered(id: number, sketch: SketchFeature, extent: ExtrudeFeature['extent'], draftDeg: number, op: ExtrudeFeature['op'] = 'new'): ExtrudeFeature {
  return { id, kind: 'extrude', name: `Extrude ${id}`, sketchId: sketch.id, regions: findRegions(sketch.sketch).map((r) => r.key), extent, draftDeg, op, visible: true }
}

const ctx = (elements: { id: number; fit: PlaneFit }[] = []): ResolveContext => ({ sections: [], elements, modelCenter: [0, 0, 0] })

async function build(features: Feature[], c: ResolveContext = ctx()) {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, c, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return { result: builder.build(steps, (id) => sketches.get(id)), builder, k }
}

/** A 40 × 20 rectangle drafted `deg` over `h`: the frustum's volume. */
function frustum(h: number, deg: number, w = 40, d = 20): number {
  const t = h * Math.tan(rad(deg))
  const top = (w - 2 * t) * (d - 2 * t)
  return (h / 3) * (w * d + top + Math.sqrt(w * d * top))
}

/** The flat faces of a body square to Z, by their height: their areas. */
function capsOf(builder: Builder, id: number): Map<number, number> {
  const caps = new Map<number, number>()
  for (const f of builder.topologyOf(id)!.faces) {
    if (f.fingerprint.kind === 'plane' && Math.abs(f.fingerprint.dir[2]) > 0.999) caps.set(Math.round(f.fingerprint.centroid[2] * 1000) / 1000, f.fingerprint.area)
  }
  return caps
}

describe('an extrude with a taper', () => {
  it('keeps the profile at the sketch plane whichever way it runs', async () => {
    const s = rectangleSketch(1, 40, 20)
    const up = await build([s, tapered(2, s, { kind: 'distance', from: 0, to: 10 }, 10)])
    const down = await build([s, tapered(2, s, { kind: 'distance', from: 0, to: -10 }, 10)])
    expect(down.result.results[0].status).toBe('ok')
    expect(Math.abs(down.result.bodies[0].volume - frustum(10, 10)) / frustum(10, 10)).toBeLessThan(1e-3)
    expect(Math.abs(down.result.bodies[0].volume - up.result.bodies[0].volume)).toBeLessThan(1e-6 * frustum(10, 10))
    // The full 40 × 20 at z = 0 both times, the narrow end away from it.
    const caps = capsOf(down.builder, 2)
    expect(caps.get(0)).toBeCloseTo(800, 3)
    expect(caps.get(-10)!).toBeLessThan(800)
    expect(capsOf(up.builder, 2).get(0)).toBeCloseTo(800, 3)
    up.builder.dispose()
    down.builder.dispose()
  })

  it('leans both ways from the sketch plane when it reaches both ways', async () => {
    const s = rectangleSketch(1, 40, 20)
    const sym = await build([s, tapered(2, s, { kind: 'symmetric', total: 20 }, 10)])
    const both = await build([s, tapered(2, s, { kind: 'distance', from: -4, to: 10 }, 10)])
    expect(sym.result.results[0].status).toBe('ok')
    expect(sym.result.bodies[0].closed).toBe(true)
    expect(sym.result.bodies.length).toBe(1)
    expect(Math.abs(sym.result.bodies[0].volume - 2 * frustum(10, 10)) / frustum(10, 10)).toBeLessThan(2e-3)
    // Widest at the sketch plane: as wide as the rectangle there.
    const b = sym.k.bounds(sym.builder.body(2)!)
    expect(b.max[0] - b.min[0]).toBeCloseTo(40, 4)
    expect(Math.abs(both.result.bodies[0].volume - frustum(10, 10) - frustum(4, 10)) / frustum(10, 10)).toBeLessThan(2e-3)
    sym.builder.dispose()
    both.builder.dispose()
  })

  it('starts leaning at an offset start, and leans out with a negative draft', async () => {
    const s = rectangleSketch(1, 40, 20)
    const off = await build([s, tapered(2, s, { kind: 'distance', from: 5, to: 15 }, 10)])
    expect(capsOf(off.builder, 2).get(5)).toBeCloseTo(800, 3)
    expect(Math.abs(off.result.bodies[0].volume - frustum(10, 10)) / frustum(10, 10)).toBeLessThan(1e-3)
    const out = await build([s, tapered(2, s, { kind: 'distance', from: 0, to: 30 }, -10)])
    const t = 30 * Math.tan(rad(10))
    expect(capsOf(out.builder, 2).get(30)).toBeCloseTo((40 + 2 * t) * (20 + 2 * t), 0)
    off.builder.dispose()
    out.builder.dispose()
  })

  it('reaches a plane, straight or tilted, leaning all the way to it', async () => {
    const s = rectangleSketch(1, 40, 20, [-20, -10])
    const flat: { id: number; fit: PlaneFit } = { id: 10, fit: { kind: 'plane', center: [0, 0, 15], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 50, extentV: 50, ...NO_STATS } }
    const toFlat = await build([s, tapered(2, s, { kind: 'toPlane', from: 0, plane: { kind: 'plane', id: 10 } }, 10)], ctx([flat]))
    expect(toFlat.result.results[0].status).toBe('ok')
    // The kernel measures its draft at the face, the frustum here at the
    // corners: a tenth of a percent apart over 10 mm, more over 15.
    expect(Math.abs(toFlat.result.bodies[0].volume - frustum(15, 10)) / frustum(15, 10)).toBeLessThan(2e-3)
    expect(toFlat.k.bounds(toFlat.builder.body(2)!).max[2]).toBeCloseTo(15, 6)
    // Tilted 20° about Y and leaned out: the high side of the plane is
    // further off than any corner of the sketch reaches straight up.
    const n: [number, number, number] = [Math.sin(rad(20)), 0, Math.cos(rad(20))]
    const tilted: { id: number; fit: PlaneFit } = { id: 11, fit: { kind: 'plane', center: [0, 0, 15], normal: n, basisU: [Math.cos(rad(20)), 0, -Math.sin(rad(20))], basisV: [0, 1, 0], extentU: 80, extentV: 80, ...NO_STATS } }
    const toTilted = await build([s, tapered(2, s, { kind: 'toPlane', from: 0, plane: { kind: 'plane', id: 11 } }, -15)], ctx([tilted]))
    expect(toTilted.result.results[0].status).toBe('ok')
    expect(toTilted.result.bodies[0].closed).toBe(true)
    // The top is on the plane everywhere: no cap of the prism is left
    // standing short of it.
    const caps = capsOf(toTilted.builder, 2)
    expect([...caps.keys()]).toEqual([0])
    toFlat.builder.dispose()
    toTilted.builder.dispose()
  })

  it('reaches a face of a body, leaning from the sketch down to it', async () => {
    const block = rectangleSketch(1, 40, 20)
    const plate = tapered(2, block, { kind: 'distance', from: 0, to: 10 }, 0)
    const first = await build([block, plate])
    const top = first.result.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9 && Math.abs(f.fingerprint.centroid[2] - 10) < 1e-6)!.fingerprint
    first.builder.dispose()
    // A 10 × 10 square 30 mm up, reaching down to the plate's top: 20 mm
    // of frustum, the square at the sketch and narrower at the plate.
    const square = { ...rectangleSketch(3, 10, 10, [15, 5]), frame: { ...XY, origin: [0, 0, 30] as [number, number, number] }, plane: { kind: 'world' as const, axis: 'z' as const, offset: 30 } }
    const post = tapered(4, square, { kind: 'toFace', from: 0, body: 2, face: top }, 10)
    const { result, builder } = await build([block, plate, square, post])
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    const made = result.bodies.find((b) => b.id === 4)!
    expect(Math.abs(made.volume - frustum(20, 10, 10, 10)) / frustum(20, 10, 10, 10)).toBeLessThan(2e-3)
    const caps = capsOf(builder, 4)
    expect(caps.get(30)).toBeCloseTo(100, 3)
    expect(caps.get(10)!).toBeLessThan(100)
    builder.dispose()
  })

  it('refuses a taper that closes the profile, saying where', async () => {
    const s = rectangleSketch(1, 40, 20)
    const { result, builder } = await build([s, tapered(2, s, { kind: 'distance', from: 0, to: 120 }, 10)])
    expect(result.results[0].status).toBe('failed')
    // The 20 mm side closes at 10 / tan 10° = 56.71 mm.
    expect(result.results[0].message).toMatch(/closes the profile 56\.7\d mm from where it starts, and the extrude runs 120\.00 mm/)
    builder.dispose()
  })

  it('refuses a taper leaning out that closes a hole of the profile', async () => {
    const s = rectangleSketch(1, 40, 20)
    addEntity(s.sketch, { kind: 'circle', c: [20, 10], r: 3 })
    const plate = { ...tapered(2, s, { kind: 'distance', from: 0, to: 30 }, -10), regions: [findRegions(s.sketch).find((r) => r.holes.length > 0)!.key] }
    const { result, builder } = await build([s, plate])
    expect(result.results[0].status).toBe('failed')
    // A hole of radius 3 closes at 3 / tan 10° = 17.01 mm.
    expect(result.results[0].message).toMatch(/closes a hole or a notch of the profile 17\.0\d mm/)
    const fine = await build([s, { ...plate, extent: { kind: 'distance', from: 0, to: 15 } }])
    expect(fine.result.results[0].status).toBe('ok')
    builder.dispose()
    fine.builder.dispose()
  })

  it('cuts through all with a taper, leaning from the sketch', async () => {
    const block = rectangleSketch(1, 40, 20)
    const pocket = rectangleSketch(3, 10, 10, [15, 5])
    const { result, builder } = await build([
      block,
      tapered(2, block, { kind: 'distance', from: 0, to: 10 }, 0),
      { ...pocket, frame: { ...XY, origin: [0, 0, 10] }, plane: { kind: 'world', axis: 'z', offset: 10 } },
      tapered(4, pocket, { kind: 'toLast', from: 0, reverse: true }, 10, 'cut'),
    ])
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    // A pyramid's frustum out of the block: 10 × 10 at the top, narrower
    // through to the bottom.
    expect(result.bodies[0].volume).toBeLessThan(8000 - 10 * (10 - 2 * 10 * Math.tan(rad(10))) ** 2)
    expect(result.bodies[0].volume).toBeGreaterThan(8000 - 1000)
    expect(result.bodies[0].closed).toBe(true)
    builder.dispose()
  })
})
