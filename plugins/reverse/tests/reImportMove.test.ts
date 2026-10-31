// SPDX-License-Identifier: AGPL-3.0-only
// A STEP file imported as bodies, and bodies moved, turned and copied: the
// move's numbers as a matrix and the gizmo's rings about the axes their
// angles turn about; the builder's Import — a body a solid, under the
// file's part names and colours, read once — and Move, whose faces keep
// their makers so a round picked after it still finds its edge, a copy
// left beside the original; the Move box in the store, its pivot and its
// gizmo; the files carried in the project archive.

import { beforeEach, describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { islandId, stepFileKey, type ExtrudeFeature, type Feature, type ResolveContext, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { matrix4Of, mergeMeshes, moveMatrix, movedMesh, movePoint, movesNothing, pivotOf, ringAxes, rotationOf } from '../core/move'
import { moveGrips } from '../core/preview'
import { findRegions } from '../core/regions'
import { type Sketch } from '../core/sketch'
import { matchEdge, matchTolerance } from '../core/topo'
import { applyReversePart, collectReversePart, STEP_MEMBER, validateFeatureJson, type ReversePart } from '../app/projectSection'
import { featureDraftReady, featureOfDraft, gripFieldValue, nameBodies, useReverse, type BodyInfo } from '../state/reStore'
import type { Vec3 } from '../../../src/core/types'
import { rectangleSketch } from './reKit'

const kernelPromise = ReKernel.load()
const ctx = (): ResolveContext => ({ sections: [], elements: [], modelCenter: [0, 0, 0] })

function extrudeAll(id: number, sketch: SketchFeature, from: number, to: number): ExtrudeFeature {
  return { id, kind: 'extrude', name: `Extrude ${id}`, sketchId: sketch.id, regions: findRegions(sketch.sketch).map((r) => r.key), extent: { kind: 'distance', from, to }, op: 'new', visible: true }
}

function build(builder: Builder, features: Feature[]) {
  const steps = resolveFeatures(features, ctx(), (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return builder.build(steps, (id) => sketches.get(id), true)
}

function boxOf(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  return { min, max }
}

const expectVec = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits))

/** A STEP file of two parts — a 10 × 10 × 2 plate and a 4 × 4 × 6 post
 *  beside it — named, as the workspace's own export writes one. */
async function twoPartFile(): Promise<string> {
  const builder = new Builder(await kernelPromise)
  const a = rectangleSketch(1, 10, 10)
  const b = rectangleSketch(3, 4, 4, [20, 0])
  build(builder, [a, extrudeAll(2, a, 0, 2), b, extrudeAll(4, b, 0, 6)])
  const text = builder.exportStep([2, 4], [
    { name: 'Plate', color: '#1d3f7a' },
    { name: 'Post', color: '#c03030' },
  ])
  builder.dispose()
  return text
}

describe('the move as numbers', () => {
  it('turns about the pivot, X then Y then Z, and carries after', () => {
    const turn = moveMatrix({ pivot: [10, 0, 0], translate: [0, 0, 0], rotate: [0, 0, 90] })
    expectVec(movePoint(turn, [20, 0, 0]), [10, 10, 0])
    expectVec(movePoint(turn, [10, 0, 0]), [10, 0, 0])
    const both = moveMatrix({ pivot: [0, 0, 0], translate: [5, 0, 0], rotate: [90, 0, 90] })
    // (0, 1, 0) about X by 90° is (0, 0, 1); about Z it stays; then +5 in X.
    expectVec(movePoint(both, [0, 1, 0]), [5, 0, 1])
    // (1, 0, 0) stays under X, goes to (0, 1, 0) under Z.
    expectVec(movePoint(both, [1, 0, 0]), [5, 1, 0])
    expect(movesNothing({ translate: [0, 0, 0], rotate: [0, 360, 0] })).toBe(true)
    expect(movesNothing({ translate: [0, 0, 1e-3], rotate: [0, 0, 0] })).toBe(false)
  })

  it('stands each ring about the axis its own angle turns about', () => {
    const rotate: Vec3 = [20, -35, 50]
    const [ax, ay, az] = ringAxes(rotate)
    const turnAbout = (axis: Vec3, deg: number) => {
      // Rodrigues: a turn by deg about a unit axis, row-major 3 × 3.
      const t = (deg * Math.PI) / 180
      const c = Math.cos(t), s = Math.sin(t), k = 1 - c
      const [x, y, z] = axis
      return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k]
    }
    const mul = (a: number[], b: number[]) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]))
    const base = rotationOf(rotate)
    // A few degrees more of one angle is that turn about its ring's axis,
    // after everything else.
    expectVec(rotationOf([27, -35, 50]), mul(turnAbout(ax, 7), base), 9)
    expectVec(rotationOf([20, -28, 50]), mul(turnAbout(ay, 7), base), 9)
    expectVec(rotationOf([20, -35, 57]), mul(turnAbout(az, 7), base), 9)
    // With nothing turned the rings stand about X, Y and Z themselves.
    expectVec(ringAxes([0, 0, 0]).flat(), [1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('puts the gizmo where the bodies are going: an arrow and a ring an axis, in its colour', () => {
    const grips = moveGrips({ pivot: [1, 2, 3], translate: [10, 0, 0], rotate: [0, 0, 0] }, 60)
    expect(grips.map((g) => `${g.side}:${g.shape}`)).toEqual(['moveX:arrow', 'turnX:ring', 'moveY:arrow', 'turnY:ring', 'moveZ:arrow', 'turnZ:ring'])
    expectVec(grips[1].position, [11, 2, 3])
    expect(grips[1].size).toBe(60)
    // The arrow stands on the middle too, off it past the ring.
    expectVec(grips[0].position, [11, 2, 3])
    expect(grips[0].standoff).toBeGreaterThan(60)
    // Held on the screen, rings and arrows alike, whatever the zoom.
    expect(grips.every((g) => g.pixels)).toBe(true)
    expect(new Set(grips.map((g) => g.color)).size).toBe(3)
  })

  it('carries a mesh and puts meshes together, and finds the middle of boxes', () => {
    const tri = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) }
    const moved = movedMesh(tri, moveMatrix({ pivot: [0, 0, 0], translate: [0, 0, 5], rotate: [90, 0, 0] }))
    expectVec(Array.from(moved.positions.slice(3, 9)), [1, 0, 5, 0, 0, 6])
    expectVec(Array.from(moved.normals.slice(0, 3)), [0, -1, 0])
    const both = mergeMeshes([tri, moved])
    expect(Array.from(both.indices)).toEqual([0, 1, 2, 3, 4, 5])
    expect(matrix4Of(moveMatrix({ pivot: [0, 0, 0], translate: [1, 2, 3], rotate: [0, 0, 0] })).slice(12)).toEqual([1, 2, 3, 1])
    expect(pivotOf([{ min: [0, 0, 0], max: [2, 2, 2] }, { min: [10, -2, 0], max: [12, 0, 4] }])).toEqual([6, 0, 2])
  })
})

describe('an Import', () => {
  it('makes a body a part, under the part’s name', async () => {
    const text = await twoPartFile()
    const builder = new Builder(await kernelPromise)
    const key = stepFileKey(text)
    builder.addStepFiles([[key, text]])
    const out = build(builder, [{ id: 7, kind: 'import', name: 'Import 1', file: { key, name: 'pcb.step', size: text.length }, visible: true }])
    expect(out.results).toEqual([{ id: 7, status: 'ok', bodies: [7, islandId(7, 1)] }])
    expect(out.bodies.map((b) => [b.label, Math.round(b.volume)])).toEqual([
      ['Plate', 200],
      ['Post', 96],
    ])
    // The post stands where the file has it.
    expect(boxOf(out.bodies[1].mesh.positions).min[0]).toBeCloseTo(20, 4)
    builder.dispose()
  })

  it('fails by name when its file was never handed over, and builds once it is', async () => {
    const text = await twoPartFile()
    const builder = new Builder(await kernelPromise)
    const imp: Feature = { id: 1, kind: 'import', name: 'Import 1', file: { key: stepFileKey(text), name: 'x.step', size: text.length }, visible: true }
    expect(build(builder, [imp]).results[0].message).toMatch(/STEP file of this import is not here/)
    builder.addStepFiles([[stepFileKey(text), text]])
    expect(build(builder, [{ ...imp, name: 'Again' }]).results[0].status).toBe('ok')
    builder.dispose()
  })

  it('keys a file by its text: the same text one key, another text another', () => {
    expect(stepFileKey('ISO-10303-21; A')).toBe(stepFileKey('ISO-10303-21; A'))
    expect(stepFileKey('ISO-10303-21; A')).not.toBe(stepFileKey('ISO-10303-21; B'))
  })
})

describe('a Move', () => {
  const box = (): Feature[] => {
    const s = rectangleSketch(1, 10, 6)
    return [s, extrudeAll(2, s, 0, 4)]
  }

  it('turns and carries the body, its faces keeping their maker, so a round after it still finds its edge', async () => {
    const builder = new Builder(await kernelPromise)
    const placement = { pivot: [5, 3, 2] as Vec3, translate: [100, 0, 0] as Vec3, rotate: [0, 0, 90] as Vec3 }
    const move: Feature = { id: 3, kind: 'moveBody', name: 'Move 1', bodies: [2], ...placement, copy: false, visible: true }
    const out = build(builder, [...box(), move])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(out.bodies.map((b) => b.id)).toEqual([2])
    const b = out.bodies[0]
    expect(b.volume).toBeCloseTo(240, 6)
    // A 10 × 6 box turned a quarter about Z through its middle: 6 × 10,
    // then 100 along X.
    const { min, max } = boxOf(b.mesh.positions)
    expectVec(min, [102, -2, 0], 3)
    expectVec(max, [108, 8, 4], 3)
    expect(new Set(b.topology.faces.map((f) => f.fingerprint.origin))).toEqual(new Set([2]))
    // A round picked on the moved body, as the panel picks it.
    const edge = b.topology.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.mid[2] - 4) < 1e-6)!
    const fillet: Feature = { id: 4, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [edge.fingerprint], radius: 1, chain: false, visible: true }
    const rounded = build(builder, [...box(), move, fillet])
    expect(rounded.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(rounded.bodies[0].volume).toBeLessThan(240)
    // The box made taller above the move: the move and the round follow.
    const s = box()[0] as SketchFeature
    const taller = build(builder, [s, extrudeAll(2, s, 0, 5), move, { ...fillet, edges: [{ ...edge.fingerprint, mid: [edge.fingerprint.mid[0], edge.fingerprint.mid[1], 5] }] }])
    expect(taller.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(boxOf(taller.bodies[0].mesh.positions).max[2]).toBeCloseTo(5, 3)
    builder.dispose()
  })

  it('copies: the body stays, the copy a body of the move’s own where it was sent', async () => {
    const builder = new Builder(await kernelPromise)
    const move: Feature = { id: 3, kind: 'moveBody', name: 'Move 1', bodies: [2], pivot: [5, 3, 2], translate: [0, 20, 0], rotate: [0, 0, 0], copy: true, visible: true }
    const out = build(builder, [...box(), move])
    expect(out.results[1]).toEqual({ id: 3, status: 'ok', bodies: [3] })
    expect(out.bodies.map((b) => b.id)).toEqual([2, 3])
    expect(boxOf(out.bodies[0].mesh.positions).min[1]).toBeCloseTo(0, 4)
    expect(boxOf(out.bodies[1].mesh.positions).min[1]).toBeCloseTo(20, 4)
    expect(new Set(out.bodies[1].topology.faces.map((f) => f.fingerprint.origin))).toEqual(new Set([3]))
    builder.dispose()
  })

  it('moves an imported part with its name, and a copy of it takes the name with a count', async () => {
    const text = await twoPartFile()
    const builder = new Builder(await kernelPromise)
    const key = stepFileKey(text)
    builder.addStepFiles([[key, text]])
    const imp: Feature = { id: 1, kind: 'import', name: 'Import 1', file: { key, name: 'pcb.step', size: text.length }, visible: true }
    const copy: Feature = { id: 2, kind: 'moveBody', name: 'Move 1', bodies: [islandId(1, 1)], pivot: [22, 2, 3], translate: [0, 0, 10], rotate: [0, 0, 0], copy: true, visible: true }
    const out = build(builder, [imp, copy])
    expect(out.bodies.map((b) => b.label)).toEqual(['Plate', 'Post', 'Post'])
    const named = nameBodies(out.bodies.map((b) => ({ id: b.id, name: b.name, label: b.label })), [imp, copy], { [islandId(1, 1)]: { name: 'Header J1' } })
    // A name given stands in for the file's; the count runs on under it.
    expect(named.map((b) => b.name)).toEqual(['Plate', 'Header J1', 'Post (2)'])
    expect(nameBodies(out.bodies.map((b) => ({ id: b.id, name: b.name, label: b.label })), [imp, copy]).map((b) => b.name)).toEqual(['Plate', 'Post', 'Post (2)'])
    builder.dispose()
  })

  it('previews the bodies where they are going, off their own meshes', async () => {
    const builder = new Builder(await kernelPromise)
    build(builder, box())
    const step = resolveFeatures([...box(), { id: 99, kind: 'moveBody', name: 'Preview', bodies: [2], pivot: [0, 0, 0], translate: [0, 0, 50], rotate: [0, 0, 0], copy: true, visible: true }], ctx(), (f) => findRegions(f.sketch)).at(-1)!
    if (step.kind !== 'moveBody') throw new Error('expected a move')
    const preview = builder.preview(step, undefined)
    expect(preview.volume).toBeCloseTo(240, 6)
    expect(boxOf(preview.mesh.positions).min[2]).toBeCloseTo(50, 4)
    builder.dispose()
  })

  it('fails by name when a body it moves is gone', async () => {
    const builder = new Builder(await kernelPromise)
    const out = build(builder, [...box(), { id: 3, kind: 'moveBody', name: 'Move 1', bodies: [9], pivot: [0, 0, 0], translate: [1, 0, 0], rotate: [0, 0, 0], copy: false, visible: true }])
    expect(out.results[1].message).toMatch(/body this move takes is gone/)
    builder.dispose()
  })
})

describe('the Move box', () => {
  const body = (id: number, min: Vec3, max: Vec3): BodyInfo => ({ id, name: `Solid ${id}`, visible: true, volume: 1, faces: 6, closed: true, triangles: 12, box: { min, max } })
  const s = () => useReverse.getState()
  beforeEach(() => {
    useReverse.setState({ features: [], rolledBack: [], featureDraft: null, nextFeatureId: 5, nextOfKind: {}, bodies: [body(2, [0, 0, 0], [10, 10, 10]), body(3, [20, 0, 0], [30, 10, 10])], past: [], future: [], stepFiles: {} })
  })

  it('opens on the bodies given, about their middle, and follows the bodies clicked', () => {
    s().startFeature('moveBody', { bodies: [2] })
    let d = s().featureDraft!
    if (d.kind !== 'moveBody') throw new Error('expected a move')
    expect(d.pivot).toEqual([5, 5, 5])
    // Nothing moved: not yet a move — but a copy where it stands is.
    expect(featureDraftReady(d)).toBe(false)
    s().setFeatureDraft({ copy: true })
    expect(featureDraftReady(s().featureDraft!)).toBe(true)
    s().toggleDraftFace(3, { hash: 1, fingerprint: { kind: 'plane', centroid: [25, 5, 10], dir: [0, 0, 1], area: 100, origin: 3 } })
    d = s().featureDraft!
    if (d.kind !== 'moveBody') throw new Error('expected a move')
    expect(d.bodies).toEqual([2, 3])
    expect(d.pivot).toEqual([15, 5, 5])
    s().toggleDraftFace(2, { hash: 2, fingerprint: { kind: 'plane', centroid: [5, 5, 10], dir: [0, 0, 1], area: 100, origin: 2 } })
    expect((s().featureDraft as { bodies: number[] }).bodies).toEqual([3])
  })

  it('takes the gizmo’s drags and typed numbers, and commits a Move', () => {
    s().startFeature('moveBody', { bodies: [2] })
    s().gripDrag('moveY', 0, 'start')
    s().gripDrag('moveY', 12.345, 'move')
    s().gripDrag('moveY', 12.345, 'end')
    s().gripDrag('turnZ', 0, 'start')
    s().gripDrag('turnZ', 44.6, 'move')
    s().gripDrag('turnZ', 44.6, 'end')
    expect(gripFieldValue(s())).toEqual({ value: 45, unit: '°' })
    s().setGripValue('moveX', -3)
    const d = s().featureDraft!
    if (d.kind !== 'moveBody') throw new Error('expected a move')
    expect(d.translate).toEqual([-3, 12.35, 0])
    expect(d.rotate).toEqual([0, 0, 45])
    expect(featureOfDraft(d, 9, 'Move 1')).toEqual({ id: 9, kind: 'moveBody', name: 'Move 1', bodies: [2], pivot: [5, 5, 5], translate: [-3, 12.35, 0], rotate: [0, 0, 45], copy: false, visible: true })
    const id = s().commitFeature()
    expect(id).toBe(5)
    expect(s().features[0]).toMatchObject({ kind: 'moveBody', name: 'Move 1' })
    // Opened again, the box holds what was committed, its pivot kept.
    s().editFeature(5)
    expect(s().featureDraft).toMatchObject({ kind: 'moveBody', featureId: 5, translate: [-3, 12.35, 0], rotate: [0, 0, 45], pivot: [5, 5, 5] })
  })

  it('keeps a STEP file once however often it is imported', () => {
    const a = s().addStepFile('a.step', 'ISO-10303-21; one')
    const b = s().addStepFile('b.step', 'ISO-10303-21; one')
    expect(a.key).toBe(b.key)
    expect(Object.keys(s().stepFiles)).toEqual([a.key])
    s().startFeature('import', { file: a, name: 'a' })
    expect(featureDraftReady(s().featureDraft!)).toBe(true)
    expect(s().commitFeature()).toBe(5)
    expect(s().features[0]).toMatchObject({ kind: 'import', name: 'a', file: { name: 'a.step', key: a.key } })
  })
})

describe('the project file', () => {
  it('carries the imported files beside the part, in one member, and brings them back', () => {
    const text = 'ISO-10303-21;\nHEADER;ENDSEC;DATA;ENDSEC;END-ISO-10303-21;'
    useReverse.getState().reset()
    const file = useReverse.getState().addStepFile('part.step', text)
    useReverse.setState({
      features: [
        { id: 1, kind: 'import', name: 'part', file, visible: true },
        { id: 2, kind: 'moveBody', name: 'Move 1', bodies: [1], pivot: [0, 0, 0], translate: [0, 0, 5], rotate: [0, 90, 0], copy: true, visible: true },
      ],
      nextFeatureId: 3,
    })
    const members = new Map<string, Uint8Array>()
    const part = collectReversePart({ addMember: (name, bytes) => members.set(name, bytes) })!
    expect(part.stepFiles).toBe(STEP_MEMBER)
    expect([...members.keys()]).toEqual([STEP_MEMBER])
    for (const f of part.features) validateFeatureJson(f as unknown as Record<string, unknown>)
    expect(() => validateFeatureJson({ kind: 'moveBody', name: 'x', bodies: [1], pivot: [0, 0], translate: [0, 0, 0], rotate: [0, 0, 0], copy: false })).toThrow(/moveBody.pivot/)
    useReverse.getState().reset()
    expect(useReverse.getState().stepFiles).toEqual({})
    applyReversePart(JSON.parse(JSON.stringify(part)) as ReversePart, { manifest: {} as never, members })
    expect(useReverse.getState().stepFiles).toEqual({ [file.key]: text })
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['import', 'moveBody'])
    // A part without its member opens all the same; the Import fails in the
    // build for want of its file.
    applyReversePart(JSON.parse(JSON.stringify(part)) as ReversePart)
    expect(useReverse.getState().stepFiles).toEqual({})
  })
})

describe('the builder reads a file once', () => {
  it('builds an Import after an edit above it from the file as read', async () => {
    const text = await twoPartFile()
    const kernel = await kernelPromise
    let reads = 0
    const counted = Object.create(kernel) as ReKernel
    counted.readStepParts = (t: string) => {
      reads++
      return kernel.readStepParts(t)
    }
    const builder = new Builder(counted)
    const key = stepFileKey(text)
    builder.addStepFiles([[key, text]])
    const s = rectangleSketch(1, 5, 5, [-20, 0])
    const imp: Feature = { id: 3, kind: 'import', name: 'Import 1', file: { key, name: 'pcb.step', size: text.length }, visible: true }
    build(builder, [s, extrudeAll(2, s, 0, 1), imp])
    build(builder, [s, extrudeAll(2, s, 0, 3), imp])
    const out = build(builder, [s, extrudeAll(2, s, 0, 4), imp])
    expect(out.bodies).toHaveLength(3)
    expect(reads).toBe(1)
    // An edge of the moved part is found again by its fingerprint.
    const post = out.bodies[2]
    expect(matchEdge(post.topology.edges[0].fingerprint, post.topology.edges.map((e) => e.fingerprint), matchTolerance(30))).toBe(0)
    builder.dispose()
  })
})
