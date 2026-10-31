// SPDX-License-Identifier: AGPL-3.0-only
// Screw threads, as the Thread feature cuts them: the standard sizes and the
// basic profile of each form, as the outline of one tooth in a plane through
// the axis. The kernel brings a round face to the thread's crests, whatever
// size it was drawn (fillRadius), screws the tooth along it and takes out of
// the body what lies between its turns (kernel.ts threadTracked).
//
// There are two forms. ISO metric coarse and fine, Unified coarse (UNC) and
// fine (UNF) share one: a 60° vee cut flat at the crest and at the root
// (ISO 68-1, ASME B1.1). The other is made for 3D printing: 90° between the
// flanks, each at 45° to the radius, and a flat a fifth of the pitch wide at
// the crest and at the root. Printed with its axis upright, the flats stand
// upright and every face that looks down leans at 45°, so it prints without
// supports; the 60° form's flanks lie 30° off level. It is a form of its own
// — it mates only with itself — sized on the ISO metric diameters at the
// pitch that cuts as deep as their coarse thread.
//
// The outline is the material that stays: a bolt's tooth standing on its
// core, or a nut's tooth hanging from its wall. Either reaches a little past
// the band the thread is cut in, so the tooth and the band never share a
// surface, and is narrower than the pitch, so the turns never meet.
//
// The offset is a clearance for printing: every face of the thread moved
// into the material — the flanks thinner, the crest lower, the root deeper —
// so a printed bolt turns into a printed nut. At a quarter of the pitch
// times the cosine of the flank's angle — an eighth of √3 times the pitch in
// the 60° form, of √2 times it in the 45° one — the tooth has no thickness
// left where the threads bear, the pitch diameter, and the offset is refused
// there. Short of that, the 60° form's crest comes to a point once the
// offset has used up its flat; the 45° form's flats are wide enough that it
// never does.

import { type DisplayUnits, lengthDecimals, toDisplay, unitWord } from '../../../src/core/units'

/** The standard a thread's sizes come from, and with them its form: the
 *  60° one of the metric and Unified tables, or the 45° one for printing. */
export type ThreadStandard = 'metric' | 'unc' | 'unf' | 'print45'

export const THREAD_STANDARDS: { id: ThreadStandard; label: string }[] = [
  { id: 'metric', label: 'ISO metric' },
  { id: 'unc', label: 'Unified coarse (UNC)' },
  { id: 'unf', label: 'Unified fine (UNF)' },
  { id: 'print45', label: '3D printing — 45° flanks' },
]

/**
 * A thread's basic profile, its lengths as shares of the pitch: how far the
 * flanks lean from the radius — the tangent and the secant of that angle —
 * how deep the profile is from the major diameter to the minor, and the
 * flats of a bolt's tooth, its crest on the major diameter and the gap's
 * floor, its root, on the minor. A nut's tooth is the bolt's gap: its crest
 * as wide as the bolt's root, its root as the bolt's crest. A crest, a root
 * and the two flanks between them make the pitch:
 * crest + root + 2 × depth × tan = 1.
 */
interface ThreadForm {
  tan: number
  sec: number
  depth: number
  crest: number
  root: number
}

/** The 60° form of ISO 68-1 and ASME B1.1: the flanks at 30° to the radius,
 *  five eighths of the sharp vee's √3/2 deep, a bolt's crest an eighth of
 *  the pitch wide and its root a quarter. */
const V60: ThreadForm = { tan: 1 / Math.sqrt(3), sec: 2 / Math.sqrt(3), depth: (5 / 8) * (Math.sqrt(3) / 2), crest: 1 / 8, root: 1 / 4 }

/** The 45° form for printing: the flanks at 45° to the radius, the crest
 *  and the root a fifth of the pitch wide each, and so 0.3 of it deep. The
 *  tooth and the gap are each half the pitch wide halfway down. */
const PRINT45: ThreadForm = { tan: 1, sec: Math.SQRT2, depth: 0.3, crest: 1 / 5, root: 1 / 5 }

const FORMS: Record<ThreadStandard, ThreadForm> = { metric: V60, unc: V60, unf: V60, print45: PRINT45 }

export interface ThreadSize {
  /** What the size is called: M16, 1/4, #10, Ø16. */
  label: string
  /** The nominal — major — diameter, millimetres. */
  diameter: number
  /** The pitches it is made in, millimetres, the standard's own first: a
   *  metric size's coarse pitch, then its fine ones; a printing size's pitch
   *  as deep as the ISO coarse thread, then the ISO coarse pitch. */
  pitches: number[]
}

/** ISO 261, the sizes of the first and second choice up to M64: the
 *  diameter and its pitches, coarse first. */
const METRIC: [number, number[]][] = [
  [1, [0.25, 0.2]],
  [1.2, [0.25, 0.2]],
  [1.4, [0.3, 0.2]],
  [1.6, [0.35, 0.2]],
  [2, [0.4, 0.25]],
  [2.5, [0.45, 0.35]],
  [3, [0.5, 0.35]],
  [3.5, [0.6, 0.35]],
  [4, [0.7, 0.5]],
  [5, [0.8, 0.5]],
  [6, [1, 0.75]],
  [7, [1, 0.75]],
  [8, [1.25, 1, 0.75]],
  [10, [1.5, 1.25, 1, 0.75]],
  [12, [1.75, 1.5, 1.25, 1]],
  [14, [2, 1.5, 1.25, 1]],
  [16, [2, 1.5, 1]],
  [18, [2.5, 2, 1.5, 1]],
  [20, [2.5, 2, 1.5, 1]],
  [22, [2.5, 2, 1.5, 1]],
  [24, [3, 2, 1.5, 1]],
  [27, [3, 2, 1.5, 1]],
  [30, [3.5, 3, 2, 1.5, 1]],
  [33, [3.5, 3, 2, 1.5]],
  [36, [4, 3, 2, 1.5]],
  [39, [4, 3, 2, 1.5]],
  [42, [4.5, 4, 3, 2, 1.5]],
  [45, [4.5, 4, 3, 2, 1.5]],
  [48, [5, 4, 3, 2, 1.5]],
  [52, [5, 4, 3, 2, 1.5]],
  [56, [5.5, 4, 3, 2, 1.5]],
  [60, [5.5, 4, 3, 2, 1.5]],
  [64, [6, 4, 3, 2, 1.5]],
]

/** ASME B1.1: the size, its major diameter in inches, threads per inch. */
const UNC: [string, number, number][] = [
  ['#1', 0.073, 64],
  ['#2', 0.086, 56],
  ['#3', 0.099, 48],
  ['#4', 0.112, 40],
  ['#5', 0.125, 40],
  ['#6', 0.138, 32],
  ['#8', 0.164, 32],
  ['#10', 0.19, 24],
  ['#12', 0.216, 24],
  ['1/4', 0.25, 20],
  ['5/16', 0.3125, 18],
  ['3/8', 0.375, 16],
  ['7/16', 0.4375, 14],
  ['1/2', 0.5, 13],
  ['9/16', 0.5625, 12],
  ['5/8', 0.625, 11],
  ['3/4', 0.75, 10],
  ['7/8', 0.875, 9],
  ['1', 1, 8],
  ['1-1/8', 1.125, 7],
  ['1-1/4', 1.25, 7],
  ['1-3/8', 1.375, 6],
  ['1-1/2', 1.5, 6],
  ['1-3/4', 1.75, 5],
  ['2', 2, 4.5],
]

const UNF: [string, number, number][] = [
  ['#0', 0.06, 80],
  ['#1', 0.073, 72],
  ['#2', 0.086, 64],
  ['#3', 0.099, 56],
  ['#4', 0.112, 48],
  ['#5', 0.125, 44],
  ['#6', 0.138, 40],
  ['#8', 0.164, 36],
  ['#10', 0.19, 32],
  ['#12', 0.216, 28],
  ['1/4', 0.25, 28],
  ['5/16', 0.3125, 24],
  ['3/8', 0.375, 24],
  ['7/16', 0.4375, 20],
  ['1/2', 0.5, 20],
  ['9/16', 0.5625, 18],
  ['5/8', 0.625, 18],
  ['3/4', 0.75, 16],
  ['7/8', 0.875, 14],
  ['1', 1, 12],
  ['1-1/8', 1.125, 12],
  ['1-1/4', 1.25, 12],
  ['1-3/8', 1.375, 12],
  ['1-1/2', 1.5, 12],
]

const INCH = 25.4

/** The smallest diameter the printing form is offered at, millimetres. */
const PRINT_FROM = 3

/** The printing form's pitch for an ISO coarse one: the pitch it cuts as
 *  deep at — 0.54 of the pitch deep in the 60° form, 0.3 in the 45° one, so
 *  1.8 times as long — rounded to a quarter of a millimetre under 3 mm and
 *  to a half from 3 mm up. As deep as the coarse thread, it keeps ISO's
 *  minor diameter: the core is as strong, and a bore drilled to the tap
 *  drill's size is taken for the same size (sizeForFace). */
function printPitch(coarse: number): number {
  const p = (coarse * V60.depth) / PRINT45.depth
  const step = p < 3 ? 0.25 : 0.5
  return Math.round(p / step) * step
}

const SIZES: Record<ThreadStandard, ThreadSize[]> = {
  metric: METRIC.map(([d, pitches]) => ({ label: `M${d}`, diameter: d, pitches })),
  unc: UNC.map(([label, d, tpi]) => ({ label, diameter: d * INCH, pitches: [INCH / tpi] })),
  unf: UNF.map(([label, d, tpi]) => ({ label, diameter: d * INCH, pitches: [INCH / tpi] })),
  // The ISO metric diameters from 3 mm, at the pitch as deep as their
  // coarse thread and then, finer and shallower, the coarse pitch itself.
  print45: METRIC.filter(([d]) => d >= PRINT_FROM).map(([d, [coarse]]) => ({ label: `Ø${d}`, diameter: d, pitches: [printPitch(coarse), coarse] })),
}

/** The sizes of a standard, smallest first. */
export function threadSizes(standard: ThreadStandard): readonly ThreadSize[] {
  return SIZES[standard]
}

/** How close a typed number has to be to a table's to be that size. */
const SAME_MM = 1e-4

/** The size of the standard a diameter is, or null for one it does not
 *  have. */
export function sizeOf(standard: ThreadStandard, diameter: number): ThreadSize | null {
  return SIZES[standard].find((s) => Math.abs(s.diameter - diameter) < SAME_MM) ?? null
}

/** Threads per inch for a pitch in millimetres. */
export function threadsPerInch(pitch: number): number {
  return INCH / pitch
}

/** What a thread is called — M16×2, 1/4-20 UNC, Ø16×3.5 print — or null
 *  for a diameter and pitch the standard does not have together. */
export function threadDesignation(standard: ThreadStandard, diameter: number, pitch: number): string | null {
  const size = sizeOf(standard, diameter)
  if (!size || !size.pitches.some((p) => Math.abs(p - pitch) < SAME_MM)) return null
  if (standard === 'metric') return `${size.label}×${trim(pitch)}`
  if (standard === 'print45') return `${size.label}×${trim(pitch)} print`
  return `${size.label}-${trim(Math.round(threadsPerInch(pitch) * 100) / 100)} ${standard.toUpperCase()}`
}

/** A thread named as it reads in a row: its designation, or its diameter
 *  and pitch where it is not a standard one — marked "print" in the
 *  printing form, so a row always says which form it is cut in. */
export function threadName(standard: ThreadStandard, diameter: number, pitch: number): string {
  return threadDesignation(standard, diameter, pitch) ?? `Ø${trim(Math.round(diameter * 1000) / 1000)} × ${trim(Math.round(pitch * 1000) / 1000)}${standard === 'print45' ? ' print' : ''}`
}

const trim = (v: number) => String(Math.round(v * 10000) / 10000)

/** How deep a standard's basic profile is, from the major diameter to the
 *  minor: five eighths of the sharp vee's √3/2 of the pitch in the 60°
 *  form, 0.3 of the pitch in the 45° one. */
export function threadDepth(pitch: number, standard: ThreadStandard): number {
  return FORMS[standard].depth * pitch
}

/** The basic profile's minor diameter — a bolt's root, a nut's crest. */
export function minorDiameter(diameter: number, pitch: number, standard: ThreadStandard): number {
  return diameter - 2 * threadDepth(pitch, standard)
}

/** The diameter the flanks are half tooth and half gap at, where the
 *  threads bear on each other: as far in from the major diameter as the
 *  flank takes to widen a bolt's crest to half the pitch. */
export function pitchDiameter(diameter: number, pitch: number, standard: ThreadStandard): number {
  const form = FORMS[standard]
  return diameter - (pitch / 2 - form.crest * pitch) / form.tan
}

/** A round face's diameter as drawn against the one its thread is cut to —
 *  a boss's against the major, a bore's against the minor: wider or
 *  narrower by more than the thread's depth, half of it a side, a scan's or
 *  a print's slack; null within it. */
export function faceAgainstThread(t: ThreadSpec, internal: boolean, faceDiameter: number): 'wider' | 'narrower' | null {
  const slack = threadDepth(t.pitch, t.standard)
  const own = internal ? minorDiameter(t.diameter, t.pitch, t.standard) : t.diameter
  return faceDiameter > own + slack ? 'wider' : faceDiameter < own - slack ? 'narrower' : null
}

/** The offset at which the tooth has no thickness left at the pitch
 *  diameter — refused there; the most it takes is just under. There the
 *  tooth is half the pitch wide, and the offset narrows it on each side by
 *  itself over the cosine of the flank's angle: a quarter of the pitch
 *  times that cosine leaves nothing. */
export function maxThreadOffset(pitch: number, standard: ThreadStandard): number {
  return pitch / (4 * FORMS[standard].sec)
}

/** How near a bore's diameter has to be to a size's major diameter to be
 *  taken for drawn at it: a number typed, not a scan's reading. */
const DRAWN_AT_SIZE_MM = 0.01

/** The size a round face most likely carries a thread of, in a standard: a
 *  boss the size whose major diameter is nearest its own; a hole drawn at a
 *  size's own diameter — Ø5 for M5, as a part is designed — that size, and
 *  any other the one whose minor diameter — the tap drill's — is nearest;
 *  at the standard's own pitch. */
export function sizeForFace(standard: ThreadStandard, faceDiameter: number, internal: boolean): { diameter: number; pitch: number } {
  const drawn = internal ? SIZES[standard].find((s) => Math.abs(s.diameter - faceDiameter) < DRAWN_AT_SIZE_MM) : undefined
  if (drawn) return { diameter: drawn.diameter, pitch: drawn.pitches[0] }
  let best = SIZES[standard][0]
  let bestOff = Infinity
  for (const s of SIZES[standard]) {
    const off = Math.abs((internal ? minorDiameter(s.diameter, s.pitches[0], standard) : s.diameter) - faceDiameter)
    if (off < bestOff) {
      best = s
      bestOff = off
    }
  }
  return { diameter: best.diameter, pitch: best.pitches[0] }
}

/** What a thread is cut to: the numbers the Thread feature holds, and the
 *  standard whose form it is cut in. */
export interface ThreadSpec {
  standard: ThreadStandard
  diameter: number
  pitch: number
  /** Millimetres every face of the thread is moved into the material. */
  offset: number
}

/** Everything the kernel cuts a thread to, on the face it is given. */
export interface ThreadCut extends ThreadSpec {
  leftHanded: boolean
  /** Millimetres along the face; null runs the whole face. */
  length: number | null
  start: number
  flip: boolean
  /** A 45° chamfer at each end the thread runs out of the body free. */
  chamfer?: boolean
}

/** Why a thread cannot be cut, read off its numbers alone — or null. The
 *  face it is on has its say in the kernel. Its figures in `units`: the
 *  editor's in the units shown, a resolve's or a command's in millimetres. */
export function threadProblem(t: ThreadSpec, units: DisplayUnits = 'mm'): string | null {
  const mm = (v: number) => lengthWords(v, units)
  if (!(t.diameter > 0)) return 'The thread needs a diameter.'
  if (!(t.pitch > 0)) return 'The thread needs a pitch.'
  if (!(t.offset >= 0)) return 'The offset only takes material away — it has to be zero or more.'
  const max = maxThreadOffset(t.pitch, t.standard)
  if (t.offset >= max) return `An offset of ${mm(t.offset)} leaves the tooth no thickness at the pitch diameter — under ${mm(max)} for a pitch of ${mm(t.pitch)}.`
  if (t.diameter / 2 - threadDepth(t.pitch, t.standard) - t.offset < t.pitch / 4) return `A pitch of ${mm(t.pitch)} is too coarse for Ø${mm(t.diameter)} — the thread would reach the axis.`
  return null
}

/** A length in a message: to a micron in millimetres, with no zeros behind it. */
function lengthWords(v: number, units: DisplayUnits): string {
  const k = 10 ** lengthDecimals(3, units)
  return `${Math.round(toDisplay(v, units) * k) / k} ${unitWord(units)}`
}

/** A point of a tooth's outline: millimetres from the axis, and along it
 *  from the tooth's middle. */
export type ToothPoint = [r: number, z: number]

/** How small a crest's flat may get before it is taken for a point. */
const POINT_FLAT = 1e-4
/** How near the face a crest's flat may come, as a share of the pitch,
 *  before the face is taken for the crest — a flat a hair inside the face
 *  would leave a sliver of the face standing on it. */
const CREST_ON_FACE = 0.01

/**
 * The outline of one tooth of the thread in a plane through the axis — the
 * material that stays, with every face moved in by the offset — and the
 * radius of the root, where the band the thread is cut in ends: a bolt's
 * band runs from it out past the face, a nut's from inside the bore out to
 * it.
 *
 * A bolt's tooth: its flat crest at the major diameter, the gap's floor at
 * the minor — an eighth and a quarter of the pitch wide in the 60° form, a
 * fifth each in the 45° one; a nut's the other way round — its crest at the
 * minor as wide as the bolt's gap floor, its gap's floor at the major as
 * the bolt's crest — the flanks between at the form's angle to the radius,
 * 30° or 45°. Counter-clockwise in (r, z).
 *
 * The offset moves each flank square to itself: at any radius the tooth is
 * narrower on each side by the offset over the flank's cosine. The crest
 * and the root move by the offset too, towards the tooth's root, where the
 * flanks stand wider apart by the offset times their tangent each — so the
 * tooth's half width at its crest and at its root changes by the offset
 * times (tan − sec), narrower, and the crest comes to a point once that has
 * used up its flat.
 *
 * Two surfaces of the tooth must not lie on one of the band or of the body:
 * the kernel's booleans fail on a helix lying in a cylinder. So the flanks
 * run on a little past the root before the tooth turns straight into what
 * stands behind it — `reach` below a bolt's core, past a nut's wall — and
 * the band's own cylinder makes the gap's floor. And where the crest's flat
 * would lie on the face of radius `face`, or beyond it, the tooth is drawn
 * up to the point its flanks meet, past the face: the face makes the crest.
 */
export function toothOutline(t: ThreadSpec, internal: boolean, reach: number, face?: number): { points: ToothPoint[]; crest: number; root: number; pointed: boolean } {
  const P = t.pitch
  const c = t.offset
  const R = t.diameter / 2
  const { tan, sec, depth, crest: crestFlat, root: rootFlat } = FORMS[t.standard]
  const h = depth * P
  // What the offset does to the tooth's half width at its crest and root.
  const shrink = c * tan - c * sec
  // Along the flank, the half width grows by tan of the way it goes into
  // the tooth's root.
  const past = Math.min(0.05 * P, reach / 2)
  if (!internal) {
    const root = R - h - c
    const rootHalf = ((1 - rootFlat) * P) / 2 + shrink
    const crestHalf = (crestFlat * P) / 2 + shrink
    const pointed = crestHalf < POINT_FLAT * P
    // Where the flanks meet, past the crest's flat or short of it.
    const apex = R - c + crestHalf / tan
    const crest = pointed ? apex : R - c
    const toApex = pointed || (face !== undefined && crest >= face - CREST_ON_FACE * P)
    const top: ToothPoint[] = toApex ? [[apex, 0]] : [[crest, -crestHalf], [crest, crestHalf]]
    const bend = root - past
    const bendHalf = rootHalf + past * tan
    const base = root - reach
    return { points: [[base, -bendHalf], [bend, -bendHalf], ...top, [bend, bendHalf], [base, bendHalf]], crest, root, pointed }
  }
  const minor = R - h
  const root = R + c
  const rootHalf = ((1 - crestFlat) * P) / 2 + shrink
  const crestHalf = (rootFlat * P) / 2 + shrink
  const pointed = crestHalf < POINT_FLAT * P
  const apex = minor + c - crestHalf / tan
  const crest = pointed ? apex : minor + c
  const toApex = pointed || (face !== undefined && crest <= face + CREST_ON_FACE * P)
  const below: ToothPoint[] = toApex ? [[apex, 0]] : [[crest, -crestHalf]]
  const above: ToothPoint[] = toApex ? [] : [[crest, crestHalf]]
  const bend = root + past
  const bendHalf = rootHalf + past * tan
  const outer = root + reach
  return { points: [...below, [bend, -bendHalf], [outer, -bendHalf], [outer, bendHalf], [bend, bendHalf], ...above], crest, root, pointed }
}

/**
 * How far out from the axis material is added before a thread is cut, or
 * null for none. A thread leaves its face at its crests — a bore at the
 * minor diameter, a boss at the major, moved into the material by the
 * offset — whatever size the face was drawn: a bore narrower than that or a
 * boss wider loses the difference to the cut itself, and a bore wider or a
 * boss narrower is first filled in or built up to it along the thread. So a
 * hole drawn Ø5 takes an M5 thread, or an M4 or an M6, and a Ø4 pin an M5.
 *
 * The fill ends on the crests, so they are a piece of its cylinder, as the
 * face's own are where it was drawn at them (toothOutline). A face within a
 * hair of them is taken for them: a fill that thin would be a sliver. Where
 * the crests come to a point, it runs a quarter of the pitch past them, for
 * the cut to take away — their points would lie on its cylinder.
 */
export function fillRadius(t: ThreadSpec, internal: boolean, faceR: number): number | null {
  const { crest, pointed } = toothOutline(t, internal, 0)
  const near = CREST_ON_FACE * t.pitch
  if (internal ? faceR <= crest + near : faceR >= crest - near) return null
  if (!pointed) return crest
  return internal ? Math.max(crest - t.pitch / 4, crest / 2) : crest + t.pitch / 4
}

/** How far past the root a thread's chamfer meets the end face, as a share
 *  of the pitch. */
const CHAMFER_PAST_ROOT = 0.1

/**
 * The radius a thread's 45° chamfer meets the end of the face at: a tenth of
 * the pitch inside a bolt's root, outside a nut's — the chamfer a bolt's end
 * is given down past the minor diameter, a tapped hole's countersink out past
 * the major. From there it runs into the body at 45° until it is clear of the
 * crests, so the thread starts on the cone instead of a turn as thin as a
 * knife's edge, and the chamfer never lies along the root.
 */
export function chamferRadius(t: ThreadSpec, internal: boolean): number {
  const root = toothOutline(t, internal, 0).root
  return internal ? root + CHAMFER_PAST_ROOT * t.pitch : root - CHAMFER_PAST_ROOT * t.pitch
}

/** Whether a round face looks away from its axis — a boss, a bolt's thread
 *  — or towards it — a bore, a nut's — read off its body's mesh: the
 *  triangles on the face, by its hash, wound outward. Null when the mesh
 *  has none of the face. */
export function roundFaceIsBoss(mesh: { positions: Float32Array; indices: Uint32Array; faceHash?: Int32Array }, hash: number, center: readonly number[], axis: readonly number[]): boolean | null {
  const faceHash = mesh.faceHash
  if (!faceHash) return null
  const p = mesh.positions
  let vote = 0
  for (let t = 0; t < faceHash.length; t++) {
    if (faceHash[t] !== hash) continue
    const [a, b, c] = [mesh.indices[3 * t] * 3, mesh.indices[3 * t + 1] * 3, mesh.indices[3 * t + 2] * 3]
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const m = [0, 1, 2].map((i) => (p[a + i] + p[b + i] + p[c + i]) / 3 - center[i])
    const along = m[0] * axis[0] + m[1] * axis[1] + m[2] * axis[2]
    const radial = [0, 1, 2].map((i) => m[i] - along * axis[i])
    vote += n[0] * radial[0] + n[1] * radial[1] + n[2] * radial[2]
  }
  return vote === 0 ? null : vote > 0
}

/** What a thread's round face says once it names a face of the body's
 *  mesh: a boss or a bore — `internal` for a bore — read off the face's
 *  triangles, and, while no size has been chosen or typed (`sized`), the
 *  standard's size for it as the face is drawn: a boss's major diameter, a
 *  bore's minor. Null while the mesh does not say. */
export function threadFaceReading(
  mesh: { positions: Float32Array; indices: Uint32Array; faceHash?: Int32Array },
  face: { hash: number; fingerprint: { center?: readonly number[]; radius?: number; dir: readonly number[] } },
  standard: ThreadStandard,
  sized: boolean,
): { internal: boolean; diameter?: number; pitch?: number } | null {
  const fp = face.fingerprint
  if (face.hash < 0 || !fp.center || !fp.radius) return null
  const boss = roundFaceIsBoss(mesh, face.hash, fp.center, fp.dir)
  if (boss === null) return null
  return sized ? { internal: !boss } : { internal: !boss, ...sizeForFace(standard, 2 * fp.radius, !boss) }
}

/** Where along a round face a thread runs, millimetres along its axis:
 *  the whole face, or `length` from `start` in from one end — the far end
 *  along the axis, or with `flip` the near one. Null for one that does not
 *  fit on the face. */
export function threadSpan(face: { lo: number; hi: number }, length: number | null, start: number, flip: boolean): { from: number; to: number } | null {
  if (length === null) return { from: face.lo, to: face.hi }
  const slack = 1e-6
  if (start < -slack || start + length > face.hi - face.lo + slack) return null
  return flip ? { from: face.lo + start, to: face.lo + start + length } : { from: face.hi - start - length, to: face.hi - start }
}
