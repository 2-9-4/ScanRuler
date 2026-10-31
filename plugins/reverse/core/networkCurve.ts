// SPDX-License-Identifier: AGPL-3.0-only
// A curve of a patch network: its trace along the scan and the smooth curve
// fitted to it.
//
// The trace is the scan path (src/core/geometry/scanPath) between each
// two of the curve's points in turn — its end node, its grips, its other
// end node — so it lies on the scan and follows its noise. The curve is a
// clamped cubic B-spline with uniform knots (networkSpline.ts), fitted to
// the trace by least squares at its arc-length parameter: through its two
// ends exactly — the nodes, which the curves meeting there share — and kept
// fair by a slight term on the poles' second differences, which holds a span
// with no points in it between its neighbours; in a network, its smoothness
// fairs the curve as well (fitCurve's `fairing`). Where the
// curve goes on smoothly into another at a node (a regular node, PN8), the
// end's tangent is given and its second pole held on that line, so the two
// meet tangent.
//
// Its span count is its strip's (networkFit.ts, whose Auto starts every
// strip at four and grows it where a patch misses the scan). A curve that
// is no cell's whole side takes `autoSpans`: the trace's length over eight
// times the scan's scatter along it, between 2 and 20 — the rule Fit
// Surface sizes its net by. The scatter is read off a pilot fit's
// residual, as Fit Surface reads it: what six spans cannot follow is
// noise, or a shape that wants more spans.

import { choleskySolve, solveLinear } from '../../../src/core/fit/linalg'
import { type ScanPath, type ScanPaths, tracePath } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import { basisAt, curveDerivative, curvePoint, DEGREE, dividedWeights, grevilleOf } from './networkSpline'

/** The fewest and most spans a curve, a strip, takes. */
export const SPANS_MIN = 2
export const SPANS_MAX = 20
/** How far Auto lets a patch stray from the scan beyond its noise before
 *  its strips get more spans, where a network gives no tolerance, mm
 *  (networkFit). */
export const DEFAULT_TOLERANCE = 0.01
/** The pilot fit's spans, for Auto's scatter. */
const PILOT_SPANS = 6
/** The fairing term's weight per pole, as a share of the data's. A circle's
 *  poles have second differences of millimetres, so the term bends any arc
 *  inward: at 1e-3 it took a 270° arc of 20 mm radius 19 µm in at eight
 *  spans; at 1e-6, under a tenth of a micron. A span no point falls in is
 *  still held between its neighbours. */
const FAIRING = 1e-6
/** The scatter Auto never reads below, mm. */
const SCATTER_FLOOR = 1e-3
/** The rounds of parameter correction a curve's fit takes. */
const CURVE_ROUNDS = 0

/** A curve's trace: the scan paths between its points, end to end. */
export interface CurveTrace {
  /** x, y, z per point. */
  points: Float32Array
  /** Where each point lies on the mesh, two numbers a point (ScanPath.on). */
  on: Int32Array
  /** The arc length at each point from the start, mm. */
  at: Float64Array
  length: number
  /** Where each of the curve's own points is in `points`: the first end,
   *  the grips, the other end. */
  grips: number[]
  /** The runs between the points, each a section or the edges' fallback,
   *  with the triangles their ends lie in. */
  runs: { way: ScanPath['way']; from: number; to: number; ends: [number, number] }[]
}

/** The trace through `points`, each taken to the scan, in order. */
export function traceCurve(scan: ScanPaths, points: readonly Vec3[]): CurveTrace {
  const xyz: number[] = []
  const on: number[] = []
  const grips: number[] = []
  const runs: CurveTrace['runs'] = []
  for (let k = 0; k + 1 < points.length; k++) {
    const path = tracePath(scan, points[k], points[k + 1])
    const n = path.points.length / 3
    if (n === 0) continue
    // Each run starts where the last ended: its first point is dropped.
    const skip = xyz.length > 0 ? 1 : 0
    const from = xyz.length / 3 - skip
    if (skip === 0) grips.push(0)
    for (let i = skip; i < n; i++) {
      xyz.push(path.points[i * 3], path.points[i * 3 + 1], path.points[i * 3 + 2])
      on.push(path.on[i * 2], path.on[i * 2 + 1])
    }
    grips.push(xyz.length / 3 - 1)
    runs.push({ way: path.way, from, to: xyz.length / 3 - 1, ends: path.ends })
  }
  if (xyz.length === 0 && points.length > 0) {
    const c = scan.closest(points[0])
    if (c) {
      xyz.push(...c.point)
      on.push(-1, c.triangle)
      grips.push(0)
    }
  }
  const count = xyz.length / 3
  const at = new Float64Array(count)
  for (let i = 1; i < count; i++) at[i] = at[i - 1] + Math.hypot(xyz[i * 3] - xyz[i * 3 - 3], xyz[i * 3 + 1] - xyz[i * 3 - 2], xyz[i * 3 + 2] - xyz[i * 3 - 1])
  return { points: Float32Array.from(xyz), on: Int32Array.from(on), at, length: count > 0 ? at[count - 1] : 0, grips, runs }
}

/** A curve fitted to a trace. */
export interface CurveFit {
  spans: number
  /** spans + 3 poles, x, y, z each. */
  poles: Float64Array
  /** The trace's distances from the curve at their parameters, mm. */
  rms: number
  max: number
}

/** What a fit holds besides its data: the tangent at either end, a unit
 *  direction pointing along the curve, from the start and into the end. */
export interface CurveEnds {
  startTangent?: Vec3
  endTangent?: Vec3
}

/** The points a curve is fitted to: a trace, or any polyline with its arc
 *  length. */
export type CurvePoints = Pick<CurveTrace, 'points' | 'at' | 'length'>

/** The clamped cubic of `spans` spans through the trace's two ends, fitted
 *  to the rest of it — see above. `fairing` is a network's smoothness on
 *  the curve (networkFit): the weight of ∫ |C‴|² ds against the points,
 *  mm⁵ — the third derivative, as a patch's, which bends a curve's arc
 *  less than the second would. */
export function fitCurve(trace: CurvePoints, spans: number, ends: CurveEnds = {}, fairing = 0): CurveFit {
  const count = trace.points.length / 3
  const n = Math.max(SPANS_MIN, Math.round(spans)) + DEGREE
  const s = n - DEGREE
  const length = trace.length > 0 ? trace.length : 1
  const first: Vec3 = count > 0 ? [trace.points[0], trace.points[1], trace.points[2]] : [0, 0, 0]
  const last: Vec3 = count > 0 ? [trace.points[(count - 1) * 3], trace.points[(count - 1) * 3 + 1], trace.points[(count - 1) * 3 + 2]] : first
  // Each pole coordinate as a constant and at most one unknown: the ends
  // fixed, a held end's second pole the end plus a free distance along its
  // tangent, the rest free.
  const base = new Float64Array(n * 3)
  const unknown = new Int32Array(n * 3).fill(-1)
  const coef = new Float64Array(n * 3)
  let k = 0
  for (let c = 0; c < 3; c++) {
    base[c] = first[c]
    base[(n - 1) * 3 + c] = last[c]
  }
  const startHeld = ends.startTangent ? k++ : -1
  const endHeld = ends.endTangent ? k++ : -1
  for (let i = 1; i < n - 1; i++) {
    for (let c = 0; c < 3; c++) {
      const at = i * 3 + c
      if (i === 1 && ends.startTangent) {
        base[at] = first[c]
        unknown[at] = startHeld
        coef[at] = ends.startTangent[c]
      } else if (i === n - 2 && ends.endTangent) {
        base[at] = last[c]
        unknown[at] = endHeld
        coef[at] = -ends.endTangent[c]
      } else {
        unknown[at] = k++
        coef[at] = 1
      }
    }
  }
  /** The poles fitted with the points at parameters t. */
  const solveAt = (t: Float64Array): { poles: Float64Array; z: Float64Array } => {
    const ata = new Float64Array(k * k)
    const atb = new Float64Array(k)
    /** A row Σ w[m] · pole(idx[m], c) = rhs, weighted by `weight`. */
    const rowIdx: number[] = []
    const rowW: number[] = []
    const addRow = (c: number, rhs: number, weight: number) => {
      let r = rhs
      const zs: number[] = []
      const ws: number[] = []
      for (let m = 0; m < rowIdx.length; m++) {
        const at = rowIdx[m] * 3 + c
        r -= rowW[m] * base[at]
        if (unknown[at] >= 0) {
          zs.push(unknown[at])
          ws.push(rowW[m] * coef[at])
        }
      }
      for (let a = 0; a < zs.length; a++) {
        atb[zs[a]] += weight * ws[a] * r
        for (let b = 0; b < zs.length; b++) ata[zs[a] * k + zs[b]] += weight * ws[a] * ws[b]
      }
    }
    const basis = new Float64Array(4)
    for (let p = 0; p < count; p++) {
      const span = basisAt(s, t[p], basis)
      rowIdx.length = 0
      rowW.length = 0
      for (let i = 0; i <= DEGREE; i++) {
        rowIdx.push(span - DEGREE + i)
        rowW.push(basis[i])
      }
      for (let c = 0; c < 3; c++) addRow(c, trace.points[p * 3 + c], 1)
    }
    // The fairing: each pole's second difference, weighed as a share of the
    // points a pole carries.
    const fair = FAIRING * Math.max(1, count / n)
    for (let i = 1; i < n - 1; i++) {
      rowIdx.length = 0
      rowW.length = 0
      rowIdx.push(i - 1, i, i + 1)
      rowW.push(1, -2, 1)
      for (let c = 0; c < 3; c++) addRow(c, 0, fair)
    }
    // The smoothness: third divided differences over the Greville
    // abscissae, each over its share of the curve — in [0, 1] a third
    // derivative stands for one along the curve times its length cubed.
    if (fairing > 0) {
      const g = grevilleOf(s)
      const weight = fairing / ((n - 1) * length ** 5)
      for (let i = 0; i + 3 < n; i++) {
        rowIdx.length = 0
        rowW.length = 0
        const w = dividedWeights(g, i, 3)
        for (let m = 0; m <= 3; m++) {
          rowIdx.push(i + m)
          rowW.push(w[m])
        }
        for (let c = 0; c < 3; c++) addRow(c, 0, weight)
      }
    }
    let diag = 0
    for (let i = 0; i < k; i++) diag += ata[i * k + i]
    for (let i = 0; i < k; i++) ata[i * k + i] += 1e-12 * Math.max(diag / Math.max(1, k), 1e-12)
    const z = choleskySolve(k, ata, atb) ?? solveLinear(k, Float64Array.from(ata), Float64Array.from(atb)) ?? new Float64Array(k)
    const poles = new Float64Array(n * 3)
    for (let at = 0; at < n * 3; at++) poles[at] = base[at] + (unknown[at] >= 0 ? coef[at] * z[unknown[at]] : 0)
    return { poles, z }
  }
  // The points start at their arc length's share; after each fit every one
  // but the ends is taken to the parameter of its nearest point on the
  // curve (Gauss–Newton), and the curve fitted again. A uniform cubic does
  // not run at even speed — round a circle its clamped ends run slower —
  // and held to the arc length it bends off the points to keep up: 19 µm
  // off a 270° arc of 20 mm radius at eight spans. Two rounds take that
  // to under a micron.
  const t = new Float64Array(count)
  for (let p = 0; p < count; p++) t[p] = trace.at[p] / length
  let solved = solveAt(t)
  for (let round = 0; round < CURVE_ROUNDS; round++) {
    projectOnto(solved.poles, s, trace.points, t)
    solved = solveAt(t)
  }
  const { poles, z } = solved
  // A held end's pole the wrong side of the end — the tangent given the
  // wrong way, or a curve too short for it — falls back to the free fit.
  const startWrong = startHeld >= 0 && z[startHeld] < 0
  const endWrong = endHeld >= 0 && z[endHeld] < 0
  if (startWrong || endWrong) return fitCurve(trace, spans, { startTangent: startWrong ? undefined : ends.startTangent, endTangent: endWrong ? undefined : ends.endTangent }, fairing)
  projectOnto(poles, s, trace.points, t)
  const fit = { spans: s, poles, rms: 0, max: 0 }
  const q: Vec3 = [0, 0, 0]
  let sq = 0
  for (let p = 0; p < count; p++) {
    curvePoint(poles, s, t[p], q)
    const d = Math.hypot(q[0] - trace.points[p * 3], q[1] - trace.points[p * 3 + 1], q[2] - trace.points[p * 3 + 2])
    sq += d * d
    if (d > fit.max) fit.max = d
  }
  fit.rms = count > 0 ? Math.sqrt(sq / count) : 0
  return fit
}

/** Each point but the two ends taken to the parameter of its nearest point
 *  on the curve: a few Gauss–Newton steps from where it was, in [0, 1]. */
function projectOnto(poles: Float64Array, spans: number, points: ArrayLike<number>, t: Float64Array): void {
  const q: Vec3 = [0, 0, 0]
  const d: Vec3 = [0, 0, 0]
  for (let p = 1; p < t.length - 1; p++) {
    let tt = t[p]
    for (let step = 0; step < 3; step++) {
      curvePoint(poles, spans, tt, q)
      curveDerivative(poles, spans, tt, d)
      const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
      if (!(dd > 0)) break
      const g = (points[p * 3] - q[0]) * d[0] + (points[p * 3 + 1] - q[1]) * d[1] + (points[p * 3 + 2] - q[2]) * d[2]
      tt = Math.min(1, Math.max(0, tt + g / dd))
    }
    t[p] = tt
  }
}

/** Auto's span count for a trace: its length over eight times its scatter
 *  (a pilot fit's RMS), between SPANS_MIN and SPANS_MAX. */
export function autoSpans(trace: CurvePoints): number {
  if (trace.length <= 0) return SPANS_MIN
  const scatter = fitCurve(trace, PILOT_SPANS).rms
  return Math.max(SPANS_MIN, Math.min(SPANS_MAX, Math.round(trace.length / (8 * Math.max(scatter, SCATTER_FLOOR)))))
}

/** The provisional fit's span a this many of the scan's edges along the
 *  trace (fitProvisional). */
const PROVISIONAL_EDGES = 6

/** A curve fitted for the directions it leaves its ends by — what orders
 *  the curves round a node and pairs those going straight on through it —
 *  before its strip says its spans: Auto, but no finer than a span every
 *  PROVISIONAL_EDGES of the scan's edges (`spacing`, mm). A trace has a
 *  point or two an edge, and a span with fewer than a handful of them
 *  leaves its end's tangent to the noise: a 20 mm spoke on a 1.1 mm mesh
 *  at Auto's 20 spans left its centre 9° out of the surface. */
export function fitProvisional(trace: CurvePoints, spacing: number): CurveFit {
  const dense = spacing > 0 ? Math.max(SPANS_MIN, Math.floor(trace.length / (PROVISIONAL_EDGES * spacing))) : SPANS_MAX
  return fitCurve(trace, Math.min(autoSpans(trace), dense))
}

/** How far along a trace the way it leaves an end is read: this many of
 *  the scan's edges, and never more than this share of the trace. */
const LEAVING_EDGES = 10
const LEAVING_SHARE = 0.3

/** The way a trace leaves its first end (0) or its last (1), a unit
 *  vector pointing along it away from the end: a quadratic through the end
 *  fitted by least squares to the points within LEAVING_EDGES of the
 *  scan's edges (`spacing`, mm) — at least 2 mm — of it. A fitted curve's
 *  own end tangent is read off its first span alone, a few noisy points at
 *  Auto's spans: the four curves meeting a 30° crease's two ends came out
 *  at 10° and 20° where the scan's halves stand at 15°, and the patches'
 *  corners twisted the fold from 26° to 35° along the crease. */
export function leavingDirection(trace: CurvePoints, end: 0 | 1, spacing: number): Vec3 {
  const n = trace.points.length / 3
  if (n < 2) return [1, 0, 0]
  const reach = Math.min(Math.max(LEAVING_EDGES * spacing, 2), LEAVING_SHARE * trace.length)
  const i0 = end === 0 ? 0 : n - 1
  const step = end === 0 ? 1 : -1
  const p0: Vec3 = [trace.points[i0 * 3], trace.points[i0 * 3 + 1], trace.points[i0 * 3 + 2]]
  // Σ over the points of (s, s²) against their offsets from the end.
  let ss = 0, s3 = 0, s4 = 0
  const b1: Vec3 = [0, 0, 0]
  const b2: Vec3 = [0, 0, 0]
  let used = 0
  for (let i = i0 + step; i >= 0 && i < n; i += step) {
    const s = Math.abs(trace.at[i] - trace.at[i0])
    if (s > reach && used >= 2) break
    if (!(s > 0)) continue
    for (let k = 0; k < 3; k++) {
      const d = trace.points[i * 3 + k] - p0[k]
      b1[k] += s * d
      b2[k] += s * s * d
    }
    ss += s * s
    s3 += s * s * s
    s4 += s * s * s * s
    used++
  }
  const det = ss * s4 - s3 * s3
  const dir: Vec3 = [0, 0, 0]
  for (let k = 0; k < 3; k++) dir[k] = det > 1e-18 * Math.max(1, ss * s4) ? (b1[k] * s4 - b2[k] * s3) / det : ss > 0 ? b1[k] / ss : 0
  const l = Math.hypot(dir[0], dir[1], dir[2])
  if (!(l > 0)) {
    const q = end === 0 ? 1 : n - 2
    const d: Vec3 = [trace.points[q * 3] - p0[0], trace.points[q * 3 + 1] - p0[1], trace.points[q * 3 + 2] - p0[2]]
    const ld = Math.hypot(...d) || 1
    return [d[0] / ld, d[1] / ld, d[2] / ld]
  }
  return [dir[0] / l, dir[1] / l, dir[2] / l]
}

/** The unit tangent of a fitted curve at its start (t = 0, along it) or
 *  its end (t = 1, into it). */
export function endTangent(fit: CurveFit, end: 0 | 1): Vec3 {
  const d = curveDerivative(fit.poles, fit.spans, end)
  const l = Math.hypot(d[0], d[1], d[2]) || 1
  return [d[0] / l, d[1] / l, d[2] / l]
}

/** The fitted curve sampled at `count` evenly spaced parameters, flat. */
export function sampleCurve(fit: CurveFit, count: number): Float64Array {
  const out = new Float64Array(count * 3)
  const q: Vec3 = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    curvePoint(fit.poles, fit.spans, count > 1 ? i / (count - 1) : 0, q)
    out[i * 3] = q[0]
    out[i * 3 + 1] = q[1]
    out[i * 3 + 2] = q[2]
  }
  return out
}

/** Traces end to end, each forwards or backwards, as one — a cell's side
 *  made of more than one curve. Each starts where the one before ended. */
export function joinTraces(parts: readonly { trace: CurvePoints; reversed: boolean }[]): CurvePoints {
  const xyz: number[] = []
  for (const { trace, reversed } of parts) {
    const n = trace.points.length / 3
    for (let k = 0; k < n; k++) {
      const i = reversed ? n - 1 - k : k
      if (xyz.length > 0 && k === 0) continue
      xyz.push(trace.points[i * 3], trace.points[i * 3 + 1], trace.points[i * 3 + 2])
    }
  }
  const count = xyz.length / 3
  const at = new Float64Array(count)
  for (let i = 1; i < count; i++) at[i] = at[i - 1] + Math.hypot(xyz[i * 3] - xyz[i * 3 - 3], xyz[i * 3 + 1] - xyz[i * 3 - 2], xyz[i * 3 + 2] - xyz[i * 3 - 1])
  return { points: Float32Array.from(xyz), at, length: count > 0 ? at[count - 1] : 0 }
}

/** A fitted curve as points along it, `perSpan` a span, with their arc
 *  length — to fit another curve to. */
export function curveSamples(fit: CurveFit, perSpan = 8): CurvePoints {
  const count = fit.spans * perSpan + 1
  const points = new Float32Array(count * 3)
  const q: Vec3 = [0, 0, 0]
  for (let i = 0; i < count; i++) points.set(curvePoint(fit.poles, fit.spans, i / (count - 1), q), i * 3)
  const at = new Float64Array(count)
  for (let i = 1; i < count; i++) at[i] = at[i - 1] + Math.hypot(points[i * 3] - points[i * 3 - 3], points[i * 3 + 1] - points[i * 3 - 2], points[i * 3 + 2] - points[i * 3 - 1])
  return { points, at, length: at[count - 1] }
}

/** A curve's poles in the other order: the same curve run backwards. */
export function reversedPoles(poles: Float64Array): Float64Array {
  const n = poles.length / 3
  const out = new Float64Array(poles.length)
  for (let i = 0; i < n; i++) {
    out[i * 3] = poles[(n - 1 - i) * 3]
    out[i * 3 + 1] = poles[(n - 1 - i) * 3 + 1]
    out[i * 3 + 2] = poles[(n - 1 - i) * 3 + 2]
  }
  return out
}
