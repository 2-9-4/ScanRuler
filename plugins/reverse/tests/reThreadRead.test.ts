// SPDX-License-Identifier: AGPL-3.0-only
// A thread read off points about an axis (core/threadRead): the pitch from
// the profile's autocorrelation, the crests and the root, the hand from the
// helix, and the standard size nearest.
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { isThread, matchThread, readThread } from '../core/threadRead'

/** Points on a threaded wall about the z axis: the radius a triangle wave
 *  of the helix's phase between `rLow` and `rHigh`, `angles` round by `rows`
 *  along, over `length` mm. A bore's normals face the axis. */
function threadedWall(opts: { rLow: number; rHigh: number; pitch: number; length: number; internal: boolean; leftHanded?: boolean; angles?: number; rows?: number; noise?: number; tilt?: Vec3 }) {
  const angles = opts.angles ?? 90
  const rows = opts.rows ?? 400
  const points: number[] = []
  const normals: number[] = []
  let seed = 7
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  const hand = opts.leftHanded ? -1 : 1
  for (let j = 0; j < rows; j++) {
    const z = -opts.length / 2 + (opts.length * j) / (rows - 1)
    for (let k = 0; k < angles; k++) {
      const th = (k / angles) * 2 * Math.PI
      const phase = (z - (hand * opts.pitch * th) / (2 * Math.PI)) / opts.pitch
      const t = phase - Math.floor(phase)
      const tri = t < 0.5 ? t * 2 : 2 - t * 2
      const r = opts.rLow + (opts.rHigh - opts.rLow) * tri + (opts.noise ?? 0) * rand()
      points.push(r * Math.cos(th), r * Math.sin(th), z)
      const s = opts.internal ? -1 : 1
      normals.push(s * Math.cos(th), s * Math.sin(th), 0)
    }
  }
  return { points: Float32Array.from(points), normals: Float32Array.from(normals) }
}

describe('a thread read off the scan', () => {
  it('reads an M6×1 bore: pitch, crests, root, right hand, and the size', () => {
    const wall = threadedWall({ rLow: 2.459, rHigh: 3, pitch: 1, length: 8, internal: true, noise: 0.02 })
    const r = readThread({ ...wall, origin: [0, 0, 0], dir: [0, 0, 1], radius: 2.75, band: 0.6, halfLength: 5 })!
    expect(r).not.toBeNull()
    expect(r.points).toBe(wall.points.length / 3)
    expect(r.internal).toBe(true)
    expect(r.pitch).toBeCloseTo(1, 1)
    expect(Math.abs(r.pitch! - 1)).toBeLessThan(0.03)
    expect(r.strength).toBeGreaterThan(0.5)
    expect(r.minor).toBeCloseTo(4.92, 0)
    expect(r.major).toBeCloseTo(6, 0)
    expect(r.leftHanded).toBe(false)
    expect(r.handConfidence).toBeGreaterThan(0.3)
    expect(r.profile.length).toBeGreaterThan(50)
    const { candidates, suggested } = matchThread(r, ['metric'])
    expect(suggested?.designation).toBe('M6×1')
    expect(candidates[0].size).toBe('M6')
  })

  it('reads a left-hand 1/4-20 boss, and a plain cylinder reads no pitch', () => {
    const wall = threadedWall({ rLow: 2.5, rHigh: 3.175, pitch: 1.27, length: 12, internal: false, leftHanded: true, noise: 0.01 })
    const r = readThread({ ...wall, origin: [0, 0, 0], dir: [0, 0, 1], radius: 2.9, band: 0.7, halfLength: 6 })!
    expect(r.internal).toBe(false)
    expect(Math.abs(r.pitch! - 1.27)).toBeLessThan(0.04)
    expect(r.leftHanded).toBe(true)
    const { suggested } = matchThread(r, ['metric', 'unc', 'unf'])
    expect(suggested?.standard).toBe('unc')
    expect(suggested?.size).toBe('1/4')
    const plain = threadedWall({ rLow: 3, rHigh: 3, pitch: 1, length: 10, internal: true, noise: 0.01 })
    const p = readThread({ ...plain, origin: [0, 0, 0], dir: [0, 0, 1], radius: 3, band: 0.5, halfLength: 5 })!
    expect(p.pitch).toBeNull()
    expect(matchThread(p, ['metric']).candidates).toEqual([])
  })

  it('a plain bore whose wall ripples within the scan’s noise repeats, but is no thread; a real one stands far clear', () => {
    // Rings 0.2 mm apart, 0.024 mm peak to peak — a print's layer lines,
    // the scanner's stripes — under noise of ±0.08 mm, densely scanned.
    const n = 360 * 400
    const points = new Float32Array(n * 3)
    const normals = new Float32Array(n * 3)
    let seed = 11
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296 - 0.5
    }
    for (let j = 0, i = 0; j < 400; j++) {
      const z = -5 + (10 * j) / 399
      for (let k = 0; k < 360; k++, i++) {
        const th = (k / 360) * 2 * Math.PI
        const r = 3 + 0.012 * Math.sin((2 * Math.PI * z) / 0.2) + 0.16 * rand()
        points.set([r * Math.cos(th), r * Math.sin(th), z], i * 3)
        normals.set([-Math.cos(th), -Math.sin(th), 0], i * 3)
      }
    }
    const plain = readThread({ points, normals, origin: [0, 0, 0], dir: [0, 0, 1], radius: 3, band: 0.5, halfLength: 5 })!
    expect(plain.pitch, 'the ripple repeats, which alone used to read as a thread').not.toBeNull()
    expect(plain.contrast!).toBeLessThan(3 * plain.noise)
    expect(isThread(plain)).toBe(false)
    const m6 = threadedWall({ rLow: 2.459, rHigh: 3, pitch: 1, length: 8, internal: true, noise: 0.08 })
    const real = readThread({ ...m6, origin: [0, 0, 0], dir: [0, 0, 1], radius: 2.75, band: 0.6, halfLength: 5 })!
    expect(real.contrast!).toBeGreaterThan(0.3)
    expect(real.contrast!).toBeGreaterThan(10 * real.noise)
    expect(isThread(real)).toBe(true)
  })

  it('reads a short thread whose length holds a chamfer, a plain half and a floor: the windows on the thread agree', () => {
    // A set screw's M6×1 hole: a 45° chamfer at the mouth (z −0.6 to 0),
    // threaded 3 mm, then plain 2.5 mm to a flat floor — as the mirror
    // holder's: over the whole length the plain half and the rims drown
    // the teeth.
    const points: number[] = []
    const normals: number[] = []
    let seed = 5
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296 - 0.5
    }
    const s45 = Math.SQRT1_2
    for (let z = -0.6; z <= 5.5; z += 0.02) {
      for (let k = 0; k < 90; k++) {
        const th = (k / 90) * 2 * Math.PI
        const [c, s] = [Math.cos(th), Math.sin(th)]
        let r: number
        let n: [number, number, number] = [-c, -s, 0]
        if (z < 0) {
          r = 3 - z
          n = [-c * s45, -s * s45, -s45]
        } else if (z <= 3) {
          const t = ((z - th / (2 * Math.PI)) % 1 + 1) % 1
          r = 2.459 + 0.541 * (t < 0.5 ? t * 2 : 2 - t * 2)
        } else r = 2.459
        r += 0.01 * rand()
        points.push(r * c, r * s, z)
        normals.push(...n)
      }
    }
    // The floor, facing up the hole.
    for (let r = 0.2; r <= 2.459; r += 0.03) {
      for (let k = 0; k < 90; k++) {
        const th = (k / 90) * 2 * Math.PI
        points.push(r * Math.cos(th), r * Math.sin(th), 5.5)
        normals.push(0, 0, -1)
      }
    }
    const read = readThread({ points: Float32Array.from(points), normals: Float32Array.from(normals), origin: [0, 0, 2.45], dir: [0, 0, 1], radius: 2.75, band: 0.6, halfLength: 3.1 })!
    expect(read.offWall, 'the floor faces along the axis').toBeGreaterThan(0)
    expect(read.windows.length).toBeGreaterThan(2)
    expect(read.agree).toBeGreaterThanOrEqual(2)
    expect(Math.abs(read.pitch! - 1)).toBeLessThan(0.05)
    expect(isThread(read)).toBe(true)
    // Where the agreeing windows lie: from the mouth over the thread (to
    // 0.55 along the axis), short of the plain half's end; the windows
    // there read nothing.
    expect(read.threaded![0]).toBeLessThan(-2)
    expect(read.threaded![1]).toBeLessThan(2)
    expect(read.windows.at(-1)!.pitch).toBeNull()
    expect(read.leftHanded).toBe(false)
    expect(matchThread(read, ['metric']).suggested?.designation).toBe('M6×1')
  })

  it('reads along a tilted axis anywhere in space, and refuses too few points', () => {
    const wall = threadedWall({ rLow: 1.2, rHigh: 1.5, pitch: 0.5, length: 6, internal: true, rows: 300, angles: 60 })
    // Turned about x by 30° and moved.
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
    const pts = new Float32Array(wall.points.length)
    const nrm = new Float32Array(wall.normals.length)
    for (let i = 0; i < pts.length; i += 3) {
      const [x, y, z] = [wall.points[i], wall.points[i + 1], wall.points[i + 2]]
      pts[i] = x + 10
      pts[i + 1] = c * y - s * z + 20
      pts[i + 2] = s * y + c * z + 30
      const [nx, ny, nz] = [wall.normals[i], wall.normals[i + 1], wall.normals[i + 2]]
      nrm[i] = nx
      nrm[i + 1] = c * ny - s * nz
      nrm[i + 2] = s * ny + c * nz
    }
    const r = readThread({ points: pts, normals: nrm, origin: [10, 20, 30], dir: [0, -s, c], radius: 1.35, band: 0.4, halfLength: 4 })!
    expect(Math.abs(r.pitch! - 0.5)).toBeLessThan(0.03)
    expect(matchThread(r, ['metric']).suggested?.designation).toBe('M3×0.5')
    expect(readThread({ points: pts.slice(0, 30), normals: nrm.slice(0, 30), origin: [10, 20, 30], dir: [0, -s, c], radius: 1.35, band: 0.4, halfLength: 4 })).toBeNull()
  })
})
