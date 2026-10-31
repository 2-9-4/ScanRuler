// SPDX-License-Identifier: AGPL-3.0-only
// The scan's pieces, its islands, and the scan without them.
//
// Scans come with islands: stray patches of the turntable, a fleck of dust,
// spray floating off the part — each a piece of surface joined to nothing
// else. They throw every whole-part reading: the box the view is framed on,
// the directions an automatic alignment reads off the part, a best fit that
// reaches for them, a light mesh for CAD that carries them along.
//
// A piece is an island by its size, not by being anything but the largest: a
// scan is often several real pieces — the two balls of a ball bar and the rod
// between them — and a size in millimetres says which are specks.

import { round125 } from './reduce'
import { vertexComponents } from '../../../src/core/geometry/unionFind'

export interface PieceSurvey {
  /** Connected pieces in the scan. */
  pieces: number
  /** Of them, the islands: the ones smaller across than the size asked. */
  islands: number
  islandTriangles: number
  /** Across the largest island, and across the smallest piece that stays,
   *  mm — how much room the size has either side of it. Null where there is
   *  no such piece. */
  largestIsland: number | null
  smallestKept: number | null
  /** 1 for every triangle on an island. */
  islandMask: Uint8Array
  /** The middle of each island's bounding box, three floats apiece — where
   *  the viewport marks it. */
  islandCentres: Float32Array
}

/** The size under which a piece is an island of scan debris rather than part: a
 *  hundredth of the part's diagonal, on the 1-2-5 steps. */
export function defaultMinPiece(bboxDiagonal: number): number {
  return round125(bboxDiagonal * 0.01)
}

/**
 * Every connected piece of the mesh and how big it is — a piece whose
 * bounding box is smaller than `minSize` across is an island.
 */
export function surveyPieces(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  minSize: number,
): PieceSurvey {
  // Union-find over the vertices, each triangle joining its three corners.
  const { find } = vertexComponents(indices, vertexCount)

  // Each piece's bounding box, kept at its root.
  const box = new Float64Array(vertexCount * 6)
  const seen = new Uint8Array(vertexCount)
  for (let t = 0; t < indices.length; t++) {
    const v = indices[t]
    const root = find(v)
    const r = root * 6
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2]
    if (!seen[root]) {
      seen[root] = 1
      box[r] = box[r + 3] = x
      box[r + 1] = box[r + 4] = y
      box[r + 2] = box[r + 5] = z
      continue
    }
    if (x < box[r]) box[r] = x
    if (y < box[r + 1]) box[r + 1] = y
    if (z < box[r + 2]) box[r + 2] = z
    if (x > box[r + 3]) box[r + 3] = x
    if (y > box[r + 4]) box[r + 4] = y
    if (z > box[r + 5]) box[r + 5] = z
  }

  const small = new Uint8Array(vertexCount)
  const centres: number[] = []
  let pieces = 0
  let islands = 0
  let largestIsland: number | null = null
  let smallestKept: number | null = null
  for (let v = 0; v < vertexCount; v++) {
    if (!seen[v]) continue
    pieces++
    const r = v * 6
    const size = Math.hypot(box[r + 3] - box[r], box[r + 4] - box[r + 1], box[r + 5] - box[r + 2])
    if (size < minSize) {
      small[v] = 1
      islands++
      centres.push((box[r] + box[r + 3]) / 2, (box[r + 1] + box[r + 4]) / 2, (box[r + 2] + box[r + 5]) / 2)
      if (largestIsland === null || size > largestIsland) largestIsland = size
    } else if (smallestKept === null || size < smallestKept) {
      smallestKept = size
    }
  }

  const islandMask = new Uint8Array(indices.length / 3)
  let islandTriangles = 0
  for (let t = 0; t < islandMask.length; t++) {
    if (!small[find(indices[t * 3])]) continue
    islandMask[t] = 1
    islandTriangles++
  }
  const islandCentres = new Float32Array(centres)
  return { pieces, islands, islandTriangles, largestIsland, smallestKept, islandMask, islandCentres }
}

/** The triangles `mask` marks, as a soup of corner coordinates — nine floats
 *  a triangle — for the viewport to show them by. */
export function maskedTriangles(positions: Float32Array, indices: Uint32Array, mask: Uint8Array): Float32Array {
  let n = 0
  for (let t = 0; t < mask.length; t++) n += mask[t]
  const out = new Float32Array(n * 9)
  let o = 0
  for (let t = 0; t < mask.length; t++) {
    if (!mask[t]) continue
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k] * 3
      out[o++] = positions[v]
      out[o++] = positions[v + 1]
      out[o++] = positions[v + 2]
    }
  }
  return out
}

/**
 * The mesh without the triangles `drop` marks, on the vertices the rest still
 * use. The vertices keep their order — each one's new number is its rank
 * among those kept — and `vertexMap` takes every old number to its new one,
 * or to −1 for a vertex that went: whatever was marked on the scan by vertex
 * follows it across.
 */
export function withoutTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  drop: Uint8Array,
): { positions: Float32Array; indices: Uint32Array; vertexMap: Int32Array } {
  // Every vertex a kept triangle uses marked with 0, then numbered in order.
  const vertexMap = new Int32Array(vertexCount).fill(-1)
  let kept = 0
  for (let t = 0; t < drop.length; t++) {
    if (drop[t]) continue
    kept++
    for (let k = 0; k < 3; k++) vertexMap[indices[t * 3 + k]] = 0
  }
  let n = 0
  for (let v = 0; v < vertexCount; v++) if (vertexMap[v] === 0) vertexMap[v] = n++
  const outPositions = new Float32Array(n * 3)
  for (let v = 0; v < vertexCount; v++) {
    const w = vertexMap[v]
    if (w < 0) continue
    outPositions[w * 3] = positions[v * 3]
    outPositions[w * 3 + 1] = positions[v * 3 + 1]
    outPositions[w * 3 + 2] = positions[v * 3 + 2]
  }
  const outIndices = new Uint32Array(kept * 3)
  let o = 0
  for (let t = 0; t < drop.length; t++) {
    if (drop[t]) continue
    outIndices[o++] = vertexMap[indices[t * 3]]
    outIndices[o++] = vertexMap[indices[t * 3 + 1]]
    outIndices[o++] = vertexMap[indices[t * 3 + 2]]
  }
  return { positions: outPositions, indices: outIndices, vertexMap }
}

export { remapVertices } from '../../../src/core/geometry/remap'
