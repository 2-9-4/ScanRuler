// SPDX-License-Identifier: AGPL-3.0-only
// Rotational repeats: a cut across an axis turned against itself. On flat
// chains — a hub of 14 swept blades round a bore, a ring of 4 holes, 2
// bosses, a part with nothing repeating, a copy moved out of place — and
// then scan.pattern on a mesh in the in-process worker: a flange with 4
// holes under 14 blades, read at two heights in one call.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../src/core/fit/ransac'
import { rotationalRepeat } from '../src/core/geometry/rotationalRepeat'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from './commandKit'
import { densify, prism } from './shellMesh'

vi.setConfig({ testTimeout: 120_000 })

type Vec2 = [number, number]

const deg = Math.PI / 180

/** A circle as a closed chain of `k` points, round [cx, cy]. */
function circle(r: number, k = 360, c: Vec2 = [0, 0]): Vec2[] {
  return Array.from({ length: k }, (_, i): Vec2 => [c[0] + r * Math.cos((i / k) * 2 * Math.PI), c[1] + r * Math.sin((i / k) * 2 * Math.PI)])
}

/** A blade 3 mm thick from radius 50 to 84, swept 0.15 rad back as it
 *  goes out, its root at angle `at`; moved `shift` mm sideways, square to
 *  its own sides. Counter-clockwise. */
function blade(at: number, shift = 0): Vec2[] {
  const side = (off: number) =>
    Array.from({ length: 35 }, (_, i): Vec2 => {
      const r = 50 + i
      const a = at + (0.15 * i) / 34
      return [r * Math.cos(a) - (off + shift) * Math.sin(a), r * Math.sin(a) + (off + shift) * Math.cos(a)]
    })
  return [...side(-1.5), ...side(1.5).reverse()]
}

/** Closed chains as a cut lays them: each loop's first point repeated at
 *  its end, jittered by `noise` mm. */
function chains(loops: Vec2[][], noise = 0, seed = 5) {
  const rand = mulberry32(seed)
  const pts: number[] = []
  const offsets = [0]
  for (const loop of loops) {
    const closed = [...loop, loop[0]]
    for (const p of closed) pts.push(p[0] + (rand() * 2 - 1) * noise, p[1] + (rand() * 2 - 1) * noise)
    offsets.push(pts.length / 2)
  }
  return { points: Float32Array.from(pts), offsets: Uint32Array.from(offsets) }
}

const PITCH = 360 / 14
const fan = (phaseDeg: number, moved?: { index: number; mm: number }) =>
  [circle(30), circle(48), ...Array.from({ length: 14 }, (_, k) => densify(blade((phaseDeg + k * PITCH) * deg, moved?.index === k ? moved.mm : 0), 0.3))]

describe('rotational repeats in a cut', () => {
  it('counts 14 blades at 25.714°, the bore and the ring under them set apart as rings', () => {
    const r = rotationalRepeat(chains(fan(7), 0.02))
    expect(r.count).toBe(14)
    expect(r.pitchDeg).toBeCloseTo(PITCH, 6)
    expect(r.score).toBeGreaterThan(0.9)
    // The phase lies at the blades' middle: past the root, swept back a
    // little; every copy one pitch on from the last, and in its place.
    const first = r.instances[0]
    expect(first.angleDeg).toBeGreaterThan(7)
    expect(first.angleDeg).toBeLessThan(7 + 0.15 / deg)
    expect(Math.abs(r.phaseDeg - first.angleDeg)).toBeLessThan(1)
    for (let k = 0; k < 14; k++) {
      const c = r.instances[k]
      expect(c.offDeg).toBeCloseTo(0, 1)
      expect(((c.angleDeg - first.angleDeg - k * PITCH + 720) % 360)).toBeCloseTo(0, 1)
      expect(c.radius).toBeGreaterThan(60)
      expect(c.rms).toBeLessThan(0.05)
      expect(c.share).toBeCloseTo(1, 1)
    }
    expect(r.rings.map((g) => g.radius)).toEqual([expect.closeTo(30, 1), expect.closeTo(48, 1)])
    for (const g of r.rings) expect(g.off).toBeLessThan(0.02)
  })

  it('reads a copy moved out of place as the one off, the others not', () => {
    const r = rotationalRepeat(chains(fan(0, { index: 5, mm: 0.4 })))
    expect(r.count).toBe(14)
    expect(r.worstInstance).toBe(5)
    expect(r.instances[5].rms).toBeGreaterThan(0.3)
    expect(r.instances[5].rms).toBeLessThan(0.45)
    // Turned on by 0.4 mm at its middle, some 67 mm out: about a third of
    // a degree, less the share of it the mean of the copies takes.
    expect(r.instances[5].offDeg).toBeGreaterThan(0.25)
    expect(r.instances[5].offDeg).toBeLessThan(0.4)
    for (let k = 0; k < 14; k++) if (k !== 5) expect(r.instances[k].rms).toBeLessThan(0.02)
  })

  it('counts 4 holes in a ring at 45°, 2 bosses, and nothing in a part that does not repeat', () => {
    const holes = Array.from({ length: 4 }, (_, k): Vec2[] => circle(3.35, 60, [37.75 * Math.cos((45 + 90 * k) * deg), 37.75 * Math.sin((45 + 90 * k) * deg)]))
    const ring = rotationalRepeat(chains([circle(30), circle(45), ...holes], 0.01))
    expect(ring.count).toBe(4)
    expect(ring.pitchDeg).toBe(90)
    expect(ring.phaseDeg).toBeCloseTo(45, 0)
    for (const c of ring.instances) expect(c.radius).toBeCloseTo(37.75, 1)
    expect(ring.rings.map((g) => g.radius)).toEqual([expect.closeTo(30, 1), expect.closeTo(45, 1)])

    const bosses = rotationalRepeat(chains([circle(30), circle(4.75, 60, [38.25, 0]), circle(4.75, 60, [-38.25, 0])]))
    expect(bosses.count).toBe(2)
    expect(bosses.phaseDeg).toBeCloseTo(0, 0)

    const lone = rotationalRepeat(chains([circle(30), circle(4, 60, [40, 0]), circle(2, 60, [0, -40])]))
    expect(lone.count).toBe(1)
    expect(lone.instances).toEqual([])
    expect(lone.tried!.score).toBeLessThan(0.5)
  })

  it('keeps to the ring of radii asked, and says how far a ring lies off the axis', () => {
    const toward = 215 * deg
    const off: Vec2 = [0.25 * Math.cos(toward), 0.25 * Math.sin(toward)]
    const holes = Array.from({ length: 4 }, (_, k): Vec2[] => circle(3, 60, [38 * Math.cos(90 * k * deg), 38 * Math.sin(90 * k * deg)]))
    const loops = [circle(30, 360, off), ...holes, ...fan(0).slice(2)]
    // Holes and blades in one cut: the blades, with the more outline, set
    // the count, and the holes read as what the copies miss.
    const both = rotationalRepeat(chains(loops))
    expect(both.count).toBe(14)
    expect(both.worst).toBeGreaterThan(1)
    const inner = rotationalRepeat(chains(loops), { maxRadius: 45 })
    expect(inner.count).toBe(4)
    expect(inner.rings).toHaveLength(1)
    expect(inner.rings[0].off).toBeCloseTo(0.25, 2)
    expect(inner.rings[0].towardDeg).toBeCloseTo(215, 0)
    expect(rotationalRepeat(chains(loops), { minRadius: 45 }).count).toBe(14)
  })
})

describe('scan.pattern on a scan', () => {
  let headless: Headless
  beforeAll(async () => {
    headless = await startHeadless()
    // A flange 3 mm thick from radius 30 to 90 with 4 holes at 45°, and 14
    // blades standing on it to 20 mm — each a tube of its own, as the cut
    // sees them.
    const at = (soup: Float32Array, z: number) => {
      for (let i = 2; i < soup.length; i += 3) soup[i] += z
      return soup
    }
    const tube = (loop: Vec2[], from: number, to: number) => at(soupOf(prism(loop, to - from)), from)
    const parts = [
      tube(circle(30, 180), 0, 3),
      tube(circle(90, 360), 0, 3),
      ...Array.from({ length: 4 }, (_, k) => tube(circle(3.35, 48, [37.75 * Math.cos((45 + 90 * k) * deg), 37.75 * Math.sin((45 + 90 * k) * deg)]), 0, 3)),
      tube(circle(30, 180), 3, 20),
      ...Array.from({ length: 14 }, (_, k) => tube(densify(blade((10 + k * PITCH) * deg), 0.5), 3, 20)),
    ]
    const soup = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
    let o = 0
    for (const p of parts) {
      soup.set(p, o)
      o += p.length
    }
    await run('scan.open', { bytes: stlBytes(soup), name: 'wheel.stl', discard: true })
  })
  afterAll(() => headless.stop())

  interface Pattern {
    axis: { name?: string; origin: number[]; dir: number[]; zeroDir: number[] }
    heights: { at: number; count: number; pitchDeg?: number; phaseDeg?: number; betweenDeg?: number; score?: number; instances?: { angleDeg: number; radius: number; rms: number }[]; rings: { radius: number; off: number }[] }[]
  }

  it('answers 4 holes in the flange and 14 blades above it in one call', async () => {
    const p = await run<Pattern>('scan.pattern', { axis: 'Z', at: [1.5, 12] })
    expect(p.axis).toMatchObject({ name: 'Z', dir: [0, 0, 1], zeroDir: [1, 0, 0] })
    const [flange, blades] = p.heights
    expect(flange).toMatchObject({ at: 1.5, count: 4, pitchDeg: 90 })
    expect(flange.phaseDeg!).toBeCloseTo(45, 0)
    expect(flange.betweenDeg!).toBeCloseTo(90, 0)
    for (const c of flange.instances!) expect(c.radius).toBeCloseTo(37.75, 1)
    expect(flange.rings.map((g) => g.radius)).toEqual([expect.closeTo(30, 1), expect.closeTo(90, 1)])
    expect(blades).toMatchObject({ at: 12, count: 14 })
    expect(blades.pitchDeg!).toBeCloseTo(25.7143, 4)
    expect(blades.instances).toHaveLength(14)
    for (const c of blades.instances!) expect(c.rms).toBeLessThan(0.05)
  })

  it('takes an axis given as a line, turned to point up, and heights spread over the scan', async () => {
    const p = await run<Pattern>('scan.pattern', { axis: { origin: [0, 0, 5], dir: [0, 0, -2] }, instances: false })
    expect(p.axis.dir).toEqual([0, 0, 1])
    expect(p.axis.origin).toEqual([0, 0, 0])
    expect(p.heights).toHaveLength(6)
    // The scan runs from 0 to 20: the lowest height cuts the flange, the
    // rest the blades.
    expect(p.heights[0]).toMatchObject({ count: 4 })
    for (const h of p.heights.slice(1)) expect(h.count).toBe(14)
    for (const h of p.heights) expect(h.instances).toBeUndefined()
  })

  it('refuses an axis it cannot read', async () => {
    expect((await refused('scan.pattern', { axis: { origin: [0, 0, 0], dir: [0, 0, 0] } })).code).toBe('invalid_input')
    expect((await refused('scan.pattern', { axis: 'Z', radius: { min: 50, max: 40 } })).code).toBe('invalid_input')
  })
})
