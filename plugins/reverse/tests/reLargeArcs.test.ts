// SPDX-License-Identifier: AGPL-3.0-only
// Curves the cut used to make lines of, or one arc of: a long shallow
// curve that bows well past the noise stays an arc however little it turns,
// and a chain asked for as n arcs comes out as n — two tangent arcs of a
// near radius, which one arc within the noise would swallow, apart again.

import { describe, expect, it } from 'vitest'
import type { FlatArcFit, Vec2 } from '../../../src/core/flat/types'
import { arcsOfChain, segmentChain } from '../core/segment'

/** A seeded uniform noise in [-1, 1]. */
function noiseOf(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2
}

/** Points along an arc about c, every 0.3 mm, the radius scattered. */
function arcPoints(c: Vec2, r: number, from: number, to: number, noise: number, rnd: () => number): Vec2[] {
  const n = Math.max(2, Math.round((Math.abs(to - from) * r) / 0.3))
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * i) / n
    const rr = r + noise * rnd()
    out.push([c[0] + rr * Math.cos(t), c[1] + rr * Math.sin(t)])
  }
  return out
}

describe('large arcs', () => {
  it('keeps a long shallow curve an arc: R177 over 40 mm, 13°, a 1.1 mm bow under 0.04 mm of noise', () => {
    const half = Math.asin(20 / 177)
    const pts = arcPoints([0, 177], 177, -Math.PI / 2 - half, -Math.PI / 2 + half, 0.04, noiseOf(7))
    const seg = segmentChain(pts)
    expect(seg.segments.map((s) => s.kind)).toEqual(['arc'])
    expect((seg.segments[0].fit as FlatArcFit).radius).toBeCloseTo(177, -1)
  })

  it('still makes a wall that wanders a little a line', () => {
    // 60 mm, bowed 0.15 mm — three noise tolerances — under 0.04 mm noise.
    const rnd = noiseOf(11)
    const pts: Vec2[] = []
    for (let x = 0; x <= 60; x += 0.3) pts.push([x, 0.15 * Math.sin((Math.PI * x) / 60) + 0.04 * rnd()])
    expect(segmentChain(pts).segments.map((s) => s.kind)).toEqual(['line'])
  })

  it('cuts a chain into the arcs asked for: two tangent arcs, R176.9 then R218.65', () => {
    const r1 = 176.9
    const r2 = 218.65
    const a1 = 40 / r1
    const a2 = 60 / r2
    const rnd = noiseOf(3)
    const first = arcPoints([0, r1], r1, -Math.PI / 2, -Math.PI / 2 + a1, 0.03, rnd)
    // Where the first ends, the second starts tangent to it, its centre on
    // the same normal.
    const end: Vec2 = [r1 * Math.sin(a1), r1 - r1 * Math.cos(a1)]
    const toCentre: Vec2 = [-Math.sin(a1), Math.cos(a1)]
    const c2: Vec2 = [end[0] + toCentre[0] * r2, end[1] + toCentre[1] * r2]
    const t2 = Math.atan2(end[1] - c2[1], end[0] - c2[0])
    const pts = [...first, ...arcPoints(c2, r2, t2, t2 + a2, 0.03, rnd)]
    // One arc within the noise swallows both — the cut's own reading.
    expect(segmentChain(pts).segments).toHaveLength(1)
    const two = arcsOfChain(pts, 2)
    expect(two.segments.map((s) => s.kind)).toEqual(['arc', 'arc'])
    const [p, q] = two.segments.map((s) => s.fit as FlatArcFit)
    expect(p.radius).toBeGreaterThan(165)
    expect(p.radius).toBeLessThan(190)
    expect(q.radius).toBeGreaterThan(205)
    expect(q.radius).toBeLessThan(232)
    // The break near where the arcs meet: 40 mm along of 100.
    const breakAt = two.segments[0].points.length / pts.length
    expect(breakAt).toBeGreaterThan(0.3)
    expect(breakAt).toBeLessThan(0.5)
  })

  it('refuses arcs it has no points for', () => {
    const pts = arcPoints([0, 50], 50, -Math.PI / 2, -Math.PI / 2 + 0.05, 0.01, noiseOf(5))
    expect(() => arcsOfChain(pts, 4)).toThrow(/too few/)
  })
})
