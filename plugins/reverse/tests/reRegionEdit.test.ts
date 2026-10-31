// SPDX-License-Identifier: AGPL-3.0-only
// A sketch edited under an extrude takes nothing away quietly: a picked
// face cut in two by a new line is picked in both parts, and a pick whose
// face the edit removed stays on the feature and is named on its row.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import type { ExtrudeFeature, Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { replaceSketch } from '../core/parameters'
import { findRegions, lostPicks } from '../core/regions'
import { addEntity, addRectangle, cloneSketch, emptySketch } from '../core/sketch'
import { build, extrudeAll, sketchOf } from './reKit'

const kernelPromise = ReKernel.load()

describe('a sketch edited under its extrude', () => {
  it('picks both parts of a face a new line cuts in two', async () => {
    const s = sketchOf(1, (k) => addRectangle(k, [0, 0], [20, 10]))
    const features: Feature[] = [s, extrudeAll(2, s, 0, 10)]
    const edited = cloneSketch(s.sketch)
    addEntity(edited, { kind: 'line', a: [8, -5], b: [8, 15] })
    expect(findRegions(edited)).toHaveLength(2)
    const next = replaceSketch(features, 1, edited)
    const extrude = next.find((f): f is ExtrudeFeature => f.kind === 'extrude')!
    expect(extrude.regions).toHaveLength(2)
    const builder = new Builder(await kernelPromise)
    const out = await build(builder, next)
    expect(out.results.map((r) => r.status)).toEqual(['ok'])
    expect(out.bodies.reduce((v, b) => v + b.volume, 0)).toBeCloseTo(20 * 10 * 10, 4)
    builder.dispose()
  })

  it('keeps a pick whose face is gone, and the build names it', async () => {
    const s = sketchOf(1, (k) => {
      addRectangle(k, [0, 0], [4, 4])
      addRectangle(k, [10, 0], [14, 4])
    })
    const features: Feature[] = [s, extrudeAll(2, s, 0, 10)]
    // The second rectangle deleted: the first keeps its ids and its key.
    const one = emptySketch()
    addRectangle(one, [0, 0], [4, 4])
    const next = replaceSketch(features, 1, one)
    const extrude = next.find((f): f is ExtrudeFeature => f.kind === 'extrude')!
    expect(extrude.regions).toHaveLength(2)
    expect(lostPicks(extrude.regions, findRegions(one))).toHaveLength(1)
    const builder = new Builder(await kernelPromise)
    const out = await build(builder, [{ ...(next[0] as SketchFeature) }, extrude])
    expect(out.results[0].status).toBe('ok')
    expect(out.results[0].warning).toMatch(/1 of 2 profiles picked is gone from the sketch/)
    expect(out.bodies[0].volume).toBeCloseTo(4 * 4 * 10, 4)
    builder.dispose()
  })
})
