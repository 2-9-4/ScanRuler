// SPDX-License-Identifier: AGPL-3.0-only
// Body steps that leave the right bodies and read the right numbers: a
// mirror kept apart from its source, a varying round on a tangent chain,
// and a sphere face's centre on a ball and in a pocket.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import type { Feature, ResolveContext, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import type { SphereFit } from '../../../src/core/types'
import { extrudeAll, rectangleSketch, XY } from './reKit'

const kernelPromise = ReKernel.load()
const NO_STATS = { sigma: 0, usedPoints: 0, regionSize: 0 }

async function build(builder: Builder, features: Feature[], elements: ResolveContext['elements'] = []) {
  const steps = resolveFeatures(features, { sections: [], elements, modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return builder.build(steps, (id) => sketches.get(id))
}

/** Two long sides joined by semicircular ends: the top edges are one
 *  tangent chain. */
function slotSketch(id: number, length: number, r: number): SketchFeature {
  const sketch = emptySketch()
  addEntity(sketch, { kind: 'line', a: [0, -r], b: [length, -r] })
  addEntity(sketch, { kind: 'arc', c: [length, 0], r, start: -Math.PI / 2, sweep: Math.PI })
  addEntity(sketch, { kind: 'line', a: [length, r], b: [0, r] })
  addEntity(sketch, { kind: 'arc', c: [0, 0], r, start: Math.PI / 2, sweep: Math.PI })
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
}

describe('a mirror not joined', () => {
  const BOX = 40 * 20 * 10

  it('is a body of its own beside its source, and a Combine between the two works', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 40, 20)
    // About x = 30: the copy spans 20 to 60, over the source's last half.
    const mirror: Feature = { id: 3, kind: 'mirror', name: 'Mirror 1', body: 2, plane: { kind: 'world', axis: 'x', offset: 30 }, join: false, visible: true }
    const out = await build(builder, [s, extrudeAll(2, s, 0, 10), mirror])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(out.results[1].bodies).toEqual([3])
    expect(out.bodies.map((b) => [b.id, b.name])).toEqual([[2, 'Extrude 2'], [3, 'Mirror 1']])
    const [source, copy] = out.bodies
    expect(source.volume).toBeCloseTo(BOX, 3)
    expect([source.box!.min[0], source.box!.max[0]]).toEqual([expect.closeTo(0, 6), expect.closeTo(40, 6)])
    expect(copy.volume).toBeCloseTo(BOX, 3)
    expect([copy.box!.min[0], copy.box!.max[0]]).toEqual([expect.closeTo(20, 6), expect.closeTo(60, 6)])

    const cut = await build(builder, [s, extrudeAll(2, s, 0, 10), mirror, { id: 4, kind: 'boolean', name: 'Combine 1', op: 'cut', body: 2, tool: 3, visible: true }])
    expect(cut.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(cut.bodies).toHaveLength(1)
    expect(cut.bodies[0].id).toBe(2)
    expect(cut.bodies[0].volume).toBeCloseTo(BOX / 2, 3)
    builder.dispose()
  })
})

describe('a varying round on a tangent chain', () => {
  it('leaves the varying edge out of the plain edges’ chain', async () => {
    const builder = new Builder(await kernelPromise)
    const s = slotSketch(1, 30, 5)
    const first = await build(builder, [s, extrudeAll(2, s, 0, 10)])
    const tops = first.bodies[0].topology.edges.filter((e) => e.fingerprint.kind === 'line' && e.fingerprint.mid[2] > 9.9)
    const near = tops.find((e) => e.fingerprint.mid[1] < 0)!.fingerprint
    const far = tops.find((e) => e.fingerprint.mid[1] > 0)!.fingerprint
    // The near side picked, chained round the rim — through the far side
    // too, which is rounded at a radius of its own.
    const out = await build(builder, [s, extrudeAll(2, s, 0, 10), { id: 3, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [near], variable: [{ edge: far, radius: [1, 1] }], radius: 1, chain: true, visible: true }])
    expect(out.results[1].message).toBeUndefined()
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    // The whole rim rounded at R1, as one chain of the one radius would.
    expect(out.bodies[0].volume).toBeCloseTo((30 * 10 + Math.PI * 25) * 10 - (1 - Math.PI / 4) * (60 + 2 * Math.PI * 5), 0)
    expect(out.results[1].warning).toMatch(/1 of the edges picked at the one radius lies on the tangent chain of an edge at a varying radius/)
    const growing = await build(builder, [s, extrudeAll(2, s, 0, 10), { id: 3, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [near], variable: [{ edge: far, radius: [0.8, 1.5] }], radius: 1, chain: true, visible: true }])
    // From R0.8 to R1.5 round the chain: more taken off than at R1.
    expect(growing.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(growing.bodies[0].closed).toBe(true)
    expect(growing.bodies[0].volume).toBeLessThan(out.bodies[0].volume - 1)
    builder.dispose()
  })
})

describe('a sphere face’s centre', () => {
  const sphereFaces = (out: Awaited<ReturnType<typeof build>>) => out.bodies.flatMap((b) => b.topology.faces.filter((f) => f.fingerprint.kind === 'sphere').map((f) => f.fingerprint))

  it('is the ball’s centre on a ball', async () => {
    const builder = new Builder(await kernelPromise)
    const ball: { id: number; fit: SphereFit } = { id: 11, fit: { kind: 'sphere', center: [5, -3, 8], radius: 6, ...NO_STATS } }
    const out = await build(builder, [{ id: 1, kind: 'extract', name: 'Body 1', element: 11, thickness: 0, op: 'new', visible: true }], [ball])
    const faces = sphereFaces(out)
    expect(faces.length).toBeGreaterThan(0)
    for (const f of faces) {
      expect(f.radius).toBeCloseTo(6, 6)
      expect(f.center!.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([5, -3, 8])
    }
    // Mirrored about x = 0, its surface turned inside out by the mirror.
    const mirrored = await build(builder, [{ id: 1, kind: 'extract', name: 'Body 1', element: 11, thickness: 0, op: 'new', visible: true }, { id: 2, kind: 'mirror', name: 'Mirror 1', body: 1, plane: { kind: 'world', axis: 'x', offset: 0 }, join: false, visible: true }], [ball])
    const copy = mirrored.bodies.find((b) => b.id === 2)!
    expect(sphereFaces({ ...mirrored, bodies: [copy] }).length).toBeGreaterThan(0)
    for (const f of copy.topology.faces.filter((x) => x.fingerprint.kind === 'sphere')) expect(f.fingerprint.center!.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-5, -3, 8])
    builder.dispose()
  })

  it('is the pocket’s centre in a pocket, where the face looks in towards it', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 40, 40)
    // A ball of R6 sunk into the top face at its middle: a concave cup.
    const ball: { id: number; fit: SphereFit } = { id: 11, fit: { kind: 'sphere', center: [20, 20, 20], radius: 6, ...NO_STATS } }
    const out = await build(builder, [s, extrudeAll(2, s, 0, 20), { id: 3, kind: 'extract', name: 'Body 3', element: 11, thickness: 0, op: 'cut', visible: true }], [ball])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(out.bodies[0].volume).toBeCloseTo(40 * 40 * 20 - (2 / 3) * Math.PI * 6 ** 3, 2)
    const faces = sphereFaces(out)
    expect(faces.length).toBeGreaterThan(0)
    for (const f of faces) {
      expect(f.radius).toBeCloseTo(6, 6)
      expect(f.center!.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([20, 20, 20])
    }
    builder.dispose()
  })
})

describe('a feature that failed', () => {
  it('keeps the body it was given, for its picks by index to be read on', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 20, 10)
    const first = await build(builder, [s, extrudeAll(2, s, 0, 5)])
    const edge = first.bodies[0].topology.edges.find((e) => e.fingerprint.mid[2] > 4.9)!.fingerprint
    // A round far larger than the block: it fails.
    const out = await build(builder, [s, extrudeAll(2, s, 0, 5), { id: 3, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [edge], radius: 40, chain: false, visible: true }])
    expect(out.results[1].status).toBe('failed')
    const stage = builder.stage(3, 2)
    expect(stage).not.toBeNull()
    expect([stage!.topology.faces.length, stage!.topology.edges.length]).toEqual([6, 12])
    expect(out.bodies[0].volume).toBeCloseTo(20 * 10 * 5, 3)
    builder.dispose()
  })
})
