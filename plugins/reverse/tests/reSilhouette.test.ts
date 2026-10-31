// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { silhouetteSegments } from '../core/silhouette'
import { icosphere } from '../../../tests/helpers'

/** The wall of a cylinder about Z, radius `r`, with radial normals. */
function tube(r: number, length: number, around = 48, along = 6) {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (let j = 0; j <= along; j++) {
    for (let k = 0; k < around; k++) {
      const a = (k / around) * 2 * Math.PI
      positions.push(r * Math.cos(a), r * Math.sin(a), (j / along) * length)
      normals.push(Math.cos(a), Math.sin(a), 0)
    }
  }
  for (let j = 0; j < along; j++) {
    for (let k = 0; k < around; k++) {
      const a = j * around + k, b = j * around + ((k + 1) % around), c = a + around, d = b + around
      indices.push(a, b, d, a, d, c)
    }
  }
  return { positions, normals, indices, triangles: indices.length / 3 }
}

describe('the silhouette of a round face', () => {
  it('is the two lines down a cylinder’s sides, seen square to its axis', () => {
    const t = tube(10, 30)
    // Looked at along +X — turned a hair, so that no vertex sits dead on
    // the line: the sides are at y = ±10.
    const a = 0.01
    const seg = silhouetteSegments(t.positions, t.normals, t.indices, [[0, t.triangles]], { dir: [Math.cos(a), Math.sin(a), 0] })
    expect(seg.length % 6).toBe(0)
    expect(seg.length).toBeGreaterThan(0)
    let left = 0, right = 0
    for (let i = 0; i < seg.length; i += 3) {
      // On the cylinder to within the chord's sag, where the normal is square to the view.
      expect(Math.hypot(seg[i], seg[i + 1])).toBeGreaterThan(10 * Math.cos(Math.PI / 48) - 1e-6)
      expect(Math.abs(seg[i] * Math.cos(a) + seg[i + 1] * Math.sin(a))).toBeLessThan(0.05)
      if (seg[i + 1] > 0) left++
      else right++
    }
    expect(left).toBe(right)
    // Each side runs the cylinder's whole length.
    const zs = Array.from(seg).filter((_, i) => i % 3 === 2)
    expect(Math.min(...zs)).toBeCloseTo(0, 6)
    expect(Math.max(...zs)).toBeCloseTo(30, 6)
  })

  it('is nothing seen down the axis, and nothing of a flat face', () => {
    const t = tube(10, 30)
    expect(silhouetteSegments(t.positions, t.normals, t.indices, [[0, t.triangles]], { dir: [0, 0, 1] }).length).toBe(0)
    const flat = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }
    expect(silhouetteSegments(flat.positions, flat.normals, flat.indices, [[0, 1]], { dir: [1, 0, 0] }).length).toBe(0)
  })

  it('is a ball’s great circle square to the view — and from an eye close by, a smaller circle nearer to it', () => {
    const ball = icosphere(4, 10)
    const normals = Array.from(ball.positions, (v) => v / 10)
    const tris = ball.indices.length / 3
    const dir: [number, number, number] = [0.3, -0.5, 0.81]
    const l = Math.hypot(...dir)
    const seg = silhouetteSegments(ball.positions, normals, ball.indices, [[0, tris]], { dir: [dir[0] / l, dir[1] / l, dir[2] / l] })
    expect(seg.length).toBeGreaterThan(60)
    for (let i = 0; i < seg.length; i += 3) {
      expect(Math.hypot(seg[i], seg[i + 1], seg[i + 2])).toBeGreaterThan(9.9)
      expect(Math.abs((seg[i] * dir[0] + seg[i + 1] * dir[1] + seg[i + 2] * dir[2]) / l)).toBeLessThan(0.05)
    }
    // From an eye 25 mm out along Z the rim is the circle of tangency: at
    // z = R²/d = 4, not at the equator.
    const near = silhouetteSegments(ball.positions, normals, ball.indices, [[0, tris]], { eye: [0, 0, 25] })
    for (let i = 0; i < near.length; i += 3) expect(near[i + 2]).toBeCloseTo(4, 0)
  })
})
