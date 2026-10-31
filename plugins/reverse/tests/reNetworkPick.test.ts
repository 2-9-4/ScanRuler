// SPDX-License-Identifier: AGPL-3.0-only
// Which patch a point of the scan lies on, as the viewport's layer picks
// it from the report's samples: inside a patch, the patch — on a curved
// one too — and beside it, past its rim, none; between two patches that
// share an edge, the one it lies over.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { type NetworkReport, PATCH_GRID } from '../core/networkBody'
import { patchUnder } from '../viewer/networkLayer'

/** A report of patches sampled from (u, v) maps, as the build gives it. */
function reportOf(...maps: ((u: number, v: number) => Vec3)[]): NetworkReport {
  const n = PATCH_GRID
  const patches = maps.map((at) => {
    const grid = new Float32Array(n * n * 3)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) grid.set(at(i / (n - 1), j / (n - 1)), (i * n + j) * 3)
    return { grid }
  })
  return { patches } as unknown as NetworkReport
}

describe('the patch under the cursor', () => {
  const flat = (x0: number) => (u: number, v: number): Vec3 => [x0 + 20 * u, 20 * v, 0]
  const dome = (u: number, v: number): Vec3 => [20 * u, 20 * v, 6 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)]

  it('finds the patch a point lies on, and none beside it', () => {
    const report = reportOf(flat(0), flat(20))
    expect(patchUnder(report, [5, 5, 0.05])).toBe(0)
    expect(patchUnder(report, [25, 15, -0.1])).toBe(1)
    // Past the rim, though nearer the patch than a point above it may be.
    expect(patchUnder(report, [-1, 5, 0])).toBeNull()
    expect(patchUnder(report, [5, 21, 0])).toBeNull()
    // Far above it is no point of it.
    expect(patchUnder(report, [5, 5, 8])).toBeNull()
  })

  it('reads a bent patch by its own surface, not its corners’ plane', () => {
    const report = reportOf(dome)
    expect(patchUnder(report, [10, 10, 6])).toBe(0)
    expect(patchUnder(report, [10, 10, 0])).toBeNull()
  })
})
