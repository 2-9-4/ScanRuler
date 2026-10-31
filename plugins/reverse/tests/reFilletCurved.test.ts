// SPDX-License-Identifier: AGPL-3.0-only
// Rounds and chamfers read across curved edges (core/curvedEdge.ts), on
// synthetic scans swept from a profile round an outline, with noise: a
// boss's foot rounded R1 on a plate (a concave circle edge), a hole
// countersunk 90° × Ø12, a plate whose outline's corner arcs carry an R1
// top round, a spherical bowl's rim rounded R1.5 — each read back within a
// few per cent through reverse.body.fillet_read's own reader.
import { describe, expect, it } from 'vitest'
import { sliceMesh } from '../../../src/core/section/slice'
import type { Vec3 } from '../../../src/core/types'
// The plugin first: its modules import one another in that order.
import '../plugin'
import { readEdgeRound, type ReadEdge } from '../app/reFilletRead'
import { arc, circleOutline, line, type Outline, type P2, type Prof, roundedRect, sweep } from './sweptScan'

const sectionOf = (mesh: { positions: Float32Array; indices: Uint32Array }) => async (origin: Vec3, normal: Vec3) => sliceMesh(mesh.positions, mesh.indices, origin, normal)

const Z: Vec3 = [0, 0, 1]
/** A full circle edge about the Z axis at height z — its seam at −X, its
 *  middle at +X, as the kernel reads one. */
function circleEdge(R: number, z: number, other: { kind: string; radius?: number; center?: Vec3; dir?: Vec3 }, centre: P2 = [0, 0]): ReadEdge {
  const seam: Vec3 = [centre[0] - R, centre[1], z]
  return {
    fingerprint: { kind: 'circle', mid: [centre[0] + R, centre[1], z], dir: Z, length: 2 * Math.PI * R, radius: R, faces: [{ kind: 'plane', dir: Z }, { kind: other.kind as 'cylinder', dir: other.dir ?? Z }], origin: 1 },
    ends: [seam, seam],
    surfaces: [{ kind: 'plane', dir: Z }, { kind: other.kind as 'cylinder', dir: other.dir ?? Z, ...(other.radius ? { radius: other.radius } : {}), ...(other.center ? { center: other.center } : {}) }],
  }
}

const STEP = 0.05

describe('rounds across circle edges', () => {
  it('reads the R1 round at a boss’s foot — a concave circle edge between the plate and the cylinder', async () => {
    const r = 1
    const profile = [...line([12, 0], [r, 0], [0, 1], STEP), ...arc([r, r], r, -Math.PI / 2, -Math.PI, true, STEP / 2), ...line([0, r], [0, 6], [1, 0], STEP), ...line([0, 6], [-4.5, 6], [0, 1], STEP)]
    const scan = sweep(circleOutline(5), profile, 0.01)
    const edge = circleEdge(5, 0, { kind: 'cylinder', radius: 5, center: [0, 0, 3] })
    const read = await readEdgeRound(sectionOf(scan), edge, { reach: 3 })
    expect(read.why).toBeUndefined()
    expect(read.radii).toHaveLength(3)
    expect(Math.abs(read.round!.radius - 1)).toBeLessThan(0.04)
    expect(read.round!.nominal).toBe(1)
    expect(read.round!.sigma).toBeGreaterThan(0)
    expect(read.round!.sigma).toBeLessThan(0.05)
    // Not a chamfer.
    expect((await readEdgeRound(sectionOf(scan), edge, { reach: 3, shape: 'chamfer' })).round).toBeNull()
  })

  it('reads a 90° × Ø12 countersink on a Ø6 hole’s mouth, and no round there', async () => {
    const profile = [...line([12, 0], [3, 0], [0, 1], STEP), ...line([3, 0], [0, -3], [-Math.SQRT1_2, Math.SQRT1_2], STEP), ...line([0, -3], [0, -8], [-1, 0], STEP), ...line([0, -8], [12, -8], [0, -1], STEP)]
    const scan = sweep(circleOutline(3), profile, 0.01)
    const edge = circleEdge(3, 0, { kind: 'cylinder', radius: 3, center: [0, 0, -4] })
    const read = await readEdgeRound(sectionOf(scan), edge, { reach: 5, shape: 'chamfer' })
    expect(read.why).toBeUndefined()
    const c = read.round!
    expect(Math.abs(c.radius - 3)).toBeLessThan(0.1)
    expect(c.setbacks![0]).toBeCloseTo(3, 1)
    expect(c.setbacks![1]).toBeCloseTo(3, 1)
    expect(Math.abs(c.countersink!.angleDeg - 90)).toBeLessThan(2)
    expect(Math.abs(c.countersink!.diameter - 12)).toBeLessThan(0.2)
    expect(Math.abs(c.countersink!.depth - 3)).toBeLessThan(0.1)
    expect(c.countersink!.sigma.angleDeg).toBeGreaterThan(0)
    expect(c.countersink!.sigma.angleDeg).toBeLessThan(1)
    expect((await readEdgeRound(sectionOf(scan), edge, { reach: 5 })).round).toBeNull()
  })

  it('reads an 82° countersink as 82°, its setbacks apart', async () => {
    const half = (41 * Math.PI) / 180
    const depth = 2
    const out = 3 + depth * Math.tan(half)
    const n: P2 = [-Math.cos(half), Math.sin(half)]
    const profile = [...line([12, 0], [out - 3, 0], [0, 1], STEP), ...line([out - 3, 0], [0, -depth], n, STEP), ...line([0, -depth], [0, -8], [-1, 0], STEP), ...line([0, -8], [12, -8], [0, -1], STEP)]
    const scan = sweep(circleOutline(3), profile, 0.01)
    const read = await readEdgeRound(sectionOf(scan), circleEdge(3, 0, { kind: 'cylinder', radius: 3, center: [0, 0, -4] }), { reach: 5, shape: 'chamfer' })
    const c = read.round!
    expect(Math.abs(c.countersink!.angleDeg - 82)).toBeLessThan(2)
    expect(Math.abs(c.countersink!.diameter - 2 * out)).toBeLessThan(0.2)
    expect(Math.abs(c.countersink!.depth - depth)).toBeLessThan(0.1)
  })

  it('reads R1 top rounds on a plate outline’s corner arcs', async () => {
    const r = 1
    const profile = [...line([-10, 0], [-r, 0], [0, 1], STEP), ...arc([-r, -r], r, Math.PI / 2, 0, false, STEP / 2), ...line([0, -r], [0, -5], [1, 0], STEP)]
    const scan = sweep(roundedRect(20, 15, 5, 0.1), profile, 0.01)
    // The arc at the (+X, +Y) corner: centre (15, 10), from (20, 10) to (15, 15).
    const mid: Vec3 = [15 + 5 * Math.SQRT1_2, 10 + 5 * Math.SQRT1_2, 0]
    const edge: ReadEdge = {
      fingerprint: { kind: 'circle', mid, dir: Z, length: (Math.PI / 2) * 5, radius: 5, faces: [{ kind: 'cylinder', dir: Z }, { kind: 'plane', dir: Z }], origin: 1 },
      ends: [[20, 10, 0], [15, 15, 0]],
      surfaces: [{ kind: 'cylinder', dir: Z, radius: 5, center: [15, 10, -2.5] }, { kind: 'plane', dir: Z }],
    }
    const read = await readEdgeRound(sectionOf(scan), edge, { reach: 3 })
    expect(read.why).toBeUndefined()
    expect(Math.abs(read.round!.radius - 1)).toBeLessThan(0.04)
    expect(read.radii.every((x) => x !== null && Math.abs(x - 1) < 0.06)).toBe(true)
  })

  it('reads the R1.5 round on a spherical bowl’s rim — a circle edge between the rim and the sphere', async () => {
    // The sphere R30 about (0, 0, 20) meets the rim z = 0 at Rc = √500.
    const Rs = 30
    const h = 20
    const Rc = Math.sqrt(Rs * Rs - h * h)
    const r = 1.5
    // In (w, z) about the rim circle the sphere's centre is (−Rc, h); the
    // round's centre r under the rim and r outside the sphere.
    const S: P2 = [-Rc, h]
    const c: P2 = [-Rc + Math.sqrt((Rs + r) ** 2 - (h + r) ** 2), -r]
    const u: P2 = [(c[0] - S[0]) / (Rs + r), (c[1] - S[1]) / (Rs + r)]
    // The sphere from the round's tangent point down towards the bottom,
    // its outward normal into the bowl.
    const sphere: Prof[] = []
    for (let a = Math.atan2(u[1], u[0]); a > -Math.PI / 2 + 0.05; a -= STEP / Rs) {
      const p: P2 = [S[0] + Rs * Math.cos(a), S[1] + Rs * Math.sin(a)]
      if (p[0] < -Rc + 1) break
      sphere.push({ p, n: [-Math.cos(a), -Math.sin(a)] })
    }
    const profile = [...line([8, 0], [c[0], 0], [0, 1], STEP), ...arc(c, r, Math.PI / 2, Math.atan2(-u[1], -u[0]), false, STEP / 2), ...sphere]
    const scan = sweep(circleOutline(Rc, 720), profile, 0.01)
    const edge = circleEdge(Rc, 0, { kind: 'sphere', radius: Rs, dir: [0, 0, 1] })
    const read = await readEdgeRound(sectionOf(scan), edge, { reach: 4 })
    expect(read.why).toBeUndefined()
    expect(Math.abs(read.round!.radius - r)).toBeLessThan(0.06)
  })

  it('reads the boss’s foot through three times the noise', async () => {
    const r = 1
    const profile = [...line([12, 0], [r, 0], [0, 1], STEP), ...arc([r, r], r, -Math.PI / 2, -Math.PI, true, STEP / 2), ...line([0, r], [0, 6], [1, 0], STEP)]
    const read = await readEdgeRound(sectionOf(sweep(circleOutline(5), profile, 0.03, 11)), circleEdge(5, 0, { kind: 'cylinder', radius: 5, center: [0, 0, 3] }), { reach: 3 })
    expect(Math.abs(read.round!.radius - 1)).toBeLessThan(0.05)
    expect(read.round!.sigmas).toBeLessThan(3)
  })

  it('reads an R1 round on a straight edge between a flat face and a cylinder', async () => {
    // Along Y: the top z = 0 meets a cylinder R5 about (x 0, z −3) at
    // x = 4, rounded R1 — the round's centre 1 under the top and 4 from
    // the axis.
    const R = 5
    const Q: P2 = [0, -3]
    const r = 1
    const c: P2 = [Math.sqrt((R - r) ** 2 - (Q[1] + r) ** 2), -r]
    const a2 = Math.atan2(c[1] - Q[1], c[0] - Q[0])
    const profile = [...line([-6, 0], [c[0], 0], [0, 1], STEP), ...arc(c, r, Math.PI / 2, a2, false, STEP / 2), ...arc(Q, R, a2, -Math.PI / 2, false, STEP)]
    const outline: Outline = Array.from({ length: 201 }, (_, i) => ({ p: [0, -20 + 0.2 * i] as P2, n: [1, 0] as P2 }))
    const scan = sweep(outline, profile, 0.01, 5, false)
    const edge: ReadEdge = {
      fingerprint: { kind: 'line', mid: [4, 0, 0], dir: [0, 1, 0], length: 40, faces: [{ kind: 'plane', dir: Z }, { kind: 'cylinder', dir: [0, 1, 0] }], origin: 1 },
      ends: [[4, -20, 0], [4, 20, 0]],
      surfaces: [{ kind: 'plane', dir: Z }, { kind: 'cylinder', dir: [0, 1, 0], radius: R, center: [0, 0, -3] }],
    }
    const read = await readEdgeRound(sectionOf(scan), edge, { reach: 3 })
    expect(read.why).toBeUndefined()
    expect(Math.abs(read.round!.radius - 1)).toBeLessThan(0.04)
  })

  it('says why an edge is not read', async () => {
    const scan = sweep(circleOutline(5), line([12, 0], [0, 0], [0, 1], STEP), 0.01)
    const noEnds: ReadEdge = { fingerprint: circleEdge(5, 0, { kind: 'cylinder' }).fingerprint }
    expect((await readEdgeRound(sectionOf(scan), noEnds, { reach: 3 })).why).toMatch(/pick it on the body/)
    expect((await readEdgeRound(sectionOf(scan), circleEdge(5, 0, { kind: 'torus' }), { reach: 3 })).why).toMatch(/torus/)
    expect((await readEdgeRound(sectionOf(scan), circleEdge(5, 0, { kind: 'cylinder', dir: [1, 0, 0] }), { reach: 3 })).why).toMatch(/another axis/)
  })
})
