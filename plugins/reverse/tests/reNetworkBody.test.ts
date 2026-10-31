// SPDX-License-Identifier: AGPL-3.0-only
// A patch network made a body (PN9), through the builder and the kernel: a
// 2 × 2 network on a noisy sphere is a sheet of four faces, tangent across
// its curves within half a degree and with its shared edges a micron apart
// as the kernel's faces lie, and it reads back from STEP as itself; a
// network that closes round the sphere — a cube's twelve edges on it, six
// four-sided cells — sews into one valid solid of the sphere's volume, and
// its preview, which makes no faces, closes round the same volume and reads
// the same patches; the sheet thickens in and out, and both ways is
// refused (the kernel hangs).

import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import type { Vec3 } from '../../../src/core/types'
import type { Feature, ThickenSide } from '../core/features'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import { resolveFeatures } from '../core/resolve'
import { build, ctx } from './reKit'
import { gridNetwork, network, sphereScan } from './networkMeshes'

const kernelPromise = ReKernel.load()
const R = 40
const NOISE = 0.02

const onSphere = (u: number, v: number): Vec3 => {
  const a = (u - 0.5) * 1.4
  const b = (v - 0.5) * 1.4
  const l = Math.hypot(1, a, b)
  return [R / l, (R * a) / l, (R * b) / l]
}

async function builderOnSphere() {
  const k = await kernelPromise
  const m = sphereScan(R, NOISE, 6)
  const b = new Builder(k)
  b.setScan(new NominalSurface(m.positions, m.indices), m.positions)
  return { k, b }
}

describe('patch network body', () => {
  it('makes a 2 × 2 network on a sphere a sheet that reads back from STEP', async () => {
    const { b } = await builderOnSphere()
    const f = gridNetwork(1, 2, 2, onSphere, 1)
    const out = await build(b, [f])
    const r = out.results.find((x) => x.id === 1)!
    expect(r.status).toBe('ok')
    const report = r.network!
    expect(report.patches.length).toBe(4)
    expect(report.closed).toBe(false)
    expect(report.worstAngle).toBeLessThan(0.5)
    // The grid route: the kernel's faces within a few microns of each other
    // along every shared curve.
    expect(report.worstGap).toBeLessThan(0.005)
    for (const p of report.patches) expect(p.rms).toBeLessThan(1.4 * NOISE)
    const body = out.bodies.find((x) => x.id === 1)!
    expect(body.surface).toBe(true)
    expect(body.faces).toBe(4)
    const text = b.exportStep([1])
    const check = b.verifyStep([1], text)
    expect(check.problems).toEqual([])
    expect(check.ok).toBe(true)
    expect(check.bodies[0].sheet).toBe(true)
  })

  it('sews a network closed round a sphere into one valid solid', async () => {
    const { k, b } = await builderOnSphere()
    // A cube's corners on the sphere, its twelve edges the curves, a seed
    // in each face.
    const s = R / Math.sqrt(3)
    const corner = (i: number): Vec3 => [i & 1 ? s : -s, i & 2 ? s : -s, i & 4 ? s : -s]
    const nodes: Record<number, Vec3> = {}
    for (let i = 0; i < 8; i++) nodes[i + 1] = corner(i)
    const curves: { from: number; to: number }[] = []
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) curves.push({ from: i + 1, to: (i | bit) + 1 })
    const seeds: Vec3[] = [[R, 0, 0], [-R, 0, 0], [0, R, 0], [0, -R, 0], [0, 0, R], [0, 0, -R]]
    const f = network(2, nodes, curves, seeds)
    const out = await build(b, [f])
    const r = out.results.find((x) => x.id === 2)!
    expect(r.status).toBe('ok')
    const report = r.network!
    expect(report.patches.length).toBe(6)
    expect(report.closed).toBe(true)
    // Every corner is one where three patches meet, reported.
    expect(report.corners.length).toBe(8)
    const body = out.bodies.find((x) => x.id === 2)!
    expect(body.closed).toBe(true)
    expect(body.faces).toBe(6)
    expect(body.volume / ((4 / 3) * Math.PI * R ** 3)).toBeCloseTo(1, 2)
    // The ghost: the patches meshed as fitted, without the kernel's faces —
    // closed round the same volume, the same patches read.
    const step = resolveFeatures([f], ctx, () => []).at(-1)!
    if (step.kind !== 'network') throw new Error(`not a network: ${step.kind}`)
    const ghost = b.preview(step, undefined)
    expect(ghost.closed).toBe(true)
    expect(ghost.network!.closed).toBe(true)
    expect(ghost.volume / body.volume).toBeCloseTo(1, 3)
    expect(ghost.network!.patches.map((p) => p.rms)).toEqual(report.patches.map((p) => p.rms))
    expect(ghost.mesh.indices.length).toBeGreaterThan(6 * 2 * 3)
    expect(ghost.network!.worstGap).toBeLessThan(report.worstGap + 1e-9)
    void k
  })

  it('thickens the sheet in and out, and refuses both ways rather than hang the kernel', async () => {
    const { b } = await builderOnSphere()
    const f = gridNetwork(1, 2, 2, onSphere, 1)
    const thicken = (side: ThickenSide): Feature => ({ id: 2, kind: 'thicken', name: 'Shell', sheet: 1, thickness: 1, side, op: 'new', visible: true })
    const volumes: number[] = []
    for (const side of ['in', 'out'] as const) {
      const out = await build(b, [f, thicken(side)])
      expect(out.results.find((x) => x.id === 2)!.status).toBe('ok')
      const solid = out.bodies.find((x) => x.id === 2)!
      expect(solid.closed).toBe(true)
      volumes.push(solid.volume)
    }
    // A shell of the sphere a millimetre thick, inside it or outside: their
    // volumes as (R³ − (R − 1)³) to ((R + 1)³ − R³).
    expect(volumes[0] / volumes[1]).toBeCloseTo((R ** 3 - (R - 1) ** 3) / ((R + 1) ** 3 - R ** 3), 2)
    const both = await build(b, [f, thicken('both')])
    const r = both.results.find((x) => x.id === 2)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/one way at a time/)
  })
})
