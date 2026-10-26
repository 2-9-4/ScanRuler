// SPDX-License-Identifier: AGPL-3.0-only
// The ramps a height map's levels leave out, said: a recess 2.5 mm deep
// whose floor meets the face round it by wide rounded ramps — a third of
// the map sloped, the two tiers alone saying nothing of how they meet —
// and a face that runs up into a slope at its edge, a ramp off one tier
// that meets no other. Two tiers a short step joins say nothing more. On
// the grid, then the recess as a noisy scan in the in-process worker.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../src/core/fit/ransac'
import { cellNoise, heightLevels, rampsOf, slopedCells } from '../src/core/geometry/heightGrid'
import { gaussian } from './helpers'
import { run, startHeadless, stlBytes, type Headless } from './commandKit'

vi.setConfig({ testTimeout: 120_000 })

const DEPTH = 2.5

/** A recess across a 40 × 20 mm face: the floor DEPTH down from x 12 to
 *  28, a cosine ramp 8 mm wide each side of it. */
function recess(x: number): number {
  if (x <= 4 || x >= 36) return 0
  if (x >= 12 && x <= 28) return -DEPTH
  const t = x < 12 ? (x - 4) / 8 : (36 - x) / 8
  return (-DEPTH * (1 - Math.cos(Math.PI * t))) / 2
}

/** The face level to x 36, then rising at 30° to its edge at 40. */
const offEdge = (x: number) => (x <= 36 ? 0 : (x - 36) * Math.tan(Math.PI / 6))

/** Two tiers 1.5 mm apart, a step between them a millimetre wide. */
const step = (x: number) => (x <= 19.5 ? 0 : x >= 20.5 ? 1.5 : 1.5 * (x - 19.5))

/** The levels and the ramps of f over 40 × 20 mm in 0.5 mm cells, a few
 *  microns of noise on it. */
function read(f: (x: number) => number) {
  const cell = 0.5
  const cols = 80
  const rows = 40
  const rand = mulberry32(5)
  const g = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g[r * cols + c] = f((c + 0.5) * cell) + 0.005 * gaussian(rand)
  const steep = slopedCells(g, cols, rows, cell, 10)
  const flat = g.slice()
  for (let i = 0; i < g.length; i++) if (steep[i]) flat[i] = Number.NaN
  const found = heightLevels(flat, { cols, cell, u0: 0, v0: 0 }, Math.max(3 * cellNoise(flat, cols, rows), 0.02))
  return { found, ramps: rampsOf(g, steep, { cols, rows, cell, u0: 0, v0: 0 }, found.levels) }
}

describe('the ramps between a height map’s tiers', () => {
  it('finds a recess’s two ramps, each joining the floor to the face round it', () => {
    const { found, ramps } = read(recess)
    // The floor and the face are the two largest; the ramps' gentle ends
    // may read as thin levels between them.
    expect(found.levels.slice(0, 2).map((l) => l.height).sort((a, b) => a - b)).toEqual([expect.closeTo(-DEPTH, 1), expect.closeTo(0, 1)])
    expect(ramps.sloped / ramps.valued).toBeGreaterThan(0.25)
    expect(ramps.ramps).toHaveLength(2)
    for (const r of ramps.ramps) {
      expect(r.joins).toEqual([expect.closeTo(-DEPTH, 0), expect.closeTo(0, 0)])
      expect(r.box.min[1]).toBe(0)
      expect(r.box.max[1]).toBe(20)
    }
    const [a, b] = [...ramps.ramps].sort((p, q) => p.box.min[0] - q.box.min[0])
    expect(a.box.min[0]).toBeGreaterThan(4)
    expect(a.box.max[0]).toBeLessThan(12)
    expect(b.box.min[0]).toBeGreaterThan(28)
  })

  it('finds a ramp off one tier that meets no other, and nothing more between two tiers a step joins', () => {
    const edge = read(offEdge).ramps
    expect(edge.sloped / edge.valued).toBeLessThan(0.2)
    expect(edge.ramps).toHaveLength(1)
    expect(edge.ramps[0].joins).toEqual([expect.closeTo(0, 1)])
    const stepped = read(step).ramps
    expect(stepped.sloped / stepped.valued).toBeLessThan(0.05)
    for (const r of stepped.ramps) expect(r.joins).toHaveLength(2)
  })
})

/** f over 40 × 20 mm as a triangle soup at `h` mm, noisy by sigma. */
function soup(f: (x: number) => number, h: number, sigma: number): Float32Array {
  const nx = Math.round(40 / h)
  const ny = Math.round(20 / h)
  const rand = mulberry32(9)
  const z = new Float32Array((nx + 1) * (ny + 1))
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) z[j * (nx + 1) + i] = f(i * h) + sigma * gaussian(rand)
  const out: number[] = []
  const p = (i: number, j: number) => [i * h, j * h, z[j * (nx + 1) + i]]
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      out.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1))
      out.push(...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1))
    }
  }
  return Float32Array.from(out)
}

describe('scan.heightmap levels on a recess', () => {
  let headless: Headless
  beforeAll(async () => {
    headless = await startHeadless()
    await run('scan.open', { bytes: stlBytes(soup(recess, 0.25, 0.005)), name: 'recess.stl', discard: true })
  })
  afterAll(() => headless.stop())

  it('says the ramps between the tiers, and where they are', async () => {
    const m = await run<{ levels: { height: number }[]; ramps?: { note: string; found: number; largest: { cells: number; box: { min: number[]; max: number[] }; joins: number[] }[] } }>('scan.heightmap', { levels: true, cell: 0.5 })
    expect(m.levels.slice(0, 2).map((l) => l.height).sort((a, b) => a - b)).toEqual([expect.closeTo(-DEPTH, 1), expect.closeTo(0, 1)])
    expect(m.ramps?.note).toMatch(/^ramps between tiers \(sloped \d+ %\) — a section along them gives their profile$/)
    expect(Number(/sloped (\d+) %/.exec(m.ramps!.note)![1])).toBeGreaterThan(20)
    expect(m.ramps!.largest.length).toBeGreaterThanOrEqual(2)
    for (const r of m.ramps!.largest.slice(0, 2)) expect(r.joins).toEqual([expect.closeTo(-DEPTH, 0), expect.closeTo(0, 0)])
  })
})
