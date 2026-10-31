// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.fillet_read: the radius of the round the scan has where a
// body has a sharp edge — read across the edge at a few places along it,
// as the fillet box reads it for the first edge picked — so the agent says
// "this edge is rounded" and ScanRuler says by how much.

import { commandHost } from '../../../src/commands/host'
import { arr, enumOf, int, num, obj } from '../../../src/commands/schema'
import { round4 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import type { EdgeInfo, FaceInfo } from '../core/buildTypes'
import { type CurvedEdge, type CurvedRead, curvedStations, curvedUnreadable, type FacedMesh, type FreeEdge, freeEdgeOf, freeStations, freeUnreadable, isCurvedEdge, readCurvedCut, readFreeCut } from '../core/curvedEdge'
import { combineReadings, cornerUnreadable, type FilletReading, type Miss, readCornerCut, readCornerSetbacks, type ScanCut } from '../core/filletEstimate'
import { rounding } from '../core/intent'
import { bodyNamed, type EdgePickIn, edgesPicked, meshOf, ready, type Ref, topologyOf } from './reCommandCore'
import { bodyRef, edgePick } from './reSchemas'

/** How many places along an edge the round is read at, by default, and
 *  where: evenly over the middle of the edge, clear of its ends where the
 *  neighbouring faces' rounds run in. */
const STATIONS = 3

/** The same on an edge of any other shape: its faces' traces change along
 *  it, and each place reads them a little differently, so the spread of
 *  more places is what says how well the round is known. */
const FREE_STATIONS = 7

const MIDDLE_SHARE = 0.6

/** The reaches a read is widened to, as multiples of the one asked, where
 *  the round reads at the top of the search or not at all; and how near
 *  the reach a radius counts as at the top. */
const WIDER = [2, 4] as const
const AT_TOP = 0.8

/** A round read off the scan at one edge, for the answer. */
export interface EdgeRound {
  radius: number
  sigma: number
  /** The radius's nominal (to the half millimetre), how far off, and in
   *  how many sigmas. */
  nominal: number
  off: number
  sigmas: number | null
  residual: { rms: number; points: number }
  /** A chamfer's setback on each of the edge's faces apart, mm, with
   *  their sigmas — an uneven bevel, a countersink. */
  setbacks?: [number, number]
  setbackSigma?: [number, number]
  /** A chamfer on a hole's mouth as a countersink: the included angle, the
   *  diameter where it meets the flat face, and its depth along the axis. */
  countersink?: { angleDeg: number; diameter: number; depth: number; sigma: { angleDeg: number; diameter: number; depth: number } }
}

/** An edge as the reading takes it: a fingerprint, with the ends and the
 *  faces' surfaces where the body gives them — a circle edge needs both —
 *  and, for an edge of any other shape, its polyline, its faces by hash and
 *  the body's mesh they are found on. */
export type ReadEdge = Pick<EdgeInfo, 'fingerprint'> & {
  ends?: EdgeInfo['ends']
  surfaces?: CurvedEdge['surfaces']
  polyline?: ArrayLike<number>
  faceHashes?: readonly number[]
  mesh?: FacedMesh
}

/** An edge with its faces' surfaces off the topology it was picked on, and
 *  the body's mesh where it is at hand. */
export function readEdgeOf(edge: EdgeInfo, topology: { faces: readonly FaceInfo[] }, mesh?: FacedMesh | null): ReadEdge {
  return {
    fingerprint: edge.fingerprint,
    ends: edge.ends,
    surfaces: edge.faces.map((h) => topology.faces.find((f) => f.hash === h)?.fingerprint),
    ...(mesh?.faceHash ? { polyline: edge.polyline, faceHashes: edge.faces, mesh } : {}),
  }
}

/** The edge as one of any shape, where the body's mesh came with it. */
const freeOf = (edge: ReadEdge): FreeEdge | null => (edge.polyline && edge.faceHashes && edge.mesh ? freeEdgeOf(edge.polyline, edge.faceHashes, edge.mesh) : null)

/** A shape read where the scan has the other one: a straight cut fits a
 *  round's points too, loosely, and a big round a chamfer's — the other
 *  shape, read there as well, fits them markedly closer, resting on nearly
 *  as many: a small chamfer across a round's middle fits the few points it
 *  rests on closer and leaves the rest. */
const otherFitsBetter = (read: FilletReading, other: FilletReading | null | undefined) => !!other && other.rms < 0.7 * read.rms && other.points >= OTHER_POINTS * read.points
const OTHER_POINTS = 0.75
const otherShape = (shape: 'round' | 'chamfer') => (shape === 'round' ? 'chamfer' : 'round')

/** Several stations' readings of one number made one, as combineReadings
 *  makes the radius. */
const combineValues = (xs: readonly { value: number; sigma: number; points: number; rms: number }[]) => combineReadings(xs.map((x) => ({ radius: x.value, sigma: x.sigma, points: x.points, rms: x.rms })))

/** What one place read: the round, or why none — "sharp", "no scan",
 *  "chamfer better", "S-profile: 45 % on the arc", "another face 1.7 mm off
 *  within the reach — reach ≤ 1.5" … */
type PlaceRead = CurvedRead | string

/** A place's verdict as the answer gives it: "R0.8" (a chamfer "C0.5"), or
 *  why it read none. */
const verdict = (x: PlaceRead, shape: 'round' | 'chamfer'): string => (typeof x === 'string' ? x : `${shape === 'chamfer' ? 'C' : 'R'}${Number(x.reading.radius.toFixed(2))}`)

/** The round across `edge` read off the scan at `stations` places, or why
 *  it cannot be: null with `why` for an edge of the wrong kind, `round:
 *  false` where the scan shows no round. A straight edge between two flats
 *  is read by filletEstimate, a curved one — a circle, an arc, an edge on a
 *  cylinder — by curvedEdge off its faces' surfaces, and any other edge
 *  picked on a body by curvedEdge off the body's mesh. `places` is one
 *  verdict a place — the round it read, or why none — where the edge reads
 *  a round at some places only, or a place read none for more than a sharp
 *  corner. Shared with the fillet's "fit" value. */
export async function readEdgeRound(
  section: (origin: Vec3, normal: Vec3, minLength: number) => Promise<ScanCut>,
  edge: ReadEdge,
  { stations: asked, reach, shape = 'round', widen = false }: { stations?: number; reach: number; shape?: 'round' | 'chamfer'; widen?: boolean },
): Promise<{ round: EdgeRound | null; why?: string; radii: (number | null)[]; places?: string[]; reach?: number; stations?: EdgeStation[]; linear?: LinearLaw }> {
  const fp = edge.fingerprint
  const curved = isCurvedEdge(fp)
  const unreadable = curved ? curvedUnreadable(edge) : cornerUnreadable(fp)
  // What the faces' surfaces do not say, the body's mesh does: an edge of
  // any shape, read off its polyline and its faces' triangles.
  const free = unreadable ? freeOf(edge) : null
  if (unreadable && !free) return { round: null, why: fp.kind === 'other' && !edge.mesh ? 'a curved edge known by its fingerprint only — pick it on the body' : unreadable, radii: [] }
  const freeWhy = free ? freeUnreadable(free) : null
  if (freeWhy) return { round: null, why: freeWhy, radii: [] }
  const stations = asked ?? STATIONS
  // Each place's cut, taken once, and how it reads at a reach: the cut
  // does not depend on the reach, so a wider read cuts nothing again.
  const places: ((reach: number) => PlaceRead)[] = []
  // Where each place lies along the edge, and whether the edge closes on
  // itself — a full circle, a loop — which has no first end to run from.
  const where: { t: number; at: Vec3 }[] = []
  let closed = false
  // The other shape fitting markedly closer is a verdict of its own.
  const better = `${otherShape(shape)} better`
  if (free) {
    const at = freeStations(free, asked ?? FREE_STATIONS, MIDDLE_SHARE)
    if (!at) return { round: null, why: 'the edge’s geometry places no cut across it', radii: [] }
    const poly = free.polyline
    const k = poly.length - 3
    closed = Math.hypot(poly[0] - poly[k], poly[1] - poly[k + 1], poly[2] - poly[k + 2]) < 1e-6
    for (const st of at) {
      where.push({ t: st.t ?? 0.5, at: st.at })
      const cut = await section(st.at, st.normal, 0)
      places.push((reach) => {
        const miss: Miss = {}
        const read = readFreeCut(free, st, cut, reach, shape, miss)
        if (!read) return miss.why ?? 'sharp'
        return otherFitsBetter(read.reading, readFreeCut(free, st, cut, reach, otherShape(shape))?.reading) ? better : read
      })
    }
  } else if (curved) {
    const at = curvedStations(edge, stations, MIDDLE_SHARE)
    if (!at) return { round: null, why: 'the edge’s geometry places no cut across it', radii: [] }
    closed = fp.kind === 'circle' && fp.length / fp.radius! > 2 * Math.PI - 1e-3
    for (const st of at) {
      where.push({ t: st.t ?? 0.5, at: st.at })
      const cut = await section(st.at, st.normal, 0)
      places.push((reach) => {
        const miss: Miss = {}
        const read = readCurvedCut(edge, st, cut, reach, shape, miss)
        if (!read) return miss.why ?? 'sharp'
        return otherFitsBetter(read.reading, readCurvedCut(edge, st, cut, reach, otherShape(shape))?.reading) ? better : read
      })
    }
  } else {
    // A fingerprint alone (a stored pick) has its middle, direction and
    // length: the ends lie half the length either side.
    const half = fp.length / 2
    const [a, b] = edge.ends ?? [
      [fp.mid[0] - fp.dir[0] * half, fp.mid[1] - fp.dir[1] * half, fp.mid[2] - fp.dir[2] * half],
      [fp.mid[0] + fp.dir[0] * half, fp.mid[1] + fp.dir[1] * half, fp.mid[2] + fp.dir[2] * half],
    ]
    const at = (t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    const ts = stations === 1 ? [0.5] : Array.from({ length: stations }, (_, i) => 0.5 - MIDDLE_SHARE / 2 + (MIDDLE_SHARE * i) / (stations - 1))
    for (const t of ts) {
      const p = at(t)
      where.push({ t, at: p })
      const cut = await section(p, fp.dir, 0)
      places.push((reach) => {
        const miss: Miss = {}
        const reading = readCornerCut(fp, p, cut, reach, shape, miss)
        if (!reading) return miss.why ?? 'sharp'
        if (otherFitsBetter(reading, readCornerCut(fp, p, cut, reach, otherShape(shape)))) return better
        const setbacks = shape === 'chamfer' ? readCornerSetbacks(fp, p, cut, reach) : null
        return { reading, ...(setbacks ? { setbacks } : {}) }
      })
    }
  }
  // A round at fewer than half the places read is no round along this
  // edge: a dent, a chip, a blob of the scan.
  const enough = (n: number) => n > 0 && n * 2 >= places.length
  const readAt = (r: number) => {
    const readings = places.map((read) => read(r))
    const found = readings.filter((x): x is CurvedRead => typeof x !== 'string')
    return { reach: r, readings, found, reading: enough(found.length) ? combineReadings(found.map((x) => x.reading)) : null }
  }
  let read = readAt(reach)
  // The search runs up to the reach: a round read at the top of it, or
  // none, may be a larger one than the reach takes in — read again at 2×
  // and 4× the reach. A round at the top that a wider read does not bear
  // out stands.
  if (widen) {
    let most = read
    for (const k of WIDER) {
      if (read.reading && read.reading.radius < AT_TOP * read.reach) break
      const wider = readAt(k * reach)
      if (wider.reading) read = wider
      else if (read.reading) break
      else if (wider.found.length >= most.found.length) most = wider
    }
    if (!read.reading) read = most.found.length > 0 ? most : { ...read, reach: WIDER[WIDER.length - 1] * reach }
  }
  const { readings, found, reading } = read
  const radii = readings.map((r) => (typeof r === 'string' ? null : round4(r.reading.radius)))
  const along: EdgeStation[] = where.map((w, i) => {
    const r = readings[i]
    return { t: round4(w.t), at: w.at.map(round4) as Vec3, radius: typeof r === 'string' ? null : r.reading.radius, sigma: typeof r === 'string' ? null : r.reading.sigma }
  })
  const law = closed ? null : linearLaw(along)
  const placed = { stations: along, ...(law ? { linear: law } : {}) }
  const verdicts = readings.map((r) => verdict(r, shape))
  // The verdicts, where a place read none for more than a sharp corner: an
  // edge sharp at every place it missed says so once, as before.
  const said = verdicts.some((v, i) => typeof readings[i] === 'string' && v !== 'sharp') ? { places: verdicts } : {}
  const what = shape === 'chamfer' ? 'chamfer' : 'round'
  const wide = read.reach !== reach ? { reach: round4(read.reach) } : {}
  // Every place missing for one reason, not a sharp corner: that reason,
  // in place of the list of what it might be.
  const one = found.length === 0 && verdicts.every((v) => v === verdicts[0]) && verdicts[0] !== 'sharp' ? verdicts[0] : null
  if (!reading)
    return {
      round: null,
      why:
        found.length === 0
          // units-ok: the agent's answer (reverse.body.fillet_read and a fit), in millimetres always.
          ? `no ${what} within ${round4(read.reach)} mm (reach)${widen ? ', the reach widened to 4× by itself' : ''}: ${one ?? `the scan shows a sharp corner, ${shape === 'chamfer' ? 'a round' : 'a chamfer'}, a gap or a ${what} larger than the reach takes in here — give a larger reach for a larger ${what}`}`
          : `a ${what} at ${found.length} of ${readings.length} places only — not one along the edge`,
      radii,
      ...(found.length > 0 ? { places: verdicts } : one ? {} : said),
      ...wide,
      ...placed,
    }
  const r = rounding(reading.radius, shape === 'chamfer' ? 'length' : 'radius', reading.sigma)
  const round: EdgeRound = { radius: round4(reading.radius), sigma: round4(reading.sigma), nominal: r.nominal, off: r.off, sigmas: r.sigmas, residual: { rms: round4(reading.rms), points: reading.points } }
  const sb = found.flatMap((x) => (x.setbacks ? [x.setbacks] : []))
  if (enough(sb.length)) {
    const s = [0, 1].map((k) => combineValues(sb.map((x) => ({ value: x.s[k], sigma: x.sigma[k], points: x.points, rms: x.rms })))!)
    round.setbacks = [round4(s[0].radius), round4(s[1].radius)]
    round.setbackSigma = [round4(s[0].sigma), round4(s[1].sigma)]
  }
  const cs = found.flatMap((x) => (x.countersink ? [x.countersink] : []))
  if (enough(cs.length)) {
    const one = (v: (c: (typeof cs)[0]) => number, sg: (c: (typeof cs)[0]) => number) => combineValues(cs.map((c) => ({ value: v(c), sigma: sg(c), points: 1, rms: 0 })))!
    const angle = one((c) => c.angleDeg, (c) => c.angleSigma)
    const dia = one((c) => c.diameter, (c) => c.diameterSigma)
    const depth = one((c) => c.depth, (c) => c.depthSigma)
    round.countersink = { angleDeg: round4(angle.radius), diameter: round4(dia.radius), depth: round4(depth.radius), sigma: { angleDeg: round4(angle.sigma), diameter: round4(dia.sigma), depth: round4(depth.sigma) } }
  }
  return { round, radii, ...said, ...wide, ...placed }
}

/** A place an edge's round was read at: where along the edge (t, 0 at its
 *  first end), the point, and what it read there — null where none. */
export interface EdgeStation {
  t: number
  at: Vec3
  radius: number | null
  sigma: number | null
}

/** A round running evenly along an edge: the line through the places' radii
 *  over t, carried out to the edge's ends — [first end, other] as a variable
 *  fillet takes it — its rms about them, and theirs about their median. */
export interface LinearLaw {
  radius: [number, number]
  rms: number
  medianRms: number
}

/** The line through the radii read along an edge, from three places that
 *  read at least; null with fewer. */
export function linearLaw(stations: readonly EdgeStation[]): LinearLaw | null {
  const read = stations.filter((s): s is EdgeStation & { radius: number } => s.radius !== null)
  const n = read.length
  if (n < LAW_PLACES) return null
  const tm = read.reduce((a, s) => a + s.t, 0) / n
  const rm = read.reduce((a, s) => a + s.radius, 0) / n
  const stt = read.reduce((a, s) => a + (s.t - tm) ** 2, 0)
  if (!(stt > 1e-9)) return null
  const slope = read.reduce((a, s) => a + (s.t - tm) * (s.radius - rm), 0) / stt
  const at = (t: number) => rm + slope * (t - tm)
  const sorted = read.map((s) => s.radius).sort((a, b) => a - b)
  const median = n % 2 ? sorted[n >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
  return {
    radius: [round4(at(0)), round4(at(1))],
    rms: round4(Math.sqrt(read.reduce((a, s) => a + (s.radius - at(s.t)) ** 2, 0) / n)),
    medianRms: round4(Math.sqrt(read.reduce((a, s) => a + (s.radius - median) ** 2, 0) / n)),
  }
}

/** How many places must read for a line through them. */
const LAW_PLACES = 3

/** The mesh worker's cut of the scan, for a command; refused with no scan. */
export function scanSection(): (origin: Vec3, normal: Vec3, minLength: number) => Promise<ScanCut> {
  if (!useStore.getState().fileName) throw new CommandError('no_scan', 'There is no scan to read a round off.')
  const worker = commandHost().session.clientRef.current
  if (!worker) throw new CommandError('unavailable', 'The mesh worker is not running.')
  return (origin, normal, minLength) => worker.section(origin, normal, minLength)
}

/** How far from an edge the scan is read for its round: a few times the
 *  largest round expected, from the part's size. */
export const roundReach = (shape: 'round' | 'chamfer' = 'round') => Math.max(shape === 'chamfer' ? 5 : 3, useStore.getState().modelSize * 0.05)

export const filletRead: Command<{ body: Ref; edges: EdgePickIn[]; shape?: 'round' | 'chamfer'; stations?: number; reach?: number }> = {
  name: 'fillet_read',
  title: 'Read rounds off the scan',
  description:
    // units-ok: the command's description, for the agent — in millimetres always.
    'The round (or chamfer) the scan has along each of a body’s sharp edges — what a fillet or chamfer there should be — read in cuts of the scan square to the edge at several stations along it, the round fitted between the two faces’ traces (by their surfaces where they are flat, cylindrical, conical or spherical, else off the body’s own faces cut at each station). Edges are picked as a fillet picks them. Each edge answers round: true with radius (the median), sigma, nominal, off, sigmas, residual, radii, stations and linear (radius [first end, other], rms, medianRms — a variable fillet’s law where rms is well under medianRms); round: false with why where only some stations read one (places gives a verdict a station); round: null for an edge it cannot read. Edges where no station reads a round are gathered into sharp: { edges, why }. shape: "chamfer" answers chamfer, distance, setbacks, setbackSigma and on a hole’s mouth countersink. Then median and spread over the edges read. reach caps the radius read: left out, a round at the top of the search is read again at 2× and 4×; an empty read says "no round within N mm" — give a larger one. Needs a scan. Changes nothing.',
  input: obj(
    {
      body: bodyRef,
      edges: arr(edgePick, 'The edges, as a fillet picks them.', { minItems: 1 }),
      shape: enumOf(['round', 'chamfer'] as const, 'What to read: a round (default) or a chamfer.'),
      stations: int(`Stations along each edge; ${STATIONS} by default, ${FREE_STATIONS} on an edge read off the mesh.`, { minimum: 1, maximum: 9 }),
      // units-ok: the command's schema, for the agent — in millimetres always.
      reach: num('How far from the edge the scan is read, mm; caps the radius. Left out: 5 % of the part’s size, 3 mm at least (5 for a chamfer).', { exclusiveMinimum: 0 }),
    },
    ['body', 'edges'],
  ),
  readOnly: true,
  run: async ({ body: bodyIn, edges: picks, shape = 'round', stations, reach }) => {
    const section = scanSection()
    const s = await ready()
    const body = bodyNamed(bodyIn)
    const edges = edgesPicked(s, body, picks)
    const t = topologyOf(s, body)
    const chamfer = shape === 'chamfer'
    const out: Record<string, unknown>[] = []
    const radii: number[] = []
    // The edges no place reads a round on, gathered: one row and its why
    // once, rather than a row each with the same long why — a broad query
    // comes back mostly as those. The why is the same for all of them in
    // one call (the reach given, or widened to its top alike); one that
    // differs keeps its own row.
    let sharp: { edges: number[]; why: string } | null = null
    for (const edge of edges) {
      const index = t.edges.indexOf(edge)
      // Where the edge is, so a row is told by its place as well as its index.
      const mid = edge.fingerprint.mid.map(round4)
      // The reach by default widens by itself; one given caps the radius.
      const read = await readEdgeRound(section, readEdgeOf(edge, t, meshOf(t)), { stations, reach: reach ?? roundReach(shape), shape, widen: reach === undefined })
      const found = read.round ? true : read.radii.length > 0 ? false : null
      const wider = read.reach !== undefined ? { reach: read.reach } : {}
      // Where along the edge each place lies, for the radii beside them.
      const placed = read.stations ? { stations: read.stations.map(({ t, at }) => ({ t, at })) } : {}
      if (read.round) {
        radii.push(read.round.radius)
        const { radius, ...rest } = read.round
        out.push({ edge: index, mid, ...(chamfer ? { chamfer: true, distance: radius } : { round: true, radius }), ...rest, radii: read.radii, ...placed, ...(read.linear ? { linear: read.linear } : {}), ...(read.places ? { places: read.places } : {}), ...wider })
      } else if (read.why && !read.places && read.radii.length > 0 && read.radii.every((r) => r === null) && (sharp === null || sharp.why === read.why)) {
        sharp ??= { edges: [], why: read.why }
        sharp.edges.push(index)
      } else out.push({ edge: index, mid, [chamfer ? 'chamfer' : 'round']: found, why: read.why, ...(read.radii.length > 0 ? { radii: read.radii, ...placed } : {}), ...(read.places ? { places: read.places } : {}), ...wider })
    }
    const sorted = [...radii].sort((a, b) => a - b)
    const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[(sorted.length >> 1) - 1] + sorted[sorted.length >> 1]) / 2
    return {
      body: { id: body.id, name: body.name },
      edges: out,
      ...(sharp ? { sharp } : {}),
      [chamfer ? 'chamfers' : 'rounds']: radii.length,
      ...(median !== null ? { median: round4(median), spread: round4(sorted[sorted.length - 1] - sorted[0]) } : {}),
    }
  },
}
