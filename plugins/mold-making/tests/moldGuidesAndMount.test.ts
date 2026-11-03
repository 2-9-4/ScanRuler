// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid,planMold} from '../core/geometry'
import {DEFAULT_MOLD_SETTINGS,parseMoldSettings} from '../core/settings'
import {cutGuideSegments} from '../viewer/moldGuides'
import {
  masterMountMesh,planMasterMount,MOUNT_HEX_SEAT_DEPTH_MM,
  MOUNT_HEX_COLLAR_HEIGHT_MM,MOUNT_HEX_AXIAL_CLEARANCE_MM,
  MOUNT_PAD_AXIAL_CLEARANCE_MM,MOUNT_PAD_RADIAL_CLEARANCE_MM,
} from '../core/masterMount'
import {mountCenterCandidates} from '../viewer/moldGuides'
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
  it('prefers the actual XY center before nearby underside fallback samples',()=>{
    const samples=mountCenterCandidates(bounds)
    expect(samples[0]).toEqual([0,0])
    expect(samples.length).toBeGreaterThan(10)
    expect(samples.every(([x,y])=>x>=bounds.min[0]&&x<=bounds.max[0]&&
      y>=bounds.min[1]&&y<=bounds.max[1])).toBe(true)
    expect(new Set(samples.map(p=>p.join(','))).size).toBe(samples.length)
  })
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
    expect(()=>parseMoldSettings({...mounted,mode:'direct'})).toThrow(/positive cavity clearance/)
    expect(parseMoldSettings({...mounted,mode:'direct',clearance:0.4}).mountEnabled).toBe(true)
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
    expect(planned.rings[1].center[2]).toBeCloseTo(planned.floorZ+MOUNT_HEX_COLLAR_HEIGHT_MM)
    expect(planned.rings[1].center[2]).toBe(planned.rings[2].center[2])
    expect(planned.rings[1].radius).toBeGreaterThan(planned.rings[2].radius)
    expect(MOUNT_HEX_SEAT_DEPTH_MM-MOUNT_HEX_COLLAR_HEIGHT_MM)
      .toBeCloseTo(MOUNT_HEX_AXIAL_CLEARANCE_MM)
    expect(planned.innerStop).not.toBeNull()
    const stop=planned.innerStop!
    expect(stop.bottomZ).toBeCloseTo(bounds.min[2]-mounted.mountHeight+MOUNT_PAD_AXIAL_CLEARANCE_MM)
    expect(stop.radius).toBeGreaterThan(mounted.mountStemDiameter/2)
    const stopRings=planned.rings.filter(r=>Math.abs(r.center[2]-stop.bottomZ)<1e-6)
    expect(stopRings).toHaveLength(2)
    expect(stopRings[0].radius).toBeCloseTo(mounted.mountStemDiameter/2)
    expect(stopRings[1].radius).toBeCloseTo(stop.radius)
    expect(planned.headSeat.pocketFloorZ).toBeCloseTo(
      planned.headSeat.baseZ-MOUNT_PAD_AXIAL_CLEARANCE_MM)
    expect(planned.headSeat.pocketRadius).toBeGreaterThan(
      mounted.mountPadDiameter/2+MOUNT_PAD_RADIAL_CLEARANCE_MM-1e-6)
    const headRings=planned.rings.filter(r=>Math.abs(r.center[2]-planned.headSeat.baseZ)<1e-6)
    expect(headRings).toHaveLength(2)
    expect(headRings[1].radius).toBeGreaterThan(headRings[0].radius)
    expect(cube.positions).toEqual(untouched)
    expect(parseMoldSettings(mounted)).toEqual(mounted)
  })
  it('provides a rigid-mold head shoulder seat in addition to the exterior collar',()=>{
    const s={...mounted,mode:'direct' as const,clearance:0.4}
    const p=planMasterMount(bounds,s,planMold(cube,s).outer)!
    expect(p.innerStop).toBeNull()
    expect(p.headSeat.baseZ).toBeCloseTo(-2)
    expect(p.headSeat.pocketFloorZ).toBeCloseTo(-2-MOUNT_PAD_AXIAL_CLEARANCE_MM)
    const head=p.rings.filter(r=>Math.abs(r.center[2]-p.headSeat.baseZ)<1e-6)
    expect(head).toHaveLength(2)
    expect(head[1].radius).toBeGreaterThan(head[0].radius)
    expect(p.headSeat.pocketTopZ).toBeGreaterThan(
      p.rings[p.rings.length-1].center[2])
  })
  it('reserves sufficient head-pocket height for an angled glue pad',()=>{
    const tilted={...mounted,mountNormal:[0.6,0,-0.8] as [number,number,number]}
    const p=planMasterMount(bounds,tilted,planMold(cube,tilted).outer)!
    const top=p.rings[p.rings.length-1]
    const lowestTop=top.center[2]-
      top.radius*Math.hypot(tilted.mountNormal[0],tilted.mountNormal[1])
    expect(p.headSeat.baseZ).toBeLessThan(lowestTop-1)
    expect(p.headSeat.pocketTopZ).toBeGreaterThan(top.center[2]+
      top.radius*Math.hypot(tilted.mountNormal[0],tilted.mountNormal[1]))
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
