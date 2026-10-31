// SPDX-License-Identifier: AGPL-3.0-only
// Round 19's V3: a build that does not finish, stopped. The worker tells
// each step before it plays it, and the kernel call it makes; a wait for
// the build stops it at its limit, and reverse.build.stop at once — the
// kernel let go and started again, the feature in play suppressed, the
// part built without it, and a change taken straight after. A step that
// crashed the kernel is kept by the page, so a fresh worker does not play
// it again. A wasm call that never returns is stood in for by a transport
// that never answers a build with a step named "Stuck" in it, telling the
// step and its call first, as the worker does.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../../src/commands/registry'
import { sessionBusy } from '../../../src/commands/host'
import { refused, run, startHeadless, type Headless } from '../../../tests/commandKit'
import { addRectangle } from '../core/sketch'
import { ReKernel } from '../core/kernel'
import type { ReWorkerEvent } from '../core/reEvents'
import { ReClient, type ReTransport } from '../core/reClient'
import { createReService, type ReWorkerRequest, type ReWorkerResponse } from '../core/reService'
import { resolveFeatures } from '../core/resolve'
import { findRegions } from '../core/regions'
import type { Feature, FilletFeature, SketchFeature } from '../core/features'
import { Builder } from '../core/build'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { extrudeAll, sketchOf } from './reKit'
import { loadManifold, localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 120_000 })

/** The kernel in this thread, but a build with a step named "Stuck" is
 *  never answered: the worker tells the step and its call, then nothing
 *  more — as a wasm call that never returns leaves it. One with "Hangs
 *  after" hangs past its last step, meshing; one with "Hangs before",
 *  before its first, saying nothing. Let go, it answers nothing at all. */
function hanging(): ReTransport {
  const inner = localKernel()
  const transport: ReTransport = {
    onFailure: null,
    onEvent: null,
    request<T>(msg: { requestId: number }, transfer: Transferable[], limitMs?: number): Promise<T> {
      const m = msg as ReWorkerRequest
      const named = (name: string) => (m.type === 'build' ? m.steps.find((s) => 'name' in s && s.name === name) : undefined)
      if (m.type === 'build' && named('Hangs after')) {
        for (const s of m.steps) transport.onEvent?.({ event: 'step', requestId: m.requestId, id: s.id })
        transport.onEvent?.({ event: 'step', requestId: m.requestId, id: null })
        transport.onEvent?.({ event: 'call', requestId: m.requestId, what: 'Tessellating the body' })
        return new Promise<T>(() => {})
      }
      if (named('Hangs before')) return new Promise<T>(() => {})
      const stuck = named('Stuck')
      if (stuck) {
        transport.onEvent?.({ event: 'step', requestId: m.requestId, id: stuck.id })
        transport.onEvent?.({ event: 'call', requestId: m.requestId, what: 'Splitting' })
        return new Promise<T>(() => {})
      }
      return inner.request<T>(msg, transfer, limitMs)
    },
    dispose() {
      inner.dispose()
    },
  }
  inner.onEvent = (e) => transport.onEvent?.(e)
  return transport
}

const rectangle = (name: string) => ({ kind: 'sketch', name, plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [30, 20], fixed: true }] } })
const slab = (name: string, from: number, to: number) => ({ kind: 'extrude', name, sketchId: 'Outline', regions: 'all', extent: { kind: 'distance', from, to }, op: 'new' })

let headless: Headless
let kernels = 0
const stops: (() => void)[] = []

/** A session over the hanging kernel, its waits stopping a step at
 *  `limitMs`, installed for the commands. */
async function sessionWith(limitMs: number): Promise<ReverseSession> {
  for (const stop of stops.splice(0)) stop()
  const session = createReverseSession({
    sceneRef: { current: null },
    kernel: () => {
      kernels++
      return new ReClient(hanging())
    },
    limitMs,
  })
  stops.push(installReverseSession(session), session.watch())
  await session.startKernel()
  return session
}

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(() => {
  resetReverse()
  kernels = 0
})

const stuck = () => useReverse.getState().features.find((f) => f.name === 'Stuck')
const volume = () => useReverse.getState().bodies.reduce((v, b) => v + b.volume, 0)

describe('V3: a build stopped', () => {
  it('at the limit of a wait: the kernel started again, the step suppressed, the part built without it, a change taken straight after', async () => {
    const session = await sessionWith(1500)
    await run('reverse.feature.add', { feature: rectangle('Outline') })
    await run('reverse.feature.add', { feature: slab('Plate', 0, 5) })
    expect(volume()).toBeCloseTo(30 * 20 * 5, 6)
    expect(kernels).toBe(1)

    const e = await refused('reverse.feature.add', { feature: slab('Stuck', 10, 12) })
    expect(e.code).toBe('failed')
    expect(e.message).toMatch(/^Stuck \(step 3, Splitting\) did not finish in [12] s: the CAD kernel was stopped and started again, and the part built without it — Stuck is suppressed\./)
    expect(e.message).toContain('reverse.feature.update { feature: "Stuck", set: { suppressed: false } }')
    expect(kernels).toBe(2)
    expect(stuck()?.suppressed).toBe(true)
    // Built without it, and idle: a change goes straight in.
    expect(session.buildState()).toBe('built')
    expect(session.busy()).toBeNull()
    expect(volume()).toBeCloseTo(30 * 20 * 5, 6)
    const removed = await run<{ removed: { name: string } }>('reverse.feature.remove', { feature: 'Stuck' })
    expect(removed.removed.name).toBe('Stuck')
    const more = await run<{ result: { status: string } }>('reverse.feature.add', { feature: slab('Top', 5, 8) })
    expect(more.result.status).toBe('ok')
    expect(volume()).toBeCloseTo(30 * 20 * 8, 6)
    expect(kernels).toBe(2)
  })

  it('at the limit with no step in play: stopped once, the part left unbuilt saying where, and no stop after it; a change builds again', async () => {
    const session = await sessionWith(1000)
    await run('reverse.feature.add', { feature: rectangle('Outline') })
    await run('reverse.feature.add', { feature: slab('Plate', 0, 5) })
    const t = Date.now()
    const e = await refused('reverse.feature.add', { feature: slab('Hangs after', 10, 12) })
    expect(e.code).toBe('failed')
    expect(e.message).toMatch(/^The build did not finish in [12] s, after its last step \(the kernel was tessellating the body\)\. No step was in play to suppress, so the CAD kernel was started again and the part left unbuilt/)
    expect(Date.now() - t).toBeLessThan(5000)
    expect(kernels).toBe(2)
    expect(useReverse.getState().features.some((f) => f.suppressed)).toBe(false)
    // Idle, the build failed whole saying so; not built again, nor stopped
    // again at the next wait's limit.
    expect(session.busy()).toBeNull()
    expect(session.buildState()).toBe('built')
    expect(useReverse.getState().buildError).toMatch(/left unbuilt/)
    await session.settled()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(kernels).toBe(2)
    // A change builds the part again.
    await run('reverse.feature.remove', { feature: 'Hangs after' })
    expect(useReverse.getState().buildError).toBeNull()
    expect(volume()).toBeCloseTo(30 * 20 * 5, 6)
    // Before its first step, the kernel saying nothing.
    const before = await refused('reverse.feature.add', { feature: slab('Hangs before', 10, 12) })
    expect(before.message).toMatch(/^The build did not finish in [12] s, before its first step\. No step was in play to suppress/)
    expect(kernels).toBe(3)
    expect(session.busy()).toBeNull()
  })

  it('asked for: at once, beside the change waiting on the build — what the session is busy with names the step', async () => {
    const session = await sessionWith(600_000)
    await run('reverse.feature.add', { feature: rectangle('Outline') })
    await run('reverse.feature.add', { feature: slab('Plate', 0, 5) })
    const waiting = runCommand('reverse.feature.add', { feature: slab('Stuck', 10, 12) }).then(
      () => null,
      (e: unknown) => e as { code: string; message: string },
    )
    await vi.waitFor(() => expect(session.playing()?.step).toMatchObject({ name: 'Stuck' }), { timeout: 10_000 })
    // The busy sentence names the step in play, its place and its call.
    expect(session.busy()).toMatch(/^the CAD kernel is building the bodies: Stuck \(step 3, Splitting\), \d+ s so far$/)
    expect(sessionBusy()).toBe(session.busy())
    const state = await run<{ busy: string | null }>('session.state')
    expect(state.busy).toMatch(/Stuck \(step 3, Splitting\)/)

    const out = await run<{ stopped: { feature: string; step: number; call: string; seconds: number }; message: string; bodies: { count: number } }>('reverse.build.stop')
    expect(out.stopped).toMatchObject({ feature: 'Stuck', step: 3, call: 'Splitting' })
    expect(out.message).toMatch(/^Stuck \(step 3, Splitting\) was stopped after \d+ s: the CAD kernel was stopped and started again, and the part built without it — Stuck is suppressed\./)
    expect(out.bodies.count).toBe(1)
    // The change that waited answers what the stop said.
    const e = await waiting
    expect(e?.code).toBe('failed')
    expect(e?.message).toMatch(/^Stuck \(step 3, Splitting\) was stopped after/)
    expect(stuck()?.suppressed).toBe(true)
    expect(kernels).toBe(2)
    expect(session.busy()).toBeNull()
    // The stop's suppression is the change's undo step: undone, Stuck goes.
    await run('history.undo')
    await session.settled()
    expect(stuck()).toBeUndefined()
    expect(volume()).toBeCloseTo(30 * 20 * 5, 6)
    // With nothing building, nothing to stop.
    expect((await run<{ stopped: null }>('reverse.build.stop')).stopped).toBeNull()
    expect(kernels).toBe(2)
  })

  it('before a change that throws the work away: the build stopped, nothing suppressed, the next build held till the change has run', async () => {
    const session = await sessionWith(600_000)
    await run('reverse.feature.add', { feature: rectangle('Outline') })
    await run('reverse.feature.add', { feature: slab('Plate', 0, 5) })
    const waiting = runCommand('reverse.feature.add', { feature: slab('Stuck', 10, 12) }).catch(() => null)
    await vi.waitFor(() => expect(session.playing()?.step).toMatchObject({ name: 'Stuck' }), { timeout: 10_000 })
    let ran = false
    let finish!: () => void
    const done = new Promise<void>((resolve) => (finish = resolve))
    await session.stop('discard', done.then(() => (ran = true)))
    expect(kernels).toBe(2)
    expect(stuck()?.suppressed).toBeUndefined()
    // The work goes: the list cleared while the next build is held.
    useReverse.getState().clearFeatures()
    expect(session.playing()).toBeNull()
    finish()
    await waiting
    await session.settled()
    expect(ran).toBe(true)
    expect(useReverse.getState().bodies).toHaveLength(0)
  })
})

/** A plate and a round on one of its upright corners. */
async function plate(radius: number): Promise<Feature[]> {
  const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
  const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new')]
  const probe = new Builder(await ReKernel.load())
  const r = request(base)
  probe.build(r.steps, r.sketchOf)
  const corner = probe.topologyOf(2)!.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99)!
  probe.dispose()
  return [...base, { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius, visible: true } as FilletFeature]
}

function request(features: Feature[]) {
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch] as [number, typeof f.sketch])
  const byId = new Map(sketches)
  return { steps, sketches, sketchOf: (id: number) => byId.get(id) }
}

describe('V3: what the kernel tells while it builds', () => {
  it('each step before it is played, null once they are, and the kernel calls in between', async () => {
    const heard: ReWorkerEvent[] = []
    const service = createReService(() => ReKernel.load(), loadManifold, undefined, (e) => heard.push(e))
    const r = request(await plate(2))
    const { response } = await service.handle({ type: 'build', requestId: 7, steps: r.steps, sketches: r.sketches })
    expect(response.type).toBe('build-ok')
    const steps = heard.filter((e) => e.event === 'step').map((e) => (e.event === 'step' ? e.id : undefined))
    expect(steps).toEqual([...r.steps.map((s) => s.id), null])
    expect(heard.every((e) => e.requestId === 7)).toBe(true)
    // The calls of a step come after it is told.
    const calls = (id: number) => {
      const from = heard.findIndex((e) => e.event === 'step' && e.id === id)
      const to = heard.findIndex((e, i) => i > from && e.event === 'step')
      return heard.slice(from + 1, to).flatMap((e) => (e.event === 'call' ? [e.what] : []))
    }
    expect(calls(2)).toContain('Extruding')
    expect(calls(3)).toContain('Filleting')
    // A run of one call is told once a second at most, not each time.
    expect(heard.length).toBeLessThan(200)
    // Built again unchanged, no step is played, and none is told.
    heard.length = 0
    await service.handle({ type: 'build', requestId: 8, steps: r.steps, sketches: r.sketches })
    expect(heard.filter((e) => e.event === 'step')).toEqual([])
  })

  it('a step the kernel crashed on is kept by the page: a fresh worker, after a stop, does not play it again', async () => {
    let traps = 0
    // A kernel whose round traps every time.
    const load = async () => {
      const k = await ReKernel.load()
      const raw = (k as unknown as { occt: Record<string, (...a: unknown[]) => unknown> }).occt
      raw.filletWithHistory = () => {
        traps++
        throw new WebAssembly.RuntimeError('unreachable')
      }
      return k
    }
    const r = request(await plate(2))
    const sketches = new Map(r.sketches)
    const first = new ReClient(localKernel(load))
    const a = await first.build(r.steps, sketches)
    expect(a!.results.find((x) => x.id === 3)?.message).toMatch(/^The CAD kernel crashed on this step/)
    expect(first.crashed.size).toBe(1)
    const trapped = traps
    // The worker let go, a new one started, handed the page's own.
    const second = new ReClient(localKernel(load))
    for (const [key, why] of first.crashed) second.crashed.set(key, why)
    const b = await second.build(r.steps, sketches)
    expect(traps).toBe(trapped)
    expect(b!.results.find((x) => x.id === 3)?.message).toMatch(/^The CAD kernel crashed on this step/)
    expect(b!.results.find((x) => x.id === 2)?.status).toBe('ok')
    first.dispose()
    second.dispose()
  })

  it('the client names the step in play from what the worker told, and forgets it once answered', async () => {
    let answer!: (r: ReWorkerResponse) => void
    const transport: ReTransport = {
      onFailure: null,
      onEvent: null,
      request<T>(): Promise<T> {
        return new Promise<T>((resolve) => (answer = resolve as unknown as (r: ReWorkerResponse) => void))
      },
      dispose() {},
    }
    const client = new ReClient(transport)
    const r = request(await plate(2))
    expect(client.playing()).toBeNull()
    const built = client.build(r.steps, new Map(r.sketches))
    // Asked for, and not yet at a step.
    expect(client.playing()).toMatchObject({ step: null, call: null })
    const requestId = 1
    transport.onEvent!({ event: 'step', requestId, id: 2 })
    transport.onEvent!({ event: 'call', requestId, what: 'Extruding' })
    // A helper's step started later: the one in play the longest is said.
    await new Promise((resolve) => setTimeout(resolve, 5))
    transport.onEvent!({ event: 'step', requestId, id: 3, helper: 1 })
    expect(client.playing()).toMatchObject({ step: { id: 2 }, call: 'Extruding' })
    transport.onEvent!({ event: 'step', requestId, id: null })
    expect(client.playing()).toMatchObject({ step: { id: 3 }, call: null })
    answer({ type: 'skipped', requestId })
    expect(await built).toBeNull()
    expect(client.playing()).toBeNull()
  })
})
