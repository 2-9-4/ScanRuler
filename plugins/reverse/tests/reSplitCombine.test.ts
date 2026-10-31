// SPDX-License-Identifier: AGPL-3.0-only
// A feature that falls into several solids, and a Combine on it: the two
// studs of one sketch, extruded together, are a body and a piece of it,
// and an intersect with the outline trims both — not the larger alone.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { addRectangle } from '../core/sketch'
import { build, extrudeAll, rectangleSketch, sketchOf } from './reKit'

const kernelPromise = ReKernel.load()

describe('a Combine on a body in pieces', () => {
  // Two studs, 4 × 4 and 3 × 3, 10 tall; the outline is 20 × 20 and 6 tall.
  const studs = sketchOf(1, (s) => {
    addRectangle(s, [0, 0], [4, 4])
    addRectangle(s, [10, 0], [13, 3])
  })
  const outline = rectangleSketch(3, 20, 20, [-5, -5])

  it('says the feature made separate solids', async () => {
    const builder = new Builder(await kernelPromise)
    const out = await build(builder, [studs, extrudeAll(2, studs, 0, 10)])
    expect(out.bodies).toHaveLength(2)
    expect(out.results[0].warning).toMatch(/2 separate solids/)
    builder.dispose()
  })

  it('intersects every piece of its body with the tool', async () => {
    const builder = new Builder(await kernelPromise)
    const features: Feature[] = [
      studs,
      extrudeAll(2, studs, 0, 10),
      outline,
      extrudeAll(4, outline, 0, 6),
      { id: 5, kind: 'boolean', name: 'Trim', op: 'intersect', body: 2, tool: 4, visible: true },
    ]
    const out = await build(builder, features)
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    // Both studs trimmed to 6, still apart; the outline went into them.
    expect(out.bodies.map((b) => b.volume).sort((a, b) => b - a)).toEqual([expect.closeTo(16 * 6, 4), expect.closeTo(9 * 6, 4)])
    for (const b of out.bodies) expect(b.box!.max[2]).toBeCloseTo(6, 6)
    builder.dispose()
  })

  it('cuts and joins every piece of its body too', async () => {
    const builder = new Builder(await kernelPromise)
    const slab = sketchOf(3, (s) => addRectangle(s, [-5, -5], [20, 20]))
    const cut: Feature[] = [studs, extrudeAll(2, studs, 0, 10), slab, extrudeAll(4, slab, 8, 13), { id: 5, kind: 'boolean', name: 'Top off', op: 'cut', body: 2, tool: 4, visible: true }]
    const cutOut = await build(builder, cut)
    expect(cutOut.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(cutOut.bodies.map((b) => b.volume).sort((a, b) => b - a)).toEqual([expect.closeTo(16 * 8, 4), expect.closeTo(9 * 8, 4)])
    const joined: Feature[] = [studs, extrudeAll(2, studs, 0, 10), outline, extrudeAll(4, outline, -2, 0), { id: 5, kind: 'boolean', name: 'On the base', op: 'join', body: 2, tool: 4, visible: true }]
    const joinOut = await build(builder, joined)
    expect(joinOut.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(joinOut.bodies).toHaveLength(1)
    expect(joinOut.bodies[0].volume).toBeCloseTo(20 * 20 * 2 + 16 * 10 + 9 * 10, 4)
    builder.dispose()
  })
})
