// SPDX-License-Identifier: AGPL-3.0-only
// The bodies a build leaves, found from the part rather than chosen: a join
// makes one with every body it meets — a body of its own where it meets
// none, one body of all where it bridges several — a cut takes its solid
// out of every body it goes into, and whatever stands apart is a body of
// its own: two profiles apart, a bar cut through at its waist.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { islandId, type ExtrudeFeature, type Feature, type SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addRectangle, emptySketch } from '../core/sketch'
import { build, XY } from './reKit'

const kernelPromise = ReKernel.load()

/** A sketch of rectangles on the XY plane, each [x0, y0, x1, y1]. */
function rects(id: number, ...boxes: [number, number, number, number][]): SketchFeature {
  const sketch = emptySketch()
  for (const [x0, y0, x1, y1] of boxes) addRectangle(sketch, [x0, y0], [x1, y1])
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
}

function extrude(id: number, sketch: SketchFeature, from: number, to: number, op: ExtrudeFeature['op'], target?: number): ExtrudeFeature {
  return { id, kind: 'extrude', name: `Extrude ${id}`, sketchId: sketch.id, regions: findRegions(sketch.sketch).map((r) => r.key), extent: { kind: 'distance', from, to }, op, ...(target !== undefined ? { target } : {}), visible: true }
}

const volumes = (r: Awaited<ReturnType<typeof build>>) => r.bodies.map((b) => Math.round(b.volume * 1000) / 1000)

describe('a join', () => {
  it('meeting no body is a body of its own, and meeting one is made one with it', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const first = await build(builder, [a, extrude(2, a, 0, 10, 'join')])
    expect(first.results.map((r) => r.status)).toEqual(['ok'])
    expect(first.bodies.map((b) => b.id)).toEqual([2])
    expect(first.results[0].bodies).toEqual([2])
    // A second block half in the first: one body, the overlap counted once.
    const b = rects(3, [5, 0, 15, 10])
    const joined = await build(builder, [a, extrude(2, a, 0, 10, 'join'), b, extrude(4, b, 0, 10, 'join')])
    expect(joined.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(joined.bodies.map((x) => x.id)).toEqual([2])
    expect(volumes(joined)).toEqual([1500])
    expect(joined.results[1].bodies).toEqual([2])
    builder.dispose()
  })

  it('touching a body only face to face joins it as well', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const b = rects(3, [10, 0, 20, 10])
    const r = await build(builder, [a, extrude(2, a, 0, 10, 'join'), b, extrude(4, b, 0, 10, 'join')])
    expect(r.bodies.map((x) => x.id)).toEqual([2])
    expect(volumes(r)).toEqual([2000])
    builder.dispose()
  })

  it('standing apart from every body is a body of its own', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const b = rects(3, [30, 0, 40, 10])
    const r = await build(builder, [a, extrude(2, a, 0, 10, 'join'), b, extrude(4, b, 0, 10, 'join')])
    expect(r.bodies.map((x) => x.id)).toEqual([2, 4])
    expect(volumes(r)).toEqual([1000, 1000])
    builder.dispose()
  })

  it('bridging two bodies makes one of all three, under the older id — and a feature naming the other still finds it', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const b = rects(3, [30, 0, 40, 10])
    const bridge = rects(5, [5, 2, 35, 8])
    const features: Feature[] = [a, extrude(2, a, 0, 10, 'join'), b, extrude(4, b, 0, 10, 'join'), bridge, extrude(6, bridge, 0, 4, 'join')]
    const r = await build(builder, features)
    expect(r.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok'])
    expect(r.bodies.map((x) => x.id)).toEqual([2])
    // Two blocks and the 20 mm of bridge between them.
    expect(volumes(r)).toEqual([2000 + 20 * 6 * 4])
    expect(r.results[2].bodies).toEqual([2])
    // A cut by a plane on body 4, gone into body 2: it works on body 2.
    const cut = await build(builder, [...features, { id: 7, kind: 'cutPlane', name: 'Cut 1', body: 4, plane: { kind: 'world', axis: 'z', offset: 5 }, keep: -1, visible: true }])
    expect(cut.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(volumes(cut)).toEqual([2 * 500 + 20 * 6 * 4])
    // Both bodies are kept as they stood before the bridge, for editing it.
    expect(builder.stage(6, 2)).not.toBeNull()
    expect(builder.stage(6, 4)).not.toBeNull()
    builder.dispose()
  })

  it('of two profiles apart, with nothing to meet, is two bodies', async () => {
    const builder = new Builder(await kernelPromise)
    const two = rects(1, [0, 0, 10, 10], [20, 0, 25, 10])
    const r = await build(builder, [two, extrude(2, two, 0, 10, 'join')])
    expect(r.bodies.map((x) => x.id)).toEqual([2, islandId(2, 1)])
    expect(volumes(r)).toEqual([1000, 500])
    expect(r.results[0].bodies).toEqual([2, islandId(2, 1)])
    builder.dispose()
  })

  it('saved with a target joins that body alone, as joins once did', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const b = rects(3, [30, 0, 40, 10])
    const bridge = rects(5, [5, 2, 35, 8])
    const r = await build(builder, [a, extrude(2, a, 0, 10, 'join'), b, extrude(4, b, 0, 10, 'join'), bridge, extrude(6, bridge, 0, 4, 'join', 2)])
    expect(r.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok'])
    expect(r.bodies.map((x) => x.id)).toEqual([2, 4])
    builder.dispose()
  })
})

describe('a Combine naming a body left in pieces', () => {
  it('takes every piece: a plug patterned into copies apart cuts all its windows', async () => {
    const builder = new Builder(await kernelPromise)
    const plate = rects(1, [0, 0, 40, 40])
    const plug = rects(3, [5, 5, 10, 10])
    const features: Feature[] = [
      plate,
      extrude(2, plate, 0, 5, 'join'),
      plug,
      extrude(4, plug, -1, 6, 'new'),
      { id: 5, kind: 'pattern', name: 'Pattern 1', body: 4, mode: 'linear', axis: { kind: 'world', axis: 'x' }, count: 3, step: 10, visible: true },
    ]
    const patterned = await build(builder, features)
    expect(patterned.bodies.map((b) => b.id)).toEqual([2, 4, 5, islandId(5, 1)])
    const r = await build(builder, [...features, { id: 6, kind: 'boolean', name: 'Combine 1', op: 'cut', body: 2, tool: 4, visible: true }])
    expect(r.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(r.bodies.map((b) => b.id)).toEqual([2])
    expect(volumes(r)).toEqual([40 * 40 * 5 - 3 * 25 * 5])
    // Naming one copy takes that copy alone.
    const one = await build(builder, [...features, { id: 6, kind: 'boolean', name: 'Combine 1', op: 'cut', body: 2, tool: islandId(5, 1), visible: true }])
    expect(one.bodies.map((b) => b.id)).toEqual([2, 4, 5])
    expect(volumes(one)[0]).toBeCloseTo(40 * 40 * 5 - 25 * 5, 3)
    builder.dispose()
  })

  it('combines two profiles extruded together, one moved into the other, either way round', async () => {
    const builder = new Builder(await kernelPromise)
    const two = rects(1, [0, 0, 20, 10], [22, 0, 32, 10])
    const island = islandId(2, 1)
    const first = await build(builder, [two, extrude(2, two, 0, 10, 'join')])
    expect(first.bodies.map((b) => b.id)).toEqual([2, island])
    // The smaller block's near end pushed 4 mm on: 2 mm into the larger.
    const end = first.bodies[1].topology.faces.find((f) => f.fingerprint.dir[0] < -0.9)!.fingerprint
    const features: Feature[] = [two, extrude(2, two, 0, 10, 'join'), { id: 3, kind: 'moveFace', name: 'Move face 1', body: island, faces: [end], offset: 4, visible: true }]
    const moved = await build(builder, features)
    expect(volumes(moved)).toEqual([2000, 1400])
    for (const [body, tool] of [[island, 2], [2, island]]) {
      const r = await build(builder, [...features, { id: 4, kind: 'boolean', name: 'Combine 1', op: 'join', body, tool, visible: true }])
      expect(r.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok'])
      expect(r.bodies.map((b) => b.id)).toEqual([body])
      expect(volumes(r)[0]).toBeCloseTo(2000 + 1400 - 200, 3)
    }
    builder.dispose()
  })

  it('keeps the ids of the pieces through one Combine after another, and the id an earlier build gave a piece still finds it', async () => {
    const builder = new Builder(await kernelPromise)
    const two = rects(1, [0, 0, 20, 10], [30, 0, 40, 10])
    const island = islandId(2, 1)
    const tool = rects(3, [15, 0, 25, 10])
    const hole = rects(6, [32, 2, 38, 8])
    const base: Feature[] = [two, extrude(2, two, 0, 10, 'join'), tool, extrude(4, tool, 0, 10, 'new'), { id: 5, kind: 'boolean', name: 'Combine 1', op: 'join', body: 2, tool: 4, visible: true }, hole, extrude(7, hole, -1, 11, 'new')]
    const joined = await build(builder, base.slice(0, 5))
    expect(joined.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok'])
    // The block the tool joined, and the one it did not, under the ids
    // the extrude gave them — not the Combine's.
    expect(joined.bodies.map((b) => b.id)).toEqual([2, island])
    expect(volumes(joined)).toEqual([2500, 1000])
    const cut = await build(builder, [...base, { id: 8, kind: 'boolean', name: 'Combine 2', op: 'cut', body: 2, tool: 7, visible: true }])
    expect(cut.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(cut.bodies.map((b) => b.id)).toEqual([2, island])
    expect(volumes(cut)).toEqual([2500, 1000 - 36 * 10])
    // A project saved before named the small block by the id the first
    // Combine gave it then — its own id, 5 — and still cuts that block.
    const named = await build(builder, [...base, { id: 8, kind: 'boolean', name: 'Combine 2', op: 'cut', body: 5, tool: 7, visible: true }])
    expect(named.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(named.bodies.map((b) => b.id)).toEqual([2, island])
    expect(volumes(named)).toEqual([2500, 1000 - 36 * 10])
    builder.dispose()
  })

  it('keeps the tool as a body of its own when asked to', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 20, 10])
    const b = rects(3, [15, 0, 30, 10])
    const base: Feature[] = [a, extrude(2, a, 0, 10, 'new'), b, extrude(4, b, 0, 10, 'new')]
    const combine = (op: 'join' | 'cut', keep: boolean): Feature => ({ id: 5, kind: 'boolean', name: 'Combine 1', op, body: 2, tool: 4, ...(keep ? { keep } : {}), visible: true })
    const joined = await build(builder, [...base, combine('join', true)])
    expect(joined.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok'])
    expect(joined.bodies.map((x) => x.id)).toEqual([2, 4])
    expect(volumes(joined)).toEqual([3000, 1500])
    const cut = await build(builder, [...base, combine('cut', true)])
    expect(volumes(cut)).toEqual([1500, 1500])
    // Not kept, the tool goes into the result as before.
    const gone = await build(builder, [...base, combine('cut', false)])
    expect(gone.bodies.map((x) => x.id)).toEqual([2])
    builder.dispose()
  })
})

describe('a new body', () => {
  it('stays a body of its own, whatever it overlaps', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const b = rects(3, [5, 0, 15, 10])
    const r = await build(builder, [a, extrude(2, a, 0, 10, 'join'), b, extrude(4, b, 0, 10, 'new')])
    expect(r.bodies.map((x) => x.id)).toEqual([2, 4])
    expect(volumes(r)).toEqual([1000, 1000])
    builder.dispose()
  })
})

describe('a cut', () => {
  it('through a bar at its waist leaves two bodies, the larger under the bar’s id and the other under the cut’s', async () => {
    const builder = new Builder(await kernelPromise)
    const bar = rects(1, [0, 0, 40, 10])
    const slot = rects(3, [25, -5, 27, 15])
    const r = await build(builder, [bar, extrude(2, bar, 0, 10, 'join'), slot, extrude(4, slot, -5, 15, 'cut')])
    expect(r.results.map((x) => x.status)).toEqual(['ok', 'ok'])
    expect(r.bodies.map((x) => x.id)).toEqual([2, 4])
    expect(volumes(r)).toEqual([2500, 1300])
    expect(r.results[1].bodies).toEqual([2, 4])
    // Cut through twice, the third piece takes the cut's id and a fraction.
    const two = rects(3, [25, -5, 27, 15], [10, -5, 12, 15])
    const thrice = await build(builder, [bar, extrude(2, bar, 0, 10, 'join'), two, extrude(4, two, -5, 15, 'cut')])
    expect(thrice.bodies.map((x) => x.id)).toEqual([2, 4, islandId(4, 1)])
    expect(volumes(thrice)).toEqual([1300, 1300, 1000])
    builder.dispose()
  })

  it('goes through every body it meets, and takes a body it swallows whole', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const b = rects(3, [30, 0, 40, 10])
    const c = rects(5, [60, 0, 62, 2])
    const cutter = rects(7, [5, -5, 70, 15])
    const r = await build(builder, [a, extrude(2, a, 0, 10, 'join'), b, extrude(4, b, 0, 10, 'join'), c, extrude(6, c, 6, 8, 'join'), cutter, extrude(8, cutter, 5, 20, 'cut')])
    expect(r.results.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    // The first block loses the top half of its far half, the second its
    // whole top half, and the small block inside the cutter is gone.
    expect(r.bodies.map((x) => x.id)).toEqual([2, 4])
    expect(volumes(r)).toEqual([1000 - 5 * 10 * 5, 1000 - 10 * 10 * 5])
    expect(r.results[3].bodies).toEqual([2, 4])
    builder.dispose()
  })

  it('that meets no body fails, saying so', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const away = rects(3, [50, 50, 60, 60])
    const r = await build(builder, [a, extrude(2, a, 0, 10, 'join'), away, extrude(4, away, 0, 10, 'cut')])
    expect(r.results[1].status).toBe('failed')
    expect(r.results[1].message).toMatch(/meets no body/)
    expect(volumes(r)).toEqual([1000])
    builder.dispose()
  })

  it('as a Combine whose tool stands clear of the body fails too, the body as it was', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rects(1, [0, 0, 10, 10])
    const away = rects(3, [50, 50, 60, 60])
    const r = await build(builder, [a, extrude(2, a, 0, 10, 'join'), away, extrude(4, away, 0, 10, 'new'), { id: 5, kind: 'boolean', name: 'Combine 5', op: 'cut', body: 2, tool: 4, visible: true }])
    expect(r.results.map((x) => x.status)).toEqual(['ok', 'ok', 'failed'])
    expect(r.results[2].message).toMatch(/Extrude 4 meets nothing of Extrude 2/)
    expect(volumes(r)).toEqual([1000, 1000])
    // One that touches the body's face takes nothing out either.
    const touching = rects(6, [10, 0, 20, 10])
    const t = await build(builder, [a, extrude(2, a, 0, 10, 'join'), touching, extrude(7, touching, 0, 10, 'new'), { id: 8, kind: 'boolean', name: 'Combine 8', op: 'cut', body: 2, tool: 7, visible: true }])
    expect(t.results[2].status).toBe('failed')
    expect(t.results[2].message).toMatch(/meets nothing/)
    builder.dispose()
  })
})
