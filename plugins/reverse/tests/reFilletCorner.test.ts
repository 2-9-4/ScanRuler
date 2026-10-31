// SPDX-License-Identifier: AGPL-3.0-only
// The sketch's Fillet: a corner between two lines made round — the lines cut
// back to the tangent points, the arc between, the relations that hold it
// and the radius as a dimension — and the corner it can be asked for by.

import { describe, expect, it } from 'vitest'
import { sharpenCorner } from '../core/corners'
import { cornerLinesAt, filletLines } from '../core/filletCorner'
import { findRegions } from '../core/regions'
import { addConstraint, addEntity, addRectangle, anchorPoint, emptySketch, entityOf, type SketchArc, type SketchLine } from '../core/sketch'
import { solveSketch } from '../core/solver'
import { useReverse } from '../state/reStore'

/** Two lines meeting square at the origin, joined there. */
function corner() {
  const sketch = emptySketch()
  const a = addEntity(sketch, { kind: 'line', a: [10, 0], b: [0, 0] })
  const b = addEntity(sketch, { kind: 'line', a: [0, 0], b: [0, 8] })
  addConstraint(sketch, { kind: 'coincident', p: { entity: a, at: 'b' }, q: { entity: b, at: 'a' } })
  return { sketch, a, b }
}

describe('filletLines', () => {
  it('cuts both lines back and puts a tangent arc of the radius between them', () => {
    const { sketch, a, b } = corner()
    const made = filletLines(sketch, a, b, 2)
    expect(typeof made).toBe('object')
    if (typeof made === 'string') return
    const la = entityOf(sketch, a) as SketchLine
    const lb = entityOf(sketch, b) as SketchLine
    const arc = entityOf(sketch, made.arc) as SketchArc
    expect(la.b[0]).toBeCloseTo(2)
    expect(la.b[1]).toBeCloseTo(0)
    expect(lb.a[0]).toBeCloseTo(0)
    expect(lb.a[1]).toBeCloseTo(2)
    expect(arc.c[0]).toBeCloseTo(2)
    expect(arc.c[1]).toBeCloseTo(2)
    expect(arc.r).toBeCloseTo(2)
    expect(arc.sweep).toBeCloseTo(Math.PI / 2)
    // The arc's two ends are the two tangent points, whichever way it runs.
    const ends = [anchorPoint(arc, 'a'), anchorPoint(arc, 'b')]
    expect(ends.some((p) => Math.hypot(p[0] - 2, p[1]) < 1e-9)).toBe(true)
    expect(ends.some((p) => Math.hypot(p[0], p[1] - 2) < 1e-9)).toBe(true)
    // The sharp join is gone; two joins, two tangencies and the radius hold it.
    const kinds = sketch.constraints.map((c) => c.kind).sort()
    expect(kinds).toEqual(['coincident', 'coincident', 'radius', 'tangent', 'tangent'])
    expect(solveSketch(sketch).ok).toBe(true)
  })

  it('follows a typed radius through the solver, and sharpenCorner takes it out again', () => {
    const { sketch, a, b } = corner()
    const made = filletLines(sketch, a, b, 2)
    if (typeof made === 'string') throw new Error(made)
    sketch.constraints = sketch.constraints.map((c) => (c.id === made.dimension && 'value' in c ? { ...c, value: 3 } : c))
    expect(solveSketch(sketch).ok).toBe(true)
    expect((entityOf(sketch, made.arc) as SketchArc).r).toBeCloseTo(3, 4)
    expect(sharpenCorner(sketch, made.arc)).toBe(true)
    expect(sketch.entities).toHaveLength(2)
  })

  it('takes its radius from ends that stand off the corner, and replaces the chord between them', () => {
    const sketch = emptySketch()
    const a = addEntity(sketch, { kind: 'line', a: [10, 0], b: [3, 0] })
    const b = addEntity(sketch, { kind: 'line', a: [0, 3], b: [0, 8] })
    const chord = addEntity(sketch, { kind: 'line', a: [3, 0], b: [0, 3] })
    addConstraint(sketch, { kind: 'coincident', p: { entity: a, at: 'b' }, q: { entity: chord, at: 'a' } })
    addConstraint(sketch, { kind: 'coincident', p: { entity: chord, at: 'b' }, q: { entity: b, at: 'a' } })
    const made = filletLines(sketch, a, b)
    if (typeof made === 'string') throw new Error(made)
    expect(made.radius).toBeCloseTo(3)
    expect(entityOf(sketch, chord)).toBeUndefined()
    expect(sketch.entities).toHaveLength(3)
  })

  it('rounds a corner that is not square, on the inside of it', () => {
    const sketch = emptySketch()
    const a = addEntity(sketch, { kind: 'line', a: [0, 0], b: [10, 0] })
    const b = addEntity(sketch, { kind: 'line', a: [0, 0], b: [10, 10] })
    const made = filletLines(sketch, a, b, 1)
    if (typeof made === 'string') throw new Error(made)
    const arc = entityOf(sketch, made.arc) as SketchArc
    // On the bisector at 22.5°, a radius above the first line.
    expect(arc.c[1]).toBeCloseTo(1)
    expect(arc.c[0]).toBeCloseTo(1 / Math.tan(Math.PI / 8))
    expect(arc.sweep).toBeCloseTo(Math.PI - Math.PI / 4)
  })

  it('refuses in words and changes nothing: parallel lines, a round too large', () => {
    const sketch = emptySketch()
    const a = addEntity(sketch, { kind: 'line', a: [0, 0], b: [10, 0] })
    const b = addEntity(sketch, { kind: 'line', a: [0, 5], b: [10, 5] })
    expect(typeof filletLines(sketch, a, b, 1)).toBe('string')
    const c = corner()
    const before = JSON.stringify(c.sketch)
    expect(typeof filletLines(c.sketch, c.a, c.b, 50)).toBe('string')
    expect(JSON.stringify(c.sketch)).toBe(before)
  })

  it('keeps a rectangle one closed region', () => {
    const sketch = emptySketch()
    const ids = addRectangle(sketch, [0, 0], [20, 10])
    expect(typeof filletLines(sketch, ids[0], ids[1], 2)).toBe('object')
    expect(solveSketch(sketch).ok).toBe(true)
    expect(findRegions(sketch)).toHaveLength(1)
  })
})

describe('cornerLinesAt', () => {
  it('finds the two lines joined at an end, and nothing at a free end', () => {
    const { sketch, a, b } = corner()
    expect(cornerLinesAt(sketch, { entity: a, at: 'b' })?.sort()).toEqual([a, b].sort())
    expect(cornerLinesAt(sketch, { entity: a, at: 'a' })).toBeNull()
  })
})

describe('the Fillet tool in the store', () => {
  const frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] } as never
  const open = () => {
    useReverse.getState().reset()
    useReverse.getState().startSketch({ kind: 'coordinate', plane: 'xy' } as never, frame, [
      { kind: 'line', a: [10, 0], b: [0, 0] },
      { kind: 'line', a: [0, 0], b: [0, 8] },
    ])
  }

  it('rounds the two lines clicked one after the other, the radius selected for typing', () => {
    open()
    const re = useReverse.getState()
    re.setSketchTool('fillet')
    re.sketchClick([6, 0], 0.5, false)
    expect(useReverse.getState().sketchDraft?.selection).toHaveLength(1)
    re.sketchClick([0, 5], 0.5, false)
    const d = useReverse.getState().sketchDraft!
    expect(d.error).toBeNull()
    expect(d.sketch.entities.filter((e) => e.kind === 'arc')).toHaveLength(1)
    const dim = d.sketch.constraints.find((c) => c.id === d.selectedConstraint)
    expect(dim?.kind).toBe('radius')
    expect(d.tool).toBe('fillet')
    // One step back and the corner is sharp again.
    useReverse.getState().undoSketch()
    expect(useReverse.getState().sketchDraft?.sketch.entities).toHaveLength(2)
  })

  it('rounds a joined corner at a click on its point, and the selected pair from the key', () => {
    open()
    let d = useReverse.getState().sketchDraft!
    const [a, b] = d.sketch.entities.map((e) => e.id)
    addConstraint(d.sketch, { kind: 'coincident', p: { entity: a, at: 'b' }, q: { entity: b, at: 'a' } })
    useReverse.getState().setSketchTool('fillet')
    useReverse.getState().sketchClick([0.1, 0.1], 0.5, false)
    d = useReverse.getState().sketchDraft!
    expect(d.sketch.entities.filter((e) => e.kind === 'arc')).toHaveLength(1)

    open()
    useReverse.getState().sketchClick([6, 0], 0.5, false)
    useReverse.getState().sketchClick([0, 5], 0.5, false)
    expect(useReverse.getState().sketchDraft?.selection).toHaveLength(2)
    useReverse.getState().filletSelected()
    expect(useReverse.getState().sketchDraft?.sketch.entities.filter((e) => e.kind === 'arc')).toHaveLength(1)
  })
})

/** The worst angle, degrees, between a line and an arc where the two meet
 *  end to end — what a kink in the built face would be. */
function worstJointDeg(sketch: ReturnType<typeof emptySketch>): number {
  let worst = 0
  for (const c of sketch.constraints) {
    if (c.kind !== 'coincident') continue
    const p = entityOf(sketch, c.p.entity)
    const q = entityOf(sketch, c.q.entity)
    const pair = p?.kind === 'line' && q?.kind === 'arc' ? { line: p, arc: q, at: c.q.at } : p?.kind === 'arc' && q?.kind === 'line' ? { line: q, arc: p, at: c.p.at } : null
    if (!pair) continue
    const t = pair.at === 'a' ? pair.arc.start : pair.arc.start + pair.arc.sweep
    const d = [pair.line.b[0] - pair.line.a[0], pair.line.b[1] - pair.line.a[1]]
    const cos = Math.abs(Math.cos(t) * d[0] + Math.sin(t) * d[1]) / Math.hypot(d[0], d[1])
    worst = Math.max(worst, (Math.asin(Math.min(1, cos)) * 180) / Math.PI)
  }
  return worst
}

describe('a rounded corner the solve moves', () => {
  it('stays tangent to the micro-degree, not merely within a micron of it', () => {
    // A small rounded rectangle, its sides dimensioned to another size: the
    // solve walks every joint along its line. A tangency held as the line's
    // distance from the centre lets the joint slide off the tangent point
    // by the square root of what is left — a few hundredths of a degree.
    const sketch = emptySketch()
    const sides = addRectangle(sketch, [-2.95, -1.275], [2.95, 1.275])
    for (let i = 0; i < 4; i++) {
      const made = filletLines(sketch, sides[i], sides[(i + 1) % 4], 1.25, 1.275)
      if (typeof made === 'string') throw new Error(made)
    }
    addConstraint(sketch, { kind: 'length', entity: sides[0], value: 3.9 })
    addConstraint(sketch, { kind: 'length', entity: sides[1], value: 0.3 })
    const report = solveSketch(sketch)
    expect(report.ok).toBe(true)
    expect((entityOf(sketch, sides[0]) as SketchLine).b[0] - (entityOf(sketch, sides[0]) as SketchLine).a[0]).toBeCloseTo(3.9, 6)
    expect(worstJointDeg(sketch)).toBeLessThan(1e-4)
  })
})
