// SPDX-License-Identifier: AGPL-3.0-only
// A patch measured as a surface (src/core/fit/heightSurface.ts): a tilted
// plane, a twisted ruled face, a sphere's cap and a cylinder's strip, each
// sampled with noise — the simplest model that holds named, the quadric's
// curvatures read back, and a patch turned in space read the same.

import { describe, expect, it } from 'vitest'
import { fitSurfaceModels } from '../src/core/fit/heightSurface'
import { mulberry32 } from '../src/core/fit/ransac'

const rand = mulberry32(21)
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())

/** Points z = f(x, y) over a square of side 2·half, `n` a side, with noise
 *  along z. */
function patch(f: (x: number, y: number) => number, half = 10, n = 41, noise = 0.01): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = -half + (2 * half * i) / (n - 1)
      const y = -half + (2 * half * j) / (n - 1)
      out.push(x, y, f(x, y) + gauss() * noise)
    }
  }
  return out
}

/** Points turned about x by `deg` and moved. */
function turned(points: number[], deg: number, by: [number, number, number]): number[] {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180)
  const out: number[] = []
  for (let i = 0; i < points.length; i += 3) {
    const [x, y, z] = [points[i], points[i + 1], points[i + 2]]
    out.push(x + by[0], c * y - s * z + by[1], s * y + c * z + by[2])
  }
  return out
}

const rmsOf = (r: ReturnType<typeof fitSurfaceModels>, m: string) => r!.fits.find((f) => f.model === m)!.rms

describe('a patch fitted as a surface', () => {
  it('a tilted plane is a plane, its slope in the frame', () => {
    const r = fitSurfaceModels(patch((x, y) => 0.2 * x - 0.1 * y + 3))!
    expect(r.best).toBe('plane')
    expect(rmsOf(r, 'plane')).toBeLessThan(0.015)
    const n = r.frame.normal
    const want = [-0.2, 0.1, 1].map((v) => v / Math.hypot(0.2, 0.1, 1))
    expect(Math.abs(n[0] * want[0] + n[1] * want[1] + n[2] * want[2])).toBeGreaterThan(0.9999)
  })

  it('a twisted ruled face is bilinear, not a plane and not more', () => {
    const r = fitSurfaceModels(patch((x, y) => 0.01 * x * y))!
    expect(rmsOf(r, 'plane')).toBeGreaterThan(0.2)
    expect(rmsOf(r, 'bilinear')).toBeLessThan(0.015)
    expect(r.best).toBe('bilinear')
  })

  it('a sphere’s cap is a quadric dome of its radius; a cylinder’s strip a quadric cylinder along its axis', () => {
    const sphere = fitSurfaceModels(patch((x, y) => Math.sqrt(50 * 50 - x * x - y * y), 10, 41, 0.005))!
    expect(sphere.best).toBe('quadric')
    const c = sphere.fits.find((f) => f.model === 'quadric')!.curvature!
    expect(c.shape).toBe('dome')
    expect(Math.abs(Math.abs(c.r1!) - 50)).toBeLessThan(2)
    expect(Math.abs(Math.abs(c.r2!) - 50)).toBeLessThan(2)
    const cyl = fitSurfaceModels(patch((x) => Math.sqrt(30 * 30 - x * x), 8, 41, 0.005))!
    expect(cyl.best).toBe('quadric')
    const k = cyl.fits.find((f) => f.model === 'quadric')!.curvature!
    expect(k.shape).toBe('cylinder')
    expect(Math.abs(Math.abs(k.r1!) - 30)).toBeLessThan(1)
    // The round runs across x; the straight direction is the axis, y.
    expect(Math.abs(k.axis2[1])).toBeGreaterThan(0.99)
  })

  it('reads a patch turned in space the same', () => {
    const flat = fitSurfaceModels(patch((x, y) => Math.sqrt(50 * 50 - x * x - y * y), 10, 41, 0.005))!
    const tilt = fitSurfaceModels(turned(patch((x, y) => Math.sqrt(50 * 50 - x * x - y * y), 10, 41, 0.005), 40, [5, -3, 12]))!
    const a = flat.fits.find((f) => f.model === 'quadric')!.curvature!
    const b = tilt.fits.find((f) => f.model === 'quadric')!.curvature!
    expect(Math.abs(Math.abs(a.r1!) - Math.abs(b.r1!))).toBeLessThan(1)
    expect(tilt.best).toBe('quadric')
  })

  it('points on a line have no surface', () => {
    expect(fitSurfaceModels([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3])).toBeNull()
  })
})
