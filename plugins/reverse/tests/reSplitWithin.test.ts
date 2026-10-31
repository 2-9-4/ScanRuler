// SPDX-License-Identifier: AGPL-3.0-only
// A fitted surface held to the scan past its region (round 20, the mirror
// holder's swage): a band of S-profile across a block's top, its region
// cut where the band still curves. The fit says how far its margin stands
// off the scan; a split by it carried on says how much of the cut face
// lies off the scan outside the region — 5 mm under it, outside the band;
// and a split within the region cuts the band alone, the block's top
// outside it left as it was. The outline a split within cuts inside, on a
// region of its own.
import { beforeAll, describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { footprintOf, type SurfaceFitResult } from '../core/surfaceFit'
import { pastRegion, pointSpacing, regionOutline } from '../core/surfaceRegion'
import { build, extrudeAll, rectangleSketch } from './reKit'

/** The band: a dip and a crest across y, fading out along x past 8. */
const S = (y: number) => -1.0 * Math.exp(-(((y + 4) / 2.2) ** 2)) + 2.5 * Math.exp(-(((y - 4) / 2.2) ** 2))
const W = (x: number) => (Math.abs(x) <= 8 ? 1 : Math.abs(x) >= 14 ? 0 : Math.cos(((Math.abs(x) - 8) / 6) * (Math.PI / 2)) ** 2)
const height = (x: number, y: number) => 10 + S(y) * W(x)
/** The region, cut where the band still stands 0.7 mm proud. */
const inRegion = (x: number, y: number) => Math.abs(x) <= 12 && y >= -6.5 && y <= 6.5

/** The block's top scanned, 0.5 mm apart, 60 × 40. */
function scanOf() {
  const step = 0.5
  const nx = 121, ny = 81
  const positions: number[] = []
  const indices: number[] = []
  const region: number[] = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x = -30 + i * step, y = -20 + j * step
    if (inRegion(x, y)) region.push(i * ny + j)
    positions.push(x, y, height(x, y))
  }
  for (let i = 0; i + 1 < nx; i++) for (let j = 0; j + 1 < ny; j++) {
    const a = i * ny + j
    indices.push(a, a + ny, a + ny + 1, a, a + ny + 1, a + 1)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), region: Uint32Array.from(region) }
}

let k: ReKernel
const scan = scanOf()
beforeAll(async () => {
  k = await ReKernel.load()
})

/** The block 60 × 40 × 13, the band fitted with a margin of 10 %, and a
 *  split of the block by it. */
function part(split: Record<string, unknown>): Feature[] {
  const s = rectangleSketch(1, 60, 40, [-30, -20])
  const surface = { id: 3, kind: 'surface', name: 'Band', region: scan.region, fit: { net: null, degree: 3, expandPct: 10, smoothness: 0.01 }, visible: true } as unknown as Feature
  return [s, extrudeAll(2, s, 0, 13), surface, { id: 4, kind: 'split', name: 'Split', body: 2, tools: [3], keep: 'largest', tolerance: 0.2, overlap: 0.5, visible: true, ...split } as unknown as Feature]
}

async function built(features: Feature[]) {
  const builder = new Builder(k)
  builder.setScan(new NominalSurface(scan.positions, scan.indices), scan.positions)
  const out = await build(builder, features)
  return { builder, out }
}

/** The body's top off the scan, in the region and outside it. */
function topOff(positions: Float32Array) {
  let inBand = 0, outside = 0
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]]
    if (z < 5 || Math.abs(x) > 29.9 || Math.abs(y) > 19.9) continue
    const off = z - height(x, y)
    if (inRegion(x, y)) inBand = Math.max(inBand, Math.abs(off))
    else if (Math.abs(off) > Math.abs(outside)) outside = off
  }
  return { inBand, outside }
}

describe('a fitted surface past its region', () => {
  it('the fit says how far its margin stands off the scan', async () => {
    const { builder, out } = await built(part({}).slice(0, 3))
    const r = out.results.find((x) => x.id === 3)!
    expect(r.status).toBe('ok')
    expect(r.surface?.pastRegion?.off).toBeGreaterThan(1)
    // Past the region: outside |x| ≤ 12, |y| ≤ 6.5.
    const at = r.surface!.pastRegion!.at
    expect(Math.abs(at[0]) > 12 || Math.abs(at[1]) > 6.5).toBe(true)
    expect(r.warning).toMatch(/Past its region the surface stands up to [\d.]+ mm off the scan/)
    builder.dispose()
  }, 120_000)

  it('a split carried on says how much of its cut face lies off the scan outside the region', async () => {
    const { builder, out } = await built(part({}))
    const r = out.results.find((x) => x.id === 4)!
    expect(r.status).toBe('ok')
    // The top outside the band cut 5 mm under the scan.
    expect(topOff(out.bodies.find((b) => b.id === 2)!.mesh.positions).outside).toBeLessThan(-4.5)
    expect(r.offScan).toHaveLength(1)
    expect(r.offScan![0]).toMatchObject({ tool: 'Band' })
    expect(r.offScan![0].max).toBeGreaterThan(4.5)
    expect(r.offScan![0].area).toBeGreaterThan(100)
    expect(r.warning).toMatch(/The cut face lies up to [\d.]+ mm off the scan past Band's region/)
    builder.dispose()
  }, 120_000)

  it('a split within the region cuts the band and leaves the top outside it as it was', async () => {
    const { builder, out } = await built(part({ within: 1 }))
    const r = out.results.find((x) => x.id === 4)!
    expect(r.status).toBe('ok')
    const body = out.bodies.find((b) => b.id === 2)!
    const off = topOff(body.mesh.positions)
    expect(off.inBand).toBeLessThan(0.8)
    // Outside the outline the block's top stands at 13, untouched: 3 mm
    // over the scan's 10, never under it.
    expect(off.outside).toBeCloseTo(3, 1)
    expect(body.topology.faces.some((f) => f.fingerprint.kind === 'plane' && f.fingerprint.origin === 2 && Math.abs(f.fingerprint.centroid[2] - 13) < 1e-6 && f.fingerprint.dir[2] > 0.99)).toBe(true)
    // What was cut lies within the outline: the block lost about the band's
    // 26 × 15 mm of it, 1 to 3 mm deep.
    expect(31_200 - body.volume).toBeGreaterThan(600)
    expect(31_200 - body.volume).toBeLessThan(1_600)
    // Only the margin ring is left to say anything of.
    expect(r.offScan![0].max).toBeLessThan(2)
    builder.dispose()
  }, 120_000)

  it('refuses within on a sheet, and for a tool with no region', async () => {
    const sheetSplit = { id: 5, kind: 'split', name: 'Trim', body: 3, tools: [2], keep: 'largest', tolerance: 0.2, overlap: 0.5, within: 1, visible: true } as unknown as Feature
    const { builder, out } = await built([...part({ body: 2, tools: [3] }).slice(0, 3), sheetSplit])
    expect(out.results.find((x) => x.id === 5)?.message).toMatch(/within keeps a solid's cut/)
    builder.dispose()
    const s = rectangleSketch(6, 10, 10, [40, 40])
    const second = { ...extrudeAll(7, s, 0, 5), name: 'Other' }
    const noRegion = { id: 8, kind: 'split', name: 'Split', body: 2, tools: [7], keep: 'largest', tolerance: 0.2, overlap: 0.5, within: 1, visible: true } as unknown as Feature
    const again = await built([...part({}).slice(0, 2), s, second, noRegion])
    expect(again.out.results.find((x) => x.id === 8)?.message).toMatch(/Other has no region to keep the cut within/)
    again.builder.dispose()
  }, 120_000)
})

describe('a region against its fit', () => {
  const fit = { origin: [0, 0, 0], axisU: [1, 0, 0], axisV: [0, 1, 0], normal: [0, 0, 1] } as const
  /** A 20 × 10 grid of points 0.5 apart, over z = 0. */
  const grid = () => {
    const xyz: number[] = []
    for (let x = -10; x <= 10 + 1e-9; x += 0.5) for (let y = -5; y <= 5 + 1e-9; y += 0.5) xyz.push(x, y, 0)
    return Float64Array.from(xyz)
  }

  it('reads the points’ spacing', () => {
    expect(pointSpacing(footprintOf(fit as never, grid()))).toBeCloseTo(0.5, 3)
  })

  it('draws the outline grown by the margin and the spacing, its corners round', () => {
    const footprint = footprintOf(fit as never, grid())
    const outline = regionOutline({ ...fit, footprint } as unknown as SurfaceFitResult, 2)!
    expect(outline.level).toBeCloseTo(2.5, 3)
    expect(outline.loops).toHaveLength(1)
    const loop = outline.loops[0]
    let area = 0
    for (let i = 0; i < loop.length; i++) area += loop[i][0] * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * loop[i][1]
    area /= 2
    // A 20 × 10 rectangle grown by 2.5: 25 × 15 with its corners rounded.
    expect(area).toBeGreaterThan(0)
    expect(area).toBeCloseTo(25 * 15 - (4 - Math.PI) * 2.5 ** 2, -1)
    const xs = loop.map((p) => p[0])
    expect(Math.max(...xs)).toBeCloseTo(12.5, 1)
    expect(Math.min(...xs)).toBeCloseTo(-12.5, 1)
    // Thinned: a few corners a round, not the field's every step.
    expect(loop.length).toBeLessThan(80)
  })

  it('fills a hole in the region, and keeps two regions apart', () => {
    const xyz: number[] = []
    for (let x = -10; x <= 10 + 1e-9; x += 0.5) for (let y = -5; y <= 5 + 1e-9; y += 0.5) if (!(Math.abs(x) < 3 && Math.abs(y) < 2)) xyz.push(x, y, 0)
    for (let x = 30; x <= 34 + 1e-9; x += 0.5) for (let y = -2; y <= 2 + 1e-9; y += 0.5) xyz.push(x, y, 0)
    const footprint = footprintOf(fit as never, xyz)
    const outline = regionOutline({ ...fit, footprint } as unknown as SurfaceFitResult, 1)!
    expect(outline.loops).toHaveLength(2)
  })

  it('reads the margin off the scan, not the points under the region', () => {
    // A flat region at z = 0 fitted as z = 0, the surface's margin over a
    // scan that steps down 2 mm past x = 12.
    const points = grid()
    const footprint = footprintOf(fit as never, points)
    const flat = { ...fit, uRange: [-14, 14], vRange: [-7, 7], degree: 3, nu: 4, nv: 4, knotsU: Float64Array.from([-14, -14, -14, -14, 14, 14, 14, 14]), knotsV: Float64Array.from([-7, -7, -7, -7, 7, 7, 7, 7]), heights: new Float64Array(16), footprint } as unknown as SurfaceFitResult
    const near = (p: readonly number[]): [number, number, number] => [p[0], p[1], p[0] > 12 ? -2 : 0]
    const past = pastRegion(flat, near)!
    expect(past.off).toBeCloseTo(2, 3)
    expect(past.at[0]).toBeGreaterThan(12)
    // The scan off to the side — past the part's edge — is not read.
    expect(pastRegion(flat, (p) => [p[0] + 5, p[1], 0])).toBeNull()
  })
})
