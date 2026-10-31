// SPDX-License-Identifier: AGPL-3.0-only
// Loops of the mesh lying in a plane, closed with the flat faces they bound —
// the cap a cut leaves, and the fill of a hole too large to search for the
// best patch across.
//
// Seen square to the plane the loops are polygons, and three.js's ear
// clipping (Earcut) triangulates a polygon and the holes inside it. Which loop
// is a face and which a hole in one is read off how deep each lies inside the
// others: a tube cut across leaves two loops, the outer one a face and the
// inner one the bore through it. No point is added — the face's triangles run
// between the loops' own vertices, which is all a flat face needs.

import { ShapeUtils, Vector2 } from 'three'
import type { Vec3 } from '../../../src/core/types'

export interface PlanarFill {
  /** Triangles, three vertex ids apiece, wound so each walks the loop edges
   *  the other way from the mesh's own triangle on them. */
  triangles: number[]
  /** Faces made — loops that bound one, not the holes in them. */
  faces: number
}

/**
 * Triangulate `loops` — closed rims of the mesh, each in the direction its
 * open half-edges run — seen square to the plane of `u` and `v`.
 */
export function fillPlanarLoops(
  positions: ArrayLike<number>,
  loops: readonly ArrayLike<number>[],
  u: Vec3,
  v: Vec3,
): PlanarFill {
  const flat = loops.map((loop) => {
    const pts: Vector2[] = []
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i] * 3
      const x = positions[p], y = positions[p + 1], z = positions[p + 2]
      pts.push(new Vector2(x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]))
    }
    return pts
  })
  const areas = flat.map((pts) => Math.abs(signedArea(pts)))

  // How many loops each lies inside, and the smallest of them — the face it
  // is a hole in, when it lies an odd number deep.
  const depth = flat.map(() => 0)
  const parent = flat.map(() => -1)
  for (let i = 0; i < flat.length; i++) {
    for (let j = 0; j < flat.length; j++) {
      if (i === j || areas[j] <= areas[i] || !inside(flat[i][0], flat[j])) continue
      depth[i]++
      if (parent[i] < 0 || areas[j] < areas[parent[i]]) parent[i] = j
    }
  }

  const triangles: number[] = []
  let faces = 0
  for (let i = 0; i < flat.length; i++) {
    if (depth[i] % 2 !== 0 || flat[i].length < 3 || areas[i] === 0) continue
    const holes: number[] = []
    for (let j = 0; j < flat.length; j++) if (depth[j] === depth[i] + 1 && parent[j] === i && flat[j].length >= 3) holes.push(j)
    const ids: number[] = []
    for (const k of [i, ...holes]) for (let m = 0; m < loops[k].length; m++) ids.push(loops[k][m])
    const tris = ShapeUtils.triangulateShape(
      flat[i].slice(),
      holes.map((j) => flat[j].slice()),
    )
    if (tris.length === 0) continue
    const group: number[] = []
    for (const [a, b, c] of tris) group.push(ids[a], ids[b], ids[c])
    if (walksWithLoop(group, loops[i])) {
      for (let t = 0; t < group.length; t += 3) {
        const x = group[t + 1]
        group[t + 1] = group[t + 2]
        group[t + 2] = x
      }
    }
    triangles.push(...group)
    faces++
  }
  return { triangles, faces }
}

/** Whether the triangles walk the loop's edges the same way the loop runs —
 *  the way the mesh's own triangles on them do, so the face would be wound
 *  against the part. Read off the first edge a triangle has. */
function walksWithLoop(triangles: number[], loop: ArrayLike<number>): boolean {
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    for (let t = 0; t < triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const p = triangles[t + k]
        const q = triangles[t + ((k + 1) % 3)]
        if (p === a && q === b) return true
        if (p === b && q === a) return false
      }
    }
  }
  return false
}

export function signedArea(pts: readonly Vector2[]): number {
  let s = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y)
  return s / 2
}

/** Point in polygon, by the crossings of a ray. */
export function inside(p: Vector2, poly: readonly Vector2[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

/** Whether a closed polygon crosses itself anywhere. */
export function selfCrossing(pts: readonly Vector2[]): boolean {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      // Neighbouring edges share a corner; the first and last do too.
      if (i === 0 && j === n - 1) continue
      const c = pts[j]
      const d = pts[(j + 1) % n]
      if (segmentsCross(a, b, c, d)) return true
    }
  }
  return false
}

function segmentsCross(a: Vector2, b: Vector2, c: Vector2, d: Vector2): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

function orient(a: Vector2, b: Vector2, c: Vector2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
