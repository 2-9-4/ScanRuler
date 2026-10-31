// SPDX-License-Identifier: AGPL-3.0-only
// A thread read off the scan: the scan's points in a thin shell about a
// bore's or a boss's axis, their radius laid out along the axis, and in
// that profile the pitch — the spacing the pattern repeats at — the crest
// and root diameters, which way the helix turns, and the standard size it
// is nearest. What an agent did with thirty probes along the wall, as one
// reading.
//
// The pitch is the first strong peak of the profile's autocorrelation: a
// thread is the one feature of a part that repeats along an axis, so the
// profile agrees with itself shifted by a pitch and by nothing shorter.
// The profile is taken sector by sector round the axis — along a line up
// the wall, as a probe would take it — because at one height the radius
// runs through a whole tooth round the turn, and a profile over all angles
// at once would be flat. Each sector's autocorrelation is added to the
// rest. It is read in windows a few turns long along the axis, and the
// pitch is the one most windows agree on: a set screw's hole is threaded
// half its length, a chamfer opens it, and over the whole length the plain
// half and the rims drown the teeth. The hand is read on the helix itself: a point at angle θ about the axis
// lies a pitch × θ / 2π further along it than its neighbour at θ = 0, one
// way for a right-hand thread and the other for a left — the phase of
// every point under each hypothesis is gathered, and the hand whose phases
// agree is the one.

import type { Vec3 } from '../../../src/core/types'
import { cross, dot, normalize, scale, sub } from '../../../src/core/vec'
import { minorDiameter, THREAD_STANDARDS, threadDepth, threadDesignation, threadSizes, type ThreadStandard } from './thread'
import { round3, round4 } from '../../../src/core/round'

export interface ThreadReadInput {
  /** The points about the axis, x y z each, and their outward normals. */
  points: Float32Array
  normals: Float32Array
  origin: Vec3
  dir: Vec3
  /** The nominal radius — the fitted cylinder's, the face's. */
  radius: number
  /** How far either side of it a point is still the thread's, mm. */
  band: number
  /** How far along the axis from the origin, each way, mm. */
  halfLength: number
}

export interface ThreadReading {
  /** How many points were read, of those handed in. */
  points: number
  /** How many more lay in the shell but faced along the axis — a chamfer,
   *  a rim — and were left out. */
  offWall: number
  /** Where along the axis they lie, mm from the origin. */
  span: [number, number]
  /** The radius: its mean, and its 5th and 95th percentile — a nut's
   *  crests and root, a bolt's root and crests — each point's taken about
   *  a straight line through its sector's along the axis, so an axis a
   *  little off or aslant reads no deeper teeth. */
  radius: { mean: number; low: number; high: number }
  minor: number
  major: number
  /** How deep the pattern cuts, high − low, mm. */
  depth: number
  /** A bore (the normals face the axis), a boss, or not clear. */
  internal: boolean | null
  /** The pitch, mm — the one most windows along the axis agree on; null
   *  where the profile does not repeat. */
  pitch: number | null
  /** How well the profile agrees with itself a pitch along, 0 to 1 — the
   *  agreeing windows' median. */
  strength: number
  /** The tooth's height, mm: the profile folded at the pitch, each sector
   *  of the wall on its own, the folded profile's peak to peak — what
   *  repeats; the agreeing windows' median, null with no pitch. */
  contrast: number | null
  /** The scan's scatter on the wall, mm: the points' radii about their
   *  sector's median at their height (1.48 × the median absolute
   *  deviation). */
  noise: number
  leftHanded: boolean | null
  /** How much better the hand found fits than the other, 0 to 1. */
  handConfidence: number
  /** Each window along the axis, mm from the origin, and what it read. */
  windows: ThreadWindow[]
  /** How many of the windows read the pitch — 0 where the whole span read
   *  one no window could see, a pitch too coarse for them. */
  agree: number
  /** Where along the axis the agreeing windows lie — where the thread is;
   *  the radius, minor and major are read there. Null with no pitch. */
  threaded: [number, number] | null
  /** The radius along the axis, thinned, for a look. */
  profile: { z: number; r: number }[]
}

/** A window along the axis the pitch is read in. */
export interface ThreadWindow {
  from: number
  to: number
  pitch: number | null
  strength: number
  contrast: number | null
}

/** A standard size the reading may be. */
export interface ThreadCandidate {
  standard: ThreadStandard
  size: string
  designation: string
  diameter: number
  pitch: number
  /** How far the reading is off this size: the pitch's share and the
   *  diameter's. */
  pitchOff: number
  diameterOff: number
  score: number
}

/** The shortest pitch looked for and the longest, mm. */
const PITCH_MIN = 0.15
const PITCH_MAX = 8
/** How many bins the profile is read in, at most, and the finest bin. */
const PROFILE_BINS = 400
const BIN_MIN = 0.01
/** The longest stretch of a window a sector may leave empty, of its
 *  length. */
const GAP_SHARE = 0.25
/** How many sectors round the axis the profile is read in: each a line up
 *  the wall, thirty degrees wide. */
const SECTORS = 12
/** The least agreement a pitch is reported at. */
const STRENGTH_MIN = 0.25
/** How many times the scan's noise the teeth must stand to be a thread:
 *  below, what repeats is the scan's own ripple — layer lines, the
 *  scanner's stripes — on a plain wall. */
const CONTRAST_MIN = 3
/** A peak within this share of the best counts as the pitch when it comes
 *  first — the pattern repeats at its pitch before it repeats at two. */
const FIRST_PEAK_SHARE = 0.75
/** How far along a window's profile the lag is searched, of its length:
 *  past half, so a window holding two turns sees their pitch, and short of
 *  where a single bump, a step or a slanted end repeats as well as a
 *  thread does. */
const LAG_SHARE = 0.6
/** A point whose normal leans further along the axis than this (|n·axis|)
 *  faces a chamfer, a rim or a floor, not the wall. */
const WALL_FACING = 0.8
/** The windows the pitch is read in along the axis: this long, or the
 *  radius when that is more — a coarse thread goes with a wide one — a
 *  fifth of that apart, and this many at most. */
const WINDOW_MM = 2.5
const WINDOW_STEP = 0.2
const WINDOWS_MAX = 16
/** How many points a sector needs for its own line along the axis. */
const SECTOR_LINE_MIN = 8
/** Windows whose pitches lie within this share of one another agree. */
const AGREE_SHARE = 0.06
/** How many profile points an answer carries. */
const PROFILE_OUT = 200
/** How far off a size a reading may be and still be suggested. */
const SUGGEST_PITCH = 0.12
const SUGGEST_DIAMETER = 0.08

/** The thread in a shell of points about an axis. */
export function readThread(input: ThreadReadInput): ThreadReading | null {
  const d = normalize(input.dir)
  if (!d) return null
  const o = input.origin
  const u0 = Math.abs(d[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3)
  const u = normalize(cross(d, u0))!
  const v = cross(d, u)
  const n = input.points.length / 3
  const withNormals = input.normals.length === input.points.length
  const zs: number[] = []
  const rs: number[] = []
  const ths: number[] = []
  let facing = 0
  let offWall = 0
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [input.points[i * 3], input.points[i * 3 + 1], input.points[i * 3 + 2]]
    const q = sub(p, o)
    const z = dot(q, d)
    if (Math.abs(z) > input.halfLength) continue
    const radial = sub(q, scale(d, z))
    const r = Math.hypot(radial[0], radial[1], radial[2])
    if (Math.abs(r - input.radius) > input.band) continue
    // A chamfer, a rim, a floor: a point facing along the axis is no part
    // of the wall the teeth stand on.
    if (withNormals && Math.abs(input.normals[i * 3] * d[0] + input.normals[i * 3 + 1] * d[1] + input.normals[i * 3 + 2] * d[2]) > WALL_FACING) {
      offWall++
      continue
    }
    zs.push(z)
    rs.push(r)
    ths.push(Math.atan2(dot(radial, v), dot(radial, u)))
    if (r > 1e-9 && withNormals) {
      facing += (input.normals[i * 3] * radial[0] + input.normals[i * 3 + 1] * radial[1] + input.normals[i * 3 + 2] * radial[2]) / r
    }
  }
  const m = zs.length
  if (m < 20) return null
  let zMin = Infinity, zMax = -Infinity
  for (const z of zs) {
    if (z < zMin) zMin = z
    if (z > zMax) zMax = z
  }
  const span = zMax - zMin
  const internal = facing / m < -0.3 ? true : facing / m > 0.3 ? false : null
  const sectorOf = (i: number) => Math.min(SECTORS - 1, Math.floor(((ths[i] + Math.PI) / (2 * Math.PI)) * SECTORS))

  // The pitch, window by window along the axis: a thread that runs only
  // part of the way — the far half of a set-screw hole plain, a chamfer at
  // its mouth — repeats in the windows on it, and the pitch is the one most
  // of them agree on, not the strongest single one.
  const windowMm = Math.max(WINDOW_MM, input.radius)
  const count = span <= windowMm * 1.2 ? 1 : Math.min(WINDOWS_MAX, Math.ceil((span - windowMm) / (windowMm * WINDOW_STEP)) + 1)
  const windowLength = count === 1 ? span : windowMm
  const windowStep = count === 1 ? 0 : (span - windowLength) / (count - 1)
  const reads: ThreadWindow[] = []
  for (let k = 0; k < count; k++) {
    const from = zMin + k * windowStep
    const to = count === 1 ? zMax : from + windowLength
    reads.push({ from, to, ...windowRead(zs, rs, sectorOf, from, to) })
  }
  let agreeing = agreeOn(reads)
  const agree = agreeing.length
  // Windows too short to see a coarse pitch: the whole span's own read.
  if (agree === 0 && count > 1) {
    const whole = { from: zMin, to: zMax, ...windowRead(zs, rs, sectorOf, zMin, zMax) }
    if (whole.pitch !== null) agreeing = [whole]
  }
  const pitch = agreeing.length > 0 ? median(agreeing.map((w) => w.pitch!)) : null
  const strength = agreeing.length > 0 ? median(agreeing.map((w) => w.strength)) : Math.max(0, ...reads.map((w) => w.strength))
  const contrast = agreeing.length > 0 ? median(agreeing.map((w) => w.contrast ?? 0)) : null
  const threaded: [number, number] | null = agreeing.length > 0 ? [Math.min(...agreeing.map((w) => w.from)), Math.max(...agreeing.map((w) => w.to))] : null

  // The crests and the root where the thread is (over the whole span where
  // there is none), each point's radius against a straight line through
  // its sector's along the axis: an axis a little off the scan's — a hole
  // modelled half a millimetre aside, a few degrees over — moves each
  // sector's radius as a whole, and pooled that reads as depth. The radius
  // is the sectors' median; a sector cut short (a cross bore, a gap in the
  // scan) keeps its level but takes no slope.
  const on: number[] = []
  for (let i = 0; i < m; i++) if (!threaded || (zs[i] >= threaded[0] && zs[i] <= threaded[1])) on.push(i)
  const reach = threaded ? threaded[1] - threaded[0] : span
  const bySector: number[][] = Array.from({ length: SECTORS }, () => [])
  for (const i of on) bySector[sectorOf(i)].push(i)
  const lines = new Float64Array(m).fill(NaN)
  const levels: number[] = []
  for (const list of bySector) {
    if (list.length < SECTOR_LINE_MIN) continue
    let sz = 0, sr = 0, lo = Infinity, hi = -Infinity
    for (const i of list) {
      sz += zs[i]
      sr += rs[i]
      lo = Math.min(lo, zs[i])
      hi = Math.max(hi, zs[i])
    }
    const zm = sz / list.length, rm = sr / list.length
    let szz = 0, szr = 0
    for (const i of list) {
      szz += (zs[i] - zm) ** 2
      szr += (zs[i] - zm) * (rs[i] - rm)
    }
    const slope = hi - lo >= reach / 2 && szz > 1e-12 ? szr / szz : 0
    for (const i of list) lines[i] = rm + slope * (zs[i] - zm)
    levels.push(rm)
  }
  const centre = levels.length > 0 ? median(levels) : median(on.map((i) => rs[i]))
  const dev = new Float64Array(m)
  for (const i of on) dev[i] = rs[i] - (Number.isNaN(lines[i]) ? centre : lines[i])
  const sortedDev = on.map((i) => dev[i]).sort((a, b) => a - b)
  const pct = (p: number) => sortedDev[Math.min(sortedDev.length - 1, Math.floor(p * sortedDev.length))]
  const low = centre + pct(0.05), high = centre + pct(0.95)
  const mean = centre

  // The hand: under which the phases of the crests agree — the points at
  // the smallest radii and the largest, which lie on the helix's crest and
  // its root; a point halfway up a flank lies on either hand's helix.
  let leftHanded: boolean | null = null
  let handConfidence = 0
  if (pitch !== null) {
    const lowCut = pct(0.15), highCut = pct(0.85)
    const agreement = (sign: 1 | -1): number => {
      let cx = 0, cy = 0, hx = 0, hy = 0, nl = 0, nh = 0
      for (const i of on) {
        const r = dev[i]
        if (r > lowCut && r < highCut) continue
        const phase = ((zs[i] - (sign * pitch * ths[i]) / (2 * Math.PI)) / pitch) * 2 * Math.PI
        if (r <= lowCut) {
          cx += Math.cos(phase)
          cy += Math.sin(phase)
          nl++
        } else {
          hx += Math.cos(phase)
          hy += Math.sin(phase)
          nh++
        }
      }
      return (nl > 0 ? Math.hypot(cx, cy) / nl : 0) + (nh > 0 ? Math.hypot(hx, hy) / nh : 0)
    }
    const right = agreement(1)
    const left = agreement(-1)
    if (Math.max(right, left) > 0.05) {
      leftHanded = left > right
      handConfidence = Math.abs(left - right) / Math.max(left, right)
    }
  }

  // The noise: each point against its sector's median at its height, over
  // the whole span; and the whole-turn profile, for a look.
  const bin = Math.max(BIN_MIN, span / PROFILE_BINS)
  const bins = Math.max(1, Math.ceil(span / bin))
  const binOf = (z: number) => Math.min(bins - 1, Math.floor((z - zMin) / bin))
  const buckets: number[][] = Array.from({ length: bins }, () => [])
  const sectorBuckets: number[][][] = Array.from({ length: SECTORS }, () => Array.from({ length: bins }, () => []))
  for (let i = 0; i < m; i++) {
    buckets[binOf(zs[i])].push(rs[i])
    sectorBuckets[sectorOf(i)][binOf(zs[i])].push(rs[i])
  }
  for (const lists of [buckets, ...sectorBuckets]) for (const list of lists) list.sort((a, c) => a - c)
  const deviations: number[] = []
  for (let i = 0; i < m; i++) {
    const list = sectorBuckets[sectorOf(i)][binOf(zs[i])]
    if (list.length < 2) continue
    deviations.push(Math.abs(rs[i] - list[Math.floor(list.length / 2)]))
  }
  deviations.sort((a, b) => a - b)
  const noise = deviations.length > 0 ? 1.4826 * deviations[deviations.length >> 1] : 0

  const stride = Math.max(1, Math.ceil(bins / PROFILE_OUT))
  const out: { z: number; r: number }[] = []
  for (let b = 0; b < bins; b += stride) {
    const list = buckets[b]
    if (list.length === 0) continue
    out.push({ z: round3(zMin + (b + 0.5) * bin), r: round3(list[Math.floor(list.length / 2)]) })
  }
  return {
    points: m,
    offWall,
    span: [round3(zMin), round3(zMax)],
    radius: { mean: round3(mean), low: round3(low), high: round3(high) },
    minor: round3(2 * low),
    major: round3(2 * high),
    depth: round3(high - low),
    internal,
    pitch: pitch === null ? null : round4(pitch),
    strength: round3(strength),
    contrast: contrast === null ? null : round4(contrast),
    noise: round4(noise),
    leftHanded,
    handConfidence: round3(handConfidence),
    windows: reads.map((w) => ({ from: round3(w.from), to: round3(w.to), pitch: w.pitch === null ? null : round4(w.pitch), strength: round3(w.strength), contrast: w.contrast === null ? null : round4(w.contrast) })),
    agree,
    threaded: threaded ? [round3(threaded[0]), round3(threaded[1])] : null,
    profile: out,
  }
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/** The pitch in the points between `from` and `to` along the axis: in each
 *  sector round it, the median radius in bins along it, the empty bins
 *  bridged, a straight trend taken out — a taper is not a thread; the
 *  sectors' autocorrelations added, and the first strong peak past the
 *  zero lag's own shoulder; the teeth's height folded at it. */
function windowRead(zs: readonly number[], rs: readonly number[], sectorOf: (i: number) => number, from: number, to: number): Omit<ThreadWindow, 'from' | 'to'> {
  const none = { pitch: null, strength: 0, contrast: null }
  const length = to - from
  const bin = Math.max(BIN_MIN, length / PROFILE_BINS)
  const bins = Math.max(1, Math.ceil(length / bin))
  const sectorBuckets: number[][][] = Array.from({ length: SECTORS }, () => Array.from({ length: bins }, () => []))
  for (let i = 0; i < zs.length; i++) {
    if (zs[i] < from || zs[i] > to) continue
    sectorBuckets[sectorOf(i)][Math.min(bins - 1, Math.floor((zs[i] - from) / bin))].push(rs[i])
  }
  const profileOf = (lists: number[][]): Float64Array | null => {
    const out = new Float64Array(bins)
    let filled = 0
    let gap = 0
    let longest = 0
    let last = NaN
    for (let b = 0; b < bins; b++) {
      const list = lists[b]
      if (list.length > 0) {
        list.sort((a, c) => a - c)
        last = list[Math.floor(list.length / 2)]
        filled++
        gap = 0
      } else longest = Math.max(longest, ++gap)
      out[b] = last
    }
    // A sector the wall leaves for a stretch — a cross bore, a gap in the
    // scan — is no line up the wall; one a coarse scan fills only row by
    // row still is.
    if (filled < SECTOR_LINE_MIN || longest > bins * GAP_SHARE) return null
    // Leading empty bins take the first value there is.
    let first = NaN
    for (let b = 0; b < bins; b++) if (!Number.isNaN(out[b])) { first = out[b]; break }
    for (let b = 0; b < bins && Number.isNaN(out[b]); b++) out[b] = first
    detrend(out)
    return out
  }
  const profiles = sectorBuckets.map(profileOf).filter((x): x is Float64Array => x !== null)
  const lagMin = Math.max(2, Math.round(PITCH_MIN / bin))
  const lagMax = Math.min(Math.floor(bins * LAG_SHARE), Math.round(PITCH_MAX / bin))
  if (!(lagMax > lagMin + 2) || profiles.length === 0) return none
  const ac = new Float64Array(lagMax + 1)
  let weighed = 0
  for (const profile of profiles) {
    let norm = 0
    for (let i = 0; i < bins; i++) norm += profile[i] * profile[i]
    if (!(norm > 0)) continue
    weighed++
    for (let L = lagMin; L <= lagMax; L++) {
      let s = 0
      for (let i = 0; i + L < bins; i++) s += profile[i] * profile[i + L]
      ac[L] += (s / norm) * (bins / (bins - L))
    }
  }
  if (weighed === 0) return none
  for (let L = lagMin; L <= lagMax; L++) ac[L] /= weighed
  // Past the first minimum: a profile still agrees with itself a short way
  // along — a 1 mm thread correlates 0.5 or more at 0.15 mm — and that
  // shoulder is no repeat.
  let start = lagMin
  while (start < lagMax && ac[start + 1] <= ac[start]) start++
  let best = -Infinity
  for (let L = start; L <= lagMax; L++) if (ac[L] > best) best = ac[L]
  const weak = { ...none, strength: Math.min(1, Math.max(0, best)) }
  if (!(best >= STRENGTH_MIN)) return weak
  // The first local maximum worth most of the best: the pitch, not twice it.
  let at = -1
  for (let L = Math.max(lagMin + 1, start); L < lagMax; L++) {
    if (ac[L] >= ac[L - 1] && ac[L] >= ac[L + 1] && ac[L] >= FIRST_PEAK_SHARE * best) {
      at = L
      break
    }
  }
  if (at < 0) return weak
  // The peak's top by a parabola through its neighbours.
  const y0 = ac[at - 1], y1 = ac[at], y2 = ac[at + 1]
  const denom = y0 - 2 * y1 + y2
  const shift = Math.abs(denom) > 1e-12 ? Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / denom)) : 0
  const pitch = (at + shift) * bin
  // The contrast: each sector's profile folded at the pitch — its own
  // phase, the helix moving it from one sector to the next — and the
  // folded profile's peak to peak, the median over the sectors.
  const phases = Math.max(4, Math.min(24, Math.round(pitch / bin)))
  const heights: number[] = []
  for (const profile of profiles) {
    const sum = new Float64Array(phases)
    const count = new Float64Array(phases)
    for (let b = 0; b < bins; b++) {
      const z = (b + 0.5) * bin
      const k = Math.min(phases - 1, Math.floor(((z / pitch) % 1) * phases))
      sum[k] += profile[b]
      count[k]++
    }
    let lo = Infinity
    let hi = -Infinity
    for (let k = 0; k < phases; k++) {
      if (count[k] === 0) continue
      const value = sum[k] / count[k]
      lo = Math.min(lo, value)
      hi = Math.max(hi, value)
    }
    if (hi > lo) heights.push(hi - lo)
  }
  heights.sort((a, b) => a - b)
  return { pitch, strength: Math.min(1, Math.max(0, y1)), contrast: heights.length > 0 ? heights[heights.length >> 1] : 0 }
}

/** The windows that read the pitch most of them agree on — within
 *  AGREE_SHARE of one another; between as many, the stronger. None where
 *  no window reads a pitch. */
function agreeOn(reads: readonly ThreadWindow[]): ThreadWindow[] {
  const read = reads.filter((w) => w.pitch !== null)
  let best: ThreadWindow[] = []
  let bestStrength = -Infinity
  for (const w of read) {
    const near = read.filter((x) => Math.abs(x.pitch! - w.pitch!) <= AGREE_SHARE * w.pitch!)
    const strength = near.reduce((a, x) => a + x.strength, 0)
    if (near.length > best.length || (near.length === best.length && strength > bestStrength)) {
      best = near
      bestStrength = strength
    }
  }
  return best
}

/** Whether a reading is a thread: a pitch found, and teeth standing well
 *  clear of the scan's noise. */
export function isThread(r: Pick<ThreadReading, 'pitch' | 'contrast' | 'noise'>): boolean {
  return r.pitch !== null && r.contrast !== null && r.contrast >= CONTRAST_MIN * r.noise
}

/** The standard sizes a reading is nearest, best first — three at most —
 *  and the one near enough to suggest, if any. A bore is matched on its
 *  crests, the minor diameter, which a scan resolves; a boss on its own
 *  crests, the major. A boss read at an ISO coarse pitch is as near the
 *  printing form's size at that pitch as the metric one — the same major
 *  diameter — and the standard listed first takes the tie: metric, before
 *  print. A bore tells them apart by the minor. */
export function matchThread(reading: ThreadReading, standards: readonly ThreadStandard[]): { candidates: ThreadCandidate[]; suggested: ThreadCandidate | null } {
  if (reading.pitch === null) return { candidates: [], suggested: null }
  const P = reading.pitch
  const all: ThreadCandidate[] = []
  for (const standard of standards) {
    for (const size of threadSizes(standard)) {
      for (const pitch of size.pitches) {
        const pitchOff = Math.abs(pitch - P) / pitch
        const offMajor = Math.abs(size.diameter - reading.major) / size.diameter
        const offMinor = Math.abs(minorDiameter(size.diameter, pitch, standard) - reading.minor) / size.diameter
        const diameterOff = reading.internal === true ? offMinor : reading.internal === false ? offMajor : Math.min(offMajor, offMinor)
        all.push({ standard, size: size.label, designation: threadDesignation(standard, size.diameter, pitch) ?? size.label, diameter: size.diameter, pitch, pitchOff: round3(pitchOff), diameterOff: round3(diameterOff), score: round3(2 * pitchOff + diameterOff) })
      }
    }
  }
  all.sort((a, b) => a.score - b.score)
  const candidates = all.slice(0, 3)
  const best = candidates[0]
  const suggested = best && best.pitchOff <= SUGGEST_PITCH && best.diameterOff <= SUGGEST_DIAMETER ? best : null
  return { candidates, suggested }
}

/** The thread's depth a standard's basic profile would cut at a pitch, for
 *  the answer to set the reading against. */
export const basicDepth = (pitch: number, standard: ThreadStandard): number => round3(threadDepth(pitch, standard))

export const ALL_STANDARDS: readonly ThreadStandard[] = THREAD_STANDARDS.map((s) => s.id)

/** The least-squares line through the values taken out of them. */
function detrend(values: Float64Array): void {
  const n = values.length
  if (n < 2) return
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += values[i]
    sxx += i * i
    sxy += i * values[i]
  }
  const denom = n * sxx - sx * sx
  const slope = denom > 0 ? (n * sxy - sx * sy) / denom : 0
  const mean = sy / n
  const mid = sx / n
  for (let i = 0; i < n; i++) values[i] -= mean + slope * (i - mid)
}

