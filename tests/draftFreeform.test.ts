// SPDX-License-Identifier: AGPL-3.0-only
// Draft on a smooth freeform wall: a U-shaped wall in plan, symmetric about
// x = 0, turning 136° from one end to the other with no corner. Grown
// neighbour to neighbour it is one wall; each patch joins only points that
// face within 20° of its running mean, so none turns more than 40°. Split on
// the mirror plane, no patch reaches across it, and the two halves read
// alike. A round boss on the plane stays one patch.

import { describe, expect, it } from 'vitest'
import { draftPatches } from '../src/core/fit/draft'

const DRAFT_DEG = 2
const HEIGHT = 20

/** Points on the wall y = x²/40, x from −50 to 50, every 0.25 mm along it
 *  and up it, each leaning DRAFT_DEG in towards the top (+Z), its normal
 *  facing out of the U (−y at the bottom) with a little noise; and a boss of
 *  radius 10 about (0, 80). */
function uWall(): { positions: Float32Array; normals: Float32Array } {
  let s = 41
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  const t = (DRAFT_DEG * Math.PI) / 180
  const j = (0.3 * Math.PI) / 180
  const pos: number[] = []
  const nor: number[] = []
  const outline: { p: [number, number]; f: [number, number] }[] = []
  for (let x = -50; x <= 50; ) {
    const slope = x / 20
    const l = Math.hypot(slope, 1)
    outline.push({ p: [x, (x * x) / 40], f: [slope / l, -1 / l] })
    x += 0.25 / l
  }
  for (let q = 0; q < 2 * Math.PI; q += 0.025) outline.push({ p: [10 * Math.cos(q), 80 + 10 * Math.sin(q)], f: [Math.cos(q), Math.sin(q)] })
  for (let z = 0.125; z < HEIGHT; z += 0.25) {
    const inset = (z - HEIGHT / 2) * Math.tan(t)
    for (const { p, f } of outline) {
      pos.push(p[0] - f[0] * inset, p[1] - f[1] * inset, z)
      nor.push(f[0] * Math.cos(t) + j * rnd(), f[1] * Math.cos(t) + j * rnd(), Math.sin(t) + j * rnd())
    }
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nor) }
}

describe('draft on a smooth freeform wall', () => {
  const { positions, normals } = uWall()
  const onWall = (p: { centroid: number[] }) => p.centroid[1] < 70

  it('parts the U into patches that each turn 40° at most', () => {
    const r = draftPatches(positions, normals, [0, 0, 1], { limit: 50, minArea: 20 })
    const walls = r.patches.filter(onWall)
    expect(walls.length).toBeGreaterThanOrEqual(4)
    for (const p of walls) {
      expect(p.turnDeg).toBeLessThanOrEqual(40)
      expect(p.draftDeg).toBeCloseTo(DRAFT_DEG, 0)
      expect(p.round).toBeUndefined()
    }
  })

  it('split on the mirror plane, gives left and right patches apart, alike, each 40° at most', () => {
    const r = draftPatches(positions, normals, [0, 0, 1], { limit: 50, minArea: 20, split: { point: [0, 0, 0], normal: [2, 0, 0] } })
    expect(r.split?.normal).toEqual([1, 0, 0])
    const walls = r.patches.filter(onWall)
    for (const p of walls) {
      // One side or the other, by more than the point spacing.
      expect(p.min[0] > -0.3 || p.max[0] < 0.3).toBe(true)
      expect(p.side).toBe(p.centroid[0] > 0 ? 1 : -1)
      expect(p.turnDeg).toBeLessThanOrEqual(40)
      expect(p.draftDeg).toBeCloseTo(DRAFT_DEG, 0)
    }
    const left = walls.filter((p) => p.side === -1)
    const right = walls.filter((p) => p.side === 1)
    expect(left.length).toBeGreaterThanOrEqual(2)
    expect(right.length).toBe(left.length)
    // The halves mirror each other: the largest patch on each side too.
    expect(Math.abs(left[0].area - right[0].area)).toBeLessThan(0.1 * right[0].area)
    expect(left[0].centroid[0]).toBeCloseTo(-right[0].centroid[0], 0)
    // The boss on the plane stays whole.
    const boss = r.patches.filter((p) => !onWall(p))
    expect(boss).toHaveLength(1)
    expect(boss[0].round).toBe(true)
  })
})
