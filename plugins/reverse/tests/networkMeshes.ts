// SPDX-License-Identifier: AGPL-3.0-only
// The synthetic scans the patch network's tests draw on: a grid of (u, v)
// mapped into space — a sheet, a strip of a cylinder, a saddle — with noise
// along the normal and holes left out, and a noisy sphere. And a network
// written out as nodes and curves through grips.

import { icosphere } from '../../../tests/helpers'
import type { Vec3 } from '../../../src/core/types'
import type { NetworkCurve, NetworkFeature, NetworkNode } from '../core/features'

/** A small deterministic generator, and normal noise from it. */
export function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** A grid of nu × nv cells over [0, 1]² mapped by `at`, wound so its
 *  normals point the way `at`'s du × dv does; `wrap` closes u round;
 *  `hole` leaves out the cells it says; `noise` moves each vertex along
 *  the grid's own normal there. */
export function gridScan(nu: number, nv: number, at: (u: number, v: number) => Vec3, opts: { wrap?: boolean; hole?: (u: number, v: number) => boolean; noise?: number; seed?: number } = {}) {
  const cols = opts.wrap ? nu : nu + 1
  const rand = random(opts.seed ?? 5)
  const positions: number[] = []
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / nu
      const v = j / nv
      const p = at(u, v)
      if (opts.noise) {
        const e = 1e-4
        const pu = at(u + e, v)
        const pv = at(u, v + e)
        const du = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]]
        const dv = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]]
        const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]
        const l = Math.hypot(n[0], n[1], n[2]) || 1
        const g = gaussian(rand) * opts.noise
        p[0] += (n[0] / l) * g
        p[1] += (n[1] / l) * g
        p[2] += (n[2] / l) * g
      }
      positions.push(...p)
    }
  }
  const indices: number[] = []
  const id = (i: number, j: number) => j * cols + (opts.wrap ? i % nu : i)
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (opts.hole?.((i + 0.5) / nu, (j + 0.5) / nv)) continue
      indices.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1))
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** A sphere of radius r about the origin with noise, closed. */
export function sphereScan(r: number, noise: number, subdivisions = 5) {
  return icosphere(subdivisions, r, noise, 3)
}

/** A network written out: nodes by id at their points, curves as
 *  [from, to, grips…] and a crease flag, seeds for the cells. */
export function network(id: number, nodes: Record<number, Vec3>, curves: { from: number; to: number; via?: Vec3[]; crease?: boolean }[], seeds: Vec3[], spans: Record<string, number> = {}): NetworkFeature {
  const ns: NetworkNode[] = Object.entries(nodes).map(([k, at]) => ({ id: Number(k), at }))
  const cs: NetworkCurve[] = curves.map((c, i) => ({ id: i + 1, from: c.from, to: c.to, via: c.via ?? [], ...(c.crease ? { crease: true } : {}) }))
  return { id, kind: 'network', name: `Network ${id}`, nodes: ns, curves: cs, cells: seeds.map((seed) => ({ seed })), spans, fit: { smoothness: 0.001 }, visible: true }
}

/** A rows × cols grid network over a surface given by `at` on [0, 1]²: its
 *  nodes on the grid's crossings, a curve along each line between two, with
 *  `grips` grips evenly along it, and a seed in every cell. */
export function gridNetwork(id: number, rows: number, cols: number, at: (u: number, v: number) => Vec3, grips = 0, box: [number, number, number, number] = [0, 1, 0, 1]): NetworkFeature {
  const [u0, u1, v0, v1] = box
  const uu = (i: number) => u0 + ((u1 - u0) * i) / cols
  const vv = (j: number) => v0 + ((v1 - v0) * j) / rows
  const nodes: Record<number, Vec3> = {}
  const nid = (i: number, j: number) => j * (cols + 1) + i + 1
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) nodes[nid(i, j)] = at(uu(i), vv(j))
  const curves: { from: number; to: number; via: Vec3[] }[] = []
  const via = (a: [number, number], b: [number, number]) => Array.from({ length: grips }, (_, k) => at(a[0] + ((b[0] - a[0]) * (k + 1)) / (grips + 1), a[1] + ((b[1] - a[1]) * (k + 1)) / (grips + 1)))
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) curves.push({ from: nid(i, j), to: nid(i + 1, j), via: via([uu(i), vv(j)], [uu(i + 1), vv(j)]) })
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) curves.push({ from: nid(i, j), to: nid(i, j + 1), via: via([uu(i), vv(j)], [uu(i), vv(j + 1)]) })
  const seeds: Vec3[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) seeds.push(at((uu(i) + uu(i + 1)) / 2, (vv(j) + vv(j + 1)) / 2))
  return network(id, nodes, curves, seeds)
}
