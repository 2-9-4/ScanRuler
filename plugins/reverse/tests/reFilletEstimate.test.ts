// SPDX-License-Identifier: AGPL-3.0-only
// The fillet radius read off a section across an edge: a rounded corner
// sampled with noise gives its radius back, a sharp corner and a chamfer
// give nothing, and the corner's window on a section through a thin wall
// stays on the near skin.
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { cornerWindow, estimateFilletRadius } from '../core/filletEstimate'
import type { Vec2 } from '../../../src/core/flat/types'

const N1: Vec2 = [0, 1] // the top face, outward +Y
const N2: Vec2 = [1, 0] // the right face, outward +X

/** A corner at the origin between the top face (y = 0, x ≤ 0) and the right
 *  face (x = 0, y ≤ 0), rounded with radius r, sampled every `step` along
 *  the profile out to `reach`, with Gaussian noise of `noise`. The material
 *  lies at x ≤ 0, y ≤ 0. */
function corner(r: number, reach: number, step: number, noise: number, seed = 5): Vec2[] {
  const rand = mulberry32(seed)
  const gauss = () => {
    const u = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const out: Vec2[] = []
  // Along the top face from far left to the round's start at x = −r.
  for (let x = -reach; x < -r; x += step) out.push([x, gauss() * noise])
  // The round: centre (−r, −r), from angle 90° down to 0°.
  const arc = (Math.PI / 2) * r
  for (let s = 0; s <= arc; s += step) {
    const a = Math.PI / 2 - s / r
    const nx = Math.cos(a), ny = Math.sin(a)
    const d = gauss() * noise
    out.push([-r + (r + d) * nx, -r + (r + d) * ny])
  }
  // Down the right face.
  for (let y = -r; y > -reach; y -= step) out.push([gauss() * noise, y])
  return out
}

describe('the fillet radius off a section', () => {
  it('reads a 2 mm round through scan noise', () => {
    const points = corner(2, 8, 0.05, 0.02)
    const reading = estimateFilletRadius(points, N1, N2, 8)
    expect(reading).not.toBeNull()
    expect(Math.abs(reading!.radius - 2)).toBeLessThan(0.05)
    expect(reading!.points).toBeGreaterThan(20)
    expect(reading!.rms).toBeLessThan(0.05)
  })

  it('reads a large round and a small one', () => {
    expect(Math.abs(estimateFilletRadius(corner(6, 20, 0.1, 0.03), N1, N2, 20)!.radius - 6)).toBeLessThan(0.12)
    expect(Math.abs(estimateFilletRadius(corner(0.5, 4, 0.02, 0.01), N1, N2, 4)!.radius - 0.5)).toBeLessThan(0.03)
  })

  it('finds no round at a sharp corner', () => {
    expect(estimateFilletRadius(corner(0, 8, 0.05, 0.02), N1, N2, 8)).toBeNull()
  })

  it('refuses a chamfer — its points lie on a line, not a circle tangent to both faces', () => {
    const points: Vec2[] = []
    for (let x = -8; x < -2; x += 0.05) points.push([x, 0])
    for (let t = 0; t <= 1; t += 0.01) points.push([-2 + 2 * t, -2 * t])
    for (let y = -2; y > -8; y -= 0.05) points.push([0, y])
    expect(estimateFilletRadius(points, N1, N2, 8)).toBeNull()
  })

  it('takes the corner’s window off the near skin of a thin wall', () => {
    // One chain: the outer corner rounded at 2 mm, then round the end of
    // the wall and back along the inner skin 1.35 mm inside both faces.
    const outer = corner(2, 12, 0.1, 0)
    const inner: Vec2[] = []
    for (let y = -12; y < -1.35; y += 0.1) inner.push([-1.35, y])
    for (let x = -1.35; x > -12; x -= 0.1) inner.push([x, -1.35])
    const chain = [...outer, [-1.35, -12] as Vec2, ...inner]
    const window = cornerWindow([chain], 8)
    // Everything in the window lies on the outer skin: nothing 1.35 mm
    // inside both faces.
    expect(window.length).toBeGreaterThan(50)
    expect(window.every((p) => !(p[0] < -1.3 && p[1] < -1.3 && Math.abs(p[0] + 1.35) < 0.01))).toBe(true)
    const reading = estimateFilletRadius(window, N1, N2, 8)
    expect(reading!.radius).toBeCloseTo(2, 1)
    // Without the walk, the inner skin pollutes the fit.
    const polluted = estimateFilletRadius(chain, N1, N2, 8)
    expect(polluted === null || Math.abs(polluted.radius - 2) > 0.2).toBe(true)
  })
})

describe('the chamfer off a section', () => {
  /** The same corner cut straight from s along the top to s down the side. */
  function chamfered(s: number, reach: number, step: number, noise: number, seed = 8): Vec2[] {
    const rand = mulberry32(seed)
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
    const out: Vec2[] = []
    for (let x = -reach; x < -s; x += step) out.push([x, gauss() * noise])
    const len = s * Math.SQRT2
    for (let t = 0; t <= len; t += step) {
      const d = gauss() * noise
      out.push([-s + (t / len) * s + d * Math.SQRT1_2, -(t / len) * s + d * Math.SQRT1_2])
    }
    for (let y = -s; y > -reach; y -= step) out.push([gauss() * noise, y])
    return out
  }

  it('reads a 45° chamfer’s setback, with a sigma, and none on a sharp corner', async () => {
    const { estimateChamfer } = await import('../core/filletEstimate')
    const c = estimateChamfer(chamfered(1.5, 8, 0.05, 0.02), N1, N2, 8)!
    expect(Math.abs(c.radius - 1.5)).toBeLessThan(0.03)
    expect(c.sigma).toBeGreaterThan(0)
    expect(c.sigma).toBeLessThan(0.03)
    expect(estimateChamfer(chamfered(0, 8, 0.05, 0.02), N1, N2, 8)).toBeNull()
  })
})
