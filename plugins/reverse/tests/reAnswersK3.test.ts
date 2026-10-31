// SPDX-License-Identifier: AGPL-3.0-only
// Rounds 11 and 12 through the commands: answers that keep what was asked
// for at detail none (a round's radius and sigma, moved, picked); a fitted
// round that had nothing to fit says so; two lines are not tangent, and
// the refusal says what to do; a solid joins or cuts one body alone
// (target); ids sent as text; an offset says its source still stands; a
// where pick that takes a round's seams says so, and sharp leaves them
// out. On the scan of a 40 mm box with one edge rounded R2.5, in the
// in-process worker, the kernel in this thread — as reFilletRead.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { roundCorner, roundUnread } from '../core/roundCorner'
import { addConstraint, addEntity, emptySketch } from '../core/sketch'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type P2 = [number, number]

/** The scanned part's profile in XZ: a 40 mm square about the origin, its
 *  top right corner rounded r, with a little noise. */
function profile(r: number, step: number, arcSteps: number, noise: number): P2[] {
  const rand = mulberry32(11)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const out: { p: P2; n: P2 }[] = []
  const line = (a: P2, b: P2, n: P2) => {
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let i = 0; i < k; i++) out.push({ p: [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k], n })
  }
  line([-20, -20], [20, -20], [0, -1])
  line([20, -20], [20, 20 - r], [1, 0])
  for (let i = 0; i < arcSteps; i++) {
    const a = (Math.PI / 2) * (i / arcSteps)
    out.push({ p: [20 - r + r * Math.cos(a), 20 - r + r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] })
  }
  line([20 - r, 20], [-20, 20], [0, 1])
  line([-20, 20], [-20, -20], [-1, 0])
  return out.map(({ p, n }) => {
    const d = gauss() * noise
    return [p[0] + d * n[0], p[1] + d * n[1]]
  })
}

/** The profile run along Y from −20 to 20, capped. */
function extruded(points: P2[]): Float32Array {
  const tris: number[] = []
  const at = (p: P2, y: number) => [p[0], y, p[1]]
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    tris.push(...at(a, -20), ...at(b, -20), ...at(b, 20))
    tris.push(...at(a, -20), ...at(b, 20), ...at(a, 20))
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    tris.push(0, -20, 0, ...at(b, -20), ...at(a, -20))
    tris.push(0, 20, 0, ...at(a, 20), ...at(b, 20))
  }
  return new Float32Array(tris)
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(extruded(profile(2.5, 0.4, 24, 0.02))), name: 'rounded.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

type Entity = { id: number; kind: string; a?: P2; b?: P2 }
type Round = { arc: number; radius: number; sigma: number | null; points: number; held: string; warning?: string }
type Body = { id: number; name: string }
type Brief = { id?: number; feature?: { id: number }; result?: { status: string; message?: string }; bodies?: { count: number; changed?: Body[] }; picked?: Record<string, unknown>[]; note?: string }

/** The profile fitted on a section across the block, and its two lines
 *  nearest a corner [u, v] of the sheet (u is Z, v is X). */
async function fittedCorner(corner: P2): Promise<[Entity, Entity]> {
  const cut = await run<{ section: { id: number } }>('section.cut', { across: 'ZX', offset: 0, name: 'Across' })
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Profile', plane: { kind: 'section', id: cut.section.id }, sketch: { fit: {} } } })
  const listed = await run<{ sketch: { entities: Entity[] } }>('reverse.feature.list', { feature: 'Profile' })
  const near = (e: Entity) => Math.min(Math.hypot(e.a![0] - corner[0], e.a![1] - corner[1]), Math.hypot(e.b![0] - corner[0], e.b![1] - corner[1]))
  const [a, b] = listed.sketch.entities.filter((e) => e.kind === 'line').sort((x, y) => near(x) - near(y))
  return [a, b]
}

describe('K3: answers that keep the number asked for', () => {
  it('a rounds edit with detail none answers the radius and sigma, and moved', async () => {
    const [a, b] = await fittedCorner([20, 20])
    const out = await run<{ id: number; status: string; rollback: unknown; rounds: Round[]; moved: { count: number }; bodies?: unknown; regions?: unknown; solve?: unknown }>('reverse.sketch.edit', { sketch: 'Profile', add: { rounds: [{ a: a.id, b: b.id }] }, detail: 'none' })
    expect(out.status).toBe('ok')
    expect(out.rollback).toBeDefined()
    expect(out.bodies).toBeUndefined()
    expect(out.regions).toBeUndefined()
    expect(out.solve).toBeUndefined()
    const [round] = out.rounds
    expect(Math.abs(round.radius - 2.5)).toBeLessThan(0.1)
    expect(round.sigma).toBeGreaterThan(0)
    expect(round.points).toBeGreaterThanOrEqual(3)
    expect(round.held).toBe('points')
    expect(round.warning).toBeUndefined()
    expect(out.moved.count).toBeGreaterThanOrEqual(0)
  })

  it('moved is always there: { count: 0 } when nothing moved', async () => {
    await fittedCorner([20, 20])
    const out = await run<{ moved: { count: number; pieces?: unknown } }>('reverse.sketch.edit', { sketch: 'Profile', name: 'Renamed' })
    expect(out.moved).toEqual({ count: 0 })
    const none = await run<{ moved: { count: number } }>('reverse.sketch.edit', { sketch: 'Renamed', name: 'Profile', detail: 'none' })
    expect(none.moved).toEqual({ count: 0 })
  })

  it('picked with detail none, on an add and an update', async () => {
    await block('Block', [0, 0], [20, 20])
    const added = await run<Brief>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body: 'Block', edges: [{ between: [[0, 0, 1], [1, 0, 0]] }], radius: 1 }, detail: 'none' })
    expect(added.picked?.[0]?.edges).toHaveLength(1)
    const updated = await run<Brief>('reverse.feature.update', { feature: 'Round', set: { edges: [{ between: [[0, 0, 1], [-1, 0, 0]] }] }, detail: 'none' })
    expect(updated.picked?.[0]?.edges).toHaveLength(1)
    const batch = await run<{ added: Brief[] }>('reverse.feature.add', { features: [{ kind: 'chamfer', body: 'Block', edges: [{ between: [[0, 0, -1], [0, 1, 0]] }], distance: 0.5 }], detail: 'none' })
    expect(batch.added[0].picked?.[0]?.edges).toHaveLength(1)
  })
})

describe('K5: a fitted round that had nothing to fit says so', () => {
  it('a corner whose pieces carry no points about it — R0.02 from one point — warns', () => {
    // The fan wheel's case: the pieces that carried the corner's round
    // were taken out. The two lines left run sharp into the corner, and
    // the few points off them lie outside it, where no round goes: the
    // search's best is its smallest radius, R0.02.
    const sketch = emptySketch()
    const along: Vec2[] = Array.from({ length: 81 }, (_, i) => [i * 0.25, 10])
    const down: Vec2[] = Array.from({ length: 81 }, (_, i) => [20, 10 - i * 0.25])
    const a = addEntity(sketch, { kind: 'line', a: [0, 10], b: [20, 10], points: [...along, [20.4, 10.3], [20.3, 10.4]], scatter: 0.01 } as never)
    const b = addEntity(sketch, { kind: 'line', a: [20, 10], b: [20, -10], points: [...down, [20.35, 10.35]], scatter: 0.01 } as never)
    addConstraint(sketch, { kind: 'coincident', p: { entity: a, at: 'b' }, q: { entity: b, at: 'a' } })
    const made = roundCorner(sketch, a, b)
    if (typeof made === 'string') throw new Error(made)
    expect(made.found).toBe('limit')
    expect(made.radius).toBeCloseTo(0.02, 6)
    const warning = roundUnread(made.points, made.found)
    expect(warning).toMatch(/radius not read; give radius/)
    if (made.points < 3) expect(warning).toMatch(new RegExp(`^${made.points} points?`))
  })

  it('a round read from its points does not warn; one given never does', () => {
    expect(roundUnread(12, 'read')).toBeNull()
    expect(roundUnread(0, undefined)).toBeNull()
    expect(roundUnread(1, 'read')).toBe('1 point on the round — radius not read; give radius, or re-fit the corner so its pieces carry its slice points')
  })

  it('through the command: a round at the scan’s sharp corner warns and is held by a dimension', async () => {
    const [a, b] = await fittedCorner([-20, -20])
    const out = await run<{ rounds: Round[] }>('reverse.sketch.edit', { sketch: 'Profile', add: { rounds: [{ a: a.id, b: b.id }] } })
    const [round] = out.rounds
    expect(round.warning).toMatch(/radius not read/)
    expect(round.held).toBe('dimension')
    expect(round.sigma).toBeNull()
  })
})

describe('K13: two lines are not tangent', () => {
  it('refuses with what to do instead', async () => {
    const err = await refused('reverse.feature.add', {
      feature: {
        kind: 'sketch',
        plane: { kind: 'world', axis: 'z', offset: 0 },
        sketch: { entities: [{ id: 1, kind: 'line', a: [0, 0], b: [10, 0] }, { id: 2, kind: 'line', a: [10, 0], b: [20, 1] }], constraints: [{ kind: 'tangent', a: 1, b: 2 }] },
      },
    })
    expect(err.code).toBe('invalid_input')
    expect(err.message).toMatch(/use parallel or collinear, or add\.rounds/)
  })
})

const rectangle = (name: string, center: P2, size: P2, z = 0) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z', offset: z }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center, size, fixed: true }] } })

/** A block 10 high on a rectangle of the XY plane, a body of its own. */
async function block(name: string, center: P2, size: P2) {
  await run('reverse.feature.add', { feature: rectangle(`${name} plan`, center, size) })
  const made = await run<Brief>('reverse.feature.add', { feature: { kind: 'extrude', name, sketchId: `${name} plan`, regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' } })
  expect(made.result?.status, made.result?.message).toBe('ok')
  return made.bodies!.changed![0].id
}

describe('K13: target — a solid joins one body alone', () => {
  it('joins the body named, not every body it meets; update moves or lets go of it', async () => {
    const left = await block('Left', [-12, 0], [10, 10])
    await block('Right', [12, 0], [10, 10])
    await run('reverse.feature.add', { feature: rectangle('Bar plan', [0, 0], [30, 4]) })
    const rib = await run<Brief>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Bar', sketchId: 'Bar plan', regions: 'all', extent: { kind: 'distance', from: 2, to: 8 }, op: 'join', target: 'Left' } })
    expect(rib.result?.status, rib.result?.message).toBe('ok')
    expect(rib.bodies?.count).toBe(2)
    expect((await run<{ target?: number }>('reverse.feature.list', { feature: 'Bar' })).target).toBe(left)
    // An edit of something else keeps it.
    const kept = await run<Brief>('reverse.feature.update', { feature: 'Bar', set: { extent: { kind: 'distance', from: 3, to: 8 } } })
    expect(kept.bodies?.count).toBe(2)
    expect((await run<{ target?: number }>('reverse.feature.list', { feature: 'Bar' })).target).toBe(left)
    // null lets it go: the bar joins both.
    const all = await run<Brief>('reverse.feature.update', { feature: 'Bar', set: { target: null } })
    expect(all.bodies?.count).toBe(1)
    expect((await run<{ target?: number }>('reverse.feature.list', { feature: 'Bar' })).target).toBeUndefined()
    expect((await refused('reverse.feature.update', { feature: 'Left plan', set: { target: 'Left' } })).code).toBe('invalid_input')
  })
})

describe('L11: ids sent as text', () => {
  it('a number written out that names nothing is taken as the id — a body, an island, a feature', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Two', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [-10, 0], size: [5, 5], fixed: true }, { kind: 'rectangle', id: 10, center: [10, 0], size: [5, 5], fixed: true }] } } })
    const made = await run<Brief>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Pair', sketchId: 'Two', regions: 'all', extent: { kind: 'distance', from: 0, to: 5 }, op: 'new' } })
    const ids = made.bodies!.changed!.map((b) => b.id).sort((x, y) => x - y)
    expect(ids).toHaveLength(2)
    expect(Number.isInteger(ids[1])).toBe(false)
    for (const id of ids) {
      const d = await run<{ bodies: { id: number }[] }>('reverse.body.describe', { body: String(id) })
      expect(d.bodies[0].id).toBe(id)
    }
    const f = await run<{ id: number; name: string }>('reverse.feature.list', { feature: String(made.feature!.id) })
    expect(f.name).toBe('Pair')
    const err = await refused('reverse.body.describe', { body: '999' })
    expect(err.code).toBe('not_found')
    expect(err.message).toMatch(/by name or by id/)
  })
})

describe('L11: an offset says its source still stands', () => {
  it('names the new body and the one beside it, at every detail', async () => {
    await block('Core', [0, 0], [10, 10])
    const out = await run<Brief>('reverse.feature.add', { feature: { kind: 'offsetBody', body: 'Core', distance: 1 } })
    expect(out.result?.status, out.result?.message).toBe('ok')
    expect(out.note).toMatch(/^new body \d+ \(Solid \d+\) beside Solid 1 \(\d+\); Solid 1 unchanged \(keep: false replaces it\)$/)
    const none = await run<Brief>('reverse.feature.add', { feature: { kind: 'offsetBody', body: 'Core', distance: 2 }, detail: 'none' })
    expect(none.note).toMatch(/beside Solid 1/)
    const replaced = await run<Brief>('reverse.feature.add', { feature: { kind: 'offsetBody', body: 'Core', distance: 0.5, keep: false } })
    expect(replaced.note).toBeUndefined()
  })
})

describe('L11: where.radius after a round, and sharp', () => {
  it('picked says when a radius took a round’s seam; sharp leaves it out', async () => {
    await block('Base', [0, 0], [40, 40])
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Boss plan', plane: { kind: 'world', axis: 'z', offset: 10 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 5, fixed: true }] } } })
    const boss = await run<Brief>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Boss', sketchId: 'Boss plan', regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'join' } })
    expect(boss.result?.status, boss.result?.message).toBe('ok')
    const top = await run<Brief>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Top round', body: 'Base', edges: [{ radius: 5, near: { at: [0, 0, 20], radius: 6 } }], radius: 1 } })
    expect(top.result?.status, top.result?.message).toBe('ok')
    type D = { bodies: { edgeList: { index: number; mid: [number, number, number] }[] }[] }
    const both = await run<D>('reverse.body.describe', { body: 'Base', where: { radius: 5 } })
    expect(both.bodies[0].edgeList).toHaveLength(2)
    const sharp = await run<D>('reverse.body.describe', { body: 'Base', where: { radius: 5, sharp: true } })
    expect(sharp.bodies[0].edgeList).toHaveLength(1)
    expect(sharp.bodies[0].edgeList[0].mid[2]).toBeCloseTo(10, 3)
    const chamfer = await run<Brief>('reverse.feature.add', { feature: { kind: 'chamfer', body: 'Base', edges: [{ radius: 5 }], distance: 0.5 }, detail: 'none' })
    const row = chamfer.picked!.find((r) => r.where) as { smooth?: number; note?: string }
    expect(row.smooth).toBe(1)
    expect(row.note).toMatch(/sharp: true leaves them out/)
  })

  it('picked counts the tangent chains a pick makes, where they are fewer than its edges', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Slab plan', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [30, 20], radius: 4, fixed: true }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Slab', sketchId: 'Slab plan', regions: 'all', extent: { kind: 'distance', from: 0, to: 5 }, op: 'new' } })
    const out = await run<Brief>('reverse.feature.add', { feature: { kind: 'fillet', body: 'Slab', edges: [{ box: { min: [-20, -20, 4.9], max: [20, 20, 5.1] } }], radius: 1 } })
    const row = out.picked!.find((r) => r.where) as { edges: number[]; chains?: number; note?: string }
    expect(row.edges).toHaveLength(8)
    expect(row.chains).toBe(1)
    expect(row.note).toMatch(/8 edges in 1 tangent chain/)
  })
})
