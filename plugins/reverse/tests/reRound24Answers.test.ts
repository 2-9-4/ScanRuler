// SPDX-License-Identifier: AGPL-3.0-only
// What the fan of round 24 asked of the answers: a sketch's pieces moved in
// place, keeping their ids and relations; a fit's ids at every detail; the
// parameters that drive nothing named; a run of suppressing told of the
// rollback bar; and what a check finds across a pattern said once. The kernel
// in this thread, as reCommandsScan.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { auditBody } from '../core/audit'
import type { FaceInfo } from '../core/build'
import { fieldsReading, idleParameters } from '../core/parameters'
import type { Parameter } from '../core/parameters'
import { anchorPoint, entityOf, type Sketch, type SketchEntity } from '../core/sketch'
import { ReClient } from '../core/reClient'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec2 = [number, number]
interface Answer { id: number; status: string; moved: { count: number; pieces?: { id: number; mm: number }[] }; movedFar?: { pieces: { id: number }[] }; set?: { pieces: number[]; detached?: number[]; short?: { piece: number; at: string; mm: number }[] }; ids?: number[]; fitted?: { pieces?: { id: number }[] }[]; fittedPieces?: number[]; solve: { ok: boolean } | null }

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const refused = (name: string, input: unknown) =>
  run(name, input).then(
    () => {
      throw new Error(`${name} went through`)
    },
    (e: Error) => ({ code: /→ (\w+):/.exec(e.message)?.[1], message: e.message }),
  )

const sketchOf = (name: string): Sketch => (useReverse.getState().features.find((f) => f.name === name) as unknown as { sketch: Sketch }).sketch
const piece = (name: string, id: number): SketchEntity => entityOf(sketchOf(name), id)!

/** A sketch of the pieces given, solved. */
const drawn = (name: string, entities: unknown[], constraints: unknown[] = []) => run('reverse.feature.add', { feature: { kind: 'sketch', name, plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { entities, constraints, infer: false } } })

const near = (p: readonly number[], q: Vec2, digits = 3) => {
  expect(p[0]).toBeCloseTo(q[0], digits)
  expect(p[1]).toBeCloseTo(q[1], digits)
}

describe('reverse.sketch.edit { set }', () => {
  it('moves a line’s end, its id and its relation staying, the piece joined to it following', async () => {
    await drawn('S', [{ id: 1, kind: 'line', a: [0, 0], b: [10, 0] }, { id: 2, kind: 'line', a: [10, 0], b: [10, 10] }], [{ id: 3, kind: 'coincident', p: { entity: 1, at: 'b' }, q: { entity: 2, at: 'a' } }])
    const out = await run<Answer>('reverse.sketch.edit', { sketch: 'S', set: { 1: { b: [12, 1] } } })
    expect(out.set!.pieces).toEqual([1])
    expect(out.set!.short).toBeUndefined()
    near(anchorPoint(piece('S', 1), 'b'), [12, 1])
    near(anchorPoint(piece('S', 2), 'a'), [12, 1])
    expect(sketchOf('S').constraints.some((c) => c.id === 3)).toBe(true)
    expect(out.moved.pieces!.map((p) => p.id)).toEqual(expect.arrayContaining([1, 2]))
    // The piece that gave way is told as pulled; the one put there, where it
    // was put, is not.
    expect(out.movedFar!.pieces.map((x) => x.id)).toEqual([2])
  })

  it('moves an arc by its ends, by its circle, and a circle and a point', async () => {
    await drawn('S', [
      { id: 1, kind: 'arc', c: [0, 0], r: 10, start: 0, sweep: Math.PI / 2 },
      { id: 2, kind: 'circle', c: [30, 0], r: 5 },
      { id: 3, kind: 'point', p: [50, 0] },
      { id: 4, kind: 'arc', c: [0, 40], r: 10, start: 0, sweep: (3 * Math.PI) / 2 },
    ])
    await run('reverse.sketch.edit', { sketch: 'S', set: { 1: { a: [20, 0], b: [0, 20] }, 2: { c: [31, 1], r: 6 }, 3: { p: [51, 2] }, 4: { a: [12, 40], r: 12 } } })
    // The same sweep through the new ends: twice the radius about the origin.
    const arc = piece('S', 1) as Extract<SketchEntity, { kind: 'arc' }>
    near(arc.c, [0, 0])
    expect(arc.r).toBeCloseTo(20, 3)
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 3)
    expect(piece('S', 2)).toMatchObject({ r: 6 })
    near((piece('S', 2) as Extract<SketchEntity, { kind: 'circle' }>).c, [31, 1])
    near((piece('S', 3) as Extract<SketchEntity, { kind: 'point' }>).p, [51, 2])
    // A radius with its ends: past half a turn it stays past half a turn.
    const big = piece('S', 4) as Extract<SketchEntity, { kind: 'arc' }>
    expect(big.r).toBeCloseTo(12, 3)
    expect(big.sweep).toBeGreaterThan(Math.PI)
    near(anchorPoint(big, 'a'), [12, 40])
    near(anchorPoint(big, 'b'), [0, 30])
    await run('reverse.sketch.edit', { sketch: 'S', set: { 1: { c: [1, 1], r: 8, start: 0.1, sweep: 1 } } })
    expect(piece('S', 1)).toMatchObject({ c: [1, 1], r: 8 })
  })

  it('moves a spline’s fit points by name, or all of them', async () => {
    await drawn('S', [{ id: 1, kind: 'spline', pts: [[0, 0], [10, 5], [20, 0]] }])
    await run('reverse.sketch.edit', { sketch: 'S', set: { 1: { p1: [10, 8], b: [21, 1] } } })
    const s = piece('S', 1) as Extract<SketchEntity, { kind: 'spline' }>
    near(s.pts[1], [10, 8])
    near(s.pts[2], [21, 1])
    await run('reverse.sketch.edit', { sketch: 'S', set: { 1: { pts: [[0, 0], [5, 5], [10, 5], [15, 0]] } } })
    expect((piece('S', 1) as Extract<SketchEntity, { kind: 'spline' }>).pts).toHaveLength(4)
  })

  it('lets relations win, and says how far short it fell', async () => {
    await drawn('S', [{ id: 1, kind: 'line', a: [0, 0], b: [10, 0], fixed: false }], [{ id: 2, kind: 'horizontal', entity: 1 }, { id: 3, kind: 'length', entity: 1, value: 10 }])
    const out = await run<Answer>('reverse.sketch.edit', { sketch: 'S', set: { 1: { a: [0, 0], b: [20, 5] } } })
    expect(out.solve?.ok).toBe(true)
    const line = piece('S', 1) as Extract<SketchEntity, { kind: 'line' }>
    expect(line.a[1]).toBeCloseTo(line.b[1], 4)
    expect(Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1])).toBeCloseTo(10, 4)
    expect(out.set!.short!.length).toBeGreaterThan(0)
    expect(Math.max(...out.set!.short!.map((x) => x.mm))).toBeGreaterThan(1)
  })

  it('refuses a field the piece has not, naming those it has, and a piece not there', async () => {
    await drawn('S', [{ id: 1, kind: 'line', a: [0, 0], b: [10, 0] }, { id: 2, kind: 'circle', c: [30, 0], r: 5 }, { id: 3, kind: 'spline', pts: [[0, 9], [5, 9], [9, 9]] }])
    const before = JSON.stringify(sketchOf('S'))
    expect((await refused('reverse.sketch.edit', { sketch: 'S', set: { 1: { c: [0, 0] } } })).message).toContain('set.1.c: not a known field — a line has a, b.')
    expect((await refused('reverse.sketch.edit', { sketch: 'S', set: { 2: { a: [0, 0] } } })).message).toContain('a circle has c, r.')
    expect((await refused('reverse.sketch.edit', { sketch: 'S', set: { 3: { p7: [0, 0] } } })).message).toContain('a spline has pts, a, b, p1.')
    expect((await refused('reverse.sketch.edit', { sketch: 'S', set: { 1: { b: [1] } } })).message).toContain('set.1.b: expected [u, v]')
    expect((await refused('reverse.sketch.edit', { sketch: 'S', set: { 1: { b: [0, 0] } } })).message).toContain('one point')
    expect((await refused('reverse.sketch.edit', { sketch: 'S', set: { 2: { r: 0 } } })).message).toContain('above zero')
    expect((await refused('reverse.sketch.edit', { sketch: 'S', set: { 1: {} } })).message).toContain('nothing to change')
    const missing = await refused('reverse.sketch.edit', { sketch: 'S', set: { 9: { b: [1, 1] } } })
    expect(missing.code).toBe('not_found')
    // A piece taken out in the same call is gone by the time set runs.
    expect((await refused('reverse.sketch.edit', { sketch: 'S', remove: { pieces: [1] }, set: { 1: { b: [1, 1] } } })).code).toBe('not_found')
    expect(JSON.stringify(sketchOf('S'))).toBe(before)
  })

  it('lets a fitted piece’s slice points go and holds a projected one', async () => {
    const fitted = (await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'F', plane: { kind: 'world', axis: 'z', offset: 5 }, sketch: { fit: {} } } })) as Answer
    const ids = fitted.fitted![0].pieces!.map((x) => x.id)
    const id = ids[0]
    expect((piece('F', id) as { points?: unknown[] }).points?.length).toBeGreaterThan(0)
    const was = piece('F', id) as Extract<SketchEntity, { kind: 'line' }>
    const to: Vec2 = [was.a[0] + 1, was.a[1] + 1]
    // One end alone: the fitted piece beside it, joined there, holds it on
    // the scan, and the answer says so.
    const out = await run<Answer>('reverse.sketch.edit', { sketch: 'F', set: { [id]: { a: to } } })
    expect(out.set!.detached).toEqual([id])
    expect((piece('F', id) as { points?: unknown[] }).points).toBeUndefined()
    expect(out.set!.short![0]).toMatchObject({ piece: id, at: 'a' })
    // The whole loop moved: nothing holds it, and it lands.
    const lines = ids.map((x) => piece('F', x) as Extract<SketchEntity, { kind: 'line' }>)
    const whole = await run<Answer>('reverse.sketch.edit', { sketch: 'F', set: Object.fromEntries(lines.map((l) => [l.id, { a: [l.a[0] + 3, l.a[1] + 2], b: [l.b[0] + 3, l.b[1] + 2] }])) })
    expect(whole.set!.short).toBeUndefined()
    near(anchorPoint(piece('F', ids[1]), 'a'), [lines[1].a[0] + 3, lines[1].a[1] + 2], 2)

    await drawn('S', [{ id: 1, kind: 'line', a: [0, 0], b: [10, 0] }])
    await run('reverse.sketch.edit', { sketch: 'S', add: { project: [{ sketch: 'F', pieces: [id] }] } })
    const projected = sketchOf('S').entities.find((e) => e.projected)!
    expect((await refused('reverse.sketch.edit', { sketch: 'S', set: { [projected.id]: { a: [0, 1] } } })).code).toBe('invalid_state')
  })

  it('gives the rebuild the moved sketch, and takes add and remove in the same call', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'B', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [-5, -5], to: [5, 5] }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'B', regions: 'all', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' } })
    const line = sketchOf('B').entities.find((e) => e.kind === 'line' && !e.construction) as Extract<SketchEntity, { kind: 'line' }>
    const out = await run<Answer & { ids?: number[] }>('reverse.sketch.edit', { sketch: 'B', set: { [line.id]: { a: [line.a[0] - 1, line.a[1] - 1] } }, add: { entities: [{ kind: 'point', p: [0, 0], construction: true }] } })
    expect(useReverse.getState().results[useReverse.getState().features.find((f) => f.name === 'Block')!.id]?.status).toBe('ok')
    expect(out.ids).toHaveLength(1)
    expect(out.set!.pieces).toEqual([line.id])
  })
})

describe('a fit’s ids', () => {
  it('come at detail brief, and at detail none', async () => {
    await drawn('S', [{ id: 1, kind: 'point', p: [0, 0], construction: true }])
    const brief = await run<Answer>('reverse.sketch.edit', { sketch: 'S', add: { fit: {} } })
    const ids = brief.fitted!.flatMap((c) => (c.pieces ?? []).map((p) => p.id))
    expect(ids.length).toBeGreaterThan(0)
    await drawn('N', [{ id: 1, kind: 'point', p: [0, 0], construction: true }])
    const none = await run<Answer>('reverse.sketch.edit', { sketch: 'N', add: { fit: {}, entities: [{ kind: 'point', p: [1, 1], construction: true }] }, detail: 'none' })
    expect(none.fitted).toBeUndefined()
    expect(none.fittedPieces!.length).toBeGreaterThan(0)
    for (const id of none.fittedPieces!) expect(entityOf(sketchOf('N'), id)).toBeTruthy()
    expect(none.ids).toHaveLength(1)
  })
})

describe('parameters that drive nothing', () => {
  const p = (id: number, name: string, expression: string): Parameter => ({ id, name, kind: 'length', expression })

  it('are those no feature reads, even through another parameter', () => {
    const parameters = [p(1, 'used', '4'), p(2, 'base', '2'), p(3, 'half', 'base / 2'), p(4, 'lone', '9'), p(5, 'loneChild', 'lone * 2')]
    const features = [{ id: 1, kind: 'extrude', name: 'E', exprs: { 'extent.to': 'used + half' } }] as never[]
    expect(idleParameters(parameters, features).map((x) => x.name)).toEqual(['lone', 'loneChild'])
    expect(fieldsReading({ exprs: { 'extent.to': 'used + half', 'extent.from': '1' } }, 'used')).toEqual(['extent.to'])
  })

  it('show in usedBy and in the deviation verdict’s line', async () => {
    await run('reverse.parameter.add', { parameters: [{ name: 'w', expression: '10' }, { name: 'h', expression: '4' }, { name: 'bladeT', expression: '2' }, { name: 'twice', expression: 'bladeT * 2' }] })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'B', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 5 }], constraints: [{ id: 2, kind: 'diameter', entity: 1, expr: 'w' }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'B', regions: 'all', extent: { kind: 'distance', from: 0, to: 4 }, exprs: { 'extent.to': 'h' }, op: 'new' } })
    const { parameters } = await run<{ parameters: { name: string; usedBy: unknown[]; drivesNothing?: boolean }[] }>('reverse.parameter.list', {})
    const row = (n: string) => parameters.find((x) => x.name === n)!
    expect(row('w').usedBy).toEqual([{ feature: 'B', fields: ['dimension 2'] }])
    expect(row('h').usedBy).toEqual([{ feature: 'Block', fields: ['extent.to'] }])
    expect(row('bladeT').usedBy).toEqual([{ parameter: 'twice' }])
    expect(row('bladeT').drivesNothing).toBe(true)
    expect(row('twice').usedBy).toEqual([])
    expect(row('twice').drivesNothing).toBeUndefined()
    const answer = await run<{ parameter: { usedBy: unknown[] } }>('reverse.parameter.set', { parameter: 'h', expression: '5' })
    expect(answer.parameter.usedBy).toEqual([{ feature: 'Block', fields: ['extent.to'] }])
  })
})

describe('a run of suppressing', () => {
  it('is told of the rollback bar from the second on', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'B', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [-5, -5], to: [5, 5] }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'B', regions: 'all', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' } })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'C', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 1 }] } } })
    const first = await run<{ note?: string }>('reverse.feature.suppress', { features: ['Block'] })
    expect(first.note).toBeUndefined()
    const second = await run<{ note?: string }>('reverse.feature.suppress', { features: ['Block'], on: false })
    expect(second.note).toContain('reverse.feature.rollback')
    // A sketch edited between them is still the same run.
    await run('reverse.sketch.edit', { sketch: 'C', set: { 1: { r: 2 } } })
    expect((await run<{ note?: string }>('reverse.feature.suppress', { features: ['Block'] })).note).toContain('reverse.feature.rollback')
    // Two changes between end it.
    await run('reverse.sketch.edit', { sketch: 'C', set: { 1: { r: 3 } } })
    await run('reverse.sketch.edit', { sketch: 'C', set: { 1: { r: 4 } } })
    expect((await run<{ note?: string }>('reverse.feature.suppress', { features: ['Block'], on: false })).note).toBeUndefined()
  })
})

describe('what a check finds across a pattern', () => {
  it('comes once for the bodies alike, each named body answering for itself', async () => {
    // A block off the axis and two more round it, none joined; and one unlike.
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'P', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [10, -2], to: [14, 2] }] } } })
    const seed = await run<{ bodies: { changed?: { id: number }[] } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Tooth', sketchId: 'P', regions: 'all', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' } })
    const pattern = await run<{ result: { status: string; message?: string } | null }>('reverse.feature.add', { feature: { kind: 'pattern', name: 'Teeth', body: seed.bodies.changed![0].id, mode: 'circular', axis: { kind: 'world', axis: 'z' }, count: 4, step: 90 } })
    expect(pattern.result?.status, pattern.result?.message).toBe('ok')
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Q', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [-30, -30], to: [-24, -24] }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Other', sketchId: 'Q', regions: 'all', extent: { kind: 'distance', from: 0, to: 7 }, op: 'new' } })
    const solids = useReverse.getState().bodies.filter((b) => !b.surface)
    expect(solids.length).toBeGreaterThan(2)
    const { bodies, checked } = await run<{ bodies: { id: number; name: string; volume: number; alike?: { count: number; ids: number[] } }[]; checked?: number }>('reverse.body.check', {})
    expect(checked).toBe(solids.length)
    const teeth = bodies.find((b) => b.alike)!
    expect(teeth.alike!.count).toBe(solids.length - 2)
    expect(teeth.alike!.ids).not.toContain(teeth.id)
    expect(bodies).toHaveLength(2)
    expect(bodies.find((b) => !b.alike)!.volume).toBeCloseTo(36 * 7, 3)
    // By name it gives its own row, whatever it is like.
    const one = await run<{ bodies: { id: number; alike?: unknown }[]; checked?: number }>('reverse.body.check', { body: teeth.alike!.ids[0] })
    expect(one.bodies[0].id).toBe(teeth.alike!.ids[0])
    expect(one.bodies[0].alike).toBeUndefined()
    expect(one.checked).toBeUndefined()
  })

  it('comes once for findings alike on one body, counted, with a few places', () => {
    const face = (hash: number, origin: number, dir: [number, number, number], centroid: [number, number, number]): FaceInfo =>
      ({ hash, fingerprint: { kind: 'plane', origin, dir, centroid, area: 4 } }) as unknown as FaceInfo
    const lean = 0.2 * (Math.PI / 180)
    const leaning: [number, number, number] = [Math.sin(lean), 0, Math.cos(lean)]
    const faces = [0, 1, 2, 3, 4, 5].map((i) => face(i + 1, 7, leaning, [i * 20, 0, 0]))
    const apart = auditBody(faces, [], {}).findings.filter((f) => f.kind === 'nearAxis')
    expect(apart).toHaveLength(6)
    const { findings, found } = auditBody(faces, [], { alike: true })
    const once = findings.filter((f) => f.kind === 'nearAxis')
    expect(once).toHaveLength(1)
    expect(once[0].count).toBe(6)
    expect(once[0].places).toHaveLength(3)
    expect(found.nearAxis).toBe(6)
    // Another feature's, or another figure, is another finding.
    const other = [...faces, face(7, 8, leaning, [200, 0, 0])]
    expect(auditBody(other, [], { alike: true }).findings.filter((f) => f.kind === 'nearAxis')).toHaveLength(2)
  })
})
