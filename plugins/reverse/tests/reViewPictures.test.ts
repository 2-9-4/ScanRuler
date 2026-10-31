// SPDX-License-Identifier: AGPL-3.0-only
// What a picture puts away in the workspace comes back as it was kept
// (P20): the bodies with every eye shut, read as not shown, put back by
// show(false) were put away by the key, which the session never did; and
// shown with every eye shut, they opened the eyes for good. The map, which
// turns the curvature map off, brings it back. A key of the workspace put
// away while another workspace is on screen is nothing to do. And a
// picture of a section on a plane element or on a sketch lies on the
// sketch's own frame (P13). A picture with no body in it says why: none
// built, the view bar's key off, or every eye shut (round 15).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sheetPlaneOf } from '../../../src/commands/core/section'
import { applyShow, viewToggles, whyNotShown } from '../../../src/commands/viewToggles'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { PlaneFit, Vec3 } from '../../../src/core/types'
import { normalize } from '../../../src/core/vec'
import { useShell } from '../../../src/state/shellStore'
import { useStore, type Element } from '../../../src/state/store'
import { resolvePlaneFrame } from '../core/resolve'
import { emptySketch } from '../core/sketch'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'

const refuse = (m: string) => new Error(m)
const body = (id: number, visible: boolean) => ({ id, name: `Solid ${id}`, visible, closed: true, volume: 1, faces: 6, triangles: 12 }) as never
/** The bodies' state a picture must leave as it found it. */
const kept = () => {
  const s = useReverse.getState()
  return { hidden: s.bodiesHidden, eyes: s.bodies.map((b) => b.visible), lasting: [...s.hiddenBodies].sort((a, b) => a - b), bodyMap: s.bodyMap, curvatureMap: s.curvatureMap }
}

beforeAll(() => plugin.install?.())
afterAll(() => useShell.getState().setWorkspace('elements'))
beforeEach(() => {
  useShell.getState().setWorkspace('reverse')
  useReverse.setState({ bodiesHidden: false, bodyMap: false, curvatureMap: false, hiddenBodies: [] })
})

describe('a picture’s show, put back', () => {
  it('leaves the bodies as they were with every eye shut, put away or shown for the picture', () => {
    useReverse.setState({ bodies: [body(1, false), body(2, false)] })
    const before = kept()
    for (const on of [false, true]) {
      const done = applyShow(viewToggles([]), { bodies: on }, refuse)
      if (on) expect(useReverse.getState().bodies.every((b) => b.visible)).toBe(true)
      done.putBack()
      expect(kept(), `bodies: ${on}`).toEqual(before)
    }
  })

  it('leaves the lasting list of hidden bodies as it was — a thickened sheet stays hidden', () => {
    // Every eye shut, one of them a sheet hidden for good, and a body the
    // build lacks now (rolled back) on the list too.
    useReverse.setState({ bodies: [body(1, false), body(2, false)] })
    useReverse.getState().setBodiesVisible([1, 2, 9], false)
    const before = kept()
    expect(before.lasting).toEqual([1, 2, 9])
    const done = applyShow(viewToggles([]), { bodies: true }, refuse)
    // Shown for the picture: the eyes open, which empties the list.
    expect(useReverse.getState().hiddenBodies).toEqual([])
    done.putBack()
    expect(kept()).toEqual(before)
  })

  it('leaves the key and the eyes as they were, some shut, the key off', () => {
    useReverse.setState({ bodies: [body(1, true), body(2, false)], bodiesHidden: true })
    const before = kept()
    for (const on of [true, false]) {
      applyShow(viewToggles([]), { bodies: on }, refuse).putBack()
      expect(kept()).toEqual(before)
    }
  })

  it('brings the curvature map back after the deviation map', () => {
    useReverse.setState({ curvatureMap: true })
    const before = kept()
    const done = applyShow(viewToggles([]), { map: true }, refuse)
    expect(useReverse.getState()).toMatchObject({ bodyMap: true, curvatureMap: false })
    done.putBack()
    expect(kept()).toEqual(before)
  })

  it('answers the workspace’s keys put away elsewhere as absent, and refuses showing them', () => {
    useShell.getState().setWorkspace('deviation')
    const done = applyShow(viewToggles([]), { sketches: false, bodies: false }, refuse)
    expect(done).toMatchObject({ absent: ['sketches', 'bodies'], changed: false })
    expect(() => applyShow(viewToggles([]), { sketches: true }, refuse)).toThrow(/not on screen in this workspace/)
  })
})

describe('a picture with no body in it says why', () => {
  /** What a picture's answer says, with `show` set for it, as view.render
   *  reads it: before anything is put back. */
  const why = (show?: Record<string, boolean>) => {
    const done = applyShow(viewToggles([]), show, refuse)
    try {
      return whyNotShown(viewToggles([]), show).bodiesWhy
    } finally {
      done.putBack()
    }
  }

  it('none built, the view bar key off, or every eye shut — and what shows them', () => {
    useReverse.setState({ bodies: [] })
    expect(why()).toMatch(/^none built/)
    useReverse.setState({ bodies: [body(1, true), body(2, true)], bodiesHidden: true })
    expect(why({ scan: true })).toMatch(/^view bar Bodies key off — show: \{ bodies: true \}/)
    useReverse.setState({ bodies: [body(1, false), body(2, false)], bodiesHidden: true })
    expect(why()).toMatch(/^view bar Bodies key off, eyes shut too: \[1, 2\]/)
    useReverse.setState({ bodies: [body(1, false), body(2, false)], bodiesHidden: false })
    expect(why()).toMatch(/^eyes shut: \[1, 2\] — show: \{ bodies: true \}/)
  })

  it('says nothing with a body shown, asked for, or put away by the picture itself', () => {
    useReverse.setState({ bodies: [body(1, true), body(2, false)] })
    expect(why()).toBeUndefined()
    useReverse.setState({ bodies: [body(1, false), body(2, false)], bodiesHidden: true })
    expect(why({ bodies: true })).toBeUndefined()
    useReverse.setState({ bodies: [body(1, true)], bodiesHidden: false })
    expect(why({ bodies: false })).toBeUndefined()
    // Nor anywhere the key does not stand.
    useShell.getState().setWorkspace('deviation')
    useReverse.setState({ bodies: [] })
    expect(why()).toBeUndefined()
  })
})

describe('a picture of a section on a plane the part has', () => {
  // A tilted plane element, its fitter's own u nothing like a sketch's.
  const normal = normalize([0.2, -0.3, 0.93])!
  const fit: PlaneFit = { kind: 'plane', center: [12, -4, 30], normal, basisU: normalize([0.3, 0.95, 0.2])!, basisV: [0, 0, 1], extentU: 10, extentV: 10, sigma: 0, usedPoints: 0, regionSize: 0 } as PlaneFit
  const el: Element = { id: 7, kind: 'plane', name: 'Lid', color: '#123', source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } }, status: 'done', visible: true, fit } as Element
  const close = (got: SectionFrame, want: SectionFrame) => {
    for (const k of ['origin', 'normal', 'basisU', 'basisV'] as const) for (let i = 0; i < 3; i++) expect(got[k][i], `${k}[${i}]`).toBeCloseTo(want[k][i], 9)
  }

  it('lies on the frame a sketch on the element takes, not the fitter’s axes', () => {
    useStore.setState({ elements: [el] })
    const sketch = resolvePlaneFrame({ kind: 'plane', id: 7 }, { elements: [el], sections: [], modelCenter: [0, 0, 0] })!
    for (const given of [7, 'Lid']) {
      const got = sheetPlaneOf(given)
      expect(got.name).toBe('Lid')
      close(got.frame, sketch)
    }
    expect(Math.abs(sheetPlaneOf(7).frame.basisU[0] - fit.basisU[0])).toBeGreaterThan(0.1)
  })

  it('lies on a sketch’s own frame, by id or name', () => {
    const frame: SectionFrame = { origin: [1, 2, 3] as Vec3, normal: [0, 0, 1], basisU: [0, 1, 0], basisV: [-1, 0, 0] }
    useReverse.setState({ features: [{ id: 41, kind: 'sketch', name: 'Rim sketch', plane: { kind: 'fitted', frame }, frame, sketch: emptySketch(), visible: true }] as never, rolledBack: [] })
    for (const given of [41, 'rim sketch']) {
      const got = sheetPlaneOf({ sketch: given })
      expect(got.name).toBe('Rim sketch')
      close(got.frame, frame)
    }
    expect(() => sheetPlaneOf({ sketch: 'Nope' })).toThrow(/no sketch named "Nope" among the sketches/)
    useReverse.setState({ features: [] })
  })
})
