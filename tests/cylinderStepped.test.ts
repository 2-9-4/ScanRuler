// SPDX-License-Identifier: AGPL-3.0-only
// A bore that steps wider below a flange, fitted from a seed on the narrow
// part: the band stops at a square shoulder; down a drafted step it runs on
// into the wide part, the one fit is too noisy to stand, and the region is
// parted along the axis — the narrow part answered, the wide one as
// `second`, whether the wide one is on the same axis or off it. A bore that is noisy all the
// way is not parted, and its refusal says what it saw. A bore a plug closes
// says where its axis runs into the plug; one open through does not. A
// plane grown on the crown of a bead fills a sliver of what it spans; one
// on a round's crown curves, and one on a face with raised lettering
// spreads its normals as wide without curving.

import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { fitCylinderFromSeed } from '../src/core/fit/fitCylinderFromSeed'
import { closedAlong, looksLikeCrown, planeRegionReport } from '../src/core/fit/segment'
import type { MeshGraph } from '../src/core/types'
import { steppedBore } from './guideMeshes'

const SETTINGS = { method: 'gaussian', sigma: 3 } as const
type P3 = [number, number, number]

function seedNear(g: MeshGraph, p: P3): number {
  let best = 0
  let bestD = Infinity
  for (let v = 0; v < g.vertexCount; v++) {
    const d = (g.positions[v * 3] - p[0]) ** 2 + (g.positions[v * 3 + 1] - p[1]) ** 2 + (g.positions[v * 3 + 2] - p[2]) ** 2
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  return best
}

const graphOf = (soup: Float32Array) => buildMeshGraph({ kind: 'soup', positions: soup })

describe('a bore stepping wider', () => {
  it('fits the narrow part from a seed on it, the band stopping at the shoulder', () => {
    const g = graphOf(steppedBore({ r1: 4.5, l1: 9, r2: 4.95, l2: 16, noise: 0.023 }))
    const out = fitCylinderFromSeed(g, [seedNear(g, [4.5, 0, -3])], SETTINGS)
    expect(Math.abs(out.radius - 4.5)).toBeLessThan(0.02)
    expect(Math.abs(out.length - 9)).toBeLessThan(0.75)
    expect(Math.abs(out.axis[2])).toBeGreaterThan(0.999)
  })

  it('parts a region that ran on down a drafted step, and names the wider part', () => {
    // Noisier walls widen the band until it runs down the 1.2 mm draft
    // into the wider part, and the one fit is too noisy to stand.
    const g = graphOf(steppedBore({ r1: 4.5, l1: 9, r2: 4.95, l2: 16, noise: 0.08, taper: 1.2 }))
    const out = fitCylinderFromSeed(g, [seedNear(g, [4.5, 0, -3])], SETTINGS)
    expect(Math.abs(out.radius - 4.5)).toBeLessThan(0.02)
    expect(Math.abs(out.length - 9)).toBeLessThan(0.75)
    expect(out.told?.note).toMatch(/^Grown freely the surface read σ 0\.\d\d over \d+\.\d mm — two surfaces along the axis\. Parted/)
    const second = out.told!.second!
    expect(Math.abs(second.radius - 4.95)).toBeLessThan(0.03)
    // The wider part lies below this one, along the axis from its centre.
    const down = -Math.sign(out.axis[2])
    expect(down * (second.band[0] + second.band[1]) / 2).toBeGreaterThan(4.5)
    expect(second.share).toBeGreaterThan(0.4)
  })

  it('holds when the wider part is off the axis, its wall meeting the narrow one’s down one side', () => {
    const g = graphOf(steppedBore({ r1: 4.5, l1: 9, r2: 4.95, l2: 16, noise: 0.06, offset: 0.3, taper: 1.2 }))
    const out = fitCylinderFromSeed(g, [seedNear(g, [-4.5, 0, -4])], SETTINGS)
    expect(Math.abs(out.radius - 4.5)).toBeLessThan(0.02)
    expect(Math.abs(out.length - 9)).toBeLessThan(1)
    expect(Math.abs(out.told!.second!.radius - 4.95)).toBeLessThan(0.03)
  })

  it('leaves a plain bore as it was', () => {
    const g = graphOf(steppedBore({ r1: 4.5, l1: 12, r2: 4.5, l2: 12, noise: 0.023 }))
    const out = fitCylinderFromSeed(g, [seedNear(g, [4.5, 0, -3])], SETTINGS)
    expect(Math.abs(out.radius - 4.5)).toBeLessThan(0.02)
    expect(out.told).toBeUndefined()
  })

  it('refuses a bore too noisy all along, with the size and σ it saw', () => {
    const g = graphOf(steppedBore({ r1: 4.5, l1: 12, r2: 4.5, l2: 12, noise: 0.17 }))
    expect(() => fitCylinderFromSeed(g, [seedNear(g, [4.5, 0, -6])], SETTINGS)).toThrow(
      /^Couldn't fit a cylinder at this point\. Found R4\.\d\d \(σ 0\.\d\d over \d+\.\d mm along the axis — two surfaces\? give within, or seed nearer one end\)/,
    )
  })

  it('lists the same under a guide, those of the size asked for first', () => {
    const g = graphOf(steppedBore({ r1: 4.5, l1: 12, r2: 4.5, l2: 12, noise: 0.17 }))
    expect(() => fitCylinderFromSeed(g, [seedNear(g, [4.5, 0, -6])], SETTINGS, undefined, { radius: { min: 3.5, max: 5.5 } })).toThrow(/radius R3\.5–R5\.5\)\. Found R4\.\d\d \(σ/)
  })
})

describe('a bore closed at an end', () => {
  it('says where its axis runs into a plug, and where it leaves it', () => {
    const g = graphOf(steppedBore({ r1: 4.2, l1: 9, r2: 4.2, l2: 12, noise: 0.01, plug: 3 }))
    const out = fitCylinderFromSeed(g, [seedNear(g, [4.2, 0, -4])], SETTINGS)
    const closed = closedAlong(g, out.region, out)!
    expect(closed).not.toBeNull()
    expect(closed.at[2]).toBeCloseTo(-9, 1)
    expect(Math.abs(closed.to! - closed.from)).toBeCloseTo(3, 1)
    // As the region report has it.
    expect(planeRegionReport(g, out.region, undefined, out).closed?.from).toBeCloseTo(closed.from, 6)
  })

  it('says nothing of a bore open through, stepped or not', () => {
    for (const r2 of [4.2, 4.6]) {
      const g = graphOf(steppedBore({ r1: 4.2, l1: 9, r2, l2: 12, noise: 0.01 }))
      const out = fitCylinderFromSeed(g, [seedNear(g, [4.2, 0, -4])], SETTINGS)
      expect(closedAlong(g, out.region, out)).toBeNull()
    }
  })

  it('reads a shaft as no bore', () => {
    // The block's outside, a square seen as no cylinder, is not asked; a
    // region whose normals face away from its axis is.
    const g = graphOf(steppedBore({ r1: 4.2, l1: 9, r2: 4.2, l2: 12, noise: 0.01, plug: 3 }))
    const out = fitCylinderFromSeed(g, [seedNear(g, [4.2, 0, -4])], SETTINGS)
    const flipped = { ...g, normals: g.normals.map((x) => -x) }
    expect(closedAlong(flipped, out.region, out)).toBeNull()
  })
})

describe('a plane on the crown of a bead', () => {
  /** A flat plate with a round bead standing on it: a torus's upper half,
   *  its crown at z = h. */
  function beadedPlate(R: number, r: number): Float32Array {
    const tris: number[] = []
    const N = 240
    const M = 40
    const at = (i: number, k: number): P3 => {
      const th = (i / N) * 2 * Math.PI
      const ph = (k / M) * Math.PI
      const rho = R + r * Math.cos(ph)
      return [rho * Math.cos(th), rho * Math.sin(th), r * Math.sin(ph)]
    }
    for (let i = 0; i < N; i++)
      for (let k = 0; k < M; k++) {
        const a = at(i, k), b = at(i + 1, k), c = at(i + 1, k + 1), d = at(i, k + 1)
        tris.push(...a, ...b, ...c, ...a, ...c, ...d)
      }
    return Float32Array.from(tris)
  }

  it('fills a sliver of the rectangle it spans, where a face fills it', () => {
    const g = graphOf(beadedPlate(25, 1))
    // Every vertex within 0.05 of the crown: what a plane grows to there.
    const crown: number[] = []
    for (let v = 0; v < g.vertexCount; v++) if (g.positions[v * 3 + 2] > 0.95) crown.push(v)
    const report = planeRegionReport(g, Uint32Array.from(crown), { normal: [0, 0, 1] })
    expect(report.fill!).toBeLessThan(0.15)
    expect(report.normalSpreadDeg!).toBeGreaterThan(10)

    const flat = graphOf(steppedBore({ r1: 2, l1: 5, r2: 2, l2: 5, side: 40 }))
    const top: number[] = []
    for (let v = 0; v < flat.vertexCount; v++) {
      const [x, y, z] = [flat.positions[v * 3], flat.positions[v * 3 + 1], flat.positions[v * 3 + 2]]
      // The top face, clear of its rounded-over edges.
      if (z > -1e-6 && Math.hypot(x, y) > 2.5 && Math.max(Math.abs(x), Math.abs(y)) < 19) top.push(v)
    }
    const face = planeRegionReport(flat, Uint32Array.from(top), { normal: [0, 0, 1] })
    expect(face.fill!).toBeGreaterThan(0.9)
    expect(face.normalSpreadDeg!).toBeLessThan(1)
  })
})

describe('a plane on a round’s crown, and on a face with lettering', () => {
  /** The same small offset wherever a position repeats, ±noise. */
  const hash = (x: number, y: number) => {
    const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return h - Math.floor(h) - 0.5
  }
  /** A height field over x0…x1 × y0…y1 at `step`, as triangles. */
  function heightField(x0: number, x1: number, y0: number, y1: number, step: number, z: (x: number, y: number) => P3): Float32Array {
    const nx = Math.round((x1 - x0) / step)
    const ny = Math.round((y1 - y0) / step)
    const tris: number[] = []
    const at = (i: number, j: number) => z(x0 + i * step, y0 + j * step)
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1)
        tris.push(...a, ...b, ...c, ...a, ...c, ...d)
      }
    return Float32Array.from(tris)
  }
  const all = (g: MeshGraph) => Uint32Array.from({ length: g.vertexCount }, (_, v) => v)

  it('warns on the crown of an R3 round, its normals spread and the region curved', () => {
    // The top of an R3 round along X, ±25° of it, noise 0.005.
    const R = 3
    const half = R * Math.sin((25 * Math.PI) / 180)
    const g = graphOf(heightField(0, 20, -half, half, 0.1, (x, y) => [x, y, Math.sqrt(R * R - y * y) - R + 0.01 * hash(x, y)]))
    const r = planeRegionReport(g, all(g), { normal: [0, 0, 1] })
    expect(r.fill!).toBeGreaterThan(0.5)
    expect(r.normalSpreadDeg!).toBeGreaterThan(10)
    // The sagitta of the strip: R (1 − cos 25°), 0.28.
    expect(Math.abs(r.curve!.sagitta - R * (1 - Math.cos((25 * Math.PI) / 180)))).toBeLessThan(0.03)
    expect(r.curve!.sagitta).toBeGreaterThan(3 * r.curve!.sigma)
    expect(looksLikeCrown(r)).toBe(true)
  })

  it('does not warn on a flat face with raised lettering, its normals spread as wide', () => {
    // 20 × 20, noise 0.005; strokes 0.5 × 3 mm standing 0.3 mm proud, a
    // tenth of the face, in a label across its middle.
    const strokes: [number, number, number, number][] = []
    for (let row = 0; row < 3; row++)
      for (let k = 0; k < 9; k++) {
        const x = -8 + k * 1.9
        const y = -5 + row * 3.6
        strokes.push(k % 2 ? [x, y + 1.25, x + 3 * 0.5, y + 1.75] : [x, y, x + 0.5, y + 3])
      }
    const proud = (x: number, y: number) => strokes.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d)
    const g = graphOf(heightField(-10, 10, -10, 10, 0.1, (x, y) => [x, y, (proud(x, y) ? 0.3 : 0) + 0.01 * hash(x, y)]))
    const share = Array.from({ length: g.vertexCount }, (_, v) => g.positions[v * 3 + 2] > 0.15).filter(Boolean).length / g.vertexCount
    expect(share).toBeGreaterThan(0.07)
    expect(share).toBeLessThan(0.13)
    const r = planeRegionReport(g, all(g), { normal: [0, 0, 1] })
    // The spread alone would have warned.
    expect(r.normalSpreadDeg!).toBeGreaterThan(10)
    expect(r.fill!).toBeGreaterThan(0.9)
    expect(r.curve!.sagitta).toBeLessThan(3 * r.curve!.sigma)
    expect(looksLikeCrown(r)).toBe(false)
    // A sliver still warns, curved or not.
    expect(looksLikeCrown({ ...r, fill: 0.1 })).toBe(true)
  })
})
