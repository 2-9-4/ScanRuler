// SPDX-License-Identifier: AGPL-3.0-only
// A section read for one skin: the cut carries the side the material is on
// at every point, and a thin arched shell with ribs on its inside keeps its
// outer arch alone, its inner skin alone, or what faces a way.
import { describe, expect, it } from 'vitest'
import { projectCut, projectCutNormals, sliceMesh, transformCut } from '../src/core/section/slice'
import { runsWhere, sideMask, sideRuns, sidedChains, type SideRule } from '../src/core/section/skin'
import type { SectionFrame } from '../src/core/section/frame'
import { rigidFromAxisAngle } from '../src/core/deviation/rigid'
import type { Vec2 } from '../src/core/flat/types'
import { ARCH, archPlaceOf, archProfile, densify, prism } from './shellMesh'

const { R, r, ribs: RIBS } = ARCH

const frame: SectionFrame = { origin: [0, 0, 7], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }

function cutOf(mesh: { positions: Float32Array; indices: Uint32Array }) {
  const cut = sliceMesh(mesh.positions, mesh.indices, frame.origin, frame.normal)
  return { cut, sided: sidedChains(projectCut(cut, frame), projectCutNormals(cut, frame)!) }
}

const placeOf = archPlaceOf

const points = (runs: { points: Vec2[] }[]) => runs.flatMap((x) => x.points)

describe('a section carries the side the material is on', () => {
  it('points out of the material on both skins of the wall', () => {
    const { sided } = cutOf(prism(archProfile(0.5), 20))
    expect(sided.chains.length).toBe(1)
    let outer = 0, inner = 0
    sided.chains[0].forEach((p, i) => {
      const n = sided.normals[0][i]
      expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 5)
      const rad = Math.hypot(p[0], p[1])
      if (p[1] < 1 || rad < r - 0.2) return
      const radial = (n[0] * p[0] + n[1] * p[1]) / rad
      if (rad > R - 0.1) {
        expect(radial).toBeGreaterThan(0.99)
        outer++
      } else if (rad > r - 0.1 && rad < r + 0.1 && RIBS.every((x) => Math.abs(Math.atan2(p[1], p[0]) * (180 / Math.PI) - x) > 4)) {
        expect(radial).toBeLessThan(-0.99)
        inner++
      }
    })
    expect(outer).toBeGreaterThan(200)
    expect(inner).toBeGreaterThan(150)
  })

  it('turns its sides with the part', () => {
    const mesh = prism(archProfile(1), 20)
    const cut = sliceMesh(mesh.positions, mesh.indices, frame.origin, frame.normal)
    const m = rigidFromAxisAngle([0, 0, 1], Math.PI / 2)
    const moved = transformCut(cut, m)
    for (let i = 0; i < cut.points.length; i += 3) {
      // A quarter turn about Z: (x, y) goes to (−y, x).
      expect(moved.normals![i]).toBeCloseTo(-cut.normals![i + 1], 5)
      expect(moved.normals![i + 1]).toBeCloseTo(cut.normals![i], 5)
    }
  })
})

describe('a section kept to one skin', () => {
  for (const noise of [0, 0.05]) {
    describe(noise ? 'on a noisy scan' : 'on a clean mesh', () => {
      const { sided } = cutOf(prism(archProfile(0.5), 20, noise))
      const all = sided.chains[0]

      it('skin outer keeps the outer arch alone, in one run', () => {
        const runs = sideRuns(sided, { skin: 'outer' })
        expect(runs.length).toBe(1)
        const kept = points(runs)
        const places = kept.map(placeOf)
        expect(places.filter((x) => x === 'inner' || x === 'rib')).toEqual([])
        // All of the arch's outside is there.
        const arch = all.filter((p) => placeOf(p) === 'outer').length
        expect(places.filter((x) => x === 'outer').length).toBeGreaterThanOrEqual(arch - 4)
      })

      it('skin inner keeps the inside of the wall, without the ribs', () => {
        const runs = sideRuns(sided, { skin: 'inner' })
        // The inside between the legs, cut into four by the three ribs.
        expect(runs.length).toBe(4)
        const places = points(runs).map(placeOf)
        expect(places.filter((x) => x !== 'inner' && x !== 'corner')).toEqual([])
        const inside = all.filter((p) => placeOf(p) === 'inner').length
        expect(places.length).toBeGreaterThan(0.85 * inside)
      })

      it('facing keeps the points that face a way', () => {
        const rule: SideRule = { facing: { dir: [0, 1], withinDeg: 45 } }
        const kept = points(sideRuns(sided, rule))
        expect(kept.length).toBeGreaterThan(100)
        for (const p of kept) {
          expect(placeOf(p)).toBe('outer')
          const a = (Math.atan2(p[1], p[0]) * 180) / Math.PI
          expect(a).toBeGreaterThan(43)
          expect(a).toBeLessThan(137)
        }
        // A skin and a facing together: the outer arch's top, still.
        const both = points(sideRuns(sided, { skin: 'outer', facing: { dir: [0, 1], withinDeg: 45 } }))
        expect(both.length).toBeGreaterThan(0.9 * kept.length)
      })
    })
  }

  it('a solid has an outer skin all round and no inner skin', () => {
    const square = densify([[0, 0], [30, 0], [30, 20], [0, 20]], 0.5)
    const { sided } = cutOf(prism(square, 20))
    const outer = sideRuns(sided, { skin: 'outer' })
    expect(outer.length).toBe(1)
    expect(outer[0].points.length).toBe(sided.chains[0].length)
    expect(sideRuns(sided, { skin: 'inner' })).toEqual([])
  })

  it('a hollow box has its inside as the inner skin', () => {
    // A square tube 2 mm thick, cut across: two loops, the inside one wound
    // the other way round.
    const outside = densify([[0, 0], [40, 0], [40, 30], [0, 30]], 0.5)
    const inside = densify([[2, 2], [2, 28], [38, 28], [38, 2]], 0.5)
    const a = prism(outside, 20)
    const b = prism(inside, 20)
    const positions = new Float32Array([...a.positions, ...b.positions])
    const indices = new Uint32Array([...a.indices, ...b.indices.map((i) => i + a.positions.length / 3)])
    const { sided } = cutOf({ positions, indices })
    expect(sided.chains.length).toBe(2)
    const mask = sideMask(sided.chains, sided.normals, { skin: 'inner' })
    const big = sided.chains.findIndex((c) => c.some((p) => p[0] < 1))
    expect(mask[big].some(Boolean)).toBe(false)
    expect(mask[1 - big].every(Boolean)).toBe(true)
    const outer = sideMask(sided.chains, sided.normals, { skin: 'outer' })
    expect(outer[big].every(Boolean)).toBe(true)
    expect(outer[1 - big].some(Boolean)).toBe(false)
  })
})

describe('runsWhere', () => {
  const loop: Vec2[] = Array.from({ length: 21 }, (_, i) => [Math.cos((i / 20) * 2 * Math.PI), Math.sin((i / 20) * 2 * Math.PI)] as Vec2)
  loop[20] = loop[0]

  it('keeps a loop’s run through its first point as one', () => {
    const runs = runsWhere(loop, (i) => i < 5 || i > 15)
    expect(runs.length).toBe(1)
    expect(runs[0].length).toBe(9)
    expect(runs[0][0]).toBe(loop[16])
    expect(runs[0][8]).toBe(loop[4])
  })

  it('keeps a loop kept whole closed, and drops runs too short to fit', () => {
    expect(runsWhere(loop, () => true)).toEqual([loop])
    const open = loop.slice(0, 20)
    expect(runsWhere(open, (i) => i !== 3 && i !== 10).map((x) => x.length)).toEqual([6, 9])
  })
})
