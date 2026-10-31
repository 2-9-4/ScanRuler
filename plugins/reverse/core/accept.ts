// SPDX-License-Identifier: AGPL-3.0-only
// A fitted sketch's near-relations taken as the design's in one go: every
// candidate (intent.ts) within so many sigmas of holding — the scan's noise
// says it holds — is added and the sketch solved, nearest the mark first.
// One the solve cannot meet with those before it is taken back (it fights
// a relation already accepted), and so is one that says nothing new (it
// follows from them); one only part of which follows is taken for the
// rest (its constraints say which). What is left is offered, with why. The
// trials are solved with the part's planes, as the sketch is. A relation
// within the sigmas may still be one the fit's pieces can only meet by
// leaving their points: a trial that moves any piece farther than the
// rule's maxMoveMm from where the fit put it is taken back too. The move is
// read off the piece's curve — how far its ends and middle as they were
// stand off the line or circle it lies on after — not by an arc's centre,
// nor by a join sliding along the pieces: a corner a hair off tangent made
// tangent runs its meeting point R·θ along them, and neither leaves its
// points. Unless told, the limit is three of the sigmas the candidate
// itself was judged by: the per-point sigma of the pieces it relates, their
// own residual floored at the chain's scatter. The scatter alone is the
// point-to-point noise, and a scanned surface's waviness is not in it: a
// tangent within two sigmas of a fit that misses its points by 0.017 must
// be free to move a piece some hundredths. When every candidate of a kind
// is left for moving, a note says how far they went and the limit that
// takes them, to be weighed against the part's tolerance. The agent reads
// the list and takes out what it disagrees with — slice to constrained
// profile in one call, the judgement still the agent's.

import { candidatesOf, pointSigma, type Candidate, type CandidateKind, DEFAULT_NET, type IntentNet } from './intent'
import type { DatumTrace } from './datums'
import { retakeMoved } from './project'
import { addConstraint, cloneSketch, type Sketch, type SketchEntity } from './sketch'
import { solveSketch } from './solver'
import { round4 } from '../../../src/core/round'

export interface AcceptRule {
  /** Accept candidates at most this many sigmas off. */
  sigmas: number
  /** Only these kinds; every kind when left out. */
  kinds?: readonly CandidateKind[]
  /** The farthest a trial may move any piece from where it was, mm; when
   *  left out, MOVE_SCATTERS of the larger of the fit's scatter and the
   *  per-point sigma of the pieces the candidate relates. */
  maxMoveMm?: number
}

/** A candidate as the answer gives it. */
export interface CandidateBrief {
  kind: CandidateKind
  pieces: number[]
  off: number
  unit: 'deg' | 'mm'
  sigmas: number | null
  datum?: string
  what?: string
  nominal?: number
}

/** The piece a trial moved farthest, and how far, mm. */
export interface Moves {
  piece: number
  mm: number
  /** The limit that trial was held to, mm. */
  limitMm: number
}

export interface AcceptResult {
  accepted: (CandidateBrief & { constraints: number[] })[]
  /** Offered and not taken: over the sigmas, of a kind not asked for, in
   *  conflict with one accepted, implied by those accepted, or moving a
   *  piece farther than maxMoveMm (moves says which, and how far). */
  left: (CandidateBrief & { why: 'sigmas' | 'kind' | 'conflict' | 'implied' | 'moved'; moves?: Moves })[]
  /** The limit the trials were held to, mm: the rule's, or the largest of
   *  the candidates' own when it gave none. */
  maxMoveMm: number
  /** Where every candidate of a kind within the sigmas was left for moving:
   *  how far they went, and the maxMoveMm that takes them. */
  note?: string
}

/** How many candidates are looked at, at most. */
const ACCEPT_LIMIT = 400
/** How many sigmas — the fit's scatter, or the pieces' own residual where
 *  larger — a trial may move a piece, unless the rule says otherwise. */
export const MOVE_SCATTERS = 3
/** The least the default limit is, mm: a slice off a clean mesh has next to
 *  no scatter, and the solver's own settling is not a move. */
const MOVE_FLOOR_MM = 0.01

/** The fit's scatter: the largest any fitted piece carries, mm — the
 *  pieces of one chain carry that chain's. 0 for a sketch with none. */
export function fitScatter(sketch: Sketch): number {
  let most = 0
  for (const e of sketch.entities) if ('points' in e && e.points && e.points.length > 0 && e.scatter !== undefined) most = Math.max(most, e.scatter)
  return most
}

/** The piece moved farthest between two states of a sketch, or null when
 *  none moved. Pieces new in `now` are not counted. */
function farthest(was: Sketch, now: Sketch): { piece: number; mm: number } | null {
  let best: { piece: number; mm: number } | null = null
  for (const e of now.entities) {
    const w = was.entities.find((x) => x.id === e.id)
    if (!w || w.kind !== e.kind) continue
    const mm = offCurve(w, e)
    if (Number.isFinite(mm) && (!best || mm > best.mm)) best = { piece: e.id, mm }
  }
  return best
}

/** How far a piece moved off where it was, mm: the most its ends and
 *  middle as they were stand off the line or circle it lies on now. A
 *  join that only slides along the pieces — two arcs a hair off tangent
 *  made tangent, the meeting point running R·θ along them — moves neither
 *  off its points, and is not counted. Other pieces as retakeMoved has
 *  them. */
export function offCurve(was: SketchEntity, now: SketchEntity): number {
  type V = [number, number]
  if (was.kind === 'line' && now.kind === 'line') {
    const dx = now.b[0] - now.a[0], dy = now.b[1] - now.a[1]
    const L = Math.hypot(dx, dy)
    if (!(L > 1e-9)) return retakeMoved(was, now)
    const off = (p: V) => Math.abs((p[0] - now.a[0]) * dy - (p[1] - now.a[1]) * dx) / L
    return Math.max(off(was.a), off(was.b))
  }
  if (was.kind === 'arc' && now.kind === 'arc') {
    const at = (t: number): V => [was.c[0] + was.r * Math.cos(was.start + t * was.sweep), was.c[1] + was.r * Math.sin(was.start + t * was.sweep)]
    const off = (p: V) => Math.abs(Math.hypot(p[0] - now.c[0], p[1] - now.c[1]) - now.r)
    return Math.max(off(at(0)), off(at(0.5)), off(at(1)))
  }
  return retakeMoved(was, now)
}

const brief = (c: Candidate): CandidateBrief => ({
  kind: c.kind,
  pieces: c.pieces,
  off: c.off,
  unit: c.unit,
  sigmas: c.sigmas,
  ...(c.datum ? { datum: c.datum } : {}),
  ...(c.what ? { what: c.what } : {}),
  ...(c.nominal !== undefined ? { nominal: c.nominal } : {}),
})

/** The sketch with the candidates the rule accepts added, solved; in
 *  place. */
export function acceptCandidates(sketch: Sketch, datums: readonly DatumTrace[], rule: AcceptRule, net: IntentNet = DEFAULT_NET): AcceptResult {
  const candidates = candidatesOf(sketch.entities, datums, net, sketch.constraints, ACCEPT_LIMIT)
  const accepted: AcceptResult['accepted'] = []
  const left: AcceptResult['left'] = []
  // The trial solves are the real one's: with the part's coordinate planes
  // given, or a relation to one holds nothing in the trial, is taken, and
  // fights the fit's own joins once the sketch is solved for real.
  const options = { datums }
  const start = solveSketch(sketch, options)
  let redundant = start.redundant
  let equations = start.equations
  // Where the pieces were before anything was accepted: every trial is
  // measured from there, so small moves cannot add up past the limit.
  const fitted = cloneSketch(sketch)
  const scatter = fitScatter(sketch)
  const sigmas = new Map(fitted.entities.map((e) => [e.id, pointSigma(e)]))
  const limitOf = (c: Candidate): number =>
    rule.maxMoveMm ?? Math.max(MOVE_SCATTERS * Math.max(scatter, ...c.pieces.map((p) => sigmas.get(p) ?? 0)), MOVE_FLOOR_MM)
  let largest = rule.maxMoveMm ?? Math.max(MOVE_SCATTERS * scatter, MOVE_FLOOR_MM)
  let limit = largest
  const tooFar = (): Moves | null => {
    const far = farthest(fitted, sketch)
    return far && far.mm > limit ? { piece: far.piece, mm: round4(far.mm), limitMm: round4(limit) } : null
  }
  for (const c of candidates) {
    if (rule.kinds && !rule.kinds.includes(c.kind)) {
      left.push({ ...brief(c), why: 'kind' })
      continue
    }
    if (c.sigmas === null || c.sigmas > rule.sigmas) {
      left.push({ ...brief(c), why: 'sigmas' })
      continue
    }
    limit = limitOf(c)
    largest = Math.max(largest, limit)
    const before = cloneSketch(sketch)
    const ids = c.constraints.map((k) => addConstraint(sketch, k))
    const report = solveSketch(sketch, options)
    const moves = report.ok ? tooFar() : null
    if (moves) {
      restore(sketch, before)
      left.push({ ...brief(c), why: 'moved', moves })
      continue
    }
    if (report.ok && report.redundant <= redundant) {
      accepted.push({ ...brief(c), constraints: ids })
      equations = report.equations
      continue
    }
    restore(sketch, before)
    // Part of it may follow from what is taken already — a mirror's equal
    // radius once the tangent sides fix the radii, the level of a mirror
    // pair whose centres already lie on the plane — and the rest not: each
    // of its relations in turn, kept where it pins down something the
    // sketch did not hold, though one of its equations repeats another.
    if (report.ok) {
      const kept: number[] = []
      let refused: Moves | null = null
      for (const k of c.constraints) {
        const was = cloneSketch(sketch)
        const id = addConstraint(sketch, k)
        const one = solveSketch(sketch, options)
        const gained = one.equations - equations - (one.redundant - redundant)
        const moves = one.ok && gained > 0 ? tooFar() : null
        if (one.ok && gained > 0 && !moves) {
          kept.push(id)
          redundant = one.redundant
          equations = one.equations
        } else {
          restore(sketch, was)
          refused = moves ?? refused
        }
      }
      if (kept.length > 0) {
        accepted.push({ ...brief(c), constraints: kept })
        continue
      }
      if (refused) {
        left.push({ ...brief(c), why: 'moved', moves: refused })
        continue
      }
    }
    left.push({ ...brief(c), why: report.ok ? 'implied' : 'conflict' })
  }
  const note = movedNote(accepted, left)
  return { accepted, left, maxMoveMm: round4(largest), ...(note ? { note } : {}) }
}

/** What a kind's candidates are called, more than one. */
const KIND_WORDS: Record<CandidateKind, string> = {
  horizontal: 'horizontals',
  vertical: 'verticals',
  parallel: 'parallels',
  perpendicular: 'perpendiculars',
  collinear: 'in-line pairs',
  angle: 'round angles',
  equal: 'equal pairs',
  concentric: 'concentric pairs',
  tangent: 'tangents',
  onDatum: 'on-plane relations',
  symmetric: 'mirror pairs',
}

/** A move as the note gives it: hundredths, or one figure under 0.01. */
const mmText = (mm: number): string => (mm >= 0.01 ? mm.toFixed(2) : mm.toPrecision(1))

/** One line for each kind of which every candidate within the sigmas was
 *  left for moving: "all 7 tangents moved 0.02–0.04 mm; `maxMoveMm: 0.05`
 *  takes them — compare with T". Null when no kind was. */
function movedNote(accepted: AcceptResult['accepted'], left: AcceptResult['left']): string | null {
  const lines: string[] = []
  for (const kind of Object.keys(KIND_WORDS) as CandidateKind[]) {
    const tried = left.filter((l) => l.kind === kind && l.why !== 'sigmas' && l.why !== 'kind')
    const moved = tried.filter((l) => l.why === 'moved' && l.moves)
    if (moved.length === 0 || moved.length < tried.length || accepted.some((a) => a.kind === kind)) continue
    const mms = moved.map((l) => l.moves!.mm)
    const lo = Math.min(...mms), hi = Math.max(...mms)
    const takes = Math.ceil(hi * 100 + 1e-9) / 100
    // units-ok: a note of a command's answer, beside its maxMoveMm
    const range = mmText(lo) === mmText(hi) ? `${mmText(hi)} mm` : `${mmText(lo)}–${mmText(hi)} mm`
    const what = moved.length === 1 ? `the one ${KIND_WORDS[kind].replace(/s$/, '')} moved ${range}` : `all ${moved.length} ${KIND_WORDS[kind]} moved ${range}`
    lines.push(`${what}; \`maxMoveMm: ${takes}\` takes ${moved.length === 1 ? 'it' : 'them'} — compare with T`)
  }
  return lines.length > 0 ? lines.join('; ') : null
}

/** The sketch put back as it was before a trial. */
function restore(sketch: Sketch, was: Sketch): void {
  sketch.entities = was.entities
  sketch.constraints = was.constraints
  sketch.nextId = was.nextId
}
