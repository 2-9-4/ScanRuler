// SPDX-License-Identifier: AGPL-3.0-only
// A slice through a clean, CAD-like outline — tangent pieces from R0.45 to
// R110, points a few microns off — fitted into one sketch that solves. The
// fitted pieces are tangent only to within their fits; the solve holds the
// relations against stiff slice points, and has to close them exactly.

import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { inferCorners } from '../core/corners'
import { placeSegments, segmentChain } from '../core/segment'
import { emptySketch } from '../core/sketch'
import { solveSketch } from '../core/solver'

/** A seeded uniform noise in [-1, 1]. */
function noiseOf(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2
}

type Step = { line: number } | { r: number; turnDeg: number }

/** Points along a chain of tangent lines and arcs, walked like a turtle from
 *  the origin heading +X, every `step` mm, each pushed off its piece by up
 *  to `noise` along the normal; closed by a straight line back to the start. */
function tangentChain(steps: Step[], step: number, noise: number, rnd: () => number): Vec2[] {
  const out: Vec2[] = []
  let p: Vec2 = [0, 0]
  let h = 0
  const push = (q: Vec2, nx: number, ny: number) => {
    const d = noise * rnd()
    out.push([q[0] + nx * d, q[1] + ny * d])
  }
  for (const s of steps) {
    if ('line' in s) {
      const n = Math.max(1, Math.round(s.line / step))
      const [dx, dy] = [Math.cos(h), Math.sin(h)]
      for (let i = 0; i < n; i++) push([p[0] + (dx * s.line * i) / n, p[1] + (dy * s.line * i) / n], -dy, dx)
      p = [p[0] + dx * s.line, p[1] + dy * s.line]
    } else {
      const turn = (s.turnDeg * Math.PI) / 180
      const side = Math.sign(turn)
      const c: Vec2 = [p[0] - side * s.r * Math.sin(h), p[1] + side * s.r * Math.cos(h)]
      const a0 = Math.atan2(p[1] - c[1], p[0] - c[0])
      const n = Math.max(2, Math.round((Math.abs(turn) * s.r) / step))
      for (let i = 0; i < n; i++) {
        const a = a0 + (turn * i) / n
        push([c[0] + s.r * Math.cos(a), c[1] + s.r * Math.sin(a)], Math.cos(a), Math.sin(a))
      }
      const a1 = a0 + turn
      p = [c[0] + s.r * Math.cos(a1), c[1] + s.r * Math.sin(a1)]
      h += turn
    }
  }
  // The closing side, straight back to the start.
  const back = Math.hypot(p[0], p[1])
  const n = Math.max(1, Math.round(back / step))
  const [dx, dy] = [-p[0] / back, -p[1] / back]
  for (let i = 0; i < n; i++) push([p[0] + (dx * back * i) / n, p[1] + (dy * back * i) / n], -dy, dx)
  return out
}

const BATTERY_SIDE: Step[] = [
  // The battery case's side: a flat bottom, a big round, a long R110 flank
  // into a small top corner, a flat top, a ledge with a cove and rounds.
  { line: 20 },
  { r: 9.4, turnDeg: 70 },
  { r: 110, turnDeg: 10 },
  { r: 0.65, turnDeg: 100 },
  { line: 12 },
  { r: 1.26, turnDeg: 90 },
  { line: 1.5 },
  { r: 0.45, turnDeg: -90 },
  { line: 3 },
  { r: 0.72, turnDeg: 78.6 },
  { line: 1.2 },
]

describe('a clean CAD slice to a sketch', () => {
  // Each of these left two to four tangencies 1.0–1.6 µm open, and the sketch
  // was refused as not solving.
  it.each([
    { spacing: 0.02, noise: 0, detail: 0.9, seed: 1 },
    { spacing: 0.02, noise: 0, detail: 0.6, seed: 2 },
    { spacing: 0.02, noise: 0.002, detail: 0.7, seed: 3 },
  ])('solves tangent pieces from R0.45 to R110: every $spacing mm, $noise mm off, detail $detail', ({ spacing, noise, detail, seed }) => {
    const pts = tangentChain(BATTERY_SIDE, spacing, noise, noiseOf(seed))
    const cut = segmentChain(pts, { detail })
    const s = emptySketch()
    const placed = placeSegments(s, cut)
    const corners = inferCorners(s, placed, cut.closed)
    expect(corners.tangent).toBeGreaterThanOrEqual(8)
    const solved = solveSketch(s)
    expect(solved.unmet).toEqual([])
    expect(solved.ok).toBe(true)
    // The pieces stay on their points: closing the relations moved them by
    // microns, not by the noise.
    expect(solved.softRms).toBeLessThan(0.01)
  })
})
