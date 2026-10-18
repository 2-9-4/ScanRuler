// SPDX-License-Identifier: AGPL-3.0-only
// An outline read as a profile — its distance from a centre against the angle
// round it, or from an axis against the position along it — and the peaks on
// that profile counted. What it is for is the knurl of a part: a heat-set
// insert standing upright on the glass shows its teeth as bumps round the top
// view's outline; lying on its side, as a row of bumps along each flank of
// its silhouette.
//
// The points are binned by position and each bin keeps its outermost point.
// That makes the order of the points irrelevant — an object's traced outline
// and a handful of edge chains in any order read the same — and it makes the
// profile the silhouette's outside: a hole's rim or an inner chain falls in
// the same bins as the outline but never wins one. Bins no point fell in are
// bridged from their neighbours for the peak search, and left out of what is
// reported.
//
// A peak counts by its topographic prominence — how far it stands above the
// higher of the lowest points either side of it before anything taller — not
// by its height: a pixel notch in a tooth's top makes a second maximum whose
// prominence is the notch's depth, and it is passed over. No smoothing goes
// before the search. Prominence already ignores the wobble, and smoothing
// would shave the very teeth it is meant to count when they are only a few
// bins wide. Round a full turn the profile has no ends: it is read from its
// lowest bin, where no peak can be, so every tooth has a valley either side.
// Along an axis it has ends, and a maximum in the first or last bin — no
// valley beyond it — is no peak.

import type { Vec2 } from './types'

export type ProfileAbout =
  /** Radius against angle about a centre — an insert standing upright, seen
   *  from the top. */
  | { kind: 'radial'; center: Vec2 }
  /** Distance from an axis against position along it — an insert lying on
   *  its side. `dir` is a unit vector (normalised here all the same);
   *  position is measured from `origin` along `dir`. */
  | { kind: 'axial'; origin: Vec2; dir: Vec2 }

export interface ProfileOptions {
  /** Bins the profile is sampled in: round the full turn (radial), or along
   *  the extent of each side's points on the axis (axial). By default about
   *  two points to a bin — round(points / 2), of the side's own points along
   *  an axis — held within 8…4096: few bins left empty, and a tooth a dozen
   *  outline pixels wide still spans several. */
  samples?: number
  /** How far a peak must stand above the higher of the two valleys either
   *  side of it to count, in document units. By default 0.3 of the
   *  profile's 5–95 % spread (the widest side's, along an axis), but never
   *  under `floor`. */
  prominence?: number
  /** The least prominence the default may fall to — the outline's own noise,
   *  which the caller sets (1.5 image pixels in document units, say). */
  floor: number
}

export interface ProfilePeak {
  /** Where on the outline, document units: the point that made the bin's
   *  value. */
  at: Vec2
  /** That point's angle in radians, [0, 2π) counter-clockwise from +X
   *  (radial), or its position along the axis (axial). */
  position: number
  /** The radius (radial) or the distance from the axis (axial). */
  value: number
  /** A peak's: how far it stands above the higher of the lowest points
   *  either side before anything taller. A valley's: how far it lies below
   *  the lower of the two peaks either side — the depth of the tooth gap. */
  prominence: number
}

export interface ProfileSide {
  /** Peaks with at least the prominence, in order of position. */
  peaks: ProfilePeak[]
  /** The deepest point between each pair of consecutive peaks: valleys[i]
   *  follows peaks[i]. Round a turn the last lies between the last peak and
   *  the first, so there are as many valleys as peaks; along an axis there is
   *  one fewer. */
  valleys: ProfilePeak[]
  /** Radial: 2π / peaks.length, radians. Axial: the spacing of the peaks,
   *  the slope of their positions against their numbers along the row.
   *  Null with fewer than two peaks. */
  pitch: number | null
  /** The largest value on the profile. */
  max: number
  /** The smallest value on the profile, over bins that have data. */
  min: number
  peakMean: number | null
  valleyMean: number | null
  /** The profile as sampled: [position, value] per bin with data, in order
   *  of position. */
  samples: [number, number][]
}

export interface FlatProfile {
  kind: 'radial' | 'axial'
  /** The prominence the peaks were taken at. */
  prominence: number
  /** Radial: one side. Axial: always two — [0] the side left of `dir`
   *  (positive cross product, points on the axis included), [1] the right.
   *  A side no point fell on has no peaks, valleys or samples, zero max and
   *  min, and null pitch and means. */
  sides: ProfileSide[]
}

const TAU = 2 * Math.PI
const POINTS_PER_BIN = 2
const MIN_SAMPLES = 8
const MAX_SAMPLES = 4096
/** The default prominence as a fraction of the profile's 5–95 % spread: a
 *  knurl's teeth stand their whole depth, which is most of what that spread
 *  is, and the wobble between them a small part of it. */
const SPREAD_FRACTION = 0.3

/** Points binned by position: each bin's outermost value, the point that
 *  made it (-1 where none fell), and that point's position; the bins begin
 *  at `lo`, each `width` wide. */
interface Binned {
  value: Float64Array
  source: Int32Array
  position: Float64Array
  lo: number
  width: number
}

function binPoints(
  members: number[],
  positions: Float64Array,
  values: Float64Array,
  lo: number,
  span: number,
  bins: number,
): Binned {
  const value = new Float64Array(bins).fill(-Infinity)
  const source = new Int32Array(bins).fill(-1)
  const position = new Float64Array(bins)
  for (const i of members) {
    const k = span > 0 ? Math.min(bins - 1, Math.max(0, Math.floor(((positions[i] - lo) / span) * bins))) : 0
    if (values[i] > value[k]) {
      value[k] = values[i]
      source[k] = i
      position[k] = positions[i]
    }
  }
  return { value, source, position, lo, width: span / bins }
}

function defaultSamples(points: number): number {
  return Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.round(points / POINTS_PER_BIN)))
}

/** The binned profile with its empty bins bridged linearly from the nearest
 *  bins with data either side — round the turn when circular. */
function bridged(b: Binned, circular: boolean): Float64Array {
  const n = b.value.length
  const out = Float64Array.from(b.value)
  const data: number[] = []
  for (let k = 0; k < n; k++) if (b.source[k] >= 0) data.push(k)
  if (data.length === 0) return out.fill(0)
  const fill = (from: number, to: number) => {
    // `to` may run past the end when the gap wraps round the turn.
    const v0 = b.value[from]
    const v1 = b.value[to % n]
    for (let k = from + 1; k < to; k++) out[k % n] = v0 + ((v1 - v0) * (k - from)) / (to - from)
  }
  for (let d = 0; d + 1 < data.length; d++) fill(data[d], data[d + 1])
  const first = data[0]
  const last = data[data.length - 1]
  if (circular) {
    fill(last, first + n)
  } else {
    for (let k = 0; k < first; k++) out[k] = b.value[first]
    for (let k = last + 1; k < n; k++) out[k] = b.value[last]
  }
  return out
}

/** Local maxima of a signal, a flat top counted once at its middle, never
 *  at either end. */
function localMaxima(x: Float64Array): number[] {
  const out: number[] = []
  const last = x.length - 1
  let i = 1
  while (i < last) {
    if (x[i - 1] < x[i]) {
      let ahead = i + 1
      while (ahead < last && x[ahead] === x[i]) ahead++
      if (x[ahead] < x[i]) {
        out.push((i + ahead - 1) >> 1)
        i = ahead
      }
    }
    i++
  }
  return out
}

/** The topographic prominence of the peak at `p`: walk either way until the
 *  signal rises past the peak, and measure from the higher of the two lowest
 *  points met. Ties go one way. Walking left, a point as high as the peak
 *  ends the walk (once past the peak's own flat top); walking right, only a
 *  higher one does. Two maxima exactly as high with a dip between — the two
 *  ends of a tooth's flat top on a traced pixel outline — would otherwise
 *  each walk past the other and both stand the tooth's full height; this way
 *  the right one stands only the dip, and teeth all of one height still each
 *  stand their own valleys. */
function prominenceAt(x: Float64Array, p: number): number {
  const h = x[p]
  let top = p
  while (top > 0 && x[top - 1] === h) top--
  let left = h
  for (let i = top - 1; i >= 0 && x[i] < h; i--) if (x[i] < left) left = x[i]
  let right = h
  for (let i = p + 1; i < x.length && x[i] <= h; i++) if (x[i] < right) right = x[i]
  return h - Math.max(left, right)
}

/** Every peak of the signal with its prominence, by bin. A circular signal
 *  is read from its lowest bin round to that bin again, so the turn has two
 *  ends no peak can sit on. */
function peaksOf(signal: Float64Array, circular: boolean): { bin: number; prominence: number }[] {
  const n = signal.length
  if (!circular) return localMaxima(signal).map((bin) => ({ bin, prominence: prominenceAt(signal, bin) }))
  let lowest = 0
  for (let k = 1; k < n; k++) if (signal[k] < signal[lowest]) lowest = k
  const turn = new Float64Array(n + 1)
  for (let k = 0; k <= n; k++) turn[k] = signal[(lowest + k) % n]
  return localMaxima(turn).map((k) => ({ bin: (lowest + k) % n, prominence: prominenceAt(turn, k) }))
}

/** The bin with data nearest `k` — `k` itself unless it was bridged — the
 *  higher of two equally near when `sign` is 1, the lower when -1. */
function nearestData(b: Binned, k: number, circular: boolean, sign: number): number {
  const n = b.value.length
  if (b.source[k] >= 0) return k
  for (let d = 1; d < n; d++) {
    let best = -1
    for (const s of [k - d, k + d]) {
      const j = circular ? ((s % n) + n) % n : s
      if (j < 0 || j >= n || b.source[j] < 0) continue
      if (best < 0 || sign * (b.value[j] - b.value[best]) > 0) best = j
    }
    if (best >= 0) return best
  }
  return -1
}

/** The 5–95 % spread of the values of the bins with data. */
function spread(b: Binned): number {
  const values: number[] = []
  for (let k = 0; k < b.value.length; k++) if (b.source[k] >= 0) values.push(b.value[k])
  if (values.length === 0) return 0
  values.sort((a, c) => a - c)
  const at = (q: number) => values[Math.round(q * (values.length - 1))]
  return at(0.95) - at(0.05)
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const m = sorted.length >> 1
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null)

function emptySide(): ProfileSide {
  return { peaks: [], valleys: [], pitch: null, max: 0, min: 0, peakMean: null, valleyMean: null, samples: [] }
}

/** The middle of the tooth whose top is bin `k`, as a position along the
 *  row: halfway between where its flanks fall through `level`, each
 *  crossing found between two bins and placed between their centres. Null
 *  when a flank runs off the end of the row before it falls that far. */
function toothMiddle(signal: Float64Array, k: number, level: number, lo: number, width: number): number | null {
  const crossing = (dir: 1 | -1): number | null => {
    for (let j = k; j + dir >= 0 && j + dir < signal.length; j += dir) {
      const a = signal[j]
      const c = signal[j + dir]
      if (c < level) return j + (dir * (a - level)) / (a - c)
    }
    return null
  }
  const left = crossing(-1)
  const right = crossing(1)
  return left === null || right === null ? null : lo + ((left + right) / 2 + 0.5) * width
}

/** One side of the profile read: its peaks at the prominence, the valleys
 *  between them, and the numbers that sum them up. */
function readSide(points: ArrayLike<number>, b: Binned, prominence: number, circular: boolean): ProfileSide {
  const n = b.value.length
  const samples: [number, number][] = []
  let max = -Infinity
  let min = Infinity
  for (let k = 0; k < n; k++) {
    if (b.source[k] < 0) continue
    samples.push([b.position[k], b.value[k]])
    if (b.value[k] > max) max = b.value[k]
    if (b.value[k] < min) min = b.value[k]
  }
  if (samples.length === 0) return emptySide()

  const pointAt = (k: number, prominence: number): ProfilePeak => {
    const i = b.source[k]
    return { at: [points[2 * i], points[2 * i + 1]], position: b.position[k], value: b.value[k], prominence }
  }

  // Peaks on the bridged signal, each reported at the nearest bin a point
  // made; two peaks landing on the same bin are one.
  const found = new Map<number, number>()
  const signal = bridged(b, circular)
  for (const { bin, prominence: p } of peaksOf(signal, circular)) {
    if (p < prominence) continue
    const k = nearestData(b, bin, circular, 1)
    const prior = found.get(k)
    if (k >= 0 && (prior === undefined || p > prior)) found.set(k, p)
  }
  const bins = [...found.keys()].sort((a, c) => a - c)
  const peaks = bins.map((k) => pointAt(k, found.get(k)!))

  const valleys: ProfilePeak[] = []
  const gaps = circular ? bins.length : bins.length - 1
  for (let g = 0; g < gaps; g++) {
    const a = bins[g]
    const c = g + 1 < bins.length ? bins[g + 1] : bins[0] + n
    let deepest = -1
    for (let j = a + 1; j < c; j++) {
      const k = j % n
      if (b.source[k] >= 0 && (deepest < 0 || b.value[k] < b.value[deepest])) deepest = k
    }
    // Two peaks always have a dip between them, and a dip is made by some
    // point; the lower peak stands in should that ever fail.
    if (deepest < 0) deepest = b.value[a] <= b.value[c % n] ? a : c % n
    valleys.push(pointAt(deepest, Math.min(b.value[a], b.value[c % n]) - b.value[deepest]))
  }

  let pitch: number | null = null
  if (peaks.length >= 2) {
    if (circular) {
      pitch = TAU / peaks.length
    } else {
      // Each peak's position is a bin's, so any one spacing is off by up to
      // a bin, and the median of them settles on one bin count — a couple
      // of percent off on a short row. Each tooth is placed instead at the
      // middle of its flanks, where they cross half its height, which falls
      // between bins; and the pitch is the line through those middles
      // against the teeth's numbers. The numbers come off the median
      // spacing, so a tooth missed in the row keeps its number's gap rather
      // than pulling the line.
      const spacings: number[] = []
      for (let i = 1; i < peaks.length; i++) spacings.push(peaks[i].position - peaks[i - 1].position)
      const step = median(spacings)
      const index = peaks.map((p) => Math.round((p.position - peaks[0].position) / step))
      const middle = bins.map((k, i) => {
        const low = Math.max(valleys[i - 1]?.value ?? -Infinity, valleys[i]?.value ?? -Infinity)
        return toothMiddle(signal, k, (b.value[k] + low) / 2, b.lo, b.width) ?? peaks[i].position
      })
      const mi = index.reduce((s, v) => s + v, 0) / index.length
      const mp = middle.reduce((s, v) => s + v, 0) / middle.length
      let sxy = 0
      let sxx = 0
      middle.forEach((m, i) => {
        sxy += (index[i] - mi) * (m - mp)
        sxx += (index[i] - mi) ** 2
      })
      pitch = sxx > 0 ? sxy / sxx : step
    }
  }

  return {
    peaks,
    valleys,
    pitch,
    max,
    min,
    peakMean: mean(peaks.map((p) => p.value)),
    valleyMean: mean(valleys.map((p) => p.value)),
    samples,
  }
}

/**
 * The profile of an outline about a centre (radius against angle) or along
 * an axis (distance from it against position, each side apart), with its
 * peaks counted at the prominence. `points` are x,y flattened in document
 * units, in any order: an object's outline, or several edge chains end to
 * end.
 */
export function outlineProfile(points: ArrayLike<number>, about: ProfileAbout, options: ProfileOptions): FlatProfile {
  const count = points.length >> 1
  const positions = new Float64Array(count)
  const values = new Float64Array(count)
  const binsFor = (members: number) =>
    options.samples !== undefined ? Math.max(3, Math.floor(options.samples)) : defaultSamples(members)
  const prominenceFrom = (sides: Binned[]) =>
    options.prominence ?? Math.max(SPREAD_FRACTION * Math.max(0, ...sides.map(spread)), options.floor)

  if (about.kind === 'radial') {
    const [cx, cy] = about.center
    const members: number[] = []
    for (let i = 0; i < count; i++) {
      const dx = points[2 * i] - cx
      const dy = points[2 * i + 1] - cy
      let angle = Math.atan2(dy, dx)
      if (angle < 0) angle += TAU
      // A hair under zero comes back as a full turn once 2π is added.
      if (angle >= TAU) angle = 0
      positions[i] = angle
      values[i] = Math.hypot(dx, dy)
      members.push(i)
    }
    const binned = binPoints(members, positions, values, 0, TAU, binsFor(count))
    const prominence = prominenceFrom([binned])
    return { kind: 'radial', prominence, sides: [readSide(points, binned, prominence, true)] }
  }

  const [ox, oy] = about.origin
  const len = Math.hypot(about.dir[0], about.dir[1])
  if (!(len > 0)) throw new RangeError('The profile axis needs a direction.')
  const ux = about.dir[0] / len
  const uy = about.dir[1] / len
  const left: number[] = []
  const right: number[] = []
  for (let i = 0; i < count; i++) {
    const dx = points[2 * i] - ox
    const dy = points[2 * i + 1] - oy
    const across = ux * dy - uy * dx
    positions[i] = dx * ux + dy * uy
    values[i] = Math.abs(across)
    ;(across >= 0 ? left : right).push(i)
  }
  const sides = [left, right].map((members) => {
    if (members.length === 0) return null
    let lo = Infinity
    let hi = -Infinity
    for (const i of members) {
      if (positions[i] < lo) lo = positions[i]
      if (positions[i] > hi) hi = positions[i]
    }
    // A side whose points all sit at one position is one bin wide.
    return binPoints(members, positions, values, lo, hi - lo, hi > lo ? binsFor(members.length) : 1)
  })
  const prominence = prominenceFrom(sides.filter((s): s is Binned => s !== null))
  return {
    kind: 'axial',
    prominence,
    sides: sides.map((s) => (s ? readSide(points, s, prominence, false) : emptySide())),
  }
}
