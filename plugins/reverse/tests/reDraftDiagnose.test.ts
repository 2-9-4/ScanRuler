// SPDX-License-Identifier: AGPL-3.0-only
// A draft the kernel refuses says why: a wall leaned further than the box
// is wide, with the largest angle it takes; two walls that lean alone but
// not together, as such — and in either case the road round it, the slope
// drawn into the profile.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { build, extrudeAll, rectangleSketch } from './reKit'

const kernelPromise = ReKernel.load()

describe('a draft that fails', () => {
  it('names the wall that will not lean and how far it would, or the walls that will not lean together', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 40, 20)
    const first = await build(builder, [s, extrudeAll(2, s, 0, 10)])
    const faces = first.bodies[0].topology.faces.map((f) => f.fingerprint)
    const bottom = faces.find((f) => f.dir[2] < -0.9)!
    const right = faces.find((f) => f.dir[0] > 0.9)!
    const left = faces.find((f) => f.dir[0] < -0.9)!
    const draft = (picked: typeof faces, angleDeg: number): Feature => ({ id: 3, kind: 'draft', name: 'Draft 1', body: 2, neutral: { kind: 'face', face: bottom }, faces: picked, angleDeg, visible: true })
    const tried = async (picked: typeof faces, deg: number) => (await build(builder, [s, extrudeAll(2, s, 0, 10), draft(picked, deg)])).results.find((x) => x.id === 3)!
    // 10 high, leaned 80°, the wall would run 57 mm in across a box 40 wide.
    const alone = await tried([right], 80)
    expect(alone.status).toBe('failed')
    expect(alone.message).toMatch(/The face does not lean at 80°/)
    const upTo = Number(/leans up to ([\d.]+)°/.exec(alone.message ?? '')?.[1])
    expect(upTo).toBeGreaterThan(70)
    expect(upTo).toBeLessThan(80)
    expect(alone.message).toMatch(/draw the slope into the profile/)
    expect(alone.where?.length).toBeGreaterThan(0)
    // At 70° each wall runs 27 mm in: alone it fits, the two together not.
    const both = await tried([right, left], 70)
    expect(both.status).toBe('failed')
    expect(both.message).toMatch(/Each of the 2 faces leans alone at 70°; together they do not/)
    expect(both.message).toMatch(/Together they lean up to/)
    builder.dispose()
  })
})
