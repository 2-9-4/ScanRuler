// SPDX-License-Identifier: AGPL-3.0-only
// A patch network's joint fit (PN8): a 2 × 2 network on a noisy sphere
// comes out tangent across every curve, within half a degree, and at the
// scan's noise; the patches share the curves between them exactly; a
// crease keeps its fold; a network read again keeps what did not change,
// with the same answer as a read afresh; a strip round 270° of a cylinder
// fits as one patch at the noise, where Fit Surface — a height field —
// refuses the same points: the regression test for the fold-back the
// network is for; a 3 × 3 network drawn askew lets go of the ties at its
// inner corners, which fought each other round them and folded the patches
// over themselves there, 2.8 mm off the scan — where one drawn square keeps
// them all; a higher smoothness smooths the patches, curves and all; and
// Auto gives a strip four spans, and more only where a patch on it misses
// its points by more than the tolerance beyond their noise, while that
// helps — six round a 270° strip, four up it.

import { describe, expect, it } from 'vitest'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import type { NetworkFeature } from '../core/features'
import { readNetwork } from '../core/network'
import { DEFAULT_TOLERANCE } from '../core/networkCurve'
import { DEFAULT_SURFACE_FIT, fitSurfaceReported } from '../core/surfaceFit'
import { gridNetwork, gridScan, network, sphereScan } from './networkMeshes'

const R = 40
const NOISE = 0.02
/** A spot on the sphere by (u, v) over a square of it a cube's face wide. */
const onSphere = (u: number, v: number): Vec3 => {
  const a = (u - 0.5) * 1.4
  const b = (v - 0.5) * 1.4
  const l = Math.hypot(1, a, b)
  return [R / l, (R * a) / l, (R * b) / l]
}

describe('patch network fit', () => {
  it('fits a 2 × 2 network on a noisy sphere tangent and at the noise', () => {
    const m = sphereScan(R, NOISE, 6)
    const scan = new ScanPaths(m.positions, m.indices)
    const f = gridNetwork(1, 2, 2, onSphere, 1)
    const r = readNetwork(scan, f)
    expect(r.outcomes.every((o) => 'patch' in o)).toBe(true)
    const fit = r.fit!
    expect(fit.patches.length).toBe(4)
    for (const p of fit.patches) {
      expect(p.rms).toBeGreaterThan(0.6 * NOISE)
      expect(p.rms).toBeLessThan(1.4 * NOISE)
    }
    // The four inner curves are shared, and the patches meet on them
    // exactly, tangent.
    expect(fit.shared.length).toBe(4)
    for (const s of fit.shared) {
      expect(s.gap).toBeLessThan(1e-9)
      expect(s.angle).toBeLessThan(0.5)
    }
    // Read again, as the preview does at an edit: the traces and the maps
    // kept, the answer the same to the bit. A node moved changes the
    // patches round it, and the read still matches one made afresh.
    const again = readNetwork(scan, f)
    expect(again.ms.map).toBeLessThan(r.ms.map / 4 + 1)
    expect(again.fit!.patches.map((p) => [...p.net.poles])).toEqual(fit.patches.map((p) => [...p.net.poles]))
    const moved = { ...f, nodes: f.nodes.map((n, i) => (i === 4 ? { ...n, at: onSphere(0.55, 0.45) } : n)) }
    const kept = readNetwork(scan, moved)
    const fresh = readNetwork(new ScanPaths(m.positions, m.indices), moved)
    expect(kept.fit!.patches.map((p) => [...p.net.poles])).toEqual(fresh.fit!.patches.map((p) => [...p.net.poles]))
    expect(kept.fit!.patches.map((p) => [...p.net.poles])).not.toEqual(fit.patches.map((p) => [...p.net.poles]))
  })

  it('keeps a crease folded', () => {
    // Two flat faces meeting at 30° along x = 0, a 1 × 2 network across
    // the fold with the middle curve on it marked a crease.
    const fold = (u: number, v: number): Vec3 => {
      const x = 80 * u - 40
      return [x, 60 * v, Math.abs(x) * Math.tan((15 * Math.PI) / 180)]
    }
    const scan = new ScanPaths(...Object.values(gridScan(160, 120, fold, { noise: NOISE })) as [Float32Array, Uint32Array])
    const f = gridNetwork(2, 1, 2, fold, 1, [0.1, 0.9, 0.1, 0.9])
    const middle = f.curves.find((c) => {
      const a = f.nodes.find((n) => n.id === c.from)!.at
      const b = f.nodes.find((n) => n.id === c.to)!.at
      return Math.abs(a[0]) < 1e-6 && Math.abs(b[0]) < 1e-6
    })!
    middle.crease = true
    const fit = readNetwork(scan, f).fit!
    const shared = fit.shared.find((s) => s.curve === middle.id)!
    expect(shared.crease).toBe(true)
    expect(shared.angle).toBeGreaterThan(28)
    expect(shared.angle).toBeLessThan(32)
    for (const p of fit.patches) expect(p.rms).toBeLessThan(1.5 * NOISE)
    // Unmarked, the same curve is held tangent and the fit cannot follow
    // the fold.
    middle.crease = false
    const smooth = readNetwork(scan, f).fit!
    expect(smooth.shared.find((s) => s.curve === middle.id)!.angle).toBeLessThan(0.5)
    expect(Math.max(...smooth.patches.map((p) => p.max))).toBeGreaterThan(5 * NOISE)
  })

  it('fits a strip round 270° of a cylinder as one patch', () => {
    const r = 20
    const m = gridScan(180, 40, (u, v) => [r * Math.cos(2 * Math.PI * u), r * Math.sin(2 * Math.PI * u), 40 * v], { wrap: true, noise: NOISE })
    const scan = new ScanPaths(m.positions, m.indices)
    const on = (deg: number, z: number): Vec3 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z]
    const f = network(3, { 1: on(0, 5), 2: on(270, 5), 3: on(270, 35), 4: on(0, 35) }, [
      { from: 1, to: 2, via: [on(90, 5), on(180, 5)] },
      { from: 2, to: 3 },
      { from: 3, to: 4, via: [on(180, 35), on(90, 35)] },
      { from: 4, to: 1 },
    ], [on(135, 20)])
    const reading = readNetwork(scan, f)
    const fit = reading.fit!
    expect(fit.patches.length).toBe(1)
    const p = fit.patches[0]
    expect(p.rms).toBeLessThan(1.25 * NOISE)
    // Fit Surface, given the same points, refuses them: no height field
    // holds a region that bends round 270°.
    const cell = reading.cells.cells[0]
    if (cell.status !== 'ok') throw new Error(cell.message)
    const vertices = new Set<number>()
    for (const t of cell.triangles) for (let k = 0; k < 3; k++) vertices.add(m.indices[t * 3 + k])
    const region = Float32Array.from([...vertices].flatMap((v) => [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]))
    expect(() => fitSurfaceReported(region, DEFAULT_SURFACE_FIT)).toThrow(/bends round past what one height field holds/)
    // On the cylinder all the way round.
    const q: Vec3 = [0, 0, 0]
    let off = 0
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        patchAt(p.net, i / 20, j / 20, q)
        off = Math.max(off, Math.abs(Math.hypot(q[0], q[1]) - r))
      }
    }
    expect(off).toBeLessThan(0.05)
  })
})

describe('a 3 × 3 network on a finely scanned sheet', () => {
  const size = 18
  const sheet = (u: number, v: number): Vec3 => [size * u, size * v, 1.2 * Math.sin(2.2 * u) * Math.cos(1.7 * v) + 0.6 * u * v]
  const m = gridScan(90, 90, sheet, { noise: 0.004, seed: 7 })
  const scan = new ScanPaths(m.positions, m.indices)
  /** A 3 × 3 network on the sheet, its inner nodes pushed `skew` of the
   *  sheet's side off the square grid, alternately. */
  function grid(skew: number) {
    const nodes: Record<number, Vec3> = {}
    const id = (i: number, j: number) => j * 4 + i + 1
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const u = 0.1 + (0.8 * i) / 3 + (i > 0 && i < 3 ? skew * (j % 2 ? 1 : -1) : 0)
        const v = 0.1 + (0.8 * j) / 3 + (j > 0 && j < 3 ? skew * (i % 2 ? -1 : 1) : 0)
        nodes[id(i, j)] = sheet(u, v)
      }
    }
    const curves: { from: number; to: number }[] = []
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) curves.push({ from: id(i, j), to: id(i + 1, j) })
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) curves.push({ from: id(i, j), to: id(i, j + 1) })
    const seeds: Vec3[] = []
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const c = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)].map((k) => nodes[k])
        seeds.push([0, 1, 2].map((k) => c.reduce((s, p) => s + p[k], 0) / 4) as Vec3)
      }
    }
    return network(1, nodes, curves, seeds)
  }
  /** How many samples of the patches face against the patch's own way. */
  function folds(fit: NonNullable<ReturnType<typeof readNetwork>['fit']>): number {
    let n = 0
    const q: Vec3 = [0, 0, 0]
    for (const p of fit.patches) {
      const mean = [0, 0, 0]
      for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10; b++) {
        patchNormal(p.net, a / 10, b / 10, q)
        for (let k = 0; k < 3; k++) mean[k] += q[k]
      }
      for (let a = 0; a <= 60; a++) for (let b = 0; b <= 60; b++) {
        patchNormal(p.net, a / 60, b / 60, q)
        if (q[0] * mean[0] + q[1] * mean[1] + q[2] * mean[2] < 0) n++
      }
    }
    return n
  }

  it('lets go of the ties at the inner corners of a network drawn askew, which they folded', () => {
    const fit = readNetwork(scan, grid(0.06)).fit!
    expect(folds(fit)).toBe(0)
    for (const p of fit.patches) {
      expect(p.rms).toBeLessThan(0.006)
      expect(p.max).toBeLessThan(0.05)
    }
    // The four inner corners let go, reported with their angles; the
    // curves tangent away from them.
    expect(fit.corners.map((c) => c.node).sort((a, b) => a - b)).toEqual([6, 7, 10, 11])
    for (const c of fit.corners) expect(c.angle).toBeLessThan(2)
    for (const s of fit.shared) expect(s.angle).toBeLessThan(0.5)
  })

  it('keeps the ties at the corners of one drawn square', () => {
    const fit = readNetwork(scan, grid(0)).fit!
    expect(folds(fit)).toBe(0)
    expect(fit.corners).toEqual([])
    for (const s of fit.shared) expect(s.angle).toBeLessThan(0.1)
  })

  it('smooths the curves with the patches, so a higher smoothness smooths over the noise', () => {
    /** How much the normals wander from their neighbours' mean over the
     *  patches, RMS, deg — the scan's noise left in them. */
    const ripple = (fit: NonNullable<ReturnType<typeof readNetwork>['fit']>) => {
      const S = 48
      let sum = 0
      let count = 0
      for (const p of fit.patches) {
        const n = Array.from({ length: S + 1 }, (_, i) => Array.from({ length: S + 1 }, (_, j) => patchNormal(p.net, i / S, j / S, [0, 0, 0])))
        for (let i = 1; i < S; i++) {
          for (let j = 1; j < S; j++) {
            const m = [0, 1, 2].map((k) => n[i - 1][j][k] + n[i + 1][j][k] + n[i][j - 1][k] + n[i][j + 1][k])
            const cos = (m[0] * n[i][j][0] + m[1] * n[i][j][1] + m[2] * n[i][j][2]) / Math.hypot(m[0], m[1], m[2])
            sum += Math.acos(Math.min(1, cos)) ** 2
            count++
          }
        }
      }
      return (Math.sqrt(sum / count) * 180) / Math.PI
    }
    // Ten spans a strip, as many as the scan resolves: on a net that fine
    // the noise has the most room.
    const f = grid(0)
    const at = (smoothness: number) => readNetwork(scan, { ...f, spans: Object.fromEntries(f.curves.map((c) => [String(c.id), 10])), fit: { smoothness } }).fit!
    const usual = at(0.001)
    const smooth = at(0.1)
    // Held to curves that followed their traces' noise whatever the
    // smoothness, the patches kept it: 0.054° at 0.001 and 0.057° at 0.1
    // here — now 0.007° and 0.002°.
    expect(ripple(smooth)).toBeLessThan(ripple(usual) / 2)
    expect(ripple(usual)).toBeLessThan(0.02)
    for (const p of smooth.patches) expect(p.rms).toBeLessThan(0.01)
    for (const s of smooth.shared) expect(s.angle).toBeLessThan(0.1)
  })
})

describe('Auto’s span counts', () => {
  const r = 20
  const m = gridScan(180, 40, (u, v) => [r * Math.cos(2 * Math.PI * u), r * Math.sin(2 * Math.PI * u), 40 * v], { wrap: true, noise: NOISE })
  const scan = new ScanPaths(m.positions, m.indices)
  const on = (deg: number, z: number): Vec3 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z]
  /** One patch round 270° of the cylinder, 30 mm tall: its strip round the
   *  bend (curves 1 and 3), its strip up it (2 and 4). */
  const strip = network(3, { 1: on(0, 5), 2: on(270, 5), 3: on(270, 35), 4: on(0, 35) }, [
    { from: 1, to: 2, via: [on(90, 5), on(180, 5)] },
    { from: 2, to: 3 },
    { from: 3, to: 4, via: [on(180, 35), on(90, 35)] },
    { from: 4, to: 1 },
  ], [on(135, 20)])
  const fitOf = (change: Partial<NetworkFeature>) => readNetwork(scan, { ...strip, ...change }).fit!
  const spansOf = (fit: ReturnType<typeof fitOf>) => {
    const round = fit.strips.find((s) => s.curves.includes(1))!
    const up = fit.strips.find((s) => s.curves.includes(2))!
    return [round.spans, up.spans]
  }

  it('starts at four spans and adds them only round the bend, where they bring the patch to the scan', () => {
    // Held at four, the patch cannot follow the bend: its misfit — what it
    // misses the points by beyond their noise — is most of its RMS.
    const four = fitOf({ spans: { 1: 4, 2: 4 } })
    expect(four.patches[0].misfit).toBeGreaterThan(0.03)
    expect(four.patches[0].rms).toBeGreaterThan(2 * NOISE)
    // Auto: six round, four up it, within the tolerance and at the noise.
    const auto = fitOf({})
    expect(spansOf(auto)).toEqual([6, 4])
    expect(auto.strips.every((s) => s.auto)).toBe(true)
    expect(auto.patches[0].misfit).toBeLessThan(DEFAULT_TOLERANCE)
    expect(auto.patches[0].rms).toBeLessThan(1.1 * NOISE)
  })

  it('goes finer for a finer tolerance, no finer than the noise', () => {
    // A tolerance of 2 µm: nine round, where what is left is the noise —
    // read as no misfit — not the twenty a misfit read off the noise itself
    // chased it to.
    const fine = fitOf({ fit: { smoothness: 0.001, tolerance: 0.002 } })
    expect(spansOf(fine)).toEqual([9, 4])
    expect(fine.patches[0].misfit).toBe(0)
  })

  it('reads a sheet’s noise as no misfit, and keeps it at four spans', () => {
    const sheet = gridScan(100, 100, (u, v) => [30 * u, 30 * v, 0], { noise: NOISE })
    const flat = new ScanPaths(sheet.positions, sheet.indices)
    const square = network(4, { 1: [3, 3, 0], 2: [27, 3, 0], 3: [27, 27, 0], 4: [3, 27, 0] }, [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 1 }], [[15, 15, 0]])
    for (const n of [4, 12]) expect(readNetwork(flat, { ...square, spans: { 1: n, 2: n } }).fit!.patches[0].misfit).toBe(0)
    const auto = readNetwork(flat, square).fit!
    expect(auto.patches[0].net).toMatchObject({ nu: 4, nv: 4 })
  })
})

import { patchNormal, patchPoint } from '../core/networkSpline'
function patchAt(net: Parameters<typeof patchPoint>[0], u: number, v: number, out: Vec3) {
  patchPoint(net, u, v, out)
}
