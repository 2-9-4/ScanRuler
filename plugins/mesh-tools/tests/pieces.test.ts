// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { parsePLY } from '../../../src/core/parsers/ply'
import {
  defaultMinPiece,
  maskedTriangles,
  remapVertices,
  surveyPieces,
  withoutTriangles,
} from '../core/pieces'
import { buildBinaryPly } from '../core/plyWriter'
import type { MeshGraph } from '../../../src/core/types'
import { boxMesh } from '../../../tests/helpers'

/** Triangle soups side by side, as one scan of several pieces. */
function soup(...parts: Float32Array[]): MeshGraph {
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return buildMeshGraph({ kind: 'soup', positions: all })
}

function shifted(positions: Float32Array, dx: number): Float32Array {
  const out = Float32Array.from(positions)
  for (let i = 0; i < out.length; i += 3) out[i] += dx
  return out
}

/** A part — a box 10 across — and an island of debris 0.5 across beside it. */
const partAndSpeck = () => soup(boxMesh(10, 4), shifted(boxMesh(0.5, 2), 30))
const SPECK_TRIANGLES = 6 * 2 * 2 * 2

describe('the default size', () => {
  it('takes a piece under a hundredth of the part for an island of debris, on 1-2-5 steps', () => {
    expect(defaultMinPiece(166.5)).toBe(2)
    expect(defaultMinPiece(231.7)).toBe(5)
    expect(defaultMinPiece(50)).toBe(0.5)
    for (const d of [3, 17, 42.5, 99, 250, 777, 4000]) expect(String(defaultMinPiece(d))).toMatch(/^\d+(\.\d{1,6})?$/)
  })
})

describe('surveying the pieces', () => {
  it('finds the islands, smaller than the size across, and how much room the size has', () => {
    const graph = partAndSpeck()
    const s = surveyPieces(graph.positions, graph.indices, graph.vertexCount, 2)
    expect(s).toMatchObject({ pieces: 2, islands: 1, islandTriangles: SPECK_TRIANGLES })
    expect(s.largestIsland).toBeCloseTo(0.5 * Math.sqrt(3), 5)
    expect(s.smallestKept).toBeCloseTo(10 * Math.sqrt(3), 5)
    // The mask marks the speck's triangles and nothing else.
    for (let t = 0; t < graph.triangleCount; t++) {
      expect(s.islandMask[t]).toBe(graph.positions[graph.indices[t * 3] * 3] > 20 ? 1 : 0)
    }
    // And its middle, where the viewport rings it.
    expect(Array.from(s.islandCentres)).toEqual([30, 0, 0])
  })

  it('keeps several pieces that are each large enough — not just the largest', () => {
    const graph = soup(boxMesh(10, 4), shifted(boxMesh(8, 4), 30))
    const s = surveyPieces(graph.positions, graph.indices, graph.vertexCount, 2)
    expect(s).toMatchObject({ pieces: 2, islands: 0, islandTriangles: 0, largestIsland: null })
    expect(s.islandCentres.length).toBe(0)
  })

  it('hands the island triangles over as corner coordinates to show', () => {
    const graph = partAndSpeck()
    const s = surveyPieces(graph.positions, graph.indices, graph.vertexCount, 2)
    const soupOf = maskedTriangles(graph.positions, graph.indices, s.islandMask)
    expect(soupOf.length).toBe(SPECK_TRIANGLES * 9)
    for (let i = 0; i < soupOf.length; i += 3) expect(soupOf[i]).toBeGreaterThan(29)
  })
})

describe('removing them', () => {
  it('keeps the rest on the vertices it uses, in their order, and says where each went', () => {
    const graph = partAndSpeck()
    const s = surveyPieces(graph.positions, graph.indices, graph.vertexCount, 2)
    const kept = withoutTriangles(graph.positions, graph.indices, graph.vertexCount, s.islandMask)
    expect(kept.indices.length / 3).toBe(graph.triangleCount - SPECK_TRIANGLES)
    let next = 0
    for (let v = 0; v < graph.vertexCount; v++) {
      const w = kept.vertexMap[v]
      if (graph.positions[v * 3] > 20) {
        expect(w).toBe(-1)
        continue
      }
      // Ranked in order, and the same point.
      expect(w).toBe(next++)
      expect(Array.from(kept.positions.subarray(w * 3, w * 3 + 3))).toEqual(Array.from(graph.positions.subarray(v * 3, v * 3 + 3)))
    }
    expect(kept.positions.length / 3).toBe(next)
    // Every kept triangle is the same triangle, renumbered.
    let o = 0
    for (let t = 0; t < graph.triangleCount; t++) {
      if (s.islandMask[t]) continue
      for (let k = 0; k < 3; k++) expect(kept.indices[o++]).toBe(kept.vertexMap[graph.indices[t * 3 + k]])
    }
  })

  it('renumbers a marked set of vertices, leaving out the ones that went', () => {
    const map = Int32Array.from([0, -1, 1, 2, -1, 3])
    expect(Array.from(remapVertices(Uint32Array.from([0, 1, 3, 4, 5]), map))).toEqual([0, 2, 3])
    // A number past the scan it was marked on is no vertex of it.
    expect(Array.from(remapVertices(Uint32Array.from([2, 99]), map))).toEqual([1])
  })
})

describe('the edited scan as a PLY', () => {
  it('reads back vertex for vertex, in the order it was written', () => {
    const graph = partAndSpeck()
    const s = surveyPieces(graph.positions, graph.indices, graph.vertexCount, 2)
    const kept = withoutTriangles(graph.positions, graph.indices, graph.vertexCount, s.islandMask)
    const bytes = buildBinaryPly(kept.positions, kept.indices, 'part.stl, edited in ScanRuler — ✓')
    const parsed = parsePLY(bytes.slice().buffer)
    expect(parsed.kind).toBe('indexed')
    expect(Array.from(parsed.positions)).toEqual(Array.from(kept.positions))
    expect(Array.from(parsed.indices!)).toEqual(Array.from(kept.indices))
    // And the scan built on it is the scan that was kept: nothing welded,
    // nothing reordered.
    const again = buildMeshGraph(parsed)
    expect(again.vertexCount).toBe(kept.positions.length / 3)
    expect(Array.from(again.indices)).toEqual(Array.from(kept.indices))
    // The comment is one line of plain text in the header.
    const header = new TextDecoder().decode(bytes.subarray(0, 200))
    expect(header).toContain('comment part.stl, edited in ScanRuler ? ?\n')
  })

  it('keeps the winding of what a delete leaves, where a guess would turn it inside out', () => {
    // A round wall, 80 mm across the inside, 5 mm thick and 4 mm high —
    // closed, wound outward — and of it, kept: its top and its inner face
    // over a sixth of the way round. Open on every side, that strip curves
    // round its own inside, and reads as inside-out to the guess.
    const n = 64
    const R = 80, w = 5, h = 4
    const corners = [[R, 0], [R + w, 0], [R + w, -h], [R, -h]]
    const positions = new Float32Array(n * 4 * 3)
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n
      corners.forEach(([r, z], k) => positions.set([r * Math.cos(a), r * Math.sin(a), z], (i * 4 + k) * 3))
    }
    // Side k of the section runs from corner k to the next: top, outside,
    // bottom, inside.
    const indices: number[] = []
    const side: number[] = []
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 4 + k, b = i * 4 + ((k + 1) % 4)
        const c = ((i + 1) % n) * 4 + k, d = ((i + 1) % n) * 4 + ((k + 1) % 4)
        indices.push(a, b, c, b, d, c)
        side.push(k, k)
      }
    }
    const wall = buildMeshGraph({ kind: 'indexed', positions, indices: Uint32Array.from(indices) })
    expect(Array.from(wall.indices)).toEqual(indices)
    const drop = Uint8Array.from(side, (k, t) => (Math.floor(t / 8) < n / 6 && (k === 0 || k === 3) ? 0 : 1))
    const kept = withoutTriangles(wall.positions, wall.indices, wall.vertexCount, drop)
    // Guessed afresh, the strip would be turned.
    expect(Array.from(buildMeshGraph({ kind: 'indexed', positions: kept.positions.slice(), indices: kept.indices.slice() }).indices)).not.toEqual(
      Array.from(kept.indices),
    )
    // Kept as a PLY and read back, it is wound as the wall was: its top faces up.
    const again = buildMeshGraph(parsePLY(buildBinaryPly(kept.positions, kept.indices, 'wall.stl').slice().buffer))
    expect(Array.from(again.indices)).toEqual(Array.from(kept.indices))
    for (let v = 0; v < again.vertexCount; v++) if (again.positions[v * 3 + 2] === 0) expect(again.normals[v * 3 + 2]).toBeGreaterThan(0)
  })
})
