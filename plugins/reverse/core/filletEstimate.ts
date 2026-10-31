// SPDX-License-Identifier: AGPL-3.0-only
// The radius of a fillet, read off the scan: every reverse-engineering
// tool offers "estimate radius from the mesh" on a fillet, since the round
// on a real part is nobody's guess — it is a tool radius. The reading is
// taken across the edge at its middle: a section through the scan by the
// plane perpendicular to the edge, projected into that plane with the edge
// at the origin and the two faces as lines through it. The scan's points
// on the flats lie on those lines; the points of the round lie inside both
// half-spaces — below both faces — and a circle through them, tangent to
// both faces, is the fillet.

import type { Vec2 } from '../../../src/core/flat/types'
import type { Vec3 } from '../../../src/core/types'
import { cross, dot, normalize, sub } from '../../../src/core/vec'

/** Why a place read no round (or chamfer), filled in by the reading that
 *  gave none: "no scan", "sharp", "S-profile: 45 % on the arc" … */
export interface Miss {
  why?: string
}

/** Why a window too few points to read read none: with none near the
 *  corner, no scan there; with some, the corner of a coarse scan's
 *  polygon, as sharp as it can show. */
export const fewWhy = (points: readonly Vec2[], reach: number): string => (points.some((p) => Math.hypot(p[0], p[1]) <= 0.1 * reach) ? 'sharp' : 'no scan')

export interface FilletReading {
  radius: number
  /** How many section points the circle was fitted to. */
  points: number
  /** The RMS of those points about the circle, millimetres. */
  rms: number
  /** The radius's own uncertainty, mm: the points' scatter over how much
   *  they say about the radius — loose on a round with few points or a
   *  short arc of them. */
  sigma: number
}

/**
 * The section points that belong to the corner: from the point of all the
 * chains nearest the corner, the chain walked both ways while it stays
 * within `reach`. A section through a thin wall cuts both skins, and the
 * far skin lies inside both faces just as the round does — but it is
 * another part of the chain, joined round the end of the wall, and the
 * walk never gets there.
 */
export function cornerWindow(chains: readonly (readonly Vec2[])[], reach: number): Vec2[] {
  const b = nearestCorner(chains)
  if (!b) return []
  const chain = chains[b.c]
  const out: Vec2[] = [chain[b.i]]
  for (let i = b.i - 1; i >= 0 && Math.hypot(chain[i][0], chain[i][1]) <= reach; i--) out.push(chain[i])
  for (let i = b.i + 1; i < chain.length && Math.hypot(chain[i][0], chain[i][1]) <= reach; i++) out.push(chain[i])
  return out
}

/** The point of all the chains nearest the corner: its chain and index. */
function nearestCorner(chains: readonly (readonly Vec2[])[]): { c: number; i: number } | null {
  let best: { c: number; i: number; d: number } | null = null
  chains.forEach((chain, c) => {
    chain.forEach((p, i) => {
      const d = Math.hypot(p[0], p[1])
      if (!best || d < best.d) best = { c, i, d }
    })
  })
  return best
}

/** Where the chain about a corner runs off onto another face within the
 *  reach: the face it ran along (0 or 1, as the edge has them), how far
 *  from the corner along it, mm, and what it does past there, as a place's
 *  verdict says it — "step 0.8 mm on face 2" where it steps and runs on
 *  beside the same face, "another face 1.7 mm off" where it turns to run
 *  beside the other. */
export interface FaceEnd {
  face: 0 | 1
  at: number
  what: string
}

/** A corner's window walked along its faces, and the reach it is read to. */
export interface FaceWindow {
  points: Vec2[]
  reach: number
  /** Set where a face ends within the reach — the reach is then held to
   *  FACE_SHARE of its extent. */
  end: FaceEnd | null
}

/** How much of a face that ends within the reach a round is read over. */
const FACE_SHARE = 0.9
/** How many points running off both faces in a row end the walk. */
const OFF_RUN = 3
/** Within this angle of a face's direction a run beside it is parallel. */
const COS_PARALLEL = Math.cos((25 * Math.PI) / 180)

/** How far a point is from a face's trace: the half-line from the corner
 *  along `d`. */
const offRay = (p: Vec2, d: Vec2): number => {
  const t = Math.max(0, p[0] * d[0] + p[1] * d[1])
  return Math.hypot(p[0] - t * d[0], p[1] - t * d[1])
}

/**
 * The section points that belong to the corner when its faces are known:
 * as cornerWindow, the chain walked both ways from the point nearest the
 * corner, but each way only while it keeps to the round and the faces.
 * Once on a face, the walk ends where the chain runs off both faces'
 * traces by more than about three scatters — a key standing 1.7 mm above
 * a housing, walked down its side onto the housing: those points lie
 * nowhere near the profile of any round, and capped as they are they
 * outweigh the round's own. Where a face ends so within the reach, the
 * reach is held to FACE_SHARE of how far the face runs: a round larger
 * than the face is not one the scan can show. `n` are the faces' outward
 * normals, `d` the ways they run from the corner, unit length.
 */
export function faceWindow(chains: readonly (readonly Vec2[])[], reach: number, n: readonly [Vec2, Vec2], d: readonly [Vec2, Vec2]): FaceWindow {
  const b = nearestCorner(chains)
  if (!b) return { points: [], reach, end: null }
  // Off a face by more than a few scatters — and more than a tenth of the
  // reach, so a scanned face a tenth off the model's still counts as on it.
  const leave = Math.max(3 * scatterOnFlats(cornerWindow(chains, reach), n[0], n[1], reach), 0.1 * reach)
  const chain = chains[b.c]
  const walk = (step: 1 | -1): { points: Vec2[]; end: FaceEnd | null } => {
    const points: Vec2[] = []
    let on: 0 | 1 | null = null
    let at = 0
    let off = 0
    for (let j = b.i + step; j >= 0 && j < chain.length; j += step) {
      const p = chain[j]
      if (Math.hypot(p[0], p[1]) > reach) break
      const o: [number, number] = [offRay(p, d[0]), offRay(p, d[1])]
      const k = o[0] <= o[1] ? 0 : 1
      if (o[k] <= leave) {
        on = k
        at = p[0] * d[k][0] + p[1] * d[k][1]
        off = 0
      } else if (on !== null && ++off >= OFF_RUN) {
        const past: Vec2[] = []
        for (let q = j - (OFF_RUN - 1) * step; q >= 0 && q < chain.length && Math.hypot(chain[q][0], chain[q][1]) <= reach; q += step) past.push(chain[q])
        return { points: points.slice(0, points.length - (OFF_RUN - 1)), end: { face: on, at, what: pastFace(past, on, at, n, d) } }
      }
      points.push(p)
    }
    return { points, end: null }
  }
  const back = walk(-1)
  const ahead = walk(1)
  const ends = [back.end, ahead.end].filter((e): e is FaceEnd => e !== null)
  const end = ends.length === 0 ? null : ends.reduce((x, y) => (y.at < x.at ? y : x))
  const held = end ? Math.min(reach, FACE_SHARE * end.at) : reach
  const walked = [chain[b.i], ...back.points, ...ahead.points]
  return { points: walked.filter((p) => Math.hypot(p[0], p[1]) <= held), reach: held, end }
}

/** What the chain does past where it left face `k`, `at` along it: a run
 *  beside the same face is a step, one beside the other face another face,
 *  each by how far off that face it runs; else where the face ended. */
function pastFace(past: readonly Vec2[], k: 0 | 1, at: number, n: readonly [Vec2, Vec2], d: readonly [Vec2, Vec2]): string {
  const mm = (x: number) => Number(x.toPrecision(2))
  const first = past[0]
  const last = past[past.length - 1]
  const u: Vec2 = [last[0] - first[0], last[1] - first[1]]
  const L = Math.hypot(u[0], u[1])
  const beside = (j: 0 | 1) => L > 1e-6 && Math.abs(u[0] * d[j][0] + u[1] * d[j][1]) >= COS_PARALLEL * L
  const off = (j: 0 | 1) => {
    const o = past.map((p) => Math.abs(p[0] * n[j][0] + p[1] * n[j][1])).sort((x, y) => x - y)
    return o[o.length >> 1]
  }
  // units-ok: a read's why, kept on the reading the agent is given too
  if (beside(k)) return `step ${mm(off(k))} mm on face ${k + 1}`
  const other = (1 - k) as 0 | 1
  // units-ok: a read's why, kept on the reading the agent is given too
  if (beside(other)) return `another face ${mm(off(other))} mm off`
  // units-ok: a read's why, kept on the reading the agent is given too
  return `another face ${mm(at)} mm along face ${k + 1}`
}

/** How far from a face a point still counts as lying on it, for reading
 *  the scatter: a thin wall's far skin lies well past this. */
const ON_FACE_MM = 0.3

/** The scan's scatter about a flat, taken as three times the median
 *  distance of the points that lie on the faces — robust to the round's
 *  own points, which are the minority near a sharp-ish corner — with a
 *  floor for a scan cleaner than the arithmetic. Only points near a face
 *  are read: on a thin wall the section runs down the far skin too, and
 *  its distance from these faces is the wall, not noise. */
function scatterOnFlats(points: readonly Vec2[], n1: Vec2, n2: Vec2, reach: number): number {
  const off: number[] = []
  for (const p of points) {
    if (Math.hypot(p[0], p[1]) > reach) continue
    const d = Math.min(Math.abs(p[0] * n1[0] + p[1] * n1[1]), Math.abs(p[0] * n2[0] + p[1] * n2[1]))
    if (d <= ON_FACE_MM) off.push(d)
  }
  if (off.length < 4) return 0.05
  off.sort((a, b) => a - b)
  return Math.max(0.02, 3 * off[off.length >> 1])
}

/**
 * The fillet radius at a corner, from the section points about it.
 *
 * `points` are in the section plane with the sharp edge at the origin;
 * `n1` and `n2` are the two faces' outward normals in that plane, unit
 * length. `reach` is how far from the corner points are read — a few
 * times the largest radius expected. Returns null when the scan shows no
 * round there: a sharp corner, a chamfer, a gap.
 *
 * The profile of a filleted corner is a flat, an arc tangent to it, and
 * the other flat tangent to the arc: one unknown, the radius, since the
 * arc's centre lies on the faces' bisector a radius inside each. Every
 * section point near the corner is read against that whole profile — a
 * scan puts only a handful of points on a small round, and reading the
 * round's points alone would lose it in the noise — and the radius is the
 * one the points lie nearest, searched over the reach. A sharp corner is
 * the profile at no radius: a round has to explain the points markedly
 * better than that to be reported.
 */
export function estimateFilletRadius(points: readonly Vec2[], n1: Vec2, n2: Vec2, reach: number, miss?: Miss): FilletReading | null {
  const none = (why: string) => {
    if (miss) miss.why = why
    return null
  }
  const tau = scatterOnFlats(points, n1, n2, reach)
  const pu: number[] = []
  const pv: number[] = []
  for (const p of points) {
    if (Math.hypot(p[0], p[1]) <= reach) {
      pu.push(p[0])
      pv.push(p[1])
    }
  }
  const n = pu.length
  if (n < 8) return none(fewWhy(points, reach))
  const k = 1 + (n1[0] * n2[0] + n1[1] * n2[1])
  if (!(k > 1e-6)) return none('the faces nearly one')
  // The centre for a radius r is r · b; the tangent points r · (b + n);
  // the flats run from the tangent points away from the corner along e.
  const bu = -(n1[0] + n2[0]) / k
  const bv = -(n1[1] + n2[1]) / k
  const t1 = [bu + n1[0], bv + n1[1]]
  const t2 = [bu + n2[0], bv + n2[1]]
  const l1 = Math.hypot(t1[0], t1[1])
  const l2 = Math.hypot(t2[0], t2[1])
  if (!(l1 > 1e-9 && l2 > 1e-9)) return none('the faces nearly one')
  const e1 = [t1[0] / l1, t1[1] / l1]
  const e2 = [t2[0] / l2, t2[1] / l2]
  /** Distance of point i to the profile of radius r, and whether the arc
   *  is what it is nearest. */
  const distance = (i: number, r: number): { d: number; arc: boolean } => {
    const x = pu[i], y = pv[i]
    const cx = r * bu, cy = r * bv
    const p1x = r * t1[0], p1y = r * t1[1]
    const p2x = r * t2[0], p2y = r * t2[1]
    // Beyond both tangent points, on the corner's side: the arc.
    const s1 = (x - p1x) * e1[0] + (y - p1y) * e1[1]
    const s2 = (x - p2x) * e2[0] + (y - p2y) * e2[1]
    if (s1 <= 0 && s2 <= 0) return { d: Math.abs(Math.hypot(x - cx, y - cy) - r), arc: true }
    const ray = (px: number, py: number, ex: number, ey: number) => {
      const t = Math.max(0, (x - px) * ex + (y - py) * ey)
      return Math.hypot(x - (px + t * ex), y - (py + t * ey))
    }
    return { d: Math.min(ray(p1x, p1y, e1[0], e1[1]), ray(p2x, p2y, e2[0], e2[1])), arc: false }
  }
  // The cost of a radius: the points' squared distances to its profile,
  // each capped a few scatters out so a stray cannot steer the search.
  const cap = 5 * tau
  const cost = (r: number) => {
    let sum = 0
    for (let i = 0; i < n; i++) {
      const d = Math.min(distance(i, r).d, cap)
      sum += d * d
    }
    return sum
  }
  const rMin = Math.max(tau, 0.02)
  const rMax = reach
  let best = rMin
  let bestCost = Infinity
  const steps = 160
  for (let i = 0; i <= steps; i++) {
    const r = rMin * Math.pow(rMax / rMin, i / steps)
    const c = cost(r)
    if (c < bestCost) {
      bestCost = c
      best = r
    }
  }
  let lo = best / Math.pow(rMax / rMin, 1 / steps)
  let hi = best * Math.pow(rMax / rMin, 1 / steps)
  for (let it = 0; it < 50; it++) {
    const a = lo + (hi - lo) * 0.382
    const b = lo + (hi - lo) * 0.618
    if (cost(a) < cost(b)) hi = b
    else lo = a
  }
  const r = (lo + hi) / 2
  // A sharp corner: the same profile at no radius. The round has to do
  // markedly better than it, and rest on points of its own.
  const sharp = cost(rMin)
  if (!(r > 2 * tau) || cost(r) > 0.5 * sharp) return none('sharp')
  // The points the round rests on: those nearest the arc, within a few
  // scatters of it — and within the corner's own neighbourhood, since on a
  // thin wall the far skin's points are nearest the arc too and lie
  // nowhere near it.
  let onArc = 0
  let arcTotal = 0
  let sum = 0
  const near = 2 * r + 3 * tau
  for (let i = 0; i < n; i++) {
    if (Math.hypot(pu[i], pv[i]) > near) continue
    const { d, arc } = distance(i, r)
    if (!arc) continue
    arcTotal++
    if (d <= 3 * tau) {
      onArc++
      sum += d * d
    }
  }
  if (onArc < 3) return none('sharp')
  const rms = Math.sqrt(sum / onArc)
  // A chamfer's points lie on a line: an arc through their middle leaves
  // the ends standing off it; so does an S-profile's.
  if (onArc < 0.6 * arcTotal) return none(`S-profile: ${Math.round((100 * onArc) / arcTotal)} % on the arc`)
  // The radius's sigma, as a least-squares fit's: a point's distance off
  // the arc, |p − r·b| − r, moves with r by −b·u − 1 (u the unit vector
  // from the centre to it) — nothing at the tangent points, most in the
  // middle of the round, which is where the radius is read.
  let jj = 0
  for (let i = 0; i < n; i++) {
    if (Math.hypot(pu[i], pv[i]) > near) continue
    const { d, arc } = distance(i, r)
    if (!arc || d > 3 * tau) continue
    const ux = pu[i] - r * bu
    const uy = pv[i] - r * bv
    const l = Math.hypot(ux, uy)
    if (!(l > 1e-12)) continue
    const j = -(bu * ux + bv * uy) / l - 1
    jj += j * j
  }
  // The scatter is the larger of the fit's and the flats' own: a round
  // that happens to fit its few points closely is no better known than
  // the scan is.
  const scatter = Math.max(rms * Math.sqrt(onArc / Math.max(1, onArc - 1)), tau / 3)
  const sigma = jj > 1e-12 ? scatter / Math.sqrt(jj) : r
  return { radius: r, points: onArc, rms, sigma }
}

/**
 * The chamfer at a corner, from the section points about it — as
 * estimateFilletRadius, with a straight cut in place of the round: the
 * profile is a flat, a line from `s` along it to `s` along the other, and
 * the other flat; one unknown, the setback s, read as the distance along
 * each face (an even chamfer). Null where the scan shows none.
 */
export function estimateChamfer(points: readonly Vec2[], n1: Vec2, n2: Vec2, reach: number, miss?: Miss): FilletReading | null {
  const none = (why: string) => {
    if (miss) miss.why = why
    return null
  }
  const tau = scatterOnFlats(points, n1, n2, reach)
  const pts = points.filter((p) => Math.hypot(p[0], p[1]) <= reach)
  if (pts.length < 8) return none(fewWhy(pts, reach))
  // Along each face away from the corner: square to its normal, on the
  // side the other face's normal points away from.
  const along = (n: Vec2, other: Vec2): Vec2 => {
    const t: Vec2 = [-n[1], n[0]]
    return t[0] * other[0] + t[1] * other[1] > 0 ? [-t[0], -t[1]] : t
  }
  const e1 = along(n1, n2)
  const e2 = along(n2, n1)
  const seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax
    const dy = by - ay
    const ll = dx * dx + dy * dy
    const t = ll > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / ll)) : 0
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  }
  const ray = (px: number, py: number, ax: number, ay: number, e: Vec2) => {
    const t = Math.max(0, (px - ax) * e[0] + (py - ay) * e[1])
    return Math.hypot(px - (ax + t * e[0]), py - (ay + t * e[1]))
  }
  /** A point's distance to the profile of setback s, and whether the cut
   *  is what it is nearest. */
  const distance = (p: Vec2, s: number): { d: number; cut: boolean } => {
    const a: Vec2 = [s * e1[0], s * e1[1]]
    const b: Vec2 = [s * e2[0], s * e2[1]]
    const dc = seg(p[0], p[1], a[0], a[1], b[0], b[1])
    const df = Math.min(ray(p[0], p[1], a[0], a[1], e1), ray(p[0], p[1], b[0], b[1], e2))
    return dc <= df ? { d: dc, cut: true } : { d: df, cut: false }
  }
  const cap = 5 * tau
  const cost = (s: number) => pts.reduce((sum, p) => sum + Math.min(distance(p, s).d, cap) ** 2, 0)
  const sMin = Math.max(tau, 0.02)
  let best = sMin
  let bestCost = Infinity
  for (let i = 0; i <= 160; i++) {
    const s = sMin * Math.pow(reach / sMin, i / 160)
    const c = cost(s)
    if (c < bestCost) {
      bestCost = c
      best = s
    }
  }
  let lo = best / Math.pow(reach / sMin, 1 / 160)
  let hi = best * Math.pow(reach / sMin, 1 / 160)
  for (let it = 0; it < 50; it++) {
    const a = lo + (hi - lo) * 0.382
    const b = lo + (hi - lo) * 0.618
    if (cost(a) < cost(b)) hi = b
    else lo = a
  }
  const s = (lo + hi) / 2
  if (!(s > 2 * tau) || cost(s) > 0.5 * cost(sMin)) return none('sharp')
  let on = 0
  let sum = 0
  let jj = 0
  const h = Math.max(1e-4, s * 1e-3)
  for (const p of pts) {
    const { d, cut } = distance(p, s)
    if (!cut || d > 3 * tau) continue
    on++
    sum += d * d
    const j = (distance(p, s + h).d - distance(p, s - h).d) / (2 * h)
    jj += j * j
  }
  if (on < 3) return none('sharp')
  const rms = Math.sqrt(sum / on)
  const scatter = Math.max(rms * Math.sqrt(on / Math.max(1, on - 1)), tau / 3)
  return { radius: s, points: on, rms, sigma: jj > 1e-12 ? scatter / Math.sqrt(jj) : s }
}

/** A chamfer read with its two setbacks apart — a countersink, a 30°
 *  bevel — and the cut's own line: `s[i]` along face i from the corner,
 *  `dir` the cut's direction in the section, `dirSigma` its uncertainty in
 *  radians. */
export interface ChamferSetbacks {
  s: [number, number]
  sigma: [number, number]
  dir: Vec2
  dirSigma: number
  points: number
  rms: number
}

/**
 * The chamfer at a corner with its setbacks free: started from the even
 * reading (estimateChamfer), the points on the cut — nearer it than either
 * face, clear of its ends — fitted with a line, the setbacks where that
 * line meets the faces, and the points taken again against the new
 * profile, a few times over. The sigmas are the line fit's: its offset
 * where it meets each face over the sine of the angle it meets it at.
 */
export function estimateChamferSetbacks(points: readonly Vec2[], n1: Vec2, n2: Vec2, reach: number): ChamferSetbacks | null {
  const even = estimateChamfer(points, n1, n2, reach)
  if (!even) return null
  const tau = scatterOnFlats(points, n1, n2, reach)
  const along = (n: Vec2, other: Vec2): Vec2 => {
    const t: Vec2 = [-n[1], n[0]]
    return t[0] * other[0] + t[1] * other[1] > 0 ? [-t[0], -t[1]] : t
  }
  const e = [along(n1, n2), along(n2, n1)]
  const pts = points.filter((p) => Math.hypot(p[0], p[1]) <= reach)
  const rayDist = (p: Vec2, s: number, k: number) => {
    const t = Math.max(0, (p[0] - s * e[k][0]) * e[k][0] + (p[1] - s * e[k][1]) * e[k][1])
    return Math.hypot(p[0] - (s + t) * e[k][0], p[1] - (s + t) * e[k][1])
  }
  let s: [number, number] = [even.radius, even.radius]
  let fit: { g: Vec2; u: Vec2; on: Vec2[] } | null = null
  for (let it = 0; it < 4; it++) {
    const a: Vec2 = [s[0] * e[0][0], s[0] * e[0][1]]
    const b: Vec2 = [s[1] * e[1][0], s[1] * e[1][1]]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const ll = dx * dx + dy * dy
    if (!(ll > 1e-12)) return null
    const on: Vec2[] = []
    for (const p of pts) {
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll
      if (t < 0.08 || t > 0.92) continue
      const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(ll)
      if (d <= 3 * tau && d <= Math.min(rayDist(p, s[0], 0), rayDist(p, s[1], 1))) on.push(p)
    }
    if (on.length < 4) return null
    // The total-least-squares line: through the centroid, along the
    // scatter's long axis.
    const g: Vec2 = [on.reduce((x, p) => x + p[0], 0) / on.length, on.reduce((x, p) => x + p[1], 0) / on.length]
    let sxx = 0, sxy = 0, syy = 0
    for (const p of on) {
      sxx += (p[0] - g[0]) ** 2
      sxy += (p[0] - g[0]) * (p[1] - g[1])
      syy += (p[1] - g[1]) ** 2
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    const u: Vec2 = [Math.cos(th), Math.sin(th)]
    // Where the line meets face k: g + λu = μ e_k.
    const meet = (k: number) => {
      const c = e[k][0] * u[1] - e[k][1] * u[0]
      return Math.abs(c) > 1e-6 ? (g[0] * u[1] - g[1] * u[0]) / c : NaN
    }
    const next: [number, number] = [meet(0), meet(1)]
    if (!(next[0] > 0 && next[1] > 0 && next[0] < 1.5 * reach && next[1] < 1.5 * reach)) return null
    s = next
    fit = { g, u, on }
  }
  const { g, u, on } = fit!
  const lam = on.map((p) => (p[0] - g[0]) * u[0] + (p[1] - g[1]) * u[1])
  const spread = lam.reduce((x, l) => x + l * l, 0)
  const sum = on.reduce((x, p) => x + ((p[0] - g[0]) * u[1] - (p[1] - g[1]) * u[0]) ** 2, 0)
  const rms = Math.sqrt(sum / on.length)
  const scatter = Math.max(rms * Math.sqrt(on.length / Math.max(1, on.length - 2)), tau / 3)
  if (!(spread > 1e-12)) return null
  const sig = (k: number) => {
    const l = (s[k] * e[k][0] - g[0]) * u[0] + (s[k] * e[k][1] - g[1]) * u[1]
    const off = scatter * Math.sqrt(1 / on.length + (l * l) / spread)
    return off / Math.max(1e-6, Math.abs(e[k][0] * u[1] - e[k][1] * u[0]))
  }
  return { s, sigma: [sig(0), sig(1)], dir: u, dirSigma: scatter / Math.sqrt(spread), points: on.length, rms }
}

/** A straight edge between two flat faces, as a body's topology gives it:
 *  where it is, which way it runs, and the faces' outward normals. */
export interface CornerEdge {
  mid: Vec3
  dir: Vec3
  length: number
  faces: readonly { kind: string; dir: Vec3 }[]
}

/** A cut of the scan: the chains' points, flat xyz, chain c running from
 *  offsets[c] to offsets[c + 1]. */
export interface ScanCut {
  points: ArrayLike<number>
  offsets: ArrayLike<number>
}

/** Why an edge cannot be read for a round by readCornerCut, or null when
 *  it can: a straight edge between two flat faces. A curved one goes to
 *  curvedEdge.ts. */
export function cornerUnreadable(edge: { kind: string; faces: readonly { kind: string }[] }): string | null {
  if (edge.kind !== 'line') return `a ${edge.kind} edge — only a straight edge is read`
  if (edge.faces.length < 2) return 'an edge with one face — nothing to round between'
  if (edge.faces.some((f) => f.kind !== 'plane')) return `an edge between a ${edge.faces[0].kind} and a ${edge.faces[1].kind} — only an edge between two flat faces is read`
  return null
}

/** The section plane across an edge at `at` along it: its normal (the
 *  edge's direction), and the maps into the plane — points with the edge
 *  at the origin, X along the first face's outward normal flattened into
 *  it, and directions the same way, unit length. Null for an edge too
 *  short or faces too nearly one. */
export function cornerFrame(edge: CornerEdge, at: Vec3): { normal: Vec3; to2: (p: Vec3) => Vec2; dir2: (p: Vec3) => Vec2 } | null {
  const n = normalize(edge.dir)
  if (!n) return null
  const n1 = edge.faces[0].dir
  const u = normalize(sub(n1, [n[0] * dot(n1, n), n[1] * dot(n1, n), n[2] * dot(n1, n)]))
  if (!u) return null
  const v = cross(n, u)
  const to2 = (p: Vec3): Vec2 => [dot(sub(p, at), u), dot(sub(p, at), v)]
  const dir2 = (p: Vec3): Vec2 => {
    const q: Vec2 = [dot(p, u), dot(p, v)]
    const l = Math.hypot(q[0], q[1])
    return l > 1e-9 ? [q[0] / l, q[1] / l] : [1, 0]
  }
  return { normal: n, to2, dir2 }
}

/** The round at `at` along a straight edge between two flats, read off
 *  the scan's cut by the plane square to the edge there (`cut`, from the
 *  mesh worker's section through `at` with the edge's direction as
 *  normal): the panel's estimate and reverse.body.fillet_read both. */
export function readCornerCut(edge: CornerEdge, at: Vec3, cut: ScanCut, reach: number, shape: 'round' | 'chamfer' = 'round', miss?: Miss): FilletReading | null {
  const frame = cornerFrame(edge, at)
  if (!frame) {
    if (miss) miss.why = 'the faces nearly one'
    return null
  }
  const n1 = frame.dir2(edge.faces[0].dir)
  const n2 = frame.dir2(edge.faces[1].dir)
  const w = faceWindow(cutChains(cut, frame.to2), reach, [n1, n2], [faceRuns(n1, n2), faceRuns(n2, n1)])
  return readOnWindow(w, (pts, r, m) => (shape === 'chamfer' ? estimateChamfer(pts, n1, n2, r, m) : estimateFilletRadius(pts, n1, n2, r, m)), miss)
}

/** The way a flat face runs from a corner, in the section: square to its
 *  outward normal `n`, away from the side the other face's normal `other`
 *  points to — for a convex corner and a concave one alike, whose normals
 *  are then turned round. */
export function faceRuns(n: Vec2, other: Vec2): Vec2 {
  const k = 1 + n[0] * other[0] + n[1] * other[1]
  if (k > 1e-6) {
    // From the corner to the tangent point of a round of one: b + n, the
    // centre b on the bisector a radius inside each face.
    const t: Vec2 = [-(n[0] + other[0]) / k + n[0], -(n[1] + other[1]) / k + n[1]]
    const l = Math.hypot(t[0], t[1])
    if (l > 1e-9) return [t[0] / l, t[1] / l]
  }
  return [-n[1], n[0]]
}

/** A reading taken on a corner's face window: with the reach the window
 *  holds it to, and where a face ended within the reach and nothing read,
 *  the miss says so — "another face 1.7 mm off within the reach — reach ≤
 *  1.5". */
export function readOnWindow(w: FaceWindow, estimate: (points: readonly Vec2[], reach: number, miss: Miss) => FilletReading | null, miss?: Miss): FilletReading | null {
  const own: Miss = {}
  const reading = estimate(w.points, w.reach, own)
  if (!reading && miss) miss.why = w.end ? faceEndWhy(w) : own.why
  return reading
}

/** A face end as a miss says it: a step as it is ("step 0.8 mm on face
 *  2"), another face with the reach the read was held to ("another face
 *  1.7 mm off within the reach — reach ≤ 1.5"). */
export const faceEndWhy = (w: FaceWindow): string => {
  const end = w.end!
  // Rounded down: a tenth, or a hundredth under a millimetre.
  const held = w.reach >= 1 ? Math.floor(w.reach * 10) / 10 : Math.floor(w.reach * 100) / 100
  return end.what.startsWith('step') ? end.what : `${end.what} within the reach — reach ≤ ${held}`
}

/** A cut's chains mapped into a section plane. */
export function cutChains(cut: ScanCut, to2: (p: Vec3) => Vec2): Vec2[][] {
  const chains: Vec2[][] = []
  for (let c = 0; c + 1 < cut.offsets.length; c++) {
    const chain: Vec2[] = []
    for (let i = cut.offsets[c]; i < cut.offsets[c + 1]; i++) chain.push(to2([cut.points[i * 3], cut.points[i * 3 + 1], cut.points[i * 3 + 2]]))
    chains.push(chain)
  }
  return chains
}

/** The chamfer's two setbacks at `at` along a straight edge between two
 *  flats, off the cut readCornerCut reads: `s[i]` along the edge's face i. */
export function readCornerSetbacks(edge: CornerEdge, at: Vec3, cut: ScanCut, reach: number): ChamferSetbacks | null {
  const frame = cornerFrame(edge, at)
  if (!frame) return null
  const window = cornerWindow(cutChains(cut, frame.to2), reach)
  return estimateChamferSetbacks(window, frame.dir2(edge.faces[0].dir), frame.dir2(edge.faces[1].dir), reach)
}

/** Several readings along one edge taken together: the median radius,
 *  and a sigma that is the larger of the readings' own (combined) and
 *  their spread — a round that changes along the edge is not known to the
 *  fit's precision. */
export function combineReadings(readings: readonly FilletReading[]): FilletReading | null {
  if (readings.length === 0) return null
  const radii = readings.map((r) => r.radius).sort((a, b) => a - b)
  const mid = radii.length >> 1
  const radius = radii.length % 2 ? radii[mid] : (radii[mid - 1] + radii[mid]) / 2
  const points = readings.reduce((a, r) => a + r.points, 0)
  const rms = Math.sqrt(readings.reduce((a, r) => a + r.rms * r.rms * r.points, 0) / Math.max(1, points))
  const fitSigma = 1 / Math.sqrt(readings.reduce((a, r) => a + 1 / Math.max(r.sigma, 1e-9) ** 2, 0))
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length
  const spread = radii.length > 1 ? Math.sqrt(radii.reduce((a, b) => a + (b - mean) ** 2, 0) / (radii.length - 1) / radii.length) : 0
  return { radius, points, rms, sigma: Math.max(fitSigma, spread) }
}
