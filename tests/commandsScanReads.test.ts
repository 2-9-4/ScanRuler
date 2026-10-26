// SPDX-License-Identifier: AGPL-3.0-only
// Reading regions, holes and outlines off the scan without sending vertex
// lists back and forth: scan.query answering counts or numbers alone and
// marking what it found, element.fit_marked fitted to a box; a plate's
// open hole read off its rim as a circle and made an element; a rounded
// plate's outline read as its corners and rounds. In the in-process worker
// (commandKit.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { boxMesh } from './helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from './commandKit'

type Vec3 = [number, number, number]
type Vec2 = [number, number]

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

const open = (soup: Float32Array, name: string) => run('scan.open', { bytes: stlBytes(soup), name, discard: true })

/** A plate 1 mm thick over the ring r0…r1 about the z axis, its outer wall
 *  closed and its bore left open, as a scan that did not see into a small
 *  hole: two rims round the bore, at z = 0 and z = 1. The bore's vertices
 *  wander off the circle by up to `jitter`, as a scanned edge does. */
function holedPlate(r0: number, r1: number, jitter = 0): Float32Array {
  const N = 64
  const rings = [r0, r0 + 1, r0 + 3, (r0 + r1) / 2, r1]
  const at = (i: number, j: number, z: number): Vec3 => {
    const a = (2 * Math.PI * (j % N)) / N
    const r = rings[i] + (i === 0 ? jitter * Math.sin(7 * a + z) : 0)
    return [r * Math.cos(a), r * Math.sin(a), z]
  }
  const tris: number[] = []
  const tri = (a: Vec3, b: Vec3, c: Vec3) => tris.push(...a, ...b, ...c)
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < N; j++) {
      // Top wound up, bottom down.
      tri(at(i, j, 1), at(i + 1, j, 1), at(i + 1, j + 1, 1))
      tri(at(i, j, 1), at(i + 1, j + 1, 1), at(i, j + 1, 1))
      tri(at(i, j, 0), at(i + 1, j + 1, 0), at(i + 1, j, 0))
      tri(at(i, j, 0), at(i, j + 1, 0), at(i + 1, j + 1, 0))
    }
  }
  const last = rings.length - 1
  for (let j = 0; j < N; j++) {
    tri(at(last, j, 0), at(last, j + 1, 0), at(last, j + 1, 1))
    tri(at(last, j, 0), at(last, j + 1, 1), at(last, j, 1))
  }
  return Float32Array.from(tris)
}

/** A plate `t` thick whose plan is the rectangle 2a × 2b with its corners
 *  rounded to r, closed: a fan over the top and the bottom, and the wall. */
function roundedPlate(a: number, b: number, r: number, t: number): Float32Array {
  const outline: Vec2[] = []
  const corners: [number, number, number][] = [[a - r, b - r, 0], [-(a - r), b - r, 90], [-(a - r), -(b - r), 180], [a - r, -(b - r), 270]]
  for (const [cx, cy, from] of corners) {
    for (let k = 0; k <= 16; k++) {
      const ang = ((from + (90 * k) / 16) * Math.PI) / 180
      outline.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)])
    }
  }
  const tris: number[] = []
  const n = outline.length
  for (let i = 0; i < n; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % n]
    tris.push(0, 0, t, p[0], p[1], t, q[0], q[1], t)
    tris.push(0, 0, 0, q[0], q[1], 0, p[0], p[1], 0)
    tris.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], t)
    tris.push(p[0], p[1], 0, q[0], q[1], t, p[0], p[1], t)
  }
  return Float32Array.from(tris)
}

describe('scan.query without the vertex list', () => {
  it('answers the count alone, or the numbers, and marks what it found for a fit', async () => {
    await open(boxMesh(40, 40), 'box.stl')
    const box = { min: [-30, -30, 19.9], max: [30, 30, 20.1] }
    const count = await run<Record<string, unknown>>('scan.query', { box, normal: { dir: [0, 0, 1] }, fields: 'count', mark: true })
    expect(count.matched).toBe(39 * 39)
    expect(count.vertices).toBeUndefined()
    expect(count.points).toBeUndefined()
    // Every vertex that matched is marked, not the limit's thinned list.
    expect(count.step).toBe(2)
    expect(count.marked).toEqual({ points: 39 * 39, from: 'scan.query box facing a way' })
    const ids = await run<Record<string, unknown>>('scan.query', { box, normal: { dir: [0, 0, 1] }, fields: 'ids' })
    expect((ids.vertices as number[]).length).toBe(ids.returned)
    expect(ids.points).toBeUndefined()
    // The marked points fitted, with no list in between.
    const plane = await run<{ element: { fit: { center: Vec3; normal: Vec3 }; source: { markedPoints?: number } } }>('element.fit_marked', { kind: 'plane', marked: true })
    expect(plane.element.fit.center[2]).toBeCloseTo(20, 4)
    expect(plane.element.source.markedPoints).toBe(39 * 39)
  })

  it('marks every vertex that matched, answering the count alone unless told otherwise', async () => {
    await open(boxMesh(40, 40), 'box.stl')
    const box = { min: [-30, -30, 19.9], max: [30, 30, 20.1] }
    const marked = await run<Record<string, unknown>>('scan.query', { box, normal: { dir: [0, 0, 1] }, limit: 100, mark: true })
    expect(marked.matched).toBe(39 * 39)
    expect(marked.returned).toBeLessThanOrEqual(100)
    expect(marked.vertices).toBeUndefined()
    expect(marked.points).toBeUndefined()
    expect(marked.marked).toEqual({ points: 39 * 39, from: 'scan.query box facing a way' })
    expect(JSON.stringify(marked).length).toBeLessThan(1000)
    // A ball, counted and marked whole.
    const ball = await run<Record<string, unknown>>('scan.query', { near: { at: [0, 0, 20], radius: 10 }, normal: { dir: [0, 0, 1] }, limit: 50, mark: true })
    const whole = await run<Record<string, unknown>>('scan.query', { near: { at: [0, 0, 20], radius: 10 }, normal: { dir: [0, 0, 1] }, limit: 20000, fields: 'ids' })
    expect(ball.matched).toBe(whole.matched)
    expect((ball.marked as { points: number }).points).toBe((whole.vertices as number[]).length)
    // Asked for, the list still comes back with the mark.
    const listed = await run<Record<string, unknown>>('scan.query', { box, normal: { dir: [0, 0, 1] }, mark: true, fields: 'all' })
    expect((listed.points as unknown[]).length).toBe(listed.returned)
  })

  it('fits element.fit_marked to the scan inside a box, facing a way', async () => {
    await open(boxMesh(40, 40), 'box.stl')
    const side = await run<{ element: { fit: { center: Vec3; normal: Vec3 } }; points: number }>('element.fit_marked', { kind: 'plane', box: { min: [19.9, -30, -30], max: [20.1, 30, 30] }, normal: { dir: [1, 0, 0] } })
    expect(side.element.fit.center[0]).toBeCloseTo(20, 4)
    expect(Math.abs(side.element.fit.normal[0])).toBeCloseTo(1, 5)
    expect(side.points).toBe(39 * 39)
    expect((await refused('element.fit_marked', { kind: 'plane', box: { min: [50, 50, 50], max: [60, 60, 60] } })).code).toBe('invalid_input')
    expect((await refused('element.fit_marked', { kind: 'plane', vertices: [1, 2, 3], box: { min: [0, 0, 0], max: [1, 1, 1] } })).code).toBe('invalid_input')
    expect((await refused('element.fit_marked', { kind: 'plane', marked: true, normal: { dir: [0, 0, 1] } })).code).toBe('invalid_input')
  })
})

interface Rim { rim: number; length: number; at: Vec3; circle?: { center: Vec3; axis: Vec3; radius: number; rms: number } }

describe('holes from the scan’s rims', () => {
  it('reads an open Ø5 hole off its rim, and makes the circle an element', async () => {
    await open(holedPlate(2.5, 15, 0.02), 'holed.stl')
    const qa = await run<{ rims: { count: number; largest: Rim[] } }>('scan.qa', { axis: 'z' })
    expect(qa.rims.count).toBe(2)
    for (const r of qa.rims.largest) {
      expect(r.circle, JSON.stringify(r)).toBeDefined()
      expect(Math.abs(r.circle!.radius - 2.5)).toBeLessThan(0.05)
      expect(Math.hypot(r.circle!.center[0], r.circle!.center[1])).toBeLessThan(0.05)
      expect(Math.abs(r.circle!.axis[2])).toBeCloseTo(1, 4)
    }
    expect(qa.rims.largest.map((r) => r.rim)).toEqual([0, 1])
    const made = await run<{ element: { kind: string; fit: { center: Vec3; radius: number } }; rim: { index: number; points: number } }>('element.fit', { kind: 'circle', rim: 1 })
    expect(made.element.kind).toBe('circle')
    expect(Math.abs(made.element.fit.radius - 2.5)).toBeLessThan(0.05)
    expect(made.rim).toMatchObject({ index: 1, points: 64 })
    expect((await refused('element.fit', { kind: 'circle', rim: 9 })).code).toBe('not_found')
    expect((await refused('element.fit', { kind: 'plane', rim: 0 })).code).toBe('invalid_input')
    expect((await refused('element.fit', { kind: 'circle', rim: 0, at: { vertex: 0 } })).code).toBe('invalid_input')
  })

  it('says no circle for a rim that is not round', async () => {
    const soup = boxMesh(40, 8)
    const kept: number[] = []
    for (let i = 0; i < soup.length; i += 9) {
      if (soup[i + 2] > 19.9 && soup[i + 5] > 19.9 && soup[i + 8] > 19.9) continue
      for (let k = 0; k < 9; k++) kept.push(soup[i + k])
    }
    await open(Float32Array.from(kept), 'open.stl')
    const qa = await run<{ rims: { count: number; largest: Rim[] } }>('scan.qa', { axis: 'z' })
    expect(qa.rims.count).toBe(1)
    expect(qa.rims.largest[0].circle).toBeUndefined()
  })
})

interface Outline {
  axis?: string
  across: string[]
  cell: number
  loops: { hole: boolean; area: number; points?: Vec2[]; rounds?: { at: number; radius: number; center: Vec2 }[]; circle?: { center: Vec2; radius: number }; worst: number }[]
}

describe('scan.outline', () => {
  it('reads a rounded plate’s plan as four corners, each with its round', async () => {
    await open(roundedPlate(20, 10, 5, 2), 'rounded.stl')
    const o = await run<Outline>('scan.outline', { tolerance: 0.1 })
    expect(o.axis).toBe('-z')
    expect(o.across).toEqual(['x', 'y'])
    expect(o.loops).toHaveLength(1)
    const [loop] = o.loops
    expect(loop.points).toHaveLength(4)
    for (const p of loop.points!) {
      expect(Math.abs(Math.abs(p[0]) - 20)).toBeLessThan(0.05)
      expect(Math.abs(Math.abs(p[1]) - 10)).toBeLessThan(0.05)
    }
    expect(loop.rounds).toHaveLength(4)
    for (const r of loop.rounds!) expect(Math.abs(r.radius - 5)).toBeLessThan(0.1)
    expect(loop.worst).toBeLessThan(0.1)
    // Seen from the side, the plate is a 40 × 2 rectangle with sharp corners.
    const side = await run<Outline>('scan.outline', { axis: '+y', tolerance: 0.1 })
    expect(side.loops[0].points).toHaveLength(4)
    expect(side.loops[0].rounds).toBeUndefined()
  })

  it('gives a hole as a loop of its own, and a round loop as one circle', async () => {
    await open(holedPlate(2.5, 15), 'holed.stl')
    const o = await run<Outline>('scan.outline', { tolerance: 0.1 })
    expect(o.loops.map((l) => l.hole)).toEqual([false, true])
    expect(o.loops[0].circle!.radius).toBeCloseTo(15, 1)
    expect(Math.abs(o.loops[1].circle!.radius - 2.5)).toBeLessThan(0.1)
    expect((await refused('scan.outline', { axis: '-z', plane: 'XY' })).code).toBe('invalid_input')
  })
})
