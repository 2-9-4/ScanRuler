// SPDX-License-Identifier: AGPL-3.0-only
// The comparison of the scan with the bodies, told by where: beside the
// live map's field (liveMap.ts), which face of which body each scan vertex
// lies nearest, so the reading can be grouped by face — and by the feature
// that made the face — and the worst spots named with a place to look. A
// single RMS over the part says that something is off; this says what.

import { hotspots, type Hotspot } from '../../../src/core/deviation/hotspots'
import { FEATURE_DEPTH } from '../../../src/core/deviation/patchKind'
import { identityRigid, rigidApply, type Rigid } from '../../../src/core/deviation/rigid'
import { emptyHit, NominalSurface } from '../../../src/core/deviation/surface'
import type { Vec3 } from '../../../src/core/types'
import type { KernelMesh } from './kernel'
import { sideReader, verticesNearBox, type ScanSide, type SideCounts, type SparseField } from './liveMap'

/** One face of one body, as the scan reads against it. */
export interface FaceReading {
  body: number
  /** The face's hash on the body's mesh — the name its fingerprint goes by. */
  faceHash: number
  /** Scan vertices nearest this face. */
  read: number
  within: number
  sum: number
  sumSq: number
  /** The largest reading outside the body and the largest inside. */
  outside: number
  inside: number
}

/** A place where the scan lies farthest from the bodies. */
export interface WorstSpot {
  vertex: number
  at: Vec3
  value: number
  body: number
  faceHash: number
}

/** A patch of the scan over tolerance (core/deviation/hotspots), told
 *  against the bodies: the face most of it lies nearest, the scan vertex
 *  its extreme reading is at, and a few of its vertices. A patch never
 *  runs off one face onto the next — the face is part of what joins it. */
export interface PatchReading extends Omit<Hotspot, 'members' | 'index'> {
  body: number
  faceHash: number
  vertex: number
  vertices: number[]
}

/** A patch of the scan past the reach of every body — see FarReading:
 *  as a patch over tolerance, but the body is the one nearest its extreme
 *  reading, or null where none lies within the far reach. */
export interface FarPatch extends Omit<PatchReading, 'body' | 'faceHash'> {
  body: number | null
  faceHash: number | null
}

/** The scan the field does not hold: every vertex (in the box, if one)
 *  past the reach of every body, looked for again out to `reach` and told
 *  by side. The field reads the scan against the model and says where the
 *  two differ by a little; this says where there is no model to differ
 *  from. Inside: the scan lies deeper in the bodies than the reach — the
 *  scan is the part's skin, so the model has material there the part has
 *  not: a hole, a pocket, a slot not cut, or a blob the scanner bridged a
 *  hole with. Outside: the scan stands further off the bodies than the
 *  reach — a flange, a boss, a rib not modelled yet, or scan spray. A
 *  vertex past the far reach of every body counts as outside. */
export interface FarReading {
  /** How far past the reach a vertex was still looked for, mm. */
  reach: number
  count: number
  inside: { count: number; patches: FarPatch[]; found: number }
  outside: { count: number; patches: FarPatch[]; found: number }
}

/** How a comparison's patches are asked for. */
export interface PatchRequest {
  /** How many to name, the largest first. */
  count: number
  /** ± mm counted as on the scan; the range by default. */
  tolerance: number
  /** How close two vertices over tolerance have to be to be one patch,
   *  mm; a few point spacings when left out. */
  grain?: number
  /** Only the scan nearest these faces — each body's by their hashes —
   *  gives the patches and the worst spots: one feature's, when the box
   *  round its faces takes in others' too. Every face when left out. */
  faces?: { body: number; hashes: number[] }[]
}

export interface CompareDetail {
  field: SparseField
  faces: FaceReading[]
  spots: WorstSpot[]
  patches: PatchReading[]
  /** How many patches there were in all, how many vertices lay over the
   *  tolerance, and the point spacing they were gathered at. */
  patchesFound: number
  over: number
  spacing: number
  /** The feature patches among all found (core/deviation/patchKind), and
   *  their share of everything past the tolerance. */
  features: { count: number; shareOfExcess: number }
  /** The scan past the reach, when asked for. */
  far?: FarReading
  /** What reading the scan by its side came to, when it was. */
  side?: SideCounts
}

/** How many of a patch's vertices are named. */
const PATCH_VERTICES = 12

/**
 * The bodies' meshes as one surface, with which body and which face each
 * triangle of it belongs to: the surface's closest hit names a triangle,
 * and these say whose it is. The surface's tree sorts its own copy of the
 * triangles, and a hit names a triangle by its place there, not in the
 * meshes: so each triangle is told by a vertex of it. The kernel meshes a
 * body face by face, a vertex on an edge there once for each face, so a
 * vertex lies on one face of one body.
 */
function surfaceOfBodies(bodies: readonly { id: number; mesh: KernelMesh; sheet?: boolean }[]): { surface: NominalSurface; bodyOf: Float64Array; faceOf: Int32Array; sheetOf: Uint8Array | null } | null {
  const kept = bodies.filter((b) => b.mesh.indices.length >= 3)
  if (kept.length === 0) return null
  let vertices = 0
  let corners = 0
  for (const b of kept) {
    vertices += b.mesh.positions.length / 3
    corners += b.mesh.indices.length
  }
  const positions = new Float32Array(vertices * 3)
  const indices = new Uint32Array(corners)
  // A body's id is a float: a piece a step split off goes by its maker's
  // id and a fraction (core/features islandId).
  const vertexBody = new Float64Array(vertices)
  const vertexFace = new Int32Array(vertices).fill(-1)
  const vertexSheet = kept.some((b) => b.sheet) ? new Uint8Array(vertices) : null
  let pv = 0
  let pi = 0
  for (const b of kept) {
    positions.set(b.mesh.positions, pv)
    const base = pv / 3
    for (let i = 0; i < b.mesh.indices.length; i++) indices[pi + i] = b.mesh.indices[i] + base
    vertexBody.fill(b.id, base, base + b.mesh.positions.length / 3)
    if (vertexSheet && b.sheet) vertexSheet.fill(1, base, base + b.mesh.positions.length / 3)
    const hashes = b.mesh.faceHash
    if (hashes) for (let t = 0; t < b.mesh.indices.length / 3; t++) for (let k = 0; k < 3; k++) vertexFace[b.mesh.indices[t * 3 + k] + base] = hashes[t]
    pv += b.mesh.positions.length
    pi += b.mesh.indices.length
  }
  const surface = new NominalSurface(positions, indices)
  // Whose each triangle is, in the order the surface's hits name them.
  const bodyOf = new Float64Array(corners / 3)
  const faceOf = new Int32Array(corners / 3)
  const sheetOf = vertexSheet ? new Uint8Array(corners / 3) : null
  for (let t = 0; t < corners / 3; t++) {
    const v = surface.index[t * 3]
    bodyOf[t] = vertexBody[v]
    faceOf[t] = vertexFace[v]
    if (sheetOf) sheetOf[t] = vertexSheet![v]
  }
  return { surface, bodyOf, faceOf, sheetOf }
}

/**
 * The scan against the bodies, in detail: the field of signed distances
 * for the vertices within `reach`, each vertex's nearest face, and the
 * `spotCount` worst places, no two nearer each other than `apart` — on
 * the faces `patches.faces` names, when it names any. With `side`, each
 * vertex is read by the way it faces (liveMap's ScanSide), and a body that
 * is a sheet (`sheet`) on its front only.
 */
export function compareBodies(
  bodies: readonly { id: number; mesh: KernelMesh; sheet?: boolean }[],
  positions: Float32Array,
  transform: Rigid | null,
  range: number,
  reach: number,
  spotCount: number,
  apart: number,
  patches?: PatchRequest,
  /** Only the scan within this box, in the bodies' frame — the field, the
   *  faces' readings, the spots and the patches all of one region. */
  within?: { min: Vec3; max: Vec3 },
  /** Also gather the scan past the reach — see FarReading — looked for
   *  out to this many mm from the bodies; nothing without it. The patches
   *  are asked for as `patches` says (count, grain), none without it. */
  far?: number,
  side: ScanSide | null = null,
): CompareDetail {
  const empty: CompareDetail = { field: { subset: new Uint32Array(0), values: new Float32Array(0) }, faces: [], spots: [], patches: [], patchesFound: 0, over: 0, spacing: 0, features: { count: 0, shareOfExcess: 0 } }
  const made = surfaceOfBodies(bodies)
  if (!made) return empty
  const { surface, bodyOf, faceOf, sheetOf } = made
  const near = verticesNearBox(positions, transform, surface.bboxMin, surface.bboxMax, reach)
  const reader = sideReader(surface, positions, transform, side, sheetOf, near, range)
  const m = transform ?? identityRigid()
  const hit = emptyHit()
  const p = new Float64Array(3)
  const subset = new Uint32Array(near.length)
  const values = new Float32Array(near.length)
  const faces = new Int32Array(near.length)
  const spotAt = new Float32Array(near.length * 3)
  const inBox = (): boolean => !within || !(p[0] < within.min[0] || p[0] > within.max[0] || p[1] < within.min[1] || p[1] > within.max[1] || p[2] < within.min[2] || p[2] > within.max[2])
  const read = far !== undefined && far > 0 ? new Uint8Array(positions.length / 3) : null
  let w = 0
  for (let i = 0; i < near.length; i++) {
    const v = near[i]
    rigidApply(m, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], p)
    if (!inBox()) continue
    const took = reader.read(v, p, hit, reach, reach)
    // A vertex its side leaves out is not missing from the model: it stays
    // out of the far reading too.
    if (took === 'out' && read) read[v] = 1
    if (took !== 'read') continue
    if (!(Math.abs(hit.signed) <= reach)) continue
    if (read) read[v] = 1
    subset[w] = v
    values[w] = hit.signed
    faces[w] = hit.faceIndex
    spotAt[w * 3] = p[0]
    spotAt[w * 3 + 1] = p[1]
    spotAt[w * 3 + 2] = p[2]
    w++
  }
  // By face: every vertex counted to the face its nearest triangle lies on.
  const rows = new Map<string, FaceReading>()
  for (let i = 0; i < w; i++) {
    const t = faces[i]
    const body = bodyOf[t]
    const faceHash = faceOf[t]
    const key = `${body}:${faceHash}`
    let row = rows.get(key)
    if (!row) {
      row = { body, faceHash, read: 0, within: 0, sum: 0, sumSq: 0, outside: 0, inside: 0 }
      rows.set(key, row)
    }
    const d = values[i]
    row.read++
    if (Math.abs(d) <= range) row.within++
    row.sum += d
    row.sumSq += d * d
    if (d > row.outside) row.outside = d
    if (d < row.inside) row.inside = d
  }
  // The faces the spots and the patches are kept to, if any.
  const kept = patches?.faces ? new Set(patches.faces.flatMap((f) => f.hashes.map((h) => `${f.body}:${h}`))) : null
  const onKept = kept ? (i: number) => kept.has(`${bodyOf[faces[i]]}:${faceOf[faces[i]]}`) : null
  // The worst spots: farthest first, each at least `apart` from the ones
  // before it, so that one bad patch is one spot and not every one of them.
  const order = Array.from({ length: w }, (_, i) => i).sort((a, b) => Math.abs(values[b]) - Math.abs(values[a]))
  const spots: WorstSpot[] = []
  const apart2 = apart * apart
  for (const i of order) {
    if (spots.length >= spotCount) break
    if (onKept && !onKept(i)) continue
    const x = spotAt[i * 3], y = spotAt[i * 3 + 1], z = spotAt[i * 3 + 2]
    let crowded = false
    for (const s of spots) {
      const dx = s.at[0] - x, dy = s.at[1] - y, dz = s.at[2] - z
      if (dx * dx + dy * dy + dz * dz < apart2) {
        crowded = true
        break
      }
    }
    if (crowded) continue
    spots.push({ vertex: subset[i], at: [x, y, z], value: values[i], body: bodyOf[faces[i]], faceHash: faceOf[faces[i]] })
  }
  // The patches over tolerance, each on one face: the face is part of the
  // key that joins vertices, so a patch never runs round a corner. Counted
  // when none is to be named too: how many there are, and how much of the
  // scan is over, is the score either way.
  const found: PatchReading[] = []
  let patchesFound = 0
  let over = 0
  let spacing = 0
  let features = { count: 0, shareOfExcess: 0 }
  if (patches) {
    const keys = new Map<string, number>()
    const keyOf = (i: number) => {
      const t = faces[i]
      const k = `${bodyOf[t]}:${faceOf[t]}`
      let n = keys.get(k)
      if (n === undefined) keys.set(k, (n = keys.size))
      return n
    }
    const report = hotspots(spotAt.subarray(0, w * 3), values.subarray(0, w), patches.tolerance, { limit: Math.max(0, patches.count), grain: patches.grain, group: keyOf, ...(onKept ? { only: onKept } : {}) })
    patchesFound = report.found
    over = report.over
    spacing = report.spacing
    features = report.features
    for (const p of report.patches) {
      const { members, index, ...rest } = p
      const t = faces[index]
      const stride = Math.max(1, Math.floor(members.length / PATCH_VERTICES))
      const vertices: number[] = []
      for (let k = 0; k < members.length && vertices.length < PATCH_VERTICES; k += stride) vertices.push(subset[members[k]])
      found.push({ ...rest, body: bodyOf[t], faceHash: faceOf[t], vertex: subset[index], vertices })
    }
  }
  // The scan the field does not hold, looked for again out to the far
  // reach. A vertex outside the bodies' box by more than that is outside
  // without asking; one inside the box is asked, capped at the far reach,
  // which keeps a vertex far from everything from opening the whole tree.
  let farReading: FarReading | undefined
  if (read && far !== undefined && far > 0) {
    const n = positions.length / 3
    const farSubset = new Uint32Array(n)
    const farValues = new Float32Array(n)
    const farFaces = new Int32Array(n)
    const farAt = new Float32Array(n * 3)
    const x0 = surface.bboxMin[0] - far, y0 = surface.bboxMin[1] - far, z0 = surface.bboxMin[2] - far
    const x1 = surface.bboxMax[0] + far, y1 = surface.bboxMax[1] + far, z1 = surface.bboxMax[2] + far
    let f = 0
    for (let v = 0; v < n; v++) {
      if (read[v]) continue
      rigidApply(m, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], p)
      if (!inBox()) continue
      let value = far
      let face = -1
      const nearBox = !(p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1 || p[2] < z0 || p[2] > z1)
      if (nearBox && surface.closest(p[0], p[1], p[2], hit, far) && Math.abs(hit.signed) <= far) {
        if (!reader.keepsFar(v, hit)) continue
        value = hit.signed
        face = hit.faceIndex
      }
      farSubset[f] = v
      farValues[f] = value
      farFaces[f] = face
      farAt[f * 3] = p[0]
      farAt[f * 3 + 1] = p[1]
      farAt[f * 3 + 2] = p[2]
      f++
    }
    const side = (inside: boolean) => {
      const want = (i: number) => (farValues[i] < 0) === inside
      let count = 0
      for (let i = 0; i < f; i++) if (want(i)) count++
      if (!patches || count === 0) return { count, patches: [], found: 0 }
      // Everything here is past the reach: a tolerance of nothing keeps
      // every vertex, and the sign keeps the sides apart. A feature here is
      // as deep as one over the tolerance has to be, not as deep as nothing.
      const report = hotspots(farAt.subarray(0, f * 3), farValues.subarray(0, f), 0, { limit: Math.max(0, patches.count), grain: patches.grain, featureDepth: FEATURE_DEPTH * patches.tolerance, only: want })
      const list: FarPatch[] = report.patches.map((h) => {
        const { members, index, ...rest } = h
        const t = farFaces[index]
        const stride = Math.max(1, Math.floor(members.length / PATCH_VERTICES))
        const vertices: number[] = []
        for (let k = 0; k < members.length && vertices.length < PATCH_VERTICES; k += stride) vertices.push(farSubset[members[k]])
        return { ...rest, body: t >= 0 ? bodyOf[t] : null, faceHash: t >= 0 ? faceOf[t] : null, vertex: farSubset[index], vertices }
      })
      return { count, patches: list, found: report.found }
    }
    farReading = { reach: far, count: f, inside: side(true), outside: side(false) }
  }
  return { field: { subset: subset.slice(0, w), values: values.slice(0, w) }, faces: [...rows.values()], spots, patches: found, patchesFound, over, spacing, features, ...(farReading ? { far: farReading } : {}), ...(side ? { side: reader.counts } : {}) }
}
