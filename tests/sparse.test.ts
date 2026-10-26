// SPDX-License-Identifier: AGPL-3.0-only
// The sparse solver: a CSR matrix assembled from triplets with duplicates
// summed, and preconditioned conjugate gradient checked against dense
// Cholesky on the 2D Laplacian — the five-point stencil over a grid with
// its edge held — and on a system whose rows are weighed very differently,
// where the diagonal's scaling earns its keep.

import { describe, expect, it } from 'vitest'
import { choleskySolve } from '../src/core/fit/linalg'
import { conjugateGradient, csrDiagonal, csrFromTriplets, csrMultiply, Triplets } from '../src/core/fit/sparse'

/** The five-point Laplacian over a k × k grid of unknowns, the cells past
 *  its edge held at zero, plus `shift` on the diagonal. */
function laplacian(k: number, shift = 0): Triplets {
  const t = new Triplets(k * k)
  const at = (i: number, j: number) => i * k + j
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      t.add(at(i, j), at(i, j), 4 + shift)
      if (i > 0) t.add(at(i, j), at(i - 1, j), -1)
      if (i + 1 < k) t.add(at(i, j), at(i + 1, j), -1)
      if (j > 0) t.add(at(i, j), at(i, j - 1), -1)
      if (j + 1 < k) t.add(at(i, j), at(i, j + 1), -1)
    }
  }
  return t
}

function dense(n: number, csr: ReturnType<Triplets['toCsr']>): Float64Array {
  const a = new Float64Array(n * n)
  for (let i = 0; i < n; i++) for (let p = csr.rowPtr[i]; p < csr.rowPtr[i + 1]; p++) a[i * n + csr.cols[p]] = csr.vals[p]
  return a
}

describe('sparse', () => {
  it('sums duplicates and keeps each row in column order', () => {
    const csr = csrFromTriplets(3, [0, 2, 0, 1, 0, 2], [2, 0, 0, 1, 2, 0], [1, 5, 3, 4, 2, 1])
    expect(Array.from(csr.rowPtr)).toEqual([0, 2, 3, 4])
    expect(Array.from(csr.cols)).toEqual([0, 2, 1, 0])
    expect(Array.from(csr.vals)).toEqual([3, 3, 4, 6])
    expect(Array.from(csrDiagonal(csr))).toEqual([3, 4, 0])
    const out = new Float64Array(3)
    csrMultiply(csr, Float64Array.from([1, 2, 3]), out)
    expect(Array.from(out)).toEqual([12, 8, 6])
  })

  it('solves a 2D Laplacian as dense Cholesky does', () => {
    const k = 20
    const n = k * k
    const csr = laplacian(k).toCsr()
    expect(csr.vals.length).toBe(5 * n - 4 * k)
    const b = new Float64Array(n)
    for (let i = 0; i < n; i++) b[i] = Math.sin(i * 0.37) + (i % 7) * 0.1
    const exact = choleskySolve(n, dense(n, csr), b)!
    const cg = conjugateGradient(csr, b, { tolerance: 1e-12 })
    expect(cg.converged).toBe(true)
    // About k iterations per factor of e — a few times k in all.
    expect(cg.iterations).toBeLessThan(6 * k)
    let worst = 0
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(cg.x[i] - exact[i]))
    expect(worst).toBeLessThan(1e-9)
  })

  it('takes a start, and takes the system as an operator', () => {
    const k = 12
    const n = k * k
    const csr = laplacian(k, 0.5).toCsr()
    const b = new Float64Array(n).fill(1)
    const cold = conjugateGradient(csr, b, { tolerance: 1e-10 })
    const warm = conjugateGradient(csr, b, { tolerance: 1e-10, x0: cold.x })
    expect(warm.iterations).toBeLessThanOrEqual(1)
    const diagonal = csrDiagonal(csr)
    const asOperator = conjugateGradient({ n, apply: (x, out) => csrMultiply(csr, x, out), diagonal }, b, { tolerance: 1e-10 })
    for (let i = 0; i < n; i++) expect(asOperator.x[i]).toBeCloseTo(cold.x[i], 9)
  })

  it('scales away rows weighed a millionfold apart', () => {
    // The Laplacian with every other row and column scaled by 1000: the
    // same system in other units, which plain conjugate gradient crawls
    // through and the diagonal's scaling does not.
    const k = 16
    const n = k * k
    const base = laplacian(k, 0.1).toCsr()
    const s = (i: number) => (i % 2 === 0 ? 1000 : 1)
    const t = new Triplets(n)
    for (let i = 0; i < n; i++) for (let p = base.rowPtr[i]; p < base.rowPtr[i + 1]; p++) t.add(i, base.cols[p], base.vals[p] * s(i) * s(base.cols[p]))
    const csr = t.toCsr()
    const b = new Float64Array(n)
    for (let i = 0; i < n; i++) b[i] = s(i) * Math.cos(i)
    const exact = choleskySolve(n, dense(n, csr), b)!
    const jacobi = conjugateGradient(csr, b, { tolerance: 1e-12 })
    const plain = conjugateGradient(csr, b, { tolerance: 1e-12, precondition: false, maxIterations: jacobi.iterations * 3 })
    expect(jacobi.converged).toBe(true)
    expect(plain.converged).toBe(false)
    for (let i = 0; i < n; i++) expect(Math.abs(jacobi.x[i] - exact[i])).toBeLessThan(1e-8 * Math.max(1, Math.abs(exact[i])))
  })

  it('answers zero for a zero right-hand side', () => {
    const csr = laplacian(4).toCsr()
    const r = conjugateGradient(csr, new Float64Array(16))
    expect(r.iterations).toBe(0)
    expect(Array.from(r.x).every((v) => v === 0)).toBe(true)
  })
})
