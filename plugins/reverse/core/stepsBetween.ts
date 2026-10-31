// SPDX-License-Identifier: AGPL-3.0-only
// Steps a body has where two faces were meant as one: two flat faces
// facing one way a hair apart where they meet, a round drawn twice on
// nearly one axis, a profile whose round starts just off another
// feature's face. A model built from stacked sketches gets them where a
// wall drawn in one sketch nearly coincides with one drawn in another —
// each fitted to the scan on its own cut — and every one of them is a
// crease a round stumbles on and a decimal in the drawing.
//
// Read off the topology alone: the faces' fingerprints, which feature made
// each (origin), and the edges round each face for where it lies — no
// kernel call. The build asks it after every join, about the faces the
// join brought against the rest (Builder.noteStepsBetween); the audit asks
// it about every pair (audit.ts).

import type { Vec3 } from '../../../src/core/types'
import { cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { EdgeInfo, FaceInfo } from './buildTypes'
import type { FaceFingerprint } from './topo'

/** Two faces closer than this are one surface. */
const SAME_MM = 1e-4

/** How far apart two faces' extents may lie, mm, and still be taken to
 *  meet: a step's two faces touch along its riser. */
const MEET_MM = 0.1

/** Steps under this, mm, are hairlines: a piece fitted twice to one cut,
 *  never a step a drawing shows — told after the others. */
export const HAIR_MM = 1e-3

/** What a step is between: two flat faces facing one way (flat), two round
 *  faces on nearly one axis at nearly one radius (round), a round whose
 *  foot — the straight edge it starts along — lies just off a flat face of
 *  another feature (foot), or a round whose side nearly touches such a
 *  face, crossing it at a crease or standing a hair off (tangent). */
export type StepForm = 'flat' | 'round' | 'foot' | 'tangent'

/** A step between two faces of a body, by index into its face list. */
export interface StepPair {
  form: StepForm
  faces: [number, number]
  /** How far apart, mm: the gap across two flat faces; the widest gap
   *  between two rounds (the radii's difference and the axes' offset
   *  together); the foot's distance off the face. */
  off: number
  /** Where to look: the middle of the face between the two (the riser)
   *  where one meets both, else where the two meet. */
  at: Vec3
  /** The face between the two — a riser 0.07 mm wide — by index. */
  riser?: number
  /** For a round drawn twice: the two radii (a cone's where the two
   *  overlap) and how far apart the axes lie. */
  radii?: [number, number]
  axisOff?: number
  /** For a round through a face it was meant to touch: the angle they
   *  meet at, degrees. */
  creaseDeg?: number
}

export interface StepOptions {
  /** A step is up to this, mm. */
  stepMm?: number
  /** How far off parallel two faces, or two axes, may lean, degrees. */
  parallelDeg?: number
  /** Which pairs to look at — the build's: one face the join brought, one
   *  it found. Every pair by default. */
  pair?: (a: FaceInfo, b: FaceInfo) => boolean
}

export const STEP_DEFAULTS = { stepMm: 0.3, parallelDeg: 1 }

const leanDeg = (a: Vec3, b: Vec3): number => {
  const la = len(a), lb = len(b)
  if (!(la > 0 && lb > 0)) return 0
  const d = (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) * 180) / Math.PI
  return d > 90 ? 180 - d : d
}

const facingDeg = (a: Vec3, b: Vec3): number => {
  const la = len(a), lb = len(b)
  if (!(la > 0 && lb > 0)) return 180
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) * 180) / Math.PI
}

/** Two directions square to a normal. */
function basisOf(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = normalize(cross(n, helper)) ?? [1, 0, 0]
  return [u, cross(n, u)]
}

/** The points of the edges round each face, by face index: what a face's
 *  extent is read off. A face no edge bounds has none. */
function extentPoints(faces: readonly FaceInfo[], edges: readonly EdgeInfo[]): Vec3[][] {
  const index = new Map<number, number>()
  faces.forEach((f, i) => index.set(f.hash, i))
  const out: Vec3[][] = faces.map(() => [])
  for (const e of edges) {
    const pts: Vec3[] = []
    const p = e.polyline
    if (p.length >= 6) for (let i = 0; i + 2 < p.length; i += 3) pts.push([p[i], p[i + 1], p[i + 2]])
    else pts.push(e.ends[0], e.ends[1], e.fingerprint.mid)
    for (const h of new Set(e.faces)) {
      const i = index.get(h)
      if (i !== undefined) out[i].push(...pts)
    }
  }
  return out
}

/** The faces next to each face across an edge, by index. */
function neighbours(faces: readonly FaceInfo[], edges: readonly EdgeInfo[]): Set<number>[] {
  const index = new Map<number, number>()
  faces.forEach((f, i) => index.set(f.hash, i))
  const out = faces.map(() => new Set<number>())
  for (const e of edges) {
    const fs = [...new Set(e.faces)].map((h) => index.get(h)).filter((i): i is number => i !== undefined)
    for (const a of fs) for (const b of fs) if (a !== b) out[a].add(b)
  }
  return out
}

interface Box2 {
  lo: [number, number]
  hi: [number, number]
}

function box2(points: readonly Vec3[], u: Vec3, v: Vec3): Box2 | null {
  if (points.length === 0) return null
  const lo: [number, number] = [Infinity, Infinity]
  const hi: [number, number] = [-Infinity, -Infinity]
  for (const p of points) {
    const a = dot(p, u), b = dot(p, v)
    if (a < lo[0]) lo[0] = a
    if (a > hi[0]) hi[0] = a
    if (b < lo[1]) lo[1] = b
    if (b > hi[1]) hi[1] = b
  }
  return { lo, hi }
}

const boxesMeet = (a: Box2, b: Box2, margin: number) => a.lo[0] <= b.hi[0] + margin && b.lo[0] <= a.hi[0] + margin && a.lo[1] <= b.hi[1] + margin && b.lo[1] <= a.hi[1] + margin

/** Along an axis: where a face's points start and end. */
function span(points: readonly Vec3[], origin: Vec3, dir: Vec3): [number, number] | null {
  if (points.length === 0) return null
  let lo = Infinity, hi = -Infinity
  for (const p of points) {
    const t = dot(sub(p, origin), dir)
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  return [lo, hi]
}

/** A round face's radius along its axis (t from its axis point), and how
 *  fast it grows: a cylinder's own, a cone's as a line through its points.
 *  Null for a cone whose points do not say. */
function radiusAlong(fp: FaceFingerprint, points: readonly Vec3[]): { at: (t: number) => number; k: number } | null {
  if (fp.kind === 'cylinder' && fp.radius !== undefined) {
    const r = fp.radius
    return { at: () => r, k: 0 }
  }
  if (fp.kind !== 'cone' || !fp.center || points.length < 2) return null
  let n = 0, st = 0, sr = 0, stt = 0, str = 0
  for (const p of points) {
    const d = sub(p, fp.center)
    const t = dot(d, fp.dir)
    const r = len(sub(d, scale(fp.dir, t)))
    n++
    st += t
    sr += r
    stt += t * t
    str += t * r
  }
  const den = n * stt - st * st
  if (Math.abs(den) < 1e-12) return null
  const k = (n * str - st * sr) / den
  const r0 = (sr - k * st) / n
  return { at: (t) => r0 + k * t, k }
}

/** The surface a face lies on, as a key: a plane by its normal and its
 *  offset, a round by its axis line and radius — so the pieces of one
 *  surface share it. */
function surfaceKey(fp: FaceFingerprint): string {
  const r = (x: number, d = 3) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d)
  const v = (p: Vec3) => p.map((x) => r(x)).join(',')
  if (fp.kind === 'plane') return `p|${v(fp.dir)}|${r(dot(fp.centroid, fp.dir), 4)}`
  if ((fp.kind === 'cylinder' || fp.kind === 'cone') && fp.center) {
    const foot = sub(fp.center, scale(fp.dir, dot(fp.center, fp.dir)))
    return `${fp.kind}|${v(fp.dir)}|${v(foot)}|${fp.radius !== undefined ? r(fp.radius, 4) : ''}`
  }
  return `${fp.kind}|${v(fp.centroid)}`
}

const mid3 = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

/**
 * The steps among a body's faces: pairs of faces that lie a hair apart
 * where they meet and were likely meant as one. Two flat faces facing one
 * way (within parallelDeg) whose planes lie 1e-4 < gap ≤ stepMm apart and
 * whose extents meet across the plane; two round faces — cylinders, cones —
 * on axes within stepMm and parallelDeg of each other, at radii within
 * stepMm, which meet end to end along the axis; a round whose axis runs along
 * a flat face of another feature and one of whose straight edges along the
 * axis — where its profile starts — lies 1e-4 < d ≤ stepMm off that face,
 * within its extent, or whose side passes 1e-4 < d ≤ stepMm through it or
 * short of it there. A face no edge bounds is taken to meet every other.
 */
export function stepPairs(faces: readonly FaceInfo[], edges: readonly EdgeInfo[], options: StepOptions = {}): StepPair[] {
  const stepMm = options.stepMm ?? STEP_DEFAULTS.stepMm
  const parallelDeg = options.parallelDeg ?? STEP_DEFAULTS.parallelDeg
  const asked = options.pair ?? (() => true)
  const points = extentPoints(faces, edges)
  const next = neighbours(faces, edges)
  const out: StepPair[] = []
  // Faces a boolean left in pieces on one surface — a top in three, a
  // round split along its seam — are one step against another's, told
  // once.
  const told = new Set<string>()
  const keep = (p: StepPair) => {
    const [ka, kb] = p.faces.map((i) => `${faces[i].fingerprint.origin}|${surfaceKey(faces[i].fingerprint)}`)
    const key = `${p.form}|${ka < kb ? ka : kb}|${ka < kb ? kb : ka}`
    if (told.has(key)) return
    told.add(key)
    out.push(p)
  }
  const riserOf = (a: number, b: number): number | undefined => {
    let best: number | undefined
    for (const r of next[a]) if (next[b].has(r) && (best === undefined || faces[r].fingerprint.area < faces[best].fingerprint.area)) best = r
    return best
  }
  const edgesOf = faces.map((): EdgeInfo[] => [])
  {
    const index = new Map(faces.map((f, i) => [f.hash, i]))
    for (const e of edges) for (const h of new Set(e.faces)) {
      const i = index.get(h)
      if (i !== undefined) edgesOf[i].push(e)
    }
  }
  /** A round of one feature whose axis runs along a flat face of another:
   *  one of its straight edges along the axis — where its profile starts
   *  — lying a hair off the face (foot), or its side a hair through the
   *  face or short of it (tangent: meant to touch it, it crosses at a
   *  crease or stands off). Within the face's extent. */
  const nearFace = (ri: number, pi: number): StepPair | null => {
    const r = faces[ri].fingerprint, p = faces[pi].fingerprint
    if (r.kind !== 'cylinder' || p.kind !== 'plane' || r.origin === p.origin) return null
    if (Math.abs(dot(r.dir, p.dir)) > Math.sin((parallelDeg * Math.PI) / 180)) return null
    const [u, v] = basisOf(p.dir)
    const bp = box2(points[pi], u, v)
    const off = (q: Vec3) => dot(sub(q, p.centroid), p.dir)
    if (!faces[ri].fullTurn) {
      let best: { d: number; at: Vec3 } | null = null
      for (const e of edgesOf[ri]) {
        if (e.fingerprint.kind !== 'line' || leanDeg(e.fingerprint.dir, r.dir) > parallelDeg) continue
        const d = Math.abs(off(e.fingerprint.mid))
        if (!(d > SAME_MM && d <= stepMm)) continue
        const be = box2([e.ends[0], e.ends[1]], u, v)
        if (bp && be && !boxesMeet(bp, be, MEET_MM)) continue
        if (!best || d < best.d) best = { d, at: e.fingerprint.mid }
      }
      if (best) return { form: 'foot', faces: [ri, pi], off: best.d, at: best.at }
    }
    if (r.radius === undefined || !r.center) return null
    const h = Math.abs(off(r.center))
    const dip = Math.abs(h - r.radius)
    if (!(dip > SAME_MM && dip <= stepMm)) return null
    const near = points[ri].filter((q) => Math.abs(off(q)) <= stepMm + dip)
    if (points[ri].length > 0 && near.length === 0) return null
    const bn = box2(near, u, v)
    if (bp && bn && !boxesMeet(bp, bn, MEET_MM)) return null
    const at: Vec3 = near.length > 0 ? mid3(near.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.min(a[2], q[2])] as Vec3, near[0]), near.reduce((a, q) => [Math.max(a[0], q[0]), Math.max(a[1], q[1]), Math.max(a[2], q[2])] as Vec3, near[0])) : r.centroid
    return { form: 'tangent', faces: [ri, pi], off: dip, at, ...(h < r.radius ? { creaseDeg: (Math.acos(h / r.radius) * 180) / Math.PI } : {}) }
  }
  const where = (a: number, b: number, riser: number | undefined, meet: Vec3 | null): Vec3 => (riser !== undefined ? faces[riser].fingerprint.centroid : meet ?? mid3(faces[a].fingerprint.centroid, faces[b].fingerprint.centroid))

  for (let x = 0; x < faces.length; x++) {
    for (let y = x + 1; y < faces.length; y++) {
      const fa = faces[x], fb = faces[y]
      const a = fa.fingerprint, b = fb.fingerprint
      if (!asked(fa, fb)) continue
      if (a.kind === 'plane' && b.kind === 'plane') {
        if (facingDeg(a.dir, b.dir) > parallelDeg) continue
        const n = normalize([a.dir[0] + b.dir[0], a.dir[1] + b.dir[1], a.dir[2] + b.dir[2]]) ?? a.dir
        const gap = Math.abs(dot(sub(b.centroid, a.centroid), n))
        if (!(gap > SAME_MM && gap <= stepMm)) continue
        const [u, v] = basisOf(n)
        const ba = box2(points[x], u, v), bb = box2(points[y], u, v)
        if (ba && bb && !boxesMeet(ba, bb, MEET_MM)) continue
        // Where the two meet across the plane: the middle of their boxes'
        // overlap, at the height between them.
        let meet: Vec3 | null = null
        if (ba && bb) {
          const c = mid3(a.centroid, b.centroid)
          const cu = (Math.max(ba.lo[0], bb.lo[0]) + Math.min(ba.hi[0], bb.hi[0])) / 2 - dot(c, u)
          const cv = (Math.max(ba.lo[1], bb.lo[1]) + Math.min(ba.hi[1], bb.hi[1])) / 2 - dot(c, v)
          meet = [c[0] + u[0] * cu + v[0] * cv, c[1] + u[1] * cu + v[1] * cv, c[2] + u[2] * cu + v[2] * cv]
        }
        const riser = riserOf(x, y)
        keep({ form: 'flat', faces: [x, y], off: gap, at: where(x, y, riser, meet), ...(riser !== undefined ? { riser } : {}) })
        continue
      }
      const round = (k: string) => k === 'cylinder' || k === 'cone'
      if (round(a.kind) && round(b.kind) && a.kind === b.kind && a.center && b.center) {
        if (leanDeg(a.dir, b.dir) > parallelDeg) continue
        const axisOff = len(cross(sub(b.center, a.center), a.dir))
        if (axisOff > stepMm) continue
        // Along the axis the two meet end to end: one round drawn in two
        // sketches stacked. Two that overlap there stand side by side — a
        // tube's wall, a groove — and are two rounds.
        const sa = span(points[x], a.center, a.dir), sb = span(points[y], a.center, a.dir)
        const t = sa && sb ? (Math.max(sa[0], sb[0]) + Math.min(sa[1], sb[1])) / 2 : 0
        if (sa && sb && Math.abs(Math.max(sa[0], sb[0]) - Math.min(sa[1], sb[1])) > MEET_MM) continue
        const ra = radiusAlong(a, points[x]), rb = radiusAlong(b, points[y])
        if (!ra || !rb) continue
        // A cone's radius read where the two meet, each along its own axis.
        const s = Math.sign(dot(a.dir, b.dir)) || 1
        const tb = dot(sub(a.center, b.center), b.dir) + t * s
        const r1 = ra.at(t), r2 = rb.at(tb)
        const dr = Math.abs(r1 - r2)
        if (dr > stepMm || (dr <= SAME_MM && axisOff <= SAME_MM)) continue
        // Two cones: one slope as well.
        if ((Math.abs(Math.atan(ra.k) - Math.atan(rb.k * s)) * 180) / Math.PI > parallelDeg) continue
        const riser = riserOf(x, y)
        keep({ form: 'round', faces: [x, y], off: dr + axisOff, at: where(x, y, riser, null), ...(riser !== undefined ? { riser } : {}), radii: [r1, r2], axisOff })
        continue
      }
      // A round's foot, or its side, just off another feature's flat face.
      const hit = nearFace(x, y) ?? nearFace(y, x)
      if (hit) keep(hit)
    }
  }
  return out
}

/** A step as a build's row keeps it: the two faces as fingerprints — the
 *  feature's own first — since the body it was found on may not stand at
 *  the end of the build. */
export interface StepBetween {
  form: StepForm
  off: number
  at: Vec3
  faces: [FaceFingerprint, FaceFingerprint]
  radii?: [number, number]
  axisOff?: number
  creaseDeg?: number
}

/** The steps a join left between the faces it brought (`mine`) and the
 *  faces it found, the feature's own face first: the thinnest first, the
 *  hairlines after the rest. */
export function stepsOfJoin(faces: readonly FaceInfo[], edges: readonly EdgeInfo[], mine: (origin: number) => boolean): StepBetween[] {
  const pairs = stepPairs(faces, edges, { pair: (a, b) => mine(a.fingerprint.origin) !== mine(b.fingerprint.origin) })
  return pairs
    .map((p): StepBetween => {
      const [x, y] = mine(faces[p.faces[0]].fingerprint.origin) ? p.faces : [p.faces[1], p.faces[0]]
      const swapped = x !== p.faces[0]
      return {
        form: p.form,
        off: p.off,
        at: p.at,
        faces: [faces[x].fingerprint, faces[y].fingerprint],
        ...(p.radii ? { radii: swapped ? [p.radii[1], p.radii[0]] : p.radii } : {}),
        ...(p.axisOff !== undefined ? { axisOff: p.axisOff } : {}),
        ...(p.creaseDeg !== undefined ? { creaseDeg: p.creaseDeg } : {}),
      }
    })
    .sort((a, b) => Number(a.off < HAIR_MM) - Number(b.off < HAIR_MM) || a.off - b.off)
}

/** The steps that make a solid of their own and may join it to what they
 *  meet — after which the build tells the steps they left. A Combine's
 *  join is told as well (Builder.joinMakers). */
export const JOINING: ReadonlySet<string> = new Set(['extrude', 'revolve', 'extract', 'loft', 'sweep'])
