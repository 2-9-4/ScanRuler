// SPDX-License-Identifier: AGPL-3.0-only
// A slice to a constrained profile in one call: a stadium plate scanned
// (two R10 ends, straight sides 40 apart, a little noise), a sketch fitted
// on its section with accept: the relations the scan cannot tell from
// holding — the sides level, the ends mirrored about the part's planes —
// taken as the design's, the sketch solved, what was left listed: what
// follows from those taken (equal ends, equal sides) as implied.
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

/** A stadium in XY — ends R10 about (±20, 0), sides at y = ±10 — sampled
 *  every `step`, with noise along the outward normal, run along Z from −5
 *  to 5 and capped. */
function stadium(step = 0.3, noise = 0.02): Float32Array {
  const rand = mulberry32(9)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const pts: { p: P2; n: P2 }[] = []
  for (let x = -20; x < 20; x += step) pts.push({ p: [x, -10], n: [0, -1] })
  for (let a = -Math.PI / 2; a < Math.PI / 2; a += step / 10) pts.push({ p: [20 + 10 * Math.cos(a), 10 * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] })
  for (let x = 20; x > -20; x -= step) pts.push({ p: [x, 10], n: [0, 1] })
  for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += step / 10) pts.push({ p: [-20 + 10 * Math.cos(a), 10 * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] })
  const profile = pts.map(({ p, n }) => {
    const d = gauss() * noise
    return [p[0] + d * n[0], p[1] + d * n[1]] as P2
  })
  const tris: number[] = []
  const at = (p: P2, z: number) => [p[0], p[1], z]
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i]
    const b = profile[(i + 1) % profile.length]
    tris.push(...at(a, -5), ...at(b, -5), ...at(b, 5), ...at(a, -5), ...at(b, 5), ...at(a, 5))
    tris.push(0, 0, -5, ...at(b, -5), ...at(a, -5), 0, 0, 5, ...at(a, 5), ...at(b, 5))
  }
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
  await run('scan.open', { bytes: stlBytes(stadium()), name: 'stadium.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

type Brief = { kind: string; pieces: number[]; sigmas: number | null; off: number; what?: string }
type Answer = {
  solve: { ok: boolean; underConstrained: number[]; fit?: { rms: number } }
  accept: { accepted: (Brief & { constraints: number[] })[]; left: (Brief & { why: string; moves?: { piece: number; mm: number } })[]; maxMoveMm: number }
  fitted: { pieces: { id: number; kind: string }[] }[]
  moved: { count: number; pieces?: { id: number; mm: number }[] }
}

describe('a sketch fitted with accept', () => {
  it('takes the stadium’s relations in one call, and the sketch solves on its points', async () => {
    const cut = await run<{ section: { id: number } }>('section.cut', { across: 'XY', offset: 0, name: 'Plan' })
    const made = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Stadium', plane: { kind: 'section', id: cut.section.id }, sketch: { fit: { accept: { sigmas: 2 } } } } })
    const kinds = made.accept.accepted.map((a) => a.kind)
    expect(made.fitted[0].pieces.map((p) => p.kind).sort()).toEqual(['arc', 'arc', 'line', 'line'])
    expect(made.solve.ok).toBe(true)
    // The fit joins smooth corners tangent itself; accept takes the rest.
    const held = await run<{ sketch: { constraints: { id: number; kind: string }[] } }>('reverse.feature.list', { feature: 'Stadium' })
    expect(held.sketch.constraints.filter((c) => c.kind === 'tangent')).toHaveLength(4)
    expect(kinds).toContain('horizontal')
    // The two straight sides tangent to the same two rounds are as long
    // as each other whatever the rounds: equal follows, and is left.
    expect(made.accept.left.find((l) => l.kind === 'equal' && l.what === 'length')?.why).toBe('implied')
    expect(kinds).toContain('symmetric')
    expect(kinds.filter((k) => k === 'onDatum').length).toBeGreaterThan(0)
    expect(made.solve.underConstrained).toEqual([])
    expect(made.accept.left.find((l) => l.kind === 'horizontal')?.why).toBe('implied')
    for (const a of made.accept.accepted) expect(a.sigmas!).toBeLessThanOrEqual(2)
    for (const l of made.accept.left) expect(['sigmas', 'conflict', 'implied', 'moved']).toContain(l.why)
    // No piece went farther from its fit than the limit, and the answer
    // says how far they went.
    expect(made.accept.maxMoveMm).toBeGreaterThan(0)
    expect(made.moved.count).toBeGreaterThanOrEqual(0)
    for (const p of made.moved.pieces ?? []) expect(p.mm).toBeLessThanOrEqual(made.accept.maxMoveMm + 1e-3)
    // The relations held cost the fit nothing worth the name.
    expect(made.solve.fit!.rms).toBeLessThan(0.05)
    // One taken out again by its id, as the answer says.
    const symmetric = made.accept.accepted.find((a) => a.kind === 'symmetric')!
    const back = await run<{ solve: { ok: boolean } }>('reverse.sketch.edit', { sketch: 'Stadium', remove: { constraints: symmetric.constraints } })
    expect(back.solve.ok).toBe(true)
    const after = await run<{ sketch: { constraints: { id: number }[] } }>('reverse.feature.list', { feature: 'Stadium' })
    expect(after.sketch.constraints.some((c) => symmetric.constraints.includes(c.id))).toBe(false)
  })

  it('counts what accept moved of the pieces fitted in the same edit', async () => {
    const cut = await run<{ section: { id: number } }>('section.cut', { across: 'XY', offset: 0 })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Later', plane: { kind: 'section', id: cut.section.id }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 40], r: 2 }] } } })
    const edited = await run<Answer>('reverse.sketch.edit', { sketch: 'Later', add: { fit: { accept: { sigmas: 2 } } } })
    const fitted = edited.fitted.flatMap((f) => f.pieces.map((p) => p.id))
    expect(edited.accept.accepted.length).toBeGreaterThan(0)
    expect(edited.moved.count).toBeGreaterThan(0)
    for (const p of edited.moved.pieces!) expect(fitted).toContain(p.id)
  })

  it('takes only the kinds asked for, and refuses an accept without sigmas', async () => {
    const cut = await run<{ section: { id: number } }>('section.cut', { across: 'XY', offset: 0 })
    const made = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', plane: { kind: 'section', id: cut.section.id }, sketch: { fit: { accept: { sigmas: 2, kinds: ['equal'] } } } } })
    expect(made.accept.accepted.map((a) => a.kind)).toEqual(['equal'])
    expect(made.accept.left.find((l) => l.kind === 'equal')?.why).toBe('implied')
    expect(made.accept.left.some((l) => l.kind !== 'equal' && l.why === 'kind')).toBe(false)
    expect((await refused('reverse.feature.add', { feature: { kind: 'sketch', plane: { kind: 'section', id: cut.section.id }, sketch: { fit: { accept: {} } } } })).code).toBe('invalid_input')
  })
})
