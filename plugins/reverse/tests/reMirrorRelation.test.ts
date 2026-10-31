// SPDX-License-Identifier: AGPL-3.0-only
// The sketch's Symmetric relation between two pieces about a line: which
// ends mirror which, what it refuses, and that the solver then holds the
// pieces as mirror images of each other.

import { describe, expect, it } from 'vitest'
import { datumTraces, traceOf } from '../core/datums'
import { mirrorPoint, symmetricPairs } from '../core/mirrorRelation'
import { addConstraint, addEntity, emptySketch, type SketchEntity } from '../core/sketch'
import { solveSketch } from '../core/solver'
import type { SectionFrame } from '../../../src/core/section/frame'

const entity = (sketch: ReturnType<typeof emptySketch>, id: number): SketchEntity => sketch.entities.find((e) => e.id === id)!

describe('mirrorPoint', () => {
  it('reflects across a line through a point along a direction', () => {
    expect(mirrorPoint([3, 1], [0, 0], [0, 1])).toEqual([-3, 1])
    const p = mirrorPoint([2, 0], [0, 0], [Math.SQRT1_2, Math.SQRT1_2])
    expect(p[0]).toBeCloseTo(0, 9)
    expect(p[1]).toBeCloseTo(2, 9)
  })
})

describe('symmetricPairs', () => {
  it('pairs the ends of two lines the way they mirror, whichever way each was drawn', () => {
    const sketch = emptySketch()
    const axis = addEntity(sketch, { kind: 'line', a: [0, -10], b: [0, 10], construction: true })
    const left = addEntity(sketch, { kind: 'line', a: [-5, 0], b: [-3, 4] })
    const same = addEntity(sketch, { kind: 'line', a: [5.2, 0.1], b: [3.1, 3.9] })
    const turned = addEntity(sketch, { kind: 'line', a: [3.1, 3.9], b: [5.2, 0.1] })
    expect(symmetricPairs(entity(sketch, left), entity(sketch, same), entity(sketch, axis))).toEqual([
      { p: { entity: left, at: 'a' }, q: { entity: same, at: 'a' } },
      { p: { entity: left, at: 'b' }, q: { entity: same, at: 'b' } },
    ])
    expect(symmetricPairs(entity(sketch, left), entity(sketch, turned), entity(sketch, axis))).toEqual([
      { p: { entity: left, at: 'a' }, q: { entity: turned, at: 'b' } },
      { p: { entity: left, at: 'b' }, q: { entity: turned, at: 'a' } },
    ])
  })

  it('holds circles by their centres and says why it refuses the rest', () => {
    const sketch = emptySketch()
    const axis = addEntity(sketch, { kind: 'line', a: [0, 0], b: [10, 0] })
    const c1 = addEntity(sketch, { kind: 'circle', c: [2, 3], r: 1 })
    const c2 = addEntity(sketch, { kind: 'circle', c: [2, -3], r: 1 })
    const line = addEntity(sketch, { kind: 'line', a: [1, 1], b: [2, 2] })
    expect(symmetricPairs(entity(sketch, c1), entity(sketch, c2), entity(sketch, axis))).toEqual([{ p: { entity: c1, at: 'center' }, q: { entity: c2, at: 'center' } }])
    expect(symmetricPairs(entity(sketch, c1), entity(sketch, line), entity(sketch, axis))).toMatch(/one kind/)
    expect(symmetricPairs(entity(sketch, c1), entity(sketch, c2), entity(sketch, c1))).toMatch(/has to be a line/)
    expect(symmetricPairs(entity(sketch, line), entity(sketch, axis), entity(sketch, axis))).toMatch(/cannot be one of the two/)
  })

  it('is what the solver needs to make one line the mirror image of the other', () => {
    const sketch = emptySketch()
    const axis = addEntity(sketch, { kind: 'line', a: [0, -10], b: [0, 10], construction: true, fixed: true })
    const left = addEntity(sketch, { kind: 'line', a: [-5, 0], b: [-3, 4], fixed: true })
    const right = addEntity(sketch, { kind: 'line', a: [6, 1], b: [2, 5] })
    const pairs = symmetricPairs(entity(sketch, left), entity(sketch, right), entity(sketch, axis))
    if (typeof pairs === 'string') throw new Error(pairs)
    for (const pair of pairs) addConstraint(sketch, { kind: 'symmetric', ...pair, about: { line: axis } })
    const report = solveSketch(sketch)
    expect(report.ok).toBe(true)
    const r = entity(sketch, right)
    if (r.kind !== 'line') throw new Error('not a line')
    expect(r.a[0]).toBeCloseTo(5, 6)
    expect(r.a[1]).toBeCloseTo(0, 6)
    expect(r.b[0]).toBeCloseTo(3, 6)
    expect(r.b[1]).toBeCloseTo(4, 6)
  })

  it("takes a coordinate plane's trace as the mirror line, and the solver holds it there from the frame", () => {
    // A sketch on the XY plane: the YZ plane cuts it in the line u = 0.
    const frame: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
    const traces = datumTraces(frame)
    const yz = traceOf(traces, 'yz')
    if (!yz) throw new Error('no trace')
    const sketch = emptySketch()
    const left = addEntity(sketch, { kind: 'line', a: [-5, 0], b: [-3, 4], fixed: true })
    const right = addEntity(sketch, { kind: 'line', a: [2, 5], b: [6, 1] })
    const pairs = symmetricPairs(entity(sketch, left), entity(sketch, right), yz)
    if (typeof pairs === 'string') throw new Error(pairs)
    expect(pairs).toEqual([
      { p: { entity: left, at: 'a' }, q: { entity: right, at: 'b' } },
      { p: { entity: left, at: 'b' }, q: { entity: right, at: 'a' } },
    ])
    for (const pair of pairs) addConstraint(sketch, { kind: 'symmetric', ...pair, about: { datum: 'yz' } })
    // The trace is the solver's to be given; without it the relation holds nothing.
    const loose = solveSketch(sketch)
    expect(loose.ok).toBe(true)
    const before = entity(sketch, right)
    if (before.kind !== 'line') throw new Error('not a line')
    expect(before.b[0]).toBeCloseTo(6, 6)
    const report = solveSketch(sketch, { datums: traces })
    expect(report.ok).toBe(true)
    const r = entity(sketch, right)
    if (r.kind !== 'line') throw new Error('not a line')
    expect(r.b[0]).toBeCloseTo(5, 6)
    expect(r.b[1]).toBeCloseTo(0, 6)
    expect(r.a[0]).toBeCloseTo(3, 6)
    expect(r.a[1]).toBeCloseTo(4, 6)
  })
})
