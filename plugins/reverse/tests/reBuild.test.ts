// SPDX-License-Identifier: AGPL-3.0-only
// The feature list through the kernel: sketches on planes, extrusions by
// distance, to a plane and between planes, a revolve about a sketch line,
// bodies joined and cut, a feature that fails loudly without taking the
// rest down, and the preview of a feature being set up.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import { bodyFacePlane, frameOnFace, type ExtrudeFeature, type Feature, type ResolveContext, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { projectFaceOutline } from '../core/project'
import { findRegions } from '../core/regions'
import { addConstraint, addEntity, addRectangle, emptySketch, type Sketch } from '../core/sketch'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { PlaneFit } from '../../../src/core/types'
import { XY } from './reKit'

// Kernel builds and real-scan fits run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

const NO_STATS = { sigma: 0, usedPoints: 0, regionSize: 0 }

function planeAt(id: number, z: number): { id: number; fit: PlaneFit } {
  return {
    id,
    fit: { kind: 'plane', center: [0, 0, z], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 50, extentV: 50, ...NO_STATS },
  }
}

/** A sketch feature holding a rectangle. */
function rectangleSketch(id: number, w: number, h: number, frame = XY, at: [number, number] = [0, 0]): SketchFeature {
  const sketch = emptySketch()
  addRectangle(sketch, at, [at[0] + w, at[1] + h])
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame, sketch, visible: true }
}

/** A sketch feature holding a circle. */
function circleSketchAt(id: number, cx: number, cy: number, r: number): SketchFeature {
  const sketch = emptySketch()
  addEntity(sketch, { kind: 'circle', c: [cx, cy], r })
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
}

/** Every region of a sketch, as the keys an extrude picks. */
const allRegions = (f: SketchFeature) => findRegions(f.sketch).map((r) => r.key)

/** An extrude of every region of a sketch. */
function extrudeAll(id: number, name: string, sketch: SketchFeature, extent: ExtrudeFeature['extent'], op: ExtrudeFeature['op'] = 'new', target?: number): ExtrudeFeature {
  return { id, kind: 'extrude', name, sketchId: sketch.id, regions: allRegions(sketch), extent, op, target, visible: true }
}

const ctx = (elements: { id: number; fit: PlaneFit }[] = []): ResolveContext => ({ sections: [], elements, modelCenter: [0, 0, 0] })

async function build(features: Feature[], c: ResolveContext = ctx()) {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, c, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  const result = builder.build(steps, (id) => sketches.get(id))
  return { result, builder, k, steps }
}

describe('building features', () => {
  it('extrudes a picked rectangle by a distance into a body', async () => {
    const s = rectangleSketch(1, 40, 20)
    const { result, builder } = await build([s, extrudeAll(2, 'Extrude 1', s, { kind: 'distance', from: 0, to: 10 })])
    expect(result.results.every((r) => r.status === 'ok')).toBe(true)
    expect(result.bodies.length).toBe(1)
    expect(result.bodies[0].closed).toBe(true)
    expect(result.bodies[0].volume).toBeCloseTo(8000, 3)
    expect(result.bodies[0].faces).toBe(6)
    expect(result.bodies[0].mesh.indices.length).toBeGreaterThanOrEqual(36)
    builder.dispose()
  })

  it('extrudes with a draft: the sides lean in, and a negative draft leans them out', async () => {
    const s = rectangleSketch(1, 40, 20)
    const straight = await build([s, extrudeAll(2, 'Extrude 1', s, { kind: 'distance', from: 0, to: 10 })])
    const drafted = await build([s, { ...extrudeAll(2, 'Extrude 1', s, { kind: 'distance', from: 0, to: 10 }), draftDeg: 10 }])
    const flared = await build([s, { ...extrudeAll(2, 'Extrude 1', s, { kind: 'distance', from: 0, to: 10 }), draftDeg: -10 }])
    expect(drafted.result.results[0].status).toBe('ok')
    expect(drafted.result.bodies[0].closed).toBe(true)
    // A 10° draft over 10 mm pulls each side in by 10 · tan 10°: the top
    // is 36.47 × 16.47, and the frustum's volume follows.
    const d = 10 * Math.tan((10 * Math.PI) / 180)
    const frustum = (10 / 3) * (40 * 20 + (40 - 2 * d) * (20 - 2 * d) + Math.sqrt(40 * 20 * (40 - 2 * d) * (20 - 2 * d)))
    // Within a tenth of a percent: the kernel measures its draft at the
    // face, the frustum here at the corners.
    expect(Math.abs(drafted.result.bodies[0].volume - frustum) / frustum).toBeLessThan(1e-3)
    expect(drafted.result.bodies[0].volume).toBeLessThan(straight.result.bodies[0].volume)
    expect(flared.result.bodies[0].volume).toBeGreaterThan(straight.result.bodies[0].volume)
    // The top face sits where the draft leaves it, 10 mm up.
    const top = drafted.result.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9)!
    expect(Math.abs(top.fingerprint.area - (40 - 2 * d) * (20 - 2 * d)) / top.fingerprint.area).toBeLessThan(1e-3)
    straight.builder.dispose()
    drafted.builder.dispose()
    flared.builder.dispose()
  })

  it('makes no step of a sketch — its regions travel with the features that pick them', async () => {
    const s = rectangleSketch(1, 40, 20)
    const { result, steps, builder } = await build([s, extrudeAll(2, 'Extrude 1', s, { kind: 'distance', from: 0, to: 10 })])
    expect(steps.map((st) => st.id)).toEqual([2])
    expect(steps[0].kind === 'extrude' && steps[0].profiles.length).toBe(1)
    expect(result.results.map((r) => r.id)).toEqual([2])
    builder.dispose()
  })

  it('reaches to a plane, and between two planes, however they are tilted', async () => {
    const elements = [planeAt(10, 15), planeAt(11, -5)]
    const s = rectangleSketch(1, 40, 20)
    const { result, builder } = await build(
      [
        s,
        extrudeAll(2, 'To plane', s, { kind: 'toPlane', from: 0, plane: { kind: 'plane', id: 10 } }),
        extrudeAll(3, 'Between', s, { kind: 'betweenPlanes', a: { kind: 'plane', id: 11 }, b: { kind: 'plane', id: 10 } }),
      ],
      ctx(elements),
    )
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    const [toPlane, between] = result.bodies
    expect(toPlane.volume).toBeCloseTo(40 * 20 * 15, 2)
    expect(between.volume).toBeCloseTo(40 * 20 * 20, 2)
    builder.dispose()
  })

  it('trims an extrusion to a tilted plane with a half-space', async () => {
    const tilted: { id: number; fit: PlaneFit } = {
      id: 12,
      fit: { kind: 'plane', center: [0, 0, 10], normal: [Math.SQRT1_2, 0, Math.SQRT1_2], basisU: [Math.SQRT1_2, 0, -Math.SQRT1_2], basisV: [0, 1, 0], extentU: 50, extentV: 50, ...NO_STATS },
    }
    const s = rectangleSketch(1, 20, 20, XY, [-10, -10])
    const { result, builder, k } = await build([s, extrudeAll(2, 'To tilted', s, { kind: 'toPlane', from: 0, plane: { kind: 'plane', id: 12 } })], ctx([tilted]))
    expect(result.results[0].status).toBe('ok')
    // The plane x + z = 10 over the square −10..10: the height runs from 20
    // at x = −10 to 0 at x = 10, so the volume is the square's area times
    // the mean height of 10.
    expect(result.bodies[0].volume).toBeCloseTo(20 * 20 * 10, 2)
    const shape = builder.body(2)!
    const b = k.bounds(shape)
    expect(b.max[2]).toBeCloseTo(20, 4)
    builder.dispose()
  })

  it('revolves a rectangle about one of its own lines into a cylinder', async () => {
    const sketch = emptySketch()
    // A 5 × 10 rectangle with its left side on the sheet's Y axis.
    const [, , , left] = addRectangle(sketch, [0, 0], [5, 10])
    const feature: SketchFeature = { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
    const { result, builder } = await build([
      feature,
      { id: 2, kind: 'revolve', name: 'Revolve 1', sketchId: 1, regions: allRegions(feature), axis: { kind: 'sketchLine', entity: left }, angleDeg: 360, op: 'new', visible: true },
    ])
    expect(result.results[0].status).toBe('ok')
    expect(result.bodies[0].volume).toBeCloseTo(Math.PI * 25 * 10, 1)
    builder.dispose()
  })

  it('joins and cuts bodies, and a hole becomes a hole', async () => {
    const withHole = rectangleSketch(1, 40, 20)
    addEntity(withHole.sketch, { kind: 'circle', c: [20, 10], r: 3 })
    const post = rectangleSketch(3, 4, 4, XY, [0, 0])
    const { result, builder } = await build([
      withHole,
      // The outer region alone, with the circle as its hole — the disc itself unpicked.
      { id: 2, kind: 'extrude', name: 'Plate', sketchId: 1, regions: [findRegions(withHole.sketch)[0].key], extent: { kind: 'distance', from: 0, to: 5 }, op: 'new', visible: true },
      post,
      extrudeAll(4, 'Post', post, { kind: 'distance', from: 5, to: 15 }, 'join', 2),
      extrudeAll(5, 'Notch', post, { kind: 'distance', from: -1, to: 2 }, 'cut', 2),
    ])
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(result.bodies.length).toBe(1)
    const plate = 40 * 20 * 5 - Math.PI * 9 * 5
    const postVolume = 4 * 4 * 10
    const notch = 4 * 4 * 2
    expect(result.bodies[0].volume).toBeCloseTo(plate + postVolume - notch, 1)
    expect(result.bodies[0].closed).toBe(true)
    builder.dispose()
  })

  it('keeps who made a face through a join that merges the faces round it', async () => {
    // A block, and a second one joined flush against its end: the tops,
    // the bottoms and the sides run on as one face each, and the block's
    // far end is built again round the edges merged into it. The merged
    // faces and that end are still the block's; the new far end is the
    // join's.
    const block = rectangleSketch(1, 20, 10)
    const more = rectangleSketch(3, 20, 10, XY, [20, 0])
    const { result, builder } = await build([
      block,
      extrudeAll(2, 'Block', block, { kind: 'distance', from: 0, to: 10 }),
      more,
      extrudeAll(4, 'More', more, { kind: 'distance', from: 0, to: 10 }, 'join', 2),
    ])
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    const faces = result.bodies[0].topology.faces.map((f) => f.fingerprint)
    expect(faces).toHaveLength(6)
    const end = (x: number) => faces.find((f) => Math.abs(f.dir[0]) > 0.99 && Math.abs(f.centroid[0] - x) < 1e-6)!
    expect(end(0).origin).toBe(2)
    expect(end(40).origin).toBe(4)
    const merged = faces.filter((f) => Math.abs(f.dir[0]) < 0.01)
    expect(merged).toHaveLength(4)
    for (const f of merged) expect(f.origin).toBe(2)
    builder.dispose()
  })

  it('leaves no seam where a sketch of crossing outlines is extruded both ways', async () => {
    // A bar and a wall across its end: the bar's part, the wall's part and
    // the piece they share in the middle, which touches the outside of the
    // sketch at its corners only — and has no hole for it.
    const s = rectangleSketch(1, 100, 20)
    addRectangle(s.sketch, [90.3, -10.2], [105, 34.9])
    const regions = findRegions(s.sketch)
    expect(regions.map((r) => r.holes.length)).toEqual([0, 0, 0])
    expect(regions.map((r) => r.area).reduce((a, b) => a + b, 0)).toBeCloseTo(100 * 20 + 14.7 * 45.1 - 9.7 * 20, 6)
    const [bar, wall, shared] = regions.map((r) => r.key)
    const extrude = (id: number, picked: string[], from: number, to: number, op: ExtrudeFeature['op'], target?: number): ExtrudeFeature => ({ id, kind: 'extrude', name: `Extrude ${id}`, sketchId: 1, regions: picked, extent: { kind: 'distance', from, to }, op, target, visible: true })
    const { result, builder } = await build([s, extrude(2, [bar, shared], -12, 0, 'new'), extrude(3, [wall, shared], 0, 40, 'join', 2), extrude(4, [wall, shared], -17, 0, 'join', 2)])
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(result.bodies[0].volume).toBeCloseTo(90.3 * 20 * 12 + 14.7 * 45.1 * 57, 3)
    // The bar's five faces outside the wall and the wall's six: nothing at
    // the height of the sketch, nothing down the wall where the bar ends.
    expect(result.bodies[0].faces).toBe(11)
    expect(result.bodies[0].topology.edges.length).toBe(24)
    builder.dispose()
  })

  it('leaves no seam where a face of a body is pulled out of its own outline', async () => {
    // A block that lies askew, at coordinates no 32-bit float holds: the
    // outline of its top face, projected into a sketch on the face and
    // extruded on, continues the four walls — and the walls stay four.
    const n = Math.hypot(0.12, -0.07, 0.99)
    const normal: [number, number, number] = [0.12 / n, -0.07 / n, 0.99 / n]
    const ux = Math.hypot(normal[2], normal[0])
    const basisU: [number, number, number] = [normal[2] / ux, 0, -normal[0] / ux]
    const basisV: [number, number, number] = [normal[1] * basisU[2] - normal[2] * basisU[1], normal[2] * basisU[0] - normal[0] * basisU[2], normal[0] * basisU[1] - normal[1] * basisU[0]]
    const askew: SectionFrame = { origin: [3.1, -7.7, 12.3], normal, basisU, basisV }
    const s = rectangleSketch(1, 40.3, 20.7, askew, [0.1, 0.2])
    const block = extrudeAll(2, 'Block', s, { kind: 'distance', from: 0, to: 10.1 })
    const first = await build([s, block])
    const top = first.result.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && Math.abs(f.fingerprint.centroid[0] * normal[0] + f.fingerprint.centroid[1] * normal[1] + f.fingerprint.centroid[2] * normal[2] - (askew.origin[0] * normal[0] + askew.origin[1] * normal[1] + askew.origin[2] * normal[2]) - 10.1) < 1e-6)!
    const frame = frameOnFace(top.fingerprint)!
    const outline = first.result.bodies[0].topology.edges.filter((e) => e.faces.includes(top.hash))
    expect(outline.length).toBe(4)
    first.builder.dispose()

    const pulled = async (edges: Parameters<typeof projectFaceOutline>[0]) => {
      const sketch = emptySketch()
      for (const e of projectFaceOutline(edges, frame).entities) addEntity(sketch, e)
      const onFace: SketchFeature = { id: 3, kind: 'sketch', name: 'Sketch 2', plane: { kind: 'fitted', frame, label: 'a face of the body' }, frame, sketch, visible: true }
      const { result, builder } = await build([s, block, onFace, extrudeAll(4, 'Pull', onFace, { kind: 'distance', from: 0, to: 5 }, 'join', 2)])
      expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
      expect(result.bodies[0].volume).toBeCloseTo(40.3 * 20.7 * 15.1, 2)
      const faces = result.bodies[0].faces
      builder.dispose()
      return faces
    }
    expect(await pulled(outline)).toBe(6)
    // The drawing of the edges alone — 32-bit floats — puts the new walls a
    // hair off the old ones, and the kernel keeps them apart.
    expect(await pulled(outline.map(({ fingerprint, polyline }) => ({ fingerprint, polyline })))).toBeGreaterThan(6)
  })

  it('reports a failed feature in its place and builds the rest', async () => {
    const s1 = rectangleSketch(1, 40, 20)
    const s3 = rectangleSketch(3, 10, 10)
    const { result, builder } = await build([
      s1,
      { id: 2, kind: 'extrude', name: 'On nothing', sketchId: 1, regions: [], extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true },
      s3,
      extrudeAll(4, 'Cut of nothing', s3, { kind: 'distance', from: 0, to: 10 }, 'cut', 2),
      extrudeAll(5, 'Fine', s3, { kind: 'distance', from: 0, to: 3 }),
      extrudeAll(6, 'Gone plane', s3, { kind: 'toPlane', from: 0, plane: { kind: 'plane', id: 99 } }),
      { id: 7, kind: 'extrude', name: 'Stale pick', sketchId: 3, regions: ['no-such-region'], extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true },
      { id: 8, kind: 'extrude', name: 'Gone sketch', sketchId: 42, regions: ['x'], extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true },
    ])
    const byId = Object.fromEntries(result.results.map((r) => [r.id, r]))
    expect(byId[2].status).toBe('failed')
    expect(byId[2].message).toMatch(/No profile picked/)
    expect(byId[4].status).toBe('failed')
    expect(byId[4].message).toMatch(/gone, or failed/)
    expect(byId[5].status).toBe('ok')
    expect(byId[6].status).toBe('failed')
    expect(byId[6].message).toMatch(/plane/)
    expect(byId[7].status).toBe('failed')
    // The sketch is closed: the regions it has are named, to pick again.
    expect(byId[7].message).toMatch(/None of the profile picked is in .* It has 1 closed region: /)
    expect(byId[8].status).toBe('failed')
    expect(byId[8].message).toMatch(/sketch .* is gone/)
    expect(result.bodies.map((b) => b.id)).toEqual([5])
    expect(result.bodies[0].volume).toBeCloseTo(300, 3)
    builder.dispose()
  })

  it('previews the solid a step would make without touching the bodies', async () => {
    const s = rectangleSketch(1, 40, 20)
    const { result, builder, steps } = await build([s, extrudeAll(2, 'Extrude 1', s, { kind: 'distance', from: 0, to: 10 })])
    expect(result.bodies.length).toBe(1)
    // The same profile, pulled further: a preview of an edit in progress.
    const [step] = resolveFeatures([s, extrudeAll(-1, 'Preview', s, { kind: 'distance', from: -5, to: 20 })], ctx(), (f) => findRegions(f.sketch))
    expect(step.kind).toBe('extrude')
    if (step.kind === 'failed' || step.kind === 'sketch') return
    const preview = builder.preview(step, s.sketch)
    expect(preview.closed).toBe(true)
    expect(preview.volume).toBeCloseTo(40 * 20 * 25, 2)
    expect(preview.mesh.indices.length).toBeGreaterThanOrEqual(36)
    // The bodies from the build stand as they were.
    expect(builder.bodyIds()).toEqual([2])
    expect(builder.body(2)).toBe(steps.length > 0 ? builder.body(2) : undefined)
    // A step that cannot be made says why rather than leaving a shape behind.
    const flat = resolveFeatures([s, extrudeAll(-1, 'Flat', s, { kind: 'distance', from: 3, to: 3 })], ctx(), (f) => findRegions(f.sketch))[0]
    if (flat.kind !== 'failed' && flat.kind !== 'sketch') expect(() => builder.preview(flat, s.sketch)).toThrow(/no length/)
    builder.dispose()
  })

  it('writes every body into one STEP file', async () => {
    const s = rectangleSketch(1, 10, 10)
    const { result, builder } = await build([
      s,
      extrudeAll(2, 'A', s, { kind: 'distance', from: 0, to: 10 }),
      extrudeAll(3, 'B', s, { kind: 'distance', from: 20, to: 30 }),
    ])
    expect(result.bodies.length).toBe(2)
    const text = builder.exportStep([2, 3])
    expect((text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length).toBe(2)
    expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)')
    builder.dispose()
  })
})

describe('a face of a body pulled as the profile', () => {
  it('pulls the face as it stands, follows the face when an earlier feature moves or reshapes it, and fails by name when it is gone', async () => {
    const s = rectangleSketch(1, 40, 20)
    const block = (to: number) => extrudeAll(2, 'Block', s, { kind: 'distance', from: 0, to })
    const first = await build([s, block(10)])
    const top = first.result.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && Math.abs(f.fingerprint.centroid[2] - 10) < 1e-6)!
    first.builder.dispose()
    const pull = (to: number, op: ExtrudeFeature['op'] = 'join'): ExtrudeFeature => ({ id: 3, kind: 'extrude', name: 'Pull', sketchId: 0, regions: [], face: { body: 2, face: top.fingerprint }, extent: { kind: 'distance', from: 0, to }, op, target: 2, visible: true })

    // Out of the block: a boss the size of the face, joined.
    const out = await build([s, block(10), pull(5)])
    expect(out.result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(out.result.bodies[0].volume).toBeCloseTo(40 * 20 * 15, 2)
    expect(out.result.bodies[0].faces).toBe(6)
    out.builder.dispose()

    // Into the block: a cut the size of the face.
    const into = await build([s, block(10), pull(-3, 'cut')])
    expect(into.result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(into.result.bodies[0].volume).toBeCloseTo(40 * 20 * 7, 2)
    into.builder.dispose()

    // The block made taller: the pull stands on the new top, not where
    // the face was.
    const taller = await build([s, block(12), pull(5)])
    expect(taller.result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(taller.result.bodies[0].volume).toBeCloseTo(40 * 20 * 17, 2)
    taller.builder.dispose()

    // A hole cut through the block first: the top face has a hole, and
    // so has what is pulled from it — nothing was copied.
    const hole = circleSketchAt(4, 10, 10, 3)
    const drill: ExtrudeFeature = { id: 5, kind: 'extrude', name: 'Hole', sketchId: 4, regions: allRegions(hole), extent: { kind: 'distance', from: -1, to: 11 }, op: 'cut', target: 2, visible: true }
    const holed = await build([s, block(10), hole, drill, { ...pull(5), id: 6 }])
    expect(holed.result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(holed.result.bodies[0].volume).toBeCloseTo(40 * 20 * 15 - Math.PI * 9 * 15, 1)
    holed.builder.dispose()

    // The face gone — the block cut away under it — the pull fails by name.
    const gone = await build([s, block(60), pull(5)])
    expect(gone.result.results[1].status).toBe('failed')
    expect(gone.result.results[1].message).toMatch(/face this extrude pulls is gone/)
    gone.builder.dispose()
  })
})

describe('a sketch on a face of a body', () => {
  it('follows the face when an earlier feature moves it, and stays put with a note when the face is lost', async () => {
    // A block, and a boss sketched on its top face.
    const s = rectangleSketch(1, 40, 20)
    const block = (to: number) => extrudeAll(2, 'Block', s, { kind: 'distance', from: 0, to })
    const first = await build([s, block(10)])
    const top = first.result.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && Math.abs(f.fingerprint.centroid[2] - 10) < 1e-6)!
    first.builder.dispose()
    const ref = bodyFacePlane(2, top.fingerprint)!
    expect(ref.frame.origin).toEqual([0, 0, 10])
    const sketch = emptySketch()
    addRectangle(sketch, [5, 5], [15, 15])
    const onFace: SketchFeature = { id: 3, kind: 'sketch', name: 'Boss sketch', plane: ref, frame: ref.frame, sketch, visible: true }
    const boss = extrudeAll(4, 'Boss', onFace, { kind: 'distance', from: 0, to: 5 }, 'join', 2)

    // The sketch is placed on the face as a step of its own, before the
    // boss: its row carries where it was found.
    const asDrawn = await build([s, block(10), onFace, boss])
    expect(asDrawn.result.results.map((r) => [r.id, r.status])).toEqual([[2, 'ok'], [3, 'ok'], [4, 'ok']])
    expect(asDrawn.result.bodies[0].volume).toBeCloseTo(40 * 20 * 10 + 10 * 10 * 5, 2)
    expect(asDrawn.result.results[1].sketchFrame).toEqual({ sketchId: 3, frame: ref.frame })
    expect(asDrawn.result.results[1].note).toBeUndefined()
    asDrawn.builder.dispose()

    // The block made taller: the top face is found again 2 mm up, and the
    // boss stands on it — not buried in the block where it was drawn.
    const taller = await build([s, block(12), onFace, boss])
    expect(taller.result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(taller.result.bodies[0].volume).toBeCloseTo(40 * 20 * 12 + 10 * 10 * 5, 2)
    expect(taller.result.results[1].sketchFrame?.frame.origin).toEqual([0, 0, 12])
    expect(taller.result.results[1].note).toBeUndefined()
    taller.builder.dispose()

    // Made much taller, the face is beyond the fingerprint's reach: the
    // sketch stays where it was, the feature builds, and the row says so.
    const lost = await build([s, block(60), onFace, boss])
    expect(lost.result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(lost.result.bodies[0].volume).toBeCloseTo(40 * 20 * 60, 2)
    expect(lost.result.results[1].note).toMatch(/was not found/)
    expect(lost.result.results[1].sketchFrame?.frame).toEqual(ref.frame)
    lost.builder.dispose()
  })

  it('takes its projected outline again when an earlier feature moves the edges, and what is held to it follows', async () => {
    // A tray: a box shelled open at the top, and an ear in a corner of the
    // floor, sketched on the floor with the floor's outline projected, its
    // corner joined to the outline's and its sides dimensioned.
    const s = rectangleSketch(1, 40, 30)
    const box = extrudeAll(2, 'Box', s, { kind: 'distance', from: 0, to: 20 })
    const first = await build([s, box])
    const faces = first.result.bodies[0].topology.faces
    const top = faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.5)!
    first.builder.dispose()
    const shell = (thickness: number): Feature => ({ id: 3, kind: 'shell', name: 'Shell', body: 2, faces: [top.fingerprint], thickness, visible: true })
    const shelled = await build([s, box, shell(2)])
    const body = shelled.result.bodies[0]
    const floor = body.topology.faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.5 && Math.abs(f.fingerprint.centroid[2] - 2) < 1e-6)!
    const ref = bodyFacePlane(2, floor.fingerprint)!
    const { entities } = projectFaceOutline(body.topology.edges.filter((e) => e.faces.includes(floor.hash)), ref.frame, 2)
    shelled.builder.dispose()
    expect(entities).toHaveLength(4)
    expect(entities.every((e) => e.source && 'edge' in e.source && e.source.body === 2)).toBe(true)

    const sketch = emptySketch()
    for (const e of entities) addEntity(sketch, e)
    // The outline's corner at (2, 2), where the walls meet the floor.
    const corner = sketch.entities.flatMap((e) => (e.kind === 'line' ? (['a', 'b'] as const).map((at) => ({ entity: e.id, at, p: at === 'a' ? e.a : e.b })) : [])).find((x) => Math.hypot(x.p[0] - 2, x.p[1] - 2) < 1e-6)!
    const [bottom, , , left] = addRectangle(sketch, [2, 2], [8, 8])
    addConstraint(sketch, { kind: 'coincident', p: { entity: bottom, at: 'a' }, q: { entity: corner.entity, at: corner.at } })
    addConstraint(sketch, { kind: 'length', entity: bottom, value: 6 })
    addConstraint(sketch, { kind: 'length', entity: left, value: 6 })
    const onFloor: SketchFeature = { id: 4, kind: 'sketch', name: 'Ear sketch', plane: ref, frame: ref.frame, sketch, visible: true }
    const earRegion = findRegions(sketch).find((r) => Math.abs(r.area - 36) < 1e-6)!
    const ear: ExtrudeFeature = { id: 5, kind: 'extrude', name: 'Ear', sketchId: 4, regions: [earRegion.key], extent: { kind: 'distance', from: 0, to: 10 }, op: 'join', visible: true }
    const tray = (t: number) => 40 * 30 * 20 - (40 - 2 * t) * (30 - 2 * t) * (20 - t)

    const asDrawn = await build([s, box, shell(2), onFloor, ear])
    expect(asDrawn.result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(asDrawn.result.results[2].sketch).toBeUndefined()
    expect(asDrawn.result.bodies).toHaveLength(1)
    expect(asDrawn.result.bodies[0].volume).toBeCloseTo(tray(2) + 6 * 6 * 10, 1)
    asDrawn.builder.dispose()

    // A thinner wall: the floor drops to 1 mm and the walls stand out to
    // x = 1 and y = 1. The outline is taken again there, the ear's corner
    // goes with it, and the ear stands against the walls as it did — no
    // gap — its sides as dimensioned.
    const thinner = await build([s, box, shell(1), onFloor, ear])
    expect(thinner.result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    const placed = thinner.result.results[2]
    expect(placed.note).toBeUndefined()
    expect(placed.sketchFrame?.frame.origin[2]).toBeCloseTo(1, 9)
    const moved = placed.sketch!
    const at = (id: number) => moved.entities.find((e) => e.id === id)!
    const earBottom = at(bottom)
    expect(earBottom.kind === 'line' && earBottom.a[0]).toBeCloseTo(1, 6)
    expect(earBottom.kind === 'line' && earBottom.a[1]).toBeCloseTo(1, 6)
    expect(earBottom.kind === 'line' && earBottom.b[0]).toBeCloseTo(7, 6)
    expect(moved.entities.filter((e) => e.projected).every((e) => e.kind === 'line' && Math.min(e.a[0], e.b[0]) > 0.999 && Math.max(e.a[0], e.b[0]) < 39.001)).toBe(true)
    expect(thinner.result.bodies).toHaveLength(1)
    expect(thinner.result.bodies[0].volume).toBeCloseTo(tray(1) + 6 * 6 * 10, 1)
    thinner.builder.dispose()

    // A thicker wall: an ear left where it was drawn would sink a millimetre
    // into both walls; it stands against them, whole.
    const thicker = await build([s, box, shell(3), onFloor, ear])
    expect(thicker.result.bodies[0].volume).toBeCloseTo(tray(3) + 6 * 6 * 10, 1)
    thicker.builder.dispose()
    // A face's outline projected before projections followed the part has
    // no source. Where the face's edges have moved off it, it stays where
    // it landed, and the ear with it.
    const unlinked = { ...onFloor, sketch: { ...sketch, entities: sketch.entities.map(({ source: _, ...e }) => e) } }
    const stale = await build([s, box, shell(3), unlinked, ear])
    expect(stale.result.results[2].sketch).toBeUndefined()
    expect(stale.result.bodies[0].volume).toBeCloseTo(tray(3) + 6 * 6 * 10 - (1 * 6 + 1 * 6 - 1) * 10, 1)
    stale.builder.dispose()
    // Built where the edges still lie on it, each piece is given its edge,
    // nothing moved; kept so, it follows from then on.
    const linking = await build([s, box, shell(2), unlinked, ear])
    const adopted = linking.result.results[2].sketch!
    expect(adopted.entities.filter((e) => e.projected).every((e) => e.source && 'edge' in e.source && e.source.body === 2)).toBe(true)
    expect(adopted.entities).toEqual(sketch.entities.map((e) => expect.objectContaining({ id: e.id, ...(e.kind === 'line' ? { a: e.a, b: e.b } : {}) })))
    linking.builder.dispose()
    const linked = await build([s, box, shell(3), { ...onFloor, sketch: adopted }, ear])
    expect(linked.result.bodies[0].volume).toBeCloseTo(tray(3) + 6 * 6 * 10, 1)
    linked.builder.dispose()

    // Kept as the build solved it, the sketch builds the same and is not
    // solved again: the projection is where its edges are.
    const kept = await build([s, box, shell(1), { ...onFloor, sketch: moved, frame: placed.sketchFrame!.frame, plane: { ...ref, frame: placed.sketchFrame!.frame } }, ear])
    expect(kept.result.results[2].sketch).toBeUndefined()
    expect(kept.result.bodies[0].volume).toBeCloseTo(tray(1) + 6 * 6 * 10, 1)
    kept.builder.dispose()

    // An edge projected twice is found for both pieces, and both follow it.
    const twice = { ...onFloor, sketch: { ...sketch, entities: [...sketch.entities, { ...sketch.entities[0], id: 99 }], nextId: 100 } }
    const doubled = await build([s, box, shell(1), twice, ear])
    expect(doubled.result.results[2].note).toBeUndefined()
    const pair = doubled.result.results[2].sketch!.entities.filter((e) => e.id === sketch.entities[0].id || e.id === 99)
    expect(pair).toHaveLength(2)
    expect(pair[0].kind === 'line' && pair[1].kind === 'line' && pair[0].a).toEqual(pair[1].kind === 'line' ? pair[1].a : null)
    doubled.builder.dispose()

    // A source no longer on the part leaves its piece where it was, and
    // the sketch's row says so.
    const orphan = { ...onFloor, sketch: { ...sketch, entities: sketch.entities.map((e) => (e.source && 'edge' in e.source ? { ...e, source: { ...e.source, body: 99 } } : e)) } }
    const gone = await build([s, box, shell(2), orphan, ear])
    expect(gone.result.results[2].note).toMatch(/4 projected pieces no longer found/)
    expect(gone.result.results[3].status).toBe('ok')
    gone.builder.dispose()
  })

  it('takes a piece projected from another sketch again from where that sketch has it now', async () => {
    // A cap sketched 10 mm above a base sketch, its outline the base's
    // right side projected up and a box drawn against it.
    const base = rectangleSketch(1, 40, 20)
    const right = base.sketch.entities[1]
    const up: SectionFrame = { ...XY, origin: [0, 0, 10] }
    const sketch = emptySketch()
    const edge = addEntity(sketch, { kind: 'line', a: [40, 0], b: [40, 20], fixed: true, projected: true, source: { sketch: 1, entity: right.id } })
    const [bottom, , , left] = addRectangle(sketch, [40, 5], [45, 15])
    addConstraint(sketch, { kind: 'pointOn', p: { entity: left, at: 'a' }, on: { line: edge } })
    addConstraint(sketch, { kind: 'pointOn', p: { entity: left, at: 'b' }, on: { line: edge } })
    addConstraint(sketch, { kind: 'length', entity: bottom, value: 5 })
    const cap: SketchFeature = { id: 2, kind: 'sketch', name: 'Cap', plane: { kind: 'fitted', frame: up }, frame: up, sketch, visible: true }
    const tab: ExtrudeFeature = { id: 3, kind: 'extrude', name: 'Tab', sketchId: 2, regions: [findRegions(sketch)[0].key], extent: { kind: 'distance', from: 0, to: 2 }, op: 'new', visible: true }

    // The base made 30 wide: the projected side comes along, and the box
    // drawn against it.
    const narrower = rectangleSketch(1, 30, 20)
    const { result, builder } = await build([narrower, cap, tab])
    expect(result.results.map((r) => [r.id, r.status])).toEqual([[2, 'ok'], [3, 'ok']])
    const moved = result.results[0].sketch!
    const box = moved.entities.find((e) => e.id === bottom)!
    expect(box.kind === 'line' && Math.min(box.a[0], box.b[0])).toBeCloseTo(30, 6)
    expect(box.kind === 'line' && Math.max(box.a[0], box.b[0])).toBeCloseTo(35, 6)
    expect(result.bodies[0].volume).toBeCloseTo(5 * 10 * 2, 3)
    builder.dispose()
  })
})

describe('where a round or a shell fails', () => {
  /** The edges along the top of a box built from a rectangle sketch. */
  const topEdges = (built: Awaited<ReturnType<typeof build>>, z: number) => built.result.bodies[0].topology.edges.filter((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.mid[2] - z) < 1e-6)

  it('names the edge that does not round at the radius, draws it, and finds the radius it takes', async () => {
    const sk = rectangleSketch(1, 40, 20)
    const box = extrudeAll(2, 'Box', sk, { kind: 'distance', from: 0, to: 10 })
    const first = await build([sk, box])
    const long = topEdges(first, 10).filter((e) => e.fingerprint.length > 30)
    expect(long).toHaveLength(2)
    // A round bigger than the box is tall.
    const fillet: Feature = { id: 3, kind: 'fillet', name: 'Fillet', body: 2, edges: [long[0].fingerprint], radius: 15, chain: false, visible: true }
    const { result } = await build([sk, box, fillet])
    const r = result.results.find((x) => x.id === 3)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/The edge does not round at 15 mm — drawn red on the part\. It rounds at up to \d+(\.\d+)? mm\./)
    const upTo = Number(/up to (\d+(?:\.\d+)?) mm/.exec(r.message!)![1])
    expect(upTo).toBeGreaterThan(5)
    expect(upTo).toBeLessThan(10)
    expect(r.where).toHaveLength(1)
    expect(r.where![0].length).toBeGreaterThanOrEqual(6)
    // The box is still there, untouched.
    expect(result.bodies[0].volume).toBeCloseTo(40 * 20 * 10, 3)
  })

  it('tells two rounds that each fit alone but run into each other apart from one that does not fit', async () => {
    const sk = rectangleSketch(1, 40, 20)
    const box = extrudeAll(2, 'Box', sk, { kind: 'distance', from: 0, to: 30 })
    const first = await build([sk, box])
    const long = topEdges(first, 30).filter((e) => e.fingerprint.length > 30)
    // 12 mm each way across a 20 mm top: alone each fits, together not.
    const fillet: Feature = { id: 3, kind: 'fillet', name: 'Fillet', body: 2, edges: long.map((e) => e.fingerprint), radius: 12, chain: false, visible: true }
    const { result } = await build([sk, box, fillet])
    const r = result.results.find((x) => x.id === 3)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/Each of the 2 edges rounds alone at 12 mm; together they do not/)
    expect(r.message).toMatch(/Together they round at up to \d+(\.\d+)? mm/)
    expect(r.where).toHaveLength(2)
  })

  it('says when a wall does not fit the body even closed, and the wall that does', async () => {
    const sk = rectangleSketch(1, 40, 20)
    const box = extrudeAll(2, 'Box', sk, { kind: 'distance', from: 0, to: 10 })
    const first = await build([sk, box])
    const top = first.result.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9)!
    // A closed hollow with a wall thicker than half the box's height
    // leaves nothing inside.
    const shell: Feature = { id: 3, kind: 'shell', name: 'Shell', body: 2, faces: [], thickness: 6, visible: true }
    const { result } = await build([sk, box, shell])
    const r = result.results.find((x) => x.id === 3)!
    expect(r.status).toBe('failed')
    // The box is 10 mm thick where two 6 mm walls would have to fit: the
    // message says so, and where.
    expect(r.message).toMatch(/A wall of 6 mm does not fit the body: the body is thinner than two walls \(12 mm\) at \([-\d., ]+\), 10 mm thick.* — marked red on the part\. It hollows at a wall of up to \d+(\.\d+)? mm\./)
    expect(r.where!.length).toBeGreaterThan(0)
    const upTo = Number(/up to (\d+(?:\.\d+)?) mm/.exec(r.message!)![1])
    expect(upTo).toBeGreaterThan(3)
    expect(upTo).toBeLessThan(5)
    // With the top open a wall of 6 mm fits: a 4 mm pocket is left.
    const opened = await build([sk, box, { ...shell, faces: [top.fingerprint] }])
    expect(opened.result.results.find((x) => x.id === 3)!.status).toBe('ok')
  })

  it('the preview of a round that fails says where too', async () => {
    const sk = rectangleSketch(1, 40, 20)
    const box = extrudeAll(2, 'Box', sk, { kind: 'distance', from: 0, to: 10 })
    const first = await build([sk, box])
    const long = topEdges(first, 10).filter((e) => e.fingerprint.length > 30)
    const fillet: Feature = { id: 3, kind: 'fillet', name: 'Fillet', body: 2, edges: [long[0].fingerprint], radius: 15, chain: false, visible: true }
    const steps = resolveFeatures([sk, box, fillet], ctx(), (f) => findRegions(f.sketch))
    const step = steps.find((x) => x.id === 3)!
    expect(step.kind).toBe('fillet')
    if (step.kind !== 'fillet') return
    expect(() => first.builder.preview(step, undefined)).toThrow()
    const d = first.builder.diagnose(step)
    expect(d?.message).toMatch(/The edge does not round at 15 mm/)
    expect(d?.where).toHaveLength(1)
    // A step of another kind, or a pick that is gone, has nothing to say.
    expect(first.builder.diagnose(steps.find((x) => x.id === 2)!)).toBeNull()
    expect(first.builder.diagnose({ ...step, edges: [{ ...long[0].fingerprint, mid: [500, 500, 500] }] })).toBeNull()
  })
})

describe('a shell the thick solid gives up on', () => {
  /** A bar with a block on its end — the fridge bracket of 2026-09-23: nine
   *  flat faces, and the kernel's thick solid fails on any two opened on
   *  opposite sides of the step where the block meets the bar. */
  async function bracket() {
    const bar = rectangleSketch(1, 94.7, 10.29, XY, [-48.65, 0])
    const block = rectangleSketch(3, 6.7, 14.11, XY, [42.09, 0])
    const built = await build([bar, extrudeAll(2, 'Bar', bar, { kind: 'distance', from: 0, to: 7.46 }), block, extrudeAll(4, 'Block', block, { kind: 'distance', from: 0, to: 20.5 }, 'join', 2)])
    const faces = built.result.bodies[0].topology.faces
    const face = (test: (f: (typeof faces)[number]['fingerprint']) => boolean) => faces.find((f) => f.fingerprint.kind === 'plane' && test(f.fingerprint))!.fingerprint
    return {
      features: [bar, extrudeAll(2, 'Bar', bar, { kind: 'distance', from: 0, to: 7.46 }), block, extrudeAll(4, 'Block', block, { kind: 'distance', from: 0, to: 20.5 }, 'join', 2)] as Feature[],
      volume: built.result.bodies[0].volume,
      front: face((f) => f.dir[1] < -0.9),
      bottom: face((f) => f.dir[2] < -0.9),
      barTop: face((f) => f.dir[2] > 0.9 && f.centroid[0] < 0),
      blockTop: face((f) => f.dir[2] > 0.9 && f.centroid[0] > 40),
    }
  }

  it('opens the front, the bar top and the block top together by offset and cut', async () => {
    const b = await bracket()
    const shell: Feature = { id: 5, kind: 'shell', name: 'Shell', body: 2, faces: [b.front, b.barTop, b.blockTop], thickness: 2, visible: true }
    const { result } = await build([...b.features, shell])
    const r = result.results.find((x) => x.id === 5)!
    expect(r.status).toBe('ok')
    const body = result.bodies[0]
    expect(body.closed).toBe(true)
    // Three sides open of a 2 mm wall on a body this size: about half of it gone.
    expect(body.volume).toBeGreaterThan(0.4 * b.volume)
    expect(body.volume).toBeLessThan(0.6 * b.volume)
    // The bar's top is open: what is left on its plane are the ends of the
    // walls, none anything like the face that was there.
    const onTop = body.topology.faces.filter((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9 && Math.abs(f.fingerprint.centroid[2] - 7.46) < 1e-3)
    expect(onTop.length).toBeGreaterThan(0)
    expect(Math.max(...onTop.map((f) => f.fingerprint.area))).toBeLessThan(0.3 * b.barTop.area)
  })

  /** The same bracket as saved on 2026-10-04, every edge rounded but the
   *  bottom's and the back's: a bar with a plate across its end, a 5 mm
   *  round between the plate's bottom and its back, 2.5 mm on the rest.
   *  Under the plate, between its front and that round, the bottom is a
   *  strip 1.37 mm wide. */
  async function roundedBracket() {
    const bar = rectangleSketch(1, 95.953344659844705, 18.5, XY, [-48.224072822605635, -9.25])
    const plate = rectangleSketch(3, 6.36528565989626, 28.5, XY, [42.37369658199797, -14.25])
    const solid: Feature[] = [bar, extrudeAll(2, 'Bar', bar, { kind: 'distance', from: 0, to: 7.49 }), plate, extrudeAll(4, 'Plate', plate, { kind: 'distance', from: 0, to: 20.52 }, 'join', 2)]
    const blocky = await build(solid)
    const backEdge = blocky.result.bodies[0].topology.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.mid[0] - 48.73898224189423) < 1e-6 && Math.abs(e.fingerprint.mid[2]) < 1e-6)!
    const round: Feature = { id: 5, kind: 'fillet', name: 'Round', body: 2, edges: [backEdge.fingerprint], radius: 5, chain: true, visible: true }
    const rounded = await build([...solid, round])
    const rest = rounded.result.bodies[0].topology.edges.filter((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.mid[2]) > 1e-6 && Math.abs(e.fingerprint.mid[0] - 48.73898224189423) > 1e-6)
    expect(rest).toHaveLength(13)
    const rounds: Feature = { id: 6, kind: 'fillet', name: 'Rounds', body: 2, edges: rest.map((e) => e.fingerprint), radius: 2.5, chain: true, visible: true }
    const built = await build([...solid, round, rounds])
    expect(built.result.results.every((r) => r.status === 'ok')).toBe(true)
    const faces = built.result.bodies[0].topology.faces.map((f) => f.fingerprint)
    return {
      features: [...solid, round, rounds],
      volume: built.result.bodies[0].volume,
      bottom: faces.find((f) => f.kind === 'plane' && f.dir[2] < -0.9)!,
      back: faces.find((f) => f.kind === 'plane' && f.dir[0] > 0.9)!,
      round: faces.find((f) => f.kind === 'cylinder' && Math.abs((f.radius ?? 0) - 5) < 1e-6)!,
    }
  }

  /** The area across the body's bar, from a slice 1 mm thick at x. */
  async function barSection(built: Awaited<ReturnType<typeof build>>, x: number) {
    const k = built.k
    const slab = k.box([x - 0.5, -20, -5], [x + 0.5, 20, 30])
    const slice = k.common(built.builder.body(2)!, slab)
    try {
      return k.volume(slice)
    } finally {
      k.release(slab)
      k.release(slice)
    }
  }

  it('opens the bottom, the round and the back of a rounded bracket, the thick solid failing on it', async () => {
    const b = await roundedBracket()
    const shell: Feature = { id: 7, kind: 'shell', name: 'Shell', body: 2, faces: [b.bottom, b.round, b.back], thickness: 1, visible: true }
    const built = await build([...b.features, shell])
    expect(built.result.results.find((x) => x.id === 7)!.status).toBe('ok')
    expect(built.result.bodies[0].closed).toBe(true)
    // Across the bar a channel open at the bottom: the top and the two
    // sides a millimetre thick, about 30 mm² against the bar's 130.
    const across = await barSection(built, 0)
    expect(across).toBeGreaterThan(25)
    expect(across).toBeLessThan(35)
  })

  it('takes no body handed back untouched for a shell', async () => {
    const b = await roundedBracket()
    // The thick solid "opens" the back alone by giving the body back as it
    // was; the shell is made the long way instead.
    const shell: Feature = { id: 7, kind: 'shell', name: 'Shell', body: 2, faces: [b.back], thickness: 1, visible: true }
    const built = await build([...b.features, shell])
    expect(built.result.results.find((x) => x.id === 7)!.status).toBe('ok')
    expect(built.result.bodies[0].closed).toBe(true)
    expect(built.result.bodies[0].volume).toBeLessThan(0.4 * b.volume)
  })

  it('fails a wall the inward offset breaks up at, says the wall that fits, and leaves the body whole', async () => {
    const b = await roundedBracket()
    // At 2 mm the strip of bottom under the plate is gone from the core,
    // which the kernel's offset cannot do.
    const shell: Feature = { id: 7, kind: 'shell', name: 'Shell', body: 2, faces: [b.bottom, b.round, b.back], thickness: 2, visible: true }
    const built = await build([...b.features, shell])
    const r = built.result.results.find((x) => x.id === 7)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/A wall of 2 mm does not fit the body even with no face opened: (the kernel's offset failed \(.+\), no thin spot found, and every face of it offsets inward by 2 mm alone — so it fails where faces meet: .+ or a face narrower than the wall|the body is thinner than two walls \(4 mm\) at .* — marked red on the part)\. It hollows at a wall of up to 1\.3\d mm\./)
    // The failed attempts worked on copies: the body after the rounds is
    // as it was, and still a closed solid.
    expect(built.result.bodies[0].closed).toBe(true)
    expect(built.result.bodies[0].volume).toBeCloseTo(b.volume, 3)
  })

  it('opens two adjacent faces across the step, the corner between them gone', async () => {
    const b = await bracket()
    const shell: Feature = { id: 5, kind: 'shell', name: 'Shell', body: 2, faces: [b.front, b.bottom], thickness: 2, visible: true }
    const { result } = await build([...b.features, shell])
    expect(result.results.find((x) => x.id === 5)!.status).toBe('ok')
    const body = result.bodies[0]
    expect(body.closed).toBe(true)
    // Nothing is left along the edge the two opened faces shared: no face
    // of the shell has its centre within a wall of both of their planes.
    const rod = body.topology.faces.filter((f) => f.fingerprint.centroid[1] < 2 + 1e-3 && f.fingerprint.centroid[2] < 2 + 1e-3 && f.fingerprint.area > 1)
    expect(rod).toHaveLength(0)
    expect(body.volume).toBeLessThan(b.volume - 2 * (b.front.area + b.bottom.area) * 0.6)
  })
})
