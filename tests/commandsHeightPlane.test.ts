// SPDX-License-Identifier: AGPL-3.0-only
// Heights and deviation in a plane's own frame, gathered into levels, and
// the deviation as data: scan.heightmap { plane, of, levels } and
// deviation.export. In the in-process worker (commandKit.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cellNoise, heightLevels, reliefGrid } from '../src/core/geometry/heightGrid'
import { boxMesh } from './helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from './commandKit'

vi.setConfig({ testTimeout: 180_000 })

type Vec3 = [number, number, number]

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

const open = (soup: Float32Array, name: string) => run('scan.open', { bytes: stlBytes(soup), name, discard: true })

/** A box sx × sy × sz round `c`, its faces cut in a grid. */
function cuboid(s: Vec3, c: Vec3, grid = 16): Float32Array {
  const soup = boxMesh(1, grid)
  for (let i = 0; i < soup.length; i++) soup[i] = soup[i] * s[i % 3] + c[i % 3]
  return soup
}

/** Rotation by `deg` about the unit axis (Rodrigues), then a shift. */
function placer(axis: Vec3, deg: number, shift: Vec3) {
  const [x, y, z] = axis
  const t = (deg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const k = 1 - c
  const m = [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ]
  const turn = (p: Vec3): Vec3 => [0, 1, 2].map((r) => m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2]) as Vec3
  const place = (p: Vec3): Vec3 => {
    const q = turn(p)
    return [q[0] + shift[0], q[1] + shift[1], q[2] + shift[2]]
  }
  return { turn, place }
}

const AXIS: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0]
const P = placer(AXIS, 25, [5, -3, 10])

/** A 40 × 40 × 4 plate, its top at z 0, with a 16 mm pad 1 mm high on it
 *  and an 8 mm tier 0.5 mm higher on that — leant 25° and moved. */
function tieredPlate(): Float32Array {
  const parts = [cuboid([40, 40, 4], [0, 0, -2], 20), cuboid([16, 16, 1], [0, 0, 0.5], 16), cuboid([8, 8, 0.5], [0, 0, 1.25], 8)]
  const soup = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    for (let i = 0; i < p.length; i += 3) soup.set(P.place([p[i], p[i + 1], p[i + 2]]), at + i)
    at += p.length
  }
  return soup
}

interface Level { height: number; sigma: number; area: number; cells: number; sharePct: number; box: { min: [number, number]; max: [number, number] } }
interface Map {
  plane?: { name?: string; origin: Vec3; u: Vec3; v: Vec3; normal: Vec3 }
  along: string
  of: string
  cell: number
  cols: number
  rows: number
  origin: [number, number]
  grid?: (number | null)[][]
  hit: number
  valued: number
  min: number
  max: number
  levels?: Level[]
  gap?: number
  unassigned?: number
}

describe('scan.heightmap on a plane', () => {
  it('reads a leaning pad’s two tiers as levels in one call', async () => {
    await open(tieredPlate(), 'tiers.stl')
    const plane = { origin: P.place([0, 0, 0]), normal: P.turn([0, 0, 1]) }
    const m = await run<Map>('scan.heightmap', { plane, levels: true })
    expect(m.grid).toBeUndefined()
    expect(m.along).toBe('normal')
    // The frame: right-handed, the normal the one given.
    const { u, v, normal } = m.plane!
    const cross: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    for (let j = 0; j < 3; j++) {
      expect(cross[j]).toBeCloseTo(normal[j], 5)
      expect(normal[j]).toBeCloseTo(plane.normal[j], 5)
    }
    const levels = m.levels!
    expect(levels.length).toBeGreaterThanOrEqual(3)
    const [plate, pad, tier] = levels
    expect(plate.height).toBeCloseTo(0, 2)
    expect(pad.height).toBeCloseTo(1, 2)
    expect(tier.height).toBeCloseTo(1.5, 2)
    expect(plate.area).toBeGreaterThan(1344 * 0.8)
    expect(plate.area).toBeLessThan(1344 * 1.2)
    expect(pad.area).toBeGreaterThan(192 * 0.7)
    expect(pad.area).toBeLessThan(192 * 1.3)
    expect(tier.area).toBeGreaterThan(64 * 0.7)
    expect(tier.area).toBeLessThan(64 * 1.3)
    // The tier's box is 8 mm across, in the plane's u and v.
    expect(tier.box.max[0] - tier.box.min[0]).toBeGreaterThan(7)
    expect(tier.box.max[0] - tier.box.min[0]).toBeLessThan(8 + 2 * m.cell + 1e-6)
    expect(m.gap).toBeGreaterThanOrEqual(0.02)
  })

  it('takes a fitted plane element, looking at the face it was fitted on', async () => {
    await open(tieredPlate(), 'tiers.stl')
    const fit = await run<{ element: { id: number } }>('element.fit', { kind: 'plane', at: { point: P.place([15, 15, 0]) } })
    const m = await run<Map>('scan.heightmap', { plane: fit.element.id, levels: true, grid: true })
    expect(m.grid).toBeDefined()
    expect(m.plane!.name).toBeDefined()
    // Turned off the plate whichever way the fit's normal came out.
    expect(m.levels![0].height).toBeCloseTo(0, 1)
    expect(m.levels![1].height).toBeCloseTo(1, 1)
    expect(m.levels![2].height).toBeCloseTo(1.5, 1)
    // flip looks from below: the plate's underside, 4 mm behind.
    const under = await run<Map>('scan.heightmap', { plane: fit.element.id, flip: true, levels: true })
    expect(under.levels![0].height).toBeCloseTo(4, 1)
  })

  it('on a coordinate plane is the axis map', async () => {
    await open(boxMesh(40, 20), 'box.stl')
    const byAxis = await run<Map>('scan.heightmap', { box: { min: [-30, -30, -30], max: [30, 30, 30] }, cell: 5 })
    const byPlane = await run<Map>('scan.heightmap', { plane: 'XY', box: { min: [-30, -30, -30], max: [30, 30, 30] }, cell: 5 })
    expect(byPlane.plane!.normal).toEqual([0, 0, 1])
    expect(byPlane.origin).toEqual(byAxis.origin)
    expect(byPlane.grid).toEqual(byAxis.grid)
    expect((await refused('scan.heightmap', { plane: 'XY', axis: '-z' })).code).toBe('invalid_input')
    expect((await refused('scan.heightmap', { flip: true })).code).toBe('invalid_input')
    expect((await refused('scan.heightmap', { of: 'deviation' })).code).toBe('invalid_state')
    // The picture alone needs the browser.
    expect((await refused('scan.heightmap', { grid: false })).code).toBe('unavailable')
  })

  it('relief takes the lean off and leaves what stands out', async () => {
    await open(tieredPlate(), 'tiers.stl')
    const m = await run<Map>('scan.heightmap', { axis: '-z', of: 'relief', smooth: 1 })
    const h = await run<Map>('scan.heightmap', { axis: '-z' })
    // The leaning plate spans millimetres of z; its relief, on the plate's
    // top three smoothing widths from the pad and its own edge, next to
    // none.
    expect(h.max - h.min).toBeGreaterThan(10)
    const o = P.place([0, 0, 0])
    const n = P.turn([0, 0, 1])
    const onTop: number[] = []
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const x = m.origin[0] + (c + 0.5) * m.cell
        const y = m.origin[1] + (r + 0.5) * m.cell
        const top = o[2] - (n[0] * (x - o[0]) + n[1] * (y - o[1])) / n[2]
        const z = h.grid![r][c]
        if (z === null || Math.abs(z - top) > 0.01) continue
        // In the plate's own frame (the turn undone: it is a rotation).
        const d: Vec3 = [x - o[0], y - o[1], z - o[2]]
        const ex = P.turn([1, 0, 0])
        const ey = P.turn([0, 1, 0])
        const lx = Math.abs(d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2])
        const ly = Math.abs(d[0] * ey[0] + d[1] * ey[1] + d[2] * ey[2])
        if (Math.max(lx, ly) > 17 || Math.max(lx, ly) < 11) continue
        onTop.push(m.grid![r][c]!)
      }
    }
    expect(onTop.length).toBeGreaterThan(100)
    for (const x of onTop) expect(Math.abs(x)).toBeLessThan(0.02)
    expect(m.max).toBeGreaterThan(0.3)
  })
})

describe('the height grid read further', () => {
  it('keeps two levels apart across the few cells of the wall between them', () => {
    const cols = 40
    const rows = 40
    const g = new Float32Array(cols * rows)
    // A step at column 20, met halfway up by every eighth ray.
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g[r * cols + c] = c < 20 ? 0 : c === 20 && r % 8 === 0 ? 0.37 : 0.8
    g[5] = Number.NaN
    const found = heightLevels(g, { cols, cell: 0.5, u0: 0, v0: 0 }, Math.max(3 * cellNoise(g, cols, rows), 0.02))
    expect(found.levels.map((l) => l.height)).toEqual([0, expect.closeTo(0.8, 5)])
    expect(found.levels[0].cells).toBe(799)
    expect(found.levels[0].area).toBeCloseTo(799 * 0.25, 6)
    expect(found.levels[1].cells).toBe(795)
    expect(found.levels[1].box.min[0]).toBeCloseTo(10, 6)
    expect(found.unassigned).toBe(5)
    const flat = reliefGrid(Float32Array.from({ length: 100 }, (_, i) => 0.1 * (i % 10)), 10, 10, 2)
    for (let i = 0; i < 100; i++) if (i % 10 > 2 && i % 10 < 7) expect(Math.abs(flat[i])).toBeLessThan(1e-5)
  })
})

describe('deviation in a heightmap and as data', () => {
  /** The 40 mm box against a reference a tenth taller: top and bottom
   *  2 mm inside it, the sides on it. */
  async function slabMap() {
    await open(boxMesh(40, 40), 'box.stl')
    const slab = boxMesh(40, 40).map((v, i) => (i % 3 === 2 ? v * 1.1 : v))
    await run('deviation.open_reference', { bytes: stlBytes(slab), name: 'slab.stl' })
    await run('deviation.align')
    await run('deviation.settings', { maxDistance: 3, tolerance: 0.5 })
  }

  it('reads the deviation where each ray lands', async () => {
    await slabMap()
    const top = await run<Map>('scan.heightmap', { of: 'deviation', cell: 5, box: { min: [-15, -15, -30], max: [15, 15, 30] } })
    expect(top.valued).toBe(36)
    for (const row of top.grid!) for (const x of row) expect(x).toBeCloseTo(-2, 1)
    const side = await run<Map>('scan.heightmap', { axis: '+x', of: 'deviation', cell: 5, box: { min: [-30, -15, -15], max: [30, 15, 15] } })
    for (const row of side.grid!) for (const x of row) expect(Math.abs(x!)).toBeLessThan(0.05)
    const lv = await run<Map>('scan.heightmap', { of: 'deviation', levels: true })
    expect(lv.levels![0].height).toBeCloseTo(-2, 1)
  })

  it('deviation.export: every reading, its share within tolerance the map’s own', async () => {
    await slabMap()
    type Stats = { measured: number; withinTolerance: number }
    const stats = (await run<{ deviation: { stats: Stats } }>('deviation.measure')).deviation.stats
    type Out = { readings: number; measured: number; withinTolerance: number; withinTolerancePct: number; file: { name: string; mimeType: string; bytes: Uint8Array } }
    const npy = await run<Out>('deviation.export', { format: 'npy' })
    expect(npy.measured).toBe(stats.measured)
    expect(npy.withinTolerance).toBe(stats.withinTolerance)
    expect(npy.file.name).toMatch(/-deviation-scan\.npy$/)
    // The array as numpy reads it: N × 4 float32, x, y, z, d.
    const b = npy.file.bytes
    expect(Array.from(b.slice(1, 6), (c) => String.fromCharCode(c)).join('')).toBe('NUMPY')
    const headLen = b[8] | (b[9] << 8)
    const header = new TextDecoder().decode(b.slice(10, 10 + headLen))
    expect(header).toContain(`'shape': (${npy.readings}, 4)`)
    expect((10 + headLen) % 64).toBe(0)
    const data = new Float32Array(b.slice(10 + headLen).buffer)
    expect(data.length).toBe(4 * npy.readings)
    const share = (ds: number[]) => {
      const m = ds.filter((d) => Math.abs(d) <= 3)
      return m.filter((d) => Math.abs(d) <= 0.5).length / m.length
    }
    const fromNpy = Array.from({ length: npy.readings }, (_, i) => data[4 * i + 3])
    expect(share(fromNpy)).toBeCloseTo(stats.withinTolerance / stats.measured, 10)
    // A top vertex lies 2 mm inside.
    const topAt = Array.from({ length: npy.readings }, (_, i) => i).find((i) => data[4 * i + 2] > 19.99 && Math.abs(data[4 * i]) < 10 && Math.abs(data[4 * i + 1]) < 10)!
    expect(data[4 * topAt + 3]).toBeCloseTo(-2, 1)

    const csv = await run<Out>('deviation.export', { format: 'csv' })
    const lines = new TextDecoder().decode(csv.file.bytes).trim().split('\n')
    expect(lines[0]).toBe('x,y,z,d')
    expect(lines.length - 1).toBe(csv.readings)
    expect(share(lines.slice(1).map((l) => Number(l.split(',')[3])))).toBeCloseTo(stats.withinTolerance / stats.measured, 10)

    const ply = await run<Out>('deviation.export', {})
    const pb = ply.file.bytes
    const text = new TextDecoder('latin1').decode(pb.slice(0, 1000))
    const end = text.indexOf('end_header\n') + 'end_header\n'.length
    expect(text).toContain(`element vertex ${ply.readings}`)
    expect(text).toContain('property float deviation')
    expect(pb.length - end).toBe(17 * ply.readings)
    const view = new DataView(pb.buffer, pb.byteOffset + end)
    let measured = 0
    let within = 0
    for (let i = 0; i < ply.readings; i++) {
      if (!view.getUint8(17 * i + 16)) continue
      measured++
      if (Math.abs(view.getFloat32(17 * i + 12, true)) <= 0.5) within++
    }
    expect(measured).toBe(stats.measured)
    expect(within).toBe(stats.withinTolerance)
  })

  it('deviation.export { side: "reference" } gives the map on the reference', async () => {
    await slabMap()
    const on = (await run<{ deviation: { onReference: { readings: number } } }>('deviation.settings', { on: 'reference' })).deviation.onReference
    const r = await run<{ readings: number; measured: number; withinTolerancePct: number; file: { name: string } }>('deviation.export', { side: 'reference', format: 'npy' })
    expect(r.readings).toBe(on.readings)
    expect(r.measured).toBeGreaterThan(0.9 * r.readings)
    expect(r.file.name).toMatch(/-deviation-reference\.npy$/)
  })

  it('refuses with no map to export', async () => {
    await open(boxMesh(40, 20), 'box.stl')
    expect((await refused('deviation.export')).code).toBe('invalid_state')
    expect((await refused('deviation.export', { side: 'reference' })).code).toBe('invalid_state')
  })
})
