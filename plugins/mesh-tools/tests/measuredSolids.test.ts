// SPDX-License-Identifier: AGPL-3.0-only
// A fitted cylinder, cone and sphere as the closed solids the Boolean cuts
// with — closed once welded, wound outward, of the volume they should have —
// a bore cut into a block with one, and what of 3D Measure's elements is on
// offer: only those shown, each as it is drawn, at its assumed Ø and out to
// its extension.

import { beforeAll, describe, expect, it } from 'vitest'
import Module, { type ManifoldToplevel } from 'manifold-3d'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { meshCentroid } from '../../../src/core/geometry/centroid'
import { booleanMesh, type Triangles } from '../core/boolean'
import { elementSolid, segmentsFor } from '../core/primitiveMesh'
import { elementSolids } from '../app/booleanSolids'
import { boxMesh } from '../../../tests/helpers'
import type { ConeFit, CylinderFit, FitData, SphereFit, Vec3 } from '../../../src/core/types'
import type { Element } from '../../../src/state/store'

let wasm: ManifoldToplevel
beforeAll(async () => {
  wasm = await Module()
  wasm.setup()
})

const stats = { sigma: 0, usedPoints: 0, regionSize: 0 }
const tilted: Vec3 = (() => {
  const v: Vec3 = [0.3, -0.2, 0.93]
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
})()

const cylinder = (radius: number, length: number, center: Vec3 = [1, 2, 3], axis: Vec3 = tilted): CylinderFit => ({ kind: 'cylinder', center, axis, radius, length, coverage: 360, ...stats })

/** Welded as the boolean welds a tool, and read by Manifold: closed, and
 *  its volume. */
function solidVolume(t: Triangles): number {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: t.positions, triVerts: t.indices })
  mesh.merge()
  const m = new wasm.Manifold(mesh)
  try {
    expect(m.status()).toBe('NoError')
    return m.volume()
  } finally {
    m.delete()
  }
}

/** The area of the n-gon a circle of radius r is meshed as. */
const ngon = (r: number, n: number) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n)

describe('a measured element as a solid', () => {
  it('meshes a tilted cylinder closed, outward, to the chord asked for', () => {
    const t = elementSolid(cylinder(5.7, 11), 0.01)!
    const n = segmentsFor(5.7, 0.01)
    // Every chord within a hundredth of the round.
    expect(5.7 * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(0.01)
    expect(solidVolume(t)).toBeCloseTo(ngon(5.7, n) * 11, 3)
    // Positive by the divergence theorem: the triangles face out.
    expect(meshCentroid(t.positions, t.indices).volumeMm3).toBeCloseTo(ngon(5.7, n) * 11, 3)
  })

  it('meshes a cone to its tip and a frustum, and a sphere', () => {
    const cone = (r1: number, r2: number): ConeFit => ({ kind: 'cone', center: [0, 0, 0], axis: tilted, halfAngle: 10, radius: (r1 + r2) / 2, radius1: r1, radius2: r2, length: 8, coverage: 360, ...stats })
    const frustum = elementSolid(cone(2, 4), 0.01)!
    const n = segmentsFor(4, 0.01)
    const k = ngon(1, n)
    // A frustum of a polygonal cone: h/3 (A0 + A1 + √(A0 A1)).
    const want = (8 / 3) * (k * 4 + k * 16 + k * 8)
    expect(solidVolume(frustum)).toBeCloseTo(want, 3)
    expect(meshCentroid(frustum.positions, frustum.indices).volumeMm3).toBeGreaterThan(0)
    const tip = elementSolid(cone(0, 4), 0.01)!
    expect(solidVolume(tip)).toBeCloseTo((8 / 3) * k * 16, 3)

    const ball: SphereFit = { kind: 'sphere', center: [3, -1, 2], radius: 6, ...stats }
    const sphere = elementSolid(ball, 0.01)!
    const v = solidVolume(sphere)
    expect(v).toBeLessThan((4 / 3) * Math.PI * 216)
    // Inscribed, so a shade under the sphere: half a percent at this chord.
    expect(v).toBeGreaterThan((4 / 3) * Math.PI * 216 * 0.99)
    expect(meshCentroid(sphere.positions, sphere.indices).volumeMm3).toBeGreaterThan(0)
  })

  it('has no solid for a kind with no volume', () => {
    const plane: FitData = { kind: 'plane', center: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 1, extentV: 1, ...stats } as FitData
    expect(elementSolid(plane, 0.01)).toBeNull()
    expect(elementSolid(cylinder(0, 5), 0.01)).toBeNull()
  })

  it('cuts a bore into a block with a fitted cylinder as it is', () => {
    const g = buildMeshGraph({ kind: 'soup', positions: boxMesh(20, 8) })
    // In through the top at z = 10, down to z = −5.
    const tool = elementSolid(cylinder(3, 20, [0, 0, 5], [0, 0, 1]), 0.01)!
    const out = booleanMesh(wasm, g, [tool], 'subtract')
    const n = segmentsFor(3, 0.01)
    expect(meshCentroid(out.positions, out.indices).volumeMm3).toBeCloseTo(8000 - ngon(3, n) * 15, 2)
  })
})

describe('the measured solids on offer', () => {
  const element = (id: number, fit: FitData, more: Partial<Element> = {}): Element => ({
    id,
    kind: fit.kind,
    name: `${fit.kind} ${id}`,
    color: '#123',
    source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } },
    status: 'done',
    visible: true,
    fit,
    ...more,
  } as Element)

  it('offers the cylinders, cones and spheres shown, each as it is drawn', async () => {
    const plane = { kind: 'plane', center: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 1, extentV: 1, ...stats } as FitData
    const ball: SphereFit = { kind: 'sphere', center: [0, 0, 0], radius: 2, ...stats }
    const solids = elementSolids([
      element(1, cylinder(5, 10, [0, 0, 0], [0, 0, 1]), { assumed: 12, extend: { kind: 'cylinder', start: 1, end: 4 } }),
      element(2, plane),
      element(3, ball, { visible: false }),
      element(4, ball),
    ])
    expect(solids.map((s) => s.key)).toEqual(['element:1', 'element:4'])
    expect(solids[0]).toMatchObject({ name: 'cylinder 1', source: '3D Measure' })
    // At its assumed Ø 12, from 1 below its measured end to 4 past the other.
    const m = await solids[0].mesh(0.01)
    let minR = Infinity
    let maxR = 0
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < m.positions.length; i += 3) {
      const r = Math.hypot(m.positions[i], m.positions[i + 1])
      if (r > 1e-6) minR = Math.min(minR, r)
      maxR = Math.max(maxR, r)
      lo = Math.min(lo, m.positions[i + 2])
      hi = Math.max(hi, m.positions[i + 2])
    }
    expect(maxR).toBeCloseTo(6, 5)
    expect(lo).toBeCloseTo(-6, 5)
    expect(hi).toBeCloseTo(9, 5)
    expect(minR).toBeCloseTo(6, 5)
  })

  it('gives a solid a new version when its shape changes, and keeps it while it does not', () => {
    const fit = cylinder(5, 10)
    const [a] = elementSolids([element(1, fit)])
    const [same] = elementSolids([element(1, { ...fit }, { name: 'renamed' })])
    const [wider] = elementSolids([element(1, fit, { assumed: 10.2 })])
    const [longer] = elementSolids([element(1, fit, { extend: { kind: 'cylinder', start: 0, end: 2 } })])
    expect(same.version).toBe(a.version)
    expect(wider.version).not.toBe(a.version)
    expect(longer.version).not.toBe(a.version)
  })
})
