// SPDX-License-Identifier: AGPL-3.0-only
// A chain of regular teeth read for the design behind it — a Fresnel's
// rings on a section through its axis, a rack, a knurl, a ribbed face.
// Fitted piece by piece, teeth come out as dozens of short lines and arcs,
// broken where the scan rounds their tips; what was drawn is less: two
// envelopes the tips and the roots lie on, one pitch, and where in each
// tooth its steep side stands.
//
// The chain's trend comes first — the line or arc it follows overall — and
// each point's height off it. The tips and the roots are the extremes of
// that height, taken with a hysteresis of about a third of the teeth's
// depth so the scan's noise makes none; each is then set at the corner its
// two sides meet at, the middle of each side fitted as a line, for a scan
// rounds a sharp tip. The tips (crests: the extremes out of the material,
// where the cut says which side that is) and the roots (troughs) are fitted
// with an envelope each, a line or an arc. The pitch is the spacing that
// lays the corners on a regular comb, read along whichever measure keeps
// them most regular: the sheet's u or v — a Fresnel's rings stand at one
// radial pitch, which on a section through its axis is u — or along the
// trend, as a rack's teeth and a gear's do. The profile is that comb laid
// on the envelopes: each corner at its regular place, on its envelope.

import { fitCircle2d } from '../../../src/core/fit/circle2d'
import { FitError } from '../../../src/core/fit/errors'
import { solveLinear } from '../../../src/core/fit/linalg'
import { viewChain } from '../../../src/core/flat/grow'
import type { Vec2 } from '../../../src/core/flat/types'

/** A line or an arc the chain, its tips or its roots follow, and how its
 *  points sit on it (rms and worst, mm). A line runs through `point` along
 *  `dir`, its + u way. An arc's radiusSigma is the fit's own uncertainty
 *  in its radius, mm: a short arc of a large circle lays its points well
 *  for many radii, its centre moving with them. */
export type Envelope =
  | { kind: 'arc'; center: Vec2; radius: number; radiusSigma: number; rms: number; worst: number }
  | { kind: 'line'; point: Vec2; dir: Vec2; rms: number; worst: number }

/** What the pitch is measured along: the sheet's u or v, or the trend. */
export type PitchAlong = 'u' | 'v' | 'trend'

export type ToothCorner = 'crest' | 'trough'

export interface TeethRead {
  /** The line or arc the chain follows overall. */
  trend: Envelope
  /** The tips' envelope and the corners it was fitted to. */
  crests: Envelope & { corners: Vec2[] }
  /** The roots'. */
  troughs: Envelope & { corners: Vec2[] }
  /** How the crests were told from the troughs: by the material (the
   *  extremes out of it), or by side — away from the trend's centre, or
   *  on its left for a straight one — where the cut does not say. */
  crestsBy: 'material' | 'side'
  pitch: number
  along: PitchAlong
  /** How far the corners lie off the regular comb along the pitch, rms mm. */
  spread: number
  /** Along the pitch, from each crest to the next trough. */
  crestToTrough: number
  /** The shorter and the longer part of a tooth along the pitch. */
  riser: number
  facet: number
  /** How far each trough lies off the crests' envelope, mm. */
  depth: { mean: number; min: number; max: number }
  /** The profile: the corners in order along the pitch, each at its
   *  regular place on its envelope — and what each is. */
  profile: Vec2[]
  kinds: ToothCorner[]
  /** The pitch measure of the profile's first corner. */
  start: number
  /** How the chain's points between the profile's ends sit on it. */
  fit: { points: number; rms: number; worst: number }
}

export interface TeethOptions {
  /** Each point's way out of the material, where the cut says. */
  outward?: readonly (Vec2 | undefined)[]
}

/** At least this many crests and troughs make a chain of teeth. */
const TEETH_MIN = 3

/** An extreme must stand this share of the teeth's depth (the heights'
 *  10–90 % spread) past the last one, and this many of the chain's
 *  scatters at least, to count. */
const HYSTERESIS = 0.35

const NOISE_STEPS = 4

/** The share of each side left out at its corners before its middle is
 *  fitted as a line: where the scan rounds the tip. */
const SIDE_TRIM = 0.2

/** An arc is taken for a trend or an envelope where its rms is under this
 *  share of a line's, and its radius under this. */
const ARC_GAIN = 0.5

const ARC_RADIUS_MAX = 1e5

/** Two sides meeting more nearly parallel than this make no corner. */
const CORNER_SIN = Math.sin((5 * Math.PI) / 180)

/** A measure along a curved trend is taken over u or v only where it
 *  keeps the corners this much more regular. */
const ALONG_GAIN = 0.8

/** The best line through points (total least squares), with how they sit
 *  on it; its direction runs + u (or + v, square to u). Null for fewer
 *  than two distinct points. */
function lineThrough(points: readonly Vec2[]): { point: Vec2; dir: Vec2; rms: number; worst: number } | null {
  const n = points.length
  if (n < 2) return null
  let mx = 0, my = 0
  for (const p of points) {
    mx += p[0] / n
    my += p[1] / n
  }
  let sxx = 0, sxy = 0, syy = 0
  for (const p of points) {
    const x = p[0] - mx
    const y = p[1] - my
    sxx += x * x
    sxy += x * y
    syy += y * y
  }
  if (!(sxx + syy > 0)) return null
  const t = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let dir: Vec2 = [Math.cos(t), Math.sin(t)]
  if (dir[0] < -1e-12 || (Math.abs(dir[0]) <= 1e-12 && dir[1] < 0)) dir = [-dir[0], -dir[1]]
  let ss = 0, worst = 0
  for (const p of points) {
    const d = Math.abs(dir[0] * (p[1] - my) - dir[1] * (p[0] - mx))
    ss += d * d
    worst = Math.max(worst, d)
  }
  return { point: [mx, my], dir, rms: Math.sqrt(ss / n), worst }
}

/** The line or arc points follow: an arc where it fits them well past a
 *  line (ARC_GAIN), a line otherwise. */
export function envelopeOf(points: readonly Vec2[]): Envelope {
  const line = lineThrough(points)
  if (!line) throw new FitError('The points coincide — they make no line or arc.')
  const c = points.length >= 4 ? fitCircle2d(points.map((p) => p[0]), points.map((p) => p[1])) : null
  if (c && Number.isFinite(c.r) && c.r < ARC_RADIUS_MAX) {
    let ss = 0, worst = 0
    for (const p of points) {
      const d = Math.abs(Math.hypot(p[0] - c.cu, p[1] - c.cv) - c.r)
      ss += d * d
      worst = Math.max(worst, d)
    }
    const rms = Math.sqrt(ss / points.length)
    if (rms < ARC_GAIN * line.rms) return { kind: 'arc', center: [c.cu, c.cv], radius: c.r, radiusSigma: radiusSigmaOf(points, [c.cu, c.cv], rms), rms, worst }
  }
  return { kind: 'line', ...line }
}

/** The standard error of a fitted circle's radius: from the fit's
 *  Jacobian in its centre and radius, the points' scatter about it taken
 *  as their noise. */
function radiusSigmaOf(points: readonly Vec2[], center: Vec2, rms: number): number {
  const n = points.length
  if (n <= 3) return Infinity
  const jtj = new Float64Array(9)
  for (const p of points) {
    const d = Math.hypot(p[0] - center[0], p[1] - center[1]) || 1
    const row = [-(p[0] - center[0]) / d, -(p[1] - center[1]) / d, -1]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) jtj[a * 3 + b] += row[a] * row[b]
  }
  const col = solveLinear(3, jtj, new Float64Array([0, 0, 1]))
  if (!col || !(col[2] > 0)) return Infinity
  return rms * Math.sqrt(n / (n - 3)) * Math.sqrt(col[2])
}

/** How far a point lies off an envelope, signed: out from an arc's centre,
 *  to the left of a line's direction. */
export function offEnvelope(e: Envelope, p: Vec2): number {
  if (e.kind === 'arc') return Math.hypot(p[0] - e.center[0], p[1] - e.center[1]) - e.radius
  return e.dir[0] * (p[1] - e.point[1]) - e.dir[1] * (p[0] - e.point[0])
}

/** The way a point's height off an envelope counts positive. */
function upFrom(e: Envelope, p: Vec2): Vec2 {
  if (e.kind === 'line') return [-e.dir[1], e.dir[0]]
  const d = Math.hypot(p[0] - e.center[0], p[1] - e.center[1]) || 1
  return [(p[0] - e.center[0]) / d, (p[1] - e.center[1]) / d]
}

/** Where along a trend a point lies, mm: along a line from its point, round
 *  an arc counter-clockwise, the angle unwound near `near` (radians). */
function alongTrend(e: Envelope, p: Vec2, near = 0): { s: number; angle: number } {
  if (e.kind === 'line') return { s: e.dir[0] * (p[0] - e.point[0]) + e.dir[1] * (p[1] - e.point[1]), angle: 0 }
  let a = Math.atan2(p[1] - e.center[1], p[0] - e.center[0])
  while (a - near > Math.PI) a -= 2 * Math.PI
  while (a - near < -Math.PI) a += 2 * Math.PI
  return { s: e.radius * a, angle: a }
}

/** Where two lines cross, as a point; null for lines near parallel. */
function crossing(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0]
  if (Math.abs(den) < CORNER_SIN) return null
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
  return [p[0] + t * d[0], p[1] + t * d[1]]
}

/** Where a line through `p` along the unit `d` meets an envelope, the
 *  crossing nearest `near`; null where it misses it. */
function onEnvelope(e: Envelope, p: Vec2, d: Vec2, near: Vec2): Vec2 | null {
  if (e.kind === 'line') return crossing(p, d, e.point, e.dir)
  const w: Vec2 = [p[0] - e.center[0], p[1] - e.center[1]]
  const b = d[0] * w[0] + d[1] * w[1]
  const disc = b * b - (w[0] * w[0] + w[1] * w[1] - e.radius * e.radius)
  if (disc < 0) return null
  const hits = [-b - Math.sqrt(disc), -b + Math.sqrt(disc)].map((t): Vec2 => [p[0] + t * d[0], p[1] + t * d[1]])
  const far = (q: Vec2) => Math.hypot(q[0] - near[0], q[1] - near[1])
  return far(hits[0]) <= far(hits[1]) ? hits[0] : hits[1]
}

/** The tooth's corner at an extreme: where the lines through the middles
 *  of its two sides cross, or the extreme itself where they make none
 *  near it. */
function cornerAt(chain: readonly Vec2[], before: number, at: number, after: number): Vec2 {
  const side = (from: number, to: number, trimFrom: boolean, trimTo: boolean) => {
    const n = to - from
    const a = from + (trimFrom ? Math.ceil(SIDE_TRIM * n) : 0)
    const b = to - (trimTo ? Math.ceil(SIDE_TRIM * n) : 0)
    return lineThrough(chain.slice(a, b + 1))
  }
  const left = side(before, at, before > 0, true)
  const right = side(at, after, true, after < chain.length - 1)
  const p = chain[at]
  if (!left || !right) return p
  const q = crossing(left.point, left.dir, right.point, right.dir)
  if (!q) return p
  // A corner the sides make far from the extreme is no corner of it.
  const reach = 0.5 * Math.min(Math.hypot(chain[at][0] - chain[before][0], chain[at][1] - chain[before][1]), Math.hypot(chain[after][0] - chain[at][0], chain[after][1] - chain[at][1]))
  return Math.hypot(q[0] - p[0], q[1] - p[1]) <= reach ? q : p
}

/** The share at `f` of sorted values. */
const quantile = (sorted: readonly number[], f: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))]

/** The distance from a point to a polyline. */
function offPolyline(line: readonly Vec2[], p: Vec2): number {
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]
    const b = line[i + 1]
    const ab: Vec2 = [b[0] - a[0], b[1] - a[1]]
    const l2 = ab[0] * ab[0] + ab[1] * ab[1]
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]))
  }
  return best
}

/**
 * A chain of regular teeth read as its crests, troughs, envelopes and pitch,
 * and the regular profile they make — see the head of this file. Throws
 * where the chain has fewer than three crests and three troughs about its
 * trend.
 */
export function readTeeth(chain0: readonly Vec2[], opts: TeethOptions = {}): TeethRead {
  const closed = chain0.length > 2 && chain0[0][0] === chain0[chain0.length - 1][0] && chain0[0][1] === chain0[chain0.length - 1][1]
  const chain = closed ? chain0.slice(0, -1) : chain0
  const n = chain.length
  if (n < 4 * TEETH_MIN) throw new FitError(`The chain has ${n} points — too few for teeth.`)
  const trend = envelopeOf(chain)

  // Each point's height off the trend, crests positive: out of the
  // material where the cut says which way that is.
  let toward = 0
  let told = 0
  const out = opts.outward
  if (out) {
    chain.forEach((p, i) => {
      const o = out[i]
      if (!o) return
      const up = upFrom(trend, p)
      toward += o[0] * up[0] + o[1] * up[1]
      told++
    })
  }
  const byMaterial = told > 0 && Math.abs(toward / told) > 0.05
  const sign = byMaterial && toward < 0 ? -1 : 1
  const g = chain.map((p) => sign * offEnvelope(trend, p))

  // The extremes, with a hysteresis of a third of the depth.
  const sorted = [...g].sort((a, b) => a - b)
  const depth = quantile(sorted, 0.9) - quantile(sorted, 0.1)
  const delta = Math.max(HYSTERESIS * depth, NOISE_STEPS * viewChain(chain).scatter)
  const found: { i: number; kind: ToothCorner }[] = []
  let mode = 0
  let hi = 0
  let lo = 0
  for (let i = 1; i < n; i++) {
    if (mode === 0) {
      if (g[i] > g[hi]) hi = i
      if (g[i] < g[lo]) lo = i
      if (g[hi] - g[lo] > delta) {
        if (hi > lo) {
          found.push({ i: lo, kind: 'trough' })
          mode = 1
        } else {
          found.push({ i: hi, kind: 'crest' })
          mode = -1
        }
      }
    } else if (mode === 1) {
      if (g[i] > g[hi]) hi = i
      else if (g[i] < g[hi] - delta) {
        found.push({ i: hi, kind: 'crest' })
        mode = -1
        lo = i
      }
    } else {
      if (g[i] < g[lo]) lo = i
      else if (g[i] > g[lo] + delta) {
        found.push({ i: lo, kind: 'trough' })
        mode = 1
        hi = i
      }
    }
  }
  // An end of the chain is no corner.
  const ext = found.filter((e) => e.i > 1 && e.i < n - 2)
  const crestCount = ext.filter((e) => e.kind === 'crest').length
  const troughCount = ext.length - crestCount
  if (crestCount < TEETH_MIN || troughCount < TEETH_MIN) {
    throw new FitError(`Only ${crestCount} crests and ${troughCount} troughs stand out of the chain’s trend — teeth take ${TEETH_MIN} of each at least; give within round one band of teeth.`)
  }

  // Each at the corner its sides meet at.
  const corners = ext.map((e, k) => ({ ...e, at: cornerAt(chain, k > 0 ? ext[k - 1].i : 0, e.i, k + 1 < ext.length ? ext[k + 1].i : n - 1) }))
  const crestEnv = envelopeOf(corners.filter((c) => c.kind === 'crest').map((c) => c.at))
  const troughEnv = envelopeOf(corners.filter((c) => c.kind === 'trough').map((c) => c.at))

  // The measure along the trend at each corner, unwound along the chain —
  // along the crests' envelope where it is the trend's kind: the tips lay
  // the pitch line truer than the chain's lopsided teeth do.
  const pitchLine = crestEnv.kind === trend.kind ? crestEnv : trend
  let near = alongTrend(pitchLine, chain[0]).angle
  const angleAt: number[] = []
  for (const p of chain) {
    near = alongTrend(pitchLine, p, near).angle
    angleAt.push(near)
  }
  const measures: { along: PitchAlong; s: (c: (typeof corners)[number]) => number }[] = [{ along: 'trend', s: (c) => alongTrend(pitchLine, c.at, angleAt[c.i]).s }]
  if (trend.kind === 'arc') measures.push({ along: 'u', s: (c) => c.at[0] }, { along: 'v', s: (c) => c.at[1] })

  // The regular comb along each measure: crest k at a + k·p, the trough
  // after it at a + r + k·p, least squares.
  const combs = measures.map((m) => {
    const order = corners.map((c) => ({ c, s: m.s(c) })).sort((a, b) => a.s - b.s)
    let k = order[0].c.kind === 'crest' ? 0 : -1
    const rows = order.map((o, j) => {
      if (j > 0 && o.c.kind === 'crest') k++
      return { o, k }
    })
    const ata = new Float64Array(9)
    const atb = new Float64Array(3)
    for (const { o, k: kk } of rows) {
      const row = [1, o.c.kind === 'trough' ? 1 : 0, kk]
      for (let a = 0; a < 3; a++) {
        atb[a] += row[a] * o.s
        for (let b = 0; b < 3; b++) ata[a * 3 + b] += row[a] * row[b]
      }
    }
    const x = solveLinear(3, ata, atb)
    if (!x || !(x[2] > 0)) return null
    const [a0, r, p] = x
    const place = (kind: ToothCorner, kk: number) => a0 + kk * p + (kind === 'trough' ? r : 0)
    let ss = 0
    for (const { o, k: kk } of rows) ss += (o.s - place(o.c.kind, kk)) ** 2
    const spread = Math.sqrt(ss / rows.length)
    return { along: m.along, rows, p, r, place, spread, irregular: spread / p }
  })
  const fits = combs.filter((c): c is NonNullable<typeof c> => c !== null)
  if (fits.length === 0) throw new FitError('The crests and troughs make no regular comb along the chain.')
  // Along the trend, unless u or v keeps the corners clearly more regular.
  const alongTrendComb = fits.find((c) => c.along === 'trend')
  const best = fits.reduce((a, b) => (b.irregular < a.irregular ? b : a))
  const comb = alongTrendComb && best !== alongTrendComb && !(best.irregular < ALONG_GAIN * alongTrendComb.irregular) ? alongTrendComb : best

  // The profile: each corner at its regular place, on its envelope — where
  // the line square to the measure there meets it.
  const station = (s: number): { p: Vec2; d: Vec2 } => {
    if (comb.along === 'u') return { p: [s, 0], d: [0, 1] }
    if (comb.along === 'v') return { p: [0, s], d: [1, 0] }
    if (pitchLine.kind === 'line') return { p: [pitchLine.point[0] + s * pitchLine.dir[0], pitchLine.point[1] + s * pitchLine.dir[1]], d: [-pitchLine.dir[1], pitchLine.dir[0]] }
    const a = s / pitchLine.radius
    return { p: pitchLine.center, d: [Math.cos(a), Math.sin(a)] }
  }
  const profile: Vec2[] = []
  const kinds: ToothCorner[] = []
  for (const { o, k } of comb.rows) {
    const { p, d } = station(comb.place(o.c.kind, k))
    profile.push(onEnvelope(o.c.kind === 'crest' ? crestEnv : troughEnv, p, d, o.c.at) ?? o.c.at)
    kinds.push(o.c.kind)
  }

  const troughsOff = corners.filter((c) => c.kind === 'trough').map((c) => Math.abs(offEnvelope(crestEnv, c.at)))
  const r = ((comb.r % comb.p) + comb.p) % comb.p
  // The chain's points between the profile's first and last corner.
  const from = Math.min(...ext.map((e) => e.i))
  const to = Math.max(...ext.map((e) => e.i))
  let ss = 0
  let worst = 0
  for (let i = from; i <= to; i++) {
    const d = offPolyline(profile, chain[i])
    ss += d * d
    worst = Math.max(worst, d)
  }
  return {
    trend,
    crests: { ...crestEnv, corners: corners.filter((c) => c.kind === 'crest').map((c) => c.at) },
    troughs: { ...troughEnv, corners: corners.filter((c) => c.kind === 'trough').map((c) => c.at) },
    crestsBy: byMaterial ? 'material' : 'side',
    pitch: comb.p,
    along: comb.along,
    spread: comb.spread,
    crestToTrough: r,
    riser: Math.min(r, comb.p - r),
    facet: Math.max(r, comb.p - r),
    depth: { mean: troughsOff.reduce((a, b) => a + b, 0) / troughsOff.length, min: Math.min(...troughsOff), max: Math.max(...troughsOff) },
    profile,
    kinds,
    start: comb.place(comb.rows[0].o.c.kind, comb.rows[0].k),
    fit: { points: to - from + 1, rms: Math.sqrt(ss / (to - from + 1)), worst },
  }
}
