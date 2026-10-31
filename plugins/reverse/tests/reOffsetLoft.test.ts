// SPDX-License-Identifier: AGPL-3.0-only
// A loft offset all round: a key's cap — a block lofted to a smaller one
// through a third, its sides curved — shrinks inward by 0.65 mm as a box
// does, and the same cap too thin for it is refused with where: the face
// with too little behind it, by its index, and the distance that does go.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import type { Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { build, rectangleSketch, XY } from './reKit'

const kernelPromise = ReKernel.load()

/** A rectangle w by h about (0, 0), at height z. */
const layer = (id: number, w: number, h: number, z: number): SketchFeature => ({ ...rectangleSketch(id, w, h, [-w / 2, -h / 2]), frame: { ...XY, origin: [0, 0, z] } })

/** A cap lofted smooth through three layers to `height`. */
function cap(height: number): Feature[] {
  return [layer(1, 10, 6, 0), layer(2, 9.4, 5.4, height / 2), layer(3, 8, 4, height), { id: 4, kind: 'loft', name: 'Key', sketches: [1, 2, 3], ruled: false, op: 'new', visible: true }]
}

const offset = (distance: number): Feature => ({ id: 5, kind: 'offsetBody', name: 'Offset 1', body: 4, distance, keep: false, visible: true })

describe('a loft offset all round', () => {
  it('shrinks inward by 0.65 mm', async () => {
    const builder = new Builder(await kernelPromise)
    const before = await build(builder, cap(3))
    expect(before.results.map((r) => r.status)).toEqual(['ok'])
    const out = await build(builder, [...cap(3), offset(-0.65)])
    expect(out.results.map((r) => r.status), JSON.stringify(out.results)).toEqual(['ok', 'ok'])
    expect(out.bodies).toHaveLength(1)
    expect(out.bodies[0].closed).toBe(true)
    expect(out.bodies[0].volume).toBeLessThan(before.bodies[0].volume * 0.5)
    expect(out.bodies[0].volume).toBeGreaterThan(0)
    builder.dispose()
  })

  it('is refused where the loft is thinner than twice the distance, saying where and how far it goes', async () => {
    const builder = new Builder(await kernelPromise)
    const out = await build(builder, [...cap(1.2), offset(-0.65)])
    const r = out.results.find((x) => x.id === 5)!
    expect(r.status).toBe('failed')
    const message = (r as { message: string }).message
    expect(message).toMatch(/thinner than twice that \(1\.3 mm\)/)
    expect(message).toMatch(/1\.\d+ mm thick behind face \d+ at \(/)
    expect(message).toMatch(/It offsets inward by up to 0\.(5[6-9]|6) mm/)
    expect((r as { where?: unknown[] }).where?.length).toBeGreaterThan(0)
    builder.dispose()
  })
})
