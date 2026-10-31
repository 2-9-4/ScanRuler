// SPDX-License-Identifier: AGPL-3.0-only
// The face a comparison names is the face reverse.body.describe lists: a
// faceted block — a half cut by a dozen planes, mirrored and joined, its
// twins sharing their surfaces — read against a "scan" sampled off its own
// faces, each point a hair outside the face it came from. Every point must
// be counted to the face it was taken from, by the hash describe's list
// holds, and that face must be the plane the point stands on by describe's
// own centroid and normal. The mesh's per-triangle hashes are held against
// the topology's on the mirrored body too, where twins share a surface.
// What had it wrong was the comparison's own surface: its tree sorts the
// triangles, and a hit was looked up by its place in that order among the
// meshes' — another face, and with two bodies another body. Last, the
// patches over tolerance on a face: a pad the model lacks is a feature,
// the texture round it is not.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { compareBodies } from '../core/compareDetail'
import type { Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { build, extrudeAll, rectangleSketch } from './reKit'

type V = [number, number, number]

const kernelPromise = ReKernel.load()

const norm = (v: V): V => {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** A cut by a plane facing `normal`, `depth` in from `edge` — a point on
 *  the edge or the corner it takes off — the material kept behind it: a
 *  facet. */
function facet(id: number, edge: V, normal: V, depth: number): Feature {
  const n = norm(normal)
  const origin: V = [edge[0] - n[0] * depth, edge[1] - n[1] * depth, edge[2] - n[2] * depth]
  const u = norm(Math.abs(n[2]) < 0.9 ? cross([0, 0, 1], n) : cross([1, 0, 0], n))
  const v = cross(n, u)
  return { id, kind: 'cutPlane', name: `Facet ${id}`, body: 2, plane: { kind: 'fitted', frame: { origin, normal: n, basisU: u, basisV: v } }, keep: -1, visible: true }
}

/** The half block x 0…24, y −15…15, z 0…20, eight of its edges and its
 *  four far corners cut away by a dozen planes, mirrored about x = 0 and
 *  joined. */
function facetedHousing(): Feature[] {
  const s: SketchFeature = rectangleSketch(1, 24, 30, [0, -15])
  const cuts: [V, V][] = [
    [[24, 15, 10], [1, 1, 0]],
    [[24, -15, 10], [1, -1, 0]],
    [[24, 0, 20], [1, 0, 1]],
    [[24, 0, 0], [1, 0, -1]],
    [[12, 15, 20], [0, 1, 1]],
    [[12, -15, 20], [0, -1, 1]],
    [[12, 15, 0], [0, 1, -1]],
    [[12, -15, 0], [0, -1, -1]],
    [[22, 13, 18], [1, 1, 1]],
    [[22, -13, 18], [1, -1, 1]],
    [[22, 13, 2], [1, 1, -1]],
    [[22, -13, 2], [1, -1, -1]],
  ]
  return [s, extrudeAll(2, s, 0, 20), ...cuts.map(([o, n], i) => facet(10 + i, o, n, i < 8 ? 2 : 3)), { id: 30, kind: 'mirror', name: 'Mirror 1', body: 2, plane: { kind: 'world', axis: 'x', offset: 0 }, join: true, visible: true }]
}

describe('the faces a comparison names', () => {
  it('are describe’s faces, on a faceted body mirrored and joined and on a body beside it', async () => {
    const builder = new Builder(await kernelPromise)
    const beside = rectangleSketch(40, 10, 10, [40, -5])
    const r = await build(builder, [...facetedHousing(), beside, extrudeAll(41, beside, 0, 10)])
    expect(r.results.every((x) => x.status === 'ok'), JSON.stringify(r.results)).toBe(true)
    expect(r.bodies).toHaveLength(2)
    const housing = r.bodies.find((b) => b.id === 2)!
    // Both halves: faces on either side of the mirror plane.
    expect(housing.topology.faces.some((f) => f.fingerprint.centroid[0] < -5)).toBe(true)
    expect(housing.topology.faces.some((f) => f.fingerprint.centroid[0] > 5)).toBe(true)

    // One point a face: the middle of its largest triangle, stood a hair
    // outside it — each a different hair, so a face's reading says which
    // point it was. A triangle's winding is outward.
    const samples: { body: number; face: number; at: V; off: number }[] = []
    for (const body of r.bodies) {
      const { mesh, topology } = body
      const faces = topology.faces
      expect(mesh.faceHash).toBeDefined()
      // Every face once by its hash, every triangle on one of them, and no
      // vertex on two.
      expect(new Set(faces.map((f) => f.hash)).size).toBe(faces.length)
      const indexOf = new Map(faces.map((f, i) => [f.hash, i]))
      for (const h of mesh.faceHash!) expect(indexOf.has(h)).toBe(true)
      const faceOfVertex = new Map<number, number>()
      for (let k = 0; k < mesh.indices.length; k++) {
        const was = faceOfVertex.get(mesh.indices[k])
        expect(was === undefined || was === mesh.faceHash![Math.floor(k / 3)]).toBe(true)
        faceOfVertex.set(mesh.indices[k], mesh.faceHash![Math.floor(k / 3)])
      }
      const p = mesh.positions
      const ix = mesh.indices
      const corner = (k: number): V => [p[ix[k] * 3], p[ix[k] * 3 + 1], p[ix[k] * 3 + 2]]
      faces.forEach((f, fi) => {
        let best = -1
        let bestArea = 0
        for (let t = 0; t < ix.length / 3; t++) {
          if (mesh.faceHash![t] !== f.hash) continue
          const [a, b, c] = [corner(t * 3), corner(t * 3 + 1), corner(t * 3 + 2)]
          const area = Math.hypot(...cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]))
          if (area > bestArea) [best, bestArea] = [t, area]
        }
        expect(best, `face ${fi} has no triangle`).toBeGreaterThanOrEqual(0)
        const [a, b, c] = [corner(best * 3), corner(best * 3 + 1), corner(best * 3 + 2)]
        const normal = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]))
        // The mesh's triangle lies on describe's face: in its plane, facing
        // its way — the mesh's hashes and the topology's agree, twins and all.
        expect(dot(normal, f.fingerprint.dir), `face ${fi}'s triangles face another way than describe's face`).toBeGreaterThan(0.999)
        const mid: V = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
        const c0 = f.fingerprint.centroid
        expect(Math.abs(dot([mid[0] - c0[0], mid[1] - c0[1], mid[2] - c0[2]], f.fingerprint.dir)), `face ${fi}'s triangles lie off describe's face`).toBeLessThan(1e-4)
        const off = 0.002 * (samples.length + 1)
        samples.push({ body: body.id, face: fi, at: [mid[0] + normal[0] * off, mid[1] + normal[1] * off, mid[2] + normal[2] * off], off })
      })
    }
    const positions = Float32Array.from(samples.flatMap((s) => s.at))
    const detail = compareBodies(r.bodies.map((b) => ({ id: b.id, mesh: b.mesh })), positions, null, 0.1, 1, 0, 1)
    expect(detail.field.values.length).toBe(samples.length)
    // Each face read by its own point alone, on its own body, by the hash
    // describe lists — the index compare answers is describe's.
    const byOff = new Map(samples.map((s) => [Math.round(s.off * 1e4), s]))
    expect(detail.faces).toHaveLength(samples.length)
    for (const row of detail.faces) {
      expect(row.read).toBe(1)
      const s = byOff.get(Math.round(row.sum * 1e4))!
      expect(s, `a reading of ${row.sum} matches no point`).toBeDefined()
      expect(row.body, `the point off face ${s.face} of body ${s.body} was counted to body ${row.body}`).toBe(s.body)
      const named = r.bodies.find((b) => b.id === row.body)!.topology.faces.findIndex((f) => f.hash === row.faceHash)
      expect(named, `the point off face ${s.face} was counted to face ${named}`).toBe(s.face)
    }
    builder.dispose()
  })

  it('counts what is over tolerance, and the patches, when none is to be named', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 20, 20)
    const r = await build(builder, [s, extrudeAll(2, s, 0, 10)])
    const { mesh } = r.bodies[0]
    // The top face's vertices, 0.05 mm proud of it: over 0.02, in a patch
    // or a few (those on its rim may lie nearest a side).
    const top: number[] = []
    for (let v = 0; v < mesh.positions.length / 3; v++) if (Math.abs(mesh.positions[v * 3 + 2] - 10) < 1e-6) top.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], 10.05)
    const positions = Float32Array.from(top)
    const read = (count: number) => compareBodies([{ id: 2, mesh }], positions, null, 0.1, 1, 0, 1, { count, tolerance: 0.02, grain: 25 })
    const named = read(8)
    const none = read(0)
    expect(named.patches.length).toBeGreaterThan(0)
    expect(none.patches).toEqual([])
    expect(none.over).toBe(positions.length / 3)
    expect(none.over).toBe(named.over)
    expect(none.patchesFound).toBe(named.patchesFound)
    expect(none.spacing).toBe(named.spacing)
    builder.dispose()
  })

  it('tells a pad the model lacks from the texture round it, by kind, and counts the features', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 40, 40)
    const r = await build(builder, [s, extrudeAll(2, s, 0, 10)])
    const { mesh } = r.bodies[0]
    // The top face's scan, a point every 0.25 mm clear of its rim: cast
    // texture ±0.3 over it, and a 6 × 6 × 1 mm pad the plate was not given.
    const top: number[] = []
    for (let x = 2; x <= 38; x += 0.25)
      for (let y = 2; y <= 38; y += 0.25) {
        const pad = x >= 17 && x < 23 && y >= 17 && y < 23 ? 1 : 0
        top.push(x, y, 10 + pad + 0.3 * Math.sin((2 * Math.PI * x) / 4) * Math.sin((2 * Math.PI * y) / 4))
      }
    const detail = compareBodies([{ id: 2, mesh }], Float32Array.from(top), null, 0.25, 2.5, 0, 1, { count: 50, tolerance: 0.25 })
    expect(detail.patchesFound).toBeGreaterThan(20)
    expect(detail.features.count).toBe(1)
    expect(detail.features.shareOfExcess).toBeGreaterThan(0.8)
    const [pad, ...texture] = detail.patches
    expect(pad).toMatchObject({ kind: 'feature', depth: expect.closeTo(1, 1) })
    expect(pad.area).toBeGreaterThan(36)
    expect(pad.area).toBeLessThan(40)
    expect(pad.volume).toBeGreaterThan(25)
    expect(texture.every((p) => p.kind === 'texture')).toBe(true)
    builder.dispose()
  })
})
