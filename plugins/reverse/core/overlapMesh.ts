// SPDX-License-Identifier: AGPL-3.0-only
// What two bodies share, worked out on the meshes the viewport draws them
// with rather than by the CAD kernel: Manifold's (Apache-2.0) intersection
// of two closed triangle meshes takes milliseconds where the kernel's
// common of two threaded parts took seconds — seconds every build and
// preview queued behind it in the kernel's worker would wait. And what
// comes back lies on the bodies' own facets, so it is drawn exactly over
// them.

import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import type { KernelMesh } from './kernelTypes'

/** The solid two bodies share, meshed, its volume and the area of its
 *  skin. */
export interface SharedSolid {
  mesh: KernelMesh
  volume: number
  area: number
}

/** Position and normal, a vertex's properties through Manifold: a new
 *  vertex where a facet is cut takes the normal there between its
 *  corners'. */
const PROPS = 6

/**
 * The solid two closed meshes share, or null where they share none — they
 * only touch, or stand apart — or where Manifold cannot read one as
 * closed. A mesh has each face's vertices of its own, as the kernel meshes
 * face by face; they are merged where they lie on one another, the normals
 * kept apart, so an edge between two faces stays sharp.
 */
export function sharedSolid(wasm: ManifoldToplevel, a: KernelMesh, b: KernelMesh): SharedSolid | null {
  const made: Manifold[] = []
  const solid = (m: KernelMesh): Manifold | null => {
    const n = m.positions.length / 3
    const props = new Float32Array(n * PROPS)
    for (let v = 0; v < n; v++) {
      for (let k = 0; k < 3; k++) {
        props[v * PROPS + k] = m.positions[v * 3 + k]
        props[v * PROPS + 3 + k] = m.normals[v * 3 + k]
      }
    }
    const mesh = new wasm.Mesh({ numProp: PROPS, vertProperties: props, triVerts: m.indices })
    mesh.merge()
    const s = new wasm.Manifold(mesh)
    made.push(s)
    return s.status() === 'NoError' && !s.isEmpty() ? s : null
  }
  try {
    const sa = solid(a)
    const sb = sa && solid(b)
    if (!sa || !sb) return null
    const common = sa.intersect(sb)
    made.push(common)
    if (common.status() !== 'NoError' || common.isEmpty()) return null
    const out = common.getMesh()
    const n = out.vertProperties.length / out.numProp
    const positions = new Float32Array(n * 3)
    const normals = new Float32Array(n * 3)
    for (let v = 0; v < n; v++) {
      const p = v * out.numProp
      const nx = out.vertProperties[p + 3], ny = out.vertProperties[p + 4], nz = out.vertProperties[p + 5]
      const len = Math.hypot(nx, ny, nz) || 1
      for (let k = 0; k < 3; k++) positions[v * 3 + k] = out.vertProperties[p + k]
      normals[v * 3] = nx / len
      normals[v * 3 + 1] = ny / len
      normals[v * 3 + 2] = nz / len
    }
    return { mesh: { positions, normals, indices: Uint32Array.from(out.triVerts) }, volume: common.volume(), area: common.surfaceArea() }
  } finally {
    for (const m of made) m.delete()
  }
}
