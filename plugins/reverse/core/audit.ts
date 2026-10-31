// SPDX-License-Identifier: AGPL-3.0-only
// A built body looked over for what a scan's noise leaves in a model: a
// wall a third of a degree off square, two faces meant to be one lying a
// twentieth of a millimetre apart, a round that meets its neighbour at a
// hair's angle instead of tangent, an edge too short to be a feature. None
// of it fails the kernel's check — the body is a valid closed solid — and
// all of it shows up downstream: in a drawing full of decimals, in a
// fillet that will not run, in a STEP file with faces no CAD program would
// have drawn. The kernel's own check (BodyCheck) says whether the body is
// sound; this says whether it is clean.
//
// Everything here is read off the topology a build already carries (the
// faces' and edges' fingerprints, the faces either side of each edge, the
// edges' ends) — no kernel call, so it runs on any body in a few
// milliseconds. The thresholds are reporting nets, wide by design: what
// comes back is a list of places with a figure each, and whether a face
// 0.3° off square was meant so is the operator's or the agent's to say.
// Each finding of a face traces back to the sketch piece that made it
// where it can (traceFace), which is where the repair goes.

import type { Vec3 } from '../../../src/core/types'
import { cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { EdgeInfo, FaceInfo } from './build'
import { liftPoint, type Feature, type SketchFeature } from './features'
import type { FaceFingerprint } from './topo'
import { round4 } from '../../../src/core/round'
import { HAIR_MM, stepPairs, type StepForm, type StepPair } from './stepsBetween'

export interface AuditOptions {
  /** An edge where the two faces beside it meet at under this many
   *  degrees — but not at none — is a kink: a round not tangent to its
   *  neighbour, or a crease between two faces meant as one. */
  kinkDeg?: number
  /** Two flat faces facing one way, within parallelDeg, lying this close
   *  together — but not in one plane — are a step. */
  stepMm?: number
  /** How far off parallel two flat faces may lean, or a face off a
   *  coordinate axis, and still be listed as nearly so. */
  parallelDeg?: number
  /** An edge under this is short. */
  shortEdge?: number
  /** How many findings of each kind at most — of steps, how many lines,
   *  a line a pair of features. */
  limit?: number
  /** Findings that say one thing — what a pattern leaves, one per instance
   *  — given once, with how many and a few of their places (oneOfAlike);
   *  limit then counts these. */
  alike?: boolean
}

export const AUDIT_DEFAULTS: Required<AuditOptions> = { kinkDeg: 5, stepMm: 0.3, parallelDeg: 1, shortEdge: 0.1, limit: 12, alike: false }

/** A step under this, mm — or under half the tolerance given, if more — is
 *  asked about: a step under T is almost never the part's. */
export const ASK_MM = 0.1

export type FindingKind = 'kink' | 'step' | 'nearParallel' | 'nearAxis' | 'shortEdge' | 'freeEdge' | 'nonManifold' | 'contact'

/** An edge the kernel found odd (kernelEdges.ts oddEdges): one face only
 *  (free), three or more (nonManifold), its one face on both sides of it
 *  (inside), or two faces facing opposite ways (knife). The topology alone
 *  cannot tell a free edge from a periodic face's seam — both have one
 *  face — so the kernel is asked. */
export interface OddEdgeIn {
  hash: number
  kind: 'free' | 'inside' | 'nonManifold' | 'knife'
  at: Vec3
  length: number
  faces: number[]
}

export interface Finding {
  kind: FindingKind
  /** The faces concerned, by index into the body's face list. */
  faces: number[]
  /** The edges concerned, by index. */
  edges: number[]
  /** Where to look, mm. */
  at: Vec3
  /** The figure: degrees for a kink, a lean or a near-parallel pair,
   *  millimetres for a step, a short edge, or the length of a free, a
   *  non-manifold or a contact edge. */
  off: number
  unit: 'deg' | 'mm'
  /** Which coordinate axis a nearAxis face is near: x, y or z. */
  axis?: 'x' | 'y' | 'z'
  /** A step's: between two flat faces, two rounds on one axis, or a round
   *  whose foot lies off a flat face (stepsBetween.ts). */
  form?: StepForm
  /** A step's line stands for every step of its form between the faces of
   *  two features (by id, the older first — one feature twice for steps
   *  within one): how many, the widest's faces, figure and place given. A
   *  finding standing for others alike (oneOfAlike) counts them too. */
  between?: [number, number]
  count?: number
  /** Where the next few of those it stands for lie. */
  places?: Vec3[]
  /** The line is of hairline steps, under HAIR_MM. */
  hair?: boolean
  /** The face between the widest step's two, by index. */
  riser?: number
  /** What it is, in a sentence. */
  note: string
}

/** Under this, two directions are one — the kernel's own slack. */
const SAME_DEG = 0.01
/** Under this, two planes are one plane. */
const SAME_MM = 1e-4
/** How near a face must lie to the sketch piece it is traced to, mm — as
 *  snapEdit.ts has it. */
const ON_MM = 2e-3

const toDeg = (r: number) => (r * 180) / Math.PI

const angleDeg = (a: Vec3, b: Vec3): number => {
  const la = len(a), lb = len(b)
  if (!(la > 0 && lb > 0)) return 0
  return toDeg(Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))))
}

/** The angle between two directions a sign apart or not, 0 to 90. */
const leanDeg = (a: Vec3, b: Vec3): number => {
  const d = angleDeg(a, b)
  return d > 90 ? 180 - d : d
}

const mid3 = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

const AXES: { axis: 'x' | 'y' | 'z'; dir: Vec3 }[] = [
  { axis: 'x', dir: [1, 0, 0] },
  { axis: 'y', dir: [0, 1, 0] },
  { axis: 'z', dir: [0, 0, 1] },
]

/** A face's outward normal at a point of its edge, where the fingerprint
 *  says it: a plane's own, a cylinder's radial — out of a boss, into a
 *  bore, which the caller tells from the mesh. Null where it is not known
 *  (a cone, a torus, a free surface, a round face whose side is not
 *  told). */
function normalAt(face: FaceInfo, p: Vec3, isBoss: ((face: FaceInfo) => boolean | null) | undefined): Vec3 | null {
  const fp = face.fingerprint
  if (fp.kind === 'plane') return fp.dir
  if (fp.kind === 'cylinder' && fp.center) {
    const boss = isBoss?.(face) ?? null
    if (boss === null) return null
    const d = sub(p, fp.center)
    const radial = sub(d, scale(fp.dir, dot(d, fp.dir)))
    const n = normalize(radial)
    if (!n) return null
    return boss ? n : scale(n, -1)
  }
  if (fp.kind === 'sphere' && fp.center) {
    const boss = isBoss?.(face) ?? null
    if (boss === null) return null
    const n = normalize(sub(p, fp.center))
    if (!n) return null
    return boss ? n : scale(n, -1)
  }
  return null
}

/** How many other places a finding standing for others gives. */
const PLACES_SHOWN = 3

/** The findings with those that say one thing given once: one kind, one
 *  figure, on faces of the same kinds made by the same features. A patterned
 *  cut leaves a short edge on every instance, each with its one repair, on
 *  the seed. The first stands for them, with how many and where the next
 *  few lie; the order is kept. */
function oneOfAlike(list: readonly Finding[], faces: readonly FaceInfo[]): Finding[] {
  const groups = new Map<string, Finding[]>()
  for (const f of list) {
    const made = f.faces.map((i) => `${faces[i].fingerprint.origin}:${faces[i].fingerprint.kind}`).sort().join()
    const key = `${f.kind}|${f.off}|${made}`
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(f)
  }
  return [...groups.values()].map(([first, ...rest]) => (rest.length === 0 ? first : { ...first, count: rest.length + 1, places: rest.slice(0, PLACES_SHOWN).map((f) => f.at) }))
}

const faceWord = (fp: FaceFingerprint) => (fp.kind === 'plane' ? 'flat face' : fp.kind === 'other' ? 'face' : fp.kind)

/**
 * The body's topology looked over. Findings come sorted nearest the mark
 * first within each kind — the smallest kink, the thinnest step, the
 * slightest lean, the shortest edge — and capped per kind. With `odd`,
 * the edges the kernel found not joining two faces as a closed solid's do
 * (OddEdgeIn) come too: free edges and non-manifold ones, and contacts —
 * an edge lying inside its one face, or between two faces facing opposite
 * ways: where a face only touched another at a tangent (a circle drawn
 * touching a curved edge) and the boolean kept the line. A smooth round's
 * edge, two faces tangent and facing one way, is none of these. The
 * longest first. Steps (stepsBetween.ts) come a line a pair of features
 * (stepLines): those between two features first.
 */
export function auditTopology(faces: readonly FaceInfo[], edges: readonly EdgeInfo[], options: AuditOptions = {}, isBoss?: (face: FaceInfo) => boolean | null, odd: readonly OddEdgeIn[] = []): Finding[] {
  return auditBody(faces, edges, options, isBoss, odd).findings
}

/** The audit (auditTopology) and how many steps lie between faces of two
 *  different features — every one, hairlines too, before any cap: what a
 *  model built from stacked sketches should have none of. `tolerance`, the
 *  part's T, mm: a step under max(ASK_MM, T/2) is asked about, and a lean
 *  — two flat faces nearly parallel, a face nearly on an axis — that moves
 *  the face less than T/2 across its span (leanMm) is left out, counted in
 *  `underHalfT`. `found` counts each kind before the cap — of steps, the
 *  lines. */
export function auditBody(faces: readonly FaceInfo[], edges: readonly EdgeInfo[], options: AuditOptions & { tolerance?: number } = {}, isBoss?: (face: FaceInfo) => boolean | null, odd: readonly OddEdgeIn[] = []): { findings: Finding[]; stepsBetweenFeatures: number; found: Partial<Record<FindingKind, number>>; underHalfT?: number } {
  const { tolerance, ...rest } = options
  const o = { ...AUDIT_DEFAULTS, ...rest }
  const index = new Map<number, number>()
  faces.forEach((f, i) => index.set(f.hash, i))
  const kinks: Finding[] = []
  const pairs = stepPairs(faces, edges, { stepMm: o.stepMm, parallelDeg: o.parallelDeg })
  const stepsBetweenFeatures = pairs.filter((p) => faces[p.faces[0]].fingerprint.origin !== faces[p.faces[1]].fingerprint.origin).length
  const steps = stepLines(pairs, faces, o.limit, Math.max(ASK_MM, (tolerance ?? 0) / 2))
  const nearParallel: Finding[] = []
  const nearAxis: Finding[] = []
  const shortEdges: Finding[] = []

  edges.forEach((e, ie) => {
    const fp = e.fingerprint
    // An edge of no length is a pole or an apex where the kernel draws
    // nothing for it (kernelEdges.ts degenerateOnes); one it draws is a
    // hair, short all the same.
    if ((fp.length > 0 || e.polyline.length > 0) && fp.length < o.shortEdge) {
      const hair = fp.length < 1e-4
      // units-ok: a finding of the body check, the agent's answer only
      shortEdges.push({ kind: 'shortEdge', faces: e.faces.map((h) => index.get(h)).filter((i): i is number => i !== undefined), edges: [ie], at: fp.mid, off: round4(fp.length), unit: 'mm', note: hair ? `an edge under 0.0001 mm long — a hair a round left, which a STEP reader may drop from one face` : `an edge ${round4(fp.length)} mm long — a sliver's, or a corner that nearly meets` })
    }
    if (e.faces.length !== 2) return
    const ia = index.get(e.faces[0]), ib = index.get(e.faces[1])
    if (ia === undefined || ib === undefined) return
    const fa = faces[ia], fb = faces[ib]
    const na = normalAt(fa, fp.mid, isBoss)
    const nb = normalAt(fb, fp.mid, isBoss)
    if (!na || !nb) return
    const d = angleDeg(na, nb)
    if (d <= SAME_DEG || d > o.kinkDeg) return
    const flat = fa.fingerprint.kind === 'plane' && fb.fingerprint.kind === 'plane'
    kinks.push({
      kind: 'kink',
      faces: [ia, ib],
      edges: [ie],
      at: fp.mid,
      off: round4(d),
      unit: 'deg',
      note: flat ? `two flat faces meet at ${round4(d)}° — a crease where one face was meant, or a step's riser seen edge on` : `a ${faceWord(fa.fingerprint)} and a ${faceWord(fb.fingerprint)} meet at ${round4(d)}° where a round would run on tangent`,
    })
  })

  const planes = faces.map((f, i) => ({ f, i })).filter(({ f }) => f.fingerprint.kind === 'plane')
  for (let x = 0; x < planes.length; x++) {
    for (let y = x + 1; y < planes.length; y++) {
      const a = planes[x].f.fingerprint, b = planes[y].f.fingerprint
      const facing = angleDeg(a.dir, b.dir)
      const lean = facing > 90 ? 180 - facing : facing
      if (lean > o.parallelDeg) continue
      if (lean > SAME_DEG) {
        nearParallel.push({ kind: 'nearParallel', faces: [planes[x].i, planes[y].i], edges: [], at: mid3(a.centroid, b.centroid), off: round4(lean), unit: 'deg', note: `two flat faces lean ${round4(lean)}° to each other — parallel, if meant so` })
      }
    }
  }

  faces.forEach((f, i) => {
    const fp = f.fingerprint
    if (fp.kind !== 'plane' && fp.kind !== 'cylinder' && fp.kind !== 'cone') return
    let best: { axis: 'x' | 'y' | 'z'; lean: number } | null = null
    for (const { axis, dir } of AXES) {
      const lean = leanDeg(fp.dir, dir)
      if (!best || lean < best.lean) best = { axis, lean }
    }
    if (!best || best.lean <= SAME_DEG || best.lean > o.parallelDeg) return
    nearAxis.push({
      kind: 'nearAxis',
      faces: [i],
      edges: [],
      at: fp.centroid,
      off: round4(best.lean),
      unit: 'deg',
      axis: best.axis,
      note: fp.kind === 'plane' ? `a flat face leans ${round4(best.lean)}° off square to the ${best.axis} axis` : `a ${fp.kind}'s axis leans ${round4(best.lean)}° off the ${best.axis} axis`,
    })
  })

  const freeEdges: Finding[] = []
  const nonManifold: Finding[] = []
  const contacts: Finding[] = []
  const edgeIndex = new Map<number, number>()
  edges.forEach((e, i) => edgeIndex.set(e.hash, i))
  for (const e of odd) {
    const fs = e.faces.map((h) => index.get(h)).filter((i): i is number => i !== undefined)
    const ie = edgeIndex.get(e.hash)
    // units-ok: a finding of the body check, the agent's answer only
    const row = { faces: fs, edges: ie === undefined ? [] : [ie], at: e.at, off: round4(e.length), unit: 'mm' as const }
    // units-ok: a finding of the body check, the agent's answer only
    if (e.kind === 'free') freeEdges.push({ kind: 'freeEdge', ...row, note: `an edge ${round4(e.length)} mm long with one face — a hole in the skin: the body is not closed here` })
    // units-ok: a finding of the body check, the agent's answer only
    else if (e.kind === 'nonManifold') nonManifold.push({ kind: 'nonManifold', ...row, note: `${e.faces.length} faces meet at one edge ${round4(e.length)} mm long — two parts of the body touch along it instead of joining; a STEP reader takes it for no closed solid` })
    // units-ok: a finding of the body check, the agent's answer only
    else if (e.kind === 'inside') contacts.push({ kind: 'contact', ...row, note: `an edge ${round4(e.length)} mm long inside its one face — another face only touched this one at a tangent there, and the boolean kept the line` })
    // units-ok: a finding of the body check, the agent's answer only
    else contacts.push({ kind: 'contact', ...row, note: `two faces meet facing opposite ways along an edge ${round4(e.length)} mm long — the body is no thick there, a tangent touch` })
  }

  // A lean that moves its face less than T/2 across the face's span is
  // under what the part can tell: two pocket walls 0.06° apart over 40 mm
  // are 0.04 mm off parallel.
  let underHalfT: number | undefined
  if (tolerance !== undefined) {
    const span = faceSpans(faces, edges)
    // A face whose span is not known (no edge drawn) stays listed.
    const counts = (f: Finding) => {
      const across = Math.max(...f.faces.map((i) => span[i] ?? 0))
      return !(across > 0) || leanMm(f.off, across) >= tolerance / 2
    }
    const before = nearParallel.length + nearAxis.length
    nearParallel.splice(0, nearParallel.length, ...nearParallel.filter(counts))
    nearAxis.splice(0, nearAxis.length, ...nearAxis.filter(counts))
    underHalfT = before - nearParallel.length - nearAxis.length
  }

  const byOff = (a: Finding, b: Finding) => a.off - b.off
  const longest = (a: Finding, b: Finding) => b.off - a.off
  const found: Partial<Record<FindingKind, number>> = {}
  const tally = (kind: FindingKind, n: number) => {
    if (n > 0) found[kind] = n
  }
  tally('freeEdge', freeEdges.length)
  tally('nonManifold', nonManifold.length)
  tally('contact', contacts.length)
  tally('kink', kinks.length)
  tally('step', steps.length)
  tally('nearParallel', nearParallel.length)
  tally('nearAxis', nearAxis.length)
  tally('shortEdge', shortEdges.length)
  const once = (list: readonly Finding[]) => (o.alike ? oneOfAlike(list, faces) : list)
  const findings = [
    ...freeEdges.sort(longest).slice(0, o.limit),
    ...nonManifold.sort(longest).slice(0, o.limit),
    ...contacts.sort(longest).slice(0, o.limit),
    ...once(kinks.sort(byOff)).slice(0, o.limit),
    ...steps,
    ...once(nearParallel.sort(byOff)).slice(0, o.limit),
    ...once(nearAxis.sort(byOff)).slice(0, o.limit),
    ...once(shortEdges.sort(byOff)).slice(0, o.limit),
  ]
  return { findings, stepsBetweenFeatures, found, ...(underHalfT !== undefined ? { underHalfT } : {}) }
}

/** How far a lean of `deg` moves a face across `span` mm. */
export const leanMm = (deg: number, span: number) => span * Math.tan((deg * Math.PI) / 180)

/** Each face's span, mm: the diagonal of the box round its edges — the
 *  points each edge is drawn by, its ends where it has none. */
export function faceSpans(faces: readonly FaceInfo[], edges: readonly EdgeInfo[]): number[] {
  const index = new Map<number, number>()
  faces.forEach((f, i) => index.set(f.hash, i))
  const lo = faces.map((): Vec3 => [Infinity, Infinity, Infinity])
  const hi = faces.map((): Vec3 => [-Infinity, -Infinity, -Infinity])
  const take = (i: number, x: number, y: number, z: number) => {
    const a = lo[i], b = hi[i]
    if (x < a[0]) a[0] = x
    if (y < a[1]) a[1] = y
    if (z < a[2]) a[2] = z
    if (x > b[0]) b[0] = x
    if (y > b[1]) b[1] = y
    if (z > b[2]) b[2] = z
  }
  for (const e of edges) {
    const own = e.faces.map((h) => index.get(h)).filter((i): i is number => i !== undefined)
    for (const i of own) {
      const p = e.polyline
      if (p.length >= 3) for (let k = 0; k + 2 < p.length; k += 3) take(i, p[k], p[k + 1], p[k + 2])
      else for (const q of e.ends) take(i, q[0], q[1], q[2])
    }
  }
  return faces.map((_, i) => (lo[i][0] <= hi[i][0] ? len(sub(hi[i], lo[i])) : 0))
}

/** A step's width as a line gives it: to the ten-thousandth, a hairline
 *  to two figures. */
const stepMm = (x: number) => (x >= HAIR_MM ? round4(x) : Number(x.toPrecision(2)))

/** What one step is, in words. */
function stepNote(p: StepPair, between: boolean): string {
  const off = stepMm(p.off)
  if (p.form === 'round') {
    const [ra, rb] = (p.radii ?? [0, 0]).map(round4)
    // units-ok: a finding of the body check, the agent's answer only
    const axes = p.axisOff !== undefined && p.axisOff > SAME_MM ? `, axes ${round4(p.axisOff)} mm apart` : ''
    return `two rounds on nearly one axis meet end to end, R${ra} and R${rb}${axes} — one round drawn twice${between ? ', in two features' : ''}`
  }
  // units-ok: a finding of the body check, the agent's answer only
  if (p.form === 'foot') return `a round starts ${off} mm off a flat face of another feature — a profile that nearly starts on that face`
  // units-ok: a finding of the body check, the agent's answer only
  if (p.form === 'tangent') return p.creaseDeg !== undefined ? `a round dips ${off} mm through a flat face of another feature, meeting it at ${round4(p.creaseDeg)}° — a round meant to touch that face` : `a round stands ${off} mm short of a flat face of another feature — a round meant to touch that face`
  // units-ok: a finding of the body check, the agent's answer only
  return between ? `two flat faces of two features facing one way lie ${off} mm apart — a wall or a height drawn twice, in two sketches` : `two flat faces facing one way lie ${off} mm apart — one face, or a step of ${off} mm`
}

/**
 * The steps as the audit lists them: a line for each pair of features and
 * form — every step between their faces, by the widest, with how many —
 * and the hairlines under HAIR_MM a line of their own a pair. Steps
 * between two features come first, then those within one; the steps a
 * drawing shows before the hairlines; the thinnest widest first. A step
 * under `ask` mm is asked about. At most `limit` lines.
 */
function stepLines(pairs: readonly StepPair[], faces: readonly FaceInfo[], limit: number, ask: number): Finding[] {
  const groups = new Map<string, StepPair[]>()
  for (const p of pairs) {
    const oa = faces[p.faces[0]].fingerprint.origin, ob = faces[p.faces[1]].fingerprint.origin
    const key = `${Math.min(oa, ob)},${Math.max(oa, ob)},${p.form},${p.off < HAIR_MM}`
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(p)
  }
  const lines = [...groups.values()].map((g): Finding => {
    const w = g.reduce((a, b) => (b.off > a.off ? b : a))
    const oa = faces[w.faces[0]].fingerprint.origin, ob = faces[w.faces[1]].fingerprint.origin
    const between = oa !== ob
    const hair = w.off < HAIR_MM
    const off = stepMm(w.off)
    const at = w.at.map((v) => Math.round(v * 1000) / 1000) as Vec3
    // units-ok: a finding of the body check, the agent's answer only
    let note = g.length === 1 ? stepNote(w, between) : hair ? '' : `${g.length} steps between the ${w.form === 'round' ? 'rounds' : 'faces'} of ${between ? 'two features' : 'one feature'}, the widest ${off} mm: ${stepNote(w, between)}`
    // units-ok: a finding of the body check, the agent's answer only
    if (hair) note = `${g.length === 1 ? 'a hairline step' : `${g.length} hairline steps`} under ${HAIR_MM} mm between the faces of ${between ? 'two features' : 'one feature'}${g.length > 1 ? `, the widest ${off} mm` : ` (${off} mm)`} — one face cut in two by a piece fitted twice`
    // units-ok: a finding of the body check, the agent's answer only
    else if (w.off < ask) note += ` — a step of ${off} mm at (${at.join(', ')}): meant? A step under the tolerance is almost never the part’s`
    return {
      kind: 'step',
      faces: [...w.faces],
      edges: [],
      at: w.at,
      off,
      // units-ok: a finding of the body check, the agent's answer only
      unit: 'mm',
      form: w.form,
      between: [Math.min(oa, ob), Math.max(oa, ob)],
      count: g.length,
      ...(hair ? { hair: true } : {}),
      ...(w.riser !== undefined ? { riser: w.riser } : {}),
      note,
    }
  })
  const rank = (f: Finding) => (f.between![0] !== f.between![1] ? 0 : 2) + (f.hair ? 1 : 0)
  return lines.sort((a, b) => rank(a) - rank(b) || a.off - b.off).slice(0, limit)
}

// ---- back to the sketch --------------------------------------------------------------

export interface FaceTrace {
  /** The feature that first made the face. */
  feature: { id: number; name: string; kind: string }
  /** For an extrude's or a revolve's face: its sketch, and the piece of it
   *  the face stands on — a wall's line, a round's circle or arc, a
   *  turned cylinder's line along the axis — where one does. */
  sketch?: { id: number; name: string }
  piece?: { id: number; kind: string }
  /** What the face is to its feature: a wall standing on a sketch line, a
   *  cap (an extrude's end, which its extent places), a round on a sketch
   *  circle or arc, or something else. */
  role: 'wall' | 'cap' | 'round' | 'other'
  /** For a cap: which end of the extrude, and where it stands. */
  end?: 'from' | 'to'
}

/**
 * Where a face came from, as far as the feature list says: the feature
 * that made it and, for an extrude's or a revolve's face, the sketch piece
 * under it — which is where a relation or a dimension would put it right.
 * Null when the maker is not in the list.
 */
export function traceFace(features: readonly Feature[], face: FaceFingerprint): FaceTrace | null {
  const maker = features.find((f) => f.id === face.origin)
  if (!maker) return null
  const feature = { id: maker.id, name: maker.name, kind: maker.kind }
  if (maker.kind !== 'extrude' && maker.kind !== 'revolve') return { feature, role: 'other' }
  const sketch = features.find((f): f is SketchFeature => f.kind === 'sketch' && f.id === maker.sketchId)
  if (!sketch) return { feature, role: 'other' }
  const frame = sketch.frame
  const named = { id: sketch.id, name: sketch.name }
  const pieces = sketch.sketch.entities.filter((e) => !e.construction)
  if (face.kind === 'plane') {
    const along = Math.abs(dot(face.dir, frame.normal))
    if (maker.kind === 'extrude' && along > 1 - 1e-6) {
      const at = dot(sub(face.centroid, frame.origin), frame.normal)
      const e = maker.extent
      const ends = e.kind === 'distance' ? { from: e.from, to: e.to } : e.kind === 'symmetric' ? { from: -e.total / 2, to: e.total / 2 } : null
      const end = ends ? (Math.abs(at - ends.to) <= ON_MM ? 'to' : Math.abs(at - ends.from) <= ON_MM ? 'from' : undefined) : undefined
      return { feature, sketch: named, role: 'cap', ...(end ? { end } : {}) }
    }
    if (along < 1e-4) {
      // The line whose lifted carrier the face lies on, the nearest of
      // several in one carrier.
      const off = (p: Vec3) => Math.abs(dot(sub(p, face.centroid), face.dir))
      let best: { id: number; kind: string } | null = null
      let nearest = Infinity
      for (const e of pieces) {
        if (e.kind !== 'line') continue
        const a = liftPoint(frame, e.a), b = liftPoint(frame, e.b)
        if (off(a) > ON_MM || off(b) > ON_MM) continue
        const d = len(sub(mid3(a, b), face.centroid))
        if (d < nearest) {
          nearest = d
          best = { id: e.id, kind: e.kind }
        }
      }
      return { feature, sketch: named, role: 'wall', ...(best ? { piece: best } : {}) }
    }
    return { feature, sketch: named, role: 'other' }
  }
  if (face.kind === 'cylinder' && face.radius !== undefined && face.center) {
    const axis = { origin: face.center, dir: face.dir }
    const offAxis = (p: Vec3) => len(cross(sub(p, axis.origin), axis.dir))
    for (const e of pieces) {
      if ((e.kind === 'circle' || e.kind === 'arc') && Math.abs(e.r - face.radius) <= ON_MM && offAxis(liftPoint(frame, e.c)) <= ON_MM) {
        return { feature, sketch: named, role: 'round', piece: { id: e.id, kind: e.kind } }
      }
    }
    // A revolve's cylinder about its axis: the section's line along the
    // axis at the radius.
    if (maker.kind === 'revolve') {
      for (const e of pieces) {
        if (e.kind !== 'line') continue
        if (Math.abs(offAxis(liftPoint(frame, e.a)) - face.radius) <= ON_MM && Math.abs(offAxis(liftPoint(frame, e.b)) - face.radius) <= ON_MM) {
          return { feature, sketch: named, role: 'round', piece: { id: e.id, kind: e.kind } }
        }
      }
    }
    return { feature, sketch: named, role: 'round' }
  }
  return { feature, sketch: named, role: 'other' }
}
