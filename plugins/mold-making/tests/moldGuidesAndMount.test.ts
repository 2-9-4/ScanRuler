// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid,planMold} from '../core/geometry'
import {DEFAULT_MOLD_SETTINGS,parseMoldSettings} from '../core/settings'
import {cutGuideSegments} from '../viewer/moldGuides'
import {masterMountMesh,planMasterMount} from '../core/masterMount'
import {closedness} from '../../mesh-tools/core/boolean'
import {signedVolume} from '../../mesh-tools/core/hollow'
import {analyzeMoldDraft} from '../core/draftAnalysis'

const cube=boxSolid({min:[-5,-5,0],max:[5,5,10]})
const bounds={min:[-5,-5,0] as [number,number,number],
  max:[5,5,10] as [number,number,number]}
const mounted={...DEFAULT_MOLD_SETTINGS,mode:'silicone-box' as const,keys:false,
  mountEnabled:true,mountPoint:[0,0,0] as [number,number,number],
  mountNormal:[0,0,-1] as [number,number,number],
  mountHeight:12}
describe('Pre-generation plane guides and glue-on master support',()=>{
  it('draws an exact primary XY/YZ/XZ split rectangle at requested fraction',()=>{
    for(const axis of ['x','y','z'] as const){
      const s={...DEFAULT_MOLD_SETTINGS,parts:2 as const,splitAxis:axis,
        splitPosition:.27}
      const outline=cutGuideSegments(bounds,s)
      expect(outline).toHaveLength(1)
      const k=axis==='x'?0:axis==='y'?1:2
      const at=bounds.min[k]+(bounds.max[k]-bounds.min[k])*.27
      expect(outline[0]).toHaveLength(4)
      for(const vertex of outline[0])expect(vertex[k]).toBeCloseTo(at)
    }
  })
  it('shows 3 radial cutting rays and two perpendicular four-piece split rectangles',()=>{
    const radial=cutGuideSegments(bounds,{...DEFAULT_MOLD_SETTINGS,parts:3})
    expect(radial).toHaveLength(3)
    for(const face of radial){
      expect(face[0][0]).toBeCloseTo(0)
      expect(face[0][1]).toBeCloseTo(0)
      expect(face[3][0]).toBeCloseTo(0)
      expect(face[3][1]).toBeCloseTo(0)
    }
    const four=cutGuideSegments(bounds,{...DEFAULT_MOLD_SETTINGS,parts:4,
      splitAxis:'z',splitPosition:.35})
    expect(four).toHaveLength(2)
    expect(four[0].every(v=>Math.abs(v[2]-3.5)<1e-8)).toBe(true)
    expect(four[1].every(v=>v[0]===0)).toBe(true)
  })
  it('does not infer a support without user selecting an actual 3D model face',()=>{
    expect(DEFAULT_MOLD_SETTINGS.mountEnabled).toBe(false)
    expect(DEFAULT_MOLD_SETTINGS.mountPoint).toBeNull()
    expect(masterMountMesh(bounds,DEFAULT_MOLD_SETTINGS)).toBeNull()
    expect(()=>parseMoldSettings({...mounted,mountPoint:null})).toThrow(/Pick a base face/)
    expect(parseMoldSettings({...mounted,mode:'direct'}).mountEnabled).toBe(true)
    expect(()=>parseMoldSettings({...mounted,mountNormal:[0,0,1]})).toThrow(/downward/)
    expect(()=>parseMoldSettings({...mounted,mountStemDiameter:50})).toThrow(/foot diameter/)
  })
  it('makes a watertight, oriented, printable multi-section support without modifying the target',()=>{
    const untouched=cube.positions.slice()
    const outer=planMold(cube,mounted).outer
    const mesh=masterMountMesh(bounds,mounted,outer)!
    expect(closedness(mesh.indices,mesh.positions.length/3)).toEqual({open:0,bad:0})
    expect(signedVolume(mesh.positions,mesh.indices)).toBeGreaterThan(0)
    const planned=planMasterMount(bounds,mounted,outer)!
    expect(planned.floorZ).toBeCloseTo(outer.min[2])
    expect(planned.rings.at(-1)!.center).toEqual([0,0,-0.2])
    expect(planned.rings[0].hex).toBe(true)
    expect(planned.rings[2].hex).toBe(true)
    expect(planned.rings[0].center[2]).toBeLessThan(planned.floorZ)
    expect(cube.positions).toEqual(untouched)
    expect(parseMoldSettings(mounted)).toEqual(mounted)
  })
  it('separates and deepens silicone box interior when mount support is enabled',()=>{
    const base=planMold(cube,{...mounted,mountEnabled:false})
    const withSupport=planMold(cube,mounted)
    expect(withSupport.innerBox!.min[2]).toBeCloseTo(base.innerBox!.min[2]-mounted.mountHeight)
    expect(withSupport.outer.min[2]).toBeCloseTo(base.outer.min[2]-mounted.mountHeight)
    expect(withSupport.outer.max[2]).toBeCloseTo(base.outer.max[2])
  })
  it('keeps the draft analyzer separate from pedestal/box geometry',()=>{
    const a=analyzeMoldDraft(cube,{...DEFAULT_MOLD_SETTINGS,parts:4})
    expect(a.regions).toHaveLength(4)
    const orig=masterMountMesh(bounds,mounted,planMold(cube,mounted).outer)!
    expect(orig.indices.length).toBeGreaterThan(0)
  })
})
