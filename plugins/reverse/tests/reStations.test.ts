// SPDX-License-Identifier: AGPL-3.0-only
// The stations of a loft from the scan: a chain cut into another
// station's pieces, kind for kind; a closed profile moved inward by a
// wall, its base line kept; and, end to end, a moulded wing — an arch on
// two flared walls, 2 mm thick, ribs inside, growing along its length —
// lofted through six stations fitted like the first, its inner loft
// through their twins moved in by the wall, in one call.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run, refused, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import type { Vec2 } from '../../../src/core/flat/types'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { kindsOfChain } from '../core/segment'
import { anchorPoint, emptySketch, addEntity, addConstraint, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { insetKeeps, insetSketch, likeStation, type StationLoop, stationLoop } from '../core/stations'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 120_000 })

const deg = Math.PI / 180

/** The wing's section at z: an arch of radius R about (0, rise) between
 *  walls flaring out at `flare` down to the base, `t` thick. */
function wingAt(z: number) {
  return { R: 24 + 0.15 * z, rise: 0.05 * z, flare: (8 + 0.1 * z) * deg, t: 2, base: -15 }
}

/** Points along a stretch, `n` of them, the last left off. */
const along = (a: Vec2, b: Vec2, n: number): Vec2[] => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])

/** Where a wall tangent to the arch at angle `theta` (radius r) reaches
 *  the base: down along the tangent, away from the crown. */
function wallFoot(r: number, rise: number, theta: number, base: number, side: 1 | -1): { top: Vec2; foot: Vec2 } {
  const top: Vec2 = [r * Math.cos(theta), rise + r * Math.sin(theta)]
  // Down the wall: clockwise of the arch on the right, counter-clockwise on the left.
  const d: Vec2 = side === 1 ? [Math.sin(theta), -Math.cos(theta)] : [-Math.sin(theta), Math.cos(theta)]
  const k = (base - top[1]) / d[1]
  return { top, foot: [top[0] + d[0] * k, base] }
}

/** The wing's material at z, counter-clockwise round it — the same number
 *  of points at every z, so the layers join point for point. */
function wingProfile(z: number): Vec2[] {
  const { R, rise, flare, t, base } = wingAt(z)
  const r = R - t
  const W = 40
  const A = 160
  const ribs = [0.3, 0.5, 0.7]
  const out: Vec2[] = []
  const right = wallFoot(R, rise, flare, base, 1)
  const left = wallFoot(R, rise, Math.PI - flare, base, -1)
  out.push(...along(right.foot, right.top, W))
  for (let i = 0; i < A; i++) {
    const a = flare + ((Math.PI - 2 * flare) * i) / A
    out.push([R * Math.cos(a), rise + R * Math.sin(a)])
  }
  out.push(...along(left.top, left.foot, W))
  const innerLeft = wallFoot(r, rise, Math.PI - flare, base, -1)
  const innerRight = wallFoot(r, rise, flare, base, 1)
  out.push(...along(left.foot, innerLeft.foot, 4))
  out.push(...along(innerLeft.foot, innerLeft.top, W))
  // The inside of the arch, from the left back to the right, a rib where
  // one hangs: square to the arch, 2 mm thick, 6 mm deep.
  for (let i = 0; i < A; i++) {
    const s = i / A
    const rib = ribs.find((x) => Math.abs(s - x) < 0.02)
    const a = Math.PI - flare - (Math.PI - 2 * flare) * s
    if (rib === undefined) {
      out.push([r * Math.cos(a), rise + r * Math.sin(a)])
      continue
    }
    if (Math.abs(s - rib) >= 0.02 - 1 / A) continue
    const ar = Math.PI - flare - (Math.PI - 2 * flare) * rib
    const c: Vec2 = [Math.cos(ar), Math.sin(ar)]
    const tan: Vec2 = [-Math.sin(ar), Math.cos(ar)]
    const at = (rad: number, side: number): Vec2 => [c[0] * rad + tan[0] * side, rise + c[1] * rad + tan[1] * side]
    out.push(at(r, 1), at(r - 6, 1), at(r - 6, -1), at(r, -1))
  }
  out.push(...along(innerRight.top, innerRight.foot, W))
  out.push(...along(innerRight.foot, right.foot, 4))
  return out
}

/** The wing as a scan: its profile at every layer along Z, joined into a
 *  tube of triangles wound out of the material, jittered by `noise`. */
function wingMesh(length = 60, step = 4, noise = 0.02) {
  const layers = Math.round(length / step)
  const profiles = Array.from({ length: layers + 1 }, (_, l) => wingProfile(l * step))
  const k = profiles[0].length
  for (const p of profiles) if (p.length !== k) throw new Error('the layers differ in points')
  let s = 7
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
  const positions = new Float32Array(k * (layers + 1) * 3)
  profiles.forEach((p, l) =>
    p.forEach((q, i) => {
      positions.set([q[0] + rand() * noise, q[1] + rand() * noise, l * step], (l * k + i) * 3)
    }),
  )
  const indices: number[] = []
  const v = (i: number, l: number) => l * k + (i % k)
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < k; i++) {
      indices.push(v(i, l), v(i + 1, l), v(i + 1, l + 1))
      indices.push(v(i, l), v(i + 1, l + 1), v(i, l + 1))
    }
  return { positions, indices: new Uint32Array(indices) }
}

/** The outer skin at z as the stations see it: the right wall up from
 *  v = from, the arch, the left wall down — a noisy run of points. */
function outerRun(z: number, from = -13, noise = 0.02): Vec2[] {
  const { R, rise, flare, base } = wingAt(z)
  const right = wallFoot(R, rise, flare, base, 1)
  const left = wallFoot(R, rise, Math.PI - flare, base, -1)
  const k = (y: number, a: Vec2, b: Vec2): Vec2 => {
    const f = (y - a[1]) / (b[1] - a[1])
    return [a[0] + (b[0] - a[0]) * f, y]
  }
  const pts: Vec2[] = [...along(k(from, right.foot, right.top), right.top, 60)]
  for (let i = 0; i < 200; i++) {
    const a = flare + ((Math.PI - 2 * flare) * i) / 200
    pts.push([R * Math.cos(a), rise + R * Math.sin(a)])
  }
  pts.push(...along(left.top, k(from, left.foot, left.top), 60), k(from, left.foot, left.top))
  let s = 11
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
  return pts.map((p) => [p[0] + rand() * noise, p[1] + rand() * noise])
}

/** A station drawn as the template is: wall, arch, wall fitted (they carry
 *  slice points), joined tangent, closed by a line across the base. */
function templateAt(z: number): Sketch {
  const { R, rise, flare } = wingAt(z)
  const right = wallFoot(R, rise, flare, -15, 1)
  const left = wallFoot(R, rise, Math.PI - flare, -15, -1)
  const at = (a: Vec2, b: Vec2, y: number): Vec2 => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y]
  const r0 = at(right.foot, right.top, -13)
  const l0 = at(left.foot, left.top, -13)
  const run = outerRun(z)
  const s = emptySketch()
  const wallR = addEntity(s, { kind: 'line', a: r0, b: right.top, points: run.slice(0, 60), scatter: 0.02 })
  const arch = addEntity(s, { kind: 'arc', c: [0, rise], r: R, start: flare, sweep: Math.PI - 2 * flare, points: run.slice(60, 260), scatter: 0.02 })
  const wallL = addEntity(s, { kind: 'line', a: left.top, b: l0, points: run.slice(260), scatter: 0.02 })
  const baseLine = addEntity(s, { kind: 'line', a: l0, b: r0 })
  addConstraint(s, { kind: 'coincident', p: { entity: wallR, at: 'b' }, q: { entity: arch, at: 'a' } })
  addConstraint(s, { kind: 'coincident', p: { entity: arch, at: 'b' }, q: { entity: wallL, at: 'a' } })
  addConstraint(s, { kind: 'coincident', p: { entity: wallL, at: 'b' }, q: { entity: baseLine, at: 'a' } })
  addConstraint(s, { kind: 'coincident', p: { entity: baseLine, at: 'b' }, q: { entity: wallR, at: 'a' } })
  addConstraint(s, { kind: 'tangent', a: wallR, b: arch })
  addConstraint(s, { kind: 'tangent', a: arch, b: wallL })
  addConstraint(s, { kind: 'horizontal', entity: baseLine })
  addConstraint(s, { kind: 'radius', entity: arch, value: R })
  return s
}

const loopOf = (s: Sketch): StationLoop => {
  const loop = stationLoop(s, 'Station')
  if (typeof loop === 'string') throw new Error(loop)
  return loop
}

/** A line's distance from a parallel one. */
const lineGap = (a: SketchLine, b: SketchLine) => {
  const d = [b.b[0] - b.a[0], b.b[1] - b.a[1]]
  const l = Math.hypot(d[0], d[1])
  return Math.abs(((a.a[0] - b.a[0]) * d[1] - (a.a[1] - b.a[1]) * d[0]) / l)
}

describe('a chain cut into given pieces', () => {
  it('breaks a wall–arch–wall run where its pieces meet, whatever the cut would do', () => {
    const { R } = wingAt(20)
    const cut = kindsOfChain(outerRun(20), ['line', 'arc', 'line'])
    expect(cut.segments.map((s) => s.kind)).toEqual(['line', 'arc', 'line'])
    const arc = cut.segments[1].fit as { radius: number }
    expect(arc.radius).toBeCloseTo(R, 0)
    // The breaks within a couple of points of the tangent points (60, 260).
    expect(Math.abs(cut.segments[0].hi - 60)).toBeLessThan(6)
    expect(Math.abs(cut.segments[2].lo - 260)).toBeLessThan(6)
    expect(() => kindsOfChain(outerRun(20).slice(0, 8), ['line', 'arc', 'arc', 'line'])).toThrow(/too few/)
  })
})

describe('a station read as a profile', () => {
  it('starts a closed profile where its fitted run starts, and refuses a branch or a spline', () => {
    const loop = loopOf(templateAt(0))
    expect(loop.closed).toBe(true)
    expect(loop.pieces.map((p) => [p.kind, p.fitted])).toEqual([['line', true], ['arc', true], ['line', true], ['line', false]])
    const branch = templateAt(0)
    addEntity(branch, { kind: 'line', a: (branch.entities[0] as SketchLine).b, b: [0, 0] })
    expect(stationLoop(branch, 'Wing 1')).toMatch(/branches/)
    const spline = emptySketch()
    addEntity(spline, { kind: 'spline', pts: [[0, 0], [1, 1], [2, 0]] })
    expect(stationLoop(spline, 'Wing 1')).toMatch(/lines and arcs/)
  })
})

describe('a station fitted like another', () => {
  it('gives the run the template’s pieces in its order, under its ids, the base line copied and met', () => {
    const template = templateAt(0)
    const loop = loopOf(template)
    for (const run of [outerRun(30), outerRun(30).reverse()]) {
      const made = likeStation(template, loop, run)
      if (typeof made === 'string') throw new Error(made)
      expect(made.sketch.entities.map((e) => [e.id, e.kind])).toEqual(template.entities.map((e) => [e.id, e.kind]))
      const arc = made.sketch.entities[1] as SketchArc
      expect(arc.r).toBeCloseTo(wingAt(30).R, 0)
      // The base line lies where the template's does, its ends on the walls.
      const base = made.sketch.entities[3] as SketchLine
      expect(base.a[1]).toBeCloseTo(-13, 6)
      expect(base.b[1]).toBeCloseTo(-13, 6)
      const wallR = made.sketch.entities[0] as SketchLine
      const atBase = [wallR.a, wallR.b].find((p) => Math.abs(p[1] + 13) < 1e-6)
      expect(atBase).toBeDefined()
      // The relations copied: four joins, two tangencies, the level base;
      // the radius is the scan's, not the template's.
      expect(made.sketch.constraints.map((c) => c.kind).sort()).toEqual(['coincident', 'coincident', 'coincident', 'coincident', 'horizontal', 'tangent', 'tangent'])
    }
  })
})

describe('a profile moved inward', () => {
  it('moves the walls in along their normals and the arch down its radius, the base line kept', () => {
    const template = templateAt(0)
    const loop = loopOf(template)
    expect(insetKeeps(loop)).toEqual([4])
    const out = insetSketch(template, loop, 2, new Set(insetKeeps(loop)))
    if (typeof out === 'string') throw new Error(out)
    expect(out.moved).toEqual([1, 2, 3])
    const [wallR, arch, wallL, base] = out.sketch.entities as [SketchLine, SketchArc, SketchLine, SketchLine]
    const [wasR, wasArch, wasL] = template.entities as [SketchLine, SketchArc, SketchLine]
    expect(arch.r).toBeCloseTo(wasArch.r - 2, 9)
    expect(lineGap(wallR, wasR)).toBeCloseTo(2, 9)
    expect(lineGap(wallL, wasL)).toBeCloseTo(2, 9)
    expect(wallR.points).toBeUndefined()
    // The walls still run tangent into the arch, and reach the base line.
    const [p, q] = [anchorPoint(wallR, 'b'), anchorPoint(arch, 'a')]
    expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-6)
    expect(base.a[1]).toBeCloseTo(-13, 9)
    expect(Math.abs(base.b[0] - base.a[0])).toBeLessThan(Math.abs((template.entities[3] as SketchLine).b[0] - (template.entities[3] as SketchLine).a[0]))
    // The radius dimension follows the arc; nothing else had to go.
    expect(out.sketch.constraints.find((c) => c.kind === 'radius')).toMatchObject({ value: expect.closeTo(wasArch.r - 2, 9) })
    expect(out.dropped).toEqual([])
  })

  it('refuses an open profile and an arc tighter than the inset', () => {
    const open = templateAt(0)
    open.entities.pop()
    expect(insetSketch(open, loopOf(open), 2, new Set())).toMatch(/open/)
    const template = templateAt(0)
    expect(insetSketch(template, loopOf(template), 30, new Set([4]))).toMatch(/close up|inside out/)
  })
})

describe('the stations of a moulded wing, end to end', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []

  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    await run('scan.open', { bytes: stlBytes(soupOf(wingMesh())), name: 'wing.stl', discard: true })
  }, 120_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless.stop()
  })
  beforeEach(resetReverse)

  type Piece = { id: number; kind: string }
  const plane = (z: number) => ({ kind: 'world', axis: 'z', offset: z })
  const fit = { skin: 'outer', within: { min: [-100, -13], max: [100, 100] } }

  /** The first station as an agent makes it: the outer skin fitted, its
   *  tangencies taken, then a line drawn across the ends of its walls. */
  async function firstStation(): Promise<Piece[]> {
    const made = await run<{ fitted: { pieces: Piece[]; closed: boolean }[] }>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Wing 1', plane: plane(5), sketch: { fit: { ...fit, accept: { sigmas: 3, kinds: ['tangent'] } } } } })
    expect(made.fitted).toHaveLength(1)
    expect(made.fitted[0].pieces.map((p) => p.kind)).toEqual(['line', 'arc', 'line'])
    const listed = await run<{ sketch: { entities: (SketchLine | SketchArc)[] } }>('reverse.feature.list', { feature: 'Wing 1' })
    const ends = listed.sketch.entities.flatMap((e) => (['a', 'b'] as const).map((at) => anchorPoint(e, at)))
    const loose = ends.filter((p) => ends.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3).length === 1)
    expect(loose).toHaveLength(2)
    await run('reverse.sketch.edit', { sketch: 'Wing 1', add: { entities: [{ id: 50, kind: 'line', a: loose[0], b: loose[1] }] } })
    return made.fitted[0].pieces
  }

  it('fits five more stations like the first, moves all six in by the wall, and lofts both sets into valid solids — one call', async () => {
    const pieces = await firstStation()
    const zs = [15, 25, 35, 45, 55]
    type Answer = {
      feature: { id: number }
      result: { status: string }
      stations: { id: number; name: string; pieces: Piece[] }[]
      inner: { loft: { id: number; result: { status: string } }; stations: { id: number; moved: number; kept: number[] }[] }
    }
    const out = await run<Answer>('reverse.feature.add', { feature: { kind: 'loft', name: 'Wing', sections: [{ sketch: 'Wing 1' }, ...zs.map(plane)], fit: { like: 'Wing 1', ...fit }, inner: 2, ruled: false } })
    expect(out.result.status, JSON.stringify(out)).toBe('ok')
    expect(out.stations.map((s) => s.name)).toEqual(zs.map((_, k) => `Wing station ${k + 2}`))
    // Each station the same pieces in the same order as the first, the
    // base line among them.
    const kinds = [...pieces.map((p) => p.kind), 'line']
    for (const st of out.stations) expect(st.pieces.map((p) => p.kind)).toEqual(kinds)
    expect(out.inner.stations).toHaveLength(6)
    for (const t of out.inner.stations) expect(t).toMatchObject({ moved: pieces.length, kept: [50] })
    expect(out.inner.loft.result.status).toBe('ok')

    // The arcs of a station and its twin, R and R − 2.
    type Listed = { sketch: { entities: (SketchLine | SketchArc)[] } }
    for (let k = 0; k < 6; k++) {
      const outer = await run<Listed>('reverse.feature.list', { feature: k === 0 ? 'Wing 1' : `Wing station ${k + 1}` })
      const inner = await run<Listed>('reverse.feature.list', { feature: `Wing inner ${k + 1}` })
      const arcsOut = outer.sketch.entities.filter((e): e is SketchArc => e.kind === 'arc')
      const arcsIn = inner.sketch.entities.filter((e): e is SketchArc => e.kind === 'arc')
      expect(arcsIn.map((a) => a.r)).toEqual(arcsOut.map((a) => expect.closeTo(a.r - 2, 4)))
      expect(Math.max(...arcsOut.map((a) => a.r))).toBeCloseTo(wingAt(k === 0 ? 5 : zs[k - 1]).R, 0)
    }

    // Two closed solids, the inner inside the outer, the wall between them
    // about 2 mm by the skin's length by the 50 mm lofted.
    type Body = { id: number; name: string; closed: boolean; volume: number; bounds: { min: number[]; max: number[] } }
    const bodies = (await run<{ bodies: Body[] }>('reverse.build')).bodies
    // A body goes by the id of the feature that made it.
    const wing = bodies.find((b) => b.id === out.feature.id)!
    const inner = bodies.find((b) => b.id === out.inner.loft.id)!
    expect(wing.closed && inner.closed).toBe(true)
    expect(inner.volume).toBeLessThan(wing.volume)
    // In by the wall across and over the crown; down to the same base.
    expect(inner.bounds.min[0]).toBeGreaterThan(wing.bounds.min[0] + 1)
    expect(inner.bounds.max[0]).toBeLessThan(wing.bounds.max[0] - 1)
    expect(inner.bounds.max[1]).toBeCloseTo(wing.bounds.max[1] - 2, 0)
    expect(inner.bounds.min[1]).toBeCloseTo(wing.bounds.min[1], 1)
    const skin = (z: number) => {
      const { R, flare } = wingAt(z)
      return R * (Math.PI - 2 * flare) + 2 * 30
    }
    const wall = wing.volume - inner.volume
    expect(wall).toBeGreaterThan(2 * skin(5) * 50 * 0.8)
    expect(wall).toBeLessThan(2 * skin(55) * 50 * 1.1)
    // Both pass the kernel's check, and the inner cuts out of the outer
    // into one valid shell.
    type Checked = { valid: boolean; closed: boolean; solids: number }
    for (const b of [wing, inner]) expect((await run<{ bodies: Checked[] }>('reverse.body.check', { body: b.id, audit: false })).bodies[0]).toMatchObject({ valid: true, closed: true, solids: 1 })
    const cut = await run<{ result: { status: string } }>('reverse.feature.add', { feature: { kind: 'boolean', op: 'cut', body: wing.id, tool: inner.id } })
    expect(cut.result.status).toBe('ok')
    const shell = (await run<{ bodies: (Checked & { volume: number })[] }>('reverse.body.check', { body: wing.id, audit: false })).bodies[0]
    expect(shell).toMatchObject({ valid: true, closed: true, solids: 1 })
    expect(shell.volume).toBeCloseTo(wall, -1)
  })

  it('makes a twin alone with a sketch’s inset, takes it again in place, and refuses the recipe without a station to copy', async () => {
    await firstStation()
    const twin = await run<{ inset: { by: number; moved: number; kept: number[] } }>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Twin', plane: plane(5), sketch: { inset: { of: 'Wing 1', by: 2 } } } })
    expect(twin.inset).toMatchObject({ by: 2, kept: [50] })
    expect((await refused('reverse.feature.add', { feature: { kind: 'loft', sections: [plane(15), plane(25)], fit } })).message).toMatch(/fit\.like names/)
    expect((await refused('reverse.feature.add', { feature: { kind: 'sketch', plane: plane(15), sketch: { fit: { like: 'Wing 1', arcs: 2 } } } })).message).toMatch(/leave arcs and spline out/)
    // Taken again in place, from the station as it stands.
    expect((await run<{ inset: { by: number; kept: number[] } }>('reverse.feature.update', { feature: 'Twin', set: { sketch: { inset: { of: 'Wing 1', by: 1 } } } })).inset).toMatchObject({ by: 1, kept: [50] })
  })
})
