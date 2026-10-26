// SPDX-License-Identifier: AGPL-3.0-only
// The deviation map on the reference: the reference cut finer with no
// cracks, a boss the scan lacks read proud on its own top, the face the
// scan never reached read as no scan, and the share the scan stands behind.

import { describe, expect, it } from 'vitest'
import { identityRigid } from '../src/core/deviation/rigid'
import { NominalSurface } from '../src/core/deviation/surface'
import { MAX_SAMPLE_TRIANGLES, meshArea, meshLongEdges, readReference, referenceCoverage, sampleSpacing, subdivideForMap, wantedSpacing } from '../src/core/deviation/onReference'

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

  it('makes a point two triangles share one vertex where they face alike, two across a sharp edge', () => {
    // The cube's faces as separate quads, as a kernel meshes face by face.
    const { positions, indices } = meshOf(Object.values(boxFaces(0, 0, 0, 10, 10, 10)))
    const fine = subdivideForMap(positions, indices, null, 1)
    const byPlace = new Map<string, number[]>()
    for (let v = 0; v < fine.positions.length / 3; v++) {
      const key = [0, 1, 2].map((k) => fine.positions[v * 3 + k].toFixed(4)).join(',')
      byPlace.set(key, [...(byPlace.get(key) ?? []), v])
    }
    let edges = 0
    for (const same of byPlace.values()) {
      // Never two vertices at one place facing the same way.
      for (let i = 0; i < same.length; i++)
        for (let j = i + 1; j < same.length; j++) {
          const dot = [0, 1, 2].reduce((s, k) => s + fine.normals[same[i] * 3 + k] * fine.normals[same[j] * 3 + k], 0)
          expect(dot).toBeLessThan(0.99)
        }
      if (same.length > 1) edges++
    }
    // The points on the cube's edges: one vertex for each face there.
    expect(edges).toBeGreaterThan(12 * 4)
    // A quad's two triangles share their diagonal's points: far fewer
    // vertices than three a triangle.
    expect(fine.positions.length / 3).toBeLessThan(fine.indices.length / 2)
  })

  it('welds alike far from the origin', () => {
    const near = meshOf(Object.values(boxFaces(0, 0, 0, 10, 10, 10)))
    const far = meshOf(Object.values(boxFaces(30_000, -30_000, 25_000, 30_010, -29_990, 25_010)))
    const a = subdivideForMap(near.positions, near.indices, null, 1)
    const b = subdivideForMap(far.positions, far.indices, null, 1)
    expect(b.positions.length).toBe(a.positions.length)
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices))
  })

  /** The longest edge of each triangle cut, over the spacing, the worst. */
  const longestOver = (fine: ReturnType<typeof subdivideForMap>) => {
    let worst = 0
    for (let t = 0; t < fine.indices.length; t += 3)
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const i = fine.indices[t + a], j = fine.indices[t + b]
        worst = Math.max(worst, Math.hypot(...[0, 1, 2].map((k) => fine.positions[i * 3 + k] - fine.positions[j * 3 + k])) / fine.spacing)
      }
    return worst
  }

  it('cuts a sliver by its longest edge into pieces about the spacing long, not a fan from its far corner', () => {
    // 30 × 0.05, the far corner near one end and in the middle; and a quad
    // 100 × 0.5 cut on its diagonal.
    for (const c of [29, 15]) {
      const fine = subdivideForMap(Float32Array.from([0, 0, 0, 30, 0, 0, c, 0.05, 0]), Uint32Array.from([0, 1, 2]), null, 0.5)
      expect(longestOver(fine), `corner at ${c}`).toBeLessThanOrEqual(1.5)
      expect(meshArea(fine.positions, fine.indices)).toBeCloseTo(0.75, 6)
      // A few triangles a spacing along it, not hundreds.
      expect(fine.indices.length / 3).toBeLessThan(4 * 60)
    }
    const { positions, indices } = meshOf([[[0, 0, 0], [100, 0, 0], [100, 0.5, 0], [0, 0.5, 0]]])
    const quad = subdivideForMap(positions, indices, null, 0.5)
    expect(longestOver(quad)).toBeLessThanOrEqual(1.5)
    expect(quad.indices.length / 3).toBeLessThan(2000)
  })

  it('cuts a fan of slivers from one corner of a face bounded by an arc as finely, with no fan of its own', () => {
    // A flat face between a chord and a quarter arc of R30, fanned from the
    // arc's end on the chord — as a kernel meshes it.
    const N = 96
    const R = 30
    const pos: number[] = []
    for (let k = 0; k <= N; k++) pos.push(R * Math.cos((k / N) * (Math.PI / 2)), R * Math.sin((k / N) * (Math.PI / 2)), 0)
    const idx: number[] = []
    for (let k = 1; k < N; k++) idx.push(0, k, k + 1)
    const positions = Float32Array.from(pos)
    const indices = Uint32Array.from(idx)
    const fine = subdivideForMap(positions, indices, null, 0.5)
    expect(longestOver(fine)).toBeLessThanOrEqual(1.5)
    expect(meshArea(fine.positions, fine.indices)).toBeCloseTo(meshArea(positions, indices), 3)
    // A sliver costs a few triangles a spacing of its length, not of its
    // area: here about four times the two a square spacing the area takes.
    expect(fine.indices.length / 3).toBeLessThan((5 * 2 * meshArea(positions, indices)) / 0.25)
    // What the spacing is opened by: two a square spacing of area and two a
    // spacing of each triangle's longest edge hold it.
    const s = 0.5
    expect(fine.indices.length / 3).toBeLessThanOrEqual((2 * meshArea(positions, indices)) / s ** 2 + (2 * meshLongEdges(positions, indices)) / s)
  })

  it('opens the spacing on a large reference, in steps a small edit does not cross', () => {
    expect(sampleSpacing(100, 0.5)).toBe(0.5)
    // √10 = 3.162…, opened to the next twentieth of a millimetre.
    expect(sampleSpacing(10_000_000, 0.5)).toBe(3.2)
    // A face moved, a hole added: the area a percent apart, the spacing the same.
    expect(sampleSpacing(10_100_000, 0.5)).toBe(3.2)
    expect(sampleSpacing(9_900_000, 0.5)).toBe(3.2)
    // Still under the triangle budget.
    expect((2 * 10_000_000) / sampleSpacing(10_000_000, 0.5) ** 2).toBeLessThanOrEqual(MAX_SAMPLE_TRIANGLES)
    // Slivers open it further: their long edges count too.
    const s = sampleSpacing(1_000_000, 0.5, 2_000_000)
    expect(s).toBeGreaterThan(sampleSpacing(1_000_000, 0.5))
    expect((2 * 1_000_000) / s ** 2 + (2 * 2_000_000) / s).toBeLessThanOrEqual(MAX_SAMPLE_TRIANGLES)
  })

  it('wants twice the tolerance, within a quarter and two millimetres', () => {
    expect(wantedSpacing(0.1)).toBe(0.25)
    expect(wantedSpacing(0.3)).toBe(0.6)
    expect(wantedSpacing(5)).toBe(2)
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

describe('a facing scan face further off than the nearest', () => {
  it('is found past the first look round the point, and read', () => {
    // The reference: a 30 × 10 mm plate's top, facing up. The scan: its top
    // 3 mm lower, facing up — and over a tenth of it a sheet 0.2 mm above,
    // facing down: nearest to the reference there, and no evidence of it.
    const ref = meshOf([[[0, 0, 0], [30, 0, 0], [30, 10, 0], [0, 10, 0]]])
    const scanMesh = meshOf([
      [[-1, -1, -3], [31, -1, -3], [31, 11, -3], [-1, 11, -3]],
      [[-1, -1, 0.2], [-1, 11, 0.2], [3, 11, 0.2], [3, -1, 0.2]],
    ])
    const scan = new NominalSurface(scanMesh.positions, scanMesh.indices)
    const fine = subdivideForMap(ref.positions, ref.indices, null, 0.5)
    const values = readReference(scan, fine, { toScan: identityRigid(), reach: 5, facingDeg: 60 })
    let under = 0
    for (let v = 0; v < values.length; v++) {
      const x = fine.positions[v * 3]
      if (x < 2.5) under++
      expect(values[v]).toBeCloseTo(3, 4)
    }
    expect(under).toBeGreaterThan(10)
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
