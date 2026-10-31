// SPDX-License-Identifier: AGPL-3.0-only
// Rounds read on an edge of any shape (core/curvedEdge.ts, readFreeCut): a
// curved blade standing on a coned dish, the blade's sides arcs about an
// axis off the dish's, so its foot is a free curve in space, neither a line
// nor a circle — a fan wheel's blade root. The scan is the same part with
// the foot rounded R1.1 by the kernel, meshed fine, split to a scan's
// spacing, with noise. Read in cuts placed along each edge's polyline and
// square to it, the faces' traces taken off the sharp body's own mesh, the
// round comes back R1.1 on every edge of the foot — through
// reverse.body.fillet_read's reader, and as a fillet's radius "fit" on a
// body built by commands, and fitted again from the stored edges.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sliceMesh } from '../../../src/core/section/slice'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec2 } from '../../../src/core/flat/types'
import type { Vec3 } from '../../../src/core/types'
import { run, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { readEdgeOf, readEdgeRound } from '../app/reFilletRead'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { Builder } from '../core/build'
import type { BuiltBody } from '../core/buildTypes'
import type { KernelMesh } from '../core/kernelTypes'
import { type CutPoint, traceFromCut } from '../core/curvedEdge'
import type { Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { ReClient } from '../core/reClient'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import plugin from '../plugin'
import { ctx, XY } from './reKit'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** The dish's profile, (radius, height): its top a cone from r 6 at z 9
 *  down to r 40 at z 3. */
const DISH: [number, number][] = [[6, 0], [40, 0], [40, 3], [6, 9]]

/** The blade's plan: a 2.5 mm strip along an arc of R40 about (−30, 0),
 *  its ends half round — from about r 10 to r 32 off the dish's axis,
 *  16 mm tall from the dish's floor. */
const C: [number, number] = [-30, 0]
const A0 = (5 * Math.PI) / 180
const A1 = (52 * Math.PI) / 180
const at = (r: number, a: number): [number, number] => [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]
const BLADE = [
  { kind: 'arc', c: C, r: 41.25, start: A0, sweep: A1 - A0 },
  { kind: 'arc', c: at(40, A1), r: 1.25, start: A1, sweep: Math.PI },
  { kind: 'arc', c: C, r: 38.75, start: A0, sweep: A1 - A0 },
  { kind: 'arc', c: at(40, A0), r: 1.25, start: A0 + Math.PI, sweep: Math.PI },
] as const

const R = 1.1

/** The XZ plane, seen from −Y: the sheet's X the part's X, its Y the
 *  part's Z — a profile drawn here turns about Z. */
const XZ: SectionFrame = { origin: [0, 0, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] }

function wheel(): Feature[] {
  const dish = emptySketch()
  DISH.forEach((a, i) => addEntity(dish, { kind: 'line', a, b: DISH[(i + 1) % DISH.length] }))
  const blade = emptySketch()
  for (const e of BLADE) addEntity(blade, { ...e, c: [...e.c] })
  return [
    { id: 1, kind: 'sketch', name: 'Dish profile', plane: { kind: 'world', axis: 'y', offset: 0 }, frame: XZ, sketch: dish, visible: true },
    { id: 2, kind: 'revolve', name: 'Dish', sketchId: 1, regions: findRegions(dish).map((r) => r.key), axis: { kind: 'world', axis: 'z' }, angleDeg: 360, op: 'new', visible: true },
    { id: 3, kind: 'sketch', name: 'Blade plan', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: blade, visible: true },
    { id: 4, kind: 'extrude', name: 'Blade', sketchId: 3, regions: findRegions(blade).map((r) => r.key), extent: { kind: 'distance', from: 0, to: 16 }, op: 'join', visible: true },
  ]
}

/** The features built, the body, and the body meshed to a chord of a few
 *  microns, as a scan's surface would lie: at the build's own chord a
 *  cone's mesh stands off it by hundredths. */
async function build(features: Feature[]): Promise<{ body: BuiltBody; fine: KernelMesh; ok: boolean }> {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, ctx, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  const result = builder.build(steps, (id) => sketches.get(id))
  const fine = builder.meshById(2, 0.003)!.mesh
  builder.dispose()
  return { body: result.bodies[0], fine, ok: result.results.every((r) => r.status === 'ok') }
}

/** The blade's foot: the edges between the dish's top and the blade, none
 *  of them a line or a circle. */
const rootEdges = (body: BuiltBody) => body.topology.edges.filter((e) => e.fingerprint.kind === 'other')

type Mesh = { positions: Float32Array; indices: Uint32Array }

/**
 * A kernel's mesh made a scan's: welded by position, every edge longer
 * than `max` within `box` split at its middle until none is — whether an
 * edge splits is the edge's alone, so the triangles either side split it
 * alike and the mesh stays whole — and every point moved by up to `noise`
 * each way. The kernel meshes a cone in slivers the length of the cone; a
 * scan has points every few tenths everywhere.
 */
function scanOf(mesh: Mesh, max: number, box: { min: Vec3; max: Vec3 }, noise: number): Mesh {
  const pos: number[] = []
  const index = new Map<string, number>()
  let tris: number[] = []
  for (const v of mesh.indices) {
    const x = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]
    const key = x.map((c) => c.toFixed(4)).join(',')
    let i = index.get(key)
    if (i === undefined) {
      i = pos.length / 3
      pos.push(...x)
      index.set(key, i)
    }
    tris.push(i)
  }
  const point = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
  const inBox = (p: number[]) => p.every((c, k) => c >= box.min[k] && c <= box.max[k])
  for (let pass = 0; pass < 12; pass++) {
    const mids = new Map<string, number>()
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const known = mids.get(key)
      if (known !== undefined) return known
      const pa = point(a)
      const pb = point(b)
      const m = pa.map((c, k) => (c + pb[k]) / 2)
      const split = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) > max && inBox(m)
      const i = split ? pos.length / 3 : -1
      if (split) pos.push(...m)
      mids.set(key, i)
      return i
    }
    const next: number[] = []
    let splits = 0
    for (let t = 0; t < tris.length; t += 3) {
      const v = [tris[t], tris[t + 1], tris[t + 2]]
      const m = [mid(v[0], v[1]), mid(v[1], v[2]), mid(v[2], v[0])]
      const n = m.filter((x) => x >= 0).length
      if (n === 0) {
        next.push(...v)
        continue
      }
      splits++
      if (n === 3) {
        next.push(v[0], m[0], m[2], m[0], v[1], m[1], m[2], m[1], v[2], m[0], m[1], m[2])
        continue
      }
      // Turned so the split edge is the first (one split) or the edge
      // left whole is the last (two).
      const r = n === 1 ? m.findIndex((x) => x >= 0) : (m.findIndex((x) => x < 0) + 1) % 3
      const [a, b, c] = [v[r], v[(r + 1) % 3], v[(r + 2) % 3]]
      const [mab, mbc] = [m[r], m[(r + 1) % 3]]
      if (n === 1) next.push(a, mab, c, mab, b, c)
      else next.push(mab, b, mbc, a, mab, mbc, a, mbc, c)
    }
    tris = next
    if (splits === 0) break
  }
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const p = new Float32Array(pos)
  for (let i = 0; i < p.length; i++) p[i] += (2 * rand() - 1) * noise
  return { positions: p, indices: new Uint32Array(tris) }
}

const sectionOf = (mesh: Mesh) => async (origin: Vec3, normal: Vec3) => sliceMesh(mesh.positions, mesh.indices, origin, normal)

/** The rounded wheel as a scan: split to 0.3 mm about the blade, ±0.015
 *  mm of noise. */
let scanned: Promise<Mesh> | null = null
function scan(): Promise<Mesh> {
  scanned ??= (async () => {
    const sharp = await build(wheel())
    const rounded = await build([...wheel(), { id: 5, kind: 'fillet', name: 'Root', body: 2, edges: rootEdges(sharp.body).map((e) => e.fingerprint), radius: R, chain: true, visible: true }])
    expect(rounded.ok).toBe(true)
    return scanOf(rounded.fine, 0.3, { min: [-14, -2, 2], max: [16, 38, 12] }, 0.015)
  })()
  return scanned
}

describe('a face’s trace off the body’s cut', () => {
  /** Points along a circle through the corner with outward normal m there
   *  and curvature κ, running off along d, with the circle's normals. */
  const along = (kappa: number, m: Vec2, d: Vec2): CutPoint[] =>
    Array.from({ length: 30 }, (_, i) => {
      const s = 0.1 * (i + 1)
      const [sn, cs] = [Math.sin(kappa * s), Math.cos(kappa * s)]
      const k = kappa === 0 ? 0 : 1 / kappa
      const p: Vec2 = kappa === 0 ? [d[0] * s, d[1] * s] : [d[0] * k * sn - m[0] * k * (1 - cs), d[1] * k * sn - m[1] * k * (1 - cs)]
      return { p, n: [d[0] * sn + m[0] * cs, d[1] * sn + m[1] * cs] }
    })

  it('is a line where the face runs straight, a circle of the face’s curvature where it bows', () => {
    const line = traceFromCut(along(0, [1, 0], [0, 1]), [1, 0], 3)!
    expect(line.kind).toBe('line')
    expect(line.d[0]).toBeCloseTo(0, 12)
    expect(line.d[1]).toBe(1)
    // Convex (bowing away from the normal) and concave, either way along.
    for (const [kappa, d] of [[1 / 20, [0, -1]], [-1 / 15, [0, 1]]] as const) {
      const t = traceFromCut(along(kappa, [1, 0], d as Vec2), [1, 0], 3)!
      expect(t.kind).toBe('circle')
      expect(Math.abs(t.r! * Math.abs(kappa) - 1)).toBeLessThan(0.01)
      // The circle passes through the corner, square to m there.
      expect(Math.hypot(t.q![0], t.q![1])).toBeCloseTo(t.r!, 6)
      expect(t.q![1]).toBeCloseTo(0, 9)
      expect(Math.sign(-t.q![0])).toBe(Math.sign(kappa))
    }
  })

  it('takes the way the face runs from its points nearest the corner — not the same face met again past a thin wall', () => {
    const near = along(0, [0, 1], [1, 0])
    const far: CutPoint[] = [2.6, 2.8, 3].map((x) => ({ p: [-x, 0], n: [0, 1] }))
    expect(traceFromCut([...near.slice(0, 8), ...far], [0, 1], 3)!.d[0]).toBe(1)
  })
})

describe('rounds on an edge of any shape', () => {
  it('reads R1.1 at a curved blade’s foot on a coned dish, on every edge of the foot', async () => {
    const sharp = await build(wheel())
    expect(sharp.ok).toBe(true)
    const roots = rootEdges(sharp.body)
    // Two long sides and two half-round ends, all meeting the cone.
    expect(roots).toHaveLength(4)
    const s = await scan()
    for (const e of roots) {
      const read = await readEdgeRound(sectionOf(s), readEdgeOf(e, sharp.body.topology, sharp.body.mesh), { reach: 3 })
      expect(read.why).toBeUndefined()
      expect(read.radii.every((r) => r !== null)).toBe(true)
      expect(Math.abs(read.round!.radius - R)).toBeLessThan(0.04)
      expect(read.round!.nominal).toBe(1)
    }
  })

  it('says to pick an edge of any shape on the body when only its fingerprint is at hand', async () => {
    const sharp = await build(wheel())
    const e = rootEdges(sharp.body)[0]
    const read = await readEdgeRound(sectionOf(await scan()), { fingerprint: e.fingerprint }, { reach: 3 })
    expect(read.round).toBeNull()
    expect(read.why).toMatch(/pick it on the body/)
  })
})

describe('a fillet’s radius fitted on a blade’s foot', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []

  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    await run('scan.open', { bytes: stlBytes(soupOf(await scan())), name: 'wheel.stl', discard: true })
    resetReverse()
  }, 180_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless?.stop()
  })

  it('reads R1.1 on every edge of the foot, fits a fillet’s radius on them, and fits it again from the stored edges', async () => {
    // On the ZX plane u = Z, v = X.
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Dish profile', plane: { kind: 'world', axis: 'y' }, sketch: { shapes: [{ kind: 'polyline', points: DISH.map(([r, z]) => [z, r]), closed: true }] } } })
    const dish = await run<{ bodies: { changed: { id: number }[] } }>('reverse.feature.add', { feature: { kind: 'revolve', name: 'Dish', sketchId: 'Dish profile', regions: 'all', axis: { kind: 'world', axis: 'z' }, angleDeg: 360, op: 'new' } })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Blade plan', plane: { kind: 'world', axis: 'z' }, sketch: { entities: BLADE.map((e, i) => ({ id: i + 1, ...e, c: [...e.c] })) } } })
    const blade = await run<{ result?: { status: string; message?: string } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Blade', sketchId: 'Blade plan', regions: 'all', extent: { kind: 'distance', from: 0, to: 16 }, op: 'join' } })
    expect(blade.result?.status, blade.result?.message).toBe('ok')
    const body = dish.bodies.changed[0].id
    // reverse.body.fillet_read on every edge of the foot, seven places each.
    const read = await run<{ edges: { round: boolean; radius: number; radii: number[] }[]; rounds: number; median: number }>('reverse.body.fillet_read', { body, edges: [{ kind: 'other' }] })
    expect(read.rounds).toBe(4)
    expect(read.edges.every((e) => e.radii.length === 7 && Math.abs(e.radius - R) < 0.04)).toBe(true)
    const round = await run<{ feature: { status: string }; fitted: Record<string, { value: number; sigma: number; nominal: number; readings: unknown[] }> }>('reverse.feature.add', {
      feature: { kind: 'fillet', name: 'Root', body, edges: [{ kind: 'other' }], radius: 'fit' },
    })
    expect(round.feature.status).toBe('ok')
    expect(round.fitted.radius.readings).toHaveLength(4)
    expect(round.fitted.radius.value).toBeGreaterThan(1.0)
    expect(round.fitted.radius.value).toBeLessThan(1.2)
    const again = await run<{ fitted: Record<string, { value: number }> }>('reverse.feature.refit', { feature: 'Root', fields: ['radius'] })
    expect(Math.abs(again.fitted.radius.value - round.fitted.radius.value)).toBeLessThan(1e-6)
  })
})
