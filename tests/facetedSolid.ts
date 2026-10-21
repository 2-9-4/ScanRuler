// SPDX-License-Identifier: AGPL-3.0-only
// A faceted solid as a scan would give it: a convex block cut by planes —
// chamfers, a bevel, a shallow crease — meshed by projecting a fine
// icosphere out from the centre onto the nearest face, so every vertex lies
// on a face and the triangles across an edge round it off a little, as a
// scanner's do. Noise goes along the face's normal.

import { mulberry32 } from '../src/core/fit/ransac'
import { gaussian, icosphere } from './helpers'

type Vec3 = [number, number, number]

/** A face of the solid: points x with n·x ≤ d are inside. */
export interface Face {
  name: string
  n: Vec3
  d: number
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** A face through `point` facing `n` (any length). */
export function face(name: string, n: Vec3, point: Vec3): Face {
  const u = unit(n)
  return { name, n: u, d: u[0] * point[0] + u[1] * point[1] + u[2] * point[2] }
}

/** The solid the faces bound, the origin inside it, as an indexed mesh, with
 *  the face each vertex lies on. */
export function facetedSolid(
  faces: Face[],
  { subdivisions = 6, noise = 0, seed = 5 }: { subdivisions?: number; noise?: number; seed?: number } = {},
): { positions: Float32Array; indices: Uint32Array; faceOf: Int32Array } {
  const sphere = icosphere(subdivisions, 1)
  const rand = mulberry32(seed)
  const count = sphere.positions.length / 3
  const positions = new Float32Array(count * 3)
  const faceOf = new Int32Array(count)
  for (let v = 0; v < count; v++) {
    const d: Vec3 = [sphere.positions[v * 3], sphere.positions[v * 3 + 1], sphere.positions[v * 3 + 2]]
    let t = Infinity
    let hit = -1
    faces.forEach((f, i) => {
      const along = f.n[0] * d[0] + f.n[1] * d[1] + f.n[2] * d[2]
      if (along <= 1e-9) return
      const ti = f.d / along
      if (ti < t) {
        t = ti
        hit = i
      }
    })
    const e = noise > 0 ? gaussian(rand) * noise : 0
    const n = faces[hit].n
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = d[k] * t + e * n[k]
    faceOf[v] = hit
  }
  return { positions, indices: sphere.indices, faceOf }
}

/** A 40 × 30 × 20 block: its four upright edges chamfered 3 mm, and a bevel
 *  25° across the top past x = 10. Eleven faces. */
export function chamferedBlock(): Face[] {
  const s = Math.SQRT1_2
  return [
    face('+x', [1, 0, 0], [20, 0, 0]),
    face('-x', [-1, 0, 0], [-20, 0, 0]),
    face('+y', [0, 1, 0], [0, 15, 0]),
    face('-y', [0, -1, 0], [0, -15, 0]),
    face('top', [0, 0, 1], [0, 0, 10]),
    face('bottom', [0, 0, -1], [0, 0, -10]),
    face('chamfer ++', [s, s, 0], [20, 12, 0]),
    face('chamfer +-', [s, -s, 0], [20, -12, 0]),
    face('chamfer -+', [-s, s, 0], [-20, 12, 0]),
    face('chamfer --', [-s, -s, 0], [-20, -12, 0]),
    face('bevel', [Math.sin((25 * Math.PI) / 180), 0, Math.cos((25 * Math.PI) / 180)], [10, 0, 10]),
  ]
}
