// SPDX-License-Identifier: AGPL-3.0-only
// Shrink / expand and Shell: the surface moved along its normal, a closed
// part hollowed, an open surface thickened into a solid.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { NominalSurface, emptyHit } from '../../../src/core/deviation/surface'
import { closedness } from '../core/boolean'
import { defaultWallThickness, hollowMesh, signedVolume } from '../core/hollow'
import { offsetMesh, thickenMesh } from '../core/offset'
import { loadSimplifier } from '../core/reduce'
import { withoutTriangles } from '../core/pieces'
import type { MeshGraph } from '../../../src/core/types'
import { boxMesh, icosphere } from '../../../tests/helpers'
import { lBracket } from './scanLike'

// Kernel builds and real-scan fits run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

let simplifier: Awaited<ReturnType<typeof loadSimplifier>>
beforeAll(async () => {
  simplifier = await loadSimplifier()
})

const box = (size = 10, grid = 4, noise = 0): MeshGraph => buildMeshGraph({ kind: 'soup', positions: boxMesh(size, grid, noise) })
const ball = (subdivisions = 4, radius = 10) => {
  const s = icosphere(subdivisions, radius)
  return { ...s, vertexCount: s.positions.length / 3 }
}

interface Mesh { positions: Float32Array; indices: Uint32Array; vertexCount?: number }

function bounds(m: Mesh) {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < m.indices.length; i++) {
    for (let k = 0; k < 3; k++) {
      const x = m.positions[m.indices[i] * 3 + k]
      lo[k] = Math.min(lo[k], x)
      hi[k] = Math.max(hi[k], x)
    }
  }
  return { lo, hi }
}

const shut = (m: Mesh) => closedness(m.indices, m.positions.length / 3)

/** Triangles of `after` turned over against the same triangle of `before`. */
function turnedOver(before: Mesh, after: Mesh, count = before.indices.length / 3): number {
  const normal = (m: Mesh, t: number) => {
    const p = m.positions
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  }
  let n = 0
  for (let t = 0; t < count; t++) {
    const x = normal(before, t)
    const y = normal(after, t)
    if (x[0] * y[0] + x[1] * y[1] + x[2] * y[2] <= 0) n++
  }
  return n
}

/** Triangles thinner than a fiftieth of their longest edge. */
function slivers(m: Mesh): number {
  const p = m.positions
  let n = 0
  for (let t = 0; t < m.indices.length / 3; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const twice = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    const longest = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (p[c] - p[b]) ** 2 + (p[c + 1] - p[b + 1]) ** 2 + (p[c + 2] - p[b + 2]) ** 2)
    if (twice < 0.02 * longest) n++
  }
  return n
}

/** Triangles turned against the mean of their neighbours across their
 *  edges — a fold, a speck in the shading. */
function folds(m: Mesh): number {
  const p = m.positions
  const tri = m.indices.length / 3
  const normal = new Float64Array(tri * 3)
  for (let t = 0; t < tri; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    normal[t * 3] = nx / l
    normal[t * 3 + 1] = ny / l
    normal[t * 3 + 2] = nz / l
  }
  const byEdge = new Map<number, number[]>()
  const key = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a)
  for (let t = 0; t < tri; t++) {
    for (let k = 0; k < 3; k++) {
      const e = key(m.indices[t * 3 + k], m.indices[t * 3 + ((k + 1) % 3)])
      const list = byEdge.get(e) ?? []
      list.push(t)
      byEdge.set(e, list)
    }
  }
  let n = 0
  for (let t = 0; t < tri; t++) {
    let sx = 0, sy = 0, sz = 0
    for (let k = 0; k < 3; k++) {
      for (const u of byEdge.get(key(m.indices[t * 3 + k], m.indices[t * 3 + ((k + 1) % 3)])) ?? []) {
        if (u === t) continue
        sx += normal[u * 3]
        sy += normal[u * 3 + 1]
        sz += normal[u * 3 + 2]
      }
    }
    if (normal[t * 3] * sx + normal[t * 3 + 1] * sy + normal[t * 3 + 2] * sz < 0) n++
  }
  return n
}

/** The vertices of a mesh where `pick` says so. */
function pickVertices(g: MeshGraph, pick: (x: number, y: number, z: number) => boolean): Uint32Array {
  const out: number[] = []
  for (let v = 0; v < g.vertexCount; v++) if (pick(g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2])) out.push(v)
  return Uint32Array.from(out)
}

/** A flat square sheet in the XY plane, facing up: `size` across, `grid`
 *  squares a side. */
function sheet(size = 10, grid = 10): Mesh & { vertexCount: number } {
  const pos: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= grid; j++) for (let i = 0; i <= grid; i++) pos.push((i / grid) * size, (j / grid) * size, 0)
  const at = (i: number, j: number) => j * (grid + 1) + i
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1))
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), vertexCount: pos.length / 3 }
}

describe('Shrink / expand', () => {
  it('moves every face of a box the distance out, edges and corners sharp — not a scale', () => {
    const g = box(10, 4)
    const out = offsetMesh(g.positions, g.indices, g.vertexCount, { distance: 0.5 })
    const { lo, hi } = bounds(out)
    for (let k = 0; k < 3; k++) {
      expect(lo[k]).toBeCloseTo(-5.5, 4)
      expect(hi[k]).toBeCloseTo(5.5, 4)
    }
    expect(signedVolume(out.positions, out.indices)).toBeCloseTo(11 ** 3, 2)
    expect(shut(out)).toEqual({ open: 0, bad: 0 })
    // The same vertices and triangles, each where it was moved to.
    expect(out.indices.length).toBe(g.indices.length)
    expect(Array.from(out.vertexMap)).toEqual(Array.from({ length: g.vertexCount }, (_, v) => v))
    // A corner goes √3 times the distance, square to none of its faces.
    expect(out.report.maxMove).toBeCloseTo(0.5 * Math.sqrt(3), 4)
    expect(out.report.moved).toBe(g.vertexCount)
    expect(out.report.relaxed).toBe(0)

    const shrunk = offsetMesh(g.positions, g.indices, g.vertexCount, { distance: -0.5 })
    expect(signedVolume(shrunk.positions, shrunk.indices)).toBeCloseTo(9 ** 3, 2)
    expect(bounds(shrunk).hi[2]).toBeCloseTo(4.5, 4)
  })

  it('grows a ball by the distance on its radius', () => {
    const b = ball(4, 10)
    for (const d of [0.5, -0.5]) {
      const out = offsetMesh(b.positions, b.indices, b.vertexCount, { distance: d })
      for (let v = 0; v < out.positions.length / 3; v++) {
        const r = Math.hypot(out.positions[v * 3], out.positions[v * 3 + 1], out.positions[v * 3 + 2])
        expect(Math.abs(r - (10 + d))).toBeLessThan(0.01)
      }
    }
  })

  it('moves a noisy scan without turning a triangle over', () => {
    const g = box(10, 30, 0.02)
    for (const d of [0.2, -0.2]) {
      const out = offsetMesh(g.positions, g.indices, g.vertexCount, { distance: d })
      expect(turnedOver(g, out)).toBe(0)
      expect(shut(out)).toEqual({ open: 0, bad: 0 })
      expect(signedVolume(out.positions, out.indices) / (10 + 2 * d) ** 3).toBeCloseTo(1, 2)
    }
  })

  it('does not fold a bump shrunk past its own curvature through itself', () => {
    // A smooth bump 0.3 mm high on a sheet, 0.4 mm round at its top: shrunk
    // by a millimetre along each point's own normal, the surface under it
    // would cross itself. Its normals are read over about as far as the
    // move goes, so it comes down whole.
    const s = sheet(4, 40)
    const bumped = s.positions.slice()
    for (let v = 0; v < s.vertexCount; v++) {
      const x = bumped[v * 3] - 2, y = bumped[v * 3 + 1] - 2
      bumped[v * 3 + 2] = 0.3 * Math.exp(-(x * x + y * y) / 0.25)
    }
    const before = { positions: bumped, indices: s.indices }
    const out = offsetMesh(bumped, s.indices, s.vertexCount, { distance: -1 })
    expect(turnedOver(before, out)).toBe(0)
    // The sheet round it the distance down.
    expect(out.positions[2]).toBeCloseTo(-1, 3)
  })

  it('pushes a face marked up to its edges out or in, the faces beside it stretched or shortened along', () => {
    const g = box(10, 10)
    const top = pickVertices(g, (_x, _y, z) => z > 5 - 1e-6)
    for (const d of [0.5, -0.5, -1.5]) {
      const out = offsetMesh(g.positions, g.indices, g.vertexCount, { distance: d, region: top })
      const { lo, hi } = bounds(out)
      expect(hi[2]).toBeCloseTo(5 + d, 4)
      expect(lo[2]).toBeCloseTo(-5, 5)
      expect(lo[0]).toBeCloseTo(-5, 5)
      expect(hi[0]).toBeCloseTo(5, 5)
      expect(signedVolume(out.positions, out.indices)).toBeCloseTo(100 * (10 + d), 2)
      expect(shut(out)).toEqual({ open: 0, bad: 0 })
      // A push further than the side's triangles are tall still turns none
      // of them over: the band beside the rim is squeezed, not crossed.
      expect(turnedOver(g, out)).toBe(0)
      expect(out.report.slid).toBeGreaterThan(0)
      expect(out.report.stepped).toBe(0)
      expect(out.report.wall).toBe(0)
      expect(out.report.region).toBe(top.length)
    }
  })

  it('steps a patch marked in the middle of a face, joined to the face by a wall', () => {
    const g = box(10, 10)
    const patch = pickVertices(g, (x, y, z) => z > 5 - 1e-6 && Math.abs(x) <= 2 + 1e-6 && Math.abs(y) <= 2 + 1e-6)
    for (const d of [0.3, -0.3]) {
      const out = offsetMesh(g.positions, g.indices, g.vertexCount, { distance: d, region: patch })
      expect(shut(out)).toEqual({ open: 0, bad: 0 })
      // A 4 × 4 mm patch, raised or sunk.
      expect(signedVolume(out.positions, out.indices)).toBeCloseTo(1000 + 16 * d, 2)
      expect(bounds(out).hi[2]).toBeCloseTo(Math.max(5, 5 + d), 4)
      expect(out.report.stepped).toBe(16)
      expect(out.report.slid).toBe(0)
      expect(out.report.wall).toBe(32)
      // The rim stays with the face around it, its copy moves: the scan's
      // own numbering carries the rim to where it was.
      for (const v of patch) {
        const w = out.vertexMap[v]
        expect(w).toBeGreaterThanOrEqual(0)
        const onRim = Math.abs(Math.abs(g.positions[v * 3]) - 2) < 1e-6 || Math.abs(Math.abs(g.positions[v * 3 + 1]) - 2) < 1e-6
        expect(out.positions[w * 3 + 2]).toBeCloseTo(onRim ? 5 : 5 + d, 5)
      }
    }
  })

  it('refuses a distance of zero, and a region with no triangle marked all round', () => {
    const g = box(10, 4)
    expect(() => offsetMesh(g.positions, g.indices, g.vertexCount, { distance: 0 })).toThrow(/zero/)
    expect(() => offsetMesh(g.positions, g.indices, g.vertexCount, { distance: 1, region: new Uint32Array([0]) })).toThrow(/marked/)
    expect(() => offsetMesh(g.positions, g.indices, g.vertexCount, { distance: 1, region: new Uint32Array(0) })).toThrow(/marked/)
  })
})

describe('Shell on an open surface: thickened into a solid', () => {
  it('thickens a sheet inward, outward or to both sides into a closed slab', () => {
    const s = sheet(10, 10)
    const ways = { in: [-1, 0], out: [0, 1], both: [-0.5, 0.5] } as const
    for (const side of ['in', 'out', 'both'] as const) {
      const out = thickenMesh(s.positions, s.indices, s.vertexCount, 1, side)
      expect(shut(out)).toEqual({ open: 0, bad: 0 })
      expect(signedVolume(out.positions, out.indices)).toBeCloseTo(100, 3)
      const { lo, hi } = bounds(out)
      expect(lo[2]).toBeCloseTo(ways[side][0], 5)
      expect(hi[2]).toBeCloseTo(ways[side][1], 5)
      expect(lo[0]).toBeCloseTo(0, 5)
      expect(hi[0]).toBeCloseTo(10, 5)
      expect(out.report.rimEdges).toBe(40)
      expect(out.report.triangles).toBe(200 + 80)
      // The skin left where the surface was keeps its numbers.
      if (side !== 'both') {
        for (let v = 0; v < s.vertexCount; v++) {
          const w = out.vertexMap[v]
          expect(out.positions[w * 3 + 2]).toBe(0)
        }
      }
    }
  })

  it('thickens an open box inward into a cup with walls the thickness all round', () => {
    const g = box(10, 4)
    const mask = new Uint8Array(g.triangleCount)
    for (let t = 0; t < g.triangleCount; t++) {
      let z = 0
      for (let k = 0; k < 3; k++) z += g.positions[g.indices[t * 3 + k] * 3 + 2] / 3
      mask[t] = z > 5 - 1e-6 ? 1 : 0
    }
    const cup = withoutTriangles(g.positions, g.indices, g.vertexCount, mask)
    const n = cup.positions.length / 3
    const out = thickenMesh(cup.positions, cup.indices, n, 0.5, 'in')
    expect(shut(out)).toEqual({ open: 0, bad: 0 })
    expect(signedVolume(out.positions, out.indices)).toBeCloseTo(1000 - 9 * 9 * 9.5, 2)
  })

  it('closes the strip beside each edge up into the inner edge, a wall thicker than the triangles are wide', () => {
    // Triangles a quarter of a millimetre across, a wall a millimetre thick:
    // beside every edge of the cup a strip of the inner skin four triangles
    // wide has nowhere to go but into the edge.
    const g = box(10, 40)
    const mask = new Uint8Array(g.triangleCount)
    for (let t = 0; t < g.triangleCount; t++) {
      let z = 0
      for (let k = 0; k < 3; k++) z += g.positions[g.indices[t * 3 + k] * 3 + 2] / 3
      mask[t] = z > 5 - 1e-6 ? 1 : 0
    }
    const cup = withoutTriangles(g.positions, g.indices, g.vertexCount, mask)
    const n = cup.positions.length / 3
    let built = 0
    const surface = () => {
      built++
      return new NominalSurface(cup.positions, cup.indices)
    }
    const out = thickenMesh(cup.positions, cup.indices, n, 1, 'in', undefined, surface)
    expect(built).toBe(1)
    expect(shut(out)).toEqual({ open: 0, bad: 0 })
    expect(Math.abs(signedVolume(out.positions, out.indices) - (1000 - 8 * 8 * 9))).toBeLessThan(0.5)
    // The inner skin ends a millimetre in from every wall, its edges sharp —
    // the strips closed up into them, merged away rather than left as
    // slivers along the edge.
    const inner = { positions: out.positions, indices: out.indices.subarray(cup.indices.length, out.indices.length - out.report.rimEdges * 6) }
    const { lo, hi } = bounds(inner)
    expect(lo[0]).toBeCloseTo(-4, 4)
    expect(hi[1]).toBeCloseTo(4, 4)
    expect(lo[2]).toBeCloseTo(-4, 4)
    expect(out.report.merged).toBeGreaterThan(1000)
    expect(slivers(inner)).toBeLessThan(inner.indices.length / 3 / 100)
    // Only the turned triangles' points were moved back, none eased.
    expect(out.report.relaxed).toBe(0)
    // A move that folds nothing never builds the search.
    built = 0
    thickenMesh(cup.positions, cup.indices, n, 0.1, 'in', undefined, surface)
    expect(built).toBe(0)
  })
})

describe('a scan thickened, then expanded', () => {
  // One side of a bracket as a scanner sees it: uneven triangles, scatter,
  // a spike one point in two hundred, a ragged border, a hole — as scanned
  // at 0.3 mm, and finer and twice as noisy.
  it.each([
    { name: 'a 0.3 mm scan', scan: () => lBracket() },
    { name: 'a 0.15 mm scan, twice the scatter', scan: () => lBracket({ size: 20, step: 0.15, noise: 0.04 }) },
  ])('leaves no fold in the second skin, and no dimple in it expanded — $name', ({ scan: make }) => {
    const scan = make()
    expect(folds({ positions: scan.positions, indices: scan.indices })).toBe(0)
    const scanSurface = new NominalSurface(scan.positions, scan.indices)
    const thick = thickenMesh(scan.positions, scan.indices, scan.vertexCount, 2, 'in', undefined, () => scanSurface)
    expect(shut(thick)).toEqual({ open: 0, bad: 0 })
    const back = { positions: thick.positions, indices: thick.indices.subarray(scan.indices.length, thick.indices.length - thick.report.rimEdges * 6) }
    const triangles = back.indices.length / 3
    // A triangle turned over is a speck in the shading, and its corners a
    // point the next move leaves behind — a dimple. A spike of the scan is
    // not copied in as a pit: the second skin keeps the thickness from it.
    expect(folds(back)).toBeLessThan(triangles / 20000)
    expect(slivers(back)).toBeLessThan(triangles / 500)

    const n = thick.positions.length / 3
    const thickSurface = new NominalSurface(thick.positions, thick.indices)
    const grown = offsetMesh(thick.positions, thick.indices, n, { distance: 0.5 }, undefined, () => thickSurface)
    expect(shut(grown)).toEqual({ open: 0, bad: 0 })
    const hit = emptyHit()
    let least = Infinity
    for (let v = 0; v < n; v++) {
      const w = grown.vertexMap[v]
      if (w < 0) continue
      thickSurface.closest(grown.positions[w * 3], grown.positions[w * 3 + 1], grown.positions[w * 3 + 2], hit)
      least = Math.min(least, hit.distance)
    }
    // Every point out by the distance; none left behind in a dimple. Beside
    // a spike — 0.1 mm — the distance is kept from its tip.
    expect(least).toBeGreaterThan(0.39)
  })
})

describe('Shell on a closed part: hollowed', () => {
  it('starts the wall at a hundred-and-twenty-fifth of the part, on the 1-2-5 steps', () => {
    expect(defaultWallThickness(250)).toBe(2)
    expect(defaultWallThickness(60)).toBe(0.5)
  })

  it('hollows a ball: the outside as it was, a sealed cavity the wall in from it', () => {
    const b = ball(4, 10)
    const surface = new NominalSurface(b.positions, b.indices)
    const out = hollowMesh(b.positions, b.indices, b.vertexCount, 2, surface, simplifier)
    expect(shut(out)).toEqual({ open: 0, bad: 0 })
    expect(out.report.cavities).toBe(1)
    const cavity = (4 / 3) * Math.PI * 8 ** 3
    expect(out.report.removed / cavity).toBeCloseTo(1, 1)
    expect(Math.abs(out.report.removed / cavity - 1)).toBeLessThan(0.03)
    expect(signedVolume(out.positions, out.indices)).toBeCloseTo(out.report.volumeBefore - out.report.removed, 3)
    // The outside untouched, every vertex where it was.
    for (let v = 0; v < b.vertexCount; v++) {
      const w = out.vertexMap[v]
      expect(w).toBe(v)
      expect(out.positions[w * 3]).toBe(b.positions[v * 3])
    }
    // The inner wall the thickness in, and far lighter than a grid's worth.
    for (let v = b.vertexCount; v < out.positions.length / 3; v++) {
      const r = Math.hypot(out.positions[v * 3], out.positions[v * 3 + 1], out.positions[v * 3 + 2])
      expect(Math.abs(r - 8)).toBeLessThan(0.15)
    }
    expect(out.report.triangles).toBeLessThan(20_000)
  })

  it('hollows a box into a box, its wall the thickness all round, without the reducer too', () => {
    const g = box(20, 8)
    const surface = new NominalSurface(g.positions, g.indices)
    const out = hollowMesh(g.positions, g.indices, g.vertexCount, 2, surface, null)
    expect(shut(out)).toEqual({ open: 0, bad: 0 })
    expect(out.report.cavities).toBe(1)
    expect(Math.abs(out.report.removed / 16 ** 3 - 1)).toBeLessThan(0.03)
    const inner = { positions: out.positions, indices: out.indices.subarray(g.indices.length) }
    const { lo, hi } = bounds(inner)
    for (let k = 0; k < 3; k++) {
      expect(lo[k]).toBeGreaterThan(-8.1)
      expect(hi[k]).toBeLessThan(8.1)
      expect(hi[k]).toBeGreaterThan(7.7)
    }
  })

  it('leaves a part thinner than twice the wall solid, and refuses one with holes', () => {
    const g = box(3, 4)
    const surface = new NominalSurface(g.positions, g.indices)
    expect(() => hollowMesh(g.positions, g.indices, g.vertexCount, 2, surface, null)).toThrow(/Nothing to hollow/)
    const s = sheet()
    expect(() => hollowMesh(s.positions, s.indices, s.vertexCount, 1, new NominalSurface(s.positions, s.indices), null)).toThrow(/not closed/)
  })
})
