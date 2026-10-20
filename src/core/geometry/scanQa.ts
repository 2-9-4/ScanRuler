// SPDX-License-Identifier: AGPL-3.0-only
// What a scan is like before anything is modelled on it: where it is open,
// how noisy it is, and where the first surface lies along an axis over a
// grid — a height map, and with one from each side the thickness through
// the part. A scan whose faces should be parallel and are a degree apart
// shows it here, before every fit on it misses by the lean.

import * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import { symmetricEigen3 } from '../fit/linalg'
import type { MeshGraph, Vec3 } from '../types'
import { meshGaps, type MeshGap } from './openEdges'

/** A grid of parallel rays: one per cell centre, the cell (c, r) starting
 *  at origin + (c + ½)·cell·u + (r + ½)·cell·v and running along `dir` (a
 *  unit vector square to u and v) for `far` mm. */
export interface RayGrid {
  origin: Vec3
  dir: Vec3
  u: Vec3
  v: Vec3
  cell: number
  cols: number
  rows: number
  far: number
}

/** The two axes across `axis`, in the order a grid lays them. */
export const acrossAxes = (axis: 0 | 1 | 2): [number, number] => (axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1])

/** How far each ray runs to the first surface it meets, row by row (row 0
 *  nearest the origin), NaN where it meets none within `far`. */
export function firstHits(bvh: MeshBVH, grid: RayGrid): Float32Array {
  const { origin: o, dir, u, v, cell, cols, rows, far } = grid
  const out = new Float32Array(cols * rows).fill(Number.NaN)
  const origin = new THREE.Vector3()
  const ray = new THREE.Ray(origin, new THREE.Vector3(dir[0], dir[1], dir[2]))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = (c + 0.5) * cell
      const b = (r + 0.5) * cell
      origin.set(o[0] + a * u[0] + b * v[0], o[1] + a * u[1] + b * v[1], o[2] + a * u[2] + b * v[2])
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, far)
      if (hit) out[r * cols + c] = hit.distance
    }
  }
  return out
}

/** The direction most of a surface faces, either way along it — a plate's
 *  faces: the leading eigenvector of Σ n·nᵀ over the normals given, then
 *  again over the normals within 20° of it, so the sides fall out. */
export function dominantFacing(normals: Float32Array): Vec3 | null {
  const lead = (keep: (i: number) => boolean): Vec3 | null => {
    const m = new Float64Array(9)
    let n = 0
    for (let i = 0; i + 2 < normals.length; i += 3) {
      if (!keep(i)) continue
      const x = normals[i], y = normals[i + 1], z = normals[i + 2]
      m[0] += x * x; m[1] += x * y; m[2] += x * z
      m[4] += y * y; m[5] += y * z; m[8] += z * z
      n++
    }
    if (n < 3) return null
    m[3] = m[1]; m[6] = m[2]; m[7] = m[5]
    return symmetricEigen3(m).vectors[2]
  }
  const first = lead(() => true)
  if (!first) return null
  const cos = Math.cos((20 * Math.PI) / 180)
  return lead((i) => Math.abs(normals[i] * first[0] + normals[i + 1] * first[1] + normals[i + 2] * first[2]) >= cos) ?? first
}

/** The open rims of the scan, longest first: how many, all their length,
 *  and the `keep` longest. */
export function scanRims(positions: Float32Array, indices: Uint32Array, keep: number): { count: number; total: number; largest: MeshGap[] } {
  const all = meshGaps(positions, indices, Infinity)
  all.sort((a, b) => b.length - a.length)
  return { count: all.length, total: all.reduce((s, g) => s + g.length, 0), largest: all.slice(0, keep) }
}

/** How noisy the surface is: over a sample of vertices spread through the
 *  scan, a plane fitted to each one's two rings of neighbours, and the
 *  scatter off it (rms, mm) — its median, and the 90th percentile. Edges
 *  and rounds fit a plane badly; the median is the faces'. */
export function localNoise(g: MeshGraph, sample: number): { median: number; p90: number; sampled: number } {
  const step = Math.max(1, Math.floor(g.vertexCount / sample))
  const p = g.positions
  const rms: number[] = []
  const ring = new Set<number>()
  const cov = new Float64Array(9)
  for (let v = 0; v < g.vertexCount; v += step) {
    ring.clear()
    ring.add(v)
    for (let e = g.adjOffsets[v]; e < g.adjOffsets[v + 1]; e++) {
      const u = g.adjList[e]
      ring.add(u)
      for (let f = g.adjOffsets[u]; f < g.adjOffsets[u + 1] && ring.size < 48; f++) ring.add(g.adjList[f])
    }
    if (ring.size < 8) continue
    let cx = 0, cy = 0, cz = 0
    for (const u of ring) {
      cx += p[u * 3]
      cy += p[u * 3 + 1]
      cz += p[u * 3 + 2]
    }
    const n = ring.size
    cx /= n
    cy /= n
    cz /= n
    cov.fill(0)
    for (const u of ring) {
      const x = p[u * 3] - cx, y = p[u * 3 + 1] - cy, z = p[u * 3 + 2] - cz
      cov[0] += x * x
      cov[1] += x * y
      cov[2] += x * z
      cov[4] += y * y
      cov[5] += y * z
      cov[8] += z * z
    }
    cov[3] = cov[1]
    cov[6] = cov[2]
    cov[7] = cov[5]
    rms.push(Math.sqrt(Math.max(0, symmetricEigen3(cov).values[0]) / n))
  }
  rms.sort((a, b) => a - b)
  const at = (q: number) => (rms.length ? rms[Math.min(rms.length - 1, Math.floor(q * rms.length))] : 0)
  return { median: at(0.5), p90: at(0.9), sampled: rms.length }
}

/** A plane z = a + b·u + c·v through the points, the worst of them left out
 *  round by round (past 2.5 robust sigma) — the faces of a plate read past
 *  its holes and bosses. Null with too few points. */
export function robustPlane(us: ArrayLike<number>, vs: ArrayLike<number>, zs: ArrayLike<number>): { a: number; b: number; c: number; used: number; rms: number } | null {
  let keep = Array.from({ length: zs.length }, (_, i) => i)
  let fit: { a: number; b: number; c: number } | null = null
  for (let round = 0; round < 4; round++) {
    if (keep.length < 6) return null
    // Normal equations about the kept points' mean, for a stable solve.
    let mu = 0, mv = 0, mz = 0
    for (const i of keep) {
      mu += us[i]
      mv += vs[i]
      mz += zs[i]
    }
    mu /= keep.length
    mv /= keep.length
    mz /= keep.length
    let suu = 0, suv = 0, svv = 0, suz = 0, svz = 0
    for (const i of keep) {
      const u = us[i] - mu, v = vs[i] - mv, z = zs[i] - mz
      suu += u * u
      suv += u * v
      svv += v * v
      suz += u * z
      svz += v * z
    }
    const det = suu * svv - suv * suv
    if (!(Math.abs(det) > 1e-12)) return null
    const b = (suz * svv - svz * suv) / det
    const c = (svz * suu - suz * suv) / det
    fit = { a: mz - b * mu - c * mv, b, c }
    const res = keep.map((i) => zs[i] - (fit!.a + b * us[i] + c * vs[i]))
    const sorted = res.map(Math.abs).sort((x, y) => x - y)
    const sigma = Math.max(1.4826 * sorted[sorted.length >> 1], 1e-6)
    const next = keep.filter((_, k) => Math.abs(res[k]) <= 2.5 * sigma)
    if (next.length === keep.length) break
    keep = next
  }
  if (!fit) return null
  let ss = 0
  for (const i of keep) ss += (zs[i] - (fit.a + fit.b * us[i] + fit.c * vs[i])) ** 2
  return { ...fit, used: keep.length, rms: Math.sqrt(ss / Math.max(1, keep.length)) }
}
