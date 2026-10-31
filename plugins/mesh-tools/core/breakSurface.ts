// SPDX-License-Identifier: AGPL-3.0-only
// The break: the scanned fracture where a body modelled to mend the part
// reaches into it — what Trim to scan cuts the body with (see trimToScan).
//
// The body is modelled to the part's nominal shape and made too long at the
// break, so it overlaps the material that is still there. Where it does, the
// fracture lies millimetres deep inside it, while the part's own skins dip
// into it only by the scanner's scatter and by how far the part is off the
// CAD. So the break is the scan where it lies deeper in the body than a
// depth — 0.3 mm to start — and the skins drop out.
//
// The field is the signed distance from the body's surface, negative inside,
// at every scan vertex near the body; each triangle across the depth is
// clipped the way Cut clips at a plane (core/cut), a crossing made once per
// edge, so the rim follows the depth smoothly instead of the scan's
// triangles. A vertex within a tenth of an edge of the depth counts as on
// it: a crossing a hair from a corner leaves a sliver on the rim, which the
// extension past it carries out row by row, and which a slab thickened from
// it turns inside out — reading a sliver's normal, the two skins cross.
//
// A marking narrows it: a vertex it leaves out though it lies deeper than the
// depth counts as outside, and the rim crosses each edge from it to a marked
// vertex at its middle — where the marking was edited, the rim runs halfway
// between marked and unmarked, in triangles as well shaped as the scan's;
// where it was left as found, the rim is the smooth line at the depth, the
// same break as found.
// Pieces smaller across than a size — a skin that dipped deeper for a
// moment, a fleck of spray caught inside the body — are dropped, as islands
// are.

import { emptyHit } from '../../../src/core/deviation/surface'
import { clipCrossed, compactEdit, composeVertexMaps, edgeCrossings } from './edit'
import type { DistanceSurface } from './hollow'
import { surveyPieces, withoutTriangles } from './pieces'
import { round125 } from './reduce'
import { meanEdgeLength } from './smooth'
import { triangleAreaSum } from '../../../src/core/geometry/centroid'

/** The body a break is found in: signed closest points on its surface,
 *  negative inside — NominalSurface — and its bounding box. */
export interface BodySurface extends DistanceSurface {
  readonly bboxMin: readonly [number, number, number]
  readonly bboxMax: readonly [number, number, number]
  readonly bboxDiagonal: number
}

export interface BreakSettings {
  /** How much deeper in the body than its surface the scan must lie to be
   *  break, mm. */
  depth: number
  /** The vertices marked as break — only these may be; absent, all. */
  marked?: Uint32Array | null
  /** Pieces of the break smaller across than this are dropped, mm. */
  minPiece: number
}

export interface BreakReport {
  depth: number
  /** How many vertices the marking held — null without one. */
  marked: number | null
  triangles: number
  /** The break's area, mm². */
  area: number
  /** Pieces kept — one for each patch of break, two for a handle broken off
   *  at both roots — and the specks dropped. */
  pieces: number
  specks: number
}

export interface BreakSurface {
  /** The break as its own mesh: the scan's triangles in it, those across the
   *  depth clipped. */
  positions: Float32Array
  indices: Uint32Array
  /** The scan's vertices in it, ascending — the marking it is shown as. */
  vertices: Uint32Array
  /** 1 for each of its vertices that lies past the depth, not on it: a
   *  scan vertex inside the break. An edge of its rim between two is the
   *  scan's own edge — a spot the scanner missed (core/extendRim). */
  deep: Uint8Array
  report: BreakReport
}

/** How much deeper in the body than its surface the scan must lie to be
 *  break, to start with, mm: more than a scan's skin dips into a body
 *  modelled a little larger than the part, less than any break lies. */
export const DEFAULT_BREAK_DEPTH = 0.3

/** The size under which a piece of break is a speck: a twentieth of the
 *  body's diagonal, on the 1-2-5 steps. A break is about as large as the
 *  body is across; what dips past the depth by chance is much smaller. */
export function defaultBreakSpeck(bodyDiagonal: number): number {
  return round125(bodyDiagonal * 0.05)
}

/** A vertex this share of the scan's mean edge from the depth is on it. */
const SNAP_SHARE = 0.1

/**
 * The break in the scan — `vertexCount` vertices — for the body: the scan
 * where it lies deeper in the body than `depth`, narrowed to the marking if
 * there is one, specks dropped. Throws, in words, when there is none.
 */
export function findBreak(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  body: BodySurface,
  settings: BreakSettings,
): BreakSurface {
  const { depth, marked, minPiece } = settings
  if (!(depth > 0) || !Number.isFinite(depth)) throw new Error('The depth must be more than zero.')
  const edge = meanEdgeLength(positions, indices)
  const snap = SNAP_SHARE * edge
  // What a vertex that cannot be break counts as: outside by an edge.
  const outside = Math.max(edge, depth)

  let allowed: Uint8Array | null = null
  if (marked) {
    allowed = new Uint8Array(vertexCount)
    for (const v of marked) if (v < vertexCount) allowed[v] = 1
  }
  // The vertices the marking cut away, where an edge is crossed halfway.
  const cutAway = allowed ? new Uint8Array(vertexCount) : null

  // The field, read exactly near the body: a vertex further out of its box
  // than a few edges is outside, and no edge from it reaches the depth.
  const field = new Float64Array(vertexCount).fill(outside)
  const pad = depth + 4 * edge
  const [lx, ly, lz] = body.bboxMin
  const [hx, hy, hz] = body.bboxMax
  const hit = emptyHit()
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2]
    if (x < lx - pad || y < ly - pad || z < lz - pad || x > hx + pad || y > hy + pad || z > hz + pad) continue
    body.closest(x, y, z, hit)
    const s = hit.signed + depth
    if (cutAway && !allowed![v] && s < 0) {
      cutAway[v] = 1
      continue
    }
    field[v] = Math.abs(s) < snap ? 0 : s
  }

  const clipped = clipBelow(positions, indices, vertexCount, field, cutAway)
  if (clipped.indices.length === 0) {
    throw new Error(
      marked
        ? // units-ok: built in the worker, also the agent's answer
          `Nothing marked lies more than ${depth} mm inside the body — mark the break where the body reaches into the part.`
        : // units-ok: built in the worker, also the agent's answer
          `The scan nowhere lies more than ${depth} mm inside the body — is the body in place over the break, reaching into the part?`,
    )
  }
  const count = clipped.positions.length / 3
  const survey = surveyPieces(clipped.positions, clipped.indices, count, minPiece)
  if (survey.islands === survey.pieces) {
    // units-ok: built in the worker, also the agent's answer
    throw new Error(`What lies more than ${depth} mm inside the body is only specks, none ${minPiece} mm across — is the body in place over the break?`)
  }
  let mesh: { positions: Float32Array; indices: Uint32Array; vertexMap: Int32Array } = clipped
  if (survey.islands > 0) {
    const kept = withoutTriangles(clipped.positions, clipped.indices, count, survey.islandMask)
    mesh = { ...kept, vertexMap: composeVertexMaps(clipped.vertexMap, kept.vertexMap) }
  }

  const inBreak: number[] = []
  const deep = new Uint8Array(mesh.positions.length / 3)
  for (let v = 0; v < vertexCount; v++) {
    const w = mesh.vertexMap[v]
    if (w < 0) continue
    inBreak.push(v)
    if (field[v] < 0) deep[w] = 1
  }
  return {
    positions: mesh.positions,
    indices: mesh.indices,
    vertices: Uint32Array.from(inBreak),
    deep,
    report: {
      depth,
      marked: marked ? marked.length : null,
      triangles: mesh.indices.length / 3,
      area: triangleAreaSum(mesh.positions, mesh.indices),
      pieces: survey.pieces - survey.islands,
      specks: survey.islands,
    },
  }
}

/**
 * The mesh clipped to where `field` is below zero: the corners below kept,
 * a new corner wherever an edge crosses — made once per edge and shared by
 * both triangles on it, at the middle of an edge to a vertex `halfway`
 * marks — and a corner at zero taken as on the rim. The kept old vertices
 * come first, in their order, as every edit's do (core/edit).
 */
function clipBelow(positions: Float32Array, indices: Uint32Array, vertexCount: number, field: Float64Array, halfway: Uint8Array | null) {
  const side = new Int8Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) side[v] = field[v] > 0 ? 1 : field[v] < 0 ? -1 : 0
  const { crossing, extra } = edgeCrossings(positions, vertexCount, (p, q) => (halfway && (halfway[p] || halfway[q]) ? 0.5 : field[p] / (field[p] - field[q])))
  const out: number[] = []
  const poly: number[] = []
  const corners = [0, 0, 0]
  for (let t = 0; t < indices.length; t += 3) {
    corners[0] = indices[t]
    corners[1] = indices[t + 1]
    corners[2] = indices[t + 2]
    const sa = side[corners[0]], sb = side[corners[1]], sc = side[corners[2]]
    if (sa >= 0 && sb >= 0 && sc >= 0) continue
    if (sa <= 0 && sb <= 0 && sc <= 0) {
      out.push(corners[0], corners[1], corners[2])
      continue
    }
    clipCrossed(corners, side, crossing, poly, out)
  }
  const all = new Float32Array(positions.length + extra.length)
  all.set(positions)
  all.set(extra, positions.length)
  return compactEdit(all, Uint32Array.from(out), vertexCount)
}
