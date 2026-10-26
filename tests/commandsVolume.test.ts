// SPDX-License-Identifier: AGPL-3.0-only
// deviation.volume: refused before there is an aligned reference; on a
// reference with a block the scan lacks, the block comes back as excess of
// about its volume, a lump, with its box; within a box away from it, nothing.
// In the in-process worker (see commandKit.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { useDeviation } from '../src/state/deviationStore'
import { boxMesh } from './helpers'
import { refused, run, startHeadless, stlBytes, undoLabels, type Headless } from './commandKit'

vi.setConfig({ testTimeout: 180_000 })

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

/** The 40 mm box with a 10 × 10 × 6 block on its top, sunk 1 mm in: 500 mm³
 *  standing out of it. */
function boxWithBlock(): Float32Array {
  const box = boxMesh(40, 40)
  const block = boxMesh(10, 10).map((v, i) => (i % 3 === 2 ? v * 0.6 + 22 : v))
  const both = new Float32Array(box.length + block.length)
  both.set(box)
  both.set(block, box.length)
  return both
}

type V3 = [number, number, number]
type Volume = {
  tolerance: number
  cell: number
  smallestSeen: number
  modelVolume: number
  totals: Record<'excess' | 'missing' | 'unsure', { volume: number; share: number }>
  found: number
  regions: { kind: string; volume: number; maxDepth: number; thickness: number; shape: string; centroid: V3; deepest: V3; box: { min: V3; max: V3 }; evidence: number; confidence: number }[]
  seconds: number
}

describe('deviation.volume', () => {
  it('finds material the reference has and the scan has not, as a region of its volume', async () => {
    await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box.stl', discard: true })
    expect((await refused('deviation.volume')).code).toBe('invalid_state')
    await run('deviation.open_reference', { bytes: stlBytes(boxWithBlock()), name: 'boss.stl' })
    expect((await refused('deviation.volume')).code).toBe('invalid_state')
    await run('deviation.align', { mode: 'points', pairs: [[20, 20, 20], [-20, 20, 20], [20, -20, 20], [20, 20, -20]].map((c) => ({ scan: c, reference: c })) })
    const before = undoLabels().length

    const v = await run<Volume>('deviation.volume', { cell: 0.5, regions: 3 })
    expect(v.cell).toBe(0.5)
    expect(v.smallestSeen).toBe(1)
    expect(v.modelVolume).toBeGreaterThan(64000 * 0.97)
    const r = v.regions[0]
    expect(r.kind).toBe('excess')
    expect(r.volume).toBeGreaterThan(500 * 0.85)
    expect(r.volume).toBeLessThan(500 * 1.15)
    expect(r.shape).toBe('lump')
    expect(r.maxDepth).toBeGreaterThan(2)
    expect(r.box.min[2]).toBeGreaterThan(19.5)
    expect(r.box.max[2]).toBeLessThan(25.5)
    expect(v.totals.excess.volume).toBeCloseTo(r.volume, 0)
    expect(v.totals.missing.volume).toBeLessThan(25)
    expect(v.regions.length).toBeLessThanOrEqual(3)
    // Shown in the workspace, and no step of the history.
    expect(useDeviation.getState().volume).not.toBeNull()
    expect(undoLabels().length).toBe(before)

    // Only the missing asked for: the block is not named, the totals stand.
    const m = await run<Volume>('deviation.volume', { cell: 0.5, kinds: ['missing'] })
    expect(m.regions.every((x) => x.kind === 'missing')).toBe(true)
    expect(m.totals.excess.volume).toBeCloseTo(v.totals.excess.volume, 0)

    // Within a box under the part's bottom, away from the block: nothing.
    const w = await run<Volume>('deviation.volume', { cell: 0.5, within: { min: [-25, -25, -25], max: [25, 25, -10] } })
    expect(w.totals.excess.volume).toBeLessThan(5)
    expect((await refused('deviation.volume', { within: { min: [0, 0, 0], max: [0, 1, 1] } })).code).toBe('invalid_input')
    expect((await refused('deviation.volume', { regions: 0 })).code).toBe('invalid_input')
  })
})
