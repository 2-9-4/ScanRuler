// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic scans for the curved-edge readings: a profile (w out from an
// outline, z up) swept round a closed outline in XY — a circle for a boss,
// a hole or a bowl, a rounded rectangle for a plate — with noise along the
// normals.
import { mulberry32 } from '../../../src/core/fit/ransac'
import type { Vec3 } from '../../../src/core/types'

export type P2 = [number, number]
/** A profile point (w out from the outline, z up) and its outward normal. */
export type Prof = { p: P2; n: P2 }

/** A profile from pieces: straight runs and arcs, sampled every `step`. */
export function line(a: P2, b: P2, n: P2, step: number): Prof[] {
  const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  return Array.from({ length: k }, (_, i) => ({ p: [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k] as P2, n }))
}
/** An arc about c of radius r from angle a0 to a1; `inward` for a concave
 *  one, whose outward normal points at its centre. */
export function arc(c: P2, r: number, a0: number, a1: number, inward: boolean, step: number): Prof[] {
  const k = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / step))
  return Array.from({ length: k }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / k
    const u: P2 = [Math.cos(a), Math.sin(a)]
    return { p: [c[0] + r * u[0], c[1] + r * u[1]] as P2, n: (inward ? [-u[0], -u[1]] : u) as P2 }
  })
}

/** An outline in XY: points and outward normals, closed. */
export type Outline = { p: P2; n: P2 }[]
export const circleOutline = (R: number, k = 360, c: P2 = [0, 0]): Outline =>
  Array.from({ length: k }, (_, i) => {
    const a = (2 * Math.PI * i) / k
    return { p: [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)] as P2, n: [Math.cos(a), Math.sin(a)] as P2 }
  })
/** A rectangle 2a × 2b with corners rounded rc, every `step`. */
export function roundedRect(a: number, b: number, rc: number, step: number): Outline {
  const out: Outline = []
  const corners: P2[] = [[a - rc, b - rc], [-(a - rc), b - rc], [-(a - rc), -(b - rc)], [a - rc, -(b - rc)]]
  corners.forEach((c, i) => {
    const a0 = (i * Math.PI) / 2
    for (let s = 0; s < (Math.PI / 2) * rc; s += step) {
      const t = a0 + s / rc
      out.push({ p: [c[0] + rc * Math.cos(t), c[1] + rc * Math.sin(t)], n: [Math.cos(t), Math.sin(t)] })
    }
    const next = corners[(i + 1) % 4]
    const e: P2 = [Math.cos(a0 + Math.PI / 2), Math.sin(a0 + Math.PI / 2)]
    const from: P2 = [c[0] + rc * e[0], c[1] + rc * e[1]]
    const to: P2 = [next[0] + rc * e[0], next[1] + rc * e[1]]
    const L = Math.hypot(to[0] - from[0], to[1] - from[1])
    for (let s = 0; s < L; s += step) out.push({ p: [from[0] + ((to[0] - from[0]) * s) / L, from[1] + ((to[1] - from[1]) * s) / L], n: e })
  })
  return out
}

/** The profile swept round the outline: an indexed sheet, each vertex
 *  moved along its normal by Gaussian noise. */
export function sweep(outline: Outline, profile: Prof[], noise: number, seed = 3, closed = true): { positions: Float32Array; indices: Uint32Array } {
  const rand = mulberry32(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const positions = new Float32Array(outline.length * profile.length * 3)
  let v = 0
  for (const o of outline) {
    for (const { p, n } of profile) {
      const d = gauss() * noise
      const nn: Vec3 = [n[0] * o.n[0], n[0] * o.n[1], n[1]]
      positions[v++] = o.p[0] + p[0] * o.n[0] + d * nn[0]
      positions[v++] = o.p[1] + p[0] * o.n[1] + d * nn[1]
      positions[v++] = p[1] + d * nn[2]
    }
  }
  const idx: number[] = []
  const P = profile.length
  for (let i = 0; i < (closed ? outline.length : outline.length - 1); i++) {
    const j = (i + 1) % outline.length
    for (let k = 0; k + 1 < P; k++) idx.push(i * P + k, j * P + k, j * P + k + 1, i * P + k, j * P + k + 1, i * P + k + 1)
  }
  return { positions, indices: new Uint32Array(idx) }
}

/** An indexed sheet as a triangle soup, for an STL. */
export function soup(...meshes: { positions: Float32Array; indices: Uint32Array }[]): Float32Array {
  const out: number[] = []
  for (const m of meshes) for (const i of m.indices) out.push(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2])
  return new Float32Array(out)
}
