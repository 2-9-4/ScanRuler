// SPDX-License-Identifier: AGPL-3.0-only
// The workspace's lengths in the display units: the text a row and a field
// show, and what typed text is kept as — a plain number in inches held as
// its millimetres, bare arithmetic kept so that it reads the same when the
// model evaluates it again in millimetres, anything with a parameter or a
// unit kept as typed. In millimetres every one is what it always was.

import { describe, expect, it } from 'vitest'
import { evaluateFor, LENGTH, type Scope } from '../core/expression'
import { evaluateParameters, type Parameter } from '../core/parameters'
import { bodyFeatureReading, keyParameter } from '../ui/featureReading'
import { fieldText, lenBare, lenShort, parameterExpression, parameterText, readField } from '../ui/reLength'

const none: Scope = () => undefined
const width: Scope = (name) => (name === 'width' ? { value: 20, dim: LENGTH } : undefined)

describe('length text', () => {
  it('reads as before in millimetres', () => {
    expect(lenShort(12.345, 'mm')).toBe('12.35 mm')
    expect(lenBare(13.4349, 'mm')).toBe('13.435')
    expect(fieldText(10, 'length', 3, 'mm')).toBe('10')
    expect(fieldText(30.123, 'angle', 2, 'mm')).toBe('30.12')
  })

  it('reads in inches, a decimal more', () => {
    expect(lenShort(12.7, 'in')).toBe('0.5 in')
    expect(lenBare(6.35, 'in')).toBe('0.25')
    expect(fieldText(25.4, 'length', 3, 'in')).toBe('1')
    expect(fieldText(1, 'length', 3, 'in')).toBe('0.0394')
    // An angle is no length: the same in either unit.
    expect(fieldText(30.123, 'angle', 2, 'in')).toBe('30.12')
  })
})

describe('a field read', () => {
  it('in millimetres, as it always was', () => {
    expect(readField('12', 'length', none, 'mm')).toEqual({ ok: true, value: 12, expr: null })
    expect(readField('width + 5', 'length', width, 'mm')).toEqual({ ok: true, value: 25, expr: 'width + 5' })
    expect(readField('-5', 'length', none, 'mm')).toEqual({ ok: true, value: -5, expr: '-5' })
  })

  it('takes a plain number in inches and holds its millimetres', () => {
    expect(readField('0.5', 'length', none, 'in')).toEqual({ ok: true, value: 12.7, expr: null })
    expect(readField('-2', 'length', none, 'in')).toEqual({ ok: true, value: -50.8, expr: null })
  })

  it('keeps bare arithmetic so it reads in inches when evaluated again', () => {
    const r = readField('1/4', 'length', none, 'in')
    expect(r).toEqual({ ok: true, value: 6.35, expr: '(1/4) * 1 in' })
    // The model evaluates what is kept in millimetres, and gets the same.
    const again = evaluateFor((r as { expr: string }).expr, 'length', none)
    expect(again.ok && again.value).toBeCloseTo(6.35, 12)
  })

  it('keeps an expression with a parameter or a unit as typed', () => {
    expect(readField('width + 5', 'length', width, 'in')).toEqual({ ok: true, value: 25, expr: 'width + 5' })
    expect(readField('2 in', 'length', none, 'in')).toEqual({ ok: true, value: 50.8, expr: '2 in' })
  })

  it('leaves a field that is no length alone', () => {
    expect(readField('30', 'angle', none, 'in')).toEqual({ ok: true, value: 30, expr: null })
    expect(readField('3', 'integer', none, 'in')).toEqual({ ok: true, value: 3, expr: null })
  })

  it('refuses what the field refuses', () => {
    expect(readField('width +', 'length', width, 'in').ok).toBe(false)
  })
})

describe('a parameter row', () => {
  const p = (expression: string): Parameter => ({ id: 1, name: 'w', kind: 'length', expression }) as Parameter

  it('shows a length given as a plain number in inches', () => {
    expect(parameterText('25.4', 'length', 'in')).toBe('1')
    expect(parameterText('25.4', 'length', 'mm')).toBe('25.4')
    expect(parameterText('width / 2', 'length', 'in')).toBe('width / 2')
    expect(parameterText('30', 'angle', 'in')).toBe('30')
  })

  it('keeps a figure typed in inches so that it reads as millimetres', () => {
    expect(parameterExpression('1', 'length', 'in')).toBe('1 in')
    expect(parameterExpression('0.5 + 0.25', 'length', 'in')).toBe('(0.5 + 0.25) * 1 in')
    expect(parameterExpression('width + 1 in', 'length', 'in')).toBe('width + 1 in')
    expect(parameterExpression('1', 'length', 'mm')).toBe('1')
    expect(parameterExpression('45', 'angle', 'in')).toBe('45')
    expect(evaluateParameters([p(parameterExpression('1', 'length', 'in'))]).readings[0].value).toBeCloseTo(25.4, 12)
    expect(evaluateParameters([p(parameterExpression('0.5 + 0.25', 'length', 'in'))]).readings[0].value).toBeCloseTo(19.05, 12)
  })
})

describe('feature rows', () => {
  const names = (id: number) => `Body ${id}`
  const ctx = { sections: [], elements: [] }

  it('read as before in millimetres, and in inches when asked', () => {
    const extrude = { kind: 'extrude' as const, extent: { kind: 'distance' as const, from: 0, to: 25.4 } }
    expect(keyParameter(extrude)).toBe('25.4 mm')
    expect(keyParameter(extrude, 'in')).toBe('1 in')
    const shell = { kind: 'shell', id: 2, name: 'Shell', body: 1, faces: [], thickness: 2 } as unknown as Parameters<typeof bodyFeatureReading>[0]
    expect(bodyFeatureReading(shell, names, ctx).text).toBe('2 mm wall')
    expect(bodyFeatureReading(shell, names, ctx, 'in').text).toBe('0.079 in wall')
    const move = { kind: 'moveBody', id: 3, name: 'Move', bodies: [1], copy: false, translate: [25.4, 0, 0], rotate: [0, 0, 0], pivot: [0, 0, 0] } as unknown as Parameters<typeof bodyFeatureReading>[0]
    expect(bodyFeatureReading(move, names, ctx, 'in').title).toContain('carried 1, 0, 0 in along X, Y, Z')
  })
})
