// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { autoNet, basisFunctions, clampedKnots, DEFAULT_SURFACE_FIT, evalSurface, findSpan, fitSurface, greville, gridOf, NET_MAX, NET_MIN } from '../core/surfaceFit'

/** A deterministic noise source, so a failing case fails the same way. */
function noise(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    // Two uniforms to a roughly Gaussian value with σ ≈ 1.
    const a = s / 4294967296
    s = (s * 1664525 + 1013904223) >>> 0
    const b = s / 4294967296
    return Math.sqrt(-2 * Math.log(a + 1e-12)) * Math.cos(2 * Math.PI * b)
  }
}

/** Points z = f(x, y) over a grid, jittered in the plane and noisy in z,
 *  in a frame turned away from the axes so the fit has to find its own. */
function sample(f: (x: number, y: number) => number, w: number, h: number, step: number, sigma: number, seed = 1): { xyz: Float32Array; truth: (p: [number, number, number]) => number } {
  const rnd = noise(seed)
  const pts: number[] = []
  // A rotation about a skew axis, so no principal axis lies on x, y or z.
  const a = 0.6
  const R = [
    [Math.cos(a), -Math.sin(a) * 0.8, Math.sin(a) * 0.6],
    [Math.sin(a), Math.cos(a) * 0.8, -Math.cos(a) * 0.6],
    [0, 0.6, 0.8],
  ]
  const turn = (x: number, y: number, z: number): [number, number, number] => [
    R[0][0] * x + R[0][1] * y + R[0][2] * z + 5,
    R[1][0] * x + R[1][1] * y + R[1][2] * z - 3,
    R[2][0] * x + R[2][1] * y + R[2][2] * z + 11,
  ]
  const back = (p: [number, number, number]): [number, number, number] => {
    const x = p[0] - 5, y = p[1] + 3, z = p[2] - 11
    return [R[0][0] * x + R[1][0] * y + R[2][0] * z, R[0][1] * x + R[1][1] * y + R[2][1] * z, R[0][2] * x + R[1][2] * y + R[2][2] * z]
  }
  for (let x = -w / 2; x <= w / 2; x += step) {
    for (let y = -h / 2; y <= h / 2; y += step) {
      const jx = x + rnd() * step * 0.2
      const jy = y + rnd() * step * 0.2
      pts.push(...turn(jx, jy, f(jx, jy) + rnd() * sigma))
    }
  }
  return { xyz: Float32Array.from(pts), truth: (p) => { const q = back(p); return f(q[0], q[1]) - q[2] } }
}

/** The largest distance of the fitted surface from the true one, sampled
 *  over the region's own extent (the margin is extrapolation). */
function worstError(fit: ReturnType<typeof fitSurface>, truth: (p: [number, number, number]) => number, shrink: number): number {
  let worst = 0
  const [u0, u1] = fit.uRange
  const [v0, v1] = fit.vRange
  const mu = (u1 - u0) * shrink, mv = (v1 - v0) * shrink
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const p = evalSurface(fit, u0 + mu + ((u1 - u0 - 2 * mu) * i) / 20, v0 + mv + ((v1 - v0 - 2 * mv) * j) / 20)
      worst = Math.max(worst, Math.abs(truth(p)))
    }
  }
  return worst
}

describe('the B-spline pieces', () => {
  it('clamped knots, Greville abscissae and a partition of unity', () => {
    const knots = clampedKnots(6, 3, 0, 10)
    expect(Array.from(knots).map((k) => Math.round(k * 1000) / 1000)).toEqual([0, 0, 0, 0, 3.333, 6.667, 10, 10, 10, 10])
    const g = greville(knots, 6, 3)
    expect(g[0]).toBe(0)
    expect(g[5]).toBe(10)
    const b = new Float64Array(4)
    for (const t of [0, 2.5, 5, 7.5, 10]) {
      basisFunctions(knots, findSpan(knots, 6, 3, t), 3, t, b)
      expect(b[0] + b[1] + b[2] + b[3]).toBeCloseTo(1, 12)
    }
  })

  it('Auto sizes the net to the extent over the scatter, within the limits', () => {
    expect(autoNet(80, 40, 1)).toEqual({ u: 10, v: 5 })
    expect(autoNet(2, 2, 1)).toEqual({ u: NET_MIN, v: NET_MIN })
    expect(autoNet(1000, 1000, 1)).toEqual({ u: NET_MAX, v: NET_MAX })
  })
})

describe('fit surface', () => {
  it('recovers a tilted plane from noisy points within the noise', () => {
    const { xyz, truth } = sample(() => 0, 40, 30, 1, 0.02)
    // No scatter given: Auto reads the noise off a pilot fit.
    const fit = fitSurface(xyz, DEFAULT_SURFACE_FIT)
    expect(fit.rms).toBeLessThan(0.03)
    expect(worstError(fit, truth, 0.15)).toBeLessThan(0.01)
    // The margin: 35 % of the extent, half each side.
    expect(fit.uRange[1] - fit.uRange[0]).toBeGreaterThan(40 * 1.3)
    expect(fit.uRange[1] - fit.uRange[0]).toBeLessThan(40 * 1.4)
  })

  it('recovers a cylinder patch and a saddle', () => {
    const R = 30
    const cyl = sample((x) => Math.sqrt(R * R - x * x) - R, 30, 20, 0.5, 0.02, 7)
    const f1 = fitSurface(cyl.xyz, { ...DEFAULT_SURFACE_FIT, net: { u: 8, v: 4 } }, 0.02)
    expect(f1.rms).toBeLessThan(0.03)
    expect(worstError(f1, cyl.truth, 0.15)).toBeLessThan(0.015)

    const saddle = sample((x, y) => (x * x - y * y) / 80, 40, 40, 1, 0.02, 3)
    const f2 = fitSurface(saddle.xyz, DEFAULT_SURFACE_FIT)
    expect(f2.rms).toBeLessThan(0.03)
    // Auto puts the net at its limit here, four points a cell: the surface
    // follows the noise a little, within a sigma and a half.
    expect(worstError(f2, saddle.truth, 0.15)).toBeLessThan(0.03)
    // Auto on a curved patch: the pilot's residual is the noise, not the
    // sag, so the net gets its spans.
    expect(f2.net.u).toBeGreaterThan(NET_MIN + 2)
  })

  it('smoothing fairs a net too fine for its points, and the grid for the kernel lies on the fit', () => {
    const { xyz, truth } = sample(() => 0, 20, 20, 2, 0.05, 11)
    // Twenty by twenty over 121 points: without the bending term the
    // system is underdetermined; with it the surface stays a plane.
    const fit = fitSurface(xyz, { ...DEFAULT_SURFACE_FIT, net: { u: 20, v: 20 }, smoothness: 0.05 }, 0.05)
    // Faired to the noise: without the term this stood at 1.2 mm.
    expect(worstError(fit, truth, 0.15)).toBeLessThan(0.1)
    const grid = gridOf(fit)
    expect(grid.rows).toBe(19 * 3 + 1)
    expect(grid.points.length).toBe(grid.rows * grid.cols * 3)
    const q = evalSurface(fit, fit.uRange[0], fit.vRange[0])
    expect(Array.from(grid.points.slice(0, 3))).toEqual(q)
  })

  it('refuses too few points', () => {
    expect(() => fitSurface(new Float32Array(6), DEFAULT_SURFACE_FIT)).toThrow(/Too few/)
  })
})
