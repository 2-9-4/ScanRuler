// SPDX-License-Identifier: AGPL-3.0-only
// What a taper asks of the profile it leans. An extrude with a taper leans
// every side of its profile in, or out, as it goes, so the section at any
// length is the profile's outline with every edge moved by that length times
// the taper's tangent. The kernel's drafted prism keeps the profile's edges
// and leans each one, whatever happens to the outline: past the length where
// an edge of the moved outline shrinks to nothing, or runs into another, the
// solid it hands back crosses itself — a cone run past its tip comes back as
// an hourglass, and the kernel calls it valid. So the outline is moved here
// first, in the profile's own plane: the loops of the face's edges, each
// edge sampled as a run of short segments, each segment moved along its
// normal, the corners where the moved segments meet again.
//
// What is checked is the edges, not the segments. Where a round meets a side
// at an angle, the leaned side runs over the round's first few segments and
// the round is trimmed back to where the two meet again — as the kernel's
// leaned faces are — so a segment that gives way at an edge's end is taken
// out and its neighbours meet past it. A length is refused only where a whole
// edge has gone (a round past its radius, a side the others close over),
// where an edge folds over in its middle (a bend in it tighter than the
// lean), or where two edges that are not neighbours run into each other.

import type { Vec2 } from '../../../src/core/flat/types'
import { cross2, dot2, normalize2, perp2, sub2 } from '../../../src/core/flat/vec2'
import type { Vec3 } from '../../../src/core/types'
import { signedArea2 } from '../../../src/core/flat/vec2'

/** A closed loop of corner points; the last joins the first. Taken as a
 *  loop whose every segment is an edge of its own. */
export type Loop2 = Vec2[]

/** A closed loop as the face's edges run it: the corner points, the last
 *  joining the first, and for each segment — from point i to the next —
 *  the edge it lies on, by a number the face's loops share. */
export interface EdgeLoop {
  points: Vec2[]
  edges: number[]
}

/** What an edge of the face is read from: its sampled points, XYZ
 *  interleaved, and its two ends — the kernel's edges as `ReKernel.edges`
 *  lists them. */
export interface OutlineEdge {
  polyline: ArrayLike<number>
  ends: [Vec3, Vec3]
}

/**
 * The loops bounding a flat face, off its edges: each edge's points in the
 * face's plane through `origin` with the in-plane axes `u` and `v`, and the
 * edges chained end to end into loops. Each loop is run with the face on
 * its left — the outer one counter-clockwise seen down `u × v`, a hole
 * clockwise. An edge whose end no other edge goes on from is an error: a
 * gap closed with a chord would check an outline the face does not have.
 */
export function faceOutline(edges: readonly OutlineEdge[], origin: Vec3, u: Vec3, v: Vec3): EdgeLoop[] {
  const flat = (p: Vec3): Vec2 => {
    const d: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]
    return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]]
  }
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
  // Each edge as its run of points, first to last, its ends the kernel's own.
  const runs: { id: number; points: Vec2[] }[] = []
  edges.forEach((e, id) => {
    const p = e.polyline
    if (p.length < 6) return
    const points: Vec2[] = []
    for (let i = 0; i + 2 < p.length; i += 3) points.push(flat([p[i], p[i + 1], p[i + 2]]))
    const a = flat(e.ends[0])
    const b = flat(e.ends[1])
    if (dist(points[0], b) + dist(points[points.length - 1], a) < dist(points[0], a) + dist(points[points.length - 1], b)) points.reverse()
    points[0] = a
    points[points.length - 1] = b
    runs.push({ id, points })
  })
  const all = runs.flatMap((r) => r.points)
  const span = spanOf([all])
  const tol = Math.max(1e-3, span * 1e-5)
  const loops: EdgeLoop[] = []
  const used = new Set<number>()
  const where = (p: Vec2) => {
    const at: Vec3 = [origin[0] + u[0] * p[0] + v[0] * p[1], origin[1] + u[1] * p[0] + v[1] * p[1], origin[2] + u[2] * p[0] + v[2] * p[1]]
    return `(${at.map((x) => x.toFixed(2)).join(', ')})`
  }
  for (let r = 0; r < runs.length; r++) {
    if (used.has(r)) continue
    used.add(r)
    const loop: EdgeLoop = { points: [], edges: [] }
    const take = (points: readonly Vec2[], id: number) => {
      for (let i = 0; i + 1 < points.length; i++) {
        loop.points.push(points[i])
        loop.edges.push(id)
      }
    }
    take(runs[r].points, runs[r].id)
    const start = runs[r].points[0]
    let end = runs[r].points[runs[r].points.length - 1]
    while (dist(end, start) > tol || loop.points.length < 2) {
      // The edge that goes on from here: the one with an end nearest.
      let best = -1
      let flip = false
      let gap = Infinity
      for (let s = 0; s < runs.length; s++) {
        if (used.has(s)) continue
        const p = runs[s].points
        const d0 = dist(p[0], end)
        const d1 = dist(p[p.length - 1], end)
        if (d0 < gap) [best, flip, gap] = [s, false, d0]
        if (d1 < gap) [best, flip, gap] = [s, true, d1]
      }
      if (best < 0 || gap > tol) throw new Error(`The profile's outline is broken at ${where(end)}: no edge of the face goes on from there, so the taper cannot be checked against it.`)
      used.add(best)
      const points = flip ? [...runs[best].points].reverse() : runs[best].points
      take(points, runs[best].id)
      end = points[points.length - 1]
    }
    if (loop.points.length >= 3) loops.push(loop)
  }
  if (loops.length === 0) return loops
  // The outer loop is the one of most area; it runs counter-clockwise, the
  // holes inside it clockwise.
  const areas = loops.map((l) => signedArea2(l.points))
  let outer = 0
  for (let i = 1; i < loops.length; i++) if (Math.abs(areas[i]) > Math.abs(areas[outer])) outer = i
  return loops.map((l, i) => ((i === outer) === areas[i] < 0 ? reversed(l) : l))
}

/** The loop run the other way round, each segment still on its edge. */
function reversed(loop: EdgeLoop): EdgeLoop {
  const n = loop.points.length
  // Segment j of the reversed loop runs from point n−1−j to point n−2−j:
  // the segment n−2−j the other way.
  return { points: [...loop.points].reverse(), edges: loop.points.map((_, j) => loop.edges[(2 * n - 2 - j) % n]) }
}

/** How far across the loops reach — what the tolerances are taken from. */
function spanOf(loops: readonly Vec2[][]): number {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const l of loops) {
    for (const [x, y] of l) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return Number.isFinite(x0) ? Math.hypot(x1 - x0, y1 - y0) : 0
}

/** A loop without the segments too short to have a direction: the corner
 *  that repeats the one before is dropped, with the segment ending there. */
function tidy(loop: EdgeLoop, tol: number): EdgeLoop {
  const points: Vec2[] = []
  const edges: number[] = []
  loop.points.forEach((p, i) => {
    const last = points[points.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > tol) {
      points.push(p)
      edges.push(loop.edges[i])
    } else edges[edges.length - 1] = loop.edges[i]
  })
  while (points.length > 1 && Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) <= tol) {
    points.pop()
    edges.pop()
  }
  return { points, edges }
}

/** Where an outline breaks as it is moved: an edge gone or folded over,
 *  or two edges run into each other — by the edges' numbers. */
export type InsetBreak = { why: 'vanishes' | 'folds'; edges: [number] } | { why: 'crosses'; edges: [number, number] }

/** A corner of the moved loop: where it lies unmoved, and the way it goes
 *  per millimetre the loop is moved. */
interface Corner {
  at: Vec2
  mitre: Vec2
}

/**
 * The loop with each segment moved `inset` to its left — into the face —
 * and each corner where two segments meet again, with the segment at an
 * edge's end that gave way on the way taken out and its neighbours made to
 * meet past it, in the order they gave way. The moved corners and each
 * segment's edge, the segment from corner i on; or what broke.
 */
function insetLoop(loop: EdgeLoop, inset: number, tol: number): { points: Vec2[]; edges: number[] } | InsetBreak {
  const { points, edges } = loop
  const n = points.length
  const dir: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const d = normalize2(sub2(points[(i + 1) % n], points[i]))
    if (!d) return { why: 'folds', edges: [edges[i]] }
    dir.push(d)
  }
  const prev = points.map((_, i) => (i + n - 1) % n)
  const next = points.map((_, i) => (i + 1) % n)
  const left = new Map<number, number>()
  for (const e of edges) left.set(e, (left.get(e) ?? 0) + 1)
  // Two segments' moved lines meet off where they meet unmoved, along
  // their normals' sum: the mitre, as the leaned faces of a prism meet.
  // Lines that run back on each other never meet again.
  const mitreOf = (a: number, b: number): Vec2 | null => {
    const na = perp2(dir[a])
    const nb = perp2(dir[b])
    const denom = 1 + dot2(na, nb)
    if (denom < 1e-9) return null
    return [(na[0] + nb[0]) / denom, (na[1] + nb[1]) / denom]
  }
  // The corner of each segment's start: the corner it shares with the one
  // before.
  const start: Corner[] = []
  for (let i = 0; i < n; i++) {
    const mitre = mitreOf(prev[i], i)
    if (!mitre) return { why: 'folds', edges: [edges[i]] }
    start.push({ at: points[i], mitre })
  }
  // A segment's length along itself, moved all the way, and the share of
  // the way at which it gave way — none while it keeps its direction.
  const lengthOf = (i: number): { now: number; gone: number } => {
    const a = start[i]
    const b = start[next[i]]
    const was = dot2(sub2(b.at, a.at), dir[i])
    const now = was + inset * dot2(sub2(b.mitre, a.mitre), dir[i])
    return { now, gone: now > tol ? Infinity : was > 0 ? was / (was - now) : 0 }
  }
  const alive = new Set(points.map((_, i) => i))
  for (;;) {
    let first = -1
    let when = Infinity
    for (const i of alive) {
      const { gone } = lengthOf(i)
      if (gone < when) [first, when] = [i, gone]
    }
    if (first < 0) break
    const e = edges[first]
    const a = prev[first]
    const b = next[first]
    // A segment with its own edge on both sides gave way in the edge's
    // middle: the edge folds over itself there — or, all of it turned over
    // at once, it is gone, as a round past its radius.
    if (edges[a] === e && edges[b] === e) return { why: [...alive].every((i) => edges[i] !== e || lengthOf(i).now <= tol) ? 'vanishes' : 'folds', edges: [e] }
    const count = left.get(e)! - 1
    left.set(e, count)
    if (count === 0 || alive.size <= 3) return { why: 'vanishes', edges: [e] }
    alive.delete(first)
    next[a] = b
    prev[b] = a
    // The neighbours meet where their lines do, unmoved; lines that run
    // side by side meet nowhere, unless they are one line.
    const mitre = mitreOf(a, b)
    const c = cross2(dir[a], dir[b])
    const pa = points[a]
    const pb = start[b].at
    let at: Vec2
    if (Math.abs(c) > 1e-12) {
      const s = cross2(sub2(pb, pa), dir[b]) / c
      at = [pa[0] + dir[a][0] * s, pa[1] + dir[a][1] * s]
    } else if (Math.abs(cross2(dir[a], sub2(pb, pa))) <= tol) at = pb
    else return { why: 'folds', edges: [e] }
    if (!mitre) return { why: 'folds', edges: [e] }
    start[b] = { at, mitre }
  }
  const order: number[] = []
  const first = alive.values().next().value!
  for (let i = first; ; ) {
    order.push(i)
    i = next[i]
    if (i === first) break
  }
  return {
    points: order.map((i) => [start[i].at[0] + start[i].mitre[0] * inset, start[i].at[1] + start[i].mitre[1] * inset] as Vec2),
    edges: order.map((i) => edges[i]),
  }
}

interface Segment {
  a: Vec2
  b: Vec2
  loop: number
  index: number
  count: number
  edge: number
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Whether two segments meet — cross, touch or run over one another —
 *  within `tol` millimetres. */
function segmentsMeet(s: Segment, t: Segment, tol: number): boolean {
  const side = (a: Vec2, b: Vec2, p: Vec2): number => {
    const d = sub2(b, a)
    const l = Math.hypot(d[0], d[1])
    return l > 0 ? cross2(d, sub2(p, a)) / l : Math.hypot(p[0] - a[0], p[1] - a[1])
  }
  const within = (a: Vec2, b: Vec2, p: Vec2): boolean => {
    const d = sub2(b, a)
    const l2 = dot2(d, d)
    if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]) <= tol
    const t = dot2(sub2(p, a), d) / l2
    const l = Math.sqrt(l2)
    return t >= -tol / l && t <= 1 + tol / l
  }
  const o1 = side(s.a, s.b, t.a)
  const o2 = side(s.a, s.b, t.b)
  const o3 = side(t.a, t.b, s.a)
  const o4 = side(t.a, t.b, s.b)
  if (((o1 > tol && o2 < -tol) || (o1 < -tol && o2 > tol)) && ((o3 > tol && o4 < -tol) || (o3 < -tol && o4 > tol))) return true
  return (Math.abs(o1) <= tol && within(s.a, s.b, t.a)) || (Math.abs(o2) <= tol && within(s.a, s.b, t.b)) || (Math.abs(o3) <= tol && within(t.a, t.b, s.a)) || (Math.abs(o4) <= tol && within(t.a, t.b, s.b))
}

/** The edges of two segments of the loops that meet though they are not
 *  neighbours; null where none do. Of the pairs that meet, the two most
 *  nearly parallel are named — two sides closing on each other, rather
 *  than one running into the other's end. */
function anyMeet(loops: readonly { points: Vec2[]; edges: number[] }[], tol: number): [number, number] | null {
  const segs: Segment[] = []
  loops.forEach(({ points: l, edges }, li) => {
    for (let i = 0; i < l.length; i++) {
      const a = l[i]
      const b = l[(i + 1) % l.length]
      segs.push({ a, b, loop: li, index: i, count: l.length, edge: edges[i], x0: Math.min(a[0], b[0]) - tol, x1: Math.max(a[0], b[0]) + tol, y0: Math.min(a[1], b[1]) - tol, y1: Math.max(a[1], b[1]) + tol })
    }
  })
  segs.sort((p, q) => p.x0 - q.x0)
  let met: [number, number] | null = null
  let across = Infinity
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    for (let j = i + 1; j < segs.length && segs[j].x0 <= s.x1; j++) {
      const t = segs[j]
      if (t.y0 > s.y1 || t.y1 < s.y0) continue
      if (s.loop === t.loop) {
        const gap = Math.abs(s.index - t.index)
        if (gap === 1 || gap === s.count - 1) continue
      }
      if (!segmentsMeet(s, t, tol)) continue
      const ds = normalize2(sub2(s.b, s.a))
      const dt = normalize2(sub2(t.b, t.a))
      const sin = ds && dt ? Math.abs(cross2(ds, dt)) : 1
      if (sin < across) [met, across] = [[s.edge, t.edge], sin]
    }
  }
  return met
}

/** Plain loops as loops of edges, each segment an edge of its own. */
function asEdgeLoops(loops: readonly (Loop2 | EdgeLoop)[]): EdgeLoop[] {
  let next = 0
  return loops.map((l) => (Array.isArray(l) ? { points: l, edges: l.map(() => next++) } : l))
}

/**
 * Where the outline breaks with every edge moved `inset` millimetres into
 * the face — out of it for a negative inset: an edge gone or folded over,
 * or two edges that are not neighbours run into each other; null where it
 * keeps its shape. Loops as faceOutline gives them, the face on the left;
 * a plain loop of points is one whose every segment is an edge.
 */
export function insetBreak(loops: readonly (Loop2 | EdgeLoop)[], inset: number): InsetBreak | null {
  const edgeLoops = asEdgeLoops(loops)
  const span = spanOf(edgeLoops.map((l) => l.points))
  if (!(span > 0)) return { why: 'vanishes', edges: [edgeLoops[0]?.edges[0] ?? 0] }
  const tol = span * 1e-9
  const clean = edgeLoops.map((l) => tidy(l, tol)).filter((l) => l.points.length >= 3)
  if (clean.length === 0) return { why: 'vanishes', edges: [edgeLoops[0].edges[0]] }
  const moved: { points: Vec2[]; edges: number[] }[] = []
  for (const l of clean) {
    const m = insetLoop(l, inset, tol)
    if ('why' in m) return m
    moved.push(m)
  }
  const met = anyMeet(moved, tol)
  return met ? { why: 'crosses', edges: met } : null
}

/** Whether the outline keeps its shape moved `inset` — see insetBreak. */
export function insetHolds(loops: readonly (Loop2 | EdgeLoop)[], inset: number): boolean {
  return insetBreak(loops, inset) === null
}

/** How far a taper runs, and where the outline broke when it is short of
 *  the length asked: the break, and the middle of each edge it names. */
export interface TaperReach {
  reach: number
  broke?: InsetBreak & { at: Vec2[] }
}

/**
 * How far a taper can run before the outline it moves breaks: `length`
 * when it holds all the way, else the length where it last holds, to a
 * ten-thousandth of `length`, and what broke just past it. `leanIn` is the
 * tangent of the taper, positive where the sides lean in. An outline that
 * does not hold even unmoved is one the kernel made oddly, not one the
 * taper broke — it is let through.
 */
export function taperLimit(loops: readonly (Loop2 | EdgeLoop)[], leanIn: number, length: number): TaperReach {
  const edgeLoops = asEdgeLoops(loops)
  if (!(Math.abs(leanIn) > 0) || insetHolds(edgeLoops, length * leanIn) || !insetHolds(edgeLoops, 0)) return { reach: length }
  let lo = 0
  let hi = length
  while (hi - lo > length * 1e-4) {
    const m = (lo + hi) / 2
    if (insetHolds(edgeLoops, m * leanIn)) lo = m
    else hi = m
  }
  const broke = insetBreak(edgeLoops, hi * leanIn)
  return broke ? { reach: lo, broke: { ...broke, at: broke.edges.map((e) => middleOf(edgeLoops, e)) } } : { reach: lo }
}

/** How far a taper can run before the outline breaks — see taperLimit. */
export function taperReach(loops: readonly (Loop2 | EdgeLoop)[], leanIn: number, length: number): number {
  return taperLimit(loops, leanIn, length).reach
}

/** The middle of an edge of the loops, unmoved: its middle segment's. */
function middleOf(loops: readonly EdgeLoop[], edge: number): Vec2 {
  for (const l of loops) {
    const on = l.edges.flatMap((e, i) => (e === edge ? [i] : []))
    if (on.length === 0) continue
    const i = on[Math.floor(on.length / 2)]
    const a = l.points[i]
    const b = l.points[(i + 1) % l.points.length]
    // An edge of an odd count of segments has its middle in one; of an
    // even count, where two meet.
    return on.length % 2 === 1 ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a
  }
  return [0, 0]
}
