// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import {
  MM_PER_INCH,
  displayUnitsOf,
  fmtArea,
  fmtLen,
  fmtVol,
  fromDisplay,
  lengthDecimals,
  lengthInputText,
  lengthStep,
  presetsMm,
  toDisplay,
  unitWord,
} from '../src/core/units'
import { lengthField } from '../src/ui/NumberField'

describe('toDisplay / fromDisplay', () => {
  it('leaves millimetres alone', () => {
    expect(toDisplay(12.7, 'mm')).toBe(12.7)
    expect(fromDisplay(12.7, 'mm')).toBe(12.7)
  })

  it('converts inches both ways', () => {
    expect(toDisplay(25.4, 'in')).toBe(1)
    expect(fromDisplay(0.5, 'in')).toBe(12.7)
    expect(toDisplay(-50.8, 'in')).toBe(-2)
  })

  it('round-trips without drift', () => {
    for (const mm of [0, 0.001, 0.1, 1, 3.175, 12.7, 99.99, -42.42, 12345.678]) {
      expect(fromDisplay(toDisplay(mm, 'in'), 'in')).toBeCloseTo(mm, 9)
    }
  })
})

describe('lengthDecimals', () => {
  it('keeps the decimals in millimetres', () => {
    expect(lengthDecimals(0, 'mm')).toBe(0)
    expect(lengthDecimals(3, 'mm')).toBe(3)
  })

  it('gives inches one more, at least three', () => {
    expect(lengthDecimals(0, 'in')).toBe(3)
    expect(lengthDecimals(1, 'in')).toBe(3)
    expect(lengthDecimals(2, 'in')).toBe(3)
    expect(lengthDecimals(3, 'in')).toBe(4)
    expect(lengthDecimals(4, 'in')).toBe(5)
  })
})

describe('fmtLen', () => {
  it('writes the figure with its unit', () => {
    expect(fmtLen(12.7, 'mm')).toBe('12.700 mm')
    expect(fmtLen(12.7, 'in')).toBe('0.5000 in')
    expect(fmtLen(12.7, 'mm', 1)).toBe('12.7 mm')
    expect(fmtLen(12.7, 'in', 1)).toBe('0.500 in')
  })

  it('leaves the word off when bare', () => {
    expect(fmtLen(25.4, 'in', 3, { bare: true })).toBe('1.0000')
  })

  it('writes 0 and a rounded-away negative as 0', () => {
    expect(fmtLen(0, 'mm')).toBe('0.000 mm')
    expect(fmtLen(0, 'in')).toBe('0.0000 in')
    expect(fmtLen(-0.0001, 'mm')).toBe('0.000 mm')
    expect(fmtLen(-0.0001, 'in', 3, { signed: true })).toBe('0.0000 in')
  })

  it('keeps the sign of a negative, and signs a positive when asked', () => {
    expect(fmtLen(-1.5, 'mm', 2)).toBe('-1.50 mm')
    expect(fmtLen(-25.4, 'in', 2)).toBe('-1.000 in')
    expect(fmtLen(0.05, 'mm', 3, { signed: true })).toBe('+0.050 mm')
    expect(fmtLen(-0.05, 'mm', 3, { signed: true })).toBe('-0.050 mm')
  })

  it('writes large figures in full', () => {
    expect(fmtLen(1234567.891, 'mm', 2)).toBe('1234567.89 mm')
    expect(fmtLen(25400, 'in', 0)).toBe('1000.000 in')
  })
})

describe('fmtArea / fmtVol', () => {
  it('scale by the square and the cube', () => {
    expect(fmtArea(MM_PER_INCH ** 2, 'in')).toBe('1.000 in²')
    expect(fmtArea(100, 'mm')).toBe('100.0 mm²')
    expect(fmtVol(MM_PER_INCH ** 3, 'in')).toBe('1.000 in³')
    expect(fmtVol(1000, 'mm', 0)).toBe('1000 mm³')
    expect(fmtVol(2 * MM_PER_INCH ** 3, 'in', 2, { bare: true })).toBe('2.000')
  })
})

describe('unitWord', () => {
  it('names the unit to a power', () => {
    expect(unitWord('mm')).toBe('mm')
    expect(unitWord('in', 2)).toBe('in²')
    expect(unitWord('mm', 3)).toBe('mm³')
  })
})

describe('lengthStep', () => {
  it('keeps millimetre steps', () => {
    expect(lengthStep(0.1, 'mm')).toBe(0.1)
  })

  it('gives the steps in use a round inch neighbour', () => {
    expect(lengthStep(0.001, 'in')).toBe(0.0001)
    expect(lengthStep(0.01, 'in')).toBe(0.001)
    expect(lengthStep(0.05, 'in')).toBe(0.005)
    expect(lengthStep(0.1, 'in')).toBe(0.005)
    expect(lengthStep(1, 'in')).toBe(0.05)
    expect(lengthStep(5, 'in')).toBe(0.25)
  })

  it('falls back to one significant figure', () => {
    expect(lengthStep(2, 'in')).toBe(0.08)
    expect(lengthStep(25, 'in')).toBe(1)
  })

  it('passes a step that is not a size through', () => {
    expect(lengthStep(0, 'in')).toBe(0)
  })
})

describe('lengthInputText', () => {
  it('shows what was typed in inches without float noise', () => {
    expect(lengthInputText(fromDisplay(0.5, 'in'), 'in')).toBe('0.5')
    expect(lengthInputText(fromDisplay(0.1234, 'in'), 'in')).toBe('0.1234')
    expect(lengthInputText(0.3, 'mm')).toBe('0.3')
  })
})

describe('presetsMm', () => {
  it('picks the list for the units, as millimetres', () => {
    const p = { mm: [0.1, 0.5], in: [0.005, 0.02] }
    expect(presetsMm(p, 'mm')).toEqual([0.1, 0.5])
    expect(presetsMm(p, 'in')).toEqual([0.127, 0.508])
  })
})

describe('displayUnitsOf', () => {
  it('reads only the two display units', () => {
    expect(displayUnitsOf('in')).toBe('in')
    expect(displayUnitsOf('mm')).toBe('mm')
    expect(displayUnitsOf('cm')).toBeNull()
    expect(displayUnitsOf(null)).toBeNull()
  })
})

describe('a length field', () => {
  it('shows inches and commits millimetres', () => {
    const f = lengthField('in')
    expect(f.text(12.7)).toBe('0.5')
    expect(f.read(0.25)).toBe(6.35)
    expect(f.step(0.01)).toBe(0.001)
    expect(f.step('any')).toBe('any')
    expect(f.min(25.4)).toBe(1)
    expect(f.min(-Infinity)).toBe(-Infinity)
    expect(f.word).toBe('in')
  })

  it('is the plain field in millimetres', () => {
    const f = lengthField('mm')
    expect(f.text(0.3)).toBe('0.3')
    expect(f.read(0.3)).toBe(0.3)
    expect(f.step(0.1)).toBe(0.1)
    expect(f.word).toBe('mm')
  })
})
