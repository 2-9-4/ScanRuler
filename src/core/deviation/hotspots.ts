// SPDX-License-Identifier: AGPL-3.0-only
// Where a deviation map lies past its tolerance, as patches: the vertices
// over tolerance gathered into connected regions, each with its centre, its
// box, its area, its mean and its extreme reading. One number over a part
// says that something is off; a list of patches says where, how large and
// how far — what a review of a model against a scan reads first.
//
// Connectivity is by distance, not by the scan's triangles: two vertices
// over tolerance within `grain` of each other, on the same side of the
// surface, are one patch. The grain is a few point spacings, so a patch
// survives the odd vertex under tolerance inside it and two patches a wall
// apart stay two. The spacing is read off the points themselves — the
// median distance to the nearest other vertex over tolerance — and gives
// the area too, as count × spacing², the area a vertex stands for on an
// evenly sampled surface.
//
// Each patch says how deep it lies (the median reading), how much lies
// past the tolerance in mm³, and so whether it is a feature or texture
// (patchKind.ts).

import type { Vec3 } from '../types'
import { makeUnionFind } from '../geometry/unionFind'
import { FEATURE_DEPTH, patchKind, type PatchKind } from './patchKind'

export interface Hotspot {
  /** How many entries of the field lie in the patch. */
  count: number
  centroid: Vec3
  min: Vec3
  max: Vec3
  /** The mean signed reading over the patch, and the one farthest from
   *  zero — positive outside the surface, as the field has it. */
  mean: number
  extreme: number
  /** What lies past the tolerance, summed over the patch: Σ (|d| −
   *  tolerance). The patches are ranked by it — large and far first. */
  excess: number
  /** mm², from the point spacing. */
  area: number
  /** mm³ past the tolerance: the excess times the area a vertex stands
   *  for — the ranking key in units a person reads. */
  volume: number
  /** The median |reading| over the patch: how deep it lies, the odd spike
   *  aside. */
  depth: number
  /** A feature (broad and deep — patchKind.ts) or texture. */
  kind: PatchKind
  /** Where the extreme reading is, and which field entry it is. */
  at: Vec3
  index: number
  /** Every field entry in the patch. */
  members: Uint32Array
}

export interface HotspotOptions {
  /** How close two vertices over tolerance have to be to be one patch,
   *  mm; a few point spacings by default (GRAIN_SPACINGS). */
  grain?: number
  /** How many patches to give, the largest excess first; 8 by default. */
  limit?: number
  /** A patch of fewer vertices is noise and left out; 3 by default. */
  minCount?: number
  /** Which entries to consider at all — every finite one by default. */
  only?: (i: number) => boolean
  /** A key that keeps entries apart: two entries with different keys are
   *  never one patch, whatever their distance — the face each lies nearest,
   *  say, so a patch never runs off one face onto the next. */
  group?: (i: number) => number
  /** How deep a patch has to lie, median |reading|, to be a feature;
   *  FEATURE_DEPTH × the tolerance by default. A caller gathering what lies
   *  past some other line than the tolerance — the search distance — gives
   *  the map's own here. */
  featureDepth?: number
}

export interface HotspotReport {
  patches: Hotspot[]
  /** How many patches there were in all, the small ones included. */
  found: number
  /** How many entries lie over the tolerance. */
  over: number
  /** The feature patches among all found, and their share of everything
   *  past the tolerance (Σ excess over every entry over it), 0–1. */
  features: { count: number; shareOfExcess: number }
  /** The point spacing read, mm, and the grain used. */
  spacing: number
  grain: number
}

/** The grain, as a multiple of the point spacing: two spacings would make
 *  a hole of one missing vertex a seam; three keep a patch whole across the
 *  gaps a scan has and still part what lies a wall away. */
const GRAIN_SPACINGS = 3
const DEFAULT_LIMIT = 8
const DEFAULT_MIN_COUNT = 3
/** How many vertices the spacing is read off, at most. */
const SPACING_SAMPLE = 2000

/**
 * The patches of `points` (x, y, z per entry) whose `values` lie past
 * `tolerance` either way.
 */
export function hotspots(points: Float32Array, values: Float32Array, tolerance: number, options: HotspotOptions = {}): HotspotReport {
  const n = values.length
  const only = options.only
  const sel: number[] = []
  for (let i = 0; i < n; i++) {
    const v = values[i]
    if (!Number.isFinite(v) || Math.abs(v) <= tolerance) continue
    if (only && !only(i)) continue
    sel.push(i)
  }
  const empty = { patches: [], found: 0, over: sel.length, features: { count: 0, shareOfExcess: 0 }, spacing: 0, grain: options.grain ?? 0 }
  if (sel.length === 0) return empty
  const spacing = pointSpacing(points, sel)
  const grain = options.grain ?? Math.max(spacing * GRAIN_SPACINGS, 1e-6)
  if (!(grain > 0)) return { ...empty, spacing }

  // Union-find over the selected entries, joined within the grain.
  const m = sel.length
  const { find, union } = makeUnionFind(m)
  const grid = gridOf(points, sel, grain)
  const group = options.group
  const g2 = grain * grain
  for (let i = 0; i < m; i++) {
    const a = sel[i]
    const ax = points[a * 3], ay = points[a * 3 + 1], az = points[a * 3 + 2]
    const sign = values[a] > 0
    const ga = group ? group(a) : 0
    grid.near(ax, ay, az, (j) => {
      if (j <= i) return
      const b = sel[j]
      if ((values[b] > 0) !== sign) return
      if (group && group(b) !== ga) return
      const dx = points[b * 3] - ax, dy = points[b * 3 + 1] - ay, dz = points[b * 3 + 2] - az
      if (dx * dx + dy * dy + dz * dz <= g2) union(i, j)
    })
  }

  // The patches, gathered.
  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < m; i++) {
    const r = find(i)
    let list = byRoot.get(r)
    if (!list) byRoot.set(r, (list = []))
    list.push(i)
  }
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT
  const featureDepth = options.featureDepth ?? FEATURE_DEPTH * tolerance
  const patches: Hotspot[] = []
  let allExcess = 0
  for (const e of sel) allExcess += Math.abs(values[e]) - tolerance
  let featureExcess = 0
  let featureCount = 0
  for (const list of byRoot.values()) {
    if (list.length < minCount) continue
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    const centroid: Vec3 = [0, 0, 0]
    let sum = 0, excess = 0, extreme = 0, index = -1
    const members = new Uint32Array(list.length)
    const abs = new Float32Array(list.length)
    list.forEach((i, k) => {
      const e = sel[i]
      members[k] = e
      const v = values[e]
      sum += v
      abs[k] = Math.abs(v)
      excess += Math.abs(v) - tolerance
      if (Math.abs(v) > Math.abs(extreme)) {
        extreme = v
        index = e
      }
      for (let c = 0; c < 3; c++) {
        const p = points[e * 3 + c]
        centroid[c] += p / list.length
        if (p < min[c]) min[c] = p
        if (p > max[c]) max[c] = p
      }
    })
    abs.sort()
    const half = list.length >> 1
    const depth = list.length % 2 ? abs[half] : (abs[half - 1] + abs[half]) / 2
    const area = list.length * spacing * spacing
    const kind = patchKind(area, depth, spacing, featureDepth)
    if (kind === 'feature') {
      featureCount++
      featureExcess += excess
    }
    patches.push({
      count: list.length,
      centroid,
      min,
      max,
      mean: sum / list.length,
      extreme,
      excess,
      area,
      volume: excess * spacing * spacing,
      depth,
      kind,
      at: [points[index * 3], points[index * 3 + 1], points[index * 3 + 2]],
      index,
      members,
    })
  }
  patches.sort((a, b) => b.excess - a.excess)
  const features = { count: featureCount, shareOfExcess: allExcess > 0 ? featureExcess / allExcess : 0 }
  return { patches: patches.slice(0, options.limit ?? DEFAULT_LIMIT), found: patches.length, over: m, features, spacing, grain }
}

/** How many cells a side the grid's numeric keys tell apart exactly. */
const KEY_SIDE = 131072
const KEY_HALF = KEY_SIDE / 2

/** A hash grid over the selected entries, for asking what lies in the
 *  cell about a point and the 26 around it. A cell's key is a number, much
 *  quicker to look up than a string; past KEY_SIDE cells a side two cells
 *  may share a key, which only hands a caller more entries to measure. */
export function gridOf(points: Float32Array, sel: readonly number[], cell: number) {
  const cells = new Map<number, number[]>()
  const keyOf = (cx: number, cy: number, cz: number) => ((cx + KEY_HALF) * KEY_SIDE + (cy + KEY_HALF)) * KEY_SIDE + (cz + KEY_HALF)
  sel.forEach((e, i) => {
    const k = keyOf(Math.floor(points[e * 3] / cell), Math.floor(points[e * 3 + 1] / cell), Math.floor(points[e * 3 + 2] / cell))
    let list = cells.get(k)
    if (!list) cells.set(k, (list = []))
    list.push(i)
  })
  return {
    /** Every selected index (into `sel`) in the 27 cells about a point. */
    near(x: number, y: number, z: number, visit: (j: number) => void): void {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const list = cells.get(keyOf(cx + dx, cy + dy, cz + dz))
            if (list) for (const j of list) visit(j)
          }
    },
  }
}

/** The median distance from a selected entry to the nearest other one,
 *  over a sample — the scan's point spacing where it lies over
 *  tolerance. Zero when there is only one. */
export function pointSpacing(points: Float32Array, sel: readonly number[]): number {
  if (sel.length < 2) return 0
  // A coarse grid first: the spacing is not known yet, so the cell is a
  // share of the box the entries span.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const e of sel)
    for (let c = 0; c < 3; c++) {
      const p = points[e * 3 + c]
      if (p < min[c]) min[c] = p
      if (p > max[c]) max[c] = p
    }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  // About as many cells along the box as there are entries per cell when
  // they lie on a surface: a cell holds a handful.
  const cell = Math.max(diag / Math.max(4, Math.cbrt(sel.length) * 2), 1e-9)
  const grid = gridOf(points, sel, cell)
  const stride = Math.max(1, Math.floor(sel.length / SPACING_SAMPLE))
  const nearest: number[] = []
  for (let i = 0; i < sel.length; i += stride) {
    const a = sel[i]
    const ax = points[a * 3], ay = points[a * 3 + 1], az = points[a * 3 + 2]
    let best = Infinity
    grid.near(ax, ay, az, (j) => {
      if (j === i) return
      const b = sel[j]
      const dx = points[b * 3] - ax, dy = points[b * 3 + 1] - ay, dz = points[b * 3 + 2] - az
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < best) best = d2
    })
    if (Number.isFinite(best)) nearest.push(Math.sqrt(best))
  }
  if (nearest.length === 0) return cell
  nearest.sort((a, b) => a - b)
  return nearest[Math.floor(nearest.length / 2)]
}
