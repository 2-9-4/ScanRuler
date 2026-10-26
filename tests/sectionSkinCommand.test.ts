// SPDX-License-Identifier: AGPL-3.0-only
// section.get read for one skin, end to end: a thin arched shell with ribs
// on its inside opened as a scan, cut across, and its outer arch, its inside
// and its top read alone — in the in-process worker (commandKit.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from './commandKit'
import { archPlaceOf, archProfile, prism } from './shellMesh'

type Vec3 = [number, number, number]
type G = { chains: { index: number; run?: number; closed: boolean; points: number; world?: Vec3[] }[] }

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

describe('section.get on one skin', () => {
  it('gives the outer arch alone, the inside between the ribs, or what faces a way', async () => {
    await run('scan.open', { bytes: stlBytes(soupOf(prism(archProfile(0.5), 20, 0.03))), name: 'cover.stl', discard: true })
    const s = await run<{ section: { id: number } }>('section.cut', { across: 'XY', offset: 7 })
    const places = (g: G) => g.chains.flatMap((c) => c.world!.map((p) => archPlaceOf([p[0], p[1]])))

    const whole = await run<G>('section.get', { section: s.section.id, space: 'world', limit: 50_000 })
    expect(whole.chains).toHaveLength(1)
    expect(new Set(places(whole))).toEqual(new Set(['outer', 'inner', 'rib', 'rim', 'corner']))

    const outer = await run<G>('section.get', { section: s.section.id, space: 'world', limit: 50_000, skin: 'outer' })
    expect(outer.chains).toHaveLength(1)
    expect(outer.chains[0]).toMatchObject({ index: 0, run: 0, closed: false })
    expect(places(outer).filter((x) => x === 'inner' || x === 'rib')).toEqual([])

    const inner = await run<G>('section.get', { section: s.section.id, space: 'world', limit: 50_000, skin: 'inner' })
    expect(inner.chains.map((c) => c.run)).toEqual([0, 1, 2, 3])
    expect(places(inner).filter((x) => x !== 'inner' && x !== 'corner')).toEqual([])

    // Up the sheet is +Y here: the top of the arch.
    const top = await run<G>('section.get', { section: s.section.id, space: 'world', limit: 50_000, facing: { dir: [0, 1], withinDeg: 45 } })
    expect(top.chains).toHaveLength(1)
    for (const p of top.chains[0].world!) expect(p[1]).toBeGreaterThan(25)

    expect((await refused('section.get', { section: s.section.id, facing: { dir: [0, 0] } })).code).toBe('invalid_input')
  })
})
