// SPDX-License-Identifier: AGPL-3.0-only
// Round 15's sketch updates (plan §18 R8): a refit handed to
// reverse.feature.update is refused, naming reverse.sketch.edit; a sketch on
// a plane through an axis turns about it with angleDeg as a flat one moves
// with offset, the extrude on it following; an inset, a copy taken once,
// taken again in place by an update; and a round on an inset's corner
// refused, its pieces carrying no slice points — on a cube scanned in the
// in-process worker, the kernel in this thread.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Line = { id: number; kind: 'line'; a: Vec2; b: Vec2; construction?: boolean; points?: Vec2[] }
type Listed = { plane: { kind: string; angleDeg?: number }; frame: { origin: number[]; basisU: number[] }; sketch: { entities: Line[] } }
type Body = { id: number; volume: number; bounds: { min: number[]; max: number[] } }

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 20)), name: 'cube.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const listed = (feature: string) => run<Listed>('reverse.feature.list', { feature })
/** A sketch's lines as the store holds them, slice points and all. */
const storedLines = (name: string) => {
  const f = useReverse.getState().features.find((x) => x.name === name)
  return f?.kind === 'sketch' ? (f.sketch.entities.filter((e) => e.kind === 'line') as Line[]) : []
}
const bodyOf = async (id: number) => (await run<{ bodies: Body[] }>('reverse.build')).bodies.find((b) => b.id === id)!
/** The extent of a sketch's lines along u and v, its construction lines
 *  (a rectangle's diagonals) left out. */
function size(entities: Line[]): Vec2 {
  const pts = entities.flatMap((e) => (e.kind === 'line' && !e.construction ? [e.a, e.b] : []))
  return [Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))]
}
/** A rectangle whose pieces keep their ids (from 1) when it is handed in
 *  again — so the inset's region, and the pick on it, keep theirs. */
const rect = (w: number, h: number) => ({ shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [w, h] }] })

describe('a refit on an update', () => {
  it('is refused, naming reverse.sketch.edit with remove and add.fit', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plate', plane: 'XY', sketch: rect(20, 10) } })
    const err = await refused('reverse.feature.update', { feature: 'Plate', set: { sketch: { fit: {} } } })
    expect(err.code).toBe('invalid_input')
    expect(err.message).toMatch(/reverse\.sketch\.edit \{ sketch, remove: \{ pieces: the fitted ones \}, add: \{ fit \} \}/)
    expect(err.message).not.toMatch(/fit it to the scan \(fit\)/)
  })
})

describe('angleDeg on a sketch through an axis', () => {
  it('turns the sketch in place, the extrude on it following; a flat sketch is told offset', async () => {
    const plane = { kind: 'radial', axis: { kind: 'world', axis: 'z' }, angleDeg: 0 }
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Station', plane, sketch: { entities: [{ id: 1, kind: 'circle', c: [10, 0], r: 2 }] } } })
    const lug = await run<{ feature: { id: number } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Lug', sketchId: 'Station', extent: { kind: 'symmetric', total: 2 }, op: 'new' } })
    const was = await bodyOf(lug.feature.id)
    expect((was.bounds.min[0] + was.bounds.max[0]) / 2).toBeCloseTo(10, 1)

    await run('reverse.feature.update', { feature: 'Station', set: { angleDeg: 90 } })
    const turned = await listed('Station')
    expect(turned.plane).toMatchObject({ kind: 'radial', angleDeg: 90 })
    expect(turned.frame.basisU.map((c) => Math.round(c * 1e6) / 1e6)).toEqual([0, 1, 0])
    // The circle where it was on the sheet, so 10 mm out along +Y now.
    expect(turned.sketch.entities[0]).toMatchObject({ kind: 'circle', c: [10, 0] })
    const now = await bodyOf(lug.feature.id)
    expect((now.bounds.min[1] + now.bounds.max[1]) / 2).toBeCloseTo(10, 1)
    expect((now.bounds.min[0] + now.bounds.max[0]) / 2).toBeCloseTo(0, 1)
    expect(now.volume).toBeCloseTo(was.volume, 3)

    // In a batch, with offset beside it: off the axis, at −125°.
    await run('reverse.feature.update', { features: [{ feature: 'Station', set: { angleDeg: -125, offset: 1 } }] })
    const both = await listed('Station')
    expect(both.plane).toMatchObject({ angleDeg: -125, offset: 1 })

    // The plane itself given again (round 19, V6): the sketch put on it,
    // its pieces where they were on the sheet.
    await run('reverse.feature.update', { feature: 'Station', set: { plane: { ...plane, angleDeg: 45 } } })
    expect((await listed('Station')).plane).toMatchObject({ kind: 'radial', angleDeg: 45 })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Flat', plane: 'XY', sketch: rect(4, 4) } })
    expect((await refused('reverse.feature.update', { feature: 'Flat', set: { angleDeg: 30 } })).message).toMatch(/flat plane; move it along its normal with offset/)
    await run('reverse.feature.update', { feature: 'Flat', set: { plane: 'XZ' } })
    expect((await listed('Flat')).plane).toMatchObject({ kind: 'world', axis: 'y' })
    // A turn about an axis takes a plane through one.
    expect((await refused('reverse.feature.update', { feature: 'Flat', set: { plane: 'XY', angleDeg: 30 } })).message).toMatch(/flat plane/)
  })
})

describe('an inset taken again in place', () => {
  it('stays as it was taken when its source changes, and an update takes it again — from of, or its own profile', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Outer', plane: 'XY', sketch: rect(20, 10) } })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Inner', plane: 'XY', sketch: { inset: { of: 'Outer', by: 1 } } } })
    const pocket = await run<{ feature: { id: number } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Pocket', sketchId: 'Inner', extent: { kind: 'distance', from: 0, to: 5 }, op: 'new' } })
    expect(size((await listed('Inner')).sketch.entities)).toEqual([expect.closeTo(18, 6), expect.closeTo(8, 6)])

    // A copy taken once: the source grown, the inset stays.
    await run('reverse.feature.update', { feature: 'Outer', set: { sketch: rect(30, 10) } })
    expect(size((await listed('Inner')).sketch.entities)).toEqual([expect.closeTo(18, 6), expect.closeTo(8, 6)])

    const again = await run<{ inset: { by: number; moved: number } }>('reverse.feature.update', { feature: 'Inner', set: { sketch: { inset: { of: 'Outer', by: 1 } } } })
    expect(again.inset).toMatchObject({ by: 1, moved: 4 })
    expect(size((await listed('Inner')).sketch.entities)).toEqual([expect.closeTo(28, 6), expect.closeTo(8, 6)])
    // The extrude on it follows.
    expect((await bodyOf(pocket.feature.id)).volume).toBeCloseTo(28 * 8 * 5, 2)

    // Without of: its own profile moved in further.
    await run('reverse.feature.update', { feature: 'Inner', set: { sketch: { inset: { by: 1 } } } })
    expect(size((await listed('Inner')).sketch.entities)).toEqual([expect.closeTo(26, 6), expect.closeTo(6, 6)])
    expect((await bodyOf(pocket.feature.id)).volume).toBeCloseTo(26 * 6 * 5, 2)
  })
})

describe('a round on an inset', () => {
  it('is refused without a radius — its pieces let their slice points go — and made with one', async () => {
    const cut = await run<{ section: { id: number } }>('section.cut', { across: 'ZX', offset: 0, name: 'Across' })
    const plane = { kind: 'section', id: cut.section.id }
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Skin', plane, sketch: { fit: {} } } })
    expect(storedLines('Skin').length).toBeGreaterThanOrEqual(4)
    expect(storedLines('Skin').every((e) => (e.points?.length ?? 0) > 0)).toBe(true)
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Wall', plane, sketch: { inset: { of: 'Skin', by: 2 } } } })
    const lines = storedLines('Wall')
    expect(lines.length).toBeGreaterThanOrEqual(4)
    expect(lines.every((e) => !e.points?.length)).toBe(true)
    // Two lines meeting at a corner.
    const a = lines[0]
    const b = lines.find((e) => e !== a && [e.a, e.b].some((p) => [a.a, a.b].some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6)))!
    const err = await refused('reverse.sketch.edit', { sketch: 'Wall', add: { rounds: [{ a: a.id, b: b.id }] } })
    expect(err.message).toMatch(/carry no slice points — drawn, or moved by an inset, which lets them go — so the scan’s round is not there to read: give radius\.$/)
    expect(err.message).not.toMatch(/radius not read/)
    const made = await run<{ rounds: { radius: number; held: string }[] }>('reverse.sketch.edit', { sketch: 'Wall', add: { rounds: [{ a: a.id, b: b.id, radius: 1.5 }] } })
    expect(made.rounds[0]).toMatchObject({ radius: expect.closeTo(1.5, 6), held: 'given' })
  })
})
