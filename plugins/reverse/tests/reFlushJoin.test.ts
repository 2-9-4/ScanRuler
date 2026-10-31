// SPDX-License-Identifier: AGPL-3.0-only
// A block joined flush to a flange: its outer face drawn on the flange's
// own radius and started inside the flange, as a latch panel on a vacuum
// adapter was. The join comes out a closed solid whether the panel's arc
// lies on the flange's cylinder exactly or a few nanometres off it — the
// kernel's exact boolean and its unifying each break one of the two, and
// the step is played again — and a chamfer picked on the panel's corner
// does not run on down the line where the panel's face meets the
// flange's, a line the viewer neither draws nor picks.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, emptySketch } from '../core/sketch'
import { splitEdges, tangentChain, type FaceFingerprint } from '../core/topo'
import type { ChamferFeature, ExtrudeFeature, Feature, RevolveFeature, SketchFeature } from '../core/features'
import type { Vec3 } from '../../../src/core/types'
import { build } from './reKit'

const kernelPromise = ReKernel.load()

const R = 31.14
const START = 0.31516575
const SWEEP = 0.39767425
/** The panel's corner on the flange's radius, where its side leaves the
 *  outer arc. */
const CORNER: [number, number] = [R * Math.cos(START + SWEEP), R * Math.sin(START + SWEEP)]

/** The wall and its flange, revolved about Z: the wall Ø56 from z 50 to
 *  80, the flange Ø62.28 from 60.27 to 63.75. */
function flange(): Feature[] {
  const sketch = emptySketch()
  const pts: [number, number][] = [[0, 50], [28, 50], [28, 60.27], [R, 60.27], [R, 63.75], [28, 63.75], [28, 80], [0, 80]]
  pts.forEach((p, i) => addEntity(sketch, { kind: 'line', a: p, b: pts[(i + 1) % pts.length] }))
  const s: SketchFeature = { id: 1, kind: 'sketch', name: 'Profile', plane: { kind: 'world', axis: 'x', offset: 0 }, frame: { origin: [0, 0, 0], normal: [1, 0, 0], basisU: [0, 1, 0], basisV: [0, 0, 1] }, sketch, visible: true }
  const revolve: RevolveFeature = { id: 2, kind: 'revolve', name: 'Body', sketchId: 1, regions: findRegions(sketch).map((r) => r.key), axis: { kind: 'world', axis: 'z' }, angleDeg: 360, op: 'new', visible: true }
  return [s, revolve]
}

/** The panel: between arcs of R and 27.5, its sides along X, drawn at
 *  z 62 — inside the flange — and extruded 19 up into the wall, joined.
 *  The sides' ends on the outer arc either exactly on it or as typed to
 *  six decimals and a nanometre off: the arc the kernel draws through
 *  them is then a few nanometres off the flange's cylinder. */
function panel(exact: boolean): Feature[] {
  const sketch = emptySketch()
  const onR = (t: number): [number, number] => {
    const p: [number, number] = [R * Math.cos(t), R * Math.sin(t)]
    return exact ? p : [Number(p[0].toFixed(6)) + 1e-6, Number(p[1].toFixed(6)) - 1e-6]
  }
  const a = onR(START)
  const b = onR(START + SWEEP)
  const inner = (y: number): [number, number] => [Math.sqrt(27.5 * 27.5 - y * y), y]
  addEntity(sketch, { kind: 'line', a: inner(a[1]), b: a })
  addEntity(sketch, { kind: 'arc', c: [0, 0], r: R, start: START, sweep: SWEEP })
  addEntity(sketch, { kind: 'line', a: b, b: inner(b[1]) })
  const t0 = Math.atan2(a[1], inner(a[1])[0])
  const t1 = Math.atan2(b[1], inner(b[1])[0])
  addEntity(sketch, { kind: 'arc', c: [0, 0], r: 27.5, start: t0, sweep: t1 - t0 })
  const s: SketchFeature = { id: 3, kind: 'sketch', name: 'Panel outline', plane: { kind: 'world', axis: 'z', offset: 62 }, frame: { origin: [0, 0, 62], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, sketch, visible: true }
  const extrude: ExtrudeFeature = { id: 4, kind: 'extrude', name: 'Panel', sketchId: 3, regions: findRegions(sketch).map((r) => r.key), extent: { kind: 'distance', from: 0, to: 19 }, op: 'join', visible: true }
  return [s, extrude]
}

const atCorner = (mid: Vec3) => Math.hypot(mid[0] - CORNER[0], mid[1] - CORNER[1]) < 0.01

describe('a block joined flush to a flange', () => {
  it('joins into one closed solid, the panel’s arc on the flange’s radius exactly or a few nanometres off', async () => {
    const builder = new Builder(await kernelPromise)
    const alone = await build(builder, flange())
    const body = alone.bodies[0].volume
    const volumes: number[] = []
    for (const exact of [false, true]) {
      const out = await build(builder, [...flange(), ...panel(exact)])
      expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
      expect(out.bodies).toHaveLength(1)
      expect(out.bodies[0].closed).toBe(true)
      volumes.push(out.bodies[0].volume)
    }
    // The same solid either way: the wall and flange and the panel's
    // 690 mm³ outside them (877.9 mm³ of panel, 186.5 inside).
    expect(volumes[1]).toBeCloseTo(volumes[0], 3)
    expect(volumes[0] - body).toBeCloseTo(691.32, 1)
    builder.dispose()
  })

  it('chamfers the panel’s corner alone, not on down the hidden line where its face meets the flange’s', async () => {
    const builder = new Builder(await kernelPromise)
    for (const exact of [false, true]) {
      const joined = await build(builder, [...flange(), ...panel(exact)])
      const topology = joined.bodies[0].topology
      const corner = topology.edges.filter((e) => atCorner(e.fingerprint.mid))
      // Up the corner from the flange's top to the panel's, and on below
      // it, in line, the panel's face meeting the flange's: a split.
      const real = corner.find((e) => e.fingerprint.length > 17)!
      const below = corner.find((e) => Math.abs(e.fingerprint.length - 1.75) < 1e-3)!
      expect(real.fingerprint.length).toBeCloseTo(17.25, 3)
      expect(below).toBeDefined()
      const splits = splitEdges(topology)
      expect(splits.has(below.hash)).toBe(true)
      expect(splits.has(real.hash)).toBe(false)
      expect(tangentChain(topology.edges, [real.hash])).toHaveLength(2)
      expect(tangentChain(topology.edges, [real.hash], splits)).toEqual([real.hash])
      const chamfer: ChamferFeature = { id: 5, kind: 'chamfer', name: 'Chamfer 1', body: 2, edges: [real.fingerprint], distance: 1, chain: true, visible: true }
      const out = await build(builder, [...flange(), ...panel(exact), chamfer])
      expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
      expect(out.results[2].edges).toHaveLength(1)
      expect(out.results[2].edges![0].length).toBeCloseTo(17.25, 3)
      expect(out.bodies[0].closed).toBe(true)
    }
    builder.dispose()
  })
})

describe('the edges between two faces of one surface', () => {
  const face = (hash: number, kind: FaceFingerprint['kind'], dir: Vec3, more: Partial<FaceFingerprint> = {}) => ({ hash, fingerprint: { kind, centroid: [0, 0, 0] as Vec3, dir, area: 1, origin: 1, ...more } })
  const edge = (hash: number, faces: number[]) => ({ hash, faces })

  it('are a flat cut in two, or one cylinder or sphere in two — never two planes at an angle, nor two cones', () => {
    const splits = splitEdges({
      faces: [
        face(1, 'plane', [0, 0, 1]),
        face(2, 'plane', [0, 0, 1]),
        face(3, 'plane', [1, 0, 0]),
        face(4, 'cylinder', [0, 0, 1], { radius: 5, center: [0, 0, 0] }),
        face(5, 'cylinder', [0, 0, 1], { radius: 5.0000044, center: [0, 0, 3] }),
        face(6, 'cylinder', [0, 0, 1], { radius: 6, center: [0, 0, 0] }),
        face(7, 'cone', [0, 0, 1], { center: [0, 0, 0] }),
        face(8, 'cone', [0, 0, 1], { center: [0, 0, 2] }),
        face(9, 'sphere', [0, 0, 1], { radius: 3, center: [1, 1, 1] }),
        face(10, 'sphere', [1, 0, 0], { radius: 3, center: [1, 1, 1] }),
      ],
      edges: [edge(100, [1, 2]), edge(101, [1, 3]), edge(102, [4, 5]), edge(103, [4, 6]), edge(104, [7, 8]), edge(105, [9, 10]), edge(106, [4, 4]), edge(107, [1])],
    })
    expect([...splits].sort()).toEqual([100, 102, 105])
  })
})
