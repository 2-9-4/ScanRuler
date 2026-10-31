// SPDX-License-Identifier: AGPL-3.0-only
// Picked regions that share a stretch of their boundary go to the kernel
// as one profile: a socket boss drawn as a circle with two bars across it,
// its nine regions picked, is one face — one prism, no fuse, and no seam
// left on the circle where the bars crossed it — and builds as the same
// outline drawn once does. Regions touching at a corner stay two; a hole
// whose inside is picked too is filled.
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import { findRegions, mergeRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, addRectangle, emptySketch, type Sketch } from '../core/sketch'
import { build, ctx, extrudeAll, sketchOf } from './reKit'

const kernelPromise = ReKernel.load()

/** The boss: a circle R14 with a bar across it and a bar down from it. */
const boss = (s: Sketch) => {
  addEntity(s, { kind: 'circle', c: [0, 0], r: 14 })
  addRectangle(s, [-18, -3], [18, 3])
  addRectangle(s, [-3, -18], [3, 0])
}

/** The same outline drawn once: the bars' ends and the arcs between. */
const outline = (s: Sketch) => {
  const r = 14
  const a = (y: number) => Math.sqrt(r * r - y * y)
  // Walked clockwise: each arc runs counter-clockwise from where the walk
  // leaves it back to where it came on.
  const arc = (from: Vec2, to: Vec2) => {
    const start = Math.atan2(to[1], to[0])
    let sweep = Math.atan2(from[1], from[0]) - start
    if (sweep < 0) sweep += 2 * Math.PI
    addEntity(s, { kind: 'arc', c: [0, 0], r, start, sweep })
  }
  const pts: Vec2[] = [[a(3), 3], [18, 3], [18, -3], [a(3), -3]]
  addEntity(s, { kind: 'line', a: pts[0], b: pts[1] })
  addEntity(s, { kind: 'line', a: pts[1], b: pts[2] })
  addEntity(s, { kind: 'line', a: pts[2], b: pts[3] })
  arc([a(3), -3], [3, -a(3)])
  addEntity(s, { kind: 'line', a: [3, -a(3)], b: [3, -18] })
  addEntity(s, { kind: 'line', a: [3, -18], b: [-3, -18] })
  addEntity(s, { kind: 'line', a: [-3, -18], b: [-3, -a(3)] })
  arc([-3, -a(3)], [-a(3), -3])
  addEntity(s, { kind: 'line', a: [-a(3), -3], b: [-18, -3] })
  addEntity(s, { kind: 'line', a: [-18, -3], b: [-18, 3] })
  addEntity(s, { kind: 'line', a: [-18, 3], b: [-a(3), 3] })
  arc([-a(3), 3], [a(3), 3])
}

describe('picked regions that share edges', () => {
  it('are one profile: the boss’s nine regions one face, its circle in three arcs, as drawn once', async () => {
    const sk = sketchOf(1, boss)
    const regions = findRegions(sk.sketch)
    expect(regions.length).toBe(9)
    const merged = mergeRegions(regions, sk.sketch)
    expect(merged.length).toBe(1)
    expect(merged[0].holes).toEqual([])
    // No seam where a bar crossed the circle: three arcs between the bars,
    // and the bars' ends.
    const kinds = merged[0].outer.pieces.map((p) => sk.sketch.entities.find((e) => e.id === p.entity)!.kind)
    expect(kinds.filter((k) => k === 'circle').length).toBe(3)
    expect(kinds.filter((k) => k === 'line').length).toBe(9)
    expect(merged[0].area).toBeCloseTo(regions.reduce((s, r) => s + r.area, 0), 9)
    // One profile to the kernel.
    const steps = resolveFeatures([sk, extrudeAll(2, sk, 0, 10)], ctx, (f) => findRegions(f.sketch))
    const extrude = steps.find((s) => s.id === 2)
    expect(extrude?.kind === 'extrude' && extrude.profiles.length).toBe(1)
    // Built, it is the outline drawn once: the same faces, the same volume.
    const builder = new Builder(await kernelPromise)
    const a = await build(builder, [sk, extrudeAll(2, sk, 0, 10)])
    const once = sketchOf(1, outline)
    expect(findRegions(once.sketch).length).toBe(1)
    const b = await build(builder, [once, extrudeAll(2, once, 0, 10)])
    builder.dispose()
    expect(a.results.find((r) => r.id === 2)?.status).toBe('ok')
    const count = (out: typeof a) => {
      const kinds = new Map<string, number>()
      for (const f of out.bodies[0].topology.faces) kinds.set(f.fingerprint.kind, (kinds.get(f.fingerprint.kind) ?? 0) + 1)
      return Object.fromEntries(kinds)
    }
    expect(count(a)).toEqual(count(b))
    expect(count(a)).toEqual({ cylinder: 3, plane: 11 })
    expect(a.bodies[0].volume).toBeCloseTo(b.bodies[0].volume, 3)
  })

  it('touching at a corner only, stay two', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [10, 10])
    addRectangle(s, [10, 10], [20, 20])
    const regions = findRegions(s)
    expect(regions.length).toBe(2)
    expect(mergeRegions(regions, s).length).toBe(2)
  })

  it('fill a hole whose inside is picked too, and leave regions apart alone', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [30, 30])
    addEntity(s, { kind: 'circle', c: [15, 15], r: 5 })
    addRectangle(s, [50, 0], [60, 10])
    const regions = findRegions(s)
    expect(regions.length).toBe(3)
    const merged = mergeRegions(regions, s)
    expect(merged.length).toBe(2)
    const square = merged.find((r) => Math.abs(r.area - 900) < 1e-6)!
    expect(square.holes).toEqual([])
    expect(square.outer.pieces.length).toBe(4)
    // The square with its hole alone is as it was.
    const alone = regions.filter((r) => r.holes.length === 1)
    expect(mergeRegions(alone, s)).toEqual(alone)
  })

  it('tapered, stay one profile each, as a project saved before has them; untapered, are one', async () => {
    // A 20 × 10 rectangle split down its middle, both halves picked, 10
    // tall: each half's sides lean on their own with a taper — a groove
    // between them — and the two make one block without.
    const sk = sketchOf(1, (s) => {
      addRectangle(s, [0, 0], [20, 10])
      addEntity(s, { kind: 'line', a: [10, 0], b: [10, 10] })
    })
    expect(findRegions(sk.sketch).length).toBe(2)
    const tapered = { ...extrudeAll(2, sk, 0, 10), draftDeg: 10 }
    const profiles = (f: ReturnType<typeof extrudeAll>) => {
      const step = resolveFeatures([sk, f], ctx, (x) => findRegions(x.sketch)).find((s) => s.id === 2)
      return step?.kind === 'extrude' ? step.profiles.length : null
    }
    expect(profiles(tapered)).toBe(2)
    expect(profiles(extrudeAll(2, sk, 0, 10))).toBe(1)
    const builder = new Builder(await kernelPromise)
    const leaning = await build(builder, [sk, tapered])
    const straight = await build(builder, [sk, extrudeAll(2, sk, 0, 10)])
    builder.dispose()
    // Two halves each 10 × 10 at the foot, their sides in by tan 10° a
    // millimetre up: a frustum each.
    const t = Math.tan((10 * Math.PI) / 180)
    const half = (h: number) => (10 - 2 * t * h) ** 2
    const frustum = (10 / 6) * (half(0) + 4 * half(5) + half(10))
    // The two meet along their foot only: the old 1377.6 mm³ over them.
    expect(leaning.bodies.reduce((s, b) => s + b.volume, 0)).toBeCloseTo(2 * frustum, 1)
    expect(2 * frustum).toBeCloseTo(1377.6, 1)
    expect(straight.bodies.map((b) => b.volume)).toEqual([expect.closeTo(2000, 6)])
    expect(straight.bodies[0].faces).toBe(6)
  })
})
