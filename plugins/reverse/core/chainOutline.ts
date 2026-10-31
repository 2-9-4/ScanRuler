// SPDX-License-Identifier: AGPL-3.0-only
// A slice's chains made ready for a sketch. A scan full of small holes cuts
// into chains that stop wherever the surface has a gap, and nothing joins
// them again: so the ends that stand closer than a gap the caller allows are
// joined across it, nearest first — two chains into one, a chain's own two
// ends into a loop. Chains are told apart by their size and by a point one
// closes round; and a chain is thinned to the few corners a polyline needs
// (Ramer–Douglas–Peucker, src/core/flat/simplify.ts), the sides that run
// nearly along the sheet's axes laid exactly along them where asked.

import { viewChain } from '../../../src/core/flat/grow'
import { simplifyRun } from '../../../src/core/flat/simplify'
import type { Vec2 } from '../../../src/core/flat/types'
import { runsWhere, sideMask, type SidedChains, type SideRule } from '../../../src/core/section/skin'
import type { Vec3 } from '../../../src/core/types'

/** Whether a chain comes back onto its own first point, as a section's
 *  loops do. */
export const chainClosed = (c: readonly Vec2[]): boolean => c.length > 2 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < 1e-9

/** A chain's length along its points, mm. */
export function chainLength(c: readonly Vec2[]): number {
  let l = 0
  for (let i = 1; i < c.length; i++) l += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1])
  return l
}

/** The area a closed chain encloses; zero for an open one. */
export function chainArea(c: readonly Vec2[]): number {
  if (!chainClosed(c)) return 0
  let a2 = 0
  for (let i = 1; i < c.length; i++) a2 += c[i - 1][0] * c[i][1] - c[i][0] * c[i - 1][1]
  return Math.abs(a2) / 2
}

/** Whether a point lies inside a closed chain (even–odd). */
function inside(p: Vec2, c: readonly Vec2[]): boolean {
  let odd = false
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1], b = c[i]
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) odd = !odd
  }
  return odd
}

/** How far a point lies from a segment. */
function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** How far a point lies from a chain. */
function toChain(p: Vec2, c: readonly Vec2[]): number {
  if (c.length === 1) return Math.hypot(p[0] - c[0][0], p[1] - c[0][1])
  let best = Infinity
  for (let i = 1; i < c.length; i++) best = Math.min(best, toSegment(p, c[i - 1], c[i]))
  return best
}

/** A chain after the gaps were bridged: its points, the chains it was made
 *  of (by their index before, ascending — one where nothing joined it), and
 *  the gaps bridged in it with the widest. */
export interface JoinedChain {
  chain: Vec2[]
  from: number[]
  gaps: number
  largest: number
}

/** The chains as they are, nothing joined. */
export const unjoined = (chains: readonly Vec2[][]): JoinedChain[] => chains.map((chain, i) => ({ chain, from: [i], gaps: 0, largest: 0 }))

/**
 * The open chains' ends joined wherever two stand within `gap` mm of each
 * other — the ends of two chains, or a chain's own two ends — nearest pairs
 * first, each end joined once. A bridge is filled with points at the
 * chains' spacing, so a fit sees a straight run across the hole; a chain
 * that comes round onto itself ends on its own first point, as a section's
 * loops do. The chains come back in the order of the lowest index each was
 * made of.
 */
export function joinChainEnds(chains: readonly Vec2[][], gap: number): JoinedChain[] {
  const n = chains.length
  const open = chains.map((c) => c.length >= 2 && !chainClosed(c))
  const end = (e: number): Vec2 => {
    const c = chains[e >> 1]
    return e & 1 ? c[c.length - 1] : c[0]
  }
  const pairs: { e: number; f: number; d: number }[] = []
  for (let i = 0; i < n; i++) {
    if (!open[i]) continue
    if (chains[i].length >= 3) {
      const d = Math.hypot(end(2 * i)[0] - end(2 * i + 1)[0], end(2 * i)[1] - end(2 * i + 1)[1])
      if (d <= gap) pairs.push({ e: 2 * i, f: 2 * i + 1, d })
    }
    for (let j = i + 1; j < n; j++) {
      if (!open[j]) continue
      for (const e of [2 * i, 2 * i + 1])
        for (const f of [2 * j, 2 * j + 1]) {
          const d = Math.hypot(end(e)[0] - end(f)[0], end(e)[1] - end(f)[1])
          if (d <= gap) pairs.push({ e, f, d })
        }
    }
  }
  if (pairs.length === 0) return unjoined(chains)
  pairs.sort((a, b) => a.d - b.d)
  const mate = new Int32Array(2 * n).fill(-1)
  const width = new Float64Array(2 * n)
  for (const p of pairs) {
    if (mate[p.e] >= 0 || mate[p.f] >= 0) continue
    mate[p.e] = p.f
    mate[p.f] = p.e
    width[p.e] = width[p.f] = p.d
  }
  // The points a bridge is filled with, a step apart: the chains' own.
  const spacings = chains.filter((c) => c.length >= 2).map((c) => viewChain(c).spacing).sort((a, b) => a - b)
  const step = Math.max(1e-3, spacings[spacings.length >> 1] ?? Infinity)
  const bridge = (out: Vec2[], a: Vec2, b: Vec2) => {
    const k = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)
    for (let t = 1; t < k; t++) out.push([a[0] + ((b[0] - a[0]) * t) / k, a[1] + ((b[1] - a[1]) * t) / k])
  }
  const done = new Uint8Array(n)
  const out: JoinedChain[] = []
  for (let i = 0; i < n; i++) {
    if (done[i]) continue
    if (!open[i] || (mate[2 * i] < 0 && mate[2 * i + 1] < 0)) {
      done[i] = 1
      out.push({ chain: chains[i] as Vec2[], from: [i], gaps: 0, largest: 0 })
      continue
    }
    // Back to where the run starts — its free end, or round a loop to
    // this chain again.
    let entry = 2 * i
    for (let guard = 0; guard <= n; guard++) {
      const m = mate[entry]
      if (m < 0 || (m ^ 1) === 2 * i) break
      entry = m ^ 1
    }
    const start = entry
    const pts: Vec2[] = []
    const from: number[] = []
    let gaps = 0, largest = 0
    for (;;) {
      const c = chains[entry >> 1]
      done[entry >> 1] = 1
      from.push(entry >> 1)
      const walk = entry & 1 ? [...c].reverse() : c
      if (pts.length > 0) bridge(pts, pts[pts.length - 1], walk[0])
      pts.push(...walk)
      const exit = entry ^ 1
      const m = mate[exit]
      if (m < 0) break
      gaps++
      largest = Math.max(largest, width[exit])
      if (m === start) {
        bridge(pts, pts[pts.length - 1], pts[0])
        pts.push([pts[0][0], pts[0][1]])
        break
      }
      entry = m
    }
    out.push({ chain: pts, from: from.sort((a, b) => a - b), gaps, largest })
  }
  return out.sort((a, b) => a.from[0] - b.from[0])
}

/** The gaps bridged over a set of joined chains, and the widest. */
export function bridgedOf(chains: readonly JoinedChain[]): { gaps: number; largest: number } {
  let gaps = 0, largest = 0
  for (const c of chains) {
    gaps += c.gaps
    largest = Math.max(largest, c.largest)
  }
  return { gaps, largest }
}

/** A chain's runs that lie in a box on the sheet — each long enough to fit,
 *  in order along the chain. */
export function runsWithin(chain: readonly Vec2[], box: { min: Vec2; max: Vec2 }): Vec2[][] {
  return runsKept(chain, { box })
}

/** A cut's points on the side a rule asks for (src/core/section/skin.ts),
 *  each point's verdict kept by the point itself: joining chains across
 *  gaps keeps the points it joins, so the verdict outlives it. The chains
 *  are a whole cut, laid flat with their outward directions. */
export function sideOf(sided: SidedChains, rule: SideRule): Map<Vec2, boolean> {
  const mask = sideMask(sided.chains, sided.normals, rule)
  const out = new Map<Vec2, boolean>()
  sided.chains.forEach((chain, c) => chain.forEach((p, i) => out.set(p, mask[c][i])))
  return out
}

/**
 * A chain's runs that lie in a box on the sheet, on a side (sideOf), where
 * a test of the point holds, or all of them — each long enough to fit (four points), in order along it; a
 * loop's run through its first point is one run, a loop kept whole stays
 * closed. A point a bridge across a gap added takes the verdict of the
 * points either side of the gap, kept where both are.
 */
export function runsKept(chain: readonly Vec2[], opts: { box?: { min: Vec2; max: Vec2 }; side?: Map<Vec2, boolean>; where?: (p: Vec2) => boolean }): Vec2[][] {
  const { box, side, where } = opts
  let onSide: boolean[] | null = null
  if (side) {
    const n = chain.length
    const known = chain.map((p) => side.get(p))
    // The nearest verdict before and after each point — round a loop, whose
    // last bridge closes it onto its first point.
    const loop = chainClosed(chain)
    const before: (boolean | undefined)[] = new Array(n)
    const after: (boolean | undefined)[] = new Array(n)
    let last = loop ? [...known].reverse().find((k) => k !== undefined) : undefined
    for (let i = 0; i < n; i++) before[i] = last = known[i] ?? last
    let next = loop ? known.find((k) => k !== undefined) : undefined
    for (let i = n - 1; i >= 0; i--) after[i] = next = known[i] ?? next
    onSide = known.map((k, i) => k ?? Boolean(before[i] && after[i]))
  }
  const inBox = (p: Vec2) => !box || (p[0] >= box.min[0] && p[0] <= box.max[0] && p[1] >= box.min[1] && p[1] <= box.max[1])
  return runsWhere(chain, (i) => inBox(chain[i]) && (!where || where(chain[i])) && (!onSide || onSide[i]))
}

/** A box a `within` takes: on the command's own sheet, [u, v] mm — or in
 *  the world, [x, y, z] mm, whatever sheet the command reads on. */
export type WithinBox = { min: Vec2; max: Vec2 } | { world: { min: Vec3; max: Vec3 } }

/** Where a sheet lies in the world: world = origin + u·basisU + v·basisV. */
export interface SheetFrame {
  origin: Vec3
  basisU: Vec3
  basisV: Vec3
}

/** How far a point of the cut may stand outside a world box and still be
 *  in it, mm: a box drawn flat on the plane the cut lies in. */
const WORLD_BOX_SLACK_MM = 1e-6

const lifted = (p: Vec2, f: SheetFrame): Vec3 => [0, 1, 2].map((k) => f.origin[k] + p[0] * f.basisU[k] + p[1] * f.basisV[k]) as Vec3

/** What runsKept takes for a within: a box on the sheet as it is; a world
 *  box as a test of each point, lifted into the world. */
export function withinOnSheet(w: WithinBox, frame: SheetFrame): { box?: { min: Vec2; max: Vec2 }; where?: (p: Vec2) => boolean } {
  if (!('world' in w)) return { box: w }
  const { min, max } = w.world
  return {
    where: (p) => {
      const q = lifted(p, frame)
      return q.every((c, k) => c >= Math.min(min[k], max[k]) - WORLD_BOX_SLACK_MM && c <= Math.max(min[k], max[k]) + WORLD_BOX_SLACK_MM)
    },
  }
}

/** The box chains span on their sheet — or, given its frame, in the
 *  world; null for no points. */
export function chainsSpan(chains: readonly (readonly Vec2[])[]): { min: Vec2; max: Vec2 } | null
export function chainsSpan(chains: readonly (readonly Vec2[])[], frame: SheetFrame): { min: Vec3; max: Vec3 } | null
export function chainsSpan(chains: readonly (readonly Vec2[])[], frame?: SheetFrame): { min: number[]; max: number[] } | null {
  const n = frame ? 3 : 2
  const min = new Array<number>(n).fill(Infinity)
  const max = new Array<number>(n).fill(-Infinity)
  for (const c of chains)
    for (const p of c) {
      const q = frame ? lifted(p, frame) : p
      for (let k = 0; k < n; k++) {
        min[k] = Math.min(min[k], q[k])
        max[k] = Math.max(max[k], q[k])
      }
    }
  return Number.isFinite(min[0]) ? { min, max } : null
}

/** What to say of a within that catches nothing of the chains: the box,
 *  and where the cut lies — on `sheet` (the command's own frame, named in
 *  words), and in the world for a world box. */
export function boxMissed(w: WithinBox, chains: readonly (readonly Vec2[])[], frame: SheetFrame | undefined, sheet: string): string {
  const r = (x: number) => Math.round(x * 1e4) / 1e4 + 0
  const span = chainsSpan(chains)
  const onSheet = span ? `u ${r(span.min[0])}…${r(span.max[0])}, v ${r(span.min[1])}…${r(span.max[1])}` : 'nothing'
  if ('world' in w) {
    const world = frame ? chainsSpan(chains, frame) : null
    const inWorld = world ? `x ${r(world.min[0])}…${r(world.max[0])}, y ${r(world.min[1])}…${r(world.max[1])}, z ${r(world.min[2])}…${r(world.max[2])}` : 'nothing'
    return `Nothing in the world box [${w.world.min.map(r).join(', ')}]…[${w.world.max.map(r).join(', ')}] (within.world); the cut spans ${inWorld} in the world — ${onSheet} on ${sheet}.`
  }
  // units-ok: a command's hint, in its input's millimetres
  return `Nothing in the box [${w.min.map(r).join(', ')}]…[${w.max.map(r).join(', ')}] — [u, v] on ${sheet}; the cut spans ${onSheet}. A box in world mm goes as within: { world: { min: [x, y, z], max: [x, y, z] } }.`
}

/** How near a point has to lie to a chain, in the chain's own scatters
 *  (viewChain), to name that chain rather than the loop round it. */
export const ON_CHAIN_SCATTERS = 3

/** Which chain a pick names: by index (the chain made of it), the largest
 *  (the closed one of the most area, else the longest), or by a point
 *  (chainAt). Its place in the list, or -1 for an index no chain was made
 *  of. */
export function pickChain(chains: readonly JoinedChain[], pick: number | 'largest' | { at: Vec2 }): number {
  if (typeof pick === 'number') return chains.findIndex((c) => c.from.includes(pick))
  if (chains.length === 0) return -1
  if (pick !== 'largest') return chainAt(chains, pick.at).index
  let best = -1
  let bestKey = -Infinity
  chains.forEach((c, i) => {
    const a = chainArea(c.chain)
    const key = a > 0 ? 1e12 + a : chainLength(c.chain)
    if (key > bestKey) {
      bestKey = key
      best = i
    }
  })
  return best
}

/** The chain a point names, and by which rule: the chain it lies on,
 *  within ON_CHAIN_SCATTERS of its scatter (the nearest such) — on; else
 *  the closed one round it (the smallest) — round; else the nearest —
 *  nearest. A point on an opening's rim is the opening, not the outline
 *  round it. With the chain's area (0 for an open one) and how many closed
 *  chains lie round the point (enclosing), whichever rule named it. Index
 *  -1 for no chains. */
export function chainAt(chains: readonly JoinedChain[], at: Vec2): { index: number; by: 'on' | 'round' | 'nearest'; area: number; enclosing: number } {
  const round = chains.flatMap((c, i) => (chainClosed(c.chain) && inside(at, c.chain) ? [i] : []))
  const out = (index: number, by: 'on' | 'round' | 'nearest') => ({ index, by, area: index >= 0 ? chainArea(chains[index].chain) : 0, enclosing: round.length })
  let best = -1
  let near = Infinity
  chains.forEach((c, i) => {
    const d = toChain(at, c.chain)
    if (d < near && d <= ON_CHAIN_SCATTERS * viewChain(c.chain).scatter) {
      near = d
      best = i
    }
  })
  if (best >= 0) return out(best, 'on')
  if (round.length > 0) return out(round.reduce((a, b) => (chainArea(chains[b].chain) < chainArea(chains[a].chain) ? b : a)), 'round')
  near = Infinity
  chains.forEach((c, i) => {
    const d = toChain(at, c.chain)
    if (d < near) {
      near = d
      best = i
    }
  })
  return out(best, 'nearest')
}

/** Which chains a filter keeps: none shorter than minLength, none longer
 *  than maxLength, none open where closedOnly, and of the rest the
 *  maxChains longest — returned as their places in the list, in order —
 *  with how many each rule left out. */
export function filterChains(
  chains: readonly Vec2[][],
  opts: { minLength?: number; maxLength?: number; closedOnly?: boolean; maxChains?: number },
): { kept: number[]; left: { short?: number; long?: number; open?: number; beyond?: number } } {
  const left: { short?: number; long?: number; open?: number; beyond?: number } = {}
  const lengths = chains.map(chainLength)
  let kept = chains.map((_, i) => i)
  const drop = (key: 'short' | 'long' | 'open', keep: (i: number) => boolean) => {
    const before = kept.length
    kept = kept.filter(keep)
    if (kept.length < before) left[key] = before - kept.length
  }
  if (opts.minLength !== undefined) drop('short', (i) => lengths[i] >= opts.minLength!)
  if (opts.maxLength !== undefined) drop('long', (i) => lengths[i] <= opts.maxLength!)
  if (opts.closedOnly) drop('open', (i) => chainClosed(chains[i]))
  if (opts.maxChains !== undefined && kept.length > opts.maxChains) {
    left.beyond = kept.length - opts.maxChains
    const longest = new Set([...kept].sort((a, b) => lengths[b] - lengths[a]).slice(0, opts.maxChains))
    kept = kept.filter((i) => longest.has(i))
  }
  return { kept, left }
}

/** A chain thinned to a polyline: its corners, whether it closes, the
 *  tolerance it was thinned at, how far the chain strays from it at most,
 *  and how many sides were laid along an axis. */
export interface Outline {
  points: Vec2[]
  closed: boolean
  tolerance: number
  maxDeviation: number
  snapped: number
  /** How many corners simplifyDeg took out. */
  merged: number
}

/** The chain's points kept at a tolerance, as places along the walk —
 *  a loop's last point (its first again) left out. */
function thinned(walk: readonly Vec2[], closed: boolean, tolerance: number): number[] {
  const flat = new Float64Array(walk.length * 2)
  walk.forEach((p, i) => {
    flat[i * 2] = p[0]
    flat[i * 2 + 1] = p[1]
  })
  const kept = simplifyRun(flat, 0, walk.length, tolerance)
  if (!closed) return kept
  kept.pop()
  // The walk's start is kept whatever it is; where it lies along a side,
  // the side is one piece without it.
  if (kept.length > 3) {
    const prev = kept[kept.length - 1], next = kept[1]
    let fits = true
    for (let i = prev; i < walk.length - 1 + next && fits; i++) fits = toSegment(walk[i % (walk.length - 1)], walk[prev], walk[next]) <= tolerance
    if (fits) kept.shift()
  }
  return kept
}

/**
 * A chain as the polyline that keeps within `tolerance` of every point —
 * the tolerance grown until it takes at most `maxPoints` corners — and,
 * with snapDeg, every side within that many degrees of the sheet's u or v
 * laid exactly along it, at the mean of the points it stands for: a run of
 * such sides is one side, and where a level side meets an upright one the
 * corner is square. With simplifyDeg, a corner the polyline turns at by
 * less than that is taken out, so two sides that nearly run on are one.
 */
export function outlineOf(chain: readonly Vec2[], opts: { tolerance: number; snapDeg?: number; maxPoints?: number; simplifyDeg?: number }): Outline {
  const closed = chainClosed(chain)
  let walk: Vec2[] = chain as Vec2[]
  if (closed) {
    // A loop starts where it most likely turns: the point farthest from
    // its middle.
    const body = chain.slice(0, -1)
    const mid = body.reduce<Vec2>((m, p) => [m[0] + p[0] / body.length, m[1] + p[1] / body.length], [0, 0])
    let far = 0
    body.forEach((p, i) => {
      if (Math.hypot(p[0] - mid[0], p[1] - mid[1]) > Math.hypot(body[far][0] - mid[0], body[far][1] - mid[1])) far = i
    })
    walk = [...body.slice(far), ...body.slice(0, far), body[far]]
  }
  let tolerance = opts.tolerance
  let at = thinned(walk, closed, tolerance)
  for (let k = 0; opts.maxPoints !== undefined && at.length > opts.maxPoints && k < 40; k++) at = thinned(walk, closed, (tolerance *= 1.5))
  const pts: Vec2[] = at.map((i) => [walk[i][0], walk[i][1]])
  const m = pts.length
  const sides = closed ? m : m - 1
  // The points a side stands for, from its corner to the next.
  const span = (k: number): [number, number] => [at[k], k + 1 < m ? at[k + 1] : walk.length - 1]
  let snapped = 0
  const gone = new Set<number>()
  if (opts.snapDeg && opts.snapDeg > 0 && sides >= 1) {
    const lean = (opts.snapDeg * Math.PI) / 180
    const axisOf = (k: number): 0 | 1 | -1 => {
      const a = pts[k], b = pts[(k + 1) % m]
      const ang = Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0]))
      return ang <= lean ? 1 : Math.PI / 2 - ang <= lean ? 0 : -1
    }
    // 1: a level side (v held), 0: an upright one (u held).
    const kinds = Array.from({ length: sides }, (_, k) => axisOf(k))
    // Runs of sides of one kind, a loop's taken round from a change.
    const first = closed ? Math.max(0, kinds.findIndex((x, k) => x !== kinds[(k - 1 + sides) % sides])) : 0
    const runs: { kind: 0 | 1; sides: number[] }[] = []
    for (let s = 0; s < sides; s++) {
      const k = (first + s) % sides
      const kind = kinds[k]
      if (kind < 0) continue
      const last = runs[runs.length - 1]
      const prevK = (k - 1 + sides) % sides
      if (last && last.kind === kind && last.sides[last.sides.length - 1] === prevK && s > 0) last.sides.push(k)
      else runs.push({ kind: kind as 0 | 1, sides: [k] })
    }
    for (const run of runs) {
      if (run.sides.length === sides) continue
      let sum = 0, count = 0
      for (const k of run.sides) {
        const [a, b] = span(k)
        for (let i = a; i <= b; i++) {
          sum += walk[i % walk.length][run.kind]
          count++
        }
      }
      const level = sum / count
      for (const k of run.sides) {
        pts[k][run.kind] = level
        pts[(k + 1) % m][run.kind] = level
      }
      for (let r = 1; r < run.sides.length; r++) gone.add(run.sides[r])
      snapped++
    }
  }
  // The corners left, with no two on one point.
  let keep = Array.from({ length: m }, (_, i) => i).filter((i) => !gone.has(i))
  keep = keep.filter((i, j) => {
    const next = keep[(j + 1) % keep.length]
    return !(next !== i && (closed || j + 1 < keep.length) && Math.hypot(pts[next][0] - pts[i][0], pts[next][1] - pts[i][1]) < 1e-6)
  })
  // The corners turned at by less than simplifyDeg go, the gentlest first,
  // its neighbours then read with the turn it leaves them: a long shallow
  // curve keeps the corners its turning adds up to, a crease between two
  // sides that nearly run on does not.
  let merged = 0
  if (opts.simplifyDeg && opts.simplifyDeg > 0) {
    const limit = (opts.simplifyDeg * Math.PI) / 180
    const turnAt = (j: number): number => {
      const n = keep.length
      if (!closed && (j === 0 || j === n - 1)) return Infinity
      const a = pts[keep[(j - 1 + n) % n]], b = pts[keep[j]], c = pts[keep[(j + 1) % n]]
      const d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))
    }
    while (keep.length > (closed ? 3 : 2)) {
      let best = -1
      let least = limit
      for (let j = 0; j < keep.length; j++) {
        const t = turnAt(j)
        if (t < least) {
          least = t
          best = j
        }
      }
      if (best < 0) break
      keep.splice(best, 1)
      merged++
    }
  }
  // How far the chain strays from the polyline, side by side.
  let maxDeviation = 0
  const loop = walk.length - 1
  for (let j = 0; j < (closed ? keep.length : keep.length - 1); j++) {
    const a = keep[j], b = keep[(j + 1) % keep.length]
    const to = b > a ? at[b] : at[b] + loop
    for (let i = at[a]; i <= to; i++) maxDeviation = Math.max(maxDeviation, toSegment(walk[closed ? i % loop : i], pts[a], pts[b]))
  }
  return { points: keep.map((i) => pts[i]), closed, tolerance, maxDeviation, snapped, merged }
}
