// SPDX-License-Identifier: AGPL-3.0-only
// The generalized winding number of a triangle set: the solid angle its
// triangles cover seen from a point, over 4π (Jacobson et al. 2013). For a
// closed surface wound with its normals out it is 1 inside and 0 outside;
// for a scan with holes it eases towards ½ near them and stays near 1 deep
// inside, with no repair, no welding and no consistent topology needed — a
// triangle soup is read as well as a mesh.
//
// Summed over every triangle it costs a pass over the scan per point, so it
// is evaluated on a tree (Barill et al. 2018): a node far from the point
// compared with its size counts as one dipole at its centroid — the
// area-weighted normal sum, Σ aᵢnᵢ — with the next term of the expansion
// beside it; only nodes near the point are opened, down to leaves of a few
// triangles summed exactly.

/** How far a node must be, in its radii, before it is read as its expansion
 *  instead of opened: Barill's default. */
export const DEFAULT_BETA = 2
/** Triangles in a leaf, at most. */
const LEAF_SIZE = 8
const FOUR_PI = 4 * Math.PI

export interface WindingTreeOptions {
  /** See DEFAULT_BETA. */
  beta?: number
  /** How many terms of a node's expansion are summed: 1, the dipole
   *  alone; 2, with the first moment; 3 (default), with the second too —
   *  Barill's second order. Two terms gain little on a curved patch seen
   *  from near its centre of curvature, where the third is as large. */
  order?: 1 | 2 | 3
}

/**
 * A tree over a triangle set for winding-number queries. Built over
 * positions with indices, or over a soup (nine coordinates a triangle) when
 * the indices are null. The triangles are read as wound; a set wound inside
 * out answers −w, which a caller turns round by its sign.
 */
export class WindingTree {
  readonly triangleCount: number
  /** Points queried, and nodes opened or read, since the tree was built. */
  queries = 0
  visits = 0
  private readonly beta2: number
  /** Per node: centroid xyz, radius, Σ aᵢnᵢ xyz. */
  private readonly node: Float64Array
  /** Per node, from order 2: the first moment M (row-major 3×3),
   *  M_jk = Σ ∫ (x − c)_j n_k dA. */
  private readonly moment: Float32Array | null
  /** Per node, at order 3: the second moment Q_klj = Σ ∫ (x − c)_k
   *  (x − c)_l n_j dA, symmetric in k, l: for each of xx, xy, xz, yy, yz,
   *  zz, its three j. */
  private readonly moment2: Float32Array | null
  /** Per node: the right child, or −1 for a leaf (the left is the next node). */
  private readonly right: Int32Array
  /** Per leaf: its first triangle in `corners` and how many. */
  private readonly first: Uint32Array
  private readonly count: Uint8Array
  /** The triangles' corners in tree order, nine a triangle. */
  private readonly corners: Float32Array
  private readonly stack = new Int32Array(256)

  constructor(positions: Float32Array, indices: Uint32Array | null, { beta = DEFAULT_BETA, order = 3 }: WindingTreeOptions = {}) {
    this.beta2 = beta * beta
    const total = indices ? indices.length / 3 : positions.length / 9
    const corner = (t: number, k: number) => (indices ? indices[t * 3 + k] : t * 3 + k) * 3

    // Each triangle's centroid and half cross product; a triangle with no
    // area covers no solid angle and is left out — its exact angle, read on
    // its line, would be ±2π of noise.
    let kept = 0
    const keep = new Uint32Array(total)
    const g = new Float64Array(total * 3)
    const an = new Float64Array(total * 3)
    for (let t = 0; t < total; t++) {
      const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2)
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
      const nx = (uy * vz - uz * vy) / 2, ny = (uz * vx - ux * vz) / 2, nz = (ux * vy - uy * vx) / 2
      if (nx === 0 && ny === 0 && nz === 0) continue
      const i = kept++
      keep[i] = t
      an[i * 3] = nx
      an[i * 3 + 1] = ny
      an[i * 3 + 2] = nz
      for (let k = 0; k < 3; k++) g[i * 3 + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3
    }
    this.triangleCount = kept

    const order3 = new Uint32Array(kept)
    for (let i = 0; i < kept; i++) order3[i] = i
    const nodeCount = nodesFor(kept, new Map())
    const node = new Float64Array(nodeCount * 7)
    // The moments only correct a node's dipole: single precision is ample,
    // and halves what a scan-sized tree holds.
    const moment = order >= 2 ? new Float32Array(nodeCount * 9) : null
    const moment2 = order >= 3 ? new Float32Array(nodeCount * 18) : null
    const right = new Int32Array(nodeCount)
    const first = new Uint32Array(nodeCount)
    const count = new Uint8Array(nodeCount)
    let nodes = 0

    // Depth first, each node before its children: the left child is the
    // next node, the right one is written once the left subtree is done.
    const work: number[] = [0, kept, -1]
    while (work.length > 0) {
      const parent = work.pop()!
      const end = work.pop()!
      const start = work.pop()!
      const id = nodes++
      if (parent >= 0) right[parent] = id
      this.summarise(id, start, end, order3, g, an, positions, keep, corner, node, moment, moment2)
      if (end - start <= LEAF_SIZE) {
        right[id] = -1
        first[id] = start
        count[id] = end - start
        continue
      }
      // Split at the median centroid along the widest spread of centroids.
      let lo0 = Infinity, lo1 = Infinity, lo2 = Infinity, hi0 = -Infinity, hi1 = -Infinity, hi2 = -Infinity
      for (let i = start; i < end; i++) {
        const o = order3[i] * 3
        if (g[o] < lo0) lo0 = g[o]
        if (g[o] > hi0) hi0 = g[o]
        if (g[o + 1] < lo1) lo1 = g[o + 1]
        if (g[o + 1] > hi1) hi1 = g[o + 1]
        if (g[o + 2] < lo2) lo2 = g[o + 2]
        if (g[o + 2] > hi2) hi2 = g[o + 2]
      }
      const axis = hi0 - lo0 >= hi1 - lo1 && hi0 - lo0 >= hi2 - lo2 ? 0 : hi1 - lo1 >= hi2 - lo2 ? 1 : 2
      const mid = (start + end) >> 1
      selectNth(order3, g, axis, start, end - 1, mid)
      // The right half is popped after the whole left subtree.
      work.push(mid, end, id, start, mid, -1)
    }
    this.node = node
    this.moment = moment
    this.moment2 = moment2
    this.right = right
    this.first = first
    this.count = count

    const corners = new Float32Array(kept * 9)
    for (let i = 0; i < kept; i++) {
      const t = keep[order3[i]]
      for (let k = 0; k < 3; k++) {
        const v = corner(t, k)
        corners[i * 9 + k * 3] = positions[v]
        corners[i * 9 + k * 3 + 1] = positions[v + 1]
        corners[i * 9 + k * 3 + 2] = positions[v + 2]
      }
    }
    this.corners = corners
  }

  /** What the tree holds, bytes. */
  get bytes(): number {
    return this.node.byteLength + (this.moment?.byteLength ?? 0) + (this.moment2?.byteLength ?? 0) + this.right.byteLength + this.first.byteLength + this.count.byteLength + this.corners.byteLength
  }

  /** The winding number at a point. */
  at(x: number, y: number, z: number): number {
    this.queries++
    const { node, moment, moment2, right, first, count, corners, stack, beta2 } = this
    let sum = 0
    let top = 0
    stack[top++] = 0
    let visits = 0
    while (top > 0) {
      const id = stack[--top]
      visits++
      const o = id * 7
      const rx = node[o] - x, ry = node[o + 1] - y, rz = node[o + 2] - z
      const d2 = rx * rx + ry * ry + rz * rz
      const r = node[o + 3]
      if (d2 > beta2 * r * r) {
        const d = Math.sqrt(d2)
        const inv3 = 1 / (d2 * d)
        sum += (node[o + 4] * rx + node[o + 5] * ry + node[o + 6] * rz) * inv3
        if (moment) {
          const m = id * 9
          const trace = moment[m] + moment[m + 4] + moment[m + 8]
          const rMr =
            rx * (moment[m] * rx + moment[m + 1] * ry + moment[m + 2] * rz) +
            ry * (moment[m + 3] * rx + moment[m + 4] * ry + moment[m + 5] * rz) +
            rz * (moment[m + 6] * rx + moment[m + 7] * ry + moment[m + 8] * rz)
          sum += trace * inv3 - (3 * rMr * inv3) / d2
        }
        if (moment2) {
          // ½ Σ T_jkl Q_klj, T the third derivative of r/|r|³:
          // −3(δ_jk r_l + δ_jl r_k + δ_kl r_j)/d⁵ + 15 r_j r_k r_l/d⁷.
          const q = id * 18
          // u_l = Σ_k Q_klk and v_j = Σ_k Q_kkj, through the six pairs.
          const xx = q, xy = q + 3, xz = q + 6, yy = q + 9, yz = q + 12, zz = q + 15
          const ux = moment2[xx] + moment2[xy + 1] + moment2[xz + 2]
          const uy = moment2[xy] + moment2[yy + 1] + moment2[yz + 2]
          const uz = moment2[xz] + moment2[yz + 1] + moment2[zz + 2]
          const vx = moment2[xx] + moment2[yy] + moment2[zz]
          const vy = moment2[xx + 1] + moment2[yy + 1] + moment2[zz + 1]
          const vz = moment2[xx + 2] + moment2[yy + 2] + moment2[zz + 2]
          // Σ_j r_j Q_klj for each pair, then Σ_kl r_k r_l of it.
          const rq = (o: number) => rx * moment2[o] + ry * moment2[o + 1] + rz * moment2[o + 2]
          const rrr = rx * rx * rq(xx) + ry * ry * rq(yy) + rz * rz * rq(zz) + 2 * (rx * ry * rq(xy) + rx * rz * rq(xz) + ry * rz * rq(yz))
          const inv5 = inv3 / d2
          sum += 0.5 * (-3 * inv5 * (2 * (rx * ux + ry * uy + rz * uz) + rx * vx + ry * vy + rz * vz) + (15 * inv5 * rrr) / d2)
        }
        continue
      }
      const child = right[id]
      if (child >= 0) {
        stack[top++] = child
        stack[top++] = id + 1
        continue
      }
      const end = first[id] + count[id]
      for (let t = first[id]; t < end; t++) sum += 2 * solidAngle(corners, t * 9, x, y, z)
    }
    this.visits += visits
    return sum / FOUR_PI
  }

  /** The winding number summed over every triangle — the exact value the
   *  tree approximates. */
  exact(x: number, y: number, z: number): number {
    let sum = 0
    for (let t = 0; t < this.triangleCount; t++) sum += 2 * solidAngle(this.corners, t * 9, x, y, z)
    return sum / FOUR_PI
  }

  private summarise(
    id: number,
    start: number,
    end: number,
    order3: Uint32Array,
    g: Float64Array,
    an: Float64Array,
    positions: Float32Array,
    keep: Uint32Array,
    corner: (t: number, k: number) => number,
    node: Float64Array,
    moment: Float32Array | null,
    moment2: Float32Array | null,
  ): void {
    let area = 0, cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0
    for (let i = start; i < end; i++) {
      const o = order3[i] * 3
      const a = Math.hypot(an[o], an[o + 1], an[o + 2])
      area += a
      cx += a * g[o]
      cy += a * g[o + 1]
      cz += a * g[o + 2]
      nx += an[o]
      ny += an[o + 1]
      nz += an[o + 2]
    }
    cx /= area
    cy /= area
    cz /= area
    let r2 = 0
    for (let i = start; i < end; i++) {
      const t = keep[order3[i]]
      for (let k = 0; k < 3; k++) {
        const v = corner(t, k)
        const dx = positions[v] - cx, dy = positions[v + 1] - cy, dz = positions[v + 2] - cz
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > r2) r2 = d2
      }
    }
    const o = id * 7
    node[o] = cx
    node[o + 1] = cy
    node[o + 2] = cz
    node[o + 3] = Math.sqrt(r2)
    node[o + 4] = nx
    node[o + 5] = ny
    node[o + 6] = nz
    if (!moment) return
    // Summed in double, kept in single.
    const sum = new Float64Array(18)
    for (let i = start; i < end; i++) {
      const o3 = order3[i] * 3
      const d = [g[o3] - cx, g[o3 + 1] - cy, g[o3 + 2] - cz]
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) sum[j * 3 + k] += d[j] * an[o3 + k]
    }
    moment.set(sum.subarray(0, 9), id * 9)
    if (!moment2) return
    // ∫ y yᵀ dA over a triangle, y = x − c: a/12 (Σ yᵢyᵢᵀ + s sᵀ), s the
    // sum of its corners' y; times n, a·n being the half cross product.
    sum.fill(0)
    const y = new Float64Array(9)
    for (let i = start; i < end; i++) {
      const t = keep[order3[i]]
      let sx = 0, sy = 0, sz = 0
      for (let k = 0; k < 3; k++) {
        const v = corner(t, k)
        y[k * 3] = positions[v] - cx
        y[k * 3 + 1] = positions[v + 1] - cy
        y[k * 3 + 2] = positions[v + 2] - cz
        sx += y[k * 3]
        sy += y[k * 3 + 1]
        sz += y[k * 3 + 2]
      }
      const pair = (a: number, b: number, s: number, u: number) => (y[a] * y[b] + y[a + 3] * y[b + 3] + y[a + 6] * y[b + 6] + s * u) / 12
      const s6 = [pair(0, 0, sx, sx), pair(0, 1, sx, sy), pair(0, 2, sx, sz), pair(1, 1, sy, sy), pair(1, 2, sy, sz), pair(2, 2, sz, sz)]
      const o3 = order3[i] * 3
      for (let p = 0; p < 6; p++) for (let j = 0; j < 3; j++) sum[p * 3 + j] += s6[p] * an[o3 + j]
    }
    moment2.set(sum, id * 18)
  }
}

/** How many nodes a tree over `n` triangles has, split at the median until
 *  a leaf holds LEAF_SIZE or fewer. */
function nodesFor(n: number, known: Map<number, number>): number {
  if (n <= LEAF_SIZE) return 1
  let c = known.get(n)
  if (c === undefined) {
    const half = n >> 1
    c = 1 + nodesFor(half, known) + nodesFor(n - half, known)
    known.set(n, c)
  }
  return c
}

/** Half the solid angle a triangle covers seen from a point, signed by its
 *  winding: Van Oosterom–Strackee, tan(Ω/2) = a·(b×c) / (abc + (a·b)c +
 *  (b·c)a + (c·a)b). */
function solidAngle(c: Float32Array, o: number, x: number, y: number, z: number): number {
  const ax = c[o] - x, ay = c[o + 1] - y, az = c[o + 2] - z
  const bx = c[o + 3] - x, by = c[o + 4] - y, bz = c[o + 5] - z
  const cx = c[o + 6] - x, cy = c[o + 7] - y, cz = c[o + 8] - z
  const la = Math.sqrt(ax * ax + ay * ay + az * az)
  const lb = Math.sqrt(bx * bx + by * by + bz * bz)
  const lc = Math.sqrt(cx * cx + cy * cy + cz * cz)
  const det = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb
  return Math.atan2(det, den)
}

/** Reorders `order[lo..hi]` so the entry at `nth` is the one a sort by the
 *  centroids' `axis` would put there, the smaller before it (quickselect). */
function selectNth(order: Uint32Array, g: Float64Array, axis: number, lo: number, hi: number, nth: number): void {
  while (hi > lo) {
    const pivot = g[order[(lo + hi) >> 1] * 3 + axis]
    let i = lo, j = hi
    while (i <= j) {
      while (g[order[i] * 3 + axis] < pivot) i++
      while (g[order[j] * 3 + axis] > pivot) j--
      if (i <= j) {
        const t = order[i]
        order[i] = order[j]
        order[j] = t
        i++
        j--
      }
    }
    if (nth <= j) hi = j
    else if (nth >= i) lo = i
    else return
  }
}
