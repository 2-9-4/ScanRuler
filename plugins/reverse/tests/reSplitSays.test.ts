// SPDX-License-Identifier: AGPL-3.0-only
// A cut that leaves a body in pieces says which piece kept the body's id
// and which are new, with where each lies — and where two pieces are the
// same size, the id stays with the one nearest where the body stood, not
// with whichever the kernel listed first. A cut by a plane that leaves
// nothing of its body says it takes all of it, which side the body lies
// on, and the pieces split off it the cut could have meant — never "no
// closed solid" after replaying the boolean every way.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { BooleanFeature, CutPlaneFeature, Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { addEntity, type Sketch } from '../core/sketch'
import { build, extrudeAll, rectangleSketch, sketchOf } from './reKit'

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** A closed outline of lines through the points, in order. */
function outline(s: Sketch, pts: [number, number][]): void {
  pts.forEach((a, i) => addEntity(s, { kind: 'line', a, b: pts[(i + 1) % pts.length] }))
}

/** Two legs 2 × 5 under a bar 10 × 2, and a lump on the bar over one leg
 *  — the left (x 0…4) or the right (x 6…10) — so the body's centroid lies
 *  over that leg. Cut at y 5 below the bar, the legs are the same size. */
const legs = (lump: 'left' | 'right') =>
  sketchOf(1, (s) =>
    outline(
      s,
      lump === 'left'
        ? [[0, 0], [2, 0], [2, 5], [8, 5], [8, 0], [10, 0], [10, 7], [4, 7], [4, 9], [0, 9]]
        : [[0, 0], [2, 0], [2, 5], [8, 5], [8, 0], [10, 0], [10, 9], [6, 9], [6, 7], [0, 7]],
    ),
  )

const cut = (id: number, body: number, axis: 'x' | 'y' | 'z', offset: number, keep: 1 | -1): CutPlaneFeature => ({ id, kind: 'cutPlane', name: `Cut ${id}`, body, plane: { kind: 'world', axis, offset }, keep, visible: true })

async function built(features: Feature[]) {
  const builder = new Builder(await kernelPromise)
  const out = await build(builder, features)
  builder.dispose()
  return out
}

describe('a cut that leaves a body in pieces', () => {
  it('gives the id to the same-size piece nearest where the body stood, and says so', async () => {
    for (const lump of ['left', 'right'] as const) {
      const s = legs(lump)
      const out = await built([s, extrudeAll(2, s, 0, 3), cut(3, 2, 'y', 5, -1)])
      const r = out.results.find((x) => x.id === 3)!
      expect(r.status, r.message).toBe('ok')
      const kept = out.bodies.find((b) => b.id === 2)!
      const other = out.bodies.find((b) => b.id !== 2)!
      expect(kept.volume).toBeCloseTo(30, 6)
      expect(other.volume).toBeCloseTo(30, 6)
      // The leg under the lump keeps the id, either way round.
      const x = (b: typeof kept) => (b.box!.min[0] + b.box!.max[0]) / 2
      expect(x(kept)).toBeCloseTo(lump === 'left' ? 1 : 9, 6)
      expect(x(other)).toBeCloseTo(lump === 'left' ? 9 : 1, 6)
      expect(r.warning).toContain(`The cut at y 5 left Extrude 2 as two bodies: 2 keeps the id (x ${lump === 'left' ? '0…2' : '8…10'}, y 0…5, z 0…3; 30 mm³); ${other.id} is new (x ${lump === 'left' ? '8…10' : '0…2'}`)
      expect(r.warning).toContain('the two the same size within 1 %, so the id stays with the piece nearest where the body stood')
    }
  })

  it('gives the id to the larger piece where they differ, and says the split', async () => {
    // One leg 2 wide, the other 3: no tie.
    const s = sketchOf(1, (sk) => outline(sk, [[0, 0], [2, 0], [2, 5], [7, 5], [7, 0], [10, 0], [10, 7], [0, 7]]))
    const out = await built([s, extrudeAll(2, s, 0, 3), cut(3, 2, 'y', 5, -1)])
    const r = out.results.find((x) => x.id === 3)!
    expect(out.bodies.find((b) => b.id === 2)!.volume).toBeCloseTo(45, 6)
    expect(r.warning).toMatch(/^The cut at y 5 left Extrude 2 as two bodies: 2 keeps the id \(x 7…10, y 0…5, z 0…3; 45 mm³\); [\d.]+ is new \(x 0…2, y 0…5, z 0…3; 30 mm³\)\. A feature naming 2 from here works on that piece alone/)
    expect(r.warning).not.toContain('same size')
  })

  it('says a split by a combine, and nothing where the body stays one', async () => {
    const s = legs('left')
    const bar = rectangleSketch(3, 12, 2, [-1, 5])
    const tool = extrudeAll(4, bar, -1, 4)
    const combine: BooleanFeature = { id: 5, kind: 'boolean', name: 'Bar off', op: 'cut', body: 2, tool: 4, visible: true }
    const out = await built([s, extrudeAll(2, s, 0, 3), bar, tool, combine])
    const r = out.results.find((x) => x.id === 5)!
    expect(r.status, r.message).toBe('ok')
    // The two legs the same size and the lump smaller: the leg under the
    // lump, nearest where the body stood, keeps the id.
    expect(r.warning).toContain('The combine left Extrude 2 as 3 bodies: 2 keeps the id (x 0…2, y 0…5, z 0…3; 30 mm³); 5 is new (x 8…10, y 0…5, z 0…3; 30 mm³); 5.0009765625 is new (x 0…4, y 7…9, z 0…3; 24 mm³)')
    const whole = await built([s, extrudeAll(2, s, 0, 3), cut(3, 2, 'y', 8, -1)])
    expect(whole.results.find((x) => x.id === 3)!.warning).toBeUndefined()
  })
})

describe('a cut by a plane that takes the whole body', () => {
  it('says it takes all of it, the side cut away, and the pieces split off it', async () => {
    const s = legs('left')
    const out = await built([s, extrudeAll(2, s, 0, 3), cut(3, 2, 'y', 5, -1), cut(4, 2, 'x', 5, 1)])
    const r = out.results.find((x) => x.id === 4)!
    expect(r.status).toBe('failed')
    const piece = out.bodies.find((b) => b.id !== 2)!.id
    expect(r.message).toBe(`The cut takes all of Extrude 2 (body 2, x 0…2, y 0…5, z 0…3): it lies wholly on the side cut away (x < 5). Since Cut 3 (feature 3) it is two bodies: 2 at x 0…2 (wholly on the side cut away), ${piece} at x 8…10 (on the side kept) — cut ${piece}, or keep -1.`)
    expect(r.message).not.toContain('tried exact')
  })

  it('says it of a body in one piece too', async () => {
    const s = rectangleSketch(1, 4, 4)
    const out = await built([s, extrudeAll(2, s, 0, 2), cut(3, 2, 'z', 5, 1)])
    const r = out.results.find((x) => x.id === 3)!
    expect(r.message).toBe('The cut takes all of Extrude 2 (body 2, x 0…4, y 0…4, z 0…2): it lies wholly on the side cut away (z < 5) — keep -1 keeps all of it, or move the plane.')
  })
})
