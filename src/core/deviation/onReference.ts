// SPDX-License-Identifier: AGPL-3.0-only
// The deviation map the other way round: the reference read against the
// scan. The map on the scan says where the scan stands off the reference —
// and nothing at all where the scan has no surface: reference material the
// part has not (a boss modelled where there is air) shows on the scan at
// best where it meets the wall, and reference surface nothing was scanned
// at never shows. Read on the reference, both are painted on the surface
// that is wrong, and the share of the reference the scan stands behind is
// a number.
//
// A reference tessellation has few vertices on a plane and long slivers on
// a cylinder, so it is first cut finer — every triangle in rows about the
// spacing apart, each row in pieces as long — and each vertex of the finer
// mesh is one reading,
// painted as the map's colour there. A reading is the signed distance to
// the scan, positive where the reference stands outside it, taken only off
// scan surface that faces the way the reference does (the far skin of a
// thin wall is not the near one's evidence) and lies square under the
// point (past the scan's rim the nearest scan is beside the point, not
// under it). With none, the point is NaN: no scan.

import type { FieldScale } from '../field/colormap'
import { deviationScale } from './deviation'
import { rigidApply, rigidRotate, type Rigid } from './rigid'
import { emptyHit, type NominalSurface } from './surface'

/** The reference cut finer for its map: a mesh of its own, every vertex a
 *  reading, each triangle with the reference triangle it lies in. */
export interface ReferenceSamples {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** Per triangle, the reference triangle it was cut from. */
  parent: Uint32Array
  /** How far apart its readings were cut to lie, mm. */
  spacing: number
}

/** How far the scan's surface may be from facing the way the reference
 *  does before it is no evidence of it, degrees, until the user sets
 *  another. Tighter than the scan's map (90°): a point the scan missed is
 *  told by nothing facing it, and a wall at right angles beside it is not
 *  its surface. */
export const DEFAULT_REFERENCE_FACING_DEG = 60

/** The most triangles a reference is cut into; past it the spacing opens. */
export const MAX_SAMPLE_TRIANGLES = 2_000_000

/** The finest and the coarsest the readings are cut to lie apart for a
 *  tolerance, mm. */
export const MIN_SAMPLE_SPACING = 0.25
export const MAX_SAMPLE_SPACING = 2

/** The spacing wanted for a tolerance of ±`tolerance`: twice it, so a
 *  patch over tolerance is a few readings across, but no finer than a
 *  quarter of a millimetre and no coarser than two. */
export function wantedSpacing(tolerance: number): number {
  return Math.min(MAX_SAMPLE_SPACING, Math.max(MIN_SAMPLE_SPACING, tolerance * 2))
}

/** Where the spacing opens, it opens onto one of these, times a power of
 *  ten — preferred numbers about an eighth apart: a reference edited a
 *  little — a face moved, a hole added — has a little more or less area,
 *  and keeps the spacing it had, so the maps before and after are read
 *  alike. */
const OPEN_STEPS = [1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.6, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10]

/** The spacing a reference of this area is cut to: `wanted`, opened as far
 *  as keeps it under MAX_SAMPLE_TRIANGLES, onto the next of OPEN_STEPS.
 *  Cut to about s, a triangle holds about s²/2 of area. */
export function sampleSpacing(area: number, wanted: number): number {
  const needed = Math.sqrt((2 * area) / MAX_SAMPLE_TRIANGLES)
  if (needed <= wanted) return wanted
  const decade = 10 ** Math.floor(Math.log10(needed))
  const step = OPEN_STEPS.find((s) => s * decade >= needed * (1 - 1e-9))!
  return Number((step * decade).toPrecision(6))
}

/** A mesh's surface area, mm². */
export function meshArea(positions: Float32Array, indices: Uint32Array): number {
  let area = 0
  for (let t = 0; t < indices.length; t += 3) area += triangleArea(positions, indices[t], indices[t + 1], indices[t + 2])
  return area
}

/**
 * The reference cut so that its readings lie about `spacing` apart: each
 * triangle in rows parallel to its longest edge, as many as its height
 * takes, each row in pieces no longer than the spacing, neighbouring rows
 * stitched. A sliver is one row — cut by its area, not its length. Where
 * two triangles cut a shared edge alike their points are one vertex; where
 * not, the pieces lie on the edge from either side — no gap. Normals are
 * the reference's vertex normals carried across each triangle, or, where
 * none are given, each corner's as cornerNormals has it.
 */
export function subdivideForMap(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array | null,
  spacing: number,
): ReferenceSamples {
  const vn = normals ? null : cornerNormals(positions, indices)
  const pos: number[] = []
  const nor: number[] = []
  const out: number[] = []
  const parent: number[] = []
  const corner = [0, 0, 0]
  // A point two triangles both make — a corner they share, the pieces of
  // an edge both cut alike — is one vertex where they face the same way:
  // the readings would otherwise lie twice at one place, and a spacing read
  // off the points' nearest neighbours would come out nothing. Where they
  // face apart, a sharp edge, each keeps its own.
  const welded = new Map<string, number[]>()
  for (let t = 0; t < indices.length; t += 3) {
    // The longest edge first, the winding kept: A→B the longest, C the far
    // corner.
    const v = [indices[t], indices[t + 1], indices[t + 2]]
    const l = [0, 1, 2].map((i) => dist(positions, v[i], v[(i + 1) % 3]))
    const first = l[0] >= l[1] && l[0] >= l[2] ? 0 : l[1] >= l[2] ? 1 : 2
    const a = v[first], b = v[(first + 1) % 3], c = v[(first + 2) % 3]
    const long = l[first]
    const height = long > 0 ? (2 * triangleArea(positions, a, b, c)) / long : 0
    const rows = Math.max(1, Math.ceil(height / spacing))
    const point = (wa: number, wb: number, wc: number) => {
      const at = pos.length / 3
      let nx = 0, ny = 0, nz = 0
      for (let k = 0; k < 3; k++) {
        corner[k] = wa * positions[a * 3 + k] + wb * positions[b * 3 + k] + wc * positions[c * 3 + k]
      }
      // Each corner's normal as this triangle has it: the reference's own
      // where given, else the faces round the corner within the crease.
      const na = vn ? t + ((first + 0) % 3) : a, nb = vn ? t + ((first + 1) % 3) : b, nc = vn ? t + ((first + 2) % 3) : c
      const src = vn ?? normals!
      nx = wa * src[na * 3] + wb * src[nb * 3] + wc * src[nc * 3]
      ny = wa * src[na * 3 + 1] + wb * src[nb * 3 + 1] + wc * src[nc * 3 + 1]
      nz = wa * src[na * 3 + 2] + wb * src[nb * 3 + 2] + wc * src[nc * 3 + 2]
      const ln = Math.hypot(nx, ny, nz) || 1
      nx /= ln
      ny /= ln
      nz /= ln
      const key = `${Math.round(corner[0] * WELD)},${Math.round(corner[1] * WELD)},${Math.round(corner[2] * WELD)}`
      const same = welded.get(key)
      for (const w of same ?? []) if (nor[w * 3] * nx + nor[w * 3 + 1] * ny + nor[w * 3 + 2] * nz > WELD_FACING) return w
      if (same) same.push(at)
      else welded.set(key, [at])
      pos.push(corner[0], corner[1], corner[2])
      nor.push(nx, ny, nz)
      return at
    }
    // Row i runs from A towards C to B towards C, i/rows of the way up;
    // the last is C alone.
    const row = (i: number): { at: number[]; t: number[] } => {
      const up = i / rows
      const pieces = i === rows ? 0 : Math.max(1, Math.ceil((long * (1 - up)) / spacing))
      const at: number[] = []
      const ts: number[] = []
      for (let j = 0; j <= pieces; j++) {
        const along = pieces === 0 ? 0 : j / pieces
        at.push(point((1 - up) * (1 - along), (1 - up) * along, up))
        ts.push(along)
      }
      return { at, t: ts }
    }
    let lower = row(0)
    for (let i = 1; i <= rows; i++) {
      const upper = row(i)
      let j = 0
      let k = 0
      const nj = lower.at.length - 1
      const nk = upper.at.length - 1
      while (j < nj || k < nk) {
        if (j < nj && (k === nk || lower.t[j + 1] <= upper.t[k + 1])) {
          out.push(lower.at[j], lower.at[j + 1], upper.at[k])
          j++
        } else {
          out.push(lower.at[j], upper.at[k + 1], upper.at[k])
          k++
        }
        parent.push(t / 3)
      }
      lower = upper
    }
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nor), indices: Uint32Array.from(out), parent: Uint32Array.from(parent), spacing }
}

/** Points within a hundred-thousandth of a millimetre are one, facing
 *  within about 8° of each other. */
const WELD = 1e5
const WELD_FACING = 0.99

/** Faces meeting at a corner within this angle are one smooth surface; past
 *  it the corner is a sharp edge, each side keeping its own normal. */
const CREASE_DEG = 30

/**
 * A normal for every corner of every triangle — three per triangle, in the
 * index buffer's order: the area-weighted normals of the triangles round
 * that vertex that lie within CREASE_DEG of this one. A cube's corner is
 * three flat faces, each its own; a cylinder's facets are one smooth side.
 * Averaged across a sharp edge, a normal would lean the shading of every
 * face it meets, and turn the facing test there onto the neighbouring face.
 */
function cornerNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const triangles = indices.length / 3
  const vertices = positions.length / 3
  const face = new Float32Array(triangles * 3)
  for (let t = 0; t < triangles; t++) {
    const n = cross(positions, indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2])
    face.set(n, t * 3)
  }
  // The triangles round each vertex, as offsets into one list.
  const count = new Uint32Array(vertices + 1)
  for (let i = 0; i < indices.length; i++) count[indices[i] + 1]++
  for (let v = 0; v < vertices; v++) count[v + 1] += count[v]
  const round = new Uint32Array(indices.length)
  const fill = count.slice(0, vertices)
  for (let i = 0; i < indices.length; i++) round[fill[indices[i]]++] = Math.floor(i / 3)
  const crease = Math.cos((CREASE_DEG * Math.PI) / 180)
  const out = new Float32Array(indices.length * 3)
  const unit = (t: number): [number, number, number] => {
    const l = Math.hypot(face[t * 3], face[t * 3 + 1], face[t * 3 + 2]) || 1
    return [face[t * 3] / l, face[t * 3 + 1] / l, face[t * 3 + 2] / l]
  }
  for (let t = 0; t < triangles; t++) {
    const own = unit(t)
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k]
      let x = 0, y = 0, z = 0
      for (let j = count[v]; j < count[v + 1]; j++) {
        const o = round[j]
        const u = unit(o)
        if (u[0] * own[0] + u[1] * own[1] + u[2] * own[2] < crease) continue
        x += face[o * 3]
        y += face[o * 3 + 1]
        z += face[o * 3 + 2]
      }
      const l = Math.hypot(x, y, z) || 1
      out.set([x / l, y / l, z / l], (t * 3 + k) * 3)
    }
  }
  return out
}

function dist(p: ArrayLike<number>, a: number, b: number): number {
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2])
}

export interface ReferenceReadOptions {
  /** Takes the reference's coordinates into the scan's. */
  toScan: Rigid
  /** How far from a point the scan is looked for, mm; past it, no scan. */
  reach: number
  /** How far the scan's surface may be from facing the way the reference
   *  does, degrees; null takes the nearest whatever it faces. */
  facingDeg: number | null
  onProgress?: (fraction: number) => void
}

/** How far from square under a point the scan it is read against may lie:
 *  the line from the scan to the point within this of the scan's normal.
 *  A point past the scan's rim finds the rim beside it, along the surface,
 *  not under it — that is no reading of the point. */
const SQUARE_DEG = 60
/** Readings nearer than this are on the surface, whatever the line's
 *  direction, mm. */
const ON_SURFACE = 1e-3

/**
 * Every vertex of the finer reference read against the scan: the signed
 * distance to it, positive where the reference stands outside the scan,
 * NaN where no scan within `reach` faces its way and lies under it. The
 * scan's winding is settled first by which way most of its nearest faces
 * agree with the reference — a scan too open to settle on loading can come
 * in either way round.
 */
export function readReference(scan: NominalSurface, samples: ReferenceSamples, { toScan, reach, facingDeg, onProgress }: ReferenceReadOptions): Float32Array {
  const { positions, normals } = samples
  const n = positions.length / 3
  const values = new Float32Array(n)
  const hit = emptyHit()
  const p = new Float64Array(3)
  const sn = new Float64Array(3)
  const outward = scanOutward(scan, samples, toScan, reach)
  const minFacing = facingDeg === null ? null : Math.cos((facingDeg * Math.PI) / 180)
  const square = Math.cos((SQUARE_DEG * Math.PI) / 180)
  const chunk = Math.max(1, Math.floor(n / 50))
  for (let v = 0; v < n; v++) {
    rigidApply(toScan, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], p)
    rigidRotate(toScan, normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2], sn)
    let found = scan.closest(p[0], p[1], p[2], hit, reach)
    if (found && minFacing !== null && outward * (sn[0] * hit.nx + sn[1] * hit.ny + sn[2] * hit.nz) < minFacing) {
      // The scan's faces are tested by their own winding: the reference's
      // normal turned the way the scan is wound.
      found =
        scan.closestFacing(p[0], p[1], p[2], outward * sn[0], outward * sn[1], outward * sn[2], minFacing, hit, reach) &&
        outward * (sn[0] * hit.nx + sn[1] * hit.ny + sn[2] * hit.nz) >= minFacing
    }
    if (found && hit.distance > ON_SURFACE) {
      const along = Math.abs((p[0] - hit.px) * hit.nx + (p[1] - hit.py) * hit.ny + (p[2] - hit.pz) * hit.nz) / hit.distance
      if (along < square) found = false
    }
    values[v] = found ? outward * hit.signed : NaN
    if (onProgress && v % chunk === 0) onProgress(v / n)
  }
  onProgress?.(1)
  return values
}

/** 1 when the scan is wound with its normals out of the material, as the
 *  reference is; -1 when it came in the other way round. */
function scanOutward(scan: NominalSurface, samples: ReferenceSamples, toScan: Rigid, reach: number): 1 | -1 {
  const { positions, normals } = samples
  const n = positions.length / 3
  const step = Math.max(1, Math.floor(n / 2000))
  const hit = emptyHit()
  const p = new Float64Array(3)
  const sn = new Float64Array(3)
  let agreement = 0
  for (let v = 0; v < n; v += step) {
    rigidApply(toScan, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], p)
    if (!scan.closest(p[0], p[1], p[2], hit, reach)) continue
    rigidRotate(toScan, normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2], sn)
    agreement += sn[0] * hit.nx + sn[1] * hit.ny + sn[2] * hit.nz
  }
  return agreement < 0 ? -1 : 1
}

/** What a map on the reference covers, mm² each: its area; what the scan
 *  stands behind within the search distance (every corner of a triangle
 *  read, none past it) and how much of that lies within ±tolerance; what
 *  stands past the search distance from the scan (a corner past it); and
 *  what no scan stands behind (a corner with no reading). */
export interface ReferenceCoverage {
  area: number
  backed: number
  withinTolerance: number
  far: number
  noScan: number
}

export function referenceCoverage(samples: ReferenceSamples, values: Float32Array, tolerance: number, maxDistance = Infinity): ReferenceCoverage {
  const { positions, indices } = samples
  const out: ReferenceCoverage = { area: 0, backed: 0, withinTolerance: 0, far: 0, noScan: 0 }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2]
    const s = triangleArea(positions, a, b, c)
    out.area += s
    const va = Math.abs(values[a]), vb = Math.abs(values[b]), vc = Math.abs(values[c])
    if (Number.isNaN(va) || Number.isNaN(vb) || Number.isNaN(vc)) out.noScan += s
    else if (va > maxDistance || vb > maxDistance || vc > maxDistance) out.far += s
    else {
      out.backed += s
      if (va <= tolerance && vb <= tolerance && vc <= tolerance) out.withinTolerance += s
    }
  }
  return out
}

/** How the map on the reference is read as colour: as the scan's, but a
 *  reading past the search distance is a reading — the reference standing
 *  that far off the scan, drawn in the cap of its end — and only a point
 *  with no scan behind it is bare. */
export function referenceScale(range: number, maxDistance: number, bands: number | null): FieldScale {
  return { ...deviationScale(range, maxDistance, bands), validMin: -Infinity, validMax: Infinity }
}

function triangleArea(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const n = cross(p, a, b, c)
  return Math.hypot(n[0], n[1], n[2]) / 2
}

function cross(p: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}
