// SPDX-License-Identifier: AGPL-3.0-only
// Trim to scan: a body modelled to mend a broken part, cut to fit the scanned
// break — the missing piece, to print and glue in.
//
// The piece's outside is easy CAD; the fracture it has to meet is far too
// rough to model. So the body is modelled to the part's nominal shape and
// made a few millimetres too long at the break, overlapping the material
// still there, and cut here with the fracture itself.
//
// Not by taking the scan out of the body: that works only where the body
// lies inside the part over the whole overlap. Wherever the CAD is larger
// than the part — and a model of a worn or warped part is, somewhere — a skin
// of the body is left round the outside of the part, flaps a few hundredths
// thick all along the joint. The body is cut by the break alone, so its own
// skins never take part, and a mismatch between CAD and part shows only as a
// small step at the joint.
//
// The break is found (core/breakSurface), carried on past the body
// (core/extendRim) and thickened to each side into a thin closed slab
// (core/offset) — Manifold cuts only with closed solids. The body minus the
// slab falls into pieces; those on the side the break's normals point to — a
// scan's point out of the material, towards the missing piece — are kept.
// Their face cut by the slab, the mating face, is the fracture moved the
// offset off it, away from the part: 0 to cut on the break, a tenth or two
// to leave room for glue. A slab is never thinner than 0.02 mm, so an offset
// of 0 sits a hundredth off.
//
// The slab's skins are told apart through the boolean by a vertex property
// — +1 on the front skin, −1 on the back, 0 on the body — which Manifold
// carries along every cut, so each piece says which side of the slab it lies
// on, and which of its triangles are the mating face. A value in between is
// the slab's rim wall, left inside the body: the break did not get out of it.
//
// The mating face is then read against the part: how far each of its points
// is from the scan, less the offset — where it lies over the break itself.
// Past the break's rim it lies over the extension, which stands in for the
// last of the fracture and for none of it past the part's skins; a point
// whose nearest point on the break is on the rim is left unread. Read
// against the scan, not the break: by the part's skins the scan goes on
// where the break stops, and a distance to the edge of an open surface is
// no gap to anything.

import type { Manifold, ManifoldToplevel, Mesh } from 'manifold-3d'
import { NominalSurface, emptyHit } from '../../../src/core/deviation/surface'
import type { Triangles } from './boolean'
import type { DistanceSurface } from './hollow'
import { defaultBreakSpeck, findBreak, type BreakReport } from './breakSurface'
import { extendRim, type ExtendReport } from './extendRim'
import { MAX_STRETCH, thickenMesh } from './offset'

export interface TrimSettings {
  /** How much deeper in the body than its surface the scan must lie to be
   *  break, mm (core/breakSurface). */
  depth: number
  /** How far the piece's mating face sits off the break, mm — 0 cuts on it. */
  offset: number
  /** Keep what is on the other side of the break. */
  flip: boolean
  /** The break as marked — only these vertices of the scan; absent, the
   *  break as found. */
  marked?: Uint32Array | null
}

export interface TrimReport {
  offset: number
  /** The slab's thickness, mm: twice the offset, 0.02 at the least. */
  slab: number
  break: BreakReport
  extend: ExtendReport
  /** Pieces kept and their volume, mm³; pieces on the other side of the
   *  break, and specks, dropped. */
  pieces: number
  volume: number
  dropped: number
  specks: number
  /** The kept pieces' face cut by the break, mm². */
  matingArea: number
  bodyVolume: number
  /** How far the mating face is from the break, less the offset, mm, where
   *  it lies over the break — positive further off: the least, the most,
   *  the median and the 5th and 95th percentiles, and how many points were
   *  read. Null with none over the break. */
  fit: GapSpread | null
}

export interface GapSpread {
  min: number
  p05: number
  median: number
  p95: number
  max: number
  measured: number
}

export interface TrimmedPiece {
  /** The piece, welded and closed, in the body's frame — the scan's. */
  positions: Float32Array
  indices: Uint32Array
  /** 1 for each triangle of the mating face. */
  mating: Uint8Array
  /** At each of the piece's vertices on the mating face over the break, how
   *  far it is from the break less the offset, mm; NaN at every other. */
  gap: Float32Array
  report: TrimReport
}

/** A body ready to be cut: welded and closed as Manifold reads it, and its
 *  surface for the signed distance the break is found by. */
export interface PreparedBody {
  positions: Float32Array
  indices: Uint32Array
  surface: NominalSurface
  volume: number
}

/** Half the thinnest slab, mm. */
const MIN_HALF = 0.01

/** How far past the slab's reach the break's rim ends outside the body, mm. */
const CLEARANCE = 0.25

/** A piece smaller than this share of the body is a speck of the cut. */
const SPECK_SHARE = 1e-4

const PROPS = 4

/**
 * The body as a CAD body's mesh comes — face by face, each edge's vertices
 * once per face — welded and checked closed. Throws, naming it, when it is
 * not a solid.
 */
export function prepareBody(wasm: ManifoldToplevel, body: Triangles, name?: string): PreparedBody {
  const notClosed = `${name ?? 'The body'} did not come out as a closed mesh — is it a solid body, not a surface?`
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: body.positions, triVerts: body.indices })
  mesh.merge()
  let solid: Manifold
  try {
    solid = new wasm.Manifold(mesh)
  } catch {
    throw new Error(notClosed)
  }
  try {
    if (solid.status() !== 'NoError' || solid.isEmpty()) throw new Error(notClosed)
    const out = solid.getMesh()
    const positions = new Float32Array(out.vertProperties.length / out.numProp * 3)
    for (let v = 0; v < positions.length / 3; v++) {
      for (let k = 0; k < 3; k++) positions[v * 3 + k] = out.vertProperties[v * out.numProp + k]
    }
    const indices = Uint32Array.from(out.triVerts)
    return { positions, indices, surface: new NominalSurface(positions, indices), volume: solid.volume() }
  } finally {
    solid.delete()
  }
}

/**
 * The body cut to fit the scan's break, as the settings say: the break
 * found, carried out past the body, thickened into a slab, the body split
 * with it and the pieces on the missing piece's side kept, and its mating
 * face read against `scanSurface` — the scan prepared for closest points,
 * made here if not given. Throws, in words, when the body misses the scan,
 * when the break does not cut the body through, or when Manifold will not
 * take the slab.
 */
export function trimToScan(
  wasm: ManifoldToplevel,
  scan: { positions: Float32Array; indices: Uint32Array; vertexCount: number },
  body: PreparedBody,
  settings: TrimSettings,
  onProgress?: (text: string) => void,
  scanSurface: () => DistanceSurface = () => new NominalSurface(scan.positions, scan.indices),
): TrimmedPiece {
  const { depth, offset, flip, marked } = settings
  if (!(offset >= 0) || !Number.isFinite(offset)) throw new Error('The offset from the break must be zero or more.')
  const half = Math.max(offset, MIN_HALF)

  onProgress?.('Finding the break…')
  const found = findBreak(scan.positions, scan.indices, scan.vertexCount, body.surface, {
    depth,
    marked,
    minPiece: defaultBreakSpeck(body.surface.bboxDiagonal),
  })
  // Out past the body by more than the slab can lean back in: thickening
  // moves a point up to MAX_STRETCH times the distance at a crease.
  onProgress?.('Carrying the break out past the body…')
  const extended = extendRim(found.positions, found.indices, found.positions.length / 3, body.surface, {
    margin: MAX_STRETCH * half + CLEARANCE,
    deep: found.deep,
  })
  onProgress?.('Making the break a slab…')
  const { positions: ep, indices: ei } = extended
  // The rim held where it was carried, so the slab's wall stays out of the
  // body (core/offset).
  const slab = thickenMesh(ep, ei, ep.length / 3, 2 * half, 'both', undefined, () => new NominalSurface(ep, ei), true)
  // The front skin keeps the surface's numbers (core/offset).
  const front = new Uint8Array(slab.positions.length / 3)
  for (const w of slab.vertexMap) if (w >= 0) front[w] = 1

  onProgress?.('Cutting the body with the break…')
  const cut = cutBody(wasm, body, { positions: slab.positions, indices: slab.indices, front }, flip)
  onProgress?.('Reading the mating face against the scan…')
  const gap = gapToBreak(cut, found, scanSurface(), half, flip)
  return {
    positions: cut.positions,
    indices: cut.indices,
    mating: cut.mating,
    gap,
    report: {
      offset,
      slab: 2 * half,
      break: found.report,
      extend: extended.report,
      pieces: cut.pieces,
      volume: cut.volume,
      dropped: cut.dropped,
      specks: cut.specks,
      matingArea: cut.matingArea,
      bodyVolume: body.volume,
      fit: spreadOf(gap),
    },
  }
}

/**
 * How far each point of the piece's mating face is from the scan, less
 * `half` — signed by the scan's facing, turned round with `flip`, so a
 * point nearer the part than it should be reads negative — and NaN for
 * every point not on the mating face or whose nearest point on the break is
 * on its rim.
 */
function gapToBreak(
  piece: { positions: Float32Array; indices: Uint32Array; mating: Uint8Array },
  found: { positions: Float32Array; indices: Uint32Array },
  scan: DistanceSurface,
  half: number,
  flip: boolean,
): Float32Array {
  const count = piece.positions.length / 3
  const gap = new Float32Array(count).fill(NaN)
  const onFace = new Uint8Array(count)
  for (let t = 0; t < piece.mating.length; t++) {
    if (piece.mating[t]) for (let k = 0; k < 3; k++) onFace[piece.indices[t * 3 + k]] = 1
  }
  // The break's rim: its edges only one triangle has.
  const n = found.positions.length / 3
  const uses = new Map<number, number>()
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
  for (let t = 0; t < found.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const e = key(found.indices[t + k], found.indices[t + ((k + 1) % 3)])
      uses.set(e, (uses.get(e) ?? 0) + 1)
    }
  }
  const surface = new NominalSurface(found.positions, found.indices)
  const p = found.positions
  const hit = emptyHit()
  /** Whether a point lies on edge (a, b), to a hundred-thousandth of it. */
  const onEdge = (a: number, b: number) => {
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2]
    const ex = p[b * 3] - ax, ey = p[b * 3 + 1] - ay, ez = p[b * 3 + 2] - az
    const len2 = ex * ex + ey * ey + ez * ez
    if (len2 === 0) return true
    const s = Math.max(0, Math.min(1, ((hit.px - ax) * ex + (hit.py - ay) * ey + (hit.pz - az) * ez) / len2))
    const dx = hit.px - ax - s * ex, dy = hit.py - ay - s * ey, dz = hit.pz - az - s * ez
    return dx * dx + dy * dy + dz * dz < 1e-10 * len2
  }
  const index = surface.index
  for (let v = 0; v < count; v++) {
    if (!onFace[v]) continue
    const x = piece.positions[v * 3], y = piece.positions[v * 3 + 1], z = piece.positions[v * 3 + 2]
    surface.closest(x, y, z, hit)
    const f = hit.faceIndex
    if (f < 0) continue
    let rim = false
    for (let k = 0; k < 3 && !rim; k++) {
      const a = index[f * 3 + k]
      const b = index[f * 3 + ((k + 1) % 3)]
      if (uses.get(key(a, b)) === 1 && onEdge(a, b)) rim = true
    }
    if (rim) continue
    scan.closest(x, y, z, hit)
    gap[v] = (flip ? -hit.signed : hit.signed) - half
  }
  return gap
}

function spreadOf(values: Float32Array): GapSpread | null {
  const read: number[] = []
  for (const v of values) if (Number.isFinite(v)) read.push(v)
  if (read.length === 0) return null
  read.sort((a, b) => a - b)
  const q = (f: number) => read[Math.min(read.length - 1, Math.round(f * (read.length - 1)))]
  return { min: read[0], p05: q(0.05), median: q(0.5), p95: q(0.95), max: read[read.length - 1], measured: read.length }
}

/** Positions with a fourth property, `side`, per vertex. */
function withSide(positions: Float32Array, side: (v: number) => number): Float32Array {
  const count = positions.length / 3
  const out = new Float32Array(count * PROPS)
  for (let v = 0; v < count; v++) {
    out[v * PROPS] = positions[v * 3]
    out[v * PROPS + 1] = positions[v * 3 + 1]
    out[v * PROPS + 2] = positions[v * 3 + 2]
    out[v * PROPS + 3] = side(v)
  }
  return out
}

/**
 * The body minus the slab, the pieces on the kept side of it — the front
 * skin's, or with `flip` the back's — as one welded mesh, its mating face
 * marked. Pieces the slab never touched are kept: nothing says they are on
 * the wrong side.
 */
function cutBody(
  wasm: ManifoldToplevel,
  body: PreparedBody,
  slab: { positions: Float32Array; indices: Uint32Array; front: Uint8Array },
  flip: boolean,
) {
  const made: Manifold[] = []
  const keep = (m: Manifold): Manifold => {
    made.push(m)
    return m
  }
  try {
    const a = keep(new wasm.Manifold(new wasm.Mesh({ numProp: PROPS, vertProperties: withSide(body.positions, () => 0), triVerts: body.indices })))
    const slabMesh = new wasm.Mesh({ numProp: PROPS, vertProperties: withSide(slab.positions, (v) => (slab.front[v] ? 1 : -1)), triVerts: slab.indices })
    slabMesh.merge()
    const refused = (why: string) =>
      `Manifold would not take the break as a slab to cut with (${why}). A larger offset can help, or the break smoothed first — Smooth on a marked region.`
    let b: Manifold
    try {
      b = keep(new wasm.Manifold(slabMesh))
    } catch (e) {
      throw new Error(refused(e instanceof Error ? e.message : String(e)))
    }
    if (b.status() !== 'NoError' || b.isEmpty()) throw new Error(refused(b.status()))
    const cut = keep(a.subtract(b))
    if (cut.status() !== 'NoError') throw new Error(`The cut failed (${cut.status()}).`)

    const speck = SPECK_SHARE * body.volume
    const kept: Manifold[] = []
    let volume = 0
    let dropped = 0
    let specks = 0
    for (const part of cut.decompose()) {
      keep(part)
      const v = part.volume()
      if (v < speck) {
        specks++
        continue
      }
      const mesh = part.getMesh()
      let ahead = 0
      let behind = 0
      let wall = 0
      for (let i = 3; i < mesh.vertProperties.length; i += mesh.numProp) {
        const s = mesh.vertProperties[i]
        if (s > 0.99) ahead++
        else if (s < -0.99) behind++
        else if (Math.abs(s) > 0.01) wall++
      }
      if (wall > 0) {
        throw new Error('The break, carried out past the body, still ends inside it somewhere — the cut would not go through. Mark the break out to where the part’s surface leaves the body.')
      }
      if (ahead > 0 && behind > 0) {
        throw new Error('The break does not cut the body through: somewhere the body overlaps the part where there is no break to cut it — the scan has a gap there, or the marking stops short. Mark the whole break, out to the body’s edges.')
      }
      if ((flip ? ahead : behind) > 0) {
        dropped++
        continue
      }
      kept.push(part)
      volume += v
    }
    if (kept.length === 0) {
      throw new Error(flip ? 'Nothing of the body lies on that side of the break — flip the side back.' : 'Nothing of the body lies on the missing piece’s side of the break — flip the side.')
    }
    const whole = kept.length === 1 ? kept[0] : keep(wasm.Manifold.compose(kept))
    return { ...weldedWithMating(whole.getMesh()), pieces: kept.length, volume, dropped, specks }
  } finally {
    for (const m of made) m.delete()
  }
}

/** A Manifold mesh as one welded mesh — a point Manifold hands back once
 *  per run joined up again — with each triangle from the slab marked, and
 *  their area. */
function weldedWithMating(mesh: Mesh) {
  const np = mesh.numProp
  const props = mesh.vertProperties
  const tri = mesh.triVerts
  const count = props.length / np
  const rep = new Int32Array(count)
  for (let v = 0; v < count; v++) rep[v] = v
  for (let i = 0; i < mesh.mergeFromVert.length; i++) rep[mesh.mergeFromVert[i]] = mesh.mergeToVert[i]
  const number = new Int32Array(count).fill(-1)
  const pos: number[] = []
  const root = (v: number) => {
    let r = v
    while (rep[r] !== r) r = rep[r]
    return r
  }
  const indices = new Uint32Array(tri.length)
  for (let i = 0; i < tri.length; i++) {
    const r = root(tri[i])
    if (number[r] < 0) {
      number[r] = pos.length / 3
      pos.push(props[r * np], props[r * np + 1], props[r * np + 2])
    }
    indices[i] = number[r]
  }
  // Which triangles are the mating face, from their own corners' property —
  // a corner on the joint is the body's for the body's triangles.
  const mating = new Uint8Array(tri.length / 3)
  let matingArea = 0
  for (let t = 0; t < tri.length; t += 3) {
    if (Math.abs(props[tri[t] * np + 3]) < 0.5) continue
    mating[t / 3] = 1
    const a = tri[t] * np, b = tri[t + 1] * np, c = tri[t + 2] * np
    const ux = props[b] - props[a], uy = props[b + 1] - props[a + 1], uz = props[b + 2] - props[a + 2]
    const vx = props[c] - props[a], vy = props[c + 1] - props[a + 1], vz = props[c + 2] - props[a + 2]
    matingArea += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return { positions: Float32Array.from(pos), indices, mating, matingArea }
}
