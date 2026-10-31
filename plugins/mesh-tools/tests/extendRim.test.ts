// SPDX-License-Identifier: AGPL-3.0-only
// The break carried out past the body: a flat break inside a 20 mm box goes
// on in its own plane until every point of its rim is the margin outside the
// box, its own points kept as they were; a hole in it is closed and only its
// outer rim carried; two patches are carried as two.

import { describe, expect, it } from 'vitest'
import { NominalSurface, emptyHit } from '../../../src/core/deviation/surface'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { boxMesh } from '../../../tests/helpers'
import { closedness } from '../core/boolean'
import { boundaryLoops } from '../core/boundary'
import { findBreak } from '../core/breakSurface'
import { extendRim } from '../core/extendRim'
import { joined, sheet } from './sheet'
import type { TestMesh } from './brokenRing'

const DEPTH = 0.3
const MARGIN = 0.4

function boxSurface(): NominalSurface {
  const g = buildMeshGraph({ kind: 'soup', positions: boxMesh(20, 8) })
  return new NominalSurface(g.positions, g.indices)
}

/** How far the point (x, y) of the plane z = 0 is from the surface's
 *  triangles, seen square to the plane: 0 when one covers it. */
function nearestOnSurface(positions: Float32Array, indices: Uint32Array, x: number, y: number): number {
  let best = Infinity
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    const d = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px)
    const s1 = d(positions[a], positions[a + 1], positions[b], positions[b + 1], x, y)
    const s2 = d(positions[b], positions[b + 1], positions[c], positions[c + 1], x, y)
    const s3 = d(positions[c], positions[c + 1], positions[a], positions[a + 1], x, y)
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0
    for (const v of [a, b, c]) best = Math.min(best, Math.hypot(positions[v] - x, positions[v + 1] - y))
  }
  return best
}

function extended(scan: TestMesh, body: NominalSurface) {
  const found = findBreak(scan.positions, scan.indices, scan.vertexCount, body, { depth: DEPTH, minPiece: 1 })
  const n = found.positions.length / 3
  return { found, n, ...extendRim(found.positions, found.indices, n, body, { margin: MARGIN, deep: found.deep }) }
}

describe('the break carried out past the body', () => {
  it('goes on in its own plane until its rim is the margin outside the body', () => {
    const body = boxSurface()
    const { found, n, positions, indices, report } = extended(sheet(), body)
    const count = positions.length / 3
    // Its own points as they were, numbered as they were.
    expect(Array.from(positions.subarray(0, n * 3))).toEqual(Array.from(found.positions))
    for (let v = 0; v < count; v++) expect(Math.abs(positions[v * 3 + 2])).toBeLessThan(1e-5)
    expect(report.rims).toBe(1)
    expect(report.holes).toBe(0)
    expect(report.rows).toBeGreaterThan(1)
    // The depth back to the wall and the margin past it, along the sides,
    // to within a step of the march — a quarter of the margin here; a little
    // further at the square's corners, which it rounds.
    expect(report.shortest).toBeGreaterThan(DEPTH + MARGIN)
    expect(report.shortest).toBeLessThan(DEPTH + MARGIN + MARGIN / 4 + 1e-6)
    expect(report.longest).toBeLessThan(2)
    // One surface, wound one way, its only open edges the new rim — every
    // point of it outside the box by the margin.
    expect(closedness(indices, count).bad).toBe(0)
    const { loops } = boundaryLoops(indices, count)
    expect(loops).toHaveLength(1)
    const hit = emptyHit()
    for (const v of loops[0].vertices) {
      body.closest(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], hit)
      expect(hit.signed).toBeGreaterThan(MARGIN)
    }
  })

  it('closes a hole in the break and carries only its outer rim', () => {
    const body = boxSurface()
    const { found, positions, indices, report } = extended(sheet({ hole: 3 }), body)
    expect(boundaryLoops(found.indices, found.positions.length / 3).loops).toHaveLength(2)
    expect(report.holes).toBe(1)
    expect(report.rims).toBe(1)
    expect(boundaryLoops(indices, positions.length / 3).loops).toHaveLength(1)
  })

  it('closes a gap in the scan open to the rim, and carries the rim past it', () => {
    // A slot 1 mm wide from the sheet's edge to 5 mm inside the box's wall:
    // the rim along its sides is the scan's own edge, past the depth, and
    // carried out as it is the two sides would run out along the slot and
    // leave it open. Shut across its mouth, it is a hole, closed like one,
    // and the rim goes on past it as it does everywhere else.
    const body = boxSurface()
    const { positions, indices, report } = extended(sheet({ notch: { to: 5, width: 1 } }), body)
    expect(report.bays).toBe(1)
    expect(report.holes).toBe(1)
    expect(report.rims).toBe(1)
    expect(report.longest).toBeLessThan(2)
    const count = positions.length / 3
    expect(closedness(indices, count).bad).toBe(0)
    const { loops } = boundaryLoops(indices, count)
    expect(loops).toHaveLength(1)
    const hit = emptyHit()
    for (const v of loops[0].vertices) {
      body.closest(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], hit)
      expect(hit.signed).toBeGreaterThan(MARGIN)
    }
    // Nothing of it left open across the slot: every point of the slot, in
    // the box, has the surface over it.
    for (let x = 5.25; x < 9.7; x += 0.5) {
      for (const y of [-0.25, 0, 0.25]) expect(nearestOnSurface(positions, indices, x, y)).toBeLessThan(0.05)
    }
  })

  it('carries two patches of break as two', () => {
    const body = boxSurface()
    const { positions, indices, report } = extended(joined(sheet({ origin: [0, 0, -3] }), sheet({ origin: [0, 0, 3], seed: 7 })), body)
    expect(report.rims).toBe(2)
    expect(boundaryLoops(indices, positions.length / 3).loops).toHaveLength(2)
  })
})
