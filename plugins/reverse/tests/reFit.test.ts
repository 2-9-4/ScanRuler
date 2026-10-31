// SPDX-License-Identifier: AGPL-3.0-only
// "fit" in place of a feature's number (app/reFit.ts), on the scan of a
// 40 mm block whose top +X edge is rounded R2.5 and top −X edge chamfered
// 1.5, its walls upright: a fillet's radius and a chamfer's distance read
// across the edges, an extrude's end at the scan's top, a draft's angle off
// the walls — each with its sigma and nominal; the number stored in the
// feature, shown fitted on its row while it stands, forgotten once set by
// hand, fitted again by reverse.feature.refit; edges that read apart
// refused with each one's reading.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type P2 = [number, number]

/** The ±Y walls' draft, degrees, and how many strips along Y the scan is
 *  made of. */
const DRAFT_DEG = 2
const STRIPS = 80

/** The block's profile in XZ: the square ±20, its top right corner
 *  rounded 2.5 and its top left chamfered 1.5, sampled every 0.4 with
 *  noise; run along Y ±20 and capped. */
function block(): Float32Array {
  const rand = mulberry32(5)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const pts: { p: P2; n: P2 }[] = []
  const line = (a: P2, b: P2, n: P2) => {
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.4))
    for (let i = 0; i < k; i++) pts.push({ p: [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k], n })
  }
  const R = 2.5
  const C = 1.5
  line([-20, -20], [20, -20], [0, -1])
  line([20, -20], [20, 20 - R], [1, 0])
  for (let i = 0; i < 24; i++) {
    const a = (Math.PI / 2) * (i / 24)
    pts.push({ p: [20 - R + R * Math.cos(a), 20 - R + R * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] })
  }
  line([20 - R, 20], [-20 + C, 20], [0, 1])
  line([-20 + C, 20], [-20, 20 - C], [-Math.SQRT1_2, Math.SQRT1_2])
  line([-20, 20 - C], [-20, -20], [-1, 0])
  const profile = pts.map(({ p, n }) => {
    const d = gauss() * 0.02
    return [p[0] + d * n[0], p[1] + d * n[1]] as P2
  })
  const tris: number[] = []
  // The ±Y walls drafted 2°, leaning in as they rise from z = −20: a point
  // of the profile at height z runs from −Y(z) to Y(z).
  const Y = (z: number) => 20 - (z + 20) * Math.tan((DRAFT_DEG * Math.PI) / 180)
  const at = (p: P2, k: number) => [p[0], -Y(p[1]) + (2 * Y(p[1]) * k) / STRIPS, p[1]]
  // Along Y in strips, so the scan has vertices all over its faces, as a
  // scan does.
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i]
    const b = profile[(i + 1) % profile.length]
    for (let k = 0; k < STRIPS; k++) tris.push(...at(a, k), ...at(b, k + 1), ...at(b, k), ...at(a, k), ...at(a, k + 1), ...at(b, k + 1))
    tris.push(0, -Y(0), 0, ...at(a, 0), ...at(b, 0), 0, Y(0), 0, ...at(b, STRIPS), ...at(a, STRIPS))
  }
  // Wound outward: the signed volume comes out positive.
  let vol = 0
  for (let i = 0; i < tris.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(i, i + 9)
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  if (!(vol > 0)) throw new Error(`The test block is wound inside out (${vol}).`)
  return new Float32Array(tris)
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(block()), name: 'block.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

type Fitted = { value: number; sigma: number | null; nominal: number; off: number; sigmas: number | null; points: number; readings?: { value: number | null; sigma?: number | null; why?: string }[] }
type Answer = { feature: { id: number; status: string; value?: number; fitted?: Record<string, Fitted> }; fitted?: Record<string, Fitted>; bodies: { changed?: { id: number; bounds: { min: number[]; max: number[] } }[] } }

const TOP_RIGHT = { between: [[0, 0, 1], [1, 0, 0]] }
const TOP_LEFT = { between: [[0, 0, 1], [-1, 0, 0]] }

async function sharpBlock(): Promise<number> {
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Base', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } } })
  const made = await run<Answer>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Base', regions: 'all', extent: { kind: 'distance', from: 0, to: 40 }, op: 'new' } })
  return made.bodies.changed![0].id
}

describe('"fit" for a feature’s numbers', () => {
  it('fits a fillet’s radius and a chamfer’s distance across their edges, stores the numbers and shows them fitted', async () => {
    const body = await sharpBlock()
    const round = await run<Answer>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body, edges: [TOP_RIGHT], radius: 'fit' } })
    expect(round.feature.status).toBe('ok')
    const r = round.fitted!.radius
    expect(Math.abs(r.value - 2.5)).toBeLessThan(0.05)
    expect(r.sigma).toBeGreaterThan(0)
    expect(r.nominal).toBe(2.5)
    expect(r.points).toBeGreaterThan(20)
    const listed = await run<{ radius: number }>('reverse.feature.list', { feature: 'Round' })
    expect(listed.radius).toBe(r.value)
    const rows = await run<{ features: { name: string; fitted?: Record<string, Fitted> }[] }>('reverse.feature.list')
    expect(rows.features.find((f) => f.name === 'Round')!.fitted!.radius.value).toBe(r.value)

    const cham = await run<Answer>('reverse.feature.add', { feature: { kind: 'chamfer', name: 'Bevel', body, edges: [TOP_LEFT], distance: 'fit' }, detail: 'none' })
    expect(Math.abs(cham.fitted!.distance.value - 1.5)).toBeLessThan(0.05)
    expect(cham.fitted!.distance.nominal).toBe(1.5)
  })

  it('refuses edges that read apart, naming each reading; a sharp edge among them too', async () => {
    const body = await sharpBlock()
    const both = await refused('reverse.feature.add', { feature: { kind: 'fillet', body, edges: [TOP_RIGHT, { between: [[0, 0, -1], [1, 0, 0]] }], radius: 'fit' } })
    expect(both.code).toBe('failed')
    expect(both.message).toMatch(/#1 2\.\d+ ± [\d.]+ mm; #2 no round/)
  })

  it('ends an extrude at the scan’s top', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Pad', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [30, 30], fixed: true }] } } })
    const pad = await run<Answer>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Up', sketchId: 'Pad', regions: 'all', extent: { kind: 'toScan', from: 0 }, op: 'new' } })
    const to = pad.fitted!['extent.to']
    expect(Math.abs(to.value - 40)).toBeLessThan(0.02)
    expect(to.nominal).toBe(40)
    expect(pad.bodies.changed![0].bounds.max[2]).toBeCloseTo(-20 + to.value, 4)
  })

  it('reads the walls’ draft, forgets a number set by hand, and refits', async () => {
    const body = await sharpBlock()
    // The ±Y walls read 2° each, leaning in away from the base.
    const draft = await run<Answer>('reverse.feature.add', { feature: { kind: 'draft', name: 'Lean', body, neutral: { kind: 'world', axis: 'z', offset: -20 }, faces: [{ kind: 'plane', between: [[0, 1, 0]] }, { kind: 'plane', between: [[0, -1, 0]] }], angleDeg: 'fit' } })
    const a = draft.fitted!.angleDeg
    expect(Math.abs(a.value - DRAFT_DEG)).toBeLessThan(0.1)
    expect(a.nominal).toBe(DRAFT_DEG)
    expect(a.readings!.map((r) => Math.round(r.value!))).toEqual([2, 2])
    expect(draft.feature.status).toBe('ok')
    const round = await run<Answer>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body, edges: [TOP_RIGHT], radius: 'fit' } })
    const fitted = round.fitted!.radius.value
    await run('reverse.feature.update', { feature: 'Round', set: { radius: 3 } })
    let rows = await run<{ features: { name: string; fitted?: unknown }[] }>('reverse.feature.list')
    expect(rows.features.find((f) => f.name === 'Round')!.fitted).toBeUndefined()
    expect((await refused('reverse.feature.refit', { feature: 'Round' })).code).toBe('invalid_state')
    const again = await run<Answer & { was: Record<string, number> }>('reverse.feature.refit', { feature: 'Round', fields: ['radius'] })
    expect(again.was.radius).toBe(3)
    expect(again.fitted!.radius.value).toBeCloseTo(fitted, 6)
    rows = await run<{ features: { name: string; fitted?: unknown }[] }>('reverse.feature.list')
    expect(rows.features.find((f) => f.name === 'Round')!.fitted).toBeDefined()
    // Undone, the fitted number is gone with it.
    await run('history.undo')
    rows = await run<{ features: { name: string; fitted?: unknown }[] }>('reverse.feature.list')
    expect(rows.features.find((f) => f.name === 'Round')!.fitted).toBeUndefined()
  })
})

describe('one feature checked against the scan', () => {
  type Checked = {
    feature: { id: number; name: string; kind: string }
    faces: number
    read: number
    within: number
    rms: number
    inside: number
    patches: { side: string; face: { madeBy?: { id: number } } | null }[]
    numbers?: Record<string, { feature: number; scan: number; sigma: number; off: number; sigmas: number; error?: string }>
    faceRows: { face: { madeBy?: { id: number } } }[]
  }

  it('reads only the feature’s own faces, finds its patch, and sets its number beside the scan’s', async () => {
    const body = await sharpBlock()
    const wrong = await run<Answer>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body, edges: [TOP_RIGHT], radius: 1 } })
    const c = await run<Checked>('reverse.body.compare', { feature: 'Round', range: 0.1 })
    expect(c.feature).toMatchObject({ name: 'Round', kind: 'fillet' })
    expect(c.faces).toBeGreaterThan(0)
    // The feature's own faces, named without it: the answer names it once.
    expect(c.faceRows.length).toBeGreaterThan(0)
    expect(c.faceRows.every((r) => r.face.madeBy === undefined)).toBe(true)
    void wrong
    expect(c.read).toBeGreaterThan(20)
    // R1 where the scan is R2.5: the body stands proud of the scan there.
    expect(c.inside).toBeLessThan(-0.3)
    expect(c.patches.length).toBeGreaterThan(0)
    expect(c.patches.every((p) => p.face !== null && p.face.madeBy === undefined && p.side === 'inside')).toBe(true)
    const n = c.numbers!.radius
    expect(n.feature).toBe(1)
    expect(Math.abs(n.scan - 2.5)).toBeLessThan(0.05)
    expect(n.sigmas).toBeGreaterThan(20)
    // Rounded to the scan, the same check reads clean.
    await run('reverse.feature.update', { feature: 'Round', set: { radius: 'fit' } })
    const ok = await run<Checked>('reverse.body.compare', { feature: 'Round', range: 0.1 })
    expect(ok.patches).toEqual([])
    expect(ok.numbers!.radius.sigmas).toBeLessThan(1e-6)
    expect(ok.rms).toBeLessThan(0.05)
  })

  it('refuses a feature that made no face, and a picture without the browser', async () => {
    await sharpBlock()
    expect((await refused('reverse.body.compare', { feature: 'Base' })).code).toBe('invalid_state')
    expect((await refused('reverse.body.compare', { feature: 'Block', picture: true })).code).toBe('unavailable')
    expect((await refused('reverse.body.compare', { picture: true })).code).toBe('invalid_input')
  })
})

