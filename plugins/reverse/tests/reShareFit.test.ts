// SPDX-License-Identifier: AGPL-3.0-only
// A level's outline fitted onto the pieces a sketch already holds
// (core/shareFit.ts): the stretches along a piece taken as that piece's,
// the corners it has left alone, the rest left as open runs that know
// which pieces they run between — and a T-junction held within its piece
// when a dimension shortens the piece (solver.ts pointOn bounded).

import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { landEnd, pastPiece, shareChain, sharePieces, takeShared } from '../core/shareFit'
import { addConstraint, addEntity, anchorPoint, emptySketch, entityOf, type Sketch, type SketchLine } from '../core/sketch'
import { solveSketch } from '../core/solver'

/** A seeded noise in [-1, 1]. */
function noiseOf(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2
}

/** A closed outline through the corners, a point every `step` mm pushed
 *  off it by up to `noise` square to the side — closed back on its first
 *  point, as a section's loop is. */
function outline(corners: Vec2[], step: number, noise: number, seed = 5): Vec2[] {
  const rnd = noiseOf(seed)
  const out: Vec2[] = []
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]
    const k = Math.round(len / step)
    for (let j = 0; j < k; j++) {
      const d = noise * rnd()
      out.push([a[0] + ((b[0] - a[0]) * j) / k + n[0] * d, a[1] + ((b[1] - a[1]) * j) / k + n[1] * d])
    }
  })
  out.push(out[0])
  return out
}

/** A rectangle of four lines fitted to their sides' points, joined at the
 *  corners. */
function fittedRectangle(lo: Vec2, hi: Vec2): { sketch: Sketch; sides: number[] } {
  const sketch = emptySketch()
  const corners: Vec2[] = [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]]
  const sides = corners.map((a, i) => {
    const b = corners[(i + 1) % 4]
    const points = Array.from({ length: 21 }, (_, k): Vec2 => [a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20])
    return addEntity(sketch, { kind: 'line', a, b, points, scatter: 0.01 })
  })
  sides.forEach((id, i) => addConstraint(sketch, { kind: 'coincident', p: { entity: id, at: 'b' }, q: { entity: sides[(i + 1) % 4], at: 'a' } }))
  return { sketch, sides }
}

describe('a level’s outline shared with the pieces there', () => {
  it('takes the walls the deck has, and leaves the wing’s as one run between the deck’s bottom and top', () => {
    const { sketch, sides } = fittedRectangle([0, 0], [20, 10])
    const [bottom, , top, left] = sides
    // The level below: the deck's outline and a wing out to x 30, its
    // walls 0.03 mm off the deck's.
    const chain = outline([[0.03, 0.03], [30, 0.03], [30, 10.03], [0.03, 10.03]], 0.2, 0.01)
    const split = shareChain(chain, sharePieces(sketch), { share: 0.1 })
    expect(split.whole).toBe(false)
    expect(split.shared.map((s) => s.piece).sort()).toEqual([bottom, top, left].sort())
    for (const s of split.shared) {
      expect(s.offMm.mean).toBeGreaterThan(0.015)
      expect(s.offMm.max).toBeLessThan(0.05)
    }
    expect(split.runs).toHaveLength(1)
    const run = split.runs[0]
    expect(run.from).toBe(bottom)
    expect(run.to).toBe(top)
    expect(Math.min(...run.points.map((p) => p[0]))).toBeGreaterThan(19.9)
    // The fitted pieces take the points beside their own; once only.
    expect(takeShared(sketch, split.shared).sort()).toEqual([bottom, top, left].sort())
    expect(takeShared(sketch, split.shared)).toEqual([])
    expect((entityOf(sketch, bottom) as SketchLine).points!.length).toBeGreaterThan(21 + 90)
  })

  it('leaves a scan’s round at a corner the sketch has sharp, and a wall 0.3 mm off is not the same wall', () => {
    const { sketch } = fittedRectangle([0, 0], [20, 10])
    // The same outline, its corners rounded R1 — 0.29 mm in off the sharp
    // corner at most: no run is left.
    const round: Vec2[] = []
    const r = 1
    const corners: [Vec2, number][] = [[[20 - r, r], -Math.PI / 2], [[20 - r, 10 - r], 0], [[r, 10 - r], Math.PI / 2], [[r, r], Math.PI]]
    corners.forEach(([c, a0], i) => {
      for (let k = 0; k <= 8; k++) round.push([c[0] + r * Math.cos(a0 + (k / 8) * (Math.PI / 2)), c[1] + r * Math.sin(a0 + (k / 8) * (Math.PI / 2))])
      const [n] = corners[(i + 1) % 4]
      const from = round[round.length - 1]
      const to: Vec2 = [n[0] + r * Math.cos(corners[(i + 1) % 4][1]), n[1] + r * Math.sin(corners[(i + 1) % 4][1])]
      for (let k = 1; k < 50; k++) round.push([from[0] + ((to[0] - from[0]) * k) / 50, from[1] + ((to[1] - from[1]) * k) / 50])
    })
    round.push(round[0])
    const split = shareChain(round, sharePieces(sketch), { share: 0.1 })
    expect(split.runs).toEqual([])
    expect(split.corners).toBeGreaterThan(0)
    // A wall standing 0.3 mm off: past share, fitted again.
    const off = outline([[0, -0.3], [20, -0.3], [20, 10], [0, 10]], 0.2, 0.005)
    const apart = shareChain(off, sharePieces(sketch), { share: 0.1 })
    expect(apart.runs.length).toBeGreaterThan(0)
    expect(apart.shared.some((s) => s.piece === 1)).toBe(false)
  })

  it('lands a run’s end on the piece’s end, in line where it carries the line on, or within the piece', () => {
    const { sketch, sides } = fittedRectangle([0, 0], [20, 10])
    const [bottom] = sides
    // Carried on: a line from x 20.2 on along y 0 lands on the corner and
    // holds collinear.
    const on = addEntity(sketch, { kind: 'line', a: [20.2, 0.01], b: [30, 0.01] })
    expect(landEnd(sketch, { entity: on, at: 'a' }, bottom, 0.1)).toMatchObject({ held: 'end', on: bottom, at: [20, 0], collinear: true })
    expect((entityOf(sketch, on) as SketchLine).a).toEqual([20, 0])
    // A T: a wall up from the bottom at x 12 is held on it, within it.
    const wall = addEntity(sketch, { kind: 'line', a: [12, 0.08], b: [12, 10] })
    expect(landEnd(sketch, { entity: wall, at: 'a' }, bottom, 0.1)).toMatchObject({ held: 'on', on: bottom })
    expect(sketch.constraints.at(-1)).toMatchObject({ kind: 'pointOn', p: { entity: wall, at: 'a' }, on: { line: bottom }, bounded: true })
  })
})

describe('a T-junction held within its piece', () => {
  /** A carrier from x 0 to 10 and a wall standing on it at x 8; the
   *  carrier then dimensioned 5 long. */
  function tee(bounded: boolean) {
    const sketch = emptySketch()
    const carrier = addEntity(sketch, { kind: 'line', a: [0, 0], b: [10, 0] })
    const wall = addEntity(sketch, { kind: 'line', a: [8, 0], b: [8, 5] })
    addConstraint(sketch, { kind: 'horizontal', entity: carrier })
    addConstraint(sketch, { kind: 'pointOn', p: { entity: wall, at: 'a' }, on: { line: carrier }, ...(bounded ? { bounded: true } : {}) })
    addConstraint(sketch, { kind: 'length', entity: carrier, value: 5 })
    const report = solveSketch(sketch)
    const c = entityOf(sketch, carrier) as SketchLine
    const end = anchorPoint(entityOf(sketch, wall)!, 'a')
    return { report, c, end, past: pastPiece(sketch, sketch.constraints.find((x) => x.kind === 'pointOn') as never) }
  }

  it('keeps the wall’s foot on the shortened carrier, the solve met', () => {
    const { report, c, end, past } = tee(true)
    expect(report.ok).toBe(true)
    expect(Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1])).toBeCloseTo(5, 6)
    expect(end[0]).toBeLessThanOrEqual(Math.max(c.a[0], c.b[0]) + 1e-6)
    expect(end[0]).toBeGreaterThanOrEqual(Math.min(c.a[0], c.b[0]) - 1e-6)
    expect(past).toBeNull()
  })

  it('leaves a plain pointOn on the line past the carrier’s end, as before — and says how far', () => {
    const { report, c, end, past } = tee(false)
    expect(report.ok).toBe(true)
    expect(end[0]).toBeGreaterThan(Math.max(c.a[0], c.b[0]) + 0.4)
    expect(past).toBeGreaterThan(0.4)
  })

  it('counts the bound in neither the equations nor the redundant ones', () => {
    const plain = tee(false).report
    const held = tee(true).report
    expect(held.equations).toBe(plain.equations)
    expect(held.redundant).toBe(plain.redundant)
  })
})
