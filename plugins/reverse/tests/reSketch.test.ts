// SPDX-License-Identifier: AGPL-3.0-only
// The sketch behind the Reverse engineer workspace: the solver meeting hard
// relations while the soft slice data settles the rest, the segmentation of
// a slice chain into lines and arcs, corners inferred and a profile closed,
// and the regions a click picks.

import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import type { Vec2 } from '../../../src/core/flat/types'
import { closeChain, inferCorners, sharpenCorner } from '../core/corners'
import { datumTraces } from '../core/datums'
import { findRegions, loopGeometry, regionAt } from '../core/regions'
import { placeSegments, segmentChain } from '../core/segment'
import {
  addConstraint,
  addEntity,
  addRectangle,
  anchorPoint,
  axisRelationOf,
  emptySketch,
  entityOf,
  lineLength,
  type Sketch,
  type SketchArc,
  type SketchLine,
} from '../core/sketch'
import { measureDimension, solveSketch } from '../core/solver'
import { gaussian } from '../../../tests/helpers'

const line = (s: Sketch, id: number) => entityOf(s, id) as SketchLine
const arc = (s: Sketch, id: number) => entityOf(s, id) as SketchArc

describe('inferred axis relations', () => {
  it('a line within 3° of the sheet axes is meant level or upright', () => {
    expect(axisRelationOf([0, 0], [10, 0])).toBe('horizontal')
    expect(axisRelationOf([0, 0], [10, 0.5])).toBe('horizontal') // 2.9°
    expect(axisRelationOf([0, 0], [-10, 0.4])).toBe('horizontal')
    expect(axisRelationOf([0, 0], [0.3, 10])).toBe('vertical')
    expect(axisRelationOf([5, 5], [5, -5])).toBe('vertical')
  })

  it('a line further off gets none, and a line at five degrees is a line at five degrees', () => {
    expect(axisRelationOf([0, 0], [10, 0.6])).toBeNull() // 3.4°
    expect(axisRelationOf([0, 0], [10, Math.tan((5 * Math.PI) / 180) * 10])).toBeNull()
    expect(axisRelationOf([0, 0], [10, 10])).toBeNull()
    expect(axisRelationOf([1, 1], [1, 1])).toBeNull()
  })

  it('a rectangle’s sides carry the inferred mark, so the chips read alike', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [10, 5])
    const axes = s.constraints.filter((c) => c.kind === 'horizontal' || c.kind === 'vertical')
    expect(axes).toHaveLength(4)
    expect(axes.every((c) => c.inferred)).toBe(true)
  })
})

/** A rounded rectangle's outline as a slice chain would come back: `w` by
 *  `h` with corner radius `r`, a point every `step` mm, Gaussian noise of
 *  `noise` mm across the outline, closed with its first point repeated. */
function roundedRectChain(w: number, h: number, r: number, step: number, noise: number, seed = 3): Vec2[] {
  const rand = mulberry32(seed)
  const pts: Vec2[] = []
  const corners: [Vec2, number][] = [
    [[w - r, r], -Math.PI / 2],
    [[w - r, h - r], 0],
    [[r, h - r], Math.PI / 2],
    [[r, r], Math.PI],
  ]
  const straights: [Vec2, Vec2][] = [
    [
      [r, 0],
      [w - r, 0],
    ],
    [
      [w, r],
      [w, h - r],
    ],
    [
      [w - r, h],
      [r, h],
    ],
    [
      [0, h - r],
      [0, r],
    ],
  ]
  for (let side = 0; side < 4; side++) {
    const [a, b] = straights[side]
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    const nx = -(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])
    const ny = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1])
    for (let i = 0; i < n; i++) {
      const t = i / n
      const e = gaussian(rand) * noise
      pts.push([a[0] + (b[0] - a[0]) * t + nx * e, a[1] + (b[1] - a[1]) * t + ny * e])
    }
    const [c, start] = corners[side]
    const m = Math.max(2, Math.round((r * Math.PI) / 2 / step))
    for (let i = 0; i < m; i++) {
      const ang = start + ((Math.PI / 2) * i) / m
      const rr = r + gaussian(rand) * noise
      pts.push([c[0] + rr * Math.cos(ang), c[1] + rr * Math.sin(ang)])
    }
  }
  pts.push([pts[0][0], pts[0][1]])
  return pts
}

describe('the sketch solver', () => {
  it('meets typed lengths on a hand-drawn rectangle and keeps it square', () => {
    const s = emptySketch()
    const [bottom, right] = addRectangle(s, [0, 0], [30, 17])
    addConstraint(s, { kind: 'length', entity: bottom, value: 40 })
    addConstraint(s, { kind: 'length', entity: right, value: 25 })
    const report = solveSketch(s)
    expect(report.ok).toBe(true)
    expect(report.unmet).toEqual([])
    expect(report.redundant).toBe(0)
    expect(lineLength(line(s, bottom))).toBeCloseTo(40, 5)
    expect(lineLength(line(s, right))).toBeCloseTo(25, 5)
    // Corners still meet, sides still square.
    const b = line(s, bottom)
    const rgt = line(s, right)
    expect(b.b[0]).toBeCloseTo(rgt.a[0], 6)
    expect(b.b[1]).toBeCloseTo(rgt.a[1], 6)
    expect(Math.abs(b.b[1] - b.a[1])).toBeLessThan(1e-6)
    expect(Math.abs(rgt.b[0] - rgt.a[0])).toBeLessThan(1e-6)
  })

  it('reports a dimension that fights another instead of splitting the difference', () => {
    const s = emptySketch()
    const [bottom, , top] = addRectangle(s, [0, 0], [30, 17])
    addConstraint(s, { kind: 'length', entity: bottom, value: 40 })
    const clash = addConstraint(s, { kind: 'length', entity: top, value: 50 })
    const report = solveSketch(s)
    expect(report.ok).toBe(false)
    expect(report.unmet.map((u) => u.id)).toContain(clash)
    expect(report.unmet[0].residual).toBeGreaterThan(1)
  })

  it('counts a relation that says nothing new as redundant', () => {
    const s = emptySketch()
    const [bottom] = addRectangle(s, [0, 0], [30, 17])
    addConstraint(s, { kind: 'horizontal', entity: bottom })
    const report = solveSketch(s)
    expect(report.ok).toBe(true)
    expect(report.redundant).toBeGreaterThanOrEqual(1)
  })

  it('keeps a fitted line on its slice points while a coincidence pulls its end', () => {
    const s = emptySketch()
    const rand = mulberry32(5)
    const points: Vec2[] = Array.from({ length: 60 }, (_, i) => [i * 0.5, 10 + gaussian(rand) * 0.02])
    const fitted = addEntity(s, { kind: 'line', a: [0, 10.3], b: [29.5, 9.8], points, scatter: 0.02 })
    const post = addEntity(s, { kind: 'line', a: [40, 0], b: [40, 20] })
    addConstraint(s, { kind: 'coincident', p: { entity: fitted, at: 'b' }, q: { entity: post, at: 'a' } })
    const report = solveSketch(s)
    expect(report.ok).toBe(true)
    const l = line(s, fitted)
    // The line lies on its points…
    expect(l.a[1]).toBeCloseTo(10, 1)
    expect(l.b[1]).toBeCloseTo(10, 1)
    // …and reaches the post, which came to meet it rather than the line
    // leaving its points.
    expect(l.b[0]).toBeCloseTo(line(s, post).a[0], 6)
    expect(l.b[1]).toBeCloseTo(line(s, post).a[1], 6)
    expect(report.softRms).toBeLessThan(0.03)
  })

  it('meets a relation exactly however far the hand drags against it', () => {
    // A rectangle whose left side stands on the YZ plane's line, dragged
    // bodily 60 mm off it and its top-left corner pulled 60 mm away: the
    // hand bends the relations by a ten-thousandth of the drag while it
    // holds, and nothing may be left off once it lets go — the plane
    // relation, the coincidences at the corners, all met.
    const traces = datumTraces({ origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    const build = () => {
      const s = emptySketch()
      const [bottom, right, top, left] = addRectangle(s, [0, 0], [30, 20])
      addConstraint(s, { kind: 'horizontal', entity: bottom })
      addConstraint(s, { kind: 'vertical', entity: right })
      addConstraint(s, { kind: 'horizontal', entity: top })
      addConstraint(s, { kind: 'vertical', entity: left })
      addConstraint(s, { kind: 'pointOn', p: { entity: left, at: 'a' }, on: { datum: 'yz' } })
      return { s, top, left }
    }
    const body = build()
    const l = line(body.s, body.left)
    body.s.entities = body.s.entities.map((e) => (e.id === body.left ? { ...l, a: [60, l.a[1]] as Vec2, b: [60, l.b[1]] as Vec2 } : e))
    const pulls = (['a', 'b'] as const).map((at) => ({ anchor: { entity: body.left, at }, to: anchorPoint(line(body.s, body.left), at) }))
    for (const quick of [true, false]) {
      const report = solveSketch(body.s, { pull: pulls, quick, datums: traces })
      expect(report.unmet).toEqual([])
      expect(Math.abs(line(body.s, body.left).a[0])).toBeLessThan(1e-6)
    }

    const corner = build()
    const t = line(corner.s, corner.top)
    const to: Vec2 = [t.b[0] - 60, t.b[1] + 60]
    corner.s.entities = corner.s.entities.map((e) => (e.id === corner.top ? { ...t, b: to } : e))
    const report = solveSketch(corner.s, { pull: [{ anchor: { entity: corner.top, at: 'b' }, to }], datums: traces })
    expect(report.unmet).toEqual([])
    // The corner went as far as the plane lets it: straight up.
    expect(line(corner.s, corner.top).b[0]).toBeCloseTo(0, 6)
    expect(line(corner.s, corner.top).b[1]).toBeCloseTo(80, 3)
  })

  it('holds a line tangent to an arc and an arc to a typed radius', () => {
    const s = emptySketch()
    const l = addEntity(s, { kind: 'line', a: [0, 0], b: [20, 0.4] })
    const a = addEntity(s, { kind: 'arc', c: [25, 5], r: 4.7, start: -Math.PI / 2, sweep: Math.PI / 2 })
    addConstraint(s, { kind: 'coincident', p: { entity: l, at: 'b' }, q: { entity: a, at: 'a' } })
    addConstraint(s, { kind: 'tangent', a: l, b: a })
    addConstraint(s, { kind: 'radius', entity: a, value: 5 })
    addConstraint(s, { kind: 'horizontal', entity: l })
    const report = solveSketch(s)
    expect(report.ok).toBe(true)
    const ar = arc(s, a)
    expect(ar.r).toBeCloseTo(5, 4)
    // Tangent at the join: the arc's centre is one radius above the line.
    expect(ar.c[1] - line(s, l).a[1]).toBeCloseTo(5, 4)
    const join = anchorPoint(ar, 'a')
    expect(join[0]).toBeCloseTo(line(s, l).b[0], 4)
  })

  it('holds a circle at half its typed diameter', () => {
    const s = emptySketch()
    const c = addEntity(s, { kind: 'circle', c: [3, 4], r: 4.6 })
    addConstraint(s, { kind: 'diameter', entity: c, value: 10 })
    const report = solveSketch(s)
    expect(report.ok).toBe(true)
    const circle = s.entities.find((e) => e.id === c)
    expect(circle?.kind === 'circle' && circle.r).toBeCloseTo(5, 6)
    expect(measureDimension(s, 'diameter', circle!)).toBeCloseTo(10, 6)
  })
})

describe('coincidence with a piece and with the axes', () => {
  // A sketch on the XY plane: the YZ plane's line is x = 0, the ZX
  // plane's y = 0.
  const traces = datumTraces({ origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })

  it('holds a point on a line, on a circle’s rim and on a coordinate plane’s line', () => {
    const s = emptySketch()
    const base = addEntity(s, { kind: 'line', a: [0, 0], b: [40, 0], fixed: true })
    const ring = addEntity(s, { kind: 'circle', c: [60, 0], r: 5, fixed: true })
    const pt = addEntity(s, { kind: 'point', p: [12, 3] })
    addConstraint(s, { kind: 'pointOn', p: { entity: pt, at: 'center' }, on: { line: base } })
    expect(solveSketch(s).ok).toBe(true)
    expect((entityOf(s, pt) as { p: Vec2 }).p[1]).toBeCloseTo(0, 6)
    const onRim = addEntity(s, { kind: 'point', p: [66, 1] })
    addConstraint(s, { kind: 'pointOn', p: { entity: onRim, at: 'center' }, on: { curve: ring } })
    expect(solveSketch(s).ok).toBe(true)
    const q = (entityOf(s, onRim) as { p: Vec2 }).p
    expect(Math.hypot(q[0] - 60, q[1])).toBeCloseTo(5, 5)
    const onAxis = addEntity(s, { kind: 'line', a: [3, 10], b: [3, 30] })
    addConstraint(s, { kind: 'pointOn', p: { entity: onAxis, at: 'a' }, on: { datum: 'yz' } })
    expect(solveSketch(s, { datums: traces }).ok).toBe(true)
    expect(line(s, onAxis).a[0]).toBeCloseTo(0, 6)
  })

  it('lays a line along another line and along a coordinate plane’s line', () => {
    const s = emptySketch()
    const base = addEntity(s, { kind: 'line', a: [0, 5], b: [40, 5], fixed: true })
    const loose = addEntity(s, { kind: 'line', a: [50, 7], b: [70, 9] })
    addConstraint(s, { kind: 'collinear', line: loose, on: { line: base } })
    expect(solveSketch(s).ok).toBe(true)
    expect(line(s, loose).a[1]).toBeCloseTo(5, 6)
    expect(line(s, loose).b[1]).toBeCloseTo(5, 6)
    const upright = addEntity(s, { kind: 'line', a: [2, 10], b: [3, 30] })
    addConstraint(s, { kind: 'collinear', line: upright, on: { datum: 'yz' } })
    expect(solveSketch(s, { datums: traces }).ok).toBe(true)
    expect(line(s, upright).a[0]).toBeCloseTo(0, 6)
    expect(line(s, upright).b[0]).toBeCloseTo(0, 6)
  })

  it('says which pieces are still loose, and none once a rectangle is pinned to the axes and dimensioned', () => {
    const s = emptySketch()
    const [bottom, right, top, left] = addRectangle(s, [2, 3], [32, 20])
    const report = solveSketch(s, { datums: traces })
    expect(report.underConstrained.sort()).toEqual([bottom, right, top, left].sort())
    // The corner on the origin, the sides dimensioned: nothing moves.
    addConstraint(s, { kind: 'pointOn', p: { entity: bottom, at: 'a' }, on: { datum: 'yz' } })
    addConstraint(s, { kind: 'pointOn', p: { entity: bottom, at: 'a' }, on: { datum: 'zx' } })
    expect(solveSketch(s, { datums: traces }).underConstrained.length).toBe(4)
    addConstraint(s, { kind: 'length', entity: bottom, value: 30 })
    addConstraint(s, { kind: 'length', entity: right, value: 17 })
    const pinned = solveSketch(s, { datums: traces })
    expect(pinned.ok).toBe(true)
    expect(pinned.underConstrained).toEqual([])
    // A fitted piece is held by the scan; a free line hung on it is
    // pinned by that alone.
    const t = emptySketch()
    const fitted = addEntity(t, { kind: 'line', a: [0, 0], b: [10, 0], points: [[0, 0], [5, 0], [10, 0]], scatter: 0.05 })
    const hung = addEntity(t, { kind: 'line', a: [10, 0], b: [10, 8] })
    addConstraint(t, { kind: 'coincident', p: { entity: hung, at: 'a' }, q: { entity: fitted, at: 'b' } })
    expect(solveSketch(t).underConstrained).toEqual([hung])
    addConstraint(t, { kind: 'vertical', entity: hung })
    addConstraint(t, { kind: 'length', entity: hung, value: 8 })
    expect(solveSketch(t).underConstrained).toEqual([])
  })
})

describe('segmenting a slice chain', () => {
  it('cuts a rounded rectangle into four lines and four arcs', () => {
    const chain = roundedRectChain(60, 40, 5, 0.25, 0.03)
    const cut = segmentChain(chain)
    expect(cut.closed).toBe(true)
    const lines = cut.segments.filter((s) => s.kind === 'line')
    const arcs = cut.segments.filter((s) => s.kind === 'arc')
    expect(lines.length).toBe(4)
    expect(arcs.length).toBe(4)
    for (const a of arcs) {
      const fit = a.fit as { radius: number }
      expect(fit.radius).toBeCloseTo(5, 0)
    }
    // Lines and arcs alternate round the outline.
    for (let i = 0; i < cut.segments.length; i++) {
      expect(cut.segments[i].kind).not.toBe(cut.segments[(i + 1) % cut.segments.length].kind)
    }
  })

  it('cuts a sharp rectangle into four lines', () => {
    const chain = roundedRectChain(50, 30, 0.001, 0.25, 0.02)
    const cut = segmentChain(chain)
    expect(cut.segments.filter((s) => s.kind === 'line').length).toBe(4)
    expect(cut.segments.length).toBe(4)
  })

  it('reads a circle as one arc that corner inference closes into a circle', () => {
    const rand = mulberry32(9)
    const chain: Vec2[] = []
    for (let i = 0; i < 360; i++) {
      const a = (i * Math.PI) / 180
      const r = 12 + gaussian(rand) * 0.02
      chain.push([r * Math.cos(a), r * Math.sin(a)])
    }
    chain.push(chain[0])
    const cut = segmentChain(chain)
    expect(cut.segments.length).toBe(1)
    expect(cut.segments[0].kind).toBe('arc')
    const s = emptySketch()
    const placed = placeSegments(s, cut)
    inferCorners(s, placed, cut.closed)
    expect(s.entities[0].kind).toBe('circle')
    expect((s.entities[0] as { r: number }).r).toBeCloseTo(12, 1)
  })

  it('takes a coarser tolerance as fewer, longer pieces', () => {
    const chain = roundedRectChain(60, 40, 1.2, 0.25, 0.03)
    const fine = segmentChain(chain, { tolerance: 0.05 })
    const coarse = segmentChain(chain, { tolerance: 1.0 })
    expect(coarse.segments.length).toBeLessThan(fine.segments.length)
    expect(coarse.segments.length).toBe(4)
  })
})

describe('inferring corners and closing', () => {
  it('joins a rounded rectangle at eight tangent corners into one solvable loop', () => {
    const chain = roundedRectChain(60, 40, 5, 0.25, 0.03)
    const cut = segmentChain(chain)
    const s = emptySketch()
    const placed = placeSegments(s, cut)
    const report = inferCorners(s, placed, cut.closed)
    expect(report.joined).toBe(8)
    expect(report.tangent).toBe(8)
    expect(report.open).toBe(0)
    const solved = solveSketch(s)
    expect(solved.ok).toBe(true)
    // The pieces sit on their points to the noise, give or take the points
    // near a corner that fell to the wrong side of the cut.
    expect(solved.softRms).toBeLessThan(0.08)
    // Every coincidence met: the loop closes.
    for (const c of s.constraints) {
      if (c.kind !== 'coincident') continue
      const p = anchorPoint(entityOf(s, c.p.entity)!, c.p.at)
      const q = anchorPoint(entityOf(s, c.q.entity)!, c.q.at)
      expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-4)
    }
    // And it is one region of the rectangle's area, less the corners.
    const regions = findRegions(s)
    expect(regions.length).toBe(1)
    expect(regions[0].area).toBeCloseTo(60 * 40 - (4 - Math.PI) * 25, 0)
  })

  it('carries two lines on to their corner, and bridges what it cannot meet', () => {
    // Three sides of a box, each stopping 4 mm short of the corners — a trace
    // whose fits stopped at the blends.
    const s = emptySketch()
    const a = addEntity(s, { kind: 'line', a: [4, 0], b: [46, 0] })
    const b = addEntity(s, { kind: 'line', a: [50, 4], b: [50, 26] })
    const c = addEntity(s, { kind: 'line', a: [46, 30], b: [4, 30] })
    const order = [
      { id: a, from: 'a' as const, to: 'b' as const },
      { id: b, from: 'a' as const, to: 'b' as const },
      { id: c, from: 'a' as const, to: 'b' as const },
    ]
    // Gaps of 5.7 mm: nothing is a corner at 2 mm.
    const inferred = inferCorners(s, order, false)
    expect(inferred.joined).toBe(0)
    expect(inferred.open).toBe(2)
    const closed = closeChain(s, order)
    expect(closed).toBe(3)
    // The two corners were carried to their intersections…
    const near = (p: Vec2, q: Vec2) => expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-9)
    near(line(s, a).b, [50, 0])
    near(line(s, b).a, [50, 0])
    near(line(s, c).a, [50, 30])
    // …and the open side got a straight bridge.
    expect(s.entities.length).toBe(4)
    const bridge = s.entities[3] as SketchLine
    expect(bridge.kind).toBe('line')
    expect(bridge.a).toEqual([4, 30])
    expect(bridge.b).toEqual([4, 0])
    expect(solveSketch(s).ok).toBe(true)
    expect(findRegions(s).length).toBe(1)
  })

  it('makes a fillet sharp by carrying its sides to the corner', () => {
    const chain = roundedRectChain(60, 40, 5, 0.25, 0.02)
    const cut = segmentChain(chain)
    const s = emptySketch()
    const placed = placeSegments(s, cut)
    inferCorners(s, placed, cut.closed)
    const fillet = s.entities.find((e) => e.kind === 'arc')!
    expect(sharpenCorner(s, fillet.id)).toBe(true)
    expect(s.entities.filter((e) => e.kind === 'arc').length).toBe(3)
    const solved = solveSketch(s)
    expect(solved.ok).toBe(true)
    const regions = findRegions(s)
    expect(regions.length).toBe(1)
    expect(regions[0].area).toBeCloseTo(60 * 40 - (3 * (4 - Math.PI) * 25) / 4, 0)
  })
})

describe('regions', () => {
  it('finds a rectangle with a hole in it and hands the kernel exact geometry', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [40, 20])
    const hole = addEntity(s, { kind: 'circle', c: [20, 10], r: 4 })
    const regions = findRegions(s)
    expect(regions.length).toBe(2)
    const [outer, inner] = regions
    expect(outer.holes.length).toBe(1)
    expect(outer.area).toBeCloseTo(800 - Math.PI * 16, 0)
    expect(inner.holes.length).toBe(0)
    expect(inner.area).toBeCloseTo(Math.PI * 16, 0)
    // A click in the ring is the ring; in the hole it is the disc.
    expect(regionAt(regions, [5, 5])).toBe(outer)
    expect(regionAt(regions, [20, 10])).toBe(inner)
    expect(regionAt(regions, [60, 5])).toBeNull()
    const geometry = loopGeometry(outer.outer, s)
    expect(geometry.map((g) => g.kind)).toEqual(['line', 'line', 'line', 'line'])
    const holeGeometry = loopGeometry(outer.holes[0], s)
    expect(holeGeometry).toEqual([{ kind: 'circle', c: [20, 10], r: 4 }])
    expect(hole).toBeGreaterThan(0)
  })

  it('splits crossing lines into their regions and ignores dangling pieces', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [40, 20])
    // A line across the middle, overhanging both sides.
    addEntity(s, { kind: 'line', a: [-5, 10], b: [45, 10] })
    // A dangling stub inside.
    addEntity(s, { kind: 'line', a: [10, 12], b: [15, 15] })
    const regions = findRegions(s)
    expect(regions.length).toBe(2)
    expect(regions[0].area).toBeCloseTo(400, 5)
    expect(regions[1].area).toBeCloseTo(400, 5)
    const lower = regionAt(regions, [20, 5])!
    expect(lower.outer.pieces.length).toBe(4)
    const geometry = loopGeometry(lower.outer, s)
    // The dividing line's stretch is exactly the part inside the box.
    const across = geometry.filter((g) => g.kind === 'line' && Math.abs(g.a[1] - 10) < 1e-9 && Math.abs(g.b[1] - 10) < 1e-9)
    expect(across.length).toBe(1)
    const seg = across[0] as { a: Vec2; b: Vec2 }
    expect(Math.min(seg.a[0], seg.b[0])).toBeCloseTo(0, 6)
    expect(Math.max(seg.a[0], seg.b[0])).toBeCloseTo(40, 6)
  })
})
