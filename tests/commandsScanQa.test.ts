// SPDX-License-Identifier: AGPL-3.0-only
// The scan read before modelling — scan.heightmap, scan.qa — and the fits
// and the alignment that say what they did: element.fit told which side,
// parting a stepped bore, a bore a plug closes; scan.qa on a closed skin;
// align.datum's origin. In the in-process worker (commandKit.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { boxMesh } from './helpers'
import { cupMesh, platedHole, steppedBore } from './guideMeshes'
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

/** A soup with every vertex moved a little, the same way wherever it
 *  repeats, so the copies still weld: a scanned surface's scatter on every
 *  face, not only where a mesh builder put noise. */
function scattered(soup: Float32Array, mm: number): Float32Array {
  const out = soup.slice()
  const hash = (x: number, y: number, z: number, k: number) => {
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k * 4.581) * 43758.5453
    return h - Math.floor(h) - 0.5
  }
  for (let i = 0; i < soup.length; i += 3) {
    const [x, y, z] = [soup[i], soup[i + 1], soup[i + 2]]
    for (let k = 0; k < 3; k++) out[i + k] = soup[i + k] + 2 * mm * hash(x, y, z, k)
  }
  return out
}

describe('a bore that steps, and one a wrap closed', () => {
  it('parts a stepped bore and answers the wider part as second', async () => {
    await open(steppedBore({ r1: 4.5, l1: 9, r2: 4.95, l2: 16, noise: 0.08, taper: 1.2 }), 'stepped.stl')
    const r = await run<{ element: { fit: { radius: number; length: number } }; note?: string; second?: { radius: number; band: [number, number]; share: number } }>('element.fit', { kind: 'cylinder', at: { point: [4.5, 0, -3] } })
    expect(Math.abs(r.element.fit.radius - 4.5)).toBeLessThan(0.02)
    expect(Math.abs(r.element.fit.length - 9)).toBeLessThan(0.75)
    expect(r.note).toMatch(/two surfaces along the axis/)
    expect(Math.abs(r.second!.radius - 4.95)).toBeLessThan(0.03)
  })

  it('says where a bore’s axis runs into the skin closing it', async () => {
    await open(steppedBore({ r1: 4.2, l1: 9, r2: 4.2, l2: 12, noise: 0.01, plug: 3 }), 'plugged.stl')
    const r = await run<{ closed?: { from: number; to: number; at: Vec3 }; warning?: string }>('element.fit', { kind: 'cylinder', at: { point: [4.2, 0, -4] } })
    expect(r.closed!.at[2]).toBeCloseTo(-9, 1)
    expect(Math.abs(r.closed!.to - r.closed!.from)).toBeCloseTo(3, 1)
    expect(r.warning).toMatch(/closed: the axis meets the scan .* and leaves it 3(\.\d+)? mm further on — a floor, or the skin of a wrap/)
    // Open through, nothing is said.
    await open(steppedBore({ r1: 4.2, l1: 9, r2: 4.2, l2: 12, noise: 0.01 }), 'through.stl')
    const through = await run<{ closed?: unknown; warning?: string }>('element.fit', { kind: 'cylinder', at: { point: [4.2, 0, -4] } })
    expect(through.closed).toBeUndefined()
    expect(through.warning).toBeUndefined()
  })

  it('notes a scanned skin closed all round, and not a CAD one', async () => {
    await open(scattered(steppedBore({ r1: 4.2, l1: 9, r2: 4.2, l2: 12, plug: 3 }), 0.01), 'wrapped.stl')
    const qa = await run<Qa>('scan.qa', { axis: 'z' })
    expect(qa.rims.count).toBe(0)
    expect(qa.notes.join(' ')).toMatch(/Closed skin, no open rims: a wrap bridges holes it did not see through — read each hole from both ends/)
    await open(boxMesh(40, 20), 'box.stl')
    expect((await run<Qa>('scan.qa', { axis: 'z' })).notes.join(' ')).not.toMatch(/Closed skin/)
  })

  /** The soup with two of its triangles, far apart, taken out. */
  const pinholed = (soup: Float32Array) => {
    const kept = Array.from(soup)
    const last = Math.floor(soup.length / 9) - 1
    kept.splice(last * 9, 9)
    kept.splice(0, 9)
    return Float32Array.from(kept)
  }

  it('reads rims very short against the part as a wrap too, and says what it holds', async () => {
    // 150 mm on a side, 260 across; triangles 0.75 mm a side: 5 mm of rim.
    await open(scattered(pinholed(boxMesh(150, 200)), 0.01), 'pinholes.stl')
    const qa = await run<Qa>('scan.qa', { axis: 'z' })
    expect(qa.rims.count).toBe(2)
    expect(qa.rims.total).toBeLessThan(0.02 * 260)
    const said = qa.notes.join(' ')
    expect(said).toMatch(/Closed skin but for pinholes, 2 open rims, 5(\.\d)? mm in all on a part 260 mm across: a wrap bridges holes it did not see through — read each hole from both ends/)
    expect(said).not.toMatch(/the scan has holes there/)
  })

  it('leaves a rim of any length as a hole, and a CAD tessellation’s pinholes as holes', async () => {
    await open(scattered(openBox(), 0.01), 'open-scan.stl')
    const hole = (await run<Qa>('scan.qa', { axis: 'x' })).notes.join(' ')
    expect(hole).toMatch(/1 open rim, 160 mm in all/)
    expect(hole).not.toMatch(/Closed skin/)
    await open(pinholed(boxMesh(150, 200)), 'pinholes-cad.stl')
    const cad = (await run<Qa>('scan.qa', { axis: 'z' })).notes.join(' ')
    expect(cad).toMatch(/2 open rims/)
    expect(cad).not.toMatch(/Closed skin/)
  })
})
