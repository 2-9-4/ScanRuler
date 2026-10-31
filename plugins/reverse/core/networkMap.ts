// SPDX-License-Identifier: AGPL-3.0-only
// A cell of a patch network mapped onto the unit square — or, for a cell
// to be split from its centre, onto a regular polygon — so that each of its
// scan points has a (u, v) on the patch fitted through it.
//
// The cell's boundary goes onto the polygon's sides, corner to corner, by
// arc length; each interior vertex is placed at a weighted mean of its
// neighbours, the weights Floater's mean-value coordinates: positive for
// any triangle, shape-preserving on a flat one. Floater's theorem (Tutte's
// for the plain mean) says a map with positive weights onto a convex
// boundary is one-to-one — however the cell lies in space, so a cell that
// folds back round a cylinder maps as well as a flat one, which is what Fit
// Surface's height field cannot do. The weights are not symmetric (w_ij ≠
// w_ji), so the system is solved by PN0's BiCGSTAB rather than its
// conjugate gradient — u and v the same matrix. Their mean would be
// symmetric, and positive, and one-to-one still; but it loses the mean-value
// weights' linear precision — a flat mesh is mapped linearly onto a flat
// square only by them — and a strip of a cylinder mapped with it was 0.12 mm
// off its patch at the start of the fit, which parameter correction took
// twelve rounds to bring to a third of that.
//
// A scan hole wholly inside the cell is closed for the map by a fan from
// the hole's middle; the fan's vertex carries no data. Any triangle that
// comes out flipped — a cell whose boundary is not a disk's, a crumb of the
// scan folded on itself — refuses the cell, by where it is.

import { biconjugateGradientStabilized, Triplets } from '../../../src/core/fit/sparse'
import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'

/** The solver's tolerance. The map is where each point starts from — the
 *  fit takes it onto the Coons surface of the patch's sides and on from
 *  there (networkFit.ts) — so it need not be exact, only one-to-one: at
 *  1e-7 no triangle flipped that 1e-9 left unflipped, on the cylinder's
 *  strip, the saddle or the sphere's cells, in a third of the time. */
const MAP_TOLERANCE = 1e-7

/** A cell's mesh as the map and the fit read it: local vertices, each the
 *  scan vertex it is or -1 for a fan's middle, and the triangles. */
export interface CellMesh {
  positions: Float64Array
  scanVertex: Int32Array
  triangles: Uint32Array
  /** The boundary loop, local ids in order with the cell on the left. */
  loop: number[]
  /** Where each corner is in `loop`. */
  cornerAt: number[]
}

export interface CellMap {
  mesh: CellMesh
  /** (u, v) per local vertex. */
  uv: Float64Array
  /** The conjugate gradient's iterations, u and v together. */
  iterations: number
}

/** The cell's local mesh from its scan triangles, with a fan in each hole,
 *  its boundary loop, and the corners found on it — or why there is none:
 *  a cell with two boundaries is a ring, not a disk. */
export function cellMesh(scan: ScanPaths, triangles: ArrayLike<number>, holes: readonly number[][], corners: readonly Vec3[]): CellMesh | string {
  const idx = scan.indices
  const pos = scan.positions
  const local = new Map<number, number>()
  const positions: number[] = []
  const scanVertex: number[] = []
  const tri: number[] = []
  const take = (v: number) => {
    let l = local.get(v)
    if (l === undefined) {
      l = scanVertex.length
      local.set(v, l)
      scanVertex.push(v)
      positions.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
    }
    return l
  }
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]
    tri.push(take(idx[t * 3]), take(idx[t * 3 + 1]), take(idx[t * 3 + 2]))
  }
  // A hole's rim runs with the cell on its left; the fan on the other side
  // of each rim edge runs it backwards.
  for (const hole of holes) {
    const c: Vec3 = [0, 0, 0]
    for (const v of hole) for (let k = 0; k < 3; k++) c[k] += pos[v * 3 + k] / hole.length
    const middle = scanVertex.length
    scanVertex.push(-1)
    positions.push(...c)
    for (let i = 0; i < hole.length; i++) tri.push(take(hole[(i + 1) % hole.length]), take(hole[i]), middle)
  }
  // The boundary: the edges of one triangle only, in its winding.
  const count = tri.length / 3
  const edgeUse = new Map<string, number>()
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tri[t * 3 + e]
      const b = tri[t * 3 + ((e + 1) % 3)]
      const k = a < b ? `${a},${b}` : `${b},${a}`
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1)
    }
  }
  const nextOf = new Map<number, number[]>()
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tri[t * 3 + e]
      const b = tri[t * 3 + ((e + 1) % 3)]
      if (edgeUse.get(a < b ? `${a},${b}` : `${b},${a}`) !== 1) continue
      const l = nextOf.get(a) ?? []
      l.push(b)
      nextOf.set(a, l)
    }
  }
  const used = new Set<string>()
  const loops: number[][] = []
  for (const [a0, list] of nextOf) {
    for (const b0 of list) {
      if (used.has(`${a0}>${b0}`)) continue
      const loop: number[] = [a0]
      let b = b0
      let a = a0
      for (let guard = 0; guard <= scanVertex.length; guard++) {
        used.add(`${a}>${b}`)
        if (b === a0) break
        loop.push(b)
        const options = (nextOf.get(b) ?? []).filter((x) => !used.has(`${b}>${x}`))
        if (options.length === 0) break
        a = b
        b = options[0]
      }
      loops.push(loop)
    }
  }
  if (loops.length === 0) return 'it has no boundary — the scan closes round it'
  if (loops.length > 1) {
    loops.sort((x, y) => y.length - x.length)
    const v = loops[1][0]
    return `it is a ring, not a disk — another boundary inside it at (${[positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]].map((x) => x.toFixed(1)).join(', ')})`
  }
  const loop = loops[0]
  // Each corner at the loop's vertex nearest it, in the corners' order.
  const cornerAt = corners.map((c) => {
    let best = 0
    let bestD = Infinity
    loop.forEach((v, i) => {
      const d = Math.hypot(positions[v * 3] - c[0], positions[v * 3 + 1] - c[1], positions[v * 3 + 2] - c[2])
      if (d < bestD) [bestD, best] = [d, i]
    })
    return best
  })
  // Round the loop from the first corner, the others come in order.
  const rel = cornerAt.map((i) => (i - cornerAt[0] + loop.length) % loop.length)
  for (let k = 1; k < rel.length; k++) {
    if (!(rel[k] > rel[k - 1])) return 'its corners do not come round its boundary in order — a side doubles back on itself'
  }
  return { positions: Float64Array.from(positions), scanVertex: Int32Array.from(scanVertex), triangles: Uint32Array.from(tri), loop, cornerAt }
}

/** The polygon a cell is mapped onto: the unit square for four corners —
 *  side 0 along v = 0 from (0, 0), then round counter-clockwise — or a
 *  regular polygon of n corners in the unit disk, its first corner at
 *  angle 0. */
export function polygonCorners(n: number): [number, number][] {
  if (n === 4) return [[0, 0], [1, 0], [1, 1], [0, 1]]
  return Array.from({ length: n }, (_, k) => [0.5 + 0.5 * Math.cos((2 * Math.PI * k) / n), 0.5 + 0.5 * Math.sin((2 * Math.PI * k) / n)] as [number, number])
}

/** The cell mapped onto its polygon (see above), or why not. */
export function mapCell(mesh: CellMesh, start?: Float64Array): CellMap | string {
  const nv = mesh.scanVertex.length
  const pos = mesh.positions
  const corners = polygonCorners(mesh.cornerAt.length)
  const uv = new Float64Array(nv * 2)
  const fixed = new Uint8Array(nv)
  // The boundary, side by side, by arc length.
  const loop = mesh.loop
  const L = loop.length
  for (let k = 0; k < mesh.cornerAt.length; k++) {
    const from = mesh.cornerAt[k]
    const to = mesh.cornerAt[(k + 1) % mesh.cornerAt.length]
    const steps = (to - from + L) % L || L
    const along: number[] = [0]
    for (let s = 1; s <= steps; s++) {
      const a = loop[(from + s - 1) % L]
      const b = loop[(from + s) % L]
      along.push(along[s - 1] + Math.hypot(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]))
    }
    const total = along[steps] || 1
    const [x0, y0] = corners[k]
    const [x1, y1] = corners[(k + 1) % corners.length]
    for (let s = 0; s < steps; s++) {
      const v = loop[(from + s) % L]
      const f = along[s] / total
      uv[v * 2] = x0 + f * (x1 - x0)
      uv[v * 2 + 1] = y0 + f * (y1 - y0)
      fixed[v] = 1
    }
  }
  // The interior's unknowns.
  const unknown = new Int32Array(nv).fill(-1)
  let m = 0
  for (let v = 0; v < nv; v++) if (!fixed[v]) unknown[v] = m++
  // Mean-value weights, per triangle corner: tan(θ/2) / |edge| toward each
  // of the corner's two neighbours, summed into w_ij — row i of the system
  // Σ_j w_ij (u_i − u_j) = 0 straight into the triplets, whose duplicates
  // the CSR sums, the boundary's known u moved right.
  const t = mesh.triangles
  const a = new Triplets(m, t.length * 4)
  const bu = new Float64Array(m)
  const bv = new Float64Array(m)
  const add = (i: number, j: number, wij: number) => {
    const ui = unknown[i]
    if (ui < 0 || !(wij > 0)) return
    a.add(ui, ui, wij)
    const uj = unknown[j]
    if (uj >= 0) a.add(ui, uj, -wij)
    else {
      bu[ui] += wij * uv[j * 2]
      bv[ui] += wij * uv[j * 2 + 1]
    }
  }
  for (let f = 0; f < t.length / 3; f++) {
    for (let c = 0; c < 3; c++) {
      const i = t[f * 3 + c]
      const j = t[f * 3 + ((c + 1) % 3)]
      const k = t[f * 3 + ((c + 2) % 3)]
      const ex = pos[j * 3] - pos[i * 3], ey = pos[j * 3 + 1] - pos[i * 3 + 1], ez = pos[j * 3 + 2] - pos[i * 3 + 2]
      const gx = pos[k * 3] - pos[i * 3], gy = pos[k * 3 + 1] - pos[i * 3 + 1], gz = pos[k * 3 + 2] - pos[i * 3 + 2]
      const le = Math.hypot(ex, ey, ez)
      const lg = Math.hypot(gx, gy, gz)
      if (!(le > 0 && lg > 0)) continue
      const cos = Math.max(-1, Math.min(1, (ex * gx + ey * gy + ez * gz) / (le * lg)))
      // tan(θ/2) = sin θ / (1 + cos θ).
      const half = Math.sqrt(Math.max(0, 1 - cos * cos)) / (1 + cos + 1e-300)
      add(i, j, half / le)
      add(i, k, half / lg)
    }
  }
  let iterations = 0
  if (m > 0) {
    const csr = a.toCsr()
    let x0u: Float64Array | undefined
    let x0v: Float64Array | undefined
    if (start) {
      x0u = new Float64Array(m)
      x0v = new Float64Array(m)
      for (let v = 0; v < nv; v++) {
        if (unknown[v] < 0) continue
        x0u[unknown[v]] = start[v * 2]
        x0v[unknown[v]] = start[v * 2 + 1]
      }
    }
    const su = biconjugateGradientStabilized(csr, bu, { tolerance: MAP_TOLERANCE, x0: x0u })
    const sv = biconjugateGradientStabilized(csr, bv, { tolerance: MAP_TOLERANCE, x0: x0v })
    iterations = su.iterations + sv.iterations
    for (let v = 0; v < nv; v++) {
      if (unknown[v] < 0) continue
      uv[v * 2] = su.x[unknown[v]]
      uv[v * 2 + 1] = sv.x[unknown[v]]
    }
  }
  // Every triangle the same way round as the polygon.
  let area = 0
  const signed = new Float64Array(t.length / 3)
  for (let f = 0; f < t.length / 3; f++) {
    const p = t[f * 3], q = t[f * 3 + 1], r = t[f * 3 + 2]
    signed[f] = (uv[q * 2] - uv[p * 2]) * (uv[r * 2 + 1] - uv[p * 2 + 1]) - (uv[r * 2] - uv[p * 2]) * (uv[q * 2 + 1] - uv[p * 2 + 1])
    area += Math.abs(signed[f])
  }
  const slack = 1e-9 * (area / Math.max(1, signed.length))
  for (let f = 0; f < signed.length; f++) {
    if (signed[f] < -slack) {
      const p = t[f * 3]
      return `the map folds over at (${[pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]].map((x) => x.toFixed(1)).join(', ')}) — the cell's boundary is not a simple loop there`
    }
  }
  return { mesh, uv, iterations }
}
