// SPDX-License-Identifier: AGPL-3.0-only
// One feature checked against the scan, in one call — reverse.body.compare
// { feature }: the scan read only about the faces the feature made, the
// patches on those faces, the far readings near them, the feature's numbers
// fitted to the scan as it stands now beside the numbers it holds, and on
// request a picture of a section through its middle. What an agent did
// with a compare, a describe and a render for every feature.

import { pictureOfSheet, sheetThrough } from '../../../src/commands/core/section'
import { round3, round4 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { cross, dot, normalize, sub } from '../../../src/core/vec'
import { CommandError } from '../../../src/plugins/api'
import type { Feature } from '../core/features'
import { liveMapReach } from '../core/liveMap'
import { resolvePlaneFrame } from '../core/resolve'
import type { FaceInfo } from '../core/build'
import { featureNamed, type Json, re, type Ref } from './reCommandCore'
import { asksFit, FIT, resolveFits } from './reFit'
import type { ReverseSession } from './reSession'

/** The fields of a feature that can be fitted, as "fit" asks for them. */
function fitAsk(f: Feature): { field: string; input: Json; now: number } | null {
  if (f.kind === 'fillet' && f.edges.length > 0) return { field: 'radius', input: { radius: FIT }, now: f.radius }
  if (f.kind === 'chamfer' && (f.mode === undefined || f.mode === 'equal')) return { field: 'distance', input: { distance: FIT }, now: f.distance }
  if (f.kind === 'draft') return { field: 'angleDeg', input: { angleDeg: FIT }, now: f.angleDeg }
  if (f.kind === 'extrude' && f.extent.kind === 'distance' && f.sketchId > 0) return { field: 'extent.to', input: { extent: { kind: 'toScan', from: f.extent.from, near: f.extent.to } }, now: f.extent.to }
  return null
}

/** The feature's numbers against the scan now: each one as it stands, the
 *  scan's reading of it with its sigma, and how far apart in sigmas. */
async function numbersOf(s: ReverseSession, f: Feature): Promise<Json | null> {
  const ask = fitAsk(f)
  if (!ask || !asksFit(f.kind, ask.input)) return null
  try {
    const { fitted } = await resolveFits(s, f.kind, ask.input, f)
    const r = fitted[ask.field]
    const off = r.value - ask.now
    return { [ask.field]: { feature: ask.now, scan: r.value, sigma: r.sigma, off: round4(off), sigmas: r.sigma ? round3(Math.abs(off) / r.sigma) : null, nominal: r.nominal, points: r.points } }
  } catch (e) {
    return { [ask.field]: { feature: ask.now, error: e instanceof Error ? e.message : String(e) } }
  }
}

/** The faces a feature made, on every body that holds any, by hash. */
export function facesMadeBy(s: ReverseSession, id: number): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>()
  for (const b of re().bodies) {
    const t = s.topologies.get(b.id)
    if (!t) continue
    const hashes = new Set(t.faces.filter((f) => f.fingerprint.origin === id).map((f) => f.hash))
    if (hashes.size > 0) out.set(b.id, hashes)
  }
  return out
}

/** The box round those faces, from the bodies' meshes. */
export function boxOfFaces(s: ReverseSession, made: Map<number, Set<number>>): { min: Vec3; max: Vec3 } | null {
  let lo: Vec3 = [Infinity, Infinity, Infinity]
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const [body, hashes] of made) {
    const m = s.meshes.get(body)
    if (!m || !m.faceHash) continue
    for (let t = 0; t < m.faceHash.length; t++) {
      if (!hashes.has(m.faceHash[t])) continue
      for (let k = 0; k < 3; k++) {
        const v = m.indices[t * 3 + k] * 3
        lo = [Math.min(lo[0], m.positions[v]), Math.min(lo[1], m.positions[v + 1]), Math.min(lo[2], m.positions[v + 2])]
        hi = [Math.max(hi[0], m.positions[v]), Math.max(hi[1], m.positions[v + 1]), Math.max(hi[2], m.positions[v + 2])]
      }
    }
  }
  return Number.isFinite(lo[0]) ? { min: lo, max: hi } : null
}

/** A place of a feature: faces of it on one body that join each other
 *  edge to edge — a rib on either side of a part is two. */
interface Place {
  body: number
  hashes: Set<number>
  faces: FaceInfo[]
  area: number
  centroid: Vec3
}

/** The feature's faces gathered into its places, the largest first. */
function placesOf(s: ReverseSession, made: Map<number, Set<number>>): Place[] {
  const out: Place[] = []
  for (const [body, hashes] of made) {
    const t = s.topologies.get(body)
    if (!t) continue
    const faces = t.faces.filter((f) => hashes.has(f.hash))
    const parent = new Map(faces.map((f) => [f.hash, f.hash]))
    const root = (h: number): number => {
      const p = parent.get(h)!
      if (p === h) return h
      const r = root(p)
      parent.set(h, r)
      return r
    }
    for (const e of t.edges) {
      const mine = e.faces.filter((h) => hashes.has(h))
      for (let i = 1; i < mine.length; i++) parent.set(root(mine[i]), root(mine[0]))
    }
    const groups = new Map<number, FaceInfo[]>()
    for (const f of faces) (groups.get(root(f.hash)) ?? groups.set(root(f.hash), []).get(root(f.hash))!).push(f)
    for (const g of groups.values()) {
      const area = g.reduce((a, f) => a + f.fingerprint.area, 0)
      const centroid = [0, 1, 2].map((k) => g.reduce((a, f) => a + f.fingerprint.centroid[k] * f.fingerprint.area, 0) / (area || 1)) as Vec3
      out.push({ body, hashes: new Set(g.map((f) => f.hash)), faces: g, area, centroid })
    }
  }
  return out.sort((a, b) => b.area - a.area)
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The longest way across a face in its own plane: the main axis of its
 *  area — the second moments of its mesh's triangles — null with no mesh. */
function lengthwise(s: ReverseSession, body: number, face: FaceInfo, normal: Vec3): Vec3 | null {
  const m = s.meshes.get(body)
  if (!m || !m.faceHash) return null
  const u = normalize(cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
  if (!u) return null
  const v = cross(normal, u)
  // ∫ over the area of 1, x, y, x², y², xy: a triangle's are A, A·centroid
  // and A/12 (a a + b b + c c + s s), s the sum of its corners.
  let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
  const at = (i: number): [number, number] => {
    const p: Vec3 = [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]
    return [dot(p, u), dot(p, v)]
  }
  for (let t = 0; t < m.faceHash.length; t++) {
    if (m.faceHash[t] !== face.hash) continue
    const [a, b, c] = [0, 1, 2].map((k) => at(m.indices[t * 3 + k]))
    const A = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
    const S = [a[0] + b[0] + c[0], a[1] + b[1] + c[1]]
    area += A
    sx += (A * S[0]) / 3
    sy += (A * S[1]) / 3
    sxx += (A / 12) * (a[0] * a[0] + b[0] * b[0] + c[0] * c[0] + S[0] * S[0])
    syy += (A / 12) * (a[1] * a[1] + b[1] * b[1] + c[1] * c[1] + S[1] * S[1])
    sxy += (A / 12) * (a[0] * a[1] + b[0] * b[1] + c[0] * c[1] + S[0] * S[1])
  }
  if (!(area > 0)) return null
  const suu = sxx - (sx * sx) / area
  const svv = syy - (sy * sy) / area
  const suv = sxy - (sx * sy) / area
  // The larger eigenvector of the 2 × 2 moment.
  const angle = 0.5 * Math.atan2(2 * suv, suu - svv)
  return normalize([u[0] * Math.cos(angle) + v[0] * Math.sin(angle), u[1] * Math.cos(angle) + v[1] * Math.sin(angle), u[2] * Math.cos(angle) + v[2] * Math.sin(angle)])
}

/** A plane that cuts across the feature at a place of it: square to a
 *  round's or a chamfer's edge (the one nearest `at`, else the middle
 *  one), through a drafted face along its pull, or through the middle of
 *  the place's largest face — a flat face cut across its length, the cut
 *  standing on it; a round face through its axis. */
function planeAcross(s: ReverseSession, f: Feature, place: Place, at?: Vec3): { origin: Vec3; normal: Vec3 } {
  if ((f.kind === 'fillet' || f.kind === 'chamfer') && f.edges.length > 0) {
    const lines = f.edges.filter((e) => e.kind === 'line')
    const middle = f.edges[Math.floor(f.edges.length / 2)]
    const e = at ? [...lines].sort((a, b) => distance(a.mid, at) - distance(b.mid, at))[0] : lines.includes(middle) ? middle : lines[0]
    const n = e ? normalize(e.dir) : null
    if (e && n) return { origin: e.mid, normal: n }
  }
  if (f.kind === 'draft' && f.faces.length > 0) {
    const face = at ? [...f.faces].sort((a, b) => distance(a.centroid, at) - distance(b.centroid, at))[0] : f.faces[0]
    const pull = f.neutral.kind === 'face' ? f.neutral.face.dir : (resolvePlaneFrame(f.neutral, s.resolveContext())?.normal ?? null)
    const n = pull ? normalize(cross(face.dir, pull)) : null
    if (n) return { origin: face.centroid, normal: n }
  }
  const largest = [...place.faces].sort((a, b) => b.fingerprint.area - a.fingerprint.area)[0]
  const fp = largest.fingerprint
  const axis = normalize(fp.dir) ?? ([0, 0, 1] as Vec3)
  if (fp.kind === 'plane') {
    const along = lengthwise(s, place.body, largest, axis)
    if (along) return { origin: fp.centroid, normal: along }
  }
  // A round face: a plane through its axis.
  const k = [0, 1, 2].reduce((a, i) => (Math.abs(axis[i]) < Math.abs(axis[a]) ? i : a), 0)
  const n = normalize(cross(axis, [0, 1, 2].map((i) => (i === k ? 1 : 0)) as Vec3)) ?? ([1, 0, 0] as Vec3)
  return { origin: fp.center ?? fp.centroid, normal: n }
}

/** Where a feature's picture cuts it: its places, the one cut — the
 *  largest, or the one nearest `at` — and the plane across it there. */
export function featureCut(s: ReverseSession, f: Feature, at?: Vec3): { places: Place[]; place: Place; plane: { origin: Vec3; normal: Vec3 } } {
  const places = placesOf(s, facesMadeBy(s, f.id))
  if (places.length === 0) throw new CommandError('invalid_state', `${f.name} made no face on a body as the part stands.`)
  const place = at ? [...places].sort((a, b) => distance(a.centroid, at) - distance(b.centroid, at))[0] : places[0]
  return { places, place, plane: planeAcross(s, f, place, at) }
}

/** reverse.body.compare { feature }: see the command's description. */
export async function compareFeature(
  s: ReverseSession,
  ref: Ref,
  options: { range: number; tolerance?: number; far: number; picture: boolean; spots: number; faces: number; patches: number; grain?: number; at?: Vec3 },
  /** The bodies against the scan in a box, the patches and the worst
   *  spots kept to the faces named — as many as asked, the far patches
   *  as many a side. */
  compareIn: (bodyIds: number[], box: { min: Vec3; max: Vec3 }, ask: { faces: { body: number; hashes: number[] }[]; patches: number; spots: number }) => Promise<Json>,
): Promise<Json> {
  const f = featureNamed(ref)
  const made = facesMadeBy(s, f.id)
  if (made.size === 0) throw new CommandError('invalid_state', `${f.name} made no face on a body as the part stands — a sketch, a feature rolled back or suppressed, or one whose faces later features took away.`)
  const faceBox = boxOfFaces(s, made)
  if (!faceBox) throw new CommandError('failed', `The faces ${f.name} made have no mesh to read the scan about.`)
  const pad = liveMapReach(options.range) + 1
  const box = { min: faceBox.min.map((v) => v - pad) as Vec3, max: faceBox.max.map((v) => v + pad) as Vec3 }
  const all = await compareIn([...made.keys()], box, { faces: [...made].map(([body, hashes]) => ({ body, hashes: [...hashes] })), patches: options.patches, spots: options.spots })
  // Only what lies on the feature's own faces — each named without the
  // feature, which the answer names once.
  const mine = (face: unknown) => (face as { madeBy?: { id: number } } | null)?.madeBy?.id === f.id
  const own = (row: Json): Json => {
    const face = row.face as Json | null
    if (!face || !mine(face)) return row
    const { madeBy: _m, ...rest } = face
    void _m
    return { ...row, face: rest }
  }
  const rows = ((all.faces as Json[]) ?? []).filter((r) => mine(r.face))
  const read = rows.reduce((a, r) => a + (r.read as number), 0)
  const within = rows.reduce((a, r) => a + (r.within as number), 0)
  const patches = ((all.patches as Json[]) ?? []).filter((p) => mine(p.face)).map(own)
  const worst = ((all.worst as Json[]) ?? []).filter((p) => mine(p.face)).map(own)
  const far = all.far as Json | undefined
  const numbers = await numbersOf(s, f)
  const answer: Json = {
    feature: { id: f.id, name: f.name, kind: f.kind },
    bodies: all.bodies,
    box: { min: faceBox.min.map(round3), max: faceBox.max.map(round3) },
    range: all.range,
    faces: rows.length,
    read,
    within,
    mean: read > 0 ? round4(rows.reduce((a, r) => a + (r.mean as number) * (r.read as number), 0) / read) : null,
    rms: read > 0 ? round4(Math.sqrt(rows.reduce((a, r) => a + (r.rms as number) ** 2 * (r.read as number), 0) / read)) : null,
    outside: rows.length > 0 ? Math.max(...rows.map((r) => r.outside as number)) : null,
    inside: rows.length > 0 ? Math.min(...rows.map((r) => r.inside as number)) : null,
    patches,
    patchesFound: all.patchesFound,
    ...(all.features ? { features: all.features } : {}),
    over: all.over,
    tolerance: all.tolerance,
    ...(all.side ? { side: all.side } : {}),
    ...(options.spots > 0 ? { worst } : {}),
    ...(far ? { far } : {}),
    ...(numbers ? { numbers } : {}),
    faceRows: rows.slice(0, options.faces).map(own),
  }
  if (!options.picture) return answer
  const { places, place, plane } = featureCut(s, f, options.at)
  const { sheet, flat } = await sheetThrough(plane.origin, plane.normal, `${f.name} across`)
  // Framed on the place: its faces' box laid on the sheet, with room.
  const placeBox = boxOfFaces(s, new Map([[place.body, place.hashes]])) ?? faceBox
  const corners: Vec3[] = []
  for (const x of [placeBox.min[0], placeBox.max[0]]) for (const y of [placeBox.min[1], placeBox.max[1]]) for (const z of [placeBox.min[2], placeBox.max[2]]) corners.push([x, y, z])
  const us = corners.map((c) => dot(sub(c, sheet.origin), sheet.basisU))
  const vs = corners.map((c) => dot(sub(c, sheet.origin), sheet.basisV))
  const size = Math.max(4, 1.4 * Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)))
  const at: [number, number] = [(Math.max(...us) + Math.min(...us)) / 2, (Math.max(...vs) + Math.min(...vs)) / 2]
  const picture = await pictureOfSheet(sheet, flat, { frame: { at, size }, tolerance: options.tolerance ?? options.range, name: `${f.name} across` })
  const where =
    places.length > 1
      ? {
          places: places.map((p) => ({ at: p.centroid.map(round3), faces: p.faces.length, area: round3(p.area) })),
          cut: places.indexOf(place),
          note: `${f.name} lies in ${places.length} places; the picture cuts ${options.at ? 'the one nearest at' : 'the largest'} (places[${places.indexOf(place)}]) — at: [x, y, z] cuts another.`,
        }
      : {}
  return { ...answer, picture: { plane: { origin: plane.origin.map(round4), normal: plane.normal.map(round4) }, map: picture.map, gap: picture.gap, ...where }, file: picture.file }
}
