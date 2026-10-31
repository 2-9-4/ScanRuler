// SPDX-License-Identifier: AGPL-3.0-only
// Surface named without a mouse: the vertices of a mesh inside a box or a
// ball, or a list of them by number — narrowed, when a direction is given,
// to those facing it. What the marking tools mark by hand, for whatever
// cannot draw a window on the part: an agent marking the top face to smooth,
// or the fixture under the part to delete.

import type { Vec3 } from '../../../src/core/types'
import type { MeshRegion } from './protocol'

/** How far from `facing` a vertex's normal may turn and still face it, by
 *  default: the angle Smooth and Sharp edges take an edge at. */
export const DEFAULT_FACING_DEG = 30

/**
 * The vertices `region` holds, in order. A box takes what is inside it or
 * on it, a ball what is no further from its centre than its radius;
 * `vertices` names them outright, one past the mesh refused. With `facing`,
 * only those whose normal is within the angle of it stay.
 */
export function selectVertices(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
  region: MeshRegion,
): Uint32Array {
  const shapes = [region.box, region.sphere, region.vertices].filter((x) => x !== undefined).length
  if (shapes !== 1) throw new Error('Name the surface one way: a box, a sphere or a list of vertices.')
  let facing: Vec3 | null = null
  if (region.facing) {
    const [x, y, z] = region.facing
    const n = Math.hypot(x, y, z)
    if (!(n > 0)) throw new Error('The direction to face has no length.')
    facing = [x / n, y / n, z / n]
  }
  const cosLimit = Math.cos(((region.angleDeg ?? DEFAULT_FACING_DEG) * Math.PI) / 180)
  const faces = (v: number): boolean => {
    if (!facing) return true
    const nx = normals[v * 3]
    const ny = normals[v * 3 + 1]
    const nz = normals[v * 3 + 2]
    const len = Math.hypot(nx, ny, nz)
    return len > 0 && (nx * facing[0] + ny * facing[1] + nz * facing[2]) / len >= cosLimit
  }
  const out: number[] = []
  if (region.vertices) {
    for (const v of region.vertices) {
      if (v >= vertexCount) throw new Error(`The mesh has no vertex ${v} — it has ${vertexCount}.`)
      if (faces(v)) out.push(v)
    }
    return Uint32Array.from(new Set(out))
  }
  if (region.box) {
    const { min, max } = region.box
    for (let k = 0; k < 3; k++) if (!(min[k] <= max[k])) throw new Error('The box’s min corner must not lie past its max corner.')
    for (let v = 0; v < vertexCount; v++) {
      const x = positions[v * 3]
      const y = positions[v * 3 + 1]
      const z = positions[v * 3 + 2]
      if (x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2] && faces(v)) out.push(v)
    }
    return Uint32Array.from(out)
  }
  const { center, radius } = region.sphere!
  if (!(radius > 0)) throw new Error('The sphere’s radius must be more than zero.')
  const r2 = radius * radius
  for (let v = 0; v < vertexCount; v++) {
    const dx = positions[v * 3] - center[0]
    const dy = positions[v * 3 + 1] - center[1]
    const dz = positions[v * 3 + 2] - center[2]
    if (dx * dx + dy * dy + dz * dz <= r2 && faces(v)) out.push(v)
  }
  return Uint32Array.from(out)
}
