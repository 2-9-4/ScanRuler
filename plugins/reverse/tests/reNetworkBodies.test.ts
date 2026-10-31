// SPDX-License-Identifier: AGPL-3.0-only
// A patch network against a body (PN11): a half-cylinder modelled, the scan
// of it running on past its straight edge as a wall that leans 6° off the
// cylinder's tangent there, and one patch on the wall whose top curve runs
// along the body's edge. Held tangent to the cylinder's face, the patch
// leaves the edge within half a degree of the face and bends to the wall
// below; held only on the edge (contact), it takes the wall's 6°. The
// curve along the edge is the edge: its fit stands off it by microns.

import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import type { ExtrudeFeature, NetworkFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { addEntity } from '../core/sketch'
import { findRegions } from '../core/regions'
import { build, sketchOf } from './reKit'
import { gridScan } from './networkMeshes'

const kernelPromise = ReKernel.load()
const R = 15
const LEAN = Math.tan((6 * Math.PI) / 180)

/** The scan: the cylinder x² + y² = R² from 70° down to its edge at
 *  (R, 0), then the wall leaning out below it to y = −25, z from 0 to 40;
 *  u along that profile, v up z. */
function scan() {
  const arc = (R * 70 * Math.PI) / 180
  const wall = 25 * Math.hypot(1, LEAN)
  const at = (u: number, v: number): Vec3 => {
    const s = u * (arc + wall)
    const z = 40 * v
    if (s <= wall) {
      const d = (wall - s) / Math.hypot(1, LEAN)
      return [R + LEAN * d, -d, z]
    }
    const a = (s - wall) / R
    return [R * Math.cos(a), R * Math.sin(a), z]
  }
  return gridScan(120, 80, at, { noise: 0.01 })
}

describe('patch network against a body', () => {
  for (const mode of ['tangent', 'contact'] as const) {
    it(`holds a patch ${mode === 'tangent' ? 'tangent to' : 'on the edge of'} a cylinder body`, async () => {
      const k = await kernelPromise
      const m = scan()
      const b = new Builder(k)
      b.setScan(new NominalSurface(m.positions, m.indices), m.positions)
      // The half-cylinder: a half-disc on XY, y ≥ 0, extruded up 40.
      const sketch = sketchOf(1, (s) => {
        addEntity(s, { kind: 'arc', c: [0, 0], r: R, start: 0, sweep: Math.PI })
        addEntity(s, { kind: 'line', a: [-R, 0], b: [R, 0] })
      })
      const extrude: ExtrudeFeature = { id: 2, kind: 'extrude', name: 'Body', sketchId: 1, regions: findRegions(sketch.sketch).map((r) => r.key), extent: { kind: 'distance', from: 0, to: 40 }, op: 'new', visible: true }
      const first = await build(b, [sketch, extrude])
      const body = first.bodies.find((x) => x.id === 2)!
      const edge = body.topology.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.mid[0] - R) < 0.1 && Math.abs(e.fingerprint.mid[1]) < 0.1)!
      const face = body.topology.faces.find((f) => f.fingerprint.kind === 'cylinder')!
      expect(edge && face).toBeTruthy()
      const wallAt = (z: number): Vec3 => [R + LEAN * 25, -25, z]
      const network: NetworkFeature = {
        id: 3,
        kind: 'network',
        name: 'Network',
        nodes: [
          { id: 1, at: [R, 0, 5] },
          { id: 2, at: [R, 0, 35] },
          { id: 3, at: wallAt(35) },
          { id: 4, at: wallAt(5) },
        ],
        curves: [
          { id: 5, from: 1, to: 2, via: [], along: { body: 2, edge: edge.fingerprint }, side: { body: 2, face: face.fingerprint, mode } },
          { id: 6, from: 2, to: 3, via: [] },
          { id: 7, from: 3, to: 4, via: [] },
          { id: 8, from: 4, to: 1, via: [] },
        ],
        cells: [{ seed: [R + LEAN * 12, -12, 20] }],
        spans: {},
        fit: { smoothness: 0.001 },
        visible: true,
      }
      const out = await build(b, [sketch, extrude, network])
      const r = out.results.find((x) => x.id === 3)!
      expect(r.status).toBe('ok')
      const report = r.network!
      expect(report.patches.length).toBe(1)
      const side = report.bodies.find((x) => x.curve === 5)!
      expect(side.mode).toBe(mode)
      // The curve along the edge is the edge.
      expect(side.gap).toBeLessThan(0.005)
      if (mode === 'tangent') expect(side.angle).toBeLessThan(0.5)
      else expect(side.angle).toBeGreaterThan(4)
      // Below the edge the patch still follows the wall.
      expect(report.patches[0].rms).toBeLessThan(mode === 'tangent' ? 0.15 : 0.03)
    })
  }
})
