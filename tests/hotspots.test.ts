// SPDX-License-Identifier: AGPL-3.0-only
// Where a field lies over tolerance, as patches (core/deviation/hotspots):
// joined by distance, parted by a wall, by the side of the surface and by
// a group key; the spacing read off the points, the area from it; each
// patch a feature (broad and deep) or texture.
import { describe, expect, it } from 'vitest'
import { hotspots, pointSpacing } from '../src/core/deviation/hotspots'

/** A grid of points on the plane z = `z`, `n` by `n` a millimetre apart,
 *  each with the value `at` gives it. */
function sheet(n: number, z: number, at: (x: number, y: number) => number): { points: number[]; values: number[] } {
  const points: number[] = []
  const values: number[] = []
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      points.push(i, j, z)
      values.push(at(i, j))
    }
  return { points, values }
}

const field = (...sheets: { points: number[]; values: number[] }[]) => ({
  points: Float32Array.from(sheets.flatMap((s) => s.points)),
  values: Float32Array.from(sheets.flatMap((s) => s.values)),
})

describe('hotspots', () => {
  it('gathers two faces over tolerance into two patches, a wall apart', () => {
    const f = field(sheet(20, 0, () => 1), sheet(20, 10, () => -0.5), sheet(20, 20, () => 0.05))
    const r = hotspots(f.points, f.values, 0.1)
    expect(r.over).toBe(800)
    expect(r.found).toBe(2)
    expect(r.spacing).toBeCloseTo(1, 6)
    expect(r.grain).toBeCloseTo(3, 6)
    const [a, b] = r.patches
    expect(a.count).toBe(400)
    expect(a.extreme).toBe(1)
    expect(a.mean).toBeCloseTo(1, 6)
    expect(a.area).toBeCloseTo(400, 6)
    expect(a.excess).toBeCloseTo(400 * 0.9, 3)
    expect(a.centroid[0]).toBeCloseTo(9.5, 6)
    expect(a.centroid[1]).toBeCloseTo(9.5, 6)
    expect(a.centroid[2]).toBe(0)
    expect(a.min).toEqual([0, 0, 0])
    expect(a.max).toEqual([19, 19, 0])
    expect(a.members).toHaveLength(400)
    expect(b.extreme).toBe(-0.5)
    expect(b.centroid[2]).toBeCloseTo(10, 6)
    expect(f.values[b.index]).toBe(-0.5)
    expect(b.at[2]).toBe(10)
  })

  it('bridges a vertex under tolerance inside a patch, and parts the two sides of the surface', () => {
    const holed = field(sheet(20, 0, (x, y) => (x === 10 && y === 10 ? 0 : 1)))
    expect(hotspots(holed.points, holed.values, 0.1).found).toBe(1)
    const split = field(sheet(20, 0, (x) => (x < 10 ? 1 : -1)))
    const r = hotspots(split.points, split.values, 0.1)
    expect(r.found).toBe(2)
    expect(r.patches.map((p) => p.extreme).sort()).toEqual([-1, 1])
    // A key keeps patches apart that distance would join — the face each
    // vertex lies nearest.
    const grouped = hotspots(holed.points, holed.values, 0.1, { group: (i) => (holed.points[i * 3] < 10 ? 0 : 1) })
    expect(grouped.found).toBe(2)
  })

  it('ranks by what lies past the tolerance, caps the list, and drops specks', () => {
    const big = sheet(20, 0, () => 0.2)
    const far = sheet(5, 30, () => 3)
    const speck = { points: [50, 50, 50, 51, 50, 50], values: [5, 5] }
    const f = field(big, far, speck)
    const r = hotspots(f.points, f.values, 0.1)
    expect(r.found).toBe(2)
    // 25 vertices 2.9 over outrank 400 vertices 0.1 over.
    expect(r.patches[0].count).toBe(25)
    expect(r.patches[1].count).toBe(400)
    expect(hotspots(f.points, f.values, 0.1, { limit: 1 }).patches).toHaveLength(1)
    expect(hotspots(f.points, f.values, 0.1, { minCount: 1 }).found).toBe(3)
    expect(hotspots(f.points, f.values, 0.1, { only: (i) => f.points[i * 3 + 2] > 20 }).over).toBe(27)
    // A grain given is used as it is: one too small for the spacing makes
    // every vertex its own speck.
    expect(hotspots(f.points, f.values, 0.1, { grain: 0.5, minCount: 1 }).found).toBe(427)
  })

  it('tells a missing pad from the texture round it: one feature, its depth and volume, the share of the excess', () => {
    // A plate 40 mm square, a point every 0.25 mm, cast texture ±0.3 over
    // it and a 6 × 6 × 1 mm pad the model lacks: the scan stands 1 mm out
    // over the pad.
    const step = 0.25
    const n = 161
    const texture = (x: number, y: number) => 0.3 * Math.sin((2 * Math.PI * x) / 4) * Math.sin((2 * Math.PI * y) / 4)
    const pad = (x: number, y: number) => x >= 17 && x < 23 && y >= 17 && y < 23
    const points: number[] = []
    const values: number[] = []
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = i * step, y = j * step
        points.push(x, y, 0)
        values.push((pad(x, y) ? 1 : 0) + texture(x, y))
      }
    const f = field({ points, values })
    const r = hotspots(f.points, f.values, 0.25, { limit: 50 })
    expect(r.spacing).toBeCloseTo(step, 6)
    // The texture's crests poke past 0.25 in many places, each small and
    // shallow; the pad is the one feature, and the first patch.
    expect(r.found).toBeGreaterThan(20)
    expect(r.features.count).toBe(1)
    const [first, ...rest] = r.patches
    expect(first.kind).toBe('feature')
    expect(first.area).toBeGreaterThan(36)
    expect(first.area).toBeLessThan(40)
    expect(first.depth).toBeGreaterThan(0.9)
    expect(first.depth).toBeLessThan(1.1)
    expect(first.volume).toBeCloseTo(first.excess * step * step, 6)
    expect(first.volume).toBeGreaterThan(25)
    expect(first.volume).toBeLessThan(30)
    expect(rest.every((p) => p.kind === 'texture')).toBe(true)
    expect(rest.every((p) => p.depth < 0.3 && p.area < 1)).toBe(true)
    expect(r.features.shareOfExcess).toBeGreaterThan(0.8)
    expect(r.features.shareOfExcess).toBeLessThanOrEqual(1)
  })

  it('takes a feature to be broad and deep: wide and shallow, or deep and small, is texture', () => {
    // At 1 mm spacing a feature is 25 vertices at least (25 spacings²),
    // and twice the tolerance deep at the median.
    const broadShallow = field(sheet(10, 0, () => 0.15))
    expect(hotspots(broadShallow.points, broadShallow.values, 0.1).patches[0]).toMatchObject({ kind: 'texture', count: 100 })
    const deepSmall = field(sheet(4, 0, () => 2))
    expect(hotspots(deepSmall.points, deepSmall.values, 0.1).patches[0]).toMatchObject({ kind: 'texture', count: 16 })
    const both = field(sheet(5, 0, () => 0.2))
    const r = hotspots(both.points, both.values, 0.1)
    expect(r.patches[0]).toMatchObject({ kind: 'feature', count: 25, depth: expect.closeTo(0.2, 6) })
    expect(r.features).toEqual({ count: 1, shareOfExcess: 1 })
    // The median, not the mean: a few spikes do not make texture deep.
    const spiky = field(sheet(10, 0, (x, y) => (x === 5 && y < 3 ? 10 : 0.15)))
    expect(hotspots(spiky.points, spiky.values, 0.1).patches[0]).toMatchObject({ kind: 'texture', depth: expect.closeTo(0.15, 6) })
    // A line other than the tolerance: what lies past a search distance of
    // 1 is told against the map's own tolerance, 0.1 — 0.2 deep is enough.
    const far = field(sheet(10, 0, () => 1.3))
    expect(hotspots(far.points, far.values, 1).patches[0].kind).toBe('texture')
    expect(hotspots(far.points, far.values, 1, { featureDepth: 0.2 }).patches[0].kind).toBe('feature')
    expect(hotspots(new Float32Array(0), new Float32Array(0), 0.1).features).toEqual({ count: 0, shareOfExcess: 0 })
  })

  it('reads the spacing off a sample, skips what is not finite, and copes with nothing over', () => {
    const f = field(sheet(30, 0, () => 1))
    expect(pointSpacing(f.points, Array.from({ length: 900 }, (_, i) => i))).toBeCloseTo(1, 6)
    const sparse = field(sheet(10, 0, () => 1))
    for (let i = 0; i < sparse.points.length; i++) sparse.points[i] *= 2.5
    expect(hotspots(sparse.points, sparse.values, 0.1).spacing).toBeCloseTo(2.5, 6)
    const nan = field(sheet(10, 0, () => NaN))
    expect(hotspots(nan.points, nan.values, 0.1)).toMatchObject({ patches: [], found: 0, over: 0 })
    expect(hotspots(new Float32Array(0), new Float32Array(0), 0.1).patches).toEqual([])
  })
})
