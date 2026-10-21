// SPDX-License-Identifier: AGPL-3.0-only
// Centres on the 2D sheet: the circle through the centres of a bolt pattern,
// picks that snap to a centre, and a construction or a dimension filled by
// clicking the holes on the sheet.
import { beforeEach, describe, expect, it } from 'vitest'
import { evaluateFlatConstruction, flatConstructRefs, flatMethod, flatSlotLabel } from '../src/core/flat/construct'
import { fitCirclePoints, flatPoint } from '../src/core/flat/fit'
import { distanceToFit, elementNear, nearestCenter } from '../src/core/flat/snap'
import type { FlatFit, Vec2 } from '../src/core/flat/types'
import { useFlat } from '../src/state/flatStore'

/** A hole of radius 2 mm at `c`, as the fit through four points on its rim. */
const hole = (c: Vec2): FlatFit =>
  fitCirclePoints([
    [c[0] + 2, c[1]],
    [c[0], c[1] + 2],
    [c[0] - 2, c[1]],
    [c[0], c[1] - 2],
  ])

/** Six holes on a 50 mm pitch circle round (100, 100). */
const pattern: Vec2[] = Array.from({ length: 6 }, (_, k) => [
  100 + 25 * Math.cos((k * Math.PI) / 3),
  100 + 25 * Math.sin((k * Math.PI) / 3),
])

describe('the circle through centres', () => {
  it('fits the pitch circle through every hole given', () => {
    const fit = evaluateFlatConstruction('flat-circle-centers', pattern.map(hole))
    expect(fit.kind).toBe('circle')
    if (fit.kind !== 'circle') return
    expect(2 * fit.radius).toBeCloseTo(50, 6)
    expect(fit.center[0]).toBeCloseTo(100, 6)
    expect(fit.usedPoints).toBe(6)
  })

  it('refuses fewer than three, and a reference with no centre', () => {
    expect(() => evaluateFlatConstruction('flat-circle-centers', pattern.slice(0, 2).map(hole))).toThrow(/three/)
    const line: FlatFit = { kind: 'line', center: [0, 0], dir: [1, 0], length: 4, sigma: 0, usedPoints: 2 }
    expect(() => evaluateFlatConstruction('flat-circle-centers', [hole(pattern[0]), hole(pattern[1]), line])).toThrow(/point/)
  })

  it('numbers the slots past its three and closes up behind one taken out', () => {
    const m = flatMethod('flat-circle-centers')
    expect(flatSlotLabel(m, 0)).toBe('Center 1')
    expect(flatSlotLabel(m, 4)).toBe('Center 5')
    expect(flatConstructRefs(m, [1, null, 3, 4, 5])).toEqual([1, 3, 4, 5])
    expect(flatConstructRefs(m, [1, null, 3])).toEqual([1, 3, null])
    // A fixed construction keeps its slots where they are.
    expect(flatConstructRefs(flatMethod('flat-point-midpoint'), [null, 2])).toEqual([null, 2])
  })
})

describe('clicking near a feature', () => {
  it('finds a centre within reach and none beyond it', () => {
    const fits = [hole([10, 10]), flatPoint([30, 30])]
    expect(nearestCenter([10.5, 10], fits, 1)).toEqual([10, 10])
    expect(nearestCenter([29.4, 30], fits, 1)).toEqual([30, 30])
    expect(nearestCenter([20, 20], fits, 1)).toBeNull()
  })

  it('takes a hole by its rim or its centre, an arc only along its sweep', () => {
    const h = hole([0, 0])
    expect(distanceToFit(h, [0.1, 0])).toBeCloseTo(0.1)
    expect(distanceToFit(h, [2.2, 0])).toBeCloseTo(0.2)
    const arc: FlatFit = { kind: 'arc', center: [0, 0], radius: 2, start: 0, sweep: Math.PI / 2, sigma: 0, usedPoints: 3 }
    expect(distanceToFit(arc, [0, 2.1])).toBeCloseTo(0.1)
    expect(distanceToFit(arc, [0, -2.1])).toBeCloseTo(2.1)
    expect(elementNear([0, 2.1], [{ fit: arc }, { fit: null }], 0.5)).toEqual({ fit: arc })
  })
})

function reset() {
  useFlat.setState({
    elements: [],
    draft: null,
    nextId: 1,
    nameCounts: {},
    dimensions: [],
    dimDraft: null,
    nextDimId: 1,
    dimCounts: {},
    pxPerMm: null,
    calSource: 'none',
    tool: { kind: 'none' },
    splitAxes: false,
    snapToEdge: true,
  })
  // 10 px/mm: the sheet is in millimetres, the picks in pixels.
  useFlat.getState().finishImageLoad('flange.png', 3000, 3000, { x: 10, y: 10 })
}

/** Make a hole on the sheet by picking its rim, in image pixels. */
function makeHole(c: Vec2): number {
  const s = useFlat.getState()
  s.startDraft('circle', 'flat-circle-pick')
  for (const [dx, dy] of [
    [20, 0],
    [0, 20],
    [-20, 0],
  ])
    useFlat.getState().addDraftPick([c[0] * 10 + dx, c[1] * 10 + dy])
  const id = useFlat.getState().commitDraft()!
  useFlat.getState().cancelDraft()
  return id
}

// One screen pixel is a tenth of a millimetre: a click reaches 1 mm.
const meta = { alt: false, unitsPerScreenPx: 0.1 }

describe('the sheet', () => {
  beforeEach(reset)

  it('snaps a pick to a centre within reach, and Alt places it freely', () => {
    makeHole([50, 50])
    useFlat.getState().startDraft('point', 'flat-point-pick')
    useFlat.getState().stageClick([50.6, 49.7], meta, null)
    let fit = useFlat.getState().draft!.fit
    expect(fit?.kind === 'point' && fit.at).toEqual([50, 50])
    useFlat.getState().stageClick([50.6, 49.7], { ...meta, alt: true }, null)
    fit = useFlat.getState().draft!.fit
    expect(fit?.kind === 'point' && fit.at[0]).toBeCloseTo(50.6)
  })

  it('builds a bolt circle from the holes clicked one after another', () => {
    const ids = pattern.map((c) => makeHole(c))
    useFlat.getState().startDraft('circle', 'flat-circle-centers')
    // Each hole by its rim, the last by its centre.
    for (const c of pattern.slice(0, 5)) useFlat.getState().stageClick([c[0] + 2.1, c[1]], meta, null)
    useFlat.getState().stageClick(pattern[5], meta, null)
    let d = useFlat.getState().draft!
    expect(d.refs).toEqual(ids)
    expect(d.fit?.kind === 'circle' && 2 * d.fit.radius).toBeCloseTo(50, 3)
    // A click on one already taken lets it go, and the rest close up.
    useFlat.getState().stageClick(pattern[1], meta, null)
    d = useFlat.getState().draft!
    expect(d.refs).toEqual([ids[0], ...ids.slice(2)])
    expect(d.fit).not.toBeNull()
    const id = useFlat.getState().commitDraft()!
    const el = useFlat.getState().elements.find((e) => e.id === id)!
    expect(el.source).toEqual({ type: 'construct', method: 'flat-circle-centers', refs: [ids[0], ...ids.slice(2)] })
  })

  it('fills a dimension with the holes clicked', () => {
    const a = makeHole([20, 20])
    const b = makeHole([60, 20])
    useFlat.getState().startDimDraft()
    useFlat.getState().stageClick([20, 20], meta, null)
    useFlat.getState().stageClick([62.1, 20], meta, null)
    expect(useFlat.getState().dimDraft!.refs).toEqual([a, b])
  })
})
