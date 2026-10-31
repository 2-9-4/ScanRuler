// SPDX-License-Identifier: AGPL-3.0-only
// A revolve whose profile meets its axis: ending on it — a pole, a sphere's
// arc — or running along it is turned; reaching over it, by a hair or by
// millimetres, is refused before the kernel's "construction failed", saying
// by how much and where.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { Feature, RevolveFeature, SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import type { SectionFrame } from '../../../src/core/section/frame'
import { ctx } from './reKit'

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** The XZ plane as a world-y sketch has it: u is Z, v is X — the axis Z is
 *  the sheet's u axis. */
const ZX: SectionFrame = { origin: [0, 0, 0], normal: [0, 1, 0], basisU: [0, 0, 1], basisV: [1, 0, 0] }

type Piece = { kind: 'line'; a: [number, number]; b: [number, number] } | { kind: 'arc'; c: [number, number]; r: number; start: number; sweep: number }

function sketchOf(pieces: Piece[]): SketchFeature {
  const sketch = emptySketch()
  for (const p of pieces) addEntity(sketch, p as never)
  return { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'y', offset: 0 }, frame: ZX, sketch, visible: true }
}

const revolve = (s: SketchFeature): RevolveFeature => ({ id: 2, kind: 'revolve', name: 'Revolve 1', sketchId: s.id, regions: findRegions(s.sketch).map((r) => r.key), axis: { kind: 'world', axis: 'z' }, angleDeg: 360, pitch: 0, op: 'new', visible: true })

async function build(pieces: Piece[]) {
  const s = sketchOf(pieces)
  const features: Feature[] = [s, revolve(s)]
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, ctx, (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>([[s.id, s.sketch]])
  const result = builder.build(steps, (id) => sketches.get(id))
  builder.dispose()
  const r = result.results[0]
  return { status: r.status, message: ('message' in r ? r.message : undefined) ?? '', volume: result.bodies[0]?.volume ?? 0 }
}

const at = (c: [number, number], r: number, t: number): [number, number] => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]

/** A half disc of radius 6.5 about Z 8.5 on the axis, its arc from
 *  `start` through `sweep`, closed by the chord between its ends. */
const halfDisc = (start: number, sweep: number): Piece[] => [
  { kind: 'arc', c: [8.5, 0], r: 6.5, start, sweep },
  { kind: 'line', a: at([8.5, 0], 6.5, start + sweep), b: at([8.5, 0], 6.5, start) },
]

describe('a revolve whose profile meets its axis', () => {
  it('turns an arc ending on the axis — a pole — into a sphere, and a cone to its tip', async () => {
    const sphere = await build(halfDisc(0, Math.PI))
    expect(sphere.status, sphere.message).toBe('ok')
    expect(sphere.volume).toBeCloseTo((4 / 3) * Math.PI * 6.5 ** 3, 3)
    // A quarter: one pole, the flat end on the equator.
    const dome = await build([
      { kind: 'arc', c: [8.5, 0], r: 6.5, start: Math.PI / 2, sweep: Math.PI / 2 },
      { kind: 'line', a: [2, 0], b: [8.5, 0] },
      { kind: 'line', a: [8.5, 0], b: [8.5, 6.5] },
    ])
    expect(dome.status, dome.message).toBe('ok')
    expect(dome.volume).toBeCloseTo((2 / 3) * Math.PI * 6.5 ** 3, 3)
    const cone = await build([
      { kind: 'line', a: [0, 5], b: [5, 0] },
      { kind: 'line', a: [5, 0], b: [0, 0] },
      { kind: 'line', a: [0, 0], b: [0, 5] },
    ])
    expect(cone.status, cone.message).toBe('ok')
    expect(cone.volume).toBeCloseTo((Math.PI * 25 * 5) / 3, 3)
  })

  it('refuses a profile reaching over the axis, saying by how much and where', async () => {
    // The arc overshoots the axis by a hundredth of a radian each end.
    const over = await build(halfDisc(-0.01, Math.PI + 0.02))
    expect(over.status).toBe('failed')
    expect(over.message).toMatch(/^The profile crosses the revolve’s axis — it reaches 0\.065 mm over it at \(/)
    expect(over.message).toMatch(/end the pieces on the axis/)
    expect(over.message).not.toMatch(/construction failed/)
    // A rectangle straddling it by millimetres: the lesser reach is named.
    const straddle = await build([
      { kind: 'line', a: [0, -1], b: [4, -1] },
      { kind: 'line', a: [4, -1], b: [4, 3] },
      { kind: 'line', a: [4, 3], b: [0, 3] },
      { kind: 'line', a: [0, 3], b: [0, -1] },
    ])
    expect(straddle.status).toBe('failed')
    expect(straddle.message).toMatch(/reaches 1 mm over it/)
  })
})
