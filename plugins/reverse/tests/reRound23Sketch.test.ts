// SPDX-License-Identifier: AGPL-3.0-only
// What two runs on real parts asked of sketches and of rounds: kinks a fit
// left said once; an unknown field of a fit answered with the fields it has;
// an inset of several profiles, chain by chain; a fit at one height moved for
// the taper the extrude will have, landing on the wall; an ellipse as a closed
// spline, its deviation said; a round on a feature of several solids, one per
// solid the query hits, all or none; seams left out of a fitted chamfer's
// picks. The kernel runs in this thread.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { boxMesh } from '../../../tests/helpers'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import type { Sketch, SketchLine } from '../core/sketch'
import { kinkedJoins } from '../core/sketchNearMiss'
import { insetChains, insetKeeps, stationLoop, type StationLoop } from '../core/stations'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 180_000 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box-round23.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})

const line = (id: number, a: number[], b: number[]) => ({ kind: 'line', id, a, b })
const sketchOf = (...entities: unknown[]) => ({ entities, constraints: [], nextId: 99 }) as unknown as Sketch
const plan = (name: string, z: number, sketch: unknown) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z', offset: z }, sketch })
const rect = (id: number, center: number[], size: number[]) => ({ kind: 'rectangle', id, center, size })
const pieces = (name: string): A => (useReverse.getState().features.find((f) => f.name === name) as A).sketch
const fresh = () => run('reverse.feature.clear')

/** A body's mesh as a triangle soup, each triangle cut in four `times` over:
 *  a scan's section reads many points along a wall, not a kernel mesh's few. */
function soupOf(bodyId: number, times = 3): Float32Array {
  const m = session.meshes.get(bodyId)!
  let tris: number[][] = []
  for (let i = 0; i < m.indices.length; i++) tris.push([0, 1, 2].map((k) => m.positions[m.indices[i] * 3 + k]))
  const out: number[] = []
  const split = (a: number[], b: number[], c: number[], n: number) => {
    if (n === 0) return void out.push(...a, ...b, ...c)
    const mid = (p: number[], q: number[]) => p.map((x, k) => (x + q[k]) / 2)
    const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)]
    split(a, ab, ca, n - 1)
    split(ab, b, bc, n - 1)
    split(ca, bc, c, n - 1)
    split(ab, bc, ca, n - 1)
  }
  for (let i = 0; i + 2 < tris.length; i += 3) split(tris[i], tris[i + 1], tris[i + 2], times)
  tris = []
  return new Float32Array(out)
}

/** A body's volume off its mesh. The kernel's own (a body's volume) runs
 *  low on a prism of a closed spline — 1 % at 16 points, 3 % at 64 — its
 *  numeric integration short of the many spans. */
function meshVolume(bodyId: number): number {
  const m = session.meshes.get(bodyId)!
  let v = 0
  for (let i = 0; i + 2 < m.indices.length; i += 3) {
    const [p, q, r] = [0, 1, 2].map((k) => [0, 1, 2].map((j) => m.positions[m.indices[i + k] * 3 + j]))
    v += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6
  }
  return Math.abs(v)
}

describe('kinks in an outline', () => {
  it('reads joins that turn 0.2° to 5°, line to line and line to arc; not a straight run, a corner, a junction or an angle meant', () => {
    const turn = (deg: number) => [10 + 10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180)]
    const kinked = kinkedJoins(sketchOf(line(1, [0, 0], [10, 0]), line(2, [10, 0], turn(2.16))))
    expect(kinked).toEqual([{ pieces: [1, 2], deg: 2.16, at: [10, 0] }])
    expect(kinkedJoins(sketchOf(line(1, [0, 0], [10, 0]), line(2, [10, 0], turn(0.1))))).toEqual([])
    expect(kinkedJoins(sketchOf(line(1, [0, 0], [10, 0]), line(2, [10, 0], turn(10))))).toEqual([])
    expect(kinkedJoins(sketchOf(line(1, [0, 0], [10, 0]), line(2, [10, 0], turn(3)), line(3, [10, 0], [10, 5])))).toEqual([])
    expect(kinkedJoins({ entities: [line(1, [0, 0], [10, 0]), line(2, [10, 0], turn(3))], constraints: [{ id: 5, kind: 'angle', a: 1, b: 2, value: 3 }], nextId: 9 } as unknown as Sketch)).toEqual([])
    // An arc leaving the line's end 3° off its tangent, whichever way it is drawn.
    const off = (3 * Math.PI) / 180
    const c = [10 - 5 * Math.sin(off), 5 * Math.cos(off)]
    const start = Math.atan2(-c[1], 10 - c[0])
    const arc = { kind: 'arc', id: 2, c, r: 5, start, sweep: 1 }
    expect(kinkedJoins(sketchOf(line(1, [0, 0], [10, 0]), arc))[0]).toMatchObject({ pieces: [1, 2], deg: 3 })
    // Tangent: no kink.
    const tangent = { kind: 'arc', id: 2, c: [10, 5], r: 5, start: -Math.PI / 2, sweep: 1 }
    expect(kinkedJoins(sketchOf(line(1, [0, 0], [10, 0]), tangent))).toEqual([])
  })

  it('says them once, at any detail, with the fix; rounds at a given radius take them away', async () => {
    await fresh()
    const kinked = plan('Kinked', 30, { entities: [line(1, [0, 0], [10, 0]), line(2, [10, 0], [20, 0.5]), line(3, [20, 0.5], [20, 10]), line(4, [20, 10], [0, 10]), line(5, [0, 10], [0, 0])] })
    const added = await run<A>('reverse.feature.add', { feature: kinked, detail: 'none' })
    expect(added.kinks).toEqual([{ pieces: [1, 2], deg: 2.86, at: [10, 0] }])
    expect(added.kinkFix).toMatch(/a tangent chain stops at it.*a crease of 2\.86°.*add: \{ rounds: \[\{ a: 1, b: 2, radius \}\] \}.*collinear/)
    const again = await run<A>('reverse.sketch.edit', { sketch: 'Kinked', name: 'Kinked' })
    expect(again.kinks).toBeUndefined()
    const rounded = await run<A>('reverse.sketch.edit', { sketch: 'Kinked', add: { rounds: [{ a: 1, b: 2, radius: 20 }] } })
    expect(rounded.rounds[0]).toMatchObject({ a: 1, b: 2, radius: 20, held: 'given' })
    expect(kinkedJoins(pieces('Kinked'))).toEqual([])
    expect(rounded.regions).toHaveLength(1)
  })

  it('collinear, as the fix words it, takes one away too', async () => {
    await fresh()
    const kinked = plan('Held', 30, { entities: [line(1, [0, 0], [10, 0]), line(2, [10, 0], [20, 0.5]), line(3, [20, 0.5], [20, 10]), line(4, [20, 10], [0, 10]), line(5, [0, 10], [0, 0])] })
    await run('reverse.feature.add', { feature: kinked, detail: 'none' })
    await run('reverse.sketch.edit', { sketch: 'Held', add: { constraints: [{ kind: 'collinear', line: 1, on: { line: 2 } }] } })
    expect(kinkedJoins(pieces('Held'))).toEqual([])
  })
})

describe('an unknown field of a sketch', () => {
  it('under fit names the fit’s fields, and where a filter of chains is', async () => {
    const e = await refused('reverse.feature.add', { feature: plan('No', 0, { fit: { minLength: 5 } }) })
    expect(e.message).toMatch(/input\.feature\.sketch\.fit\.minLength: not a known field — sketch\.fit has chains, within, level/)
    expect(e.message).toMatch(/A fit keeps no chains by length: reverse\.section\.fit \{ minLength, maxLength, closedOnly, maxChains \}.*fit\.chains/)
    expect(e.message).toMatch(/gives the fields\.$/)
    const other = await refused('reverse.feature.add', { feature: plan('No', 0, { fit: { minArea: 5 } }) })
    expect(other.message).toMatch(/sketch\.fit has chains/)
    expect(other.message).not.toMatch(/keeps no chains/)
  })

  it('under a sketch, an inset and an edit’s add, the same way', async () => {
    expect((await refused('reverse.feature.add', { feature: plan('No', 0, { shape: [] }) })).message).toMatch(/sketch\.shape: not a known field — sketch has fit, project, entities, shapes/)
    expect((await refused('reverse.feature.add', { feature: plan('No', 0, { shapes: [rect(1, [0, 0], [4, 4])], inset: { by: 1, wall: 2 } }) })).message).toMatch(/sketch\.inset\.wall: not a known field — sketch\.inset has by, of, keep/)
    await fresh()
    await run('reverse.feature.add', { feature: plan('Edited', 0, { shapes: [rect(1, [0, 0], [4, 4])] }) })
    expect((await refused('reverse.sketch.edit', { sketch: 'Edited', add: { fit: { maxChains: 2 } } })).message).toMatch(/input\.add\.fit\.maxChains: not a known field — sketch\.fit has chains.*keeps no chains/)
  })
})

describe('an inset of several profiles', () => {
  it('moves each closed chain into its own inside, a circle by its radius, and lists them', async () => {
    await fresh()
    const sk = { shapes: [{ kind: 'rectangle', id: 1, from: [0, 0], to: [10, 10] }, { kind: 'rectangle', id: 11, from: [20, 0], to: [40, 10] }], entities: [{ kind: 'circle', id: 31, c: [60, 5], r: 5 }], inset: { by: 1 } }
    const out = await run<A>('reverse.feature.add', { feature: plan('Several', 0, sk) })
    expect(out.inset).toMatchObject({ by: 1, moved: 9, kept: [] })
    expect(out.inset.chains).toHaveLength(3)
    const s = pieces('Several')
    const lens = s.entities.filter((e: A) => e.kind === 'line').map((l: SketchLine) => Math.round(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) * 1e6) / 1e6).sort((a: number, b: number) => a - b)
    expect(lens).toEqual([8, 8, 8, 8, 8, 8, 18, 18])
    expect(s.entities.find((e: A) => e.kind === 'circle').r).toBeCloseTo(4)
    expect(out.regions).toHaveLength(3)
  })

  it('at detail none too, and again in place, chain by chain', async () => {
    const again = await run<A>('reverse.feature.update', { feature: 'Several', set: { sketch: { inset: { by: -0.5 } } }, detail: 'none' })
    expect(again.inset).toMatchObject({ by: -0.5, moved: 9 })
    expect(pieces('Several').entities.find((e: A) => e.kind === 'circle').r).toBeCloseTo(4.5)
  })

  it('refuses by chain where one closes up, or two would cross, and moves nothing', async () => {
    await fresh()
    await run('reverse.feature.add', { feature: plan('Wide and thin', 0, { shapes: [{ kind: 'rectangle', id: 1, from: [0, 0], to: [40, 40] }, { kind: 'rectangle', id: 11, from: [50, 0], to: [90, 4] }] }) })
    const was = JSON.stringify(pieces('Wide and thin'))
    const closed = await refused('reverse.feature.update', { feature: 'Wide and thin', set: { sketch: { inset: { by: 3 } } } })
    expect(closed.message).toMatch(/1 of the 2 chains do not move: pieces 11, 12, 13, 14.*turn inside out.*nothing was moved/)
    const crossing = await refused('reverse.feature.update', { feature: 'Wide and thin', set: { sketch: { inset: { by: -6 } } } })
    expect(crossing.message).toMatch(/would cross.*Nothing was moved/)
    expect(JSON.stringify(pieces('Wide and thin'))).toBe(was)
  })

  it('moves a round drawn on a fitted chain with it, and keeps a closing line where it lies', () => {
    const points = [[0, 0], [1, 0]]
    const fitted = (id: number, a: number[], b: number[]) => ({ ...line(id, a, b), points })
    const round = { kind: 'arc', id: 4, c: [9, 9], r: 1, start: 0, sweep: Math.PI / 2 }
    const entities = [fitted(1, [0, 0], [10, 0]), fitted(2, [10, 0], [10, 9]), round, fitted(5, [9, 10], [0, 10]), line(6, [0, 10], [0, 0])]
    const tangents = [{ id: 7, kind: 'tangent', a: 2, b: 4 }, { id: 8, kind: 'tangent', a: 4, b: 5 }]
    const loop = stationLoop({ entities } as unknown as Sketch, 'x', { anyRuns: true }) as StationLoop
    expect(insetKeeps(loop)).toEqual(expect.arrayContaining([4, 6]))
    expect(insetKeeps(loop, { constraints: tangents } as unknown as Sketch)).toEqual([6])
  })

  it('moves a chain inside another into its own inside; leaves an open one where it lies', () => {
    const square = (first: number, lo: number, hi: number) => [line(first, [lo, lo], [hi, lo]), line(first + 1, [hi, lo], [hi, hi]), line(first + 2, [hi, hi], [lo, hi]), line(first + 3, [lo, hi], [lo, lo])]
    const out = insetChains(sketchOf(...square(1, 0, 20), ...square(5, 5, 15), line(9, [30, 0], [40, 0])), { by: 1, name: 'x' })
    if (typeof out === 'string') throw new Error(out)
    expect(out.chains.map((c) => c.pieces)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]])
    expect(out.open).toEqual([[9]])
    const at = (id: number) => (out.sketch.entities.find((e) => e.id === id) as SketchLine)
    expect(at(1).a).toEqual([1, 1])
    expect(at(5).a).toEqual([6, 6])
    expect(at(9).a).toEqual([30, 0])
    // Depth asked for: the hole the other way.
    const held = insetChains(sketchOf(...square(1, 0, 20), ...square(5, 5, 15)), { by: (depth) => (depth % 2 === 0 ? -1 : 1), name: 'x' })
    if (typeof held === 'string') throw new Error(held)
    expect(held.chains.map((c) => c.by)).toEqual([-1, 1])
  })
})

describe('a fit at one height against the draft', () => {
  const DRAFT = 3
  const HEIGHT = 20
  const LEVEL = 10
  const lean = LEVEL * Math.tan((DRAFT * Math.PI) / 180)
  /** A frustum on 40 × 40 with a Ø10 hole, as the taper makes it, for the scan. */
  beforeAll(async () => {
    await fresh()
    await run('reverse.feature.add', { feature: plan('Scan sk', 0, { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40] }], entities: [{ kind: 'circle', id: 21, c: [0, 0], r: 5 }] }) })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Scan', sketchId: 'Scan sk', regions: [{ at: [15, 15] }], extent: { kind: 'distance', from: 0, to: HEIGHT }, draftDeg: DRAFT, op: 'new' } })
    await session.settled()
    const soup = soupOf(useReverse.getState().bodies[0].id, 4)
    await fresh()
    await run('scan.open', { bytes: stlBytes(soup), name: 'frustum.stl', discard: true })
  }, 180_000)

  const volumeWith = async (sketch: string): Promise<number> => {
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: `${sketch} body`, sketchId: sketch, regions: 'largest', extent: { kind: 'distance', from: 0, to: HEIGHT }, draftDeg: DRAFT, op: 'new' } })
    await session.settled()
    const r = useReverse.getState().results[useReverse.getState().features.find((f) => f.name === `${sketch} body`)!.id]
    expect(r?.status).toBe('ok')
    const b = useReverse.getState().bodies.find((x) => r!.bodies!.includes(x.id))!
    return b.volume
  }

  it('moves the fitted chains by level·tan(draft), the hole the other way, and the extrude lands on the wall', async () => {
    const a = await run<A>('reverse.feature.add', { feature: plan('Mid wall', 0, { fit: { level: LEVEL, draftDeg: DRAFT, alignAxes: true } }), detail: 'none' })
    expect(a.draftOffset).toMatchObject({ draftDeg: DRAFT, level: LEVEL })
    expect(a.draftOffset.mm).toBeCloseTo(lean, 3)
    expect(a.draftOffset.note).toMatch(/draftDeg 3, toward level 10/)
    const out = a.draftOffset.chains.map((c: A) => c.outMm).sort((x: number, y: number) => x - y)
    expect(out[0]).toBeCloseTo(-lean, 3)
    expect(out[1]).toBeCloseTo(lean, 3)
    // The square at the plane again, the scan's slice moved with it.
    const s = pieces('Mid wall')
    const lines = s.entities.filter((e: A) => e.kind === 'line')
    expect(lines).toHaveLength(4)
    for (const l of lines as SketchLine[]) expect(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])).toBeCloseTo(40, 1)
    for (const l of lines as (SketchLine & { points: number[][] })[]) {
      expect(l.points.length).toBeGreaterThan(3)
      const across = Math.abs(l.a[0] - l.b[0]) > Math.abs(l.a[1] - l.b[1]) ? 1 : 0
      for (const p of l.points) expect(Math.abs(Math.abs(p[across]) - 20)).toBeLessThan(0.02)
    }
    // The solid: the frustum's volume, less its hole's growing cone.
    const t = Math.tan((DRAFT * Math.PI) / 180)
    const prism = (HEIGHT / 3) * (40 ** 2 + (40 - 2 * HEIGHT * t) ** 2 + 40 * (40 - 2 * HEIGHT * t))
    const hole = (Math.PI * HEIGHT * (5 ** 2 + (5 + HEIGHT * t) ** 2 + 5 * (5 + HEIGHT * t))) / 3
    expect(Math.abs((await volumeWith('Mid wall')) - (prism - hole)) / (prism - hole)).toBeLessThan(0.002)
  })

  it('without it, the wall lands off by that', async () => {
    await run('reverse.feature.add', { feature: plan('Not moved', 0, { fit: { level: LEVEL, alignAxes: true, chains: 'largest' } }), detail: 'none' })
    const l = pieces('Not moved').entities.find((e: A) => e.kind === 'line') as SketchLine
    expect(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])).toBeCloseTo(40 - 2 * lean, 1)
  })

  it('at the plane there is nothing to move; a spline cannot move, and it says why and the number', async () => {
    const atPlane = await run<A>('reverse.feature.add', { feature: plan('At plane', 5, { fit: { draftDeg: DRAFT, chains: 'largest', alignAxes: true } }), detail: 'none' })
    expect(atPlane.draftOffset).toMatchObject({ mm: 0, note: expect.stringMatching(/no fit\.level/) })
    const spline = await run<A>('reverse.feature.add', { feature: plan('Spline fit', 0, { fit: { level: LEVEL, draftDeg: DRAFT, chains: 'largest', spline: 12 } }), detail: 'none' })
    expect(spline.draftOffset.notMoved).toMatch(/a spline/)
    expect(spline.draftOffset.mm).toBeCloseTo(lean, 3)
    expect(spline.draftOffset.note).toMatch(/lands 0\.524\d* mm off the scan/)
    expect(spline.draftOffset.chains).toBeUndefined()
  })

  it('by an edit too, on the level fitted', async () => {
    await run('reverse.feature.add', { feature: plan('Edit fit', 50, { entities: [{ kind: 'point', id: 1, p: [100, 100] }] }) })
    const out = await run<A>('reverse.sketch.edit', { sketch: 'Edit fit', add: { fit: { level: -40, draftDeg: DRAFT, chains: 'largest', alignAxes: true } }, detail: 'none' })
    expect(out.draftOffset.mm).toBeCloseTo(40 * Math.tan((DRAFT * Math.PI) / 180), 3)
    expect(out.draftOffset.chains).toHaveLength(1)
  })
})

describe('an ellipse in a sketch', () => {
  it('is one closed spline, its deviation said; a closed face that extrudes to π·a·b', async () => {
    await fresh()
    const a = await run<A>('reverse.feature.add', { feature: plan('Tube', 0, { shapes: [{ kind: 'ellipse', id: 1, center: [3, 4], a: 12, b: 4, angleDeg: 30 }] }) })
    expect(a.shapes).toEqual([{ index: 0, kind: 'ellipse', spline: 1 }])
    expect(a.ellipses).toEqual([{ piece: 1, points: 16, deviationMm: expect.any(Number) }])
    expect(a.ellipses[0].deviationMm).toBeGreaterThan(0)
    expect(a.ellipses[0].deviationMm).toBeLessThan(0.05)
    expect(a.regions).toHaveLength(1)
    expect(Math.abs(a.regions[0].area - Math.PI * 48) / (Math.PI * 48)).toBeLessThan(0.002)
    const e = pieces('Tube').entities[0]
    expect(e).toMatchObject({ kind: 'spline', closed: true })
    expect(e.pts).toHaveLength(16)
    // Its first point: along the turned half axis a from the centre.
    expect(e.pts[0][0]).toBeCloseTo(3 + 12 * Math.cos(Math.PI / 6), 6)
    expect(e.pts[0][1]).toBeCloseTo(4 + 12 * Math.sin(Math.PI / 6), 6)
    const built = await run<A>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Bar', sketchId: 'Tube', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' } })
    expect(built.result.status).toBe('ok')
    expect(built.bodies.changed[0].closed).toBe(true)
    expect(Math.abs(meshVolume(built.bodies.changed[0].id) - Math.PI * 480) / (Math.PI * 480)).toBeLessThan(0.002)
  })

  it('more points lie closer; refused at no size; said at detail none', async () => {
    const more = await run<A>('reverse.feature.add', { feature: plan('Finer', 40, { shapes: [{ kind: 'ellipse', center: [0, 0], a: 12, b: 4, points: 32 }] }), detail: 'none' })
    const less = await run<A>('reverse.feature.add', { feature: plan('Coarser', 45, { shapes: [{ kind: 'ellipse', center: [0, 0], a: 12, b: 4, points: 8 }] }), detail: 'none' })
    expect(more.ellipses[0].deviationMm).toBeLessThan(less.ellipses[0].deviationMm)
    expect((await refused('reverse.feature.add', { feature: plan('Flat', 50, { shapes: [{ kind: 'ellipse', center: [0, 0], a: 12, b: 0 }] }) })).message).toMatch(/sketch\.shapes\[0\]\.b: must be more than 0/)
    // World points, as the other shapes take them.
    const world = await run<A>('reverse.feature.add', { feature: plan('World', 55, { shapes: [{ kind: 'ellipse', world: true, center: [2, 1, 55], a: 3, b: 2 }] }), detail: 'none' })
    expect(world.ellipses[0].points).toBe(16)
  })

  it('sweeps along a path', async () => {
    await fresh()
    await run('reverse.feature.add', { feature: plan('Tube', 0, { shapes: [{ kind: 'ellipse', center: [0, 0], a: 8, b: 3 }] }) })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Path', plane: { kind: 'world', axis: 'y', offset: 0 }, sketch: { shapes: [{ kind: 'polyline', world: true, points: [[0, 0, 0], [0, 0, 30]] }] } } })
    const swept = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Swept', profile: 'Tube', path: 'Path', op: 'new' } })
    expect(swept.result.status).toBe('ok')
    expect(swept.bodies.changed[0].closed).toBe(true)
    expect(Math.abs(meshVolume(swept.bodies.changed[0].id) - Math.PI * 720) / (Math.PI * 720)).toBeLessThan(0.005)
    // Round a bend too: on, tangent, a quarter turn of R20.
    const frame = (useReverse.getState().features.find((f) => f.name === 'Path') as A).frame
    const uv = (p: number[]) => [0, 1].map((k) => [0, 1, 2].reduce((sum, j) => sum + (p[j] - frame.origin[j]) * (k === 0 ? frame.basisU : frame.basisV)[j], 0))
    const [c, from, to] = [uv([20, 0, 30]), uv([0, 0, 30]), uv([20, 0, 50])]
    const start = Math.atan2(from[1] - c[1], from[0] - c[0])
    const sweep = Math.atan2(Math.sin(Math.atan2(to[1] - c[1], to[0] - c[0]) - start), Math.cos(Math.atan2(to[1] - c[1], to[0] - c[0]) - start))
    await run('reverse.sketch.edit', { sketch: 'Path', add: { entities: [{ kind: 'arc', c, r: 20, start, sweep }] } })
    const bent = await run<A>('reverse.feature.update', { feature: 'Swept', set: { name: 'Bent' } })
    expect(bent.result.status).toBe('ok')
    const length = 30 + 10 * Math.PI
    expect(Math.abs(meshVolume(bent.feature.id) - Math.PI * 24 * length) / (Math.PI * 24 * length)).toBeLessThan(0.005)
  })
})

describe('a round on a feature of several solids', () => {
  /** Three blocks in one extrude; the third lower, so that a box can miss it. */
  const blocks = async () => {
    await fresh()
    await run('reverse.feature.add', { feature: plan('Tool sk', 0, { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [10, 10] }, { kind: 'rectangle', id: 11, center: [20, 0], size: [10, 10] }, { kind: 'rectangle', id: 21, center: [100, 0], size: [10, 10] }] }) })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Tools', sketchId: 'Tool sk', regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' } })
    await session.settled()
  }
  const near = { kind: 'line', minLength: 1, box: { min: [-20, -20, 9], max: [40, 20, 11] } }

  it('by the feature’s name: one per solid the query hits, listed, the rest left out, one undo step', async () => {
    await blocks()
    const ids = useReverse.getState().bodies.map((b) => b.id)
    expect(ids).toHaveLength(3)
    const had = useReverse.getState().features.length
    const out = await run<A>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Tool round', body: 'Tools', edges: [near], radius: 1 } })
    expect(out.solids.made.map((m: A) => m.name)).toEqual(['Tool round 1', 'Tool round 2'])
    expect(out.solids.made.map((m: A) => m.body)).toEqual(ids.slice(0, 2))
    expect(out.solids.made.every((m: A) => m.status === 'ok' && m.edges === 4)).toBe(true)
    expect(out.solids.leftOut).toEqual([{ id: ids[2], name: expect.any(String) }])
    expect(out.solids.note).toMatch(/1 of the 3 solids left out/)
    expect(useReverse.getState().features.length).toBe(had + 2)
    await run('history.undo')
    expect(useReverse.getState().features.length).toBe(had)
    await run('history.redo')
    expect(useReverse.getState().features.length).toBe(had + 2)
  })

  it('by its id, by the id as text, at detail none, a chamfer: the same; a solid’s own id is that solid', async () => {
    await blocks()
    const tools = useReverse.getState().features.find((f) => f.name === 'Tools')!
    const ids = useReverse.getState().bodies.map((b) => b.id)
    const byId = await run<A>('reverse.feature.add', { feature: { kind: 'chamfer', name: 'C', body: tools.id, edges: [near], distance: 0.5 }, detail: 'none' })
    expect(byId.solids.made.map((m: A) => m.name)).toEqual(['C 1', 'C 2'])
    await run('history.undo')
    const byText = await run<A>('reverse.feature.add', { feature: { kind: 'chamfer', body: String(tools.id), edges: [near], distance: 0.5 } })
    expect(byText.solids.made.map((m: A) => m.name)).toEqual(['Chamfer on Tools 1', 'Chamfer on Tools 2'])
    await run('history.undo')
    const own = await run<A>('reverse.feature.add', { feature: { kind: 'chamfer', name: 'One', body: ids[1], edges: [near], distance: 0.5 } })
    expect(own.solids).toBeUndefined()
    expect(own.result.status).toBe('ok')
  })

  it('all or none: a name taken, no edge hit, a round too big', async () => {
    await blocks()
    const had = useReverse.getState().features.length
    await run('reverse.feature.add', { feature: plan('Taken 2', 50, { shapes: [rect(1, [0, 0], [1, 1])] }) })
    expect((await refused('reverse.feature.add', { feature: { kind: 'fillet', name: 'Taken', body: 'Tools', edges: [near], radius: 1 } })).message).toMatch(/already named “Taken 2”/)
    await run('reverse.feature.remove', { feature: 'Taken 2' })
    const none = await refused('reverse.feature.add', { feature: { kind: 'fillet', body: 'Tools', edges: [{ kind: 'circle' }], radius: 1 } })
    expect(none.code).toBe('not_found')
    expect(none.message).toMatch(/No edge of the 3 solids of Tools answers/)
    // Round 20 goes on none of the blocks, each 10 across.
    const big = await refused('reverse.feature.add', { feature: { kind: 'fillet', name: 'Big', body: 'Tools', edges: [near], radius: 20 } })
    expect(big.code).toBe('failed')
    expect(big.message).toMatch(/2 of the 2 fillets on Tools did not build, and none was added — Big 1 on/)
    expect(useReverse.getState().features.length).toBe(had)
    expect(useReverse.getState().features.some((f) => f.name.startsWith('Big'))).toBe(false)
  })

  it('edges by index: a name refused as before, naming the solids; faces by index in a query refused', async () => {
    await blocks()
    const e = await refused('reverse.feature.add', { feature: { kind: 'fillet', body: 'Tools', edges: [0], radius: 1 } })
    expect(e.message).toMatch(/Tools made 3 bodies/)
    const f = await refused('reverse.feature.add', { feature: { kind: 'fillet', body: 'Tools', edges: [{ faces: [0, 1] }], radius: 1 } })
    expect(f.message).toMatch(/faces or exclude by index number the faces and edges of one of them/)
  })
})

describe('seams in a fitted chamfer’s picks', () => {
  it('are dropped, said, and stay out at every rebuild; the name of the term told', async () => {
    await fresh()
    await run('reverse.feature.add', { feature: plan('Pin sk', 0, { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 12 }] }) })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Pin', sketchId: 'Pin sk', regions: 'all', extent: { kind: 'distance', from: 0, to: 30 }, op: 'new' } })
    await session.settled()
    // The scan: the same pin with its rim chamfered C1.
    const top = { box: { min: [-13, -13, 29], max: [13, 13, 31] }, kind: 'circle' }
    await run('reverse.feature.add', { feature: { kind: 'chamfer', name: 'Scan C1', body: 'Pin', edges: [top], distance: 1 } })
    await session.settled()
    const soup = soupOf(useReverse.getState().bodies[0].id, 2)
    await run('scan.open', { bytes: stlBytes(soup), name: 'pin.stl', discard: true })
    await run('reverse.feature.remove', { feature: 'Scan C1' })
    await session.settled()
    // The rim and the wall's seam, caught together; the bottom rim left out.
    const both = { madeBy: 'Pin', box: { min: [-13, -13, 5], max: [13, 13, 31] } }
    const edges = await run<A>('reverse.body.describe', { body: 'Pin', where: both })
    expect(edges.bodies[0].edgeList.map((e: A) => e.kind).sort()).toEqual(['circle', 'line'])
    const out = await run<A>('reverse.feature.add', { feature: { kind: 'chamfer', name: 'Rim', body: 'Pin', edges: [both], distance: 'fit' } })
    expect(out.fitted.distance.seamsDropped).toBe(1)
    expect(out.fitted.distance.note).toMatch(/1 seam edge left out of the picks: nothing to read a size across\. The query that caught them is kept with sharp: true/)
    expect(Math.abs(out.fitted.distance.value - 1)).toBeLessThan(0.1)
    expect(out.result.status).toBe('ok')
    const kept = useReverse.getState().features.find((f) => f.name === 'Rim') as A
    expect(kept.edges).toHaveLength(1)
    expect(kept.edgesWhere[0].where.sharp).toBe(true)
    // Picked by itself, the rim is told nothing of seams.
    await run('reverse.feature.remove', { feature: 'Rim' })
    const plain = await run<A>('reverse.feature.add', { feature: { kind: 'chamfer', name: 'Rim 2', body: 'Pin', edges: [{ ...both, kind: 'circle' }], distance: 'fit' } })
    expect(plain.fitted.distance.seamsDropped).toBeUndefined()
    await run('reverse.feature.remove', { feature: 'Rim 2' })
    // A seam alone: refused, saying what to pick.
    const seam = await refused('reverse.feature.add', { feature: { kind: 'chamfer', body: 'Pin', edges: [{ ...both, kind: 'line' }], distance: 'fit' } })
    expect(seam.message).toMatch(/Every edge picked is a seam.*kind: "other".*coaxial/)
  })
})
