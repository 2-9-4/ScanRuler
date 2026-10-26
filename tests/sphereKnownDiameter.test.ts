// SPDX-License-Identifier: AGPL-3.0-only
// A sphere fitted with its known diameter held: on a ball scanned only as a
// cap, a surface reading a little off towards the rim drags the free fit's
// centre along the cap's axis several times as far, and holding the diameter
// keeps it where it belongs.
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { FitError } from '../src/core/fit/errors'
import { fitSphereFromSeed, fitSphereOnSelection } from '../src/core/fit/fitSphereFromSeed'
import { fitSphereClipped } from '../src/core/fit/sphere'
import type { FitSettings, MeshGraph } from '../src/core/types'
import { allIndices, icosphere } from './helpers'

const R = 12.7

/** A cap of half-angle `capDeg` round +Z on a ball of radius R centred at
 *  the origin, on a regular grid, reading `rimMm` outside the ball at its
 *  rim and rising to it quadratically from the pole — a scanner that loses
 *  accuracy as the surface turns away from it. */
function cap(capDeg: number, rimMm: number): Float32Array {
  const rings = 60
  const round = 120
  const out = new Float32Array(rings * round * 3)
  let w = 0
  for (let i = 1; i <= rings; i++) {
    const t = i / rings
    const a = ((capDeg * Math.PI) / 180) * t
    const r = R + rimMm * t * t
    for (let j = 0; j < round; j++) {
      const ph = (2 * Math.PI * j) / round
      out[w++] = r * Math.sin(a) * Math.cos(ph)
      out[w++] = r * Math.sin(a) * Math.sin(ph)
      out[w++] = r * Math.cos(a)
    }
  }
  return out
}

describe('sphere fit with a known diameter', () => {
  it('keeps the centre of a 30° cap where the free fit lets it run', () => {
    const pts = cap(30, 0.01)
    const idx = allIndices(pts.length / 3)
    const free = fitSphereClipped(pts, idx, 0)!
    const held = fitSphereClipped(pts, idx, 0, R)!
    // The free fit trades the rim's 10 µm for a ball 0.15 mm too large,
    // its centre 75 µm back along the axis.
    expect(Math.abs(free.sphere.cz)).toBeGreaterThan(0.05)
    expect(held.sphere.r).toBe(R)
    expect(Math.hypot(held.sphere.cx, held.sphere.cy, held.sphere.cz)).toBeLessThan(0.005)
    // And it says what the points give free: the same fit as above.
    expect(held.free!.r).toBeCloseTo(free.sphere.r, 6)
    expect(free.free).toBeUndefined()
  })

  it('changes nothing on a whole ball scanned true', () => {
    const g = buildMeshGraph({ kind: 'indexed', ...icosphere(4, 5) })
    const free = fitSphereClipped(g.positions, allIndices(g.vertexCount), 3)!
    const held = fitSphereClipped(g.positions, allIndices(g.vertexCount), 3, free.sphere.r)!
    expect(Math.hypot(held.sphere.cx - free.sphere.cx, held.sphere.cy - free.sphere.cy, held.sphere.cz - free.sphere.cz)).toBeLessThan(1e-6)
  })

  const SETTINGS: FitSettings = { method: 'gaussian', sigma: 3 }
  const ball = (): MeshGraph => buildMeshGraph({ kind: 'indexed', ...icosphere(4, 5) })

  it('holds it from a click and from a marked surface, and reports the free diameter and the shift', () => {
    const g = ball()
    const top: number[] = []
    for (let v = 0; v < g.vertexCount; v++) if (g.positions[v * 3 + 2] > 2) top.push(v)
    const marked = fitSphereOnSelection(g, Uint32Array.from(top), { ...SETTINGS, knownDiameter: 10.02 })
    expect(marked.radius).toBe(5.01)
    expect(marked.held!.freeDiameter).toBeGreaterThan(9.9)
    expect(marked.held!.freeDiameter).toBeLessThan(10.01)
    expect(marked.held!.shift).toBeGreaterThan(0)
    // The bigger ball held on the same cap sits further back from it.
    expect(marked.center[2]).toBeLessThan(0)

    const clicked = fitSphereFromSeed(g, [top[0]], { ...SETTINGS, knownDiameter: 10 })
    expect(clicked.radius).toBe(5)
    expect(clicked.held).toBeDefined()
    expect(fitSphereFromSeed(g, [top[0]], SETTINGS).held).toBeUndefined()
  })

  it('refuses a diameter the surface plainly is not', () => {
    const g = ball()
    const all = allIndices(g.vertexCount)
    expect(() => fitSphereOnSelection(g, all, { ...SETTINGS, knownDiameter: 14 })).toThrow(FitError)
    expect(() => fitSphereOnSelection(g, all, { ...SETTINGS, knownDiameter: 14 })).toThrow(/known Ø 14\.000/)
    expect(() => fitSphereFromSeed(g, [0], { ...SETTINGS, knownDiameter: 14 })).toThrow(/known Ø 14\.000/)
    // Within a millimetre it is held, however far the scan reads off.
    expect(fitSphereOnSelection(g, all, { ...SETTINGS, knownDiameter: 10.8 }).radius).toBe(5.4)
  })
})
