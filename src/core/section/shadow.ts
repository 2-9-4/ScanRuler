// SPDX-License-Identifier: AGPL-3.0-only
// The shadow of the scan on a plane: the whole part seen along the plane's
// normal, kept as its outer boundary — the outline a straight-walled bin or
// a foam cutout needs, every indentation filled, where a cut is only what
// one plane passes through.
//
// The scan's triangles are projected onto the plane and rasterised into a
// mask (a cell is set when its centre lies inside a projected triangle; a
// triangle seen edge-on sets nothing, so a sheet edge-on has no shadow).
// Marching squares traces the mask's loops, which gives the topology —
// which loops there are, which are holes — and roughly where. Every traced
// point lies between a set centre and an unset one, and is then bisected
// along that step onto the true boundary of the union of projected
// triangles: the exact loops are the mesh's own silhouette to floating-point
// accuracy whatever the cell, and the cell only decides which features are
// resolved (a slot narrower than a cell can close).
//
// The exact loops are the reference, not what the section keeps. What it
// keeps is a contour read as lines and arcs, the way a sketch is drawn, and
// never inside the part: the exact silhouette offset outwards by the play
// plus the tolerance (an exact rounded offset — the distance to the exact
// loops, traced and bisected the same way), read with loopShape at the
// tolerance, so the reading lies between play and play + 2·tolerance
// outside. A least-squares piece can stray past what it was asked for, so
// the reading is checked against the exact loops, sampled piece by piece.
// Where it comes a little closer than the play all round, the whole offset
// is raised by the shortfall and the loops read again — a uniform margin, so
// lines still meet at corners — as long as its far side stays in the band.
// What still leaves the band is a piece read wrongly (two lines meeting far
// past a blunt corner, an arc forced through ends off its circle), and that
// piece alone becomes the stretch of offset loop it stood for, thinned; a
// loop that still strays is kept as its offset loop thinned to half the
// tolerance, which lies in the band by construction. A negative play is a
// press fit and keeps the same guarantee against the shrunk silhouette.
//
// A reading that stays in the band can still carry teeth: a corner read as
// two with a stub of a line between them, turning out and back — inside the
// band, and plain wrong to the eye. A short line whose ends turn opposite
// ways is taken out where its neighbours, run on to meet, or one line in
// their place, stay in the band.
//
// Last, the corners: where two lines meet turning by less than the
// smoothing angle (30° unless told otherwise), the corner is rounded by an
// arc tangent to both, as large as the two lines leave room for and the band
// allows — a faceted run of a curved side becomes one the eye and a CAD
// kernel read as smooth; a corner turning more stays sharp.
//
// The pieces are what the DXF, the SVG and the STEP prism are written from;
// sampled finely they are also an ordinary SectionCut — closed loops with
// the outward direction at every point — so the sheet, the 3D view and
// everything that reads a cut reads a shadow the same way.
//
// Pure typed-array code, no DOM.

import { simplifyRun } from '../flat/simplify'
import { loopShape, maskLoops, type LoopShape, type Pt } from '../geometry/outline'
import type { Vec3 } from '../types'
import type { FlatFit } from '../flat/types'
import type { SectionFrame } from './frame'
import type { SectionCut } from './slice'
import { fmtArea, fmtLen, unitWord, type DisplayUnits } from '../units'

/** The tolerance a shadow is read to unless told otherwise, mm. The raster
 *  cell is half of it. */
export const SHADOW_TOLERANCE = 0.1

/** Corners of a shadow's outline turning by less than this are rounded
 *  unless told otherwise, degrees; sharper ones stay sharp. */
export const SHADOW_SMOOTH_DEG = 30

/** A corner turning by less than this is no corner to round, radians. */
const MIN_TURN = (0.5 * Math.PI) / 180

/** The most cells the mask may have: a bigger part widens the cell. */
const MAX_CELLS = 8_000_000

/** How close the bisection gets to the boundary, mm. */
const REFINE_TO = 1e-5

/** The exact loops are thinned to this before they are measured against —
 *  well under anything the reading is judged on, and enough to fold a
 *  straight run of refined points into one segment. */
const REFERENCE_THIN = 1e-3

/** How many times the offset is raised when the reading comes too close. */
const MAX_RAISES = 3

/** A line this many tolerances long or shorter, turning back the way it
 *  came at one end, is a tooth to pull. */
const TOOTH_LENGTH = 6

/** The chord error an arc is sampled to, mm. */
const ARC_SAGITTA = 0.002

/** A piece of a shadow's contour on the sheet ([u, v] mm in the section's
 *  frame), in the order the loop runs: the material lies to the left. An arc
 *  turns by `sweep` radians about its centre, positive counter-clockwise; a
 *  circle is a whole loop on its own. */
export type ShadowPiece =
  | { kind: 'line'; from: Pt; to: Pt }
  | { kind: 'arc'; from: Pt; to: Pt; center: Pt; radius: number; sweep: number }
  | { kind: 'circle'; center: Pt; radius: number }

export interface ShadowLoop {
  /** A hole in the outline (run clockwise seen from the normal's side);
   *  otherwise an outer loop (counter-clockwise). */
  hole: boolean
  pieces: ShadowPiece[]
}

/** What a shadow is, beside the polylines: its contour as pieces, and the
 *  figures the readout and the exports give. */
export interface ShadowShape {
  loops: ShadowLoop[]
  /** The area the contour encloses, holes taken off, mm². */
  area: number
  play: number
  tolerance: number
  /** Corners turning by less than this were rounded, degrees; 0 none. */
  smoothDeg: number
  /** How far the contour lies outside the exact silhouette, nearest and
   *  farthest, as measured — never less than the play. */
  margin: { min: number; max: number }
  /** The raster's cell, mm — tolerance / 2, or wider for a big part. */
  cell: number
  widened: boolean
  /** Where the part lies along the normal, from the frame's origin, mm:
   *  what an extruded shadow stands between. */
  extent: { min: number; max: number }
  /** The frame the shadow was taken in, moved with the part — so a shadow
   *  slid along its normal can be shifted rather than taken again. */
  frame: SectionFrame
}

export interface ShadowOptions {
  /** mm; SHADOW_TOLERANCE by default. */
  tolerance?: number
  /** How far outside the part the contour lies, mm: positive is a
   *  clearance, negative a press fit. 0 by default. */
  play?: number
  /** Corners where the outline turns by less than this many degrees are
   *  rounded, sharper ones kept; 0 rounds none. SHADOW_SMOOTH_DEG by
   *  default. */
  smoothDeg?: number
  /** The most raster cells; the cell is widened past it. */
  maxCells?: number
}

/** A loop of the exact silhouette, in [u, v] mm. */
export interface ExactLoop {
  points: Pt[]
  hole: boolean
}

export interface ShadowOutline {
  /** The kernel's truth: the silhouette's loops, refined, unthinned. */
  exact: ExactLoop[]
  /** What the section keeps. */
  shape: ShadowShape
  cut: SectionCut & { shadow: ShadowShape }
}

const emptyCut = (shape: ShadowShape): SectionCut & { shadow: ShadowShape } => ({
  points: new Float32Array(0),
  offsets: new Uint32Array(1),
  normals: new Float32Array(0),
  shadow: shape,
})

/** The scan's shadow on the frame's plane, as a cut — see the top. */
export function shadowMesh(
  positions: Float32Array,
  indices: Uint32Array,
  frame: SectionFrame,
  opts: ShadowOptions = {},
): SectionCut & { shadow: ShadowShape } {
  return shadowOutline(positions, indices, frame, opts).cut
}

/** The shadow with the exact loops it was read from — what the tests check
 *  the reading against. */
export function shadowOutline(
  positions: Float32Array,
  indices: Uint32Array,
  frame: SectionFrame,
  opts: ShadowOptions = {},
): ShadowOutline {
  const tol = opts.tolerance !== undefined && opts.tolerance > 0 ? opts.tolerance : SHADOW_TOLERANCE
  const play = opts.play !== undefined && Number.isFinite(opts.play) ? opts.play : 0
  const smoothDeg = opts.smoothDeg !== undefined && opts.smoothDeg >= 0 ? Math.min(opts.smoothDeg, 180) : SHADOW_SMOOTH_DEG
  const [ox, oy, oz] = frame.origin
  const [ux, uy, uz] = frame.basisU
  const [vx, vy, vz] = frame.basisV
  const [nx, ny, nz] = frame.normal

  // ---- 1. project ---------------------------------------------------------
  const nv = positions.length / 3
  const pu = new Float64Array(nv)
  const pv = new Float64Array(nv)
  let wMin = Infinity
  let wMax = -Infinity
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (let i = 0; i < nv; i++) {
    const x = positions[i * 3] - ox
    const y = positions[i * 3 + 1] - oy
    const z = positions[i * 3 + 2] - oz
    const u = x * ux + y * uy + z * uz
    const v = x * vx + y * vy + z * vz
    const w = x * nx + y * ny + z * nz
    pu[i] = u
    pv[i] = v
    if (u < uMin) uMin = u
    if (u > uMax) uMax = u
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
    if (w < wMin) wMin = w
    if (w > wMax) wMax = w
  }
  const blank = (cell: number, widened: boolean): ShadowOutline => {
    const shape: ShadowShape = {
      loops: [],
      area: 0,
      play,
      tolerance: tol,
      smoothDeg,
      margin: { min: play, max: play },
      cell,
      widened,
      extent: { min: Number.isFinite(wMin) ? wMin : 0, max: Number.isFinite(wMax) ? wMax : 0 },
      frame,
    }
    return { exact: [], shape, cut: emptyCut(shape) }
  }
  const triCount = indices.length / 3
  if (nv === 0 || triCount === 0) return blank(tol / 2, false)

  // ---- 2. rasterise -------------------------------------------------------
  let cell = tol / 2
  let widened = false
  const maxCells = opts.maxCells ?? MAX_CELLS
  const spanU = uMax - uMin
  const spanV = vMax - vMin
  if ((spanU / cell + 5) * (spanV / cell + 5) > maxCells) {
    cell = Math.sqrt(((spanU + 5 * cell) * (spanV + 5 * cell)) / maxCells) * 1.01
    widened = true
  }
  const grid = {
    cell,
    u0: uMin - 2 * cell,
    v0: vMin - 2 * cell,
    cols: Math.ceil(spanU / cell) + 5,
    rows: Math.ceil(spanV / cell) + 5,
  }
  const mask = new Uint8Array(grid.cols * grid.rows)
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3]
    const b = indices[t * 3 + 1]
    const c = indices[t * 3 + 2]
    fillTriangle(mask, grid, pu[a], pv[a], pu[b], pv[b], pu[c], pv[c])
  }

  // ---- 3. trace -----------------------------------------------------------
  const traced = maskLoops(mask, grid, (3 * cell) ** 2)
  if (traced.length === 0) return blank(cell, widened)

  // ---- 4. refine onto the union of the projected triangles ----------------
  const union = triangleBuckets(pu, pv, indices, grid, traced)
  const exact: ExactLoop[] = traced.map((l) => ({
    hole: l.hole,
    points: l.points.map((p) => refineCrossing(p, grid, mask, union.inside)),
  }))

  // ---- 5. the contour: offset, read, checked ------------------------------
  const ref = new SegmentField(exact, cell)
  // The band the contour must lie in, outside the exact silhouette.
  const low = play - 1e-6
  const high = play + 2 * tol + 1e-6
  let d = play + tol
  const base = offsetLoops(ref, exact, d, cell)
  const baseLoops = base.map((l) => ({ hole: l.hole, pieces: readLoop(l.points, tol, base.cell) }))
  let offset = base
  let loops = baseLoops
  let margin = measureMargin(loops, ref, cell)
  // A reading that comes a little too close all round is raised whole, so
  // its lines still meet at their corners — as long as that keeps its far
  // side inside the band.
  for (let round = 0; round < MAX_RAISES && margin.min < low && margin.max + (play - margin.min) < high; round++) {
    d += play - margin.min + 1e-4
    offset = offsetLoops(ref, exact, d, cell)
    loops = offset.map((l) => ({ hole: l.hole, pieces: readLoop(l.points, tol, offset.cell) }))
    margin = measureMargin(loops, ref, cell)
  }
  // What still leaves the band is a piece read wrongly — two lines meeting
  // far past a blunt corner, an arc forced through ends off its circle —
  // and only that piece is drawn instead as the offset loop it stands for,
  // thinned; a loop that still leaves the band is kept as its offset loop
  // thinned to half the tolerance, which lies within it by construction —
  // all of it on the offset of play + tolerance, not a raised one.
  if (margin.min < low || margin.max > high) {
    offset = base
    loops = baseLoops.map((l, i) => {
      const run = offset[i].points
      const bad = l.pieces.map((pc) => {
        const m = measureMargin([{ hole: l.hole, pieces: [pc] }], ref, cell)
        return m.min < low || m.max > high
      })
      const n = l.pieces.length
      const first = bad.indexOf(false)
      let pieces: ShadowPiece[] = []
      if (first >= 0) {
        // Round from a good piece, so that bad ones in a row — two lines
        // that meet past a corner — are patched as one stretch, the corner
        // between them gone.
        for (let k = 0; k < n; ) {
          const at = (first + k) % n
          if (!bad[at]) {
            pieces.push(l.pieces[at])
            k++
            continue
          }
          let end = k
          while (end + 1 < n && bad[(first + end + 1) % n]) end++
          const from = l.pieces[at]
          const to = l.pieces[(first + end) % n]
          if (from.kind !== 'circle' && to.kind !== 'circle') pieces.push(...patchPiece({ kind: 'line', from: from.from, to: to.to }, run, tol / 2))
          k = end + 1
        }
      }
      const m = first >= 0 ? measureMargin([{ hole: l.hole, pieces }], ref, cell) : null
      if (!m || m.min < low || m.max > high) pieces = polygonPieces(run, tol / 2)
      return { hole: l.hole, pieces }
    })
    margin = measureMargin(loops, ref, cell)
  }
  loops = loops.filter((l) => l.pieces.length > 0).map(orient)

  // ---- 6. the teeth, then the corners ---------------------------------------
  const band = (pieces: ShadowPiece[]) => {
    const m = measureMargin([{ hole: false, pieces }], ref, cell)
    return m.min >= low && m.max <= high
  }
  loops = loops.map((l) => ({ hole: l.hole, pieces: pullTeeth(l.pieces, TOOTH_LENGTH * tol, band) }))
  if (smoothDeg > 0) loops = loops.map((l) => ({ hole: l.hole, pieces: roundCorners(l.pieces, (smoothDeg * Math.PI) / 180, band) }))
  margin = measureMargin(loops, ref, cell)

  // ---- 7. the cut: the pieces sampled, with outward normals, lifted -------
  const shape: ShadowShape = {
    loops,
    area: loops.reduce((s, l) => s + (l.hole ? -1 : 1) * Math.abs(loopArea(l.pieces)), 0),
    play,
    tolerance: tol,
    smoothDeg,
    margin,
    cell,
    widened,
    extent: { min: wMin, max: wMax },
    frame,
  }
  return { exact, shape, cut: { ...liftLoops(loops, frame, cell), shadow: shape } }
}

/** The shadow slid along its own normal: the same loops drawn on the plane
 *  at its new place. Null when the frame has turned, so the shadow has to be
 *  taken again. */
export function shiftShadow(cut: SectionCut, to: SectionFrame): SectionCut | null {
  const sh = cut.shadow
  if (!sh) return null
  const from = sh.frame
  const same = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9
  if (!same(from.normal, to.normal) || !same(from.basisU, to.basisU) || !same(from.basisV, to.basisV)) return null
  const dx = to.origin[0] - from.origin[0]
  const dy = to.origin[1] - from.origin[1]
  const dz = to.origin[2] - from.origin[2]
  const along = dx * to.normal[0] + dy * to.normal[1] + dz * to.normal[2]
  // A move that is not along the normal moves the sheet's zero: the loops
  // would have to be laid out again.
  if (Math.hypot(dx - along * to.normal[0], dy - along * to.normal[1], dz - along * to.normal[2]) > 1e-9) return null
  const points = cut.points.slice()
  for (let i = 0; i < points.length; i += 3) {
    points[i] += dx
    points[i + 1] += dy
    points[i + 2] += dz
  }
  return {
    points,
    offsets: cut.offsets,
    ...(cut.normals ? { normals: cut.normals } : {}),
    shadow: { ...sh, frame: to, extent: { min: sh.extent.min - along, max: sh.extent.max - along } },
  }
}

// ---- the raster ------------------------------------------------------------

interface Grid {
  cell: number
  u0: number
  v0: number
  cols: number
  rows: number
}

/** Set every cell whose centre lies inside the triangle (edges included),
 *  row by row. A triangle seen edge-on sets nothing. */
function fillTriangle(mask: Uint8Array, g: Grid, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
  const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  if (area2 === 0) return
  const y0 = Math.min(ay, by, cy)
  const y1 = Math.max(ay, by, cy)
  const r0 = Math.max(0, Math.ceil((y0 - g.v0) / g.cell - 0.5))
  const r1 = Math.min(g.rows - 1, Math.floor((y1 - g.v0) / g.cell - 0.5))
  for (let r = r0; r <= r1; r++) {
    const y = g.v0 + (r + 0.5) * g.cell
    let lo = Infinity
    let hi = -Infinity
    const edge = (px: number, py: number, qx: number, qy: number) => {
      if ((py <= y && y <= qy) || (qy <= y && y <= py)) {
        if (py === qy) {
          lo = Math.min(lo, px, qx)
          hi = Math.max(hi, px, qx)
        } else {
          const x = px + ((y - py) * (qx - px)) / (qy - py)
          if (x < lo) lo = x
          if (x > hi) hi = x
        }
      }
    }
    edge(ax, ay, bx, by)
    edge(bx, by, cx, cy)
    edge(cx, cy, ax, ay)
    if (!(hi >= lo)) continue
    const c0 = Math.max(0, Math.ceil((lo - g.u0) / g.cell - 0.5))
    const c1 = Math.min(g.cols - 1, Math.floor((hi - g.u0) / g.cell - 0.5))
    const row = r * g.cols
    for (let c = c0; c <= c1; c++) mask[row + c] = 1
  }
}

/** The two cell centres a traced point lies between, the set one first —
 *  marching squares puts every point halfway along such a step. */
function crossingCells(p: Pt, g: Grid, mask: Uint8Array): [Pt, Pt] {
  const fx = (p[0] - g.u0) / g.cell - 0.5
  const fy = (p[1] - g.v0) / g.cell - 0.5
  const horizontal = Math.abs(fx - Math.round(fx)) > 0.25
  const c = horizontal ? Math.floor(fx) : Math.round(fx)
  const r = horizontal ? Math.round(fy) : Math.floor(fy)
  const c2 = horizontal ? c + 1 : c
  const r2 = horizontal ? r : r + 1
  const set = (cc: number, rr: number) => cc >= 0 && rr >= 0 && cc < g.cols && rr < g.rows && mask[rr * g.cols + cc] !== 0
  const centre = (cc: number, rr: number): Pt => [g.u0 + (cc + 0.5) * g.cell, g.v0 + (rr + 0.5) * g.cell]
  return set(c, r) ? [centre(c, r), centre(c2, r2)] : [centre(c2, r2), centre(c, r)]
}

/** A traced point moved onto the boundary of `inside`, by bisection along
 *  the step it lies on. */
function refineCrossing(p: Pt, g: Grid, mask: Uint8Array, inside: (u: number, v: number) => boolean): Pt {
  const [a, b] = crossingCells(p, g, mask)
  let lx = a[0], ly = a[1], hx = b[0], hy = b[1]
  for (let k = 0; k < 60 && Math.hypot(hx - lx, hy - ly) > REFINE_TO; k++) {
    const mx = (lx + hx) / 2
    const my = (ly + hy) / 2
    if (inside(mx, my)) {
      lx = mx
      ly = my
    } else {
      hx = mx
      hy = my
    }
  }
  return [(lx + hx) / 2, (ly + hy) / 2]
}

/** The projected triangles near the traced boundary, bucketed, and the
 *  test of whether a point lies inside any of them. Only the buckets the
 *  boundary passes through are filled — a refinement never asks elsewhere. */
function triangleBuckets(pu: Float64Array, pv: Float64Array, indices: Uint32Array, g: Grid, traced: { points: Pt[] }[]) {
  const W = g.cols * g.cell
  const H = g.rows * g.cell
  const size = Math.max(1, 4 * g.cell, Math.sqrt((W * H) / 1e6))
  const bc = Math.ceil(W / size) + 1
  const br = Math.ceil(H / size) + 1
  const slot = new Int32Array(bc * br).fill(-1)
  let used = 0
  const bucketOf = (u: number, v: number) => [Math.floor((u - g.u0) / size), Math.floor((v - g.v0) / size)]
  for (const l of traced) {
    for (const p of l.points) {
      const [c, r] = bucketOf(p[0], p[1])
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc
          const rr = r + dr
          if (cc < 0 || rr < 0 || cc >= bc || rr >= br) continue
          const k = rr * bc + cc
          if (slot[k] < 0) slot[k] = used++
        }
      }
    }
  }
  const count = new Uint32Array(used + 1)
  const triCount = indices.length / 3
  const each = (fn: (s: number, t: number) => void) => {
    for (let t = 0; t < triCount; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
      const c0 = Math.max(0, Math.floor((Math.min(pu[a], pu[b], pu[c]) - g.u0) / size))
      const c1 = Math.min(bc - 1, Math.floor((Math.max(pu[a], pu[b], pu[c]) - g.u0) / size))
      const r0 = Math.max(0, Math.floor((Math.min(pv[a], pv[b], pv[c]) - g.v0) / size))
      const r1 = Math.min(br - 1, Math.floor((Math.max(pv[a], pv[b], pv[c]) - g.v0) / size))
      for (let r = r0; r <= r1; r++) {
        for (let cc = c0; cc <= c1; cc++) {
          const s = slot[r * bc + cc]
          if (s >= 0) fn(s, t)
        }
      }
    }
  }
  each((s) => count[s + 1]++)
  for (let i = 1; i <= used; i++) count[i] += count[i - 1]
  const fill = count.slice(0, used)
  const tris = new Uint32Array(count[used])
  each((s, t) => {
    tris[fill[s]++] = t
  })
  const inside = (u: number, v: number): boolean => {
    const [c, r] = bucketOf(u, v)
    if (c < 0 || r < 0 || c >= bc || r >= br) return false
    const s = slot[r * bc + c]
    if (s < 0) return false
    for (let i = count[s]; i < count[s + 1]; i++) {
      const t = tris[i]
      const a = indices[t * 3], b = indices[t * 3 + 1], cc = indices[t * 3 + 2]
      const ax = pu[a], ay = pv[a], bx = pu[b], by = pv[b], cx = pu[cc], cy = pv[cc]
      const d1 = (bx - ax) * (v - ay) - (by - ay) * (u - ax)
      const d2 = (cx - bx) * (v - by) - (cy - by) * (u - bx)
      const d3 = (ax - cx) * (v - cy) - (ay - cy) * (u - cx)
      const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (area2 === 0) continue
      if (area2 > 0 ? d1 >= 0 && d2 >= 0 && d3 >= 0 : d1 <= 0 && d2 <= 0 && d3 <= 0) return true
    }
    return false
  }
  return { inside }
}

// ---- distance to the exact loops ------------------------------------------

/**
 * The exact loops as segments, bucketed — for the distance from a point to
 * the silhouette, and (by a ray along +u, even-odd over the same buckets'
 * rows) whether it lies inside. Long segments are split so that a bucket
 * holds only what passes through it.
 */
class SegmentField {
  readonly size: number
  private readonly u0: number
  private readonly v0: number
  private readonly bc: number
  private readonly br: number
  /** ax, ay, bx, by per segment. */
  private readonly seg: Float64Array
  private readonly start: Uint32Array
  private readonly items: Uint32Array
  /** Per bucket row, the segments crossing that row's band of v. */
  private readonly rowStart: Uint32Array
  private readonly rowItems: Uint32Array
  readonly box: { u0: number; v0: number; u1: number; v1: number }

  constructor(loops: readonly ExactLoop[], cell: number) {
    const segs: number[] = []
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity
    for (const l of loops) {
      const n = l.points.length
      if (n < 2) continue
      const flat = new Float64Array((n + 1) * 2)
      for (let i = 0; i <= n; i++) {
        flat[i * 2] = l.points[i % n][0]
        flat[i * 2 + 1] = l.points[i % n][1]
      }
      const kept = simplifyRun(flat, 0, n + 1, REFERENCE_THIN)
      for (let k = 1; k < kept.length; k++) {
        const ax = flat[kept[k - 1] * 2], ay = flat[kept[k - 1] * 2 + 1]
        const bx = flat[kept[k] * 2], by = flat[kept[k] * 2 + 1]
        segs.push(ax, ay, bx, by)
        u0 = Math.min(u0, ax, bx)
        v0 = Math.min(v0, ay, by)
        u1 = Math.max(u1, ax, bx)
        v1 = Math.max(v1, ay, by)
      }
    }
    this.box = { u0, v0, u1, v1 }
    const W = Math.max(u1 - u0, cell)
    const H = Math.max(v1 - v0, cell)
    const size = Math.max(4 * cell, 0.5, Math.sqrt((W * H) / 250_000))
    this.size = size
    // Split for bucketing: no piece longer than a bucket.
    const split: number[] = []
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3]
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / size))
      for (let j = 0; j < k; j++) {
        split.push(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k, ax + ((bx - ax) * (j + 1)) / k, ay + ((by - ay) * (j + 1)) / k)
      }
    }
    this.seg = Float64Array.from(split)
    this.u0 = u0 - size
    this.v0 = v0 - size
    this.bc = Math.ceil(W / size) + 3
    this.br = Math.ceil(H / size) + 3
    const n = this.seg.length / 4
    const cellsOf = (s: number, fn: (k: number) => void) => {
      const ax = this.seg[s * 4], ay = this.seg[s * 4 + 1], bx = this.seg[s * 4 + 2], by = this.seg[s * 4 + 3]
      const c0 = this.col(Math.min(ax, bx)), c1 = this.col(Math.max(ax, bx))
      const r0 = this.row(Math.min(ay, by)), r1 = this.row(Math.max(ay, by))
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * this.bc + c)
    }
    const count = new Uint32Array(this.bc * this.br + 1)
    for (let s = 0; s < n; s++) cellsOf(s, (k) => count[k + 1]++)
    for (let i = 1; i < count.length; i++) count[i] += count[i - 1]
    const fill = count.slice(0, -1)
    this.items = new Uint32Array(count[count.length - 1])
    for (let s = 0; s < n; s++) cellsOf(s, (k) => { this.items[fill[k]++] = s })
    this.start = count
    const rows = new Uint32Array(this.br + 1)
    const rowsOf = (s: number, fn: (r: number) => void) => {
      const r0 = this.row(Math.min(this.seg[s * 4 + 1], this.seg[s * 4 + 3]))
      const r1 = this.row(Math.max(this.seg[s * 4 + 1], this.seg[s * 4 + 3]))
      for (let r = r0; r <= r1; r++) fn(r)
    }
    for (let s = 0; s < n; s++) rowsOf(s, (r) => rows[r + 1]++)
    for (let i = 1; i < rows.length; i++) rows[i] += rows[i - 1]
    const rfill = rows.slice(0, -1)
    this.rowItems = new Uint32Array(rows[rows.length - 1])
    for (let s = 0; s < n; s++) rowsOf(s, (r) => { this.rowItems[rfill[r]++] = s })
    this.rowStart = rows
  }

  private col(u: number) {
    return Math.max(0, Math.min(this.bc - 1, Math.floor((u - this.u0) / this.size)))
  }
  private row(v: number) {
    return Math.max(0, Math.min(this.br - 1, Math.floor((v - this.v0) / this.size)))
  }

  private segDist(s: number, u: number, v: number): number {
    const ax = this.seg[s * 4], ay = this.seg[s * 4 + 1]
    const dx = this.seg[s * 4 + 2] - ax, dy = this.seg[s * 4 + 3] - ay
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / l2)) : 0
    return Math.hypot(u - ax - t * dx, v - ay - t * dy)
  }

  /** Inside the exact silhouette: a ray along +u crosses its loops an odd
   *  number of times. */
  inside(u: number, v: number): boolean {
    if (v < this.box.v0 || v > this.box.v1 || u < this.box.u0 || u > this.box.u1) return false
    const r = this.row(v)
    let odd = false
    for (let i = this.rowStart[r]; i < this.rowStart[r + 1]; i++) {
      const s = this.rowItems[i]
      const ay = this.seg[s * 4 + 1], by = this.seg[s * 4 + 3]
      if (ay > v === by > v) continue
      const ax = this.seg[s * 4], bx = this.seg[s * 4 + 2]
      if (u < ax + ((v - ay) * (bx - ax)) / (by - ay)) odd = !odd
    }
    return odd
  }

  /** Whether any of the silhouette lies within r of the point. */
  within(u: number, v: number, r: number): boolean {
    const c0 = this.col(u - r), c1 = this.col(u + r)
    const r0 = this.row(v - r), r1 = this.row(v + r)
    for (let rr = r0; rr <= r1; rr++) {
      for (let c = c0; c <= c1; c++) {
        const k = rr * this.bc + c
        for (let i = this.start[k]; i < this.start[k + 1]; i++) if (this.segDist(this.items[i], u, v) <= r) return true
      }
    }
    return false
  }

  /** The distance to the silhouette, searched ring by ring outwards. */
  distance(u: number, v: number): number {
    const c = Math.floor((u - this.u0) / this.size)
    const r = Math.floor((v - this.v0) / this.size)
    let best = Infinity
    const maxRing = Math.max(this.bc, this.br) + Math.abs(c) + Math.abs(r)
    for (let ring = 0; ring <= maxRing; ring++) {
      // Everything in a farther ring is at least (ring − 1) buckets away.
      if (best <= (ring - 1) * this.size) break
      for (let rr = r - ring; rr <= r + ring; rr++) {
        if (rr < 0 || rr >= this.br) continue
        const edge = rr === r - ring || rr === r + ring
        for (let cc = c - ring; cc <= c + ring; cc += edge ? 1 : 2 * ring) {
          if (cc >= 0 && cc < this.bc) {
            const k = rr * this.bc + cc
            for (let i = this.start[k]; i < this.start[k + 1]; i++) best = Math.min(best, this.segDist(this.items[i], u, v))
          }
          if (ring === 0) break
        }
      }
    }
    return best
  }

  /** The distance, negative inside. */
  signed(u: number, v: number): number {
    const d = this.distance(u, v)
    return this.inside(u, v) ? -d : d
  }
}

// ---- the offset ------------------------------------------------------------

/**
 * The loops of the silhouette offset by d (outwards for d > 0): the points
 * whose signed distance to the exact loops is d — rounded at convex corners
 * by d, as a real clearance is. Rasterised on a grid of its own (coarser for
 * a big offset, whose loops have no detail finer than it), traced, and
 * bisected onto that distance.
 */
function offsetLoops(ref: SegmentField, exact: readonly ExactLoop[], d: number, baseCell: number): { points: Pt[]; hole: boolean }[] & { cell: number } {
  if (Math.abs(d) < 1e-9) return Object.assign(exact.map((l) => ({ points: l.points, hole: l.hole })), { cell: baseCell })
  const cell = Math.max(baseCell, Math.abs(d) / 8)
  const pad = Math.max(d, 0) + 3 * cell
  const { u0: bu0, v0: bv0, u1: bu1, v1: bv1 } = ref.box
  const g: Grid = {
    cell,
    u0: bu0 - pad,
    v0: bv0 - pad,
    cols: Math.ceil((bu1 - bu0 + 2 * pad) / cell) + 1,
    rows: Math.ceil((bv1 - bv0 + 2 * pad) / cell) + 1,
  }
  const mask = new Uint8Array(g.cols * g.rows)
  // Inside the silhouette, row by row: even-odd over the exact loops.
  const xs: number[] = []
  for (let r = 0; r < g.rows; r++) {
    const y = g.v0 + (r + 0.5) * cell
    xs.length = 0
    for (const l of exact) {
      const n = l.points.length
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = l.points[j], b = l.points[i]
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
      }
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.u0) / cell - 0.5))
      const c1 = Math.min(g.cols - 1, Math.floor((xs[k + 1] - g.u0) / cell - 0.5))
      for (let c = c0; c <= c1; c++) mask[r * g.cols + c] = 1
    }
  }
  // The band within |d| of the silhouette flips: outside cells near enough
  // join (d > 0), inside cells near enough leave (d < 0).
  const reach = Math.abs(d)
  const seen = new Uint8Array(g.cols * g.rows)
  const flips: number[] = []
  for (const l of exact) {
    const n = l.points.length
    for (let i = 0; i < n; i++) {
      const a = l.points[i], b = l.points[(i + 1) % n]
      const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - g.u0) / cell - 0.5))
      const c1 = Math.min(g.cols - 1, Math.ceil((Math.max(a[0], b[0]) + reach - g.u0) / cell - 0.5))
      const r0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - g.v0) / cell - 0.5))
      const r1 = Math.min(g.rows - 1, Math.ceil((Math.max(a[1], b[1]) + reach - g.v0) / cell - 0.5))
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const k = r * g.cols + c
          if (seen[k]) continue
          seen[k] = 1
          const set = mask[k] !== 0
          if (set === d > 0) continue
          if (ref.within(g.u0 + (c + 0.5) * cell, g.v0 + (r + 0.5) * cell, reach)) flips.push(k)
        }
      }
    }
  }
  for (const k of flips) mask[k] = d > 0 ? 1 : 0
  const inside = d > 0
    ? (u: number, v: number) => ref.inside(u, v) || ref.within(u, v, reach)
    : (u: number, v: number) => ref.inside(u, v) && !ref.within(u, v, reach)
  const loops = maskLoops(mask, g, (3 * cell) ** 2).map((l) => ({
    hole: l.hole,
    points: l.points.map((p) => refineCrossing(p, g, mask, inside)),
  }))
  return Object.assign(loops, { cell })
}

// ---- reading a loop as pieces -----------------------------------------------

/** A loop read as lines and arcs at the tolerance — loopShape's reading made
 *  into pieces that meet end to end exactly. */
function readLoop(points: Pt[], tolerance: number, cell: number): ShadowPiece[] {
  if (points.length < 3) return []
  const shape = loopShape(points, tolerance, cell)
  return shapePieces(shape, points, tolerance)
}

const sub2 = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const dist2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Where on the line from a to b the foot of p lies, as a share of a → b. */
function along(p: Pt, a: Pt, b: Pt): number {
  const d = sub2(b, a)
  const l2 = d[0] * d[0] + d[1] * d[1]
  return l2 > 0 ? ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2 : 0
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/**
 * The arc from a to b nearest the circle fitted (centre c0, radius r0): its
 * centre on the bisector of a and b, at the fitted radius where the chord
 * allows, so that it starts and ends exactly where its neighbours do; and of
 * the two ways round, the one that passes nearer `via` — or, without one,
 * the shorter. Null where a and b coincide.
 */
function arcThrough(a: Pt, b: Pt, c0: Pt, r0: number, via?: Pt): ShadowPiece | null {
  const chord = dist2(a, b)
  if (chord < 1e-9) return null
  const r = Math.max(r0, chord / 2)
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const nrm: Pt = [-(b[1] - a[1]) / chord, (b[0] - a[0]) / chord]
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2))
  const p: Pt = [m[0] + nrm[0] * h, m[1] + nrm[1] * h]
  const q: Pt = [m[0] - nrm[0] * h, m[1] - nrm[1] * h]
  const center = dist2(p, c0) <= dist2(q, c0) ? p : q
  const a0 = Math.atan2(a[1] - center[1], a[0] - center[0])
  const a1 = Math.atan2(b[1] - center[1], b[0] - center[0])
  let short = a1 - a0
  while (short > Math.PI) short -= 2 * Math.PI
  while (short <= -Math.PI) short += 2 * Math.PI
  const long = short > 0 ? short - 2 * Math.PI : short + 2 * Math.PI
  let sweep = short
  if (via) {
    const at = (s: number): Pt => [center[0] + r * Math.cos(a0 + s / 2), center[1] + r * Math.sin(a0 + s / 2)]
    if (dist2(at(long), via) < dist2(at(short), via)) sweep = long
  }
  return { kind: 'arc', from: a, to: b, center, radius: r, sweep }
}

/** loopShape's corners, rounds and arcs as pieces end to end: a round's two
 *  lines stop where they touch it, and every arc runs exactly between the
 *  ends of its neighbours. */
function shapePieces(shape: LoopShape, traced: readonly Pt[], tolerance: number): ShadowPiece[] {
  if (shape.circle) return [{ kind: 'circle', center: shape.circle.center, radius: shape.circle.radius }]
  const P = shape.points.length
  if (P < 3) return []
  const pts = shape.points
  const at = (i: number) => pts[((i % P) + P) % P]
  const roundAt = new Map(shape.rounds.map((r) => [r.at, r]))
  const arcFrom = new Map(shape.arcs.map((a) => [a.from, a]))
  // Where each corner's sides start and end: the corner, or for a round the
  // feet of its centre on the two lines.
  const enter: Pt[] = pts.map((p) => p)
  const leave: Pt[] = pts.map((p) => p)
  const rounded = new Array<boolean>(P).fill(false)
  const fillets = new Map<number, Pt>()
  for (const [i, r] of roundAt) {
    // The fillet of the fitted radius between the two lines: its centre on
    // the corner's bisector, so it touches both exactly.
    const c = at(i)
    const l1 = dist2(at(i - 1), c)
    const l2 = dist2(c, at(i + 1))
    if (!(l1 > 0 && l2 > 0)) continue
    const d1: Pt = [(c[0] - at(i - 1)[0]) / l1, (c[1] - at(i - 1)[1]) / l1]
    const d2: Pt = [(at(i + 1)[0] - c[0]) / l2, (at(i + 1)[1] - c[1]) / l2]
    const half = Math.acos(Math.max(-1, Math.min(1, -(d1[0] * d2[0] + d1[1] * d2[1])))) / 2
    if (!(half > 1e-3 && half < Math.PI / 2 - 1e-3)) continue
    const back = r.radius / Math.tan(half)
    if (!(back < l1 && back < l2)) continue
    const bis: Pt = [d2[0] - d1[0], d2[1] - d1[1]]
    const bl = Math.hypot(bis[0], bis[1])
    const reach = r.radius / Math.sin(half)
    enter[i] = [c[0] - d1[0] * back, c[1] - d1[1] * back]
    leave[i] = [c[0] + d2[0] * back, c[1] + d2[1] * back]
    fillets.set(i, [c[0] + (bis[0] / bl) * reach, c[1] + (bis[1] / bl) * reach])
    rounded[i] = true
  }
  // Two rounds that overlap along the line between them: neither is kept.
  for (let i = 0; i < P; i++) {
    const j = (i + 1) % P
    if (!rounded[i] || !rounded[j]) continue
    if (along(enter[j], at(i), at(j)) < along(leave[i], at(i), at(j))) {
      rounded[i] = rounded[j] = false
      enter[i] = leave[i] = at(i)
      enter[j] = leave[j] = at(j)
    }
  }
  const n = traced.length
  const nearest = (p: Pt) => {
    let best = 0
    for (let k = 1; k < n; k++) if (dist2(traced[k], p) < dist2(traced[best], p)) best = k
    return best
  }
  const pieces: ShadowPiece[] = []
  for (let i = 0; i < P; i++) {
    const r = roundAt.get(i)
    if (rounded[i] && r) {
      const arc = arcThrough(enter[i], leave[i], fillets.get(i)!, r.radius)
      if (arc) pieces.push(arc)
    }
    const a = leave[i]
    const b = enter[(i + 1) % P]
    const side = arcFrom.get(i)
    if (side) {
      const ia = nearest(a)
      let ib = nearest(b)
      if (ib <= ia) ib += n
      const arc = arcThrough(a, b, side.center, side.radius, traced[Math.floor((ia + ib) / 2) % n])
      if (arc) pieces.push(arc)
    } else if (dist2(a, b) > 1e-9) pieces.push({ kind: 'line', from: a, to: b })
  }
  return mergeLines(pieces, tolerance / 4)
}

/** Two lines in a row along one straight side made one — where the loop
 *  was read from cut a side in two: the joint within `slack` of the line
 *  through their far ends. */
function mergeLines(pieces: ShadowPiece[], slack: number): ShadowPiece[] {
  const out = pieces.slice()
  const joinable = (a: ShadowPiece, b: ShadowPiece) =>
    a.kind === 'line' && b.kind === 'line' && segDist2(a.to, a.from, b.to) < slack &&
    (a.to[0] - a.from[0]) * (b.to[0] - b.from[0]) + (a.to[1] - a.from[1]) * (b.to[1] - b.from[1]) > 0
  for (let i = 0; out.length > 2 && i < out.length; ) {
    const j = (i + 1) % out.length
    const a = out[i]
    const b = out[j]
    if (a.kind === 'line' && b.kind === 'line' && joinable(a, b)) {
      out[i] = { kind: 'line', from: a.from, to: b.to }
      out.splice(j, 1)
      if (j < i) i--
    } else i++
  }
  return out
}

const segDist2 = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** A piece that left the band, drawn instead as the stretch of the offset
 *  loop it stands for — from the point nearest its start to the one nearest
 *  its end, the way the loop runs — thinned, its own two ends kept so its
 *  neighbours still meet it. A whole circle has no stretch: it stays. */
function patchPiece(pc: ShadowPiece, run: readonly Pt[], tolerance: number): ShadowPiece[] {
  if (pc.kind === 'circle') return [pc]
  const n = run.length
  const nearest = (p: Pt) => {
    let best = 0
    for (let k = 1; k < n; k++) if (dist2(run[k], p) < dist2(run[best], p)) best = k
    return best
  }
  const ia = nearest(pc.from)
  let ib = nearest(pc.to)
  if (ib <= ia) ib += n
  const pts: Pt[] = [pc.from]
  for (let k = ia + 1; k < ib; k++) pts.push(run[k % n])
  pts.push(pc.to)
  const flat = new Float64Array(pts.length * 2)
  pts.forEach((p, k) => {
    flat[k * 2] = p[0]
    flat[k * 2 + 1] = p[1]
  })
  const kept = simplifyRun(flat, 0, pts.length, tolerance)
  const out: ShadowPiece[] = []
  for (let k = 1; k < kept.length; k++) {
    const a = pts[kept[k - 1]]
    const b = pts[kept[k]]
    if (dist2(a, b) > 1e-9) out.push({ kind: 'line', from: a, to: b })
  }
  return out
}

/**
 * Every corner where two lines meet turning by less than `maxTurn` (radians)
 * rounded by the arc tangent to both: as large as half of each line allows,
 * so neighbouring rounds never overlap, and smaller — halved, a few times —
 * where `fits` says the arc leaves the band; a corner nothing fits stays
 * sharp. Lines are cut back to where the arcs touch them, so the loop runs on
 * without a kink. Corners beside an arc are left as they are.
 */
function roundCorners(pieces: readonly ShadowPiece[], maxTurn: number, fits: (arc: ShadowPiece[]) => boolean): ShadowPiece[] {
  const n = pieces.length
  if (n < 2) return pieces.slice()
  // Per corner k — where piece k ends and k + 1 starts — the arc, if any.
  const rounds: ({ enter: Pt; leave: Pt; arc: ShadowPiece } | null)[] = new Array(n).fill(null)
  for (let k = 0; k < n; k++) {
    const a = pieces[k]
    const b = pieces[(k + 1) % n]
    if (a.kind !== 'line' || b.kind !== 'line') continue
    const la = dist2(a.from, a.to)
    const lb = dist2(b.from, b.to)
    if (!(la > 0 && lb > 0)) continue
    const d1: Pt = [(a.to[0] - a.from[0]) / la, (a.to[1] - a.from[1]) / la]
    const d2: Pt = [(b.to[0] - b.from[0]) / lb, (b.to[1] - b.from[1]) / lb]
    const turnSign = d1[0] * d2[1] - d1[1] * d2[0]
    const turn = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])))
    if (!(turn >= MIN_TURN && turn < maxTurn)) continue
    const c = a.to
    const t = Math.tan(turn / 2)
    // Its centre to the side the loop turns to.
    const side: Pt = turnSign > 0 ? [-d1[1], d1[0]] : [d1[1], -d1[0]]
    for (let back = Math.min(la, lb) / 2, tries = 0; tries < 6; tries++, back /= 2) {
      const radius = back / t
      const enter: Pt = [c[0] - d1[0] * back, c[1] - d1[1] * back]
      const leave: Pt = [c[0] + d2[0] * back, c[1] + d2[1] * back]
      const center: Pt = [enter[0] + side[0] * radius, enter[1] + side[1] * radius]
      const arc: ShadowPiece = { kind: 'arc', from: enter, to: leave, center, radius, sweep: turnSign > 0 ? turn : -turn }
      if (fits([arc])) {
        rounds[k] = { enter, leave, arc }
        break
      }
    }
  }
  const out: ShadowPiece[] = []
  for (let k = 0; k < n; k++) {
    const p = pieces[k]
    const before = rounds[(k + n - 1) % n]
    const after = rounds[k]
    if (p.kind === 'line') {
      const from = before ? before.leave : p.from
      const to = after ? after.enter : p.to
      if (dist2(from, to) > 1e-9) out.push({ kind: 'line', from, to })
    } else out.push(p)
    if (after) out.push(after.arc)
  }
  return out
}

/**
 * Teeth pulled: a short line between two lines whose ends turn opposite ways
 * — a corner the reading took as two with a stub between, or a wave of the
 * scan followed — replaced by the first of these that `fits` says stays in
 * the band: its neighbours run on to where they cross; the stub folded into
 * the line before it, or after it, so one of its two turns goes; one line
 * from the first's start to the last's end. A tooth nothing replaces stays:
 * it is the part's own jog.
 */
function pullTeeth(pieces: readonly ShadowPiece[], short: number, fits: (pieces: ShadowPiece[]) => boolean): ShadowPiece[] {
  let out = pieces.slice()
  const cross = (p: Pt, q: Pt) => p[0] * q[1] - p[1] * q[0]
  for (let i = 0; out.length > 3 && i < out.length; ) {
    const n = out.length
    const a = out[(i + n - 1) % n]
    const b = out[i]
    const c = out[(i + 1) % n]
    let fix: ShadowPiece[] | null = null
    if (a.kind === 'line' && b.kind === 'line' && c.kind === 'line' && dist2(b.from, b.to) <= short) {
      const da = sub2(a.to, a.from)
      const db = sub2(b.to, b.from)
      const dc = sub2(c.to, c.from)
      if (cross(da, db) * cross(db, dc) < 0) {
        const tries: ShadowPiece[][] = []
        const den = cross(da, dc)
        if (Math.abs(den) > 1e-12 * Math.hypot(...da) * Math.hypot(...dc)) {
          const w = sub2(c.from, a.from)
          const s = cross(w, dc) / den
          const t = cross(w, da) / den
          // The crossing past a's start and short of c's end, so neither
          // line turns back on itself.
          if (s > 0 && t < 1) {
            const x: Pt = [a.from[0] + s * da[0], a.from[1] + s * da[1]]
            tries.push([{ kind: 'line', from: a.from, to: x }, { kind: 'line', from: x, to: c.to }])
          }
        }
        tries.push(
          [{ kind: 'line', from: a.from, to: b.to }, c],
          [a, { kind: 'line', from: b.from, to: c.to }],
          [{ kind: 'line', from: a.from, to: c.to }],
        )
        fix = tries.find(fits) ?? null
      }
    }
    if (!fix) {
      i++
      continue
    }
    // The three taken out, the loop turned to start where they were.
    const start = (i + n - 1) % n
    const turned = [...out.slice(start), ...out.slice(0, start)]
    out = [...fix, ...turned.slice(3)]
    i = 0
  }
  return out
}

/** A loop kept as a run of short lines, thinned to the tolerance. */
function polygonPieces(points: readonly Pt[], tolerance: number): ShadowPiece[] {
  const n = points.length
  if (n < 3) return []
  const flat = new Float64Array((n + 1) * 2)
  for (let i = 0; i <= n; i++) {
    flat[i * 2] = points[i % n][0]
    flat[i * 2 + 1] = points[i % n][1]
  }
  const kept = simplifyRun(flat, 0, n + 1, tolerance)
  const out: ShadowPiece[] = []
  for (let k = 1; k < kept.length; k++) {
    const a: Pt = [flat[kept[k - 1] * 2], flat[kept[k - 1] * 2 + 1]]
    const b: Pt = [flat[kept[k] * 2], flat[kept[k] * 2 + 1]]
    if (dist2(a, b) > 1e-9) out.push({ kind: 'line', from: a, to: b })
  }
  return out
}

// ---- sampling ----------------------------------------------------------------

/** Points along a piece, its start included and its end not, `step` mm
 *  apart at most (arcs also to ARC_SAGITTA), each with the outward
 *  direction — the right of the way it runs. */
function samplePiece(p: ShadowPiece, step: number, out: { pts: number[]; nrm: number[] }): void {
  if (p.kind === 'line') {
    const len = dist2(p.from, p.to)
    const k = Math.max(1, Math.ceil(len / step))
    const tx = (p.to[0] - p.from[0]) / len
    const ty = (p.to[1] - p.from[1]) / len
    for (let j = 0; j < k; j++) {
      const q = lerp(p.from, p.to, j / k)
      out.pts.push(q[0], q[1])
      out.nrm.push(ty, -tx)
    }
    return
  }
  const sweep = p.kind === 'circle' ? 2 * Math.PI : p.sweep
  const start = p.kind === 'circle' ? 0 : Math.atan2(p.from[1] - p.center[1], p.from[0] - p.center[0])
  const r = p.radius
  const byChord = r > ARC_SAGITTA ? 2 * Math.acos(1 - ARC_SAGITTA / r) : Math.PI / 4
  const dA = Math.min(byChord, step / Math.max(r, 1e-9), Math.PI / 8)
  const k = Math.max(2, Math.ceil(Math.abs(sweep) / dA))
  const sign = sweep >= 0 ? 1 : -1
  for (let j = 0; j < k; j++) {
    const t = start + (sweep * j) / k
    const cx = Math.cos(t)
    const cy = Math.sin(t)
    if (j === 0 && p.kind === 'arc') out.pts.push(p.from[0], p.from[1])
    else out.pts.push(p.center[0] + r * cx, p.center[1] + r * cy)
    out.nrm.push(sign * cx, sign * cy)
  }
}

function sampleLoop(pieces: readonly ShadowPiece[], step: number): { pts: number[]; nrm: number[] } {
  const out = { pts: [] as number[], nrm: [] as number[] }
  for (const p of pieces) samplePiece(p, step, out)
  return out
}

/** The area a loop encloses, signed: positive counter-clockwise. */
function loopArea(pieces: readonly ShadowPiece[]): number {
  // The polygon through the ends, plus each arc's segment beyond its chord.
  let s = 0
  for (const p of pieces) {
    if (p.kind === 'circle') return Math.PI * p.radius * p.radius
    s += (p.from[0] * p.to[1] - p.to[0] * p.from[1]) / 2
    if (p.kind === 'arc') s += (p.radius * p.radius * (p.sweep - Math.sin(p.sweep))) / 2
  }
  return s
}

/** A loop turned to run with the material on its left: outer loops
 *  counter-clockwise, holes clockwise. */
function orient(l: ShadowLoop): ShadowLoop {
  const ccw = loopArea(l.pieces) > 0
  if (ccw !== l.hole) return l
  const pieces = l.pieces
    .slice()
    .reverse()
    .map((p): ShadowPiece => (p.kind === 'line' ? { kind: 'line', from: p.to, to: p.from } : p.kind === 'arc' ? { ...p, from: p.to, to: p.from, sweep: -p.sweep } : p))
  // A circle has no way round of its own: it runs as its loop says.
  return { hole: l.hole, pieces }
}

/** How far the pieces lie outside the exact silhouette, nearest and
 *  farthest, sampled finely. */
function measureMargin(loops: readonly ShadowLoop[], ref: SegmentField, cell: number): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const l of loops) {
    const { pts } = sampleLoop(l.pieces, cell / 2)
    for (let i = 0; i < pts.length; i += 2) {
      const d = ref.signed(pts[i], pts[i + 1])
      if (d < min) min = d
      if (d > max) max = d
    }
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 }
}

/** The loops as a SectionCut on the frame's plane: sampled `step` apart,
 *  closed by repeating the first point, with the outward direction. */
function liftLoops(loops: readonly ShadowLoop[], frame: SectionFrame, step: number): SectionCut {
  const sampled = loops.map((l) => {
    const s = sampleLoop(l.pieces, step)
    // A circle is sampled counter-clockwise; a hole runs the other way.
    if (l.pieces.length === 1 && l.pieces[0].kind === 'circle' && l.hole) {
      const n = s.pts.length / 2
      const pts: number[] = []
      const nrm: number[] = []
      for (let i = n - 1; i >= 0; i--) {
        pts.push(s.pts[i * 2], s.pts[i * 2 + 1])
        nrm.push(-s.nrm[i * 2], -s.nrm[i * 2 + 1])
      }
      return { pts, nrm }
    }
    return s
  })
  let total = 0
  for (const s of sampled) total += s.pts.length / 2 + 1
  const points = new Float32Array(total * 3)
  const normals = new Float32Array(total * 3)
  const offsets = new Uint32Array(sampled.length + 1)
  const [ox, oy, oz] = frame.origin
  const [ux, uy, uz] = frame.basisU
  const [vx, vy, vz] = frame.basisV
  let at = 0
  sampled.forEach((s, li) => {
    offsets[li] = at
    const n = s.pts.length / 2
    for (let j = 0; j <= n; j++) {
      const i = j % n
      const u = s.pts[i * 2]
      const v = s.pts[i * 2 + 1]
      const a = s.nrm[i * 2]
      const b = s.nrm[i * 2 + 1]
      points[at * 3] = ox + u * ux + v * vx
      points[at * 3 + 1] = oy + u * uy + v * vy
      points[at * 3 + 2] = oz + u * uz + v * vz
      normals[at * 3] = a * ux + b * vx
      normals[at * 3 + 1] = a * uy + b * vy
      normals[at * 3 + 2] = a * uz + b * vz
      at++
    }
  })
  offsets[sampled.length] = at
  return { points, offsets, normals }
}

/** "2 loops · 11 243 mm²" and the band the contour lies in — the readout's
 *  words, and the row's, in `units`. */
export function describeShadow(sh: ShadowShape, units: DisplayUnits = 'mm'): { loops: string; area: string; band: string } {
  const n = sh.loops.length
  const mm = (v: number) => `${v < 0 ? '−' : ''}${fmtLen(Math.abs(v), units, 2, { bare: true })}`
  return {
    loops: `${n} loop${n === 1 ? '' : 's'}`,
    // A whole number of square millimetres; square inches to three decimals.
    area: units === 'in' ? fmtArea(sh.area, units, 0) : `${Math.round(sh.area).toLocaleString('en-US')} ${unitWord(units, 2)}`,
    band: `${mm(sh.margin.min)} to ${mm(sh.margin.max)} ${unitWord(units)} outside the part`,
  }
}

/** The contour as the 2D sheet's fits — a LINE, ARC or CIRCLE each, for the
 *  drawing exports: an arc counter-clockwise from its start, as those take
 *  it, whichever way the loop runs. */
export function shadowFlatFits(sh: ShadowShape): FlatFit[] {
  const base = { sigma: 0, usedPoints: 0 }
  const out: FlatFit[] = []
  for (const l of sh.loops) {
    for (const p of l.pieces) {
      if (p.kind === 'circle') out.push({ kind: 'circle', center: [p.center[0], p.center[1]], radius: p.radius, ...base })
      else if (p.kind === 'line') {
        const length = dist2(p.from, p.to)
        if (length <= 0) continue
        out.push({
          kind: 'line',
          center: [(p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2],
          dir: [(p.to[0] - p.from[0]) / length, (p.to[1] - p.from[1]) / length],
          length,
          ...base,
        })
      } else {
        const begin = p.sweep >= 0 ? p.from : p.to
        out.push({
          kind: 'arc',
          center: [p.center[0], p.center[1]],
          radius: p.radius,
          start: Math.atan2(begin[1] - p.center[1], begin[0] - p.center[0]),
          sweep: Math.abs(p.sweep),
          ...base,
        })
      }
    }
  }
  return out
}

/** The outline as regions — each outer loop with the holes that lie in it,
 *  the nearest one round them — as a solid made of it needs them: one body
 *  per outer loop, its holes as inner bounds. */
export function shadowRegions(sh: ShadowShape): { outer: ShadowLoop; holes: ShadowLoop[] }[] {
  const outers = sh.loops.filter((l) => !l.hole)
  const polys = outers.map((l) => outlinePoints(l.pieces, Math.PI / 36))
  const area = outers.map((l) => Math.abs(loopArea(l.pieces)))
  const regions = outers.map((outer) => ({ outer, holes: [] as ShadowLoop[] }))
  for (const hole of sh.loops.filter((l) => l.hole)) {
    const at = outlinePoints(hole.pieces, Math.PI / 36)[0]
    let best = -1
    for (let i = 0; i < outers.length; i++) {
      if (inPolygon(at, polys[i]) && (best < 0 || area[i] < area[best])) best = i
    }
    if (best >= 0) regions[best].holes.push(hole)
  }
  return regions
}

/** A loop as a polygon for drawing: a line's ends, an arc in steps of at
 *  most `arcStep` radians — closed, the first point not repeated. */
export function outlinePoints(pieces: readonly ShadowPiece[], arcStep: number): Pt[] {
  const out: Pt[] = []
  for (const p of pieces) {
    if (p.kind === 'line') {
      out.push(p.from)
      continue
    }
    const sweep = p.kind === 'circle' ? 2 * Math.PI : p.sweep
    const a0 = p.kind === 'circle' ? 0 : Math.atan2(p.from[1] - p.center[1], p.from[0] - p.center[0])
    const k = Math.max(p.kind === 'circle' ? 16 : 2, Math.ceil(Math.abs(sweep) / arcStep))
    for (let j = 0; j < k; j++) {
      if (j === 0 && p.kind === 'arc') out.push(p.from)
      else out.push([p.center[0] + p.radius * Math.cos(a0 + (sweep * j) / k), p.center[1] + p.radius * Math.sin(a0 + (sweep * j) / k)])
    }
  }
  return out
}

function inPolygon(q: Pt, p: readonly Pt[]): boolean {
  let x = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > q[1] !== p[j][1] > q[1] && q[0] < ((p[j][0] - p[i][0]) * (q[1] - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) x = !x
  }
  return x
}
