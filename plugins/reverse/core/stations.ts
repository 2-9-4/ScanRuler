// SPDX-License-Identifier: AGPL-3.0-only
// The stations of a loft taken from the scan. A styled part — a cover's
// wing, a fairing — is a loft through sections of it, and a loft through
// sections only lofts cleanly when every station has the same pieces in the
// same order: the same lines and arcs, tangent where the others are. So a
// station is fitted like one already made: the scan's run on its plane cut
// into that station's pieces, kind for kind (segment.ts kindsOfChain), its
// relations copied, and the pieces it was closed with — a line across the
// base, drawn rather than fitted — copied where they lie, the run's ends run
// on to meet them. And a thin shell's inner station is its outer one moved
// in by the wall: each line along its normal, each arc about its centre, the
// corners met again — the pieces drawn to close it staying where they are,
// so the inner loft reaches the same base and the cut opens it there.

import { FitError } from '../../../src/core/fit/errors'
import type { Vec2 } from '../../../src/core/flat/types'
import { cross2, dot2, len2, mid2, normalize2, perp2, scale2, signedArea2, sub2, add2 } from '../../../src/core/flat/vec2'
import { type DatumTrace, traceLine, traceOf, traceOffset } from './datums'
import { findRegions } from './regions'
import { chainStatistics, kindsOfChain, placeSegments } from './segment'
import { type Anchor, type AnchorAt, anchorPoint, arcAngleOf, arcPoint, type Constraint, constraintEntities, endsOf, entityOf, entityPolyline, isDimension, type Sketch, type SketchArc, type SketchCircle, type SketchEntity, type SketchLine, TOUCH_MM, unwindAngle } from './sketch'
import { measureDimension } from './solver'

/** One piece of a station's profile, in the order the profile runs. */
export interface StationPiece {
  id: number
  kind: 'line' | 'arc'
  /** The end the profile comes into the piece at, and the one it leaves by. */
  from: 'a' | 'b'
  to: 'a' | 'b'
  /** Fitted to the scan — it holds slice points; otherwise drawn. */
  fitted: boolean
}

/** A station's profile: its pieces end to end, a closed one starting where
 *  its run of fitted pieces starts. */
export interface StationLoop {
  pieces: StationPiece[]
  closed: boolean
}

const otherEnd = (end: 'a' | 'b'): 'a' | 'b' => (end === 'a' ? 'b' : 'a')

const aKind = (kind: string) => `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`

/** A station's piece shorter than this is no piece: the loft through it
 *  fails in the kernel, or folds where the fit cut a corner into a sliver. */
export const STATION_MIN_PIECE_MM = 0.05

/** An arc of a station sweeping less than this, degrees, is a corner the
 *  fit cut into an arc, not a round. */
const STATION_MIN_ARC_DEG = 5

/** How far past the run's pieces a corner may land, in the run's extents:
 *  further, two nearly parallel carriers met far off — a wall run into a
 *  boss beside it, met at u = 827. */
const CORNER_REACH = 2

/** A length or an angle as an answer gives it: microns kept where they are
 *  all there is. */
const mm = (x: number) => (Math.abs(x) < 0.01 ? Number(x.toPrecision(2)) : Math.round(x * 1000) / 1000)
const degOf = (rad: number) => Math.round(((rad * 180) / Math.PI) * 10) / 10

/** The box round a run of points. */
function chainBox(points: readonly Vec2[]): { min: Vec2; max: Vec2 } {
  const min: Vec2 = [Infinity, Infinity]
  const max: Vec2 = [-Infinity, -Infinity]
  for (const p of points) {
    min[0] = Math.min(min[0], p[0])
    min[1] = Math.min(min[1], p[1])
    max[0] = Math.max(max[0], p[0])
    max[1] = Math.max(max[1], p[1])
  }
  return { min, max }
}

/** A line's or an arc's length. */
function pieceLength(e: SketchLine | SketchArc): number {
  return e.kind === 'line' ? len2(sub2(e.b, e.a)) : e.r * Math.abs(e.sweep)
}

/** The way a profile runs at one end of a piece it comes in by `from`: a
 *  line's one way along it, an arc's tangent turned the way it is run. */
function travelAt(e: SketchLine | SketchArc, from: 'a' | 'b', at: 'a' | 'b'): Vec2 | null {
  if (e.kind === 'line') return normalize2(from === 'a' ? sub2(e.b, e.a) : sub2(e.a, e.b))
  const angle = at === 'a' ? e.start : e.start + e.sweep
  const turn = (from === 'a' ? 1 : -1) * Math.sign(e.sweep || 1)
  return [-Math.sin(angle) * turn, Math.cos(angle) * turn]
}

/** Which way a profile through `ids`, in that order, runs each piece: the
 *  end it leaves a piece by is the one nearest the next piece's ends (the
 *  last piece of an open one: the end away from the one before). Read off
 *  the pieces as they lie, so a solve that turned one round shows it. */
function endsAlong(sketch: Pick<Sketch, 'entities'>, ids: readonly number[], closed: boolean): Map<number, { from: 'a' | 'b'; to: 'a' | 'b' }> {
  const out = new Map<number, { from: 'a' | 'b'; to: 'a' | 'b' }>()
  const n = ids.length
  const piece = (k: number) => entityOf(sketch, ids[k]) as SketchLine | SketchArc
  const nearer = (k: number, other: number): 'a' | 'b' => {
    const o = piece(other)
    const gap = (end: 'a' | 'b') => Math.min(len2(sub2(anchorPoint(piece(k), end), anchorPoint(o, 'a'))), len2(sub2(anchorPoint(piece(k), end), anchorPoint(o, 'b'))))
    return gap('a') <= gap('b') ? 'a' : 'b'
  }
  for (let k = 0; k < n; k++) {
    if (n === 1) out.set(ids[k], { from: 'a', to: 'b' })
    else if (k < n - 1 || closed) {
      const to = nearer(k, (k + 1) % n)
      out.set(ids[k], { from: otherEnd(to), to })
    } else {
      const from = nearer(k, k - 1)
      out.set(ids[k], { from, to: otherEnd(from) })
    }
  }
  return out
}

/**
 * What is wrong with a station made like `template` (whose profile `loop`
 * is), piece by piece, in words — empty when nothing is: a piece under
 * STATION_MIN_PIECE_MM, a line run backwards against the template's, an arc
 * bending the other way or sweeping under STATION_MIN_ARC_DEG. Each is a
 * fold a loft would go through: the run did not fall into the template's
 * pieces there. `ids` names the station's pieces in the loop's order where
 * they are not the template's ids. Read off the pieces as they lie — before
 * the solve, and after it, which can fold a piece the fit left whole.
 */
export function stationFaults(template: Sketch, loop: StationLoop, made: Pick<Sketch, 'entities'>, ids: readonly number[] = loop.pieces.map((p) => p.id)): string[] {
  const ends = endsAlong(made, ids, loop.closed)
  const out: string[] = []
  loop.pieces.forEach((p, k) => {
    const e = entityOf(made, ids[k]) as SketchLine | SketchArc | undefined
    const t = entityOf(template, p.id) as SketchLine | SketchArc | undefined
    if (!e || !t || e.kind !== t.kind) return
    const what = `piece ${ids[k]} (${aKind(e.kind)})`
    const length = pieceLength(e)
    if (length < STATION_MIN_PIECE_MM) {
      // units-ok: a station fit's or an inset's message, also the agent's answer
      out.push(`${what} is ${mm(length)} mm long — under ${STATION_MIN_PIECE_MM} mm`)
      return
    }
    const way = ends.get(ids[k])!
    const now = travelAt(e, way.from, way.to)
    const was = travelAt(t, p.from, p.to)
    if (e.kind === 'line') {
      // units-ok: a station fit's or an inset's message, also the agent's answer
      if (now && was && dot2(now, was) < 0) out.push(`${what} runs ${mm(length)} mm backwards against the template’s piece ${p.id}`)
      return
    }
    const arc = t as SketchArc
    const sense = (way.from === 'a' ? 1 : -1) * Math.sign(e.sweep || 1)
    const had = (p.from === 'a' ? 1 : -1) * Math.sign(arc.sweep || 1)
    if (sense !== had) out.push(`${what} bends the other way from the template’s piece ${p.id}`)
    else if (Math.abs(e.sweep) < (STATION_MIN_ARC_DEG * Math.PI) / 180) out.push(`${what} sweeps ${degOf(Math.abs(e.sweep))}° — under ${STATION_MIN_ARC_DEG}°`)
  })
  return out
}

/** What a station that folds is told to do. */
export const STATION_FOLD_HELP = 'the scan’s run does not fall into the template’s pieces there, and a loft through it folds. Point the fit with within or facing, give it a tolerance, or draw this station.'

/**
 * A sketch's profile as a station: its lines and arcs end to end (what is
 * drawn for construction, and points, left aside), in the order they run —
 * a closed profile turned to start where its one run of fitted pieces
 * starts. Why not, in words, for a sketch that holds a circle or a spline,
 * branches, or is more than one chain, or whose fitted pieces are more than
 * one run.
 */
export function stationLoop(sketch: Pick<Sketch, 'entities'>, name: string, opts: { anyRuns?: boolean } = {}): StationLoop | string {
  const own = sketch.entities.filter((e) => !e.construction && e.kind !== 'point')
  if (own.length === 0) return `${name} has no pieces.`
  const odd = own.find((e) => e.kind !== 'line' && e.kind !== 'arc')
  if (odd) return `${name} has ${aKind(odd.kind)} (piece ${odd.id}) — a station is lines and arcs end to end.`
  const pieces = own as (SketchLine | SketchArc)[]
  // A piece shorter than touch has its two ends at one corner, and its
  // neighbours meet across it: named, not read as three pieces meeting.
  const sliver = pieces.find((e) => len2(sub2(anchorPoint(e, 'a'), anchorPoint(e, 'b'))) <= TOUCH_MM && pieceLength(e) <= TOUCH_MM)
  // units-ok: a station fit's or an inset's message, also the agent's answer
  if (sliver) return `${name}'s piece ${sliver.id} (${aKind(sliver.kind)}) is ${mm(pieceLength(sliver))} mm long — shorter than the ${TOUCH_MM} mm two ends meet within, so the pieces either side meet across it. Take it out (reverse.sketch.edit remove) and join its neighbours, or fit the station again.`
  const ends = pieces.flatMap((e, i) => (['a', 'b'] as const).map((end) => ({ piece: i, end, at: anchorPoint(e, end) })))
  const partners = ends.map((p) => ends.filter((q) => q.piece !== p.piece && len2(sub2(q.at, p.at)) <= TOUCH_MM))
  if (partners.some((x) => x.length > 1)) return `${name} branches — three pieces meet at a point; a station is one chain of pieces end to end.`
  const loose = ends.filter((_, i) => partners[i].length === 0)
  const start = loose[0] ?? ends[0]
  const order: StationPiece[] = []
  const seen = new Set<number>()
  let at = start
  let closed = false
  for (;;) {
    const e = pieces[at.piece]
    seen.add(at.piece)
    const to = otherEnd(at.end)
    order.push({ id: e.id, kind: e.kind, from: at.end, to, fitted: Boolean(e.points?.length) })
    const next = partners[ends.findIndex((q) => q.piece === at.piece && q.end === to)][0]
    if (!next) break
    if (seen.has(next.piece)) {
      closed = next.piece === start.piece
      break
    }
    at = next
  }
  if (order.length < pieces.length) return `${name} is more than one chain — a station is one chain of pieces end to end (its pieces ${order.map((p) => p.id).join(', ')} make one; ${pieces.length - order.length} more lie apart).`
  const n = order.length
  if (closed && order.some((p) => p.fitted) && order.some((p) => !p.fitted)) {
    const first = order.findIndex((p, i) => p.fitted && !order[(i - 1 + n) % n].fitted)
    order.push(...order.splice(0, first))
  }
  const runs = order.filter((p, i) => p.fitted && (i === 0 || !order[i - 1].fitted)).length
  if (runs > 1 && !opts.anyRuns) return `${name}'s fitted pieces are ${runs} runs with drawn pieces between them — a station is one run fitted to the scan, closed by what is drawn.`
  return { pieces: order, closed }
}

/** Where two pieces' carriers cross nearest `near` — a line's whole line, an
 *  arc's whole circle — or, for a line that runs past a circle, the point on
 *  the line nearest it: where a line runs tangent into an arc. Null for two
 *  lines that run parallel, or two circles that do not meet. */
function meeting(a: SketchLine | SketchArc, b: SketchLine | SketchArc, near: Vec2): Vec2 | null {
  const nearest = (cs: Vec2[]) => (cs.length === 0 ? null : cs.reduce((x, y) => (len2(sub2(y, near)) < len2(sub2(x, near)) ? y : x)))
  if (a.kind === 'line' && b.kind === 'line') {
    const da = sub2(a.b, a.a)
    const db = sub2(b.b, b.a)
    const denom = cross2(da, db)
    if (Math.abs(denom) < 1e-9 * len2(da) * len2(db)) return null
    return add2(a.a, scale2(da, cross2(sub2(b.a, a.a), db) / denom))
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    const d = len2(sub2(b.c, a.c))
    if (d < 1e-9 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return null
    const along = (a.r * a.r - b.r * b.r + d * d) / (2 * d)
    const h = Math.sqrt(Math.max(0, a.r * a.r - along * along))
    const u = scale2(sub2(b.c, a.c), 1 / d)
    const foot = add2(a.c, scale2(u, along))
    return nearest([add2(foot, scale2(perp2(u), h)), add2(foot, scale2(perp2(u), -h))])
  }
  const line = (a.kind === 'line' ? a : b) as SketchLine
  const arc = (a.kind === 'arc' ? a : b) as SketchArc
  const d = normalize2(sub2(line.b, line.a))
  if (!d) return null
  const foot = add2(line.a, scale2(d, dot2(sub2(arc.c, line.a), d)))
  const off = len2(sub2(arc.c, foot))
  if (off >= arc.r) return foot
  const h = Math.sqrt(arc.r * arc.r - off * off)
  return nearest([add2(foot, scale2(d, h)), add2(foot, scale2(d, -h))])
}

/** `raw` (in [0, 2π)) or a full turn either side of it, whichever lies
 *  nearest the sweep the arc had. */
function nearestSweep(raw: number, had: number): number {
  const two = 2 * Math.PI
  return [raw, raw + two, raw - two].filter((s) => s > 1e-9 && s <= two + 1e-9).reduce((x, y) => (Math.abs(y - had) < Math.abs(x - had) ? y : x), raw)
}

/** A piece's end put at a point: a line's outright, an arc's at the angle
 *  the point lies at about its centre. */
function setEnd(e: SketchLine | SketchArc, at: 'a' | 'b', p: Vec2): void {
  if (e.kind === 'line') {
    if (at === 'a') e.a = [p[0], p[1]]
    else e.b = [p[0], p[1]]
    return
  }
  const angle = arcAngleOf(e, p)
  if (at === 'a') {
    const end = e.start + e.sweep
    const raw = unwindAngle(end, angle) - angle
    e.start = angle
    e.sweep = nearestSweep(raw, e.sweep)
  } else e.sweep = nearestSweep(unwindAngle(angle, e.start) - e.start, e.sweep)
}

/** The corners of a profile met again after its pieces moved: each two
 *  pieces in a row brought to where their carriers cross, nearest the corner
 *  `near` gives; pieces of `still` keep to their carriers and their ends
 *  slide along them, as do the others. Each corner met, with how far it
 *  landed from the farther of the two ends it was met from. */
function meetCorners(sketch: Sketch, loop: StationLoop, ends: ReadonlyMap<number, { from: 'a' | 'b'; to: 'a' | 'b' }>, still: (id: number) => boolean, near: (i: number, pa: Vec2, pb: Vec2) => Vec2): { a: number; b: number; reach: number }[] {
  const n = loop.pieces.length
  const met: { a: number; b: number; reach: number }[] = []
  for (let i = 0; i < (loop.closed ? n : n - 1); i++) {
    const A = loop.pieces[i]
    const B = loop.pieces[(i + 1) % n]
    if (still(A.id) && still(B.id)) continue
    const ea = entityOf(sketch, A.id) as SketchLine | SketchArc
    const eb = entityOf(sketch, B.id) as SketchLine | SketchArc
    const atA = ends.get(A.id)!.to
    const atB = ends.get(B.id)!.from
    const pa = anchorPoint(ea, atA)
    const pb = anchorPoint(eb, atB)
    const spot = near(i, pa, pb)
    const m = meeting(ea, eb, spot) ?? spot
    setEnd(ea, atA, m)
    setEnd(eb, atB, m)
    met.push({ a: A.id, b: B.id, reach: Math.max(len2(sub2(m, pa)), len2(sub2(m, pb))) })
  }
  return met
}

/** A deep copy of a piece or a relation. */
const copyOf = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** A station fitted like another: its sketch, and whether the run was taken
 *  from its far end. */
export interface LikeStation {
  sketch: Sketch
  reversed: boolean
}

/**
 * The scan's run on a station's plane fitted like `template`, whose profile
 * `loop` is: the run cut into the template's fitted pieces, kind for kind
 * in their order, each fitted to its own points and given the template
 * piece's id; the template's drawn pieces copied where they lie in [u, v];
 * the corners met where the pieces cross — a drawn piece keeping to its
 * line, the run's end running on or back to it — and the template's
 * relations among these pieces copied, its dimensions on drawn pieces alone
 * too (a fitted piece's size is the scan's to say). The run is taken the way
 * round that fits the pieces clearly better, or else lands the pieces'
 * ends nearer the template's. A template with no fitted piece is fitted
 * whole, when it is open. Why not, in words.
 */
export function likeStation(template: Sketch, loop: StationLoop, chain: readonly Vec2[], tolerance?: number): LikeStation | string {
  const all = loop.pieces.every((p) => !p.fitted)
  if (all && loop.closed) return 'it is closed and has no piece fitted to the scan, so its run cannot be told from what closes it — fit it to the scan, or leave it open.'
  const pieces = all ? loop.pieces.map((p) => ({ ...p, fitted: true })) : loop.pieces
  const stretch = pieces.filter((p) => p.fitted)
  const whole = loop.closed && stretch.length === pieces.length
  const { points, closed } = chainStatistics(chain)
  if (whole && !closed) return 'it is a closed outline fitted whole, and this run is open — fit a closed chain (closeGaps), or close the template with a drawn piece.'
  if (!whole && closed && stretch.length < pieces.length) return 'this chain is closed and the template’s run is open, closed by drawn pieces — keep to one run (skin, facing or within).'
  const tmpl = (id: number) => entityOf(template, id) as SketchLine | SketchArc
  const first = anchorPoint(tmpl(stretch[0].id), stretch[0].from)
  const kinds = stretch.map((p) => p.kind)
  // The run from its first point and from its last; a closed one from the
  // point nearest where the template's outline starts.
  const ways = [points, [...points].reverse()].map((pts) => {
    let run = pts
    if (whole) {
      const k = pts.reduce((best, p, i) => (len2(sub2(p, first)) < len2(sub2(pts[best], first)) ? i : best), 0)
      run = [...pts.slice(k), ...pts.slice(0, k)]
    }
    try {
      return kindsOfChain(run, kinds, { ...(tolerance !== undefined ? { tolerance } : {}), closed: whole })
    } catch (e) {
      if (e instanceof FitError) return e.message
      throw e
    }
  })
  const fits = ways.filter((w): w is Exclude<(typeof ways)[number], string> => typeof w !== 'string')
  if (fits.length === 0) return ways[0] as string
  // How far the cut's piece ends land from the template's.
  const off = (cut: (typeof fits)[number]) =>
    cut.segments.reduce((sum, s, k) => sum + len2(sub2(s.points[0], anchorPoint(tmpl(stretch[k].id), stretch[k].from))) + len2(sub2(s.points[s.points.length - 1], anchorPoint(tmpl(stretch[k].id), stretch[k].to))), 0)
  let cut = fits[0]
  if (fits.length === 2) {
    const [f, r] = fits
    const clearly = 2
    cut = f.cost * clearly < r.cost ? f : r.cost * clearly < f.cost ? r : off(f) <= off(r) ? f : r
  }
  const reversed = cut === ways[1]

  // The pieces: the run's under the template's ids, the drawn ones copied.
  const scratch: Sketch = { entities: [], constraints: [], nextId: 1 }
  const placed = placeSegments(scratch, cut)
  const out: Sketch = { entities: [], constraints: [], nextId: 1 }
  const ends = new Map<number, { from: 'a' | 'b'; to: 'a' | 'b' }>()
  let k = 0
  for (const p of pieces) {
    if (p.fitted) {
      const made = { ...(entityOf(scratch, placed[k].id) as SketchLine | SketchArc), id: p.id }
      out.entities.push(made)
      ends.set(p.id, { from: placed[k].from as 'a' | 'b', to: placed[k].to as 'a' | 'b' })
      k++
    } else {
      out.entities.push(copyOf(tmpl(p.id)))
      ends.set(p.id, { from: p.from, to: p.to })
    }
  }
  // The corners: a drawn piece's end stays on its line, the run's end runs
  // to it; two of the run's pieces meet about where the cut broke them.
  const fitted = new Set(pieces.filter((p) => p.fitted).map((p) => p.id))
  const n = pieces.length
  const met = meetCorners(out, { pieces, closed: loop.closed }, ends, (id) => !fitted.has(id), (i, pa, pb) => (!fitted.has(pieces[i].id) ? pb : !fitted.has(pieces[(i + 1) % n].id) ? pa : mid2(pa, pb)))
  // A corner met far past the run: two carriers nearly parallel, met
  // where nothing of the scan is — the station would loft "ok" at many
  // times its volume.
  const box = chainBox(points)
  const extent = len2(sub2(box.max, box.min))
  const far = met.reduce<(typeof met)[number] | null>((x, c) => (c.reach > CORNER_REACH * extent && (!x || c.reach > x.reach) ? c : x), null)
  // units-ok: a station fit's or an inset's message, also the agent's answer
  if (far) return `the corner of pieces ${far.a} and ${far.b} lands ${mm(far.reach)} mm past the run’s ends — over ${CORNER_REACH}× the run’s extent (${mm(extent)} mm): the two run nearly parallel and meet far off, likely because the run takes in something beside the station (a boss, a rib). Point it with within or facing.`
  const faults = stationFaults(template, { pieces, closed: loop.closed }, out)
  if (faults.length > 0) return `${faults.join('; ')} — ${STATION_FOLD_HELP}`

  // The template's relations among these pieces, their anchors read by
  // which way each piece now runs.
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const mapAt = (a: Anchor): Anchor => {
    const p = byId.get(a.entity)
    if (!p || !p.fitted || (a.at !== 'a' && a.at !== 'b')) return a
    const now = ends.get(p.id)!
    return { entity: a.entity, at: (a.at === p.from ? now.from : now.to) as AnchorAt }
  }
  let next = Math.max(0, ...out.entities.map((e) => e.id)) + 1
  for (const c of template.constraints) {
    const named = constraintEntities(c)
    if (!named.every((id) => byId.has(id))) continue
    if (isDimension(c) && named.some((id) => fitted.has(id))) continue
    const copy = copyOf(c) as Constraint & { p?: Anchor; q?: Anchor | object }
    if (copy.p) copy.p = mapAt(copy.p)
    if (copy.q && 'entity' in copy.q) copy.q = mapAt(copy.q as Anchor)
    copy.id = next++
    out.constraints.push(copy)
  }
  out.nextId = next
  return { sketch: out, reversed }
}

/** What a station's fit was given and found, for a refusal to say: the run
 *  taken, the chain it was taken from after closeGaps bridged what it did,
 *  the cut's chains as they came, how many runs within, skin or facing
 *  kept, and the fit as it was asked. */
export interface RunFacts {
  run: readonly Vec2[]
  joined: { chain: readonly Vec2[]; from: readonly number[] }
  chains: readonly (readonly Vec2[])[]
  runs: number
  fit: { closeGaps?: number; within?: unknown; skin?: unknown; facing?: unknown }
}

/** How many of a chain's gaps a refusal names, the widest first. */
const GAPS_NAMED = 5

const closedChain = (c: readonly Vec2[]) => c.length > 2 && len2(sub2(c[0], c[c.length - 1])) < 1e-9

/**
 * The gaps round the outline a run came from: each open chain's ends
 * paired with the nearest free end — another chain's, or its own other end
 * — the nearest pairs first, as closeGaps pairs them but with no limit, and
 * the pairs that link the run's chains to each other and on round the
 * outline kept. Those within closeGaps are the ones it bridged; the rest
 * stayed open. A pair longer than the outline's own extent links it to
 * something else, not across a gap of it, and is left out. Widest first.
 */
export function gapsRound(chains: readonly (readonly Vec2[])[], from: readonly number[], closeGaps = 0): { bridged: number[]; open: number[] } {
  const n = chains.length
  const open = chains.map((c) => c.length >= 2 && !closedChain(c))
  const end = (e: number): Vec2 => {
    const c = chains[e >> 1]
    return e & 1 ? c[c.length - 1] : c[0]
  }
  const pairs: { e: number; f: number; d: number }[] = []
  for (let i = 0; i < n; i++) {
    if (!open[i]) continue
    if (chains[i].length >= 3) pairs.push({ e: 2 * i, f: 2 * i + 1, d: len2(sub2(end(2 * i), end(2 * i + 1))) })
    for (let j = i + 1; j < n; j++) {
      if (!open[j]) continue
      for (const e of [2 * i, 2 * i + 1]) for (const f of [2 * j, 2 * j + 1]) pairs.push({ e, f, d: len2(sub2(end(e), end(f))) })
    }
  }
  pairs.sort((a, b) => a.d - b.d)
  const mate = new Int32Array(2 * n).fill(-1)
  const width = new Float64Array(2 * n)
  for (const p of pairs) {
    if (mate[p.e] >= 0 || mate[p.f] >= 0) continue
    mate[p.e] = p.f
    mate[p.f] = p.e
    width[p.e] = width[p.f] = p.d
  }
  // The outline the run's chains make, followed from them across every
  // pair; its extent bounds what is a gap of it.
  const seen = new Set<number>()
  const links = new Set<number>()
  const todo = from.filter((i) => i < n)
  while (todo.length > 0) {
    const c = todo.pop()!
    if (seen.has(c)) continue
    seen.add(c)
    for (const e of [2 * c, 2 * c + 1]) {
      const m = mate[e]
      if (m < 0) continue
      links.add(Math.min(e, m))
      todo.push(m >> 1)
    }
  }
  const box = chainBox([...seen].flatMap((c) => chains[c] as Vec2[]))
  const extent = len2(sub2(box.max, box.min))
  const widths = [...links].map((e) => width[e]).filter((d) => d > 1e-9 && d < extent).sort((a, b) => b - a)
  return { bridged: widths.filter((d) => d <= closeGaps), open: widths.filter((d) => d > closeGaps) }
}

/**
 * What a station's refusal adds of the numbers it decided on. For a run
 * that is open where the station is a closed outline fitted whole: how far
 * apart its ends stand, the closeGaps given, the gaps it bridged and those
 * still open, widest first — or, where within, skin or facing kept a run
 * of a chain that had closed, that it was they that opened it. For any
 * other refusal of a run closeGaps bridged: the bridges, which a station's
 * pieces may not fall on. Empty when there is nothing to add.
 */
export function runFactsWords(loop: StationLoop, f: RunFacts): string {
  const list = (ds: readonly number[]) => ds.slice(0, GAPS_NAMED).map((d) => mm(d)).join(', ') + (ds.length > GAPS_NAMED ? ` and ${ds.length - GAPS_NAMED} more` : '')
  const { bridged, open } = gapsRound(f.chains, f.joined.from, f.fit.closeGaps ?? 0)
  const given = f.fit.closeGaps !== undefined ? `closeGaps ${mm(f.fit.closeGaps)}` : 'no closeGaps given'
  // units-ok: a station fit's or an inset's message, also the agent's answer
  const bridges = bridged.length > 0 ? `${given} bridged ${bridged.length} gap${bridged.length === 1 ? '' : 's'} (${list(bridged)} mm)` : `${given}, none bridged`
  const whole = loop.closed && loop.pieces.every((p) => p.fitted)
  if (!whole || closedChain(f.run)) return bridged.length > 0 ? ` (${bridges} — a bridge is a straight run across a hole, and the station’s pieces may not fall on it)` : ''
  const ends = mm(len2(sub2(f.run[0], f.run[f.run.length - 1])))
  const by = (['within', 'skin', 'facing'] as const).filter((k) => f.fit[k] !== undefined)
  if (closedChain(f.joined.chain) && by.length > 0)
    // units-ok: a station fit's or an inset's message, also the agent's answer
    return ` The run’s ends stand ${ends} mm apart: its chain closed (${bridges}), and ${by.join(' and ')} split it into ${f.runs} run${f.runs === 1 ? '' : 's'}, the longest taken — fit the closed chain without ${by.length === 1 ? 'it' : 'them'}, or close the template with a drawn piece where the run stops.`
  // units-ok: a station fit's or an inset's message, also the agent's answer
  const still = open.length > 0 ? `; still open: ${list(open)} mm` : ''
  const reach = open.length > 0 ? ` closeGaps ${mm(open[0] * 1.05)} bridges them where they are holes in the scan; where they are the part’s own (a gap between keys), close the template with a drawn piece across them instead.` : ''
  // units-ok: a station fit's or an inset's message, also the agent's answer
  return ` The run’s ends stand ${ends} mm apart; ${bridges}${still}.${reach}`
}

/** How far off a relation may be and still be held, mm (or, for one of
 *  directions, the sine of the angle). */
const HOLDS = 1e-5

/** Whether a relation holds on the sketch as it lies. A dimension is not
 *  asked. */
function holds(sketch: Sketch, c: Constraint, datums: readonly DatumTrace[] | undefined): boolean {
  const e = (id: number) => entityOf(sketch, id)
  const pt = (a: Anchor) => anchorPoint(e(a.entity)!, a.at)
  const dir = (id: number) => {
    const l = e(id)
    return l?.kind === 'line' ? normalize2(sub2(l.b, l.a)) : null
  }
  const offLine = (p: Vec2, a: Vec2, d: Vec2) => Math.abs(dot2(sub2(p, a), perp2(d)))
  const carrier = (on: { line: number } | { datum: 'xy' | 'yz' | 'zx' }): { a: Vec2; d: Vec2 } | null => {
    if ('line' in on) {
      const l = e(on.line)
      const d = dir(on.line)
      return l?.kind === 'line' && d ? { a: l.a, d } : null
    }
    const t = traceOf(datums, on.datum)
    return t ? traceLine(t) : null
  }
  switch (c.kind) {
    case 'coincident':
      return len2(sub2(pt(c.p), pt(c.q))) <= HOLDS
    case 'horizontal':
    case 'vertical': {
      const d = dir(c.entity)
      return !d || Math.abs(d[c.kind === 'horizontal' ? 1 : 0]) <= HOLDS
    }
    case 'parallel':
    case 'perpendicular': {
      const [a, b] = [dir(c.a), dir(c.b)]
      return !a || !b || Math.abs(c.kind === 'parallel' ? cross2(a, b) : dot2(a, b)) <= HOLDS
    }
    case 'tangent': {
      const [a, b] = [e(c.a), e(c.b)]
      if (!a || !b) return true
      const round = (x: SketchEntity) => x.kind === 'arc' || x.kind === 'circle'
      if (a.kind === 'line' || b.kind === 'line') {
        const l = (a.kind === 'line' ? a : b) as SketchLine
        const r = (a.kind === 'line' ? b : a) as SketchArc
        const d = normalize2(sub2(l.b, l.a))
        return !d || !round(r) || Math.abs(offLine(r.c, l.a, d) - r.r) <= HOLDS
      }
      if (!round(a) || !round(b)) return true
      const [p, q] = [a as SketchArc, b as SketchArc]
      const d = len2(sub2(q.c, p.c))
      return Math.min(Math.abs(d - (p.r + q.r)), Math.abs(d - Math.abs(p.r - q.r))) <= HOLDS
    }
    case 'concentric': {
      const [a, b] = [e(c.a), e(c.b)]
      return !a || !b || !('c' in a) || !('c' in b) || len2(sub2(a.c, b.c)) <= HOLDS
    }
    case 'equal': {
      const [a, b] = [e(c.a), e(c.b)]
      if (a?.kind === 'line' && b?.kind === 'line') return Math.abs(len2(sub2(a.b, a.a)) - len2(sub2(b.b, b.a))) <= HOLDS
      return !a || !b || !('r' in a) || !('r' in b) || Math.abs(a.r - b.r) <= HOLDS
    }
    case 'pointOn': {
      const p = pt(c.p)
      if ('curve' in c.on) {
        const r = e(c.on.curve)
        return !r || !('r' in r) || Math.abs(len2(sub2(p, r.c)) - r.r) <= HOLDS
      }
      if ('datum' in c.on) {
        const t = traceOf(datums, c.on.datum)
        return !t || Math.abs(traceOffset(t, p)) <= HOLDS
      }
      const on = carrier(c.on)
      return !on || offLine(p, on.a, on.d) <= HOLDS
    }
    case 'collinear': {
      const l = e(c.line)
      const on = carrier(c.on)
      return l?.kind !== 'line' || !on || Math.max(offLine(l.a, on.a, on.d), offLine(l.b, on.a, on.d)) <= HOLDS
    }
    case 'symmetric': {
      const [p, q] = [pt(c.p), pt(c.q)]
      if (c.about === 'x') return Math.abs(p[1] + q[1]) <= HOLDS && Math.abs(p[0] - q[0]) <= HOLDS
      if (c.about === 'y') return Math.abs(p[0] + q[0]) <= HOLDS && Math.abs(p[1] - q[1]) <= HOLDS
      const axis = carrier(c.about)
      if (!axis) return true
      return Math.abs(dot2(sub2(mid2(p, q), axis.a), perp2(axis.d))) <= HOLDS && Math.abs(dot2(sub2(q, p), axis.d)) <= HOLDS
    }
    default:
      return true
  }
}

/** How much more an inset arc's sweep may change than its corners say,
 *  degrees. */
const INSET_ARC_SLACK_DEG = 15

/** How far a moved arc's sweep may change when its profile is moved in:
 *  nothing at a corner its neighbour runs tangent into it at — both move
 *  alike and stay tangent — up to about the angle between them at one they
 *  meet at an angle (twice it, for an inset deep against the radius), a
 *  quarter turn at one whose neighbour is kept, its end sliding round to
 *  where the kept line cuts the new circle; and INSET_ARC_SLACK_DEG over.
 *  The angle a corner is met at is taken either way round, so a cusp — a
 *  piece run back along its neighbour — counts as tangent, which it is to
 *  the relation that holds it. */
function cornerSlack(sketch: Sketch, loop: StationLoop, i: number, keep: ReadonlySet<number>): number {
  const n = loop.pieces.length
  const piece = (k: number) => entityOf(sketch, loop.pieces[k].id) as SketchLine | SketchArc
  const at = (k: number, end: 'from' | 'to') => travelAt(piece(k), loop.pieces[k].from, end === 'from' ? loop.pieces[k].from : loop.pieces[k].to)
  const corner = (k: number, other: number, end: 'from' | 'to') => {
    if (keep.has(loop.pieces[other].id)) return Math.PI / 2
    const [t, u] = [at(k, end), at(other, end === 'from' ? 'to' : 'from')]
    return t && u ? 2 * Math.asin(Math.min(1, Math.abs(cross2(t, u)))) : Math.PI / 2
  }
  return corner(i, (i - 1 + n) % n, 'from') + corner(i, (i + 1) % n, 'to') + (INSET_ARC_SLACK_DEG * Math.PI) / 180
}

/** Where a station folds, in words, or null: a corner the profile turns
 *  back at (more than a right angle — a piece run backwards along its
 *  neighbour), or a piece under STATION_MIN_PIECE_MM. */
function sourceFolds(sketch: Sketch, loop: StationLoop): string | null {
  const n = loop.pieces.length
  const piece = (k: number) => entityOf(sketch, loop.pieces[k].id) as SketchLine | SketchArc
  const short = loop.pieces.find((_, k) => pieceLength(piece(k)) < STATION_MIN_PIECE_MM)
  let worst: { a: number; b: number; turn: number } | null = null
  for (let k = 0; k < (loop.closed ? n : n - 1); k++) {
    const A = loop.pieces[k]
    const B = loop.pieces[(k + 1) % n]
    const t = travelAt(piece(k), A.from, A.to)
    const u = travelAt(piece((k + 1) % n), B.from, B.from)
    if (!t || !u) continue
    const turn = Math.acos(Math.max(-1, Math.min(1, dot2(t, u))))
    if (turn > Math.PI / 2 && (!worst || turn > worst.turn)) worst = { a: A.id, b: B.id, turn }
  }
  const words = [
    ...(worst ? [`the source folds back at the corner of pieces ${worst.a} and ${worst.b} (it turns ${degOf(worst.turn)}° there)`] : []),
    // units-ok: a station fit's or an inset's message, also the agent's answer
    ...(short ? [`its piece ${short.id} is ${mm(pieceLength(piece(loop.pieces.indexOf(short))))} mm long`] : []),
  ]
  if (words.length === 0) return null
  const said = words.join('; ')
  return said[0].toUpperCase() + said.slice(1)
}

/** The pairs of a profile's pieces that cross each other — not at the
 *  corner two neighbours share — read on their polylines. */
function crossingPairs(sketch: Sketch, loop: StationLoop): [number, number][] {
  const n = loop.pieces.length
  const lines = loop.pieces.map((p) => entityPolyline(entityOf(sketch, p.id)!, 48))
  const ends = loop.pieces.map((p) => {
    const e = entityOf(sketch, p.id)!
    return [anchorPoint(e, 'a'), anchorPoint(e, 'b')]
  })
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const beside = j === i + 1 || (loop.closed && i === 0 && j === n - 1)
      const atCorner = (p: Vec2) => beside && [...ends[i], ...ends[j]].some((q) => len2(sub2(p, q)) <= 10 * TOUCH_MM)
      let found = false
      for (let s = 0; s + 1 < lines[i].length && !found; s++) {
        const [p0, p1] = [lines[i][s], lines[i][s + 1]]
        const da = sub2(p1, p0)
        for (let t = 0; t + 1 < lines[j].length && !found; t++) {
          const [q0, q1] = [lines[j][t], lines[j][t + 1]]
          const db = sub2(q1, q0)
          const denom = cross2(da, db)
          if (Math.abs(denom) < 1e-18) continue
          const w = sub2(q0, p0)
          const x = cross2(w, db) / denom
          const y = cross2(w, da) / denom
          if (x < 0 || x > 1 || y < 0 || y > 1) continue
          if (!atCorner(add2(p0, scale2(da, x)))) found = true
        }
      }
      if (found) out.push([loop.pieces[i].id, loop.pieces[j].id])
    }
  }
  return out
}

/** A profile moved in: the sketch, the pieces moved and kept, and the
 *  relations the move broke, which went. */
export interface Inset {
  sketch: Sketch
  moved: number[]
  dropped: { id: number; kind: string }[]
}

/** The pieces a profile keeps where they lie when it is moved in and none
 *  are named: the drawn ones, where it has fitted ones too — the line it was
 *  closed with across the base — and none where all or none are fitted. An
 *  arc held tangent both ways (`sketch` says) is a round drawn on the
 *  outline, reverse.sketch.edit's add.rounds, and moves with it. */
export function insetKeeps(loop: StationLoop, sketch?: Pick<Sketch, 'constraints'>): number[] {
  const fitted = loop.pieces.filter((p) => p.fitted)
  if (!(fitted.length > 0 && fitted.length < loop.pieces.length)) return []
  const round = (id: number) => (sketch?.constraints ?? []).filter((c) => c.kind === 'tangent' && (c.a === id || c.b === id)).length >= 2
  return loop.pieces.filter((p) => !p.fitted && !(p.kind === 'arc' && round(p.id))).map((p) => p.id)
}

/**
 * A closed profile moved inward by `by` mm — outward for a negative `by` —
 * as a thin shell's inner station is its outer one moved in by the wall:
 * each line along its normal into the profile, each arc about its centre,
 * `by` off its radius where the profile lies on its centre's side and on
 * where it lies off it; the corners met again where the moved pieces cross.
 * Pieces in `keep` stay on their lines, their ends sliding along them to
 * meet the moved ones. The moved pieces let their slice points go: the
 * scan's points are the other skin's. Dimensions take what they now
 * measure (their expressions let go); a relation the move breaks — a moved
 * end held on a coordinate plane, a moved line along a kept one — goes, and
 * `dropped` lists it. Why not, in words: the profile is open, an arc would
 * close up, a piece would turn inside out — an arc's sweep changing more
 * than its corners let it (cornerSlack) among them — or the result would
 * close more than one region; the last two name the fold in the source
 * where there is one, which is most often why.
 */
export function insetSketch(sketch: Sketch, loop: StationLoop, by: number, keep: ReadonlySet<number>, datums?: readonly DatumTrace[]): Inset | string {
  const made = movedInward(sketch, loop, by, keep)
  if (typeof made === 'string') return made
  return { ...made, dropped: relationsSettled(made.sketch, made.moved, datums) }
}

/** insetSketch's move: one profile's pieces moved and the corners met again,
 *  the relations left as they were. */
function movedInward(sketch: Sketch, loop: StationLoop, by: number, keep: ReadonlySet<number>): { sketch: Sketch; moved: number[] } | string {
  if (!loop.closed) return 'the profile is open — an inset moves a closed profile inward; close it with a line across its ends first.'
  const out: Sketch = copyOf(sketch)
  const piece = (s: Sketch, id: number) => entityOf(s, id) as SketchLine | SketchArc
  // Which way the profile runs: counter-clockwise, its inside on the left.
  const outline = loop.pieces.flatMap((p) => {
    const pts = entityPolyline(piece(sketch, p.id), 48)
    return p.from === 'a' ? pts : pts.reverse()
  })
  const left = signedArea2(outline) > 0
  const inward = (travel: Vec2): Vec2 => (left ? perp2(travel) : scale2(perp2(travel), -1))
  const moved: number[] = []
  for (const p of loop.pieces) {
    if (keep.has(p.id)) continue
    const e = piece(out, p.id)
    if (e.kind === 'line') {
      const d = normalize2(sub2(p.to === 'b' ? e.b : e.a, p.to === 'b' ? e.a : e.b))
      if (!d) return `piece ${p.id} has no length.`
      const shift = scale2(inward(d), by)
      e.a = add2(e.a, shift)
      e.b = add2(e.b, shift)
    } else {
      const mid = e.start + e.sweep / 2
      const m = arcPoint(e, mid)
      const ccw: Vec2 = [-Math.sin(mid), Math.cos(mid)]
      const travel = p.from === 'a' ? ccw : scale2(ccw, -1)
      const r = dot2(inward(travel), sub2(e.c, m)) > 0 ? e.r - by : e.r + by
      // units-ok: a station fit's or an inset's message, also the agent's answer
      if (!(r > 1e-6)) return `the arc ${p.id} (R${Math.round(e.r * 1000) / 1000}) is tighter than ${Math.abs(by)} mm — it would close up. Make the wall thinner, or round that corner wider first.`
      e.r = r
    }
    delete e.points
    delete e.scatter
    moved.push(p.id)
  }
  const ends = new Map(loop.pieces.map((p) => [p.id, { from: p.from, to: p.to }]))
  // Each corner met where the moved pieces cross nearest where it stood.
  meetCorners(out, loop, ends, (id) => keep.has(id), (i) => anchorPoint(piece(sketch, loop.pieces[i].id), loop.pieces[i].to))
  // A piece that came out the other way round has turned inside out. An
  // arc keeps its sweep where its neighbours run tangent into it, and
  // changes by little more than the corners it meets them at; past that,
  // its neighbours crossed past it — most often because the source folds.
  const fold = sourceFolds(sketch, loop)
  const why = fold ? ` ${fold} — fit that station again (fit.like refuses a fold) before insetting it.` : ' Give a smaller inset.'
  for (const [i, p] of loop.pieces.entries()) {
    const [a, b] = [piece(sketch, p.id), piece(out, p.id)]
    if (a.kind === 'line' && b.kind === 'line') {
      const was = sub2(a.b, a.a)
      const now = sub2(b.b, b.a)
      // units-ok: a station fit's or an inset's message, also the agent's answer
      if (!(dot2(was, now) > 0) || len2(now) < 1e-6) return `piece ${p.id} would turn inside out at ${by} mm — the profile is narrower there than the inset takes; give it a smaller one, or keep that piece (keep).${fold ? ` ${fold}.` : ''}`
    } else if (a.kind === 'arc' && b.kind === 'arc') {
      const allowed = Math.min(Math.PI, cornerSlack(sketch, loop, i, keep))
      // units-ok: a station fit's or an inset's message, also the agent's answer
      if (Math.abs(b.sweep - a.sweep) > allowed || b.sweep < 1e-6) return `the arc ${p.id} would turn inside out at ${by} mm — its sweep goes from ${degOf(a.sweep)}° to ${degOf(b.sweep)}°, more than the corners it meets its neighbours at let it (${degOf(allowed)}°): they cross past it.${why}`
    }
  }
  // One closed profile in, one region out: a result that crosses itself
  // lofts a fragment of itself.
  const ids = new Set(loop.pieces.map((p) => p.id))
  const regions = findRegions({ entities: out.entities.filter((e) => ids.has(e.id)) })
  if (regions.length > 1) {
    const pairs = crossingPairs(out, loop)
    // units-ok: a station fit's or an inset's message, also the agent's answer
    return `the inset at ${by} mm crosses itself: it closes ${regions.length} regions (areas ${regions.map((r) => mm(r.area)).join(', ')} mm²)${pairs.length > 0 ? `, pieces ${pairs.map(([x, y]) => `${x} and ${y}`).join(', ')} crossing` : ''}.${why}`
  }
  return { sketch: out, moved }
}

/** After a move: the dimensions on the pieces moved read again, the
 *  relations it broke let go, and which went. */
function relationsSettled(out: Sketch, moved: readonly number[], datums: readonly DatumTrace[] | undefined): { id: number; kind: string }[] {
  const dropped: { id: number; kind: string }[] = []
  const movedSet = new Set(moved)
  out.constraints = out.constraints.filter((c) => {
    if (!constraintEntities(c).some((id) => movedSet.has(id))) return true
    if (isDimension(c)) {
      const at = (id: number) => entityOf(out, id)!
      const value =
        c.kind === 'length' || c.kind === 'radius' || c.kind === 'diameter'
          ? measureDimension(out, c.kind, at(c.entity))
          : c.kind === 'angle'
            ? measureDimension(out, 'angle', at(c.a), at(c.b))
            : measureDimension(out, 'distance', c.p, c.q, datums)
      if (value === null) {
        dropped.push({ id: c.id, kind: c.kind })
        return false
      }
      c.value = value
      delete c.expr
      return true
    }
    if (holds(out, c, datums)) return true
    dropped.push({ id: c.id, kind: c.kind })
    return false
  })
  return dropped
}

/** A sketch's drawn pieces by the chains they make: those whose ends meet
 *  (within TOUCH_MM) are one, a circle or a closed spline one of its own. */
function chainsOf(sketch: Pick<Sketch, 'entities'>): SketchEntity[][] {
  const own = sketch.entities.filter((e) => !e.construction && e.kind !== 'point')
  const parent = own.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  const ends = own.map((e) => endsOf(e).map((at) => anchorPoint(e, at)))
  for (let i = 0; i < own.length; i++)
    for (let j = i + 1; j < own.length; j++) if (ends[i].some((p) => ends[j].some((q) => len2(sub2(p, q)) <= TOUCH_MM))) parent[root(i)] = root(j)
  const out = new Map<number, SketchEntity[]>()
  own.forEach((e, i) => (out.get(root(i)) ?? out.set(root(i), []).get(root(i))!).push(e))
  return [...out.values()]
}

/** Whether a point lies inside a closed outline. */
function insidePolygon(poly: readonly Vec2[], p: Vec2): boolean {
  let inn = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]]
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inn = !inn
  }
  return inn
}

/** Whether two chains' outlines cross, read on their polylines. */
function outlinesCross(a: readonly (readonly Vec2[])[], b: readonly (readonly Vec2[])[]): boolean {
  for (const la of a)
    for (const lb of b)
      for (let s = 0; s + 1 < la.length; s++) {
        const da = sub2(la[s + 1], la[s])
        for (let t = 0; t + 1 < lb.length; t++) {
          const db = sub2(lb[t + 1], lb[t])
          const denom = cross2(da, db)
          if (Math.abs(denom) < 1e-18) continue
          const w = sub2(lb[t], la[s])
          const x = cross2(w, db) / denom
          const y = cross2(w, da) / denom
          if (x >= 0 && x <= 1 && y >= 0 && y <= 1) return true
        }
      }
  return false
}

/** The slice points a piece had, moved as the piece was: across a line's
 *  shift, along their radii by a round's change of radius. */
function pointsMoved(was: SketchEntity, now: SketchEntity): Vec2[] | undefined {
  if (!('points' in was) || !was.points?.length) return undefined
  if (was.kind === 'line' && now.kind === 'line') {
    const d = normalize2(sub2(now.b, now.a))
    if (!d) return undefined
    const n = perp2(d)
    const by = scale2(n, dot2(n, sub2(now.a, was.a)))
    return was.points.map((p) => add2(p, by))
  }
  if ((was.kind === 'arc' && now.kind === 'arc') || (was.kind === 'circle' && now.kind === 'circle')) {
    return was.points.map((p) => {
      const out = sub2(p, was.c)
      const r = len2(out)
      return r > 1e-9 ? add2(now.c, scale2(out, (r + now.r - was.r) / r)) : p
    })
  }
  return undefined
}

/** A chain as an inset answers with it: its pieces, how far it moved inward
 *  (outward where negative), and those of them held where they lie. */
export interface ChainInset {
  pieces: number[]
  by: number
  kept: number[]
}

/** A sketch's profiles moved inward: the sketch, what moved, the relations
 *  that went, each chain's move, the ids held where they lie, and the chains
 *  left where they lie because they are open. */
export interface ChainsInset extends Inset {
  chains: ChainInset[]
  kept: number[]
  open: number[][]
}

/** What insetChains is asked: how far each chain moves — by how many closed
 *  chains lie round it, where it depends on that — the pieces held where
 *  they lie (by default each chain's insetKeeps), the chains to move (those
 *  with a piece in `only`; by default every one), and the slice points kept,
 *  moved with their pieces, in place of let go. */
export interface InsetChainsAsk {
  by: number | ((depth: number) => number)
  keep?: (loop: StationLoop) => ReadonlySet<number>
  only?: ReadonlySet<number>
  keepPoints?: boolean
  name: string
  datums?: readonly DatumTrace[]
}

/**
 * Every closed chain of a sketch moved inward on its own (insetSketch; a
 * circle by its radius): each into its own inside, so a chain inside
 * another moves away from it. Open chains, among closed ones, stay where
 * they lie and are named. All or nothing: a chain that closes up or turns
 * inside out, or two that come to cross, refuse the whole of it, by chain.
 * One chain alone refuses in insetSketch's own words.
 */
export function insetChains(sketch: Sketch, ask: InsetChainsAsk): ChainsInset | string {
  const all = chainsOf(sketch)
  if (all.length === 0) return `${ask.name} has no pieces.`
  const chains = ask.only ? all.filter((c) => c.some((e) => ask.only!.has(e.id))) : all
  const named = (c: readonly SketchEntity[]) => `pieces ${c.map((e) => e.id).join(', ')}`
  type Read = { pieces: SketchEntity[]; loop?: StationLoop }
  const read: Read[] = []
  const refused: string[] = []
  const open: number[][] = []
  for (const pieces of chains) {
    if (pieces.length === 1 && pieces[0].kind === 'circle') {
      read.push({ pieces })
      continue
    }
    const loop = stationLoop({ entities: pieces }, ask.name, { anyRuns: true })
    if (typeof loop === 'string') refused.push(chains.length === 1 ? loop : `${named(pieces)}: ${loop}`)
    else if (loop.closed) read.push({ pieces, loop })
    else if (chains.length === 1) return movedInward(sketch, loop, 0, new Set()) as string
    else open.push(pieces.map((e) => e.id))
  }
  const noneMove = (words: readonly string[], of: number) => (of === 1 ? words[0] : `${words.length} of the ${of} chains do not move: ${words.join('; ')} — nothing was moved.`)
  if (refused.length > 0) return noneMove(refused, chains.length)
  if (read.length === 0) return 'every chain is open — an inset moves a closed profile inward; close them with a line across their ends first.'
  // Each chain's outline before the move: how deep it lies among the others.
  const outlineOf = (s: Pick<Sketch, 'entities'>, r: Read) => r.pieces.map((e) => entityPolyline(entityOf(s, e.id)!, 48))
  const before = read.map((r) => outlineOf(sketch, r))
  const depthOf = (i: number) => before.filter((o, k) => k !== i && insidePolygon(joinedOutline(read[k], o), before[i][0][0])).length
  let out = sketch
  const moved: number[] = []
  const chainsOut: ChainInset[] = []
  const kept: number[] = []
  read.forEach((r, i) => {
    const by = typeof ask.by === 'number' ? ask.by : ask.by(depthOf(i))
    const say = (why: string) => refused.push(read.length === 1 ? why : `${named(r.pieces)}: ${why}`)
    if (!r.loop) {
      const was = r.pieces[0] as SketchCircle
      // units-ok: a station fit's or an inset's message, also the agent's answer
      if (!(was.r - by > 1e-6)) return void say(`the circle ${was.id} (R${mm(was.r)}) is tighter than ${Math.abs(by)} mm — it would close up. Give a smaller inset.`)
      out = copyOf(out)
      const e = entityOf(out, was.id) as SketchCircle
      e.r = was.r - by
      delete e.points
      delete e.scatter
      moved.push(was.id)
      chainsOut.push({ pieces: [was.id], by, kept: [] })
      return
    }
    const keep = ask.keep ? ask.keep(r.loop) : new Set(insetKeeps(r.loop, sketch))
    const made = movedInward(out, r.loop, by, keep)
    if (typeof made === 'string') return void say(made)
    out = made.sketch
    moved.push(...made.moved)
    const held = r.loop.pieces.filter((p) => keep.has(p.id)).map((p) => p.id)
    kept.push(...held)
    chainsOut.push({ pieces: r.pieces.map((e) => e.id), by, kept: held })
  })
  if (refused.length > 0) return noneMove(refused, read.length)
  const after = read.map((r) => outlineOf(out, r))
  for (let i = 0; i < read.length; i++)
    for (let j = i + 1; j < read.length; j++)
      if (outlinesCross(after[i], after[j]) && !outlinesCross(before[i], before[j])) return `moved, the chains of ${named(read[i].pieces)} and of ${named(read[j].pieces)} would cross — give a smaller inset, or inset them apart. Nothing was moved.`
  if (ask.keepPoints) {
    for (const id of moved) {
      const was = entityOf(sketch, id)!
      const now = entityOf(out, id)!
      const points = pointsMoved(was, now)
      if (points) Object.assign(now, { points, ...('scatter' in was && was.scatter !== undefined ? { scatter: was.scatter } : {}) })
    }
  }
  return { sketch: out, moved, dropped: relationsSettled(out, moved, ask.datums), chains: chainsOut, kept, open }
}

/** A chain's polylines as one closed outline, in its order round. */
function joinedOutline(r: { loop?: StationLoop; pieces: readonly SketchEntity[] }, lines: readonly (readonly Vec2[])[]): Vec2[] {
  if (!r.loop) return lines.flat()
  return r.loop.pieces.flatMap((p) => {
    const k = r.pieces.findIndex((e) => e.id === p.id)
    return p.from === 'a' ? [...lines[k]] : [...lines[k]].reverse()
  })
}
