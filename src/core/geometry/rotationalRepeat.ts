// SPDX-License-Identifier: AGPL-3.0-only
// Rotational repeats: how many times a cut square to an axis repeats itself
// going round it — a fan's blades, a flange's holes, a wheel's spokes — and
// how well each copy matches the others.
//
// The cut's outline is laid on a map of angle against radius, each cell
// holding the length of outline in it. A pattern of n copies turned by
// 360/n lands on itself, so the map's autocorrelation along the angle (read
// through an FFT, every radius summed) is high at every multiple of the
// pitch. For each count the mean autocorrelation at its n − 1 turns is its
// score: a count that divides the true one scores as well as it does and a
// multiple of it falls away, so the largest count near the best score is
// the one taken. Round outlines about the axis — a bore, a hub, a rim — are
// the same at every angle and say nothing of a count; they are found first
// (a band of radii the outline runs along all the way round), set apart and
// answered as rings with how far their centres lie off the axis.
//
// With the count known, the phase is where the n-th harmonic of the outline
// peaks, and each copy is the outline within half a pitch of its place. A
// copy is measured against the others turned onto it: for each point of its
// outline the distance to each other copy's outline, the median over the
// copies taken, so one copy that is off reads off and the rest do not.
//
// The cut comes as (u, v) chains in a plane square to the axis, the axis at
// [0, 0]; angles are from +u towards +v.

import type { EdgeChains } from '../flat/edges'
import { fitCircle2d } from '../fit/circle2d'

export interface RepeatOptions {
  /** Only the outline between these radii, mm. */
  minRadius?: number
  maxRadius?: number
  /** The most copies looked for. */
  maxCount?: number
}

export interface RepeatInstance {
  /** Where the middle of its outline lies, degrees from +u, 0 to 360. */
  angleDeg: number
  /** How far that is from where an even spacing puts it, degrees. */
  offDeg: number
  /** The middle's distance from the axis, mm. */
  radius: number
  /** How far its outline lies from the other copies' turned onto it, mm. */
  rms: number
  worst: number
  /** Its outline's length against the median copy's. */
  share: number
}

export interface RepeatRing {
  radius: number
  /** How far the circle's centre lies off the axis, mm, and which way. */
  off: number
  towardDeg: number
  rms: number
}

export interface RepeatResult {
  /** The copies found going round; 1 when nothing repeats. */
  count: number
  pitchDeg: number
  /** Where the first copy's middle lies, under one pitch. */
  phaseDeg: number
  /** How well the copies land on each other turned, 0 to 1. */
  score: number
  /** The best count when none was taken. */
  tried?: { count: number; score: number }
  instances: RepeatInstance[]
  rms: number
  worst: number
  worstInstance: number
  rings: RepeatRing[]
  /** The outline read, mm, rings and copies together. */
  length: number
}

/** Under this score no repeat is taken. */
export const REPEAT_MIN_SCORE = 0.5
/** A count is taken over a larger one only when that one scores below
 *  this share of the best. */
const NEAR_BEST = 0.85
const MAX_COUNT = 60
/** Angle bins round the map: a power of two for the FFT. */
const ANGLE_BINS = 1024
/** The blur along the angle, bins: copies a little out of place still land
 *  on each other. */
const BLUR_BINS = 2
/** A band of radii the outline covers this share of the way round, running
 *  along it, is a ring. */
const RING_COVER = 0.75
const RING_SECTORS = 180
/** How far either side of its radius a ring's band reaches, as a share of
 *  the radius: room for a circle off the axis. */
const RING_SLACK = 0.02
/** How far a copy's point looks for the others' outlines: a share of the
 *  radius, within bounds, mm. A point with nothing near reads that far. */
const REACH_SHARE = 0.02
const REACH_MIN = 0.3
const REACH_MAX = 2
/** How many points of the outline are measured against the others at most. */
const MEASURED = 6000

const TAU = 2 * Math.PI
const wrapPi = (a: number) => a - TAU * Math.round(a / TAU)

/** In-place radix-2 FFT of (re, im); `inverse` without the 1/n. */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inverse ? 1 : -1) * TAU) / len
    const wr = Math.cos(a)
    const wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const p = i + k
        const q = p + len / 2
        const tr = re[q] * cr - im[q] * ci
        const ti = re[q] * ci + im[q] * cr
        re[q] = re[p] - tr
        im[q] = im[p] - ti
        re[p] += tr
        im[p] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

/** How many times the cut repeats going round the axis, and how its copies
 *  match: see the head of the file. */
export function rotationalRepeat(cut: EdgeChains, opts: RepeatOptions = {}): RepeatResult {
  const minR = opts.minRadius ?? 0
  const maxR = opts.maxRadius ?? Infinity
  const maxCount = Math.max(2, Math.min(opts.maxCount ?? MAX_COUNT, ANGLE_BINS / 8))

  // The outline's segments whose middles lie in the band.
  const seg: number[] = []
  let length = 0
  let rLo = Infinity
  let rHi = -Infinity
  const { points, offsets } = cut
  for (let c = 0; c + 1 < offsets.length; c++) {
    for (let i = offsets[c]; i + 1 < offsets[c + 1]; i++) {
      const ax = points[2 * i], ay = points[2 * i + 1], bx = points[2 * i + 2], by = points[2 * i + 3]
      const l = Math.hypot(bx - ax, by - ay)
      const r = Math.hypot((ax + bx) / 2, (ay + by) / 2)
      if (!(l > 0) || r < minR || r > maxR) continue
      seg.push(ax, ay, bx, by)
      length += l
      rLo = Math.min(rLo, Math.hypot(ax, ay), Math.hypot(bx, by))
      rHi = Math.max(rHi, Math.hypot(ax, ay), Math.hypot(bx, by))
    }
  }
  const none = (tried?: { count: number; score: number }, rings: RepeatRing[] = []): RepeatResult => ({
    count: 1, pitchDeg: 360, phaseDeg: 0, score: 0, ...(tried ? { tried } : {}), instances: [], rms: 0, worst: 0, worstInstance: -1, rings, length,
  })
  if (seg.length < 4 * 8) return none()

  // The outline cut into short pieces, each a sample at its middle with
  // its length for a weight: short enough that a piece's middle stands for
  // it, few enough to measure every one.
  const span = Math.max(rHi - rLo, 1e-3)
  const step = Math.max(Math.min(0.25, span / 400), length / 400_000, 1e-3)
  const px: number[] = [], py: number[] = [], pw: number[] = []
  const pa: number[] = [], pb: number[] = [], pc: number[] = [], pd: number[] = []
  for (let s = 0; s < seg.length; s += 4) {
    const [ax, ay, bx, by] = [seg[s], seg[s + 1], seg[s + 2], seg[s + 3]]
    const l = Math.hypot(bx - ax, by - ay)
    const k = Math.max(1, Math.ceil(l / step))
    for (let j = 0; j < k; j++) {
      const x0 = ax + ((bx - ax) * j) / k, y0 = ay + ((by - ay) * j) / k
      const x1 = ax + ((bx - ax) * (j + 1)) / k, y1 = ay + ((by - ay) * (j + 1)) / k
      px.push((x0 + x1) / 2)
      py.push((y0 + y1) / 2)
      pw.push(l / k)
      pa.push(x0); pb.push(y0); pc.push(x1); pd.push(y1)
    }
  }
  const n = px.length
  const pr = new Float64Array(n)
  const pt = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    pr[i] = Math.hypot(px[i], py[i])
    pt[i] = Math.atan2(py[i], px[i])
  }

  // Rings: bands of radii the outline covers most of the way round,
  // running along them (square to the radius), a band either side taken
  // in so a circle a little off the axis still fills its band.
  const ringBins = Math.max(1, Math.min(200, Math.ceil(span / Math.max(0.1, span / 100))))
  const rw = span / ringBins
  const binR = (r: number) => Math.min(ringBins - 1, Math.max(0, Math.floor((r - rLo) / rw)))
  const along = new Uint8Array(n)
  const covered: Set<number>[] = Array.from({ length: ringBins }, () => new Set())
  for (let i = 0; i < n; i++) {
    const tx = pc[i] - pa[i], ty = pd[i] - pb[i]
    const tl = Math.hypot(tx, ty)
    // Running square to the radius: within 30° of the circle through it.
    if (pr[i] > 0 && tl > 0 && Math.abs(tx * px[i] + ty * py[i]) / (tl * pr[i]) < 0.5) {
      along[i] = 1
      covered[binR(pr[i])].add(Math.floor(((pt[i] + Math.PI) / TAU) * RING_SECTORS) % RING_SECTORS)
    }
  }
  const isRingBin = new Uint8Array(ringBins)
  for (let b = 0; b < ringBins; b++) {
    // The band taken in either side: a bin, or 2 % of the radius where
    // that is more — a circle 0.6 mm off the axis at 30 mm stays in it.
    const wide = Math.max(1, Math.ceil((RING_SLACK * (rLo + (b + 0.5) * rw)) / rw))
    const seen = new Set<number>()
    for (let d = -wide; d <= wide; d++) for (const s of covered[b + d] ?? []) seen.add(s)
    if (seen.size >= RING_COVER * RING_SECTORS) isRingBin[b] = 1
  }
  const ringOf = new Int32Array(n).fill(-1)
  const ringRuns: [number, number][] = []
  for (let b = 0; b < ringBins; b++) {
    if (!isRingBin[b]) continue
    const last = ringRuns[ringRuns.length - 1]
    if (last && last[1] === b - 1) last[1] = b
    else ringRuns.push([b, b])
  }
  const runOfBin = new Int32Array(ringBins).fill(-1)
  ringRuns.forEach(([a, b], k) => {
    for (let i = a; i <= b; i++) runOfBin[i] = k
  })
  for (let i = 0; i < n; i++) if (along[i] && runOfBin[binR(pr[i])] >= 0) ringOf[i] = runOfBin[binR(pr[i])]
  const rings: RepeatRing[] = []
  ringRuns.forEach((_, k) => {
    const us: number[] = [], vs: number[] = []
    for (let i = 0; i < n; i++) if (ringOf[i] === k) {
      us.push(px[i])
      vs.push(py[i])
    }
    const c = us.length >= 8 ? fitCircle2d(us, vs) : null
    if (!c || !Number.isFinite(c.r)) return
    let ss = 0
    for (let i = 0; i < us.length; i++) ss += (Math.hypot(us[i] - c.cu, vs[i] - c.cv) - c.r) ** 2
    rings.push({ radius: c.r, off: Math.hypot(c.cu, c.cv), towardDeg: (((Math.atan2(c.cv, c.cu) * 180) / Math.PI) + 360) % 360, rms: Math.sqrt(ss / us.length) })
  })
  rings.sort((a, b) => a.radius - b.radius)

  // The map of angle against radius over the rest, each radius less its
  // mean round the circle, and the autocorrelation along the angle.
  const kept: number[] = []
  for (let i = 0; i < n; i++) if (ringOf[i] < 0) kept.push(i)
  if (kept.length < 8) return none(undefined, rings)
  const mapBins = Math.max(1, Math.min(128, ringBins))
  const mw = span / mapBins
  const map = Array.from({ length: mapBins }, () => new Float64Array(ANGLE_BINS))
  for (const i of kept) {
    const t = (((pt[i] / TAU) * ANGLE_BINS) % ANGLE_BINS + ANGLE_BINS) % ANGLE_BINS
    const t0 = Math.floor(t)
    const f = t - t0
    // A piece's middle may lie a hair inside its ends' radii.
    const row = map[Math.min(mapBins - 1, Math.max(0, Math.floor((pr[i] - rLo) / mw)))]
    row[t0 % ANGLE_BINS] += pw[i] * (1 - f)
    row[(t0 + 1) % ANGLE_BINS] += pw[i] * f
  }
  const power = new Float64Array(ANGLE_BINS)
  const re = new Float64Array(ANGLE_BINS)
  const im = new Float64Array(ANGLE_BINS)
  for (const row of map) {
    let mean = 0
    for (let t = 0; t < ANGLE_BINS; t++) mean += row[t] / ANGLE_BINS
    for (let t = 0; t < ANGLE_BINS; t++) {
      re[t] = row[t] - mean
      im[t] = 0
    }
    fft(re, im)
    for (let k = 0; k < ANGLE_BINS; k++) power[k] += re[k] * re[k] + im[k] * im[k]
  }
  for (let k = 0; k < ANGLE_BINS; k++) {
    const f = Math.min(k, ANGLE_BINS - k)
    re[k] = power[k] * Math.exp(-(((TAU * f * BLUR_BINS) / ANGLE_BINS) ** 2))
    im[k] = 0
  }
  fft(re, im, true)
  const ac0 = re[0]
  if (!(ac0 > 1e-12 * length * length)) return none(undefined, rings)
  const acAt = (s: number) => {
    const t = ((s % ANGLE_BINS) + ANGLE_BINS) % ANGLE_BINS
    const t0 = Math.floor(t)
    const f = t - t0
    return (re[t0 % ANGLE_BINS] * (1 - f) + re[(t0 + 1) % ANGLE_BINS] * f) / ac0
  }
  const scores: number[] = []
  for (let c = 2; c <= maxCount; c++) {
    let s = 0
    for (let j = 1; j < c; j++) s += acAt((j * ANGLE_BINS) / c)
    scores[c] = s / (c - 1)
  }
  let best = 2
  for (let c = 3; c <= maxCount; c++) if (scores[c] > scores[best]) best = c
  if (scores[best] < REPEAT_MIN_SCORE) return none({ count: best, score: scores[best] }, rings)
  let count = best
  for (let c = maxCount; c > best; c--) {
    if (scores[c] >= Math.max(REPEAT_MIN_SCORE, NEAR_BEST * scores[best])) {
      count = c
      break
    }
  }
  const pitch = TAU / count

  // The phase: where the outline's count-th harmonic peaks.
  let zr = 0, zi = 0
  for (const i of kept) {
    zr += pw[i] * Math.cos(count * pt[i])
    zi += pw[i] * Math.sin(count * pt[i])
  }
  let phase = (((Math.atan2(zi, zr) / count) % pitch) + pitch) % pitch

  // Each piece to the copy whose place is nearest, and how far round from
  // it; those in the outer quarter of a pitch also stand in for the next
  // copy, turned, when the others are measured against it.
  const copyOf = new Int32Array(n).fill(-1)
  const offOf = new Float64Array(n)
  for (const i of kept) {
    const rel = wrapPi(pt[i] - phase)
    const k = Math.round(rel / pitch)
    copyOf[i] = ((k % count) + count) % count
    offOf[i] = rel - k * pitch
  }
  const lengths = new Float64Array(count)
  const sx = new Float64Array(count)
  const sy = new Float64Array(count)
  for (const i of kept) {
    const k = copyOf[i]
    lengths[k] += pw[i]
    sx[k] += pw[i] * px[i]
    sy[k] += pw[i] * py[i]
  }
  // The harmonic's peak and the middles of the copies' outlines differ by
  // as much as a copy is lopsided: the phase is moved onto the middles,
  // their mean, so each copy's offset is its own.
  let mr = 0, mi = 0
  for (let k = 0; k < count; k++) {
    if (!(lengths[k] > 0)) continue
    const d = wrapPi(Math.atan2(sy[k], sx[k]) - phase - k * pitch)
    mr += lengths[k] * Math.cos(d)
    mi += lengths[k] * Math.sin(d)
  }
  // Kept under a pitch, the copies' numbers moved round with it (`turned`
  // places on).
  const raw = phase + Math.atan2(mi, mr)
  const turned = Math.floor(raw / pitch)
  phase = raw - turned * pitch
  const typical = median(Array.from(lengths))
  const meanR = kept.reduce((s, i) => s + pw[i] * pr[i], 0) / kept.reduce((s, i) => s + pw[i], 0)
  const reach = Math.min(REACH_MAX, Math.max(REACH_MIN, REACH_SHARE * meanR))

  // The pieces turned back onto the first copy's place, in a grid of cells
  // `reach` wide, each tagged with the copy it came from.
  const grid = new Map<string, number[]>()
  const tagged: { k: number; a: number; b: number; c: number; d: number }[] = []
  const turn = (x: number, y: number, by: number): [number, number] => [x * Math.cos(by) - y * Math.sin(by), x * Math.sin(by) + y * Math.cos(by)]
  const place = (i: number, k: number) => {
    const by = -k * pitch
    const [a, b] = turn(pa[i], pb[i], by)
    const [c, d] = turn(pc[i], pd[i], by)
    const id = tagged.length
    tagged.push({ k, a, b, c, d })
    const x0 = Math.floor(Math.min(a, c) / reach), x1 = Math.floor(Math.max(a, c) / reach)
    const y0 = Math.floor(Math.min(b, d) / reach), y1 = Math.floor(Math.max(b, d) / reach)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = `${x},${y}`
      const list = grid.get(key)
      if (list) list.push(id)
      else grid.set(key, [id])
    }
  }
  for (const i of kept) {
    const k = copyOf[i]
    place(i, k)
    if (Math.abs(offOf[i]) >= pitch / 4) place(i, (k + (offOf[i] > 0 ? 1 : -1) + count) % count)
  }

  // Measured at every few pieces at most: enough to read a copy by, few
  // enough to answer at once.
  const stride = Math.max(1, Math.ceil(kept.length / MEASURED))
  const sumSq = new Float64Array(count)
  const measured = new Float64Array(count)
  const worstOf = new Float64Array(count)
  const nearest = new Float64Array(count)
  for (let q = 0; q < kept.length; q += stride) {
    const i = kept[q]
    const k = copyOf[i]
    const [x, y] = turn(px[i], py[i], -k * pitch)
    nearest.fill(reach)
    const gx = Math.floor(x / reach), gy = Math.floor(y / reach)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        const t = tagged[id]
        if (t.k === k) continue
        const d = toSegment(x, y, t.a, t.b, t.c, t.d)
        if (d < nearest[t.k]) nearest[t.k] = d
      }
    }
    const others: number[] = []
    for (let j = 0; j < count; j++) if (j !== k) others.push(nearest[j])
    const d = median(others)
    sumSq[k] += pw[i] * d * d
    measured[k] += pw[i]
    worstOf[k] = Math.max(worstOf[k], d)
  }

  const instances: RepeatInstance[] = []
  let all = 0
  let weight = 0
  let worst = 0
  let worstInstance = 0
  for (let k = 0; k < count; k++) {
    // The copy at phase + k pitches, as the pieces were numbered.
    const o = (((k - turned) % count) + count) % count
    const l = lengths[o]
    const cx = l > 0 ? sx[o] / l : 0
    const cy = l > 0 ? sy[o] / l : 0
    const angle = Math.atan2(cy, cx)
    const ideal = phase + k * pitch
    instances.push({
      angleDeg: (((angle * 180) / Math.PI) + 360) % 360,
      offDeg: l > 0 ? (wrapPi(angle - ideal) * 180) / Math.PI : 0,
      radius: Math.hypot(cx, cy),
      rms: measured[o] > 0 ? Math.sqrt(sumSq[o] / measured[o]) : reach,
      worst: measured[o] > 0 ? worstOf[o] : reach,
      share: typical > 0 ? l / typical : 0,
    })
    all += sumSq[o]
    weight += measured[o]
    if (worstOf[o] > worst) {
      worst = worstOf[o]
      worstInstance = k
    }
  }
  return {
    count,
    pitchDeg: 360 / count,
    phaseDeg: (phase * 180) / Math.PI,
    score: scores[count],
    instances,
    rms: weight > 0 ? Math.sqrt(all / weight) : 0,
    worst,
    worstInstance,
    rings,
    length,
  }
}
