// SPDX-License-Identifier: AGPL-3.0-only
// The scan's flat regions through the commands: scan.segment on a faceted
// block, mirror twins across a plane, a region marked and fitted with
// element.fit_marked; element.fit answering the region it grew and warning
// when it grew across two surfaces. In the in-process worker (commandKit.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chamferedBlock, face, facetedSolid } from './facetedSolid'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from './commandKit'

type Vec3 = [number, number, number]

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

const open = (faces = chamferedBlock(), noise = 0.01) =>
  run('scan.open', { bytes: stlBytes(soupOf(facetedSolid(faces, { noise }))), name: 'block.stl', discard: true })

interface Region {
  id: number
  normal: Vec3
  point: Vec3
  sigma: number
  area: number
  box: { min: Vec3; max: Vec3 }
  vertices: number
  neighbours: { id: number; deg: number }[]
  mirror?: { id: number | 'self'; deg: number; mm: number }
}
interface Segmented { found: number; shown?: number; considered: number; claimed: number; regions: Region[]; marked?: { points: number; from: string } }

const near = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > Math.cos((0.5 * Math.PI) / 180)
const byNormal = (s: Segmented, n: Vec3) => s.regions.find((r) => near(r.normal, n))!

describe('scan.segment', () => {
  it('finds each face as one region, with its plane and neighbours', async () => {
    await open()
    const s = await run<Segmented>('scan.segment', { minArea: 10 })
    expect(s.found).toBe(11)
    expect(s.regions).toHaveLength(11)
    expect(s.regions.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const top = byNormal(s, [0, 0, 1])
    expect(top.point[2]).toBeCloseTo(10, 1)
    expect(top.sigma).toBeLessThan(0.015)
    const bevel = byNormal(s, [Math.sin((25 * Math.PI) / 180), 0, Math.cos((25 * Math.PI) / 180)])
    expect(top.neighbours.find((n) => n.id === bevel.id)?.deg).toBeCloseTo(25, 0)
    // No vertex lists in the answer.
    expect(JSON.stringify(s).length).toBeLessThan(6000)

    const few = await run<Segmented>('scan.segment', { minArea: 10, limit: 3 })
    expect(few.shown).toBe(3)
    expect(few.regions).toHaveLength(3)
    for (const r of few.regions) for (const n of r.neighbours) expect(n.id).toBeLessThanOrEqual(3)
  })

  it('pairs mirror twins across a plane', async () => {
    await open()
    const s = await run<Segmented>('scan.segment', { minArea: 10, symmetric: 'ZX' })
    const plusY = byNormal(s, [0, 1, 0])
    const minusY = byNormal(s, [0, -1, 0])
    expect(plusY.mirror?.id).toBe(minusY.id)
    expect(minusY.mirror?.id).toBe(plusY.id)
    expect(plusY.mirror!.deg).toBeLessThan(0.5)
    expect(plusY.mirror!.mm).toBeLessThan(0.05)
    const s2 = Math.SQRT1_2
    expect(byNormal(s, [s2, s2, 0]).mirror?.id).toBe(byNormal(s, [s2, -s2, 0]).id)
    // The top straddles the plane: its own twin.
    expect(byNormal(s, [0, 0, 1]).mirror?.id).toBe('self')
    // Across YZ the bevel has none.
    const yz = await run<Segmented>('scan.segment', { minArea: 10, symmetric: 'YZ' })
    expect(byNormal(yz, [Math.sin((25 * Math.PI) / 180), 0, Math.cos((25 * Math.PI) / 180)]).mirror).toBeUndefined()
  })

  it('marks a region for element.fit_marked', async () => {
    await open()
    expect((await refused('element.fit_marked', { kind: 'plane', marked: true })).code).toBe('invalid_state')
    const s = await run<Segmented>('scan.segment', { minArea: 10, mark: 2 })
    expect(s.marked).toEqual({ points: s.regions[1].vertices, from: 'scan.segment region 2' })
    const fitted = await run<{ element: { fit: { normal: Vec3; usedPoints: number }; source: { markedPoints: number } } }>('element.fit_marked', { kind: 'plane', marked: true })
    expect(near(fitted.element.fit.normal, s.regions[1].normal)).toBe(true)
    expect(fitted.element.source.markedPoints).toBe(s.regions[1].vertices)
    expect((await refused('scan.segment', { mark: 99 })).code).toBe('invalid_input')
    expect((await refused('element.fit_marked', { kind: 'plane', marked: true, vertices: [1, 2, 3] })).code).toBe('invalid_input')
  })

  it('keeps to a box', async () => {
    await open()
    const s = await run<Segmented>('scan.segment', { box: { min: [-30, -30, 5], max: [30, 30, 30] }, minArea: 10 })
    expect(s.considered).toBeLessThan(s.claimed * 3)
    for (const r of s.regions) expect(r.box.min[2]).toBeGreaterThanOrEqual(5)
    expect(s.regions.some((r) => near(r.normal, [0, 0, -1]))).toBe(false)
  })
})

describe('element.fit answers the region it grew', () => {
  it('gives the area, box and normal spread, and marks it', async () => {
    await open(chamferedBlock(), 0.005)
    const r = await run<{ region: { area: number; box: { min: Vec3; max: Vec3 }; normalSpreadDeg: number }; warning?: string; marked?: { points: number } ; element: { fit: { regionSize: number } } }>('element.fit', { kind: 'plane', at: { point: [-5, 0, 10] }, mark: true })
    expect(r.region.area).toBeGreaterThan(780)
    expect(r.region.area).toBeLessThan(900)
    expect(r.region.box.max[0]).toBeLessThan(10.3)
    expect(r.region.normalSpreadDeg).toBeLessThan(5)
    expect(r.warning).toBeUndefined()
    expect(r.marked?.points).toBe(r.element.fit.regionSize)
    // A point is picked, not grown: it has no region to mark.
    expect((await refused('element.fit', { kind: 'point', at: { point: [-5, 0, 10] }, mark: true })).code).toBe('invalid_input')
  })

  it('warns when a box straddling a shallow crease grows it over two surfaces', async () => {
    const t = (2 * Math.PI) / 180
    const faces = chamferedBlock().filter((f) => f.name !== 'bevel')
    faces.push(face('roof', [Math.sin(t), 0, Math.cos(t)], [0, 0, 10]))
    await open(faces, 0.02)
    const r = await run<{ warning?: string; region: { second?: { centroid: Vec3; angleDeg: number; offset: number } } }>('element.fit', {
      kind: 'plane',
      at: { point: [-8, 0, 10] },
      within: { min: [-16, -10, 5], max: [12, 10, 12] },
    })
    expect(r.warning).toMatch(/^two surfaces\?/)
    expect(r.warning).toMatch(/shrink the box or move the seed/)
    expect(r.region.second!.centroid[0]).toBeGreaterThan(1)
    expect(r.region.second!.angleDeg).toBeGreaterThan(1)
    expect(r.region.second!.offset).toBeLessThan(0)
    // Kept off the crease, the same seed grows one surface.
    const one = await run<{ warning?: string }>('element.fit', { kind: 'plane', at: { point: [-8, 0, 10] }, within: { min: [-16, -10, 5], max: [-1, 10, 12] } })
    expect(one.warning).toBeUndefined()
  })
})
