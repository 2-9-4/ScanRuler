// SPDX-License-Identifier: AGPL-3.0-only
// Suggest creases (PN12): the scan's sharp edges and folds, traced and
// offered as crease curves for a patch network — candidates drawn dashed,
// accepted one by one or all at once.
//
// An edge of the scan is on a crease where the surface turns sharply
// across it. Raw, the angle between an edge's two triangles is mostly
// noise: 0.02 mm of it on edges of 0.5 mm tips neighbouring triangles up
// to 27° apart. So the triangles' normals are filtered first, three rounds
// of a bilateral mean: each becomes the mean of the normals of the
// triangles sharing a corner with it, by area, each weighed by a Gaussian
// in how far it is from its own. Noise is averaged away — on the same
// sheet no edge then turns more than 0.8° — while across a crease the
// other side's normals are tens of degrees off and weigh next to nothing,
// so a 90° edge keeps its 90°. A plain mean over the same ring does not:
// one round takes a 35° fold down to 11° and a 90° edge to 27°, three
// rounds to 7° and 17°.
//
// Two angles are read at an edge. Its own, between its two triangles'
// filtered normals. And the angle across it a few edges out (acrossAngle):
// between the mean normals of the triangles 1.5 to 4 edges off it on
// either side. A crease that crosses the triangles slantwise shares its
// turn out between two edges — a 30° fold puts no more than 24° on any
// one — but across it reads its whole 30°; a speck of noise the filter left
// turns its own edges and nothing a few edges out.
//
// The candidates are the edges whose own angle is over the weak threshold,
// thinned to one line by non-maximum suppression across the crease: an
// edge goes where a near-parallel edge beside it turns more. Their
// vertices, joined by every edge of the scan between two of them, make
// pieces, and a piece is kept that holds an edge whose angle across is
// over the strong threshold — hysteresis, the seed read across, not at the
// edge alone, which is what finds a slantwise fold and leaves noise out.
//
// Each piece is traced into paths, TEASAR's way: from the vertex farthest
// from the root along the tree of shortest ways back to the root or to a
// path already taken, the band round each path covered, until none is
// left. The ways keep to the kept edges — a step off them costs three
// times its length — so they follow the crease, not the inside of its
// bends. A tip just past the band of a path already taken (the other half
// of a loop, a crease run into a corner) is joined to it.
//
// A round is no crease, and its edges can pass the weak threshold: a
// radius r over edges h apart turns about h / r an edge, 14° at 2 mm on
// 0.5 mm edges. What tells it from a crease is where the turn is: a crease
// puts it on one edge, or two slantwise; a round a little on every edge. So
// along each path the share of the angle across that the edge itself
// turns is read, as a running median (creaseRuns), and the path kept only
// where it is 0.4 or more — 0.51 to 1 on every crease measured, 0.16 to
// 0.31 along the rounds (see creaseRuns). The ridges are traced again
// without the rounds found, since a branch down a round, traced first,
// takes the band of the crease it leaves with it.
//
// The paths' ends within MERGE_MM are one node, nearest first and never
// wider than MERGE_MM across: a crease cut slantwise dips under the weak
// angle for an edge or two at a time, and its pieces a millimetre apart
// would otherwise all run together into one node. Loose ends pointing at
// each other a little farther apart are bridged; two chains through a node
// no other reaches are one; spurs and crumbs go; and a chain shorter than
// four times the scatter-scaled span is dropped — the span Auto would give
// it, eight times the scan's scatter, never under three mean edges. On the
// scans measured the floor rules (the scatter is 0.01 to 0.02 mm, the
// span it gives 0.16 mm): without it, a boss 1 mm across left three to
// five curves of 2 to 6 mm, and noise of 0.12 mm on 0.5 mm edges a chain
// of 3.5 mm; with it — and a group of curves shorter than it all together
// dropped — neither, while the rims of a boss 2 mm across, 8 mm round its
// top, stay.
//
// The chains are cut at their corners, where they turn 45° or more over
// 4 mm either side, and a closed one with fewer than three into four, so
// that every curve runs between two nodes. A node where chains end is put
// where they meet carried on straight, and taken onto the scan. Each chain
// is fitted as a network curve is (PN2), and its grips are the fitted
// curve's points, each as far on from the last as the chord between them
// stays within a tenth of an edge of it — so that the scan path between
// two grips, a plane section, keeps to the crease round its bends — and
// never more than 10 mm apart. Its angle is the mean angle across it,
// read along it on the scan.
//
// Measured (reNetworkCreases.test.ts): a box with sharp rims and rounds of
// 4 mm on 0.5 mm edges, or of 2 mm, comes out as its two rims and nothing
// on the rounds, the curves within 0.03 mm of the rims, the scan paths
// through their grips within 0.09 mm, the angles 90° ± 0.15°; one with
// every edge sharp as its twelve edges, their nodes within 0.015 mm of its
// corners; a 35° or 40° fold across a sheet with 0.02 mm of noise as one
// curve within 0.13 mm of it, end to end, and a 30° fold within 0.2 mm,
// short of the edges by 1.1 and 1.8 mm, where its angle dips under the
// weak one. A box of 320,000 triangles in a 2-million-triangle scan takes
// 0.25 to 0.3 s, half of it the filter; the whole scan, 1.4 s.

import type { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import { autoSpans, type CurvePoints, fitCurve, sampleCurve } from './networkCurve'

/** The hysteresis thresholds, deg: an edge whose own angle is over
 *  WEAK_DEG is a candidate, and a piece of candidates is kept that holds
 *  one whose angle across is over STRONG_DEG. */
export const STRONG_DEG = 25
export const WEAK_DEG = 12
/** Chain ends this close are one node, mm. */
export const MERGE_MM = 2
/** The normal filter's range in |n − n'| — 0.2 is 11.5° — and its rounds.
 *  At 0.3 a slantwise 35° fold came out at 16° on its best edge; at 0.15,
 *  noise of a tenth of an edge stuck at up to 45°. */
const RANGE = 0.2
const ROUNDS = 3
/** How near parallel an edge beside another has to be to suppress it. */
const PARALLEL_COS = Math.cos((35 * Math.PI) / 180)
/** The angle across an edge: the triangles from ACROSS_SKIP to
 *  ACROSS_REACH mean edges off it, either side — past the two edges a
 *  slantwise crease shares its turn between, and short of a step's other
 *  rim on most parts. */
const ACROSS_SKIP = 1.5
const ACROSS_REACH = 4
/** How far round a path its band of ridge vertices is taken as covered,
 *  in mean edges, and how much farther a new path's tip may lie from one
 *  already taken to be joined to it. */
const COVER_EDGES = 2
const JOIN_EDGES = 2
/** What a step off the kept edges costs a path, per its length. */
const OFF_RIDGE = 3
/** A path shorter than this many mean edges is a spur off the band. */
const SPUR_EDGES = 2
/** The least share of the angle across a crease's edges turn themselves,
 *  as a running median over this many steps either side (creaseRuns). */
const CONCENTRATION = 0.4
const CONCENTRATION_WINDOW = 3
/** How many times the ridges are traced, each without the rounds the one
 *  before found. */
const TRACE_PASSES = 3
/** The shortest chain kept: MIN_SPANS of the scatter-scaled span — Auto's,
 *  SCATTER_SPAN times the scan's scatter — never under SPAN_FLOOR_EDGES
 *  mean edges (see above). */
const MIN_SPANS = 4
const SCATTER_SPAN = 8
const SPAN_FLOOR_EDGES = 3
/** The vertices sampled for the scan's scatter. */
const SCATTER_SAMPLES = 4000
/** Loose ends up to BRIDGE_MM apart, pointing at each other within
 *  BRIDGE_DEG, are bridged. */
const BRIDGE_MM = 2 * MERGE_MM
const BRIDGE_DEG = 20
/** A chain has a corner where its chords CORNER_REACH mm back and on turn
 *  CORNER_TURN_DEG or more: the middle of a 4 mm round in a rim turns 55°
 *  so, a 20 mm circle 11°. */
const CORNER_TURN_DEG = 45
const CORNER_REACH = 2 * MERGE_MM
/** A closed chain with fewer than three corners is cut into this many. */
const LOOP_PIECES = 4
/** A node is put where the lines its chains come in by meet: each from
 *  the chain's point NODE_FAR mm from the node to its point NODE_NEAR mm
 *  from it, held to the ends' mean by NODE_HOLD a line. */
const NODE_FAR = 2 * MERGE_MM
const NODE_NEAR = MERGE_MM / 2
const NODE_HOLD = 1e-3
/** The grips: the chord between two may leave the fitted curve by this
 *  many mean edges, and they are never more than GRIP_SPACING mm apart. */
const GRIP_SAG_EDGES = 0.1
const GRIP_SPACING = 10
/** A fitted curve is sampled every SAMPLE_EDGES mean edges, at most
 *  MAX_SAMPLES times. */
const SAMPLE_EDGES = 0.5
const MAX_SAMPLES = 4000
/** The angle along a curve: the scan's normal ANGLE_OFFSET_EDGES off it on
 *  either side, averaged over ANGLE_RADIUS_EDGES, every ANGLE_STEP mm. */
const ANGLE_OFFSET_EDGES = 3
const ANGLE_RADIUS_EDGES = 1.5
const ANGLE_STEP = 2

export interface CreaseSuggestion {
  /** Nodes where suggested curves end, ends within MERGE_MM of each other merged. */
  nodes: { id: number; at: Vec3 }[]
  /** Each suggested crease: its two nodes, a few grips along it (as NetworkCurve.via takes them — points on the scan, enough that the scan path between consecutive ones follows the crease), its length (mm) and its mean dihedral angle (deg). */
  curves: { from: number; to: number; via: Vec3[]; length: number; angle: number; points: Float32Array }[]
}

/** The triangles a suggestion reads, as a mesh of their own. */
interface Region {
  /** Three local vertices per triangle. */
  tri: Uint32Array
  triangles: number
  /** x, y, z per local vertex. */
  xyz: Float64Array
  vertices: number
  /** The triangles round each vertex (CSR). */
  vtOffsets: Uint32Array
  vtList: Uint32Array
  /** Each edge's two vertices, lower first, and the triangles either side
   *  — the second -1 on a rim, or where more than two meet. */
  ea: Uint32Array
  eb: Uint32Array
  t1: Int32Array
  t2: Int32Array
  edges: number
  /** Each triangle's three edges, side k from corner k to k + 1. */
  triEdge: Uint32Array
  /** The edges round each vertex (CSR). */
  veOffsets: Uint32Array
  veList: Uint32Array
}

/** The scan's creases, in `box` when given: see above. */
export function suggestCreases(scan: ScanPaths, opts: { box?: { min: Vec3; max: Vec3 }; strongDeg?: number; weakDeg?: number } = {}): CreaseSuggestion {
  const strong = opts.strongDeg ?? STRONG_DEG
  const weak = Math.min(opts.weakDeg ?? WEAK_DEG, strong)
  const r = regionOf(scan, opts.box)
  if (r.triangles === 0) return { nodes: [], curves: [] }
  const normals = filteredNormals(r)
  const angle = edgeAngles(r, normals)
  const kept = thinned(r, angle, weak)
  const minLength = MIN_SPANS * Math.max(SCATTER_SPAN * scatterOf(r, normals), SPAN_FLOOR_EDGES * scan.edge)
  const scratch = { stamp: new Int32Array(r.triangles), mark: 0, queue: [] as number[] }
  const acrossOf = new Float32Array(r.edges).fill(-1)
  const across = (e: number) => (acrossOf[e] >= 0 ? acrossOf[e] : (acrossOf[e] = acrossAngle(r, normals, e, scan.edge, scratch)))
  const seed = (e: number) => across(e) >= strong
  const share = (e: number) => angle[e] / Math.max(angle[e], across(e))
  // Traced again without the vertices of the runs along rounds: a branch
  // down a round, traced first, takes the band round the crease it leaves
  // with it — a rim's corner where a round meets it.
  const off = new Uint8Array(r.vertices)
  let runs: number[][] = []
  for (let pass = 0; pass < TRACE_PASSES; pass++) {
    const paths = ridgePaths(r, kept, seed, scan.edge, off)
    runs = creaseRuns(r, paths, kept, share, SPUR_EDGES * scan.edge)
    const inRun = new Uint8Array(r.vertices)
    for (const p of runs) for (const v of p) inRun[v] = 1
    let dropped = 0
    for (const p of paths) {
      for (const v of p) {
        if (inRun[v] || off[v]) continue
        off[v] = 1
        dropped++
      }
    }
    if (dropped === 0) break
  }
  const linked = settleNodes(scan, splitChains(linkChains(r, runs, minLength)), minLength)
  return curvesOf(scan, linked, weak, minLength)
}

// ---------------------------------------------------------------------------
// The region and its edges.

/** The triangles in `box` — their middles in it — or all of them, as a
 *  mesh of their own with its edges. An edge on the box's side has one
 *  triangle in it and is a rim. */
function regionOf(scan: ScanPaths, box?: { min: Vec3; max: Vec3 }): Region {
  const pos = scan.positions
  const idx = scan.indices
  let chosen: Uint32Array
  if (box) {
    const near = scan.trianglesIn(box.min, box.max)
    const keep = new Uint32Array(near.length)
    let n = 0
    for (const t of near) {
      let inside = true
      for (let k = 0; k < 3 && inside; k++) {
        const c = (pos[idx[t * 3] * 3 + k] + pos[idx[t * 3 + 1] * 3 + k] + pos[idx[t * 3 + 2] * 3 + k]) / 3
        if (c < box.min[k] || c > box.max[k]) inside = false
      }
      if (inside) keep[n++] = t
    }
    chosen = keep.subarray(0, n)
  } else {
    chosen = new Uint32Array(scan.triangleCount)
    for (let t = 0; t < chosen.length; t++) chosen[t] = t
  }
  const n = chosen.length
  const localOf = new Int32Array(pos.length / 3).fill(-1)
  const tri = new Uint32Array(n * 3)
  let m = 0
  const all = new Float64Array(Math.min(n * 3, pos.length / 3) * 3)
  for (let i = 0; i < n; i++) {
    const t = chosen[i]
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]
      let l = localOf[v]
      if (l < 0) {
        l = m++
        localOf[v] = l
        all[l * 3] = pos[v * 3]
        all[l * 3 + 1] = pos[v * 3 + 1]
        all[l * 3 + 2] = pos[v * 3 + 2]
      }
      tri[i * 3 + k] = l
    }
  }
  const xyz = all.slice(0, m * 3)
  // The triangles round each vertex.
  const vtOffsets = new Uint32Array(m + 1)
  for (let i = 0; i < n * 3; i++) vtOffsets[tri[i] + 1]++
  for (let v = 0; v < m; v++) vtOffsets[v + 1] += vtOffsets[v]
  const vtList = new Uint32Array(n * 3)
  {
    const cursor = vtOffsets.slice(0, m)
    for (let i = 0; i < n * 3; i++) vtList[cursor[tri[i]]++] = (i / 3) | 0
  }
  // The edges: each triangle side put under its lower vertex, and the
  // sides under one vertex with the same upper vertex paired — a few a
  // vertex, so a scan of them is cheaper than a map of all.
  const below = new Uint32Array(m + 1)
  for (let i = 0; i < n * 3; i++) {
    const a = tri[i]
    const b = tri[i - (i % 3) + ((i % 3) + 1) % 3]
    below[Math.min(a, b) + 1]++
  }
  for (let v = 0; v < m; v++) below[v + 1] += below[v]
  const upper = new Uint32Array(n * 3)
  const side = new Uint32Array(n * 3)
  {
    const cursor = below.slice(0, m)
    for (let i = 0; i < n * 3; i++) {
      const a = tri[i]
      const b = tri[i - (i % 3) + ((i % 3) + 1) % 3]
      const at = cursor[Math.min(a, b)]++
      upper[at] = Math.max(a, b)
      side[at] = i
    }
  }
  const edgeOf = new Int32Array(n * 3).fill(-1)
  const mateOf = new Int32Array(n * 3).fill(-1)
  let edges = 0
  for (let v = 0; v < m; v++) {
    const end = below[v + 1]
    for (let i = below[v]; i < end; i++) {
      if (edgeOf[i] >= 0) continue
      let mate = -1
      let many = false
      for (let j = i + 1; j < end; j++) {
        if (edgeOf[j] >= 0 || upper[j] !== upper[i]) continue
        if (mate < 0) mate = j
        else many = true
      }
      if (many) {
        // More than two triangles on one edge: each its own, a rim.
        for (let j = i; j < end; j++) if (edgeOf[j] < 0 && upper[j] === upper[i]) edgeOf[j] = edges++
        continue
      }
      edgeOf[i] = edges
      if (mate >= 0) {
        edgeOf[mate] = edges
        mateOf[i] = mate
      }
      edges++
    }
  }
  const ea = new Uint32Array(edges)
  const eb = new Uint32Array(edges)
  const t1 = new Int32Array(edges).fill(-1)
  const t2 = new Int32Array(edges).fill(-1)
  const triEdge = new Uint32Array(n * 3)
  for (let v = 0; v < m; v++) {
    for (let i = below[v]; i < below[v + 1]; i++) {
      const e = edgeOf[i]
      triEdge[side[i]] = e
      if (t1[e] >= 0) continue
      ea[e] = v
      eb[e] = upper[i]
      t1[e] = (side[i] / 3) | 0
      if (mateOf[i] >= 0) t2[e] = (side[mateOf[i]] / 3) | 0
    }
  }
  // The edges round each vertex.
  const veOffsets = new Uint32Array(m + 1)
  for (let e = 0; e < edges; e++) {
    veOffsets[ea[e] + 1]++
    veOffsets[eb[e] + 1]++
  }
  for (let v = 0; v < m; v++) veOffsets[v + 1] += veOffsets[v]
  const veList = new Uint32Array(edges * 2)
  {
    const cursor = veOffsets.slice(0, m)
    for (let e = 0; e < edges; e++) {
      veList[cursor[ea[e]]++] = e
      veList[cursor[eb[e]]++] = e
    }
  }
  return { tri, triangles: n, xyz, vertices: m, vtOffsets, vtList, ea, eb, t1, t2, edges, triEdge, veOffsets, veList }
}

// ---------------------------------------------------------------------------
// The normals and the angle at each edge.

/** The triangles' normals, filtered (see above). */
function filteredNormals(r: Region): Float64Array {
  const { tri, xyz, triangles: n } = r
  let cur = new Float64Array(n * 3)
  const area = new Float64Array(n)
  for (let t = 0; t < n; t++) {
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3
    const ux = xyz[b] - xyz[a], uy = xyz[b + 1] - xyz[a + 1], uz = xyz[b + 2] - xyz[a + 2]
    const vx = xyz[c] - xyz[a], vy = xyz[c + 1] - xyz[a + 1], vz = xyz[c + 2] - xyz[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    area[t] = l / 2
    if (l > 0) {
      cur[t * 3] = nx / l
      cur[t * 3 + 1] = ny / l
      cur[t * 3 + 2] = nz / l
    }
  }
  let next = new Float64Array(n * 3)
  const stamp = new Int32Array(n).fill(-1)
  const inv = 1 / (2 * RANGE * RANGE)
  const { vtOffsets, vtList } = r
  for (let round = 0; round < ROUNDS; round++) {
    for (let t = 0; t < n; t++) {
      const nx = cur[t * 3], ny = cur[t * 3 + 1], nz = cur[t * 3 + 2]
      let sx = 0, sy = 0, sz = 0
      const mark = round * n + t
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k]
        for (let i = vtOffsets[v]; i < vtOffsets[v + 1]; i++) {
          const u = vtList[i]
          if (stamp[u] === mark) continue
          stamp[u] = mark
          const mx = cur[u * 3], my = cur[u * 3 + 1], mz = cur[u * 3 + 2]
          const d = 2 - 2 * (nx * mx + ny * my + nz * mz)
          const w = area[u] * Math.exp(-d * inv)
          sx += w * mx
          sy += w * my
          sz += w * mz
        }
      }
      const l = Math.hypot(sx, sy, sz)
      if (l > 0) {
        next[t * 3] = sx / l
        next[t * 3 + 1] = sy / l
        next[t * 3 + 2] = sz / l
      } else {
        next[t * 3] = nx
        next[t * 3 + 1] = ny
        next[t * 3 + 2] = nz
      }
    }
    const swap = cur
    cur = next
    next = swap
  }
  return cur
}

/** Each edge's angle between its two triangles' filtered normals, deg; 0
 *  on a rim. */
function edgeAngles(r: Region, normals: Float64Array): Float32Array {
  const out = new Float32Array(r.edges)
  for (let e = 0; e < r.edges; e++) {
    const a = r.t1[e]
    const b = r.t2[e]
    if (a < 0 || b < 0) continue
    const c = normals[a * 3] * normals[b * 3] + normals[a * 3 + 1] * normals[b * 3 + 1] + normals[a * 3 + 2] * normals[b * 3 + 2]
    out[e] = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI
  }
  return out
}

/** The edges over `weak` that no near-parallel edge beside them, across
 *  the crease, outdoes: non-maximum suppression across it. */
function thinned(r: Region, angle: Float32Array, weak: number): Uint8Array {
  const kept = new Uint8Array(r.edges)
  const { xyz, ea, eb, t1, t2, triEdge } = r
  const near: number[] = []
  for (let e = 0; e < r.edges; e++) {
    const s = angle[e]
    if (s < weak || t2[e] < 0) continue
    // The edges of the two triangles, and of the triangles across those.
    near.length = 0
    for (const t of [t1[e], t2[e]]) {
      for (let k = 0; k < 3; k++) {
        const f = triEdge[t * 3 + k]
        if (f === e) continue
        near.push(f)
        const u = t1[f] === t ? t2[f] : t1[f]
        if (u < 0) continue
        for (let j = 0; j < 3; j++) {
          const g = triEdge[u * 3 + j]
          if (g !== f) near.push(g)
        }
      }
    }
    const a = ea[e] * 3, b = eb[e] * 3
    let dx = xyz[b] - xyz[a], dy = xyz[b + 1] - xyz[a + 1], dz = xyz[b + 2] - xyz[a + 2]
    const dl = Math.hypot(dx, dy, dz) || 1
    dx /= dl
    dy /= dl
    dz /= dl
    const mx = (xyz[a] + xyz[b]) / 2, my = (xyz[a + 1] + xyz[b + 1]) / 2, mz = (xyz[a + 2] + xyz[b + 2]) / 2
    let top = true
    for (const f of near) {
      if (f === e || angle[f] <= s) continue
      const p = ea[f] * 3, q = eb[f] * 3
      let fx = xyz[q] - xyz[p], fy = xyz[q + 1] - xyz[p + 1], fz = xyz[q + 2] - xyz[p + 2]
      const fl = Math.hypot(fx, fy, fz) || 1
      fx /= fl
      fy /= fl
      fz /= fl
      if (Math.abs(fx * dx + fy * dy + fz * dz) < PARALLEL_COS) continue
      // Beside it, not on along the crease: its middle farther off e's line
      // than along it.
      const ox = (xyz[p] + xyz[q]) / 2 - mx, oy = (xyz[p + 1] + xyz[q + 1]) / 2 - my, oz = (xyz[p + 2] + xyz[q + 2]) / 2 - mz
      const along = ox * dx + oy * dy + oz * dz
      const off = ox * ox + oy * oy + oz * oz - along * along
      if (off > along * along) {
        top = false
        break
      }
    }
    if (top) kept[e] = 1
  }
  return kept
}

/** The scan's scatter about its own surface: each sampled vertex's offset
 *  along its normal from the middle of its neighbours, their median scaled
 *  to what noise σ on a plane gives a vertex of six — 0.0200 mm read off a
 *  sheet with 0.02 of it, 0.0117 off a box with 0.01. */
function scatterOf(r: Region, normals: Float64Array): number {
  const { xyz, veOffsets, veList, ea, eb, vtOffsets, vtList } = r
  const step = Math.max(1, Math.floor(r.vertices / SCATTER_SAMPLES))
  const offsets: number[] = []
  for (let v = 0; v < r.vertices; v += step) {
    const k = veOffsets[v + 1] - veOffsets[v]
    if (k < 3) continue
    let cx = 0, cy = 0, cz = 0
    for (let i = veOffsets[v]; i < veOffsets[v + 1]; i++) {
      const e = veList[i]
      const w = (ea[e] === v ? eb[e] : ea[e]) * 3
      cx += xyz[w]
      cy += xyz[w + 1]
      cz += xyz[w + 2]
    }
    let nx = 0, ny = 0, nz = 0
    for (let i = vtOffsets[v]; i < vtOffsets[v + 1]; i++) {
      const t = vtList[i]
      nx += normals[t * 3]
      ny += normals[t * 3 + 1]
      nz += normals[t * 3 + 2]
    }
    const nl = Math.hypot(nx, ny, nz)
    if (!(nl > 0)) continue
    offsets.push(Math.abs((xyz[v * 3] - cx / k) * nx + (xyz[v * 3 + 1] - cy / k) * ny + (xyz[v * 3 + 2] - cz / k) * nz) / nl)
  }
  if (offsets.length === 0) return 0
  offsets.sort((a, b) => a - b)
  // |N(0, σ√(7/6))| has its median at 0.674 σ √(7/6) = 0.73 σ.
  return offsets[offsets.length >> 1] / 0.73
}

// ---------------------------------------------------------------------------
// The ridges: the angle across, and the paths.

/** The angle across edge e a few edges out, deg: between the mean filtered
 *  normals of the triangles beside it on either side, ACROSS_SKIP to
 *  ACROSS_REACH mean edges off it — past the triangles a crease crosses
 *  slantwise, which share its angle out between two edges. */
function acrossAngle(r: Region, normals: Float64Array, e: number, edge: number, scratch: { stamp: Int32Array; mark: number; queue: number[] }): number {
  const { xyz, tri, ea, eb, t1, t2, triEdge } = r
  const a = ea[e] * 3, b = eb[e] * 3
  let dx = xyz[b] - xyz[a], dy = xyz[b + 1] - xyz[a + 1], dz = xyz[b + 2] - xyz[a + 2]
  const dl = Math.hypot(dx, dy, dz) || 1
  dx /= dl
  dy /= dl
  dz /= dl
  const f = t1[e], g = t2[e]
  if (f < 0 || g < 0) return 0
  const nx = normals[f * 3] + normals[g * 3], ny = normals[f * 3 + 1] + normals[g * 3 + 1], nz = normals[f * 3 + 2] + normals[g * 3 + 2]
  // Across: square to the edge, in the plane between its two triangles.
  let sx = dy * nz - dz * ny, sy = dz * nx - dx * nz, sz = dx * ny - dy * nx
  const sl = Math.hypot(sx, sy, sz)
  if (!(sl > 0)) return 0
  sx /= sl
  sy /= sl
  sz /= sl
  const mx = (xyz[a] + xyz[b]) / 2, my = (xyz[a + 1] + xyz[b + 1]) / 2, mz = (xyz[a + 2] + xyz[b + 2]) / 2
  const skip = ACROSS_SKIP * edge
  const reach = ACROSS_REACH * edge
  const side = [0, 0, 0, 0, 0, 0]
  const mark = ++scratch.mark
  const queue = scratch.queue
  queue.length = 0
  queue.push(f, g)
  scratch.stamp[f] = mark
  scratch.stamp[g] = mark
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q]
    const i = tri[t * 3] * 3, j = tri[t * 3 + 1] * 3, k = tri[t * 3 + 2] * 3
    const cx = (xyz[i] + xyz[j] + xyz[k]) / 3 - mx, cy = (xyz[i + 1] + xyz[j + 1] + xyz[k + 1]) / 3 - my, cz = (xyz[i + 2] + xyz[j + 2] + xyz[k + 2]) / 3 - mz
    if (cx * cx + cy * cy + cz * cz > reach * reach) continue
    const off = cx * sx + cy * sy + cz * sz
    if (Math.abs(off) >= skip) {
      const o = off > 0 ? 0 : 3
      side[o] += normals[t * 3]
      side[o + 1] += normals[t * 3 + 1]
      side[o + 2] += normals[t * 3 + 2]
    }
    for (let n = 0; n < 3; n++) {
      const h = triEdge[t * 3 + n]
      const u = t1[h] === t ? t2[h] : t1[h]
      if (u < 0 || scratch.stamp[u] === mark) continue
      scratch.stamp[u] = mark
      queue.push(u)
    }
  }
  const l1 = Math.hypot(side[0], side[1], side[2])
  const l2 = Math.hypot(side[3], side[4], side[5])
  if (!(l1 > 0 && l2 > 0)) return 0
  const c = (side[0] * side[3] + side[1] * side[4] + side[2] * side[5]) / (l1 * l2)
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI
}

/** The ridge vertices' paths: the kept edges' vertices, joined by every
 *  edge of the scan between two of them; the pieces that hold a seed edge
 *  (hysteresis), each traced into paths by repeated longest ways (see
 *  above). Each path is a list of vertices. */
function ridgePaths(r: Region, kept: Uint8Array, seed: (e: number) => boolean, edge: number, off: Uint8Array): number[][] {
  const m = r.vertices
  const { ea, eb, veOffsets, veList, xyz } = r
  const cover = COVER_EDGES * edge
  const joinReach = cover + JOIN_EDGES * edge
  const spur = SPUR_EDGES * edge
  const ridge = new Uint8Array(m)
  for (let e = 0; e < r.edges; e++) {
    if (!kept[e]) continue
    ridge[ea[e]] = 1
    ridge[eb[e]] = 1
  }
  for (let v = 0; v < m; v++) if (off[v]) ridge[v] = 0
  const piece = new Int32Array(m).fill(-1)
  const dist = new Float64Array(m)
  const parent = new Int32Array(m)
  const seen = new Int32Array(m).fill(-1)
  const settled = new Int32Array(m).fill(-1)
  const blocked = new Int32Array(m).fill(-1)
  const onPath = new Int32Array(m).fill(-1)
  const covered = new Uint8Array(m)
  const fromRoot = new Float64Array(m)
  const up = new Int32Array(m)
  let stamp = 0
  const heap = new Heap()
  const step = (v: number, w: number) => Math.hypot(xyz[w * 3] - xyz[v * 3], xyz[w * 3 + 1] - xyz[v * 3 + 1], xyz[w * 3 + 2] - xyz[v * 3 + 2])
  /** Dijkstra over the piece from `sources`, out to `limit`, round the
   *  vertices blocked under this stamp: the vertices reached, nearest
   *  first; their distances and parents in dist and parent. `along`
   *  weighs an edge of the scan that is not a kept one OFF_RIDGE times
   *  its length, so that a way keeps to the crease's own edges and does
   *  not cut the inside of its bends a row of vertices in. */
  const reach = (id: number, sources: readonly number[], limit: number, along = false): number[] => {
    const out: number[] = []
    for (const s of sources) {
      dist[s] = 0
      parent[s] = -1
      seen[s] = stamp
      heap.push(s, 0)
    }
    while (heap.size > 0) {
      const [v, d] = heap.pop()
      if (settled[v] === stamp || d > dist[v]) continue
      settled[v] = stamp
      out.push(v)
      for (let i = veOffsets[v]; i < veOffsets[v + 1]; i++) {
        const e = veList[i]
        const w = ea[e] === v ? eb[e] : ea[e]
        if (piece[w] !== id || settled[w] === stamp || blocked[w] === stamp) continue
        const nd = d + (along && !kept[e] ? OFF_RIDGE : 1) * step(v, w)
        if (nd > limit) continue
        if (seen[w] !== stamp || nd < dist[w]) {
          seen[w] = stamp
          dist[w] = nd
          parent[w] = v
          heap.push(w, nd)
        }
      }
    }
    return out
  }
  const paths: number[][] = []
  let pieces = 0
  for (let v0 = 0; v0 < m; v0++) {
    if (!ridge[v0] || piece[v0] >= 0) continue
    // The piece: the ridge vertices joined to v0, and its kept edges.
    const id = pieces++
    const members = [v0]
    const edges: number[] = []
    piece[v0] = id
    for (let q = 0; q < members.length; q++) {
      const v = members[q]
      for (let i = veOffsets[v]; i < veOffsets[v + 1]; i++) {
        const e = veList[i]
        const w = ea[e] === v ? eb[e] : ea[e]
        if (kept[e] && ea[e] === v) edges.push(e)
        if (ridge[w] && piece[w] < 0) {
          piece[w] = id
          members.push(w)
        }
      }
    }
    if (members.length < 2 || !edges.some(seed)) continue
    // The root: the vertex farthest from any one; the tree of shortest
    // ways from it.
    stamp++
    let order = reach(id, [v0], Infinity, true)
    let root = v0
    for (const v of order) if (dist[v] > dist[root]) root = v
    stamp++
    order = reach(id, [root], Infinity, true)
    for (const v of order) {
      fromRoot[v] = dist[v]
      up[v] = parent[v]
    }
    // Paths from the farthest vertex not yet covered back along the tree
    // to the root or to a path already taken; the band round each covered.
    for (;;) {
      let tip = -1
      let far = -1
      for (const v of order) {
        if (covered[v]) continue
        if (fromRoot[v] > far) [far, tip] = [fromRoot[v], v]
      }
      if (tip < 0) break
      let path = [tip]
      let v = tip
      let len = 0
      while (onPath[v] < 0 && v !== root) {
        const w = up[v]
        if (w < 0) break
        len += step(v, w)
        v = w
        path.push(v)
      }
      // A tip just past the band of a path already taken — the other half
      // of a loop, a crease run into a corner — is joined to that path by
      // the shortest way that keeps off its own.
      stamp++
      for (let i = 1; i < path.length; i++) blocked[path[i]] = stamp
      const end = path[path.length - 1]
      const near = reach(id, [tip], joinReach).find((u) => onPath[u] >= 0 && u !== end)
      if (near !== undefined) {
        const lead: number[] = []
        for (let u = near; u !== tip; u = parent[u]) lead.push(u)
        for (let i = 0; i < lead.length; i++) len += step(lead[i], i + 1 < lead.length ? lead[i + 1] : tip)
        path = [...lead, ...path]
      }
      stamp++
      for (const u of reach(id, path, cover)) covered[u] = 1
      for (const u of path) covered[u] = 1
      if (len < spur) continue
      for (const u of path) if (onPath[u] < 0) onPath[u] = paths.length
      paths.push(path)
    }
  }
  return splitAtJoins(paths, onPath)
}

/** The paths cut where another path's end joins one partway along it:
 *  every piece runs from end or join to end or join. */
function splitAtJoins(paths: number[][], onPath: Int32Array): number[][] {
  const cuts = paths.map(() => new Set<number>())
  for (let p = 0; p < paths.length; p++) {
    for (const end of [paths[p][0], paths[p][paths[p].length - 1]]) {
      const q = onPath[end]
      if (q < 0 || q === p) continue
      const at = paths[q].indexOf(end)
      if (at > 0 && at < paths[q].length - 1) cuts[q].add(at)
    }
  }
  const out: number[][] = []
  paths.forEach((path, p) => {
    const at = [...cuts[p]].sort((a, b) => a - b)
    let from = 0
    for (const c of at) {
      out.push(path.slice(from, c + 1))
      from = c
    }
    out.push(path.slice(from))
  })
  return out
}

/** The paths cut to their runs along creases, not rounds. A crease puts
 *  its turn on one edge, or two where it crosses the triangles slantwise;
 *  a round turns a little at every edge. So along a path each kept edge's
 *  angle is set against the angle across it a few edges out: the median
 *  of that share over CONCENTRATION_WINDOW steps either side is from 0.51
 *  to 1 on every path along a crease measured — sharp edges, rims, folds
 *  of 25° to 35° cut slantwise with noise to 0.08 mm — and from 0.16 to
 *  0.31 on every path down a round of 1 to 2 mm on edges of 0.3 and
 *  0.5 mm (0.38 once, on a round of 1 mm on 0.3 mm edges, three edges in
 *  radius; no edge of a 4 mm round passed the weak angle at all). A run
 *  is kept where it is CONCENTRATION or more. */
function creaseRuns(r: Region, paths: readonly number[][], kept: Uint8Array, share: (e: number) => number, spur: number): number[][] {
  const { xyz, veOffsets, veList, ea, eb } = r
  const out: number[][] = []
  const near: number[] = []
  for (const p of paths) {
    const steps = p.length - 1
    const ratio = new Float64Array(steps).fill(NaN)
    for (let i = 0; i < steps; i++) {
      const u = p[i], v = p[i + 1]
      for (let k = veOffsets[u]; k < veOffsets[u + 1]; k++) {
        const e = veList[k]
        if ((ea[e] === v || eb[e] === v) && kept[e]) ratio[i] = share(e)
      }
    }
    const good = new Uint8Array(steps)
    for (let i = 0; i < steps; i++) {
      near.length = 0
      for (let j = Math.max(0, i - CONCENTRATION_WINDOW); j <= Math.min(steps - 1, i + CONCENTRATION_WINDOW); j++) if (!Number.isNaN(ratio[j])) near.push(ratio[j])
      if (near.length === 0) continue
      near.sort((a, b) => a - b)
      good[i] = near[near.length >> 1] >= CONCENTRATION ? 1 : 0
    }
    for (let i = 0; i < steps; ) {
      if (!good[i]) {
        i++
        continue
      }
      let j = i
      let len = 0
      while (j < steps && good[j]) {
        const a = p[j] * 3, b = p[j + 1] * 3
        len += Math.hypot(xyz[b] - xyz[a], xyz[b + 1] - xyz[a + 1], xyz[b + 2] - xyz[a + 2])
        j++
      }
      if (len >= spur) out.push(p.slice(i, j + 1))
      i = j
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Chains between nodes.

interface Chain {
  /** x, y, z per point, from its `from` node to its `to` node. */
  pts: number[]
  from: number
  to: number
}

interface Linked {
  nodes: Vec3[]
  chains: Chain[]
  /** The nodes a chain was cut at, which lie on it as they are. */
  cut: Set<number>
}

/** Two loose ends that point at each other across a gap of up to
 *  BRIDGE_MM, within BRIDGE_DEG — a crease whose angle dips under the weak
 *  one for longer than MERGE_MM, as it does in noise of a tenth of an edge
 *  — made one node, between them; nearest first. A chain's own two ends
 *  are bridged only when it is long enough to be a loop. */
function bridge(nodes: Vec3[], chains: Chain[], minLength: number): void {
  const valence = new Int32Array(nodes.length)
  for (const c of chains) {
    valence[c.from]++
    valence[c.to]++
  }
  const loose: { node: number; chain: number; at: Vec3; out: Vec3 }[] = []
  chains.forEach((c, i) => {
    const length = polylineLength(c.pts)
    for (const end of [0, 1] as const) {
      const node = end === 0 ? c.from : c.to
      if (valence[node] !== 1) continue
      const pts = end === 0 ? c.pts : reversed(c.pts)
      const at: Vec3 = [pts[0], pts[1], pts[2]]
      const back = pointAlong(pts, Math.min(NODE_FAR, 0.5 * length))
      const u: Vec3 = [at[0] - back[0], at[1] - back[1], at[2] - back[2]]
      const l = Math.hypot(...u)
      if (l > 0) loose.push({ node, chain: i, at, out: [u[0] / l, u[1] / l, u[2] / l] })
    }
  })
  const cos = Math.cos((BRIDGE_DEG * Math.PI) / 180)
  const pairs: [number, number, number][] = []
  for (let i = 0; i < loose.length; i++) {
    for (let j = i + 1; j < loose.length; j++) {
      const a = loose[i], b = loose[j]
      if (a.chain === b.chain && polylineLength(chains[a.chain].pts) < minLength) continue
      const g: Vec3 = [b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]]
      const d = Math.hypot(...g)
      if (d > BRIDGE_MM) continue
      const along = d > 0 ? (a.out[0] * g[0] + a.out[1] * g[1] + a.out[2] * g[2]) / d : 1
      const back = d > 0 ? -(b.out[0] * g[0] + b.out[1] * g[1] + b.out[2] * g[2]) / d : 1
      const facing = -(a.out[0] * b.out[0] + a.out[1] * b.out[1] + a.out[2] * b.out[2])
      if (along >= cos && back >= cos && facing >= cos) pairs.push([d, i, j])
    }
  }
  pairs.sort((p, q) => p[0] - q[0])
  const done = new Uint8Array(loose.length)
  for (const [, i, j] of pairs) {
    if (done[i] || done[j]) continue
    done[i] = done[j] = 1
    const a = loose[i], b = loose[j]
    nodes[a.node] = [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2, (a.at[2] + b.at[2]) / 2]
    for (const c of chains) {
      if (c.from === b.node) c.from = a.node
      if (c.to === b.node) c.to = a.node
    }
  }
}

/** The points gathered into clusters, nearest pairs first, each no wider
 *  than MERGE_MM across and never holding two points `apart` says must
 *  stay apart — transitively, ends a little over a millimetre apart along
 *  a crease broken every millimetre would all be one: each point's
 *  cluster, by its first point. */
function clusters(at: readonly Vec3[], apart: (i: number, j: number) => boolean): number[] {
  const n = at.length
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => at[a][0] - at[b][0])
  const d = (i: number, j: number) => Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1], at[i][2] - at[j][2])
  const pairs: [number, number, number][] = []
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n && at[order[b]][0] - at[order[a]][0] < MERGE_MM; b++) {
      const dist = d(order[a], order[b])
      if (dist < MERGE_MM) pairs.push([dist, order[a], order[b]])
    }
  }
  pairs.sort((p, q) => p[0] - q[0])
  const of = Array.from({ length: n }, (_, i) => i)
  const members = Array.from({ length: n }, (_, i) => [i])
  for (const [, i, j] of pairs) {
    const a = of[i], b = of[j]
    if (a === b) continue
    if (members[a].some((p) => members[b].some((q) => apart(p, q) || d(p, q) >= MERGE_MM))) continue
    for (const q of members[b]) of[q] = a
    members[a].push(...members[b])
    members[b] = []
  }
  return of
}

function polylineLength(pts: readonly number[]): number {
  let l = 0
  for (let i = 3; i < pts.length; i += 3) l += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1])
  return l
}

function reversed(pts: readonly number[]): number[] {
  const out: number[] = []
  for (let i = pts.length - 3; i >= 0; i -= 3) out.push(pts[i], pts[i + 1], pts[i + 2])
  return out
}

/** Two chains through a node no other reaches made one: the pieces of a
 *  crease cut slantwise, whose angle dips under the weak one an edge or
 *  two at a time, and a chain cut where a spur left it. One pass: joining
 *  leaves every other node's count as it was. */
function joinedThrough(nodes: readonly Vec3[], chains: readonly Chain[]): Chain[] {
  const live: (Chain | null)[] = chains.slice()
  const at: number[][] = nodes.map(() => [])
  live.forEach((c, i) => {
    at[c!.from].push(i)
    at[c!.to].push(i)
  })
  for (let n = 0; n < nodes.length; n++) {
    const [ia, ib] = at[n]
    if (at[n].length !== 2 || ia === ib) continue
    const a = live[ia]!, b = live[ib]!
    const into = a.to === n ? a.pts : reversed(a.pts)
    const out = b.from === n ? b.pts : reversed(b.pts)
    const c: Chain = { pts: [...into.slice(0, -3), ...nodes[n], ...out.slice(3)], from: a.to === n ? a.from : a.to, to: b.from === n ? b.to : b.from }
    live[ia] = live[ib] = null
    const ic = live.length
    live.push(c)
    at[n] = []
    for (const end of new Set([c.from, c.to])) at[end] = at[end].map((i) => (i === ia || i === ib ? ic : i))
  }
  return live.filter((c): c is Chain => c !== null)
}

/** The paths' ends merged into nodes within MERGE_MM; chains through a
 *  node only two reach joined into one; short chains hanging off a node
 *  dropped. */
function linkChains(r: Region, paths: readonly number[][], minLength: number): Linked {
  const { xyz } = r
  const ends: { vertex: number; at: Vec3 }[] = []
  for (const p of paths) {
    for (const v of [p[0], p[p.length - 1]]) ends.push({ vertex: v, at: [xyz[v * 3], xyz[v * 3 + 1], xyz[v * 3 + 2]] })
  }
  // Ends 2i and 2i + 1 are path i's.
  const groupOf = clusters(
    ends.map((e) => e.at),
    (i, j) => i >> 1 === j >> 1,
  )
  const nodeOf = new Map<number, number>()
  const sums: number[][] = []
  const endNode = ends.map((e, i) => {
    const root = groupOf[i]
    let n = nodeOf.get(root)
    if (n === undefined) {
      n = sums.length
      nodeOf.set(root, n)
      sums.push([0, 0, 0, 0])
    }
    sums[n][0] += e.at[0]
    sums[n][1] += e.at[1]
    sums[n][2] += e.at[2]
    sums[n][3]++
    return n
  })
  const nodes: Vec3[] = sums.map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]])
  let chains: Chain[] = paths.map((p, i) => {
    const pts: number[] = []
    for (const v of p) pts.push(xyz[v * 3], xyz[v * 3 + 1], xyz[v * 3 + 2])
    return { pts, from: endNode[i * 2], to: endNode[i * 2 + 1] }
  })
  bridge(nodes, chains, minLength)
  for (;;) {
    chains = joinedThrough(nodes, chains)
    // A short chain off a node no other reaches, or round from a node to
    // itself, is a spur or a crumb.
    const valence = new Int32Array(nodes.length)
    for (const c of chains) {
      valence[c.from]++
      valence[c.to]++
    }
    const before = chains.length
    chains = chains.filter((c) => !(polylineLength(c.pts) < minLength && (valence[c.from] === 1 || valence[c.to] === 1 || c.from === c.to)))
    if (chains.length === before) break
  }
  // Each chain runs from its node to its node.
  for (const c of chains) {
    c.pts.splice(0, 3, ...nodes[c.from])
    c.pts.splice(c.pts.length - 3, 3, ...nodes[c.to])
  }
  return { nodes, chains, cut: new Set() }
}

/** The chains cut at their corners — where they turn CORNER_TURN_DEG or
 *  more over CORNER_REACH either side, the sharpest first and no two
 *  closer than twice that — a closed chain also where other chains meet
 *  it, and one of fewer than three corners into LOOP_PIECES, the longest
 *  piece halved each time. */
function splitChains(linked: Linked): Linked {
  const nodes = linked.nodes.slice()
  const cut = new Set(linked.cut)
  const valence = new Int32Array(nodes.length)
  for (const c of linked.chains) {
    valence[c.from]++
    valence[c.to]++
  }
  const chains: Chain[] = []
  for (const c of linked.chains) {
    const closed = c.from === c.to
    const n = c.pts.length / 3
    const s = new Float64Array(n)
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(c.pts[i * 3] - c.pts[i * 3 - 3], c.pts[i * 3 + 1] - c.pts[i * 3 - 2], c.pts[i * 3 + 2] - c.pts[i * 3 - 1])
    const total = s[n - 1]
    if (n < 3 || total <= 0) {
      chains.push(c)
      continue
    }
    /** The point at arc length t, round the loop on a closed chain. */
    const pointAt = (t: number): Vec3 | null => {
      if (closed) t = ((t % total) + total) % total
      else if (t < 0 || t > total) return null
      let lo = 0
      let hi = n - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (s[mid] <= t) lo = mid
        else hi = mid
      }
      const f = s[hi] > s[lo] ? (t - s[lo]) / (s[hi] - s[lo]) : 0
      return [0, 1, 2].map((k) => c.pts[lo * 3 + k] + f * (c.pts[hi * 3 + k] - c.pts[lo * 3 + k])) as Vec3
    }
    const turn = new Float64Array(n)
    const last = closed ? n - 1 : n
    for (let i = 0; i < last; i++) {
      const b = pointAt(s[i] - CORNER_REACH)
      const f = pointAt(s[i] + CORNER_REACH)
      if (!b || !f) continue
      const p: Vec3 = [c.pts[i * 3], c.pts[i * 3 + 1], c.pts[i * 3 + 2]]
      const u: Vec3 = [p[0] - b[0], p[1] - b[1], p[2] - b[2]]
      const w: Vec3 = [f[0] - p[0], f[1] - p[1], f[2] - p[2]]
      const l = Math.hypot(...u) * Math.hypot(...w)
      if (l > 0) turn[i] = (Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / l))) * 180) / Math.PI
    }
    const apart = (i: number, j: number) => {
      const d = Math.abs(s[i] - s[j])
      return closed ? Math.min(d, total - d) : d
    }
    const cuts: number[] = []
    // A closed chain through a node others reach is cut there.
    if (closed && valence[c.from] > 2) cuts.push(0)
    const order = Array.from({ length: last }, (_, i) => i).filter((i) => turn[i] >= CORNER_TURN_DEG).sort((a, b) => turn[b] - turn[a])
    for (const i of order) if (cuts.every((j) => apart(i, j) >= 2 * CORNER_REACH)) cuts.push(i)
    if (closed && cuts.length < 3) {
      if (cuts.length === 0) {
        let best = 0
        for (let i = 1; i < last; i++) if (turn[i] > turn[best]) best = i
        cuts.push(best)
      }
      while (cuts.length < LOOP_PIECES) {
        cuts.sort((a, b) => s[a] - s[b])
        let gap = -1
        let at = 0
        for (let k = 0; k < cuts.length; k++) {
          const a = s[cuts[k]]
          const b = k + 1 < cuts.length ? s[cuts[k + 1]] : s[cuts[0]] + total
          if (b - a > gap) [gap, at] = [b - a, k]
        }
        const mid = (s[cuts[at]] + gap / 2) % total
        let best = 0
        for (let i = 0; i < last; i++) if (Math.abs(s[i] - mid) < Math.abs(s[best] - mid)) best = i
        if (cuts.includes(best)) break
        cuts.push(best)
      }
    }
    cuts.sort((a, b) => s[a] - s[b])
    if (cuts.length === 0) {
      chains.push(c)
      continue
    }
    const nodeAt = cuts.map((i) => {
      if (closed && i === 0 && valence[c.from] > 2) return c.from
      nodes.push([c.pts[i * 3], c.pts[i * 3 + 1], c.pts[i * 3 + 2]])
      cut.add(nodes.length - 1)
      return nodes.length - 1
    })
    const slice = (i: number, j: number): number[] => {
      // From point i to point j, on round the loop past its end if need be.
      if (j > i) return c.pts.slice(i * 3, j * 3 + 3)
      return [...c.pts.slice(i * 3, (n - 1) * 3), ...c.pts.slice(0, j * 3 + 3)]
    }
    if (closed) {
      for (let k = 0; k < cuts.length; k++) {
        const i = cuts[k]
        const j = cuts[(k + 1) % cuts.length]
        chains.push({ pts: slice(i, j), from: nodeAt[k], to: nodeAt[(k + 1) % cuts.length] })
      }
    } else {
      const at = [0, ...cuts, n - 1]
      const ids = [c.from, ...nodeAt, c.to]
      for (let k = 0; k + 1 < at.length; k++) chains.push({ pts: c.pts.slice(at[k] * 3, at[k + 1] * 3 + 3), from: ids[k], to: ids[k + 1] })
    }
  }
  return { nodes, chains, cut }
}

/** The nodes the cuts made merged with any within MERGE_MM; crumbs — a
 *  short chain round from a node to itself — dropped; each node where
 *  chains ended put where their ends, carried on straight, meet (a path
 *  stops short of a corner, or cuts it, by an edge or two) — not one a
 *  chain was cut at, which lies on it, unless three chains or more meet
 *  there; each taken onto the scan; and the chains run to it. */
function settleNodes(scan: ScanPaths, linked: Linked, minLength: number): Linked {
  const n = linked.nodes.length
  const used = new Uint8Array(n)
  for (const c of linked.chains) used[c.from] = used[c.to] = 1
  // Two nodes a chain longer than the shortest joins stay two: merged, the
  // chain would close on itself.
  const long = new Set<number>()
  for (const c of linked.chains) if (polylineLength(c.pts) >= minLength) long.add(Math.min(c.from, c.to) * n + Math.max(c.from, c.to))
  const ids = Array.from({ length: n }, (_, i) => i).filter((i) => used[i])
  const groupOf = clusters(
    ids.map((i) => linked.nodes[i]),
    (a, b) => long.has(Math.min(ids[a], ids[b]) * n + Math.max(ids[a], ids[b])),
  )
  const position = new Int32Array(n)
  ids.forEach((id, k) => (position[id] = k))
  const find = (i: number) => ids[groupOf[position[i]]]
  const sums = linked.nodes.map(() => [0, 0, 0, 0])
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue
    const r = find(i)
    for (let k = 0; k < 3; k++) sums[r][k] += linked.nodes[i][k]
    sums[r][3]++
  }
  const nodes: Vec3[] = sums.map((v, i) => (v[3] > 0 ? [v[0] / v[3], v[1] / v[3], v[2] / v[3]] : linked.nodes[i]))
  // A node is a cut's when all it was merged from were.
  const ended = new Set<number>()
  for (const i of ids) if (!linked.cut.has(i)) ended.add(find(i))
  const chains = linked.chains
    .map((c) => ({ pts: c.pts, from: find(c.from), to: find(c.to) }))
    .filter((c) => !(c.from === c.to && polylineLength(c.pts) < minLength))
  // The lines the chains come in by: from a point NODE_FAR along each to
  // one NODE_NEAR from its end.
  const lines = new Map<number, { p: Vec3; u: Vec3 }[]>()
  for (const c of chains) {
    const length = polylineLength(c.pts)
    for (const end of [0, 1] as const) {
      const pts = end === 0 ? c.pts : reversed(c.pts)
      const far = pointAlong(pts, Math.min(NODE_FAR, 0.5 * length))
      const near = pointAlong(pts, Math.min(NODE_NEAR, 0.15 * length))
      const u: Vec3 = [near[0] - far[0], near[1] - far[1], near[2] - far[2]]
      const l = Math.hypot(...u)
      if (!(l > 0)) continue
      const node = end === 0 ? c.from : c.to
      const list = lines.get(node) ?? []
      list.push({ p: far, u: [u[0] / l, u[1] / l, u[2] / l] })
      lines.set(node, list)
    }
  }
  // Least squares: the point nearest the lines, held lightly to the mean
  // of the ends, which is where it stays along lines that run on straight.
  for (const [node, list] of lines) {
    if (list.length < 2 || (list.length < 3 && !ended.has(node))) continue
    const x0 = nodes[node]
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    const b = [0, 0, 0]
    const hold = NODE_HOLD * list.length
    for (let i = 0; i < 3; i++) {
      m[i * 4] += hold
      b[i] += hold * x0[i]
    }
    for (const { p, u } of list) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const a = (i === j ? 1 : 0) - u[i] * u[j]
          m[i * 3 + j] += a
          b[i] += a * p[j]
        }
      }
    }
    const x = solve3(m, b)
    if (x && Math.hypot(x[0] - x0[0], x[1] - x0[1], x[2] - x0[2]) < MERGE_MM) nodes[node] = x
  }
  for (const node of lines.keys()) {
    const c = scan.closest(nodes[node])
    if (c) nodes[node] = c.point
  }
  for (const c of chains) {
    c.pts.splice(0, 3, ...nodes[c.from])
    c.pts.splice(c.pts.length - 3, 3, ...nodes[c.to])
  }
  return { nodes, chains, cut: new Set() }
}

/** The point at arc length t along a polyline, held to its ends. */
function pointAlong(pts: readonly number[], t: number): Vec3 {
  let left = t
  for (let i = 3; i < pts.length; i += 3) {
    const l = Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1])
    if (l >= left && l > 0) {
      const f = left / l
      return [pts[i - 3] + f * (pts[i] - pts[i - 3]), pts[i - 2] + f * (pts[i + 1] - pts[i - 2]), pts[i - 1] + f * (pts[i + 2] - pts[i - 1])]
    }
    left -= l
  }
  return [pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]]
}

/** The 3 × 3 system m x = b, row-major, or null when singular. */
function solve3(m: number[], b: number[]): Vec3 | null {
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  if (!(Math.abs(det) > 1e-12)) return null
  const x = (b[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (b[1] * m[8] - m[5] * b[2]) + m[2] * (b[1] * m[7] - m[4] * b[2])) / det
  const y = (m[0] * (b[1] * m[8] - m[5] * b[2]) - b[0] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * b[2] - b[1] * m[6])) / det
  const z = (m[0] * (m[4] * b[2] - b[1] * m[7]) - m[1] * (m[3] * b[2] - b[1] * m[6]) + b[0] * (m[3] * m[7] - m[4] * m[6])) / det
  return [x, y, z]
}

// ---------------------------------------------------------------------------
// The curves.

/** Each chain fitted (PN2), its grips, length and angle — a chain whose
 *  angle across comes to less than `weak` is no crease, and is left out,
 *  and so is a group of curves joined at their nodes that all together is
 *  shorter than the shortest chain: a speck, a dent or a chip or a burst
 *  of noise, however its corners cut it up — and the nodes the curves
 *  reach, numbered from 1. */
function curvesOf(scan: ScanPaths, linked: Linked, weak: number, minLength: number): CreaseSuggestion {
  type Fitted = { from: number; to: number; line: Float64Array; s: Float64Array; angle: number }
  const fitted: Fitted[] = []
  for (const c of linked.chains) {
    const count = c.pts.length / 3
    if (count < 2) continue
    const points = Float32Array.from(c.pts)
    const at = new Float64Array(count)
    for (let i = 1; i < count; i++) at[i] = at[i - 1] + Math.hypot(points[i * 3] - points[i * 3 - 3], points[i * 3 + 1] - points[i * 3 - 2], points[i * 3 + 2] - points[i * 3 - 1])
    const trace: CurvePoints = { points, at, length: at[count - 1] }
    if (!(trace.length > 0)) continue
    const fit = fitCurve(trace, autoSpans(trace))
    const samples = Math.max(8, Math.min(MAX_SAMPLES, Math.ceil(trace.length / (SAMPLE_EDGES * scan.edge)) + 1))
    const line = sampleCurve(fit, samples)
    const s = new Float64Array(samples)
    for (let i = 1; i < samples; i++) s[i] = s[i - 1] + Math.hypot(line[i * 3] - line[i * 3 - 3], line[i * 3 + 1] - line[i * 3 - 2], line[i * 3 + 2] - line[i * 3 - 1])
    const angle = angleAlong(scan, line, s)
    if (angle >= weak) fitted.push({ from: c.from, to: c.to, line, s, angle })
  }
  const group = linked.nodes.map((_, i) => i)
  const root = (i: number): number => {
    while (group[i] !== i) {
      group[i] = group[group[i]]
      i = group[i]
    }
    return i
  }
  for (const f of fitted) group[root(f.from)] = root(f.to)
  const total = new Float64Array(linked.nodes.length)
  for (const f of fitted) total[root(f.from)] += f.s[f.s.length - 1]
  const ids = new Map<number, number>()
  const nodes: CreaseSuggestion['nodes'] = []
  const idOf = (n: number) => {
    let id = ids.get(n)
    if (id === undefined) {
      id = nodes.length + 1
      ids.set(n, id)
      nodes.push({ id, at: linked.nodes[n] })
    }
    return id
  }
  const curves: CreaseSuggestion['curves'] = []
  for (const { from, to, line, s, angle } of fitted) {
    if (total[root(from)] < minLength) continue
    const via = gripsOf(line, s, GRIP_SAG_EDGES * scan.edge).map((i) => {
      const p: Vec3 = [line[i * 3], line[i * 3 + 1], line[i * 3 + 2]]
      return scan.closest(p)?.point ?? p
    })
    curves.push({ from: idOf(from), to: idOf(to), via, length: s[s.length - 1], angle, points: Float32Array.from(line) })
  }
  return { nodes, curves }
}

/** The samples to take as grips, the ends left out: each as far on from
 *  the last as the chord between them stays within `sag` of the curve,
 *  and GRIP_SPACING at most. */
function gripsOf(line: Float64Array, s: Float64Array, sag: number): number[] {
  const n = s.length
  const out: number[] = []
  let i = 0
  while (i < n - 1) {
    let j = i + 1
    while (j + 1 < n && s[j + 1] - s[i] <= GRIP_SPACING && chordHolds(line, i, j + 1, sag)) j++
    if (j >= n - 1) break
    out.push(j)
    i = j
  }
  return out
}

/** Whether every sample between i and j lies within `sag` of the chord. */
function chordHolds(line: Float64Array, i: number, j: number, sag: number): boolean {
  const ax = line[i * 3], ay = line[i * 3 + 1], az = line[i * 3 + 2]
  const dx = line[j * 3] - ax, dy = line[j * 3 + 1] - ay, dz = line[j * 3 + 2] - az
  const dd = dx * dx + dy * dy + dz * dz
  for (let k = i + 1; k < j; k++) {
    const px = line[k * 3] - ax, py = line[k * 3 + 1] - ay, pz = line[k * 3 + 2] - az
    const t = dd > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / dd)) : 0
    if (Math.hypot(px - t * dx, py - t * dy, pz - t * dz) > sag) return false
  }
  return true
}

/** The mean angle across the crease, deg: at every ANGLE_STEP along it,
 *  the scan's normal a few edges off it either side. */
function angleAlong(scan: ScanPaths, line: Float64Array, s: Float64Array): number {
  const n = s.length
  const total = s[n - 1]
  const off = ANGLE_OFFSET_EDGES * scan.edge
  const radius = ANGLE_RADIUS_EDGES * scan.edge
  let sum = 0
  let count = 0
  // Not at the very ends, where other creases meet it; a short curve is
  // read in its middle half.
  const margin = Math.min(off, total / 4)
  const steps = Math.max(2, Math.round(total / ANGLE_STEP))
  let k = 0
  for (let step = 0; step <= steps; step++) {
    const want = (total * step) / steps
    if (want < margin || want > total - margin) continue
    while (k + 1 < n && s[k + 1] <= want) k++
    const a = Math.max(0, k - 1)
    const b = Math.min(n - 1, k + 1)
    const p: Vec3 = [line[k * 3], line[k * 3 + 1], line[k * 3 + 2]]
    const t: Vec3 = [line[b * 3] - line[a * 3], line[b * 3 + 1] - line[a * 3 + 1], line[b * 3 + 2] - line[a * 3 + 2]]
    const c = scan.closest(p)
    if (!c) continue
    const normal = scan.normalAt(c.point, c.triangle)
    const across = cross(t, normal)
    const al = Math.hypot(...across)
    if (!(al > 0)) continue
    const one = normalNear(scan, [p[0] + (across[0] / al) * off, p[1] + (across[1] / al) * off, p[2] + (across[2] / al) * off], radius)
    const two = normalNear(scan, [p[0] - (across[0] / al) * off, p[1] - (across[1] / al) * off, p[2] - (across[2] / al) * off], radius)
    if (!one || !two) continue
    sum += (Math.acos(Math.max(-1, Math.min(1, one[0] * two[0] + one[1] * two[1] + one[2] * two[2]))) * 180) / Math.PI
    count++
  }
  return count > 0 ? sum / count : 0
}

/** The scan's normal at its nearest point to q: its triangles' within
 *  `radius` of that point, by area. */
function normalNear(scan: ScanPaths, q: Vec3, radius: number): Vec3 | null {
  const c = scan.closest(q)
  if (!c) return null
  const p = c.point
  const sum: Vec3 = [0, 0, 0]
  const near: Vec3 = [0, 0, 0]
  for (const t of scan.trianglesIn([p[0] - radius, p[1] - radius, p[2] - radius], [p[0] + radius, p[1] + radius, p[2] + radius])) {
    if (scan.closestOnTriangle(t, p, near) > radius) continue
    const a = scan.indices[t * 3] * 3, b = scan.indices[t * 3 + 1] * 3, d = scan.indices[t * 3 + 2] * 3
    const pos = scan.positions
    const w = cross([pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], [pos[d] - pos[a], pos[d + 1] - pos[a + 1], pos[d + 2] - pos[a + 2]])
    sum[0] += w[0]
    sum[1] += w[1]
    sum[2] += w[2]
  }
  const l = Math.hypot(...sum)
  return l > 0 ? [sum[0] / l, sum[1] / l, sum[2] / l] : c.normal
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** A binary min-heap of (vertex, distance). */
class Heap {
  private ids: number[] = []
  private keys: number[] = []

  get size(): number {
    return this.ids.length
  }

  push(id: number, key: number): void {
    const ids = this.ids
    const keys = this.keys
    let i = ids.length
    ids.push(id)
    keys.push(key)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      ids[i] = ids[parent]
      keys[i] = keys[parent]
      i = parent
    }
    ids[i] = id
    keys[i] = key
  }

  pop(): [number, number] {
    const ids = this.ids
    const keys = this.keys
    const top: [number, number] = [ids[0], keys[0]]
    const lastId = ids.pop()!
    const lastKey = keys.pop()!
    const n = ids.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && keys[r] < keys[l] ? r : l
        if (keys[c] >= lastKey) break
        ids[i] = ids[c]
        keys[i] = keys[c]
        i = c
      }
      ids[i] = lastId
      keys[i] = lastKey
    }
    return top
  }
}

