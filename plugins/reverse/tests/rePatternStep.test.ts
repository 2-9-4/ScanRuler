// SPDX-License-Identifier: AGPL-3.0-only
// A circular pattern's step is the angle from the first copy to the last:
// 90° in four puts copies at 0, 30, 60 and 90; 360° shares a full turn out
// among them. A project saved while the kernel spread the step as pitch ×
// count opens with its copies where they stood.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { patternPitch, type Feature, type PatternFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { migrateFeature, PART_VERSION } from '../app/projectSection'
import { build, extrudeAll, rectangleSketch } from './reKit'

const kernelPromise = ReKernel.load()

/** A 2 × 2 block 20 out along +x, patterned about z. */
function patterned(count: number, step: number): Feature[] {
  const s = rectangleSketch(1, 2, 2, [19, -1])
  const pattern: PatternFeature = { id: 3, kind: 'pattern', name: 'Pattern 1', body: 2, mode: 'circular', axis: { kind: 'world', axis: 'z' }, count, step, visible: true }
  return [s, extrudeAll(2, s, 0, 2), pattern]
}

/** The angle of each body's box centre about z, degrees, in order round. */
async function anglesOf(features: Feature[]): Promise<number[]> {
  const builder = new Builder(await kernelPromise)
  const out = await build(builder, features)
  builder.dispose()
  expect(out.results.every((r) => r.status === 'ok')).toBe(true)
  return out.bodies
    .map((b) => {
      const c = [(b.box!.min[0] + b.box!.max[0]) / 2, (b.box!.min[1] + b.box!.max[1]) / 2]
      const a = (Math.atan2(c[1], c[0]) * 180) / Math.PI
      return a < -1e-6 ? a + 360 : Math.max(0, a)
    })
    .sort((a, b) => a - b)
}

describe('circular pattern step', () => {
  it('spaces an open span first to last, and a full turn evenly round', async () => {
    expect(patternPitch(90, 4)).toBeCloseTo(30, 12)
    expect(patternPitch(360, 14)).toBeCloseTo(25.714285714, 8)
    const open = await anglesOf(patterned(4, 90))
    expect(open.length).toBe(4)
    open.forEach((a, i) => expect(a).toBeCloseTo(i * 30, 4))
    const round = await anglesOf(patterned(14, 360))
    expect(round.length).toBe(14)
    round.forEach((a, i) => expect(a).toBeCloseTo((i * 360) / 14, 4))
  })

  it('opens a project saved with the old step with its copies where they stood', async () => {
    // Saved before version 2: step 77.142 over 3 copies was a pitch of
    // 25.714, the copies spanning two of those.
    const old = patterned(3, 77.142)
    const migrated = old.map((f) => migrateFeature(f, 1))
    const p = migrated[2] as PatternFeature
    expect(p.step).toBeCloseTo(51.428, 12)
    const angles = await anglesOf(migrated)
    expect(angles.length).toBe(3)
    angles.forEach((a, i) => expect(a).toBeCloseTo(i * 25.714, 4))
    // A full turn, a linear row and a part written now are left alone.
    expect(migrateFeature(patterned(14, 360)[2], 1)).toEqual(patterned(14, 360)[2])
    const row: PatternFeature = { ...(patterned(3, 15)[2] as PatternFeature), mode: 'linear' }
    expect(migrateFeature(row, 1)).toBe(row)
    expect(migrateFeature(old[2], PART_VERSION)).toBe(old[2])
    // An expression driving the step is carried over with the change.
    const driven = migrateFeature({ ...(old[2] as PatternFeature), exprs: { step: 'pitch * 3' } }, 1) as PatternFeature
    expect(driven.exprs?.step).toBe('(pitch * 3) * ((3) - 1) / (3)')
  })
})
