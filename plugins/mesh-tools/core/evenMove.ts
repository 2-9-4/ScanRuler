// SPDX-License-Identifier: AGPL-3.0-only
// Moving a surface along its normals evenly: the normals smoothed over the
// scan's scatter but kept sharp across its edges, and every vertex moved so
// the faces round it move by the distance asked, a corner's too.

import { across } from './meshCorners'
import { meanEdgeLength } from './smooth'

/** The share of the strongest spread of the normals around a point that
 *  another must reach to be a direction of its own: the spread of two faces
 *  30° apart — tan² 15°. Under it, the faces are one surface. */
const EDGE_RATIO = Math.tan((15 * Math.PI) / 180) ** 2

/** No point moves further than this many times the distance — a knife edge
 *  would send it off without end. */
export const MAX_STRETCH = 3

/** Faces turned from each other by more than 30° are either side of an
 *  edge, and their normals are not averaged together. */
const EDGE_COS = Math.cos((30 * Math.PI) / 180)

/** The most rounds the faces' normals are averaged over their neighbours —
 *  as far as about eight triangles across. */
const MAX_NORMAL_PASSES = 64

/**
 * The faces' normals averaged over their neighbours — `passes` rounds of
 * each with those across its edges, an edge of the part, past 30°, never
 * crossed. A scan's own scatter tilts its triangles by a few degrees, and
 * a point moved a millimetre along a normal tilted 3° lands 50 µm aside —
 * more than its neighbours are apart on a fine scan, which turns triangles
 * over. So the further the move, the wider the normals are read: over
 * about as far as it goes, eight triangles at the most.
 */
export function smoothedNormals(
  normals: Float32Array,
  indices: Uint32Array,
  offsets: Uint32Array,
  corners: Uint32Array,
  passes: number,
): Float32Array {
  const triangles = normals.length / 3
  const neighbour = new Int32Array(triangles * 3)
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) neighbour[t * 3 + k] = across(indices[t * 3 + k], indices[t * 3 + ((k + 1) % 3)], indices, offsets, corners)
  }
  // A face turned from every one of its neighbours is a spike of scatter,
  // not an edge — a face beside an edge has its own side's beside it — and
  // takes their mean instead: left as it is, it would be read as an edge and
  // send its corners off square to it.
  const cleaned = normals.slice()
  for (let t = 0; t < triangles; t++) {
    let x = 0, y = 0, z = 0
    let alike = false
    let others = 0
    for (let k = 0; k < 3 && !alike; k++) {
      const u = neighbour[t * 3 + k]
      if (u < 0 || (normals[u * 3] === 0 && normals[u * 3 + 1] === 0 && normals[u * 3 + 2] === 0)) continue
      if (normals[t * 3] * normals[u * 3] + normals[t * 3 + 1] * normals[u * 3 + 1] + normals[t * 3 + 2] * normals[u * 3 + 2] >= EDGE_COS) alike = true
      x += normals[u * 3]
      y += normals[u * 3 + 1]
      z += normals[u * 3 + 2]
      others++
    }
    const len = Math.hypot(x, y, z)
    if (alike || others < 2 || len === 0) continue
    cleaned[t * 3] = x / len
    cleaned[t * 3 + 1] = y / len
    cleaned[t * 3 + 2] = z / len
  }
  // Each face averaged only with those that are one surface with it.
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const u = neighbour[t * 3 + k]
      const same = u >= 0 && cleaned[t * 3] * cleaned[u * 3] + cleaned[t * 3 + 1] * cleaned[u * 3 + 1] + cleaned[t * 3 + 2] * cleaned[u * 3 + 2] >= EDGE_COS
      neighbour[t * 3 + k] = same ? u : -1
    }
  }
  let cur = cleaned
  let next = new Float32Array(normals.length)
  for (let pass = 0; pass < passes; pass++) {
    for (let t = 0; t < triangles; t++) {
      let x = cur[t * 3], y = cur[t * 3 + 1], z = cur[t * 3 + 2]
      for (let k = 0; k < 3; k++) {
        const u = neighbour[t * 3 + k]
        if (u < 0) continue
        x += cur[u * 3]
        y += cur[u * 3 + 1]
        z += cur[u * 3 + 2]
      }
      const len = Math.hypot(x, y, z)
      next[t * 3] = len > 0 ? x / len : 0
      next[t * 3 + 1] = len > 0 ? y / len : 0
      next[t * 3 + 2] = len > 0 ? z / len : 0
    }
    const swap = cur
    cur = next
    next = swap
  }
  return cur
}

/** How many rounds the normals are averaged for a move of `distance`:
 *  averaging spreads as the square root of the rounds, and the reach wanted
 *  is about the move — the square of how many of the mesh's edges it goes,
 *  one at the least. */
export function normalPasses(positions: Float32Array, indices: Uint32Array, distance: number): number {
  const edge = meanEdgeLength(positions, indices)
  return edge > 0 ? Math.min(MAX_NORMAL_PASSES, Math.max(1, Math.round((distance / edge) ** 2))) : 1
}

/**
 * The eigenvalues and unit eigenvectors of a symmetric 3 × 3 matrix, by
 * Jacobi rotations: `a` row-major, overwritten; the values into `w`, the
 * vectors into the columns of `vecs` — `vecs[i * 3 + k]` is the i-th
 * component of the k-th.
 */
function eigenSym3(a: Float64Array, w: Float64Array, vecs: Float64Array): void {
  vecs.fill(0)
  vecs[0] = vecs[4] = vecs[8] = 1
  for (let sweep = 0; sweep < 16; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5]
    const diag = a[0] * a[0] + a[4] * a[4] + a[8] * a[8]
    if (off === 0 || off <= 1e-24 * diag) break
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p * 3 + q]
        if (apq === 0) continue
        const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq)
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < 3; k++) {
          const akp = a[k * 3 + p], akq = a[k * 3 + q]
          a[k * 3 + p] = c * akp - s * akq
          a[k * 3 + q] = s * akp + c * akq
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p * 3 + k], aqk = a[q * 3 + k]
          a[p * 3 + k] = c * apk - s * aqk
          a[q * 3 + k] = s * apk + c * aqk
        }
        for (let k = 0; k < 3; k++) {
          const vkp = vecs[k * 3 + p], vkq = vecs[k * 3 + q]
          vecs[k * 3 + p] = c * vkp - s * vkq
          vecs[k * 3 + q] = s * vkp + c * vkq
        }
      }
    }
  }
  w[0] = a[0]
  w[1] = a[4]
  w[2] = a[8]
}

/** Scratch for evenMove, so it allocates nothing per point. */
const scratch = { m: new Float64Array(9), w: new Float64Array(3), vecs: new Float64Array(9) }

/**
 * The move of vertex `v` that takes each face around it — those `take`
 * passes — `d` along its own normal, as near as one move can: written into
 * `out` at `o`. Zero for a point with no such face.
 */
export function evenMove(
  v: number,
  d: number,
  offsets: Uint32Array,
  corners: Uint32Array,
  normals: Float32Array,
  angles: Float32Array,
  take: Uint8Array | null,
  out: Float32Array,
  o: number,
): void {
  const { m, w, vecs } = scratch
  m.fill(0)
  // Which way the faces around the point face, together: a face turned
  // against that is a fold in the surface — one made by an earlier move, a
  // scan's own — and says nothing of where the point is to go. Taken in, it
  // would cancel the faces either side of it and leave the point behind: a
  // dimple.
  let mx = 0, my = 0, mz = 0
  for (let k = offsets[v]; k < offsets[v + 1]; k++) {
    const c = corners[k]
    const t = (c / 3) | 0
    if (take && !take[t]) continue
    mx += angles[c] * normals[t * 3]
    my += angles[c] * normals[t * 3 + 1]
    mz += angles[c] * normals[t * 3 + 2]
  }
  let bx = 0, by = 0, bz = 0
  let weight = 0
  for (let k = offsets[v]; k < offsets[v + 1]; k++) {
    const c = corners[k]
    const t = (c / 3) | 0
    if (take && !take[t]) continue
    const wt = angles[c]
    const nx = normals[t * 3], ny = normals[t * 3 + 1], nz = normals[t * 3 + 2]
    if (!(wt > 0) || (nx === 0 && ny === 0 && nz === 0) || nx * mx + ny * my + nz * mz <= 0) continue
    m[0] += wt * nx * nx
    m[1] += wt * nx * ny
    m[2] += wt * nx * nz
    m[4] += wt * ny * ny
    m[5] += wt * ny * nz
    m[8] += wt * nz * nz
    bx += wt * nx
    by += wt * ny
    bz += wt * nz
    weight += wt
  }
  out[o] = out[o + 1] = out[o + 2] = 0
  if (weight === 0) return
  m[3] = m[1]
  m[6] = m[2]
  m[7] = m[5]
  eigenSym3(m, w, vecs)
  const top = Math.max(w[0], w[1], w[2])
  let x = 0, y = 0, z = 0
  for (let k = 0; k < 3; k++) {
    if (!(w[k] > EDGE_RATIO * top)) continue
    const ex = vecs[k], ey = vecs[3 + k], ez = vecs[6 + k]
    const f = (ex * bx + ey * by + ez * bz) / w[k]
    x += f * ex
    y += f * ey
    z += f * ez
  }
  x *= d
  y *= d
  z *= d
  const len = Math.hypot(x, y, z)
  const most = MAX_STRETCH * Math.abs(d)
  if (len > most) {
    x *= most / len
    y *= most / len
    z *= most / len
  }
  out[o] = x
  out[o + 1] = y
  out[o + 2] = z
}
