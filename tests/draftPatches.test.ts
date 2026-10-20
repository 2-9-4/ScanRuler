// SPDX-License-Identifier: AGPL-3.0-only
// Draft read off a scan against a pull: a block whose four sides lean 1°
// in towards the top reads four walls at +1° along +Z — and −1° against
// −Z — one wall leaning back reads its back draft, and the top and the
// bottom, square to the pull, are no walls.

import { describe, expect, it } from 'vitest'
import { draftPatches } from '../src/core/fit/draft'
import type { Vec3 } from '../src/core/types'

/** Points every 0.5 mm on the sides of a 40 × 40 × 20 block, each side
 *  leaning `leanDeg` in towards the top (one side `oddDeg`), with its
 *  normal turned by up to a degree of noise; and its top and bottom. */
function block(leanDeg: number, oddDeg = leanDeg): { positions: Float32Array; normals: Float32Array } {
  let s = 17
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  const pos: number[] = []
  const nor: number[] = []
  const sides: [Vec3, Vec3][] = [
    [[1, 0, 0], [0, 1, 0]],
    [[-1, 0, 0], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0]],
  ]
  sides.forEach(([out, along], k) => {
    const t = (((k === 0 ? oddDeg : leanDeg) * Math.PI) / 180)
    for (let a = -19; a <= 19; a += 0.5) {
      for (let z = 0.5; z < 20; z += 0.5) {
        const inset = z * Math.tan(t)
        const p = [0, 1, 2].map((i) => out[i] * (20 - inset) + along[i] * a + (i === 2 ? z : 0))
        const n = [out[0] * Math.cos(t), out[1] * Math.cos(t), Math.sin(t)]
        const j = (0.5 * Math.PI) / 180
        pos.push(...p)
        nor.push(n[0] + j * rnd(), n[1] + j * rnd(), n[2] + j * rnd())
      }
    }
  })
  for (let x = -19; x <= 19; x += 1) {
    for (let y = -19; y <= 19; y += 1) {
      pos.push(x, y, 0, x, y, 20)
      nor.push(0, 0, -1, 0, 0, 1)
    }
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nor) }
}

describe('draft against a pull', () => {
  it('reads four walls leaning 1° along +Z, and the top and bottom as none', () => {
    const { positions, normals } = block(1)
    const r = draftPatches(positions, normals, [0, 0, 1])
    expect(r.patches).toHaveLength(4)
    for (const p of r.patches) {
      expect(p.draftDeg).toBeCloseTo(1, 1)
      expect(p.sigmaDeg).toBeLessThan(0.05)
      expect(p.area).toBeGreaterThan(500)
      expect(Math.abs(p.facing[2])).toBeLessThan(1e-6)
    }
    expect(r.walls).toBeLessThan(r.points)
  })

  it('reads the same walls against −Z as back drafts', () => {
    const { positions, normals } = block(1)
    for (const p of draftPatches(positions, normals, [0, 0, -2]).patches) expect(p.draftDeg).toBeCloseTo(-1, 1)
  })

  it('tells the one wall that leans back', () => {
    const { positions, normals } = block(1, -0.5)
    const r = draftPatches(positions, normals, [0, 0, 1])
    const back = r.patches.find((p) => p.facing[0] > 0.9)!
    expect(back.draftDeg).toBeCloseTo(-0.5, 1)
    expect(r.patches.filter((p) => p.draftDeg > 0.8)).toHaveLength(3)
  })
})
