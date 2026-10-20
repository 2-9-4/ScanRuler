// SPDX-License-Identifier: AGPL-3.0-only
// Draft read off a scan against a pull direction: the walls that run near
// the pull — the sides a mould opens along, a core slides along — gathered
// into patches, each with the angle it leans off the pull. A moulded part's
// walls lean half a degree to a few; a part read without that in mind has
// its rails, rims and undersides miss their fits by the lean, which looks
// like noise, or warp, until the draft is seen. One call over the scan says
// which walls lean, which way and how far, before anything is modelled.
//
// A wall's draft is the angle its normal stands off square to the pull,
// positive where the wall faces partly along the pull — it lets go as the
// tool moves that way — and negative where it faces back: a back draft, an
// undercut to that pull. Neighbouring walls are kept apart by which way
// they face across the pull, so a box's four sides are four patches.

import { hotspots } from '../deviation/hotspots'
import type { Vec3 } from '../types'

export interface DraftOptions {
  /** How far off square to the pull a wall may lean and still count, degrees;
   *  10 by default. */
  nearDeg?: number
  /** How many patches to give, the largest first; 12 by default. */
  limit?: number
  /** How close two points have to be to be one patch, mm — three point
   *  spacings by default. */
  grain?: number
  /** Patches smaller than this, mm², are left out; 1 by default. */
  minArea?: number
}

export interface DraftPatch {
  centroid: Vec3
  min: Vec3
  max: Vec3
  area: number
  count: number
  /** The mean lean off the pull, degrees: positive lets go along the pull. */
  draftDeg: number
  /** Its standard error, degrees — the spread over √count — and the spread
   *  of the points' own leans, which is mostly the scan's normal noise. */
  sigmaDeg: number
  spreadDeg: number
  /** Which way the wall faces across the pull, a unit vector square to it. */
  facing: Vec3
}

export interface DraftReport {
  pull: Vec3
  nearDeg: number
  /** The points that lie on walls near the pull, of all read. */
  walls: number
  points: number
  patches: DraftPatch[]
  /** How many patches there were in all, the small ones included. */
  found: number
}

/** A jump in the way neighbouring points face across the pull this large
 *  parts two walls, degrees: a corner turns 90°, a round side never this
 *  much from one point to the next. */
const FACING_GAP_DEG = 20

/**
 * The walls of a scan near a pull direction, as patches with their draft.
 * `normals` are the scan's own, pointing out of the material.
 */
export function draftPatches(positions: Float32Array, normals: Float32Array, pullDir: Vec3, options: DraftOptions = {}): DraftReport {
  const len = Math.hypot(pullDir[0], pullDir[1], pullDir[2])
  if (!(len > 0)) throw new Error('The pull direction has no length.')
  const pull: Vec3 = [pullDir[0] / len, pullDir[1] / len, pullDir[2] / len]
  const nearDeg = options.nearDeg ?? 10
  const sinNear = Math.sin((nearDeg * Math.PI) / 180)
  const n = positions.length / 3
  const lean = new Float32Array(n).fill(NaN)
  const facing = new Float32Array(n).fill(NaN)
  // Two directions square to the pull, to tell which way a wall faces.
  const [e1, e2] = square(pull)
  let walls = 0
  for (let i = 0; i < n; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2]
    const nl = Math.hypot(nx, ny, nz)
    if (!(nl > 0)) continue
    const s = (nx * pull[0] + ny * pull[1] + nz * pull[2]) / nl
    if (Math.abs(s) > sinNear) continue
    lean[i] = (Math.asin(s) * 180) / Math.PI
    facing[i] = Math.atan2(nx * e2[0] + ny * e2[1] + nz * e2[2], nx * e1[0] + ny * e1[1] + nz * e1[2])
    walls++
  }
  const limit = options.limit ?? 12
  const minArea = options.minArea ?? 1
  // Every wall point is "over" a tolerance below any lean: the patches are
  // of all of them, by where they lie — then each cut where the way it
  // faces jumps, so a box's four sides are four walls and a boss's round
  // side one.
  const report = hotspots(positions, lean, -1, {
    limit: Math.max(limit * 4, 50),
    only: (i) => !Number.isNaN(lean[i]),
    ...(options.grain !== undefined ? { grain: options.grain } : {}),
  })
  const patches: DraftPatch[] = []
  for (const p of report.patches) {
    for (const members of byFacing(p.members, facing)) {
      const area = (p.area * members.length) / p.members.length
      if (area < minArea) continue
      const patch = patchOf(members, area, positions, normals, lean, pull)
      // A strip a point or two wide along a sharp edge is the edge's
      // averaged normals, not a wall.
      if (widthAcross(members, positions, pull, patch.facing) < report.grain) continue
      patches.push(patch)
    }
  }
  patches.sort((a, b) => b.area - a.area)
  return { pull, nearDeg, walls, points: n, patches: patches.slice(0, limit), found: report.found }
}

/** A patch's points parted where the way they face jumps: sorted round by
 *  their facing, cut at every gap over FACING_GAP_DEG. */
function byFacing(members: Uint32Array, facing: Float32Array): number[][] {
  const order = Array.from(members).sort((a, b) => facing[a] - facing[b])
  const gap = (FACING_GAP_DEG * Math.PI) / 180
  const cuts: number[] = []
  for (let i = 0; i < order.length; i++) {
    const next = i + 1 < order.length ? facing[order[i + 1]] : facing[order[0]] + 2 * Math.PI
    if (next - facing[order[i]] > gap) cuts.push(i + 1)
  }
  if (cuts.length <= 1) return [order]
  // Round from the first cut, so a wall facing across ±180° stays whole.
  const out: number[][] = []
  for (let k = 0; k < cuts.length; k++) {
    const from = cuts[k] % order.length
    const to = cuts[(k + 1) % cuts.length] % order.length
    const run = from < to ? order.slice(from, to) : [...order.slice(from), ...order.slice(0, to)]
    out.push(run)
  }
  return out
}

/** A wall's figures off its points. */
function patchOf(members: readonly number[], area: number, positions: Float32Array, normals: Float32Array, lean: Float32Array, pull: Vec3): DraftPatch {
  let sum = 0
  let sumSq = 0
  const f: Vec3 = [0, 0, 0]
  const c: Vec3 = [0, 0, 0]
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const m of members) {
    const v = lean[m]
    sum += v
    sumSq += v * v
    for (let k = 0; k < 3; k++) {
      const x = positions[m * 3 + k]
      f[k] += normals[m * 3 + k]
      c[k] += x
      if (x < min[k]) min[k] = x
      if (x > max[k]) max[k] = x
    }
  }
  const count = members.length
  const mean = sum / count
  const spread = Math.sqrt(Math.max(0, sumSq / count - mean * mean))
  // The facing: the summed normals with their part along the pull taken
  // out.
  const along = f[0] * pull[0] + f[1] * pull[1] + f[2] * pull[2]
  const across: Vec3 = [f[0] - along * pull[0], f[1] - along * pull[1], f[2] - along * pull[2]]
  const al = Math.hypot(across[0], across[1], across[2]) || 1
  return {
    centroid: [c[0] / count, c[1] / count, c[2] / count],
    min,
    max,
    area,
    count,
    draftDeg: mean,
    sigmaDeg: spread / Math.sqrt(count),
    spreadDeg: spread,
    facing: [across[0] / al, across[1] / al, across[2] / al],
  }
}

/** How wide a wall's points lie across it: along the wall, square to the
 *  pull, mm. */
function widthAcross(members: readonly number[], positions: Float32Array, pull: Vec3, facing: Vec3): number {
  const t: Vec3 = [pull[1] * facing[2] - pull[2] * facing[1], pull[2] * facing[0] - pull[0] * facing[2], pull[0] * facing[1] - pull[1] * facing[0]]
  let lo = Infinity
  let hi = -Infinity
  for (const m of members) {
    const d = positions[m * 3] * t[0] + positions[m * 3 + 1] * t[1] + positions[m * 3 + 2] * t[2]
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  return hi - lo
}

/** Two unit directions square to `d` and to each other. */
function square(d: Vec3): [Vec3, Vec3] {
  const t: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const a: Vec3 = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]]
  const al = Math.hypot(a[0], a[1], a[2])
  const e1: Vec3 = [a[0] / al, a[1] / al, a[2] / al]
  const e2: Vec3 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]]
  return [e1, e2]
}
