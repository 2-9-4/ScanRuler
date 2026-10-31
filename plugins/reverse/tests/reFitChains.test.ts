// SPDX-License-Identifier: AGPL-3.0-only
// Fit all chains on the things a real slice does that a clean outline does
// not: walls that wander by several times the noise, a blob in a corner, the
// riser of a small step — and the options the fit takes: the detail
// setting, corners joined in the same step, lines laid along the sheet's
// axes, and a refit of what was fitted.

import { beforeEach, describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import type { FlatArcFit, FlatLineFit, Vec2 } from '../../../src/core/flat/types'
import { alignToAxes, mergeAlignedLines } from '../core/axisAlign'
import { inferCorners } from '../core/corners'
import { DEFAULT_FIT_OPTIONS, sanitizeFitOptions } from '../core/fitOptions'
import { detailLevels, placeSegments, segmentChain } from '../core/segment'
import { addEntity, anchorPoint, emptySketch, entityOf, type SketchLine } from '../core/sketch'
import { solveSketch } from '../core/solver'
import type { SectionFrame } from '../../../src/core/section/frame'
import { useReverse } from '../state/reStore'
import { gaussian } from '../../../tests/helpers'

type Piece = { kind: 'line'; to: Vec2 } | { kind: 'arc'; to: Vec2; center: Vec2 }

/**
 * A closed outline walked from `start` through lines and quarter-turn arcs,
 * a point every `step` mm, with Gaussian noise across it and, on top, a
 * `wander` of the given amplitude and wavelength along every line — what a
 * bowed sheet-metal wall does. Closed with its first point repeated.
 */
function outline(start: Vec2, pieces: Piece[], opts: { step?: number; noise?: number; wander?: number; wavelength?: number; seed?: number } = {}): Vec2[] {
  const { step = 0.15, noise = 0.008, wander = 0, wavelength = 24, seed = 5 } = opts
  const rand = mulberry32(seed)
  const pts: Vec2[] = []
  let at = start
  for (const p of pieces) {
    if (p.kind === 'line') {
      const dx = p.to[0] - at[0]
      const dy = p.to[1] - at[1]
      const len = Math.hypot(dx, dy)
      const n = Math.max(1, Math.round(len / step))
      for (let i = 0; i < n; i++) {
        const s = (i / n) * len
        // The wander fades to nothing at both ends, so corners stay put.
        const e = gaussian(rand) * noise + wander * Math.sin((2 * Math.PI * s) / wavelength) * Math.sin((Math.PI * s) / len)
        pts.push([at[0] + (dx * s) / len - (dy / len) * e, at[1] + (dy * s) / len + (dx / len) * e])
      }
    } else {
      const r = Math.hypot(at[0] - p.center[0], at[1] - p.center[1])
      const a0 = Math.atan2(at[1] - p.center[1], at[0] - p.center[0])
      let a1 = Math.atan2(p.to[1] - p.center[1], p.to[0] - p.center[0])
      // The short way round.
      while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI
      while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI
      const n = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / step))
      for (let i = 0; i < n; i++) {
        const a = a0 + ((a1 - a0) * i) / n
        const rr = r + gaussian(rand) * noise
        pts.push([p.center[0] + rr * Math.cos(a), p.center[1] + rr * Math.sin(a)])
      }
    }
    at = p.to
  }
  pts.push(pts[0])
  return pts
}

/** A long thin rounded rectangle, `w` by `h`, corner radius `r`. */
function roundedBar(w: number, h: number, r: number, opts: Parameters<typeof outline>[2] = {}): Vec2[] {
  return outline(
    [r, 0],
    [
      { kind: 'line', to: [w - r, 0] },
      { kind: 'arc', to: [w, r], center: [w - r, r] },
      { kind: 'line', to: [w, h - r] },
      { kind: 'arc', to: [w - r, h], center: [w - r, h - r] },
      { kind: 'line', to: [r, h] },
      { kind: 'arc', to: [0, h - r], center: [r, h - r] },
      { kind: 'line', to: [0, r] },
      { kind: 'arc', to: [r, 0], center: [r, r] },
    ],
    opts,
  )
}

const lineSpan = (l: SketchLine) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])
const lines = (cut: ReturnType<typeof segmentChain>) => cut.segments.filter((s) => s.kind === 'line')
const arcs = (cut: ReturnType<typeof segmentChain>) => cut.segments.filter((s) => s.kind === 'arc')

describe('fitting a chain whose walls wander', () => {
  it('keeps every fillet of a long bar whose sides bow by many times the noise', () => {
    // Sides of 85 mm that wander by ±0.12 mm at a noise of 0.008: on the
    // σ of the whole run a side takes half a fillet on board and hardly
    // notices, and the round goes missing.
    const chain = roundedBar(90, 18, 2.5, { wander: 0.12 })
    const cut = segmentChain(chain)
    expect(arcs(cut)).toHaveLength(4)
    expect(lines(cut)).toHaveLength(4)
    for (const a of arcs(cut)) {
      expect((a.fit as FlatArcFit).radius).toBeGreaterThan(2.2)
      expect((a.fit as FlatArcFit).radius).toBeLessThan(2.8)
    }
    // No side runs on past its corner: each line ends within the fillet's
    // reach of where the straight ends.
    for (const l of lines(cut)) expect((l.fit as FlatLineFit).length).toBeLessThan(86)
  })

  it('reads a bowed wall as a line, not as an arc of a hundred millimetres', () => {
    const chain = roundedBar(90, 18, 2.5, { wander: 0.12, wavelength: 170 })
    const cut = segmentChain(chain)
    for (const a of arcs(cut)) expect((a.fit as FlatArcFit).radius).toBeLessThan(5)
  })

  it('gives more pieces the finer the detail, and the fillets at every setting', () => {
    const chain = roundedBar(90, 18, 2.5, { wander: 0.2, wavelength: 18 })
    const coarse = segmentChain(chain, { detail: 0 })
    const fine = segmentChain(chain, { detail: 1 })
    expect(coarse.segments.length).toBe(8)
    expect(fine.segments.length).toBeGreaterThan(coarse.segments.length)
    for (const cut of [coarse, fine]) {
      const rounds = arcs(cut).filter((a) => (a.fit as FlatArcFit).radius < 3.5 && (a.fit as FlatArcFit).sweep > 1)
      expect(rounds).toHaveLength(4)
    }
  })

  it('reads the detail setting as a wave tolerance between one and five noise tolerances', () => {
    expect(detailLevels(0.1, 1).wave).toBeCloseTo(0.1, 9)
    expect(detailLevels(0.1, 0.5).wave).toBeCloseTo(0.3, 9)
    expect(detailLevels(0.1, 0.75).wave).toBeCloseTo(0.1 * Math.sqrt(3), 9)
    expect(detailLevels(0.1, 0.25).wave).toBeCloseTo(0.4, 9)
    expect(detailLevels(0.1, 0).wave).toBeCloseTo(0.5, 9)
    expect(detailLevels(0.1, 0).arc).toBeCloseTo(0.1, 9)
  })
})

describe('what is not a piece', () => {
  it('cuts a blob out of a corner and lets the sides make the corner', () => {
    // A sharp rectangle with weld spatter in one corner: the chain leaves
    // the bottom side 1.6 mm short of the corner, runs a lumpy ramp across
    // and joins the right side 1.6 mm up.
    const w = 60
    const h = 30
    const chain = outline([0, 0], [
      { kind: 'line', to: [w - 1.6, 0] },
      { kind: 'line', to: [w - 1.3, 0.55] },
      { kind: 'line', to: [w - 0.9, 0.45] },
      { kind: 'line', to: [w - 0.55, 1.0] },
      { kind: 'line', to: [w - 0.5, 1.45] },
      { kind: 'line', to: [w, 1.6] },
      { kind: 'line', to: [w, h] },
      { kind: 'line', to: [0, h] },
      { kind: 'line', to: [0, 0] },
    ])
    const cut = segmentChain(chain)
    expect(cut.segments).toHaveLength(4)
    expect(cut.segments.filter((s) => s.cornerAfter)).toHaveLength(1)
    const sketch = emptySketch()
    const order = placeSegments(sketch, cut)
    const report = inferCorners(sketch, order, cut.closed)
    expect(report.joined).toBe(4)
    expect(report.open).toBe(0)
    expect(solveSketch(sketch).ok).toBe(true)
    // The corner is where the sides cross, not on the blob.
    const bottom = order.find((p) => p.joinNext)!
    const corner = anchorPoint(entityOf(sketch, bottom.id)!, bottom.to)
    expect(corner[0]).toBeCloseTo(w, 1)
    expect(corner[1]).toBeCloseTo(0, 1)
  })

  it('keeps the riser of a small step as a line, not half a turn of an arc', () => {
    // A 1.3 mm step in the top side, its two corners rounded as a scanner
    // rounds them: a circle fits the S well enough to pass on its σ.
    const r = 0.3
    const chain = outline([0, 0], [
      { kind: 'line', to: [60, 0] },
      { kind: 'line', to: [60, 30] },
      { kind: 'line', to: [35 + r, 30] },
      { kind: 'arc', to: [35, 30 - r], center: [35 + r, 30 - r] },
      { kind: 'line', to: [35, 28.7 + r] },
      { kind: 'arc', to: [35 - r, 28.7], center: [35 - r, 28.7 + r] },
      { kind: 'line', to: [0, 28.7] },
      { kind: 'line', to: [0, 0] },
    ])
    const cut = segmentChain(chain)
    for (const a of arcs(cut)) expect((a.fit as FlatArcFit).sweep).toBeLessThan((120 * Math.PI) / 180)
    const risers = lines(cut).filter((l) => Math.abs((l.fit as FlatLineFit).dir[1]) > 0.95 && (l.fit as FlatLineFit).length < 2)
    expect(risers).toHaveLength(1)
    // And the two levels either side of it stay two lines.
    const tops = lines(cut).filter((l) => Math.abs((l.fit as FlatLineFit).dir[0]) > 0.99 && (l.fit as FlatLineFit).center[1] > 28)
    expect(tops).toHaveLength(2)
  })
})

describe('laying fitted lines along the axes', () => {
  it('makes a line within the angle level or upright and leaves the rest', () => {
    const s = emptySketch()
    const level = addEntity(s, { kind: 'line', a: [0, 0], b: [50, 0.5] }) // 0.6°
    const upright = addEntity(s, { kind: 'line', a: [50, 0.5], b: [49.4, 30] }) // 1.2° off
    const slanted = addEntity(s, { kind: 'line', a: [0, 0], b: [20, 3] }) // 8.5°
    const report = alignToAxes(s, [level, upright, slanted], { degrees: 3 })
    expect(report).toEqual({ horizontal: 1, vertical: 1, diagonal: 0 })
    const kinds = s.constraints.map((c) => c.kind).sort()
    expect(kinds).toEqual(['horizontal', 'vertical'])
    expect(s.constraints.every((c) => c.inferred)).toBe(true)
    const l = entityOf(s, level) as SketchLine
    expect(l.a[1]).toBeCloseTo(l.b[1], 9)
    // The direction it was drawn in is kept.
    expect(l.b[0]).toBeGreaterThan(l.a[0])
    // A second pass adds nothing.
    expect(alignToAxes(s, [level, upright, slanted], { degrees: 3 })).toEqual({ horizontal: 0, vertical: 0, diagonal: 0 })
  })

  it('holds a line near 45° at it against an aligned line, when asked', () => {
    const s = emptySketch()
    const level = addEntity(s, { kind: 'line', a: [0, 0], b: [50, 0.2] })
    const diagonal = addEntity(s, { kind: 'line', a: [50, 0.2], b: [60, 10.6] }) // 46.1°
    expect(alignToAxes(s, [level, diagonal], { degrees: 3 }).diagonal).toBe(0)
    expect(alignToAxes(s, [level, diagonal], { degrees: 3, diagonals: true }).diagonal).toBe(1)
    const angle = s.constraints.find((c) => c.kind === 'angle')
    expect(angle && 'value' in angle && [45, 135]).toContain(angle && 'value' in angle ? angle.value : null)
    expect(solveSketch(s).ok).toBe(true)
    const d = entityOf(s, diagonal) as SketchLine
    expect(Math.abs(d.b[1] - d.a[1])).toBeCloseTo(Math.abs(d.b[0] - d.a[0]), 3)
  })
})

describe('the pieces of one aligned wall', () => {
  it('become one line, and a fine fit of a wandering bar still solves when aligned', () => {
    const chain = roundedBar(90, 18, 2.5, { wander: 0.12, wavelength: 30 })
    const cut = segmentChain(chain, { detail: 1 })
    const s = emptySketch()
    let order = placeSegments(s, cut)
    expect(order.length).toBeGreaterThan(8)
    alignToAxes(s, order.map((p) => p.id), { degrees: 3 })
    order = mergeAlignedLines(s, order, cut.closed, 0.6)
    expect(order).toHaveLength(8)
    expect(s.entities).toHaveLength(8)
    // The merged side runs the whole length and carries every piece's points.
    const sides = s.entities.filter((e): e is SketchLine => e.kind === 'line' && lineSpan(e) > 80)
    expect(sides).toHaveLength(2)
    for (const side of sides) expect(side.points!.length).toBeGreaterThan(500)
    const report = inferCorners(s, order, cut.closed)
    expect(report.open).toBe(0)
    expect(solveSketch(s).ok).toBe(true)
  })

  it('leaves two level lines a step apart as two', () => {
    const s = emptySketch()
    const a = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] })
    const b = addEntity(s, { kind: 'line', a: [10, 1.2], b: [20, 1.2] })
    const order = [
      { id: a, from: 'a' as const, to: 'b' as const },
      { id: b, from: 'a' as const, to: 'b' as const },
    ]
    alignToAxes(s, [a, b])
    expect(mergeAlignedLines(s, order, false, 0.6)).toHaveLength(2)
  })
})

describe('the fit options', () => {
  it('come back valid from whatever was stored', () => {
    expect(sanitizeFitOptions(null)).toEqual(DEFAULT_FIT_OPTIONS)
    expect(sanitizeFitOptions({ detail: 7, alignAxes: 'yes', alignDegrees: 0 })).toEqual({ ...DEFAULT_FIT_OPTIONS, detail: 1, alignDegrees: 0.5 })
  })
})

describe('fitting and refitting in the store', () => {
  const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  const s = () => useReverse.getState()
  const draft = () => s().sketchDraft!

  beforeEach(() => {
    useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, sketchDraft: null })
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  })

  it('fits a closed chain into a closed profile in one step', () => {
    const chain = roundedBar(90, 18, 2.5, { wander: 0.12 })
    s().autoFit([chain], 'all', DEFAULT_FIT_OPTIONS)
    expect(draft().sketch.entities).toHaveLength(8)
    expect(draft().sketch.constraints.filter((c) => c.kind === 'coincident')).toHaveLength(8)
    expect(draft().sketch.constraints.filter((c) => c.kind === 'tangent')).toHaveLength(8)
    expect(draft().found.length).toBe(1)
    // Infer corners afterwards finds nothing to do, and says nothing.
    s().inferAllCorners()
    expect(draft().error).toBeNull()
  })

  it('leaves the corners open when asked to', () => {
    const chain = roundedBar(90, 18, 2.5)
    s().autoFit([chain], 'all', { ...DEFAULT_FIT_OPTIONS, joinCorners: false })
    expect(draft().sketch.constraints).toHaveLength(0)
    expect(draft().found.length).toBe(0)
  })

  it('lays the sides along the axes when asked to', () => {
    // The bar turned by one degree: every side is off level or upright.
    const c = Math.cos(Math.PI / 180)
    const k = Math.sin(Math.PI / 180)
    const chain = roundedBar(90, 18, 2.5).map((p): Vec2 => [p[0] * c - p[1] * k, p[0] * k + p[1] * c])
    s().autoFit([chain], 'all', { ...DEFAULT_FIT_OPTIONS, alignAxes: true })
    expect(draft().sketch.constraints.filter((x) => x.kind === 'horizontal')).toHaveLength(2)
    expect(draft().sketch.constraints.filter((x) => x.kind === 'vertical')).toHaveLength(2)
    expect(draft().report?.ok).toBe(true)
    for (const e of draft().sketch.entities) {
      if (e.kind !== 'line') continue
      expect(Math.min(Math.abs(e.b[0] - e.a[0]), Math.abs(e.b[1] - e.a[1]))).toBeLessThan(1e-3) // the solver's own measure of met
    }
  })

  it('refits with other options as one step that undo takes back whole', () => {
    const chain = roundedBar(90, 18, 2.5, { wander: 0.2, wavelength: 18 })
    s().autoFit([chain], 'all', { ...DEFAULT_FIT_OPTIONS, detail: 1 })
    const fine = draft().sketch.entities.map((e) => e.id)
    expect(fine.length).toBeGreaterThan(8)
    s().refitChains([chain], { ...DEFAULT_FIT_OPTIONS, detail: 0 })
    expect(draft().sketch.entities).toHaveLength(8)
    expect(draft().sketch.entities.some((e) => fine.includes(e.id))).toBe(false)
    expect(Object.keys(draft().fitted)).toEqual(['0'])
    s().undoSketch()
    expect(draft().sketch.entities.map((e) => e.id)).toEqual(fine)
    // Still fitted, by the pieces that came back: Fit would not fit it twice.
    expect(draft().fitted[0].order.map((p) => p.id)).toEqual(fine)
  })
})
