// SPDX-License-Identifier: AGPL-3.0-only
// The surface moved along its normal: expanded or shrunk by a distance, not
// scaled — a 20 mm ball expanded by 0.5 mm is 21 mm across, and a bore in it
// a millimetre narrower. And the same move made twice, a thickness apart, as
// the two skins of a sheet thickened into a solid (Shell, on an open
// surface).
//
// Each point moves so that every face around it ends the distance from where
// it was — even thickness, as a CAD offset has it. On a face the point moves
// the distance along the normal; on a sharp edge further, square to neither
// face, so both faces end the distance out and the edge stays sharp — √2
// times the distance at a right angle; at a corner further still. The move is
// the least-squares answer to "each face around the point, the distance
// along its own normal", weighted by the angle each face has at the point,
// and taken only in the directions the faces spread over: a scan's scatter
// and the gentle turn of a curved surface are one direction, a turn of more
// than 30° — the angle Smooth and Sharp edges take — is an edge. A knife
// edge would send its point far out; no point moves more than three times the
// distance.
//
// A region marked by hand moves as a step, like a face pushed. Its rim is
// one of two things. Where the surface beside it runs along the move — the
// region marked up to a machined edge, the face beside the edge square to it
// — the rim moves with the region and slides along that face, which is
// stretched or shortened with it: a face pushed out or in at an edge keeps
// the edge sharp. Elsewhere — a rim in the middle of a face — the region is
// split from the surface there and joined to it by a new wall along the
// move.
//
// Moving a surface can fold it over itself. Beside an edge it turns into —
// a convex edge shrunk, a concave one expanded — the face beside the edge
// comes out narrower by the distance, and a strip of it as wide as the
// distance has nowhere to go: its points are taken back out to the distance
// from the surface as it was, which lands them on the moved edge, and the
// strip closes up into it. A bump that curves tighter than the distance has
// no such place; wherever a triangle still comes out turned over, the
// points around it are eased — each takes the mean move of its neighbours —
// until none is.

import { buildAdjacency } from '../../../src/core/geometry/adjacency'
import { compactEdit, type EditedMesh } from './edit'
import type { DistanceSurface } from './hollow'
import { meanEdgeLength, vertexNormals } from './smooth'
import { across, cornersOf, faceGeometry, nextCorner, rimPoints } from './meshCorners'
import { evenMove, normalPasses, smoothedNormals } from './evenMove'
import { type Clearance, mendFolds } from './mendFolds'
export { MAX_STRETCH } from './evenMove'

export interface OffsetSettings {
  /** How far the surface moves, mm: out along its normal when positive —
   *  the part grows — in when negative. */
  distance: number
  /** Move only the surface marked by hand — these vertices, as a step;
   *  absent, the whole mesh. */
  region?: Uint32Array | null
}

export interface OffsetReport {
  distance: number
  /** How many vertices the marked region held — null for the whole mesh. */
  region: number | null
  /** Points moved, and how far the furthest went, mm — past the distance at
   *  an edge or a corner. */
  moved: number
  maxMove: number
  /** Points eased where the moved surface folded over itself, and points
   *  merged where it closed up on itself — a strip beside an edge, a fold. */
  relaxed: number
  merged: number
  /** Points of the region's rim that slid along the face beside it, and
   *  those split from the surface with a wall between; the wall's
   *  triangles. */
  slid: number
  stepped: number
  wall: number
}

/** Which way a thickened sheet grows from the surface: behind it — the
 *  scanned surface stays the outside — in front of it, or half each way. */
export type ThickenSide = 'in' | 'out' | 'both'

export interface ThickenReport {
  thickness: number
  side: ThickenSide
  /** Triangles the second skin and the wall round the rims brought. */
  triangles: number
  /** Open edges the wall closes. */
  rimEdges: number
  /** Points eased where a skin folded over itself, and merged where it
   *  closed up on itself. */
  relaxed: number
  merged: number
}

/** A face beside the rim whose normal is within 30° of square to the move
 *  runs along it: the rim slides along such a face rather than stepping off
 *  it. */
const SLIDE_SIN = 0.5

/** The share of the mesh's mean edge a scan's scatter is taken to reach. */
const SCATTER_SHARE = 0.25

/**
 * The mesh — or the region of it marked — moved `distance` along its normal,
 * even thickness: out when positive, in when negative. The whole mesh keeps
 * every vertex and triangle it had; a region's rim slides along the face
 * beside it or steps off the surface with a wall, as the top of this file
 * says. Points the move would fold over are eased.
 */
export function offsetMesh(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  settings: OffsetSettings,
  onProgress?: (text: string) => void,
  surface?: () => DistanceSurface,
): EditedMesh & { report: OffsetReport } {
  const d = settings.distance
  if (!Number.isFinite(d) || d === 0) throw new Error('The distance must not be zero.')
  const triangles = indices.length / 3
  const region = settings.region ?? null
  if (region && region.length === 0) throw new Error('Nothing is marked — mark the surface to move on the part first.')

  const { normals, angles } = faceGeometry(positions, indices)
  // The triangles that move: all of them, or those with every corner marked
  // — exactly the ones tinted on the part.
  const moves = new Uint8Array(triangles)
  if (region) {
    const marked = new Uint8Array(vertexCount)
    for (let k = 0; k < region.length; k++) if (region[k] < vertexCount) marked[region[k]] = 1
    let count = 0
    for (let t = 0; t < triangles; t++) {
      if (marked[indices[t * 3]] && marked[indices[t * 3 + 1]] && marked[indices[t * 3 + 2]]) {
        moves[t] = 1
        count++
      }
    }
    if (count === 0) throw new Error('No triangle is marked all round — mark more of the surface to move.')
  } else moves.fill(1)

  onProgress?.(d > 0 ? 'Expanding the surface…' : 'Shrinking the surface…')
  const { offsets, corners } = cornersOf(indices, vertexCount)
  const facing = smoothedNormals(normals, indices, offsets, corners, normalPasses(positions, indices, d))
  // Each point of the moving surface and its move, from the moving faces
  // around it alone: a rim point marked up to an edge moves along the face
  // beside it, square to the region's own.
  const move = new Float32Array(vertexCount * 3)
  const moving = new Uint8Array(vertexCount)
  const rim = new Uint8Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) {
    let inside = false
    let outside = false
    for (let k = offsets[v]; k < offsets[v + 1]; k++) {
      if (moves[(corners[k] / 3) | 0]) inside = true
      else outside = true
    }
    if (!inside) continue
    moving[v] = 1
    rim[v] = outside ? 1 : 0
    evenMove(v, d, offsets, corners, facing, angles, region ? moves : null, move, v * 3)
  }

  // The rim: points that slide with the region along the face beside them,
  // and points split off it — the copy moves, the point stays with the
  // surface around.
  const copyOf = new Int32Array(vertexCount).fill(-1)
  const slides = new Uint8Array(vertexCount)
  let total = vertexCount
  let slid = 0
  let stepped = 0
  if (region) {
    for (let v = 0; v < vertexCount; v++) {
      if (!rim[v]) continue
      const mx = move[v * 3], my = move[v * 3 + 1], mz = move[v * 3 + 2]
      const len = Math.hypot(mx, my, mz)
      let along = true
      if (len > 0) {
        for (let k = offsets[v]; k < offsets[v + 1] && along; k++) {
          const t = (corners[k] / 3) | 0
          if (moves[t]) continue
          const dot = (normals[t * 3] * mx + normals[t * 3 + 1] * my + normals[t * 3 + 2] * mz) / len
          if (Math.abs(dot) >= SLIDE_SIN) along = false
        }
      }
      if (along) {
        slides[v] = 1
        slid++
      } else {
        copyOf[v] = total++
        stepped++
      }
    }
  }

  // Where every point ends, and where it was — a copy was where its
  // original was.
  const base = new Float32Array(total * 3)
  base.set(positions)
  for (let v = 0; v < vertexCount; v++) {
    const c = copyOf[v]
    if (c >= 0) base.set(positions.subarray(v * 3, v * 3 + 3), c * 3)
  }
  const out = base.slice()
  const free = new Uint8Array(total)
  for (let v = 0; v < vertexCount; v++) {
    if (!moving[v]) continue
    const to = copyOf[v] >= 0 ? copyOf[v] : v
    out[to * 3] += move[v * 3]
    out[to * 3 + 1] += move[v * 3 + 1]
    out[to * 3 + 2] += move[v * 3 + 2]
    free[to] = 1
  }

  // The face beside a sliding rim is stretched, or shortened, along the
  // move — evenly over a band of it, so no triangle of it turns over: the
  // band behind the rim stretched to follow it out, the band ahead of it
  // squeezed into what the rim leaves. Its far edge stays where it was.
  if (slid > 0) {
    const band = Math.max(2 * Math.abs(d), 2 * meanEdgeLength(positions, indices))
    const vn = new Float32Array(vertexCount * 3)
    vertexNormals(positions, indices, vn)
    const { offsets: nOff, list: nList } = buildAdjacency(indices, vertexCount)
    const source = new Int32Array(vertexCount).fill(-1)
    const queue: number[] = []
    for (let v = 0; v < vertexCount; v++) {
      if (slides[v] && (move[v * 3] !== 0 || move[v * 3 + 1] !== 0 || move[v * 3 + 2] !== 0)) {
        source[v] = v
        queue.push(v)
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q]
      const s0 = source[u]
      const mx = move[s0 * 3], my = move[s0 * 3 + 1], mz = move[s0 * 3 + 2]
      const len = Math.hypot(mx, my, mz)
      for (let k = nOff[u]; k < nOff[u + 1]; k++) {
        const w = nList[k]
        if (moving[w] || source[w] !== -1) continue
        // Along the move, from the rim point it is reached from: ahead of
        // the rim (where it moves to) or behind it.
        const along =
          ((positions[w * 3] - positions[s0 * 3]) * mx + (positions[w * 3 + 1] - positions[s0 * 3 + 1]) * my + (positions[w * 3 + 2] - positions[s0 * 3 + 2]) * mz) / len
        const share = along > 0 ? 1 - along / (len + band) : 1 + along / band
        const facing = Math.abs(vn[w * 3] * mx + vn[w * 3 + 1] * my + vn[w * 3 + 2] * mz) / len
        if (share <= 0 || facing >= SLIDE_SIN) {
          source[w] = -2
          continue
        }
        source[w] = s0
        queue.push(w)
        out[w * 3] += share * mx
        out[w * 3 + 1] += share * my
        out[w * 3 + 2] += share * mz
        free[w] = 1
      }
    }
  }

  // The triangles: the moving ones on the copies of the rim points split
  // off, and the wall from each edge of the region that runs along a split
  // to the surface beside it.
  const wall: number[] = []
  if (stepped > 0) {
    for (let t = 0; t < triangles; t++) {
      if (!moves[t]) continue
      for (let k = 0; k < 3; k++) {
        const a = indices[t * 3 + k]
        const b = indices[t * 3 + ((k + 1) % 3)]
        if (copyOf[a] < 0 && copyOf[b] < 0) continue
        const other = across(a, b, indices, offsets, corners)
        if (other < 0 || moves[other]) continue
        const a2 = copyOf[a] >= 0 ? copyOf[a] : a
        const b2 = copyOf[b] >= 0 ? copyOf[b] : b
        // The quad a, b, b', a' — half of it is nothing where one end
        // slides rather than splits.
        if (b2 !== b) wall.push(a, b, b2)
        if (a2 !== a) wall.push(a, b2, a2)
      }
    }
  }
  const all = new Uint32Array(indices.length + wall.length)
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    all[i] = moves[(i / 3) | 0] && copyOf[v] >= 0 ? copyOf[v] : v
  }
  all.set(wall, indices.length)

  // The points moved the whole distance — not the rim sliding along the face
  // beside it, nor that face — keep the distance from the surface as it was.
  let clearance: Clearance | null = null
  if (surface) {
    const points = new Uint8Array(total)
    for (let v = 0; v < vertexCount; v++) {
      if (!moving[v] || slides[v]) continue
      points[copyOf[v] >= 0 ? copyOf[v] : v] = 1
    }
    clearance = { surface, distance: Math.abs(d), points, scatter: SCATTER_SHARE * meanEdgeLength(positions, indices) }
  }
  // Never merged: a point the move leaves where it was, or one on a rim.
  const locked = new Uint8Array(total)
  {
    const { offsets: o, corners: c } = cornersOf(all, total)
    const rim = rimPoints(all, total, o, c)
    for (let v = 0; v < total; v++) locked[v] = free[v] && !rim[v] ? 0 : 1
  }
  const mended = mendFolds(base, out, all, triangles, normals, free, locked, clearance)

  let moved = 0
  let maxMove = 0
  for (let v = 0; v < total; v++) {
    const dist = Math.hypot(out[v * 3] - base[v * 3], out[v * 3 + 1] - base[v * 3 + 1], out[v * 3 + 2] - base[v * 3 + 2])
    if (dist === 0) continue
    moved++
    if (dist > maxMove) maxMove = dist
  }
  const edited = compactEdit(out, mended.indices, vertexCount)
  return {
    ...edited,
    report: {
      distance: d,
      region: region ? region.length : null,
      moved,
      maxMove,
      relaxed: mended.relaxed,
      merged: mended.merged,
      slid,
      stepped,
      wall: wall.length / 3,
    },
  }
}

/**
 * An open surface thickened into a solid: a second skin `thickness` from it
 * — behind it, in front of it, or half each way, as `side` says — moved
 * with even thickness as offsetMesh moves a surface, and a wall round every
 * rim joining the two. The skin at the surface's own place keeps its
 * vertices' numbers; with both skins moved, the front one does. Folds the
 * moved skin would make are eased.
 *
 * `holdRim` keeps each skin's rim where the move put it, neither eased nor
 * pushed out from the surface — for a slab whose wall must stay where its
 * rim was carried (core/trimToScan): in a pocket narrower than twice the
 * distance, pushed off one face onto the next, a rim point wanders the
 * length of it and takes the wall along. A shell wants the rim mended with
 * the rest, which closes the strip beside an edge right up to it.
 */
export function thickenMesh(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  thickness: number,
  side: ThickenSide,
  onProgress?: (text: string) => void,
  surface?: () => DistanceSurface,
  holdRim = false,
): EditedMesh & { report: ThickenReport } {
  if (!(thickness > 0) || !Number.isFinite(thickness)) throw new Error('The thickness must be more than zero.')
  onProgress?.('Thickening the surface…')
  const triangles = indices.length / 3
  const { normals, angles } = faceGeometry(positions, indices)
  const { offsets, corners } = cornersOf(indices, vertexCount)
  const facing = smoothedNormals(normals, indices, offsets, corners, normalPasses(positions, indices, thickness))
  const unit = new Float32Array(vertexCount * 3)
  for (let v = 0; v < vertexCount; v++) evenMove(v, 1, offsets, corners, facing, angles, null, unit, v * 3)

  const front = side === 'in' ? 0 : side === 'out' ? thickness : thickness / 2
  const back = side === 'in' ? -thickness : side === 'out' ? 0 : -thickness / 2
  // The skin the scan's numbers stay on: the one left where the surface is,
  // or the front one.
  const frontKeeps = back !== 0
  const n = vertexCount
  const rim = rimPoints(indices, vertexCount, offsets, corners)
  const skin = (along: number): { out: Float32Array; indices: Uint32Array; relaxed: number; merged: number } => {
    const base = positions.slice()
    const out = positions.slice()
    if (along === 0) return { out, indices, relaxed: 0, merged: 0 }
    const free = new Uint8Array(n)
    for (let v = 0; v < n; v++) {
      out[v * 3] += along * unit[v * 3]
      out[v * 3 + 1] += along * unit[v * 3 + 1]
      out[v * 3 + 2] += along * unit[v * 3 + 2]
      free[v] = holdRim && rim[v] ? 0 : 1
    }
    const clearance = surface ? { surface, distance: Math.abs(along), points: free, scatter: SCATTER_SHARE * meanEdgeLength(positions, indices) } : null
    // The rim is never merged in each skin: the wall joins the two along it.
    const mended = mendFolds(base, out, indices.slice(), triangles, normals, free, rim, clearance)
    return { out, ...mended }
  }
  const frontSkin = skin(front)
  const backSkin = skin(back)

  const all = new Float32Array(n * 6)
  all.set(frontKeeps ? frontSkin.out : backSkin.out)
  all.set(frontKeeps ? backSkin.out : frontSkin.out, n * 3)
  const f = (v: number) => (frontKeeps ? v : v + n)
  const b = (v: number) => (frontKeeps ? v + n : v)

  // The front skin as the surface was wound, the back one wound the other
  // way, so both face out of the solid; then the wall along each open edge
  // — of the surface as it was: each skin keeps its rim.
  const wall: number[] = []
  for (let c = 0; c < indices.length; c++) {
    const a = indices[c]
    const e = indices[nextCorner(c)]
    if (across(a, e, indices, offsets, corners) >= 0) continue
    wall.push(f(e), f(a), b(a), f(e), b(a), b(e))
  }
  const fi = frontSkin.indices
  const bi = backSkin.indices
  const out = new Uint32Array(fi.length + bi.length + wall.length)
  for (let i = 0; i < fi.length; i++) out[i] = f(fi[i])
  for (let i = 0; i < bi.length; i += 3) {
    out[fi.length + i] = b(bi[i])
    out[fi.length + i + 1] = b(bi[i + 2])
    out[fi.length + i + 2] = b(bi[i + 1])
  }
  out.set(wall, fi.length + bi.length)

  const edited = compactEdit(all, out, vertexCount)
  return {
    ...edited,
    report: {
      thickness,
      side,
      triangles: out.length / 3 - triangles,
      rimEdges: wall.length / 6,
      relaxed: frontSkin.relaxed + backSkin.relaxed,
      merged: frontSkin.merged + backSkin.merged,
    },
  }
}
