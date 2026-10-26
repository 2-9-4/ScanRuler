// SPDX-License-Identifier: AGPL-3.0-only
// Draft on thin walls: a dish with six radial blades 2 mm thick, each side
// drafted 3°, their ends full rounds, and a drafted hub in the middle. The
// rounds join a blade's two sides point by point, so walls grown over
// neighbours alone are one patch facing nowhere; the patch's summed normal
// is short against its count, and it is parted into the blade's two sides,
// facing ± across the blade. The hub, whose points face every way, stays
// one patch and says so. A curved blade, one side facing away from its
// centre and the other towards it, is parted the same way.

import { describe, expect, it } from 'vitest'
import { draftPatches } from '../src/core/fit/draft'
import type { Vec3 } from '../src/core/types'

const DRAFT_DEG = 3
const HEIGHT = 10
/** The blade's half thickness at mid-height, mm, and the spacing of the
 *  points along an outline. */
const HALF = 1
const STEP = 0.15

type Outline = { p: [number, number]; f: [number, number] }[]

/** A scan of walls over outlines in the plane, each leaning DRAFT_DEG in
 *  towards the top (+Z), with a little normal noise; and a floor square to
 *  the pull. */
function scan(outlines: Outline[]): { positions: Float32Array; normals: Float32Array } {
  let s = 29
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  const pos: number[] = []
  const nor: number[] = []
  const t = (DRAFT_DEG * Math.PI) / 180
  const j = (0.5 * Math.PI) / 180
  for (const outline of outlines)
    for (let z = 0.125; z < HEIGHT; z += 0.25) {
      // Inset by the draft at each height, about mid-height.
      const inset = (z - HEIGHT / 2) * Math.tan(t)
      for (const { p, f } of outline) {
        pos.push(p[0] - f[0] * inset, p[1] - f[1] * inset, z)
        nor.push(f[0] * Math.cos(t) + j * rnd(), f[1] * Math.cos(t) + j * rnd(), Math.sin(t) + j * rnd())
      }
    }
  for (let x = -60; x <= 60; x += 1)
    for (let y = -60; y <= 60; y += 1) {
      pos.push(x, y, 0)
      nor.push(0, 0, 1)
    }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nor) }
}

/** A straight blade along the radius at angle `a`, from rIn to rOut: two
 *  sides HALF off its middle line, its ends half circles. */
function blade(a: number, rIn: number, rOut: number): Outline {
  const r: [number, number] = [Math.cos(a), Math.sin(a)]
  const tg: [number, number] = [-r[1], r[0]]
  const at = (u: number, v: number): [number, number] => [r[0] * u + tg[0] * v, r[1] * u + tg[1] * v]
  const out: Outline = []
  for (let u = rIn; u <= rOut; u += STEP) {
    out.push({ p: at(u, HALF), f: tg })
    out.push({ p: at(u, -HALF), f: [-tg[0], -tg[1]] })
  }
  const da = STEP / HALF
  for (let q = -Math.PI / 2 + da; q < Math.PI / 2; q += da) {
    const c = Math.cos(q), sn = Math.sin(q)
    out.push({ p: at(rOut + c * HALF, sn * HALF), f: at(c, sn) })
    out.push({ p: at(rIn - c * HALF, sn * HALF), f: at(-c, sn) })
  }
  return out
}

/** A round boss of radius r about (cx, cy). */
function boss(r: number, cx = 0, cy = 0): Outline {
  const out: Outline = []
  for (let q = 0; q < 2 * Math.PI; q += STEP / r) out.push({ p: [cx + r * Math.cos(q), cy + r * Math.sin(q)], f: [Math.cos(q), Math.sin(q)] })
  return out
}

/** A curved blade: the band between circles R ∓ HALF about (cx, cy), from
 *  angle a0 to a1, its ends half circles. */
function crescent(cx: number, cy: number, R: number, a0: number, a1: number): Outline {
  const out: Outline = []
  const pt = (q: number, rr: number): [number, number] => [cx + rr * Math.cos(q), cy + rr * Math.sin(q)]
  for (let q = a0; q <= a1; q += STEP / R) {
    const f: [number, number] = [Math.cos(q), Math.sin(q)]
    out.push({ p: pt(q, R + HALF), f })
    out.push({ p: pt(q, R - HALF), f: [-f[0], -f[1]] })
  }
  const da = STEP / HALF
  for (const [q, sign] of [[a1, 1], [a0, -1]] as const) {
    const rad: [number, number] = [Math.cos(q), Math.sin(q)]
    const tan: [number, number] = [-rad[1] * sign, rad[0] * sign]
    const mid = pt(q, R)
    for (let k = -Math.PI / 2 + da; k < Math.PI / 2; k += da) {
      const f: [number, number] = [tan[0] * Math.cos(k) + rad[0] * Math.sin(k), tan[1] * Math.cos(k) + rad[1] * Math.sin(k)]
      out.push({ p: [mid[0] + f[0] * HALF, mid[1] + f[1] * HALF], f })
    }
  }
  return out
}

describe('draft on thin walls', () => {
  const BLADES = 6
  const R_IN = 20
  const R_OUT = 50
  const angles = Array.from({ length: BLADES }, (_, b) => (2 * Math.PI * b) / BLADES)
  const { positions, normals } = scan([...angles.map((a) => blade(a, R_IN, R_OUT)), boss(10)])
  const r = draftPatches(positions, normals, [0, 0, 1], { limit: 50 })

  it('gives each 2 mm blade two patches, facing ± across it', () => {
    for (const a of angles) {
      const rad: Vec3 = [Math.cos(a), Math.sin(a), 0]
      const tg: Vec3 = [-rad[1], rad[0], 0]
      const sides = r.patches.filter((p) => {
        const along = p.centroid[0] * rad[0] + p.centroid[1] * rad[1]
        const across = p.centroid[0] * tg[0] + p.centroid[1] * tg[1]
        return along > R_IN - 2 && along < R_OUT + 2 && Math.abs(across) < 2 && p.area > 100
      })
      expect(sides).toHaveLength(2)
      const [s0, s1] = sides.map((p) => p.facing[0] * tg[0] + p.facing[1] * tg[1])
      expect(Math.abs(s0)).toBeGreaterThan(0.95)
      expect(s0 * s1).toBeLessThan(-0.9)
      for (const p of sides) {
        expect(p.draftDeg).toBeCloseTo(DRAFT_DEG, 0)
        expect(p.round).toBeUndefined()
      }
    }
  })

  it('keeps the hub one patch, and flags it as facing every way', () => {
    const hub = r.patches.filter((p) => Math.hypot(p.centroid[0], p.centroid[1]) < 3)
    expect(hub).toHaveLength(1)
    expect(hub[0].round).toBe(true)
    expect(hub[0].draftDeg).toBeCloseTo(DRAFT_DEG, 0)
    expect(hub[0].area).toBeGreaterThan(300)
  })

  it('reads a wall nearly square to the pull whole, its noisy points leaning either way', () => {
    // A wall drafted 0.2°, its normals noisier than that: half the points
    // lean back, and are still the same wall.
    let s = 7
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2
    const t = (0.2 * Math.PI) / 180, j = (1.5 * Math.PI) / 180
    const pos: number[] = [], nor: number[] = []
    for (let y = 0; y < 30; y += 0.25)
      for (let z = 0; z < 10; z += 0.25) {
        pos.push(0, y, z)
        nor.push(Math.cos(t) + j * rnd(), j * rnd(), Math.sin(t) + j * rnd())
      }
    const walls = draftPatches(Float32Array.from(pos), Float32Array.from(nor), [0, 0, 1]).patches
    expect(walls).toHaveLength(1)
    expect(walls[0].draftDeg).toBeCloseTo(0.2, 1)
  })

  it('parts a curved blade into its two sides, one facing out and one in', () => {
    // An arc of radius 50 about (−30, 0), 40° of it.
    const c: [number, number] = [-30, 0]
    const scanned = scan([crescent(c[0], c[1], 50, -0.35, 0.35)])
    const sides = draftPatches(scanned.positions, scanned.normals, [0, 0, 1]).patches.filter((p) => p.area > 100)
    expect(sides).toHaveLength(2)
    // Each side's facing against the way out from the arc's centre.
    const out = sides.map((p) => {
      const d = [p.centroid[0] - c[0], p.centroid[1] - c[1]]
      return (p.facing[0] * d[0] + p.facing[1] * d[1]) / Math.hypot(d[0], d[1])
    })
    expect(Math.max(...out)).toBeGreaterThan(0.9)
    expect(Math.min(...out)).toBeLessThan(-0.9)
    for (const p of sides) {
      expect(p.round).toBeUndefined()
      expect(p.draftDeg).toBeCloseTo(DRAFT_DEG, 0)
    }
  })
})
