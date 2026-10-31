// SPDX-License-Identifier: AGPL-3.0-only
// The audit of a body's topology (core/audit): kinks, steps, faces nearly
// parallel or nearly on an axis, short edges — and the trace from a face
// back to the sketch piece that made it.
import { describe, expect, it } from 'vitest'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { auditTopology, traceFace } from '../core/audit'
import type { EdgeInfo, FaceInfo } from '../core/build'
import type { Feature } from '../core/features'
import type { FaceKind } from '../core/topo'

const rad = (deg: number) => (deg * Math.PI) / 180
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

const face = (hash: number, kind: FaceKind, centroid: Vec3, dir: Vec3, origin = 2, extra: { radius?: number; center?: Vec3 } = {}): FaceInfo => ({
  hash,
  fingerprint: { kind, centroid, dir, area: 100, origin, ...extra },
})

const edge = (hash: number, mid: Vec3, dir: Vec3, length: number, faces: number[]): EdgeInfo => ({
  hash,
  fingerprint: { kind: 'line', mid, dir, length, faces: [], origin: 2 },
  faces,
  ends: [mid, mid],
  endTangents: [dir, dir],
  polyline: new Float32Array(0),
})

describe('a body looked over', () => {
  it('finds nothing wrong with a box', () => {
    const faces = [face(1, 'plane', [0, 0, 10], [0, 0, 1]), face(2, 'plane', [0, 0, 0], [0, 0, -1]), face(3, 'plane', [10, 0, 5], [1, 0, 0]), face(4, 'plane', [-10, 0, 5], [-1, 0, 0]), face(5, 'plane', [0, 10, 5], [0, 1, 0]), face(6, 'plane', [0, -10, 5], [0, -1, 0])]
    const edges = [edge(10, [10, 0, 10], [0, 1, 0], 20, [1, 3]), edge(11, [10, 10, 5], [0, 0, 1], 10, [3, 5])]
    expect(auditTopology(faces, edges)).toEqual([])
  })

  it('names a face a hair off an axis, two faces nearly parallel, and a step between two heights', () => {
    const tilted = unit([0, Math.sin(rad(0.3)), Math.cos(rad(0.3))])
    const faces = [
      face(1, 'plane', [0, 0, 10], tilted),
      face(2, 'plane', [0, 0, 0], [0, 0, -1]),
      face(3, 'plane', [10, 0, 5], [1, 0, 0]),
      face(4, 'plane', [-10, 0, 5], unit([-Math.cos(rad(0.5)), Math.sin(rad(0.5)), 0])),
      // Two tops facing up, one 0.05 mm above the other — well above the
      // tilted top, so they make no step with it.
      face(5, 'plane', [30, 0, 40], [0, 0, 1]),
      face(6, 'plane', [50, 0, 40.05], [0, 0, 1]),
      // A face leaning 3°: not within the default degree, so not listed.
      face(7, 'plane', [0, 30, 5], unit([Math.sin(rad(3)), 0, Math.cos(rad(3))])),
    ]
    const found = auditTopology(faces, [])
    const axis = found.filter((f) => f.kind === 'nearAxis')
    expect(axis.map((f) => f.faces[0]).sort()).toEqual([0, 3])
    const top = axis.find((f) => f.faces[0] === 0)!
    expect(top.off).toBeCloseTo(0.3, 3)
    expect(top).toMatchObject({ axis: 'z', unit: 'deg', at: [0, 0, 10] })
    const wall = axis.find((f) => f.faces[0] === 3)!
    expect(wall.off).toBeCloseTo(0.5, 3)
    expect(wall.axis).toBe('x')
    // The two walls 0.5° off parallel — and the tilted top, 0.3° off the
    // bottom under it and the two level tops, nearest the mark first.
    const parallel = found.filter((f) => f.kind === 'nearParallel')
    expect(parallel.map((f) => f.faces)).toEqual([
      [0, 1],
      [0, 4],
      [0, 5],
      [2, 3],
    ])
    expect(parallel[3].off).toBeCloseTo(0.5, 3)
    expect(parallel[0].off).toBeCloseTo(0.3, 3)
    const steps = found.filter((f) => f.kind === 'step')
    expect(steps).toHaveLength(1)
    expect(steps[0].faces).toEqual([4, 5])
    expect(steps[0].off).toBeCloseTo(0.05, 6)
    expect(steps[0].unit).toBe('mm')
    // A step is a step within stepMm only.
    expect(auditTopology(faces, [], { stepMm: 0.01 }).filter((f) => f.kind === 'step')).toHaveLength(0)
    expect(auditTopology(faces, [], { parallelDeg: 0.1 }).filter((f) => f.kind === 'nearAxis')).toHaveLength(0)
    expect(auditTopology(faces, [], { parallelDeg: 5 }).filter((f) => f.kind === 'nearAxis').map((f) => f.faces[0])).toContain(6)
  })

  it('finds a kink where a round meets a flat face at a hair’s angle, and a short edge', () => {
    // A boss about the y axis, radius 5, beside a top face: the seam at
    // the top of the boss is tangent (no kink); an edge 2° round from it
    // is a kink.
    const boss = face(1, 'cylinder', [0, 0, 0], [0, 1, 0], 2, { radius: 5, center: [0, 0, 0] })
    const top = face(2, 'plane', [0, 0, 5], [0, 0, 1])
    const seam = edge(10, [0, 0, 5], [0, 1, 0], 20, [1, 2])
    const kinked = edge(11, [5 * Math.sin(rad(2)), 0, 5 * Math.cos(rad(2))], [0, 1, 0], 20, [1, 2])
    const stub = edge(12, [3, 3, 3], [1, 0, 0], 0.04, [1, 2])
    const found = auditTopology([boss, top], [seam, kinked, stub], {}, () => true)
    const kinks = found.filter((f) => f.kind === 'kink')
    expect(kinks).toHaveLength(1)
    expect(kinks[0].edges).toEqual([1])
    expect(kinks[0].faces.sort()).toEqual([0, 1])
    expect(kinks[0].off).toBeCloseTo(2, 3)
    expect(kinks[0].note).toMatch(/tangent/)
    const short = found.filter((f) => f.kind === 'shortEdge')
    expect(short).toHaveLength(1)
    expect(short[0]).toMatchObject({ edges: [2], off: 0.04, unit: 'mm' })
    // A bore's normal points the other way: the same edge is then far
    // from tangent, and no kink.
    expect(auditTopology([boss, top], [kinked], {}, () => false).filter((f) => f.kind === 'kink')).toHaveLength(0)
    // Without the side told, a round face says nothing.
    expect(auditTopology([boss, top], [kinked]).filter((f) => f.kind === 'kink')).toHaveLength(0)
    // The net.
    expect(auditTopology([boss, top], [kinked], { kinkDeg: 1 }, () => true).filter((f) => f.kind === 'kink')).toHaveLength(0)
  })

  it('lists the edges the kernel found odd — free, non-manifold, contacts — longest first, by index, with their faces', () => {
    const faces = [face(1, 'plane', [0, 0, 10], [0, 0, 1]), face(2, 'cylinder', [0, 14, 5], [0, 0, 1], 3, { radius: 6, center: [0, 14, 0] }), face(3, 'plane', [10, 0, 5], [1, 0, 0], 4)]
    const edges = [edge(10, [0, 20, 2.5], [0, 0, 1], 5, [1, 2]), edge(11, [0, 20, 3.5], [0, 0, 1], 3, [2]), edge(12, [10, 0, 10], [0, 1, 0], 20, [1])]
    const found = auditTopology(faces, edges, {}, undefined, [
      { hash: 11, kind: 'inside', at: [0, 20, 3.5], length: 3, faces: [2] },
      { hash: 99, kind: 'knife', at: [1, 1, 1], length: 4, faces: [1, 3] },
      { hash: 10, kind: 'nonManifold', at: [0, 20, 2.5], length: 5, faces: [1, 2, 3, 7] },
      { hash: 12, kind: 'free', at: [10, 0, 10], length: 20, faces: [1] },
    ])
    expect(found.map((f) => f.kind)).toEqual(['freeEdge', 'nonManifold', 'contact', 'contact'])
    expect(found[0]).toMatchObject({ edges: [2], faces: [0], off: 20, unit: 'mm' })
    // A face not on the body (hash 7) is left out of the faces; an edge
    // not in the list (hash 99) has no index.
    expect(found[1]).toMatchObject({ edges: [0], faces: [0, 1, 2] })
    expect(found[1].note).toMatch(/^4 faces meet at one edge/)
    expect(found.slice(2).map((f) => f.off)).toEqual([4, 3])
    expect(found[2]).toMatchObject({ edges: [], faces: [0, 2] })
    expect(found[3].note).toMatch(/inside its one face/)
    // Without the kernel's list the audit says nothing of them: a seam has
    // one face too, and the topology alone cannot tell the two apart.
    expect(auditTopology(faces, edges).filter((f) => f.kind === 'freeEdge' || f.kind === 'contact' || f.kind === 'nonManifold')).toEqual([])
  })

  it('caps each kind and sorts nearest the mark first', () => {
    const faces = Array.from({ length: 6 }, (_, i) => face(i + 1, 'plane', [i * 10, 0, 0], unit([Math.sin(rad(0.9 - i * 0.1)), 0, Math.cos(rad(0.9 - i * 0.1))])))
    const found = auditTopology(faces, [], { limit: 3 }).filter((f) => f.kind === 'nearAxis')
    expect(found).toHaveLength(3)
    expect(found.map((f) => f.off)).toEqual([0.4, 0.5, 0.6])
  })
})

describe('a face traced back to its sketch', () => {
  const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  const features = [
    {
      id: 1,
      kind: 'sketch',
      name: 'Sketch 1',
      plane: { kind: 'world', axis: 'z', offset: 0 },
      frame: XY,
      sketch: {
        entities: [
          { id: 1, kind: 'line', a: [0, 0], b: [40, 0] },
          { id: 2, kind: 'line', a: [40, 0], b: [40, 20] },
          { id: 3, kind: 'circle', c: [20, 10], r: 3 },
          { id: 4, kind: 'line', a: [-5, -5], b: [45, -5], construction: true },
        ],
        constraints: [],
        nextId: 5,
      },
      visible: true,
    },
    { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: ['r1'], extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true },
    { id: 3, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [], radius: 1, visible: true },
  ] as unknown as Feature[]

  it('finds the wall’s line, the cap’s end and the bore’s circle', () => {
    const wall = traceFace(features, { kind: 'plane', centroid: [20, 0, 5], dir: [0, -1, 0], area: 400, origin: 2 })!
    expect(wall).toMatchObject({ feature: { id: 2, name: 'Extrude 1' }, sketch: { id: 1, name: 'Sketch 1' }, role: 'wall', piece: { id: 1, kind: 'line' } })
    const side = traceFace(features, { kind: 'plane', centroid: [40, 10, 5], dir: [1, 0, 0], area: 200, origin: 2 })!
    expect(side.piece).toEqual({ id: 2, kind: 'line' })
    const cap = traceFace(features, { kind: 'plane', centroid: [20, 10, 10], dir: [0, 0, 1], area: 800, origin: 2 })!
    expect(cap).toMatchObject({ role: 'cap', end: 'to' })
    expect(cap.piece).toBeUndefined()
    const floor = traceFace(features, { kind: 'plane', centroid: [20, 10, 0], dir: [0, 0, -1], area: 800, origin: 2 })!
    expect(floor).toMatchObject({ role: 'cap', end: 'from' })
    const bore = traceFace(features, { kind: 'cylinder', centroid: [20, 10, 5], dir: [0, 0, 1], area: 100, radius: 3, center: [20, 10, 0], origin: 2 })!
    expect(bore).toMatchObject({ role: 'round', piece: { id: 3, kind: 'circle' } })
  })

  it('stops where the trace runs out', () => {
    // A face another feature made: the feature, and no sketch.
    expect(traceFace(features, { kind: 'cylinder', centroid: [0, 0, 0], dir: [0, 0, 1], area: 1, radius: 1, origin: 3 })).toMatchObject({ feature: { id: 3, kind: 'fillet' }, role: 'other' })
    // A face no feature in the list made.
    expect(traceFace(features, { kind: 'plane', centroid: [0, 0, 0], dir: [0, 0, 1], area: 1, origin: 99 })).toBeNull()
    // A wall no line lies under: the wall, with no piece.
    expect(traceFace(features, { kind: 'plane', centroid: [20, 7, 5], dir: [0, 1, 0], area: 1, origin: 2 })).toMatchObject({ role: 'wall' })
    expect(traceFace(features, { kind: 'plane', centroid: [20, 7, 5], dir: [0, 1, 0], area: 1, origin: 2 })!.piece).toBeUndefined()
  })
})
