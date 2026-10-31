// SPDX-License-Identifier: AGPL-3.0-only
// The parameter table and the slots the features read it through: the
// table evaluated in dependency order with its refusals, every slot's
// reading and writing, the expressions written through to features and
// sketches, and a parameter renamed wherever it is read.

import { describe, expect, it } from 'vitest'
import type { Feature, SketchFeature } from '../core/features'
import { applyParameters, applySketchExpressions, applySlots, evaluateParameters, featureExpressionErrors, nameProblem, renameInFeature, renameInParameters, replaceSketch, slotAt, slotsOf, unlinkSlot, usersOf, withSlot, type Parameter } from '../core/parameters'
import { addConstraint, addEntity, addRectangle, emptySketch, isDimension, type Sketch } from '../core/sketch'
import { lineLength } from '../core/sketch'
import { XY } from './reKit'

const param = (id: number, name: string, expression: string, kind: Parameter['kind'] = 'length'): Parameter => ({ id, name, kind, expression })

describe('the table', () => {
  it('evaluates each parameter after the ones it reads, in any order', () => {
    const t = evaluateParameters([param(1, 'total', 'width + height'), param(2, 'width', '40'), param(3, 'height', 'width / 2')])
    expect(t.readings.map((r) => [r.name, r.value, r.error])).toEqual([
      ['total', 60, null],
      ['width', 40, null],
      ['height', 20, null],
    ])
    expect(t.scope('total')).toEqual({ value: 60, dim: { mm: 1, deg: 0 } })
    expect(t.scope('nothing')).toBeUndefined()
  })

  it('reads a bare number in the parameter’s kind and keeps the kinds apart', () => {
    const t = evaluateParameters([param(1, 'turn', '30', 'angle'), param(2, 'count', '6', 'integer'), param(3, 'ratio', '0.5', 'number'), param(4, 'bad', 'turn + 2 mm', 'angle'), param(5, 'worse', 'count', 'length')])
    expect(t.readings[0]).toMatchObject({ value: 30 })
    expect(t.readings[1]).toMatchObject({ value: 6 })
    expect(t.readings[2]).toMatchObject({ value: 0.5 })
    expect(t.readings[3]).toMatchObject({ value: null, error: 'an angle and a length cannot be added' })
    expect(t.readings[4]).toMatchObject({ value: null, error: expect.stringContaining('comes out as a number; a length is wanted') })
  })

  it('asks a whole number of an integer parameter', () => {
    const t = evaluateParameters([param(1, 'holes', '7.3', 'integer'), param(2, 'teeth', 'round(7.3)', 'integer')])
    expect(t.readings[0].error).toContain('not whole')
    expect(t.readings[1].value).toBe(7)
  })

  it('reports a loop on every parameter in it, and what reads the loop', () => {
    const t = evaluateParameters([param(1, 'a', 'b + 1'), param(2, 'b', 'c * 2'), param(3, 'c', 'a'), param(4, 'd', 'a + 5'), param(5, 'f', '3')])
    for (const r of t.readings.slice(0, 3)) expect(r).toMatchObject({ value: null, error: expect.stringContaining('goes round in a loop') })
    expect(t.readings[3]).toMatchObject({ value: null, error: expect.stringContaining('“a” has no value') })
    expect(t.readings[4]).toMatchObject({ value: 3 })
    expect(t.scope('a')).toEqual({ error: '“a” has no value' })
  })

  it('refuses a name that will not do', () => {
    const others = [param(1, 'width', '1'), param(2, 'Height', '2')]
    expect(nameProblem('', others)).toBe('needs a name')
    expect(nameProblem('sin', others)).toContain('a word the expressions keep')
    expect(nameProblem('2wide', others)).toContain('a letter or an underscore')
    expect(nameProblem('width', others)).toContain('already')
    expect(nameProblem('width', others, 1)).toBeNull()
    expect(nameProblem('height', others)).toContain('case alone')
    expect(nameProblem('depth', others)).toBeNull()
    const t = evaluateParameters([param(1, 'w', '1'), param(2, 'w', '2'), param(3, 'mm', '3')])
    expect(t.readings[1].error).toContain('already')
    expect(t.readings[2].error).toContain('keep')
  })
})

describe('slots', () => {
  const extrude: Feature = { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: ['r:1'], extent: { kind: 'distance', from: 0, to: 10 }, draftDeg: 0, op: 'new', visible: true }

  it('read and write an extrude as its box shows it', () => {
    expect(slotsOf(extrude).map((s) => s.path)).toEqual(['extent.from', 'extent.to', 'taper'])
    const to = slotAt(extrude, 'extent.to')!
    expect(to.get(extrude)).toBe(10)
    expect(to.set(extrude, 25)).toMatchObject({ extent: { kind: 'distance', from: 0, to: 25 } })
    const taper = slotAt(extrude, 'taper')!
    expect(taper.get({ ...extrude, draftDeg: -5 })).toBe(5)
    expect(taper.set(extrude, 5)).toMatchObject({ draftDeg: -5 })
    expect(taper.set(extrude, 0)).toMatchObject({ draftDeg: 0 })
    expect(slotsOf({ ...extrude, extent: { kind: 'symmetric', total: 8 } }).map((s) => s.path)).toEqual(['extent.total', 'taper'])
    expect(slotsOf({ ...extrude, extent: { kind: 'toNext', from: 2 } }).map((s) => s.path)).toEqual(['extent.from', 'taper'])
    expect(slotsOf({ ...extrude, extent: { kind: 'betweenPlanes', a: { kind: 'world', axis: 'z', offset: 0 }, b: { kind: 'world', axis: 'z', offset: 5 } } }).map((s) => s.path)).toEqual(['taper'])
  })

  it('read and write the others', () => {
    const hole: Feature = { id: 3, kind: 'hole', name: 'Hole 1', body: 2, axis: { kind: 'element', id: 1 }, radius: 3, depth: null, visible: true }
    expect(slotsOf(hole).map((s) => s.path)).toEqual(['diameter'])
    expect(slotAt(hole, 'diameter')!.get(hole)).toBe(6)
    expect(slotAt(hole, 'diameter')!.set(hole, 10)).toMatchObject({ radius: 5 })
    expect(slotsOf({ ...hole, depth: 4 }).map((s) => s.path)).toEqual(['diameter', 'depth'])
    const revolve: Feature = { id: 4, kind: 'revolve', name: 'Revolve 1', sketchId: 1, regions: [], axis: { kind: 'world', axis: 'z' }, angleDeg: 180, op: 'new', visible: true }
    expect(slotsOf(revolve).map((s) => s.path)).toEqual(['angleDeg'])
    expect(slotAt(revolve, 'angleDeg')!.set(revolve, 720)).toMatchObject({ angleDeg: 360 })
    const coil = { ...revolve, pitch: 2, angleDeg: 720 }
    expect(slotsOf(coil).map((s) => s.path)).toEqual(['angleDeg', 'pitch', 'turns', 'height'])
    expect(slotAt(coil, 'turns')!.get(coil)).toBe(2)
    expect(slotAt(coil, 'turns')!.set(coil, 3)).toMatchObject({ angleDeg: 1080 })
    expect(slotAt(coil, 'height')!.get(coil)).toBe(4)
    expect(slotAt(coil, 'height')!.set(coil, 10)).toMatchObject({ angleDeg: 1800 })
    const pattern: Feature = { id: 5, kind: 'pattern', name: 'Pattern 1', body: 2, mode: 'circular', axis: { kind: 'world', axis: 'z' }, count: 4, step: 360, visible: true }
    expect(slotsOf(pattern).map((s) => [s.path, s.kind])).toEqual([
      ['count', 'integer'],
      ['step', 'angle'],
    ])
    expect(slotAt(pattern, 'count')!.set(pattern, 7.3)).toMatchObject({ count: 7 })
    expect(slotAt(pattern, 'count')!.set(pattern, 1)).toMatchObject({ count: 2 })
    expect(slotsOf({ ...pattern, mode: 'linear' }).map((s) => [s.path, s.kind])).toEqual([
      ['count', 'integer'],
      ['step', 'length'],
    ])
    const split: Feature = { id: 6, kind: 'split', name: 'Split 1', body: 2, tools: [], keep: 'scan', tolerance: 0.3, overlap: 0.5, visible: true }
    expect(slotAt(split, 'overlap')!.get(split)).toBe(50)
    expect(slotAt(split, 'overlap')!.set(split, 80)).toMatchObject({ overlap: 0.8 })
    const shell: Feature = { id: 7, kind: 'shell', name: 'Shell 1', body: 2, faces: [], thickness: 2, visible: true }
    expect(slotAt(shell, 'thickness')!.set(shell, -3)).toMatchObject({ thickness: 3 })
    // A sketch's one slot is its plane's offset: moving it carries the frame.
    const sketch: Feature = { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: emptySketch(), visible: true }
    expect(slotsOf(sketch).map((x) => x.path)).toEqual(['offset'])
    const lifted = slotAt(sketch, 'offset')!.set(sketch, 7) as Extract<Feature, { kind: 'sketch' }>
    expect(lifted.plane).toMatchObject({ kind: 'world', offset: 7 })
    expect(lifted.frame.origin).toEqual([0, 0, 7])
    const fitted: Feature = { ...sketch, plane: { kind: 'fitted', frame: XY } }
    expect(slotsOf(fitted)).toEqual([])
  })

  it('write an expression through, and let it go for a number', () => {
    const scope = evaluateParameters([param(1, 'height', '20')]).scope
    const bound = withSlot(extrude, 'extent.to', 25, 'height + 5')
    expect(bound).toMatchObject({ extent: { to: 25 }, exprs: { 'extent.to': 'height + 5' } })
    const { next, errors } = applySlots(bound, evaluateParameters([param(1, 'height', '30')]).scope)
    expect(errors).toEqual({})
    expect(next).toMatchObject({ extent: { to: 35 } })
    expect(applySlots(bound, scope).next).toBe(bound)
    const typed = withSlot(bound, 'extent.to', 12, null)
    expect(typed).toMatchObject({ extent: { to: 12 } })
    expect('exprs' in typed).toBe(false)
    expect(unlinkSlot(bound, 'extent.to')).not.toHaveProperty('exprs')
    expect(unlinkSlot(extrude, 'extent.to')).toBe(extrude)
  })

  it('leave the number standing when the expression cannot be read, and drop one with no slot', () => {
    const bound = withSlot(extrude, 'extent.to', 25, 'height + 5')
    const { next, errors } = applySlots(bound, () => undefined)
    expect(next).toBe(bound)
    expect(errors).toEqual({ 'extent.to': 'there is no parameter “height”' })
    expect(featureExpressionErrors(bound, () => undefined)).toEqual({ 'extent.to': 'there is no parameter “height”' })
    const stale = { ...bound, extent: { kind: 'symmetric' as const, total: 8 }, exprs: { 'extent.to': 'height', taper: '2' } }
    const dropped = applySlots(stale, evaluateParameters([param(1, 'height', '20')]).scope)
    expect(dropped.next.exprs).toEqual({ taper: '2' })
    expect(dropped.next).toMatchObject({ draftDeg: -2 })
  })
})

function square(size: number): { sketch: Sketch; width: number } {
  const sketch = emptySketch()
  const ids = addRectangle(sketch, [0, 0], [size, size])
  const origin = addEntity(sketch, { kind: 'point', p: [0, 0], fixed: true })
  addConstraint(sketch, { kind: 'coincident', p: { entity: ids[0], at: 'a' }, q: { entity: origin, at: 'center' } })
  const width = addConstraint(sketch, { kind: 'length', entity: ids[0], value: size, expr: 'width' })
  addConstraint(sketch, { kind: 'length', entity: ids[1], value: size })
  return { sketch, width }
}

describe('sketches', () => {
  it('write a dimension’s expression through and solve the sketch again on it', () => {
    const { sketch } = square(10)
    const scope = evaluateParameters([param(1, 'width', '30')]).scope
    const { next, errors } = applySketchExpressions(sketch, XY, scope)
    expect(errors).toEqual({})
    expect(next).not.toBe(sketch)
    const bottom = next.entities[0]
    expect(bottom.kind === 'line' && lineLength(bottom)).toBeCloseTo(30, 6)
    const was = sketch.entities[0]
    expect(was.kind === 'line' && lineLength(was)).toBeCloseTo(10, 6)
    expect(next.constraints.find((c) => isDimension(c) && c.expr === 'width')).toMatchObject({ value: 30 })
    expect(applySketchExpressions(next, XY, scope).next).toBe(next)
  })

  it('leave a dimension whose expression cannot be read as it is', () => {
    const { sketch, width } = square(10)
    const { next, errors } = applySketchExpressions(sketch, XY, () => undefined)
    expect(next).toBe(sketch)
    expect(errors).toEqual({ [`dim:${width}`]: 'there is no parameter “width”' })
  })

  it('keep the features on a changed sketch pointing at their regions', () => {
    const { sketch, width } = square(10)
    const features: Feature[] = [
      { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true },
      { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: ['r:1'], extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true, exprs: { 'extent.to': 'width / 2' } },
      { id: 3, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [], radius: 1, chain: true, visible: true },
    ]
    const wide = evaluateParameters([param(1, 'width', '30')]).scope
    const r = applyParameters(features, wide)
    expect(r.changed).toBe(true)
    expect(r.errors.size).toBe(0)
    const s = r.features[0] as SketchFeature
    expect(s.sketch).not.toBe(sketch)
    expect(r.features[1]).toMatchObject({ extent: { to: 15 } })
    expect((r.features[1] as Extract<Feature, { kind: 'extrude' }>).regions).toHaveLength(1)
    // The fillet read nothing and is the same object.
    expect(r.features[2]).toBe(features[2])
    // Nothing moves a second time.
    const again = applyParameters(r.features, wide)
    expect(again.changed).toBe(false)
    expect(again.features[0]).toBe(r.features[0])
    expect(again.features[1]).toBe(r.features[1])
    // A parameter that cannot be read leaves everything standing and says so.
    const broken = applyParameters(r.features, evaluateParameters([param(1, 'width', 'nothing')]).scope)
    expect(broken.changed).toBe(false)
    expect(broken.errors.get(1)).toMatchObject({ [`dim:${width}`]: expect.stringContaining('“width” has no value') })
    expect(broken.errors.get(2)).toMatchObject({ 'extent.to': expect.stringContaining('“width” has no value') })
  })

  it('replace a sketch and rekey the features on it', () => {
    const { sketch } = square(10)
    const features: Feature[] = [
      { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true },
      { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: ['r:nothing'], extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true },
    ]
    const other = square(20).sketch
    const next = replaceSketch(features, 1, other, { name: 'Renamed' })
    expect(next[0]).toMatchObject({ name: 'Renamed', sketch: other })
    // A pick that matches nothing is kept as it was, for the feature to report.
    expect((next[1] as Extract<Feature, { kind: 'extrude' }>).regions).toEqual(['r:nothing'])
  })
})

describe('who reads a parameter', () => {
  const { sketch } = square(10)
  const parameters = [param(1, 'width', '40'), param(2, 'height', 'width / 2'), param(3, 'depth', '5')]
  const features: Feature[] = [
    { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true },
    { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: [], extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true, exprs: { 'extent.to': 'height + 1' } },
  ]

  it('lists them', () => {
    expect(usersOf('width', parameters, features)).toEqual([
      { kind: 'parameter', id: 2, name: 'height' },
      { kind: 'feature', id: 1, name: 'Sketch 1' },
    ])
    expect(usersOf('height', parameters, features)).toEqual([{ kind: 'feature', id: 2, name: 'Extrude 1' }])
    expect(usersOf('depth', parameters, features)).toEqual([])
  })

  it('renames it everywhere', () => {
    const renamed = renameInParameters(parameters, 1, 'w')
    expect(renamed.map((p) => [p.name, p.expression])).toEqual([
      ['w', '40'],
      ['height', 'w / 2'],
      ['depth', '5'],
    ])
    const s = renameInFeature(features[0], 'width', 'w') as SketchFeature
    expect(s.sketch.constraints.find((c) => isDimension(c) && c.expr)).toMatchObject({ expr: 'w' })
    expect(renameInFeature(features[1], 'width', 'w')).toBe(features[1])
    expect(renameInFeature(features[1], 'height', 'h')).toMatchObject({ exprs: { 'extent.to': 'h + 1' } })
  })
})
