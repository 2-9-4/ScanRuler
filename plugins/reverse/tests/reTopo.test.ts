// SPDX-License-Identifier: AGPL-3.0-only
// Stable names for faces and edges: the fingerprints a pick is stored as,
// the kernel reading them off a body, the builder carrying each face's
// maker through a boolean, and a pick re-found on a rebuilt body after an
// earlier dimension moved — or reported lost, by name, when its face is gone.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { type Feature, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { rectangleLoop, ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import { canonicalDir, describeEdge, describeFace, matchEdge, matchFace, matchTolerance, onOneSurface, transformEdgeFingerprint, transformFingerprint, type EdgeFingerprint, type FaceFingerprint } from '../core/topo'
import { rigidFromAxisAngle } from '../../../src/core/deviation/rigid'
import { ctx, extrudeAll, rectangleSketch, XY } from './reKit'

const kernelPromise = ReKernel.load()

function circleSketch(id: number, cx: number, cy: number, r: number): SketchFeature {
  const sketch = emptySketch()
  addEntity(sketch, { kind: 'circle', c: [cx, cy], r })
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
}

async function build(builder: Builder, features: Feature[]) {
  const steps = resolveFeatures(features, ctx, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return builder.build(steps, (id) => sketches.get(id))
}

const near = (a: readonly number[], b: readonly number[], tol = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < tol)

describe('fingerprints', () => {
  const plane = (centroid: [number, number, number], dir: [number, number, number], area = 100, origin = 1): FaceFingerprint => ({ kind: 'plane', centroid, dir, area, origin })

  it('make an axis canonical and leave a normal its sign', () => {
    expect(canonicalDir([0, 0, -1])).toEqual([0, 0, 1])
    expect(canonicalDir([-0.6, 0.8, 0])).toEqual([0.6, -0.8, 0])
    expect(canonicalDir([0, -3, 4])).toEqual([0, 0.6, -0.8])
  })

  it('match the nearest face of the same kind within the tolerance and no other', () => {
    const tol = matchTolerance(50)
    const top = plane([20, 10, 10], [0, 0, 1], 800)
    const candidates = [plane([20, 10, 0], [0, 0, -1], 800), plane([21, 10, 10], [0, 0, 1], 840), plane([20, 10, 40], [0, 0, 1], 800)]
    // The bottom faces the other way, the far top is past the position
    // tolerance (five millimetres on this part, twenty on the second
    // look), the moved top is it.
    expect(matchFace(top, candidates, tol)).toBe(1)
    expect(matchFace({ ...top, kind: 'cylinder' }, candidates, tol)).toBeNull()
    expect(matchFace(top, [candidates[2]], tol)).toBeNull()
    // Made by the same feature wins between two equally near.
    const twins = [plane([20, 10, 10], [0, 0, 1], 800, 7), plane([20, 10, 10], [0, 0, 1], 800, 1)]
    expect(matchFace(top, twins, tol)).toBe(1)
  })

  it('tell a top edge from the bottom one under it by their faces', () => {
    const tol = matchTolerance(50)
    const line = (mid: [number, number, number], up: 1 | -1): EdgeFingerprint => ({
      kind: 'line',
      mid,
      dir: [1, 0, 0],
      length: 40,
      faces: [
        { kind: 'plane', dir: [0, -1, 0] },
        { kind: 'plane', dir: [0, 0, up] },
      ],
      origin: 1,
    })
    const wanted = line([20, 0, 10], 1)
    expect(matchEdge(wanted, [line([20, 0, 0], -1), line([20, 0, 10], -1), line([20, 0, 10], 1)], tol)).toBe(2)
    expect(matchEdge(wanted, [line([20, 0, 10], -1)], tol)).toBeNull()
  })

  it('take a second look among the faces the same feature made when a dimension moved by more than a tenth of the part', () => {
    // A 20 × 20 boss pulled from 7 to 17 mm: its top face moves 10 mm
    // along its normal, its side edges grow to more than double.
    const tol = matchTolerance(Math.hypot(20, 20, 17))
    const top = plane([10, 10, 7], [0, 0, 1], 400, 2)
    const grown = [plane([10, 10, 0], [0, 0, -1], 400, 2), plane([10, 10, 17], [0, 0, 1], 400, 2), plane([10, 0, 8.5], [0, -1, 0], 340, 2)]
    expect(matchFace(top, grown, tol)).toBe(1)
    // Not among faces another feature made: a face that is gone stays gone.
    expect(matchFace(top, [plane([10, 10, 17], [0, 0, 1], 400, 5)], tol)).toBeNull()
    // A pick with no maker known takes no second look either.
    expect(matchFace({ ...top, origin: -1 }, grown, tol)).toBeNull()
    const upright = (mid: [number, number, number], length: number, origin = 2): EdgeFingerprint => ({ kind: 'line', mid, dir: [0, 0, 1], length, faces: [{ kind: 'plane', dir: [0, -1, 0] }, { kind: 'plane', dir: [-1, 0, 0] }], origin })
    const side = upright([0, 0, 3.5], 7)
    expect(matchEdge(side, [upright([0, 0, 8.5], 17), upright([20, 0, 8.5], 17)], tol)).toBe(0)
    expect(matchEdge(side, [upright([0, 0, 8.5], 17, 5)], tol)).toBeNull()
  })

  it('describe themselves for a message', () => {
    expect(describeFace({ kind: 'cylinder', centroid: [10, 10, 5], dir: [0, 0, 1], area: 94.2, radius: 3, origin: 2 })).toBe('cylinder Ø6.0 at (10.0, 10.0, 5.0)')
    expect(describeFace(plane([20, 10, 10], [0, 0, 1], 800))).toBe('plane 800 mm² at (20.0, 10.0, 10.0)')
    expect(describeEdge({ kind: 'circle', mid: [7, 10, 10], dir: [0, 0, 1], length: 18.85, radius: 3, faces: [], origin: 2 })).toBe('circle Ø6.0 at (7.0, 10.0, 10.0)')
    expect(describeEdge({ kind: 'line', mid: [20, 0, 10], dir: [1, 0, 0], length: 40, faces: [], origin: 2 })).toBe('line 40.0 mm at (20.0, 0.0, 10.0)')
  })

  it('tell two faces meeting tangent on one surface from two surfaces running into each other', () => {
    const round = (kind: 'cylinder' | 'cone', center: [number, number, number], dir: [number, number, number], radius?: number): FaceFingerprint => ({ kind, centroid: center, dir, area: 50, center, origin: 1, ...(radius === undefined ? {} : { radius }) })
    // A cylinder's halves, along its axis and with radii a millionth apart —
    // the hair the kernel would not merge them over.
    expect(onOneSurface(round('cylinder', [0, 0, 0], [0, 0, 1], 33.92), round('cylinder', [0, 0, 12], [0, 0, 1], 33.919999432))).toBe(true)
    expect(onOneSurface(round('cylinder', [0, 0, 0], [0, 0, 1], 5), round('cylinder', [0, 0, 0], [0, 0, 1], 5.1))).toBe(false)
    // A round of the same radius beside it, on an axis of its own.
    expect(onOneSurface(round('cylinder', [0, 0, 0], [0, 0, 1], 5), round('cylinder', [10, 0, 0], [0, 0, 1], 5))).toBe(false)
    expect(onOneSurface(round('cylinder', [0, 0, 0], [0, 0, 1], 5), round('cylinder', [0, 0, 0], [0, 1, 0], 5))).toBe(false)
    expect(onOneSurface(round('cone', [0, 0, 0], [0, 0, 1]), round('cone', [0, 0, 7], [0, 0, 1]))).toBe(true)
    expect(onOneSurface(round('cone', [0, 0, 0], [0, 0, 1]), round('cylinder', [0, 0, 0], [0, 0, 1], 5))).toBe(false)
    expect(onOneSurface(plane([0, 0, 0], [0, 0, 1]), plane([30, 0, 0], [0, 0, 1]))).toBe(true)
    const sphere = (center: [number, number, number], radius: number): FaceFingerprint => ({ kind: 'sphere', centroid: center, dir: [0, 0, 1], area: 50, center, radius, origin: 1 })
    expect(onOneSurface(sphere([1, 2, 3], 4), sphere([1, 2, 3], 4))).toBe(true)
    expect(onOneSurface(sphere([1, 2, 3], 4), sphere([1, 2, 5], 4))).toBe(false)
    // A torus's fingerprint does not say enough to tell: never one surface.
    const torus: FaceFingerprint = { kind: 'torus', centroid: [0, 0, 0], dir: [0, 0, 1], area: 50, origin: 1 }
    expect(onOneSurface(torus, torus)).toBe(false)
  })
})

describe('the kernel reading a body', () => {
  it('reads a box as six outward planes and twelve lines, each between two faces', async () => {
    const k = await kernelPromise
    const face = k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], 40, 20), holes: [] })
    const box = k.extrude(face, [0, 0, 1], 0, 10)
    const faces = k.faces(box)
    expect(faces.length).toBe(6)
    expect(faces.every((f) => f.kind === 'plane')).toBe(true)
    const top = faces.find((f) => near(f.centroid, [20, 10, 10]))!
    expect(near(top.dir, [0, 0, 1])).toBe(true)
    expect(top.area).toBeCloseTo(800, 6)
    const bottom = faces.find((f) => near(f.centroid, [20, 10, 0]))!
    expect(near(bottom.dir, [0, 0, -1])).toBe(true)
    const edges = k.edges(box, 0.1)
    expect(edges.length).toBe(12)
    expect(edges.every((e) => e.kind === 'line' && e.faceHashes.length === 2 && e.polyline.length >= 6)).toBe(true)
    const topFront = edges.find((e) => near(e.mid, [20, 0, 10]))!
    expect(near(topFront.dir, [1, 0, 0])).toBe(true)
    expect(topFront.length).toBeCloseTo(40, 6)
    const hashes = new Set(faces.map((f) => f.hash))
    expect(topFront.faceHashes.every((h) => hashes.has(h))).toBe(true)
    // The mesh names the face of every triangle by the same hashes.
    const mesh = k.mesh(box, 0.1)
    expect(mesh.faceHash).toBeDefined()
    expect(mesh.faceHash!.length).toBe(mesh.indices.length / 3)
    expect([...mesh.faceHash!].every((h) => hashes.has(h))).toBe(true)
    // Two triangles a face, and the top face's triangles lie at z = 10.
    const perFace = new Map<number, number>()
    for (const h of mesh.faceHash!) perFace.set(h, (perFace.get(h) ?? 0) + 1)
    expect([...perFace.values()]).toEqual([2, 2, 2, 2, 2, 2])
    for (let t = 0; t < mesh.faceHash!.length; t++) {
      if (mesh.faceHash![t] !== top.hash) continue
      for (let c = 0; c < 3; c++) expect(mesh.positions[mesh.indices[t * 3 + c] * 3 + 2]).toBeCloseTo(10, 6)
    }
    k.release(face, box)
  })

  it('reads a hole as a cylinder with its axis and radius, rimmed by circles', async () => {
    const k = await kernelPromise
    const face = k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], 40, 20), holes: [] })
    const box = k.extrude(face, [0, 0, 1], 0, 10)
    const disc = k.face({ outer: [{ kind: 'circle', center: [10, 10, -5], normal: [0, 0, 1], radius: 3 }], holes: [] })
    const drill = k.extrude(disc, [0, 0, 1], 0, 20)
    const { shape, history } = k.cutTracked(box, drill)
    const faces = k.faces(shape)
    const wall = faces.find((f) => f.kind === 'cylinder')!
    expect(wall).toBeDefined()
    expect(wall.radius).toBeCloseTo(3, 6)
    expect(near(wall.dir, [0, 0, 1])).toBe(true)
    expect(near(wall.centroid, [10, 10, 5], 1e-3)).toBe(true)
    const circles = k.edges(shape, 0.1).filter((e) => e.kind === 'circle')
    expect(circles.length).toBe(2)
    expect(circles.every((c) => Math.abs(c.radius! - 3) < 1e-6 && near(c.dir, [0, 0, 1]))).toBe(true)
    // The history: the top and bottom faces were modified (holed), the
    // sides kept their hashes, and every face the history names came
    // from the box or the drill — the tool's faces are tracked too.
    const before = k.faceHashes(box)
    const tool = k.faceHashes(drill)
    const after = new Set(faces.map((f) => f.hash))
    const kept = before.filter((h) => after.has(h))
    expect(kept.length).toBe(4)
    const holed = before.filter((h) => history.has(h))
    expect(holed.length).toBe(2)
    for (const [old, made] of history) {
      expect([...before, ...tool]).toContain(old)
      expect(made.every((h) => after.has(h))).toBe(true)
    }
    k.release(face, box, disc, drill, shape)
  })
})

describe('the builder naming faces', () => {
  it('carries each face’s maker through a cut', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    const s1 = rectangleSketch(1, 40, 20)
    const s3 = circleSketch(3, 10, 10, 3)
    const result = await build(builder, [s1, extrudeAll(2, s1, 0, 10), s3, extrudeAll(4, s3, -5, 15, 'cut', 2)])
    expect(result.results.every((r) => r.status === 'ok')).toBe(true)
    const body = result.bodies[0]
    const { faces, edges } = body.topology
    expect(faces.length).toBe(7)
    const wall = faces.find((f) => f.fingerprint.kind === 'cylinder')!
    expect(wall.fingerprint.origin).toBe(4)
    const top = faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9)!
    expect(top.fingerprint.origin).toBe(2)
    expect(faces.filter((f) => f.fingerprint.origin === 2).length).toBe(6)
    // The rim of the hole belongs to the cut; a box edge to the extrude.
    const rim = edges.find((e) => e.fingerprint.kind === 'circle' && e.fingerprint.mid[2] > 9)!
    expect(rim.fingerprint.origin).toBe(4)
    expect(rim.fingerprint.faces.map((f) => f.kind).sort()).toEqual(['cylinder', 'plane'])
    const boxEdge = edges.find((e) => e.fingerprint.kind === 'line')!
    expect(boxEdge.fingerprint.origin).toBe(2)
    builder.dispose()
  })

  it('tells a round face that goes the whole way round from a fillet’s part of a turn, and names the fillet its maker', async () => {
    const k = await kernelPromise
    const s1 = rectangleSketch(1, 40, 20)
    const s3 = circleSketch(3, 10, 10, 3)
    const holed = [s1, extrudeAll(2, s1, 0, 10), s3, extrudeAll(4, s3, -5, 15, 'cut', 2)]
    const first = new Builder(k)
    const plain = await build(first, holed)
    const top = plain.bodies[0].topology.edges.find((e) => e.fingerprint.kind === 'line' && e.fingerprint.length > 30 && e.fingerprint.mid[2] > 9)!
    first.dispose()
    const builder = new Builder(k)
    const result = await build(builder, [...holed, { id: 5, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [top.fingerprint], radius: 2, chain: false, visible: true }])
    expect(result.results.every((r) => r.status === 'ok')).toBe(true)
    const rounds = result.bodies[0].topology.faces.filter((f) => f.fingerprint.kind === 'cylinder')
    expect(rounds).toHaveLength(2)
    const bore = rounds.find((f) => Math.abs(f.fingerprint.radius! - 3) < 1e-6)!
    expect(bore.fullTurn).toBe(true)
    expect(bore.fingerprint.origin).toBe(4)
    const fillet = rounds.find((f) => Math.abs(f.fingerprint.radius! - 2) < 1e-6)!
    expect(fillet.fullTurn).toBe(false)
    expect(fillet.fingerprint.origin).toBe(5)
    // A plane says nothing about turns.
    expect(result.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane')!.fullTurn).toBeUndefined()
    builder.dispose()
  })

  it('re-finds a picked face and its edges after an earlier dimension moved, and reports a lost one by name', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    const s1 = rectangleSketch(1, 40, 20)
    const first = await build(builder, [s1, extrudeAll(2, s1, 0, 10)])
    const { faces, edges } = first.bodies[0].topology
    const top = faces.find((f) => f.fingerprint.dir[2] > 0.9)!.fingerprint
    const far = faces.find((f) => f.fingerprint.dir[0] > 0.9)!.fingerprint
    const topEdges = edges.filter((e) => e.fingerprint.mid[2] > 9.9).map((e) => e.fingerprint)
    expect(topEdges.length).toBe(4)

    // The same body two millimetres longer: every pick lands again.
    const wider = rectangleSketch(1, 42, 20)
    const second = await build(builder, [wider, extrudeAll(2, wider, 0, 10)])
    const foundTop = builder.findFaces(2, [top])
    expect('hashes' in foundTop).toBe(true)
    const topNow = second.bodies[0].topology.faces.find((f) => 'hashes' in foundTop && f.hash === foundTop.hashes[0])!
    expect(near(topNow.fingerprint.centroid, [21, 10, 10], 1e-6)).toBe(true)
    const foundFar = builder.findFaces(2, [far])
    expect('hashes' in foundFar).toBe(true)
    const farNow = second.bodies[0].topology.faces.find((f) => 'hashes' in foundFar && f.hash === foundFar.hashes[0])!
    expect(near(farNow.fingerprint.centroid, [42, 10, 5], 1e-6)).toBe(true)
    const foundEdges = builder.findEdges(2, topEdges)
    expect('hashes' in foundEdges).toBe(true)
    if ('hashes' in foundEdges) {
      expect(new Set(foundEdges.hashes).size).toBe(4)
      const mids = foundEdges.hashes.map((h) => second.bodies[0].topology.edges.find((e) => e.hash === h)!.fingerprint.mid)
      expect(mids.every((m) => Math.abs(m[2] - 10) < 1e-6)).toBe(true)
    }

    // A face that is not there any more is reported, by what it was.
    const lost = builder.findFaces(2, [{ kind: 'cylinder', centroid: [10, 10, 5], dir: [0, 0, 1], area: 94.2, radius: 3, origin: 4 }])
    expect(lost).toEqual({ lost: 'cylinder Ø6.0 at (10.0, 10.0, 5.0)' })
    const lostEdge = builder.findEdges(2, [{ kind: 'circle', mid: [7, 10, 10], dir: [0, 0, 1], length: 18.85, radius: 3, faces: [], origin: 4 }])
    expect(lostEdge).toEqual({ lost: 'circle Ø6.0 at (7.0, 10.0, 10.0)' })
    expect(builder.findFaces(99, [top])).toEqual({ lost: 'the body is gone' })
    builder.dispose()
  })
})

describe('a fingerprint carried through an alignment', () => {
  it('moves its centroid and turns its direction, an axis made canonical again', () => {
    // A quarter turn about Z, then 5 mm along X.
    const m = rigidFromAxisAngle([0, 0, 1], Math.PI / 2)
    m.t[0] += 5
    const plane: FaceFingerprint = { kind: 'plane', centroid: [10, 0, 3], dir: [0, -1, 0], area: 12, origin: 1 }
    const moved = transformFingerprint(plane, m)
    expect(moved.centroid.map((x) => Math.round(x * 1e9) / 1e9 + 0)).toEqual([5, 10, 3])
    // A plane's normal keeps its sign — a bottom stays a bottom.
    expect(moved.dir.map((x) => Math.round(x * 1e9) / 1e9 + 0)).toEqual([1, 0, 0])
    expect(moved.area).toBe(12)
    expect(moved.origin).toBe(1)
    const bore: FaceFingerprint = { kind: 'cylinder', centroid: [10, 0, 3], dir: [0, 1, 0], area: 12, origin: 1, radius: 2, center: [10, 0, 0] }
    const turned = transformFingerprint(bore, m)
    // The axis (0, 1, 0) turns to (−1, 0, 0), which canonical makes (1, 0, 0).
    expect(turned.dir.map((x) => Math.round(x * 1e9) / 1e9 + 0)).toEqual([1, 0, 0])
    expect(turned.center!.map((x) => Math.round(x * 1e9) / 1e9 + 0)).toEqual([5, 10, 0])
  })

  it('carries an edge too: its middle moved, its direction canonical again, its faces turned', () => {
    const m = rigidFromAxisAngle([0, 0, 1], Math.PI / 2)
    m.t[0] += 5
    const edge: EdgeFingerprint = { kind: 'line', mid: [10, 0, 3], dir: [0, 1, 0], length: 20, faces: [{ kind: 'plane', dir: [0, -1, 0] }, { kind: 'cylinder', dir: [0, 1, 0] }], origin: 2 }
    const moved = transformEdgeFingerprint(edge, m)
    const r = (v: number[]) => v.map((x) => Math.round(x * 1e9) / 1e9 + 0)
    expect(r(moved.mid)).toEqual([5, 10, 3])
    // (0, 1, 0) turns to (−1, 0, 0): a line's direction has no sign.
    expect(r(moved.dir)).toEqual([1, 0, 0])
    // A plane's normal keeps its sign; a cylinder's axis has none.
    expect(r(moved.faces[0].dir)).toEqual([1, 0, 0])
    expect(r(moved.faces[1].dir)).toEqual([1, 0, 0])
    expect(moved.length).toBe(20)
    expect(matchEdge(moved, [edge, moved], matchTolerance(100))).toBe(1)
  })
})
