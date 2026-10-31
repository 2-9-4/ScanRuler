// SPDX-License-Identifier: AGPL-3.0-only
// Round 19's answers that work the first time (V9) and the list put in
// another order (V6), through the commands: a body named in a batch whose
// build is held, the join an extrude took by default said, a sketch's frame
// on its brief row, measured elements by name in a revolve's, a hole's, an
// extract's axis; features moved in one call, and a sketch moved to
// another plane with the revolve on it keeping its axis line. In the kernel
// in this thread, with no scan — as reUpdateMany.test.ts runs it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../../src/commands/registry'
import type { CylinderFit, FitData } from '../../../src/core/types'
import { useStore, type Element } from '../../../src/state/store'
import { refused, run, startHeadless, undoLabels, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import type { SketchFeature } from '../core/features'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await session.startKernel()
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

type Vec3 = [number, number, number]
interface Body { id: number; name: string; volume: number; bounds: { min: Vec3; max: Vec3 } }
interface Answer { feature: { id: number; name: string; status: string; frame?: { origin: Vec3; normal: Vec3; basisU: Vec3; basisV: Vec3 } }; result: { status: string; message?: string } | null; bodies: { count: number; changed?: Body[] }; op?: string; joined?: string; note?: string; plane?: string; build?: string }

const rect = (name: string, center: [number, number], size: [number, number], plane: unknown = 'XY') => ({ kind: 'sketch', name, plane, sketch: { shapes: [{ kind: 'rectangle', center, size }] } })
const circle = (name: string, c: [number, number], r: number) => ({ kind: 'sketch', name, plane: 'XY', sketch: { entities: [{ kind: 'circle', c, r }] } })
const pad = (name: string, sketchId: string, from: number, to: number, op?: string) => ({ kind: 'extrude', name, sketchId, extent: { kind: 'distance', from, to }, ...(op ? { op } : {}) })

function expectVec(got: readonly number[], want: readonly number[]) {
  for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], 9)
}

const bodies = () => useReverse.getState().bodies
const volume = () => bodies().reduce((v, b) => v + b.volume, 0)
const statuses = () => useReverse.getState().features.filter((f) => f.kind !== 'sketch').map((f) => useReverse.getState().results[f.id]?.status)
/** The body the feature of this name made, by its id. */
const bodyBy = (name: string) => bodies().find((b) => b.id === useReverse.getState().features.find((f) => f.name === name)?.id)!

describe('V9: a body named in a batch whose build is held', () => {
  it('builds a 13-feature batch held to its end whose cuts and combines name the bodies it makes', async () => {
    const batch = [
      rect('Cup sk', [0, 0], [40, 30]),
      pad('Cup raw', 'Cup sk', 0, 20, 'new'),
      // Named by the extrude that will make it, and by the cut on it.
      { kind: 'cutPlane', name: 'Cut WallR', body: 'Cup raw', plane: { kind: 'world', axis: 'x', offset: 15 }, keep: -1 },
      { kind: 'cutPlane', name: 'Cut Top', body: 'Cut WallR', plane: { kind: 'world', axis: 'z', offset: 18 }, keep: -1 },
      circle('Bore sk', [0, 0], 5),
      pad('Bore', 'Bore sk', -1, 30, 'new'),
      { kind: 'boolean', name: 'Bored', op: 'cut', body: 'Cup raw', tool: 'Bore' },
      rect('Flange sk', [0, 18], [30, 10]),
      pad('Flange', 'Flange sk', 0, 3, 'new'),
      rect('Rib sk', [0, 24], [4, 4]),
      pad('Rib', 'Rib sk', 0, 10, 'new'),
      { kind: 'boolean', name: 'Flange+rib', op: 'join', body: 'Flange', tool: 'Rib' },
      // By the id the extrude gives its body: its own.
      { kind: 'boolean', name: 'Cup+Flange', op: 'join', body: 2, tool: 'Flange+rib' },
    ]
    const answers: Record<string, unknown>[] = []
    for (let i = 0; i < batch.length; i++) answers.push((await runCommand('reverse.feature.add', { feature: batch[i], detail: 'none' }, undefined, undefined, i < batch.length - 1)) as Record<string, unknown>)
    expect(answers.slice(0, -1).every((a) => a.build === 'held')).toBe(true)
    expect(session.held()).toBe(false)
    expect(statuses().every((s) => s === 'ok'), JSON.stringify(useReverse.getState().results)).toBe(true)
    expect(bodies().map((b) => b.id)).toEqual([2])
    // The cup cut to 35 × 30 × 18, bored Ø10, with the flange and the rib
    // joined where they overlap it.
    expect(volume()).toBeCloseTo(35 * 30 * 18 - Math.PI * 25 * 18 + (900 - 180) + (160 - 12), 1)
  })

  it('says a join added in the batch is not built yet, where only the build knows its body', async () => {
    await runCommand('reverse.feature.add', { feature: rect('Pad sk', [0, 0], [10, 10]) }, undefined, undefined, true)
    await runCommand('reverse.feature.add', { feature: pad('Pad', 'Pad sk', 0, 5) }, undefined, undefined, true)
    let e: unknown
    try {
      await runCommand('reverse.feature.add', { feature: { kind: 'cutPlane', body: 'Pad', plane: { kind: 'world', axis: 'z', offset: 2 }, keep: -1 } }, undefined, undefined, true)
    } catch (x) {
      e = x
    }
    expect((e as Error).message).toMatch(/Pad was added in this batch and is not built yet: a join takes the id of the oldest body it meets, which only the build knows\. Give it op: "new"/)
    await run('reverse.build')
    // Built, it is found as any body is.
    expect((await run<Answer>('reverse.feature.add', { feature: { kind: 'cutPlane', body: 'Pad', plane: { kind: 'world', axis: 'z', offset: 2 }, keep: -1 } })).result?.status).toBe('ok')
  })
})

describe('V9: a join by default, said', () => {
  it('answers op "join (default)" and what it joined, with the volumes; a new body when it met none', async () => {
    await run('reverse.feature.add', { features: [rect('Base', [0, 0], [20, 20]), pad('Block', 'Base', 0, 10, 'new'), circle('Boss sk', [0, 0], 3)] })
    const boss = await run<Answer>('reverse.feature.add', { feature: pad('Boss', 'Boss sk', 0, 15) })
    expect(boss.op).toBe('join (default)')
    expect(boss.joined).toMatch(/^Solid 1 \(2\): 4000 → 4141\.4 mm³$/)
    await run('reverse.feature.add', { feature: circle('Far sk', [50, 50], 2) })
    const far = await run<Answer>('reverse.feature.add', { feature: pad('Far', 'Far sk', 0, 5), detail: 'none' })
    expect(far.op).toBe('join (default)')
    expect(far.joined).toMatch(/^nothing — it met no body, and is a new body: .* \(\d+\)$/)
    // Asked for, the op is not told back.
    await run('reverse.feature.add', { feature: circle('Pin sk', [-5, -5], 1) })
    const pin = await run<Answer>('reverse.feature.add', { feature: pad('Pin', 'Pin sk', 0, 12, 'join') })
    expect(pin.op).toBeUndefined()
    expect(pin.joined).toBeUndefined()
  })
})

describe('V9: a sketch’s frame on its brief row', () => {
  it('comes with feature.add and sketch.edit, not on the list’s rows', async () => {
    const made = await run<Answer>('reverse.feature.add', { feature: rect('Lid', [0, 0], [10, 6], { kind: 'world', axis: 'z', offset: 5 }) })
    const frame = made.feature.frame!
    expect(Object.keys(frame).sort()).toEqual(['basisU', 'basisV', 'normal', 'origin'])
    expectVec(frame.origin, [0, 0, 5])
    expectVec(frame.normal, [0, 0, 1])
    expectVec(frame.basisU, [1, 0, 0])
    expectVec(frame.basisV, [0, 1, 0])
    const edited = await run<Answer>('reverse.sketch.edit', { sketch: 'Lid', add: { entities: [{ kind: 'circle', c: [0, 0], r: 1 }] } })
    expectVec(edited.feature.frame!.origin, [0, 0, 5])
    const rows = await run<{ features: Record<string, unknown>[] }>('reverse.feature.list')
    expect(rows.features[0].frame).toBeUndefined()
  })
})

describe('V9: measured elements by name', () => {
  const element = (id: number, name: string, fit: FitData): Element => ({ id, kind: fit.kind, name, color: '#123', source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } }, status: 'done', visible: true, fit })
  const axle: CylinderFit = { kind: 'cylinder', center: [0, 0, 0], axis: [0, 0, 1], radius: 2, length: 40, coverage: 360, sigma: 0, usedPoints: 0, regionSize: 0 }
  const bore: CylinderFit = { ...axle, center: [2, 2, 5], radius: 1 }
  let had: Element[]
  beforeEach(() => {
    had = useStore.getState().elements
    const n = useStore.getState().nextId
    useStore.setState({ elements: [element(n, 'Axle', axle), element(n + 1, 'Bore el', bore)], nextId: n + 2 })
  })
  afterEach(() => useStore.setState({ elements: had }))

  it('takes a revolve’s, a hole’s and an extract’s element by its name, as by its id', async () => {
    // On XZ, u = Z and v = X: a ring 3 wide round the axle, 10 long.
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Ring sk', plane: 'XZ', sketch: { shapes: [{ kind: 'rectangle', from: [0, 5], to: [10, 8] }] } } })
    const ring = await run<Answer>('reverse.feature.add', { feature: { kind: 'revolve', name: 'Ring', sketchId: 'Ring sk', axis: { kind: 'element', name: 'Axle' }, op: 'new' } })
    expect(ring.result?.status, ring.result?.message).toBe('ok')
    expect(ring.bodies.changed![0].volume).toBeCloseTo(Math.PI * (64 - 25) * 10, 1)
    const axleId = useStore.getState().elements.find((e) => e.name === 'Axle')!.id
    expect((useReverse.getState().features.find((f) => f.name === 'Ring') as { axis: unknown }).axis).toEqual({ kind: 'element', id: axleId })

    await run('reverse.feature.add', { features: [rect('Base', [0, 0], [20, 20]), pad('Block', 'Base', 0, 10, 'new')] })
    const hole = await run<Answer>('reverse.feature.add', { feature: { kind: 'hole', body: 'Block', axis: { kind: 'element', name: 'bore EL' } } })
    expect(hole.result?.status, hole.result?.message).toBe('ok')
    expect(bodyBy('Block').volume).toBeCloseTo(4000 - Math.PI * 10, 1)

    const pin = await run<Answer>('reverse.feature.add', { feature: { kind: 'extract', name: 'Axle body', element: 'Axle' } })
    expect(pin.result?.status, pin.result?.message).toBe('ok')
    expect(pin.bodies.changed![0].volume).toBeCloseTo(Math.PI * 4 * 40, 0)
    expect((useReverse.getState().features.find((f) => f.name === 'Axle body') as { element: number }).element).toBe(axleId)
    expect((await run<Answer>('reverse.feature.add', { feature: { kind: 'extract', element: axleId } })).result?.status).toBe('ok')

    expect((await refused('reverse.feature.add', { feature: { kind: 'extract', element: 'Nothing' } })).message).toMatch(/There is no element named "Nothing"/)
    // A name in the id: told where it goes.
    expect((await refused('reverse.feature.add', { feature: { kind: 'revolve', sketchId: 'Ring sk', axis: { kind: 'element', id: 'Axle' } } })).message).toMatch(/a name goes in name/)
  })
})

describe('V6: features moved in the list', () => {
  /** A cup hollowed by a cut, then a slab across the hollow, joined. */
  async function cup(): Promise<void> {
    await run('reverse.feature.add', {
      features: [rect('Cup sk', [0, 0], [40, 30]), pad('Cup', 'Cup sk', 0, 20, 'new'), rect('Cavity sk', [0, 0], [30, 20]), pad('Cavity', 'Cavity sk', 2, 20, 'cut'), rect('Lip sk', [0, 0], [36, 4]), pad('Lip slab', 'Lip sk', 5, 8)],
    })
  }
  const order = () => useReverse.getState().features.map((f) => f.name)

  it('puts the slab before the cut in one call, one undo step, as removing and adding it there did', async () => {
    await cup()
    expect(volume()).toBeCloseTo(24000 - 10800 + 360, 3)
    const ids = useReverse.getState().features.map((f) => [f.name, f.id])
    const steps = undoLabels().length
    const out = await run<{ moved: { id: number; name: string; status: string }[]; after: { name: string }; next: { name: string } }>('reverse.feature.move', { features: ['Lip slab', 'Lip sk'], after: 'Cup' })
    expect(out.moved.map((m) => m.name)).toEqual(['Lip sk', 'Lip slab'])
    expect(out.moved.every((m) => m.status === 'ok')).toBe(true)
    expect(out.next.name).toBe('Cavity sk')
    expect(order()).toEqual(['Cup sk', 'Cup', 'Lip sk', 'Lip slab', 'Cavity sk', 'Cavity'])
    // Ids and names as they were.
    expect(useReverse.getState().features.map((f) => [f.name, f.id]).sort()).toEqual(ids.sort())
    expect(undoLabels().length).toBe(steps + 1)
    // The cut now takes the slab's middle with the hollow.
    const moved = volume()
    expect(moved).toBeCloseTo(24000 - 10800, 3)
    // As built by removing it and adding it there again.
    resetReverse()
    await run('reverse.feature.add', { features: [rect('Cup sk', [0, 0], [40, 30]), pad('Cup', 'Cup sk', 0, 20, 'new'), rect('Lip sk', [0, 0], [36, 4]), pad('Lip slab', 'Lip sk', 5, 8), rect('Cavity sk', [0, 0], [30, 20]), pad('Cavity', 'Cavity sk', 2, 20, 'cut')] })
    expect(volume()).toBeCloseTo(moved, 6)
  })

  it('refuses a feature put before what it builds on, or past one that builds on it, and undoes', async () => {
    await cup()
    expect((await refused('reverse.feature.move', { features: ['Lip slab'], after: 'Cup sk' })).message).toMatch(/^Lip slab builds on Lip sk, which would then come after it — move Lip sk with it, or put Lip slab lower\.$/)
    expect((await refused('reverse.feature.move', { features: ['Cup sk'], after: 'Cup' })).message).toMatch(/^Cup builds on Cup sk, which the move puts after it — move Cup with it, or put Cup sk higher\.$/)
    expect((await refused('reverse.feature.move', { features: ['Cup'], after: 'Cup' })).message).toMatch(/after names a feature that is moved/)
    // A round on an edge the cut made comes after the cut.
    await run('reverse.feature.add', { feature: { kind: 'fillet', name: 'Rim round', body: 'Cup', edges: [{ madeBy: 'Cavity', between: [[1, 0, 0], [0, 1, 0]] }], radius: 1 } })
    expect((await refused('reverse.feature.move', { features: ['Rim round'], after: 'Cup' })).message).toMatch(/Rim round builds on Cavity/)
    // Already there: nothing changes, and no undo step.
    const steps = undoLabels().length
    expect((await run<{ moved: unknown[]; already: number }>('reverse.feature.move', { features: ['Cavity'], after: 'Cavity sk' })).already).toBe(1)
    expect(undoLabels().length).toBe(steps)
    await run('reverse.feature.move', { features: ['Lip sk', 'Lip slab'], after: 'Cup' })
    await run('history.undo')
    expect(order()).toEqual(['Cup sk', 'Cup', 'Cavity sk', 'Cavity', 'Lip sk', 'Lip slab', 'Rim round'])
  })

  it('keeps the rollback bar between the features it stood between', async () => {
    await cup()
    await run('reverse.feature.rollback', { after: 'Cavity' })
    await run('reverse.feature.move', { features: ['Lip sk', 'Lip slab'], after: 'Cup' })
    expect(order()).toEqual(['Cup sk', 'Cup', 'Lip sk', 'Lip slab', 'Cavity sk', 'Cavity'])
    expect(useReverse.getState().rolledBack).toEqual([])
  })
})

describe('V6: a sketch moved to another plane', () => {
  const element = (id: number, name: string, fit: FitData): Element => ({ id, kind: fit.kind, name, color: '#123', source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } }, status: 'done', visible: true, fit })
  const axisAt = (x: number): CylinderFit => ({ kind: 'cylinder', center: [x, 0, 0], axis: [0, 0, 1], radius: 1, length: 40, coverage: 360, sigma: 0, usedPoints: 0, regionSize: 0 })
  let had: Element[]
  beforeEach(() => {
    had = useStore.getState().elements
    const n = useStore.getState().nextId
    useStore.setState({ elements: [element(n, 'Axis A', axisAt(0)), element(n + 1, 'Axis B', axisAt(10))], nextId: n + 2 })
  })
  afterEach(() => useStore.setState({ elements: had }))

  it('moves a revolve’s profile to a plane through another axis in one call, the revolve keeping its sketch and its axis line', async () => {
    const radial = (name: string) => ({ kind: 'radial', axis: { kind: 'element', name }, angleDeg: 0 })
    // u out along the radius, v up the axis: a ring 3 to 5 out, 10 tall,
    // revolved about its construction line 42 on the axis.
    await run('reverse.feature.add', {
      feature: { kind: 'sketch', name: 'Prof', plane: radial('Axis A'), sketch: { entities: [{ id: 42, kind: 'line', a: [0, 0], b: [0, 10], construction: true }], shapes: [{ kind: 'rectangle', from: [3, 0], to: [5, 10] }] } },
    })
    const ring = await run<Answer>('reverse.feature.add', { feature: { kind: 'revolve', name: 'Ring', sketchId: 'Prof', axis: { kind: 'sketchLine', entity: 42 }, op: 'new' } })
    expect(ring.result?.status, ring.result?.message).toBe('ok')
    expect(ring.bodies.changed![0].bounds.min[0]).toBeCloseTo(-5, 3)
    const was = useReverse.getState().features.find((f) => f.name === 'Prof') as SketchFeature
    // A fitted piece's slice points, as a fit leaves them.
    useReverse.setState((s) => ({ features: s.features.map((f) => (f.id === was.id && f.kind === 'sketch' ? { ...f, sketch: { ...f.sketch, entities: f.sketch.entities.map((e) => (e.id === 43 ? { ...e, points: [[3, 0], [4, 0], [5, 0]] } : e)) } } : f)) as typeof s.features }))
    const steps = undoLabels().length
    const moved = await run<Answer>('reverse.feature.update', { feature: 'Prof', set: { plane: radial('Axis B') } })
    expect(undoLabels().length).toBe(steps + 1)
    expect(moved.plane).toBe('the plane through Axis B at 0°')
    expectVec(moved.feature.frame!.origin, [10, 0, 0])
    expect(moved.note).toMatch(/^Piece 43 let its slice points go/)
    const now = useReverse.getState().features.find((f) => f.name === 'Prof') as SketchFeature
    // The pieces where they were on the sheet; the revolve on them still.
    expect(now.sketch.entities.map((e) => ({ ...e, points: undefined }))).toEqual(was.sketch.entities.map((e) => ({ ...e, points: undefined })))
    expect(now.sketch.entities.find((e) => e.id === 43)).not.toHaveProperty('points')
    const revolve = useReverse.getState().features.find((f) => f.name === 'Ring') as { sketchId: number; axis: unknown }
    expect(revolve).toMatchObject({ sketchId: was.id, axis: { kind: 'sketchLine', entity: 42 } })
    expect(useReverse.getState().results[(revolve as unknown as { id: number }).id]?.status).toBe('ok')
    const body = bodies()[0]
    expect(body.volume).toBeCloseTo(Math.PI * (25 - 9) * 10, 1)
    const built = await run<{ bodies: Body[] }>('reverse.build')
    expect(built.bodies[0].bounds.min[0]).toBeCloseTo(5, 3)
    expect(built.bodies[0].bounds.max[0]).toBeCloseTo(15, 3)
  })

  it('starts the new frame’s u from the old one, and refuses a face made below the sketch', async () => {
    await run('reverse.feature.add', { features: [rect('Base', [5, 0], [10, 4]), pad('Block', 'Base', 0, 10, 'new')] })
    // XY's u is X; on XZ, where a sketch's u is Z, it stays X.
    const standing = await run<Answer>('reverse.feature.update', { feature: 'Base', set: { plane: 'XZ' } })
    expectVec(standing.feature.frame!.normal, [0, 1, 0])
    expectVec(standing.feature.frame!.basisU, [1, 0, 0])
    expect(bodyBy('Block').volume).toBeCloseTo(400, 6)
    const face = (await run<{ bodies: { faceList: { index: number; kind: string; normal?: Vec3 }[] }[] }>('reverse.body.describe', { body: 'Block', edges: false })).bodies[0].faceList.find((f) => f.kind === 'plane')!
    expect((await refused('reverse.feature.update', { feature: 'Base', set: { plane: { kind: 'bodyFace', body: 'Block', face: face.index } } })).message).toMatch(/is made by Block, below Base — a sketch lies on a face made before it; move Base below Block first/)
  })
})
