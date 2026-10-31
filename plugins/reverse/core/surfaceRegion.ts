// SPDX-License-Identifier: AGPL-3.0-only
// A fitted surface against the region it was fitted through. The fit
// reaches past its region by a margin (expandPct), its quadratics free
// there, and a split carries it on further along the slope at its edge
// (surfaceFit reachingGridOf): past the region nothing holds it to the
// scan. A band whose region was cut where it still curves came out 1.4 mm
// off the scan just past it, and the split by it cut a block's top 5 mm
// under the scan outside the band (round 20, the mirror holder's swage).
// What is read here, over the fit's plane:
//  - the region's footprint (SurfaceFitResult footprint) as a field of
//    each node's distance to the nearest of its points (regionField);
//  - how far the surface as fitted stands off the scan past its region,
//    in the rectangle it spans (pastRegion);
//  - how far a split's cut face lies off the scan past the region
//    (offPastRegion);
//  - the region's outline grown by a margin, as loops (regionOutline):
//    what a split within the region (SplitFeature within) cuts inside.
// "Off the scan" is where the scan lies under the surface along its
// height direction: a point whose nearest scan point lies off to the side
// is past the part's edge, and not read.

import type { Vec3 } from '../../../src/core/types'
import { evalSurface, type SurfaceFitResult } from './surfaceFit'

/** How far past its region a surface may stand off the scan before the
 *  fit says so, mm — the split's tolerance's default; a fit has none of
 *  its own. */
export const PAST_REGION_MM = 0.2
/** The nodes a side the field over a fit's rectangle takes at most, and
 *  all of it — the cell grows past the points' spacing to keep to them. */
const FIELD_SIDE = 160
const FIELD_NODES = 250_000
/** A point of the scan lies under a point of the surface when the line
 *  between them stands within 60° of the height direction (tan 60°), or
 *  within a cell of it aside. */
const UNDER_TAN = Math.sqrt(3)
/** How many points a region's spacing is read at, at most. */
const SPACING_SAMPLES = 600

/** A field over a rectangle of a fit's plane: each node's distance to the
 *  nearest of the points, mm — Infinity where none was found. Node (r, c)
 *  lies at (u0 + c·cell, v0 + r·cell); `dist` is row-major. */
export interface RegionField {
  u0: number
  v0: number
  cell: number
  cols: number
  rows: number
  dist: Float32Array
}

/** The scan's nearest point to a point, within reach — or null. */
export type NearScan = (p: Vec3) => Vec3 | null

/** The points' spacing: the median distance from one to its nearest
 *  neighbour, read at up to SPACING_SAMPLES of them. Zero for fewer than
 *  two. */
export function pointSpacing(uv: ArrayLike<number>): number {
  const n = uv.length >> 1
  if (n < 2) return 0
  let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity
  for (let i = 0; i < n; i++) {
    uLo = Math.min(uLo, uv[i * 2])
    uHi = Math.max(uHi, uv[i * 2])
    vLo = Math.min(vLo, uv[i * 2 + 1])
    vHi = Math.max(vHi, uv[i * 2 + 1])
  }
  // A cell no narrower than the spacing of points spread over the whole
  // box: a point's nearest neighbour lies in its cell or one beside it.
  const cell = Math.max(Math.sqrt(Math.max((uHi - uLo) * (vHi - vLo), 1e-12) / n), (Math.max(uHi - uLo, vHi - vLo) || 1) / 4096, 1e-6)
  const cols = Math.floor((vHi - vLo) / cell) + 1
  const cells = new Map<number, number[]>()
  const keyOf = (cu: number, cv: number) => cu * cols + cv
  for (let i = 0; i < n; i++) {
    const k = keyOf(Math.floor((uv[i * 2] - uLo) / cell), Math.floor((uv[i * 2 + 1] - vLo) / cell))
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  }
  const step = Math.max(1, Math.floor(n / SPACING_SAMPLES))
  const nearest: number[] = []
  for (let i = 0; i < n; i += step) {
    const cu = Math.floor((uv[i * 2] - uLo) / cell), cv = Math.floor((uv[i * 2 + 1] - vLo) / cell)
    let best = Infinity
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        if (cv + b < 0 || cv + b >= cols) continue
        for (const j of cells.get(keyOf(cu + a, cv + b)) ?? []) {
          const d = Math.hypot(uv[j * 2] - uv[i * 2], uv[j * 2 + 1] - uv[i * 2 + 1])
          if (j !== i && d > 1e-9 && d < best) best = d
        }
      }
    }
    if (Number.isFinite(best)) nearest.push(best)
  }
  if (nearest.length === 0) return cell
  nearest.sort((a, b) => a - b)
  return nearest[nearest.length >> 1]
}

/** The field of the points' distance over the rectangle u × v, `cell`
 *  apart — no finer than FIELD_NODES allows. Each node starts from the
 *  points nearest it and takes its neighbours' nearest points over in two
 *  passes, forward and back (a vector distance transform): within a
 *  fraction of the cell of the true distance, at the cost of two sweeps
 *  of the grid. */
export function regionField(uv: ArrayLike<number>, u: readonly [number, number], v: readonly [number, number], cell: number): RegionField {
  const area = Math.max((u[1] - u[0]) * (v[1] - v[0]), 1e-12)
  cell = Math.max(cell, Math.sqrt(area / FIELD_NODES), 1e-6)
  const cols = Math.floor((u[1] - u[0]) / cell) + 2
  const rows = Math.floor((v[1] - v[0]) / cell) + 2
  const count = cols * rows
  const su = new Float64Array(count).fill(NaN)
  const sv = new Float64Array(count).fill(NaN)
  const dist = new Float32Array(count).fill(Infinity)
  const n = uv.length >> 1
  for (let i = 0; i < n; i++) {
    const pu = uv[i * 2], pv = uv[i * 2 + 1]
    const c = Math.round((pu - u[0]) / cell), r = Math.round((pv - v[0]) / cell)
    if (c < 0 || c >= cols || r < 0 || r >= rows) continue
    const at = r * cols + c
    const d = Math.hypot(u[0] + c * cell - pu, v[0] + r * cell - pv)
    if (d < dist[at]) {
      dist[at] = d
      su[at] = pu
      sv[at] = pv
    }
  }
  const take = (at: number, from: number, uu: number, vv: number) => {
    if (Number.isNaN(su[from])) return
    const d = Math.hypot(uu - su[from], vv - sv[from])
    if (d < dist[at]) {
      dist[at] = d
      su[at] = su[from]
      sv[at] = sv[from]
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const at = r * cols + c, uu = u[0] + c * cell, vv = v[0] + r * cell
      if (r > 0) {
        if (c > 0) take(at, at - cols - 1, uu, vv)
        take(at, at - cols, uu, vv)
        if (c + 1 < cols) take(at, at - cols + 1, uu, vv)
      }
      if (c > 0) take(at, at - 1, uu, vv)
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const at = r * cols + c, uu = u[0] + c * cell, vv = v[0] + r * cell
      if (r + 1 < rows) {
        if (c + 1 < cols) take(at, at + cols + 1, uu, vv)
        take(at, at + cols, uu, vv)
        if (c > 0) take(at, at + cols - 1, uu, vv)
      }
      if (c + 1 < cols) take(at, at + 1, uu, vv)
    }
  }
  return { u0: u[0], v0: v[0], cell, cols, rows, dist }
}

/** The field's distance at (u, v): its nearest node's — Infinity off the
 *  field. */
export function fieldAt(f: RegionField, u: number, v: number): number {
  const c = Math.round((u - f.u0) / f.cell), r = Math.round((v - f.v0) / f.cell)
  if (c < 0 || c >= f.cols || r < 0 || r >= f.rows) return Infinity
  return f.dist[r * f.cols + c]
}

/** How far a point of the surface lies off the scan under it, or null
 *  where the scan's nearest point lies off to the side — past the part's
 *  edge — or there is none within reach. */
function offScan(p: Vec3, normal: Vec3, near: NearScan, aside: number): number | null {
  const q = near(p)
  if (!q) return null
  const d: Vec3 = [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
  const off = Math.hypot(d[0], d[1], d[2])
  const along = Math.abs(d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2])
  const across = Math.sqrt(Math.max(0, off * off - along * along))
  return across <= Math.max(aside, UNDER_TAN * along) ? off : null
}

/** Where a surface stands furthest off the scan, and how far, mm. */
export interface PastRegion {
  off: number
  at: Vec3
}

/** How far the surface as fitted stands off the scan past its region: in
 *  the rectangle it spans, at the nodes further than the region's spacing
 *  from every point of it — the margin, and any hole the region has — the
 *  surface's distance from the scan under it, the largest and where. Null
 *  with no footprint, or no scan under the margin. */
export function pastRegion(fit: SurfaceFitResult, near: NearScan): PastRegion | null {
  const uv = fit.footprint
  if (!uv || uv.length < 8) return null
  const spacing = pointSpacing(uv)
  const extent = Math.max(fit.uRange[1] - fit.uRange[0], fit.vRange[1] - fit.vRange[0])
  const field = regionField(uv, fit.uRange, fit.vRange, Math.max(spacing, extent / FIELD_SIDE))
  let worst: PastRegion | null = null
  for (let r = 0; r < field.rows; r++) {
    const vv = field.v0 + r * field.cell
    if (vv > fit.vRange[1]) break
    for (let c = 0; c < field.cols; c++) {
      const uu = field.u0 + c * field.cell
      if (uu > fit.uRange[1]) break
      if (!(field.dist[r * field.cols + c] > spacing)) continue
      const p = evalSurface(fit, uu, vv)
      const off = offScan(p, fit.normal, near, field.cell)
      if (off !== null && (!worst || off > worst.off)) worst = { off, at: p }
    }
  }
  return worst
}

/** How much of a split's cut face lies off the scan past a tool's region:
 *  the most, mm; the area further off than the tolerance, mm²; and where
 *  the most is. */
export interface OffPastRegion {
  max: number
  area: number
  at: Vec3
}

/** How far points spread over a cut face on a fitted tool (xyz flat, each
 *  standing for `areas` of it) lie off the scan, of those past the tool's
 *  region — further than its spacing from every point of it, over its
 *  plane. Null where none past the region has the scan under it. */
export function offPastRegion(fit: SurfaceFitResult, points: ArrayLike<number>, areas: ArrayLike<number>, near: NearScan, tolerance: number): OffPastRegion | null {
  const uv = fit.footprint
  if (!uv || uv.length < 8) return null
  const spacing = pointSpacing(uv)
  const box = boxOf(uv, 2 * spacing)
  const field = regionField(uv, box.u, box.v, Math.max(spacing, Math.max(box.u[1] - box.u[0], box.v[1] - box.v[0]) / FIELD_SIDE))
  let out: OffPastRegion | null = null
  for (let i = 0; i < areas.length; i++) {
    const p: Vec3 = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]
    const d: Vec3 = [p[0] - fit.origin[0], p[1] - fit.origin[1], p[2] - fit.origin[2]]
    const uu = d[0] * fit.axisU[0] + d[1] * fit.axisU[1] + d[2] * fit.axisU[2]
    const vv = d[0] * fit.axisV[0] + d[1] * fit.axisV[1] + d[2] * fit.axisV[2]
    if (!(fieldAt(field, uu, vv) > spacing)) continue
    const off = offScan(p, fit.normal, near, field.cell)
    if (off === null) continue
    out ??= { max: 0, area: 0, at: p }
    if (off > out.max) [out.max, out.at] = [off, p]
    if (off > tolerance) out.area += areas[i]
  }
  return out
}

/** The (u, v) box round the points, `pad` wider every way. */
function boxOf(uv: ArrayLike<number>, pad: number): { u: [number, number]; v: [number, number] } {
  let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity
  for (let i = 0; i + 1 < uv.length; i += 2) {
    uLo = Math.min(uLo, uv[i])
    uHi = Math.max(uHi, uv[i])
    vLo = Math.min(vLo, uv[i + 1])
    vHi = Math.max(vHi, uv[i + 1])
  }
  return { u: [uLo - pad, uHi + pad], v: [vLo - pad, vHi + pad] }
}

/** A region's outline grown by a margin, over its fit's plane: the outer
 *  loops, counter-clockwise in (u, v), holes filled; the field they were
 *  drawn on and the distance they lie at. */
export interface RegionOutline {
  loops: [number, number][][]
  field: RegionField
  level: number
}

/**
 * The region's outline grown by `margin` mm: the line round its points at
 * the margin plus their spacing — the spacing so the gaps between the
 * points close — drawn through the distance field (marching squares), the
 * holes left out, and thinned to within a twentieth of that distance, or a
 * quarter of the field's cell (Ramer–Douglas–Peucker): each side is a wall
 * where the cut within it stops. Null with no footprint or no loop.
 */
export function regionOutline(fit: SurfaceFitResult, margin: number): RegionOutline | null {
  const uv = fit.footprint
  if (!uv || uv.length < 8) return null
  const spacing = pointSpacing(uv)
  const level = Math.max(0, margin) + spacing
  const span = boxOf(uv, 0)
  const extent = Math.max(span.u[1] - span.u[0], span.v[1] - span.v[0])
  const cell = Math.max(spacing / 2, extent / (2 * FIELD_SIDE))
  const box = boxOf(uv, level + 2 * cell)
  const field = regionField(uv, box.u, box.v, cell)
  const loops = levelLoops(field, level)
    .filter((l) => loopArea(l) > 0)
    .map((l) => thinLoop(l, Math.max(field.cell / 4, level / 20)))
    .filter((l) => l.length >= 3)
  return loops.length > 0 ? { loops, field, level } : null
}

/** The lines where the field crosses `level`, as closed loops with the
 *  inside (the field at or under the level) on their left: outer loops
 *  counter-clockwise, holes clockwise. Each square of four nodes adds the
 *  pieces its corners call for, a saddle's by the value at its middle. */
function levelLoops(f: RegionField, level: number): [number, number][][] {
  const { cols, rows, dist, cell, u0, v0 } = f
  const inside = (r: number, c: number) => dist[r * cols + c] <= level
  // An edge between two nodes by a key: along u from (r, c), or along v.
  const hKey = (r: number, c: number) => (r * cols + c) * 2
  const vKey = (r: number, c: number) => (r * cols + c) * 2 + 1
  const pointOn = (key: number): [number, number] => {
    const node = key >> 1
    const r = Math.floor(node / cols), c = node % cols
    const r2 = key & 1 ? r + 1 : r, c2 = key & 1 ? c : c + 1
    const a = dist[r * cols + c], b = dist[r2 * cols + c2]
    const fa = Number.isFinite(a) ? a : level * 4 + cell * 4
    const fb = Number.isFinite(b) ? b : level * 4 + cell * 4
    const t = Math.abs(fb - fa) > 1e-12 ? Math.min(1, Math.max(0, (level - fa) / (fb - fa))) : 0.5
    return [u0 + (c + (c2 - c) * t) * cell, v0 + (r + (r2 - r) * t) * cell]
  }
  const next = new Map<number, number>()
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      // Round the square counter-clockwise: bottom, right, top, left —
      // each edge from the corner it leaves to the one it reaches.
      const corner = [inside(r, c), inside(r, c + 1), inside(r + 1, c + 1), inside(r + 1, c)]
      const edges = [hKey(r, c), vKey(r, c + 1), hKey(r + 1, c), vKey(r, c)]
      const leaving: number[] = []
      const entering: number[] = []
      for (let e = 0; e < 4; e++) {
        const a = corner[e], b = corner[(e + 1) % 4]
        if (a && !b) leaving.push(e)
        else if (!a && b) entering.push(e)
      }
      if (leaving.length === 0) continue
      if (leaving.length === 1) {
        next.set(edges[leaving[0]], edges[entering[0]])
        continue
      }
      // A saddle: the inside corners joined through the middle when it is
      // inside — each leaving edge to the entering one after it, going
      // round — and kept apart when not, to the one before it.
      const middle = (dist[r * cols + c] + dist[r * cols + c + 1] + dist[(r + 1) * cols + c + 1] + dist[(r + 1) * cols + c]) / 4 <= level
      for (const e of leaving) next.set(edges[e], edges[middle ? (e + 1) % 4 : (e + 3) % 4])
    }
  }
  const loops: [number, number][][] = []
  const seen = new Set<number>()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: [number, number][] = []
    let at: number | undefined = start
    while (at !== undefined && !seen.has(at)) {
      seen.add(at)
      loop.push(pointOn(at))
      at = next.get(at)
    }
    if (at === start && loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** A closed loop's signed area: positive counter-clockwise. */
function loopArea(loop: readonly [number, number][]): number {
  let a = 0
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

/** A closed loop thinned to the corners that keep it within `tolerance`
 *  of where it ran (Ramer–Douglas–Peucker, from its two points furthest
 *  apart). */
function thinLoop(loop: [number, number][], tolerance: number): [number, number][] {
  if (loop.length <= 4) return loop
  let far = 0, best = -1
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1])
    if (d > best) [best, far] = [d, i]
  }
  const keep = new Uint8Array(loop.length)
  keep[0] = keep[far] = 1
  const run = (from: number, to: number) => {
    // from … to going round, to after from.
    const count = (to - from + loop.length) % loop.length
    if (count < 2) return
    const a = loop[from], b = loop[to % loop.length]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    let worst = -1, at = -1
    for (let k = 1; k < count; k++) {
      const p = loop[(from + k) % loop.length]
      const d = length > 1e-12 ? Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length : Math.hypot(p[0] - a[0], p[1] - a[1])
      if (d > worst) [worst, at] = [d, (from + k) % loop.length]
    }
    if (worst > tolerance) {
      keep[at] = 1
      run(from, at)
      run(at, to)
    }
  }
  run(0, far)
  run(far, 0)
  return loop.filter((_, i) => keep[i])
}
