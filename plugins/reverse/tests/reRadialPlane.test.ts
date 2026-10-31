// SPDX-License-Identifier: AGPL-3.0-only
// Planes for sketches on a turned part: a plane through an axis at any
// angle, whose sketch has u out along the radius and v up the axis on
// either side of it; `up` on a standing plane, so its sketch has Z up
// whichever way the plane's normal points; and sections and elements
// named by name in a plane. The frames as resolvePlaneFrame lays them, and
// a sketch made on them by command, on a box scanned in the in-process
// worker, the kernel in this thread — as reCommandsScan.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { frameKey, type SectionFrame } from '../../../src/core/section/frame'
import type { SectionCut } from '../../../src/core/section/slice'
import type { CylinderFit, FitData, PlaneFit, Vec3 } from '../../../src/core/types'
import { cross, dot } from '../../../src/core/vec'
import { useStore, type Element } from '../../../src/state/store'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import type { PlaneRef, ResolveContext } from '../core/features'
import { ReClient } from '../core/reClient'
import { describePlaneRef, resolvePlaneFrame } from '../core/resolve'
import { localKernel } from './reLocal'
import plugin from '../plugin'
// After the plugin, as the app loads it: the commands sit in an import cycle.
import '../app/reSectionCommands'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

const deg = (d: number) => (d * Math.PI) / 180
const radius = (a: number): Vec3 => [Math.cos(deg(a)), Math.sin(deg(a)), 0]

function expectVec(got: readonly number[], want: readonly number[], digits = 9) {
  for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], digits)
}

function expectRightHanded(f: Pick<SectionFrame, 'normal' | 'basisU' | 'basisV'>) {
  expectVec(cross(f.basisU, f.basisV), f.normal, 6)
}

/** A bore standing at (10, 5), fitted with its axis pointing down. */
const bore: CylinderFit = { kind: 'cylinder', center: [10, 5, 3], axis: [0, 0, -1], radius: 4, length: 30, coverage: 360, sigma: 0, usedPoints: 0, regionSize: 0 }
/** A standing plane, its normal −Y — the side B6's sketches came out upside down on. */
const wall: PlaneFit = { kind: 'plane', center: [0, 7, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1], extentU: 5, extentV: 5, sigma: 0, usedPoints: 0, regionSize: 0 }
const wallBack: PlaneFit = { ...wall, normal: [0, 1, 0], basisU: [-1, 0, 0] }

const ctx: ResolveContext = {
  sections: [{ id: 9, frame: { origin: [0, 3, 0], normal: [0, -1, 0], basisU: [0, 0, 1], basisV: [-1, 0, 0] } }],
  elements: [
    { id: 1, name: 'Bore', fit: bore },
    { id: 2, name: 'Wall', fit: wall },
    { id: 3, name: 'Wall back', fit: wallBack },
  ],
  modelCenter: [0, 0, 0],
}

describe('a plane through an axis', () => {
  it('has u out along the radius and v up the axis at 52° and at 232°, its zero on the axis level with the origin', () => {
    for (const a of [52, 232]) {
      const f = resolvePlaneFrame({ kind: 'radial', axis: { kind: 'element', id: 1 }, angleDeg: a }, ctx)!
      expectVec(f.basisU, radius(a))
      expectVec(f.basisV, [0, 0, 1])
      expectVec(f.origin, [10, 5, 0])
      expectRightHanded(f)
    }
    const z = resolvePlaneFrame({ kind: 'radial', axis: { kind: 'world', axis: 'z' }, angleDeg: 90, offset: 2 }, ctx)!
    expectVec(z.basisU, [0, 1, 0])
    expectVec(z.basisV, [0, 0, 1])
    // Moved along its normal by the offset: off the axis, square to it.
    expectVec(z.origin, z.normal.map((c) => 2 * c))
    expect(resolvePlaneFrame({ kind: 'radial', axis: { kind: 'element', id: 2 }, angleDeg: 0 }, ctx)).toBeNull()
    expect(describePlaneRef({ kind: 'radial', axis: { kind: 'element', id: 1 }, angleDeg: 52 }, { sections: [], elements: [{ id: 1, name: 'Bore' }] })).toBe('the plane through Bore at 52°')
  })
})

describe('up on a plane', () => {
  it('runs v up Z on a standing plane whichever way its normal points, u = up × normal', () => {
    for (const ref of [
      { kind: 'plane', id: 2, up: 'z' },
      { kind: 'plane', id: 3, up: 'z' },
      { kind: 'section', id: 9, up: 'z' },
      { kind: 'world', axis: 'y', offset: 4, up: 'z' },
    ] as PlaneRef[]) {
      const f = resolvePlaneFrame(ref, ctx)!
      expectVec(f.basisV, [0, 0, 1])
      expectVec(f.basisU, cross([0, 0, 1], f.normal))
      expectRightHanded(f)
    }
    // Without up, the section's sketch on that plane has Z along u — as B6
    // found it.
    expectVec(resolvePlaneFrame({ kind: 'section', id: 9 }, ctx)!.basisU, [0, 0, 1])
    // Up along the normal has no way up the plane: the sketch rule stands.
    expect(resolvePlaneFrame({ kind: 'world', axis: 'z', offset: 0, up: 'z' }, ctx)).toEqual(resolvePlaneFrame({ kind: 'world', axis: 'z', offset: 0 }, ctx))
  })
})

describe('planes given by command', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []

  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    await run('scan.open', { bytes: stlBytes(boxMesh(40, 10)), name: 'box.stl', discard: true })
  }, 120_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless.stop()
  })
  beforeEach(() => {
    resetReverse()
    const element = (id: number, name: string, fit: FitData): Element => ({ id, kind: fit.kind, name, color: '#123', source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } }, status: 'done', visible: true, fit })
    const n = useStore.getState().nextId
    useStore.setState({ elements: [element(n, 'Bore', bore), element(n + 1, 'Wall', wall)], nextId: n + 2 })
  })

  type Frame = { origin: Vec3; normal: Vec3; basisU: Vec3; basisV: Vec3 }

  it('makes sketches on a plane through an axis at 52° and 232° with v = +Z and u along the radius', async () => {
    for (const a of [52, 232]) {
      const plane = { kind: 'radial', axis: { kind: 'element', name: 'Bore' }, angleDeg: a }
      const described = await run<Frame>('reverse.plane.describe', { plane })
      await run('reverse.feature.add', { feature: { kind: 'sketch', name: `Profile ${a}`, plane, sketch: { entities: [{ id: 1, kind: 'circle', c: [6, 2], r: 1 }] } } })
      const made = await run<{ frame: Frame }>('reverse.feature.list', { feature: `Profile ${a}` })
      for (const f of [described, made.frame]) {
        expectVec(f.basisU, radius(a), 4)
        expectVec(f.basisV, [0, 0, 1], 4)
        expectVec(f.origin, [10, 5, 0], 4)
        expectRightHanded(f)
      }
    }
    expect((await refused('reverse.plane.describe', { plane: { kind: 'radial', axis: { kind: 'element', name: 'Wall' }, angleDeg: 0 } })).message).toMatch(/no axis/)
    expect((await refused('reverse.plane.describe', { plane: { kind: 'radial', axis: { kind: 'element', name: 'Nothing' }, angleDeg: 0 } })).code).toBe('not_found')
  })

  it('takes a section and a plane by name, and up on them', async () => {
    // A section across the wall, as one cut on its plane would be kept.
    const store = useStore.getState()
    const id = store.nextId
    const frame: SectionFrame = { origin: [0, 7, 0], normal: [0, -1, 0], basisU: [0, 0, 1], basisV: [-1, 0, 0] }
    const cut: SectionCut = { points: Float32Array.from([0, 7, 0, 1, 7, 0, 1, 7, 1]), offsets: Uint32Array.from([0, 3]) }
    useStore.setState({ sections: [{ id, name: 'Side cut', color: '#123', visible: true, frame, ref: null, offset: 0, cut, cutKey: frameKey(frame) }], nextId: id + 1 })

    const bySection = await run<Frame>('reverse.plane.describe', { plane: { kind: 'section', name: 'side cut', up: 'z' } })
    expectVec(bySection.basisV, [0, 0, 1])
    expectVec(bySection.basisU, cross([0, 0, 1], bySection.normal))
    const byId = await run<Frame>('reverse.plane.describe', { plane: { kind: 'section', id } })
    expect(dot(byId.basisU, [0, 0, 1])).not.toBeCloseTo(0, 6)
    const byPlane = await run<Frame>('reverse.plane.describe', { plane: { kind: 'plane', name: 'Wall', up: 'z' } })
    expectVec(byPlane.basisV, [0, 0, 1])
    expectRightHanded(byPlane)
    expect((await refused('reverse.plane.describe', { plane: { kind: 'world', axis: 'z', up: 'z' } })).message).toMatch(/runs along the plane’s normal/)
    expect((await refused('reverse.plane.describe', { plane: { kind: 'section', name: 'No such cut' } })).code).toBe('not_found')
    expect((await refused('reverse.plane.describe', { plane: { kind: 'section' } })).message).toMatch(/by id or by name/)
  })
})
