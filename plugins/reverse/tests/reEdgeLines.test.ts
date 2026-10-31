// SPDX-License-Identifier: AGPL-3.0-only
// A body's edges drawn along the outlines of its faces' triangles rather
// than the kernel's own samples of them: each edge once, every point of it
// a vertex of the mesh the body is shaded with, and each edge's share its
// own — the two circles of a cylinder apart, its seam once, a round's rims
// where the round meets the faces beside it. And which of them are drawn:
// not a round face's seam, nor the cut between two faces on one surface;
// a tangent edge apart from the sharp ones.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { Builder, type BuiltBody } from '../core/build'
import { edgeSegments, edgeShares, outlineSegments, restSegments } from '../core/edgeLines'
import { onOneSurface } from '../core/topo'
import { type ExtrudeFeature, type Feature, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, addRectangle } from '../core/sketch'
import { sketchOf } from './reKit'

const kernelPromise = ReKernel.load()

function extrudeAll(id: number, sketch: SketchFeature, to: number): ExtrudeFeature {
  return { id, kind: 'extrude', name: `Extrude ${id}`, sketchId: sketch.id, regions: findRegions(sketch.sketch).map((r) => r.key), extent: { kind: 'distance', from: 0, to }, op: 'new', visible: true }
}

async function bodyOf(features: Feature[]): Promise<BuiltBody> {
  const builder = new Builder(await kernelPromise)
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const sketches = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  const { results, bodies } = builder.build(steps, (id) => sketches.get(id))
  builder.dispose()
  expect(results.every((r) => r.status === 'ok')).toBe(true)
  return bodies[0]
}

/** The mesh's vertices, by where they are. */
function vertexPlaces(body: BuiltBody): Set<string> {
  const p = body.mesh.positions
  const out = new Set<string>()
  for (let i = 0; i < p.length; i += 3) out.add(`${p[i]},${p[i + 1]},${p[i + 2]}`)
  return out
}

function allOnMesh(segments: Float32Array, places: Set<string>): boolean {
  for (let i = 0; i < segments.length; i += 3) if (!places.has(`${segments[i]},${segments[i + 1]},${segments[i + 2]}`)) return false
  return true
}

function toPolyline(p: Float32Array, x: number, y: number, z: number): number {
  let best = Infinity
  for (let j = 0; j + 5 < p.length; j += 3) {
    const d = [p[j + 3] - p[j], p[j + 4] - p[j + 1], p[j + 5] - p[j + 2]]
    const ll = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    const t = ll > 0 ? Math.min(1, Math.max(0, ((x - p[j]) * d[0] + (y - p[j + 1]) * d[1] + (z - p[j + 2]) * d[2]) / ll)) : 0
    best = Math.min(best, Math.hypot(p[j] + d[0] * t - x, p[j + 1] + d[1] * t - y, p[j + 2] + d[2] * t - z))
  }
  return best
}

const lines = (body: BuiltBody) => edgeSegments(body.mesh.positions, body.mesh.indices, body.mesh.faceHash!, body.topology.edges)

/** Whether two of a built body's faces lie on one surface, as the viewport
 *  asks it. */
const oneSurfaceOf = (body: BuiltBody) => {
  const byHash = new Map(body.topology.faces.map((f) => [f.hash, f.fingerprint]))
  return (a: number, b: number) => onOneSurface(byHash.get(a)!, byHash.get(b)!)
}
const restOf = (body: BuiltBody) => restSegments(body.mesh.positions, body.mesh.normals, body.mesh.indices, body.mesh.faceHash!, oneSurfaceOf(body))
const sharesOf = (body: BuiltBody) => edgeShares(body.mesh.positions, body.mesh.normals, body.mesh.indices, body.mesh.faceHash!, body.topology.edges, oneSurfaceOf(body))

/** A mesh of quads as the kernel meshes a body: each quad its own four
 *  vertices, all with the quad's normal, two triangles of its face. */
function quads(list: readonly { corners: [Vec3, Vec3, Vec3, Vec3]; normal: Vec3; face: number }[]) {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const faceHash: number[] = []
  for (const q of list) {
    const first = positions.length / 3
    for (const c of q.corners) {
      positions.push(...c)
      normals.push(...q.normal)
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
    faceHash.push(q.face, q.face)
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices), faceHash: new Int32Array(faceHash) }
}

/** A unit square in the XY plane from x0, as face `face`, and a second
 *  beside it along the x = 1 side turned up about that side by `deg`. */
function hinge(deg: number, faces: [number, number]) {
  const t = (deg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  return quads([
    { corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], normal: [0, 0, 1], face: faces[0] },
    { corners: [[1, 0, 0], [1 + c, 0, s], [1 + c, 1, s], [1, 1, 0]], normal: [-s, 0, c], face: faces[1] },
  ])
}

const count = (segments: Float32Array) => segments.length / 6

describe('edges along the faces’ triangles', () => {
  it('draws a box’s twelve edges once each, from its faces’ outlines', async () => {
    const s = sketchOf(1, (sk) => addRectangle(sk, [0, 0], [40, 20]))
    const body = await bodyOf([s, extrudeAll(2, s, 10)])
    expect(outlineSegments(body.mesh.positions, body.mesh.indices).length / 6).toBe(12)
    const byEdge = lines(body)
    expect(byEdge.size).toBe(12)
    for (const segments of byEdge.values()) expect(segments.length / 6).toBe(1)
  })

  it('gives a cylinder’s circles and its seam each their own, every point a vertex of the shaded mesh', async () => {
    const s = sketchOf(1, (sk) => addEntity(sk, { kind: 'circle', c: [0, 0], r: 5 }))
    const body = await bodyOf([s, extrudeAll(2, s, 10)])
    const places = vertexPlaces(body)
    const outline = outlineSegments(body.mesh.positions, body.mesh.indices)
    expect(allOnMesh(outline, places)).toBe(true)
    const byEdge = lines(body)
    const circles = body.topology.edges.filter((e) => e.fingerprint.kind === 'circle')
    const seam = body.topology.edges.find((e) => e.fingerprint.kind === 'line')!
    expect(circles.length).toBe(2)
    // The seam is a side of the cylinder's mesh twice over, one place.
    expect(byEdge.get(seam.hash)!.length / 6).toBe(1)
    let total = byEdge.get(seam.hash)!.length
    for (const c of circles) {
      const segments = byEdge.get(c.hash)!
      expect(allOnMesh(segments, places)).toBe(true)
      // On its own circle: every point the radius out, at the circle's height.
      const z = c.ends[0][2]
      for (let i = 0; i < segments.length; i += 3) {
        expect(Math.hypot(segments[i], segments[i + 1])).toBeCloseTo(5, 4)
        expect(segments[i + 2]).toBeCloseTo(z, 6)
      }
      total += segments.length
    }
    // Between them, the whole outline and nothing twice.
    expect(total).toBe(outline.length)
  })

  it('draws a round’s rims on the triangles of the round and of the faces beside it', async () => {
    const s = sketchOf(1, (sk) => addRectangle(sk, [0, 0], [40, 20]))
    const plate = await bodyOf([s, extrudeAll(2, s, 10)])
    const top = plate.topology.edges.filter((e) => e.fingerprint.kind === 'line' && e.ends[0][2] > 9.9 && e.ends[1][2] > 9.9)
    const rounded = await bodyOf([s, extrudeAll(2, s, 10), { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: top.map((e) => e.fingerprint), radius: 3, chain: false, visible: true }])
    const places = vertexPlaces(rounded)
    const byEdge = lines(rounded)
    const rims = rounded.topology.edges.filter((e) => e.faces.some((h) => rounded.topology.faces.find((f) => f.hash === h)?.fingerprint.kind === 'cylinder'))
    expect(rims.length).toBeGreaterThan(8)
    for (const rim of rims) {
      const segments = byEdge.get(rim.hash)!
      // Taken off the faces, not the kernel's samples of the edge.
      expect(allOnMesh(segments, places)).toBe(true)
      // And on the edge they stand for, within a chord's sag of its polyline.
      for (let i = 0; i < segments.length; i += 3) expect(toPolyline(rim.polyline, segments[i], segments[i + 1], segments[i + 2])).toBeLessThan(0.05)
    }
  })
})

describe('which edges are drawn', () => {
  it('draws two faces folded at an angle as a sharp edge, and the open sides of a sheet', () => {
    const m = hinge(90, [1, 2])
    const rest = restSegments(m.positions, m.normals, m.indices, m.faceHash, () => true)
    // The fold once, and the three open sides of each square.
    expect(count(rest.sharp)).toBe(7)
    expect(count(rest.tangent)).toBe(0)
  })

  it('takes a side where the faces turn by a tenth of a degree for tangent, and one of a degree for sharp', () => {
    const slight = hinge(0.1, [1, 2])
    expect(count(restSegments(slight.positions, slight.normals, slight.indices, slight.faceHash).tangent)).toBe(1)
    const draft = hinge(1, [1, 2])
    const rest = restSegments(draft.positions, draft.normals, draft.indices, draft.faceHash)
    expect(count(rest.tangent)).toBe(0)
    expect(count(rest.sharp)).toBe(7)
  })

  it('leaves out the cut between two faces on one surface, and keeps two surfaces running into each other as tangent', () => {
    const flat = hinge(0, [1, 2])
    expect(count(restSegments(flat.positions, flat.normals, flat.indices, flat.faceHash, () => true).tangent)).toBe(0)
    expect(count(restSegments(flat.positions, flat.normals, flat.indices, flat.faceHash, () => true).sharp)).toBe(6)
    expect(count(restSegments(flat.positions, flat.normals, flat.indices, flat.faceHash, () => false).tangent)).toBe(1)
  })

  it('leaves out a seam: one face meeting itself in a place, each side with its own vertices', () => {
    const closed = hinge(0, [1, 1])
    const rest = restSegments(closed.positions, closed.normals, closed.indices, closed.faceHash)
    expect(count(rest.sharp)).toBe(6)
    expect(count(rest.tangent)).toBe(0)
    // Without the faces of the triangles a seam is not told from a tangent
    // edge.
    expect(count(restSegments(closed.positions, closed.normals, closed.indices, null).tangent)).toBe(1)
  })

  it('draws a cylinder by its circles alone, its seam left out and known for one', async () => {
    const s = sketchOf(1, (sk) => addEntity(sk, { kind: 'circle', c: [0, 0], r: 5 }))
    const body = await bodyOf([s, extrudeAll(2, s, 10)])
    const rest = restOf(body)
    const { segments, joins } = sharesOf(body)
    const circles = body.topology.edges.filter((e) => e.fingerprint.kind === 'circle')
    const seam = body.topology.edges.find((e) => e.fingerprint.kind === 'line')!
    expect(joins.get(seam.hash)).toBe('seam')
    for (const c of circles) expect(joins.get(c.hash)).toBe('sharp')
    expect(rest.sharp.length).toBe(circles.reduce((n, c) => n + segments.get(c.hash)!.length, 0))
    expect(rest.tangent.length).toBe(0)
    expect(rest.sharp.length).toBe(outlineSegments(body.mesh.positions, body.mesh.indices).length - segments.get(seam.hash)!.length)
  })

  it('tells a round’s rims along the flats it runs into for tangent, and the plate’s other edges for sharp', async () => {
    const s = sketchOf(1, (sk) => addRectangle(sk, [0, 0], [40, 20]))
    const plate = await bodyOf([s, extrudeAll(2, s, 10)])
    const top = plate.topology.edges.filter((e) => e.fingerprint.kind === 'line' && e.ends[0][2] > 9.9 && e.ends[1][2] > 9.9)
    const rounded = await bodyOf([s, extrudeAll(2, s, 10), { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: top.map((e) => e.fingerprint), radius: 3, chain: false, visible: true }])
    const { joins } = sharesOf(rounded)
    const kindOf = new Map(rounded.topology.faces.map((f) => [f.hash, f.fingerprint.kind]))
    const rims = rounded.topology.edges.filter((e) => e.fingerprint.kind === 'line' && e.faces.some((h) => kindOf.get(h) === 'cylinder') && e.faces.some((h) => kindOf.get(h) === 'plane'))
    // Each of the four rounds runs into the top and into a side.
    expect(rims.length).toBe(8)
    for (const rim of rims) expect(joins.get(rim.hash)).toBe('tangent')
    const plain = rounded.topology.edges.filter((e) => e.faces.every((h) => kindOf.get(h) === 'plane'))
    expect(plain.length).toBeGreaterThan(0)
    for (const e of plain) expect(joins.get(e.hash)).toBe('sharp')
    expect(restOf(rounded).tangent.length).toBeGreaterThan(0)
  })
})
