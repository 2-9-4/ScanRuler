// SPDX-License-Identifier: AGPL-3.0-only
// A saved bracket: an outline and a lip drawn on one section, both bottoms
// on the same datum but a hair apart after the solve, the outline extruded
// on its own and the lip's two faces joined onto it. The front of the
// joined body is one flat face to anyone looking at it, and the shell
// takes it as one — not as two faces a hair out of plane with each other,
// which the shell refuses and a pick reads as "2 faces".

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { type ExtrudeFeature, type Feature, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import { ctx, XY } from './reKit'

const kernelPromise = ReKernel.load()

/** The saved sketch, line for line. */
function bracketSketch(): SketchFeature {
  const s = emptySketch()
  const y0 = 0.0011789628354849499
  const y1 = 0.0012024343376343314
  addEntity(s, { kind: 'line', a: [-48.32674960711101, y0], b: [46.718959686490905, y0] })
  addEntity(s, { kind: 'line', a: [46.718959686490905, y0], b: [46.718959686490905, 9.494566700014142] })
  addEntity(s, { kind: 'line', a: [46.718959686490905, 9.494566700014142], b: [-48.32674960711101, 9.494566700014142] })
  addEntity(s, { kind: 'line', a: [-48.32674960711101, 9.494566700014142], b: [-48.32674960711101, y0] })
  addEntity(s, { kind: 'line', a: [42.16730524644081, y1], b: [48.36988067626953, y1] })
  addEntity(s, { kind: 'line', a: [48.36988067626953, y1], b: [48.36988067626953, 14.250077247619629] })
  addEntity(s, { kind: 'line', a: [48.36988067626953, 14.250077247619629], b: [42.16730524644081, 14.250077247619629] })
  addEntity(s, { kind: 'line', a: [42.16730524644081, 14.250077247619629], b: [42.16730524644081, y1] })
  return { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: s, visible: true }
}

async function build(features: Feature[]) {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, ctx, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return builder.build(steps, (id) => sketches.get(id))
}

describe('the bracket’s lip joined onto its outline', () => {
  it('has one front face, one top on the lip, and shells', async () => {
    const sk = bracketSketch()
    const keys = findRegions(sk.sketch).map((r) => r.key)
    // The outline left of the lip is bounded by lines 1, 3, 4 and the
    // lip's left side, line 8.
    const outline: ExtrudeFeature = { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: [keys.find((k) => k.startsWith('1.3.4.8@'))!], extent: { kind: 'distance', from: 0, to: 4.24 }, op: 'new', visible: true }
    const lip: ExtrudeFeature = { id: 3, kind: 'extrude', name: 'Extrude 2', sketchId: 1, regions: keys.filter((k) => !k.startsWith('1.3.4.8@')), extent: { kind: 'distance', from: 0, to: 10 }, op: 'join', target: 2, visible: true }
    expect(lip.regions).toHaveLength(2)
    const result = await build([sk, outline, lip])
    expect(result.results.map((r) => `${r.id} ${r.status} ${r.message ?? ''}`)).toEqual(['2 ok ', '3 ok '])
    const body = result.bodies[0]
    const faces = body.topology.faces
    const front = faces.filter((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[1] < -0.9)
    const tops = faces.filter((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9)
    // Front: one face. Tops: the outline's at 4.24 and the lip's at 10.
    expect(front).toHaveLength(1)
    expect(tops).toHaveLength(2)
    // A shell open at the top of the lip.
    const lipTop = tops.find((f) => f.fingerprint.centroid[2] > 9)!
    const shell: Feature = { id: 4, kind: 'shell', name: 'Shell', body: 2, faces: [lipTop.fingerprint], thickness: 1, visible: true }
    const shelled = await build([sk, outline, lip, shell])
    const r = shelled.results.find((x) => x.id === 4)!
    expect(r.message ?? '').toBe('')
    expect(r.status).toBe('ok')
  })
})
