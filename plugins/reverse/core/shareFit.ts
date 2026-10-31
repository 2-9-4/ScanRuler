// SPDX-License-Identifier: AGPL-3.0-only
// A fit that lands on what the sketch already holds. A sketch fitted at
// one level and then at another — the deck of a plate and the wing below
// it — has walls that run through both: drawn twice, a hair apart, they
// leave small steps all round the part. So before a level's outline is
// cut into pieces, every slice point within `share` mm of a piece already
// there, running the piece's way, goes to that piece: that stretch of wall
// is drawn already. On a fitted piece the points join its own, and the
// solve refits it on the evidence of every level; a drawn or projected
// piece takes none. What is left is fitted as open runs, and each run's
// ends land on the piece they reach — on its end, or held on it within it
// (a T-junction, solver.ts pointOn bounded).

import type { Vec2 } from '../../../src/core/flat/types'
import { chainClosed } from './chainOutline'
import type { PlacedSegment } from './segment'
import { addConstraint, type Anchor, type AnchorAt, anchorPoint, endsOf, entityOf, nearestOnEntity, type Sketch, type SketchArc, type SketchCircle, type SketchEntity, type SketchLine } from './sketch'

/** How near a slice point lies to a piece to be taken as that piece's wall,
 *  mm: steps under it are one surface. */
export const SHARE_MM = 0.1
/** How far a stretch of the outline may turn off the piece it lies along
 *  and still be that piece's, degrees. */
export const SHARE_DEG = 5
/** An end of a run this close to an end of the piece it reaches is put on
 *  that end (reSketchInput's SNAP_MM). */
const LAND_SNAP_MM = 0.05
/** How far past a piece's end a run may end and still be landed on that
 *  end, mm: the run leaves the piece where its points first stray from it,
 *  a slice spacing or two on. */
const LAND_REACH_MM = 1
/** The fewest points a run needs to be fitted (runsWhere's four). */
const MIN_RUN_POINTS = 4
/** A stretch shorter than this along its piece is too short to tell its
 *  way: it lies across the piece rather than along it. */
const MIN_STRETCH_MM = 0.4

type Carrier = SketchLine | SketchArc | SketchCircle

/** The pieces a fit may land on: the sketch's lines, arcs and circles, but
 *  its construction lines. */
export function sharePieces(sketch: Pick<Sketch, 'entities'>): Carrier[] {
  return sketch.entities.filter((e): e is Carrier => !e.construction && (e.kind === 'line' || e.kind === 'arc' || e.kind === 'circle'))
}

/** Where a point's foot lies on a piece — on the piece itself, not its
 *  line or circle run on — and how far off it the point is; null when the
 *  foot falls past an end. */
function footOn(e: Carrier, p: Vec2): { off: number } | null {
  if (e.kind === 'line') {
    const dx = e.b[0] - e.a[0]
    const dy = e.b[1] - e.a[1]
    const ll = dx * dx + dy * dy
    if (!(ll > 0)) return null
    const t = ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / ll
    if (t < 0 || t > 1) return null
    return { off: Math.abs((p[1] - e.a[1]) * dx - (p[0] - e.a[0]) * dy) / Math.sqrt(ll) }
  }
  const off = Math.abs(Math.hypot(p[0] - e.c[0], p[1] - e.c[1]) - e.r)
  if (e.kind === 'circle') return { off }
  const two = 2 * Math.PI
  const along = (((Math.atan2(p[1] - e.c[1], p[0] - e.c[0]) - e.start) % two) + two) % two
  return along <= e.sweep ? { off } : null
}

/** The way a piece runs where a point's foot lies, a unit vector. */
function wayAt(e: Carrier, p: Vec2): Vec2 {
  if (e.kind === 'line') {
    const l = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1
    return [(e.b[0] - e.a[0]) / l, (e.b[1] - e.a[1]) / l]
  }
  const a = Math.atan2(p[1] - e.c[1], p[0] - e.c[0])
  return [-Math.sin(a), Math.cos(a)]
}

/** A stretch of the outline taken as a piece's wall: the piece, its points,
 *  and how far off it they lie. */
export interface SharedStretch {
  piece: number
  points: Vec2[]
  offMm: { mean: number; max: number; rms: number }
}

/** What is left of the outline: a run to fit, open, and the pieces its
 *  start and its end reach — null at an open chain's own end. */
export interface OpenRun {
  points: Vec2[]
  from: number | null
  to: number | null
}

/** A chain of the outline against the pieces already there: what of it is
 *  theirs, what is left to fit, and whether none of it was theirs (whole:
 *  the chain is fitted as it is). */
export interface ChainShare {
  shared: SharedStretch[]
  runs: OpenRun[]
  whole: boolean
  /** Points a few hundredths off a corner the sketch already has — two of
   *  its pieces meeting — or off the piece either side: that corner. */
  corners: number
}

/**
 * A chain of the outline shared out among the pieces already there. Each
 * point goes to the nearest piece whose foot it has within `share` mm;
 * then each stretch of one piece is kept only where it runs the piece's
 * way (within `deg`) for MIN_STRETCH_MM or more — a stretch across a
 * piece is no wall of it. A run left between two kept stretches whose
 * points all lie within 3·share of the pieces either side is the corner
 * between them, drawn already (a scan's round of a few tenths at a sharp
 * corner of the sketch); so is one too short to fit. The rest are the runs
 * to fit.
 */
export function shareChain(chain: readonly Vec2[], pieces: readonly Carrier[], opts: { share: number; deg?: number }): ChainShare {
  const loop = chainClosed(chain)
  const pts = loop ? chain.slice(0, -1) : [...chain]
  const n = pts.length
  const none: ChainShare = { shared: [], runs: [], whole: true, corners: 0 }
  if (n === 0 || pieces.length === 0 || !(opts.share > 0)) return none
  const cos = Math.cos(((opts.deg ?? SHARE_DEG) * Math.PI) / 180)
  // Each point's nearest piece within share, and how far off it.
  const near = new Int32Array(n).fill(-1)
  const nearOff = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let best = -1
    let bestOff = opts.share
    pieces.forEach((e, k) => {
      const f = footOn(e, pts[i])
      if (f && f.off <= bestOff) {
        bestOff = f.off
        best = k
      }
    })
    near[i] = best
    nearOff[i] = bestOff
  }
  // Then walked along the chain: a point stays with the piece the point
  // before it went to while it lies within 2·share of it, unless another
  // lies nearer — so a wall a tenth off, its points either side of share
  // by the scan's noise, is one stretch, and a run leaves it only where
  // the outline clearly goes its own way. Round a loop twice, from a point
  // that knows its piece, so the first points have the walk behind them.
  const label = new Int32Array(n).fill(-1)
  const off = new Float64Array(n)
  const first = loop ? Math.max(0, Array.from(near).findIndex((x) => x >= 0)) : 0
  let cur = -1
  for (let k = 0; k < (loop ? 2 * n : n); k++) {
    const i = (first + k) % n
    const stay = cur >= 0 ? footOn(pieces[cur], pts[i]) : null
    if (stay && stay.off <= 2 * opts.share && !(near[i] >= 0 && near[i] !== cur && nearOff[i] < stay.off)) {
      label[i] = cur
      off[i] = stay.off
    } else {
      cur = near[i]
      label[i] = near[i]
      off[i] = nearOff[i]
    }
  }
  // The stretches of one label, in order — round a loop from a point where
  // the label changes, so none is cut in two.
  const stretches = (): { label: number; idx: number[] }[] => {
    let start = 0
    if (loop) {
      const change = Array.from({ length: n }, (_, i) => i).find((i) => label[i] !== label[(i - 1 + n) % n])
      if (change === undefined) return [{ label: label[0], idx: Array.from({ length: n }, (_, i) => i) }]
      start = change
    }
    const out: { label: number; idx: number[] }[] = []
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n
      const last = out[out.length - 1]
      if (last && last.label === label[i]) last.idx.push(i)
      else out.push({ label: label[i], idx: [i] })
    }
    return out
  }
  // A stretch kept only where it runs the piece's way, long enough to say.
  for (const s of stretches()) {
    if (s.label < 0) continue
    const e = pieces[s.label]
    const first = pts[s.idx[0]]
    const last = pts[s.idx[s.idx.length - 1]]
    const chord: Vec2 = [last[0] - first[0], last[1] - first[1]]
    const len = Math.hypot(chord[0], chord[1])
    const mid = pts[s.idx[s.idx.length >> 1]]
    const way = wayAt(e, mid)
    const along = len > 0 ? Math.abs(chord[0] * way[0] + chord[1] * way[1]) / len : 0
    if (s.idx.length < 2 || len < Math.max(MIN_STRETCH_MM, 2 * opts.share) || along < cos) for (const i of s.idx) label[i] = -1
  }
  const all = stretches()
  if (all.every((s) => s.label < 0)) return none
  const reach = 3 * opts.share
  let corners = 0
  const runs: OpenRun[] = []
  all.forEach((s, k) => {
    if (s.label >= 0) return
    const before = k > 0 ? all[k - 1].label : loop ? all[all.length - 1].label : -1
    const after = k + 1 < all.length ? all[k + 1].label : loop ? all[0].label : -1
    const sides = [before, after].filter((x) => x >= 0).map((x) => pieces[x])
    if (sides.length === 2) {
      const near = s.idx.every((i) => sides.some((e) => nearestOnEntity(e, pts[i]).dist <= reach))
      if (near || s.idx.length < MIN_RUN_POINTS) {
        corners += s.idx.length
        return
      }
    }
    runs.push({ points: s.idx.map((i) => pts[i]), from: before >= 0 ? pieces[before].id : null, to: after >= 0 ? pieces[after].id : null })
  })
  const byPiece = new Map<number, { points: Vec2[]; offs: number[] }>()
  for (const s of all) {
    if (s.label < 0) continue
    const id = pieces[s.label].id
    const got = byPiece.get(id) ?? { points: [], offs: [] }
    for (const i of s.idx) {
      got.points.push(pts[i])
      got.offs.push(off[i])
    }
    byPiece.set(id, got)
  }
  const shared = [...byPiece].map(([piece, { points, offs }]) => ({ piece, points, offMm: { mean: offs.reduce((a, b) => a + b, 0) / offs.length, max: Math.max(...offs), rms: Math.sqrt(offs.reduce((a, b) => a + b * b, 0) / offs.length) } }))
  return { shared, runs, whole: false, corners }
}

/** The shared stretches' points put behind the fitted pieces they lie on,
 *  beside the points they had: the solve then fits each such wall on every
 *  level. Its scatter — the weight its points carry against the relations —
 *  is raised to how far the new points lay off it: a level a few
 *  hundredths off is no noise a clean slice's few microns can hold the
 *  piece to, and weighed as such it would pull against every relation on
 *  it. A drawn, fixed or projected piece takes none, and a point the piece
 *  has already (the same chain fitted again) is not taken twice. Returns
 *  the pieces that took points. */
export function takeShared(sketch: Sketch, shared: readonly SharedStretch[]): number[] {
  const took: number[] = []
  for (const s of shared) {
    const e = entityOf(sketch, s.piece)
    if (!e || e.fixed || e.projected || !('points' in e) || !e.points || e.points.length === 0) continue
    const had = new Set(e.points.map((p) => `${p[0]},${p[1]}`))
    const fresh = s.points.filter((p) => !had.has(`${p[0]},${p[1]}`))
    if (fresh.length === 0) continue
    e.points = [...e.points, ...fresh]
    e.scatter = Math.max(e.scatter ?? 0, s.offMm.rms)
    took.push(e.id)
  }
  return took
}

/** Where a new run's end landed: on the end of the piece it reached
 *  (coincident), or held on the piece within it (on: a bounded pointOn) —
 *  and, where the run carries a line on in line past that line's end,
 *  collinear with it. */
export interface Landing {
  end: Anchor
  on: number
  /** free: held at first, and let go — the sketch did not solve with it
   *  held (letGo). */
  held: 'end' | 'on' | 'free'
  at: Vec2
  collinear?: true
  /** The relations that hold it, by id. */
  constraints: number[]
}

/**
 * A new run's end landed on the piece it reached: within LAND_SNAP_MM of
 * one of that piece's ends, or with its foot past one by up to
 * LAND_REACH_MM, it is made coincident with that end — a line's end moved
 * there first; with its foot on the piece, it is held on it by a pointOn
 * that keeps it within the piece (bounded). A line run on past a line's end
 * in line with it — its far end within `share` of that line — is held
 * collinear with it too: one wall, drawn on. Null where the end lies too
 * far past the piece to land.
 */
export function landEnd(sketch: Sketch, end: Anchor, on: number, share: number): Landing | null {
  const e = entityOf(sketch, end.entity)
  const t = entityOf(sketch, on)
  if (!e || !t || (t.kind !== 'line' && t.kind !== 'arc' && t.kind !== 'circle')) return null
  const p = anchorPoint(e, end.at)
  const ends = endsOf(t).map((at) => ({ at, q: anchorPoint(t, at) }))
  const nearest = ends.map((x) => ({ ...x, d: Math.hypot(x.q[0] - p[0], x.q[1] - p[1]) })).sort((x, y) => x.d - y.d)[0]
  const onPiece = footOn(t, p) !== null
  if (nearest && (nearest.d <= LAND_SNAP_MM || (!onPiece && nearest.d <= LAND_REACH_MM))) {
    if (e.kind === 'line') {
      if (end.at === 'a') e.a = [nearest.q[0], nearest.q[1]]
      else if (end.at === 'b') e.b = [nearest.q[0], nearest.q[1]]
    }
    const landing: Landing = { end, on, held: 'end', at: nearest.q, constraints: [addConstraint(sketch, { kind: 'coincident', p: end, q: { entity: t.id, at: nearest.at } })] }
    if (e.kind === 'line' && t.kind === 'line' && inLine(e, t, share)) {
      landing.constraints.push(addConstraint(sketch, { kind: 'collinear', line: e.id, on: { line: t.id } }))
      landing.collinear = true
    }
    return landing
  }
  // An end that comes along the piece rather than to it — the run's way
  // within LAND_GRAZE_DEG of the piece's there — is no junction: where it
  // meets the piece is as good as anywhere along it.
  if (!onPiece || grazes(e, end.at, t, p)) return null
  return { end, on, held: 'on', at: p, constraints: [addConstraint(sketch, { kind: 'pointOn', p: end, on: t.kind === 'line' ? { line: t.id } : { curve: t.id }, bounded: true })] }
}

/** How near the way a run arrives at a piece may lie to the piece's own
 *  way there and the end still be held on it, degrees. */
const LAND_GRAZE_DEG = 10

/** Whether a piece's end arrives along `t` at `p` rather than across it. */
function grazes(e: SketchEntity, at: AnchorAt, t: Carrier, p: Vec2): boolean {
  let way: Vec2 | null = null
  if (e.kind === 'line') way = [e.b[0] - e.a[0], e.b[1] - e.a[1]]
  else if (e.kind === 'arc') {
    const a = at === 'a' ? e.start : e.start + e.sweep
    way = [-Math.sin(a), Math.cos(a)]
  }
  if (!way) return false
  const len = Math.hypot(way[0], way[1])
  if (!(len > 0)) return false
  const there = wayAt(t, p)
  return Math.abs(way[0] * there[0] + way[1] * there[1]) / len >= Math.cos((LAND_GRAZE_DEG * Math.PI) / 180)
}

/**
 * A fit's landings let go where the sketch does not solve with them held:
 * while the solve leaves relations unmet and some landing's relations are
 * among them, the landing whose relations miss the most is taken out
 * (held: free) and the sketch solved again — at most `rounds` times. A
 * near miss the fit could not tell from a junction then leaves an end
 * open, which the answer shows, rather than the whole fit refused.
 * `solve` solves the sketch and says what was unmet, by relation id.
 */
export function letGo(sketch: Sketch, landings: readonly Landing[], solve: () => ReadonlyMap<number, number> | null, rounds = 8): void {
  for (let round = 0; round < rounds; round++) {
    const unmet = solve()
    if (!unmet || unmet.size === 0) return
    const worst = landings
      .filter((l) => l.held !== 'free' && l.constraints.some((id) => unmet.has(id)))
      .map((l) => ({ l, miss: Math.max(...l.constraints.map((id) => unmet.get(id) ?? 0)) }))
      .sort((x, y) => y.miss - x.miss)[0]
    if (!worst) return
    sketch.constraints = sketch.constraints.filter((c) => !worst.l.constraints.includes(c.id))
    worst.l.held = 'free'
  }
}

/** Whether a line lies along another's line: running its way within
 *  SHARE_DEG, both its ends within `share` of it. */
function inLine(l: SketchLine, m: SketchLine, share: number): boolean {
  const dx = m.b[0] - m.a[0]
  const dy = m.b[1] - m.a[1]
  const ll = Math.hypot(dx, dy)
  if (!(ll > 0)) return false
  const offOf = (p: Vec2) => Math.abs((p[1] - m.a[1]) * dx - (p[0] - m.a[0]) * dy) / ll
  const lx = l.b[0] - l.a[0]
  const ly = l.b[1] - l.a[1]
  const lenL = Math.hypot(lx, ly)
  if (!(lenL > 0)) return false
  const along = Math.abs(lx * dx + ly * dy) / (lenL * ll)
  return along >= Math.cos((SHARE_DEG * Math.PI) / 180) && offOf(l.a) <= share && offOf(l.b) <= share
}

/** A pointOn's anchor where it lies past the piece it is held on — on the
 *  line or circle the piece runs on, beyond its end — and how far, mm;
 *  null on the piece, or held on anything but a line or an arc. */
export function pastPiece(sketch: Pick<Sketch, 'entities'>, c: { p: Anchor; on: { line: number } | { curve: number } | { datum: unknown } }): number | null {
  const id = 'line' in c.on ? c.on.line : 'curve' in c.on ? c.on.curve : null
  const t = id === null ? undefined : entityOf(sketch, id)
  const e = entityOf(sketch, c.p.entity)
  if (!t || !e || (t.kind !== 'line' && t.kind !== 'arc')) return null
  const p = anchorPoint(e, c.p.at)
  if (footOn(t, p) !== null) return null
  // Past an end: how far along the line or round the circle from it.
  if (t.kind === 'line') {
    const dx = t.b[0] - t.a[0]
    const dy = t.b[1] - t.a[1]
    const ll = Math.hypot(dx, dy)
    if (!(ll > 0)) return null
    const s = ((p[0] - t.a[0]) * dx + (p[1] - t.a[1]) * dy) / ll
    return s < 0 ? -s : s - ll
  }
  const two = 2 * Math.PI
  const along = (((Math.atan2(p[1] - t.c[1], p[0] - t.c[0]) - t.start) % two) + two) % two
  return Math.min(along - t.sweep, two - along) * t.r
}

/** What a fit that shared its chains with the sketch's pieces did: by the
 *  index of each chain it shared, the runs fitted — each with its pieces
 *  in order, or why it was not — and the pieces the run's start and end
 *  reached; the stretches shared, piece by piece; where the runs' ends
 *  landed; and how many points were corners already drawn. */
export interface ShareReport {
  chains: Record<number, { order: PlacedSegment[] | null; points: number; skipped?: string; from: number | null; to: number | null }[]>
  shared: { piece: number; points: number; offMm: { mean: number; max: number } }[]
  junctions: (Landing & { chain: number; run: number })[]
  corners: number
}

/** The pieces a fit may land on, by the kinds it reads. */
export type { Carrier as ShareCarrier }
