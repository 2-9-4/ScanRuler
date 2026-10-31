// SPDX-License-Identifier: AGPL-3.0-only
// The nominal-value chips of the Reverse engineer workspace: what a measured
// figure is rounded to, and when it is left alone.

import { describe, expect, it } from 'vitest'
import { nominalOf, nominalStep, nominalText } from '../core/nominal'

describe('nominalOf', () => {
  it('rounds lengths to the half millimetre under 10 mm and the millimetre above', () => {
    expect(nominalOf(5.98, 'length')).toBe(6)
    expect(nominalOf(6.27, 'length')).toBe(6.5)
    expect(nominalOf(19.62, 'length')).toBe(20)
    expect(nominalOf(20.4, 'length')).toBe(20)
    expect(nominalStep(9.9, 'length')).toBe(0.5)
    expect(nominalStep(10.1, 'length')).toBe(1)
  })

  it('rounds radii to the half whatever their size, and angles to five degrees', () => {
    expect(nominalOf(1.97, 'radius')).toBe(2)
    expect(nominalOf(12.3, 'radius')).toBe(12.5)
    expect(nominalOf(44.8, 'angle')).toBe(45)
    expect(nominalOf(91.2, 'angle')).toBe(90)
  })

  it('keeps the sign — an extrude reaching behind its plane', () => {
    expect(nominalOf(-9.98, 'length')).toBe(-10)
    expect(nominalOf(-0.3, 'length')).toBe(-0.5)
  })

  it('offers nothing for a value that already is nominal', () => {
    expect(nominalOf(6, 'length')).toBeNull()
    expect(nominalOf(6.01, 'length')).toBeNull()
    expect(nominalOf(0, 'length')).toBeNull()
    expect(nominalOf(2.5, 'radius')).toBeNull()
    expect(nominalOf(90, 'angle')).toBeNull()
    expect(nominalOf(Number.NaN, 'length')).toBeNull()
  })

  it('a value just past the tolerance is offered', () => {
    expect(nominalOf(6.03, 'length')).toBe(6)
  })

  it('reads as the chip', () => {
    expect(nominalText(6, 'length')).toBe('6 mm')
    expect(nominalText(6.5, 'length')).toBe('6.5 mm')
    expect(nominalText(45, 'angle')).toBe('45°')
  })
})
