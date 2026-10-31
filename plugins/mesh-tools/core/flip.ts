// SPDX-License-Identifier: AGPL-3.0-only
// Flip normals: triangles turned over. Which way a triangle faces is the
// order of its corners — anticlockwise seen from the side it faces — so two
// of them swapped turn it over, and the normals of its vertices with it once
// the mesh is read again. Nothing moves and no vertex goes: each keeps its
// number, and whatever is marked on the scan by vertex stays where it was.

import type { EditedMesh } from './edit'

/**
 * The mesh with its triangles turned over — every one, or those `mask`
 * marks 1 — and how many were. Copies: the worker hands its answer over,
 * and the mesh it holds stays its own.
 */
export function flipTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  mask?: Uint8Array,
): EditedMesh & { flipped: number } {
  const out = indices.slice()
  let flipped = 0
  for (let t = 0; t < out.length; t += 3) {
    if (mask && !mask[t / 3]) continue
    const b = out[t + 1]
    out[t + 1] = out[t + 2]
    out[t + 2] = b
    flipped++
  }
  const vertexMap = new Int32Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) vertexMap[v] = v
  return { positions: positions.slice(0, vertexCount * 3), indices: out, vertexMap, flipped }
}
