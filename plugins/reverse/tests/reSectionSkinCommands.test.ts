// SPDX-License-Identifier: AGPL-3.0-only
// The section commands kept to one skin, end to end: a thin arched shell
// with ribs on its inside opened as a scan, its outer arch fitted, stacked
// and outlined alone, and a stack clipped to a box — in the in-process
// worker.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { ARCH, archPlaceOf, archProfile, prism } from '../../../tests/shellMesh'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 60_000 })

type Vec2 = [number, number]
type Vec3 = [number, number, number]

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(soupOf(prism(archProfile(0.5), 20, 0.03))), name: 'cover.stl', discard: true })
}, 60_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

describe('the section commands on one skin of a thin shell', () => {
  it('reverse.section.fit fits the outer arch alone, the ribs and the inside left out', async () => {
    const sec = await run<{ section: { id: number } }>('section.cut', { across: 'XY', offset: 7, name: 'Across' })
    type Fit = { chains: { index: number; run?: number; closed?: boolean; pieces: { kind: string; radius?: number; world: { a?: Vec3; b?: Vec3 } }[] }[] }
    const all = await run<Fit>('reverse.section.fit', { section: sec.section.id, brief: true })
    expect(all.chains[0].pieces.some((p) => p.kind === 'arc' && Math.abs(p.radius! - ARCH.r) < 0.2)).toBe(true)
    const outer = await run<Fit>('reverse.section.fit', { section: sec.section.id, brief: true, skin: 'outer' })
    expect(outer.chains).toHaveLength(1)
    expect(outer.chains[0]).toMatchObject({ index: 0, run: 0, closed: false })
    const arcs = outer.chains[0].pieces.filter((p) => p.kind === 'arc')
    expect(arcs.some((p) => Math.abs(p.radius! - ARCH.R) < 0.15)).toBe(true)
    expect(arcs.every((p) => p.radius! > ARCH.r + 1)).toBe(true)
    expect((await refused('reverse.section.fit', { section: sec.section.id, facing: { dir: [0, 0] } })).code).toBe('invalid_input')
  })

  it('reverse.section.outline gives the outer arch’s polyline', async () => {
    type Outline = { index: number; run?: number; shape: { closed: boolean; points: Vec2[] } }
    // On the XY plane at z = 7 the sketch's [u, v] are X and Y.
    const o = await run<Outline>('reverse.section.outline', { plane: { kind: 'world', axis: 'z', offset: 7 }, skin: 'outer', tolerance: 0.1 })
    expect(o).toMatchObject({ index: 0, run: 0, shape: { closed: false } })
    for (const p of o.shape.points) expect(['outer', 'rim', 'corner']).toContain(archPlaceOf(p))
    const inner = await run<Outline>('reverse.section.outline', { plane: { kind: 'world', axis: 'z', offset: 7 }, skin: 'inner', chain: { at: [0, 30] } })
    for (const p of inner.shape.points) expect(['inner', 'corner']).toContain(archPlaceOf(p))
  })

  it('reverse.section.stack keeps each cut to the outer skin, and clips to a box', async () => {
    type Stack = { levels: { chains: { index: number; run?: number; closed: boolean; size: Vec2 }[] }[]; tracks: { levels: { chain: number; run?: number }[] }[] }
    const st = await run<Stack>('reverse.section.stack', { plane: { kind: 'world', axis: 'z' }, offsets: [5, 10, 15], skin: 'outer' })
    for (const l of st.levels) {
      expect(l.chains).toHaveLength(1)
      expect(l.chains[0]).toMatchObject({ index: 0, run: 0, closed: false })
      expect(l.chains[0].size[0]).toBeCloseTo(2 * ARCH.R, 0)
    }
    expect(st.tracks).toHaveLength(1)
    expect(st.tracks[0].levels[0]).toMatchObject({ chain: 0, run: 0 })
    // The left leg's box: kept whole without clip, cut down to it with.
    const within = { min: [-45, -20, 0], max: [-30, 0, 20] }
    const whole = await run<Stack>('reverse.section.stack', { plane: { kind: 'world', axis: 'z' }, offsets: [7], within })
    expect(whole.levels[0].chains[0].size[0]).toBeGreaterThan(70)
    const clipped = await run<Stack>('reverse.section.stack', { plane: { kind: 'world', axis: 'z' }, offsets: [7], within: { ...within, clip: true } })
    expect(clipped.levels[0].chains.length).toBeGreaterThan(0)
    for (const c of clipped.levels[0].chains) expect(c.size[0]).toBeLessThanOrEqual(15)
  })
})
