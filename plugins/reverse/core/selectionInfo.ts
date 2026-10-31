// SPDX-License-Identifier: AGPL-3.0-only
// What the part says about what was clicked on it: a face's area and
// normal, an edge's length, a corner's coordinates — and, with two things
// picked, what lies between them: the distance between two corners, from a
// corner to an edge or a face, between parallel faces or edges, the angle
// between those that are not. The measuring a CAD program's Inspect does,
// read off the bodies' own topology (build.ts), in the part's coordinates.
// Plain data in, rows of text out: the chips by the click show them.

import { type DisplayUnits, fmtArea, fmtLen } from '../../../src/core/units'
import type { Vec3 } from '../../../src/core/types'
import { add, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { EdgeInfo, FaceInfo } from './build'

/** One thing picked on a body: a face, an edge, or a corner — an end of
 *  an edge. */
export type PickedItem =
  | { type: 'face'; bodyId: number; face: FaceInfo; edges: EdgeInfo[] }
  | { type: 'edge'; bodyId: number; edge: EdgeInfo }
  | { type: 'vertex'; bodyId: number; point: Vec3 }

export interface InfoRow {
  label: string
  value: string
}

export interface SelectionInfo {
  title: string
  rows: InfoRow[]
}

/** What tells two picks apart: the body and the face's or edge's hash, a
 *  corner's place to a micron. */
export function itemKey(i: PickedItem): string {
  if (i.type === 'face') return `f:${i.bodyId}:${i.face.hash}`
  if (i.type === 'edge') return `e:${i.bodyId}:${i.edge.hash}`
  return `v:${i.bodyId}:${i.point.map((c) => Math.round(c * 1000)).join(',')}`
}

/** The figures a row reads, in the units shown: lengths and coordinates to a
 *  micron in millimetres (inches get their own decimals), areas to a
 *  hundredth of a square millimetre. */
function wordsIn(units: DisplayUnits) {
  return {
    mm: (v: number) => fmtLen(v, units, 3),
    area: (v: number) => fmtArea(v, units, 2),
    xyz: (p: Vec3) => p.map((c) => fmtLen(c, units, 3, { bare: true })).join(', '),
  }
}
type Words = ReturnType<typeof wordsIn>
const deg = (v: number) => `${v.toFixed(2)}°`
/** A direction with its noise put away: −0.000 reads as 0.000. */
const unit = (d: Vec3) => d.map((c) => (Math.abs(c) < 5e-4 ? 0 : c).toFixed(3)).join(', ')

/** Parallel within a twentieth of a degree — what a modelled part is, and
 *  a lofted or drafted one is not. */
const PARALLEL = Math.cos((0.05 * Math.PI) / 180)

/** The centre of a round edge, off three of its drawn points — the
 *  fingerprint carries the radius and the axis but not the centre. */
export function circleCentre(edge: EdgeInfo): Vec3 | null {
  const p = edge.polyline
  const n = Math.floor(p.length / 3)
  if (n < 3) return null
  const at = (i: number): Vec3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
  const a = at(0)
  const b = at(Math.floor(n / 3))
  const c = at(Math.floor((2 * n) / 3))
  const ab = sub(b, a)
  const ac = sub(c, a)
  const nrm = cross(ab, ac)
  const n2 = dot(nrm, nrm)
  if (n2 < 1e-18) return null
  // The circumcentre of the triangle a, b, c.
  const t = add(scale(cross(nrm, ab), dot(ac, ac)), scale(cross(ac, nrm), dot(ab, ab)))
  return add(a, scale(t, 1 / (2 * n2)))
}

/** A straight carrier a pick stands for: a line edge, or the axis of a round
 *  face or a round edge. */
function lineOf(i: PickedItem): { point: Vec3; dir: Vec3; axis: boolean } | null {
  if (i.type === 'edge') {
    const f = i.edge.fingerprint
    if (f.kind === 'line') return { point: f.mid, dir: normalize(f.dir) ?? [0, 0, 1], axis: false }
    if (f.kind === 'circle') {
      const c = circleCentre(i.edge)
      const d = normalize(f.dir)
      return c && d ? { point: c, dir: d, axis: true } : null
    }
    return null
  }
  if (i.type === 'face') {
    const f = i.face.fingerprint
    const d = normalize(f.dir)
    if ((f.kind === 'cylinder' || f.kind === 'cone') && f.center && d) return { point: f.center, dir: d, axis: true }
  }
  return null
}

function planeOf(i: PickedItem): { point: Vec3; normal: Vec3 } | null {
  if (i.type !== 'face' || i.face.fingerprint.kind !== 'plane') return null
  const n = normalize(i.face.fingerprint.dir)
  return n ? { point: i.face.fingerprint.centroid, normal: n } : null
}

function pointOf(i: PickedItem): Vec3 | null {
  if (i.type === 'vertex') return i.point
  // A sphere stands for its centre.
  if (i.type === 'face' && i.face.fingerprint.kind === 'sphere' && i.face.fingerprint.center) return i.face.fingerprint.center
  return null
}

const pointToLine = (p: Vec3, l: { point: Vec3; dir: Vec3 }) => {
  const w = sub(p, l.point)
  return len(sub(w, scale(l.dir, dot(w, l.dir))))
}

function nameOf(i: PickedItem): string {
  if (i.type === 'vertex') return 'Point'
  if (i.type === 'edge') return i.edge.fingerprint.kind === 'line' ? 'Straight edge' : i.edge.fingerprint.kind === 'circle' ? 'Round edge' : 'Edge'
  const k = i.face.fingerprint.kind
  return k === 'plane' ? 'Flat face' : k === 'cylinder' ? 'Cylindrical face' : k === 'cone' ? 'Conical face' : k === 'sphere' ? 'Spherical face' : k === 'torus' ? 'Toroidal face' : 'Freeform face'
}

function single(i: PickedItem, w: Words): InfoRow[] {
  if (i.type === 'vertex') return [{ label: 'X', value: w.mm(i.point[0]) }, { label: 'Y', value: w.mm(i.point[1]) }, { label: 'Z', value: w.mm(i.point[2]) }]
  if (i.type === 'edge') {
    const f = i.edge.fingerprint
    const rows: InfoRow[] = [{ label: 'Length', value: w.mm(f.length) }]
    if (f.kind === 'line') {
      rows.push({ label: 'Direction', value: unit(normalize(f.dir) ?? f.dir) })
      rows.push({ label: 'From', value: w.xyz(i.edge.ends[0]) }, { label: 'To', value: w.xyz(i.edge.ends[1]) })
    } else if (f.kind === 'circle' && f.radius !== undefined) {
      rows.push({ label: 'Radius', value: w.mm(f.radius) }, { label: 'Diameter', value: w.mm(2 * f.radius) })
      const c = circleCentre(i.edge)
      if (c) rows.push({ label: 'Centre', value: w.xyz(c) })
      rows.push({ label: 'Axis', value: unit(normalize(f.dir) ?? f.dir) })
    } else rows.push({ label: 'Middle', value: w.xyz(f.mid) })
    return rows
  }
  const f = i.face.fingerprint
  const rows: InfoRow[] = [{ label: 'Area', value: w.area(f.area) }]
  if (f.kind === 'plane') rows.push({ label: 'Normal', value: unit(normalize(f.dir) ?? f.dir) }, { label: 'Centre', value: w.xyz(f.centroid) })
  else {
    if (f.radius !== undefined) rows.push({ label: 'Radius', value: w.mm(f.radius) }, { label: 'Diameter', value: w.mm(2 * f.radius) })
    if (f.kind === 'sphere' && f.center) rows.push({ label: 'Centre', value: w.xyz(f.center) })
    else if (f.kind === 'cylinder' || f.kind === 'cone' || f.kind === 'torus') rows.push({ label: 'Axis', value: unit(normalize(f.dir) ?? f.dir) })
    if ((f.kind === 'cylinder' || f.kind === 'cone') && f.center) rows.push({ label: 'On axis', value: w.xyz(f.center) })
  }
  return rows
}

/** What lies between two picks, or nothing the part can say. */
function between(a: PickedItem, b: PickedItem, w: Words): InfoRow[] {
  const pa = pointOf(a)
  const pb = pointOf(b)
  if (pa && pb) {
    const d = sub(pb, pa)
    return [
      { label: 'Distance', value: w.mm(len(d)) },
      { label: 'ΔX', value: w.mm(Math.abs(d[0])) },
      { label: 'ΔY', value: w.mm(Math.abs(d[1])) },
      { label: 'ΔZ', value: w.mm(Math.abs(d[2])) },
    ]
  }
  // A point against a plane or a line.
  const point = pa ?? pb
  const other = pa ? b : a
  if (point) {
    const plane = planeOf(other)
    if (plane) return [{ label: 'Distance to the face', value: w.mm(Math.abs(dot(sub(point, plane.point), plane.normal))) }]
    const line = lineOf(other)
    if (line) return [{ label: line.axis ? 'Distance to the axis' : 'Distance to the edge', value: w.mm(pointToLine(point, line)) }]
    return []
  }
  const planeA = planeOf(a)
  const planeB = planeOf(b)
  if (planeA && planeB) {
    const c = Math.abs(dot(planeA.normal, planeB.normal))
    if (c >= PARALLEL) return [{ label: 'Distance', value: w.mm(Math.abs(dot(sub(planeB.point, planeA.point), planeA.normal))) }, { label: 'Angle', value: 'parallel' }]
    return [{ label: 'Angle', value: deg((Math.acos(Math.min(1, c)) * 180) / Math.PI) }]
  }
  const lineA = lineOf(a)
  const lineB = lineOf(b)
  const plane = planeA ?? planeB
  const line = planeA ? lineB : planeB ? lineA : null
  if (plane && line) {
    const s = Math.abs(dot(line.dir, plane.normal))
    // Along the face: a distance. Across it: the angle the line leaves it at.
    if (s <= Math.sin((0.05 * Math.PI) / 180)) return [{ label: 'Distance', value: w.mm(Math.abs(dot(sub(line.point, plane.point), plane.normal))) }, { label: 'Angle', value: 'parallel' }]
    return [{ label: 'Angle to the face', value: deg((Math.asin(Math.min(1, s)) * 180) / Math.PI) }]
  }
  if (lineA && lineB) {
    const c = Math.abs(dot(lineA.dir, lineB.dir))
    const word = lineA.axis && lineB.axis ? 'Distance between the axes' : 'Distance'
    if (c >= PARALLEL) return [{ label: word, value: w.mm(pointToLine(lineB.point, lineA)) }, { label: 'Angle', value: 'parallel' }]
    // Askew or crossing: the angle, and how far apart they pass.
    const n = normalize(cross(lineA.dir, lineB.dir))
    const gap = n ? Math.abs(dot(sub(lineB.point, lineA.point), n)) : 0
    return [{ label: 'Angle', value: deg((Math.acos(Math.min(1, c)) * 180) / Math.PI) }, { label: gap < 1e-6 ? 'They cross' : 'Closest', value: gap < 1e-6 ? 'in one point' : w.mm(gap) }]
  }
  return []
}

/** The rows for what is picked: one thing in full; two, each in a line and
 *  what lies between them; more, the sums. */
export function selectionInfo(items: readonly PickedItem[], units: DisplayUnits = 'mm'): SelectionInfo | null {
  const w = wordsIn(units)
  if (items.length === 0) return null
  if (items.length === 1) return { title: nameOf(items[0]), rows: single(items[0], w) }
  const edges = items.filter((i): i is Extract<PickedItem, { type: 'edge' }> => i.type === 'edge')
  const faces = items.filter((i): i is Extract<PickedItem, { type: 'face' }> => i.type === 'face')
  const points = items.filter((i) => i.type === 'vertex')
  const count = [faces.length ? `${faces.length} face${faces.length === 1 ? '' : 's'}` : '', edges.length ? `${edges.length} edge${edges.length === 1 ? '' : 's'}` : '', points.length ? `${points.length} point${points.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
  const rows: InfoRow[] = []
  if (items.length === 2) rows.push(...between(items[0], items[1], w))
  if (edges.length > 1 || (edges.length === 1 && items.length > 2)) rows.push({ label: 'Length, together', value: w.mm(edges.reduce((s, e) => s + e.edge.fingerprint.length, 0)) })
  else if (edges.length === 1) rows.push({ label: 'Edge length', value: w.mm(edges[0].edge.fingerprint.length) })
  if (faces.length > 1 || (faces.length === 1 && items.length > 2)) rows.push({ label: 'Area, together', value: w.area(faces.reduce((s, f) => s + f.face.fingerprint.area, 0)) })
  else if (faces.length === 1) rows.push({ label: 'Face area', value: w.area(faces[0].face.fingerprint.area) })
  return { title: count, rows }
}
