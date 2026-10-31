// SPDX-License-Identifier: AGPL-3.0-only
// Thicken and Split between through the commands: a sheet named by its
// name made a wall half each way, its wall along the edge said; edited to
// another thickness; a solid refused as a sheet; a body named as target
// joined, op taken as join; a split keeping what lies between refused with
// one sheet. In the in-process worker, the kernel in this thread.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

/** A 40 mm cube about the origin, as a triangle soup. */
function cube(): Float32Array {
  const h = 20
  const c = (i: number): number[] => [i & 1 ? h : -h, i & 2 ? h : -h, i & 4 ? h : -h]
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
  return new Float32Array(quads.flatMap(([a, b, cc, d]) => [...c(a), ...c(b), ...c(cc), ...c(a), ...c(cc), ...c(d)]))
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(cube()), name: 'cube.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

type Body = { id: number; name: string; volume?: number }
type Brief = { id?: number; feature?: { id: number }; result?: { status: string; message?: string; note?: string }; bodies?: { count: number; changed?: Body[] } }

/** A sheet 20 mm wide and 10 tall, standing in the plane x = 30. */
async function sheet(name: string, x = 30) {
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: `${name} line`, plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { entities: [{ id: 1, kind: 'line', a: [x, -10], b: [x, 10], fixed: true }] } } })
  const made = await run<Brief>('reverse.feature.add', { feature: { kind: 'sheet', name, sketchId: `${name} line`, from: 0, to: 10 } })
  expect(made.result?.status, made.result?.message).toBe('ok')
}

describe('thicken through the commands', () => {
  it('makes a sheet a wall half each way, says the wall along its edge, and takes an edit', async () => {
    await sheet('Skin')
    const out = await run<Brief>('reverse.feature.add', { feature: { kind: 'thicken', name: 'Wall', sheet: 'Skin', thickness: 2, side: 'both' } })
    expect(out.result?.status, out.result?.message).toBe('ok')
    expect(out.result?.note).toMatch(/The wall along the sheet's edge is 2 mm at its thinnest/)
    const listed = await run<{ kind: string; sheet: number; thickness: number; side: string; op: string }>('reverse.feature.list', { feature: 'Wall' })
    expect(listed).toMatchObject({ kind: 'thicken', thickness: 2, side: 'both', op: 'new' })
    const described = await run<{ bodies: Body[] }>('reverse.body.describe', { body: 'Wall' })
    expect(described.bodies[0].volume).toBeCloseTo(20 * 10 * 2, 1)
    const edited = await run<Brief>('reverse.feature.update', { feature: 'Wall', set: { thickness: 3, side: 'out' } })
    expect(edited.result?.status, edited.result?.message).toBe('ok')
    const again = await run<{ bodies: Body[] }>('reverse.body.describe', { body: 'Wall' })
    expect(again.bodies[0].volume).toBeCloseTo(20 * 10 * 3, 1)
  })

  it('refuses a solid as the sheet, by name', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plan', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [10, 10], fixed: true }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plan', regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' } })
    const err = await refused('reverse.feature.add', { feature: { kind: 'thicken', sheet: 'Block', thickness: 1 } })
    expect(err.message).toMatch(/is a solid — thicken takes a sheet/)
  })

  it('joins the body named as target, op taken as join', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plan', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [25, 0], size: [10, 20], fixed: true }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plan', regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' } })
    // The sheet at x = 30 is the block's right face: half the wall is in
    // the block, the half outside it joins it.
    await sheet('Skin')
    const out = await run<Brief>('reverse.feature.add', { feature: { kind: 'thicken', name: 'Wall', sheet: 'Skin', thickness: 2, side: 'both', target: 'Block' } })
    expect(out.result?.status, out.result?.message).toBe('ok')
    const listed = await run<{ op: string; target?: number }>('reverse.feature.list', { feature: 'Wall' })
    expect(listed.op).toBe('join')
    expect(listed.target).toBeDefined()
    const block = await run<{ bodies: Body[] }>('reverse.body.describe', { body: 'Block' })
    expect(block.bodies[0].volume).toBeCloseTo(10 * 20 * 10 + 20 * 10 * 1, 1)
  })
})

describe('split between through the commands', () => {
  it('refuses keep between with one sheet', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plan', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [30, 0], size: [10, 10], fixed: true }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plan', regions: 'all', extent: { kind: 'distance', from: 1, to: 9 }, op: 'new' } })
    await sheet('Skin')
    const err = await refused('reverse.feature.add', { feature: { kind: 'split', body: 'Block', tools: ['Skin'], keep: 'between' } })
    expect(err.message).toMatch(/between the sheets takes two sheets or more/)
  })

  it('keeps the slice between two sheets', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plan', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [30, 0], size: [10, 10], fixed: true }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plan', regions: 'all', extent: { kind: 'distance', from: 1, to: 9 }, op: 'new' } })
    await sheet('Outer', 31)
    await sheet('Inner', 29)
    const out = await run<Brief>('reverse.feature.add', { feature: { kind: 'split', name: 'Wall', body: 'Block', tools: ['Outer', 'Inner'], keep: 'between' } })
    expect(out.result?.status, out.result?.message).toBe('ok')
    const block = await run<{ bodies: Body[] }>('reverse.body.describe', { body: 'Block' })
    expect(block.bodies[0].volume).toBeCloseTo(2 * 10 * 8, 1)
  })
})
