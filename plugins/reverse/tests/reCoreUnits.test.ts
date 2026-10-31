// SPDX-License-Identifier: AGPL-3.0-only
// The workspace's text builders in the units shown: what is picked, the
// nominal chip, a parameter's value, a plane's name, a face's and an edge's
// words, a thread's problem — in inches when asked, and in millimetres, as
// before, when not (the build's messages and the agent's answers).

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import type { FaceInfo } from '../core/build'
import { formatValue } from '../core/expression'
import { nominalText } from '../core/nominal'
import { describePlaneRef } from '../core/resolve'
import { selectionInfo, type PickedItem } from '../core/selectionInfo'
import { threadProblem } from '../core/thread'
import { describeEdge, describeEdgeIn, describeFace, describeFaceIn, type EdgeFingerprint, type FaceFingerprint } from '../core/topo'

const plane = (centroid: Vec3, normal: Vec3, area: number): PickedItem => {
  const face: FaceInfo = { hash: 1, fingerprint: { kind: 'plane', centroid, dir: normal, area, origin: 1 } }
  return { type: 'face', bodyId: 1, face, edges: [] }
}
const corner = (p: Vec3): PickedItem => ({ type: 'vertex', bodyId: 1, point: p })
const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value
const ctx = { sections: [{ id: 3, name: 'Section 1' }], elements: [] }

describe('what is picked, in inches', () => {
  it('a corner, a distance and an area read in inches; millimetres unchanged', () => {
    const one = selectionInfo([corner([25.4, 12.7, 0])], 'in')!
    expect(value(one.rows, 'X')).toBe('1.0000 in')
    expect(value(one.rows, 'Y')).toBe('0.5000 in')
    expect(value(selectionInfo([corner([0, 0, 0]), corner([0, 0, 50.8])], 'in')!.rows, 'Distance')).toBe('2.0000 in')
    expect(value(selectionInfo([plane([25.4, 0, 0], [0, 0, 1], 645.16)], 'in')!.rows, 'Area')).toBe('1.000 in²')
    expect(value(selectionInfo([plane([25.4, 0, 0], [0, 0, 1], 645.16)], 'in')!.rows, 'Centre')).toBe('1.0000, 0.0000, 0.0000')
    expect(value(selectionInfo([plane([25.4, 0, 0], [0, 0, 1], 645.16)])!.rows, 'Area')).toBe('645.16 mm²')
    expect(value(selectionInfo([corner([25.4, 12.7, 0])])!.rows, 'X')).toBe('25.400 mm')
  })
})

describe('the nominal chip', () => {
  it('a millimetre nominal in inches to the ten-thousandth; angles as they are', () => {
    expect(nominalText(6, 'length', 'in')).toBe('0.2362 in')
    expect(nominalText(2.5, 'radius', 'in')).toBe('0.0984 in')
    expect(nominalText(45, 'angle', 'in')).toBe('45°')
    expect(nominalText(1.5, 'draft', 'in')).toBe('1.5°')
    expect(nominalText(6, 'length')).toBe('6 mm')
    expect(nominalText(6.5, 'radius')).toBe('6.5 mm')
  })
})

describe("a parameter's value", () => {
  it('a length in inches, no zeros behind it; other kinds as they are', () => {
    expect(formatValue(25.4, 'length', 'in')).toBe('1 in')
    expect(formatValue(35, 'length', 'in')).toBe('1.378 in')
    expect(formatValue(30, 'angle', 'in')).toBe('30°')
    expect(formatValue(6, 'integer', 'in')).toBe('6')
    expect(formatValue(35, 'length')).toBe('35 mm')
  })
})

describe("a plane's name", () => {
  it('its offset in inches', () => {
    expect(describePlaneRef({ kind: 'section', id: 3, offset: 12.7 }, ctx, 'in')).toBe('Section 1, +0.500 in off it')
    expect(describePlaneRef({ kind: 'section', id: 3, offset: -25.4 }, ctx, 'in')).toBe('Section 1, −1.000 in off it')
    expect(describePlaneRef({ kind: 'world', axis: 'z', offset: 25.4 }, ctx, 'in')).toBe('XY plane at Z = 1.000')
    expect(describePlaneRef({ kind: 'section', id: 3, offset: 12.7 }, ctx)).toBe('Section 1, +12.70 mm off it')
    expect(describePlaneRef({ kind: 'world', axis: 'z', offset: 25.4 }, ctx)).toBe('XY plane at Z = 25.40')
  })
})

describe("a face's and an edge's words", () => {
  const cylinder: FaceFingerprint = { kind: 'cylinder', centroid: [25.4, 0, 12.7], dir: [0, 0, 1], area: 100, radius: 6.35, origin: 1 }
  const flat: FaceFingerprint = { kind: 'plane', centroid: [0, 0, 0], dir: [0, 0, 1], area: 645.16, origin: 1 }
  const line: EdgeFingerprint = { kind: 'line', mid: [25.4, 0, 0], dir: [1, 0, 0], length: 50.8, faces: [], origin: 1 }
  it('in inches for a page, in millimetres for the build', () => {
    expect(describeFaceIn('in')(cylinder)).toBe('cylinder Ø0.500 at (1.000, 0.000, 0.500)')
    expect(describeFaceIn('in')(flat)).toBe('plane 1.000 in² at (0.000, 0.000, 0.000)')
    expect(describeEdgeIn('in')(line)).toBe('line 2.000 in at (1.000, 0.000, 0.000)')
    expect(describeFace(cylinder)).toBe('cylinder Ø12.7 at (25.4, 0.0, 12.7)')
    expect(describeFace(flat)).toBe('plane 645 mm² at (0.0, 0.0, 0.0)')
    expect(describeEdge(line)).toBe('line 50.8 mm at (25.4, 0.0, 0.0)')
    expect([flat].map(describeFaceIn('mm'))).toEqual([describeFace(flat)])
  })
})

describe("a thread's problem", () => {
  it('its figures in inches when asked', () => {
    const coarse = { standard: 'metric' as const, diameter: 2, pitch: 1.27, offset: 0 }
    expect(threadProblem(coarse, 'in')).toBe('A pitch of 0.05 in is too coarse for Ø0.0787 in — the thread would reach the axis.')
    expect(threadProblem(coarse)).toBe('A pitch of 1.27 mm is too coarse for Ø2 mm — the thread would reach the axis.')
  })
})
