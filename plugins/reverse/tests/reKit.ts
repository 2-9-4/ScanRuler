// SPDX-License-Identifier: AGPL-3.0-only
// What the Reverse engineer tests build their models from: the XY frame,
// sketches and features written out, a build of a feature list, the
// resolve context of a part with nothing else in it, and the workspace
// reset between tests.

import type { SectionFrame } from '../../../src/core/section/frame'
import type { ExtrudeFeature, Feature, ResolveContext, SketchFeature } from '../core/features'
import { addRectangle, emptySketch, type Sketch } from '../core/sketch'
import { findRegions } from '../core/regions'
import type { Builder } from '../core/build'
import { resolveFeatures } from '../core/resolve'

export const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }

export function rectangleSketch(id: number, w: number, h: number, at: [number, number] = [0, 0]): SketchFeature {
  const sketch = emptySketch()
  addRectangle(sketch, at, [at[0] + w, at[1] + h])
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
}

export function extrudeAll(id: number, sketch: SketchFeature, from: number, to: number, op: ExtrudeFeature['op'] = 'new', target?: number): ExtrudeFeature {
  return { id, kind: 'extrude', name: `Extrude ${id}`, sketchId: sketch.id, regions: findRegions(sketch.sketch).map((r) => r.key), extent: { kind: 'distance', from, to }, op, target, visible: true }
}

export async function build(builder: Builder, features: Feature[]) {
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return builder.build(steps, (id) => sketches.get(id))
}

export const ctx: ResolveContext = { sections: [], elements: [], modelCenter: [0, 0, 0] }

export function sketchOf(id: number, draw: (s: Sketch) => void): SketchFeature {
  const sketch = emptySketch()
  draw(sketch)
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
}

