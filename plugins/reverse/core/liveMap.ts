// SPDX-License-Identifier: AGPL-3.0-only
// The live deviation map of the Reverse engineer workspace: the scan coloured
// by its signed distance to the ghost of the feature being set up, or to the
// committed bodies. Nothing here is new measurement — it is the Deviation
// workspace's nearest-point machinery (the BVH with pseudonormal signs in
// deviation/surface.ts, its facing limit in deviation/deviation.ts, the
// ramp in field/colormap.ts)
// applied to a small tessellation and a subset of the scan, so it can run
// again a few times a second while a grip is dragged.
//
// The map is sparse on purpose. A ghost is one feature of a part — a boss, a
// pocket, one wall — and the scan around it says nothing about the feature;
// so only the vertices near the ghost are read, and only those within reach
// of its surface are painted. The rest of the scan keeps whatever colour it
// wears, which is what lets the operator see the feature settle onto the
// scan without the whole part flashing a colour it does not deserve.

import { closestFacingWay, DEFAULT_MAP_FACING_DEG, deviationScale, scanNormalsSign } from '../../../src/core/deviation/deviation'
import { identityRigid, rigidApply, rigidRotate, type Rigid } from '../../../src/core/deviation/rigid'
import { type ClosestHit, emptyHit, NominalSurface } from '../../../src/core/deviation/surface'
import { paintField, type Colormap, type FieldScale } from '../../../src/core/field/colormap'
import type { KernelMesh } from './kernel'

/** The range the ramp opens at, ± millimetres: what QuickSurface's every
 *  dialog reads at, and about the noise of a good structured-light scan. */
export const LIVE_MAP_RANGE_MM = 0.1
/** How far past the ramp's range a vertex is still read, as a multiple of
 *  the range: everything nearer wears the ramp or a cap, everything further
 *  is left alone. Ten ranges is comfortably past a feature's own thickness
 *  at the default range and short of the next feature over. */
export const LIVE_MAP_REACH = 10
/** The smallest range the field takes, millimetres — under this the ramp
 *  would be reading scan noise as shape. */
export const LIVE_MAP_MIN_RANGE_MM = 0.005

/** A reading at some of the scan's vertices: which, and what. */
export interface SparseField {
  /** Scan vertex indices, ascending. */
  subset: Uint32Array
  /** Signed millimetres per subset entry, positive outside the surface. */
  values: Float32Array
  /** Scan vertices within the surface's box that lie deeper inside it than
   *  the reach — ascending, none of them in `subset`. The scan is the
   *  part's skin, so a vertex deep inside the model is a place the model
   *  has material the part has not: a hole, a pocket or a slot not cut,
   *  or a blob the scanner bridged a hole with. Read against the bodies
   *  only; a ghost is one feature, and the scan inside it says nothing. */
  farInside?: Uint32Array
}

/** The colour a vertex deep inside the bodies wears on the live map: a
 *  violet nothing on the ramp — green on the surface, red outside, blue
 *  inside, the caps past the reach — nor the scan's own tint comes near. */
export const FAR_INSIDE_RGB: readonly [number, number, number] = [186, 50, 196]

/** One surface out of several meshes — the committed bodies read as one
 *  part. Each body is closed on its own, so the pseudonormals that sign the
 *  distance are right wherever the nearest point lands; where two bodies
 *  overlap, the nearer surface wins, as it would on the fused part. */
export function surfaceOfMeshes(meshes: readonly KernelMesh[]): NominalSurface | null {
  const kept = meshes.filter((m) => m.indices.length >= 3)
  if (kept.length === 0) return null
  if (kept.length === 1) return new NominalSurface(kept[0].positions, kept[0].indices)
  let nv = 0, ni = 0
  for (const m of kept) {
    nv += m.positions.length
    ni += m.indices.length
  }
  const positions = new Float32Array(nv)
  const indices = new Uint32Array(ni)
  let pv = 0, pi = 0
  for (const m of kept) {
    positions.set(m.positions, pv)
    const base = pv / 3
    for (let i = 0; i < m.indices.length; i++) indices[pi + i] = m.indices[i] + base
    pv += m.positions.length
    pi += m.indices.length
  }
  return new NominalSurface(positions, indices)
}

/** Which of a surface's triangles — in the order its hits name them —
 *  belong to a sheet, for a surface surfaceOfMeshes made of these meshes,
 *  `sheet` saying which of them are sheets; null when none is. */
export function sheetTriangles(surface: NominalSurface, meshes: readonly KernelMesh[], sheet: readonly boolean[]): Uint8Array | null {
  const kept = meshes.map((m, i) => ({ m, sheet: sheet[i] === true })).filter((x) => x.m.indices.length >= 3)
  if (!kept.some((x) => x.sheet)) return null
  const vertexSheet = new Uint8Array(surface.vertexCount)
  let base = 0
  for (const { m, sheet: s } of kept) {
    if (s) vertexSheet.fill(1, base, base + m.positions.length / 3)
    base += m.positions.length / 3
  }
  const out = new Uint8Array(surface.triangleCount)
  for (let t = 0; t < out.length; t++) out[t] = vertexSheet[surface.index[t * 3]]
  return out
}

/**
 * Which side of the model the scan is read on. The nearest surface is not
 * always the one a scan vertex came off: across a thin wall, or with only
 * the outer skin of a shell modelled, a vertex of the inner skin lies
 * nearest the outer one, facing back at it, and reads as minus the wall.
 * The scan's own normal says which way the vertex faces, and the model's
 * which way its surface does.
 */
export interface ScanSide {
  /** The scan's vertex normals, three per vertex, in its own frame. Which
   *  way round they are wound is read off the scan against the model. */
  normals: Float32Array
  /** The facing limit, degrees: a vertex whose nearest surface turns
   *  further than this from facing its way is read against the nearest one
   *  within reach that does — the Deviation map's facing limit. Null for
   *  the nearest whatever it faces. */
  facingDeg: number | null
  /** A vertex no surface within reach faces: read against the nearest all
   *  the same ('keep', the default), or left out and counted apart. */
  unfacing?: 'keep' | 'drop'
  /** 'outer': only the scan whose normal faces out of the model, the way
   *  the nearest surface does — the outer skin of a shell against a body
   *  not hollowed yet. The rest is left out and counted apart. */
  skin?: 'outer'
}

/** The facing limit the scan is read under unless told otherwise: the
 *  Deviation map's — surface facing away, and nothing short of that. */
export const DEFAULT_FACING_DEG = DEFAULT_MAP_FACING_DEG

/** What reading the scan by its side came to: how many vertices were read
 *  against a farther surface that faces them (refaced); how many no
 *  surface within reach faced (unfacing — read against the nearest, or
 *  left out with unfacing: 'drop'); how many lay on the back of a sheet
 *  (back) and how many faced into the model (inward, with skin: 'outer') —
 *  those two left out. */
export interface SideCounts {
  refaced: number
  unfacing: number
  back: number
  inward: number
}

/**
 * The scan read against a surface by its side: a closest-point query that
 * takes the scan vertex's normal into account — see ScanSide. A sheet has
 * no inside, so its distance is signed by its front, the way its normal
 * points: it is read on its front only, under the default facing limit at
 * least, and a vertex behind it with nothing facing it within reach is
 * left out — the far skin of a wall a sheet stands on one skin of. With
 * no `side` (a scan without its normals) the reading is the plain nearest.
 */
export function sideReader(
  surface: NominalSurface,
  positions: Float32Array,
  transform: Rigid | null,
  side: ScanSide | null,
  /** Which triangles are a sheet's, by the surface's order — see
   *  sheetTriangles. */
  sheet: Uint8Array | null,
  /** The vertices whose normals settle which way the scan is wound — the
   *  ones near what is read — and how far a vertex may lie from the
   *  surface and still have its full say (scanNormalsSign). */
  voters: Uint32Array,
  near: number,
) {
  const m = transform ?? identityRigid()
  const minFacing = side && side.facingDeg !== null ? Math.cos((side.facingDeg * Math.PI) / 180) : null
  const sheetFacing = Math.max(minFacing ?? -1, Math.cos((DEFAULT_FACING_DEG * Math.PI) / 180))
  const outward = side ? scanNormalsSign(surface, positions, side.normals, m, { vertices: voters, near }) : 1
  const sn = new Float64Array(3)
  const counts: SideCounts = { refaced: 0, unfacing: 0, back: 0, inward: 0 }
  const normalOf = (v: number) => {
    const n = side!.normals
    rigidRotate(m, outward * n[v * 3], outward * n[v * 3 + 1], outward * n[v * 3 + 2], sn)
  }
  return {
    counts,
    /** Read vertex `v`, at `p` in the model's frame, into `hit`: true when
     *  it counts — 'none' with no surface within `maxDistance`, 'out' when
     *  its side leaves it out. A facing surface is looked for within
     *  `facingReach`. */
    read(v: number, p: Float64Array, hit: ClosestHit, maxDistance: number, facingReach: number): 'read' | 'none' | 'out' {
      if (!surface.closest(p[0], p[1], p[2], hit, maxDistance)) return 'none'
      if (!side) return 'read'
      normalOf(v)
      const facing = sn[0] * hit.nx + sn[1] * hit.ny + sn[2] * hit.nz
      const onSheet = sheet !== null && sheet[hit.faceIndex] === 1
      if (side.skin === 'outer' && !onSheet && facing < 0) {
        counts.inward++
        return 'out'
      }
      const limit = onSheet ? sheetFacing : minFacing
      if (limit === null || facing >= limit) return 'read'
      const found = closestFacingWay(surface, p[0], p[1], p[2], sn[0], sn[1], sn[2], limit, hit, maxDistance, facingReach)
      if (found === 'none') return 'none'
      if (found !== 'unfacing') {
        if (found === 'refaced') counts.refaced++
        return 'read'
      }
      if (sheet !== null && sheet[hit.faceIndex] === 1) {
        counts.back++
        return 'out'
      }
      counts.unfacing++
      return side.unfacing === 'drop' ? 'out' : 'read'
    },
    /** Whether a reading of vertex `v` past the reach, in `hit`, belongs to
     *  the side asked for: not behind a sheet, and with skin: 'outer' not
     *  facing into the model. */
    keepsFar(v: number, hit: ClosestHit): boolean {
      if (!side) return true
      normalOf(v)
      if (sn[0] * hit.nx + sn[1] * hit.ny + sn[2] * hit.nz >= 0) return true
      return !(side.skin === 'outer' || (sheet !== null && sheet[hit.faceIndex] === 1))
    },
  }
}

/** The scan vertices whose transformed position lies inside a box grown by
 *  `margin` on every side — the cheap sieve before the tree is asked. */
export function verticesNearBox(
  positions: Float32Array,
  transform: Rigid | null,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  margin: number,
): Uint32Array {
  const n = positions.length / 3
  const x0 = min[0] - margin, y0 = min[1] - margin, z0 = min[2] - margin
  const x1 = max[0] + margin, y1 = max[1] + margin, z1 = max[2] + margin
  const out = new Uint32Array(n)
  const p = new Float64Array(3)
  let w = 0
  for (let v = 0; v < n; v++) {
    let x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2]
    if (transform) {
      rigidApply(transform, x, y, z, p)
      x = p[0]; y = p[1]; z = p[2]
    }
    if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue
    out[w++] = v
  }
  return w === n ? out : out.slice(0, w)
}

/** The signed distance of every scan vertex within reach of the surface —
 *  `reach` millimetres of its bounding box, then of the surface itself.
 *  Vertices further than the reach are dropped from the field rather than
 *  read as off-scale: a vertex a wall away from the feature is not a
 *  deviation of the feature, it is another part of the scan. */
function sparseDeviation(
  surface: NominalSurface,
  positions: Float32Array,
  transform: Rigid | null,
  reach: number,
  /** Also name the vertices deeper inside the surface than the reach —
   *  see SparseField.farInside. */
  farInside: boolean,
  side: ScanSide | null,
  sheet: Uint8Array | null,
  range: number,
): SparseField {
  const near = verticesNearBox(positions, transform, surface.bboxMin, surface.bboxMax, reach)
  const reader = sideReader(surface, positions, transform, side, sheet, near, range)
  const m = transform ?? identityRigid()
  const hit = emptyHit()
  const p = new Float64Array(3)
  const subset = new Uint32Array(near.length)
  const values = new Float32Array(near.length)
  const deep = farInside ? new Uint32Array(near.length) : null
  let w = 0
  let f = 0
  for (let i = 0; i < near.length; i++) {
    const v = near[i]
    rigidApply(m, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], p)
    // The distance is unbounded: a vertex past the reach is dropped from
    // the field, not unread — so the ones deep inside come for nothing.
    if (reader.read(v, p, hit, Infinity, reach) !== 'read') continue
    const d = hit.signed
    if (!(Math.abs(d) <= reach)) {
      if (deep && d < -reach) deep[f++] = v
      continue
    }
    subset[w] = v
    values[w] = d
    w++
  }
  return { subset: subset.slice(0, w), values: values.slice(0, w), ...(deep ? { farInside: deep.slice(0, f) } : {}) }
}

/** The whole map for one range: the vertices within `LIVE_MAP_REACH` ranges
 *  of the surface and their signed distances — and, against the bodies,
 *  the vertices deep inside them. With `side`, the scan is read by the
 *  way it faces (ScanSide), and a sheet among the bodies (`sheet`, see
 *  sheetTriangles) on its front only. */
export function liveMap(
  surface: NominalSurface,
  positions: Float32Array,
  transform: Rigid | null,
  range: number,
  farInside = false,
  side: ScanSide | null = null,
  sheet: Uint8Array | null = null,
): SparseField {
  return sparseDeviation(surface, positions, transform, liveMapReach(range), farInside, side, sheet, Math.max(range, LIVE_MAP_MIN_RANGE_MM))
}

export function liveMapReach(range: number): number {
  return Math.max(range, LIVE_MAP_MIN_RANGE_MM) * LIVE_MAP_REACH
}

/** How the map is read: the Deviation ramp about zero at ± the range, a
 *  cap past either end out to the reach — everything in the field is
 *  a measurement, so nothing in it is drawn as unmeasured. */
export function liveMapScale(range: number): FieldScale {
  return deviationScale(Math.max(range, LIVE_MAP_MIN_RANGE_MM), liveMapReach(range), null)
}

/** Colour the field's values in the chosen colour map, three bytes per
 *  subset entry. */
export function paintSparse(field: SparseField, scale: FieldScale, map: Colormap, out?: Uint8Array): Uint8Array {
  const rgb = out && out.length === field.values.length * 3 ? out : new Uint8Array(field.values.length * 3)
  paintField(field.values, scale, map, rgb)
  return rgb
}

/** What the box says about the map: how many vertices it read, how many
 *  of them lie within the range, and how many lie deep inside the bodies. */
export function sparseSummary(field: SparseField, range: number): { points: number; within: number; farInside: number } {
  const { values } = field
  let within = 0
  for (let i = 0; i < values.length; i++) if (Math.abs(values[i]) <= range) within++
  return { points: values.length, within, farInside: field.farInside?.length ?? 0 }
}

/** The field's vertices and colours as the viewport paints them: the ramp
 *  over the read vertices, the far-inside colour over the deep ones. */
export function paintedSparse(field: SparseField, scale: FieldScale, map: Colormap): { subset: Uint32Array; rgb: Uint8Array } {
  const rgb = paintSparse(field, scale, map)
  const deep = field.farInside
  if (!deep || deep.length === 0) return { subset: field.subset, rgb }
  const subset = new Uint32Array(field.subset.length + deep.length)
  subset.set(field.subset)
  subset.set(deep, field.subset.length)
  const all = new Uint8Array(subset.length * 3)
  all.set(rgb)
  for (let i = field.subset.length; i < subset.length; i++) {
    all[i * 3] = FAR_INSIDE_RGB[0]
    all[i * 3 + 1] = FAR_INSIDE_RGB[1]
    all[i * 3 + 2] = FAR_INSIDE_RGB[2]
  }
  return { subset, rgb: all }
}
