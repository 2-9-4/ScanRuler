// SPDX-License-Identifier: AGPL-3.0-only
// A slice chain cut into lines and arcs — the mesh sketch's first move. A
// section through a part comes back as one polyline per outline, a point
// every fraction of a millimetre, noisy as the scan is; the sketch wants a
// dozen pieces with the slice points kept behind each one as the soft data
// the solver pulls it towards (see solver.ts).
//
// The cut is made in passes. Ramer–Douglas–Peucker at the noise tolerance
// marks the corners and lays chords along the curves; then neighbouring
// runs are merged, best first, as long as one line — or, failing that, one
// arc — still explains the joined points, until nothing merges. The chords
// of a fillet merge into its arc, the pieces of a straight side into its
// line, and a corner stays a corner because no one piece fits across it.
// The boundaries between a line and an arc are slid to where the residuals
// say; what is left under a short length is asked about (the dissolve
// pass); and a last look at every piece asks whether the other kind
// explains it better.
//
// What "explains" means is where a real slice differs from a clean outline,
// and it is three things. The σ of the run, which alone lets a long side
// swallow half a fillet. The worst stretch — the mean miss over a few
// points in a row — which a long run cannot average away. And the heading:
// the chain has to come into a piece and leave it along the piece. An arc
// is held to the noise tolerance and a line to a wave tolerance several
// times that (detailLevels), because a scanned wall bows and wanders and a
// round does not.
//
// The noise tolerance is the chain's own scatter, measured off it, unless
// the operator sets one: the same rule serves a clean CAD tessellation and
// a rough hand scan. The detail setting says how much of a wall's wander is
// the wall.

import { FitError } from '../../../src/core/fit/errors'
import { fitArcPoints, fitCirclePoints, fitLinePoints } from '../../../src/core/flat/fit'
import { simplifyRun } from '../../../src/core/flat/simplify'
import type { EdgeChains } from '../../../src/core/flat/edges'
import type { FlatArcFit, FlatLineFit, Vec2 } from '../../../src/core/flat/types'
import { len2, sub2 } from '../../../src/core/flat/vec2'
import { addEntity, unwindAngle, type AnchorAt, type Sketch, type SketchArc, type SketchLine } from './sketch'
import { viewChain } from '../../../src/core/flat/grow'

/** One piece of the chain, over the run of chain points [lo, hi]. */
export interface ChainSegment {
  kind: 'line' | 'arc'
  lo: number
  hi: number
  points: Vec2[]
  fit: FlatLineFit | FlatArcFit
  /** A piece was dropped between this one and the next — a blob in the
   *  corner — and the two make the corner between them. */
  cornerAfter?: boolean
}

export interface SegmentedChain {
  segments: ChainSegment[]
  /** The chain as segmented: a loop's closing duplicate dropped. */
  points: Vec2[]
  closed: boolean
  /** The chain's scatter and point spacing, millimetres. */
  scatter: number
  spacing: number
  /** The tolerance the cut was made at. */
  tolerance: number
}

export interface SegmentOptions {
  /** Millimetres a piece may miss its points by; the chain's scatter says
   *  otherwise. A typed tolerance is taken as it stands — `detail` scales
   *  only the one read off the chain. */
  tolerance?: number
  /** How fine the cut is, 0 (coarse: few, long pieces) to 1 (fine: every
   *  small feature its own piece). It sets how far a straight side may
   *  wander and still be one line, and how short a piece may be — see
   *  `detailLevels`. */
  detail?: number
  /** Pieces of fewer points are folded into a neighbour. */
  minPoints?: number
  /** A piece shorter than this, millimetres, that only cuts a corner its
   *  neighbours make by themselves is dropped; a multiple of the tolerance
   *  otherwise. */
  minLength?: number
}

/** How many scatters the default tolerance is. */
const TOLERANCE_SCATTERS = 3
/** The tolerance floor as a share of the point spacing. */
const TOLERANCE_SPACING = 0.6
/** An arc has to cover this much to be an arc rather than a bowed line. */
const MIN_SWEEP = (6 * Math.PI) / 180
/** A line is made an arc when a circle explains it this much better, at a
 *  radius under this many line lengths — see flat/grow.ts. */
const LINE_ARC_F_CRIT = 16
const LINE_ARC_RADIUS_LENGTHS = 20
/** The F test makes an arc of a line only when the arc turns at least this
 *  far: the test is there for a short line laid on a tight round, and a
 *  long side that bows a few degrees is a side that bows, not an arc. */
const LINE_ARC_MIN_SWEEP = (20 * Math.PI) / 180
/** — unless it bows by this many noise tolerances: a wall wanders by a few
 *  of them, and a millimetre's bow under 0.04 mm of noise is a curve the
 *  part was drawn with — the R400 underside of a moulding, the R177 side
 *  of a housing — whatever little it turns. */
const CURVE_BULGES = 5
/** How far a straight side may wander, in tolerances: at the middle of the
 *  detail setting, and at its coarse end — once at the fine end. The coarse
 *  end is not far above the middle: what goes with a wave tolerance of half
 *  a millimetre is every feature of two, and a part has those. */
const WAVE_MIDDLE = 3
const WAVE_COARSE = 5
/** A line has its whole waviness from this many wave tolerances of length
 *  up, and the noise tolerance alone at none: wandering is what a long wall
 *  does, and a stub a millimetre long that misses by a quarter of one is
 *  not a line. */
const WAVE_LENGTHS = 20
/** How far the chain's heading at either end of a run may be off the
 *  tangent of the arc fitted to it — see `runsAlong`. */
const ARC_END_HEADING = (20 * Math.PI) / 180
/** A turn under this is no turn, when an arc's two halves are asked whether
 *  they turn the same way. */
const ARC_TURN_NOISE = (8 * Math.PI) / 180
const ARC_TURN_ASKED = (170 * Math.PI) / 180
const ARC_TURN_SLACK = (35 * Math.PI) / 180
/** The same for a line — see `headsAlong`. */
const LINE_END_HEADING = (15 * Math.PI) / 180
/** A piece is judged over this many points in a row — see `worstMiss`. */
const DEPART_WINDOW = 5
/** An arc may leave its points by this many tolerances over such a stretch. */
const ARC_DEPART = 2.5
/** A piece under this many wave tolerances long is looked at as a possible
 *  corner-cutter — see the dissolve pass. */
const SHORT_WAVES = 5
/** An arc that turns less than SHALLOW_SWEEP has to bulge this many wave
 *  tolerances to be an arc: under that it is a wall that bows, and a wall
 *  is a line — see `settle`. */
const SHALLOW_SWEEP = (30 * Math.PI) / 180
const SHALLOW_BULGES = 3
/** A piece no line and no arc explains is asked about up to this many short
 *  lengths: what is left of a corner once its sides are fitted, a ramp of
 *  weld or dirt, is longer than a stub and as little a feature. */
const UNEXPLAINED_SHORTS = 3
/** An arc that turns this far is a fillet however short it is — given the
 *  points to say so: five points round a corner are a corner the scanner
 *  rounded, and fit a circle because any five points do. */
const SHORT_ARC_SWEEP = (50 * Math.PI) / 180
const SHORT_ARC_POINTS = 8
/** — and a radius of at least this many wave tolerances: a lump the size of
 *  what a wall may wander by is a lump. */
const SHORT_ARC_WAVES = 3
/** Two lines under this angle have no corner between them. */
const MEET_PARALLEL = Math.sin((8 * Math.PI) / 180)

/** What a piece is held to: an arc to the noise, a line to the waviness. */
interface Tolerances {
  line: number
  arc: number
}
const ANYTHING: Tolerances = { line: Infinity, arc: Infinity }

/**
 * What a detail setting means at a noise tolerance. A scanned wall is not
 * straight: sheet metal bows, a print sags, a blob in a corner lifts the
 * last millimetres of a side — by several times the noise, over a long
 * stretch. A single tolerance cannot serve both: tight enough to keep a
 * fillet apart from its sides it chops a bowed wall into shallow arcs, and
 * loose enough for the wall it lets one arc swallow a fillet and both its
 * sides. So an arc is held to the noise tolerance — a round is a small
 * thing, measured well — and a line to `wave`, the detail setting's
 * multiple of it; pieces under `short` are the ones the dissolve pass asks
 * about.
 */
export function detailLevels(tolerance: number, detail = 0.5): { wave: number; arc: number; short: number } {
  const d = Math.min(1, Math.max(0, Number.isFinite(detail) ? detail : 0.5))
  const factor = d >= 0.5 ? Math.pow(WAVE_MIDDLE, 2 * (1 - d)) : WAVE_MIDDLE + (WAVE_COARSE - WAVE_MIDDLE) * (1 - 2 * d)
  const wave = tolerance * factor
  return { wave, arc: tolerance, short: SHORT_WAVES * wave }
}

/** The chain's spacing and scatter, the way flat/grow.ts reads them, and
 *  its points as copies of its own. */
export function chainStatistics(chain: readonly Vec2[]): { spacing: number; scatter: number; closed: boolean; points: Vec2[] } {
  const { spacing, scatter, closed, points } = viewChain(chain)
  return { spacing, scatter, closed, points: points.map((p): Vec2 => [p[0], p[1]]) }
}

function tryFit<R>(fit: (points: readonly Vec2[]) => R, points: readonly Vec2[]): R | null {
  try {
    return fit(points)
  } catch (e) {
    if (e instanceof FitError) return null
    throw e
  }
}

/** The line fit of a run, or null; a run of two points is a line by
 *  definition and gets a zero-residual fit. */
function lineOf(points: readonly Vec2[]): FlatLineFit | null {
  return points.length >= 2 ? tryFit(fitLinePoints, points) : null
}

function arcOf(points: readonly Vec2[]): FlatArcFit | null {
  if (points.length < 5) return null
  const arc = tryFit(fitArcPoints, points)
  if (!arc || !(arc.sweep >= MIN_SWEEP) || !Number.isFinite(arc.radius)) return null
  return arc
}

type Piece = { kind: 'line'; fit: FlatLineFit } | { kind: 'arc'; fit: FlatArcFit }

/**
 * How far a piece leaves its points: the largest mean signed miss over any
 * DEPART_WINDOW points in a row. The fit's σ is an average
 * over the whole run, and a long side averages away anything short — a line
 * of five hundred points takes half a fillet on board and its σ hardly
 * moves, which is how a corner's round went missing and the side overshot
 * the corner. A stretch of points all off to one side is another feature,
 * however long the rest of the run; one stray point is not, which is why it
 * is the mean of a few and not the largest miss.
 */
function worstMiss(points: readonly Vec2[], piece: Piece): number {
  const n = points.length
  const w = Math.min(DEPART_WINDOW, n)
  const miss = new Float64Array(n)
  if (piece.kind === 'line') {
    const { center, dir } = piece.fit
    for (let i = 0; i < n; i++) miss[i] = (points[i][0] - center[0]) * -dir[1] + (points[i][1] - center[1]) * dir[0]
  } else {
    const { center, radius } = piece.fit
    for (let i = 0; i < n; i++) miss[i] = Math.hypot(points[i][0] - center[0], points[i][1] - center[1]) - radius
  }
  let sum = 0
  let worst = 0
  for (let i = 0; i < n; i++) {
    sum += miss[i]
    if (i >= w) sum -= miss[i - w]
    if (i >= w - 1 && Math.abs(sum) > worst * w) worst = Math.abs(sum) / w
  }
  return worst
}

/**
 * Whether the chain comes into an arc and leaves it along the arc. A circle
 * fits things that are no arc well enough to pass on its σ: the riser of a
 * small step — down, across, down, an S a millimetre tall — comes out as
 * half a turn bulging out of the corner, and a fillet with a stretch of its
 * side on board as a round of twice the radius. Both give themselves away
 * at their ends, where the chain heads one way and the circle another: on
 * the rounds of a real part the two agree within ten degrees, on these they
 * are off by twenty-five and more. The chord over the first and the last
 * few points is the chain's heading there.
 */
function runsAlong(points: readonly Vec2[], arc: FlatArcFit): boolean {
  const n = points.length
  const k = Math.max(1, Math.min(4, Math.floor(n / 4)))
  const off = (a: Vec2, b: Vec2): number => {
    const chord = sub2(b, a)
    const radial: Vec2 = [(a[0] + b[0]) / 2 - arc.center[0], (a[1] + b[1]) / 2 - arc.center[1]]
    const lc = len2(chord)
    const lr = len2(radial)
    if (lc < 1e-12 || lr < 1e-12) return 0
    // The tangent is square to the radius: the chord's share along the
    // radius is the sine of how far off it heads.
    return Math.asin(Math.min(1, Math.abs(chord[0] * radial[0] + chord[1] * radial[1]) / (lc * lr)))
  }
  if (off(points[0], points[k]) > ARC_END_HEADING || off(points[n - 1 - k], points[n - 1]) > ARC_END_HEADING) return false
  // And it turns one way throughout: an S turns into its middle one way and
  // out of it the other, and an arc laid through it that happens to leave
  // along both ends is still no arc. Turns under a few degrees are noise.
  const mid = n >> 1
  const head = sub2(points[k], points[0])
  const middle = sub2(points[Math.min(n - 1, mid + k)], points[Math.max(0, mid - k)])
  const tail = sub2(points[n - 1], points[n - 1 - k])
  const turn = (a: Vec2, b: Vec2): number => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])
  const into = turn(head, middle)
  const out = turn(middle, tail)
  if (Math.abs(into) > ARC_TURN_NOISE && Math.abs(out) > ARC_TURN_NOISE && into * out < 0) return false
  // And by as much as the arc says: the riser of a step leaves heading the
  // way it came in, whatever half-turn a circle through it claims. Past
  // half a turn the chords cannot say, and nothing is asked.
  const claimed = arc.sweep * (1 - k / n)
  if (claimed > ARC_TURN_ASKED) return true
  return Math.abs(Math.abs(turn(head, tail)) - claimed) <= ARC_TURN_SLACK
}

/**
 * Whether the chain comes into a line and leaves it along the line. What a
 * side is allowed for its waviness is room a fillet fits into: a side may
 * run a third of the way round the corner before it has missed by as much,
 * and with both sides doing so nothing is left of the round. But a wall
 * that wanders keeps its heading within a few degrees, and a side that has
 * started round a corner has not — so a line ends where the chain stops
 * heading its way, whatever the miss.
 */
function headsAlong(points: readonly Vec2[], line: FlatLineFit): boolean {
  const n = points.length
  const k = Math.max(1, Math.min(4, Math.floor(n / 4)))
  const off = (a: Vec2, b: Vec2): number => {
    const chord = sub2(b, a)
    const lc = len2(chord)
    if (lc < 1e-12) return 0
    return Math.asin(Math.min(1, Math.abs(chord[0] * -line.dir[1] + chord[1] * line.dir[0]) / lc))
  }
  return off(points[0], points[k]) <= LINE_END_HEADING && off(points[n - 1 - k], points[n - 1]) <= LINE_END_HEADING
}

/** A piece and how well it sits: the larger of its σ and its worst stretch
 *  as a share of what it is allowed — under one is a fit. */
interface Judged {
  piece: Piece
  score: number
}

/** The better piece for a run: a line if one will do, an arc if not, null
 *  if neither. A line's σ is held to half its waviness — a side that bows
 *  by the whole of it end to end is within it, one that misses by it all
 *  along is not the side. */
function judgedPieceOf(points: readonly Vec2[], tol: Tolerances): Judged | null {
  const line = lineOf(points)
  if (line) {
    const piece: Piece = { kind: 'line', fit: line }
    if (tol.line === Infinity) return { piece, score: 0 }
    const allowed = tol.arc + (tol.line - tol.arc) * Math.min(1, line.length / (WAVE_LENGTHS * tol.line))
    if (line.sigma <= allowed / 2 && headsAlong(points, line)) {
      const worst = worstMiss(points, piece)
      if (worst <= allowed) return { piece, score: Math.max((2 * line.sigma) / allowed, worst / allowed) }
    }
  }
  const arc = arcOf(points)
  if (arc) {
    const piece: Piece = { kind: 'arc', fit: arc }
    if (tol.arc === Infinity) return { piece, score: 0 }
    if (arc.sigma <= tol.arc && runsAlong(points, arc)) {
      const worst = worstMiss(points, piece)
      if (worst <= ARC_DEPART * tol.arc) return { piece, score: Math.max(arc.sigma / tol.arc, worst / (ARC_DEPART * tol.arc)) }
    }
  }
  return null
}

function pieceOf(points: readonly Vec2[], tol: Tolerances): Piece | null {
  return judgedPieceOf(points, tol)?.piece ?? null
}

/** The fit of a run as one kind, whatever its residual. */
function fitAs(points: readonly Vec2[], kind: 'line' | 'arc'): FlatLineFit | FlatArcFit | null {
  return kind === 'line' ? lineOf(points) : arcOf(points)
}

/** What a run is: a line if one explains it at the tolerance — unless a
 *  circle of a few line lengths explains it significantly better, the F test
 *  flat/grow.ts uses, which gives away a short line on a tight arc whose σ
 *  the noise could have covered — else an arc, else whichever fits tighter. */
function classify(pts: readonly Vec2[], tol: Tolerances, scatter: number): Piece | null {
  let piece = pieceOf(pts, tol) ?? pieceOf(pts, ANYTHING)
  if (!piece) return null
  if (piece.kind === 'line' && pts.length >= 6) {
    const circle = tryFit(fitCirclePoints, pts)
    if (circle) {
      const noise = Math.max(circle.sigma, 0.5 * scatter)
      const gain = pts.length * (piece.fit.sigma ** 2 - circle.sigma ** 2)
      if (gain > LINE_ARC_F_CRIT * noise * noise && circle.radius < LINE_ARC_RADIUS_LENGTHS * piece.fit.length) {
        const arc = arcOf(pts)
        if (arc && (arc.sweep >= LINE_ARC_MIN_SWEEP || bulgeOf(arc) >= CURVE_BULGES * tol.arc) && runsAlong(pts, arc)) piece = { kind: 'arc', fit: arc }
      }
    }
  }
  // A shallow arc that bulges no more than a wall may wander is the wall —
  // one that bows well past the noise is a curve.
  if (piece.kind === 'arc' && piece.fit.sweep < SHALLOW_SWEEP && Number.isFinite(tol.line)) {
    const bulge = bulgeOf(piece.fit)
    const line = bulge < Math.min(SHALLOW_BULGES * tol.line, CURVE_BULGES * tol.arc) ? lineOf(pts) : null
    if (line) piece = { kind: 'line', fit: line }
  }
  return piece
}

/** How far an arc bows off its chord. */
function bulgeOf(arc: FlatArcFit): number {
  return arc.radius * (1 - Math.cos(arc.sweep / 2))
}

/** Where two pieces' carriers cross nearest `near` — two lines at their
 *  intersection, a line and a circle or two circles at the nearer of their
 *  two, or where they come closest when they just miss. Null for two lines
 *  that run alongside each other. */
function meetOf(a: Piece, b: Piece, near: Vec2): Vec2 | null {
  const nearest = (candidates: Vec2[]): Vec2 | null => {
    let best: Vec2 | null = null
    let bestD = Infinity
    for (const c of candidates) {
      const d = len2(sub2(c, near))
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return best
  }
  if (a.kind === 'line' && b.kind === 'line') {
    const da = a.fit.dir
    const db = b.fit.dir
    const denom = da[0] * db[1] - da[1] * db[0]
    if (Math.abs(denom) < MEET_PARALLEL) return null
    const w = sub2(b.fit.center, a.fit.center)
    const t = (w[0] * db[1] - w[1] * db[0]) / denom
    return [a.fit.center[0] + da[0] * t, a.fit.center[1] + da[1] * t]
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    const d = len2(sub2(b.fit.center, a.fit.center))
    if (d < 1e-9) return null
    const u: Vec2 = [(b.fit.center[0] - a.fit.center[0]) / d, (b.fit.center[1] - a.fit.center[1]) / d]
    const r1 = a.fit.radius
    const r2 = b.fit.radius
    const along = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
    const h2 = r1 * r1 - along * along
    const foot: Vec2 = [a.fit.center[0] + u[0] * along, a.fit.center[1] + u[1] * along]
    if (h2 <= 0) return foot
    const h = Math.sqrt(h2)
    return nearest([
      [foot[0] - u[1] * h, foot[1] + u[0] * h],
      [foot[0] + u[1] * h, foot[1] - u[0] * h],
    ])
  }
  const line = (a.kind === 'line' ? a : b).fit as FlatLineFit
  const arc = (a.kind === 'arc' ? a : b).fit as FlatArcFit
  const w = sub2(arc.center, line.center)
  const t = w[0] * line.dir[0] + w[1] * line.dir[1]
  const foot: Vec2 = [line.center[0] + line.dir[0] * t, line.center[1] + line.dir[1] * t]
  const off = len2(sub2(arc.center, foot))
  if (off >= arc.radius) return foot
  const h = Math.sqrt(arc.radius * arc.radius - off * off)
  return nearest([
    [foot[0] + line.dir[0] * h, foot[1] + line.dir[1] * h],
    [foot[0] - line.dir[0] * h, foot[1] - line.dir[1] * h],
  ])
}

interface Run {
  lo: number
  hi: number
  /** Looked at by the dissolve pass and found to be a feature of its own. */
  kept?: boolean
  /** A piece was dropped between this run and the next: the two make the
   *  corner between them, however far apart their ends stand. */
  cornerAfter?: boolean
  /** A cluster of short runs kept as the one feature it is — see `keep`. */
  cluster?: boolean
}

/** Laid-flat chains as the lists of points the fit takes, one per chain. */
export function chainsOfEdges(edges: EdgeChains): Vec2[][] {
  const out: Vec2[][] = []
  for (let c = 0; c + 1 < edges.offsets.length; c++) {
    const chain: Vec2[] = []
    for (let i = edges.offsets[c]; i < edges.offsets[c + 1]; i++) chain.push([edges.points[i * 2], edges.points[i * 2 + 1]])
    out.push(chain)
  }
  return out
}

/** How many places along a chain an arc may end at, at most, when it is
 *  cut into a given number of arcs — every point on a short chain. */
const ARC_BREAKS = 160

/**
 * A chain — or the run of it from its first point to its last, a closed
 * one opened there — as `count` arcs end to end: the breaks are where the
 * arcs together sit closest on the points. For a curve the cut makes
 * otherwise: two tangent arcs of a near radius that one arc within the
 * noise would swallow (a housing's R177 side running into its R218), a long
 * shallow curve the cut would make a line or lines of. Each arc is fitted
 * to its own points; the relations between them — tangent, above all — are
 * the sketch's to take (reverse.sketch.candidates).
 */
export function arcsOfChain(chain: readonly Vec2[], count: number, opts: Pick<SegmentOptions, 'tolerance'> = {}): SegmentedChain {
  const { spacing, scatter, points } = chainStatistics(chain)
  const n = points.length
  const pieces = Math.max(1, Math.floor(count))
  if (n < 5 * pieces) throw new FitError(`The chain has ${n} points — too few for ${pieces} arc${pieces === 1 ? '' : 's'}, five each at least.`)
  const tolerance = opts.tolerance ?? Math.max(TOLERANCE_SCATTERS * scatter, TOLERANCE_SPACING * spacing)
  const stride = Math.max(1, Math.ceil(n / ARC_BREAKS))
  const at: number[] = []
  for (let k = 0; k < n - 1; k += stride) at.push(k)
  at.push(n - 1)
  const m = at.length
  // What an arc over the points from break a to break b costs: the sum of
  // its squared misses — none for a run too short to be one.
  const costs = new Map<number, { cost: number; fit: FlatArcFit } | null>()
  const arcCost = (a: number, b: number) => {
    const key = a * m + b
    if (costs.has(key)) return costs.get(key)!
    const run = points.slice(at[a], at[b] + 1)
    const fit = run.length >= 5 ? arcOf(run) : null
    let cost = Infinity
    if (fit) {
      cost = 0
      for (const p of run) cost += (Math.hypot(p[0] - fit.center[0], p[1] - fit.center[1]) - fit.radius) ** 2
    }
    const out = fit ? { cost, fit } : null
    costs.set(key, out)
    return out
  }
  // best[k][b]: the least cost of k + 1 arcs over the points to break b.
  const best: number[][] = []
  const from: number[][] = []
  for (let k = 0; k < pieces; k++) {
    best.push(new Array<number>(m).fill(Infinity))
    from.push(new Array<number>(m).fill(-1))
    for (let b = 1; b < m; b++) {
      if (k === 0) {
        best[0][b] = arcCost(0, b)?.cost ?? Infinity
        continue
      }
      for (let a = k; a < b; a++) {
        if (!Number.isFinite(best[k - 1][a])) continue
        const c = arcCost(a, b)
        if (!c) continue
        const total = best[k - 1][a] + c.cost
        if (total < best[k][b]) {
          best[k][b] = total
          from[k][b] = a
        }
      }
    }
  }
  if (!Number.isFinite(best[pieces - 1][m - 1])) throw new FitError(`The chain cannot be cut into ${pieces} arcs — at least one stretch of it is straight or too short.`)
  const ends: number[] = [m - 1]
  for (let k = pieces - 1; k > 0; k--) ends.unshift(from[k][ends[0]])
  ends.unshift(0)
  const segments: ChainSegment[] = []
  for (let k = 0; k < pieces; k++) {
    const lo = at[ends[k]]
    const hi = at[ends[k + 1]]
    const c = arcCost(ends[k], ends[k + 1])!
    segments.push({ kind: 'arc', lo, hi, points: points.slice(lo, hi + 1), fit: c.fit })
  }
  return { segments, points, closed: false, scatter, spacing, tolerance }
}

/** How many places along a chain a piece may end at, at most, when it is
 *  cut into given kinds of piece — every point on a short chain. */
const KIND_BREAKS = 100
/** The most points a piece's cost is read over while the breaks are
 *  sought; the pieces found are fitted to all of theirs. */
const KIND_COST_POINTS = 200

/**
 * A chain as the pieces `kinds` names, end to end and in that order — the
 * lines and arcs of another station, so the stations of a loft come out
 * piece for piece alike. The breaks are where the pieces together sit
 * closest on the points: the least sum of their squared misses, each piece
 * fitted to its own points. Whether neighbours run tangent is the sketch's
 * to hold. `closed`: the chain is a loop starting at its first point, and
 * the last piece comes back to it. `cost` is that sum, mm². Throws FitError
 * when the chain is too short for the pieces or no cut fits them.
 */
export function kindsOfChain(chain: readonly Vec2[], kinds: readonly ('line' | 'arc')[], opts: Pick<SegmentOptions, 'tolerance'> & { closed?: boolean } = {}): SegmentedChain & { cost: number } {
  const stats = chainStatistics(chain)
  const points = opts.closed ? [...stats.points, stats.points[0]] : stats.points
  const n = points.length
  const pieces = kinds.length
  if (pieces === 0) throw new FitError('There are no pieces to cut the chain into.')
  const fewest = (k: 'line' | 'arc') => (k === 'arc' ? 5 : 3)
  const needed = kinds.reduce((sum, k) => sum + fewest(k) - 1, 1)
  if (n < needed) throw new FitError(`The chain has ${n} points — too few for ${pieces} pieces (${kinds.join(', ')}).`)
  const tolerance = opts.tolerance ?? Math.max(TOLERANCE_SCATTERS * stats.scatter, TOLERANCE_SPACING * stats.spacing)
  const stride = Math.max(1, Math.ceil((n - 1) / KIND_BREAKS))
  const at: number[] = []
  for (let k = 0; k < n - 1; k += stride) at.push(k)
  at.push(n - 1)
  const m = at.length
  // What a piece of a kind over the points from break a to break b costs:
  // its squared misses, read over a thinned run and scaled to the whole.
  const costs = new Map<number, number>()
  const costOf = (a: number, b: number, kind: 'line' | 'arc'): number => {
    const key = (a * m + b) * 2 + (kind === 'arc' ? 1 : 0)
    const had = costs.get(key)
    if (had !== undefined) return had
    const count = at[b] - at[a] + 1
    let cost = Infinity
    if (count >= fewest(kind)) {
      const step = Math.max(1, Math.ceil(count / KIND_COST_POINTS))
      const run: Vec2[] = []
      for (let i = at[a]; i <= at[b]; i += step) run.push(points[i])
      if (run[run.length - 1] !== points[at[b]]) run.push(points[at[b]])
      const fit = kind === 'arc' ? tryFit(fitArcPoints, run) : tryFit(fitLinePoints, run)
      if (fit && Number.isFinite(fit.sigma) && (kind === 'line' || Number.isFinite((fit as FlatArcFit).radius))) cost = fit.sigma * fit.sigma * count
    }
    costs.set(key, cost)
    return cost
  }
  // best[k][b]: the least cost of pieces 0..k over the points to break b.
  const best: number[][] = []
  const from: number[][] = []
  for (let k = 0; k < pieces; k++) {
    best.push(new Array<number>(m).fill(Infinity))
    from.push(new Array<number>(m).fill(-1))
    for (let b = 1; b < m; b++) {
      if (k === 0) {
        best[0][b] = costOf(0, b, kinds[0])
        continue
      }
      for (let a = k; a < b; a++) {
        if (!Number.isFinite(best[k - 1][a])) continue
        const total = best[k - 1][a] + costOf(a, b, kinds[k])
        if (total < best[k][b]) {
          best[k][b] = total
          from[k][b] = a
        }
      }
    }
  }
  if (!Number.isFinite(best[pieces - 1][m - 1])) throw new FitError(`The chain cannot be cut into ${kinds.join(', ')} — a stretch of it is too short for its piece, or no piece fits it.`)
  const ends: number[] = [m - 1]
  for (let k = pieces - 1; k > 0; k--) ends.unshift(from[k][ends[0]])
  ends.unshift(0)
  const segments: ChainSegment[] = []
  let cost = 0
  for (let k = 0; k < pieces; k++) {
    const lo = at[ends[k]]
    const hi = at[ends[k + 1]]
    const run = points.slice(lo, hi + 1)
    const fit = kinds[k] === 'arc' ? tryFit(fitArcPoints, run) : tryFit(fitLinePoints, run)
    if (!fit) throw new FitError(`Piece ${k + 1} (${kinds[k]}) does not fit its stretch of the chain.`)
    cost += fit.sigma * fit.sigma * run.length
    segments.push({ kind: kinds[k], lo, hi, points: run, fit })
  }
  return { segments, points, closed: Boolean(opts.closed), scatter: stats.scatter, spacing: stats.spacing, tolerance, cost }
}

/**
 * Cut a chain into lines and arcs. Throws FitError on a chain too short to
 * cut at all.
 */
export function segmentChain(chain: readonly Vec2[], opts: SegmentOptions = {}): SegmentedChain {
  const { spacing, scatter, closed, points } = chainStatistics(chain)
  const n = points.length
  if (n < 4) throw new FitError('The chain has too few points to fit anything to.')
  const tolerance = opts.tolerance ?? Math.max(TOLERANCE_SCATTERS * scatter, TOLERANCE_SPACING * spacing)
  const levels = detailLevels(tolerance, opts.detail)
  const tol: Tolerances = { line: levels.wave, arc: levels.arc }
  const minPoints = Math.max(3, opts.minPoints ?? 4)
  const minLength = opts.minLength ?? levels.short

  // ---- the corners and chords: RDP at the tolerance ---------------------------
  const flat = new Float64Array(n * 2)
  points.forEach((p, i) => {
    flat[i * 2] = p[0]
    flat[i * 2 + 1] = p[1]
  })
  let breaks: number[]
  if (closed) {
    // A loop has no ends for RDP to hang from: the point farthest from the
    // first gives two, and each half is simplified on its own.
    let far = 1
    let farD = -1
    for (let i = 1; i < n; i++) {
      const d = len2(sub2(points[i], points[0]))
      if (d > farD) {
        farD = d
        far = i
      }
    }
    const first = simplifyRun(flat, 0, far + 1, tolerance)
    const second = simplifyRun(flat, far, n, tolerance)
    breaks = [...first, ...second.slice(1), n] // n stands for the closing return to 0
  } else {
    breaks = simplifyRun(flat, 0, n, tolerance)
  }
  const mod = (i: number): number => ((i % n) + n) % n
  const at = (i: number): Vec2 => points[mod(i)]
  const runs: Run[] = []
  for (let k = 0; k + 1 < breaks.length; k++) runs.push({ lo: breaks[k], hi: breaks[k + 1] })

  // Points taken out of the fitting: a blob in a corner, a burr on a side —
  // what the dissolve pass dropped. No piece is fitted to them, and none is
  // held to them by the solver afterwards.
  const masked = new Uint8Array(n)
  const pointsOf = (r: Run): Vec2[] => {
    const out: Vec2[] = []
    for (let i = r.lo; i <= r.hi; i++) if (!masked[mod(i)]) out.push(at(i))
    return out
  }
  /** `b` as it follows `a` round the chain: shifted by whole turns until it
   *  starts at or after `a`'s end. */
  const following = (a: Run, b: Run): Run => {
    const k = Math.ceil((a.hi - b.lo) / n)
    return { lo: b.lo + k * n, hi: b.hi + k * n }
  }
  const unionOf = (a: Run, b: Run): Run => {
    const f = following(a, b)
    let lo = a.lo
    let hi = f.hi
    // Never more than once round.
    if (hi - lo > n) hi = lo + n
    while (lo >= n) {
      lo -= n
      hi -= n
    }
    return { lo, hi }
  }
  const fits = new Map<string, Judged | null>()
  const pieceOver = (r: Run): Judged | null => {
    const key = `${r.lo}:${r.hi}`
    let judged = fits.get(key)
    if (judged === undefined) {
      judged = judgedPieceOf(pointsOf(r), tol)
      fits.set(key, judged)
    }
    return judged
  }
  /** Runs i and i+1 made one, in the list. */
  const mergeAt = (i: number, count = 1): void => {
    let union = runs[i]
    for (let k = 1; k <= count; k++) union = unionOf(union, runs[(i + k) % runs.length])
    const drop = new Set<number>()
    for (let k = 1; k <= count; k++) drop.add((i + k) % runs.length)
    if (runs[(i + count) % runs.length].cornerAfter) union.cornerAfter = true
    runs[i] = union
    for (const j of [...drop].sort((x, y) => y - x)) runs.splice(j, 1)
  }

  // ---- merge neighbours while one piece still explains them ----------------
  const mergeAll = (): void => {
    let merged = true
    while (merged && runs.length > 1) {
      merged = false
      // Best-first: the pair whose union sits best within what it is allowed
      // merges, so a fillet's chords gather into their arc before a side
      // swallows one of them — and sits by its worst stretch as much as by
      // its σ, which a long side's many points would talk down.
      let best = -1
      let bestScore = Infinity
      const pairCount = closed ? runs.length : runs.length - 1
      for (let i = 0; i < pairCount; i++) {
        if (closed && runs.length === 2 && i === 1) break
        const judged = pieceOver(unionOf(runs[i], runs[(i + 1) % runs.length]))
        if (judged && judged.score < bestScore) {
          bestScore = judged.score
          best = i
        }
      }
      if (best >= 0) {
        mergeAt(best)
        merged = true
      }
    }
  }
  mergeAll()

  // ---- the boundaries settle where the residuals say -------------------------
  // RDP puts a break where the chord bends, which on a fillet is a few
  // points into the straight side; a piece fitted with a neighbour's points
  // in it is biased — an arc with a stretch of straight edge in it fits a
  // larger radius. So every boundary is slid to the split at which the two
  // pieces, each refitted on its own side, explain their points best, and
  // the pieces are refitted on what they end up with.
  // Each run's kind at the tolerance, so a side is judged as the line it is
  // and a fillet as the arc it is — a line explains almost anything with
  // enough points behind it, and would take the fillet's ends for itself.
  const kindOf = (r: Run): 'line' | 'arc' => classify(pointsOf(r), tol, scatter)?.kind ?? 'line'
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    const pairCount = closed ? runs.length : runs.length - 1
    for (let i = 0; i < pairCount && runs.length > 1; i++) {
      const j = (i + 1) % runs.length
      const a = runs[i]
      const b = following(a, runs[j])
      if (b.lo !== a.hi) continue
      const span = Math.min(a.hi - a.lo, b.hi - b.lo, 16)
      if (span < 2) continue
      const kindA = kindOf(a)
      const kindB = kindOf(b)
      if (kindA === kindB) continue
      let bestK = a.hi
      let bestCost = Infinity
      for (let k = a.hi - span; k <= a.hi + span; k++) {
        if (k - a.lo + 1 < minPoints || b.hi - k + 1 < minPoints) continue
        const left = fitAs(pointsOf({ lo: a.lo, hi: k }), kindA)
        const right = fitAs(pointsOf({ lo: k, hi: b.hi }), kindB)
        if (!left || !right) continue
        const cost = left.sigma ** 2 * (k - a.lo + 1) + right.sigma ** 2 * (b.hi - k + 1)
        if (cost < bestCost) {
          bestCost = cost
          bestK = k
        }
      }
      if (bestK !== a.hi) {
        moved = true
        runs[i] = { lo: a.lo, hi: bestK }
        const shift = b.lo - runs[j].lo
        runs[j] = { lo: bestK - shift, hi: b.hi - shift }
      }
    }
    if (!moved) break
  }

  // ---- short pieces: noise, a burr, a blob, or a feature ---------------------
  // What is left under the short length comes in clusters — a blob is two or
  // three stubs in a row, the riser of a small step a round, a stub and a
  // round — and a cluster is asked about as one thing, against the long
  // pieces either side of it; asked stub by stub, a riser goes because the
  // round next to it happens to cross the side before. It is one of four
  // things, tried in this order. Noise its neighbours explain with it on
  // board: the lot is one piece. A burr on a side: the neighbours are one
  // piece with its points left out. A blob in a corner — weld spatter,
  // dirt, the scanner's own rounding of an inside corner: the neighbours
  // carried on meet beside it, so they make the corner between them and the
  // cluster goes, its points with it. Anything else — the riser, whose
  // neighbours run alongside each other and never meet — is a feature: it
  // stays, as the one piece it is. A fillet is no stub however short: an arc
  // that turns a good way round is kept on its sweep.
  const pathLength = (r: Run): number => {
    let sum = 0
    for (let i = r.lo; i < r.hi; i++) sum += len2(sub2(at(i + 1), at(i)))
    return sum
  }
  const isShort = (r: Run): boolean => {
    if (r.kept) return false
    const count = r.hi - r.lo + 1
    if (count < minPoints) return true
    const length = pathLength(r)
    if (length >= UNEXPLAINED_SHORTS * minLength) return false
    // Unexplained: what is left of a corner once its sides are fitted.
    if (pieceOver(r) === null) return true
    const piece = classify(pointsOf(r), tol, scatter)
    if (piece?.kind === 'arc') {
      // A round the size of what a wall may wander by is a lump, or a
      // corner the scanner rounded, whatever a circle through it says.
      if (piece.fit.radius < SHORT_ARC_WAVES * tol.line) return true
      if (length >= minLength) return false
      return !(piece.fit.sweep >= SHORT_ARC_SWEEP && count >= SHORT_ARC_POINTS)
    }
    return length < minLength
  }
  for (let guard = 0; guard < 4 * n && runs.length > 1; guard++) {
    const count = runs.length
    const short = runs.map(isShort)
    if (!short.some(Boolean)) break
    if (short.every(Boolean)) {
      for (const r of runs) r.kept = true
      break
    }
    // The first cluster: from a short run whose predecessor is long, on
    // through the short runs after it.
    let first = -1
    for (let k = 0; k < count && first < 0; k++) {
      const before = closed ? short[(k - 1 + count) % count] : k > 0 && short[k - 1]
      if (short[k] && !before) first = k
    }
    let size = 1
    while (size < count && short[(first + size) % count] && (closed || first + size < count)) size++
    const members = Array.from({ length: size }, (_, k) => runs[(first + k) % count])
    const hasPrev = closed || first > 0
    const hasNext = closed || first + size < count
    const p = (first - 1 + count) % count
    const q = (first + size) % count
    let cluster = members[0]
    for (let k = 1; k < size; k++) cluster = unionOf(cluster, members[k])
    const length = members.reduce((sum, r) => sum + pathLength(r), 0)
    /** The cluster made the one piece it is, and left alone from here on. */
    const keep = (): void => {
      if (size === 1) {
        members[0].kept = true
        return
      }
      mergeAt(first, size - 1)
      const merged = runs.find((r) => r.lo === cluster.lo && r.hi === cluster.hi)
      if (merged) {
        merged.kept = true
        merged.cluster = true
      } else for (const r of runs) if (isShort(r)) r.kept = true
    }
    if (length >= UNEXPLAINED_SHORTS * minLength || (closed && p === q)) {
      keep()
      continue
    }
    if (!hasPrev || !hasNext) {
      // At an open chain's end: fold it in if the neighbour takes it, drop
      // it if it is no longer than a stub, keep it otherwise.
      const j = hasNext ? q : p
      const joined = hasNext ? unionOf(cluster, runs[j]) : unionOf(runs[j], cluster)
      if (pieceOver(joined)) mergeAt(hasNext ? first : j, size)
      else if (length < minLength) {
        for (let k = cluster.lo + (hasPrev ? 1 : 0); k <= cluster.hi - (hasNext ? 1 : 0); k++) masked[mod(k)] = 1
        runs.splice(first, size)
        fits.clear()
      } else keep()
      continue
    }
    const a = runs[p]
    const b = runs[q]
    const all = unionOf(unionOf(a, cluster), b)
    if (pieceOver(all)) {
      mergeAt(p, size + 1)
      continue
    }
    const inner: number[] = []
    for (let k = cluster.lo + 1; k < cluster.hi; k++) if (!masked[mod(k)]) inner.push(mod(k))
    for (const k of inner) masked[k] = 1
    fits.clear()
    if (pieceOver(all)) {
      mergeAt(p, size + 1)
      continue
    }
    const pa = classify(pointsOf(a), tol, scatter)
    const pb = classify(pointsOf(b), tol, scatter)
    // Two lines make a corner; a line and a round, or two rounds, cross
    // wherever their circles happen to, and what lies between those is
    // more often the small blend of an S-bend than a blob.
    const meet = pa?.kind === 'line' && pb?.kind === 'line' ? meetOf(pa, pb, at((cluster.lo + cluster.hi) >> 1)) : null
    const reach = Math.max(length, minLength)
    if (meet && len2(sub2(meet, at(cluster.lo))) <= reach && len2(sub2(meet, at(cluster.hi))) <= reach) {
      a.cornerAfter = true
      // Highest index first, so the ones before it stay where they are.
      const gone = members.map((_, k) => (first + k) % count).sort((x, y) => y - x)
      for (const k of gone) runs.splice(k, 1)
      continue
    }
    for (const k of inner) masked[k] = 0
    fits.clear()
    keep()
  }

  // ---- name each run ------------------------------------------------------------
  const segments: ChainSegment[] = []
  for (const r of runs) {
    let pts = pointsOf(r)
    // A kept cluster is a riser with the scanner's rounding at both ends:
    // its middle half is the riser, and what the line is fitted to and held
    // to; the corners are made where it crosses its neighbours.
    if (r.cluster && pts.length >= 8) pts = pts.slice(pts.length >> 2, pts.length - (pts.length >> 2))
    const line = r.cluster ? lineOf(pts) : null
    const piece: Piece | null = line ? { kind: 'line', fit: line } : classify(pts, tol, scatter)
    if (!piece) continue
    segments.push({ kind: piece.kind, lo: r.lo, hi: r.hi, points: pts, fit: piece.fit, ...(r.cornerAfter ? { cornerAfter: true } : {}) })
  }
  if (segments.length === 0) throw new FitError('No line or arc could be fitted to the chain.')
  return { segments, points, closed, scatter, spacing, tolerance }
}

/** A segment as it enters the sketch, and which of the entity's anchors
 *  stands at the run's first and last point — what corner inference walks. */
export interface PlacedSegment {
  id: number
  from: AnchorAt
  to: AnchorAt
  /** This piece and the next make a corner whatever the gap between their
   *  ends — see ChainSegment.cornerAfter. */
  joinNext?: boolean
}

/** Add a segmented chain's pieces to the sketch as fitted entities, each
 *  with its slice points behind it. */
export function placeSegments(sketch: Sketch, cut: SegmentedChain): PlacedSegment[] {
  return cut.segments.map((seg): PlacedSegment => {
    const joinNext = seg.cornerAfter ? { joinNext: true } : {}
    const first = seg.points[0]
    const last = seg.points[seg.points.length - 1]
    if (seg.kind === 'line') {
      const fit = seg.fit as FlatLineFit
      // The piece runs between the projections of the run's ends.
      const project = (p: Vec2): Vec2 => {
        const t = (p[0] - fit.center[0]) * fit.dir[0] + (p[1] - fit.center[1]) * fit.dir[1]
        return [fit.center[0] + fit.dir[0] * t, fit.center[1] + fit.dir[1] * t]
      }
      const id = addEntity(sketch, {
        kind: 'line',
        a: project(first),
        b: project(last),
        points: seg.points,
        scatter: cut.scatter,
      } as Omit<SketchLine, 'id'>)
      return { id, from: 'a', to: 'b', ...joinNext }
    }
    const fit = seg.fit as FlatArcFit
    const angleOf = (p: Vec2) => Math.atan2(p[1] - fit.center[1], p[0] - fit.center[0])
    const thetaA = angleOf(first)
    const thetaB = angleOf(last)
    const thetaM = angleOf(seg.points[seg.points.length >> 1])
    // Which way round the run goes: counter-clockwise from its first point
    // if the middle point lies on that way to the last.
    const ccwSweep = unwindAngle(thetaB, thetaA) - thetaA
    const ccw = unwindAngle(thetaM, thetaA) - thetaA <= ccwSweep
    const arc = ccw
      ? { start: thetaA, sweep: ccwSweep > 1e-9 ? ccwSweep : 2 * Math.PI }
      : { start: thetaB, sweep: 2 * Math.PI - ccwSweep }
    const id = addEntity(sketch, {
      kind: 'arc',
      c: fit.center,
      r: fit.radius,
      start: arc.start,
      sweep: arc.sweep,
      points: seg.points,
      scatter: cut.scatter,
    } as Omit<SketchArc, 'id'>)
    return ccw ? { id, from: 'a', to: 'b', ...joinNext } : { id, from: 'b', to: 'a', ...joinNext }
  })
}
