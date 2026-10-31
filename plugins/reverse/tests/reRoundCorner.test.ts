// SPDX-License-Identifier: AGPL-3.0-only
// A corner made round in a fitted sketch (core/roundCorner.ts): slice
// points of a profile with a tangent blend, the blend's points merged into
// its two neighbours as a segmenter that missed it leaves them; one call
// puts the arc in, the solver fits it with the tangencies held, and the
// radius comes back within its sigma of the drawn one — between two lines,
// a line and an arc, and two arcs. With a radius given, it is held.
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { reassignCornerPoints, roundCorner, roundRadiusSigma } from '../core/roundCorner'
import { addConstraint, addEntity, emptySketch, entityOf, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { solveSketch } from '../core/solver'

const rand = mulberry32(3)
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
const NOISE = 0.03

/** Points every `step` along a polyline of exact samples, each moved off
 *  by noise along the local normal. */
function noisy(points: Vec2[]): Vec2[] {
  return points.map((p, i) => {
    const q = points[Math.min(points.length - 1, i + 1)]
    const o = points[Math.max(0, i - 1)]
    const t = [q[0] - o[0], q[1] - o[1]]
    const l = Math.hypot(t[0], t[1]) || 1
    const d = gauss() * NOISE
    return [p[0] - (t[1] / l) * d, p[1] + (t[0] / l) * d]
  })
}

const line = (a: Vec2, b: Vec2, step = 0.2): Vec2[] => {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
}
const arc = (c: Vec2, r: number, from: number, to: number, step = 0.2): Vec2[] => {
  const n = Math.max(2, Math.round((Math.abs(to - from) * r) / step))
  return Array.from({ length: n }, (_, i) => {
    const a = from + ((to - from) * i) / n
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
  })
}

/** A sketch of two fitted pieces joined at their sharp corner, each
 *  carrying its slice points (the blend's among them). */
function twoPieces(a: { piece: Omit<SketchLine, 'id'> | Omit<SketchArc, 'id'> }, b: { piece: Omit<SketchLine, 'id'> | Omit<SketchArc, 'id'> }, join: ['a' | 'b', 'a' | 'b']): { sketch: Sketch; a: number; b: number } {
  const sketch = emptySketch()
  const ia = addEntity(sketch, { ...a.piece, scatter: NOISE } as never)
  const ib = addEntity(sketch, { ...b.piece, scatter: NOISE } as never)
  addConstraint(sketch, { kind: 'coincident', p: { entity: ia, at: join[0] }, q: { entity: ib, at: join[1] } })
  return { sketch, a: ia, b: ib }
}

/** The round put in, solved, the points shared out again and solved once
 *  more — what reverse.sketch.edit does. */
function rounded(s: { sketch: Sketch; a: number; b: number }, radius?: number) {
  const made = roundCorner(s.sketch, s.a, s.b, radius)
  if (typeof made === 'string') throw new Error(made)
  let report = solveSketch(s.sketch)
  for (let i = 0; i < 3 && reassignCornerPoints(s.sketch, s.a, s.b, made.arc) > 0; i++) report = solveSketch(s.sketch)
  const arcNow = entityOf(s.sketch, made.arc) as SketchArc
  return { made, report, arc: arcNow, sigma: roundRadiusSigma(s.sketch, s.a, s.b, made.arc) }
}

describe('a corner made round in a fitted sketch', () => {
  it('between two lines: an R2.9 blend the fit merged comes back within its sigma, the lines still on their points', () => {
    // The corner at (20, 10): a wall along +x up to it, then up along +y,
    // rounded R2.9 — points of the round given half to each line.
    const R = 2.9
    const c: Vec2 = [20 - R, 10 - R]
    const along = noisy(line([0, 10], [20 - R, 10]))
    const round = noisy(arc(c, R, Math.PI / 2, 0))
    const up = noisy(line([20, 10 - R], [20, -10]))
    const half = Math.floor(round.length / 2)
    const s = twoPieces(
      { piece: { kind: 'line', a: [0, 10], b: [20, 10], points: [...along, ...round.slice(0, half)] } },
      { piece: { kind: 'line', a: [20, 10], b: [20, -10], points: [...round.slice(half), ...up] } },
      ['b', 'a'],
    )
    const { report, arc: a, sigma, made } = rounded(s)
    expect(report.ok).toBe(true)
    expect(made.dimension).toBeUndefined()
    expect(sigma).not.toBeNull()
    expect(sigma!).toBeLessThan(0.1)
    expect(Math.abs(a.r - R)).toBeLessThan(Math.max(2 * sigma!, 0.03))
    expect(a.points!.length).toBeGreaterThan(round.length * 0.6)
    const la = entityOf(s.sketch, s.a) as SketchLine
    expect(Math.abs(la.a[1] - 10)).toBeLessThan(0.02)
    expect(Math.abs(la.b[0] - (20 - a.r))).toBeLessThan(0.02)
  })

  it('a line into an arc, and two arcs: the blend found tangent to each', () => {
    // A line along y = 0 up to (20, 0), then an R15 arc about (35, 0)
    // rising from it square, blended R3: the blend's centre 3 above the
    // line and 18 from (35, 0).
    const R = 3
    const bx = 35 - Math.sqrt(18 * 18 - R * R)
    const blendC: Vec2 = [bx, R]
    const toArc = Math.atan2(R - 0, bx - 35) // from the big circle's centre to the blend's
    const flat = noisy(line([0, 0], [bx, 0]))
    const blend = noisy(arc(blendC, R, -Math.PI / 2, Math.atan2(15 * Math.sin(toArc) - R, 35 + 15 * Math.cos(toArc) - bx)))
    const big = noisy(arc([35, 0], 15, toArc, Math.PI / 2))
    const half = Math.floor(blend.length / 2)
    const s = twoPieces(
      { piece: { kind: 'line', a: [0, 0], b: [20, 0], points: [...flat, ...blend.slice(0, half)] } },
      { piece: { kind: 'arc', c: [35, 0], r: 15, start: Math.PI / 2, sweep: Math.PI / 2, points: [...blend.slice(half), ...big] } },
      ['b', 'b'],
    )
    const one = rounded(s)
    expect(one.report.ok).toBe(true)
    expect(Math.abs(one.arc.r - R)).toBeLessThan(Math.max(2 * one.sigma!, 0.05))

    const R2 = 2.5
    // Two R15 circles about (−12, 0) and (12, 0), meeting at the origin;
    // the valley between their tops blended: the blend touches both from
    // outside, its centre 17.5 from each, on x = 0.
    const by = Math.sqrt(17.5 * 17.5 - 12 * 12)
    const bc: Vec2 = [0, by]
    const tl = Math.atan2(by, 12) // on the left circle, toward the blend
    const tr = Math.PI - tl
    const left = noisy(arc([-12, 0], 15, Math.PI / 2, tl))
    const blend2 = noisy(arc(bc, R2, Math.PI + tl, 2 * Math.PI - tl))
    const right = noisy(arc([12, 0], 15, tr, Math.PI / 2))
    const h2 = Math.floor(blend2.length / 2)
    const meet = Math.atan2(Math.sqrt(15 * 15 - 12 * 12), 12)
    const s2 = twoPieces(
      { piece: { kind: 'arc', c: [-12, 0], r: 15, start: meet, sweep: Math.PI / 2 - meet, points: [...left, ...blend2.slice(0, h2)] } },
      { piece: { kind: 'arc', c: [12, 0], r: 15, start: Math.PI / 2, sweep: Math.PI - meet - Math.PI / 2, points: [...blend2.slice(h2), ...right] } },
      ['a', 'b'],
    )
    const two = rounded(s2)
    expect(two.report.ok).toBe(true)
    expect(Math.abs(two.arc.r - R2)).toBeLessThan(Math.max(2 * two.sigma!, 0.05))
  })

  it('holds a radius given, and says why where no round fits', () => {
    const s = twoPieces({ piece: { kind: 'line', a: [0, 10], b: [20, 10] } }, { piece: { kind: 'line', a: [20, 10], b: [20, -10] } }, ['b', 'a'])
    const { report, arc: a, made } = rounded(s, 4)
    expect(report.ok).toBe(true)
    expect(made.dimension).toBeDefined()
    expect(a.r).toBeCloseTo(4, 6)
    const t = twoPieces({ piece: { kind: 'line', a: [0, 10], b: [20, 10] } }, { piece: { kind: 'line', a: [20, 10], b: [20, 8] } }, ['b', 'a'])
    expect(roundCorner(t.sketch, t.a, t.b, 5)).toMatch(/does not fit/)
    expect(roundCorner(t.sketch, t.a, t.a)).toMatch(/two lines or arcs/)
  })
})
