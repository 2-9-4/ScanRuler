// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {closedness} from '../../mesh-tools/core/boolean'
import {signedVolume} from '../../mesh-tools/core/hollow'
import {DEFAULT_MOLD_SETTINGS} from '../core/settings'
import {boxSolid,draftedBox,planMold} from '../core/geometry'

const target=boxSolid({min:[-5,-4,0],max:[5,4,10]})
describe('Mold part planning',()=>{
  it('keeps a full-height target and watertight box primitives',()=>{
    const cube=boxSolid({min:[0,0,0],max:[10,20,30]})
    expect(closedness(cube.indices,cube.positions.length/3)).toEqual({open:0,bad:0})
    expect(signedVolume(cube.positions,cube.indices)).toBeCloseTo(6000,3)
    const p=planMold(target,DEFAULT_MOLD_SETTINGS)
    expect(p.openingZ).toBeNull()
    // The automatic minimum includes clamp-tab space; the old fixed
    // 4 mm backing is no longer the specified mold dimension.
    expect(p.outer.min[2]).toBeCloseTo(-p.material.base)
    expect(p.outer.max[2]).toBeCloseTo(10+p.material.base)
    expect(p.material.base).toBeGreaterThanOrEqual(2)
    expect(p.material.side).toBeGreaterThanOrEqual(2)
  })
  it('makes cylindrical boxes wide enough for every target corner',()=>{
    const p=planMold(target,{...DEFAULT_MOLD_SETTINGS,mode:'silicone-box',boxShape:'cylindrical'})
    expect(p.cylinder).not.toBeNull()
    expect(p.cylinder!.innerR).toBeGreaterThan(Math.hypot(5,4))
    expect(p.cylinder!.outerR).toBeGreaterThan(p.cylinder!.innerR+3)
    expect(p.innerBox!.max[2]).toBeGreaterThan(p.outer.max[2])
  })
  it('applies draft to the open box interior, not its model',()=>{
    const limits={min:[-5,-4,0] as [number,number,number],max:[5,4,10] as [number,number,number]}
    const prism=draftedBox(limits,1)
    expect(prism.positions[4*3]).toBe(-6)
    expect(prism.positions[6*3]).toBe(6)
    expect(signedVolume(prism.positions,prism.indices)).toBeGreaterThan(800)
  })
  it('rejects degenerate targets but adds required backing when extra margins are zero',()=>{
    expect(()=>planMold({positions:new Float32Array(9),indices:new Uint32Array([0,1,2])},DEFAULT_MOLD_SETTINGS)).toThrow()
    const zero=planMold(target,{...DEFAULT_MOLD_SETTINGS,sideMargin:0,baseThickness:0})
    expect(zero.material.side).toBeGreaterThan(0)
    expect(zero.material.base).toBeGreaterThan(0)
    const extra=planMold(target,{...DEFAULT_MOLD_SETTINGS,sideMargin:1.25,baseThickness:2.5})
    expect(extra.material.side-zero.material.side).toBeCloseTo(1.25)
    expect(extra.material.base-zero.material.base).toBeCloseTo(2.5)
    expect(extra.outer.min[0]).toBeCloseTo(zero.outer.min[0]-1.25)
    expect(extra.outer.min[2]).toBeCloseTo(zero.outer.min[2]-2.5)
  })
})
