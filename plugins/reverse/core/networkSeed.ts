// SPDX-License-Identifier: AGPL-3.0-only
// A point well inside a loop drawn on the scan: the seed a patch placed by
// its corners is filled at (PN4). The cell reader takes a region by the
// point inside it, and the patch's corners move afterwards — dragged, or a
// neighbour's put on its side — so the seed is put as far from the loop as
// it can be, not just over its first edge.
//
// The loop is seen along the way it faces — its vector area, the normal
// integrated over any surface it bounds, turned to agree with the scan's
// normals along it. A plain mean of the normals at its points is not that:
// the points lie closer on some sides than others, and round a strip of
// 270° of a cylinder the strip's two straight ends outweighed its arcs and
// the mean pointed out of the gap. Seen so, the loop is flattened onto the
// plane across it, and the point of that polygon farthest from its sides is
// found on a
// grid — the middle of a square, the inside of an L's corner, not its
// centroid, which an L or a U puts outside. That point is taken back onto
// the scan along the normal: of the scan's crossings with the line there,
// the one nearest the plane among those facing the loop's way. The facing
// matters on a shell: a loop round the outside of a housing has its plane
// below the skin, often under the inner wall too, and the inner wall —
// nearer, facing in — is the wrong one (a 60° cap of a shell 1.5 mm thick).
//
// A loop the flattening folds over — a strip round more than half a
// cylinder — has no such polygon; nor has one whose seed, so found, comes
// out within MARGIN_EDGES of the loop. Then the seed is stepped in from
// the loop's sides, across them on the scan, to the farthest that stays
// inside the polygon there.

import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'

/** The grid the flattened loop is searched on, a side, and once more round
 *  the best of it. */
const GRID = 24
/** How far from the loop a seed must be, in the scan's edges. */
const MARGIN_EDGES = 2
/** The loop's points used at most: a few hundred carry its shape. */
const MAX_POINTS = 400

/** A point on the scan inside a closed loop of points on it (x, y, z
 *  each, the last joined to the first), or null for a loop too small. */
export function seedInside(scan: ScanPaths, outline: ArrayLike<number>): Vec3 | null {
  const all = Math.floor(outline.length / 3)
  if (all < 3) return null
  const stride = Math.max(1, Math.ceil(all / MAX_POINTS))
  const pts: Vec3[] = []
  for (let i = 0; i < all; i += stride) pts.push([outline[i * 3], outline[i * 3 + 1], outline[i * 3 + 2]])
  const m = pts.length
  if (m < 3) return null
  // The loop's middle, and the way it faces: its vector area (Newell's),
  // turned the way the scan's normals along it lean, each by the length of
  // loop it stands for.
  const c: Vec3 = [0, 0, 0]
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / m
  const n: Vec3 = [0, 0, 0]
  for (let i = 0; i < m; i++) {
    const w = cross(sub(pts[i], c), sub(pts[(i + 1) % m], c))
    for (let k = 0; k < 3; k++) n[k] += w[k] / 2
  }
  const nl = Math.hypot(n[0], n[1], n[2])
  if (!(nl > 0)) return null
  for (let k = 0; k < 3; k++) n[k] /= nl
  let lean = 0
  for (let i = 0; i < m; i++) {
    const on = scan.closestInside(pts[i])
    if (on) lean += dot(scan.triangleNormal(on.triangle), n) * Math.hypot(...sub(pts[(i + 1) % m], pts[i]))
  }
  if (lean < 0) for (let k = 0; k < 3; k++) n[k] = -n[k]
  // A frame across the normal, and the loop flattened into it.
  const u = unit(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]))
  const v = cross(n, u)
  const xs = pts.map((p) => dot(sub(p, c), u))
  const ys = pts.map((p) => dot(sub(p, c), v))
  const margin = MARGIN_EDGES * scan.edge
  const flat = farthestInside(xs, ys)
  if (flat && flat.distance > margin) {
    const base: Vec3 = [c[0] + flat.x * u[0] + flat.y * v[0], c[1] + flat.x * u[1] + flat.y * v[1], c[2] + flat.x * u[2] + flat.y * v[2]]
    const hit = alongNormal(scan, base, n, pts)
    if (hit && nearestOf(hit, pts) > margin) return scan.closestInside(hit)?.point ?? hit
  }
  return steppedIn(scan, pts, { c, n, u, v, xs, ys })
}

/** The point of a polygon farthest from its sides, on a grid and once
 *  more on a finer one round the best; null for a polygon with nothing
 *  inside it. */
function farthestInside(xs: readonly number[], ys: readonly number[]): { x: number; y: number; distance: number } | null {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (let i = 0; i < xs.length; i++) {
    x0 = Math.min(x0, xs[i])
    x1 = Math.max(x1, xs[i])
    y0 = Math.min(y0, ys[i])
    y1 = Math.max(y1, ys[i])
  }
  let best: { x: number; y: number; distance: number } | null = null
  const search = (ax: number, bx: number, ay: number, by: number) => {
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = ax + ((i + 0.5) / GRID) * (bx - ax)
        const y = ay + ((j + 0.5) / GRID) * (by - ay)
        if (!insidePolygon(xs, ys, x, y)) continue
        const d = polygonDistance(xs, ys, x, y)
        if (!best || d > best.distance) best = { x, y, distance: d }
      }
    }
  }
  search(x0, x1, y0, y1)
  if (!best) return null
  const hx = (x1 - x0) / GRID
  const hy = (y1 - y0) / GRID
  const { x, y } = best
  search(x - hx, x + hx, y - hy, y + hy)
  return best
}

/** Where the line through `base` along `n` crosses the scan: the crossing
 *  nearest `base` among the triangles facing `n`'s way, or among all. */
function alongNormal(scan: ScanPaths, base: Vec3, n: Vec3, pts: readonly Vec3[]): Vec3 | null {
  // As far each way as the loop is wide.
  let reach = 0
  for (const p of pts) reach = Math.max(reach, Math.hypot(p[0] - base[0], p[1] - base[1], p[2] - base[2]))
  reach += 4 * scan.edge
  const lo: Vec3 = [0, 0, 0]
  const hi: Vec3 = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(base[k] - reach * n[k], base[k] + reach * n[k]) - scan.edge
    hi[k] = Math.max(base[k] - reach * n[k], base[k] + reach * n[k]) + scan.edge
  }
  const p = scan.positions
  const idx = scan.indices
  let facing: { t: number } | null = null
  let any: { t: number } | null = null
  for (const tri of scan.trianglesIn(lo, hi)) {
    const a = idx[tri * 3] * 3, b = idx[tri * 3 + 1] * 3, d = idx[tri * 3 + 2] * 3
    const t = lineTriangle(base, n, [p[a], p[a + 1], p[a + 2]], [p[b], p[b + 1], p[b + 2]], [p[d], p[d + 1], p[d + 2]])
    if (t === null) continue
    if (!any || Math.abs(t) < Math.abs(any.t)) any = { t }
    if (dot(scan.triangleNormal(tri), n) > 0.2 && (!facing || Math.abs(t) < Math.abs(facing.t))) facing = { t }
  }
  const hit = facing ?? any
  return hit ? [base[0] + hit.t * n[0], base[1] + hit.t * n[1], base[2] + hit.t * n[2]] : null
}

/** Möller–Trumbore for a line: where along `dir` from `o` it crosses the
 *  triangle, or null. */
function lineTriangle(o: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a)
  const e2 = sub(c, a)
  const h = cross(dir, e2)
  const det = dot(e1, h)
  if (Math.abs(det) < 1e-12) return null
  const s = sub(o, a)
  const uu = dot(s, h) / det
  if (uu < 0 || uu > 1) return null
  const q = cross(s, e1)
  const vv = dot(dir, q) / det
  if (vv < 0 || uu + vv > 1) return null
  return dot(e2, q) / det
}

/** The fallback: from each of a dozen points round the loop, a step in
 *  across it on the scan — left of the way it runs, seen from outside, for
 *  a loop running anticlockwise, right for one running clockwise — of a
 *  fifth of the loop's width, then halved until the flattened point is
 *  inside; the one farthest from the loop. */
function steppedIn(scan: ScanPaths, pts: readonly Vec3[], flat: { c: Vec3; n: Vec3; u: Vec3; v: Vec3; xs: readonly number[]; ys: readonly number[] }): Vec3 | null {
  const { c, n, u, v, xs, ys } = flat
  const m = pts.length
  let area = 0
  for (let i = 0; i < m; i++) area += xs[i] * ys[(i + 1) % m] - xs[(i + 1) % m] * ys[i]
  const sign = area >= 0 ? 1 : -1
  let width = 0
  for (const p of pts) width = Math.max(width, Math.hypot(...sub(p, pts[0])))
  let best: { at: Vec3; distance: number } | null = null
  for (let j = 0; j < 12; j++) {
    const i = Math.floor((j * m) / 12)
    const p = pts[i]
    const t = sub(pts[(i + 1) % m], pts[(i - 1 + m) % m])
    const on = scan.closestInside(p)
    const normal = on ? scan.triangleNormal(on.triangle) : n
    const left = unit(cross(normal, t))
    for (let step = width / 5; step > scan.edge; step /= 2) {
      const q: Vec3 = [p[0] + sign * step * left[0], p[1] + sign * step * left[1], p[2] + sign * step * left[2]]
      const back = scan.closestInside(q)
      if (!back) break
      const r = back.point
      if (!insidePolygon(xs, ys, dot(sub(r, c), u), dot(sub(r, c), v))) continue
      const d = nearestOf(r, pts)
      if (!best || d > best.distance) best = { at: r, distance: d }
      break
    }
  }
  return best ? best.at : (scan.closestInside(pts[0])?.point ?? null)
}

function insidePolygon(xs: readonly number[], ys: readonly number[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if (ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside
  }
  return inside
}

function polygonDistance(xs: readonly number[], ys: readonly number[], x: number, y: number): number {
  let best = Infinity
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const dx = xs[i] - xs[j]
    const dy = ys[i] - ys[j]
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - xs[j]) * dx + (y - ys[j]) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(xs[j] + t * dx - x, ys[j] + t * dy - y))
  }
  return best
}

function nearestOf(p: Vec3, pts: readonly Vec3[]): number {
  let best = Infinity
  for (const q of pts) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]))
  return best
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function unit(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2])
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1]
}
