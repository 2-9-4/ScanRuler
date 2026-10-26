// SPDX-License-Identifier: AGPL-3.0-only
// Which side of the material a section's points lie on: one skin of a thin
// wall told from the other, and the points that face a way.
//
// A cut through a moulded shell crosses each wall twice — once through the
// skin the part shows, once through the skin inside — and ribs and bosses
// on the inside add pieces of their own. A form fitted to all of it is
// pulled off both. Every point of a cut carries the direction out of the
// material there (slice.ts, from the scan's triangle winding), and with it
// the cut can be read for one side alone:
//
// - outer skin: a point whose outward direction faces away from the
//   middle of the cut (the mean of its points by length) and whose ray along
//   that direction leaves the cut without crossing it — the part as seen
//   from outside. A rib's face looks at the next rib or the wall it stands
//   on, and the inner skin of a closed shell at the wall across, so neither
//   is outer.
// - inner skin: a point whose outward direction faces the middle of the
//   cut and whose ray back through the material first comes out on the
//   outer skin, no farther than about the wall's thickness (one and a half
//   times the median of those distances over the cut) — the other side of
//   the same wall. A rib's face looks through the rib onto its other face,
//   not the outer skin, and a rib's tip through the rib and the wall, much
//   farther, so neither is a skin; a solid's far side faces away from the
//   middle, so a part that is not hollow has no inner skin.
// - facing: a point whose outward direction lies within an angle of a
//   direction given on the sheet.
//
// Each point is judged on its outward direction smoothed over its
// neighbours, and the verdict is cleaned along the chain: a gap in a kept
// stretch, or a kept stretch, shorter than a few point spacings takes its
// neighbours' verdict — the scan's noise, not the part. What is kept comes
// out as runs, each a chain of its own (runsWhere), the way a box on the
// sheet keeps a run of a chain.
//
// "Middle" is a judgement, not a measurement: a cut through an open shell
// (an arch, a cover) has it under the arch, which is what tells the arch's
// inside from its outside. Where that fails — a part whose cut has no
// clear inside — facing names the side by direction instead.

import type { EdgeChains } from '../flat/edges'
import type { Vec2 } from '../flat/types'

export type Skin = 'outer' | 'inner'

/** Points whose outward direction lies within `withinDeg` of `dir`. */
export interface Facing {
  dir: Vec2
  withinDeg: number
}

/** Which points to keep: a skin, a facing, or both (a point must pass
 *  both). */
export interface SideRule {
  skin?: Skin
  facing?: Facing
}

/** A cut laid flat as chains of points, each point with its outward
 *  direction on the sheet. */
export interface SidedChains {
  chains: Vec2[][]
  normals: Vec2[][]
}

/** How far off its direction facing takes a point's outward direction
 *  unless told, degrees. */
export const FACING_DEG = 60

/** How many neighbours on each side a point's direction is smoothed over. */
const SMOOTH = 2

/** A gap in a kept stretch, or a kept stretch, shorter than this many
 *  point spacings takes its neighbours' verdict. */
const CLEAN_SPACINGS = 4

/** How much thicker than the wall (the median over the cut) the material
 *  behind a point of the inner skin may be. */
const WALL_SHARE = 1.5

/** How many points on each side of a point a ray from it ignores on its own
 *  chain — the surface it starts from. */
const RAY_SKIP = 2

/** Segments are boxed in groups of this many for the ray tests. */
const CHUNK = 16

/** A cut's points and their outward directions as chains — the two laid
 *  flat by projectCut and projectCutNormals. */
export function sidedChains(edges: EdgeChains, normals: Float32Array): SidedChains {
  const chains: Vec2[][] = []
  const out: Vec2[][] = []
  for (let c = 0; c + 1 < edges.offsets.length; c++) {
    const chain: Vec2[] = []
    const n: Vec2[] = []
    for (let i = edges.offsets[c]; i < edges.offsets[c + 1]; i++) {
      chain.push([edges.points[i * 2], edges.points[i * 2 + 1]])
      n.push([normals[i * 2], normals[i * 2 + 1]])
    }
    chains.push(chain)
    out.push(n)
  }
  return { chains, normals: out }
}

/** Whether a chain comes back onto its own first point, as a section's
 *  loops do. */
const isClosed = (c: readonly Vec2[]) => c.length > 2 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]

/**
 * Per chain, per point, whether the point is on the side the rule asks for.
 * The chains and their directions are a whole cut (sidedChains): the skins
 * are judged against all of it, so pass every chain, not the few wanted.
 */
export function sideMask(chains: readonly (readonly Vec2[])[], normals: readonly (readonly Vec2[])[], rule: SideRule): boolean[][] {
  const lens = chains.map((c) => (isClosed(c) ? c.length - 1 : c.length))
  const closed = chains.map(isClosed)
  // Directions smoothed along each chain, round a loop.
  const dirs: Vec2[][] = chains.map((_, c) => {
    const n = lens[c]
    const out: Vec2[] = []
    for (let i = 0; i < n; i++) {
      let u = 0, v = 0
      for (let k = -SMOOTH; k <= SMOOTH; k++) {
        let j = i + k
        if (closed[c]) j = ((j % n) + n) % n
        else if (j < 0 || j >= n) continue
        u += normals[c][j][0]
        v += normals[c][j][1]
      }
      const l = Math.hypot(u, v)
      out.push(l > 1e-9 ? [u / l, v / l] : [0, 0])
    }
    return out
  })
  // The spacing of the points, and the middle of the cut by length.
  const steps: number[] = []
  let mu = 0, mv = 0, total = 0
  chains.forEach((chain) => {
    for (let i = 1; i < chain.length; i++) {
      const l = Math.hypot(chain[i][0] - chain[i - 1][0], chain[i][1] - chain[i - 1][1])
      if (l <= 0) continue
      steps.push(l)
      mu += ((chain[i][0] + chain[i - 1][0]) / 2) * l
      mv += ((chain[i][1] + chain[i - 1][1]) / 2) * l
      total += l
    }
  })
  steps.sort((a, b) => a - b)
  const spacing = steps[steps.length >> 1] ?? 0
  const middle: Vec2 = total > 0 ? [mu / total, mv / total] : [0, 0]
  const awayFromMiddle = (c: number, i: number) => {
    const d = dirs[c][i]
    return d[0] * (chains[c][i][0] - middle[0]) + d[1] * (chains[c][i][1] - middle[1])
  }
  const live = (c: number, i: number) => dirs[c][i][0] !== 0 || dirs[c][i][1] !== 0
  const clean = (mask: boolean[][]) => mask.map((m, c) => cleanAlong(chains[c], m, closed[c], CLEAN_SPACINGS * spacing))
  const rays = rule.skin ? new RayCaster(chains, closed) : null

  let outer: boolean[][] | null = null
  if (rule.skin) {
    outer = clean(chains.map((_, c) => Array.from({ length: lens[c] }, (_, i) => live(c, i) && awayFromMiddle(c, i) > 0 && rays!.first(c, i, dirs[c][i]) === null)))
  }
  let side: boolean[][] = chains.map((_, c) => new Array<boolean>(lens[c]).fill(true))
  if (rule.skin === 'outer') side = outer!
  else if (rule.skin === 'inner') {
    // How far through the material each point facing the middle comes out
    // on the outer skin; NaN where it does not.
    const through = chains.map((_, c) =>
      Array.from({ length: lens[c] }, (_, i) => {
        if (!live(c, i) || awayFromMiddle(c, i) >= 0) return NaN
        const d = dirs[c][i]
        const hit = rays!.first(c, i, [-d[0], -d[1]])
        if (!hit) return NaN
        const ends = outer![hit.chain]
        return ends[hit.seg] || ends[(hit.seg + 1) % lens[hit.chain]] ? hit.t : NaN
      }),
    )
    // The wall's thickness, as most of those points have it: a rib's tip
    // looks through the rib and the wall onto the outer skin too, but from
    // much farther.
    const all = through.flat().filter((t) => !Number.isNaN(t)).sort((a, b) => a - b)
    const wall = all[all.length >> 1] ?? 0
    const reach = WALL_SHARE * wall + 2 * spacing
    side = through.map((m) => m.map((t) => t <= reach))
  }
  if (rule.facing) {
    const fl = Math.hypot(rule.facing.dir[0], rule.facing.dir[1])
    const cos = Math.cos((rule.facing.withinDeg * Math.PI) / 180)
    side = side.map((m, c) => m.map((k, i) => k && fl > 0 && live(c, i) && (dirs[c][i][0] * rule.facing!.dir[0] + dirs[c][i][1] * rule.facing!.dir[1]) / fl >= cos))
  }
  if (rule.skin === 'inner' || rule.facing) side = clean(side)
  // A loop's last point is its first again.
  return side.map((m, c) => (closed[c] ? [...m, m[0]] : m))
}

/** A verdict along a chain cleaned of stretches shorter than `least` mm:
 *  first the gaps between kept stretches filled, then the kept stretches
 *  left that short dropped. A gap at an open chain's end is left. */
function cleanAlong(chain: readonly Vec2[], mask: boolean[], closed: boolean, least: number): boolean[] {
  const n = mask.length
  if (n === 0 || !(least > 0)) return mask
  const out = mask.slice()
  const step = (i: number) => {
    const j = i + 1 < n ? i + 1 : 0
    return Math.hypot(chain[j][0] - chain[i][0], chain[j][1] - chain[i][1])
  }
  for (const value of [false, true]) {
    // Where to start walking: a loop from a change, so no stretch is split.
    let start = 0
    if (closed) {
      start = out.findIndex((x, i) => x !== out[(i - 1 + n) % n])
      if (start < 0) continue
    }
    let i = 0
    while (i < n) {
      const at = (start + i) % n
      if (out[at] !== value) {
        i++
        continue
      }
      // A stretch of `value` from here.
      let j = i
      let length = 0
      while (j < n && out[(start + j) % n] === value) {
        if (j + 1 < n) length += step((start + j) % n)
        j++
      }
      const bounded = closed || (i > 0 && j < n)
      // A gap is filled only between kept stretches; a kept stretch goes
      // wherever it lies.
      if (length < least && (value || bounded)) for (let k = i; k < j; k++) out[(start + k) % n] = !value
      i = j
    }
  }
  return out
}

/**
 * The runs of a chain where `keep` holds of its points, in order along it —
 * each a chain of its own, with at least `minPoints` points. A loop's run
 * that runs through its first point comes out as one; a loop kept whole
 * comes out whole, closed.
 */
export function runsWhere(chain: readonly Vec2[], keep: (i: number) => boolean, minPoints = 4): Vec2[][] {
  return runIndices(chain.length, isClosed(chain), keep, minPoints).map((run) => run.map((i) => chain[i]))
}

/** runsWhere by index: the runs of a chain of `count` points where `keep`
 *  holds, as the indices of their points. A closed chain's last point is
 *  its first again; a loop kept whole ends on it. */
export function runIndices(count: number, closed: boolean, keep: (i: number) => boolean, minPoints = 4): number[][] {
  const n = closed ? count - 1 : count
  const flags = Array.from({ length: n }, (_, i) => keep(i))
  if (closed && flags.every(Boolean)) return count >= minPoints ? [Array.from({ length: count }, (_, i) => i)] : []
  // A loop is walked from a point it leaves out, so its runs come whole.
  const start = closed ? flags.findIndex((x) => !x) : 0
  const runs: number[][] = []
  let run: number[] = []
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    if (flags[i]) run.push(i)
    else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) runs.push(run)
  return runs.filter((r) => r.length >= minPoints)
}

/** The runs of every chain on the side a rule asks for — what a section
 *  read for one skin is fitted on. */
export function sideRuns(sided: SidedChains, rule: SideRule, minPoints = 4): { chain: number; points: Vec2[] }[] {
  const mask = sideMask(sided.chains, sided.normals, rule)
  return sided.chains.flatMap((chain, c) => runsWhere(chain, (i) => mask[c][i], minPoints).map((points) => ({ chain: c, points })))
}

/** Rays cast across a cut's segments, nearest crossing first; the
 *  segments boxed in short runs so most are passed over at once. */
class RayCaster {
  private boxes: { chain: number; from: number; to: number; lo: Vec2; hi: Vec2 }[] = []

  constructor(
    private chains: readonly (readonly Vec2[])[],
    private closed: boolean[],
  ) {
    chains.forEach((chain, c) => {
      for (let from = 0; from + 1 < chain.length; from += CHUNK) {
        const to = Math.min(chain.length - 1, from + CHUNK)
        const lo: Vec2 = [Infinity, Infinity]
        const hi: Vec2 = [-Infinity, -Infinity]
        for (let i = from; i <= to; i++) {
          lo[0] = Math.min(lo[0], chain[i][0])
          lo[1] = Math.min(lo[1], chain[i][1])
          hi[0] = Math.max(hi[0], chain[i][0])
          hi[1] = Math.max(hi[1], chain[i][1])
        }
        this.boxes.push({ chain: c, from, to, lo, hi })
      }
    })
  }

  /** The nearest segment the ray from point i of chain c along d crosses,
   *  the segments near the point on its own chain aside; null when it
   *  leaves the cut. Segment s runs from point s to point s + 1. */
  first(c: number, i: number, d: Vec2): { chain: number; seg: number; t: number } | null {
    const o = this.chains[c][i]
    const n = this.closed[c] ? this.chains[c].length - 1 : this.chains[c].length
    const near = (s: number) => {
      if (!this.closed[c]) return s >= i - RAY_SKIP - 1 && s <= i + RAY_SKIP
      const k = (((s - i) % n) + n) % n
      return k <= RAY_SKIP || k >= n - RAY_SKIP - 1
    }
    let best: { chain: number; seg: number; t: number } | null = null
    for (const b of this.boxes) {
      if (!rayMeetsBox(o, d, b.lo, b.hi, best ? best.t : Infinity)) continue
      const chain = this.chains[b.chain]
      for (let s = b.from; s < b.to; s++) {
        if (b.chain === c && near(s)) continue
        const t = raySegment(o, d, chain[s], chain[s + 1])
        if (t !== null && (!best || t < best.t)) best = { chain: b.chain, seg: s, t }
      }
    }
    return best
  }
}

/** Whether the ray from o along d meets the box before `far`. */
function rayMeetsBox(o: Vec2, d: Vec2, lo: Vec2, hi: Vec2, far: number): boolean {
  let t0 = 0
  let t1 = far
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-15) {
      if (o[k] < lo[k] || o[k] > hi[k]) return false
      continue
    }
    let a = (lo[k] - o[k]) / d[k]
    let b = (hi[k] - o[k]) / d[k]
    if (a > b) [a, b] = [b, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
    if (t0 > t1) return false
  }
  return true
}

/** How far along the ray from o along d it crosses the segment a–b, or
 *  null where it does not (or only at its start). */
function raySegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const ex = b[0] - a[0], ey = b[1] - a[1]
  const den = d[0] * ey - d[1] * ex
  if (Math.abs(den) < 1e-15) return null
  const wx = a[0] - o[0], wy = a[1] - o[1]
  const t = (wx * ey - wy * ex) / den
  const s = (wx * d[1] - wy * d[0]) / den
  return t > 1e-9 && s >= 0 && s <= 1 ? t : null
}
