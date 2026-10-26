// SPDX-License-Identifier: AGPL-3.0-only
// Height levels read from the flat cells alone: two tiers 1.41 mm apart,
// joined by a fillet's ramp, beside a broad 30° slope — the slope's steps
// read as noise and its cells and the ramp's filled the bins between the
// tiers, so the two came back as one level. With the sloped cells left out
// they are two, and sloped counts what was left out. The grid on its own,
// then the same surface as a noisy scan in the in-process worker.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../src/core/fit/ransac'
import { cellNoise, heightLevels, slopedCells } from '../src/core/geometry/heightGrid'
import { gaussian } from './helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from './commandKit'

vi.setConfig({ testTimeout: 120_000 })

const STEP = 1.41
const TAN30 = Math.tan(Math.PI / 6)

/** The surface over 40 × 40 mm: for y under 16 a low tier, for x past 19 a
 *  tier STEP higher, a cosine ramp between (x 15 to 19, 29° at its
 *  steepest); for y from 16 a plane rising 30° along x + y. */
function surface(x: number, y: number): number {
  if (y >= 16) return -6 + (TAN30 * (x + y)) / Math.SQRT2
  if (x <= 15) return 0
  if (x >= 19) return STEP
  return (STEP * (1 - Math.cos((Math.PI * (x - 15)) / 4))) / 2
}

/** The surface as a triangle soup at `h` mm, each vertex lifted by noise
 *  of `sigma` mm. */
function surfaceSoup(h: number, sigma: number): Float32Array {
  const n = Math.round(40 / h)
  const rand = mulberry32(7)
  const z = new Float32Array((n + 1) * (n + 1))
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) z[j * (n + 1) + i] = surface(i * h, j * h) + sigma * gaussian(rand)
  const out: number[] = []
  const p = (i: number, j: number) => [i * h, j * h, z[j * (n + 1) + i]]
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      out.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1))
      out.push(...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1))
    }
  }
  return Float32Array.from(out)
}

describe('height levels from the flat cells', () => {
  it('keeps two tiers a ramp joins apart, the ramp and the slope counted as sloped', () => {
    const cell = 0.5
    const cols = 80
    const rows = 80
    const rand = mulberry32(3)
    const g = new Float32Array(cols * rows)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g[r * cols + c] = surface((c + 0.5) * cell, (r + 0.5) * cell) + 0.007 * gaussian(rand)
    const grid = { cols, cell, u0: 0, v0: 0 }

    // Every cell counted: the slope's steps are the noise, the gap a third
    // of a millimetre and more, and the tiers one level.
    const before = heightLevels(g, grid, Math.max(3 * cellNoise(g, cols, rows), 0.02))
    expect(before.gap).toBeGreaterThan(0.3)
    const low = before.levels.find((l) => l.range[0] <= 0.05 && l.range[1] >= -0.05)!
    expect(low.range[1]).toBeGreaterThan(STEP)

    const steep = slopedCells(g, cols, rows, cell, 10)
    const flat = g.slice()
    let sloped = 0
    let onRamp = 0
    for (let i = 0; i < g.length; i++) {
      if (!steep[i]) continue
      flat[i] = Number.NaN
      sloped++
      const x = ((i % cols) + 0.5) * cell
      const y = (Math.floor(i / cols) + 0.5) * cell
      if (y < 16 && x > 15 && x < 19) onRamp++
    }
    // The slope's cells all but the odd one on its edge whose neighbour on
    // a tier happens to be level with it, and the ramp's steep middle: of
    // its 8 columns over 32 rows the 6 between about 15.3 and 18.7 mm (the
    // row beside the slope may find a level neighbour there too).
    expect(sloped - onRamp).toBeGreaterThan(0.99 * 48 * cols)
    expect(onRamp).toBeGreaterThanOrEqual(6 * 31)
    expect(onRamp).toBeLessThanOrEqual(8 * 32)
    // No cell of either tier away from the ramp is taken for sloped.
    for (let r = 0; r < 32; r++) for (let c = 0; c < cols; c++) if (c < 28 || c > 40) expect(steep[r * cols + c]).toBe(0)

    const noise = cellNoise(flat, cols, rows)
    expect(noise).toBeLessThan(0.015)
    const after = heightLevels(flat, grid, Math.max(3 * noise, 0.02))
    expect(after.levels).toHaveLength(2)
    const heights = after.levels.map((l) => l.height).sort((a, b) => a - b)
    expect(heights[0]).toBeCloseTo(0, 1)
    expect(heights[1]).toBeCloseTo(STEP, 1)
    expect(heights[1] - heights[0]).toBeCloseTo(STEP, 1)
  })
})

describe('scan.heightmap levels on a noisy scan', () => {
  let headless: Headless
  beforeAll(async () => {
    headless = await startHeadless()
    await run('scan.open', { bytes: stlBytes(surfaceSoup(0.25, 0.007)), name: 'tiers-and-slope.stl', discard: true })
  })
  afterAll(() => headless.stop())

  interface Levels {
    slopeDeg: number
    sloped: number
    noise: number
    gap: number
    levels: { height: number; sigma: number; cells: number }[]
    unassigned: number
  }

  it('reads the two tiers 1.41 mm apart as two levels', async () => {
    const m = await run<Levels>('scan.heightmap', { levels: true, cell: 0.5 })
    expect(m.slopeDeg).toBe(10)
    expect(m.sloped).toBeGreaterThan(0.5 * 80 * 80)
    expect(m.noise).toBeLessThan(0.02)
    const tiers = m.levels.slice(0, 2).map((l) => l.height).sort((a, b) => a - b)
    expect(tiers[0]).toBeCloseTo(0, 1)
    expect(tiers[1]).toBeCloseTo(STEP, 1)
    for (const l of m.levels.slice(0, 2)) expect(l.sigma).toBeLessThan(0.05)
    // Every cell counted, as before: one level across both tiers.
    const all = await run<Levels>('scan.heightmap', { levels: true, cell: 0.5, slopeDeg: 90 })
    expect(all.sloped).toBe(0)
    expect(all.levels.some((l) => l.cells > 0 && l.sigma > 0.3)).toBe(true)
  })

  it('refuses slopeDeg off the levels of a height', async () => {
    expect((await refused('scan.heightmap', { slopeDeg: 5 })).code).toBe('invalid_input')
    expect((await refused('scan.heightmap', { levels: true, of: 'relief', slopeDeg: 5 })).code).toBe('invalid_input')
  })
})
