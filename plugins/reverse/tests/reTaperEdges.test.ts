// SPDX-License-Identifier: AGPL-3.0-only
// A taper checked edge by edge: the profile's outline is the face's B-rep
// edges, each a run of short segments, and a taper is refused only when a
// whole edge vanishes, an edge folds over in its middle, or two edges that
// are not neighbours run into each other — not when the first few segments
// of a round give way where it meets a side at an angle, which the kernel's
// leaned faces simply trim. A gap in the outline is an error, not a chord.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { type ExtrudeFeature, type Feature, type SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, type Sketch } from '../core/sketch'
import { type EdgeLoop, faceOutline, insetBreak, insetHolds, type Loop2, type OutlineEdge } from '../core/taper'
import { ctx, sketchOf } from './reKit'

const kernelPromise = ReKernel.load()

type V2 = [number, number]

const R_TIP = 0.9
const TIP = (Math.PI * 2) / 3
const SAG = 0.6

/** A fan blade's plan, 40 mm between its tip centres: two long sides bowed
 *  out 0.6 mm, 2.8 mm apart at the middle, and an R0.9 round at each tip
 *  that meets the sides at about 26°, not tangent to them. Its pieces as
 *  arcs: centre, radius, start and sweep, counter-clockwise. */
function bladeArcs(): { c: V2; r: number; start: number; sweep: number }[] {
  const a: V2 = [R_TIP * Math.cos(TIP), R_TIP * Math.sin(TIP)]
  const half = 20 - a[0]
  const R = (half * half + SAG * SAG) / (2 * SAG)
  const lean = Math.asin(half / R)
  return [
    // The left tip, the bottom side, the right tip, the top side.
    { c: [0, 0], r: R_TIP, start: TIP, sweep: TIP },
    { c: [20, -a[1] - SAG + R], r: R, start: -Math.PI / 2 - lean, sweep: 2 * lean },
    { c: [40, 0], r: R_TIP, start: -TIP / 2, sweep: TIP },
    { c: [20, a[1] + SAG - R], r: R, start: Math.PI / 2 - lean, sweep: 2 * lean },
  ]
}

function bladeSketch(id: number): SketchFeature {
  return sketchOf(id, (s) => {
    for (const arc of bladeArcs()) addEntity(s, { kind: 'arc', ...arc })
  })
}

/** The blade's outline as its four edges, each arc in `n` segments. */
function bladeLoop(n = 24): EdgeLoop {
  const loop: EdgeLoop = { points: [], edges: [] }
  bladeArcs().forEach(({ c, r, start, sweep }, e) => {
    for (let i = 0; i < n; i++) {
      const t = start + (sweep * i) / n
      loop.points.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
      loop.edges.push(e)
    }
  })
  return loop
}

function extrude(id: number, sketch: SketchFeature, extent: ExtrudeFeature['extent'], draftDeg: number): ExtrudeFeature {
  return { id, kind: 'extrude', name: `Extrude ${id}`, sketchId: sketch.id, regions: findRegions(sketch.sketch).map((r) => r.key), extent, draftDeg, op: 'new', visible: true }
}

async function build(features: Feature[]) {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, ctx, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return { result: builder.build(steps, (id) => sketches.get(id)), builder, k }
}

/** 3° over 12.6 mm: how far each side moves. */
const INSET = 12.6 * Math.tan((3 * Math.PI) / 180)

describe('the outline a taper moves, edge by edge', () => {
  it('trims a round where a side meets it at an angle, instead of refusing its first segment', () => {
    const blade = bladeLoop()
    expect(insetHolds([blade], INSET)).toBe(true)
    expect(insetHolds([blade], -INSET)).toBe(true)
    // The same points with every segment an edge of its own: the round's
    // first segment gives way at the corner, and that was a refusal.
    expect(insetBreak([blade.points], INSET)?.why).toBe('vanishes')
  })

  it('still refuses where a whole edge vanishes', () => {
    // The tips close as the sides close in on them: each R0.9 round is
    // trimmed shorter until it is gone.
    const broke = insetBreak([bladeLoop()], 1.2)
    expect(broke).toEqual({ why: 'vanishes', edges: [expect.any(Number)] })
    expect([0, 2]).toContain(broke!.edges[0])
    // A round of radius 5 as one edge, moved in past its radius.
    const ring: EdgeLoop = { points: Array.from({ length: 64 }, (_, i) => [5 * Math.cos((2 * Math.PI * i) / 64), 5 * Math.sin((2 * Math.PI * i) / 64)] as V2), edges: Array(64).fill(0) }
    expect(insetBreak([ring], 4.9)).toBeNull()
    expect(insetBreak([ring], 5.1)).toEqual({ why: 'vanishes', edges: [0] })
  })

  it('refuses an edge that folds over in its middle', () => {
    // A 20 × 10 plate whose top-right corner is one edge with the side and
    // the top: a straight run, a quarter round of radius 1, a straight run.
    const corner: V2[] = [[20, 0]]
    for (let i = 0; i <= 16; i++) corner.push([19 + Math.cos((Math.PI / 2) * (i / 16)), 9 + Math.sin((Math.PI / 2) * (i / 16))])
    corner.push([0, 10])
    const plate: EdgeLoop = { points: [[0, 0], ...corner.slice(0, -1), [0, 10]], edges: [0, ...corner.slice(0, -1).map(() => 1), 2] }
    expect(insetBreak([plate], 0.9)).toBeNull()
    expect(insetBreak([plate], 1.2)).toEqual({ why: 'folds', edges: [1] })
  })

  it('refuses two edges that are not neighbours running into each other', () => {
    // Two 20 mm squares joined by a neck 2 mm wide: the neck's walls meet.
    const dumbbell: Loop2 = [[0, 0], [20, 0], [20, 9], [30, 9], [30, 0], [50, 0], [50, 20], [30, 20], [30, 11], [20, 11], [20, 20], [0, 20]]
    expect(insetBreak([dumbbell], 0.9)).toBeNull()
    const broke = insetBreak([dumbbell], 1.1)
    expect(broke?.why).toBe('crosses')
    // The neck's corners all meet at once: an edge from below it, from
    // [20,0] round to [30,9], and one from above, [30,20] round to [20,20].
    const [low, high] = [...broke!.edges].sort((a, b) => a - b)
    expect([1, 2, 3]).toContain(low)
    expect([7, 8, 9]).toContain(high)
  })

  it('reads the loops off the face’s edges, and calls a gap in them an error', () => {
    const at = (x: number, y: number): [number, number, number] => [x, y, 0]
    const line = (a: V2, b: V2): OutlineEdge => ({ polyline: new Float32Array([...at(...a), ...at(...b)]), ends: [at(...a), at(...b)] })
    // A square, its edges listed out of order and two of them backwards.
    const square = [line([0, 0], [10, 0]), line([0, 10], [10, 10]), line([0, 10], [0, 0]), line([10, 10], [10, 0])]
    const loops = faceOutline(square, [0, 0, 0], [1, 0, 0], [0, 1, 0])
    expect(loops.length).toBe(1)
    expect(loops[0].points.length).toBe(4)
    expect(new Set(loops[0].edges).size).toBe(4)
    expect(insetHolds(loops, 4.9)).toBe(true)
    // One side missing: no chord across the gap.
    expect(() => faceOutline(square.slice(1), [0, 0, 0], [1, 0, 0], [0, 1, 0])).toThrow(/outline is broken at \(/)
  })
})

describe('a taper on a blade with sharp-cornered tips', () => {
  it('has one region to extrude', () => {
    expect(findRegions(bladeSketch(1).sketch).length).toBe(1)
  })

  for (const [name, extent, draft] of [
    ['down, leaning in', { kind: 'distance', from: 0, to: -12.6 }, 3],
    ['up, leaning out', { kind: 'distance', from: 0, to: 12.6 }, -3],
    ['up, leaning in', { kind: 'distance', from: 0, to: 12.6 }, 3],
    ['down, leaning out', { kind: 'distance', from: 0, to: -12.6 }, -3],
    ['both ways, leaning in', { kind: 'distance', from: -12.6, to: 12.6 }, 3],
  ] as [string, ExtrudeFeature['extent'], number][]) {
    it(`extrudes 12.6 mm at ${draft}°, ${name}, to one valid closed solid`, async () => {
      const s = bladeSketch(1)
      const { result, builder } = await build([s, extrude(2, s, extent, draft)])
      const straight = await build([s, extrude(2, s, extent, 0)])
      expect(result.results[0].message).toBeUndefined()
      expect(result.results[0].status).toBe('ok')
      expect(result.bodies.length).toBe(1)
      expect(result.bodies[0].closed).toBe(true)
      // Leaning in it holds less than the straight prism, leaning out more.
      const ratio = result.bodies[0].volume / straight.result.bodies[0].volume
      if (draft > 0) expect(ratio).toBeLessThan(1)
      else expect(ratio).toBeGreaterThan(1)
      expect(Math.abs(1 - ratio)).toBeLessThan(0.5)
      builder.dispose()
      straight.builder.dispose()
    })
  }

  it('is refused where the tips close, naming the edge that vanishes', async () => {
    const s = bladeSketch(1)
    const { result, builder } = await build([s, extrude(2, s, { kind: 'distance', from: 0, to: 30 }, 3)])
    expect(result.results[0].status).toBe('failed')
    const message = result.results[0].message ?? ''
    expect(message).toMatch(/^The taper closes the profile \d+\.\d\d mm from where it starts, and the extrude runs 30\.00 mm that way: the edge through \(-?\d+\.\d\d, -?\d+\.\d\d, 0\.00\) shrinks to nothing there — ease the taper/)
    // At a tip: x near 0 or near 40.
    const x = Number(/through \((-?[\d.]+)/.exec(message)![1])
    expect(Math.min(Math.abs(x), Math.abs(x - 40))).toBeLessThan(1)
    builder.dispose()
  })

  it('is refused where a neck pinches off, naming the two edges that meet', async () => {
    const s = sketchOf(1, (sk) => {
      const pts: V2[] = [[0, 0], [20, 0], [20, 9], [30, 9], [30, 0], [50, 0], [50, 20], [30, 20], [30, 11], [20, 11], [20, 20], [0, 20]]
      pts.forEach((p, i) => addEntity(sk, { kind: 'line', a: p, b: pts[(i + 1) % pts.length] }))
    })
    const { result, builder } = await build([s, extrude(2, s, { kind: 'distance', from: 0, to: 10 }, 10)])
    expect(result.results[0].status).toBe('failed')
    // The neck's walls, 1 mm each side of y = 10, meet 1 / tan 10° = 5.67 mm
    // on; the edges named lie one each side of the neck.
    const message = result.results[0].message ?? ''
    expect(message).toMatch(/closes the profile 5\.6\d mm from where it starts, and the extrude runs 10\.00 mm that way: the edges through \([\d.]+, [\d.]+, 0\.00\) and \([\d.]+, [\d.]+, 0\.00\) run into each other there/)
    const ys = [...message.matchAll(/\(([\d.]+), ([\d.]+), 0\.00\)/g)].map((m) => Number(m[2])).sort((a, b) => a - b)
    expect(ys[0]).toBeLessThan(10)
    expect(ys[1]).toBeGreaterThan(10)
    builder.dispose()
  })
})
