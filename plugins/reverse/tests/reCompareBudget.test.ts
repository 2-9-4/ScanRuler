// SPDX-License-Identifier: AGPL-3.0-only
// Answers that keep to what was asked: a feature's comparison as many
// patches, spots and face rows as asked for and no more, the patches and
// spots on the feature's own faces; a feature's visible showing or hiding
// its bodies, and a body's own, which the export and the comparison then
// follow; the stack's chains left out over a length. On a noisy 40 mm box
// scanned in the in-process worker, the kernel in this thread — as
// reCommands.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { filterChains } from '../core/chainOutline'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'

// Kernel builds and real-scan fits run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

type Vec3 = [number, number, number]
interface Body { id: number; name: string; visible: boolean }
interface Brief {
  feature: { id: number; name: string; kind: string; status: string; visible: boolean }
  result: { status: string; message?: string } | null
  bodies: { changed?: Body[] }
  visibility?: { visible: boolean; bodies: { id: number; name: string }[] }
}
type Face = { index: number; kind: string; madeBy?: unknown } | null
interface Patch { side: string; face: Face }
interface FeatureCompare {
  faces: number
  patches: Patch[]
  patchesFound: number
  over: number
  worst?: { at: Vec3; deviation: number; face: Face }[]
  far?: { inside: { patches: Patch[] }; outside: { patches: Patch[] } }
  faceRows: { face: Face }[]
}

// A box the size of the scan, its faces read with 0.3 mm of noise: a
// scatter of small patches over a 0.4 mm tolerance on every face.
const NOISY_BOX = stlBytes(boxMesh(40, 40, 0.3))

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: NOISY_BOX, name: 'noisy box.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

/** A box body `size` across about the origin in X and Y, from `z` up
 *  `height`, by a sketch and an extrude of the given name. */
async function boxBody(name: string, size: number, z: number, height: number) {
  await run<Brief>('reverse.feature.add', { feature: { kind: 'sketch', name: `${name} plate`, plane: { kind: 'world', axis: 'z', offset: z }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [size, size], fixed: true }] } } })
  const made = await run<Brief>('reverse.feature.add', { feature: { kind: 'extrude', name, sketchId: `${name} plate`, regions: 'all', extent: { kind: 'distance', from: 0, to: height }, op: 'new' } })
  expect(made.result?.status, made.result?.message).toBe('ok')
  return made.bodies.changed![0]
}

const visibleIds = () => useReverse.getState().bodies.filter((b) => b.visible).map((b) => b.id)

describe('a feature compared within its budget', () => {
  it('names as many patches, spots and face rows as asked, all on the feature’s faces', async () => {
    // The scan's box, cut back 2 mm at +x by a feature of its own: the
    // worst of the scan there, on the cut's face, not the extrude's.
    const box = await boxBody('Block', 40, -20, 40)
    const cut = await run<Brief>('reverse.feature.add', { feature: { kind: 'cutPlane', name: 'Side off', body: box.id, plane: { kind: 'world', axis: 'x', offset: 18 }, keep: -1 } })
    expect(cut.result?.status, cut.result?.message).toBe('ok')
    const ask = { feature: 'Block', range: 0.3, tolerance: 0.4, grain: 1.5 }

    // Unbounded, the patches run to the fifty a comparison names at most.
    const wide = await run<FeatureCompare>('reverse.body.compare', { ...ask, patches: 50, spots: 50, faces: 200 })
    expect(wide.patchesFound).toBeGreaterThan(5)
    expect(wide.patches.length).toBeGreaterThan(5)

    // Five patches and no spots: five, of all those found, and the answer
    // under 2 k tokens (four characters a token).
    const tight = await run<FeatureCompare>('reverse.body.compare', { ...ask, patches: 5, spots: 0 })
    expect(tight.patches).toHaveLength(5)
    expect(tight.patchesFound).toBe(wide.patchesFound)
    expect(tight.over).toBe(wide.over)
    expect(tight.worst).toBeUndefined()
    for (const side of [tight.far?.inside, tight.far?.outside]) expect(side?.patches.length ?? 0).toBeLessThanOrEqual(5)
    const length = JSON.stringify(tight).length
    expect(length).toBeLessThan(8000)
    expect(length).toBeLessThan(JSON.stringify(wide).length / 2)
    // Every patch on a face of the feature, named without the feature.
    for (const p of tight.patches) {
      expect(p.face).not.toBeNull()
      expect(p.face!.madeBy).toBeUndefined()
    }

    // The face rows cut to the count; faces still says how many were read.
    const rows = await run<FeatureCompare>('reverse.body.compare', { ...ask, faces: 2, patches: 0 })
    expect(rows.faceRows).toHaveLength(2)
    expect(rows.faces).toBeGreaterThan(2)
    expect(rows.patches).toEqual([])
    expect(rows.patchesFound).toBe(wide.patchesFound)

    // The worst spots on the extrude's faces, as many as asked, and on
    // the cut's: the scan 2 mm outside it.
    const spots = await run<FeatureCompare>('reverse.body.compare', { ...ask, spots: 3, patches: 0 })
    expect(spots.worst).toHaveLength(3)
    for (const sp of spots.worst!) {
      expect(sp.face).not.toBeNull()
      expect(sp.face!.madeBy).toBeUndefined()
    }
    const onCut = await run<FeatureCompare>('reverse.body.compare', { ...ask, feature: 'Side off', spots: 3, patches: 0 })
    expect(onCut.worst!.length).toBeGreaterThan(0)
    for (const sp of onCut.worst!) expect(sp.deviation).toBeGreaterThan(1.5)
  })
})

describe('bodies shown and hidden', () => {
  it('a feature’s visible hides its bodies, and the export and the comparison leave them out', async () => {
    const block = await boxBody('Block', 40, -20, 40)
    const lid = await boxBody('Lid', 10, 25, 5)
    expect(visibleIds().sort()).toEqual([block.id, lid.id].sort())

    // The lid's extrude hidden: its body goes, the block's stays.
    const hidden = await run<Brief>('reverse.feature.update', { feature: 'Lid', set: { visible: false } })
    expect(hidden.visibility).toEqual({ visible: false, bodies: [{ id: lid.id, name: lid.name }] })
    expect(hidden.feature.visible).toBe(false)
    expect(visibleIds()).toEqual([block.id])
    const step = await run<{ bodies: { id: number }[] }>('reverse.export.step')
    expect(step.bodies.map((b) => b.id)).toEqual([block.id])

    // A round on the block stands for the block: hidden through it, there
    // is no visible body to compare or export.
    await run<Brief>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body: block.id, edges: [0], radius: 1, chain: false } })
    await run<Brief>('reverse.feature.update', { feature: 'Round', set: { visible: false } })
    expect(visibleIds()).toEqual([])
    expect((await refused('reverse.body.compare', {})).code).toBe('invalid_state')
    expect((await refused('reverse.export.step', {})).code).toBe('invalid_state')

    // A body shown again by its own row's command.
    const shown = await run<{ body: Body }>('reverse.body.set', { body: block.id, visible: true })
    expect(shown.body.visible).toBe(true)
    expect(visibleIds()).toEqual([block.id])
    const list = await run<{ features: { name: string; visible: boolean }[] }>('reverse.feature.list')
    expect(list.features.find((f) => f.name === 'Round')?.visible).toBe(true)
    expect(list.features.find((f) => f.name === 'Lid')?.visible).toBe(false)

    // A sketch keeps its own eye.
    await run<Brief>('reverse.feature.update', { feature: 'Block plate', set: { visible: true } })
    expect(useReverse.getState().features.find((f) => f.name === 'Block plate')?.visible).toBe(true)
    expect(visibleIds()).toEqual([block.id])
  })
})

describe('chains left out by length', () => {
  it('maxLength leaves out the chains longer than it, and says how many', async () => {
    type Stack = { levels: { chains: unknown[]; leftOut?: Record<string, number> }[] }
    const all = await run<Stack>('reverse.section.stack', { plane: { kind: 'world', axis: 'z' }, offsets: [0] })
    expect(all.levels[0].chains).toHaveLength(1)
    const short = await run<Stack>('reverse.section.stack', { plane: { kind: 'world', axis: 'z' }, offsets: [0], maxLength: 100 })
    expect(short.levels[0].chains).toEqual([])
    expect(short.levels[0].leftOut).toEqual({ maxLength: 1 })

    const square = (side: number): [number, number][] => [[0, 0], [side, 0], [side, side], [0, side], [0, 0]]
    const { kept, left } = filterChains([square(1), square(10), square(100)], { minLength: 5, maxLength: 200 })
    expect(kept).toEqual([1])
    expect(left).toEqual({ short: 1, long: 1 })
  })
})
