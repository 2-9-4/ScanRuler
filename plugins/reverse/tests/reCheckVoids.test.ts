// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.check on what a body hides and how it says it: a block with
// a cavity sealed inside reads one void with the cavity's volume and box, a
// warning and not a problem; a STEP file of it keeps both shells; and the
// audit's findings come one line each with audit: "brief". On a 40 mm box
// scanned, the kernel in this thread — as reCommandsScan.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec3 = [number, number, number]
interface Brief { result: { status: string; message?: string } | null; bodies: { changed?: { id: number; name: string }[] } }
interface Checked {
  id: number
  ok: boolean
  shells: number[]
  voids: number
  voidList?: { volume: number; box: { min: Vec3; max: Vec3 } }[]
  warnings?: string[]
  problems?: string[]
  clean?: boolean
  findings?: string[]
  steps?: unknown[]
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

/** A block `size` across about (x, y), from z to z + height, a body of its own. */
async function block(name: string, size: number, z: number, height: number, at: [number, number] = [0, 0]) {
  await run<Brief>('reverse.feature.add', { feature: { kind: 'sketch', name: `${name} sketch`, plane: { kind: 'world', axis: 'z', offset: z }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: at, size: [size, size], fixed: true }] } } })
  const made = await run<Brief>('reverse.feature.add', { feature: { kind: 'extrude', name, sketchId: `${name} sketch`, regions: 'all', extent: { kind: 'distance', from: 0, to: height }, op: 'new' } })
  expect(made.result?.status, made.result?.message).toBe('ok')
  return made.bodies.changed![0]
}

describe('what a body hides', () => {
  it('reads a cavity sealed inside a block as a void, with its volume and box, and a STEP file keeps it', async () => {
    const outer = await block('Block', 20, 0, 20)
    const inner = await block('Core', 4, 8, 4)
    const cut = await run<Brief>('reverse.feature.add', { feature: { kind: 'boolean', op: 'cut', body: outer.id, tool: inner.id } })
    expect(cut.result?.status, cut.result?.message).toBe('ok')
    const checked = (await run<{ bodies: Checked[] }>('reverse.body.check', { body: outer.id })).bodies[0]
    expect(checked.shells).toEqual([2])
    expect(checked.voids).toBe(1)
    expect(checked.voidList![0].volume).toBeCloseTo(64, 3)
    expect(checked.voidList![0].box.min).toEqual([-2, -2, 8])
    expect(checked.voidList![0].box.max).toEqual([2, 2, 12])
    // A warning, not a problem: the body is sound, it has a hollow in it.
    expect(checked.ok).toBe(true)
    expect(checked.problems).toBeUndefined()
    expect(checked.warnings?.[0]).toMatch(/^1 void sealed inside the body .*64 mm³ in \(-2, -2, 8\)–\(2, 2, 12\)/)
    type Step = { verify: { ok: boolean; bodies: { shells: [number[], number[]] }[] } }
    const step = await run<Step>('reverse.export.step', { bodies: [outer.id], verify: true })
    expect(step.verify.ok).toBe(true)
    expect(step.verify.bodies[0].shells).toEqual([[2], [2]])
  })

  it('reads a block with none as none', async () => {
    const b = await block('Block', 20, 0, 20)
    const checked = (await run<{ bodies: Checked[] }>('reverse.body.check', { body: b.id })).bodies[0]
    expect(checked.shells).toEqual([1])
    expect(checked.voids).toBe(0)
    expect(checked.voidList).toBeUndefined()
    expect(checked.warnings).toBeUndefined()
  })

  it('gives the audit one line a finding with audit: "brief"', async () => {
    // Two blocks side by side, one top 0.05 mm above the other: a step.
    const a = await block('Left', 10, 0, 10, [-5, 0])
    const b = await block('Right', 10, 0, 10.05, [5, 0])
    const joined = await run<Brief>('reverse.feature.add', { feature: { kind: 'boolean', op: 'join', body: a.id, tool: b.id } })
    expect(joined.result?.status, joined.result?.message).toBe('ok')
    const full = (await run<{ bodies: Checked[] }>('reverse.body.check', { body: a.id, audit: true })).bodies[0]
    expect(full.steps).toHaveLength(1)
    const brief = (await run<{ bodies: Checked[] }>('reverse.body.check', { body: a.id, audit: 'brief' })).bodies[0]
    expect(brief.clean).toBe(false)
    expect(brief.steps).toBeUndefined()
    expect(brief.warnings).toBeUndefined()
    expect(brief.findings!.length).toBeGreaterThan(0)
    const step = brief.findings!.find((l) => l.startsWith('step '))!
    expect(step).toMatch(/^step 0\.05 mm at \([^)]*\): faces \d+ \((Left|Right)\) \+ \d+ \((Left|Right)\) — \S/)
    for (const line of brief.findings!) expect(line).not.toMatch(/\n/)
  })
})
