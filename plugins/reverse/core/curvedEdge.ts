// SPDX-License-Identifier: AGPL-3.0-only
// Rounds and chamfers read across curved edges — a circle or an arc between
// a flat face and a cylinder, a cone or a sphere (a boss's foot, a hole's
// mouth, a plate outline's corner, a bowl's rim), and a straight edge
// between a flat face and a cylinder — as filletEstimate reads a straight
// edge between two flats: the scan cut by the plane square to the edge at a
// few places along it, the round fitted in each cut between the faces'
// traces. Cut square to a circle, the plane holds the axis: a cylinder's
// trace is a line along it, a cone's a line at its angle, a sphere's a
// circle about a centre on it. Cut square to a straight edge, a cylinder's
// trace is a circle.
//
// The model gives each trace. Which way along it the face runs is read off
// the scan — the face's points lie on one side of the corner only — and the
// flat face's outward normal, which the model gives with its sign, then says
// whether the corner is convex (a round takes material off) or concave (a
// fillet adds it, at a boss's foot). A concave corner is read as the convex
// one its normals turned round make: the same two faces, the same round.
//
// An edge of any other shape — a blade's foot on a dish — is read off the
// body's mesh instead of its faces' surfaces; see readFreeCut below.

import type { Vec2 } from '../../../src/core/flat/types'
import type { Vec3 } from '../../../src/core/types'
import { addScaled, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import { type ChamferSetbacks, cornerWindow, cutChains, estimateChamfer, estimateChamferSetbacks, estimateFilletRadius, faceEndWhy, faceWindow, fewWhy, type FilletReading, type Miss, type ScanCut } from './filletEstimate'

/** A face of the edge as the reading takes it: kind and direction (the
 *  edge's fingerprint has them), radius and centre where the body's
 *  topology gives them. */
export interface EdgeSurface {
  kind: string
  dir: Vec3
  radius?: number
  center?: Vec3
}

export interface CurvedEdge {
  fingerprint: { kind: string; mid: Vec3; dir: Vec3; length: number; radius?: number; faces: readonly { kind: string; dir: Vec3 }[] }
  ends?: readonly [Vec3, Vec3]
  /** The faces' surfaces in the fingerprint's order, from the topology. */
  surfaces?: readonly (EdgeSurface | undefined)[]
}

/** Where a cut is taken: the corner, the plane's normal, and the plane's
 *  axes — for a circle, x out from the axis and y along it. */
export interface Station {
  at: Vec3
  normal: Vec3
  x: Vec3
  y: Vec3
  /** Where along the edge, 0 at its first end and 1 at its other — on a
   *  closed edge, from its seam one way round. */
  t?: number
}

/** A face's trace in a cut: a line through the corner with normal m, or a
 *  circle about q of radius r; d the way the face runs from the corner. m is
 *  the normal at the corner with the sign the reading gives it: the round's
 *  centre lies where every trace's signed distance is −r. */
export interface Trace2 {
  kind: 'line' | 'circle'
  m: Vec2
  d: Vec2
  q?: Vec2
  r?: number
}

/** A station's reading: the round (or even chamfer), and for a chamfer the
 *  setbacks apart and, on a hole's mouth, the countersink's cone. */
export interface CurvedRead {
  reading: FilletReading
  setbacks?: ChamferSetbacks
  countersink?: { angleDeg: number; angleSigma: number; diameter: number; diameterSigma: number; depth: number; depthSigma: number }
}

/** How far a round face's axis may lean off the edge's and still be it. */
const COS_AXIS = Math.cos((3 * Math.PI) / 180)
/** Faces meeting within this many degrees of tangent have no corner. */
const SIN_TANGENT = Math.sin((10 * Math.PI) / 180)

const surfaceOf = (edge: CurvedEdge, i: number): EdgeSurface => edge.surfaces?.[i] ?? edge.fingerprint.faces[i]

/** Whether the curved reader is the one for an edge: a circle, or a
 *  straight edge with a round face on a side. */
export function isCurvedEdge(fp: CurvedEdge['fingerprint']): boolean {
  return fp.kind === 'circle' || (fp.kind === 'line' && fp.faces.length >= 2 && fp.faces.some((f) => f.kind !== 'plane'))
}

/** Why a curved edge cannot be read, or null when it can. */
export function curvedUnreadable(edge: CurvedEdge): string | null {
  const fp = edge.fingerprint
  if (fp.faces.length < 2) return 'an edge with one face — nothing to round between'
  const s = [surfaceOf(edge, 0), surfaceOf(edge, 1)]
  const flat = s.findIndex((f) => f.kind === 'plane')
  if (flat < 0) return `an edge between a ${s[0].kind} and a ${s[1].kind} — a curved edge is read with a flat face on one side`
  const other = s[1 - flat]
  const axis = normalize(fp.dir)
  const od = normalize(other.dir)
  if (!axis || !od) return 'an edge without a direction'
  if (fp.kind === 'circle') {
    if (!(fp.radius! > 0)) return 'a circle edge without its radius'
    if (!edge.ends) return 'a circle edge known by its fingerprint only — pick it on the body'
    if (other.kind === 'cylinder' || other.kind === 'cone') return Math.abs(dot(od, axis)) >= COS_AXIS ? null : `a circle edge on a ${other.kind} of another axis`
    if (other.kind === 'sphere') return other.radius ? null : 'a circle edge on a sphere whose radius is not known here — pick it on the body'
    return `a circle edge on a ${other.kind} face — a cylinder, a cone or a sphere is read`
  }
  if (fp.kind === 'line') {
    if (other.kind !== 'cylinder') return `an edge between a plane and a ${other.kind} — a straight edge is read between two flat faces or a flat face and a cylinder`
    if (!other.radius || !other.center) return 'an edge on a cylinder whose radius is not known here — pick it on the body'
    if (Math.abs(dot(od, axis)) < COS_AXIS) return 'a straight edge across a cylinder'
    const off = sub(fp.mid, other.center)
    const radial = normalize(sub(off, scale(od, dot(off, od))))
    const n = normalize(s[flat].dir)
    if (radial && n && Math.abs(dot(radial, n)) > Math.cos((10 * Math.PI) / 180)) return 'a smooth edge — its faces meet tangent, there is no corner to read'
    return null
  }
  return `a ${fp.kind} edge — a straight edge or a circle is read`
}

/** The places along a curved edge a cut is taken: for a circle, evenly
 *  round it — over the middle `share` of an arc, all round a full one; for
 *  a straight edge, over its middle. Null where the edge's geometry falls
 *  short. */
export function curvedStations(edge: CurvedEdge, n: number, share: number): Station[] | null {
  const fp = edge.fingerprint
  const axis = normalize(fp.dir)
  if (!axis) return null
  if (fp.kind === 'circle') {
    const R = fp.radius!
    const [e0, e1] = edge.ends!
    // The centre lies a radius from the middle towards the chord's middle
    // — for an arc of any span, and for a full circle, whose ends meet
    // opposite its middle.
    const chord: Vec3 = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2, (e0[2] + e1[2]) / 2]
    let v = sub(chord, fp.mid)
    v = sub(v, scale(axis, dot(v, axis)))
    const lv = len(v)
    if (!(lv > 1e-9)) return null
    const C = addScaled(fp.mid, v, R / lv)
    const rho0 = scale(v, -1 / lv)
    const w = cross(axis, rho0)
    const span = Math.min(2 * Math.PI, fp.length / R)
    const full = span > 2 * Math.PI - 1e-3
    const thetas = full
      ? Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n)
      : n === 1
        ? [0]
        : Array.from({ length: n }, (_, i) => span * share * (i / (n - 1) - 0.5))
    const rhoAt = (t: number) => normalize(addScaled(scale(rho0, Math.cos(t)), w, Math.sin(t)))!
    // Which way round the first end lies: the arc's end at −span/2 nearer
    // it, or the other; a full circle's ends meet opposite its middle.
    const back = addScaled(C, rhoAt(-span / 2), R)
    const sign = full || len(sub(back, e0)) <= len(sub(back, e1)) ? 1 : -1
    return thetas.map((t) => {
      const rho = rhoAt(t)
      const along = full ? (((t + Math.PI) / (2 * Math.PI)) % 1) : 0.5 + (sign * t) / span
      return { at: addScaled(C, rho, R), normal: cross(axis, rho), x: rho, y: axis, t: along }
    })
  }
  const flat = [surfaceOf(edge, 0), surfaceOf(edge, 1)].find((f) => f.kind === 'plane')
  if (!flat) return null
  const y = normalize(sub(flat.dir, scale(axis, dot(flat.dir, axis))))
  if (!y) return null
  const x = cross(y, axis)
  const half = fp.length / 2
  const [a, b] = edge.ends ?? [addScaled(fp.mid, axis, -half), addScaled(fp.mid, axis, half)]
  const ts = n === 1 ? [0.5] : Array.from({ length: n }, (_, i) => 0.5 - share / 2 + (share * i) / (n - 1))
  return ts.map((t) => ({ at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], normal: axis, x, y, t }))
}

const unit2 = (v: Vec2): Vec2 | null => {
  const l = Math.hypot(v[0], v[1])
  return l > 1e-9 ? [v[0] / l, v[1] / l] : null
}
const dot2 = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const perp = (v: Vec2): Vec2 => [-v[1], v[0]]
const neg = (v: Vec2): Vec2 => [-v[0], -v[1]]

/** The sign that makes a circle trace's distance, |x − q| − r, grow along
 *  its normal m at the corner. */
const circleSign = (t: Trace2) => Math.sign(-dot2(t.q!, t.m)) || 1

/** A trace's signed distance at x, and its gradient. */
function phi(t: Trace2, x: Vec2): number {
  if (t.kind === 'line') return dot2(x, t.m)
  return circleSign(t) * (Math.hypot(x[0] - t.q![0], x[1] - t.q![1]) - t.r!)
}
function grad(t: Trace2, x: Vec2): Vec2 {
  if (t.kind === 'line') return t.m
  const g = unit2([x[0] - t.q![0], x[1] - t.q![1]]) ?? t.m
  const s = circleSign(t)
  return [s * g[0], s * g[1]]
}

/** Which way along a curve from the corner the scan's points lie: the
 *  points within `tol` of it, clear of the corner, counted either side. */
function sides(window: readonly Vec2[], dist: (p: Vec2) => number, tangent: Vec2, tol: number): [number, number] {
  let plus = 0
  let minus = 0
  for (const p of window) {
    if (Math.hypot(p[0], p[1]) < 3 * tol || dist(p) > tol) continue
    if (dot2(p, tangent) > 0) plus++
    else minus++
  }
  return [plus, minus]
}

interface Candidate {
  trace: Omit<Trace2, 'd'>
  dist: (p: Vec2) => number
  tangent: Vec2
}

/** The candidate and the way along it the scan bears out: the most points,
 *  at least three, and twice any other's. */
function bestOf(window: readonly Vec2[], cands: readonly Candidate[], tol: number): Trace2 | null {
  const scored: { trace: Trace2; n: number }[] = []
  for (const c of cands) {
    const [plus, minus] = sides(window, c.dist, c.tangent, tol)
    scored.push({ trace: { ...c.trace, d: c.tangent }, n: plus }, { trace: { ...c.trace, d: neg(c.tangent) }, n: minus })
  }
  scored.sort((a, b) => b.n - a.n)
  if (scored.length === 0 || scored[0].n < 3 || (scored.length > 1 && scored[0].n < 2 * scored[1].n)) return null
  return scored[0].trace
}

const lineCand = (m: Vec2): Candidate => ({ trace: { kind: 'line', m }, dist: (p) => Math.abs(dot2(p, m)), tangent: perp(m) })
const circleCand = (q: Vec2, r: number): Candidate => {
  const u: Vec2 = [-q[0] / r, -q[1] / r]
  return { trace: { kind: 'circle', m: u, q, r }, dist: (p) => Math.abs(Math.hypot(p[0] - q[0], p[1] - q[1]) - r), tangent: perp(u) }
}

/** A cone's trace through the corner, read off the scan: the median
 *  direction of the points out along it, off the flat face's line. */
function coneTrace(window: readonly Vec2[], flat: Trace2, reach: number, tol: number): Trace2 | null {
  const far = window.filter((p) => Math.abs(dot2(p, flat.m)) > tol && Math.hypot(p[0], p[1]) >= Math.max(3 * tol, 0.35 * reach))
  if (far.length < 4) return null
  const mean = unit2(far.reduce<Vec2>((a, p) => [a[0] + p[0] / Math.hypot(p[0], p[1]), a[1] + p[1] / Math.hypot(p[0], p[1])], [0, 0]))
  if (!mean) return null
  const angles = far.map((p) => Math.atan2(dot2(p, perp(mean)), dot2(p, mean))).sort((a, b) => a - b)
  const a = angles[angles.length >> 1]
  const d: Vec2 = [mean[0] * Math.cos(a) - mean[1] * Math.sin(a), mean[0] * Math.sin(a) + mean[1] * Math.cos(a)]
  return { kind: 'line', m: perp(d), d }
}

/**
 * The round fitted between two traces, line or circle, as
 * estimateFilletRadius fits it between two lines: one unknown, the radius;
 * for each the centre where both traces' signed distances are −r (a Newton
 * step or two from the two lines' answer), the profile the faces from their
 * tangent points with the arc between, every point near the corner read
 * against it, capped; the radius the points lie nearest, and one only where
 * it does markedly better than a sharp corner.
 */
export function estimateRoundOnTraces(points: readonly Vec2[], t1: Trace2, t2: Trace2, reach: number): FilletReading | null {
  const pts = points.filter((p) => Math.hypot(p[0], p[1]) <= reach)
  if (pts.length < 8) return null
  const off: number[] = []
  for (const p of pts) {
    const d = Math.min(Math.abs(phi(t1, p)), Math.abs(phi(t2, p)))
    if (d <= 0.3) off.push(d)
  }
  off.sort((a, b) => a - b)
  const tau = off.length < 4 ? 0.05 : Math.max(0.02, 3 * off[off.length >> 1])
  const k = 1 + dot2(t1.m, t2.m)
  if (!(k > 1e-6)) return null
  const b: Vec2 = [-(t1.m[0] + t2.m[0]) / k, -(t1.m[1] + t2.m[1]) / k]
  type Profile = { c: Vec2; T: [Vec2, Vec2]; e: [Vec2, Vec2] }
  const profile = (r: number): Profile | null => {
    let c: Vec2 = [r * b[0], r * b[1]]
    for (let it = 0; it < 20; it++) {
      const f1 = phi(t1, c) + r
      const f2 = phi(t2, c) + r
      if (Math.abs(f1) + Math.abs(f2) < 1e-10 * (1 + r)) break
      const g1 = grad(t1, c)
      const g2 = grad(t2, c)
      const det = g1[0] * g2[1] - g1[1] * g2[0]
      if (Math.abs(det) < 1e-9) return null
      c = [c[0] - (f1 * g2[1] - f2 * g1[1]) / det, c[1] - (g1[0] * f2 - g2[0] * f1) / det]
    }
    if (Math.abs(phi(t1, c) + r) + Math.abs(phi(t2, c) + r) > 1e-6 * (1 + r)) return null
    const T: [Vec2, Vec2] = [0, 1].map((i) => {
      const g = grad(i ? t2 : t1, c)
      return [c[0] + r * g[0], c[1] + r * g[1]] as Vec2
    }) as [Vec2, Vec2]
    const e: [Vec2, Vec2] = [0, 1].map((i) => {
      const t = i ? t2 : t1
      const g = perp(grad(t, c))
      return dot2(g, t.d) >= 0 ? g : neg(g)
    }) as [Vec2, Vec2]
    return { c, T, e }
  }
  const faceDist = (p: Vec2, pr: Profile, i: number): number => {
    const t = i ? t2 : t1
    const T = pr.T[i]
    const e = pr.e[i]
    const s = (p[0] - T[0]) * e[0] + (p[1] - T[1]) * e[1]
    if (s < 0) return Math.hypot(p[0] - T[0], p[1] - T[1])
    if (t.kind === 'line') return Math.hypot(p[0] - (T[0] + s * e[0]), p[1] - (T[1] + s * e[1]))
    return Math.abs(phi(t, p))
  }
  const distance = (p: Vec2, r: number, pr: Profile): { d: number; arc: boolean } => {
    const w: Vec2 = [p[0] - pr.c[0], p[1] - pr.c[1]]
    if (dot2(w, pr.e[0]) <= 0 && dot2(w, pr.e[1]) <= 0) return { d: Math.abs(Math.hypot(w[0], w[1]) - r), arc: true }
    return { d: Math.min(faceDist(p, pr, 0), faceDist(p, pr, 1)), arc: false }
  }
  const cap = 5 * tau
  const cost = (r: number) => {
    const pr = profile(r)
    if (!pr) return Infinity
    let sum = 0
    for (const p of pts) sum += Math.min(distance(p, r, pr).d, cap) ** 2
    return sum
  }
  const rMin = Math.max(tau, 0.02)
  if (!(reach > rMin)) return null
  const steps = 160
  let best = rMin
  let bestCost = Infinity
  for (let i = 0; i <= steps; i++) {
    const r = rMin * Math.pow(reach / rMin, i / steps)
    const c = cost(r)
    if (c < bestCost) {
      bestCost = c
      best = r
    }
  }
  if (!Number.isFinite(bestCost)) return null
  let lo = best / Math.pow(reach / rMin, 1 / steps)
  let hi = best * Math.pow(reach / rMin, 1 / steps)
  for (let it = 0; it < 50; it++) {
    const a = lo + (hi - lo) * 0.382
    const c = lo + (hi - lo) * 0.618
    if (cost(a) < cost(c)) hi = c
    else lo = a
  }
  const r = (lo + hi) / 2
  const pr = profile(r)
  if (!pr || !(r > 2 * tau) || cost(r) > 0.5 * cost(rMin)) return null
  const near = 2 * r + 3 * tau
  let onArc = 0
  let arcTotal = 0
  let sum = 0
  const h = Math.max(1e-4, r * 1e-3)
  const prUp = profile(r + h)
  const prDown = profile(r - h)
  let jj = 0
  for (const p of pts) {
    if (Math.hypot(p[0], p[1]) > near) continue
    const { d, arc } = distance(p, r, pr)
    if (!arc) continue
    arcTotal++
    if (d > 3 * tau) continue
    onArc++
    sum += d * d
    if (prUp && prDown) {
      const j = (Math.hypot(p[0] - prUp.c[0], p[1] - prUp.c[1]) - (r + h) - (Math.hypot(p[0] - prDown.c[0], p[1] - prDown.c[1]) - (r - h))) / (2 * h)
      jj += j * j
    }
  }
  if (onArc < 3 || onArc < 0.6 * arcTotal) return null
  const rms = Math.sqrt(sum / onArc)
  const scatter = Math.max(rms * Math.sqrt(onArc / Math.max(1, onArc - 1)), tau / 3)
  return { radius: r, points: onArc, rms, sigma: jj > 1e-12 ? scatter / Math.sqrt(jj) : r }
}

/** How near a face's trace a scan point counts as on it, for telling which
 *  way the face runs: wide, since the model's face may stand a little off
 *  the scan's — a face fitted leaning, a part not quite flat. */
const traceTol = (reach: number) => Math.max(0.3, 0.08 * reach)

/** How far off the model's line a face's scan points are taken for where
 *  the scan has the face, mm, and how far the scan's corner may stand off
 *  the model's and still be taken. */
const SCENE_BAND = 0.4
const SCENE_SHIFT = 0.5

/**
 * Two traces moved onto the scan near the corner: each face's
 * points clear of the round (beyond `from` along it, within a band of the
 * model's line), the median of their offsets from the line — the face
 * where the scan has it — and the corner where the two moved lines meet.
 * The model's faces were fitted over the whole part; a face that leans a
 * little, a part a little bent, puts the scan's corner a tenth or two off
 * the model's — which a round of a millimetre reads as another round. The
 * lines keep the model's directions: a degree's lean is hundredths over
 * the few millimetres read, and a median is not pulled by the points of a
 * chamfer or a countersink the band takes in. Null where neither face
 * says, or the scan's corner stands too far off.
 */
function sceneCorner(window: readonly Vec2[], t: readonly [Trace2, Trace2], from: number, reach: number): Vec2 | null {
  // A circle's trace is moved as a line is, by its offset along the normal
  // at the corner: the shift is a tenth or two, the circle many times that.
  const c = t.map((tr) => {
    const off = window.filter((p) => dot2(p, tr.d) >= from && Math.hypot(p[0], p[1]) <= reach).map((p) => phi(tr, p)).filter((d) => Math.abs(d) <= SCENE_BAND)
    if (off.length < 6) return null
    off.sort((x, y) => x - y)
    return off[off.length >> 1]
  })
  if (c[0] === null && c[1] === null) return null
  const [a, b] = [c[0] ?? 0, c[1] ?? 0]
  const [n, m] = [t[0].m, t[1].m]
  const det = n[0] * m[1] - n[1] * m[0]
  if (Math.abs(det) < 1e-6) return null
  const corner: Vec2 = [(a * m[1] - b * n[1]) / det, (n[0] * b - m[0] * a) / det]
  return Math.hypot(corner[0], corner[1]) <= SCENE_SHIFT ? corner : null
}

/** The reaches a station is read at, as shares of the one asked, where
 *  nothing reads: a neighbouring feature the reach takes in — a
 *  countersink a millimetre past a round, a face ending short of the reach
 *  that the face window did not find — read past. None under RETRY_FLOOR
 *  mm. */
const RETRIES = [1, 0.6, 0.4, 0.25] as const
const RETRY_FLOOR = 1
const retried = (reach: number) => RETRIES.map((k) => k * reach).filter((r, i) => i === 0 || r >= RETRY_FLOOR)

/** Why a station read nothing: its first read's why (at the reach asked),
 *  or a later one's where that said nothing. */
const firstWhy = (miss: Miss | undefined, own: Miss) => {
  if (miss && !miss.why && own.why) miss.why = own.why
}

/**
 * The round (or chamfer) across a curved edge at one station, read off the
 * scan's cut by the station's plane. Null where the cut shows none, or does
 * not bear out which way the faces run; `miss` then says why. Where the
 * reach takes in a neighbouring feature — a countersink a millimetre past a
 * round — and nothing reads, the corner is read again over shorter reaches
 * (RETRIES).
 */
export function readCurvedCut(edge: CurvedEdge, st: Station, cut: ScanCut, reach: number, shape: 'round' | 'chamfer' = 'round', miss?: Miss): CurvedRead | null {
  const to2 = (p: Vec3): Vec2 => {
    const d = sub(p, st.at)
    return [dot(d, st.x), dot(d, st.y)]
  }
  const chains = cutChains(cut, to2)
  for (const r of retried(reach)) {
    const own: Miss = {}
    const read = readCurvedAt(edge, st, chains, to2, r, shape, own)
    if (read) return read
    firstWhy(miss, own)
  }
  return null
}

function readCurvedAt(edge: CurvedEdge, st: Station, chains: Vec2[][], to2: (p: Vec3) => Vec2, reach: number, shape: 'round' | 'chamfer', miss: Miss, capped = false): CurvedRead | null {
  const none = (why: string) => {
    miss.why = why
    return null
  }
  const dir2 = (v: Vec3): Vec2 | null => unit2([dot(v, st.x), dot(v, st.y)])
  const window = cornerWindow(chains, reach)
  if (window.length < 8) return none(fewWhy(window, reach))
  const tol = traceTol(reach)
  const fp = edge.fingerprint
  const surf = [surfaceOf(edge, 0), surfaceOf(edge, 1)]
  const fi = surf.findIndex((f) => f.kind === 'plane')
  if (fi < 0) return none('no flat face')
  const other = surf[1 - fi]
  const mp = dir2(surf[fi].dir)
  if (!mp) return none('the flat face lies in the cut')
  const flat = bestOf(window, [lineCand(mp)], tol)
  if (!flat) return none('the faces not found in the cut')
  let trace: Trace2 | null = null
  if (fp.kind === 'circle' && other.kind === 'cylinder') {
    const along = dir2(fp.dir)
    if (along) trace = bestOf(window, [lineCand(perp(along))], tol)
  } else if (fp.kind === 'circle' && other.kind === 'cone') trace = coneTrace(window, flat, reach, tol)
  else if (fp.kind === 'circle' && other.kind === 'sphere') {
    const R = fp.radius!
    const Rs = other.radius!
    const h = Math.sqrt(Math.max(0, Rs * Rs - R * R))
    const qs: Vec2[] = h > 1e-6 ? [[-R, h], [-R, -h]] : [[-R, 0]]
    trace = bestOf(window, qs.map((q) => circleCand(q, Rs)), tol)
  } else if (fp.kind === 'line' && other.kind === 'cylinder') {
    const q = to2(other.center!)
    trace = Math.hypot(q[0], q[1]) > 1e-6 ? bestOf(window, [circleCand(q, other.radius!)], tol) : null
  }
  if (!trace) return none('the faces not found in the cut')
  // Convex where the other face runs off against the flat's outward
  // normal; its own normal then points away from the flat, and towards it
  // on a concave corner.
  const s = dot2(flat.m, trace.d)
  if (Math.abs(s) < SIN_TANGENT) return none('the faces meet near tangent')
  const across = dot2(trace.m, flat.d)
  if (Math.abs(across) < 1e-3) return none('the faces meet near tangent')
  const oriented: Trace2 = Math.sign(across) === Math.sign(s) ? trace : { ...trace, m: neg(trace.m) }
  const concave = s > 0
  const turn = (t: Trace2): Trace2 => (concave ? { ...t, m: neg(t.m) } : t)
  let t: [Trace2, Trace2] = fi === 0 ? [turn(flat), turn(oriented)] : [turn(oriented), turn(flat)]
  if (t[0].kind !== 'line' || t[1].kind !== 'line') {
    if (shape === 'chamfer') {
      // A chamfer is read against the curved face's tangent at the corner,
      // over a reach short enough for the face to stay by it.
      const near = tangentReach(t)
      if (!capped && near < reach) return readCurvedAt(edge, st, chains, to2, near, shape, miss, true) ?? none(tangentWhy(miss, near, t))
      t = [asTangent(t[0]), asTangent(t[1])]
    } else {
      const reading = estimateRoundOnTraces(window, t[0], t[1], reach)
      return reading ? { reading } : none('sharp')
    }
  }
  // Read against the model's corner, then against the scan's own corner
  // found from the face points clear of what was read — both on the face
  // window, which ends where a face does within the reach.
  const m: [Vec2, Vec2] = [t[0].m, t[1].m]
  const fw = faceWindow(chains, reach, m, [t[0].d, t[1].d])
  const held = fw.reach
  const own: Miss = {}
  const estimate = (w: readonly Vec2[], mm?: Miss) => (shape === 'round' ? estimateFilletRadius(w, m[0], m[1], held, mm) : estimateChamfer(w, m[0], m[1], held, mm))
  let reading = estimate(fw.points, own)
  // How far along a face the profile leaves it, for a radius or setback
  // of one.
  const k = 1 + dot2(m[0], m[1])
  const tangent = shape === 'round' && k > 1e-6 ? Math.hypot(-(m[0][0] + m[1][0]) / k + m[0][0], -(m[0][1] + m[1][1]) / k + m[0][1]) : 1
  // Where a face ends within the reach, neither runs far enough clear of
  // the round to say where the scan has it: the model's corner, for either
  // shape alike.
  const from = Math.max(0.4 * held, reading ? 1.25 * reading.radius * tangent : 0)
  const scene = from < 0.9 * held && !fw.end ? sceneCorner(fw.points, t, from, held) : null
  let w: readonly Vec2[] = fw.points
  let corner: Vec2 = [0, 0]
  if (scene && Math.hypot(scene[0], scene[1]) > 1e-3) {
    const moved = fw.points.map((p): Vec2 => [p[0] - scene[0], p[1] - scene[1]])
    const again = estimate(moved)
    if (again) {
      reading = again
      w = moved
      corner = scene
    }
  }
  if (!reading) return none(fw.end ? faceEndWhy(fw) : (own.why ?? 'sharp'))
  if (shape === 'round') return { reading }
  const setbacks = estimateChamferSetbacks(w, m[0], m[1], held) ?? undefined
  // A hole's mouth — a cylinder whose outward normal points at its axis —
  // cut by a cone: the countersink, as a drawing calls it out.
  if (!setbacks || fp.kind !== 'circle' || other.kind !== 'cylinder' || oriented.m[0] >= 0) return { reading, ...(setbacks ? { setbacks } : {}) }
  const sFlat = setbacks.s[fi]
  const sWall = setbacks.s[1 - fi]
  const half = Math.acos(Math.min(1, Math.abs(setbacks.dir[1])))
  return {
    reading,
    setbacks,
    countersink: {
      angleDeg: (2 * half * 180) / Math.PI,
      angleSigma: (2 * setbacks.dirSigma * 180) / Math.PI,
      diameter: 2 * (fp.radius! + corner[0] + sFlat * flat.d[0]),
      diameterSigma: 2 * setbacks.sigma[fi],
      depth: sWall * Math.abs(oriented.d[1]),
      depthSigma: setbacks.sigma[1 - fi],
    },
  }
}

// An edge of any shape — the curve where a blade's side meets a dish, a
// spline's edge, a straight edge between a flat and a cone — read off the
// body it was picked on rather than off its faces' surfaces: the cuts are
// placed by length along the edge's polyline, each square to the edge
// there, so the faces' normals at the station lie in the cut; each face's
// normal there comes from the body's mesh, whose triangles carry the face
// they lie on; and each face's trace is the body's mesh cut by the same
// plane — a line through the corner square to the normal, or a circle
// tangent to it where the face curves within the reach (a dish's cone cut
// across a blade's foot, a torus). The round is then fitted between the
// traces as on any other edge.

/** A face of an edge as the body's mesh gives it: its triangles, three
 *  corners each (xyz, nine numbers a triangle), and the surface's outward
 *  normal at every corner. */
export interface FaceTriangles {
  positions: Float32Array
  normals: Float32Array
}

/** An edge of any shape, off the body: the polyline it is drawn by (xyz
 *  interleaved) and its two faces' triangles. */
export interface FreeEdge {
  polyline: ArrayLike<number>
  faces: readonly [FaceTriangles, FaceTriangles]
}

/** A body's mesh as the reading takes it: the kernel's, which says which
 *  face each triangle lies on. */
export interface FacedMesh {
  positions: ArrayLike<number>
  normals: ArrayLike<number>
  indices: ArrayLike<number>
  faceHash?: ArrayLike<number>
}

/** The triangles of the face `hash` off a body's mesh, null where the mesh
 *  does not say which face a triangle lies on or has none of it. */
export function faceTriangles(mesh: FacedMesh, hash: number): FaceTriangles | null {
  const fh = mesh.faceHash
  if (!fh) return null
  let count = 0
  for (let t = 0; t < fh.length; t++) if (fh[t] === hash) count++
  if (count === 0) return null
  const positions = new Float32Array(count * 9)
  const normals = new Float32Array(count * 9)
  let o = 0
  for (let t = 0; t < fh.length; t++) {
    if (fh[t] !== hash) continue
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t * 3 + k]
      for (let j = 0; j < 3; j++) {
        positions[o] = mesh.positions[v * 3 + j]
        normals[o++] = mesh.normals[v * 3 + j]
      }
    }
  }
  return { positions, normals }
}

/** An edge of any shape off a body's mesh: its polyline and its two
 *  faces' triangles; null for an edge with one face (a seam) or a face the
 *  mesh does not hold. */
export function freeEdgeOf(polyline: ArrayLike<number>, faces: readonly number[], mesh: FacedMesh): FreeEdge | null {
  if (polyline.length < 6 || faces.length < 2 || faces[0] === faces[1]) return null
  const a = faceTriangles(mesh, faces[0])
  const b = faceTriangles(mesh, faces[1])
  return a && b ? { polyline, faces: [a, b] } : null
}

/** The point of a triangle nearest p, as weights on its corners (Ericson,
 *  Real-Time Collision Detection, 5.1.5). */
function nearestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): [number, number, number] {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0]
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0]
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return [1 - v, v, 0]
  }
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1]
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return [1 - w, 0, w]
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [0, 1 - w, w]
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  return [1 - v - w, v, w]
}

/** The surface's outward normal on a face at the point of it nearest
 *  `at`: the normals at the corners of the triangle it lies on, weighted
 *  as the point lies between them — on the edge, the normals the mesher
 *  put on the edge itself, however long the face's slivers run off it. */
export function faceNormalNear(face: FaceTriangles, at: Vec3): Vec3 | null {
  const p = face.positions
  const corner = (t: number, k: number): Vec3 => [p[t + k * 3], p[t + k * 3 + 1], p[t + k * 3 + 2]]
  let best: { t: number; w: [number, number, number] } | null = null
  let bestD = Infinity
  for (let t = 0; t + 8 < p.length; t += 9) {
    const c = [corner(t, 0), corner(t, 1), corner(t, 2)]
    const w = nearestOnTriangle(at, c[0], c[1], c[2])
    const q = [0, 1, 2].map((k) => w[0] * c[0][k] + w[1] * c[1][k] + w[2] * c[2][k])
    const d = Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2])
    if (d < bestD) {
      bestD = d
      best = { t, w }
    }
  }
  if (!best) return null
  const { t, w } = best
  const n = face.normals
  return normalize([0, 1, 2].map((k) => w[0] * n[t + k] + w[1] * n[t + 3 + k] + w[2] * n[t + 6 + k]) as Vec3)
}

/** A point of a face's cut, in the cut: where it is, and the surface's
 *  outward normal there flattened into the cut, unit length. */
export interface CutPoint {
  p: Vec2
  n: Vec2
}

/** Where a face's triangles cross the plane through `at` square to
 *  `normal`, within `reach` of `at`, mapped into the plane by the axes x
 *  and y: points along each triangle's cut a fifteenth of the reach apart,
 *  with the normals at its corners carried along — a flat or a cone is
 *  meshed in long slivers, whose cut runs across the whole reach with no
 *  crossing inside it. */
export function faceCut(face: FaceTriangles, at: Vec3, normal: Vec3, x: Vec3, y: Vec3, reach: number): CutPoint[] {
  const p = face.positions
  const nn = face.normals
  const out: CutPoint[] = []
  const step = reach / 15
  const corner = (a: Float32Array, t: number, k: number): Vec3 => [a[t + k * 3], a[t + k * 3 + 1], a[t + k * 3 + 2]]
  const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
  for (let t = 0; t + 8 < p.length; t += 9) {
    const c = [corner(p, t, 0), corner(p, t, 1), corner(p, t, 2)]
    const s = c.map((q) => dot(sub(q, at), normal))
    const ends: { p: Vec2; n: Vec3 }[] = []
    for (let k = 0; k < 3; k++) {
      const sa = s[k]
      const sb = s[(k + 1) % 3]
      if (sa < 0 === sb < 0) continue
      const f = sa / (sa - sb)
      const q = sub(lerp(c[k], c[(k + 1) % 3], f), at)
      ends.push({ p: [dot(q, x), dot(q, y)], n: lerp(corner(nn, t, k), corner(nn, t, (k + 1) % 3), f) })
    }
    if (ends.length < 2) continue
    const [a, b] = [ends[0].p, ends[1].p]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    // Clear of the reach: the segment's nearest point to the corner.
    const f = l > 0 ? Math.max(0, Math.min(1, -(a[0] * (b[0] - a[0]) + a[1] * (b[1] - a[1])) / (l * l))) : 0
    if (Math.hypot(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) > reach) continue
    const n = Math.max(1, Math.ceil(l / step))
    for (let i = 0; i <= n; i++) {
      const q: Vec2 = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]
      if (Math.hypot(q[0], q[1]) > reach) continue
      const m = lerp(ends[0].n, ends[1].n, i / n)
      const m2 = unit2([dot(m, x), dot(m, y)])
      if (m2) out.push({ p: q, n: m2 })
    }
  }
  return out
}

/** The point at length s along a polyline, and the unit direction there
 *  taken over `h` either side — a chord across a few of the polyline's
 *  segments, not one segment's own. */
function alongPolyline(poly: ArrayLike<number>, cum: readonly number[], s: number, h: number): { at: Vec3; dir: Vec3 | null } {
  const point = (u: number): Vec3 => {
    const x = Math.max(0, Math.min(cum[cum.length - 1], u))
    let i = 1
    while (i < cum.length - 1 && cum[i] < x) i++
    const seg = cum[i] - cum[i - 1]
    const f = seg > 0 ? (x - cum[i - 1]) / seg : 0
    return [0, 1, 2].map((k) => poly[(i - 1) * 3 + k] + (poly[i * 3 + k] - poly[(i - 1) * 3 + k]) * f) as Vec3
  }
  return { at: point(s), dir: normalize(sub(point(s + h), point(s - h))) }
}

/** The places along an edge of any shape a cut is taken: by length along
 *  its polyline over the middle `share`, each plane square to the edge
 *  there, X along the first face's outward normal flattened into it. Null
 *  where the polyline is too short or a face's normal is not found. */
export function freeStations(edge: FreeEdge, n: number, share: number): Station[] | null {
  const poly = edge.polyline
  const cum = [0]
  for (let i = 1; i < poly.length / 3; i++) cum.push(cum[i - 1] + Math.hypot(poly[i * 3] - poly[i * 3 - 3], poly[i * 3 + 1] - poly[i * 3 - 2], poly[i * 3 + 2] - poly[i * 3 - 1]))
  const total = cum[cum.length - 1]
  if (!(total > 1e-6)) return null
  const h = Math.min(0.5, 0.05 * total)
  const ts = n === 1 ? [0.5] : Array.from({ length: n }, (_, i) => 0.5 - share / 2 + (share * i) / (n - 1))
  const out: Station[] = []
  for (const t of ts) {
    const { at, dir } = alongPolyline(poly, cum, t * total, h)
    if (!dir) return null
    const n0 = faceNormalNear(edge.faces[0], at)
    const x = n0 ? normalize(sub(n0, scale(dir, dot(n0, dir)))) : null
    if (!x) return null
    out.push({ at, normal: dir, x, y: cross(dir, x), t })
  }
  return out
}

/** Why an edge of any shape cannot be read, or null when it can: its faces
 *  meet tangent at its middle — a round's seam, no corner. */
export function freeUnreadable(edge: FreeEdge): string | null {
  const st = freeStations(edge, 1, 0)
  if (!st) return 'the edge’s geometry places no cut across it'
  const m = edge.faces.map((f) => faceNormalNear(f, st[0].at))
  if (!m[0] || !m[1]) return 'the edge’s faces are not found on the body’s mesh'
  if (len(cross(m[0], m[1])) < SIN_TANGENT && dot(m[0], m[1]) > 0) return 'a smooth edge — its faces meet tangent, there is no corner to read'
  return null
}

/** How far a face's trace may bow off a line over the reach, mm, and still
 *  be read as one. */
const TRACE_SAG = 0.005

/** How far a curved face may bow off its tangent at the corner, mm, over
 *  the reach a chamfer is read at against that tangent: a twentieth — the
 *  scan's own scatter, near enough, where a chamfer of a millimetre reads
 *  a few hundredths off. */
const CHAMFER_SAG = 0.05

/** The reach over which every curved trace stays within CHAMFER_SAG of its
 *  tangent at the corner: a circle of radius R bows reach² / 2R off it. */
function tangentReach(t: readonly Trace2[]): number {
  let r = Infinity
  for (const tr of t) if (tr.kind === 'circle') r = Math.min(r, tr.r!)
  return Math.sqrt(2 * r * CHAMFER_SAG)
}

/** A trace as its tangent at the corner: a circle's line through the
 *  corner square to its normal there. */
const asTangent = (t: Trace2): Trace2 => (t.kind === 'line' ? t : { kind: 'line', m: t.m, d: t.d })

/** Why a chamfer read against a curved face's tangent read nothing: what
 *  the short read said, with the reach it was held to and why. */
function tangentWhy(miss: Miss, near: number, t: readonly Trace2[]): string {
  let r = Infinity
  for (const tr of t) if (tr.kind === 'circle') r = Math.min(r, tr.r!)
  const r2 = (x: number) => Math.round(x * 100) / 100
  // units-ok: a read's why, kept on the reading the agent is given too
  return `${miss.why ?? 'sharp'} — read against the curved face's tangent within ${r2(near)} mm, where the R${r2(r)} face stays within ${CHAMFER_SAG} mm of it`
}

/**
 * A face's trace through the corner, off the body's own cut: m the
 * outward normal at the corner in the cut, d the way the face runs from
 * the corner (where its cut points lie), and a circle tangent to the line
 * where the face bows off it by more than TRACE_SAG over the reach. The
 * curvature is read off the normals, not the points: a mesh's points lie
 * on chords, off the surface by as much as its chord tolerance, which is
 * the bow being read, while its normals are the surface's own. Along a
 * circle the normal turns from m towards d by κ for every millimetre; κ is
 * the least-squares one.
 */
export function traceFromCut(points: readonly CutPoint[], m: Vec2, reach: number): Trace2 | null {
  const clear = points.filter((c) => Math.hypot(c.p[0], c.p[1]) >= 0.1 * reach)
  if (clear.length < 2) return null
  // The face runs from the corner the way its nearest points lie: a cut
  // may meet the same face again past a thin wall — the dish on the far
  // side of a blade — but only further off.
  const nearest = clear.reduce((a, c) => (Math.hypot(c.p[0], c.p[1]) < Math.hypot(a.p[0], a.p[1]) ? c : a))
  const t = perp(m)
  const d = dot2(nearest.p, t) >= 0 ? t : neg(t)
  const own = clear.filter((c) => dot2(c.p, d) > 0)
  if (own.length < 2) return null
  let num = 0
  let den = 0
  for (const c of own) {
    const s = dot2(c.p, d)
    num += Math.atan2(dot2(c.n, d), dot2(c.n, m)) * s
    den += s * s
  }
  const kappa = den > 0 ? num / den : 0
  if (Math.abs(kappa) * reach * reach < 2 * TRACE_SAG) return { kind: 'line', m, d }
  const k = 1 / kappa
  return { kind: 'circle', m, d, q: [-k * m[0], -k * m[1]], r: Math.abs(k) }
}

/**
 * The round (or, between straight traces, the chamfer) across an edge of
 * any shape at one station, read off the scan's cut by the station's
 * plane. The body gives both traces and which way each face runs; the
 * corner is convex where the second face runs off against the first's
 * outward normal, and a concave one is read as the convex one its normals
 * turned round make, as readCurvedCut reads it.
 */
export function readFreeCut(edge: FreeEdge, st: Station, cut: ScanCut, reach: number, shape: 'round' | 'chamfer' = 'round', miss?: Miss): CurvedRead | null {
  const to2 = (p: Vec3): Vec2 => {
    const d = sub(p, st.at)
    return [dot(d, st.x), dot(d, st.y)]
  }
  const chains = cutChains(cut, to2)
  for (const r of retried(reach)) {
    const own: Miss = {}
    const read = readFreeAt(edge, st, chains, r, shape, own)
    if (!read) firstWhy(miss, own)
    // The traces are the model's faces, fitted over the whole part: a few
    // hundredths off the scan's, the round reads a few per cent off, which
    // the fit's own sigma does not know.
    if (read) return { ...read, reading: { ...read.reading, sigma: Math.max(read.reading.sigma, FREE_SIGMA_SHARE * read.reading.radius) } }
  }
  return null
}

/** How well a round on an edge of any shape is known at one place, at
 *  best, as a share of its radius. */
const FREE_SIGMA_SHARE = 0.02

/** Each face's normal and cut at a station, kept with the station: a face
 *  is read through all its triangles, and a station is read at two
 *  reaches and for both shapes. The cut is kept at the largest reach
 *  asked and filtered for a shorter one. */
const facesAtStation = new WeakMap<Station, { normal: Vec3 | null; cut: CutPoint[]; reach: number }[]>()
function faceAt(st: Station, i: number, face: FaceTriangles, reach: number): { normal: Vec3 | null; cut: CutPoint[] } {
  let kept = facesAtStation.get(st)
  if (!kept) facesAtStation.set(st, (kept = []))
  const known = kept[i]
  if (known && known.reach >= reach) return known
  const read = { normal: known?.normal ?? faceNormalNear(face, st.at), cut: faceCut(face, st.at, st.normal, st.x, st.y, reach), reach }
  kept[i] = read
  return read
}

function readFreeAt(edge: FreeEdge, st: Station, chains: Vec2[][], reach: number, shape: 'round' | 'chamfer', miss: Miss, capped = false): CurvedRead | null {
  const none = (why: string) => {
    miss.why = why
    return null
  }
  const window = cornerWindow(chains, reach)
  if (window.length < 8) return none(fewWhy(window, reach))
  const traces: Trace2[] = []
  for (const [i, face] of edge.faces.entries()) {
    const { normal, cut } = faceAt(st, i, face, reach)
    const m = normal ? unit2([dot(normal, st.x), dot(normal, st.y)]) : null
    const tr = m ? traceFromCut(cut.filter((c) => Math.hypot(c.p[0], c.p[1]) <= reach), m, reach) : null
    if (!tr) return none('the faces not found in the cut')
    traces.push(tr)
  }
  const s = dot2(traces[0].m, traces[1].d)
  if (Math.abs(s) < SIN_TANGENT) return none('the faces meet near tangent')
  const concave = s > 0
  let t = traces.map((tr): Trace2 => (concave ? { ...tr, m: neg(tr.m) } : tr)) as [Trace2, Trace2]
  // A chamfer is read against a curved face's tangent at the corner, over
  // a reach short enough for the face to stay by it (tangentReach).
  if (shape === 'chamfer' && (t[0].kind !== 'line' || t[1].kind !== 'line')) {
    const near = tangentReach(t)
    if (!capped && near < reach) return readFreeAt(edge, st, chains, near, shape, miss, true) ?? none(tangentWhy(miss, near, t))
    t = [asTangent(t[0]), asTangent(t[1])]
  }
  const lines = t[0].kind === 'line' && t[1].kind === 'line'
  const m: [Vec2, Vec2] = [t[0].m, t[1].m]
  // Between straight traces, on the face window, as readCurvedAt reads.
  const fw = lines ? faceWindow(chains, reach, m, [t[0].d, t[1].d]) : { points: window, reach, end: null }
  const held = fw.reach
  const own: Miss = {}
  const estimate = (w: readonly Vec2[], mm?: Miss) =>
    !lines ? estimateRoundOnTraces(w, t[0], t[1], held) : shape === 'round' ? estimateFilletRadius(w, m[0], m[1], held, mm) : estimateChamfer(w, m[0], m[1], held, mm)
  // Read against the model's corner, then against the scan's own corner
  // found from the face points clear of what was read.
  let reading = estimate(fw.points, own)
  const k = 1 + dot2(m[0], m[1])
  const tangent = shape === 'round' && k > 1e-6 ? Math.hypot(-(m[0][0] + m[1][0]) / k + m[0][0], -(m[0][1] + m[1][1]) / k + m[0][1]) : 1
  // Where a face ends within the reach, neither runs far enough clear of
  // the round to say where the scan has it: the model's corner, for either
  // shape alike.
  const from = Math.max(0.4 * held, reading ? 1.25 * reading.radius * tangent : 0)
  const scene = from < 0.9 * held && !fw.end ? sceneCorner(fw.points, t, from, held) : null
  let w: readonly Vec2[] = fw.points
  if (scene && Math.hypot(scene[0], scene[1]) > 1e-3) {
    const moved = fw.points.map((p): Vec2 => [p[0] - scene[0], p[1] - scene[1]])
    const again = estimate(moved)
    if (again) {
      reading = again
      w = moved
    }
  }
  if (!reading) return none(fw.end ? faceEndWhy(fw) : (own.why ?? 'sharp'))
  if (shape === 'round') return { reading }
  const setbacks = estimateChamferSetbacks(w, m[0], m[1], held)
  return { reading, ...(setbacks ? { setbacks } : {}) }
}
