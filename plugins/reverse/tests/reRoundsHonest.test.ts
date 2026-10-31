// SPDX-License-Identifier: AGPL-3.0-only
// Rounds that read and fail honestly. A round larger than the default
// reach is read by widening the reach, not answered as a sharp corner; a
// reach given holds, and says so. A round or a chamfer is made on a copy
// of its body, so one the kernel gives up on never leaves the body
// changed for the failure to blame the step before; reverse.body.check
// reads the body as it stood before a feature. A round's picks say which
// edges the kernel's tangent chain takes with them.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// The command kit first: the app's command modules import one another
// round in a circle that starts there.
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { sliceMesh } from '../../../src/core/section/slice'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { readEdgeOf, readEdgeRound } from '../app/reFilletRead'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { Builder } from '../core/build'
import type { BuiltBody } from '../core/buildTypes'
import type { KernelMesh, Shape } from '../core/kernelTypes'
import { HASH_BOUND } from '../core/kernelOps'
import type { Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { ReClient } from '../core/reClient'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import plugin from '../plugin'
import { build as buildOn, ctx, extrudeAll, rectangleSketch, sketchOf } from './reKit'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** The XZ plane, seen from −Y: a profile drawn here turns about Z. */
const XZ: SectionFrame = { origin: [0, 0, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] }

/** A dome R150 from r 80 at z 10 up to a boss r 25, the boss to z 60:
 *  the boss's foot a circle between a sphere and a cylinder, concave. */
const RS = 150
const ZC = 10 - Math.sqrt(RS * RS - 80 * 80)
const Z1 = ZC + Math.sqrt(RS * RS - 25 * 25)
const A0 = Math.atan2(10 - ZC, 80)
const A1 = Math.atan2(Z1 - ZC, 25)
const R = 20

function part(): Feature[] {
  const s = emptySketch()
  addEntity(s, { kind: 'line', a: [6, 0], b: [80, 0] })
  addEntity(s, { kind: 'line', a: [80, 0], b: [80, 10] })
  addEntity(s, { kind: 'arc', c: [0, ZC], r: RS, start: A0, sweep: A1 - A0 })
  addEntity(s, { kind: 'line', a: [25, Z1], b: [25, 60] })
  addEntity(s, { kind: 'line', a: [25, 60], b: [6, 60] })
  addEntity(s, { kind: 'line', a: [6, 60], b: [6, 0] })
  return [
    { id: 1, kind: 'sketch', name: 'Profile', plane: { kind: 'world', axis: 'y', offset: 0 }, frame: XZ, sketch: s, visible: true },
    { id: 2, kind: 'revolve', name: 'Part', sketchId: 1, regions: findRegions(s).map((r) => r.key), axis: { kind: 'world', axis: 'z' }, angleDeg: 360, op: 'new', visible: true },
  ]
}

async function build(features: Feature[]): Promise<{ body: BuiltBody; fine: KernelMesh; ok: boolean; messages: string[] }> {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, ctx, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  const result = builder.build(steps, (id) => sketches.get(id))
  const fine = builder.meshById(2, 0.01)!.mesh
  builder.dispose()
  return { body: result.bodies[0], fine, ok: result.results.every((r) => r.status === 'ok'), messages: result.results.map((r) => r.message ?? '') }
}

/** The boss's foot: the circle edge at z ≈ Z1. */
const footOf = (body: BuiltBody) => body.topology.edges.filter((e) => e.fingerprint.kind === 'circle' && Math.abs(e.fingerprint.mid[2] - Z1) < 0.5 && Math.abs((e.fingerprint.radius ?? 0) - 25) < 0.5)

/** A kernel mesh with a little noise, as a scan. */
function noisy(mesh: KernelMesh, noise: number) {
  let seed = 11
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const p = new Float32Array(mesh.positions)
  for (let i = 0; i < p.length; i++) p[i] += (2 * rand() - 1) * noise
  return { positions: p, indices: mesh.indices }
}

const sectionOf = (mesh: { positions: Float32Array; indices: Uint32Array }) => async (origin: Vec3, normal: Vec3) => sliceMesh(mesh.positions, mesh.indices, origin, normal)

/** The part with its foot rounded R20 by the kernel, as a scan. */
let scanned: Promise<{ positions: Float32Array; indices: Uint32Array }> | null = null
function scan() {
  scanned ??= (async () => {
    const sharp = await build(part())
    const foot = footOf(sharp.body)
    expect(foot).toHaveLength(1)
    const rounded = await build([...part(), { id: 3, kind: 'fillet', name: 'Foot', body: 2, edges: [foot[0].fingerprint], radius: R, chain: true, visible: true }])
    expect(rounded.ok, rounded.messages.join('; ')).toBe(true)
    return noisy(rounded.fine, 0.015)
  })()
  return scanned
}

describe('a round larger than the default reach', () => {
  it('reads R20 at a boss’s foot on a dome, the reach widened; held to a reach, says none within it', async () => {
    const sharp = await build(part())
    expect(sharp.ok).toBe(true)
    const s = await scan()
    // The default reach, 5 % of the part's size: well under the round.
    const p = s.positions
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], p[i + k])), (hi[k] = Math.max(hi[k], p[i + k]))
    const reach = Math.max(3, 0.05 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))
    expect(reach).toBeLessThan(R)
    const edge = readEdgeOf(footOf(sharp.body)[0], sharp.body.topology, sharp.body.mesh)
    // Held to the reach, as a reach given holds it: no round within it,
    // said so — not "a sharp corner".
    const held = await readEdgeRound(sectionOf(s), edge, { reach })
    expect(held.round).toBeNull()
    expect(held.why).toMatch(/^no round within [\d.]+ mm \(reach\)/)
    expect(held.why).toMatch(/larger reach/)
    // Widened, as by default: R20 at every place, and the reach that read.
    const read = await readEdgeRound(sectionOf(s), edge, { reach, widen: true })
    expect(read.why).toBeUndefined()
    expect(read.radii.every((r) => r !== null)).toBe(true)
    expect(Math.abs(read.round!.radius - R)).toBeLessThan(0.1)
    expect(read.round!.nominal).toBe(R)
    expect(read.reach).toBeGreaterThan(reach)
  })
})

describe('a round made on a copy of its body', () => {
  /** A 60 × 40 × 10 block with a Ø16 boss 30 tall on it. */
  const bossed = (): Feature[] => {
    const plan = rectangleSketch(1, 60, 40)
    const circle = sketchOf(3, (s) => addEntity(s, { kind: 'circle', c: [30, 20], r: 8 }))
    return [plan, extrudeAll(2, plan, 0, 10), circle, extrudeAll(4, circle, 0, 30, 'join')]
  }

  it('leaves the body as it stood, rounds the edges asked, and traces the faces to the body’s', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    const out = await buildOn(builder, bossed())
    expect(out.results.every((r) => r.status === 'ok')).toBe(true)
    const solid = builder.body(2)!
    const faces = k.faceHashes(solid)
    const occt = (k as unknown as { occt: { subShapeHashes(s: Shape, t: 'edge', b: number): number[] } }).occt
    const edges = occt.subShapeHashes(solid, 'edge', HASH_BOUND)
    const foot = out.bodies[0].topology.edges.find((e) => e.fingerprint.kind === 'circle' && Math.abs(e.fingerprint.mid[2] - 10) < 1e-6)!
    expect(edges).toContain(foot.hash)
    const before = k.volume(solid)
    // Too large: refused, the body as it stood.
    expect(() => k.filletTracked(solid, [foot.hash], 40)).toThrow()
    expect(k.isValid(solid)).toBe(true)
    expect(k.faceHashes(solid)).toEqual(faces)
    expect(k.volume(solid)).toBeCloseTo(before, 6)
    // R2 at the boss's foot, concave: material added, and every face of
    // the body traced.
    const made = k.filletTracked(solid, [foot.hash], 2)
    expect(k.isClosedSolid(made.shape)).toBe(true)
    expect(k.volume(made.shape)).toBeGreaterThan(before)
    for (const h of made.history.keys()) expect(faces).toContain(h)
    expect(faces.every((h) => made.history.has(h))).toBe(true)
    k.release(made.shape)
    // The same through the chamfer, at the boss's top rim.
    const top = out.bodies[0].topology.edges.find((e) => e.fingerprint.kind === 'circle' && Math.abs(e.fingerprint.mid[2] - 30) < 1e-6)!
    const bevel = k.chamferTracked(solid, [top.hash], 1)
    expect(k.volume(bevel.shape)).toBeLessThan(before)
    k.release(bevel.shape)
    builder.dispose()
  })

  it('a round the kernel gives up on, leaving what it worked on broken, does not blame the step before', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    // The kernel as it failed on the scooter: the round refused, the shape
    // it was handed left failing the check.
    const occt = (k as unknown as { occt: Record<string, unknown> }).occt
    const fillet = occt.filletWithHistory
    const isValid = k.isValid
    const broken = new Set<number>()
    occt.filletWithHistory = (solid: number) => {
      broken.add(solid)
      throw new Error('filletWithHistory: operation failed')
    }
    k.isValid = (shape: Shape) => !broken.has(shape) && isValid.call(k, shape)
    try {
      const plan = bossed()
      const out = await buildOn(builder, plan)
      const foot = out.bodies[0].topology.edges.find((e) => e.fingerprint.kind === 'circle' && Math.abs(e.fingerprint.mid[2] - 10) < 1e-6)!
      const round = await buildOn(builder, [...plan, { id: 5, kind: 'fillet', name: 'Foot round', body: 2, edges: [foot.fingerprint], radius: 2, chain: true, visible: true }])
      const failed = round.results.find((r) => r.id === 5)!
      expect(failed.status).toBe('failed')
      // The kernel worked on a copy; the body handed to the round passes.
      expect(broken.size).toBeGreaterThan(0)
      expect(k.isValid(builder.body(2)!)).toBe(true)
      expect(failed.message).not.toMatch(/already fails the kernel check/)
      expect(failed.message).not.toMatch(/last changed by/)
    } finally {
      occt.filletWithHistory = fillet
      k.isValid = isValid
      builder.dispose()
    }
  })
})

describe('through the commands', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []

  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    await run('scan.open', { bytes: stlBytes(soupOf(await scan())), name: 'dome.stl', discard: true })
    resetReverse()
  }, 180_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless?.stop()
  })

  interface Edge { index: number; kind: string; radius?: number; mid: Vec3 }
  const edgesOf = async (body: string) => (await run<{ bodies: { edgeList: Edge[] }[] }>('reverse.body.describe', { body })).bodies[0].edgeList

  it('reads the R20 foot with a default call, fits a fillet’s radius to it, and holds a reach given', async () => {
    // On the world Y plane u = Z, v = X: the profile as (z, r).
    const arc = (a: number): [number, number] => [ZC + RS * Math.sin(a), RS * Math.cos(a)]
    const [p0, p1] = [arc(A0), arc(A1)]
    const entities = [
      { id: 1, kind: 'line', a: [0, 6], b: [0, 80] },
      { id: 2, kind: 'line', a: [0, 80], b: p0 },
      { id: 3, kind: 'arc', c: [ZC, 0], r: RS, start: Math.PI / 2 - A1, sweep: A1 - A0 },
      { id: 4, kind: 'line', a: p1, b: [60, 25] },
      { id: 5, kind: 'line', a: [60, 25], b: [60, 6] },
      { id: 6, kind: 'line', a: [60, 6], b: [0, 6] },
    ]
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Profile', plane: { kind: 'world', axis: 'y' }, sketch: { entities } } })
    const made = await run<{ result?: { status: string; message?: string } }>('reverse.feature.add', { feature: { kind: 'revolve', name: 'Part', sketchId: 'Profile', regions: 'all', axis: { kind: 'world', axis: 'z' }, angleDeg: 360, op: 'new' } })
    expect(made.result?.status, made.result?.message).toBe('ok')
    const foot = (await edgesOf('Part')).find((e) => e.kind === 'circle' && Math.abs(e.mid[2] - Z1) < 0.5 && Math.abs((e.radius ?? 0) - 25) < 0.5)!
    expect(foot).toBeDefined()
    const read = await run<{ edges: { round: boolean; radius: number; reach?: number; why?: string }[] }>('reverse.body.fillet_read', { body: 'Part', edges: [foot.index] })
    expect(read.edges[0].why).toBeUndefined()
    expect(Math.abs(read.edges[0].radius - R)).toBeLessThan(0.1)
    expect(read.edges[0].reach).toBeGreaterThan(R)
    const held = await run<{ edges: unknown[]; sharp: { edges: number[]; why: string } }>('reverse.body.fillet_read', { body: 'Part', edges: [foot.index], reach: 10 })
    expect(held.edges).toEqual([])
    expect(held.sharp.edges).toEqual([foot.index])
    expect(held.sharp.why).toMatch(/^no round within 10 mm \(reach\)/)
    // The fillet's "fit": widened the same, and held by a reach given.
    expect((await refused('reverse.feature.add', { feature: { kind: 'fillet', name: 'Held', body: 'Part', edges: [foot.index], radius: 'fit', reach: 10 } })).message).toMatch(/no round within 10 mm \(reach\)/)
    const fitted = await run<{ feature: { status: string }; fitted: { radius: { value: number; reach?: number } } }>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Foot', body: 'Part', edges: [foot.index], radius: 'fit' } })
    expect(fitted.feature.status).toBe('ok')
    expect(Math.abs(fitted.fitted.radius.value - R)).toBeLessThan(0.1)
    expect(fitted.fitted.radius.reach).toBeGreaterThan(R)
  })

  it('a round’s picks name the edges its tangent chain takes too; the check reads a feature’s input', async () => {
    resetReverse()
    // A stadium 20 × 10 extruded 5: its top outline one tangent chain of
    // two lines and two half circles.
    const entities = [
      { id: 1, kind: 'line', a: [-10, -5], b: [10, -5] },
      { id: 2, kind: 'arc', c: [10, 0], r: 5, start: -Math.PI / 2, sweep: Math.PI },
      { id: 3, kind: 'line', a: [10, 5], b: [-10, 5] },
      { id: 4, kind: 'arc', c: [-10, 0], r: 5, start: Math.PI / 2, sweep: Math.PI },
    ]
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Stadium', plane: { kind: 'world', axis: 'z' }, sketch: { entities } } })
    const slab = await run<{ result?: { status: string; message?: string } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Slab', sketchId: 'Stadium', regions: 'all', extent: { kind: 'distance', from: 0, to: 5 }, op: 'new' } })
    expect(slab.result?.status, slab.result?.message).toBe('ok')
    const edges = await edgesOf('Slab')
    const front = edges.find((e) => e.kind === 'line' && Math.abs(e.mid[1] + 5) < 1e-6 && Math.abs(e.mid[2] - 5) < 1e-6)!
    const others = edges.filter((e) => e !== front && Math.abs(e.mid[2] - 5) < 1e-6)
    expect(others).toHaveLength(3)
    const round = await run<{ result?: { status: string; message?: string }; picked: { adds?: number; edges?: number[]; mids?: Vec3[]; note?: string }[] }>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Rim', body: 'Slab', edges: [front.index], radius: 1 } })
    expect(round.result?.status, round.result?.message).toBe('ok')
    const adds = round.picked.find((p) => p.adds !== undefined)!
    expect(adds.adds).toBe(3)
    expect(new Set(adds.edges)).toEqual(new Set(others.map((e) => e.index)))
    expect(adds.mids).toHaveLength(3)
    expect(adds.note).toMatch(/rounds each tangent chain whole/)
    // A round too large for the slab fails; its input passes the check,
    // read as it stood before the round.
    const big = await run<{ result?: { status: string; message?: string } }>('reverse.feature.update', { feature: 'Rim', set: { radius: 8 } })
    expect(big.result?.status).toBe('failed')
    expect(big.result?.message).not.toMatch(/already fails the kernel check/)
    const checked = await run<{ bodies: { before?: { name: string }; valid: boolean; closed: boolean; faces: number }[] }>('reverse.body.check', { before: 'Rim', audit: false })
    expect(checked.bodies[0]).toMatchObject({ before: { name: 'Rim' }, valid: true, closed: true })
    expect(checked.bodies[0].faces).toBe(6)
    expect((await refused('reverse.body.check', { before: 'Stadium' })).message).toMatch(/works on no body/)
  })
})
