// SPDX-License-Identifier: AGPL-3.0-only
// A sketch edited piece by piece, as reverse.sketch.edit hands the sketch
// to sketchOf: a shape added without an id on a sketch whose inferred
// relations took the ids after its pieces starts its run past them, not on
// them; a new piece's end a few hundredths off one end of the sketch's is
// moved onto it and joined — a fixed one's too, and new ends onto each
// other; a polyline closes on its first corner; and a name given for a
// number a feature drives by an expression is refused with the way to
// write it.

import { beforeAll, describe, expect, it } from 'vitest'
import { validate } from '../../../src/commands/schema'
import type { Sketch, SketchLine } from '../core/sketch'
import { XY } from './reKit'

type SketchOf = typeof import('../app/reSketchInput').sketchOf
let sketchOf: SketchOf
let featureOf: typeof import('../app/reSchemas').featureOf

beforeAll(async () => {
  // As the app loads them: the commands sit in an import cycle.
  await import('../plugin')
  ;({ sketchOf } = await import('../app/reSketchInput'))
  ;({ featureOf } = await import('../app/reSchemas'))
})

/** Two lines meeting at (10, 0), their relations inferred — ids 3 up. */
function inferred(): Sketch {
  const { sketch } = sketchOf(
    {
      entities: [
        { id: 1, kind: 'line', a: [0, 0], b: [10, 0] },
        { id: 2, kind: 'line', a: [10, 0], b: [10, 10] },
      ],
    },
    XY,
  )
  return sketch
}

/** What reverse.sketch.edit hands sketchOf: the sketch as it stands, and
 *  what was added. */
const edit = (held: Sketch, add: Record<string, unknown>) =>
  sketchOf({ ...add, entities: [...held.entities, ...((add.entities as unknown[]) ?? [])], constraints: [...held.constraints, ...((add.constraints as unknown[]) ?? [])] }, XY, held, { snap: true })

describe('a sketch edited piece by piece', () => {
  it('starts a shape without an id after every piece and relation', () => {
    const held = inferred()
    const taken = new Set([...held.entities.map((e) => e.id), ...held.constraints.map((c) => c.id)])
    expect(Math.max(...held.constraints.map((c) => c.id))).toBeGreaterThan(2)
    const { sketch, made } = edit(held, { shapes: [{ kind: 'rectangle', center: [30, 30], size: [5, 5] }] })
    const sides = made.shapes[0].sides as number[]
    expect(sides).toHaveLength(4)
    for (const id of sides) expect(taken.has(id)).toBe(false)
    expect(Math.min(...sides)).toBeGreaterThanOrEqual(held.nextId)
    expect(sketch.entities.filter((e) => !taken.has(e.id)).length).toBeGreaterThanOrEqual(4)
  })

  it('moves a new end 0.02 mm off the sketch’s corner onto it, and joins it there', () => {
    const held = inferred()
    const { sketch, made } = edit(held, { entities: [{ id: 20, kind: 'line', a: [10.02, 0], b: [20, 0] }] })
    expect(made.snapped).toEqual([{ piece: 20, at: 'a', to: { piece: 1, at: 'b' }, by: 0.02 }])
    expect((sketch.entities.find((e) => e.id === 20) as SketchLine).a).toEqual([10, 0])
    expect(sketch.constraints.some((c) => c.kind === 'coincident' && [c.p.entity, c.q.entity].includes(20))).toBe(true)
  })

  it('moves a piece given fixed too — a gap that small is never meant — and says so', () => {
    const held = inferred()
    const { sketch, made } = edit(held, { entities: [{ id: 20, kind: 'line', a: [10.02, 0], b: [20, 0], fixed: true }] })
    expect(made.snapped).toEqual([{ piece: 20, at: 'a', to: { piece: 1, at: 'b' }, by: 0.02, fixed: true }])
    expect((sketch.entities.find((e) => e.id === 20) as SketchLine).a).toEqual([10, 0])
  })

  it('joins new ends to each other, a free one going to a fixed one, and leaves the sketch’s own as they were', () => {
    const held = inferred()
    const { sketch, made } = edit(held, {
      entities: [
        { id: 20, kind: 'line', a: [30, 0], b: [40, 0], fixed: true },
        { id: 21, kind: 'line', a: [40.01, 0.01], b: [40, 10] },
      ],
    })
    expect(made.snapped).toEqual([{ piece: 21, at: 'a', to: { piece: 20, at: 'b' }, by: 0.0141 }])
    expect((sketch.entities.find((e) => e.id === 21) as SketchLine).a).toEqual([40, 0])
    expect((sketch.entities.find((e) => e.id === 20) as SketchLine).b).toEqual([40, 0])
    // Pieces the sketch had, handed back as they were, stay put.
    expect(sketch.entities.find((e) => e.id === 1)).toEqual(held.entities.find((e) => e.id === 1))
  })

  it('closes a polyline whose last corner lies on or a hair off its first, with no micro line', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]]
    for (const [last, closed] of [[[0.01, -0.02], undefined], [[0, 0], true], [[0.03, 0], true]] as const) {
      const { sketch, made } = sketchOf({ shapes: [{ kind: 'polyline', points: [...square, last], ...(closed ? { closed } : {}) }] }, XY, undefined, { snap: true })
      expect(made.shapes[0].lines).toHaveLength(4)
      expect(made.shapes[0].closedOn).toBe('first corner')
      const lines = sketch.entities.filter((e): e is SketchLine => e.kind === 'line')
      expect(lines.every((l) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) > 9.9)).toBe(true)
      expect(lines[3].b).toEqual([0, 0])
    }
    // An open polyline whose ends lie apart stays open.
    expect(sketchOf({ shapes: [{ kind: 'polyline', points: [...square, [0, 0.2]] }] }, XY).made.shapes[0].lines).toHaveLength(4)
  })

  it('leaves an end past 0.05 mm, and one between two ends', () => {
    const held = inferred()
    expect(edit(held, { entities: [{ id: 20, kind: 'line', a: [10.08, 0], b: [20, 0] }] }).made.snapped).toBeUndefined()
    // Two ends 0.06 apart, the new one between them: which was meant?
    const apart = sketchOf({ entities: [{ id: 1, kind: 'line', a: [0, 0], b: [10, 0] }, { id: 2, kind: 'line', a: [10.06, 0], b: [10.06, 10] }] }, XY).sketch
    expect(edit(apart, { entities: [{ id: 20, kind: 'line', a: [10.03, 0.01], b: [10, -10] }] }).made.snapped).toBeUndefined()
  })
})

describe('a name given for a number', () => {
  it('is refused with the exprs to write, where the feature drives the field by an expression', () => {
    expect(validate(featureOf('fillet'), { kind: 'fillet', body: 1, edges: [0], radius: 'r' }, 'input.feature')).toEqual(['input.feature.radius: "r" is a name or an expression, and this field takes a number — give exprs: { radius: "r" }'])
    expect(validate(featureOf('shell'), { kind: 'shell', body: 1, thickness: 't' }, 'input.feature')).toEqual(['input.feature.thickness: "t" is a name or an expression, and this field takes a number — give exprs: { thickness: "t" }, with any number here (the expression sets it)'])
    // An extrude's distance, down in its extent.
    const extrude = { kind: 'extrude', sketchId: 1, regions: 'all', extent: { kind: 'distance', from: 0, to: 'h' } }
    expect(validate(featureOf('extrude'), extrude, 'input.feature').join('; ')).toContain('give exprs: { "extent.to": "h" }')
  })
})
