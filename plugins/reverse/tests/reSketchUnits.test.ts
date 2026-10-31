// SPDX-License-Identifier: AGPL-3.0-only
// The sketch in the units shown: a dimension's number on the sheet written
// and opened for typing in inches while the sketch holds millimetres, an
// angle in degrees either way, and a moved face's sentence in inches — the
// same in millimetres as it always was.

import { describe, expect, it } from 'vitest'
import { type ExtrudeFeature, type SketchFeature } from '../core/features'
import { findRegions } from '../core/regions'
import { addRectangle, emptySketch, type Constraint } from '../core/sketch'
import { planMoves, planSnap } from '../core/snapEdit'
import type { FaceFingerprint } from '../core/topo'
import { bareLength, dimensionFieldText, dimensionText } from '../viewer/sketchDimText'
import { XY } from './reKit'

type Dimension = Extract<Constraint, { value: number }>
const dim = (kind: Dimension['kind'], value: number, expr?: string): Dimension => ({ id: 1, kind, entity: 1, value, ...(expr ? { expr } : {}) }) as unknown as Dimension

describe('a sketch dimension in the units shown', () => {
  it('writes a length in inches without zeros behind, an angle in degrees', () => {
    expect(bareLength(12.7)).toBe('12.7')
    expect(bareLength(12.7, 'in')).toBe('0.5')
    expect(bareLength(12.5, 'in')).toBe('0.4921')
    expect(dimensionText(dim('length', 25.4))).toBe('25.4')
    expect(dimensionText(dim('length', 25.4), 'in')).toBe('1')
    expect(dimensionText(dim('radius', 6.35), 'in')).toBe('R 0.25')
    expect(dimensionText(dim('diameter', 12.7), 'in')).toBe('Ø 0.5')
    expect(dimensionText(dim('angle', 30), 'in')).toBe('30°')
    expect(dimensionText(dim('length', 25.4, 'w'), 'in')).toBe('ƒ 1')
  })

  it('opens the field on the inch figure, the expression where one drives it', () => {
    expect(dimensionFieldText(dim('length', 12.7))).toBeUndefined()
    expect(dimensionFieldText(dim('length', 12.7), 'in')).toBe('0.5')
    expect(dimensionFieldText(dim('angle', 30), 'in')).toBeUndefined()
    expect(dimensionFieldText(dim('length', 12.7, 'w / 2'), 'in')).toBe('w / 2')
  })
})

describe('a moved face’s sentence in the units shown', () => {
  function block(): { sketch: SketchFeature; extrude: ExtrudeFeature } {
    const s = emptySketch()
    addRectangle(s, [0, 0], [50.8, 25.4])
    const sketch: SketchFeature = { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: s, visible: true }
    const region = findRegions(s)[0]
    const extrude: ExtrudeFeature = { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: [region.key], extent: { kind: 'distance', from: 0, to: 25.4 }, op: 'new', visible: true }
    return { sketch, extrude }
  }
  const plane = (centroid: [number, number, number], dir: [number, number, number]): FaceFingerprint => ({ kind: 'plane', centroid, dir, area: 100, origin: 2 })

  it('says the extrude’s distance in inches, and in millimetres by default', () => {
    const { sketch, extrude } = block()
    const top = plane([25.4, 12.7, 25.4], [0, 0, 1])
    const mm = planSnap([sketch, extrude], top, 6.35)
    const inch = planSnap([sketch, extrude], top, 6.35, [], 'in')
    if (mm.route === 'direct' || inch.route === 'direct') throw new Error('no plan')
    expect(mm.text).toBe('Extrude 1: To 25.4 → 31.75 mm')
    expect(inch.text).toBe('Extrude 1: To 1 → 1.25 in')
    // The edit itself is the same millimetres either way.
    expect(inch.features).toEqual(mm.features)
    const both = planMoves([sketch, extrude], [top], 6.35, [], 'in')
    if (both.route === 'direct') throw new Error(both.why)
    expect(both.text).toBe('Extrude 1: To 1 → 1.25 in')
  })

  it('says a wall’s move in inches', () => {
    const { sketch, extrude } = block()
    const plan = planSnap([sketch, extrude], plane([50.8, 12.7, 12.7], [1, 0, 0]), 2.54, [], 'in')
    if (plan.route === 'direct') throw new Error(plan.why)
    expect(plan.text).toBe('Sketch 1: the line under this face moves 0.1 in out')
  })
})
