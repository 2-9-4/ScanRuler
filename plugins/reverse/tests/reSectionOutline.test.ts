// SPDX-License-Identifier: AGPL-3.0-only
// A section's outline across the scan's holes: a noisy 40 mm box away from
// the origin, a hole in one wall where the cut runs, read as a polyline in
// the sketch's own frame, its gap bridged — and the same bridge, and the
// filters, on a stack, a section's fit and a sketch's fit.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../../src/state/store'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec2 = [number, number]
type Vec3 = [number, number, number]

/** How far the box stands off the origin. */
const AT: Vec3 = [30, 10, 0]

/** A 40 mm box with noise on its faces, moved to AT, a 2 mm cell taken out
 *  of its +x wall where z runs 4 to 6. */
function holedBox(): Float32Array {
  const soup = boxMesh(40, 20, 0.01)
  const kept: number[] = []
  for (let t = 0; t < soup.length; t += 9) {
    const xs = [soup[t], soup[t + 3], soup[t + 6]]
    const cy = (soup[t + 1] + soup[t + 4] + soup[t + 7]) / 3
    const cz = (soup[t + 2] + soup[t + 5] + soup[t + 8]) / 3
    if (xs.every((x) => Math.abs(x - 20) < 0.1) && cz > 4 && cz < 6 && cy > 0 && cy < 2) continue
    for (let k = 0; k < 9; k++) kept.push(soup[t + k] + AT[k % 3])
  }
  return Float32Array.from(kept)
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(holedBox()), name: 'holed.stl', discard: true })
  await run('section.cut', { across: 'XY', offset: 5, name: 'Mid' })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Outline {
  index: number
  shape: { kind: 'polyline'; closed: boolean; points: Vec2[] }
  count: number
  tolerance: number
  maxDeviation: number
  snapped?: number
  bridged?: { gaps: number; largest: number }
  frame: { origin: Vec3; basisU: Vec3; basisV: Vec3 }
}

/** The nearest of the points to a corner, how far. */
const near = (pts: Vec2[], c: Vec2) => Math.min(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))

describe('a section’s outline across the scan’s holes', () => {
  it('reads the outline as a polyline in the sketch’s frame, its gap bridged', async () => {
    const open = await run<Outline>('reverse.section.outline', { section: 'Mid' })
    expect(open.shape.closed).toBe(false)
    expect(open.bridged).toBeUndefined()

    const o = await run<Outline>('reverse.section.outline', { section: 'Mid', closeGaps: 2.5, snapDeg: 1 })
    expect(o.shape.closed).toBe(true)
    expect(o.bridged?.gaps).toBe(1)
    expect(o.bridged?.largest).toBeGreaterThan(1.5)
    expect(o.bridged?.largest).toBeLessThan(2.5)
    expect(o.count).toBe(4)
    expect(o.snapped).toBe(4)
    expect(o.maxDeviation).toBeLessThan(0.1)
    // The sketch's [u, v]: X and Y from the world origin's foot, not the
    // section's sheet about the part's centre.
    expect(o.frame.origin).toEqual([0, 0, 5])
    for (const c of [[10, -10], [50, -10], [50, 30], [10, 30]] as Vec2[]) expect(near(o.shape.points, c)).toBeLessThan(0.05)

    // The same by a plane and a point inside; the polyline pasted into a
    // sketch on the section is the box's outline.
    const byPlane = await run<Outline>('reverse.section.outline', { plane: { kind: 'world', axis: 'z', offset: 5 }, chain: { at: [20, 10] }, closeGaps: 2.5, snapDeg: 1 })
    expect(byPlane.shape.points).toEqual(o.shape.points)
    const sec = useStore.getState().sections.find((s) => s.name === 'Mid')!
    const made = await run<{ regions?: { area: number }[] }>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Pasted', plane: { kind: 'section', id: sec.id }, sketch: { shapes: [o.shape] } } })
    expect(made.regions).toHaveLength(1)
    expect(made.regions![0].area).toBeCloseTo(1600, -1)

    expect((await refused('reverse.section.outline', {})).code).toBe('invalid_input')
    expect((await refused('reverse.section.outline', { section: 'Mid', chain: 7 })).code).toBe('not_found')
  })

  it('keeps to a box (within), and leaves the chains too long out (maxLength)', async () => {
    // The +x wall alone, in the sketch's [u, v]: an open run along x = 50.
    const wall = await run<Outline & { run?: number }>('reverse.section.outline', { section: 'Mid', closeGaps: 2.5, within: { min: [48, -5], max: [52, 25] } })
    expect(wall.shape.closed).toBe(false)
    expect(wall.run).toBe(0)
    for (const p of wall.shape.points) {
      expect(Math.abs(p[0] - 50)).toBeLessThan(0.1)
      expect(p[1]).toBeGreaterThanOrEqual(-5)
      expect(p[1]).toBeLessThanOrEqual(25)
    }
    const missed = await refused('reverse.section.outline', { section: 'Mid', within: { min: [100, 100], max: [110, 110] } })
    expect(missed.code).toBe('not_found')
    expect(missed.message).toMatch(/Nothing in the box \[100, 100\]…\[110, 110\] — \[u, v\] on the sketch’s \[u, v\] \(frame\); the cut spans u 9\.9\d*…50\.0\d*, v -10\.0\d*…30\.0\d*\. A box in world mm goes as within: \{ world/)
    // The outline is 160 mm round: nothing shorter is left to take.
    expect((await refused('reverse.section.outline', { section: 'Mid', closeGaps: 2.5, maxLength: 100 })).message).toMatch(/longer than 100 mm/)
    const kept = await run<Outline & { leftOut?: unknown }>('reverse.section.outline', { section: 'Mid', closeGaps: 2.5, maxLength: 200 })
    expect(kept.shape.closed).toBe(true)
    expect(kept.leftOut).toBeUndefined()
  })

  it('bridges the gap and filters the chains on a stack and a section’s fit', async () => {
    type Level = { offset: number; chains: { index: number; closed: boolean }[]; bridged?: { gaps: number }; leftOut?: Record<string, number> }
    const z = { kind: 'world', axis: 'z' }
    const plain = await run<{ levels: Level[] }>('reverse.section.stack', { plane: z, offsets: [0, 5] })
    expect(plain.levels.map((l) => l.chains[0].closed)).toEqual([true, false])
    const bridged = await run<{ levels: Level[] }>('reverse.section.stack', { plane: z, offsets: [0, 5], closeGaps: 2.5 })
    expect(bridged.levels.map((l) => l.chains[0].closed)).toEqual([true, true])
    expect(bridged.levels[0].bridged).toBeUndefined()
    expect(bridged.levels[1].bridged?.gaps).toBe(1)
    const closedOnly = await run<{ levels: Level[] }>('reverse.section.stack', { plane: z, offsets: [0, 5], closedOnly: true })
    expect(closedOnly.levels[1].chains).toEqual([])
    expect(closedOnly.levels[1].leftOut).toEqual({ closedOnly: 1 })
    const long = await run<{ levels: Level[] }>('reverse.section.stack', { plane: z, offsets: [0], minLength: 500 })
    expect(long.levels[0].leftOut).toEqual({ minLength: 1 })

    type Fit = { chains: { index: number; closed: boolean; pieces: { kind: string }[] }[]; bridged?: { gaps: number }; leftOut?: Record<string, number> }
    const fit = await run<Fit>('reverse.section.fit', { section: 'Mid', closeGaps: 2.5, candidates: false })
    expect(fit.bridged?.gaps).toBe(1)
    expect(fit.chains[0].closed).toBe(true)
    expect(fit.chains[0].pieces.filter((p) => p.kind === 'line').length).toBeGreaterThanOrEqual(4)
    const none = await run<Fit>('reverse.section.fit', { section: 'Mid', closedOnly: true, candidates: false })
    expect(none.chains).toEqual([])
    expect(none.leftOut).toEqual({ closedOnly: 1 })
  })

  it('takes a box in the world in every within, refuses one that catches nothing with where the cut lies, and gives the fit’s bounds', async () => {
    type Fit = { bounds: { min: Vec2; max: Vec2 }; chains: { index: number; run?: number; pieces: { kind: string; world: { a: Vec3; b: Vec3 } }[] }[] }
    // The section's sheet counts from the part's centre: the box spans ±20.
    const whole = await run<Fit>('reverse.section.fit', { section: 'Mid', candidates: false })
    for (const k of [0, 1]) {
      expect(whole.bounds.min[k]).toBeCloseTo(-20, 1)
      expect(whole.bounds.max[k]).toBeCloseTo(20, 1)
    }
    // The +x wall as a box in the world — what the agent had in hand.
    const wall = { world: { min: [48, -5, 0], max: [52, 25, 10] } }
    const fit = await run<Fit>('reverse.section.fit', { section: 'Mid', closeGaps: 2.5, candidates: false, within: wall })
    expect(fit.chains.length).toBeGreaterThan(0)
    for (const c of fit.chains) for (const p of c.pieces) for (const end of [p.world.a, p.world.b]) expect(Math.abs(end[0] - 50)).toBeLessThan(0.1)
    // The same world box given as a sheet box: nothing there, and the
    // refusal says where the cut lies on the sheet.
    const sheetMiss = await refused('reverse.section.fit', { section: 'Mid', within: { min: [48, -15], max: [52, 35] } })
    expect(sheetMiss.code).toBe('not_found')
    expect(sheetMiss.message).toMatch(/Nothing in the box \[48, -15\]…\[52, 35\] — \[u, v\] on Mid’s sheet \(counted from the part’s centre\); the cut spans u -20\.0\d*…20\.0\d*, v -20\.0\d*…20\.0\d*/)
    // World corners as a sheet box are refused with the cut's extent too.
    expect((await refused('reverse.section.fit', { section: 'Mid', within: { min: [48, -15, 0], max: [52, 35, 10] } })).message).toMatch(/a box in the world goes as within: \{ world: .*the cut spans u -20/)
    const worldMiss = await refused('reverse.section.fit', { section: 'Mid', within: { world: { min: [100, 0, 0], max: [110, 10, 10] } } })
    expect(worldMiss.message).toMatch(/Nothing in the world box \[100, 0, 0\]…\[110, 10, 10\] \(within\.world\); the cut spans x 9\.9\d*…50\.0\d*, y -10\.0\d*…30\.0\d*, z 5…5 in the world/)

    // The outline: the same world box, the points in the sketch's [u, v].
    const o = await run<Outline>('reverse.section.outline', { section: 'Mid', closeGaps: 2.5, within: wall })
    for (const p of o.shape.points) expect(Math.abs(p[0] - 50)).toBeLessThan(0.1)
    expect((await refused('reverse.section.outline', { section: 'Mid', within: { world: { min: [100, 0, 0], max: [110, 10, 10] } } })).message).toMatch(/Nothing in the world box/)

    // The stack's box was the world's all along; world: { min, max } is the same box.
    type Level = { chains: { index: number; run?: number; size: Vec2 }[] }
    const z = { kind: 'world', axis: 'z' }
    const plain = await run<{ levels: Level[] }>('reverse.section.stack', { plane: z, offsets: [5], within: { min: [48, -5, 0], max: [52, 25, 10], clip: true } })
    const asWorld = await run<{ levels: Level[] }>('reverse.section.stack', { plane: 'XY', offsets: [5], within: { ...wall, clip: true } })
    expect(asWorld.levels[0].chains.length).toBeGreaterThan(0)
    expect(asWorld.levels[0].chains).toEqual(plain.levels[0].chains)
    expect((await refused('reverse.section.stack', { plane: z, offsets: [5], within: { min: [0, 0, 0], max: [1, 1, 1], world: wall.world } })).message).toMatch(/not both/)

    // A plane by name in the outline: the XY plane at the origin.
    const byName = await run<Outline>('reverse.section.outline', { plane: 'XY', closeGaps: 2.5 })
    const byObject = await run<Outline>('reverse.section.outline', { plane: { kind: 'world', axis: 'z' }, closeGaps: 2.5 })
    expect(byName.shape.points).toEqual(byObject.shape.points)
  })

  it('fits a sketch to the outline its gap bridged', async () => {
    const sec = useStore.getState().sections.find((s) => s.name === 'Mid')!
    type Made = { fitted?: { chain: number; closed: boolean; bridged?: { gaps: number } }[]; regions?: { area: number }[] }
    const made = await run<Made>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Bridged', plane: { kind: 'section', id: sec.id }, sketch: { fit: { chains: 'largest', closeGaps: 2.5 } } } })
    expect(made.fitted).toHaveLength(1)
    expect(made.fitted![0]).toMatchObject({ chain: 0, closed: true, bridged: { gaps: 1 } })
    expect(made.regions).toHaveLength(1)
    expect(made.regions![0].area).toBeCloseTo(1600, -1)
  })
})
