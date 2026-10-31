// SPDX-License-Identifier: AGPL-3.0-only
// A surface fitted along a height direction of its own (fit.normal): a
// hump on a sloping face, fitted as heights along z where its own
// principal normal leans with the slope — and the fit that runs away
// saying which direction it was fitted along and how far the region turns
// from it: a flat region whose net was thrown off in a corner is told to
// take another net or a height direction; a shell wrapping a shoulder,
// past 70° from its plane, is told no height field holds it.
import { describe, expect, it } from 'vitest'
import { validate } from '../../../src/commands/schema'
import { featureOf } from '../app/reSchemas'
import { DEFAULT_SURFACE_FIT, fitSurface, heightFrame, runAway } from '../core/surfaceFit'

const net = (n: number) => ({ ...DEFAULT_SURFACE_FIT, net: { u: n, v: n } })
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Points on a grid w × h, z = f(x, y). */
function patch(f: (x: number, y: number) => number, w: number, h: number, step: number): Float64Array {
  const pts: number[] = []
  for (let x = -w / 2; x <= w / 2; x += step) for (let y = -h / 2; y <= h / 2; y += step) pts.push(x, y, f(x, y))
  return Float64Array.from(pts)
}

describe('a height direction of the fit’s own', () => {
  it('lays the plane square to the direction given, the principal axes in it', () => {
    const [u, v, n] = heightFrame([[0.8, 0, 0.6], [0, 1, 0], [-0.6, 0, 0.8]], [0, 0, 2])
    expect(n).toEqual([0, 0, 1])
    expect(dot(u, n)).toBeCloseTo(0, 12)
    expect(u[0]).toBeCloseTo(1, 12)
    expect(v).toEqual([expect.closeTo(0, 12), expect.closeTo(1, 12), expect.closeTo(0, 12)])
    // None given, or none to speak of: the principal frame as it is.
    expect(heightFrame([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    expect(heightFrame([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0])[2]).toEqual([0, 0, 1])
  })

  it('fits a hump on a slope along z, where its principal normal leans', () => {
    const hump = (x: number, y: number) => 0.5 * x + 4 * Math.exp(-(x * x + y * y) / 150)
    const xyz = patch(hump, 40, 30, 0.5)
    const leaning = fitSurface(xyz, net(12), 0.01)
    expect(Math.abs(leaning.normal[2])).toBeLessThan(0.95)
    const along = fitSurface(xyz, { ...net(12), normal: [0, 0, 5] }, 0.01)
    expect(along.normal).toEqual([0, 0, 1])
    expect(along.rms).toBeLessThan(0.02)
    // The schema takes it.
    expect(validate(featureOf('surface'), { kind: 'surface', region: { box: { min: [0, 0, 0], max: [1, 1, 1] } }, fit: { normal: [0, 0, 1] } }, 'feature')).toEqual([])
  })
})

describe('a fit that runs away says what it was fitted along', () => {
  it('names the direction and the spread, and on a gentle region asks for a net or a direction', () => {
    const xyz = patch(() => 0, 20, 20, 0.5)
    const fit = fitSurface(xyz, net(20), 0.01, 0)
    // A corner of the net thrown far off, out in the margin where no point is.
    fit.heights[0] = 500
    const said = runAway(fit, xyz, DEFAULT_SURFACE_FIT.expandPct)!
    expect(said).toMatch(/Its height direction was \[-?0, -?0, -?1\] \(the region’s principal normal\); 95 % of the region’s normals are within 0° of it\./)
    expect(said).toMatch(/Fit a coarser net, .* or take less margin — or give fit\.normal, the way the region faces, for its height direction\.$/)
    expect(runAway(fit, xyz, DEFAULT_SURFACE_FIT.expandPct, [0, 0, 1])).toMatch(/\(fit\.normal\);.* or take less margin\.$/)
  })

  it('says a region bending round past 70° is no height field: split it, or loft through stations', () => {
    // A shell wrapping a shoulder: 200° of a cylinder R15 round the y axis,
    // 40 mm long, its points 0.5 mm apart.
    const pts: number[] = []
    for (let a = -100; a <= 100; a += 2) for (let y = -20; y <= 20; y += 0.5) pts.push(15 * Math.sin((a * Math.PI) / 180), y, 15 * Math.cos((a * Math.PI) / 180))
    const xyz = Float64Array.from(pts)
    const fit = fitSurface(xyz, net(20), 0.01, 0)
    fit.heights[0] = 1e4
    const said = runAway(fit, xyz, DEFAULT_SURFACE_FIT.expandPct)!
    expect(said).toMatch(/95 % of the region’s normals are within (\d+)° of it\. The region bends round past what one height field holds — split it, or loft through stations\.$/)
    expect(Number(/are within (\d+)° of it/.exec(said)![1])).toBeGreaterThan(80)
  })
})
