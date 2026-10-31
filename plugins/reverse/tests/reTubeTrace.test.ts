// SPDX-License-Identifier: AGPL-3.0-only
// A bent tube's centreline read from the scan: a synthetic tube of straights
// and arcs in two planes, read back to its corners and radius; the stops a
// flange and a bellows make, said and not crossed. With RE_TUBE_SCAN set to a
// mesh (and RE_TUBE_RUNS to "x,y,z,dx,dy,dz;…", where to start), a real one.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseOBJ } from '../../../src/core/parsers/obj'
import { sliceMesh } from '../../../src/core/section/slice'
import type { Vec3 } from '../../../src/core/types'
import { addScaled, cross, normalize, sub } from '../../../src/core/vec'
import { routePieces, type SweepRoute } from '../core/sweepRoute'
import { routeMiss, traceTube, type TubeCutter } from '../core/tubeTrace'

vi.setConfig({ testTimeout: 600_000 })

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** A closed tube mesh about a centreline given as frames, its rim at each
 *  frame a loop `size(s)` round — a welded skin, its ends capped, wound with
 *  its normals out. */
function tubeMesh(line: { at: Vec3; dir: Vec3 }[], radiusAt: (i: number, angle: number) => number, around = 72): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  let u = normalize(cross(line[0].dir, Math.abs(line[0].dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))!
  line.forEach((f, i) => {
    // Carried along with the least turn, as a sweep's section is.
    u = normalize(addScaled(u, f.dir, -(u[0] * f.dir[0] + u[1] * f.dir[1] + u[2] * f.dir[2])))!
    const v = cross(f.dir, u)
    for (let k = 0; k < around; k++) {
      const a = (2 * Math.PI * k) / around
      const r = radiusAt(i, a)
      positions.push(...addScaled(addScaled(f.at, u, r * Math.cos(a)), v, r * Math.sin(a)))
    }
  })
  for (let i = 0; i + 1 < line.length; i++) {
    for (let k = 0; k < around; k++) {
      const [a, b] = [i * around + k, i * around + ((k + 1) % around)]
      const [c, d] = [a + around, b + around]
      indices.push(a, b, d, a, d, c)
    }
  }
  // The ends: a fan to a middle point each.
  const startMid = positions.length / 3
  positions.push(...line[0].at)
  const endMid = positions.length / 3
  positions.push(...line[line.length - 1].at)
  const lastRing = (line.length - 1) * around
  for (let k = 0; k < around; k++) {
    indices.push(startMid, (k + 1) % around, k)
    indices.push(endMid, lastRing + k, lastRing + ((k + 1) % around))
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/** Frames along a route's pieces, about every `each` mm. */
function framesAlong(route: SweepRoute, each = 0.5): { at: Vec3; dir: Vec3 }[] {
  const made = routePieces(route, route.points[0])
  if (typeof made === 'string') throw new Error(made)
  const out: { at: Vec3; dir: Vec3 }[] = []
  for (const p of made.pieces) {
    if (p.kind === 'line') {
      const n = Math.max(1, Math.ceil(dist(p.a, p.b) / each))
      const dir = normalize(sub(p.b, p.a))!
      for (let i = 0; i < n; i++) out.push({ at: addScaled(p.a, sub(p.b, p.a), i / n), dir })
    } else if (p.kind === 'arc') {
      // The centre from the three points: a and b equally far from m.
      const chord = sub(p.b, p.a)
      const mid: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2]
      const toM = sub(p.m, mid)
      const sag = Math.hypot(...toM)
      const half = Math.hypot(...chord) / 2
      const r = (sag * sag + half * half) / (2 * sag)
      const c = addScaled(p.m, normalize(toM)!, -r)
      const e1 = normalize(sub(p.a, c))!
      const axis = normalize(cross(sub(p.a, c), sub(p.b, c)))!
      const e2 = cross(axis, e1)
      const sweep = 2 * Math.asin(Math.min(1, half / r))
      const n = Math.max(2, Math.ceil((sweep * r) / each))
      for (let i = 0; i < n; i++) {
        const t = (sweep * i) / n
        out.push({ at: addScaled(addScaled(c, e1, r * Math.cos(t)), e2, r * Math.sin(t)), dir: addScaled([0, 0, 0], addScaled(addScaled([0, 0, 0], e1, -Math.sin(t)), e2, Math.cos(t)), 1) })
      }
    }
  }
  const last = made.pieces[made.pieces.length - 1] as { a: Vec3; b: Vec3 }
  out.push({ at: last.b, dir: normalize(sub(last.b, last.a))! })
  return out
}

const cutterOf =
  (m: { positions: Float32Array; indices: Uint32Array }): TubeCutter =>
  (origin, normal) =>
    sliceMesh(m.positions, m.indices, origin, normal, { minLength: 0.5 })

/** A tube: 60 straight, bend in XZ, 50 straight, bend in another plane, 60 on. */
const ROUTE: SweepRoute = {
  points: [
    [0, 0, 0],
    [0, 0, 60],
    [50, 0, 60],
    [50, 40, 90],
  ],
  bendRadius: 20,
}

describe('a tube traced', () => {
  it('reads a synthetic tube back: corners and radius, in two bend planes', async () => {
    const line = framesAlong(ROUTE)
    const mesh = tubeMesh(line, () => 8)
    const t = await traceTube(cutterOf(mesh), { start: [0, 0, 1], dir: [0, 0, 1] })
    expect(t.stops[0].kind, t.stops[0].says).toMatch(/lost|size/)
    expect(t.route).not.toBeNull()
    expect(t.route!.points).toHaveLength(4)
    for (const [got, want] of [[t.route!.points[1], ROUTE.points[1]], [t.route!.points[2], ROUTE.points[2]]] as [Vec3, Vec3][]) expect(dist(got, want)).toBeLessThan(0.1)
    expect(t.route!.radii![0]!).toBeCloseTo(20, 0)
    expect(Math.abs(t.route!.radii![0]! - 20)).toBeLessThan(0.15)
    expect(Math.abs(t.route!.radii![1]! - 20)).toBeLessThan(0.15)
    expect(t.residual!.max).toBeLessThan(0.05)
    expect(t.stations[0].major).toBeCloseTo(16, 0)
    expect(t.runs.map((r) => r.kind)).toEqual(['straight', 'bend', 'straight', 'bend', 'straight'])
    const bend = t.runs[1] as Extract<(typeof t.runs)[number], { kind: 'bend' }>
    expect(bend.turnDeg).toBeCloseTo(90, 0)
    expect(Math.abs(bend.normal[1])).toBeCloseTo(1, 2)
    expect(t.warnings).toEqual([])
    // What it answers builds: the same chain, ready for a sweep.
    expect(typeof routePieces(t.route!, t.route!.points[0])).not.toBe('string')
  })

  it('reads a short straight between two bends, and bends of different radii', async () => {
    const route: SweepRoute = {
      points: [
        [0, 0, 0],
        [0, 0, 50],
        [40, 0, 50],
        [40, 45, 50],
      ],
      bendRadius: 15,
      radii: [15, 22],
    }
    const mesh = tubeMesh(framesAlong(route), () => 6)
    const t = await traceTube(cutterOf(mesh), { start: [0, 0, 0.5], dir: [0, 0, 1] })
    expect(t.route!.points).toHaveLength(4)
    expect(Math.abs(t.route!.radii![0]! - 15)).toBeLessThan(0.3)
    expect(Math.abs(t.route!.radii![1]! - 22)).toBeLessThan(0.3)
    expect(dist(t.route!.points[1], route.points[1])).toBeLessThan(0.15)
    expect(dist(t.route!.points[2], route.points[2])).toBeLessThan(0.15)
  })

  it('reads an oval the same, with its two diameters and which way', async () => {
    const mesh = tubeMesh(framesAlong(ROUTE), (_, a) => {
      // An ellipse of semi-axes 9 and 7 by its polar radius.
      const [c, s] = [Math.cos(a) / 9, Math.sin(a) / 7]
      return 1 / Math.hypot(c, s)
    }, 96)
    const t = await traceTube(cutterOf(mesh), { start: [0, 0, 1], dir: [0, 0, 1] })
    expect(t.stations[1].major).toBeCloseTo(18, 0)
    expect(t.stations[1].minor).toBeCloseTo(14, 0)
    expect(dist(t.route!.points[1], ROUTE.points[1])).toBeLessThan(0.1)
    expect(Math.abs(t.route!.radii![0]! - 20)).toBeLessThan(0.2)
  })

  it('follows it both ways from a straight, the stations in one run, a stop at each end', async () => {
    const mesh = tubeMesh(framesAlong(ROUTE), () => 8)
    const t = await traceTube(cutterOf(mesh), { start: [20, 0, 60], dir: [1, 0, 0], both: true })
    expect(t.stops).toHaveLength(2)
    expect(t.stops.map((x) => x.kind).join(' ')).toMatch(/^(lost|size) (lost|size)$/)
    expect(t.stations[0].at[2]).toBeLessThan(3)
    expect(t.stations[t.stations.length - 1].at[1]).toBeGreaterThan(38)
    expect(t.route!.points).toHaveLength(4)
    expect(dist(t.route!.points[1], ROUTE.points[1])).toBeLessThan(0.1)
    expect(dist(t.route!.points[2], ROUTE.points[2])).toBeLessThan(0.1)
    // Started off centre and off the tube's way, it finds both.
    const rough = await traceTube(cutterOf(mesh), { start: [20, 2, 62], dir: [1, 0.2, 0.2], both: true })
    expect(dist(rough.route!.points[1], ROUTE.points[1])).toBeLessThan(0.1)
    expect(dist(rough.route!.points[2], ROUTE.points[2])).toBeLessThan(0.1)
    // A route another way round measures the same centres the same.
    expect(routeMiss(t.stations.map((x) => x.at), ROUTE).max).toBeLessThan(0.05)
  })

  it('stops at a bellows and a flange, saying where and why, and does not cross them', async () => {
    // Straight 60, then folds: the radius 8 to 12 and back, pitch 4.
    const straight = framesAlong({ points: [[0, 0, 0], [0, 0, 120]], bendRadius: 1 }, 0.25)
    const folded = (i: number) => {
      const z = straight[i].at[2]
      return z < 60 || z > 90 ? 8 : 8 + 4 * Math.abs(Math.sin((Math.PI * (z - 60)) / 4))
    }
    const t = await traceTube(cutterOf(tubeMesh(straight, folded)), { start: [0, 0, 2], dir: [0, 0, 1] })
    expect(t.stops[0].kind).toBe('size')
    expect(t.stops[0].says).toMatch(/size jumps/)
    expect(t.stops[0].at[2]).toBeGreaterThan(58)
    expect(t.stops[0].at[2]).toBeLessThan(66)
    expect(t.stations[t.stations.length - 1].at[2]).toBeLessThan(62)
    // A flange: a step out, at once.
    const flange = (i: number) => (straight[i].at[2] < 80 ? 8 : 20)
    const f = await traceTube(cutterOf(tubeMesh(straight, flange)), { start: [0, 0, 2], dir: [0, 0, 1] })
    expect(f.stops[0].kind).toBe('size')
    expect(f.stops[0].at[2]).toBeGreaterThan(76)
    // A small step is gone through, and said.
    const cuff = (i: number) => (straight[i].at[2] < 60 ? 8 : 8.5)
    const c = await traceTube(cutterOf(tubeMesh(straight, cuff)), { start: [0, 0, 2], dir: [0, 0, 1], maxLengthMm: 100 })
    expect(c.stops[0].kind).toBe('length')
    expect(c.stops[0].says).toMatch(/maxLengthMm/)
    expect(c.warnings.join(' ')).toMatch(/size goes 16 → 16.8/)
  })

  it('says it when start is not in a tube, or the wall is open', async () => {
    const straight = framesAlong({ points: [[0, 0, 0], [0, 0, 80]], bendRadius: 1 })
    const mesh = tubeMesh(straight, () => 8)
    const out = await traceTube(cutterOf(mesh), { start: [30, 0, 40], dir: [0, 0, 1] })
    expect(out.route).toBeNull()
    expect(out.stops[0].kind).toBe('lost')
    expect(out.stops[0].says).toMatch(/start has to lie inside the tube/)
    // A hole in the wall from 40 on: the triangles of one side left out.
    const holed = { positions: mesh.positions, indices: mesh.indices.filter((_, i, all) => {
      const t = i - (i % 3)
      const z = (mesh.positions[all[t] * 3 + 2] + mesh.positions[all[t + 1] * 3 + 2] + mesh.positions[all[t + 2] * 3 + 2]) / 3
      const x = (mesh.positions[all[t] * 3] + mesh.positions[all[t + 1] * 3] + mesh.positions[all[t + 2] * 3]) / 3
      return !(z > 40 && z < 60 && x > 4)
    }) }
    const open = await traceTube(cutterOf(holed), { start: [0, 0, 2], dir: [0, 0, 1] })
    expect(open.stops[0].kind).toBe('open')
    expect(open.stops[0].at[2]).toBeGreaterThan(38)
    expect(open.stops[0].at[2]).toBeLessThan(44)
  })
})

const scan = process.env.RE_TUBE_SCAN
const starts = (process.env.RE_TUBE_RUNS ?? '').split(';').filter(Boolean)
describe.skipIf(!scan || !existsSync(scan) || starts.length === 0)('a real tube', () => {
  it('reads what it reads', async () => {
    const buf = readFileSync(scan!)
    const started = performance.now()
    const parsed = parseOBJ(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    const mesh = { positions: parsed.positions as Float32Array, indices: parsed.indices as Uint32Array }
    console.log(`read ${mesh.positions.length / 3} vertices in ${((performance.now() - started) / 1000).toFixed(1)} s`)
    for (const text of starts) {
      const [x, y, z, dx, dy, dz] = text.split(',').map(Number)
      const began = performance.now()
      const t = await traceTube(cutterOf(mesh), { start: [x, y, z], dir: [dx, dy, dz], both: true })
      console.log(`TRACE from ${text}: ${((performance.now() - began) / 1000).toFixed(1)} s, ${t.cuts} cuts, ${t.stations.length} stations\n stops ${t.stops.map((x) => `${x.kind}: ${x.says}`).join(' | ')}\n route ${JSON.stringify(t.route)}\n residual ${JSON.stringify(t.residual)}\n runs ${JSON.stringify(t.runs)}\n warnings ${JSON.stringify(t.warnings)}`)
      for (const other of JSON.parse(process.env.RE_TUBE_AGAINST ?? '[]') as SweepRoute[]) console.log('AGAINST', JSON.stringify(other.points[1]), other.bendRadius, JSON.stringify(routeMiss(t.stations.map((s) => s.at), other)))
      if (t.route) console.log('OWN', JSON.stringify(routeMiss(t.stations.map((s) => s.at), t.route)))
      console.log(t.stations.filter((_, i) => i % 3 === 0).map((s) => `${s.s.toFixed(1)}: ${s.at.map((v) => v.toFixed(2)).join(',')} ${s.major.toFixed(2)}x${s.minor.toFixed(2)} eq${s.size.toFixed(2)}`).join('\n'))
    }
  })
})
