// SPDX-License-Identifier: AGPL-3.0-only
// The strays of a fitted surface named. A region read off the scan by a
// box and a facing takes in what is not the surface: the inside of a cup
// under its rim, a gutter beside a flange. The fit that runs away for them
// — and a robust fit that leaves them out — names them, each with a box
// ready to give back as one of region.exclude's: a second sheet along the
// height direction, read in cells about 2 mm wide, and the robust fit's
// far points, clustered on a 5 mm grid. A region read facing a way says
// its normals are within the query's angle by construction, not a spread
// read off a plane through a rim's points. On the lamp's housing (RE_LAMP
// names 16_lamp_01-datums), the run's region names the cup and the gutter,
// and a refit with their boxes left out builds.
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { queryVertices } from '../../../src/core/geometry/query'
import { parseSTL } from '../../../src/core/parsers/stl'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { DEFAULT_SURFACE_FIT, fitSurface, fitSurfaceReported, runAway, type Stray, StraysRefusal } from '../core/surfaceFit'
import { build } from './reKit'

const kernelPromise = ReKernel.load()

/** A deterministic noise source. */
function noise(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296 - 0.5
  }
}

type Box = { min: Vec3; max: Vec3 }
const inside = (p: readonly number[], b: Box) => [0, 1, 2].every((k) => p[k] >= b.min[k] && p[k] <= b.max[k])

/** Points every `step` mm over x0…x1, y0…y1 at height f, noisy by ±sigma/2,
 *  less those in `hole`. */
function sheet(pts: number[], x0: number, x1: number, y0: number, y1: number, f: (x: number, y: number) => number, rnd: () => number, hole?: Box, step = 1, sigma = 0.04) {
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    for (let y = y0; y <= y1 + 1e-9; y += step) {
      const p = [x, y, f(x, y) + sigma * rnd()]
      if (!hole || !inside(p, hole)) pts.push(...p)
    }
  }
}

/** A flange at z 0, 80 × 60, with the floor of a cup 6 mm under it over
 *  x 0…20, y −10…10, and a lug standing 20 mm over a hole in it. */
function flangeOverCup(): Float64Array {
  const rnd = noise(3)
  const pts: number[] = []
  sheet(pts, -40, 40, -30, 30, () => 0, rnd, { min: [-36, -26, -1], max: [-24, -14, 1] })
  sheet(pts, 0, 20, -10, 10, () => -6, rnd)
  sheet(pts, -35, -25, -25, -15, () => 20, rnd)
  return Float64Array.from(pts)
}

const net = (n: number) => ({ ...DEFAULT_SURFACE_FIT, net: { u: n, v: n } })
const without = (xyz: Float64Array, boxes: Box[]) => {
  const out: number[] = []
  for (let i = 0; i < xyz.length; i += 3) if (!boxes.some((b) => inside([xyz[i], xyz[i + 1], xyz[i + 2]], b))) out.push(xyz[i], xyz[i + 1], xyz[i + 2])
  return Float64Array.from(out)
}

describe('a robust fit names its strays', () => {
  it('a second sheet under it, and the points it left out far off, each with a box to leave out', () => {
    const xyz = flangeOverCup()
    const r = fitSurfaceReported(xyz, { ...net(8), robust: true })
    const strays = r.strays!
    expect(strays.length).toBe(2)
    const cup = strays.find((s) => s.why.startsWith('a second sheet'))!
    expect(cup.why).toMatch(/^a second sheet 6 mm under the one fitted, along its height direction/)
    expect(cup.points).toBe(21 * 21)
    expect(cup.offMm).toEqual([6, 6])
    // The box takes the cup's floor and none of the flange over it.
    expect(cup.box.min[0]).toBeLessThanOrEqual(-1)
    expect(cup.box.max[0]).toBeGreaterThanOrEqual(21)
    expect(cup.box.max[2]).toBeLessThan(-4.5)
    const lug = strays.find((s) => s.why.startsWith('left out by the robust fit'))!
    expect(lug.why).toMatch(/^left out by the robust fit, 20 mm over its surface$/)
    expect(lug.points).toBe(11 * 11)
    expect(inside([-35, -25, 20], lug.box) && inside([-25, -15, 20], lug.box)).toBe(true)
    // Given back as excludes, the region fits as one sheet, with nothing
    // left to name.
    const again = fitSurfaceReported(without(xyz, strays.map((s) => s.box)), { ...net(8), robust: true })
    expect(again.strays).toBeUndefined()
    expect(again.fit.rms).toBeLessThan(0.03)
  })

  it('names none on a clean region, steep as it gets', () => {
    // Half a cylinder R30 over its axis, out to 56° from its plane: a slope
    // across a cell is no second sheet.
    const pts: number[] = []
    sheet(pts, -25, 25, -20, 20, (x) => Math.sqrt(900 - x * x) - 30, noise(5), undefined, 0.5, 0.02)
    expect(fitSurfaceReported(Float64Array.from(pts), { ...net(8), robust: true }).strays).toBeUndefined()
  })
})

/** Points z = f(x, y) on a disc of radius r with a hole of radius `hole`
 *  in it, every `step` mm, noisy in z by sigma — reSurfaceRunaway's. */
function disc(f: (x: number, y: number) => number, r: number, hole: number, step: number, sigma: number, seed = 1): number[] {
  const rnd = noise(seed)
  const pts: number[] = []
  for (let x = -r; x <= r; x += step) {
    for (let y = -r; y <= r; y += step) {
      const d = Math.hypot(x, y)
      if (d > r || d < hole) continue
      pts.push(x, y, f(x, y) + 2 * rnd() * sigma)
    }
  }
  return pts
}
const levels = (x: number, y: number) => (x > 10 ? 4 : 0) + (y < -20 ? -3 : 0) + (x < -30 ? 2 : 0) + (x * y) / 2000
const rim = (c: number, k: number) => (x: number, y: number) => levels(x, y) + Math.max(0, Math.hypot(x, y) - c) ** 2 * k

describe('a fit that runs away names its strays', () => {
  /** reSurfaceRunaway's disc that runs away, with a second sheet 8 mm
   *  under part of it. */
  const points = () => {
    const pts = disc(rim(56, 1), 60, 15, 1, 0.5, 5)
    sheet(pts, 20, 36, -8, 8, (x, y) => levels(x, y) - 8, noise(9))
    return Float64Array.from(pts)
  }

  it('is refused with them, and the refusal says what to do with them', () => {
    let refused: StraysRefusal | null = null
    try {
      fitSurfaceReported(points(), net(14))
    } catch (e) {
      if (e instanceof StraysRefusal) refused = e
    }
    expect(refused).not.toBeNull()
    expect(refused!.message).toMatch(/^The surface runs away from its points/)
    // The sheet named first, with its box; the rim the fit does not follow
    // all the way round would leave out the whole region, and is not named.
    expect(refused!.message).toMatch(/ Strays \(strays\): \d+ points a second sheet [\d.–]+ mm under the one fitted, along its height direction in \(19, -9, -?[\d.]+\)–\(37, 9, -?[\d.]+\)[;,] .* — give their boxes in region\.exclude and fit again\.$/)
    const sheetStray = refused!.strays.find((s) => s.why.startsWith('a second sheet'))!
    expect(sheetStray.offMm[0]).toBeGreaterThan(6)
    expect(inside([28, 0, levels(28, 0) - 8], sheetStray.box)).toBe(true)
  })

  it('answers them on the feature’s result, and a region read facing a way says its normals are within it', async () => {
    const builder = new Builder(await kernelPromise)
    const positions = Float32Array.from(points())
    builder.setScan(null, positions)
    const region = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
    const regionBox = { box: { min: [-70, -70, -20], max: [70, 70, 40] }, normal: { dir: [0, 0, 2], withinDeg: 28 } }
    const f = { id: 1, kind: 'surface', name: 'Skin', region, regionBox, fit: net(14), visible: true } as unknown as Feature
    const out = await build(builder, [f])
    builder.dispose()
    const result = out.results[0]
    expect(result.status).toBe('failed')
    expect(result.message).toMatch(/the region was read facing \[0, 0, 1\] within 28°, so its normals are within 28° of that by construction/)
    expect(result.message).not.toMatch(/turn up to/)
    expect(result.strays?.some((s: Stray) => s.why.startsWith('a second sheet'))).toBe(true)
  })
})

describe('a region read facing a way', () => {
  /** A flat region whose net was thrown off in a corner, out in the margin
   *  where no point is — reSurfaceNormal's. */
  const thrown = () => {
    const pts: number[] = []
    for (let x = -10; x <= 10; x += 0.5) for (let y = -10; y <= 10; y += 0.5) pts.push(x, y, 0)
    const xyz = Float64Array.from(pts)
    const fit = fitSurface(xyz, net(20), 0.01, 0)
    fit.heights[0] = 500
    return { xyz, fit }
  }

  it('says its normals are within the query’s angle by construction, not their spread', () => {
    const { xyz, fit } = thrown()
    const said = runAway(fit, xyz, DEFAULT_SURFACE_FIT.expandPct, undefined, { dir: [0, 0, 3], withinDeg: 28 })!
    expect(said).toMatch(/\(the region’s principal normal\); the region was read facing \[0, 0, 1\] within 28°, so its normals are within 28° of that by construction\. Fit a coarser net/)
    expect(said).not.toMatch(/95 %/)
    // 30° where the query gave no angle.
    expect(runAway(fit, xyz, DEFAULT_SURFACE_FIT.expandPct, undefined, { dir: [0, 0, 1] })).toMatch(/within 30°, so its normals are within 30° of that/)
  })

  it('read facing away from the height direction, names the way it faces for fit.normal', () => {
    const { xyz, fit } = thrown()
    const tilted: Vec3 = [Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6)]
    const said = runAway(fit, xyz, DEFAULT_SURFACE_FIT.expandPct, undefined, { dir: tilted, withinDeg: 20 })!
    expect(said).toMatch(/so its normals are within 20° of that by construction, 30° off the height direction\./)
    expect(said).toMatch(/— or give fit\.normal: \[0\.5, 0, 0\.866\], the way the region was read facing, for its height direction\.$/)
  })
})

// ---- the lamp's housing ----------------------------------------------------------

const lamp = process.env.RE_LAMP ?? ''

describe.skipIf(!lamp)('the lamp’s flange region', () => {
  it('names the cup and the gutter, and a refit with their boxes left out builds', () => {
    const zip = unzipSync(readFileSync(lamp))
    const manifest = JSON.parse(strFromU8(zip['project.json']))
    const stl = zip[manifest.scan.member]
    const p = parseSTL(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength)).positions
    const { r, t } = manifest.scan.appliedAlignment as { r: number[]; t: number[] }
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i], p[i + 1], p[i + 2]]
      for (let k = 0; k < 3; k++) p[i + k] = r[k * 3] * x + r[k * 3 + 1] * y + r[k * 3 + 2] * z + t[k]
    }
    const g = buildMeshGraph({ kind: 'soup', positions: p })
    // The run's region: the whole part, facing (0.28, 0.85, −0.45) within
    // 28°, thinned to 20 000 points as the region's query thins it.
    const lo: Vec3 = [Infinity, Infinity, Infinity]
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < g.vertexCount; i++) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k], g.positions[i * 3 + k] - 1), Math.max(hi[k], g.positions[i * 3 + k] + 1)]
    const facing = { dir: [0.28, 0.85, -0.45] as Vec3, withinDeg: 28 }
    const len = Math.hypot(...facing.dir)
    const found = queryVertices(g, { min: lo, max: hi, normal: { dir: facing.dir.map((x) => x / len) as Vec3, cosLimit: Math.cos((28 * Math.PI) / 180) }, limit: g.vertexCount })
    const region = (exclude: Box[]) => {
      const kept: number[] = []
      for (const v of found.vertices) if (!exclude.some((b) => inside([g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]], b))) kept.push(v)
      const step = Math.max(1, Math.ceil(kept.length / 20_000))
      return Float32Array.from(kept.filter((_, i) => i % step === 0).flatMap((v) => [g.positions[v * 3], g.positions[v * 3 + 1], g.positions[v * 3 + 2]]))
    }
    // The boxes the run left out by hand: the cup's inside and the gutter.
    const cup: Box = { min: [2.5, -1e9, -68], max: [40.5, 1e9, 1e9] }
    const gutter: Box = { min: [43.5, -1e9, -1e9], max: [1e9, 1e9, 1e9] }
    const overlaps = (a: Box, b: Box) => [0, 1, 2].every((k) => a.min[k] <= b.max[k] && b.min[k] <= a.max[k])
    // Auto's net, and the three the run tried.
    for (const n of [null, 20, 6, 4]) {
      const params = { ...DEFAULT_SURFACE_FIT, net: n === null ? null : n === 6 ? { u: 6, v: 8 } : { u: n, v: n }, robust: true }
      let strays: Stray[]
      try {
        strays = fitSurfaceReported(region([]), params, facing).strays ?? []
      } catch (e) {
        if (!(e instanceof StraysRefusal)) throw e
        expect(e.message).toMatch(/so its normals are within 28° of that by construction/)
        strays = e.strays
      }
      expect(strays.some((s) => s.why.startsWith('a second sheet') && overlaps(s.box, cup))).toBe(true)
      expect(strays.some((s) => s.box.max[0] > gutter.min[0])).toBe(true)
      const refit = fitSurfaceReported(region(strays.map((s) => s.box)), params, facing)
      expect(refit.fit.rms).toBeLessThan(0.5)
    }
  })
})
