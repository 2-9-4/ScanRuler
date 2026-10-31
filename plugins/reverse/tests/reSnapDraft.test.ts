// SPDX-License-Identifier: AGPL-3.0-only
// A face snapped onto a leaning face of the scan, and the draft that
// follows the move: through the kernel, the drafted face lies on the scan's
// plane; in the store, the move and the draft go in as one undo entry.

import { beforeEach, describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { type ExtrudeFeature, type SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addRectangle, emptySketch } from '../core/sketch'
import { snapReading } from '../core/snapFace'
import { planSnap } from '../core/snapEdit'
import type { FaceFingerprint } from '../core/topo'
import type { PlaneFit } from '../../../src/core/types'
import { dot, sub } from '../../../src/core/vec'
import { snapDraftOf, useReverse, type FeatureDraft } from '../state/reStore'
import { build, XY } from './reKit'

const kernelPromise = ReKernel.load()
const STATS = { sigma: 0.02, usedPoints: 500, regionSize: 500 }

function block(): { sketch: SketchFeature; extrude: ExtrudeFeature } {
  const s = emptySketch()
  addRectangle(s, [0, 0], [40, 20])
  const sketch: SketchFeature = { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: s, visible: true }
  const extrude: ExtrudeFeature = { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: findRegions(s).map((r) => r.key), extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true }
  return { sketch, extrude }
}

// The scan's top: 2 mm above the block's, dipping 3° as it goes along +X.
const t = (3 * Math.PI) / 180
const scanNormal: [number, number, number] = [Math.sin(t), 0, Math.cos(t)]
const scanTop: PlaneFit = { kind: 'plane', center: [20, 10, 12], normal: scanNormal, basisU: [Math.cos(t), 0, -Math.sin(t)], basisV: [0, 1, 0], extentU: 15, extentV: 8, ...STATS }

function moveDraft(top: FaceFingerprint, lean: boolean): Extract<FeatureDraft, { kind: 'moveFace' }> {
  const reading = snapReading(top, scanTop)
  if (typeof reading === 'string') throw new Error(reading)
  return { kind: 'moveFace', body: 2, faces: [{ hash: -1, fingerprint: top }], snap: true, offset: Math.round(reading.offset * 1000) / 1000, reading, fitting: false, error: null, lean, history: true }
}

describe('a snapped face drafted onto the scan', () => {
  it('lays the face on the scan’s leaning plane after the move, keeping the volume about the hinge', async () => {
    const builder = new Builder(await kernelPromise)
    const { sketch, extrude } = block()
    const first = await build(builder, [sketch, extrude])
    const top = first.bodies[0].topology.faces.find((f) => f.fingerprint.dir[2] > 0.9)!.fingerprint
    const d = moveDraft(top, true)
    // The move goes into the extrude's distance; the draft comes after it.
    const plan = planSnap([sketch, extrude], top, d.offset)
    if (plan.route === 'direct') throw new Error(plan.why)
    const lean = snapDraftOf(d)
    expect(lean).not.toBeNull()
    expect(lean!.angleDeg).toBeCloseTo(3, 2)
    const out = await build(builder, [...plan.features, { ...lean!, id: 3, name: 'Draft 1' }])
    expect(out.results.map((r) => `${r.status}:${r.message ?? ''}`)).toEqual(['ok:', 'ok:'])
    expect(out.results.map((r) => r.id)).toEqual([2, 3])
    const leaned = out.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9)!.fingerprint
    // Its normal is the scan's, and its plane goes through the scan's patch.
    expect(dot(leaned.dir, scanNormal)).toBeGreaterThan(Math.cos((0.01 * Math.PI) / 180))
    expect(Math.abs(dot(sub(leaned.centroid, scanTop.center), scanNormal))).toBeLessThan(1e-3)
    // Hinged through the middle, what the +X half loses the −X half gains.
    expect(out.bodies[0].volume).toBeCloseTo(40 * 20 * 12, 2)
    expect(out.bodies[0].closed).toBe(true)
    builder.dispose()
  })

  it('offers nothing without the tick, a typed offset, or a reopened Move face', () => {
    const top: FaceFingerprint = { kind: 'plane', centroid: [20, 10, 10], dir: [0, 0, 1], area: 800, origin: 2 }
    expect(snapDraftOf(moveDraft(top, false))).toBeNull()
    expect(snapDraftOf({ ...moveDraft(top, true), reading: null })).toBeNull()
    expect(snapDraftOf({ ...moveDraft(top, true), featureId: 7 })).toBeNull()
    const lean = snapDraftOf(moveDraft(top, true))!
    expect(lean.faces[0].centroid).toEqual([20, 10, 12])
    expect(lean.neutral.kind).toBe('fitted')
  })
})

describe('the store committing a snap with its draft', () => {
  const s = () => useReverse.getState()
  beforeEach(() => {
    const { sketch, extrude } = block()
    useReverse.setState({ features: [sketch, extrude], rolledBack: [], featureDraft: null, nextFeatureId: 3, nextOfKind: { sketch: 1, extrude: 1 }, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
  })

  it('edits the extrude and adds Draft 1 after it, one undo taking both back', () => {
    const top: FaceFingerprint = { kind: 'plane', centroid: [20, 10, 10], dir: [0, 0, 1], area: 800, origin: 2 }
    useReverse.setState({ featureDraft: moveDraft(top, true) })
    s().commitFeature()
    const features = s().features
    expect(features.map((f) => f.kind)).toEqual(['sketch', 'extrude', 'draft'])
    const extrude = features[1] as ExtrudeFeature
    expect(extrude.extent).toEqual({ kind: 'distance', from: 0, to: 12 })
    const draft = features[2]
    expect(draft.name).toBe('Draft 1')
    expect(draft.kind === 'draft' ? draft.angleDeg : NaN).toBeCloseTo(3, 2)
    expect(s().nextFeatureId).toBe(4)
    s().undoFeatures()
    expect(s().features.map((f) => f.kind)).toEqual(['sketch', 'extrude'])
    expect((s().features[1] as ExtrudeFeature).extent).toEqual({ kind: 'distance', from: 0, to: 10 })
  })

  it('adds the draft after a Move face made on the body too', () => {
    // A face nothing traces back to: another feature's.
    const top: FaceFingerprint = { kind: 'plane', centroid: [20, 10, 10], dir: [0, 0, 1], area: 800, origin: 9 }
    useReverse.setState({ featureDraft: moveDraft(top, true) })
    s().commitFeature()
    expect(s().features.map((f) => f.kind)).toEqual(['sketch', 'extrude', 'moveFace', 'draft'])
    expect(s().features[3].name).toBe('Draft 1')
    expect(s().nextFeatureId).toBe(5)
  })
})
