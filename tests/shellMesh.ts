// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic thin shells for the tests that read a section for one skin: a
// profile pushed into a tube of triangles wound out of the material, and
// the section of a moulded cover — an arch on two legs, open below, ribs
// hanging from its inside.

import type { Vec2 } from '../src/core/flat/types'

/** A small seeded random source, so the noise is the same every run. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** A closed polygon with its sides cut into steps no longer than `step`. */
export function densify(poly: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let t = 0; t < k; t++) out.push([a[0] + ((b[0] - a[0]) * t) / k, a[1] + ((b[1] - a[1]) * t) / k])
  }
  return out
}

/** A counter-clockwise profile pushed along Z into a tube of triangles,
 *  wound so their normals point out of the material, its vertices jittered
 *  in X and Y by up to `noise` mm. */
export function prism(profile: Vec2[], length: number, noise = 0, layers = 2) {
  const k = profile.length
  const rand = rng(7)
  const positions = new Float32Array(k * (layers + 1) * 3)
  for (let l = 0; l <= layers; l++)
    for (let i = 0; i < k; i++) {
      const at = (l * k + i) * 3
      positions[at] = profile[i][0] + (rand() * 2 - 1) * noise
      positions[at + 1] = profile[i][1] + (rand() * 2 - 1) * noise
      positions[at + 2] = (length * l) / layers
    }
  const indices: number[] = []
  const v = (i: number, l: number) => l * k + (i % k)
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < k; i++) {
      indices.push(v(i, l), v(i + 1, l), v(i + 1, l + 1))
      indices.push(v(i, l), v(i + 1, l + 1), v(i, l + 1))
    }
  return { positions, indices: new Uint32Array(indices) }
}

/** The arch's outer and inner radius, how far its legs run below its
 *  springing, how far in its ribs reach, their half-thickness and the
 *  angles they hang at. */
export const ARCH = { R: 40, r: 37, leg: 15, ribTip: 29, ribHalf: 1, ribs: [60, 90, 120] } as const

/** The section of a moulded cover: an arch 3 mm thick standing on two
 *  legs, open below, with three ribs hanging from its inside — traced
 *  counter-clockwise round the material. */
export function archProfile(step: number): Vec2[] {
  const { R, r, leg, ribTip, ribHalf, ribs } = ARCH
  const deg = Math.PI / 180
  const poly: Vec2[] = [[R, -leg]]
  for (let a = 0; a <= 180; a += 1) poly.push([R * Math.cos(a * deg), R * Math.sin(a * deg)])
  poly.push([-R, -leg], [-r, -leg])
  // The inside, from the left back to the right, a rib where one hangs.
  const ribsDown = [...ribs].sort((a, b) => b - a)
  for (let a = 180; a >= 0; a -= 1) {
    const rib = ribsDown.find((x) => Math.abs(x - a) < 0.5)
    if (rib === undefined) {
      if (ribsDown.some((x) => Math.abs(x - a) < 3)) continue
      poly.push([r * Math.cos(a * deg), r * Math.sin(a * deg)])
      continue
    }
    // A rib: square to the arch, 2 mm thick, in to ribTip.
    const c = [Math.cos(rib * deg), Math.sin(rib * deg)]
    const t = [-Math.sin(rib * deg), Math.cos(rib * deg)]
    const at = (rad: number, side: number): Vec2 => [c[0] * rad + t[0] * side, c[1] * rad + t[1] * side]
    poly.push(at(r, ribHalf), at(ribTip, ribHalf), at(ribTip, -ribHalf), at(r, -ribHalf))
  }
  poly.push([r, -leg])
  return densify(poly, step)
}

/** Where on the arch a sheet point lies (the arch cut square to Z, u = X,
 *  v = Y). */
export function archPlaceOf(p: Vec2): 'outer' | 'inner' | 'rib' | 'rim' | 'corner' {
  const { R, r, leg } = ARCH
  const rad = Math.hypot(p[0], p[1])
  // The rim the legs stand on; the corner where it meets the inside is
  // either's.
  if (p[1] < -leg + 0.1 && Math.abs(Math.abs(p[0]) - r) < 0.1) return 'corner'
  if (p[1] < -leg + 0.1 && Math.abs(p[0]) > r) return 'rim'
  if (p[1] <= 0.3) return Math.abs(p[0]) > (R + r) / 2 ? 'outer' : 'inner'
  if (rad > (R + r) / 2) return 'outer'
  if (rad > r - 0.4) return 'inner'
  return 'rib'
}
