// SPDX-License-Identifier: AGPL-3.0-only
// A section as a plane in a dimension: the plane it was cut on, its patch
// what the cut covers; picked into a dimension like a fitted plane, kept out
// of the tolerances, and taken away with the dimensions on it.
import { beforeEach, describe, expect, it } from 'vitest'
import { evaluateDimension, evaluateDimensions } from '../src/core/dimensions'
import { sectionPlane, type SectionFrame } from '../src/core/section/frame'
import type { SectionCut } from '../src/core/section/slice'
import type { PlaneFit } from '../src/core/types'
import { dimensionRefsOf } from '../src/state/sectionModel'
import { useStore, type Element, type Section } from '../src/state/store'

const plane: PlaneFit = {
  kind: 'plane',
  center: [0, 0, 0],
  normal: [0, 0, 1],
  basisU: [1, 0, 0],
  basisV: [0, 1, 0],
  extentU: 5,
  extentV: 5,
  sigma: 0.01,
  usedPoints: 100,
  regionSize: 100,
  residualMin: -0.02,
  residualMax: 0.03,
}

const frame = (z: number): SectionFrame => ({
  origin: [0, 0, z],
  normal: [0, 0, 1],
  basisU: [1, 0, 0],
  basisV: [0, 1, 0],
})

/** A rectangle 8 × 4 mm with its corner at (2, 1), at height z. */
function rectCut(z: number): SectionCut {
  return {
    points: Float32Array.from([2, 1, z, 10, 1, z, 10, 5, z, 2, 5, z, 2, 1, z]),
    offsets: Uint32Array.from([0, 5]),
  }
}

function section(id: number, z: number): Section {
  return { id, name: `Section ${id}`, color: '#456', visible: true, frame: frame(z), ref: 'z', offset: z, cut: rectCut(z) }
}

const planeElement: Element = {
  id: 1,
  kind: 'plane',
  name: 'Plane 1',
  color: '#123',
  source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } },
  status: 'done',
  visible: true,
  fit: plane,
}

describe('sectionPlane', () => {
  it('is the plane of the frame, its patch what the cut covers', () => {
    const p = sectionPlane(frame(7), rectCut(7))
    expect(p.kind).toBe('plane')
    expect(p.normal).toEqual([0, 0, 1])
    expect(p.center[0]).toBeCloseTo(6)
    expect(p.center[1]).toBeCloseTo(3)
    expect(p.center[2]).toBeCloseTo(7)
    expect(p.extentU).toBeCloseTo(4)
    expect(p.extentV).toBeCloseTo(2)
    // No surface of its own: nothing to stray, no form.
    expect(p.formError).toBeUndefined()
    expect(p.residualMin).toBeUndefined()
  })

  it('stands at the frame origin with no patch until the cut is in', () => {
    const p = sectionPlane(frame(3), undefined)
    expect(p.center).toEqual([0, 0, 3])
    expect(p.extentU).toBe(0)
  })

  it('measures a plane distance from a fitted plane to it', () => {
    const v = evaluateDimension('dist-plane-plane', [sectionPlane(frame(12), rectCut(12)), plane])
    expect(v.invalid).toBeUndefined()
    expect(v.raw).toBeCloseTo(12)
    // Only the fitted plane has a surface to widen the reading.
    expect(v.range).toBeUndefined()
  })
})

describe('a section in a dimension', () => {
  beforeEach(() => {
    useStore.getState().beginLoad('rim.stl')
    useStore.getState().finishLoad(100, 50, 20, [0, 0, 0])
    useStore.setState({ elements: [planeElement], sections: [section(2, 12)], nextId: 3, nextNumber: 3 })
  })

  it('is offered as a plane, named as the section', () => {
    const refs = dimensionRefsOf(useStore.getState().elements, useStore.getState().sections)
    expect(refs.map((r) => [r.id, r.kind, r.name, Boolean(r.section)])).toEqual([
      [1, 'plane', 'Plane 1', false],
      [2, 'plane', 'Section 2', true],
    ])
  })

  it('is picked into a dimension like a plane, and the distance reads off it', () => {
    const s = useStore.getState()
    s.startDimension('dist-point-point')
    useStore.getState().selectDimensionElement(1)
    useStore.getState().selectDimensionElement(2)
    const dd = useStore.getState().dimDraft!
    expect(dd.type).toBe('dist-plane-plane')
    expect(dd.refs).toEqual([1, 2])
    useStore.getState().commitDimension()
    const st = useStore.getState()
    const [row] = evaluateDimensions(st.dimensions, dimensionRefsOf(st.elements, st.sections))
    expect(row.title).toBe('Plane 1 → Section 2')
    expect(row.value.raw).toBeCloseTo(12)
  })

  it('is not taken by a tolerance', () => {
    useStore.getState().startDimension('form-flatness')
    useStore.getState().selectDimensionElement(2)
    expect(useStore.getState().dimDraft!.refs.every((r) => r === null)).toBe(true)
  })

  it('takes the dimensions on it along when it is removed', () => {
    useStore.setState({
      dimensions: [
        { id: 1, type: 'dist-plane-plane', name: 'Distance 1', refs: [1, 2] },
        { id: 2, type: 'size-diameter', name: 'Diameter 1', refs: [1] },
      ],
    })
    useStore.getState().editDimension(1)
    useStore.getState().removeSection(2)
    const st = useStore.getState()
    expect(st.sections).toEqual([])
    expect(st.dimensions.map((d) => d.id)).toEqual([2])
    // The box open on the dimension that went is closed with it.
    expect(st.dimDraft).toBeNull()
  })
})
