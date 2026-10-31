// SPDX-License-Identifier: AGPL-3.0-only
// Cells of three, five and six sides split from their centres (PN6): a
// triangle and a pentagon on a noisy sphere come out as three and five
// four-sided patches at the noise, tangent across the spokes within half a
// degree, the centre reported as a corner of three or five patches; a
// centre dragged is taken; and a triangle beside a four-sided cell splits
// the side they share with a T-node, the T-junction held tangent and its gap
// and angle read.

import { describe, expect, it } from 'vitest'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../src/core/types'
import { readNetwork } from '../core/network'
import { network, sphereScan } from './networkMeshes'

const R = 40
const NOISE = 0.02
/** A point on the sphere `deg` from its +x pole, turned `turn` round it. */
const cap = (deg: number, turn: number): Vec3 => {
  const a = (deg * Math.PI) / 180
  const t = (turn * Math.PI) / 180
  return [R * Math.cos(a), R * Math.sin(a) * Math.cos(t), R * Math.sin(a) * Math.sin(t)]
}

/** A point inside a cell on the sphere: its corners' middle, on it. */
const inside = (corners: Vec3[]): Vec3 => {
  const c = corners.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]] as Vec3, [0, 0, 0] as Vec3)
  const l = Math.hypot(...c)
  return [(R * c[0]) / l, (R * c[1]) / l, (R * c[2]) / l]
}

describe('patch network split cells', () => {
  const m = sphereScan(R, NOISE, 6)
  const scan = new ScanPaths(m.positions, m.indices)
  /** A polygon of n corners round the pole, `deg` out, as a network. */
  const polygon = (n: number, deg: number, centre?: Vec3) => {
    const nodes: Record<number, Vec3> = {}
    for (let k = 0; k < n; k++) nodes[k + 1] = cap(deg, (360 * k) / n)
    // Straight sides — great circles. Bowed out much, a pentagon's sides
    // meet at under the corner rule's 30° and it reads as one round side.
    const curves = Array.from({ length: n }, (_, k) => ({ from: k + 1, to: ((k + 1) % n) + 1 }))
    const f = network(1, nodes, curves, [cap(2, 0)])
    if (centre) f.cells[0].centre = centre
    return f
  }

  for (const n of [3, 5]) {
    it(`splits a ${n === 3 ? 'triangle' : 'pentagon'} on a sphere cap into ${n} patches`, () => {
      const r = readNetwork(scan, polygon(n, 35))
      const out = r.outcomes[0]
      expect('patches' in out && out.patches.length).toBe(n)
      if (!('patches' in out)) return
      expect(out.sides).toBe(n)
      const fit = r.fit!
      for (const p of fit.patches) {
        expect(p.rms).toBeGreaterThan(0.5 * NOISE)
        expect(p.rms).toBeLessThan(1.5 * NOISE)
      }
      // The spokes are shared between the quads, and tangent across.
      const spokes = r.split!.spokes.map((s) => s.curve)
      expect(spokes.length).toBe(n)
      const across = fit.shared.filter((s) => spokes.includes(s.curve))
      expect(across.length).toBe(n)
      for (const s of across) {
        expect(s.gap).toBeLessThan(1e-9)
        expect(s.angle).toBeLessThan(0.5)
      }
      // The centre: a corner of n patches, its angle reported.
      expect(fit.corners.length).toBe(1)
      expect(fit.corners[0].patches).toBe(n)
      expect(Number.isFinite(fit.corners[0].angle)).toBe(true)
      // The centre is the cap's middle, near the pole.
      const c = r.split!.centres[0].at
      expect(Math.hypot(c[1], c[2])).toBeLessThan(3)
    })
  }

  it('takes a centre dragged elsewhere', () => {
    const r = readNetwork(scan, polygon(3, 35, cap(8, 90)))
    const out = r.outcomes[0]
    expect('patches' in out && out.patches.length).toBe(3)
    const c = r.split!.centres[0].at
    const want = cap(8, 90)
    expect(Math.hypot(c[0] - want[0], c[1] - want[1], c[2] - want[2])).toBeLessThan(0.2)
  })

  /** A quad and, beside it, a triangle on its right side. */
  const besideTriangle = () => {
    const nodes: Record<number, Vec3> = { 1: cap(30, 150), 2: cap(30, 210), 3: cap(8, 240), 4: cap(8, 120), 5: cap(40, 290) }
    return network(
      1,
      nodes,
      [
        { from: 1, to: 2 },
        { from: 2, to: 3 },
        { from: 3, to: 4 },
        { from: 4, to: 1 },
        { from: 3, to: 5 },
        { from: 5, to: 2 },
      ],
      [cap(18, 180), inside([nodes[3], nodes[5], nodes[2]])],
    )
  }

  it('splits the side a triangle shares with a four-sided cell by a T-node', () => {
    const r = readNetwork(scan, besideTriangle())
    expect(r.outcomes.map((o) => ('patches' in o ? o.patches.length : o.refused))).toEqual([1, 3])
    const tee = r.fit!.shared.filter((s) => s.tee)
    // The quad's side 2→3 is now two curves through the triangle's T-node:
    // each half is a whole side of one of the triangle's quads.
    expect(tee.length).toBe(2)
    // A T-junction's two edges are fitted apart: microns, not nothing — the
    // long side fitted to its two curves as fitted.
    for (const s of tee) expect(s.gap).toBeLessThan(0.005)
    const node = r.traced.nodes.find((n) => n.id >= 1_000_000 && !r.split!.centres.some((c) => c.at === n.at))
    expect(node).toBeDefined()
  })

  it('holds a T-junction tangent', () => {
    // Noisier, on a net of sixteen spans: left free, the quad and the
    // triangle's quads met at 2.1° across the T-junction.
    const noisy = sphereScan(R, 0.05, 6)
    const f = besideTriangle()
    const r = readNetwork(new ScanPaths(noisy.positions, noisy.indices), { ...f, spans: Object.fromEntries(f.curves.map((c) => [String(c.id), 16])) })
    const tee = r.fit!.shared.filter((s) => s.tee)
    expect(tee.length).toBe(2)
    for (const s of tee) expect(s.angle).toBeLessThan(1)
  })
})
