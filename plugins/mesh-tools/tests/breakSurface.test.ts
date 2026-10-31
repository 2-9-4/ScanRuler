// SPDX-License-Identifier: AGPL-3.0-only
// The break a body is cut with: a flat sheet of scan through a 20 mm box —
// the break is the square of it more than the depth inside the box, its rim
// on the line at the depth; a marking narrows it; specks go and two patches
// stay two; and a body that misses the scan is said to.

import { describe, expect, it } from 'vitest'
import { NominalSurface, emptyHit } from '../../../src/core/deviation/surface'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { boxMesh } from '../../../tests/helpers'
import { boundaryLoops } from '../core/boundary'
import { findBreak } from '../core/breakSurface'
import { sheet, joined } from './sheet'

const DEPTH = 0.3

/** The box, ±10 mm each way, as a closed surface to measure against. */
function boxSurface(shift = 0): NominalSurface {
  const g = buildMeshGraph({ kind: 'soup', positions: boxMesh(20, 8) })
  const p = g.positions.slice()
  for (let i = 0; i < p.length; i += 3) p[i] += shift
  return new NominalSurface(p, g.indices)
}

function area(p: Float32Array, idx: Uint32Array): number {
  let a = 0
  for (let t = 0; t < idx.length; t += 3) {
    const i = idx[t] * 3, j = idx[t + 1] * 3, k = idx[t + 2] * 3
    const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2]
    const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2]
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return a
}

describe('the break found in the scan', () => {
  it('is the sheet more than the depth inside the box, its rim on the line at the depth', () => {
    const body = boxSurface()
    const scan = sheet()
    const found = findBreak(scan.positions, scan.indices, scan.vertexCount, body, { depth: DEPTH, minPiece: 1 })
    // A square the depth in from the walls; the top and bottom are 10 mm off.
    const side = 20 - 2 * DEPTH
    expect(found.report.area).toBeCloseTo(side * side, 0)
    expect(area(found.positions, found.indices)).toBeCloseTo(found.report.area, 6)
    expect(found.report.pieces).toBe(1)
    expect(found.report.specks).toBe(0)
    // Every point of it the depth inside at least — the snap, a tenth of an
    // edge, is all it may come short — and its rim one loop at the depth.
    const hit = emptyHit()
    const snap = 0.1 * 0.5 + 1e-4
    const n = found.positions.length / 3
    for (let v = 0; v < n; v++) {
      body.closest(found.positions[v * 3], found.positions[v * 3 + 1], found.positions[v * 3 + 2], hit)
      expect(hit.signed).toBeLessThan(-DEPTH + snap)
    }
    // Off the square's corners, where the distance bends and a straight
    // edge across the bend cannot follow it, by no more than a quarter of
    // an edge.
    const { loops } = boundaryLoops(found.indices, n)
    expect(loops).toHaveLength(1)
    for (const v of loops[0].vertices) {
      const x = found.positions[v * 3], y = found.positions[v * 3 + 1]
      body.closest(x, y, found.positions[v * 3 + 2], hit)
      const corner = Math.abs(x) > side / 2 - 1 && Math.abs(y) > side / 2 - 1
      expect(Math.abs(hit.signed + DEPTH)).toBeLessThan(corner ? 0.25 * 0.5 : snap)
    }
    // The scan's vertices in it are those inside the square, and only those.
    const inside = new Set(found.vertices)
    for (let v = 0; v < scan.vertexCount; v++) {
      const x = Math.abs(scan.positions[v * 3]), y = Math.abs(scan.positions[v * 3 + 1])
      if (x < side / 2 - snap && y < side / 2 - snap) expect(inside.has(v)).toBe(true)
      if (x > side / 2 + snap || y > side / 2 + snap) expect(inside.has(v)).toBe(false)
    }
    for (let i = 1; i < found.vertices.length; i++) expect(found.vertices[i]).toBeGreaterThan(found.vertices[i - 1])
  })

  it('is narrowed to the marking, its rim halfway between marked and unmarked', () => {
    const body = boxSurface()
    const scan = sheet()
    const left: number[] = []
    for (let v = 0; v < scan.vertexCount; v++) if (scan.positions[v * 3] < 0) left.push(v)
    const all = findBreak(scan.positions, scan.indices, scan.vertexCount, body, { depth: DEPTH, minPiece: 1 })
    const found = findBreak(scan.positions, scan.indices, scan.vertexCount, body, { depth: DEPTH, marked: Uint32Array.from(left), minPiece: 1 })
    expect(found.report.marked).toBe(left.length)
    expect(found.report.area).toBeGreaterThan(0.4 * all.report.area)
    expect(found.report.area).toBeLessThan(0.55 * all.report.area)
    // Halfway to the first unmarked vertex at the most: half an edge, and
    // the sheet's scatter.
    for (let v = 0; v < found.positions.length / 3; v++) expect(found.positions[v * 3]).toBeLessThan(0.35)
    for (const v of found.vertices) expect(scan.positions[v * 3]).toBeLessThan(0)
  })

  it('is the break as found when the marking is left as found', () => {
    const body = boxSurface()
    const scan = sheet()
    const found = findBreak(scan.positions, scan.indices, scan.vertexCount, body, { depth: DEPTH, minPiece: 1 })
    const again = findBreak(scan.positions, scan.indices, scan.vertexCount, body, { depth: DEPTH, marked: found.vertices, minPiece: 1 })
    expect(again.report.triangles).toBe(found.report.triangles)
    expect(again.report.area).toBeCloseTo(found.report.area, 9)
    expect(Array.from(again.vertices)).toEqual(Array.from(found.vertices))
  })

  it('drops specks, and keeps two patches as two', () => {
    const body = boxSurface()
    const scan = joined(
      joined(sheet(), sheet({ origin: [0, 0, 5] })),
      // A fleck 1 mm across inside the box.
      sheet({ origin: [3, 3, -5], size: 1, step: 0.25 }),
    )
    const found = findBreak(scan.positions, scan.indices, scan.vertexCount, body, { depth: DEPTH, minPiece: 2 })
    expect(found.report.pieces).toBe(2)
    expect(found.report.specks).toBe(1)
  })

  it('says so when the body misses the scan, or the marking misses the body', () => {
    const scan = sheet()
    expect(() => findBreak(scan.positions, scan.indices, scan.vertexCount, boxSurface(100), { depth: DEPTH, minPiece: 1 })).toThrow(
      /The scan nowhere lies more than 0\.3 mm inside the body/,
    )
    const far: number[] = []
    for (let v = 0; v < scan.vertexCount; v++) if (scan.positions[v * 3] > 15) far.push(v)
    expect(() => findBreak(scan.positions, scan.indices, scan.vertexCount, boxSurface(), { depth: DEPTH, marked: Uint32Array.from(far), minPiece: 1 })).toThrow(
      /Nothing marked lies more than 0\.3 mm inside the body/,
    )
  })
})
