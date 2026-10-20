// SPDX-License-Identifier: AGPL-3.0-only
// The scan read before modelling — scan.heightmap, scan.qa — and the fits
// and the alignment that say what they did: element.fit told which side,
// align.datum's origin. In the in-process worker (commandKit.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { boxMesh } from './helpers'
import { cupMesh, platedHole } from './guideMeshes'
import { refused, run, startHeadless, stlBytes, type Headless } from './commandKit'

type Vec3 = [number, number, number]

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

const open = (soup: Float32Array, name: string) => run('scan.open', { bytes: stlBytes(soup), name, discard: true })

/** A 40 × 40 plate `t` thick whose top face leans `deg` along x. */
function wedgePlate(t: number, deg: number): Float32Array {
  const soup = boxMesh(40, 20)
  const slope = Math.tan((deg * Math.PI) / 180)
  for (let i = 0; i < soup.length; i += 3) {
    const top = soup[i + 2] > 0
    soup[i + 2] = top ? t / 2 + slope * (soup[i] + 20) : -t / 2
  }
  return soup
}

/** The 40 mm box without its top face: one open rim, 160 mm round. */
function openBox(): Float32Array {
  const soup = boxMesh(40, 8)
  const kept: number[] = []
  for (let i = 0; i < soup.length; i += 9) {
    if (soup[i + 2] > 19.9 && soup[i + 5] > 19.9 && soup[i + 8] > 19.9) continue
    for (let k = 0; k < 9; k++) kept.push(soup[i + k])
  }
  return Float32Array.from(kept)
}

interface Height { along: string; across: string[]; cell: number; cols: number; rows: number; origin: [number, number]; grid: (number | null)[][]; min: number; max: number; hit: number }

describe('scan.heightmap', () => {
  it('reads the top from above and the underside from below, nothing past the part', async () => {
    await open(boxMesh(40, 20), 'box.stl')
    const down = await run<Height>('scan.heightmap', { box: { min: [-30, -30, -30], max: [30, 30, 30] }, cell: 5 })
    expect(down.along).toBe('z')
    expect(down.across).toEqual(['x', 'y'])
    expect([down.cols, down.rows]).toEqual([12, 12])
    expect(down.origin).toEqual([-30, -30])
    // Cells 2..9 lie over the box (−20…20), the rest beside it.
    expect(down.grid[5][5]).toBeCloseTo(20, 2)
    expect(down.grid[0][0]).toBeNull()
    expect(down.hit).toBe(64)
    expect(down.max).toBeCloseTo(20, 2)
    const up = await run<Height>('scan.heightmap', { axis: '+z', cell: 5 })
    expect(up.grid[3][3]).toBeCloseTo(-20, 2)
    const side = await run<Height>('scan.heightmap', { axis: '+x' })
    expect(side.across).toEqual(['y', 'z'])
    expect(side.cols * side.rows).toBeLessThanOrEqual(1600)
    expect(side.min).toBeCloseTo(-20, 2)
  })

  it('keeps the grid small and refuses a box inside out', async () => {
    await open(boxMesh(40, 20), 'box.stl')
    const fine = await run<Height & { note?: string }>('scan.heightmap', { cell: 0.1 })
    expect(fine.cols * fine.rows).toBeLessThanOrEqual(1600)
    expect(fine.note).toMatch(/widened/)
    expect((await refused('scan.heightmap', { box: { min: [1, 0, 0], max: [0, 1, 1] } })).code).toBe('invalid_input')
  })
})

interface Qa {
  rims: { count: number; total: number; largest: { length: number; at: Vec3 }[] }
  noise: { median: number }
  thickness: { axis: Vec3; p50: number; tiltDeg: number; thickensToward: Vec3; run: [number, number]; over: number; faces: { topDeg: number; bottomDeg: number } }
  notes: string[]
}

describe('scan.qa', () => {
  it('finds a closed, exact box square through', async () => {
    await open(boxMesh(40, 20), 'box.stl')
    const qa = await run<Qa>('scan.qa', { axis: 'z' })
    expect(qa.rims.count).toBe(0)
    expect(qa.noise.median).toBeLessThan(1e-3)
    expect(qa.thickness.p50).toBeCloseTo(40, 2)
    expect(qa.thickness.tiltDeg).toBeLessThan(0.01)
  })

  it('names faces out of parallel, the way the part thickens, and which face leans', async () => {
    await open(wedgePlate(4, 0.8), 'wedge.stl')
    // Unaligned, the axis is the way most of the surface faces: between
    // the two faces, each leaning half the angle off it.
    const qa = await run<Qa>('scan.qa')
    expect(Math.abs(qa.thickness.axis[2])).toBeGreaterThan(0.999)
    expect(qa.thickness.tiltDeg).toBeCloseTo(0.8, 2)
    expect(qa.thickness.thickensToward[0]).toBeCloseTo(1, 3)
    expect(qa.thickness.run[1] - qa.thickness.run[0]).toBeCloseTo(Math.tan((0.8 * Math.PI) / 180) * qa.thickness.over, 2)
    expect(qa.thickness.faces.topDeg).toBeCloseTo(0.4, 1)
    expect(qa.thickness.faces.bottomDeg).toBeCloseTo(0.4, 1)
    expect(qa.notes.join(' ')).toMatch(/0\.8° apart/)
    // Along z, the bottom is square and the top leans the whole angle.
    const z = await run<Qa>('scan.qa', { axis: 'z' })
    expect(z.thickness.faces.bottomDeg).toBeLessThan(0.01)
    expect(z.thickness.faces.topDeg).toBeCloseTo(0.8, 2)
    expect(z.notes.join(' ')).toMatch(/across z that/)
  })

  it('counts the open rims and their length', async () => {
    await open(openBox(), 'open.stl')
    const qa = await run<Qa>('scan.qa', { axis: 'x' })
    expect(qa.rims.count).toBe(1)
    expect(qa.rims.total).toBeCloseTo(160, 1)
    expect(qa.rims.largest[0].at[2]).toBeCloseTo(20, 3)
    expect(qa.notes[0]).toMatch(/1 open rim/)
  })
})

describe('element.fit told what it is after', () => {
  it('takes the cup’s inside from its rim, and refuses a size it cannot find', async () => {
    await open(cupMesh(6.5, 10), 'cup.stl')
    const inside = await run<{ element: { fit: { radius: number } } }>('element.fit', { kind: 'sphere', at: { point: [8.25, 0, 0] }, side: 'inside' })
    expect(inside.element.fit.radius).toBeCloseTo(6.5, 1)
    const e = await refused('element.fit', { kind: 'sphere', at: { point: [8.25, 0, 0] }, radius: { min: 20 } })
    expect(e.code).toBe('failed')
    expect(e.message).toMatch(/Found R/)
    expect((await refused('element.fit', { kind: 'plane', at: { point: [8.25, 0, 0] }, side: 'inside' })).code).toBe('invalid_input')
  })

  it('finds a bore from its mouth with the axis given', async () => {
    await open(platedHole(3, 30, 6), 'plate.stl')
    const bore = await run<{ element: { fit: { radius: number } } }>('element.fit', { kind: 'cylinder', at: { point: [0, 0, 3] }, axis: [0, 0, 1] })
    expect(bore.element.fit.radius).toBeCloseTo(3, 1)
  })
})

describe('align.datum’s origin', () => {
  it('says which coordinates it set, and where its point stands off zero', async () => {
    await open(boxMesh(40, 20), 'box.stl')
    const r = await run<{ origin: { set: string[]; at: Vec3; note?: string } }>('align.datum', {
      primary: { points: [[-10, -10, -20], [10, -10, -20], [0, 10, -20]] },
      secondary: { points: [[-10, -20, -20], [10, -20, -20]] },
      origin: { point: [5, 0, 0] },
    })
    expect(r.origin.set).toEqual(['x'])
    expect(r.origin.at[0]).toBeCloseTo(0, 3)
    expect(r.origin.at[1]).toBeCloseTo(20, 3)
    expect(r.origin.at[2]).toBeCloseTo(20, 3)
    expect(r.origin.note).toMatch(/own y and z.*origin alone/)
    const only = await run<{ origin: { set: string[]; note?: string } }>('align.datum', { origin: { point: [0, 20, 20] } })
    expect(only.origin.set).toEqual(['x', 'y', 'z'])
    expect(only.origin.note).toBeUndefined()
  })
})
