// SPDX-License-Identifier: AGPL-3.0-only
// A mesh's triangles as corners: each face's normal and area, the corners
// round a vertex in order, the corner across an edge, and the points on an
// open rim.

/** A triangle whose height is under this share of its longest edge is a
 *  sliver: its normal is the rounding's, not the surface's, and it says
 *  nothing of which way a point is to move. */
const SLIVER_SHAPE = 0.02

/** Each triangle's unit normal — none for a sliver — and the angle at each
 *  of its corners. */
export function faceGeometry(positions: Float32Array, indices: Uint32Array): { normals: Float32Array; angles: Float32Array } {
  const triangles = indices.length / 3
  const normals = new Float32Array(triangles * 3)
  const angles = new Float32Array(indices.length)
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2]
    const bcx = positions[c] - positions[b], bcy = positions[c + 1] - positions[b + 1], bcz = positions[c + 2] - positions[b + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    const len = Math.hypot(nx, ny, nz)
    // A sliver's normal is left at nothing: at the corner where it is all
    // but straight it has the most angle of any face, and would turn the
    // point the way its rounding happens to point.
    const longest = Math.max(abx * abx + aby * aby + abz * abz, acx * acx + acy * acy + acz * acz, bcx * bcx + bcy * bcy + bcz * bcz)
    if (len > SLIVER_SHAPE * longest) {
      normals[t * 3] = nx / len
      normals[t * 3 + 1] = ny / len
      normals[t * 3 + 2] = nz / len
    }
    angles[t * 3] = Math.atan2(len, abx * acx + aby * acy + abz * acz)
    angles[t * 3 + 1] = Math.atan2(len, -(abx * bcx + aby * bcy + abz * bcz))
    angles[t * 3 + 2] = Math.max(0, Math.PI - angles[t * 3] - angles[t * 3 + 1])
  }
  return { normals, angles }
}

/** Every vertex's triangle corners — `t * 3 + k` — in CSR form. */
export function cornersOf(indices: Uint32Array, vertexCount: number): { offsets: Uint32Array; corners: Uint32Array } {
  const offsets = new Uint32Array(vertexCount + 1)
  for (let i = 0; i < indices.length; i++) offsets[indices[i] + 1]++
  for (let v = 0; v < vertexCount; v++) offsets[v + 1] += offsets[v]
  const corners = new Uint32Array(indices.length)
  const at = offsets.slice(0, vertexCount)
  for (let i = 0; i < indices.length; i++) corners[at[indices[i]]++] = i
  return { offsets, corners }
}

/** The corner after `c` round its triangle. */
export const nextCorner = (c: number) => (c % 3 === 2 ? c - 2 : c + 1)

/** Whether a triangle walks the edge from `b` to `a` — the triangle across
 *  the edge `a`→`b` — and which; −1 for none. */
export function across(a: number, b: number, indices: Uint32Array, offsets: Uint32Array, corners: Uint32Array): number {
  for (let k = offsets[b]; k < offsets[b + 1]; k++) {
    const c = corners[k]
    if (indices[nextCorner(c)] === a) return (c / 3) | 0
  }
  return -1
}

/** The points on the mesh's open edges — a rim — 1 each. */
export function rimPoints(indices: Uint32Array, vertexCount: number, offsets: Uint32Array, corners: Uint32Array): Uint8Array {
  const rim = new Uint8Array(vertexCount)
  for (let c = 0; c < indices.length; c++) {
    const a = indices[c]
    const b = indices[nextCorner(c)]
    if (across(a, b, indices, offsets, corners) < 0) {
      rim[a] = 1
      rim[b] = 1
    }
  }
  return rim
}
