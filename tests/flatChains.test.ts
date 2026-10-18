// SPDX-License-Identifier: AGPL-3.0-only
// Edge chains told about by number — length, closure, box, the nearest point
// and a thinned polyline, in document units — and the snap index saying
// which chain a point is on.
import { describe, expect, it } from 'vitest'
import { chainEnters, chainNearest, chainPoints, chainPolyline, chainSummary, chainTotal } from '../src/core/flat/chains'
import type { EdgeChains } from '../src/core/flat/edges'
import { EdgeIndex } from '../src/core/flat/snap'

// A straight run of eleven pixels, and a square loop that ends a pixel short
// of where it began, as a traced loop does.
const chains: EdgeChains = {
  points: new Float32Array([
    0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 0, 10, 0,
    20, 20, 25, 20, 30, 20, 30, 25, 30, 30, 25, 30, 20, 30, 20, 25, 20, 21,
  ]),
  offsets: new Uint32Array([0, 11, 20]),
}
const mm = { x: 0.1, y: 0.2 }

describe('edge chains by number', () => {
  it('reads each chain’s length, closure and box in document units', () => {
    expect(chainTotal(chains)).toBe(2)
    expect(chainSummary(chains, 0, mm, 2)).toEqual({ id: 0, points: 11, length: 1, closed: false, box: { min: [0, 0], max: [1, 0] } })
    const loop = chainSummary(chains, 1, mm, 2)
    expect(loop.closed).toBe(true)
    expect(loop.box.min[0]).toBeCloseTo(2)
    expect(loop.box.max[1]).toBeCloseTo(6)
    // A section's loop closes only on its first point repeated.
    expect(chainSummary(chains, 1, mm, 1e-9).closed).toBe(false)
  })

  it('finds a chain’s nearest point, whether it enters a box, and its points', () => {
    const near = chainNearest(chains, 0, { x: 1, y: 1 }, [4.2, 3])
    expect(near.at).toEqual([4, 0])
    expect(near.distance).toBeCloseTo(Math.hypot(0.2, 3))
    expect(chainEnters(chains, 1, { x: 1, y: 1 }, { min: [24, 29], max: [26, 31] })).toBe(true)
    expect(chainEnters(chains, 1, { x: 1, y: 1 }, { min: [22, 22], max: [28, 28] })).toBe(false)
    expect(chainPoints(chains, 0, mm)[10]).toEqual([1, 0])
  })

  it('thins a chain to a tolerance in document units', () => {
    expect(chainPolyline(chains, 0, mm, 0.01)).toEqual([[0, 0], [1, 0]])
    expect(chainPolyline(chains, 1, { x: 1, y: 1 }, 0.1)).toEqual([[20, 20], [30, 20], [30, 30], [20, 30], [20, 21]])
  })

  it('the snap index says which chain the nearest point is on, and how far', () => {
    const index = new EdgeIndex(chains)
    expect(index.nearestOnChain(26, 31, 3)).toEqual({ at: [25, 30], chain: 1, distance: Math.SQRT2 })
    expect(index.nearestOnChain(5, 1, 2)).toMatchObject({ at: [5, 0], chain: 0 })
    expect(index.nearestOnChain(15, 10, 3)).toBeNull()
  })
})
