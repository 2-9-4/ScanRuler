// SPDX-License-Identifier: AGPL-3.0-only
// A sweep along a route in 3D: straights and tangent arcs from corner points
// and a bend radius, a bend too big for its straights refused with the most it
// takes, the profile held to the start, and a tube in three bend planes built
// round and oval, measured against its length and read back from STEP. The
// kernel runs in this thread.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { boxMesh } from '../../../tests/helpers'
import { collectReversePart, validateFeatureJson } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import type { LoopPiece } from '../core/kernelTypes'
import { slotsOf } from '../core/parameters'
import { ReClient } from '../core/reClient'
import { routePieces, type SweepRoute } from '../core/sweepRoute'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 180_000 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any

const at0: Vec3 = [0, 0, 0]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const pieces = (route: SweepRoute, from: Vec3 = at0) => {
  const made = routePieces(route, from)
  if (typeof made === 'string') throw new Error(made)
  return made
}
const kinds = (p: LoopPiece[]) => p.map((x) => x.kind).join(' ')
type Run = Extract<LoopPiece, { kind: 'line' | 'arc' }>

/** A centreline in three bend planes, each corner a square turn. */
const THREE_PLANES: Vec3[] = [
  [0, 0, 0],
  [0, 0, 50],
  [50, 0, 50],
  [50, 50, 50],
  [50, 50, 100],
]
/** Its length at a bend radius: every corner gives up 2R and takes a quarter
 *  round back. */
const lengthAt = (r: number) => 200 - 3 * 2 * r + 3 * (Math.PI / 2) * r

describe('a route as pieces', () => {
  it('makes straights and tangent arcs, each joined to the next', () => {
    const { pieces: made, start, tangent } = pieces({ points: THREE_PLANES, bendRadius: 10 })
    expect(kinds(made)).toBe('line arc line arc line arc line')
    expect(start).toEqual([0, 0, 0])
    expect(tangent).toEqual([0, 0, 1])
    for (let i = 1; i < made.length; i++) expect(dist((made[i - 1] as Run).b, (made[i] as Run).a)).toBe(0)
    // The first bend: 10 back from the corner each way, its middle on the
    // bisector 10 from the centre at (10, 0, 40).
    const arc = made[1] as Extract<LoopPiece, { kind: 'arc' }>
    expect(arc.a).toEqual([0, 0, 40])
    expect(arc.b).toEqual([expect.closeTo(10, 9), 0, expect.closeTo(50, 9)])
    expect(dist(arc.m, [10, 0, 40])).toBeCloseTo(10, 9)
    expect(dist(arc.a, [10, 0, 40])).toBeCloseTo(10, 9)
  })

  it('runs from the end nearest the profile', () => {
    const { pieces: made, start, tangent } = pieces({ points: THREE_PLANES, bendRadius: 10 }, [50, 50, 99])
    expect(start).toEqual([50, 50, 100])
    expect(tangent).toEqual([-0, -0, -1])
    expect((made[0] as Run).a).toEqual([50, 50, 100])
    expect((made[made.length - 1] as Run).b).toEqual([0, 0, 0])
  })

  it('refuses a bend its straights cannot take, naming the point and the most it takes', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [0, 0, 20],
      [30, 0, 20],
    ]
    const said = routePieces({ points, bendRadius: 25 }, at0) as string
    expect(said).toMatch(/points\[1\] \(0, 0, 20\)/)
    expect(said).toMatch(/straight from points\[0\]/)
    expect(said).toMatch(/takes a radius of 20 mm at most/)
    // The most it says fits, the arc using up the straight wholly.
    expect(kinds(pieces({ points, bendRadius: 20 }).pieces)).toBe('arc line')
    // Two corners sharing a straight: the second is told what the first
    // leaves of it.
    const shared: Vec3[] = [
      [0, 0, 0],
      [0, 0, 100],
      [30, 0, 100],
      [30, 0, 200],
    ]
    expect(routePieces({ points: shared, bendRadius: 20 }, at0)).toMatch(/points\[1\].*takes a radius of 10 mm at most/)
    expect(kinds(pieces({ points: shared, bendRadius: 15 }).pieces)).toBe('line arc arc line')
    // Each bend its own radius: 25 and 5 share the 30 and no more.
    expect(kinds(pieces({ points: shared, bendRadius: 1, radii: [25, 5] }).pieces)).toBe('line arc arc line')
    expect(routePieces({ points: shared, bendRadius: 1, radii: [25, 6] }, at0)).toMatch(/takes a radius of 24 mm at most/)
    expect(routePieces({ points: shared, bendRadius: 1, radii: [25] }, at0)).toMatch(/2 inner points and 1 radii/)
  })

  it('passes over repeated points and corners with no turn, and says of the rest what is wrong', () => {
    const plain = pieces({ points: [[0, 0, 0], [0, 0, 0], [0, 0, 20], [0, 0, 20], [0, 0, 40], [30, 0, 40]], bendRadius: 5 })
    expect(kinds(plain.pieces)).toBe('line arc line')
    expect((plain.pieces[0] as Run).b).toEqual([0, 0, 35])
    expect(kinds(pieces({ points: [[0, 0, 0], [0, 0, 20], [0, 0, 40]], bendRadius: 5 }).pieces)).toBe('line')
    expect(routePieces({ points: [[0, 0, 0], [0, 0, 0]], bendRadius: 5 }, at0)).toMatch(/all one point/)
    // The point said is as given, whatever was passed over before it.
    expect(routePieces({ points: [[0, 0, 0], [0, 0, 0], [0, 0, 20], [0, 0, 5]], bendRadius: 5 }, at0)).toMatch(/folds back.*points\[2\]/)
    expect(routePieces({ points: [[0, 0, 0], [0, 0, 20], [30, 0, 20], [0, 0, 0]], bendRadius: 5 }, at0)).toMatch(/ends where it starts/)
    expect(routePieces({ points: [[0, 0, 0], [0, 0, 20], [30, 0, 20]], bendRadius: 0 }, at0)).toMatch(/needs a radius above 0/)
  })
})

describe('a sweep along a route', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []
  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box-route.stl', discard: true })
  }, 120_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless.stop()
  })

  const fresh = () => run('reverse.feature.clear')
  const onZ = (name: string, sketch: unknown) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z' }, sketch })
  const circle = { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 4 }] }

  /** A body's volume off its mesh: the kernel's own runs low on splines. */
  function meshVolume(bodyId: number): number {
    const m = session.meshes.get(bodyId)!
    let v = 0
    for (let i = 0; i + 2 < m.indices.length; i += 3) {
      const [p, q, r] = [0, 1, 2].map((k) => [0, 1, 2].map((j) => m.positions[m.indices[i + k] * 3 + j]))
      v += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])
    }
    return Math.abs(v) / 6
  }
  const stepCheck = async () => (await run<A>('reverse.export.step', { verify: true })).verify

  it('builds a round tube in three bend planes to its length, and reads back from STEP', async () => {
    await fresh()
    await run('reverse.feature.add', { feature: onZ('Round', circle) })
    const swept = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Tube', profile: 'Round', route: { points: THREE_PLANES, bendRadius: 10 }, op: 'new' } })
    expect(swept.result.status, swept.result.message).toBe('ok')
    const body = swept.bodies.changed[0]
    expect(body.closed).toBe(true)
    const volume = Math.PI * 16 * lengthAt(10)
    expect(Math.abs(meshVolume(body.id) - volume) / volume).toBeLessThan(0.003)
    expect(body.bounds.min).toEqual([expect.closeTo(-4, 2), expect.closeTo(-4, 2), expect.closeTo(0, 2)])
    expect(body.bounds.max).toEqual([expect.closeTo(54, 2), expect.closeTo(54, 2), expect.closeTo(100, 2)])
    const check = await stepCheck()
    expect(check.ok, JSON.stringify(check)).toBe(true)
  })

  it('carries an oval spline profile the same way: the section keeps its shape, the seam holds', async () => {
    await fresh()
    await run('reverse.feature.add', { feature: onZ('Oval', { shapes: [{ kind: 'ellipse', center: [0, 0], a: 5, b: 3.5 }] }) })
    const swept = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Oval tube', profile: 'Oval', route: { points: THREE_PLANES, bendRadius: 12 }, op: 'new' } })
    expect(swept.result.status, swept.result.message).toBe('ok')
    expect(swept.bodies.changed[0].closed).toBe(true)
    const volume = Math.PI * 5 * 3.5 * lengthAt(12)
    expect(Math.abs(meshVolume(swept.bodies.changed[0].id) - volume) / volume).toBeLessThan(0.01)
    const check = await stepCheck()
    expect(check.ok, JSON.stringify(check)).toBe(true)
  })

  it('starts on a measured plane where the route does not leave along an axis', async () => {
    await fresh()
    const way: Vec3 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]
    const start: Vec3 = [3, 2, 1]
    const corner: Vec3 = [start[0] + 40 * way[0], start[1] + 40 * way[1], start[2] + 40 * way[2]]
    await run('element.construct', { kind: 'plane', method: 'plane-coords', params: { nx: way[0], ny: way[1], nz: way[2], px: start[0], py: start[1], pz: start[2] }, name: 'Start plane' })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Round', plane: { kind: 'plane', name: 'Start plane' }, sketch: { shapes: [{ kind: 'ellipse', world: true, center: start, a: 4, b: 4 }] } } })
    const swept = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Tube', profile: 'Round', route: { points: [start, corner, [corner[0] + 40, corner[1], corner[2]]], bendRadius: 10 }, op: 'new' } })
    expect(swept.result.status, swept.result.message).toBe('ok')
    expect(swept.bodies.changed[0].closed).toBe(true)
  })

  it('holds the profile to the start: square, in its plane and on it', async () => {
    await fresh()
    await run('reverse.feature.add', { feature: onZ('Round', circle) })
    const askew = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Askew', profile: 'Round', route: { points: [[0, 0, 0], [40, 0, 0]], bendRadius: 10 }, op: 'new' } })
    expect(askew.result).toMatchObject({ status: 'failed', message: expect.stringContaining('90.0° off square to the route') })
    expect(askew.result.message).toMatch(/\{ kind: "world", axis: "x", offset: 0 \}/)
    const above = await run<A>('reverse.feature.update', { feature: 'Askew', set: { route: { points: [[0, 0, 1], [0, 0, 40]], bendRadius: 10 } } })
    expect(above.result).toMatchObject({ status: 'failed', message: expect.stringContaining('1.000 mm off the route') })
    const beside = await run<A>('reverse.feature.update', { feature: 'Askew', set: { route: { points: [[9, 0, 0], [9, 0, 40]], bendRadius: 10 } } })
    expect(beside.result).toMatchObject({ status: 'failed', message: expect.stringContaining('The route starts 9.000 mm from the middle') })
    const tight = await run<A>('reverse.feature.update', { feature: 'Askew', set: { route: { points: [[0, 0, 0], [0, 0, 5], [30, 0, 5]], bendRadius: 10 } } })
    expect(tight.result).toMatchObject({ status: 'failed', message: expect.stringContaining('takes a radius of 5 mm at most') })
    const fold = await run<A>('reverse.feature.update', { feature: 'Askew', set: { route: { points: [[0, 0, 0], [0, 0, 20], [30, 0, 20]], bendRadius: 3 } } })
    expect(fold.result).toMatchObject({ status: 'failed', message: expect.stringContaining('would fold through itself') })
    const well = await run<A>('reverse.feature.update', { feature: 'Askew', set: { route: { points: [[0, 0, 0], [0, 0, 20], [30, 0, 20]], bendRadius: 10 } } })
    expect(well.result.status, well.result.message).toBe('ok')
  })

  it('takes path or route, as add and update say; a project with either stands the same', async () => {
    await fresh()
    await run('reverse.feature.add', { feature: onZ('Round', circle) })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Path', plane: { kind: 'world', axis: 'y', offset: 0 }, sketch: { shapes: [{ kind: 'polyline', world: true, points: [[0, 0, 0], [0, 0, 30]] }] } } })
    expect((await refused('reverse.feature.add', { feature: { kind: 'sweep', profile: 'Round' } })).message).toMatch(/takes path.*or route/)
    expect((await refused('reverse.feature.add', { feature: { kind: 'sweep', profile: 'Round', path: 'Path', route: { points: [[0, 0, 0], [0, 0, 9]], bendRadius: 1 } } })).message).toMatch(/not both/)
    const swept = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Tube', profile: 'Round', route: { points: THREE_PLANES, bendRadius: 10 }, op: 'new' } })
    expect(swept.result.status, swept.result.message).toBe('ok')
    const listed = await run<A>('reverse.feature.list', { feature: 'Tube' })
    expect(listed.route.bendRadius).toBe(10)
    // Nothing but the profile's sketch is read: the path sketch can go.
    const sweep = () => useReverse.getState().features.find((f) => f.name === 'Tube') as A
    expect(sweep().path).toBeUndefined()

    // Saved and read as a file holds it.
    const part = JSON.parse(JSON.stringify(collectReversePart())) as A
    const held = part.features.find((f: A) => f.name === 'Tube')
    expect(held.route.points).toEqual(THREE_PLANES)
    expect(() => validateFeatureJson(held)).not.toThrow()
    expect(() => validateFeatureJson({ ...held, route: { points: [[0, 0]], bendRadius: 1 } })).toThrow()
    // A sweep of an older file has no route at all.
    expect(() => validateFeatureJson({ kind: 'sweep', name: 'Old', profile: 1, path: 2 })).not.toThrow()

    // The bend radius takes an expression; the rest of the route stays.
    expect(slotsOf(sweep()).map((s) => s.path)).toEqual(['route.bendRadius'])
    await run('reverse.parameter.add', { name: 'bend', expression: '8' })
    const driven = await run<A>('reverse.feature.update', { feature: 'Tube', set: { exprs: { 'route.bendRadius': 'bend' } } })
    expect(driven.result.status, driven.result.message).toBe('ok')
    expect(sweep().route.bendRadius).toBe(8)
    expect(sweep().route.points).toEqual(THREE_PLANES)
    const volume = Math.PI * 16 * lengthAt(8)
    expect(Math.abs(meshVolume(swept.bodies.changed[0].id) - volume) / volume).toBeLessThan(0.003)

    // A path given takes the route's place, and the other way round.
    const onPath = await run<A>('reverse.feature.update', { feature: 'Tube', set: { path: 'Path' } })
    expect(onPath.result.status, onPath.result.message).toBe('ok')
    expect(sweep().route).toBeUndefined()
    expect(slotsOf(sweep())).toEqual([])
    const back = await run<A>('reverse.feature.update', { feature: 'Tube', set: { route: { points: THREE_PLANES, bendRadius: 10 } } })
    expect(back.result.status, back.result.message).toBe('ok')
    expect(sweep().path).toBeUndefined()
  })

  it('holds a profile a build placed anew to the route: on a face that moved off it, refused', async () => {
    await fresh()
    await run('reverse.feature.add', { feature: { ...onZ('Base', { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 15 }] }) } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Base', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' } })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'On top', plane: { kind: 'bodyFace', body: 'Block', face: { kind: 'plane', between: [[0, 0, 1]] } }, sketch: circle } })
    const swept = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Tube', profile: 'On top', route: { points: [[0, 0, 10], [0, 0, 40]], bendRadius: 5 }, op: 'new' } })
    expect(swept.result.status, swept.result.message).toBe('ok')
    await run('reverse.feature.update', { feature: 'Block', set: { extent: { kind: 'distance', from: 0, to: 12 } } })
    const results = useReverse.getState().results
    const tube = useReverse.getState().features.find((f) => f.name === 'Tube')!
    expect(results[tube.id].status).toBe('failed')
    expect(results[tube.id].message).toMatch(/off the route/)
  })

  it('builds what the trace answers: a tube scan read by the command and swept along its route, in the part measured', async () => {
    await fresh()
    // A real pipe's bend as it was read from its scan: its numbers, an oval
    // profile on a plane standing as the route leaves.
    const route = { points: [[14.209, -18.326, 100.932], [-27.285, -20.399, 104.81], [-25.02, -5.523, 74.696]] as Vec3[], bendRadius: 26.511, radii: [26.511] }
    const made = routePieces(route, route.points[0])
    if (typeof made === 'string') throw new Error(made)
    const { start, tangent } = made
    await run('element.construct', { kind: 'plane', method: 'plane-coords', params: { nx: tangent[0], ny: tangent[1], nz: tangent[2], px: start[0], py: start[1], pz: start[2] }, name: 'Start of pipe' })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Oval', plane: { kind: 'plane', name: 'Start of pipe' }, sketch: { shapes: [{ kind: 'ellipse', world: true, center: start, a: 12.5, b: 11.8 }] } } })
    const swept = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Pipe', profile: 'Oval', route, op: 'new' } })
    expect(swept.result.status, swept.result.message).toBe('ok')
    expect(swept.bodies.changed[0].closed).toBe(true)
    const check = await stepCheck()
    expect(check.ok, JSON.stringify(check)).toBe(true)

    // The command on a tube scan: a square turn of R20 between straights.
    const line: Vec3[] = []
    for (let z = 0; z < 60; z += 0.5) line.push([0, 0, z])
    for (let a = 0; a < Math.PI / 2; a += 0.025) line.push([20 - 20 * Math.cos(a), 0, 60 + 20 * Math.sin(a)])
    for (let x = 20; x <= 80; x += 0.5) line.push([x, 0, 80])
    const dirs = line.map((_, i) => {
      const q = line[Math.min(i + 1, line.length - 1)]
      const o = line[Math.max(i - 1, 0)]
      const l = dist(q, o)
      return [(q[0] - o[0]) / l, 0, (q[2] - o[2]) / l]
    })
    const around = 48
    const ring = (i: number, k: number): number[] => {
      const a = (2 * Math.PI * (k % around)) / around
      // In the XZ plane square to the way, and along Y.
      const across = [dirs[i][2], 0, -dirs[i][0]]
      return [0, 1, 2].map((j) => line[i][j] + 8 * Math.cos(a) * across[j] + (j === 1 ? 8 * Math.sin(a) : 0))
    }
    const soup: number[] = []
    for (let i = 0; i + 1 < line.length; i++)
      for (let k = 0; k < around; k++) {
        const [a, b, c, d] = [ring(i, k), ring(i, k + 1), ring(i + 1, k), ring(i + 1, k + 1)]
        soup.push(...a, ...b, ...d, ...a, ...d, ...c)
      }
    for (let k = 0; k < around; k++) {
      soup.push(...line[0], ...ring(0, k + 1), ...ring(0, k))
      soup.push(...line[line.length - 1], ...ring(line.length - 1, k), ...ring(line.length - 1, k + 1))
    }
    await run('scan.open', { bytes: stlBytes(new Float32Array(soup)), name: 'tube.stl', discard: true })
    const read = await run<A>('reverse.scan.tube_trace', { start: [0, 0, 10], dir: [0, 0, 1], both: true })
    expect(read.stops).toHaveLength(2)
    expect(read.route.points).toHaveLength(3)
    expect(dist(read.route.points[1], [0, 0, 80])).toBeLessThan(0.1)
    expect(Math.abs(read.route.radii[0] - 20)).toBeLessThan(0.2)
    expect(read.stations.length).toBeGreaterThan(10)
    expect(read.stations[2].major).toBeCloseTo(16, 0)
    const p = read.startPlane
    expect(p.method).toBe('plane-coords')
    await run('element.construct', { kind: p.kind, method: p.method, params: p.params, name: 'Tube start' })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Tube round', plane: { kind: 'plane', name: 'Tube start' }, sketch: { shapes: [{ kind: 'ellipse', world: true, center: [p.params.px, p.params.py, p.params.pz], a: 8, b: 8 }] } } })
    const tube = await run<A>('reverse.feature.add', { feature: { kind: 'sweep', name: 'Tube read', profile: 'Tube round', route: read.route, op: 'new' } })
    expect(tube.result.status, tube.result.message).toBe('ok')
    expect((await refused('reverse.scan.tube_trace', { start: [0, 0, 10] })).code).toBe('invalid_input')
    const nowhere = await run<A>('reverse.scan.tube_trace', { start: [500, 0, 10], dir: [0, 0, 1] })
    expect(nowhere.route).toBeNull()
    expect(nowhere.stops[0].says).toMatch(/start has to lie inside the tube/)
  })
})
