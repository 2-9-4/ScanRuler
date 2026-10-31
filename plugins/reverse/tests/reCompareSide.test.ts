// SPDX-License-Identifier: AGPL-3.0-only
// The comparison by the scan's side: a thin wall scanned on both skins —
// the outer at z = 0 facing up, the inner 2 mm under it facing down — read
// against (a) the hollow model, the wall itself; (b) a block filling the
// outer skin, as a shell is before it is hollowed: the inner skin reads as
// −2 unless skin: "outer" leaves it out, and then the figures are the
// hollow model's; (c) a sheet on the outer skin, which reads that skin's
// noise alone, the inner one behind it left out. The scan's winding is
// read off the scan, so a scan wound inside-out reads alike.

import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { computeVertexNormals } from '../../../src/core/geometry/normals'
import { compareBodies } from '../core/compareDetail'
import type { KernelMesh } from '../core/kernel'
import { liveMap, sheetTriangles, surfaceOfMeshes, type ScanSide } from '../core/liveMap'

/** A closed box from `min` to `max`, wound outward, as a kernel mesh. */
function box(min: [number, number, number], max: [number, number, number]): KernelMesh {
  const positions = new Float32Array(24)
  for (let i = 0; i < 8; i++) {
    positions[i * 3] = i & 1 ? max[0] : min[0]
    positions[i * 3 + 1] = i & 2 ? max[1] : min[1]
    positions[i * 3 + 2] = i & 4 ? max[2] : min[2]
  }
  const indices = Uint32Array.from([0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5])
  return { positions, indices, normals: new Float32Array(24) }
}

/** A square grid over x, y in ±half at height z, `cells` to a side, its
 *  triangles wound to face up or down, each vertex's height jittered by
 *  ±noise. */
function grid(half: number, z: number, up: boolean, cells: number, noise = 0, rand = mulberry32(7)): { positions: Float32Array; indices: Uint32Array } {
  const side = cells + 1
  const positions = new Float32Array(side * side * 3)
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const v = j * side + i
      positions[v * 3] = -half + (2 * half * i) / cells
      positions[v * 3 + 1] = -half + (2 * half * j) / cells
      positions[v * 3 + 2] = z + noise * (2 * rand() - 1)
    }
  const indices: number[] = []
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const a = j * side + i
      const b = a + 1
      const c = a + side
      const d = c + 1
      if (up) indices.push(a, b, d, a, d, c)
      else indices.push(a, d, b, a, c, d)
    }
  return { positions, indices: Uint32Array.from(indices) }
}

const NOISE = 0.05
const WALL = 2
const CELLS = 50

/** The thin wall's scan: both skins, their normals from their winding —
 *  out of the material — or all of them turned round. */
function wallScan(insideOut = false): { positions: Float32Array; normals: Float32Array; skin: number } {
  const rand = mulberry32(11)
  const outer = grid(10, 0, !insideOut, CELLS, NOISE, rand)
  const inner = grid(10, -WALL, insideOut, CELLS, NOISE, rand)
  const skin = outer.positions.length / 3
  const positions = new Float32Array(outer.positions.length * 2)
  positions.set(outer.positions)
  positions.set(inner.positions, outer.positions.length)
  const indices = new Uint32Array(outer.indices.length * 2)
  indices.set(outer.indices)
  for (let i = 0; i < inner.indices.length; i++) indices[outer.indices.length + i] = inner.indices[i] + skin
  return { positions, normals: computeVertexNormals(positions, indices), skin }
}

/** A sheet over the outer skin, facing up. */
function sheet(): KernelMesh {
  const g = grid(12, 0, true, 12)
  return { ...g, normals: new Float32Array(g.positions.length) }
}

const RANGE = 0.4
const REACH = 10 * RANGE

/** The comparison's figures over its field. */
function figures(values: Float32Array) {
  let sum = 0
  let sumSq = 0
  for (const v of values) {
    sum += v
    sumSq += v * v
  }
  return { read: values.length, mean: sum / values.length, rms: Math.sqrt(sumSq / values.length) }
}

function compare(bodies: { id: number; mesh: KernelMesh; sheet?: boolean }[], positions: Float32Array, side: ScanSide | null, far?: number) {
  return compareBodies(bodies, positions, null, RANGE, REACH, 0, 1, undefined, undefined, far, side)
}

describe('a thin wall against a body not hollowed yet', () => {
  const scan = wallScan()
  const hollow = [{ id: 1, mesh: box([-15, -15, -WALL], [15, 15, 0]) }]
  const solid = [{ id: 2, mesh: box([-15, -15, -20], [15, 15, 0]) }]
  const facing: ScanSide = { normals: scan.normals, facingDeg: 90 }

  it('reads the inner skin as minus the wall by default', () => {
    const d = compare(solid, scan.positions, facing)
    expect(d.field.values.length).toBe(2 * scan.skin)
    const inner = Float32Array.from(d.field.values.filter((_, i) => d.field.subset[i] >= scan.skin))
    expect(inner.length).toBe(scan.skin)
    expect(figures(inner).mean).toBeCloseTo(-WALL, 1)
    // Nothing faces the inner skin within reach: read against the top all
    // the same, and counted.
    expect(d.side).toEqual({ refaced: 0, unfacing: scan.skin, back: 0, inward: 0 })
  })

  it('with skin: "outer", reads the outer skin at the hollow model’s numbers', () => {
    const asHollow = figures(compare(hollow, scan.positions, facing).field.values)
    expect(asHollow.read).toBe(2 * scan.skin)
    const d = compare(solid, scan.positions, { ...facing, skin: 'outer' })
    const outer = figures(d.field.values)
    expect(outer.read).toBe(scan.skin)
    expect(d.side!.inward).toBe(scan.skin)
    expect(Math.abs(outer.mean - asHollow.mean)).toBeLessThan(0.01)
    expect(Math.abs(outer.rms - asHollow.rms)).toBeLessThan(0.005)
    expect(outer.rms).toBeLessThan(NOISE)
  })

  it('with unfacing: "drop", leaves the inner skin out too', () => {
    const d = compare(solid, scan.positions, { ...facing, unfacing: 'drop' })
    expect(d.field.values.length).toBe(scan.skin)
    expect(d.side!.unfacing).toBe(scan.skin)
  })

  it('reads alike from a scan wound inside-out', () => {
    const turned = wallScan(true)
    const d = compare(solid, turned.positions, { normals: turned.normals, facingDeg: 90, skin: 'outer' })
    expect(d.field.values.length).toBe(turned.skin)
    expect(figures(d.field.values).rms).toBeLessThan(NOISE)
  })

  it('keeps the skin it leaves out out of the far reading', () => {
    // At a range of 0.1 the reach is 1 mm and the inner skin lies past it.
    const plain = compareBodies(solid, scan.positions, null, 0.1, 1, 0, 1, { count: 0, tolerance: 0.1 }, undefined, 25, facing)
    expect(plain.far!.inside.count).toBe(scan.skin)
    const outer = compareBodies(solid, scan.positions, null, 0.1, 1, 0, 1, { count: 0, tolerance: 0.1 }, undefined, 25, { ...facing, skin: 'outer' })
    expect(outer.far!.inside.count).toBe(0)
  })

  it('re-reads a vertex sunk past half a thin wall against its own face', () => {
    // The wall's inner skin within 0.4 of the outer face: nearer the top
    // than the bottom it came off, by its position alone.
    const thin = [{ id: 3, mesh: box([-15, -15, -WALL], [15, 15, 0]) }]
    const sunk = new Float32Array(scan.positions)
    for (let v = scan.skin; v < 2 * scan.skin; v++) sunk[v * 3 + 2] = -0.6
    const nearest = compare(thin, sunk, null)
    const side = compare(thin, sunk, facing)
    const innerOf = (d: ReturnType<typeof compare>) => Float32Array.from(d.field.values.filter((_, i) => d.field.subset[i] >= scan.skin))
    expect(figures(innerOf(nearest)).mean).toBeCloseTo(-0.6, 1)
    expect(figures(innerOf(side)).mean).toBeCloseTo(-1.4, 1)
    expect(side.side!.refaced).toBe(scan.skin)
  })
})

describe('a sheet on the outer skin', () => {
  const scan = wallScan()
  const bodies = [{ id: 4, mesh: sheet(), sheet: true }]

  it('reads the outer skin’s noise alone', () => {
    const d = compare(bodies, scan.positions, { normals: scan.normals, facingDeg: 90 })
    const f = figures(d.field.values)
    expect(f.read).toBe(scan.skin)
    expect(f.rms).toBeLessThan(NOISE)
    expect(d.side!.back).toBe(scan.skin)
    expect(Math.max(...d.field.subset)).toBeLessThan(scan.skin)
  })

  it('on its front even with the facing limit off', () => {
    const d = compare(bodies, scan.positions, { normals: scan.normals, facingDeg: null })
    expect(figures(d.field.values).read).toBe(scan.skin)
  })

  it('reads both skins without the scan’s normals', () => {
    const f = figures(compare(bodies, scan.positions, null).field.values)
    expect(f.read).toBe(2 * scan.skin)
    expect(f.rms).toBeGreaterThan(1)
  })

  it('and so does the live map', () => {
    const meshes = [sheet()]
    const surface = surfaceOfMeshes(meshes)!
    const flags = sheetTriangles(surface, meshes, [true])
    expect(flags).not.toBeNull()
    const field = liveMap(surface, scan.positions, null, RANGE, false, { normals: scan.normals, facingDeg: 90 }, flags)
    expect(field.values.length).toBe(scan.skin)
    const plain = liveMap(surface, scan.positions, null, RANGE)
    expect(plain.values.length).toBe(2 * scan.skin)
  })
})
