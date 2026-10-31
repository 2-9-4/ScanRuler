// SPDX-License-Identifier: AGPL-3.0-only
// A slice's chains made ready for a sketch: the ends a hole in the scan
// left apart joined across it, chains told apart by size and by a point,
// a noisy rectangle thinned to its four corners and laid along the axes,
// and a fit that skips the chain too short to fit.

import { beforeEach, describe, expect, it } from 'vitest'
// The plugin first, as the app loads it: the sketch input sits in the
// commands' import cycle.
import '../plugin'
import { mulberry32 } from '../../../src/core/fit/ransac'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import { acceptOnDraft, fitDraft } from '../app/reSketchInput'
import { bridgedOf, chainAt, chainClosed, filterChains, joinChainEnds, outlineOf, pickChain, unjoined } from '../core/chainOutline'
import { DEFAULT_FIT_OPTIONS } from '../core/fitOptions'
import { useReverse } from '../state/reStore'
import { gaussian } from '../../../tests/helpers'

/** Points from a to b, `step` apart, a's included and b's not. */
function run(a: Vec2, b: Vec2, step = 0.1): Vec2[] {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  return Array.from({ length: n }, (_, i): Vec2 => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
}

/** A rectangle's outline from `lo` to `hi`, closed on its first point,
 *  with Gaussian noise of `noise` mm on every point. */
function rectangle(lo: Vec2, hi: Vec2, noise = 0, seed = 3): Vec2[] {
  const rand = mulberry32(seed)
  const c: Vec2[] = [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]]
  const pts = c.flatMap((p, i) => run(p, c[(i + 1) % 4]))
  const noisy = pts.map((p): Vec2 => [p[0] + gaussian(rand) * noise, p[1] + gaussian(rand) * noise])
  return [...noisy, noisy[0]]
}

describe('chain ends joined across a gap', () => {
  // Two halves of a 20 × 10 rectangle, each stopping 0.3 mm short of the
  // other at both ends.
  const left: Vec2[] = [...run([9.85, 10], [0, 10]), ...run([0, 10], [0, 0]), ...run([0, 0], [9.85, 0]), [9.85, 0]]
  const right: Vec2[] = [...run([10.15, 0], [20, 0]), ...run([20, 0], [20, 10]), ...run([20, 10], [10.15, 10]), [10.15, 10]]

  it('joins two open chains into one loop where the gaps are within reach', () => {
    const joined = joinChainEnds([left, right], 0.5)
    expect(joined).toHaveLength(1)
    expect(joined[0].from).toEqual([0, 1])
    expect(joined[0].gaps).toBe(2)
    expect(joined[0].largest).toBeCloseTo(0.3, 6)
    expect(chainClosed(joined[0].chain)).toBe(true)
    expect(bridgedOf(joined)).toEqual({ gaps: 2, largest: joined[0].largest })
  })

  it('leaves them apart where the gaps are wider than allowed', () => {
    const joined = joinChainEnds([left, right], 0.2)
    expect(joined).toHaveLength(2)
    expect(joined.map((j) => j.from)).toEqual([[0], [1]])
    expect(bridgedOf(joined).gaps).toBe(0)
  })

  it('closes a chain on itself, and leaves a closed one alone', () => {
    const open = rectangle([0, 0], [10, 10]).slice(0, -3)
    const closed = rectangle([30, 0], [40, 10])
    const joined = joinChainEnds([closed, open], 0.5)
    expect(joined.map((j) => j.from)).toEqual([[0], [1]])
    expect(joined[0].chain).toBe(closed)
    expect(chainClosed(joined[1].chain)).toBe(true)
    expect(joined[1].gaps).toBe(1)
  })
})

describe('chains told apart', () => {
  const big = rectangle([0, 0], [40, 20])
  const hole = rectangle([5, 5], [10, 10])
  const wall: Vec2[] = run([50, 0], [50, 30])
  const chains = unjoined([hole, big, wall])

  it('picks the largest, the one round a point and the nearest', () => {
    expect(pickChain(chains, 'largest')).toBe(1)
    expect(pickChain(chains, { at: [7, 7] })).toBe(0)
    expect(pickChain(chains, { at: [30, 10] })).toBe(1)
    expect(pickChain(chains, { at: [52, 10] })).toBe(2)
    expect(pickChain(chains, 2)).toBe(2)
    expect(pickChain(chains, 5)).toBe(-1)
  })

  it('takes the chain a point lies on, within three of its scatters, over the loop round it', () => {
    // A noisy opening inside the outline; the point on its rim, a hair
    // outside it, lies inside the outline only.
    const opening = rectangle([5, 5], [10, 10], 0.03, 7)
    const rimmed = unjoined([big, opening])
    expect(pickChain(rimmed, { at: [10.02, 7] })).toBe(1)
    expect(pickChain(rimmed, { at: [9.98, 7] })).toBe(1)
    // A millimetre off the rim it is the loop round it again.
    expect(pickChain(rimmed, { at: [11, 7] })).toBe(0)
    expect(pickChain(rimmed, { at: [8, 7] })).toBe(1)
  })

  it('says which rule named the chain round a point, its area and how many closed chains lie round it', () => {
    // Round 15: the fan wheel's blade — the agent could not tell on from round.
    expect(chainAt(chains, [7, 7])).toEqual({ index: 0, by: 'round', area: expect.closeTo(25, 6), enclosing: 2 })
    expect(chainAt(chains, [30, 10])).toEqual({ index: 1, by: 'round', area: expect.closeTo(800, 6), enclosing: 1 })
    expect(chainAt(chains, [5, 7])).toMatchObject({ index: 0, by: 'on', enclosing: 2 })
    expect(chainAt(chains, [50.01, 12])).toEqual({ index: 2, by: 'on', area: 0, enclosing: 0 })
    expect(chainAt(chains, [55, 12])).toEqual({ index: 2, by: 'nearest', area: 0, enclosing: 0 })
    expect(chainAt([], [0, 0])).toEqual({ index: -1, by: 'nearest', area: 0, enclosing: 0 })
  })

  it('filters by length, by closing and by count', () => {
    expect(filterChains([hole, big, wall], { minLength: 25 })).toEqual({ kept: [1, 2], left: { short: 1 } })
    expect(filterChains([hole, big, wall], { closedOnly: true })).toEqual({ kept: [0, 1], left: { open: 1 } })
    expect(filterChains([hole, big, wall], { maxChains: 2 })).toEqual({ kept: [1, 2], left: { beyond: 1 } })
    expect(filterChains([hole, big, wall], {})).toEqual({ kept: [0, 1, 2], left: {} })
  })
})

describe('a chain thinned to an outline', () => {
  it('takes a noisy rectangle to its four corners, within the tolerance', () => {
    const o = outlineOf(rectangle([12, -3], [52, 17], 0.01), { tolerance: 0.05 })
    expect(o.closed).toBe(true)
    expect(o.points.length).toBeGreaterThanOrEqual(4)
    expect(o.points.length).toBeLessThanOrEqual(5)
    expect(o.maxDeviation).toBeLessThanOrEqual(0.05 + 1e-9)
    for (const corner of [[12, -3], [52, -3], [52, 17], [12, 17]] as Vec2[]) expect(Math.min(...o.points.map((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1])))).toBeLessThan(0.1)
  })

  it('lays the sides along the axes, the corners square', () => {
    const o = outlineOf(rectangle([12, -3], [52, 17], 0.01), { tolerance: 0.05, snapDeg: 1 })
    expect(o.points).toHaveLength(4)
    expect(o.snapped).toBe(4)
    for (let i = 0; i < 4; i++) {
      const a = o.points[i], b = o.points[(i + 1) % 4]
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true)
    }
    expect(o.maxDeviation).toBeLessThan(0.06)
  })

  it('grows the tolerance to keep to maxPoints', () => {
    const circle: Vec2[] = Array.from({ length: 721 }, (_, i): Vec2 => [10 * Math.cos((i * Math.PI) / 360), 10 * Math.sin((i * Math.PI) / 360)])
    circle[720] = circle[0]
    const fine = outlineOf(circle, { tolerance: 0.01 })
    const few = outlineOf(circle, { tolerance: 0.01, maxPoints: 12 })
    expect(fine.points.length).toBeGreaterThan(12)
    expect(few.points.length).toBeLessThanOrEqual(12)
    expect(few.tolerance).toBeGreaterThan(0.01)
  })

  it('keeps an open chain open, its ends kept', () => {
    const o = outlineOf([...run([0, 0], [10, 0]), ...run([10, 0], [10, 5]), [10, 5]], { tolerance: 0.05 })
    expect(o.closed).toBe(false)
    expect(o.points).toEqual([[0, 0], [10, 0], [10, 5]])
  })

  it('takes out the corners it barely turns at with simplifyDeg, and keeps a curve’s', () => {
    // A side, one that runs on 2° off it, and a corner square up.
    const lift = 10 * Math.tan((2 * Math.PI) / 180)
    const crease = [...run([0, 0], [10, 0]), ...run([10, 0], [20, lift]), ...run([20, lift], [20, 10]), [20, 10]] as Vec2[]
    const sharp = outlineOf(crease, { tolerance: 0.05 })
    expect(sharp.points).toHaveLength(4)
    expect(sharp.merged).toBe(0)
    const merged = outlineOf(crease, { tolerance: 0.05, simplifyDeg: 3 })
    expect(merged.points).toEqual([[0, 0], [20, lift], [20, 10]])
    expect(merged.merged).toBe(1)
    // The chain now strays from the long side by the crease's height there.
    expect(merged.maxDeviation).toBeCloseTo(lift / 2, 2)
    // A circle's corners turn by more than a degree each: they stay.
    const circle: Vec2[] = Array.from({ length: 721 }, (_, i): Vec2 => [10 * Math.cos((i * Math.PI) / 360), 10 * Math.sin((i * Math.PI) / 360)])
    circle[720] = circle[0]
    const round = outlineOf(circle, { tolerance: 0.01, maxPoints: 24 })
    expect(outlineOf(circle, { tolerance: 0.01, maxPoints: 24, simplifyDeg: 1 }).points).toHaveLength(round.points.length)
  })
})

describe('a sketch fitted with a chain too short to fit', () => {
  const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  const s = () => useReverse.getState()

  beforeEach(() => {
    useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, sketchDraft: null })
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  })

  it('skips it and names it, the rest fitted', () => {
    const fitted = fitDraft({ chains: [rectangle([0, 0], [20, 10]), [[30, 0], [30.5, 0], [31, 0.1]]], fit: {}, options: DEFAULT_FIT_OPTIONS })
    expect(fitted).toHaveLength(2)
    expect(fitted[0]).toMatchObject({ chain: 0, closed: true })
    expect(fitted[0].pieces).toHaveLength(4)
    expect(fitted[1]).toMatchObject({ chain: 1, points: 3 })
    expect(fitted[1].skipped).toMatch(/too few points/)
    expect(s().sketchDraft!.found.length).toBe(1)
  })

  it('says when a fitted chain crosses itself, and refuses accept on it', () => {
    // A bow tie: one closed chain whose sides cross in the middle, two
    // triangles for regions.
    const tie: Vec2[] = [...run([0, 0], [10, 10]), ...run([10, 10], [10, 0]), ...run([10, 0], [0, 10]), ...run([0, 10], [0, 0]), [0, 0]]
    const fitted = fitDraft({ chains: [tie], fit: {}, options: DEFAULT_FIT_OPTIONS })
    expect(fitted[0].closed).toBe(true)
    expect(fitted[0].crosses?.regions).toBe(2)
    expect(fitted[0].crosses?.areas[0]).toBeCloseTo(25, 1)
    expect(fitted[0].warning).toMatch(/profile crosses itself: 1 chain → 2 regions \(areas 25/)
    expect(() => acceptOnDraft({ sigmas: 2 })).toThrow(/accept is refused: the profile crosses itself/)
    // One that closes one region says nothing of it.
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    const plain = fitDraft({ chains: [rectangle([0, 0], [20, 10])], fit: {}, options: DEFAULT_FIT_OPTIONS })
    expect(plain[0].crosses).toBeUndefined()
    expect(plain[0].warning).toBeUndefined()
  })

  it('fits the largest chain, the one round a point, and what lies in a box', () => {
    const chains = [rectangle([0, 0], [4, 4]), rectangle([10, 0], [30, 10])]
    expect(fitDraft({ chains, fit: { chains: 'largest' }, options: DEFAULT_FIT_OPTIONS }).map((f) => f.chain)).toEqual([1])
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    const round = fitDraft({ chains, fit: { chains: { at: [2, 2] } }, options: DEFAULT_FIT_OPTIONS })
    expect(round.map((f) => f.chain)).toEqual([0])
    expect(round[0]).toMatchObject({ pickedBy: 'round', area: expect.closeTo(16, 3), enclosing: 1 })
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    expect(fitDraft({ chains, fit: { chains: { at: [40, 5] } }, options: DEFAULT_FIT_OPTIONS })[0]).toMatchObject({ chain: 1, pickedBy: 'nearest', enclosing: 0 })
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    expect(fitDraft({ chains, fit: { chains: 'largest' }, options: DEFAULT_FIT_OPTIONS })[0].pickedBy).toBeUndefined()
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    const wall = fitDraft({ chains, fit: { chains: [1], within: { min: [9, 2], max: [11, 8] } }, options: DEFAULT_FIT_OPTIONS })
    expect(wall).toHaveLength(1)
    expect(wall[0]).toMatchObject({ chain: 1, run: 0, closed: false })
    expect(wall[0].pieces!.map((p) => p.kind)).toEqual(['line'])
  })

  it('says where an open chain’s ends are, the gap, and the closeGaps that closes it', () => {
    // A 20 × 10 outline with a hole of 3 mm in the scan along its top.
    const holey: Vec2[] = [...run([8.5, 10], [0, 10]), ...run([0, 10], [0, 0]), ...run([0, 0], [20, 0]), ...run([20, 0], [20, 10]), ...run([20, 10], [11.5, 10]), [11.5, 10]]
    const fitted = fitDraft({ chains: [holey], fit: {}, options: DEFAULT_FIT_OPTIONS })
    expect(fitted[0].closed).toBe(false)
    const open = fitted[0].open!
    const ends = [...open.ends].sort((a, b) => a[0] - b[0])
    expect(ends[0][0]).toBeCloseTo(8.5, 1)
    expect(ends[1][0]).toBeCloseTo(11.5, 1)
    for (const e of ends) expect(e[1]).toBeCloseTo(10, 1)
    expect(open.gap).toBeCloseTo(3, 1)
    expect(open.tryCloseGaps).toBeGreaterThan(open.gap)
    expect(open.tryCloseGaps).toBeLessThan(4)
    // Fitted again with it: closed.
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    const again = fitDraft({ chains: [holey], fit: { closeGaps: open.tryCloseGaps }, options: DEFAULT_FIT_OPTIONS })
    expect(again[0]).toMatchObject({ closed: true, bridged: { gaps: 1 } })
    expect(again[0].open).toBeUndefined()
    // A run a box cut is open by asking: its ends and gap, no closeGaps.
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    const wall = fitDraft({ chains: [rectangle([10, 0], [30, 10])], fit: { within: { min: [9, 2], max: [11, 8] } }, options: DEFAULT_FIT_OPTIONS })
    expect(wall[0].open?.gap).toBeGreaterThan(5)
    expect(wall[0].open?.tryCloseGaps).toBeUndefined()
  })

  it('joins the ends across a gap before fitting', () => {
    const open = rectangle([0, 0], [20, 10]).slice(0, -4)
    const fitted = fitDraft({ chains: [open], fit: { closeGaps: 0.5 }, options: DEFAULT_FIT_OPTIONS })
    expect(fitted[0]).toMatchObject({ chain: 0, closed: true })
    expect(fitted[0].bridged?.gaps).toBe(1)
    expect(s().sketchDraft!.found.length).toBe(1)
  })
})
