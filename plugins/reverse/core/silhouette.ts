// SPDX-License-Identifier: AGPL-3.0-only
// The outline a round face shows from where it is looked at. A body is drawn
// by its edges, and a cylinder has none along its sides, a ball none at all:
// drawn solid in the body's colour they have no rim, and a boss on a plate
// reads as a disc. What a drawing puts there is the silhouette — the line
// on the surface where it turns from facing the eye to facing away.
//
// On a mesh with a normal at every vertex that line is where normal · view
// is zero, and it is found a triangle at a time with nothing known of the
// triangle's neighbours: the value at the three corners, and where it
// changes sign along two of the sides, a segment between the two crossings.
// Taken off the triangles' own flat normals the line would run along mesh
// edges in a zigzag; off the vertex normals it cuts across the triangles
// and is as smooth as the surface was meshed.

import type { Vec3 } from '../../../src/core/types'

/** Where the body is looked at from: along one direction (an orthographic
 *  camera) or from a point. In the mesh's own coordinates. */
export type SilhouetteView = { dir: Vec3 } | { eye: Vec3 }

/**
 * The silhouette of the given triangles — `ranges` as [first triangle,
 * count], the round faces of a body; a flat face has one normal and no
 * silhouette of its own — as segments, XYZ XYZ per segment.
 */
export function silhouetteSegments(positions: ArrayLike<number>, normals: ArrayLike<number>, indices: ArrayLike<number>, ranges: readonly (readonly [number, number])[], view: SilhouetteView): Float32Array {
  const out: number[] = []
  const g = [0, 0, 0]
  const at = [0, 0, 0]
  for (const [first, count] of ranges) {
    for (let t = first; t < first + count; t++) {
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k] * 3
        at[k] = v
        const vx = 'dir' in view ? view.dir[0] : positions[v] - view.eye[0]
        const vy = 'dir' in view ? view.dir[1] : positions[v + 1] - view.eye[1]
        const vz = 'dir' in view ? view.dir[2] : positions[v + 2] - view.eye[2]
        g[k] = normals[v] * vx + normals[v + 1] * vy + normals[v + 2] * vz
      }
      // A corner dead on the line counts as facing: a sign is wanted, and a
      // zero taken either way leaves no gap, only a segment a hair shorter.
      const s0 = g[0] >= 0, s1 = g[1] >= 0, s2 = g[2] >= 0
      if (s0 === s1 && s1 === s2) continue
      // The corner on its own side, and the two sides that leave it.
      const lone = s0 !== s1 && s0 !== s2 ? 0 : s1 !== s0 && s1 !== s2 ? 1 : 2
      for (const other of [(lone + 1) % 3, (lone + 2) % 3]) {
        const f = g[lone] / (g[lone] - g[other])
        const a = at[lone], b = at[other]
        out.push(positions[a] + (positions[b] - positions[a]) * f, positions[a + 1] + (positions[b + 1] - positions[a + 1]) * f, positions[a + 2] + (positions[b + 2] - positions[a + 2]) * f)
      }
    }
  }
  return Float32Array.from(out)
}
