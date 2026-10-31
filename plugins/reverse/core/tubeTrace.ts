// SPDX-License-Identifier: AGPL-3.0-only
// A bent tube's centreline read from the scan. From a point and a way, the
// scan is cut square to the tube station by station, each cut's loop round the
// centre giving a centre and a size, until the loop is lost or its size jumps
// (a bellows, a flange, a junction): that is said, never crossed. The centres
// are then fitted as one chain of straights and tangent arcs, corners added
// where they stray most, and cut again square to the chain, which is what a
// bend's radius is read from: a plane through the bend's axis has the true
// section, the marching plane lags behind the bend and leans.

import { solveLinear } from '../../../src/core/fit/linalg'
import { sketchFrameOn } from '../../../src/core/section/frame'
import type { SectionCut } from '../../../src/core/section/slice'
import type { Vec3 } from '../../../src/core/types'
import { addScaled, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import { routePieces, type SweepRoute } from './sweepRoute'

export type TubeCutter = (origin: Vec3, normal: Vec3) => SectionCut | Promise<SectionCut>

export interface TubeStation {
  /** How far along the centres from the first, mm. */
  s: number
  at: Vec3
  /** The way the plane cut this station stood. */
  dir: Vec3
  /** Widest and narrowest across the loop's principal axes, mm. */
  major: number
  minor: number
  /** The widest way, in the plane. */
  majorDir: Vec3
  /** The diameter of a round of the loop's area, mm. */
  size: number
}

export type TubeStopKind = 'length' | 'lost' | 'open' | 'size' | 'centre'

export interface TubeStop {
  kind: TubeStopKind
  s: number
  at: Vec3
  says: string
}

/** A straight or a bend of the fitted chain, with the size of the tube there. */
export type TubeRun =
  | { kind: 'straight'; from: Vec3; to: Vec3; length: number; major: number; minor: number; rms: number }
  | { kind: 'bend'; corner: Vec3; radius: number; turnDeg: number; normal: Vec3; major: number; minor: number; rms: number }

export interface TubeTrace {
  stations: TubeStation[]
  /** Where it stopped and why: the one way, or with `both` the end the
   *  stations start from, then the end they run to. */
  stops: TubeStop[]
  /** Null with fewer than TRACE_MIN_STATIONS stations. */
  route: SweepRoute | null
  runs: TubeRun[]
  /** Station centres against the route, mm. */
  residual: { rms: number; max: number; at: Vec3 } | null
  warnings: string[]
  cuts: number
}

/** A loop's size off the running size by more than this share is a stop: no
 *  bent tube's section changes so much; a fold, a flange or a branch does. */
export const SIZE_JUMP = 0.15
/** Off by more than this share is said, and the trace goes on: a cuff. */
const SIZE_STEP = 0.04
/** A centre off where it was expected by more than this share of the size is
 *  a stop: the loop is another's, or the tube ended in a joint. */
const CENTRE_JUMP = 0.3
/** How many stations the running size is the median of. */
const RUNNING = 8
/** How many stations the next plane is reckoned from. */
const AHEAD = 6
/** Fewer stations than this are no centreline. */
const TRACE_MIN_STATIONS = 4
/** A bend is looked for between chords this many sizes long either side of a
 *  station, turned by more than BEND_SPAN_TURN_DEG: at half a size and 5°, a
 *  bend tighter than about six sizes in radius, clear of a surface's lumps. */
const BEND_SPAN = 0.5
const BEND_SPAN_TURN_DEG = 5
/** Corners at most: past this it is no chain of straights and bends. */
const MAX_CORNERS = 12
/** A fitted corner turning less than this is none, degrees. */
const MIN_TURN_DEG = 3
/** A corner has to bring the worst station down by this share to stay. */
const CORNER_GAIN = 0.2
/** How often the stations are cut again square to the fit. */
const RECUTS = 2
/** Worst station off the route over this, as a share of the size, is said. */
const RESIDUAL_WARN = 0.02

interface Round {
  at: Vec3
  major: number
  minor: number
  majorDir: Vec3
  size: number
}

/** The tube's loop on a cut through `at`: the smallest closed chain round it
 *  with its material on the inside — a scanned bore has it outside — or why
 *  there is none: an open chain near it, or nothing. */
function roundAt(cut: SectionCut, at: Vec3, normal: Vec3, near: number): Round | 'open' | 'none' {
  const frame = sketchFrameOn({ origin: at, normal })
  if (!frame) return 'none'
  const { basisU: u, basisV: v } = frame
  let best: { area: number; xy: Float64Array } | null = null
  let open = false
  for (let c = 0; c + 1 < cut.offsets.length; c++) {
    const from = cut.offsets[c]
    const n = cut.offsets[c + 1] - from
    if (n < 3) continue
    const xy = new Float64Array(n * 2)
    for (let i = 0; i < n; i++) {
      const d: Vec3 = [cut.points[(from + i) * 3] - at[0], cut.points[(from + i) * 3 + 1] - at[1], cut.points[(from + i) * 3 + 2] - at[2]]
      xy[i * 2] = dot(d, u)
      xy[i * 2 + 1] = dot(d, v)
    }
    const closed = xy[0] === xy[(n - 1) * 2] && xy[1] === xy[(n - 1) * 2 + 1]
    if (!closed) {
      for (let i = 0; i < n && !open; i++) if (Math.hypot(xy[i * 2], xy[i * 2 + 1]) < near) open = true
      continue
    }
    let inside = false
    let twice = 0
    for (let i = 0; i + 1 < n; i++) {
      const [x0, y0, x1, y1] = [xy[i * 2], xy[i * 2 + 1], xy[i * 2 + 2], xy[i * 2 + 3]]
      twice += x0 * y1 - x1 * y0
      if (y0 > 0 !== y1 > 0 && 0 < x0 - (y0 * (x1 - x0)) / (y1 - y0)) inside = !inside
    }
    if (!inside) continue
    // Which side the material is on, where the cut carries it.
    if (cut.normals && cut.normals.length === cut.points.length) {
      let outward = 0
      for (let i = 0; i < n; i++) outward += xy[i * 2] * dot([cut.normals[(from + i) * 3], cut.normals[(from + i) * 3 + 1], cut.normals[(from + i) * 3 + 2]], u) + xy[i * 2 + 1] * dot([cut.normals[(from + i) * 3], cut.normals[(from + i) * 3 + 1], cut.normals[(from + i) * 3 + 2]], v)
      if (outward < 0) continue
    }
    const area = Math.abs(twice) / 2
    if (!best || area < best.area) best = { area, xy }
  }
  if (!best) return open ? 'open' : 'none'
  // The loop's centre and principal axes, by its area's moments.
  const { xy } = best
  const n = xy.length / 2
  let a = 0
  let cx = 0
  let cy = 0
  let xx = 0
  let yy = 0
  let xy2 = 0
  for (let i = 0; i + 1 < n; i++) {
    const [x0, y0, x1, y1] = [xy[i * 2], xy[i * 2 + 1], xy[i * 2 + 2], xy[i * 2 + 3]]
    const w = x0 * y1 - x1 * y0
    a += w
    cx += (x0 + x1) * w
    cy += (y0 + y1) * w
    xx += (x0 * x0 + x0 * x1 + x1 * x1) * w
    yy += (y0 * y0 + y0 * y1 + y1 * y1) * w
    xy2 += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * w
  }
  a /= 2
  cx /= 6 * a
  cy /= 6 * a
  const mxx = xx / (12 * a) - cx * cx
  const myy = yy / (12 * a) - cy * cy
  const mxy = xy2 / (24 * a) - cx * cy
  const angle = 0.5 * Math.atan2(2 * mxy, mxx - myy)
  const [ex, ey] = [Math.cos(angle), Math.sin(angle)]
  let [lo1, hi1, lo2, hi2] = [Infinity, -Infinity, Infinity, -Infinity]
  for (let i = 0; i < n; i++) {
    const p = xy[i * 2] * ex + xy[i * 2 + 1] * ey
    const q = -xy[i * 2] * ey + xy[i * 2 + 1] * ex
    lo1 = Math.min(lo1, p)
    hi1 = Math.max(hi1, p)
    lo2 = Math.min(lo2, q)
    hi2 = Math.max(hi2, q)
  }
  const [w1, w2] = [hi1 - lo1, hi2 - lo2]
  const along = addScaled(scale(u, ex), v, ey)
  return {
    at: addScaled(addScaled(at, u, cx), v, cy),
    major: Math.max(w1, w2),
    minor: Math.min(w1, w2),
    majorDir: w1 >= w2 ? along : cross(normal, along),
    size: Math.sqrt((4 * Math.abs(a)) / Math.PI),
  }
}

const median = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]

/** Where the next plane stands, and which way: the last stations' centres as
 *  a parabola along s, read a step on. Before there are enough, straight on. */
function reckon(stations: readonly TubeStation[], way: Vec3, step: number): { at: Vec3; dir: Vec3 } {
  const last = stations[stations.length - 1]
  const n = Math.min(AHEAD, stations.length)
  if (n < 4) return { at: addScaled(last.at, way, step), dir: way }
  const recent = stations.slice(-n)
  const a = new Float64Array(9)
  const rhs = [new Float64Array(3), new Float64Array(3), new Float64Array(3)]
  for (const x of recent) {
    const t = x.s - last.s
    const row = [1, t, t * t]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) a[i * 3 + j] += row[i] * row[j]
      for (let k = 0; k < 3; k++) rhs[k][i] += row[i] * x.at[k]
    }
  }
  const fit = rhs.map((b) => solveLinear(3, a.slice(), b))
  if (fit.some((f) => !f)) return { at: addScaled(last.at, way, step), dir: way }
  const c = fit as Float64Array[]
  const dir = normalize([c[0][1] + 2 * c[0][2] * step, c[1][1] + 2 * c[1][2] * step, c[2][1] + 2 * c[2][2] * step]) ?? way
  return { at: addScaled(last.at, dir, step), dir }
}

// ---- the chain fitted ------------------------------------------------------

interface Corner {
  at: Vec3
  radius: number
  turn: number
  /** The arc's ends and centre; on a corner with no arc, all `at`. */
  enter: Vec3
  exit: Vec3
  centre: Vec3
}

interface Chain {
  ends: [Vec3, Vec3]
  corners: Corner[]
}

/** A chain from its points and radii. A radius too big for its straights is
 *  brought down to what they hold, with its neighbour's, so a fit passing
 *  through such a place still has a chain to measure. */
function chainOf(points: readonly Vec3[], radii: readonly number[]): Chain {
  const n = points.length
  const dirs: Vec3[] = []
  const runs: number[] = []
  for (let i = 0; i + 1 < n; i++) {
    const d = sub(points[i + 1], points[i])
    runs.push(len(d))
    dirs.push(normalize(d) ?? [1, 0, 0])
  }
  const turns = radii.map((_, j) => Math.acos(Math.max(-1, Math.min(1, dot(dirs[j], dirs[j + 1])))))
  const reach = radii.map((r, j) => Math.max(r, 0) * Math.tan(Math.min(turns[j], 3) / 2))
  for (let j = 0; j < radii.length; j++) {
    // The straight before this corner, shared with the corner before.
    const prev = j > 0 ? reach[j - 1] : 0
    const room = runs[j]
    if (prev + reach[j] > room) {
      const k = room / (prev + reach[j])
      if (j > 0) reach[j - 1] *= k
      reach[j] *= k
    }
    if (j === radii.length - 1 && reach[j] > runs[j + 1]) reach[j] = runs[j + 1]
  }
  const corners = radii.map((_, j): Corner => {
    const at = points[j + 1]
    const turn = turns[j]
    const slope = Math.tan(Math.min(turn, 3) / 2)
    const radius = slope > 1e-9 ? reach[j] / slope : 0
    const inward = normalize(sub(dirs[j + 1], dirs[j]))
    const enter = addScaled(at, dirs[j], -reach[j])
    const exit = addScaled(at, dirs[j + 1], reach[j])
    return { at, radius, turn, enter, exit, centre: inward ? addScaled(at, inward, radius / Math.max(Math.cos(turn / 2), 1e-6)) : at }
  })
  return { ends: [points[0], points[n - 1]], corners }
}

/** The nearest point of a segment to q; the chain's ends run on as lines. */
function onSegment(q: Vec3, a: Vec3, b: Vec3, openStart: boolean, openEnd: boolean): Vec3 {
  const d = sub(b, a)
  const l2 = dot(d, d)
  if (l2 < 1e-18) return a
  let t = dot(sub(q, a), d) / l2
  if (!openStart && t < 0) t = 0
  if (!openEnd && t > 1) t = 1
  return addScaled(a, d, t)
}

/** The nearest point of a corner's arc to q. */
function onArc(q: Vec3, c: Corner): Vec3 {
  const e1 = sub(c.enter, c.centre)
  const e2 = sub(c.exit, c.centre)
  const axis = normalize(cross(e1, e2))
  if (!axis || c.radius < 1e-9) return c.enter
  const flat = sub(q, c.centre)
  const inPlane = addScaled(flat, axis, -dot(flat, axis))
  const u = normalize(e1)!
  const v = cross(axis, u)
  let phi = Math.atan2(dot(inPlane, v), dot(inPlane, u))
  const sweep = c.turn
  if (phi < 0) phi = phi < (sweep - 2 * Math.PI) / 2 ? phi + 2 * Math.PI : 0
  if (phi > sweep) phi = phi - sweep < 2 * Math.PI - phi ? sweep : 0
  return addScaled(addScaled(c.centre, u, c.radius * Math.cos(phi)), v, c.radius * Math.sin(phi))
}

/** The chain's nearest point to q, the way it runs there, and on which piece:
 *  pieces count straight 0, corner 0, straight 1, corner 1, … */
function nearestOn(q: Vec3, chain: Chain): { at: Vec3; dir: Vec3; piece: number } {
  const { ends, corners } = chain
  let best: { at: Vec3; dir: Vec3; piece: number } | null = null
  let far = Infinity
  const take = (at: Vec3, dir: Vec3, piece: number) => {
    const d = len(sub(q, at))
    if (d < far) {
      far = d
      best = { at, dir, piece }
    }
  }
  for (let i = 0; i <= corners.length; i++) {
    const a = i === 0 ? ends[0] : corners[i - 1].exit
    const b = i === corners.length ? ends[1] : corners[i].enter
    const way = normalize(sub(b, a)) ?? normalize(sub(i === corners.length ? ends[1] : corners[i].at, i === 0 ? ends[0] : corners[i - 1].at)) ?? [1, 0, 0]
    take(onSegment(q, a, b, i === 0, i === corners.length), way, i * 2)
    if (i < corners.length) {
      const c = corners[i]
      const at = onArc(q, c)
      const axis = normalize(cross(sub(c.enter, c.centre), sub(c.exit, c.centre)))
      const out = axis ? normalize(cross(axis, sub(at, c.centre))) : null
      take(at, out ?? way, i * 2 + 1)
    }
  }
  return best!
}

/** The chain's points and radii brought nearer the centres by damped least
 *  squares over the three components of every centre's miss. */
function fitChain(centres: readonly Vec3[], points0: readonly Vec3[], radii0: readonly number[], floor: number, iterations = 25): { points: Vec3[]; radii: number[]; cost: number } {
  const unpack = (x: Float64Array) => {
    const points: Vec3[] = points0.map((_, i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]])
    return { points, radii: radii0.map((_, j) => Math.max(floor, x[points0.length * 3 + j])) }
  }
  const miss = (x: Float64Array) => {
    const { points, radii } = unpack(x)
    const chain = chainOf(points, radii)
    const out = new Float64Array(centres.length * 3)
    centres.forEach((c, i) => {
      const n = nearestOn(c, chain).at
      for (let k = 0; k < 3; k++) out[i * 3 + k] = c[k] - n[k]
    })
    return out
  }
  const size = points0.length * 3 + radii0.length
  const x = new Float64Array(size)
  points0.forEach((p, i) => x.set(p, i * 3))
  x.set(radii0, points0.length * 3)
  let r = miss(x)
  const sum = (v: Float64Array) => v.reduce((a, b) => a + b * b, 0)
  let cost = sum(r)
  let lambda = 1e-3
  const delta = 1e-3
  for (let it = 0; it < iterations; it++) {
    const jac: Float64Array[] = []
    for (let p = 0; p < size; p++) {
      const moved = x.slice()
      moved[p] += delta
      const rp = miss(moved)
      const col = new Float64Array(r.length)
      for (let i = 0; i < r.length; i++) col[i] = (rp[i] - r[i]) / delta
      jac.push(col)
    }
    const jtj = new Float64Array(size * size)
    const jtr = new Float64Array(size)
    for (let a = 0; a < size; a++) {
      for (let b = a; b < size; b++) {
        let v = 0
        for (let i = 0; i < r.length; i++) v += jac[a][i] * jac[b][i]
        jtj[a * size + b] = v
        jtj[b * size + a] = v
      }
      for (let i = 0; i < r.length; i++) jtr[a] -= jac[a][i] * r[i]
    }
    let better = false
    for (let tries = 0; tries < 8 && !better; tries++) {
      const damped = jtj.slice()
      for (let a = 0; a < size; a++) damped[a * size + a] += lambda * (jtj[a * size + a] + 1e-6)
      const step = solveLinear(size, damped, jtr.slice())
      if (step) {
        const next = x.slice()
        for (let a = 0; a < size; a++) next[a] += step[a]
        const rn = miss(next)
        const c = sum(rn)
        if (c < cost) {
          const done = cost - c < 1e-9 * cost
          x.set(next)
          r = rn
          cost = c
          lambda = Math.max(lambda / 3, 1e-9)
          better = true
          if (done) it = iterations
        }
      }
      if (!better) lambda *= 4
    }
    if (!better) break
  }
  return { ...unpack(x), cost }
}

/** Where a chain's ends lie: the first and last centres, on the straights. */
function endsOn(centres: readonly Vec3[], points: Vec3[], radii: readonly number[]): Vec3[] {
  const chain = chainOf(points, radii)
  const out = [...points]
  out[0] = nearestOn(centres[0], chain).at
  out[out.length - 1] = nearestOn(centres[centres.length - 1], chain).at
  return out
}

/** How far points lie off a route, by the chain's own measure; for checking
 *  one route against centres read for another. */
export function routeMiss(centres: readonly Vec3[], route: SweepRoute): { rms: number; max: number } {
  const radii = route.points.slice(1, -1).map((_, j) => route.radii?.[j] ?? route.bendRadius)
  const { rms, max } = missOf(centres, chainOf(route.points, radii))
  return { rms, max }
}

/** How far the centres lie off a chain: rms, worst, where. */
function missOf(centres: readonly Vec3[], chain: Chain): { rms: number; max: number; at: number } {
  let sum = 0
  let max = -1
  let at = 0
  centres.forEach((c, i) => {
    const d = len(sub(c, nearestOn(c, chain).at))
    sum += d * d
    if (d > max) {
      max = d
      at = i
    }
  })
  return { rms: Math.sqrt(sum / centres.length), max, at }
}

/** Where the centres turn: each run of stations turning faster than
 *  BEND_SPAN_TURN allows, as a corner where the straights either side of it
 *  meet, with the radius that brings the arc to the centre nearest the corner. */
function seedCorners(centres: readonly Vec3[], size: number): { points: Vec3[]; radii: number[] } {
  const n = centres.length
  const spacing = len(sub(centres[n - 1], centres[0])) / (n - 1)
  const span = Math.max(2, Math.round((BEND_SPAN * size) / Math.max(spacing, 1e-6)))
  const chord = (a: number, b: number) => normalize(sub(centres[Math.min(b, n - 1)], centres[Math.max(a, 0)]))
  const bending = centres.map((_, i) => {
    if (i === 0 || i === n - 1) return false
    const back = chord(i - span, i)
    const on = chord(i, i + span)
    if (!back || !on) return false
    return (Math.acos(Math.max(-1, Math.min(1, dot(back, on)))) * 180) / Math.PI > BEND_SPAN_TURN_DEG
  })
  const points: Vec3[] = [centres[0]]
  const radii: number[] = []
  for (let i = 0; i < n; i++) {
    if (!bending[i]) continue
    let j = i
    while (j + 1 < n && bending[j + 1]) j++
    const a = chord(i - span, i)
    const b = chord(j, j + span)
    if (a && b) {
      // Where the two lines come nearest.
      const w = sub(centres[i], centres[j])
      const [ab, aw, bw] = [dot(a, b), dot(a, w), dot(b, w)]
      const under = 1 - ab * ab
      const turn = Math.acos(Math.max(-1, Math.min(1, ab)))
      if (under > 1e-6 && (turn * 180) / Math.PI >= MIN_TURN_DEG) {
        const along = (ab * bw - aw) / under
        const on = (bw - ab * aw) / under
        const corner: Vec3 = addScaled(addScaled(centres[i], a, along), sub(addScaled(centres[j], b, on), addScaled(centres[i], a, along)), 0.5)
        const off = Math.min(...centres.slice(i, j + 1).map((c) => len(sub(c, corner))))
        const stand = 1 / Math.cos(Math.min(turn, 3) / 2) - 1
        points.push(corner)
        radii.push(stand > 1e-6 ? off / stand : size)
      }
    }
    i = j
  }
  points.push(centres[n - 1])
  return { points, radii }
}

/** The fewest corners that hold the centres: those they turn at, then one more
 *  where they stray most, for as long as that brings the worst down. */
function growChain(centres: readonly Vec3[], tolerance: number, size: number): { points: Vec3[]; radii: number[] } {
  const floor = size / 2
  const settle = (p: readonly Vec3[], r: readonly number[]) => {
    const fit = fitChain(centres, p, r, floor)
    return { points: endsOn(centres, fit.points, fit.radii), radii: fit.radii }
  }
  const seeded = seedCorners(centres, size)
  let { points, radii } = settle(seeded.points, seeded.radii)
  const firstRadius = size
  let held = missOf(centres, chainOf(points, radii))
  for (let n = 0; n < MAX_CORNERS && held.max > tolerance; n++) {
    const chain = chainOf(points, radii)
    const worst = centres[held.at]
    const piece = nearestOn(worst, chain).piece
    // On a straight, a corner within it; on an arc, the arc is two bends: the
    // new corner goes on the side of its middle the worst centre lies.
    const after = piece % 2 === 0 ? piece / 2 : (piece - 1) / 2 + (dot(sub(worst, chain.corners[(piece - 1) / 2].at), sub(chain.corners[(piece - 1) / 2].exit, chain.corners[(piece - 1) / 2].enter)) > 0 ? 1 : 0)
    const trial = settle([...points.slice(0, after + 1), worst, ...points.slice(after + 1)], [...radii.slice(0, after), firstRadius, ...radii.slice(after)])
    const chainNow = chainOf(trial.points, trial.radii)
    const kept = chainNow.corners.every((c) => (c.turn * 180) / Math.PI >= MIN_TURN_DEG)
    const now = missOf(centres, chainNow)
    if (!kept || now.max > held.max * (1 - CORNER_GAIN)) break
    points = trial.points
    radii = trial.radii
    held = now
  }
  return { points, radii }
}

// ---- the trace --------------------------------------------------------------

const r1 = (x: number) => Math.round(x * 10) / 10 || 0
const r3 = (x: number) => Math.round(x * 1000) / 1000 || 0
const atWords = (p: Vec3) => `(${p.map(r3).join(', ')})`

/**
 * Follow a tube from `start` the way `dir` goes, and with `both` the other way
 * too, until it ends or stops being one: see the top of the file. `stepMm` by
 * default an eighth of its size.
 */
export async function traceTube(cut: TubeCutter, input: { start: Vec3; dir: Vec3; both?: boolean; stepMm?: number; maxLengthMm?: number }): Promise<TubeTrace> {
  const way = normalize(input.dir)
  const warnings: string[] = []
  let cuts = 0
  const cutAt = async (origin: Vec3, normal: Vec3, near: number) => {
    cuts++
    return roundAt(await cut(origin, normal), origin, normal, near)
  }
  const empty = (kind: TubeStopKind, says: string, at: Vec3): TubeTrace => ({ stations: [], stops: [{ kind, s: 0, at, says }], route: null, runs: [], residual: null, warnings, cuts })
  if (!way) return empty('lost', 'dir has no length.', input.start)
  const first = await cutAt(input.start, way, Infinity)
  if (typeof first === 'string') return empty(first === 'open' ? 'open' : 'lost', first === 'open' ? `The scan cut square to dir at start ${atWords(input.start)} has an open chain and no closed loop round start: the tube's wall has a hole there. Start where it is whole.` : `No closed loop round start ${atWords(input.start)} on a plane square to dir: start has to lie inside the tube, dir along it.`, input.start)
  const step = input.stepMm ?? Math.max(0.25, first.size / 8)
  const maxLength = input.maxLengthMm ?? 3000
  const station0: TubeStation = { s: 0, at: first.at, dir: way, major: first.major, minor: first.minor, majorDir: first.majorDir, size: first.size }

  /** One way along the tube from the first station: the stations, it first,
   *  and where and why it stopped. */
  const march = async (going: Vec3): Promise<{ stations: TubeStation[]; stop: TubeStop }> => {
    const stations: TubeStation[] = [{ ...station0, dir: going }]
    let lastStep = -Infinity
    let dir = going
    for (;;) {
      const last = stations[stations.length - 1]
      // units-ok: the agent's answer, in the part's millimetres
      if (last.s + step > maxLength) return { stations, stop: { kind: 'length', s: last.s, at: last.at, says: `maxLengthMm: ${r1(maxLength)} mm followed and the tube goes on.` } }
      const ahead = reckon(stations, dir, step)
      const running = median(stations.slice(-RUNNING).map((x) => x.size))
      const found = await cutAt(ahead.at, ahead.dir, running)
      const s = last.s + step
      // units-ok: the agent's answer, in the part's millimetres
      const place = `${r1(s)} mm from the start, at ${atWords(ahead.at)}`
      if (found === 'open') return { stations, stop: { kind: 'open', s, at: ahead.at, says: `The wall is open ${place}: the scan has a hole or an edge there.` } }
      if (found === 'none') return { stations, stop: { kind: 'lost', s, at: ahead.at, says: `The loop is lost ${place}: nothing closed round the centreline, so the tube ends here, or turned tighter than the step follows.` } }
      const jump = found.size / running - 1
      // units-ok: the agent's answer, in the part's millimetres
      if (Math.abs(jump) > SIZE_JUMP) return { stations, stop: { kind: 'size', s, at: ahead.at, says: `The size jumps ${r1(running)} → ${r1(found.size)} mm (${r1(jump * 100)} %) ${place}: a flange, a bellows or a junction. The trace stops here, and does not cross it; start again past it for what follows.` } }
      const off = len(sub(found.at, ahead.at))
      // units-ok: the agent's answer, in the part's millimetres
      if (off > CENTRE_JUMP * running) return { stations, stop: { kind: 'centre', s, at: ahead.at, says: `The centre moves ${r1(off)} mm off its line ${place}: this loop is not the tube's, or a junction joins it. The trace stops here.` } }
      if (Math.abs(jump) > SIZE_STEP && s - lastStep > 4 * step) {
        // units-ok: the agent's answer, in the part's millimetres
        warnings.push(`The size goes ${r1(running)} → ${r1(found.size)} mm ${place}: a step in the tube (a cuff, a sleeve, a weld) the trace went through. One profile will not fit both sides.`)
        lastStep = s
      }
      dir = normalize(sub(found.at, last.at)) ?? ahead.dir
      stations.push({ s: last.s + len(sub(found.at, last.at)), at: found.at, dir: ahead.dir, major: found.major, minor: found.minor, majorDir: found.majorDir, size: found.size })
    }
  }

  const on = await march(way)
  const back = input.both ? await march(scale(way, -1)) : null
  // Run the whole of it one way: from the far end of the way back.
  const stations = back ? [...back.stations.slice(1).reverse().map((x) => ({ ...x, dir: scale(x.dir, -1) })), ...on.stations] : on.stations
  const stops = back ? [back.stop, on.stop] : [on.stop]
  if (stations.length < TRACE_MIN_STATIONS) {
    warnings.push(`Only ${stations.length} station${stations.length === 1 ? '' : 's'} before the stop: too few for a centreline.`)
    return { stations, stops, route: null, runs: [], residual: null, warnings, cuts }
  }
  // The chain from the march's centres; then the stations cut again square
  // to it, and it fitted again to those.
  const size = median(stations.map((x) => x.size))
  const tolerance = Math.max(0.1, 0.008 * size)
  let { points, radii } = growChain(
    stations.map((x) => x.at),
    tolerance,
    size,
  )
  for (let again = 0; again < RECUTS && radii.length > 0; again++) {
    const chain = chainOf(points, radii)
    for (let i = 0; i < stations.length; i++) {
      const there = nearestOn(stations[i].at, chain)
      const found = await cutAt(there.at, there.dir, size)
      if (typeof found === 'string' || Math.abs(found.size / size - 1) > SIZE_JUMP) continue
      stations[i] = { ...stations[i], at: found.at, dir: there.dir, major: found.major, minor: found.minor, majorDir: found.majorDir, size: found.size }
    }
    const fit = fitChain(
      stations.map((x) => x.at),
      points,
      radii,
      size / 2,
    )
    points = endsOn(
      stations.map((x) => x.at),
      fit.points,
      fit.radii,
    )
    radii = fit.radii
  }
  let s = 0
  stations.forEach((x, i) => {
    if (i > 0) s += len(sub(x.at, stations[i - 1].at))
    x.s = s
  })
  const chain = chainOf(points, radii)
  const centres = stations.map((x) => x.at)
  const held = missOf(centres, chain)
  // units-ok: the agent's answer, in the part's millimetres
  if (held.max > RESIDUAL_WARN * size) warnings.push(`A centre lies ${r3(held.max)} mm off the route ${r1(stations[held.at].s)} mm along, at ${atWords(stations[held.at].at)}: the tube is dented or lumped there, or it is no chain of straights and round bends. Check it by a section.`)
  // What goes out takes the radii the chain really has, each rounded a hair
  // down so that what it was fitted to still fits once rounded.
  const route: SweepRoute = { points: points.map((p) => p.map(r3) as Vec3), bendRadius: radii.length > 0 ? r3(median(chain.corners.map((c) => c.radius))) : r3(size), ...(radii.length > 0 ? { radii: chain.corners.map((c) => Math.floor(c.radius * 1000) / 1000) } : {}) }
  const made = routePieces(route, route.points[0])
  if (typeof made === 'string') warnings.push(`The route as rounded does not build: ${made}`)
  return {
    stations,
    stops,
    route,
    runs: runsOf(stations, chain),
    residual: { rms: r3(held.rms), max: r3(held.max), at: stations[held.at].at },
    warnings,
    cuts,
  }
}

/** The chain's straights and bends with the tube's size on each, the medians
 *  of the stations nearest it. */
function runsOf(stations: readonly TubeStation[], chain: Chain): TubeRun[] {
  const { corners, ends } = chain
  const on = new Map<number, TubeStation[]>()
  for (const x of stations) {
    const piece = nearestOn(x.at, chain).piece
    on.set(piece, [...(on.get(piece) ?? []), x])
  }
  const read = (piece: number) => {
    const here = on.get(piece) ?? []
    if (here.length === 0) return { major: 0, minor: 0, rms: 0 }
    const rms = Math.sqrt(here.reduce((sum, x) => sum + len(sub(x.at, nearestOn(x.at, chain).at)) ** 2, 0) / here.length)
    return { major: r3(median(here.map((x) => x.major))), minor: r3(median(here.map((x) => x.minor))), rms: r3(rms) }
  }
  const out: TubeRun[] = []
  for (let i = 0; i <= corners.length; i++) {
    const a = i === 0 ? ends[0] : corners[i - 1].exit
    const b = i === corners.length ? ends[1] : corners[i].enter
    if (len(sub(b, a)) > 1e-3) out.push({ kind: 'straight', from: a.map(r3) as Vec3, to: b.map(r3) as Vec3, length: r3(len(sub(b, a))), ...read(i * 2) })
    if (i === corners.length) continue
    const c = corners[i]
    const normal = normalize(cross(sub(c.enter, c.centre), sub(c.exit, c.centre))) ?? [0, 0, 1]
    out.push({ kind: 'bend', corner: c.at.map(r3) as Vec3, radius: r3(c.radius), turnDeg: r3((c.turn * 180) / Math.PI), normal: normal.map((x) => Math.round(x * 1e4) / 1e4 || 0) as Vec3, ...read(i * 2 + 1) })
  }
  return out
}
