// SPDX-License-Identifier: AGPL-3.0-only
// A body's volume as an answer gives it, and the STEP check's two costly
// readings: the volumes it holds a file to, and the gap, asked of the same
// face first.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { meshVolume } from '../core/kernelMesh'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import { XY } from './reKit'

vi.setConfig({ testTimeout: 120_000 })

const kernelPromise = ReKernel.load()

function sketchFeature(id: number, draw: (s: Sketch) => void): SketchFeature {
  const sketch = emptySketch()
  draw(sketch)
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
}

const extrude = (id: number, s: SketchFeature, to: number): Feature => ({ id, kind: 'extrude', name: `Extrude ${id}`, sketchId: s.id, regions: findRegions(s.sketch).map((r) => r.key), extent: { kind: 'distance', from: 0, to }, op: 'new', visible: true })

async function built(features: Feature[]) {
  const kernel = await kernelPromise
  const builder = new Builder(kernel)
  const sketches = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const result = builder.build(steps, (id) => sketches.get(id))
  return { kernel, builder, result }
}

/** An ellipse 10 by 7 as a closed spline through `n` points. */
const ellipse = (id: number, n: number) => sketchFeature(id, (s) => addEntity(s, { kind: 'spline', pts: Array.from({ length: n }, (_, i): [number, number] => [10 * Math.cos((2 * Math.PI * i) / n), 7 * Math.sin((2 * Math.PI * i) / n)]), closed: true }))

describe('a body’s volume in an answer', () => {
  it('is a closed-spline prism’s, within 0.5 % of the truth, at any number of points', async () => {
    for (const n of [8, 16, 64]) {
      const s = ellipse(1, n)
      const { kernel, builder, result } = await built([s, extrude(2, s, 5)])
      const truth = Math.PI * 10 * 7 * 5
      expect(Math.abs(result.bodies[0].volume - truth) / truth).toBeLessThan(5e-3)
      expect(Math.abs(kernel.measuredVolume(builder.body(result.bodies[0].id)!) - truth) / truth).toBeLessThan(5e-3)
      builder.dispose()
    }
  })

  it('stays the kernel’s exact figure on a body of planes and cylinders: its coarser mesh does not stand', async () => {
    const s = sketchFeature(1, (sk) => addEntity(sk, { kind: 'circle', c: [0, 0], r: 3 }))
    const { kernel, builder, result } = await built([s, extrude(2, s, 5)])
    const shape = builder.body(result.bodies[0].id)!
    const exact = Math.PI * 9 * 5
    expect(result.bodies[0].volume).toBeCloseTo(exact, 6)
    // A mesh well short of it does not move the figure.
    expect(kernel.measuredVolume(shape, kernel.mesh(shape, 1))).toBeCloseTo(exact, 6)
    builder.dispose()
  })

  it('reads a closed mesh by its signed tetrahedra', () => {
    const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]
    const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]
    expect(meshVolume({ positions, indices })).toBeCloseTo(1, 9)
    expect(meshVolume({ positions: positions.map((v) => v * 2), indices })).toBeCloseTo(8, 9)
  })
})

describe('the STEP check', () => {
  it('reads a file off the body as far off as it is, asked of the same face first', async () => {
    const s = ellipse(1, 16)
    const { kernel, builder, result } = await built([s, extrude(2, s, 5)])
    const shape = builder.body(result.bodies[0].id)!
    const text = kernel.exportStep([shape], [{ name: 'x' }])
    const clean = kernel.verifyStep(text, [shape])
    expect(clean.bodies[0].gap.max).toBeLessThan(1e-3)
    expect(clean.problems.filter((p) => /volume|off the body/.test(p))).toEqual([])
    // The body moved 0.05 mm: the file is that far off it, however the
    // points are asked.
    const moved = kernel.transformTracked(shape, [1, 0, 0, 0.05, 0, 1, 0, 0, 0, 0, 1, 0]).shape
    const off = kernel.verifyStep(text, [moved])
    expect(off.bodies[0].gap.max).toBeGreaterThan(0.02)
    expect(off.bodies[0].gap.max).toBeLessThan(0.051)
    expect(off.problems.join(' ')).toMatch(/off the body/)
    builder.dispose()
  })
})
