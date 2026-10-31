// SPDX-License-Identifier: AGPL-3.0-only
// The break carried on past the body, so it cuts the body through (see
// trimToScan).
//
// The break ends the depth short of the body's surface: that is where it was
// cut out of the scan (core/breakSurface). Each point of its rim is carried
// on along the surface — square to the rim, away from the break — in short
// steps, until it is a margin outside the body. It stops as soon as it is
// past the body, so the extension stays short and cannot wander back into the
// body somewhere else, and no point stops short of its neighbours, so the new
// rim runs clear of the body all along. The extension is laid as rows of
// quads an edge of the break apart, each row walking the one before it.
//
// The direction is read off the break round each rim point, not off the
// triangle at it: the normal over a millimetre or a few edges, whichever is
// more, and the way out of the break across each rim edge — the edge, as its
// triangle walks it, crossed with that triangle's normal — both smoothed
// along the rim, the one put square to the other. A fracture's roughness,
// a step in it, a groove leaning over, all turn the triangles at the rim
// every which way; the break as a whole runs on smoothly.
//
// A hole inside the break — a spot the scanner missed, a speck left
// unmarked — has nowhere to be carried to: it is closed with Fill holes'
// curved patch (core/fillHoles), and only the outer rim of each piece of
// break is carried on.
//
// So is a spot the scanner missed at the break's edge — where the fracture
// meets a skin, most often — open to the rim: a bay in it, which carried out
// as it is would leave its sides running out along it, and the body joined
// across it. Its rim is the scan's own edge, which lies past the depth
// where the rim elsewhere is on it; each run of such edges that bends into
// the break is shut off across its mouth by a thin strip, which makes it a
// hole like the others, and the strip's outer edge is carried on with the
// rim.

import { emptyHit } from '../../../src/core/deviation/surface'
import type { Vec3 } from '../../../src/core/types'
import type { BodySurface } from './breakSurface'
import { boundaryLoops, loopSize, type BoundaryLoop } from './boundary'
import { fillHoles } from './fillHoles'
import { meanEdgeLength } from './smooth'
import { vertexComponents } from '../../../src/core/geometry/unionFind'
import { cross } from '../../../src/core/vec'

export interface ExtendSettings {
  /** How far outside the body every rim point is to end, mm. */
  margin: number
  /** 1 for each vertex of the break that lies past the depth rather than
   *  on it (BreakSurface.deep): an edge of the rim between two is the
   *  scan's own. */
  deep?: Uint8Array | null
}

export interface ExtendReport {
  /** Rims carried on — one for each piece of break — and holes closed,
   *  of them bays: gaps in the scan open to the rim. */
  rims: number
  holes: number
  bays: number
  /** Rows the longest of them took. */
  rows: number
  /** The shortest and the longest way a rim point went, mm. */
  shortest: number
  longest: number
}

/** The normal round a rim point is the break's over this far at the least,
 *  mm, or this many of its edges. */
const NORMAL_REACH = 1
const NORMAL_EDGES = 3

/** Passes of smoothing along the rim — a (1, 2, 1) average each. */
const RIM_PASSES = 10

/** No rim point stops short of this many neighbours either way. */
const HOLD_SPAN = 3

/**
 * The break — `vertexCount` vertices — carried on past the body: holes in it
 * closed, its outer rims carried out until they are `margin` outside the
 * body. Its own vertices keep their numbers; patches and the extension come
 * after them. Throws, in words, when a rim does not come out of the body.
 */
export function extendRim(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  body: BodySurface,
  settings: ExtendSettings,
): { positions: Float32Array; indices: Uint32Array; report: ExtendReport } {
  const { margin } = settings
  if (!(margin > 0) || !Number.isFinite(margin)) throw new Error('The margin must be more than zero.')

  // ---- bays shut, holes closed, outer rims found -----------------------------
  let p = positions
  let idx = indices
  let bays = 0
  if (settings.deep) {
    const shut = shutBays(p, idx, vertexCount, settings.deep)
    p = shut.positions
    idx = shut.indices
    bays = shut.bays
  }
  let rims = outerRims(p, idx, p.length / 3)
  const holes = rims.holes
  for (const hole of holes) {
    const size = loopSize(p, hole.vertices)
    try {
      const filled = fillHoles(p, idx, p.length / 3, size * 1.001 + 1e-6, 'curved', undefined, middleOf(p, hole.vertices))
      p = filled.positions
      idx = filled.indices
    } catch {
      // units-ok: built in the worker, also the agent's answer
      throw new Error(`A hole in the break, ${size.toFixed(1)} mm across, could not be closed — close it on the scan with Fill holes, or mark the break across it.`)
    }
  }
  if (holes.length > 0) rims = outerRims(p, idx, p.length / 3)

  // ---- the break's normals, found by place -----------------------------------
  const edge = meanEdgeLength(p, idx)
  const reach = Math.max(NORMAL_REACH, NORMAL_EDGES * edge)
  const triangles = idx.length / 3
  const area = new Float64Array(triangles * 3)
  const centre = new Float64Array(triangles * 3)
  for (let t = 0; t < triangles; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    // Twice the area along the normal: summed, an area-weighted normal.
    area[t * 3] = uy * vz - uz * vy
    area[t * 3 + 1] = uz * vx - ux * vz
    area[t * 3 + 2] = ux * vy - uy * vx
    for (let k = 0; k < 3; k++) centre[t * 3 + k] = (p[a + k] + p[b + k] + p[c + k]) / 3
  }
  const cells = new Map<string, number[]>()
  const cellOf = (x: number, y: number, z: number) => `${Math.floor(x / reach)},${Math.floor(y / reach)},${Math.floor(z / reach)}`
  for (let t = 0; t < triangles; t++) {
    const key = cellOf(centre[t * 3], centre[t * 3 + 1], centre[t * 3 + 2])
    const list = cells.get(key)
    if (list) list.push(t)
    else cells.set(key, [t])
  }
  const normalAround = (q: Vec3): Vec3 => {
    const sum: Vec3 = [0, 0, 0]
    const ci = Math.floor(q[0] / reach), cj = Math.floor(q[1] / reach), ck = Math.floor(q[2] / reach)
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let k = ck - 1; k <= ck + 1; k++) {
          for (const t of cells.get(`${i},${j},${k}`) ?? []) {
            const d = Math.hypot(centre[t * 3] - q[0], centre[t * 3 + 1] - q[1], centre[t * 3 + 2] - q[2])
            if (d > reach) continue
            sum[0] += area[t * 3]
            sum[1] += area[t * 3 + 1]
            sum[2] += area[t * 3 + 2]
          }
        }
      }
    }
    return unit(sum)
  }

  // ---- each outer rim carried out ----------------------------------------------
  const pos: number[] = Array.from(p)
  const out: number[] = Array.from(idx)
  const hit = emptyHit()
  const step = Math.min(edge, margin) / 4
  const limit = body.bboxDiagonal + margin
  let rows = 0
  let shortest = Infinity
  let longest = 0
  for (const loop of rims.rims) {
    const n = loop.vertices.length
    const at = (i: number): Vec3 => {
      const v = loop.vertices[((i % n) + n) % n] * 3
      return [p[v], p[v + 1], p[v + 2]]
    }
    // Out of the break across each rim edge, shared by the edge's two ends.
    const outs: Vec3[] = Array.from({ length: n }, () => [0, 0, 0])
    for (let i = 0; i < n; i++) {
      const a = at(i)
      const b = at(i + 1)
      const o = loop.opposite[i] * 3
      const e: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const f: Vec3 = [p[o] - a[0], p[o + 1] - a[1], p[o + 2] - a[2]]
      const away = unit(cross(e, unit(cross(e, f))))
      for (let k = 0; k < 3; k++) {
        outs[i][k] += away[k]
        outs[(i + 1) % n][k] += away[k]
      }
    }
    const normals = smoothLoop(Array.from({ length: n }, (_, i) => normalAround(at(i))), RIM_PASSES).map(unit)
    const dirs = smoothLoop(outs.map(unit), RIM_PASSES).map((d, i) => {
      const nn = normals[i]
      const along = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]
      return unit([d[0] - along * nn[0], d[1] - along * nn[1], d[2] - along * nn[2]])
    })

    // How far each point goes: until it is the margin outside the body.
    const need = dirs.map((d, i) => {
      const q = at(i)
      for (let s = step; s <= limit; s += step) {
        // No reach on the search: a point deep inside is as far from the
        // surface as one well outside.
        body.closest(q[0] + s * d[0], q[1] + s * d[1], q[2] + s * d[2], hit)
        if (hit.signed > margin) return s
      }
      throw new Error(
        'Part of the break’s edge does not come out of the body when carried on along the fracture — mark the break out to where the part’s surface leaves the body.',
      )
    })
    const held = need.map((_, i) => {
      let most = 0
      for (let k = -HOLD_SPAN; k <= HOLD_SPAN; k++) most = Math.max(most, need[(i + k + n) % n])
      return most
    })
    for (const s of held) {
      shortest = Math.min(shortest, s)
      longest = Math.max(longest, s)
    }

    // The rows, each walking the edges of the one before it the other way
    // round, so the extension continues the break's winding.
    const count = Math.max(1, Math.ceil(Math.max(...held) / edge))
    rows = Math.max(rows, count)
    let prev = Array.from(loop.vertices)
    for (let r = 1; r <= count; r++) {
      const row: number[] = []
      for (let i = 0; i < n; i++) {
        const q = at(i)
        const s = (held[i] * r) / count
        row.push(pos.length / 3)
        pos.push(q[0] + s * dirs[i][0], q[1] + s * dirs[i][1], q[2] + s * dirs[i][2])
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        out.push(prev[j], prev[i], row[i], prev[j], row[i], row[j])
      }
      prev = row
    }
  }
  return {
    positions: Float32Array.from(pos),
    indices: Uint32Array.from(out),
    report: { rims: rims.rims.length, holes: holes.length, bays, rows, shortest: Number.isFinite(shortest) ? shortest : 0, longest },
  }
}

/** Run of the scan's own edge along a rim shorter than this many edges is
 *  left as it is: a notch a point deep is no gap. */
const BAY_EDGES = 2

/**
 * Each gap in the scan open to a rim — a run of the rim's edges between
 * vertices past the depth, bending into the mesh — made a hole: a strip of
 * triangles laid outside the straight line across its mouth, from the rim
 * vertex before the run to the one after, whose inner edge is the line and
 * whose outer one the rim now. The mesh's own vertices keep their numbers;
 * the strip's come after them.
 */
function shutBays(positions: Float32Array, indices: Uint32Array, vertexCount: number, deep: Uint8Array) {
  const pos: number[] = Array.from(positions)
  const out: number[] = Array.from(indices)
  const isDeep = (v: number) => v < deep.length && deep[v] === 1
  const edge = meanEdgeLength(positions, indices)
  const point = (v: number): Vec3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]
  const add = (q: Vec3) => {
    pos.push(q[0], q[1], q[2])
    return pos.length / 3 - 1
  }
  let bays = 0
  for (const loop of boundaryLoops(indices, vertexCount).loops) {
    const n = loop.vertices.length
    const v = (i: number) => loop.vertices[((i % n) + n) % n]
    const own = (i: number) => isDeep(v(i)) && isDeep(v(i + 1))
    // The loop's places a strip took, ends included: two never share one.
    const taken = new Uint8Array(n)
    for (let s = 0; s < n; s++) {
      if (own(s - 1) || !own(s)) continue
      let e = s
      while (own(e) && e < s + n) e++
      // Edges s … e − 1 are the scan's own; the mouth runs from the vertex
      // before the run to the one after, which the strip joins.
      const runEdges = e - s
      if (runEdges < BAY_EDGES || runEdges + 4 > n) continue
      let free = true
      for (let i = s - 1; i <= e + 1; i++) if (taken[((i % n) + n) % n]) free = false
      if (!free) continue
      const pv = v(s - 1)
      const a = v(s)
      const b = v(e)
      const nv = v(e + 1)
      // Which way the break faces round the run: its triangles on the run.
      const facing: Vec3 = [0, 0, 0]
      for (let i = s; i < e; i++) {
        const t = triangleNormal(point(v(i)), point(v(i + 1)), point(loop.opposite[((i % n) + n) % n]))
        for (let c = 0; c < 3; c++) facing[c] += t[c]
      }
      // A bay, not a tongue: the run and the line back across its mouth go
      // round the other way from the mesh, which lies on the left of its rim.
      const turn: Vec3 = [0, 0, 0]
      for (let i = s; i <= e; i++) {
        const c = cross(point(v(i)), point(i === e ? a : v(i + 1)))
        for (let k2 = 0; k2 < 3; k2++) turn[k2] += c[k2]
      }
      if (turn[0] * facing[0] + turn[1] * facing[1] + turn[2] * facing[2] >= 0) continue
      const A = point(a)
      const B = point(b)
      const across: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
      const width = Math.hypot(across[0], across[1], across[2])
      if (width === 0) continue
      const outward = unit(cross(across, unit(facing)))
      const m = Math.max(2, Math.ceil(width / edge))
      const lift = Math.min(edge, width / m) / 2
      const c: number[] = [a]
      const o: number[] = [pv]
      for (let j = 1; j < m; j++) {
        const q: Vec3 = [A[0] + (across[0] * j) / m, A[1] + (across[1] * j) / m, A[2] + (across[2] * j) / m]
        c.push(add(q))
        o.push(add([q[0] + lift * outward[0], q[1] + lift * outward[1], q[2] + lift * outward[2]]))
      }
      c.push(b)
      o.push(nv)
      // The old rim edges into a and out of b closed by the strip's ends;
      // each chord edge walked from b's side to a's, so the bay is on its
      // left as a hole's rim; the outer edge from pv round to nv.
      out.push(a, pv, o[1])
      for (let j = 0; j < m; j++) {
        if (j < m - 1) out.push(c[j + 1], c[j], o[Math.max(1, j)])
        else out.push(b, c[j], o[j])
        if (j > 0 && j < m - 1) out.push(c[j + 1], o[j], o[j + 1])
      }
      out.push(nv, b, o[m - 1])
      for (let i = s - 1; i <= e + 1; i++) taken[((i % n) + n) % n] = 1
      bays++
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(out), bays }
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]])
}

/** Each piece of the mesh's largest rim — its outer edge — and the rest of
 *  its rims, its holes. A piece closed all round has no rim and cannot cut. */
function outerRims(positions: Float32Array, indices: Uint32Array, vertexCount: number): { rims: BoundaryLoop[]; holes: BoundaryLoop[] } {
  const { find } = vertexComponents(indices, vertexCount)
  const { loops } = boundaryLoops(indices, vertexCount)
  const largest = new Map<number, { loop: BoundaryLoop; size: number }>()
  for (const loop of loops) {
    const piece = find(loop.vertices[0])
    const size = loopSize(positions, loop.vertices)
    const known = largest.get(piece)
    if (!known || size > known.size) largest.set(piece, { loop, size })
  }
  const rims = new Set([...largest.values()].map((l) => l.loop))
  const pieces = new Set<number>()
  for (let t = 0; t < indices.length; t += 3) pieces.add(find(indices[t]))
  if (largest.size < pieces.size) {
    throw new Error('Part of the break is closed all round, with no edge to carry out past the body — it cannot cut anything.')
  }
  return { rims: loops.filter((l) => rims.has(l)), holes: loops.filter((l) => !rims.has(l)) }
}

/** A rim's middle as Fill holes finds it: the mean of its points. */
function middleOf(positions: Float32Array, loop: Uint32Array): Vec3 {
  let x = 0, y = 0, z = 0
  for (const v of loop) {
    x += positions[v * 3]
    y += positions[v * 3 + 1]
    z += positions[v * 3 + 2]
  }
  return [x / loop.length, y / loop.length, z / loop.length]
}

function smoothLoop(values: Vec3[], passes: number): Vec3[] {
  let cur = values
  const n = cur.length
  for (let s = 0; s < passes; s++) {
    cur = cur.map((v, i) => {
      const a = cur[(i - 1 + n) % n]
      const b = cur[(i + 1) % n]
      return [(a[0] + 2 * v[0] + b[0]) / 4, (a[1] + 2 * v[1] + b[1]) / 4, (a[2] + 2 * v[2] + b[2]) / 4]
    })
  }
  return cur
}

/** Unit vector, or (0, 0, 0) for a zero-length input — the core normalize
 *  gives null, and the fitting one +Z. */
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]
}
