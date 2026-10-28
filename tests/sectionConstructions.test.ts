// SPDX-License-Identifier: AGPL-3.0-only
// A section as a plane in a construction: a midplane between two cuts, a
// line where a cut meets a face — filled into a plane's slot as a plane
// element is, followed when the section is edited or re-cut, and taking
// what is built on it along when it is deleted. An alignment to a plane and
// a symmetry seed take one too.
import { beforeEach, describe, expect, it } from 'vitest'
import type { SectionFrame } from '../src/core/section/frame'
import type { SectionCut } from '../src/core/section/slice'
import { buildSummary } from '../src/core/summary'
import { sectionKeyOf } from '../src/state/sectionModel'
import type { PlaneFit } from '../src/core/types'
import { useStore, type Element, type Section } from '../src/state/store'

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

/** A face standing square to the cuts, x = 0. */
const wall: PlaneFit = {
  kind: 'plane',
  center: [0, 3, 5],
  normal: [1, 0, 0],
  basisU: [0, 1, 0],
  basisV: [0, 0, 1],
  extentU: 4,
  extentV: 4,
  sigma: 0.01,
  usedPoints: 100,
  regionSize: 100,
}

const wallElement: Element = {
  id: 1,
  kind: 'plane',
  name: 'Wall',
  color: '#123',
  source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } },
  status: 'done',
  visible: true,
  fit: wall,
}

const fitOf = (id: number) => useStore.getState().elements.find((e) => e.id === id)?.fit

/** A midplane between sections 2 and 3, made as the panel makes it. */
function midplane(): number {
  const s = useStore.getState()
  s.startDraft('plane')
  useStore.getState().setDraftMethod('plane-midplane')
  useStore.getState().setDraftRef(0, 2)
  useStore.getState().setDraftRef(1, 3)
  return useStore.getState().commitDraft()!
}

describe('a section in a construction', () => {
  beforeEach(() => {
    useStore.getState().beginLoad('rim.stl')
    useStore.getState().finishLoad(100, 50, 20, [0, 0, 0])
    useStore.setState({
      elements: [wallElement],
      sections: [section(2, 4), section(3, 10)],
      dimensions: [],
      nextId: 4,
      nextNumber: 4,
    })
  })

  it('fills a plane slot, and the midplane between two cuts lies halfway', () => {
    const id = midplane()
    const fit = fitOf(id)
    expect(fit?.kind).toBe('plane')
    if (fit?.kind !== 'plane') return
    expect(fit.center[2]).toBeCloseTo(7)
    expect(Math.abs(fit.normal[2])).toBeCloseTo(1)
  })

  it('takes no section in a slot that is not a plane', () => {
    useStore.getState().startDraft('line')
    useStore.getState().setDraftMethod('line-axis')
    useStore.getState().setDraftRef(0, 2)
    expect(useStore.getState().draft?.status).not.toBe('ready')
  })

  it('meets a face along a line', () => {
    useStore.getState().startDraft('line')
    useStore.getState().setDraftMethod('line-plane-plane')
    useStore.getState().setDraftRef(0, 1)
    useStore.getState().setDraftRef(1, 3)
    const d = useStore.getState().draft!
    expect(d.status).toBe('ready')
    if (d.fit?.kind !== 'line') throw new Error('not a line')
    expect(Math.abs(d.fit.dir[1])).toBeCloseTo(1)
    expect(d.fit.center[0]).toBeCloseTo(0)
    expect(d.fit.center[2]).toBeCloseTo(10)
  })

  it('follows the section when it is edited', () => {
    const id = midplane()
    useStore.getState().editSection(3)
    useStore.getState().setSectionDraftOffset(20)
    const d = useStore.getState().sectionDraft!
    useStore.getState().resolveSectionDraft(sectionKeyOf(d.frame!, d), rectCut(20))
    expect(useStore.getState().sectionDraft?.status).toBe('ready')
    useStore.getState().commitSection()
    const fit = fitOf(id)
    if (fit?.kind !== 'plane') throw new Error('not a plane')
    expect(fit.center[2]).toBeCloseTo(12)
  })

  it('goes with the section, and what stands on it with it', () => {
    const id = midplane()
    useStore.setState({ dimensions: [{ id: 1, type: 'dist-plane-plane', name: 'Distance 1', refs: [1, id] }] })
    useStore.getState().removeSection(2)
    const st = useStore.getState()
    expect(st.sections.map((sec) => sec.id)).toEqual([3])
    expect(st.elements.map((e) => e.id)).toEqual([1])
    expect(st.dimensions).toEqual([])
  })

  it('names the section in the report', () => {
    midplane()
    const st = useStore.getState()
    expect(buildSummary('rim.stl', st.elements, [], st.sections)).toContain('midplane of Section 2 and Section 3')
  })

  it('is a plane an element can be aligned to, dropped when the section goes', () => {
    useStore.getState().startDraft('plane')
    useStore.getState().setDraftMethod('plane-coords')
    // A plane leaning 2° off the cuts, aligned parallel to section 3.
    const lean = (2 * Math.PI) / 180
    ;[0, Math.sin(lean), Math.cos(lean), 0, 0, 1].forEach((v, i) => useStore.getState().setDraftParam(i, v))
    useStore.getState().setDraftOrientRef(3)
    expect(useStore.getState().draft?.orient?.ref).toBe(3)
    const id = useStore.getState().commitDraft()!
    const fit = fitOf(id)
    if (fit?.kind !== 'plane') throw new Error('not a plane')
    expect(Math.abs(fit.normal[2])).toBeCloseTo(1, 6)
    useStore.getState().removeSection(3)
    const after = useStore.getState().elements.find((e) => e.id === id)!
    expect(after.orient).toBeUndefined()
    if (after.fit?.kind !== 'plane') throw new Error('not a plane')
    expect(after.fit.normal[1]).toBeCloseTo(Math.sin(lean))
  })

  it('seeds a symmetry search, and the seed lets go when the section goes', () => {
    useStore.getState().startDraft('plane')
    useStore.getState().setDraftMethod('plane-symmetry')
    useStore.getState().setDraftSeed(2)
    useStore.getState().removeSection(2)
    expect(useStore.getState().draft?.seed).toBeNull()
  })
})
