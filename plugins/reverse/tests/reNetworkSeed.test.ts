// SPDX-License-Identifier: AGPL-3.0-only
// Where a patch placed by its corners is filled: its seed well inside the
// loop — the middle of a square, the bar of a U and not its notch, the
// outer skin of a shell and not the inner wall nearer the loop's plane,
// the middle of a strip round 270° of a cylinder. And the corners a patch
// was placed with are its corners, whatever the boundary turns there.

import { describe, expect, it } from 'vitest'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import { readNetwork } from '../core/network'
import { seedInside } from '../core/networkSeed'
import { gridScan, network, sphereScan } from './networkMeshes'

/** A closed loop through corners, a point every half millimetre along
 *  each straight side. */
function loop(corners: readonly Vec3[]): number[] {
  const out: number[] = []
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % corners.length]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.5))
    for (let k = 0; k < n; k++) out.push(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n)
  }
  return out
}

function insidePolygon(poly: readonly [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

describe('a patch’s seed', () => {
  const sheet = gridScan(100, 100, (u, v) => [100 * u, 100 * v, 0], { noise: 0.01 })
  const flat = new ScanPaths(sheet.positions, sheet.indices)

  it('lies in the middle of a square', () => {
    const seed = seedInside(flat, loop([[20, 20, 0], [60, 20, 0], [60, 60, 0], [20, 60, 0]]))!
    expect(Math.hypot(seed[0] - 40, seed[1] - 40)).toBeLessThan(2)
    expect(Math.abs(seed[2])).toBeLessThan(0.1)
  })

  it('lies in a U’s bar or arms, not in its notch, where its centroid is', () => {
    const u: [number, number][] = [[20, 20], [80, 20], [80, 80], [60, 80], [60, 40], [40, 40], [40, 80], [20, 80]]
    const seed = seedInside(flat, loop(u.map(([x, y]) => [x, y, 0] as Vec3)))!
    expect(insidePolygon(u, seed[0], seed[1])).toBe(true)
    // Ten millimetres off every side: the bar and the arms are twenty wide.
    expect(Math.min(seed[0] - 20, 80 - seed[0], seed[1] - 20)).toBeGreaterThan(5)
  })

  it('lies on a shell’s outer skin, not on the inner wall its loop’s plane is under', () => {
    // A shell 1.5 mm thick: the outer sphere's normals out, the inner one's
    // in, to the hollow. A loop 30° round the outer one's +x pole has its
    // middle 5.4 mm in, under the inner wall.
    const outer = sphereScan(40, 0.01, 5)
    const inner = sphereScan(38.5, 0.01, 5)
    const flipped = Uint32Array.from(inner.indices)
    for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]]
    const positions = new Float32Array(outer.positions.length + inner.positions.length)
    positions.set(outer.positions, 0)
    positions.set(inner.positions, outer.positions.length)
    const offset = outer.positions.length / 3
    const indices = new Uint32Array(outer.indices.length + flipped.length)
    indices.set(outer.indices, 0)
    indices.set(flipped.map((i) => i + offset), outer.indices.length)
    const shell = new ScanPaths(positions, indices)
    const ring: number[] = []
    for (let k = 0; k < 360; k++) {
      const t = (k * Math.PI) / 180
      ring.push(40 * Math.cos(Math.PI / 6), 40 * Math.sin(Math.PI / 6) * Math.cos(t), 40 * Math.sin(Math.PI / 6) * Math.sin(t))
    }
    const seed = seedInside(shell, ring)!
    expect(Math.abs(Math.hypot(...seed) - 40)).toBeLessThan(0.1)
    expect(seed[0]).toBeGreaterThan(39)
  })

  it('lies in the middle of a strip round 270° of a cylinder, which folds over seen along any one way', () => {
    const r = 20
    const m = gridScan(180, 40, (u, v) => [r * Math.cos(2 * Math.PI * u), r * Math.sin(2 * Math.PI * u), 40 * v], { wrap: true, noise: 0.01 })
    const scan = new ScanPaths(m.positions, m.indices)
    const on = (deg: number, z: number): Vec3 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z]
    const out: number[] = []
    for (let a = 0; a < 270; a += 2) out.push(...on(a, 5))
    for (let z = 5; z < 35; z += 0.5) out.push(...on(270, z))
    for (let a = 270; a > 0; a -= 2) out.push(...on(a, 35))
    for (let z = 35; z > 5; z -= 0.5) out.push(...on(0, z))
    const seed = seedInside(scan, out)!
    const angle = (Math.atan2(seed[1], seed[0]) * 180) / Math.PI
    const deg = angle < 0 ? angle + 360 : angle
    expect(Math.abs(Math.hypot(seed[0], seed[1]) - r)).toBeLessThan(0.1)
    expect(deg).toBeGreaterThan(5)
    expect(deg).toBeLessThan(265)
    expect(seed[2]).toBeGreaterThan(7)
    expect(seed[2]).toBeLessThan(33)
  })
})

describe('the corners a patch was placed with', () => {
  it('are its corners: a node on a straight side one, a square corner none', () => {
    const m = gridScan(100, 100, (u, v) => [100 * u, 100 * v, 0], { noise: 0.01 })
    const scan = new ScanPaths(m.positions, m.indices)
    // A square with a node in its bottom side's middle (5): by the rule its
    // corners are 1, 2, 3 and 4. Placed with 1, 5, 3 and 4 for its corners,
    // they are those — 2 is a bend in the side from 5 to 3.
    const f = network(1, { 1: [20, 20, 0], 5: [40, 20, 0], 2: [60, 20, 0], 3: [60, 60, 0], 4: [20, 60, 0] }, [
      { from: 1, to: 5 },
      { from: 5, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
      { from: 4, to: 1 },
    ], [[40, 40, 0]])
    const byRule = readNetwork(scan, f)
    expect(byRule.fit!.patches[0].corners.slice().sort()).toEqual([1, 2, 3, 4])
    f.cells[0].corners = [1, 5, 3, 4]
    const placed = readNetwork(scan, f)
    expect(placed.outcomes[0]).toMatchObject({ sides: 4 })
    expect(placed.fit!.patches[0].corners.slice().sort()).toEqual([1, 3, 4, 5])
    expect(placed.fit!.patches[0].rms).toBeLessThan(0.02)
  })
})
