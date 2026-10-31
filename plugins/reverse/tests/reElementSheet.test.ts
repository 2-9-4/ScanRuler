// SPDX-License-Identifier: AGPL-3.0-only
// Where a plane element lies on a sketch drawn on it: a sketch on an
// element counts from the world origin's foot, as on any plane, so every
// answer that resolves one — reverse.plane.describe, a sketch added and
// edited, reverse.section.outline — says where the element's centre and
// box are in that [u, v]: a fitted plane's from its patch, a constructed
// one's from the scan where it meets the plane. Pieces drawn away from it
// are told (farFromElement). On a 40 mm box scanned in the in-process
// worker, the kernel in this thread — as reCommandsScan.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FitData, PlaneFit } from '../../../src/core/types'
import { useStore, type Element } from '../../../src/state/store'
import { boxMesh } from '../../../tests/helpers'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
// After the plugin, as the app loads it: the commands sit in an import cycle.
import '../app/reSectionCommands'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec2 = [number, number]
interface OnSheet { name: string; centre: Vec2; box: [Vec2, Vec2]; from: string }
interface Answer { element?: OnSheet; farFromElement?: string; words?: string }

/** A patch fitted on the +X face, up and to the side of the origin's foot,
 *  its own u and v the other way round from the sketch's (Y and Z) — as
 *  the mirror holder's element 47 had them. */
const side: PlaneFit = { kind: 'plane', center: [20, 12, 8], normal: [1, 0, 0], basisU: [0, -1, 0], basisV: [0, 0, -1], extentU: 5, extentV: 5, sigma: 0, usedPoints: 0, regionSize: 0 }
/** A plane constructed through the box's middle, drawn small. */
const middle: PlaneFit = { kind: 'plane', center: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 3, extentV: 3, sigma: 0, usedPoints: 0, regionSize: 0 }

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []
let sideId = 0
let middleId = 0

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40)), name: 'box.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(() => {
  resetReverse()
  const base = { color: '#123', status: 'done' as const, visible: true }
  const fitted = (id: number, name: string, fit: FitData): Element => ({ id, kind: fit.kind, name, ...base, source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } }, fit })
  const made = (id: number, name: string, fit: FitData): Element => ({ id, kind: fit.kind, name, ...base, source: { type: 'constructed', method: 'pointNormal', refs: [], params: [] }, fit })
  const n = useStore.getState().nextId
  sideId = n
  middleId = n + 1
  useStore.setState({ elements: [fitted(n, 'Side', side), made(n + 1, 'Middle', middle)], nextId: n + 2 })
})

const circle = (c: Vec2, r = 2) => ({ kind: 'circle', c, r })

describe('a plane element on its sketch’s sheet', () => {
  it('says where a fitted patch lies, and warns on pieces drawn about the origin’s foot', async () => {
    const plane = { kind: 'plane', id: sideId }
    const described = await run<Answer>('reverse.plane.describe', { plane })
    // On a sketch on the +X face u is Y and v is Z, from (20, 0, 0).
    expect(described.element).toEqual({ name: 'Side', centre: [12, 8], box: [[7, 3], [17, 13]], from: 'patch' })
    expect(described.words).toMatch(/world origin’s foot; Side’s centre is at \[12, 8\]/)

    const far = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'At zero', plane, sketch: { entities: [circle([0, 0])] } } })
    expect(far.element?.centre).toEqual([12, 8])
    expect(far.farFromElement).toBe('drawn 14.4 mm from Side’s centre ([12.00, 8.00]); [0, 0] is the world origin’s foot, not the element’s centre — draw about element.centre (reverse.plane.describe gives the frame).')
    // Kept at detail none: the warning is what the agent must read.
    const none = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'At zero too', plane, sketch: { entities: [circle([0, 0])] } }, detail: 'none' })
    expect(none.farFromElement).toMatch(/^drawn 14\.4 mm/)

    // Drawn on the patch: no warning.
    const on = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'On it', plane, sketch: { entities: [circle([12, 8])] } } })
    expect(on.element?.name).toBe('Side')
    expect(on.farFromElement).toBeUndefined()

    // An edit that takes the pieces' box round the centre: no warning.
    const edited = await run<Answer>('reverse.sketch.edit', { sketch: 'At zero', add: { entities: [circle([12, 8])] } })
    expect(edited.element?.centre).toEqual([12, 8])
    expect(edited.farFromElement).toBeUndefined()
    // And one put far again by update.
    const moved = await run<Answer>('reverse.feature.update', { feature: 'On it', set: { sketch: { entities: [{ id: 1, ...circle([-30, -30]) }], constraints: [] } } })
    expect(moved.farFromElement).toMatch(/^drawn 56\.6 mm from Side’s centre/)
  })

  it('reads a constructed plane’s footprint off the scan, and section.outline says it too', async () => {
    const plane = { kind: 'plane', id: middleId }
    const described = await run<Answer>('reverse.plane.describe', { plane })
    expect(described.element?.from).toBe('scan')
    // The box's walls where the plane cuts them, not the 6 mm it is drawn at.
    const [lo, hi] = described.element!.box
    for (const c of [...lo, ...hi]) expect(Math.abs(c)).toBeCloseTo(20, 0)
    expect(described.element!.centre.map((c) => Math.abs(c))).toEqual([0, 0])

    const outline = await run<Answer>('reverse.section.outline', { plane })
    expect(outline.element).toEqual(described.element)
    // A sketch across the middle has its pieces round the centre: no warning.
    const sketch = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Across', plane, sketch: { entities: [circle([15, 0])] } } })
    expect(sketch.element?.from).toBe('scan')
    expect(sketch.farFromElement).toBeUndefined()
    // A world plane has no element to say.
    expect((await run<Answer>('reverse.plane.describe', { plane: { kind: 'world', axis: 'z' } })).element).toBeUndefined()
  })
})
