// SPDX-License-Identifier: AGPL-3.0-only
// Sections kept to one skin for a sketch: a moulded cover's arch fitted
// without its ribs or its inside, a gap bridged across keeping its side,
// and a stack's circles judged against their own chain's noise.

import { beforeEach, describe, expect, it } from 'vitest'
// The plugin first, as the app loads it: the sketch input sits in the
// commands' import cycle.
import '../plugin'
import { mulberry32 } from '../../../src/core/fit/ransac'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import { sliceMesh } from '../../../src/core/section/slice'
import { summarizeChain } from '../app/reSectionCommands'
import { fitDraft, sidedOf, sideRuleOf } from '../app/reSketchInput'
import { joinChainEnds, runsKept, sideOf } from '../core/chainOutline'
import { DEFAULT_FIT_OPTIONS } from '../core/fitOptions'
import { useReverse } from '../state/reStore'
import { gaussian } from '../../../tests/helpers'
import { ARCH, archPlaceOf, archProfile, prism } from '../../../tests/shellMesh'

const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }

/** The cover's arch cut across, laid flat with its sides. */
function archCut(noise = 0.03) {
  const mesh = prism(archProfile(0.5), 20, noise)
  return sidedOf(sliceMesh(mesh.positions, mesh.indices, [0, 0, 7], [0, 0, 1]), XY)
}

describe('a sketch fitted to one skin of a thin shell', () => {
  const s = () => useReverse.getState()
  const radii = () => s().sketchDraft!.sketch.entities.flatMap((e) => (e.kind === 'arc' ? [e.r] : []))

  beforeEach(() => {
    useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, sketchDraft: null })
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  })

  it('fits the whole section, inside and ribs too, when no skin is asked', () => {
    const sided = archCut()
    fitDraft({ chains: sided.chains, fit: {}, options: DEFAULT_FIT_OPTIONS })
    expect(radii().some((r) => Math.abs(r - ARCH.r) < 0.3)).toBe(true)
  })

  it('skin outer fits the outer arch alone', () => {
    const sided = archCut()
    const fit = { skin: 'outer' as const }
    const fitted = fitDraft({ chains: sided.chains, side: sideOf(sided, sideRuleOf(fit.skin, undefined)!), fit, options: DEFAULT_FIT_OPTIONS })
    expect(fitted).toHaveLength(1)
    expect(fitted[0]).toMatchObject({ chain: 0, run: 0, closed: false })
    const arcs = radii()
    expect(arcs.some((r) => Math.abs(r - ARCH.R) < 0.1)).toBe(true)
    expect(arcs.every((r) => r > ARCH.r + 1)).toBe(true)
    // Every piece ends on the outside: the arch, the legs' outer faces,
    // the rims.
    for (const e of s().sketchDraft!.sketch.entities) {
      const ends: Vec2[] = e.kind === 'line' ? [e.a, e.b] : e.kind === 'arc' ? [[e.c[0] + e.r * Math.cos(e.start), e.c[1] + e.r * Math.sin(e.start)], [e.c[0] + e.r * Math.cos(e.start + e.sweep), e.c[1] + e.r * Math.sin(e.start + e.sweep)]] : []
      for (const p of ends) expect(['outer', 'rim', 'corner']).toContain(archPlaceOf(p))
    }
  })

  it('skin inner fits the inside between the ribs, and facing the top', () => {
    const sided = archCut()
    const inner = fitDraft({ chains: sided.chains, side: sideOf(sided, { skin: 'inner' }), fit: { skin: 'inner' }, options: DEFAULT_FIT_OPTIONS })
    expect(inner.map((f) => f.run)).toEqual([0, 1, 2, 3])
    expect(radii().some((r) => Math.abs(r - ARCH.r) < 0.1)).toBe(true)
    expect(radii().every((r) => r < ARCH.R - 1)).toBe(true)

    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    const facing = { dir: [0, 1] as Vec2, withinDeg: 45 }
    const top = fitDraft({ chains: sided.chains, side: sideOf(sided, sideRuleOf(undefined, facing)!), fit: { facing }, options: DEFAULT_FIT_OPTIONS })
    expect(top).toHaveLength(1)
    expect(radii().every((r) => Math.abs(r - ARCH.R) < 0.15)).toBe(true)
  })

  it('refuses a facing with no direction', () => {
    expect(() => sideRuleOf(undefined, { dir: [0, 0] })).toThrow(/facing.dir/)
    expect(sideRuleOf(undefined, undefined)).toBeNull()
    expect(sideRuleOf('outer', { dir: [1, 0] })).toEqual({ skin: 'outer', facing: { dir: [1, 0], withinDeg: 60 } })
  })
})

describe('a side kept across a bridged gap', () => {
  it('runs the outer skin on across the gap closeGaps bridged', () => {
    const sided = archCut(0)
    const side = sideOf(sided, { skin: 'outer' })
    // The loop opened by a hole in the top of the arch: four points gone.
    const loop = sided.chains[0].slice(0, -1)
    const top = loop.findIndex((p) => p[1] > ARCH.R - 0.01)
    const open = [...loop.slice(top + 4), ...loop.slice(0, top)]
    expect(runsKept(open, { side })).toHaveLength(2)
    const [joined] = joinChainEnds([open], 3)
    expect(joined.gaps).toBe(1)
    const runs = runsKept(joined.chain, { side })
    expect(runs).toHaveLength(1)
    expect(runs[0].every((p) => ['outer', 'rim', 'corner'].includes(archPlaceOf(p)))).toBe(true)
    // The bridge's points are in it.
    expect(runs[0].length).toBeGreaterThan(runsKept(open, { side }).reduce((n, r) => n + r.length, 0))
  })
})

describe('a stack’s circles', () => {
  const lift = (p: Vec2): [number, number, number] => [p[0], p[1], 0]

  /** A closed chain round a shape given by its radius at an angle, with
   *  Gaussian noise of `noise` mm, closed on its first point. */
  function ring(radius: (t: number) => number, count: number, noise: number, seed = 5): Vec2[] {
    const rand = mulberry32(seed)
    const pts = Array.from({ length: count }, (_, i): Vec2 => {
      const t = (i / count) * 2 * Math.PI
      return [3 + radius(t) * Math.cos(t) + gaussian(rand) * noise, -2 + radius(t) * Math.sin(t) + gaussian(rand) * noise]
    })
    return [...pts, pts[0]]
  }

  it('reads a small noisy hole as a circle, by a fit judged against its noise', () => {
    const hole = ring(() => 2.5, 60, 0.04)
    // The old test — every point within 2 % of the mean radius — failed it.
    const rs = hole.map((p) => Math.hypot(p[0] - 3, p[1] + 2))
    expect((Math.max(...rs) - Math.min(...rs)) / 2.5).toBeGreaterThan(0.02)
    const c = summarizeChain(hole, 0, lift).circle
    expect(c).toBeDefined()
    expect(c!.radius).toBeCloseTo(2.5, 1)
    expect(c!.center[0]).toBeCloseTo(3, 1)
    expect(c!.center[1]).toBeCloseTo(-2, 1)
    expect(c!.rms).toBeLessThan(0.08)
  })

  it('reads a large round hole, and not a hexagon, an oval or a slot', () => {
    expect(summarizeChain(ring(() => 50, 600, 0.03), 0, lift).circle?.radius).toBeCloseTo(50, 1)
    const hexagon = (t: number) => 5 * Math.cos(Math.PI / 6) / Math.cos(((t % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6)
    expect(summarizeChain(ring(hexagon, 120, 0.01), 0, lift).circle).toBeUndefined()
    const oval = (t: number) => 1 / Math.hypot(Math.cos(t) / 5, Math.sin(t) / 5.3)
    expect(summarizeChain(ring(oval, 120, 0.01), 0, lift).circle).toBeUndefined()
    const slot = (t: number) => Math.min(8 / Math.max(Math.abs(Math.cos(t)), 1e-9), 3 / Math.max(Math.abs(Math.sin(t)), 1e-9))
    expect(summarizeChain(ring(slot, 160, 0.01), 0, lift).circle).toBeUndefined()
  })
})
