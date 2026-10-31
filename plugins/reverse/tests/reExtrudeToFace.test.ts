// SPDX-License-Identifier: AGPL-3.0-only
// An extrude that ends on a curved face, or on a body: a box cut from its
// side up to a cylinder standing beside it — the cut's floor the cylinder's
// arc, by To a face and by To a body alike, with no face of a helper body
// left on the part — and refused, saying so, where the face does not lie
// under the whole profile. (Round 20: the mirror holder's left wall, four
// helper features in place of a sketch and a cut.)
import { beforeAll, describe, expect, it } from 'vitest'
import type { SectionFrame } from '../../../src/core/section/frame'
import { Builder } from '../core/build'
import type { ExtrudeExtent, ExtrudeFeature, Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, addRectangle, emptySketch } from '../core/sketch'
import { build, XY } from './reKit'

/** The side plane x = 0, its sheet's u along y and v along z. */
const YZ: SectionFrame = { origin: [0, 0, 0], normal: [1, 0, 0], basisU: [0, 1, 0], basisV: [0, 0, 1] }

/** The box 40 × 20 × 20 from the origin; the cylinder R30 about the axis
 *  through (60, 10) along z, `height` tall from z = 0 — its near side at
 *  x = 30 under y = 10, 31.08 at y 2 and 18. */
function part(height: number): Feature[] {
  const box = emptySketch()
  addRectangle(box, [0, 0], [40, 20])
  const ring = emptySketch()
  addEntity(ring, { kind: 'circle', c: [60, 10], r: 30 })
  const sk = (id: number, sketch: ReturnType<typeof emptySketch>): SketchFeature => ({ id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true })
  const ex = (id: number, s: SketchFeature, to: number, name: string): ExtrudeFeature => ({ id, kind: 'extrude', name, sketchId: s.id, regions: findRegions(s.sketch).map((r) => r.key), extent: { kind: 'distance', from: 0, to }, op: 'new', visible: true })
  const a = sk(1, box)
  const b = sk(3, ring)
  return [a, ex(2, a, 20, 'Box'), b, ex(4, b, height, 'Cylinder')]
}

/** The profile on the side plane: y 2…18, z `z0`…`z1`. */
function profile(z0: number, z1: number): SketchFeature {
  const s = emptySketch()
  addRectangle(s, [2, z0], [18, z1])
  return { id: 5, kind: 'sketch', name: 'Side', plane: { kind: 'world', axis: 'x', offset: 0 }, frame: YZ, sketch: s, visible: true }
}

const cut = (s: SketchFeature, extent: ExtrudeExtent): ExtrudeFeature => ({ id: 6, kind: 'extrude', name: 'Pocket', sketchId: s.id, regions: findRegions(s.sketch).map((r) => r.key), extent, op: 'cut', target: 2, visible: true })

/** The volume the cut takes: the profile run from x = 0 to the cylinder. */
function wanted(z0: number, z1: number): number {
  let v = 0
  const n = 4000
  for (let i = 0; i < n; i++) {
    const y = 2 + ((i + 0.5) * 16) / n
    v += (60 - Math.sqrt(900 - (y - 10) ** 2)) * (16 / n)
  }
  return v * (z1 - z0)
}

let k: ReKernel
beforeAll(async () => {
  k = await ReKernel.load()
})

async function cylinderFace() {
  const builder = new Builder(k)
  const out = await build(builder, part(20))
  const face = out.bodies.find((b) => b.id === 4)!.topology.faces.find((f) => f.fingerprint.kind === 'cylinder')!.fingerprint
  builder.dispose()
  return face
}

describe('an extrude up to a curved face', () => {
  it('cuts a box up to a cylinder face: the floor its arc, the volume to the cylinder', async () => {
    const face = await cylinderFace()
    const side = profile(2, 18)
    const builder = new Builder(k)
    const out = await build(builder, [...part(20), side, cut(side, { kind: 'toFace', from: 0, body: 4, face })])
    expect(out.results.find((r) => r.id === 6)).toMatchObject({ status: 'ok' })
    const box = out.bodies.find((b) => b.id === 2)!
    expect(box.volume).toBeCloseTo(16_000 - wanted(2, 18), 0)
    // The pocket's floor lies on the cylinder; its walls are the profile's
    // own, and nothing stands past x = 31.1.
    const faces = box.topology.faces.map((f) => f.fingerprint)
    expect(faces.filter((f) => f.kind === 'cylinder' && f.origin === 6)).toHaveLength(1)
    const walls = faces.filter((f) => f.origin === 6 && f.kind === 'plane')
    expect(walls).toHaveLength(4)
    for (const w of walls) expect(w.centroid[0]).toBeLessThan(31.1)
    builder.dispose()
  }, 120_000)

  it('cuts the same up to the cylinder as a body', async () => {
    const side = profile(2, 18)
    const builder = new Builder(k)
    const out = await build(builder, [...part(20), side, cut(side, { kind: 'toBody', from: 0, body: 4 })])
    expect(out.results.find((r) => r.id === 6)).toMatchObject({ status: 'ok' })
    expect(out.bodies.find((b) => b.id === 2)!.volume).toBeCloseTo(16_000 - wanted(2, 18), 0)
    builder.dispose()
  }, 120_000)

  it('refuses a profile the face does not lie under, saying so', async () => {
    // The cylinder 10 tall; the profile runs to z 18.
    const builder = new Builder(k)
    const first = await build(builder, part(10))
    const face = first.bodies.find((b) => b.id === 4)!.topology.faces.find((f) => f.fingerprint.kind === 'cylinder')!.fingerprint
    const side = profile(2, 18)
    const out = await build(builder, [...part(10), side, cut(side, { kind: 'toFace', from: 0, body: 4, face })])
    const r = out.results.find((x) => x.id === 6)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/does not cover the whole profile/)
    expect(r.message).toMatch(/cylinder face of Cylinder/)
    // How far short, for a surface's margin to be grown by that and not by guess.
    expect(r.message).toMatch(/stops up to [\d.]+ mm short along z — about \d+ % of its width/)
    // The box is left as it was.
    expect(out.bodies.find((b) => b.id === 2)!.volume).toBeCloseTo(16_000, 3)
    builder.dispose()
  }, 120_000)

  it('refuses a body that lies beside the profile', async () => {
    const side = profile(2, 18)
    const s = emptySketch()
    addRectangle(s, [30, 40], [50, 60])
    const far: SketchFeature = { id: 7, kind: 'sketch', name: 'Far', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: s, visible: true }
    const block: ExtrudeFeature = { id: 8, kind: 'extrude', name: 'Far block', sketchId: 7, regions: findRegions(s).map((r) => r.key), extent: { kind: 'distance', from: 0, to: 20 }, op: 'new', visible: true }
    const builder = new Builder(k)
    const out = await build(builder, [...part(20), far, block, side, cut(side, { kind: 'toBody', from: 0, body: 8 })])
    expect(out.results.find((x) => x.id === 6)?.message).toMatch(/never meets Far block/)
    builder.dispose()
  }, 120_000)
})
