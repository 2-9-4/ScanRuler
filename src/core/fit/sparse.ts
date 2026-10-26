// SPDX-License-Identifier: AGPL-3.0-only
// Sparse linear algebra for systems too large for the dense Cholesky in
// linalg.ts: a matrix in compressed rows (CSR), assembled from triplets with
// their duplicates summed, and the conjugate gradient method for symmetric
// positive-definite systems, preconditioned by the diagonal (Jacobi).
//
// Dense Cholesky costs n³/3: four hundred unknowns is a few milliseconds,
// ten thousand is minutes and 800 MB of matrix. A least-squares fit over
// a mesh or a large net touches each unknown with a few dozen others, so
// the matrix is mostly zeros, and conjugate gradient needs only products
// with it — each costs the non-zeros, not n². Its convergence goes with the
// square root of the condition number; scaling by the diagonal takes out
// what comes from unknowns weighed differently (a heavy row beside light
// ones), which is most of it in a fit. What is left is the problem's own:
// a Laplacian over a mesh k vertices across takes about k iterations.
//
// The solver takes either a CSR matrix or any operator that can multiply
// a vector — a system kept in pieces need not be assembled to be solved.
// A system that is not symmetric takes BiCGSTAB instead, at twice the
// products an iteration.

/** A square matrix in compressed rows: row i's entries are cols/vals in
 *  [rowPtr[i], rowPtr[i + 1]), their columns ascending and each once. */
export interface CsrMatrix {
  n: number
  rowPtr: Int32Array
  cols: Int32Array
  vals: Float64Array
}

/** A symmetric positive-definite operator: its size, its product with a
 *  vector (written into `out`, which it may assume is not `x`), and its
 *  diagonal for the preconditioner where it is known. */
export interface LinearOperator {
  n: number
  apply(x: Float64Array, out: Float64Array): void
  diagonal?: Float64Array
}

/** Entries gathered in any order, a position given more than once summed —
 *  what a fit's terms add to its normal equations, point by point. */
export class Triplets {
  readonly n: number
  private rows: Int32Array
  private colsAt: Int32Array
  private valsAt: Float64Array
  private count = 0

  constructor(n: number, capacity = 16) {
    this.n = n
    const c = Math.max(16, capacity)
    this.rows = new Int32Array(c)
    this.colsAt = new Int32Array(c)
    this.valsAt = new Float64Array(c)
  }

  get size(): number {
    return this.count
  }

  add(i: number, j: number, v: number): void {
    if (v === 0) return
    if (this.count === this.rows.length) this.grow()
    this.rows[this.count] = i
    this.colsAt[this.count] = j
    this.valsAt[this.count] = v
    this.count++
  }

  /** The entries `v · w[a] · w[b]` for every pair of `idx`: the term
   *  v (Σ w[a] x[idx[a]])² adds to a system's matrix. */
  addOuter(idx: ArrayLike<number>, w: ArrayLike<number>, v: number): void {
    for (let a = 0; a < idx.length; a++) {
      const va = v * w[a]
      if (va === 0) continue
      for (let b = 0; b < idx.length; b++) this.add(idx[a], idx[b], va * w[b])
    }
  }

  toCsr(): CsrMatrix {
    return csrFromTriplets(this.n, this.rows, this.colsAt, this.valsAt, this.count)
  }

  private grow(): void {
    const c = this.rows.length * 2
    const rows = new Int32Array(c)
    const cols = new Int32Array(c)
    const vals = new Float64Array(c)
    rows.set(this.rows)
    cols.set(this.colsAt)
    vals.set(this.valsAt)
    this.rows = rows
    this.colsAt = cols
    this.valsAt = vals
  }
}

/** A CSR matrix of the first `count` triplets, duplicates summed. Two
 *  passes by row, then a marker per column within each row: linear in the
 *  entries, with no sort but the columns' order within a row. */
export function csrFromTriplets(n: number, rows: ArrayLike<number>, cols: ArrayLike<number>, vals: ArrayLike<number>, count = rows.length): CsrMatrix {
  const start = new Int32Array(n + 1)
  for (let k = 0; k < count; k++) start[rows[k] + 1]++
  for (let i = 0; i < n; i++) start[i + 1] += start[i]
  const byRowCol = new Int32Array(count)
  const byRowVal = new Float64Array(count)
  const cursor = start.slice(0, n)
  for (let k = 0; k < count; k++) {
    const at = cursor[rows[k]]++
    byRowCol[at] = cols[k]
    byRowVal[at] = vals[k]
  }
  // Duplicates summed into the column's first place in its row.
  const marker = new Int32Array(n).fill(-1)
  const rowPtr = new Int32Array(n + 1)
  const outCol = new Int32Array(count)
  const outVal = new Float64Array(count)
  let w = 0
  for (let i = 0; i < n; i++) {
    const first = w
    for (let k = start[i]; k < start[i + 1]; k++) {
      const c = byRowCol[k]
      const m = marker[c]
      if (m >= first) outVal[m] += byRowVal[k]
      else {
        marker[c] = w
        outCol[w] = c
        outVal[w] = byRowVal[k]
        w++
      }
    }
    sortRow(outCol, outVal, first, w)
    rowPtr[i + 1] = w
  }
  return { n, rowPtr, cols: outCol.slice(0, w), vals: outVal.slice(0, w) }
}

/** A row's entries in column order — insertion sort, a row being short. */
function sortRow(cols: Int32Array, vals: Float64Array, from: number, to: number): void {
  for (let i = from + 1; i < to; i++) {
    const c = cols[i]
    const v = vals[i]
    let j = i - 1
    while (j >= from && cols[j] > c) {
      cols[j + 1] = cols[j]
      vals[j + 1] = vals[j]
      j--
    }
    cols[j + 1] = c
    vals[j + 1] = v
  }
}

/** out = A x. */
export function csrMultiply(a: CsrMatrix, x: Float64Array, out: Float64Array): void {
  const { n, rowPtr, cols, vals } = a
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) s += vals[k] * x[cols[k]]
    out[i] = s
  }
}

/** The matrix's diagonal. */
export function csrDiagonal(a: CsrMatrix): Float64Array {
  const d = new Float64Array(a.n)
  for (let i = 0; i < a.n; i++) {
    for (let k = a.rowPtr[i]; k < a.rowPtr[i + 1]; k++) if (a.cols[k] === i) d[i] = a.vals[k]
  }
  return d
}

/** A CSR matrix as an operator. */
export function csrOperator(a: CsrMatrix): LinearOperator {
  return { n: a.n, apply: (x, out) => csrMultiply(a, x, out), diagonal: csrDiagonal(a) }
}

export interface CgOptions {
  /** Where to start; zero when absent. A solution of a nearby system — the
   *  last round of an iteration — saves most of the work. */
  x0?: Float64Array
  /** Stop once the residual is this share of the right-hand side's norm. */
  tolerance?: number
  maxIterations?: number
  /** Scale by the diagonal (Jacobi); on unless asked off. */
  precondition?: boolean
}

export interface CgResult {
  x: Float64Array
  iterations: number
  /** The residual's norm over the right-hand side's, at the end. */
  residual: number
  converged: boolean
}

/** Solve A x = b for a symmetric positive-definite A by preconditioned
 *  conjugate gradient. A zero right-hand side gives zero at once. */
export function conjugateGradient(a: CsrMatrix | LinearOperator, b: Float64Array, opts: CgOptions = {}): CgResult {
  const op = 'apply' in a ? a : csrOperator(a)
  const n = op.n
  const tolerance = opts.tolerance ?? 1e-10
  const maxIterations = opts.maxIterations ?? Math.max(100, 10 * n)
  const x = opts.x0 ? Float64Array.from(opts.x0) : new Float64Array(n)
  const r = new Float64Array(n)
  const z = new Float64Array(n)
  const p = new Float64Array(n)
  const q = new Float64Array(n)
  // The preconditioner: 1 / diagonal, where the diagonal is positive.
  const inv = new Float64Array(n).fill(1)
  if (opts.precondition !== false && op.diagonal) {
    for (let i = 0; i < n; i++) {
      const d = op.diagonal[i]
      inv[i] = d > 0 ? 1 / d : 1
    }
  }
  let bNorm = 0
  for (let i = 0; i < n; i++) bNorm += b[i] * b[i]
  bNorm = Math.sqrt(bNorm)
  if (!(bNorm > 0)) return { x: new Float64Array(n), iterations: 0, residual: 0, converged: true }

  op.apply(x, q)
  let rr = 0
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - q[i]
    rr += r[i] * r[i]
  }
  let rz = 0
  for (let i = 0; i < n; i++) {
    z[i] = inv[i] * r[i]
    p[i] = z[i]
    rz += r[i] * z[i]
  }
  const goal = tolerance * bNorm
  let iterations = 0
  while (Math.sqrt(rr) > goal && iterations < maxIterations) {
    op.apply(p, q)
    let pq = 0
    for (let i = 0; i < n; i++) pq += p[i] * q[i]
    // Not positive along p: the operator is not definite, or the round-off
    // has caught up with the solution. What there is stands.
    if (!(pq > 0)) break
    const alpha = rz / pq
    rr = 0
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]
      r[i] -= alpha * q[i]
      rr += r[i] * r[i]
    }
    let rzNext = 0
    for (let i = 0; i < n; i++) {
      z[i] = inv[i] * r[i]
      rzNext += r[i] * z[i]
    }
    const beta = rzNext / rz
    rz = rzNext
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]
    iterations++
  }
  const residual = Math.sqrt(rr) / bNorm
  return { x, iterations, residual, converged: residual <= tolerance }
}

/** Solve A x = b for a square A that need not be symmetric — a system of
 *  weighted means whose weights differ either way along an edge — by
 *  BiCGSTAB (van der Vorst), preconditioned by the diagonal. It wants an A
 *  whose spectrum keeps clear of zero, as a diagonally dominant one does.
 *  Two products with A an iteration. */
export function biconjugateGradientStabilized(a: CsrMatrix | LinearOperator, b: Float64Array, opts: CgOptions = {}): CgResult {
  const op = 'apply' in a ? a : csrOperator(a)
  const n = op.n
  const tolerance = opts.tolerance ?? 1e-10
  const maxIterations = opts.maxIterations ?? Math.max(100, 10 * n)
  const x = opts.x0 ? Float64Array.from(opts.x0) : new Float64Array(n)
  const inv = new Float64Array(n).fill(1)
  if (opts.precondition !== false && op.diagonal) {
    for (let i = 0; i < n; i++) inv[i] = op.diagonal[i] !== 0 ? 1 / op.diagonal[i] : 1
  }
  let bNorm = 0
  for (let i = 0; i < n; i++) bNorm += b[i] * b[i]
  bNorm = Math.sqrt(bNorm)
  if (!(bNorm > 0)) return { x: new Float64Array(n), iterations: 0, residual: 0, converged: true }
  const r = new Float64Array(n)
  const r0 = new Float64Array(n)
  const p = new Float64Array(n)
  const v = new Float64Array(n)
  const s = new Float64Array(n)
  const t = new Float64Array(n)
  const y = new Float64Array(n)
  const z = new Float64Array(n)
  op.apply(x, t)
  let rr = 0
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - t[i]
    r0[i] = r[i]
    rr += r[i] * r[i]
  }
  const goal = tolerance * bNorm
  let rho = 1
  let alpha = 1
  let omega = 1
  let iterations = 0
  while (Math.sqrt(rr) > goal && iterations < maxIterations) {
    let rhoNext = 0
    for (let i = 0; i < n; i++) rhoNext += r0[i] * r[i]
    if (rhoNext === 0) break
    const beta = (rhoNext / rho) * (alpha / omega)
    rho = rhoNext
    for (let i = 0; i < n; i++) {
      p[i] = r[i] + beta * (p[i] - omega * v[i])
      y[i] = inv[i] * p[i]
    }
    op.apply(y, v)
    let r0v = 0
    for (let i = 0; i < n; i++) r0v += r0[i] * v[i]
    if (r0v === 0) break
    alpha = rho / r0v
    let ss = 0
    for (let i = 0; i < n; i++) {
      s[i] = r[i] - alpha * v[i]
      ss += s[i] * s[i]
    }
    if (Math.sqrt(ss) <= goal) {
      for (let i = 0; i < n; i++) x[i] += alpha * y[i]
      rr = ss
      iterations++
      break
    }
    for (let i = 0; i < n; i++) z[i] = inv[i] * s[i]
    op.apply(z, t)
    let tt = 0
    let ts = 0
    for (let i = 0; i < n; i++) {
      tt += t[i] * t[i]
      ts += t[i] * s[i]
    }
    omega = tt > 0 ? ts / tt : 0
    rr = 0
    for (let i = 0; i < n; i++) {
      x[i] += alpha * y[i] + omega * z[i]
      r[i] = s[i] - omega * t[i]
      rr += r[i] * r[i]
    }
    iterations++
    if (omega === 0) break
  }
  const residual = Math.sqrt(rr) / bNorm
  return { x, iterations, residual, converged: residual <= tolerance }
}
