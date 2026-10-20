// SPDX-License-Identifier: AGPL-3.0-only
// The deviation map on the reference: the reference cut finer with no
// cracks, a boss the scan lacks read proud on its own top, the face the
// scan never reached read as no scan, and the share the scan stands behind.

import { describe, expect, it } from 'vitest'
import { identityRigid } from '../src/core/deviation/rigid'
import { NominalSurface } from '../src/core/deviation/surface'
import { meshArea, readReference, referenceCoverage, sampleSpacing, subdivideForMap } from '../src/core/deviation/onReference'

type Quad = [number, number, number][]

/** Triangles of quads given counter-clockwise from outside. */
function meshOf(quads: Quad[]): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  for (const q of quads) {
    const base = positions.length / 3
    for (const v of q) positions.push(...v)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** The faces of a box, outward, by name. */
function boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Record<'bottom' | 'top' | 'front' | 'back' | 'left' | 'right', Quad> {
  return {
    bottom: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    top: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    front: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    back: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    left: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    right: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
  }
}

describe('the reference cut finer', () => {
  it('keeps the readings about the spacing apart, and the area', () => {
    const cube = boxFaces(0, 0, 0, 10, 10, 10)
    const { positions, indices } = meshOf(Object.values(cube))
    const fine = subdivideForMap(positions, indices, null, 1)
    expect(meshArea(fine.positions, fine.indices)).toBeCloseTo(600, 3)
    for (let t = 0; t < fine.indices.length; t += 3) {
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const i = fine.indices[t + a], j = fine.indices[t + b]
        const d = Math.hypot(...[0, 1, 2].map((k) => fine.positions[i * 3 + k] - fine.positions[j * 3 + k]))
        expect(d).toBeLessThanOrEqual(Math.SQRT2 * 1.5)
      }
    }
    // About two triangles a square spacing, not hundreds.
    expect(fine.indices.length / 3).toBeLessThan(600 * 4)
    expect(fine.parent).toHaveLength(fine.indices.length / 3)
  })

  it('cuts a sliver by its area, not its length', () => {
    const { positions, indices } = meshOf([[[0, 0, 0], [100, 0, 0], [100, 0.5, 0], [0, 0.5, 0]]])
    const fine = subdivideForMap(positions, indices, null, 0.5)
    expect(fine.indices.length / 3).toBeLessThan(2000)
  })

  it('opens the spacing on a large reference', () => {
    expect(sampleSpacing(100, 0.5)).toBe(0.5)
    expect(sampleSpacing(10_000_000, 0.5)).toBeCloseTo(Math.sqrt(10), 6)
  })
})

describe('the reference read against the scan', () => {
  // The scan: a 10 mm cube scanned all round but underneath.
  const cube = boxFaces(0, 0, 0, 10, 10, 10)
  const scanMesh = meshOf([cube.top, cube.front, cube.back, cube.left, cube.right])
  const scan = new NominalSurface(scanMesh.positions, scanMesh.indices)
  // The reference: the cube with a 2 × 2 boss 3 mm proud on top.
  const boss = boxFaces(4, 4, 10, 6, 6, 13)
  const ref = meshOf([...Object.values(cube), boss.top, boss.front, boss.back, boss.left, boss.right])
  const fine = subdivideForMap(ref.positions, ref.indices, null, 0.5)
  const values = readReference(scan, fine, { toScan: identityRigid(), reach: 5, facingDeg: 60 })
  const at = (pred: (x: number, y: number, z: number) => boolean) => {
    const out: number[] = []
    for (let v = 0; v < values.length; v++) if (pred(fine.positions[v * 3], fine.positions[v * 3 + 1], fine.positions[v * 3 + 2])) out.push(values[v])
    return out
  }

  it('reads the boss proud on its own top', () => {
    const top = at((x, y, z) => z === 13 && x > 4.2 && x < 5.8 && y > 4.2 && y < 5.8)
    expect(top.length).toBeGreaterThan(4)
    for (const v of top) expect(v).toBeCloseTo(3, 4)
  })

  it('reads the scanned faces on the surface and the bottom as no scan', () => {
    const sides = at((x, _y, z) => x === 0 && z > 1 && z < 9)
    expect(sides.length).toBeGreaterThan(10)
    for (const v of sides) expect(v).toBeCloseTo(0, 5)
    const bottom = at((x, y, z) => z === 0 && x > 1 && x < 9 && y > 1 && y < 9)
    expect(bottom.length).toBeGreaterThan(10)
    for (const v of bottom) expect(v).toBeNaN()
  })

  it('says how much of the reference the scan stands behind', () => {
    const c = referenceCoverage(fine, values, 0.1)
    expect(c.area).toBeCloseTo(600 + 4 + 4 * 6, 3)
    // The bottom (100 mm²) is not backed; the boss's sides face nothing.
    expect(c.backed / c.area).toBeGreaterThan(0.75)
    expect(c.backed / c.area).toBeLessThan(0.85)
    expect(c.withinTolerance).toBeLessThan(c.backed)
  })

  it('reads a scan wound the other way round the same', () => {
    const flipped = Uint32Array.from(scanMesh.indices)
    for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]]
    const inside = readReference(new NominalSurface(scanMesh.positions, flipped), fine, { toScan: identityRigid(), reach: 5, facingDeg: 60 })
    for (let v = 0; v < values.length; v++) {
      if (Number.isNaN(values[v])) expect(inside[v]).toBeNaN()
      else expect(inside[v]).toBeCloseTo(values[v], 5)
    }
  })
})

describe('a reference welded at its sharp edges', () => {
  it('keeps each face its own normal at a corner, and reads the faces on the surface to their corners', () => {
    // A 10 mm cube of 8 shared vertices — as a mesh file welds it.
    const positions = Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10])
    const indices = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7])
    const scan = new NominalSurface(positions, indices)
    const fine = subdivideForMap(positions, indices, null, 0.5)
    // Every normal is a face's own: one of the six axis directions.
    for (let v = 0; v < fine.normals.length / 3; v++) {
      const n = [fine.normals[v * 3], fine.normals[v * 3 + 1], fine.normals[v * 3 + 2]].map(Math.abs)
      expect(Math.max(...n)).toBeCloseTo(1, 6)
    }
    const values = readReference(scan, fine, { toScan: identityRigid(), reach: 5, facingDeg: 60 })
    for (const v of values) expect(Math.abs(v)).toBeLessThan(1e-4)
  })
})
