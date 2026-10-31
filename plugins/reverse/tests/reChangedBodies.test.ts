// SPDX-License-Identifier: AGPL-3.0-only
// The kernel hands the page only the bodies a build made, changed or took
// away: three blocks built one by one, a fillet appended on the middle one,
// the fillet taken back, a block removed — each build's answer counted on
// its way out of the worker's service, as the page's worker would post it,
// and the bodies the build left as they were checked to be the very objects
// the page already held.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import type { BuiltBody } from '../core/build'
import { ReClient, type ReTransport } from '../core/reClient'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

/** Every build answer the service gives, by the bodies it hands over whole
 *  and the bodies it names. */
const answers: { sent: number[]; standing: number[] }[] = []
function counting(inner: ReTransport): ReTransport {
  return {
    get onFailure() { return inner.onFailure },
    set onFailure(f) { inner.onFailure = f },
    dispose: () => inner.dispose(),
    async request<T>(msg: { requestId: number }, transfer: Transferable[]): Promise<T> {
      const res = await inner.request<T>(msg, transfer)
      const r = res as { type?: string; bodies?: BuiltBody[]; all?: { id: number }[] }
      if (r.type === 'build-ok') answers.push({ sent: r.bodies!.map((b) => b.id), standing: r.all!.map((b) => b.id) })
      return res
    },
  }
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(counting(localKernel())) })
  stops.push(installReverseSession(session), session.watch())
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const block = (name: string, x: number) => ({
  features: [
    { kind: 'sketch', name, plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [x, 0], size: [10, 10], fixed: true }] } },
    { kind: 'extrude', sketchId: name, regions: 'all', extent: { kind: 'distance', from: 0, to: 6 }, op: 'new' },
  ],
  detail: 'none',
})

/** The features as they stand built straight through the client. */
async function buildAsItStands() {
  const { useReverse, featuresToBuild } = await import('../state/reStore')
  const { resolveFeatures } = await import('../core/resolve')
  const built = featuresToBuild(useReverse.getState())
  const sketches = new Map(built.flatMap((f) => (f.kind === 'sketch' ? [[f.id, f.sketch] as const] : [])))
  return session.client()!.build(resolveFeatures(built, session.resolveContext(), session.regionsOf), sketches)
}

/** The build that lands after the command, and its answer. */
async function last(name: string, input: unknown) {
  const before = answers.length
  const out = await run(name, input)
  await session.settled()
  expect(answers.length).toBeGreaterThan(before)
  return { out, answer: answers.at(-1)! }
}

describe('changed bodies', () => {
  it('hands over the bodies a build made, changed or took away, and no other', async () => {
    await last('reverse.feature.add', block('A', 0))
    await last('reverse.feature.add', block('B', 30))
    const third = await last('reverse.feature.add', block('C', 60))
    // The third block's build hands over the third block alone.
    expect(third.answer.standing).toHaveLength(3)
    expect(third.answer.sent).toHaveLength(1)
    const [a, b, c] = third.answer.standing
    const meshes = new Map(session.meshes)

    // A fillet appended on B: one body handed over, B; A and C stay the
    // very meshes the page held, so the viewport keeps their blocks.
    const fillet = await last('reverse.feature.add', { feature: { kind: 'fillet', body: b, edges: [0], radius: 1 }, detail: 'none' })
    expect((fillet.out as { status: string }).status).toBe('ok')
    expect(fillet.answer.sent).toEqual([b])
    expect(session.meshes.get(a)).toBe(meshes.get(a))
    expect(session.meshes.get(c)).toBe(meshes.get(c))
    expect(session.meshes.get(b)).not.toBe(meshes.get(b))

    // A build of the same list hands over nothing.
    const sent = answers.length
    const answer = await buildAsItStands()
    expect(answers.slice(sent).map((a) => a.sent)).toEqual([[]])
    expect(answer?.changed).toEqual([])
    expect(answer?.bodies.map((x) => x.mesh)).toEqual([a, b, c].map((id) => session.meshes.get(id)))

    // The fillet taken back: B as it stood is a state looked up — but the
    // page holds the filleted B, so that one body comes again.
    const undone = await last('history.undo', {})
    expect(undone.answer.sent).toEqual([b])
    expect(session.meshes.get(a)).toBe(meshes.get(a))

    // A block removed: nothing to hand over, and the page lets it go.
    const removed = await last('reverse.feature.remove', { feature: 'Extrude 3', detail: 'none' })
    expect(removed.answer.sent).toEqual([])
    expect(removed.answer.standing).toEqual([a, b])
    expect(session.meshes.has(c)).toBe(false)
  })

  it('says what each change’s builds did: a value set back plays nothing', async () => {
    // A block of its own: the kernel still holds the other tests' builds.
    await run('reverse.parameter.add', { name: 'h', expression: '6' })
    const made = (await run('reverse.feature.add', {
      features: [
        { kind: 'sketch', name: 'A', plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [12, 7], fixed: true }] } },
        { kind: 'extrude', sketchId: 'A', regions: 'all', extent: { kind: 'distance', from: 0, to: 6 }, exprs: { 'extent.to': 'h' }, op: 'new' },
        { kind: 'fillet', body: 'Solid 1', edges: [0], radius: 1 },
      ],
      detail: 'none',
    })) as { steps?: { recomputed: number; restored: number } }
    expect(made).not.toHaveProperty('stopped')
    expect(made.steps?.recomputed).toBeGreaterThan(0)
    const taller = (await run('reverse.parameter.set', { parameter: 'h', expression: '9' })) as { steps?: { recomputed: number; restored: number } }
    expect(taller.steps?.recomputed).toBe(2)
    // The extrude and the round played again — and set back, neither.
    const back = (await run('reverse.parameter.set', { parameter: 'h', expression: '6' })) as { steps?: { recomputed: number; restored: number } }
    expect(back.steps).toEqual({ recomputed: 0, restored: 2, played: [] })
    const up = (await run('reverse.feature.rollback', { to: 1, detail: 'none' })) as { steps?: { recomputed: number } }
    expect(up.steps?.recomputed).toBe(0)
    const down = (await run('reverse.feature.rollback', { to: null, detail: 'none' })) as { steps?: { recomputed: number } }
    expect(down.steps?.recomputed).toBe(0)
    // A command that builds nothing says nothing of it.
    expect(await run('reverse.feature.list', {})).not.toHaveProperty('steps')
  })

  it('asks again for a body when an answer came in between its build and its request', async () => {
    // Two builds asked for at once: the first makes the block taller, the
    // second builds it as it stands — asking with what the page held before
    // the first's answer, so the worker leaves the block out as held, and
    // the page, holding the taller one by then, asks for it again.
    await last('reverse.feature.add', block('A', 0))
    const client = session.client()!
    const { useReverse, featuresToBuild } = await import('../state/reStore')
    const { resolveFeatures } = await import('../core/resolve')
    const built = featuresToBuild(useReverse.getState())
    const sketches = new Map(built.flatMap((f) => (f.kind === 'sketch' ? [[f.id, f.sketch] as const] : [])))
    const stepsOf = (features: typeof built) => resolveFeatures(features, session.resolveContext(), session.regionsOf)
    const taller = built.map((f) => (f.kind === 'extrude' ? { ...f, extent: { kind: 'distance' as const, from: 0, to: 9 } } : f))
    const held = session.meshes.values().next().value!
    const sent = answers.length
    const first = client.build(stepsOf(taller), sketches)
    const second = client.build(stepsOf(built), sketches)
    expect(await first).toBeNull()
    const answer = await second
    expect(answers.slice(sent).map((a) => a.sent.length)).toEqual([1, 0])
    expect(answer?.bodies).toHaveLength(1)
    expect(answer?.changed).toHaveLength(1)
    // The block as it stands, 6 high — not the taller one held in between.
    const z = answer!.bodies[0].mesh.positions.filter((_, i) => i % 3 === 2)
    expect(Math.max(...z)).toBeCloseTo(6, 6)
    expect(answer!.bodies[0].mesh.positions.length).toBe(held.positions.length)
  })
})
