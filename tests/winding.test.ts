// SPDX-License-Identifier: AGPL-3.0-only
// The winding-number tree: 1 inside and 0 outside a closed surface, about
// 5/6 at the centre of a cube missing a face and ½ in its opening, the
// tree's value near the exact sum — within 1e-2 at β = 2, within 1e-3 at
// β = 4 — and how fast it answers.

import { describe, expect, it } from 'vitest'
import { WindingTree } from '../src/core/deviation/winding'

/** A box's twelve triangles, wound outward; `skip` leaves faces out
 *  (0 −x, 1 +x, 2 −y, 3 +y, 4 −z, 5 +z). */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip: number[] = []): { positions: Float32Array; indices: Uint32Array } {
  const quads: [number, number, number][][] = [
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
  ]
  const positions: number[] = []
  const indices: number[] = []
  quads.forEach((q, f) => {
    if (skip.includes(f)) return
    const base = positions.length / 3
    for (const v of q) positions.push(...v)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  })
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** A box with each face cut into n × n quads, so the tree has depth. */
function fineBox(n: number, size: number, skip: number[] = []): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  // Each face as an origin and two edge vectors, u × v outward.
  const s = size
  const faces: [number[], number[], number[]][] = [
    [[0, 0, 0], [0, 0, s], [0, s, 0]],
    [[s, 0, 0], [0, s, 0], [0, 0, s]],
    [[0, 0, 0], [s, 0, 0], [0, 0, s]],
    [[0, s, 0], [0, 0, s], [s, 0, 0]],
    [[0, 0, 0], [0, s, 0], [s, 0, 0]],
    [[0, 0, s], [s, 0, 0], [0, s, 0]],
  ]
  faces.forEach(([o, u, v], f) => {
    if (skip.includes(f)) return
    const base = positions.length / 3
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k < 3; k++) positions.push(o[k] + (u[k] * i) / n + (v[k] * j) / n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = base + i * (n + 1) + j, b = a + n + 1
        indices.push(a, b, b + 1, a, b + 1, a + 1)
      }
    }
  })
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** A UV sphere, wound outward. */
function sphere(radius: number, rings: number, segments: number): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings
    for (let j = 0; j < segments; j++) {
      const theta = (2 * Math.PI * j) / segments
      positions.push(radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi))
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j, b = i * segments + ((j + 1) % segments)
      const c = a + segments, d = b + segments
      if (i > 0) indices.push(a, c, b)
      if (i < rings - 1) indices.push(b, c, d)
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** A seeded generator, so a failure comes back the same. */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('the winding number', () => {
  it('is 1 inside a closed cube and a sphere and 0 outside, the tree near the exact sum', () => {
    // Each with its centre and which points lie clear inside and outside —
    // off the surface by more than the sphere's facets sag.
    const cases = [
      { mesh: fineBox(24, 10), centre: 5, inside: (p: number[]) => p.every((v) => v > 0.1 && v < 9.9), outside: (p: number[]) => p.some((v) => v < -0.1 || v > 10.1) },
      { mesh: sphere(5, 48, 96), centre: 0, inside: (p: number[]) => Math.hypot(...p) < 4.9, outside: (p: number[]) => Math.hypot(...p) > 5.1 },
    ]
    for (const { mesh, centre, inside, outside } of cases) {
      const tree = new WindingTree(mesh.positions, mesh.indices)
      const wide = new WindingTree(mesh.positions, mesh.indices, { beta: 4 })
      const rnd = random(7)
      for (let i = 0; i < 300; i++) {
        const p = [0, 0, 0].map(() => centre + (rnd() - 0.5) * 16)
        const exact = tree.exact(p[0], p[1], p[2])
        expect(Math.abs(tree.at(p[0], p[1], p[2]) - exact)).toBeLessThan(1e-2)
        expect(Math.abs(wide.at(p[0], p[1], p[2]) - exact)).toBeLessThan(1e-3)
        if (inside(p)) expect(exact).toBeCloseTo(1, 6)
        if (outside(p)) expect(exact).toBeCloseTo(0, 6)
      }
    }
  })

  it('reads a cube missing a face as about 5/6 at its centre and ½ in its opening', () => {
    const open = box(0, 0, 0, 10, 10, 10, [5])
    const tree = new WindingTree(open.positions, open.indices)
    expect(tree.at(5, 5, 5)).toBeCloseTo(5 / 6, 3)
    expect(tree.at(5, 5, 10)).toBeCloseTo(0.5, 3)
    // A soup reads the same as the mesh it was written out from.
    const soup = new Float32Array(open.indices.length * 3)
    open.indices.forEach((v, i) => soup.set(open.positions.subarray(v * 3, v * 3 + 3), i * 3))
    expect(new WindingTree(soup, null).at(5, 5, 5)).toBeCloseTo(5 / 6, 3)
  })

  it('stays near the brute-force sum on a random soup', () => {
    const rnd = random(11)
    const n = 4000
    const soup = new Float32Array(n * 9)
    for (let t = 0; t < n; t++) {
      // Small triangles scattered through a 20 mm box, at every angle.
      const cx = rnd() * 20, cy = rnd() * 20, cz = rnd() * 20
      for (let k = 0; k < 3; k++) {
        soup[t * 9 + k * 3] = cx + (rnd() - 0.5) * 2
        soup[t * 9 + k * 3 + 1] = cy + (rnd() - 0.5) * 2
        soup[t * 9 + k * 3 + 2] = cz + (rnd() - 0.5) * 2
      }
    }
    const tree = new WindingTree(soup, null)
    const wide = new WindingTree(soup, null, { beta: 4 })
    let worst = 0
    let worstWide = 0
    for (let i = 0; i < 1000; i++) {
      const x = rnd() * 24 - 2, y = rnd() * 24 - 2, z = rnd() * 24 - 2
      const exact = tree.exact(x, y, z)
      worst = Math.max(worst, Math.abs(tree.at(x, y, z) - exact))
      worstWide = Math.max(worstWide, Math.abs(wide.at(x, y, z) - exact))
    }
    expect(worst).toBeLessThan(1e-2)
    expect(worstWide).toBeLessThan(1e-3)
  })

  it('times queries on a million triangles', () => {
    const mesh = sphere(50, 500, 1000)
    const t0 = performance.now()
    const tree = new WindingTree(mesh.positions, mesh.indices)
    const built = performance.now() - t0
    const rnd = random(3)
    const n = 20000
    let near = 0
    const t1 = performance.now()
    for (let i = 0; i < n; i++) {
      // Half the points within a millimetre of the surface, where the tree
      // opens the most.
      const r = i % 2 ? 50 + (rnd() - 0.5) * 2 : rnd() * 80
      const u = rnd() * 2 - 1, phi = rnd() * 2 * Math.PI, s = Math.sqrt(1 - u * u)
      near += tree.at(r * s * Math.cos(phi), r * s * Math.sin(phi), r * u)
    }
    const ms = performance.now() - t1
    console.log(`winding: ${tree.triangleCount} triangles, built in ${built.toFixed(0)} ms, ${tree.bytes >> 20} MB, ${((n / ms) * 1000).toFixed(0)} queries/s, ${(tree.visits / n).toFixed(0)} nodes a query`)
    expect(Number.isFinite(near)).toBe(true)
  }, 60_000)
})
