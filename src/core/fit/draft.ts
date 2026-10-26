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
//
// Walls are first grown from point to neighbouring point, only between
// points that face nearly the same way. That keeps a corner's two walls
// apart, but a round turns little from one point to the next: the two sides
// of a thin wall, a blade or a rib, join round its ends, and a smooth
// freeform wall runs on round its curve, across a part's mirror plane. So
// each such wall is grown again into patches, a point joining a patch only
// while it also faces within the same angle of the patch's running mean
// facing: a patch's facings span at most about twice that. A boss's or a
// hole's round side faces every way, but all its normals pass through one
// axis: it stays one patch and is flagged. A split plane, the part's mirror
// plane say, keeps every patch to one side of it.

import { gridOf, pointSpacing } from '../deviation/hotspots'
import { makeUnionFind } from '../geometry/unionFind'
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
  /** No patch reaches across this plane — the part's mirror plane, so a
   *  handed part's two halves read apart. A round side is kept whole. */
  split?: { point: Vec3; normal: Vec3 }
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
  /** How far the way it faces turns across it, degrees: the spread of its
   *  points' facings, from the 2nd to the 98th percentile. */
  turnDeg: number
  /** With a split plane: the side of it the patch lies on, along its
   *  normal. */
  side?: 1 | -1
  /** Set when the wall's points face every way across the pull — a boss's
   *  or a hole's round side, or walls that could not be parted — so that
   *  `facing` names no one way. */
  round?: true
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
  /** The split plane, its normal a unit vector, when one was given. */
  split?: { point: Vec3; normal: Vec3 }
}

/** A jump in the way neighbouring points face across the pull this large
 *  parts two walls, degrees: a corner turns 90°, a round side never this
 *  much from one point to the next. A point also joins a patch only while
 *  it faces within this of the patch's mean facing. */
const FACING_GAP_DEG = 20
/** The grain, as a multiple of the point spacing, as deviation patches
 *  have it; and the fewest points a patch is made of. */
const GRAIN_SPACINGS = 3
const MIN_COUNT = 3
/** A wall whose facings, summed, come to less than this share of its
 *  count faces every way, and may be a round side: a boss's sum to about
 *  nothing; a wall curved through a half turn still to 0.64. */
const SHORT_FACING = 0.5

/** The wall points and what they are grouped by: where they lie, and which
 *  way they face across the pull, (fu, fv) in the plane of e1 and e2. */
interface Walls {
  positions: Float32Array
  fu: Float32Array
  fv: Float32Array
  e1: Vec3
  e2: Vec3
  grain: number
  /** With a split plane, which side of it each point lies on (0 or 1). */
  side?: Uint8Array
}

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
  // Two directions square to the pull, to tell which way a wall faces.
  const [e1, e2] = square(pull)
  const fu = new Float32Array(n)
  const fv = new Float32Array(n)
  const sel: number[] = []
  for (let i = 0; i < n; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2]
    const nl = Math.hypot(nx, ny, nz)
    if (!(nl > 0)) continue
    const s = (nx * pull[0] + ny * pull[1] + nz * pull[2]) / nl
    if (Math.abs(s) > sinNear) continue
    lean[i] = (Math.asin(s) * 180) / Math.PI
    const u = nx * e1[0] + ny * e1[1] + nz * e1[2]
    const v = nx * e2[0] + ny * e2[1] + nz * e2[2]
    const fl = Math.hypot(u, v)
    fu[i] = u / fl
    fv[i] = v / fl
    sel.push(i)
  }
  const limit = options.limit ?? 12
  const minArea = options.minArea ?? 1
  const walls = sel.length
  if (walls < MIN_COUNT) return { pull, nearDeg, walls, points: n, patches: [], found: 0 }
  // The spacing of the wall points gives the grain and the area a point
  // stands for.
  const spacing = pointSpacing(positions, sel)
  const grain = options.grain ?? Math.max(spacing * GRAIN_SPACINGS, 1e-6)
  const split = options.split && splitPlane(options.split)
  const w: Walls = { positions, fu, fv, e1, e2, grain }
  if (split) {
    const side = new Uint8Array(n)
    const { point: o, normal: d } = split
    for (const i of sel) side[i] = (positions[i * 3] - o[0]) * d[0] + (positions[i * 3 + 1] - o[1]) * d[1] + (positions[i * 3 + 2] - o[2]) * d[2] < 0 ? 1 : 0
    w.side = side
  }
  const parts: { members: number[]; round: boolean }[] = []
  for (const group of grow(sel, w)) settle(group, w, parts)
  const patches: DraftPatch[] = []
  for (const { members, round } of parts) {
    const area = members.length * spacing * spacing
    if (area < minArea) continue
    const patch = patchOf(members, area, positions, normals, lean, pull, w)
    // A strip a point or two wide along a sharp edge is the edge's
    // averaged normals, not a wall.
    if (widthAcross(members, positions, pull, patch.facing) < grain) continue
    if (round) patch.round = true
    else if (w.side) patch.side = w.side[members[0]] ? -1 : 1
    patches.push(patch)
  }
  patches.sort((a, b) => b.area - a.area)
  return { pull, nearDeg, walls, points: n, patches: patches.slice(0, limit), found: parts.length, ...(split ? { split } : {}) }
}

/** The split plane with a unit normal; refused with no length. */
function splitPlane(s: { point: Vec3; normal: Vec3 }): { point: Vec3; normal: Vec3 } {
  const l = Math.hypot(s.normal[0], s.normal[1], s.normal[2])
  if (!(l > 0)) throw new Error('The split plane has no normal.')
  return { point: [s.point[0], s.point[1], s.point[2]], normal: [s.normal[0] / l, s.normal[1] / l, s.normal[2] / l] }
}

/** The walls among `members`: points within the grain of each other that
 *  face within FACING_GAP_DEG of each other across the pull, joined. */
function grow(members: readonly number[], w: Walls): number[][] {
  const { positions: p, fu, fv } = w
  const cosGap = Math.cos((FACING_GAP_DEG * Math.PI) / 180)
  const g2 = w.grain * w.grain
  const { find, union } = makeUnionFind(members.length)
  const grid = gridOf(p, members, w.grain)
  for (let i = 0; i < members.length; i++) {
    const a = members[i]
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2]
    grid.near(ax, ay, az, (j) => {
      if (j <= i) return
      const b = members[j]
      if (fu[a] * fu[b] + fv[a] * fv[b] < cosGap) return
      const dx = p[b * 3] - ax, dy = p[b * 3 + 1] - ay, dz = p[b * 3 + 2] - az
      if (dx * dx + dy * dy + dz * dz <= g2) union(i, j)
    })
  }
  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < members.length; i++) {
    const r = find(i)
    let list = byRoot.get(r)
    if (!list) byRoot.set(r, (list = []))
    list.push(members[i])
  }
  return [...byRoot.values()].filter((list) => list.length >= MIN_COUNT)
}

/** A grown wall: kept whole when it is a round side, or when it faces
 *  within FACING_GAP_DEG of its mean and lies on one side of the split;
 *  otherwise grown again into patches by their running mean facing. */
function settle(members: number[], w: Walls, out: { members: number[]; round: boolean }[]): void {
  const { fu, fv, side } = w
  let su = 0, sv = 0
  for (const m of members) {
    su += fu[m]
    sv += fv[m]
  }
  const sl = Math.hypot(su, sv)
  if (sl < SHORT_FACING * members.length && roundSide(members, w)) {
    out.push({ members, round: true })
    return
  }
  const cosGap = Math.cos((FACING_GAP_DEG * Math.PI) / 180)
  let one = sl > 0
  for (const m of members) {
    if (!one) break
    if ((fu[m] * su + fv[m] * sv) / sl < cosGap || (side && side[m] !== side[members[0]])) one = false
  }
  if (one) {
    out.push({ members, round: false })
    return
  }
  for (const part of meanGrow(members, w)) out.push({ members: part, round: false })
}

/** A wall parted into patches, each grown from a seed over neighbours that
 *  face within FACING_GAP_DEG of the point they are reached from and of the
 *  patch's mean facing so far, on the seed's side of the split. Seeds are
 *  taken steadiest first — where the neighbourhood faces most one way, the
 *  middle of a flat rather than the turn of a round. */
function meanGrow(members: readonly number[], w: Walls): number[][] {
  const { positions: p, fu, fv, side } = w
  const cosGap = Math.cos((FACING_GAP_DEG * Math.PI) / 180)
  const g2 = w.grain * w.grain
  const grid = gridOf(p, members, w.grain)
  const n = members.length
  const close = (a: number, b: number) => {
    const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2]
    return dx * dx + dy * dy + dz * dz <= g2
  }
  const steady = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = members[i]
    let su = 0, sv = 0, c = 0
    grid.near(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], (j) => {
      const b = members[j]
      if (!close(a, b)) return
      su += fu[b]
      sv += fv[b]
      c++
    })
    steady[i] = c ? Math.hypot(su, sv) / c : 0
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => steady[b] - steady[a] || a - b)
  const owner = new Int32Array(n).fill(-1)
  const out: number[][] = []
  for (const s of order) {
    if (owner[s] >= 0) continue
    const id = out.length
    owner[s] = id
    const patch = [s]
    let mu = fu[members[s]], mv = fv[members[s]]
    for (let h = 0; h < patch.length; h++) {
      const a = members[patch[h]]
      const ml = Math.hypot(mu, mv) || 1
      const cu = mu / ml, cv = mv / ml
      grid.near(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], (j) => {
        if (owner[j] >= 0) return
        const b = members[j]
        if (side && side[a] !== side[b]) return
        if (fu[a] * fu[b] + fv[a] * fv[b] < cosGap || fu[b] * cu + fv[b] * cv < cosGap) return
        if (!close(a, b)) return
        owner[j] = id
        patch.push(j)
        mu += fu[b]
        mv += fv[b]
      })
    }
    out.push(patch.map((i) => members[i]))
  }
  return out.filter((list) => list.length >= MIN_COUNT)
}

/** Whether a patch facing every way is a round side, a boss's or a hole's:
 *  its normal lines, across the pull, all pass near one axis, and every
 *  point faces straight away from it or straight towards it. A thin wall's
 *  two sides fail the first when they are straight, and the second when
 *  they curve: one side faces away from its centre, the other towards. */
function roundSide(members: readonly number[], w: Walls): boolean {
  const { positions: p, fu, fv, e1, e2 } = w
  const n = members.length
  const at = (m: number): [number, number] => {
    const x = p[m * 3], y = p[m * 3 + 1], z = p[m * 3 + 2]
    return [x * e1[0] + y * e1[1] + z * e1[2], x * e2[0] + y * e2[1] + z * e2[2]]
  }
  // The point nearest all the normal lines: Σ (I − f fᵀ) c = Σ (I − f fᵀ) p.
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0
  for (const m of members) {
    const [u, v] = at(m)
    const m11 = 1 - fu[m] * fu[m], m12 = -fu[m] * fv[m], m22 = 1 - fv[m] * fv[m]
    a11 += m11
    a12 += m12
    a22 += m22
    b1 += m11 * u + m12 * v
    b2 += m12 * u + m22 * v
  }
  const det = a11 * a22 - a12 * a12
  // Normal lines nearly all parallel meet nowhere; a round's spread all
  // ways give n²/4.
  if (!(det > 0.05 * n * n)) return false
  const cu = (b1 * a22 - b2 * a12) / det
  const cv = (a11 * b2 - a12 * b1) / det
  let facing = 0, miss = 0, reach = 0
  for (const m of members) {
    const [u, v] = at(m)
    const du = u - cu, dv = v - cv
    const dl = Math.hypot(du, dv)
    if (!(dl > 0)) continue
    facing += (fu[m] * du + fv[m] * dv) / dl
    const off = fu[m] * dv - fv[m] * du
    miss += off * off
    reach += dl
  }
  return Math.abs(facing) > 0.8 * n && Math.sqrt(miss / n) < (0.2 * reach) / n
}

/** A wall's figures off its points. */
function patchOf(members: readonly number[], area: number, positions: Float32Array, normals: Float32Array, lean: Float32Array, pull: Vec3, w: Walls): DraftPatch {
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
  // The turn: each point's facing as an angle off the mean facing, in the
  // plane square to the pull.
  const mu = (across[0] * w.e1[0] + across[1] * w.e1[1] + across[2] * w.e1[2]) / al
  const mv = (across[0] * w.e2[0] + across[1] * w.e2[1] + across[2] * w.e2[2]) / al
  const turn = new Float32Array(count)
  members.forEach((m, i) => (turn[i] = Math.atan2(mu * w.fv[m] - mv * w.fu[m], mu * w.fu[m] + mv * w.fv[m])))
  turn.sort()
  const turnDeg = ((turn[Math.floor(0.98 * (count - 1))] - turn[Math.floor(0.02 * (count - 1))]) * 180) / Math.PI
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
    turnDeg,
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
