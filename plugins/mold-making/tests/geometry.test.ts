// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { closedness } from '../../mesh-tools/core/boolean'
import { signedVolume } from '../../mesh-tools/core/hollow'
import { DEFAULT_MOLD_SETTINGS } from '../core/settings'
import { boxSolid, planMold } from '../core/geometry'

const testTarget = boxSolid({ min: [-5,-4,0], max: [5,4,10] })

describe('Mold Making geometry preparation', () => {
  it('creates outward-wound, watertight axis-aligned blocks', () => {
    const cube = boxSolid({ min:[0,0,0], max:[10,20,30] })
    expect(closedness(cube.indices, cube.positions.length/3)).toEqual({open:0,bad:0})
    expect(signedVolume(cube.positions, cube.indices)).toBeCloseTo(6000, 3)
  })
  it('cuts one-sided rigid cavities below target mid-height', () => {
    const plan = planMold(testTarget, DEFAULT_MOLD_SETTINGS)
    expect(plan.openingZ).toBe(5)
    expect(plan.outer.min[2]).toBe(-4)
    expect(plan.outer.max[2]).toBe(5)
  })
  it('creates an open silicone box with independently thick base, walls and silicone clearance', () => {
    const settings = { ...DEFAULT_MOLD_SETTINGS, mode:'silicone-box' as const }
    const plan = planMold(testTarget, settings)
    expect(plan.innerBox).not.toBeNull()
    expect(plan.outer.min[0]).toBe(-20)
    expect(plan.innerBox?.min[0]).toBe(-17)
    expect(plan.innerBox!.max[2]).toBeGreaterThan(plan.outer.max[2])
  })
  it('rejects a zero-extent target and undersized margins', () => {
    expect(()=>planMold({positions:new Float32Array(9),indices:new Uint32Array([0,1,2])},DEFAULT_MOLD_SETTINGS)).toThrow()
    expect(()=>planMold(testTarget,{...DEFAULT_MOLD_SETTINGS,sideMargin:0.2})).toThrow()
  })
})
