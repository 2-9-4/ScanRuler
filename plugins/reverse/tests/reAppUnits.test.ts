// SPDX-License-Identifier: AGPL-3.0-only
// The workspace's store actions say lengths in the units shown, and hold
// millimetres whatever is shown: an extrude's end put through a point on
// the part, read out in inches; the row's and the grip's number still held,
// and named, in millimetres. Plain zustand, no DOM.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePrefs } from '../../../src/state/prefsStore'
import { keyParameterOf, useReverse } from '../state/reStore'
import { XY } from './reKit'

const s = () => useReverse.getState()

function finishSquare(size = 10): number {
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  s().setSketchTool('rectangle')
  s().sketchClick([0, 0], 0.5, false, { off: true })
  s().sketchClick([size, size], 0.5, false, { off: true })
  const id = s().commitSketch()
  if (id === null) throw new Error('the square did not finish')
  return id
}

beforeEach(() => {
  useReverse.setState({ features: [], rolledBack: [], featureDraft: null, nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [] })
})

afterEach(() => usePrefs.setState({ units: 'mm' }))

describe('an extrude’s end through a point, with inches shown', () => {
  it('says the height in inches and holds it in millimetres', () => {
    usePrefs.setState({ units: 'in' })
    s().startExtrude(finishSquare())
    expect(s().extrudeToPoint([3, 3, 25.4])).toMatch(/^To = 1\.000 in, the height of the point clicked\.$/)
    expect(s().extrudeDraft?.extent).toEqual({ kind: 'distance', from: 0, to: 25.4 })
    expect(s().extrudeToPoint([3, 3, -12.7])).toMatch(/^From = -0\.500 in.*behind the sketch plane/)
    expect(s().extrudeDraft?.extent).toEqual({ kind: 'distance', from: -12.7, to: 25.4 })
  })

  it('says a symmetric total in inches', () => {
    usePrefs.setState({ units: 'in' })
    s().startExtrude(finishSquare())
    s().setExtrude({ extent: { kind: 'symmetric', total: 10 } })
    expect(s().extrudeToPoint([0, 0, 25.4])).toMatch(/^Total 2\.000 in — each half/)
  })

  it('reads as before in millimetres', () => {
    s().startExtrude(finishSquare())
    expect(s().extrudeToPoint([3, 3, 17.456])).toMatch(/^To = 17\.46 mm, /)
  })
})

describe('the number a row reads, with inches shown', () => {
  it('is still held, and named, in millimetres — the screen converts it', () => {
    usePrefs.setState({ units: 'in' })
    s().startExtrude(finishSquare())
    s().setExtrude({ extent: { kind: 'distance', from: 0, to: 12.7 } })
    s().commitExtrude()
    const extrude = s().features.find((f) => f.kind === 'extrude')
    expect(extrude && keyParameterOf(extrude)).toEqual({ value: 12.7, unit: 'mm' })
  })
})
