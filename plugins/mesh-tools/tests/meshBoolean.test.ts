// SPDX-License-Identifier: AGPL-3.0-only
// A closed scan and a solid made one: a cylinder taken out of a block as a
// blind bore, added to it as a boss, and the two cut down to what they share
// — the result closed, of the volume it should have, and the block's own
// vertices carried through the edit's map where they still are.

import { beforeAll, describe, expect, it } from 'vitest'
import Module, { type ManifoldToplevel } from 'manifold-3d'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { meshCentroid } from '../../../src/core/geometry/centroid'
import { booleanMesh, closedness, type Triangles } from '../core/boolean'
import { boxMesh } from '../../../tests/helpers'
import type { MeshGraph } from '../../../src/core/types'

let wasm: ManifoldToplevel
beforeAll(async () => {
  wasm = await Module()
  wasm.setup()
})

const block = (): MeshGraph => buildMeshGraph({ kind: 'soup', positions: boxMesh(20, 8) })

/** A cylinder along Z as a CAD body's mesh comes: face by face, the rims'
 *  vertices once for the wall and once for each end. */
function cylinder(r: number, z0: number, z1: number, x = 0, y = 0, n = 48): Triangles {
  const p: number[] = []
  const idx: number[] = []
  const at = (i: number): [number, number] => [x + r * Math.cos((2 * Math.PI * i) / n), y + r * Math.sin((2 * Math.PI * i) / n)]
  // The wall: a quad per segment, wound outward.
  for (let i = 0; i < n; i++) {
    const [ax, ay] = at(i)
    const [bx, by] = at(i + 1)
    const base = p.length / 3
    p.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  // The ends, fanned from their middles: the top facing up, the bottom down.
  for (const [z, up] of [[z1, true], [z0, false]] as const) {
    const centre = p.length / 3
    p.push(x, y, z)
    const ring = p.length / 3
    for (let i = 0; i < n; i++) {
      const [ax, ay] = at(i)
      p.push(ax, ay, z)
    }
    for (let i = 0; i < n; i++) {
      const a = ring + i
      const b = ring + ((i + 1) % n)
      if (up) idx.push(centre, a, b)
      else idx.push(centre, b, a)
    }
  }
  return { positions: new Float32Array(p), indices: new Uint32Array(idx) }
}

/** The area of the n-gon a cylinder of radius r is meshed as. */
const ngon = (r: number, n = 48) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n)

describe('a boolean of the scan and a solid', () => {
  it('cuts a blind bore into a block, closed, with the block’s vertices carried through', () => {
    const g = block()
    expect(meshCentroid(g.positions, g.indices).volumeMm3).toBeCloseTo(8000, 3)
    // In through the top at z = 10, down to z = −5.
    const out = booleanMesh(wasm, g, [cylinder(3, -5, 15)], 'subtract')
    const n = out.positions.length / 3
    expect(closedness(out.indices, n)).toEqual({ open: 0, bad: 0 })
    const c = meshCentroid(out.positions, out.indices)
    expect(c.closed).toBe(true)
    expect(c.volumeMm3).toBeCloseTo(8000 - ngon(3) * 15, 2)
    expect(out.report.volumeAfter).toBeCloseTo(c.volumeMm3, 2)
    expect(out.report.removed).toBeGreaterThan(0)
    // Every vertex of the block that is still there is where it was, and
    // the old ones keep their order ahead of the new.
    expect(out.vertexMap.length).toBe(g.vertexCount)
    let last = -1
    let kept = 0
    for (let v = 0; v < g.vertexCount; v++) {
      const w = out.vertexMap[v]
      if (w < 0) continue
      kept++
      expect(w).toBeGreaterThan(last)
      last = w
      for (let k = 0; k < 3; k++) expect(out.positions[w * 3 + k]).toBe(g.positions[v * 3 + k])
    }
    // Only the top's vertices inside the bore went.
    expect(kept).toBeGreaterThan(g.vertexCount * 0.9)
    expect(kept).toBeLessThan(g.vertexCount)
    expect(n).toBeGreaterThan(kept)
  })

  it('adds a boss through the top, and keeps only what the two share', () => {
    const g = block()
    const boss = booleanMesh(wasm, g, [cylinder(3, 5, 15)], 'add')
    expect(meshCentroid(boss.positions, boss.indices).volumeMm3).toBeCloseTo(8000 + ngon(3) * 5, 2)
    expect(closedness(boss.indices, boss.positions.length / 3)).toEqual({ open: 0, bad: 0 })
    const common = booleanMesh(wasm, g, [cylinder(3, 5, 15)], 'intersect')
    expect(meshCentroid(common.positions, common.indices).volumeMm3).toBeCloseTo(ngon(3) * 5, 2)
  })

  it('says what is wrong: an open mesh, a solid sealed inside, a solid that misses', () => {
    const g = block()
    const open = { positions: g.positions, indices: g.indices.slice(3), vertexCount: g.vertexCount }
    expect(() => booleanMesh(wasm, open, [cylinder(3, -5, 15)], 'subtract')).toThrow(/not closed — 3 open edges.*Fill holes/)
    expect(() => booleanMesh(wasm, g, [cylinder(3, -5, 5)], 'subtract')).toThrow(/wholly inside/)
    expect(() => booleanMesh(wasm, g, [cylinder(3, 20, 30)], 'subtract')).toThrow(/does not reach/)
    expect(() => booleanMesh(wasm, g, [cylinder(3, 20, 30)], 'intersect')).toThrow(/do not overlap/)
  })
})

describe('a boolean of the scan and several solids', () => {
  const named = (name: string, t: Triangles) => ({ ...t, name })

  it('takes two bores out in one edit, and a solid given twice once', () => {
    const g = block()
    const two = booleanMesh(wasm, g, [cylinder(2, -5, 15, -5), cylinder(2, -5, 15, 5)], 'subtract')
    expect(closedness(two.indices, two.positions.length / 3)).toEqual({ open: 0, bad: 0 })
    expect(meshCentroid(two.positions, two.indices).volumeMm3).toBeCloseTo(8000 - 2 * ngon(2) * 15, 2)
    // As one: their union, so the same solid twice takes what it takes once.
    const once = booleanMesh(wasm, g, [cylinder(3, -5, 15)], 'subtract')
    const twice = booleanMesh(wasm, g, [cylinder(3, -5, 15), cylinder(3, -5, 15)], 'subtract')
    expect(twice.report.volumeAfter).toBeCloseTo(once.report.volumeAfter, 4)
  })

  it('keeps what the mesh shares with either of two solids', () => {
    const g = block()
    const kept = booleanMesh(wasm, g, [cylinder(2, 5, 15, -5), cylinder(2, 5, 15, 5)], 'intersect')
    expect(meshCentroid(kept.positions, kept.indices).volumeMm3).toBeCloseTo(2 * ngon(2) * 5, 2)
  })

  it('names the solid that misses the mesh, or would seal a hollow, or adds nothing', () => {
    const g = block()
    const bore = named('Bore 1', cylinder(2, -5, 15, -5))
    expect(() => booleanMesh(wasm, g, [bore, named('Cylinder 2', cylinder(2, 20, 30, 5))], 'subtract')).toThrow(/^Cylinder 2 does not reach the mesh/)
    expect(() => booleanMesh(wasm, g, [bore, named('Pocket', cylinder(2, -5, 5, 5))], 'subtract')).toThrow(/^Pocket lies wholly inside the mesh — taking it away would seal a hollow/)
    // Two that overlap are one piece, named together.
    expect(() => booleanMesh(wasm, g, [bore, named('Pocket A', cylinder(2, -5, 5, 4)), named('Pocket B', cylinder(2, -5, 5, 6))], 'subtract')).toThrow(/^Pocket A and Pocket B lie wholly inside the mesh — taking them away/)
    expect(() => booleanMesh(wasm, g, [named('Boss', cylinder(2, 5, 15, -5)), named('Plug', cylinder(2, -5, 5, 5))], 'add')).toThrow(/^Plug lies wholly inside the mesh — there is nothing to add/)
    // A solid with no name is the solid.
    expect(() => booleanMesh(wasm, g, [cylinder(2, 20, 30)], 'subtract')).toThrow(/^The solid does not reach/)
  })
})
