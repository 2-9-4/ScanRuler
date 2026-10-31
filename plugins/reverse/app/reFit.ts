// SPDX-License-Identifier: AGPL-3.0-only
// "fit" in place of a feature's number: the agent says which number is the
// scan's to give, ScanRuler fits it and says how well — the value, its
// sigma, the nominal and how many sigmas off, the points it rests on. A
// fillet's radius and a chamfer's distance (each edge read across, as
// reverse.body.fillet_read reads it, the median taken, a spread past two
// sigmas refused with every edge's reading; one edge given as { edge,
// radius: "fit" } read along it, at one radius where its places agree and
// as a line from one end to the other where they lie on one), a draft's angle (the scan
// inside each face's outline fitted with a plane, then fitted again to the
// points about that plane, how much of the face's height the scan spans
// said), an extrude's end ({ kind: "toScan" }:
// the scan's face capping the region, its offset along the extrusion).
//
// The feature stores the number, as one typed — a project holds nothing
// new. What it was fitted from is kept for the session (fittedOf), for the
// panel to show and reverse.feature.refit to fit again after something
// upstream moved.

import { commandHost } from '../../../src/commands/host'
import { fitPlaneTLS } from '../../../src/core/fit/plane'
import type { Vec2 } from '../../../src/core/flat/types'
import { round4 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { cross, dot, normalize, scale, sub } from '../../../src/core/vec'
import { CommandError } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import type { DraftFeature, EdgeRef, FaceRef, Feature, MirrorPlane, SketchFeature } from '../core/features'
import { rounding } from '../core/intent'
import { resolvePlaneFrame } from '../core/resolve'
import { type FaceTriangles, faceTriangles, isCurvedEdge } from '../core/curvedEdge'
import type { BodyInfo } from '../state/reStore'
import { matchEdge, matchFace, matchTolerance } from '../core/topo'
import { isWhere } from '../core/where'
import { bodyAt, bodyNamed, type EdgePickIn, edgePicked, edgesPicked, type FacePickIn, facesPicked, type Json, meshOf, mirrorPlaneOf, type Ref, regionKeys, sketchNamed, topologyOf, unwrapped, type Where, whereIndices } from './reCommandCore'
import { cornerUnreadable } from '../core/filletEstimate'
import { type EdgeStation, type LinearLaw, type ReadEdge, readEdgeOf, readEdgeRound, roundReach, scanSection } from './reFilletRead'
import type { ReverseSession } from './reSession'
import { type FitMark, fittedOf, markFitted, unmarkFitted } from './reFitMarks'
import { asksRegion, boxByExprs, regionOf } from './reSurfaceRegion'

export { fittedOf, markFitted, unmarkFitted }

/** A number fitted to the scan, as an answer gives it. */
export interface FitReading {
  value: number
  sigma: number | null
  nominal: number
  off: number
  sigmas: number | null
  points: number
  rms?: number
  /** Each edge's or face's own reading, where the value is a median. */
  readings?: { value: number | null; sigma?: number | null; why?: string }[]
  /** A round's or chamfer's: the reach it was read over, mm, where the
   *  default one was widened to read it. */
  reach?: number
  /** A draft's: how much of each face's height along the pull the scan
   *  points read span, 0–1 — the least of the faces. */
  coverage?: number
  /** What makes the reading doubtful: a draft read off a strip of its
   *  faces. */
  warning?: string
  /** A radius fitted along one edge: at its first end and at its other, as
   *  a variable fillet takes it — the value is the places' median. */
  law?: [number, number]
  /** What the fit made of it, said. */
  note?: string
  /** A round's or chamfer's: how many seam edges were left out of the picks
   *  (dropSeams). */
  seamsDropped?: number
}

/** The word that asks for a number to be fitted. */
export const FIT = 'fit'

/** Whether an input asks for anything fitted. */
export function asksFit(kind: string, input: Json): boolean {
  if (kind === 'fillet') return input.radius === FIT || edgesAskFit(input)
  if (kind === 'chamfer') return input.distance === FIT
  if (kind === 'draft') return input.angleDeg === FIT || ((input.groups as Json[] | undefined) ?? []).some((g) => g?.angleDeg === FIT)
  if (kind === 'extrude') return (input.extent as Json | undefined)?.kind === 'toScan'
  return asksRegion(kind, input)
}

/** Whether a fillet's input gives an edge as { edge, radius: "fit" }. */
const edgesAskFit = (input: Json) => Array.isArray(input.edges) && input.edges.some((e) => isVarying(e) && e.radius === FIT)

const isVarying = (e: unknown): e is { edge: EdgePickIn; radius: unknown } => typeof e === 'object' && e !== null && 'edge' in e

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Several readings of one number made one: the median, its sigma (the
 *  readings' combined, a quarter more for the median), and a refusal when
 *  one stands more than two sigmas off the rest — each reading listed, for
 *  the agent to pick the edges or faces again. */
function combined(what: string, unit: string, readings: { value: number | null; sigma: number | null; why?: string }[], kind: 'radius' | 'length' | 'draft'): FitReading {
  const ok = readings.filter((r): r is { value: number; sigma: number; why?: string } => r.value !== null && r.sigma !== null)
  const listed = readings.map((r, i) => `#${i + 1} ${r.value === null ? r.why ?? 'no reading' : `${round4(r.value)} ± ${round4(r.sigma ?? 0)} ${unit}`}`).join('; ')
  if (ok.length < readings.length) throw new CommandError('failed', `The ${what} cannot be fitted: not every one picked reads — ${listed}. Pick only those that do, or give a number.`)
  const value = median(ok.map((r) => r.value))
  const pooled = 1 / Math.sqrt(ok.reduce((a, r) => a + 1 / Math.max(r.sigma, 1e-9) ** 2, 0))
  const sigma = ok.length > 1 ? 1.2533 * pooled : pooled
  for (const r of ok) {
    if (Math.abs(r.value - value) > 2 * Math.hypot(r.sigma, sigma)) throw new CommandError('failed', `The ${what} cannot be one number: the readings spread past two sigmas — ${listed}. Split them into features of their own, or give a number.`)
  }
  const nominal = rounding(value, kind, sigma)
  return { value: round4(value), sigma: round4(sigma), nominal: nominal.nominal, off: nominal.off, sigmas: nominal.sigmas, points: 0, readings: readings.map((r) => ({ value: r.value === null ? null : round4(r.value), sigma: r.sigma === null ? null : round4(r.sigma), ...(r.why ? { why: r.why } : {}) })) }
}

/** The edges a fit reads: those an input names, resolved on the body, or
 *  the stored ones — any but a straight edge between two flats (a circle,
 *  an edge on a cylinder, a blade's root) found again on the body as the
 *  feature saw it, for its ends, its faces' surfaces and the body's mesh,
 *  which a fingerprint does not carry. */
async function edgesOf(s: ReverseSession, input: Json, stored: Feature | null): Promise<ReadEdge[]> {
  const picks = (input.edges as unknown[] | undefined)?.filter((e) => !(e && typeof e === 'object' && 'edge' in (e as Json)))
  const onBody = (body: BodyInfo) => {
    const t = topologyOf(s, body)
    return edgesPicked(s, body, picks as EdgePickIn[]).map((e) => readEdgeOf(e, t, meshOf(t)))
  }
  if (picks && input.body !== undefined) return onBody(bodyNamed(input.body as Ref))
  if (picks && stored && 'body' in stored) return onBody(bodyAt(stored.body as number))
  if (stored && 'edges' in stored) {
    const refs = stored.edges as EdgeRef[]
    // A straight edge between two flats reads off its fingerprint alone;
    // any other is found again on the body as the feature saw it.
    const onTheBody = (fp: EdgeRef) => isCurvedEdge(fp) || cornerUnreadable(fp) !== null
    if (!refs.some(onTheBody) || !('body' in stored)) return refs.map((fingerprint) => ({ fingerprint }))
    const st = await s.staged(stored.id, stored.body as number).catch(() => null)
    const tol = matchTolerance(2 * (useStore.getState().modelSize || 100))
    return refs.map((fingerprint) => {
      const i = st && onTheBody(fingerprint) ? matchEdge(fingerprint, st.topology.edges.map((e) => e.fingerprint), tol) : null
      return st && i !== null ? readEdgeOf(st.topology.edges[i], st.topology, st.mesh) : { fingerprint }
    })
  }
  throw new CommandError('invalid_input', 'A fitted size needs the edges to read it across.')
}

/** A solid's seam: one face on both sides of an edge, where a closed surface
 *  meets itself — the kernel lists that face once. No wall meets another along
 *  it, so there is no round to read. */
const isSeam = (e: { faces: readonly number[] }, body: BodyInfo) => !body.surface && new Set(e.faces).size === 1

/**
 * The seams a fitted round's or chamfer's picks caught, left out of them: a
 * rim picked by madeBy and near takes the seam beside it, whose reading
 * refused the whole fit. A query that caught one is kept with sharp: true,
 * the term that leaves seams out — so it does at every rebuild too — and what
 * else sharp left out, edges between faces that meet tangent, is said with
 * them. A seam picked by index or fingerprint goes from the list. Said on the
 * reading (seamsDropped, note).
 */
function dropSeams(s: ReverseSession, input: Json, stored: Feature | null): { input: Json; said: Pick<FitReading, 'seamsDropped' | 'note'> } {
  const given = input.edges as unknown[] | undefined
  const body = input.body !== undefined ? bodyNamed(input.body as Ref) : stored && 'body' in stored ? bodyAt(stored.body as number) : null
  if (!given || !body) return { input, said: {} }
  const t = topologyOf(s, body)
  let seams = 0
  let smooth = 0
  let queried = false
  const edges = given.flatMap((g) => {
    if (isVarying(g)) return [g]
    const p = unwrapped(g, 'edge')
    if (isWhere(p)) {
      const hits = whereIndices(p, t, body, 'edge')
      const caught = hits.filter((i) => isSeam(t.edges[i], body)).length
      if (caught === 0) return [g]
      const sharp = { ...(p as Where), sharp: true }
      const kept = whereIndices(sharp, t, body, 'edge').length
      seams += caught
      smooth += hits.length - caught - kept
      queried = true
      return kept > 0 ? [sharp] : []
    }
    const e = edgePicked(s, body, p as EdgePickIn)
    if (e.hash < 0 || !isSeam(e, body)) return [g]
    seams++
    return []
  })
  if (seams === 0) return { input, said: {} }
  if (edges.length === 0) throw new CommandError('invalid_input', `Every edge picked is a seam — one face on both sides, nothing to read a size across (${seams}). Pick the rim by a query of its own: kind: "other" for a rim on a slant, coaxial: { at, dir } for one round an axis.`)
  const more = smooth > 0 ? `, and ${smooth} between faces that meet tangent` : ''
  return { input: { ...input, edges }, said: { seamsDropped: seams, note: `${seams} seam edge${seams === 1 ? '' : 's'} left out of the picks${more}: nothing to read a size across.${queried ? ' The query that caught them is kept with sharp: true, which leaves them out at every rebuild.' : ''}` } }
}

async function fitEdges(s: ReverseSession, input: Json, stored: Feature | null, shape: 'round' | 'chamfer'): Promise<FitMark> {
  const section = scanSection()
  const edges = await edgesOf(s, input, stored)
  // A reach given caps the radius, and is kept for a refit; by default it
  // widens by itself where a round reads at its top or not at all.
  const asked = typeof input.reach === 'number' ? input.reach : undefined
  const readings = []
  let points = 0
  let widened = 0
  const running: string[] = []
  for (const [i, edge] of edges.entries()) {
    const r = await readEdgeRound(section, edge, { reach: asked ?? roundReach(shape), shape, widen: asked === undefined })
    if (r.round) points += r.round.residual.points
    if (r.reach !== undefined) widened = Math.max(widened, r.reach)
    readings.push(r.round ? { value: r.round.radius, sigma: r.round.sigma } : { value: null, sigma: null, why: r.why })
    // A round that runs from one size to another along its edge: one
    // number misses it, a line along the edge would not.
    const along = shape === 'round' && r.round && r.stations ? lawOf(r.stations, r.round.radius, r.linear ?? null) : null
    if (along?.kind === 'line') running.push(`#${i + 1} runs from R${along.radius[0]} to R${along.radius[1]} along it`)
  }
  const warning = running.length > 0 ? { warning: `${running.join('; ')} — { edge, radius: "fit" } in edges fits ${running.length === 1 ? 'it' : 'each'} as a variable fillet.` } : {}
  return {
    ...warning,
    // units-ok: a fit is the agent's — its refusals say millimetres always.
    ...combined(shape === 'chamfer' ? 'chamfer’s distance' : 'fillet’s radius', 'mm', readings, shape === 'chamfer' ? 'length' : 'radius'),
    points,
    ...(widened > 0 ? { reach: widened } : {}),
    ...(asked !== undefined ? { spec: { reach: asked } } : {}),
  }
}

/** How many places along an edge a radius fitted along it is read at. */
const LAW_STATIONS = 7

/** What the places along one edge make of its radius: one number, where
 *  each lies within two sigmas of their median (as the edges of a fit
 *  must); a line from the first end to the other, where they spread past
 *  that about the median but each lies within two sigmas of the line;
 *  neither. Sigma is each place's own with the places' pooled. */
function lawOf(stations: readonly EdgeStation[], value: number, linear: LinearLaw | null): { kind: 'one' | 'line' | 'neither'; radius: [number, number] } {
  const read = stations.filter((x): x is EdgeStation & { radius: number; sigma: number } => x.radius !== null && x.sigma !== null)
  const pooled = 1 / Math.sqrt(read.reduce((a, x) => a + 1 / Math.max(x.sigma, 1e-9) ** 2, 0))
  const sigma = read.length > 1 ? 1.2533 * pooled : pooled
  const near = (at: (t: number) => number) => read.every((x) => Math.abs(x.radius - at(x.t)) <= 2 * Math.hypot(x.sigma, sigma))
  if (near(() => value)) return { kind: 'one', radius: [value, value] }
  const [a, b] = linear?.radius ?? [0, 0]
  if (linear && a > 0 && b > 0 && near((t) => a + (b - a) * t)) return { kind: 'line', radius: [a, b] }
  return { kind: 'neither', radius: [value, value] }
}

/** The edges given as { edge, radius: "fit" }, each read along it at
 *  LAW_STATIONS places on the body: its radius [start, end] — one number
 *  both ends where the places agree, a line where they lie on one —
 *  refused where they follow neither. What each was fitted from, by its
 *  place among the fillet's variable edges. */
async function fitEdgeLaws(s: ReverseSession, input: Json, stored: Feature | null): Promise<{ edges: unknown[]; fitted: Record<string, FitMark> }> {
  const section = scanSection()
  const body = input.body !== undefined ? bodyNamed(input.body as Ref) : stored && 'body' in stored ? bodyAt(stored.body as number) : null
  if (!body) throw new CommandError('invalid_input', 'A radius fitted along an edge needs the body.')
  const t = topologyOf(s, body)
  const asked = typeof input.reach === 'number' ? input.reach : undefined
  const edges = [...(input.edges as unknown[])]
  const fitted: Record<string, FitMark> = {}
  let k = 0
  for (const [i, given] of edges.entries()) {
    if (!isVarying(given)) continue
    const at = k++
    if (given.radius !== FIT) continue
    const edge = edgePicked(s, body, given.edge)
    const read = await readEdgeRound(section, readEdgeOf(edge, t, meshOf(t)), { stations: LAW_STATIONS, reach: asked ?? roundReach('round'), widen: asked === undefined })
    if (!read.round || !read.stations) throw new CommandError('failed', `The radius along edges[${i}] cannot be fitted: ${read.why ?? 'no round reads along it'}.`)
    const law = lawOf(read.stations, read.round.radius, read.linear ?? null)
    const listed = read.stations.map((x) => `t ${x.t}: ${x.radius === null ? 'none' : `R${round4(x.radius)} ± ${round4(x.sigma ?? 0)}`}`).join('; ')
    if (law.kind === 'neither')
      throw new CommandError(
        'failed',
        // units-ok: a fit is the agent's — its refusals say millimetres always.
        `The radius along edges[${i}] follows neither one number nor a line from end to end: ${listed}${read.linear ? ` (a line from R${read.linear.radius[0]} to R${read.linear.radius[1]} leaves rms ${read.linear.rms} mm)` : ''}. Split the edge where it changes, or give radius [start, end].`,
      )
    const nominal = rounding(read.round.radius, 'radius', read.round.sigma)
    fitted[`variable.${at}.radius`] = {
      value: read.round.radius,
      sigma: read.round.sigma,
      nominal: nominal.nominal,
      off: nominal.off,
      sigmas: nominal.sigmas,
      points: read.round.residual.points,
      ...(read.linear ? { rms: law.kind === 'line' ? read.linear.rms : read.linear.medianRms } : {}),
      law: law.radius,
      readings: read.stations.map((x) => ({ value: x.radius === null ? null : round4(x.radius), sigma: x.sigma === null ? null : round4(x.sigma) })),
      note:
        law.kind === 'line'
          ? // units-ok: as above.
            `The radius runs from ${law.radius[0]} at the edge’s first end to ${law.radius[1]} at its other: its places spread past two sigmas about one radius (rms ${read.linear!.medianRms} mm) and lie on a line (rms ${read.linear!.rms} mm) — taken as a variable fillet.`
          : `One radius along the edge: its places agree within two sigmas — ${read.round.radius} at both ends.`,
      ...(read.reach !== undefined ? { reach: read.reach } : {}),
    }
    edges[i] = { ...given, radius: law.radius }
  }
  return { edges, fitted }
}

/** Scan points about a box, with their normals. */
async function scanIn(min: Vec3, max: Vec3, limit = 20_000): Promise<{ positions: Float32Array; normals: Float32Array }> {
  if (!useStore.getState().fileName) throw new CommandError('no_scan', 'There is no scan to fit to.')
  const worker = commandHost().session.clientRef.current
  if (!worker) throw new CommandError('unavailable', 'The mesh worker is not running.')
  const q = await worker.query({ min, max, limit })
  return { positions: q.positions, normals: q.normals }
}

/** A plane's origin and normal, whatever kind it is given as. */
function planeFrame(s: ReverseSession, plane: MirrorPlane): { origin: Vec3; normal: Vec3 } {
  if (plane.kind === 'face') return { origin: plane.face.centroid, normal: normalize(plane.face.dir)! }
  const frame = resolvePlaneFrame(plane, s.resolveContext())
  if (!frame) throw new CommandError('not_found', 'That plane is not there any more.')
  return { origin: frame.origin, normal: frame.normal }
}

/** How far off the plane fitted a wall's scan point still counts, mm, at
 *  most — the band narrows to three times the points' scatter, not under
 *  WALL_BAND_MIN_MM — and how far its normal may turn, degrees. */
const WALL_BAND_MM = 1.5
const WALL_BAND_MIN_MM = 0.3
const WALL_TURN_DEG = 25
/** How far a scan wall may lean off the face picked, degrees, for the
 *  first reading: the points are looked for over the face's footprint up
 *  to that far off it, and the band besides. */
const WALL_LEAN_MAX_DEG = 15
/** How many times the plane is fitted again to the points about it. */
const WALL_PASSES = 3
/** Under this share of a face's height along the pull, a draft read off
 *  the scan is said to rest on a strip of it. */
const WALL_COVERAGE_WARN = 0.5

/** A face a draft reads, as picked, and its triangles off the body's mesh
 *  where they are at hand — its outline; null where they are not, and a
 *  square of its area stands in. */
interface DraftFaceIn {
  fingerprint: FaceRef
  triangles: FaceTriangles | null
}

/** The faces a draft's fit reads — those an input names (`picks`) on the
 *  body, or those stored, found again on the body as the feature saw it —
 *  each with its triangles. */
async function draftFacesOf(s: ReverseSession, body: BodyInfo, picks: FacePickIn[] | undefined, stored: readonly FaceRef[], storedId: number | null): Promise<DraftFaceIn[]> {
  if (picks) {
    const mesh = meshOf(topologyOf(s, body))
    return facesPicked(s, body, picks).map((f) => ({ fingerprint: f.fingerprint, triangles: mesh && f.hash >= 0 ? faceTriangles(mesh, f.hash) : null }))
  }
  const st = storedId !== null ? await s.staged(storedId, body.id).catch(() => null) : null
  const tol = matchTolerance(2 * (useStore.getState().modelSize || 100))
  return stored.map((fingerprint) => {
    const i = st ? matchFace(fingerprint, st.topology.faces.map((f) => f.fingerprint), tol) : null
    return { fingerprint, triangles: st && i !== null ? faceTriangles(st.mesh, st.topology.faces[i].hash) : null }
  })
}

/** A face's footprint in its own plane — its triangles, or the square of
 *  its area about its middle — as a point-in test in (u, w); the box round
 *  it; its height along `up`, the way the pull runs. */
function footprintOf(face: DraftFaceIn, c: Vec3, u: Vec3, w: Vec3, up: Vec3): { inside: (p: Vec3) => boolean; lo: Vec3; hi: Vec3; height: number } {
  const tri = face.triangles
  if (!tri || tri.positions.length < 9) {
    const half = Math.sqrt(face.fingerprint.area) / 2
    const corners = [-1, 1].flatMap((a) => [-1, 1].map((b): Vec3 => [0, 1, 2].map((k) => c[k] + a * half * u[k] + b * half * w[k]) as Vec3))
    const along = corners.map((p) => dot(p, up))
    return {
      inside: (p) => Math.abs(dot(sub(p, c), u)) <= half && Math.abs(dot(sub(p, c), w)) <= half,
      lo: [0, 1, 2].map((k) => Math.min(...corners.map((p) => p[k]))) as Vec3,
      hi: [0, 1, 2].map((k) => Math.max(...corners.map((p) => p[k]))) as Vec3,
      height: Math.max(...along) - Math.min(...along),
    }
  }
  const P = tri.positions
  const n = P.length / 3
  const uv = new Float64Array(n * 2)
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  let upLo = Infinity
  let upHi = -Infinity
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
    const d = sub(p, c)
    uv[i * 2] = dot(d, u)
    uv[i * 2 + 1] = dot(d, w)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k])
      hi[k] = Math.max(hi[k], p[k])
    }
    const a = dot(p, up)
    upLo = Math.min(upLo, a)
    upHi = Math.max(upHi, a)
  }
  // Each triangle's box in (u, w), to pass over most of them at once.
  const count = n / 3
  const boxes = new Float64Array(count * 4)
  for (let t = 0; t < count; t++) {
    const xs = [uv[t * 6], uv[t * 6 + 2], uv[t * 6 + 4]]
    const ys = [uv[t * 6 + 1], uv[t * 6 + 3], uv[t * 6 + 5]]
    boxes.set([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], t * 4)
  }
  const EPS = 1e-6
  const inside = (p: Vec3): boolean => {
    const d = sub(p, c)
    const x = dot(d, u)
    const y = dot(d, w)
    for (let t = 0; t < count; t++) {
      if (x < boxes[t * 4] - EPS || y < boxes[t * 4 + 1] - EPS || x > boxes[t * 4 + 2] + EPS || y > boxes[t * 4 + 3] + EPS) continue
      const [ax, ay, bx, by, cx, cy] = uv.subarray(t * 6, t * 6 + 6)
      const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
      const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
      const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
      if (!((d1 < -EPS || d2 < -EPS || d3 < -EPS) && (d1 > EPS || d2 > EPS || d3 > EPS))) return true
    }
    return false
  }
  return { inside, lo, hi, height: upHi - upLo }
}

/** A plane fitted through the points `idx`, its normal turned to `n`'s
 *  side, with the points' scatter about it. */
function planeThrough(positions: Float32Array, idx: readonly number[], n: Vec3): { normal: Vec3; d: number; rms: number } | null {
  const plane = idx.length >= 20 ? fitPlaneTLS(positions, idx) : null
  if (!plane) return null
  let normal: Vec3 = [plane.nx, plane.ny, plane.nz]
  let d = plane.d
  if (dot(normal, n) < 0) {
    normal = scale(normal, -1)
    d = -d
  }
  let sum = 0
  for (const i of idx) sum += (positions[i * 3] * normal[0] + positions[i * 3 + 1] * normal[1] + positions[i * 3 + 2] * normal[2] - d) ** 2
  return { normal, d, rms: Math.sqrt(sum / idx.length) }
}

/** One face's lean off the scan. The points over its footprint — its
 *  outline in its own plane — facing as it does within WALL_TURN_DEG, up
 *  to WALL_LEAN_MAX_DEG of lean off it; a plane through their middle,
 *  facing as they do on average; then a plane fitted to the points within
 *  the band of it, and again to those within the band of that, the band
 *  narrowed to the scatter, WALL_PASSES times. Not the band about the face
 *  picked: a wall leaned off it crosses that band in a strip, and the
 *  strip's noise pulls the fit toward no lean. Answers how much of the
 *  face's height along the pull the points span. */
async function fitDraftFace(face: DraftFaceIn, pull: { origin: Vec3; normal: Vec3 }): Promise<{ value: number | null; sigma: number | null; why?: string; coverage?: number; points: number }> {
  const fp = face.fingerprint
  const c = fp.centroid
  const where = `[${c.map(round4).join(', ')}]`
  if (fp.kind !== 'plane') return { value: null, sigma: null, why: `a ${fp.kind} face — only flat faces are drafted`, points: 0 }
  const n = normalize(fp.dir)!
  // Away from the neutral plane, on the face's side of it.
  const side = Math.sign(dot(sub(c, pull.origin), pull.normal)) || 1
  const away = scale(pull.normal, side)
  // Up the face: the pull as it runs across the face; along it, square.
  const w = normalize(sub(away, scale(n, dot(away, n))))
  if (!w) return { value: null, sigma: null, why: `the face about ${where} is square to the pull`, points: 0 }
  const u = cross(n, w)
  const foot = footprintOf(face, c, u, w, away)
  const reach = WALL_BAND_MM + foot.height * Math.tan((WALL_LEAN_MAX_DEG * Math.PI) / 180)
  const scan = await scanIn([foot.lo[0] - reach, foot.lo[1] - reach, foot.lo[2] - reach], [foot.hi[0] + reach, foot.hi[1] + reach, foot.hi[2] + reach], 40_000)
  const at = (i: number): Vec3 => [scan.positions[i * 3], scan.positions[i * 3 + 1], scan.positions[i * 3 + 2]]
  const facing = (i: number): Vec3 => [scan.normals[i * 3], scan.normals[i * 3 + 1], scan.normals[i * 3 + 2]]
  const cosTurn = Math.cos((WALL_TURN_DEG * Math.PI) / 180)
  const over: number[] = []
  for (let i = 0; i < scan.positions.length / 3; i++) {
    const p = at(i)
    if (Math.abs(dot(sub(p, c), n)) <= reach && dot(facing(i), n) >= cosTurn && foot.inside(p)) over.push(i)
  }
  const tooFew = { value: null, sigma: null, why: `too few scan points on the face about ${where}`, points: 0 }
  if (over.length < 20) return tooFew
  let sum: Vec3 = [0, 0, 0]
  for (const i of over) sum = [sum[0] + facing(i)[0], sum[1] + facing(i)[1], sum[2] + facing(i)[2]]
  let normal = normalize(sum) ?? n
  const offsets = over.map((i) => dot(at(i), normal)).sort((a, b) => a - b)
  let d = offsets[offsets.length >> 1]
  let band = WALL_BAND_MM
  let idx: number[] = []
  let rms = 0
  for (let pass = 0; pass <= WALL_PASSES; pass++) {
    const near = over.filter((i) => Math.abs(dot(at(i), normal) - d) <= band && dot(facing(i), normal) >= cosTurn)
    const plane = planeThrough(scan.positions, near, n)
    if (!plane) break
    idx = near
    ;({ normal, d, rms } = plane)
    band = Math.min(WALL_BAND_MM, Math.max(WALL_BAND_MIN_MM, 3 * rms))
  }
  if (idx.length < 20) return tooFew
  const angle = (Math.asin(Math.max(-1, Math.min(1, dot(normal, away)))) * 180) / Math.PI
  // The angle's sigma: the points' scatter about the plane over their
  // spread along the pull, the direction the lean is read in.
  const ups = idx.map((i) => dot(at(i), away)).sort((a, b) => a - b)
  const middle = ups.reduce((a, x) => a + x, 0) / ups.length
  const spread = ups.reduce((a, x) => a + (x - middle) ** 2, 0)
  const sigma = spread > 0 ? (rms / Math.sqrt(spread)) * (180 / Math.PI) : null
  // The span from the 2nd to the 98th percentile, so a stray point does
  // not stretch it.
  const q = (f: number) => ups[Math.round(f * (ups.length - 1))]
  const coverage = foot.height > 1e-9 ? Math.min(1, (q(0.98) - q(0.02)) / foot.height) : 1
  return { value: angle, sigma, coverage, points: idx.length }
}

/** A draft's angle off the scan for faces: each face's lean, the median —
 *  and the least share of a face's height the scan spans, with a warning
 *  naming each face under half. */
async function fitDraftFaces(faces: DraftFaceIn[], pull: { origin: Vec3; normal: Vec3 }, what = 'draft’s angle'): Promise<FitReading> {
  if (faces.length === 0) throw new CommandError('invalid_input', 'A fitted draft needs the faces it leans.')
  const read: Awaited<ReturnType<typeof fitDraftFace>>[] = []
  for (const f of faces) read.push(await fitDraftFace(f, pull))
  const r = combined(what, '°', read, 'draft')
  const covered = read.map((x) => x.coverage).filter((x): x is number => x !== undefined)
  const pct = (x: number) => `${Math.round(x * 100)} %`
  const thin = read.flatMap((x, i) => (x.coverage !== undefined && x.coverage < WALL_COVERAGE_WARN ? [faces.length === 1 ? pct(x.coverage) : `#${i + 1} ${pct(x.coverage)}`] : []))
  return {
    ...r,
    points: read.reduce((a, x) => a + x.points, 0),
    ...(r.readings ? { readings: r.readings.map((x, i) => (read[i].coverage !== undefined ? { ...x, coverage: round4(read[i].coverage!) } : x)) } : {}),
    ...(covered.length > 0 ? { coverage: round4(Math.min(...covered)) } : {}),
    ...(thin.length > 0 ? { warning: `The scan spans under half the face’s height along the pull (${thin.join(', ')}): the angle rests on a strip of it — check it on a section across the wall, or give a number.` } : {}),
  }
}

/** The body, the neutral plane's frame and the draft as it stands, for a
 *  draft's fit, from an input and the feature. */
function draftFitFrame(s: ReverseSession, input: Json, stored: Feature | null): { body: BodyInfo; pull: { origin: Vec3; normal: Vec3 }; draft: DraftFeature | null } {
  const draft = stored && stored.kind === 'draft' ? stored : null
  const bodyRef = (input.body ?? (stored && 'body' in stored ? stored.body : undefined)) as Ref | undefined
  if (bodyRef === undefined) throw new CommandError('invalid_input', 'A fitted draft needs its body.')
  const body = bodyNamed(bodyRef)
  const neutral: MirrorPlane | undefined = input.neutral ? mirrorPlaneOf(s, input.neutral as Json, body) : draft?.neutral
  if (!neutral) throw new CommandError('invalid_input', 'A fitted draft needs its neutral plane.')
  return { body, pull: planeFrame(s, neutral), draft }
}

async function fitDraftAngle(s: ReverseSession, input: Json, stored: Feature | null): Promise<FitReading> {
  const { body, pull, draft } = draftFitFrame(s, input, stored)
  return fitDraftFaces(await draftFacesOf(s, body, input.faces as FacePickIn[] | undefined, draft?.faces ?? [], draft?.id ?? null), pull)
}

/** The region's outline points, for a point-in test with a margin. */
function inside(poly: readonly Vec2[], p: Vec2): boolean {
  let inn = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inn = !inn
  }
  return inn
}

function edgeDistance(poly: readonly Vec2[], p: Vec2): number {
  let d = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]
    const b = poly[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const ll = dx * dx + dy * dy
    const t = ll > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll)) : 0
    d = Math.min(d, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)))
  }
  return d
}

/** How far inside a region's outline a scan point has to lie to be read
 *  for the end — clear of the walls' rounds. */
const END_INSET_MM = 0.5
/** A gap along the extrusion that splits the points into two faces, mm. */
const END_GAP_MM = 0.3
/** How far a cap's normal may turn from the extrusion's, degrees. */
const END_TURN_DEG = 15

async function fitExtrudeEnd(s: ReverseSession, input: Json, stored: Feature | null): Promise<{ reading: FitReading; to: number; from: number; spec: Json }> {
  const extent = input.extent as Json
  const st = stored && stored.kind === 'extrude' ? stored : null
  const sketch: SketchFeature = input.sketchId !== undefined ? sketchNamed(input.sketchId as Ref) : st ? (sketchNamed(st.sketchId) as SketchFeature) : (() => { throw new CommandError('invalid_input', 'An extrude to the scan needs its sketch.') })()
  const keys = input.sketchId !== undefined ? regionKeys(s, sketch, input.regions) : st!.regions
  const regions = s.regionsOf(sketch).filter((r) => keys.includes(r.key))
  if (regions.length === 0) throw new CommandError('invalid_state', `${sketch.name} has none of the regions picked.`)
  const frame = sketch.frame
  const dirIn = (input.direction as Vec3 | undefined) ?? (st as { direction?: Vec3 } | null)?.direction
  const dir = normalize(dirIn ?? frame.normal)!
  const from = Number(extent.from ?? 0)
  const sign = extent.reverse === true ? -1 : 1
  const op = String(input.op ?? st?.op ?? 'join')
  // modelSize is about half the part's diagonal: the prism swept twice
  // that each way reaches every face of the part.
  const size = 2 * (useStore.getState().modelSize || 100)
  // The box the region's prism sweeps over the part's size each way.
  let lo: Vec3 = [Infinity, Infinity, Infinity]
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const r of regions) {
    for (const [u, v] of r.outer.polygon) {
      for (const t of [from - size, from + size]) {
        const p: Vec3 = [0, 1, 2].map((k) => frame.origin[k] + u * frame.basisU[k] + v * frame.basisV[k] + t * dir[k]) as Vec3
        lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1]), Math.min(lo[2], p[2])]
        hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1]), Math.max(hi[2], p[2])]
      }
    }
  }
  const scan = await scanIn(lo, hi)
  // A cap faces along the extrusion for a solid made; a cut ends on the
  // floor of what it takes out, which faces back.
  const capDir = op === 'cut' ? -sign : sign
  const cosTurn = Math.cos((END_TURN_DEG * Math.PI) / 180)
  const nDotDir = dot(frame.normal, dir)
  const ts: number[] = []
  for (let i = 0; i < scan.positions.length / 3; i++) {
    const m: Vec3 = [scan.normals[i * 3], scan.normals[i * 3 + 1], scan.normals[i * 3 + 2]]
    if (dot(m, dir) * capDir < cosTurn) continue
    const d = sub([scan.positions[i * 3], scan.positions[i * 3 + 1], scan.positions[i * 3 + 2]], frame.origin)
    const t = dot(d, frame.normal) / nDotDir
    if ((t - from) * sign <= 0.05) continue
    const q = sub(d, [dir[0] * t, dir[1] * t, dir[2] * t])
    const uv: Vec2 = [dot(q, frame.basisU), dot(q, frame.basisV)]
    const hit = regions.some((r) => inside(r.outer.polygon, uv) && edgeDistance(r.outer.polygon, uv) >= END_INSET_MM && !r.holes.some((h) => inside(h.polygon, uv) || edgeDistance(h.polygon, uv) < END_INSET_MM))
    if (hit) ts.push(t)
  }
  // The faces met along the way, by gaps along the extrusion.
  ts.sort((a, b) => a - b)
  const clusters: number[][] = []
  for (const t of ts) {
    const last = clusters[clusters.length - 1]
    if (last && t - last[last.length - 1] <= END_GAP_MM) last.push(t)
    else clusters.push([t])
  }
  const most = Math.max(0, ...clusters.map((c) => c.length))
  const faces = clusters.filter((c) => c.length >= Math.max(20, 0.1 * most))
  if (faces.length === 0) throw new CommandError('failed', `No face of the scan caps the region along the extrusion${ts.length > 0 ? ` — ${ts.length} points, none gathered into a face` : ''}: check the direction (reverse for the other way) and the op.`)
  const near = extent.near as number | undefined
  const along = (c: number[]) => median(c) * sign
  const chosen =
    near !== undefined
      ? faces.reduce((a, b) => (Math.abs(median(b) - near) < Math.abs(median(a) - near) ? b : a))
      : op === 'cut'
        ? faces.reduce((a, b) => (along(b) < along(a) ? b : a))
        : faces.reduce((a, b) => (along(b) > along(a) ? b : a))
  const to = median(chosen)
  const mad = median(chosen.map((t) => Math.abs(t - to)))
  const rms = Math.sqrt(chosen.reduce((a, t) => a + (t - to) ** 2, 0) / chosen.length)
  // A scan's noise runs together across a face — a stripe, a pass — so its
  // thousands of points are not thousands of readings: no better than a
  // hundred independent ones.
  const sigma = Math.max((1.4826 * mad) / Math.sqrt(chosen.length), rms / 10) || null
  const nominal = rounding(to, 'length', sigma)
  return {
    from,
    to,
    spec: { kind: 'toScan', from, ...(extent.reverse === true ? { reverse: true } : {}), ...(near !== undefined ? { near } : {}) },
    reading: {
      value: round4(to),
      sigma: sigma === null ? null : round4(sigma),
      nominal: nominal.nominal,
      off: nominal.off,
      sigmas: nominal.sigmas,
      points: chosen.length,
      rms: round4(rms),
      ...(faces.length > 1 ? { readings: faces.map((c) => ({ value: round4(median(c)), sigma: null })) } : {}),
    },
  }
}

/**
 * An input's "fit" values fitted: the input with the numbers in their
 * place, and what each was fitted from, by the field it went into. `stored`
 * is the feature as it stands, for an update or a refit: what the input
 * leaves out is read off it.
 */
export async function resolveFits(s: ReverseSession, kind: string, input: Json, stored: Feature | null = null): Promise<{ input: Json; fitted: Record<string, FitMark> }> {
  if (!asksFit(kind, input)) return { input, fitted: {} }
  switch (kind) {
    case 'fillet': {
      const cleared = input.radius === FIT ? dropSeams(s, input, stored) : { input, said: {} }
      const r = input.radius === FIT ? await fitEdges(s, cleared.input, stored, 'round') : null
      const laws = edgesAskFit(input) ? await fitEdgeLaws(s, cleared.input, stored) : null
      const { reach: _reach, ...rest } = cleared.input
      return { input: { ...rest, ...(r ? { radius: r.value } : {}), ...(laws ? { edges: laws.edges } : {}) }, fitted: { ...(r ? { radius: { ...r, ...cleared.said } } : {}), ...laws?.fitted } }
    }
    case 'chamfer': {
      const mode = input.mode ?? (stored && stored.kind === 'chamfer' ? stored.mode : undefined)
      if (mode !== undefined && mode !== 'equal') throw new CommandError('invalid_input', 'Only an even chamfer’s distance is fitted — give the numbers of one by two distances or an angle.')
      const cleared = dropSeams(s, input, stored)
      const r = await fitEdges(s, cleared.input, stored, 'chamfer')
      const { reach: _reach, ...rest } = cleared.input
      return { input: { ...rest, distance: r.value }, fitted: { distance: { ...r, ...cleared.said } } }
    }
    case 'draft': {
      const fitted: Record<string, FitMark> = {}
      let out = input
      if (input.angleDeg === FIT) {
        const r = await fitDraftAngle(s, input, stored)
        out = { ...out, angleDeg: r.value }
        fitted.angleDeg = r
      }
      // Each group asking for its angle fitted, off its own faces.
      const groups = input.groups as Json[] | undefined
      if (groups?.some((g) => g?.angleDeg === FIT)) {
        const { body, pull, draft } = draftFitFrame(s, input, stored)
        const next: Json[] = []
        for (const [i, g] of groups.entries()) {
          if (g.angleDeg !== FIT) {
            next.push(g)
            continue
          }
          // The group's faces as given — or, handed back as stored (a
          // refit), found on the body as the feature saw it.
          const was = draft?.groups?.[i]
          const asStored = was !== undefined && g.faces === (was.faces as unknown)
          const faces = asStored ? await draftFacesOf(s, body, undefined, was.faces, draft!.id) : await draftFacesOf(s, body, g.faces as FacePickIn[], [], null)
          const r = await fitDraftFaces(faces, pull, `angle of group ${i + 1}`)
          next.push({ ...g, angleDeg: r.value })
          fitted[`groups.${i}.angleDeg`] = r
        }
        out = { ...out, groups: next }
      }
      return { input: out, fitted }
    }
    case 'extrude': {
      const r = await fitExtrudeEnd(s, input, stored)
      return { input: { ...input, extent: { kind: 'distance', from: r.from, to: r.to } }, fitted: { 'extent.to': { ...r.reading, spec: r.spec } } }
    }
    case 'surface': {
      // A region asked for by a query: read off the scan, the feature
      // keeping the vertices found — and the scan handed to the kernel,
      // which fits the surface through them, if it has not got it yet.
      // A box's numbers given by expressions are read through them first;
      // the box is kept with the feature, for them to move it later.
      const asked = boxByExprs(input.region as Json, input.exprs as Json | undefined)
      const region = await regionOf(asked)
      await s.syncScan()
      return { input: { ...input, region, regionBox: asked.box ? asked : null }, fitted: {} }
    }
  }
  return { input, fitted: {} }
}

/** The input that fits a feature's marked fields again — "fit" where each
 *  was, the extrude's end as it was asked for. */
export function refitInput(feature: Feature, fields?: readonly string[]): { set: Json; fields: string[] } {
  const m = fittedOf(feature.id, feature) ?? {}
  const asked = fields ?? Object.keys(m)
  if (asked.length === 0) throw new CommandError('invalid_state', 'Nothing of this feature was fitted this session — name the fields to fit (radius, distance, angleDeg, extent.to).')
  const set: Json = {}
  for (const f of asked) {
    if (f === 'radius' || f === 'distance' || f === 'angleDeg') {
      set[f] = FIT
      // A round's reach, given when it was fitted, given again.
      const reach = (m[f] as FitMark | undefined)?.spec?.reach
      if (f !== 'angleDeg' && typeof reach === 'number') set.reach = reach
    }
    else if (f === 'extent.to') set.extent = ((m[f] as FitMark | undefined)?.spec as Json | undefined) ?? { kind: 'toScan', from: (feature as { extent?: { from?: number } }).extent?.from ?? 0 }
    else if (/^groups\.\d+\.angleDeg$/.test(f) && feature.kind === 'draft' && feature.groups?.[Number(f.split('.')[1])]) {
      // A group's angle: the groups handed back as they stand — their
      // faces the stored ones, found on the body as the feature saw it —
      // that one asking for its angle fitted.
      const i = Number(f.split('.')[1])
      const groups = ((set.groups as Json[] | undefined) ?? feature.groups.map((g) => ({ ...g }) as unknown as Json)).slice()
      groups[i] = { ...groups[i], faces: feature.groups[i].faces, angleDeg: FIT }
      set.groups = groups
    } else throw new CommandError('invalid_input', `${f} is not a number that is fitted — radius, distance, angleDeg, a draft's groups.<i>.angleDeg or extent.to.`)
  }
  return { set, fields: [...asked] }
}
