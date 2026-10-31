// SPDX-License-Identifier: AGPL-3.0-only
// A sketch dimension drawn as a drawing carries it — extension lines, a
// dimension line with arrowheads, the number in a gap — and dragged to where
// it reads best; and the sketch's Chamfer, the fillet's straight sister.

import { describe, expect, it } from 'vitest'
import { sharpenCorner } from '../core/corners'
import { dimPlaceAt, dimShape, dimStrokes, type Dimension } from '../core/dimLayout'
import { chamferLines } from '../core/filletCorner'
import { addConstraint, addEntity, emptySketch, entityOf, type SketchLine } from '../core/sketch'
import { solveSketch } from '../core/solver'
import { useReverse } from '../state/reStore'

const dimensionOf = (sketch: ReturnType<typeof emptySketch>, id: number) => sketch.constraints.find((c) => c.id === id) as Dimension

describe('dimShape and dimStrokes', () => {
  it('stands a length off its line with two extension lines, two arrows inside and a gap for the number', () => {
    const sketch = emptySketch()
    const l = addEntity(sketch, { kind: 'line', a: [0, 0], b: [20, 0] })
    const id = addConstraint(sketch, { kind: 'length', entity: l, value: 20 })
    const shape = dimShape(dimensionOf(sketch, id), sketch, [], 3)
    expect(shape?.kind).toBe('linear')
    if (!shape || shape.kind !== 'linear') return
    expect(Math.abs(shape.off)).toBeCloseTo(3)
    const s = dimStrokes(shape, 0.05, 20)
    // Two extension lines and the dimension line in two parts.
    expect(s.lines).toHaveLength(4)
    expect(s.arrows).toHaveLength(2)
    // Inside arrows point away from each other.
    expect(s.arrows[0].dir[0]).toBeCloseTo(-1)
    expect(s.arrows[1].dir[0]).toBeCloseTo(1)
    expect(s.text[0]).toBeCloseTo(10)
    expect(s.textAngle).toBeCloseTo(0)
  })

  it('turns the arrows in from outside when the stretch is short on screen', () => {
    const sketch = emptySketch()
    const l = addEntity(sketch, { kind: 'line', a: [0, 0], b: [1, 0] })
    const id = addConstraint(sketch, { kind: 'length', entity: l, value: 1 })
    const shape = dimShape(dimensionOf(sketch, id), sketch, [], 3)!
    const s = dimStrokes(shape, 0.1, 20)
    expect(s.arrows[0].dir[0]).toBeCloseTo(1)
    expect(s.arrows[1].dir[0]).toBeCloseTo(-1)
  })

  it('keeps the number readable on a line that runs down the sheet', () => {
    const sketch = emptySketch()
    const l = addEntity(sketch, { kind: 'line', a: [0, 10], b: [-10, 0] })
    const id = addConstraint(sketch, { kind: 'length', entity: l, value: Math.hypot(10, 10) })
    const s = dimStrokes(dimShape(dimensionOf(sketch, id), sketch, [], 2)!, 0.05, 20)
    expect(s.textAngle).toBeCloseTo(Math.PI / 4)
  })

  it('puts a dragged number where it was dropped, and keeps it there as the line moves', () => {
    const sketch = emptySketch()
    const l = addEntity(sketch, { kind: 'line', a: [0, 0], b: [20, 0] })
    const id = addConstraint(sketch, { kind: 'length', entity: l, value: 20 })
    const c = dimensionOf(sketch, id)
    const place = dimPlaceAt(c, sketch, [14, -6], [])!
    const placed = { ...c, place }
    const s = dimStrokes(dimShape(placed, sketch, [], 3)!, 0.05, 20)
    expect(s.text[0]).toBeCloseTo(14)
    expect(s.text[1]).toBeCloseTo(-6)
    // The line moved up by five: the number goes with it.
    const line = entityOf(sketch, l) as SketchLine
    line.a = [0, 5]
    line.b = [20, 5]
    const moved = dimStrokes(dimShape(placed, sketch, [], 3)!, 0.05, 20)
    expect(moved.text[1]).toBeCloseTo(-1)
  })

  it('carries the dimension line out to a number dragged past the end', () => {
    const sketch = emptySketch()
    const l = addEntity(sketch, { kind: 'line', a: [0, 0], b: [20, 0] })
    const id = addConstraint(sketch, { kind: 'length', entity: l, value: 20 })
    const c = dimensionOf(sketch, id)
    const s = dimStrokes(dimShape({ ...c, place: dimPlaceAt(c, sketch, [30, 4], [])! }, sketch, [], 3)!, 0.05, 20)
    const reach = Math.max(...s.lines.flat().map((p) => p[0]))
    expect(reach).toBeGreaterThan(28)
    expect(reach).toBeLessThan(30)
  })

  it('leads a radius in to the rim from a number outside, and out to it from one inside', () => {
    const sketch = emptySketch()
    const circle = addEntity(sketch, { kind: 'circle', c: [0, 0], r: 10 })
    const id = addConstraint(sketch, { kind: 'radius', entity: circle, value: 10 })
    const c = dimensionOf(sketch, id)
    const outside = dimStrokes(dimShape({ ...c, place: dimPlaceAt(c, sketch, [20, 0], [])! }, sketch, [], 1)!, 0.05, 30)
    expect(outside.arrows[0].tip[0]).toBeCloseTo(10)
    expect(outside.arrows[0].dir[0]).toBeCloseTo(-1)
    const inside = dimStrokes(dimShape({ ...c, place: dimPlaceAt(c, sketch, [5, 0], [])! }, sketch, [], 1)!, 0.05, 30)
    expect(inside.arrows[0].dir[0]).toBeCloseTo(1)
    expect(inside.text[0]).toBeCloseTo(5)
  })

  it('draws a diameter rim to rim through the centre, carried out to a number outside', () => {
    const sketch = emptySketch()
    const circle = addEntity(sketch, { kind: 'circle', c: [0, 0], r: 10 })
    const id = addConstraint(sketch, { kind: 'diameter', entity: circle, value: 20 })
    const c = dimensionOf(sketch, id)
    const outside = dimStrokes(dimShape({ ...c, place: dimPlaceAt(c, sketch, [20, 0], [])! }, sketch, [], 1)!, 0.05, 30)
    // An arrow on the rim at each end, both pointing out at it.
    const tips = outside.arrows.map((a) => [a.tip[0], a.dir[0]])
    expect(tips.map(([x]) => x).sort((p, q) => p - q)).toEqual([expect.closeTo(-10), expect.closeTo(10)])
    for (const [x, dir] of tips) expect(Math.sign(dir)).toBe(Math.sign(x))
    // The line runs from the far rim on through the centre to the number.
    const xs = outside.lines.flat().map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(-10)
    expect(Math.max(...xs)).toBeGreaterThan(15)
    expect(outside.text[0]).toBeCloseTo(20)
    const inside = dimStrokes(dimShape({ ...c, place: dimPlaceAt(c, sketch, [0, 3], [])! }, sketch, [], 1)!, 0.05, 30)
    expect(inside.text[1]).toBeCloseTo(3)
    expect(Math.max(...inside.lines.flat().map((p) => p[1]))).toBeCloseTo(10)
    expect(Math.min(...inside.lines.flat().map((p) => p[1]))).toBeCloseTo(-10)
  })

  it('draws an angle as the arc the number says, and across the vertex when dragged there', () => {
    const sketch = emptySketch()
    const a = addEntity(sketch, { kind: 'line', a: [0, 0], b: [10, 0] })
    const b = addEntity(sketch, { kind: 'line', a: [0, 0], b: [0, 10] })
    const id = addConstraint(sketch, { kind: 'angle', a, b, value: 90 })
    const c = dimensionOf(sketch, id)
    const shape = dimShape(c, sketch, [], 1)
    expect(shape?.kind).toBe('angle')
    if (!shape || shape.kind !== 'angle') return
    expect(shape.sweep).toBeCloseTo(Math.PI / 2)
    const s = dimStrokes(shape, 0.02, 30)
    expect(s.arrows).toHaveLength(2)
    expect(s.text[0]).toBeGreaterThan(0)
    expect(s.text[1]).toBeGreaterThan(0)
    const across = dimStrokes(dimShape({ ...c, place: dimPlaceAt(c, sketch, [-4, -4], [])! }, sketch, [], 1)!, 0.02, 30)
    expect(across.text[0]).toBeCloseTo(-4)
    expect(across.text[1]).toBeCloseTo(-4)
    // Both arrow tips lie on the lines' carriers, on the far side.
    for (const arrow of across.arrows) expect(Math.min(Math.abs(arrow.tip[0]), Math.abs(arrow.tip[1]))).toBeCloseTo(0)
    for (const arrow of across.arrows) expect(arrow.tip[0] + arrow.tip[1]).toBeLessThan(0)
  })
})

/** Two lines meeting square at the origin, joined there. */
function corner() {
  const sketch = emptySketch()
  const a = addEntity(sketch, { kind: 'line', a: [10, 0], b: [0, 0] })
  const b = addEntity(sketch, { kind: 'line', a: [0, 0], b: [0, 8] })
  addConstraint(sketch, { kind: 'coincident', p: { entity: a, at: 'b' }, q: { entity: b, at: 'a' } })
  return { sketch, a, b }
}

describe('chamferLines', () => {
  it('cuts both lines back and puts a line across, held by its two distances', () => {
    const { sketch, a, b } = corner()
    const made = chamferLines(sketch, a, b, 2)
    expect(typeof made).toBe('object')
    if (typeof made === 'string') return
    const la = entityOf(sketch, a) as SketchLine
    const lb = entityOf(sketch, b) as SketchLine
    expect(la.b).toEqual([2, 0])
    expect(lb.a).toEqual([0, 2])
    const across = entityOf(sketch, made.line) as SketchLine
    expect(across.a).toEqual([2, 0])
    expect(across.b).toEqual([0, 2])
    expect(made.dimensions.map((id) => dimensionOf(sketch, id).value)).toEqual([2, 2])
    expect(solveSketch(sketch).ok).toBe(true)
  })

  it('takes a new distance typed over one of the two, as an uneven chamfer', () => {
    const { sketch, a, b } = corner()
    const made = chamferLines(sketch, a, b, 2)
    if (typeof made === 'string') throw new Error(made)
    sketch.constraints = sketch.constraints.map((c) => (c.id === made.dimensions[0] && 'value' in c ? { ...c, value: 3 } : c))
    addConstraint(sketch, { kind: 'horizontal', entity: a })
    addConstraint(sketch, { kind: 'vertical', entity: b })
    expect(solveSketch(sketch).ok).toBe(true)
    const across = entityOf(sketch, made.line) as SketchLine
    const lb = entityOf(sketch, b) as SketchLine
    expect(Math.abs(across.a[0] - lb.a[0])).toBeCloseTo(3, 4)
  })

  it('refuses parallel lines and a distance that does not fit, and changes nothing', () => {
    const { sketch, a, b } = corner()
    const before = JSON.stringify(sketch)
    expect(typeof chamferLines(sketch, a, b, 9)).toBe('string')
    expect(JSON.stringify(sketch)).toBe(before)
  })

  it('is taken out again by Sharp corner', () => {
    const { sketch, a, b } = corner()
    const made = chamferLines(sketch, a, b, 2)
    if (typeof made === 'string') throw new Error(made)
    expect(sharpenCorner(sketch, made.line)).toBe(true)
    expect(sketch.entities).toHaveLength(2)
    expect((entityOf(sketch, a) as SketchLine).b).toEqual([0, 0])
    expect(sketch.constraints.filter((c) => c.kind === 'distance')).toHaveLength(0)
  })
})

describe('the store', () => {
  const frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] } as never
  const open = () => {
    useReverse.getState().reset()
    useReverse.getState().startSketch({ kind: 'coordinate', plane: 'xy' } as never, frame, [
      { kind: 'line', a: [10, 0], b: [0, 0] },
      { kind: 'line', a: [0, 0], b: [0, 8] },
    ])
  }

  it('moves a dimension as one step to undo, leaving the pieces where they are', () => {
    open()
    const re = useReverse.getState()
    re.setSketchTool('dimension')
    re.sketchClick([6, 0], 0.5, false)
    const d = useReverse.getState().sketchDraft!
    const id = d.selectedConstraint!
    expect(dimensionOf(d.sketch, id).kind).toBe('length')
    const steps = d.history.length
    re.moveDimension(id, [5, 6], true)
    re.moveDimension(id, [7, 8], false)
    const after = useReverse.getState().sketchDraft!
    expect(after.history.length).toBe(steps + 1)
    expect(Math.abs(dimensionOf(after.sketch, id).place!.along)).toBeCloseTo(2)
    expect(Math.abs(dimensionOf(after.sketch, id).place!.off)).toBeCloseTo(8)
    re.undoSketch()
    expect(dimensionOf(useReverse.getState().sketchDraft!.sketch, id).place).toBeUndefined()
  })

  it('chamfers the two lines clicked, the first distance selected for typing, the next starting with the last', () => {
    open()
    const re = useReverse.getState()
    re.setSketchTool('chamfer')
    re.sketchClick([6, 0], 0.5, false)
    re.sketchClick([0, 5], 0.5, false)
    const d = useReverse.getState().sketchDraft!
    expect(d.error).toBeNull()
    expect(d.sketch.entities).toHaveLength(3)
    expect(dimensionOf(d.sketch, d.selectedConstraint!).kind).toBe('distance')
    expect(d.lastChamfer).toBeCloseTo(2)
    expect(d.tool).toBe('chamfer')
  })
})
