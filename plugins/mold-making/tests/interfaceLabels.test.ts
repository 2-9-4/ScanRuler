// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {labelsForParts,matingMarks,planSeamNumberPlacements} from '../core/interfaceLabels'
import type {Limits} from '../core/geometry'
import {DEFAULT_MOLD_SETTINGS} from '../core/settings'

describe('Exterior mold interface engraving numbering',()=>{
  it('gives the same seam number to both mating parts',()=>{
    for(const count of [2,3,4]){
      const marks=matingMarks(count)
      const labels=labelsForParts(count)
      // A two-part mold has one shared interface, not two.
      expect(marks).toHaveLength(count===2?1:count)
      expect(labels).toHaveLength(count)
      for(const mark of marks){
        const [a,b]=mark.pair
        expect(a).not.toBe(b)
        expect(a).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThan(count)
        expect(labels[a].split('-')).toContain(String(mark.number))
        expect(labels[b].split('-')).toContain(String(mark.number))
      }
    }
  })
  const outer:Limits={min:[-16,-14,-9],max:[16,14,11]}
  const source:Limits={min:[-10,-8,-5],max:[10,8,7]}
  const fourBounds:Limits[]=[
    {min:[-16,-14,-9],max:[0,0,11]},
    {min:[-16,0,-9],max:[0,14,11]},
    {min:[0,-14,-9],max:[16,0,11]},
    {min:[0,0,-9],max:[16,14,11]},
  ]
  it('places paired numbers beside the split, not together in the middle of each part',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,parts:4 as const,splitAxis:'x' as const}
    const locations=planSeamNumberPlacements(outer,source,s,fourBounds,null)
    expect(locations).toHaveLength(8)
    for(const mark of matingMarks(4)){
      const two=locations.filter(place=>place.number===mark.number)
      expect(two.map(p=>p.partIndex).sort()).toEqual([...mark.pair].sort())
      expect(two[0].seamAxis).toBe(two[1].seamAxis)
      for(const place of two){
        expect(place.surface).not.toBe('radial')
        const k=place.seamAxis==='x'?0:place.seamAxis==='y'?1:2
        // Both labeled surfaces lie no more than one glyph width away
        // from their physical mating plane.
        expect(Math.abs(place.center[k]-place.seamAt)).toBeLessThan(4.5)
      }
      expect((two[0].center[0]-two[1].center[0])**2+
             (two[0].center[1]-two[1].center[1])**2).toBeGreaterThan(0)
    }
    // Each quadrant has two distinct individual digits, not the old
    // combined 1-4 in the middle of its outside wall.
    for(let i=0;i<4;i++)
      expect(locations.filter(place=>place.partIndex===i)).toHaveLength(2)
  })
  it('moves threefold exterior numbers toward the neighboring radial interfaces',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,parts:3 as const}
    const circular:Limits={min:[-22,-22,-9],max:[22,22,11]}
    const locations=planSeamNumberPlacements(circular,source,s,
      [circular,circular,circular],22)
    expect(locations).toHaveLength(6)
    for(const mark of matingMarks(3)){
      const pair=locations.filter(p=>p.number===mark.number)
      expect(pair).toHaveLength(2)
      for(const location of pair){
        expect(location.surface).toBe('radial')
        const delta=Math.atan2(Math.sin(location.angleRad-location.seamAt),
          Math.cos(location.angleRad-location.seamAt))
        expect(Math.abs(delta)).toBeLessThan(.30)
        expect(Math.abs(delta)).toBeGreaterThan(.03)
        expect(Math.hypot(location.center[0],location.center[1])).toBeCloseTo(22)
      }
      expect(pair[0].angleRad).not.toBeCloseTo(pair[1].angleRad,5)
    }
  })
  it('places Z-first fourfold numbers alongside vertical and horizontal seams',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,parts:4 as const,splitAxis:'z' as const}
    const b:Limits[]=[
      {min:[-16,-14,-9],max:[0,14,1]},
      {min:[0,-14,-9],max:[16,14,1]},
      {min:[-16,-14,1],max:[0,14,11]},
      {min:[0,-14,1],max:[16,14,11]},
    ]
    const locations=planSeamNumberPlacements(outer,source,s,b,null)
    expect(locations).toHaveLength(8)
    for(const location of locations){
      const k=location.seamAxis==='z'?2:0
      expect(Math.abs(location.center[k]-location.seamAt)).toBeLessThan(4.5)
    }
    expect(locations.filter(p=>p.seamAxis==='z')).toHaveLength(4)
    expect(locations.filter(p=>p.seamAxis==='x')).toHaveLength(4)
  })
  it('keeps two-part seam numbers on opposite sides of a real parting line',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,parts:2 as const,splitAxis:'x' as const}
    const b:Limits[]=[
      {min:[-16,-14,-9],max:[0,14,11]},
      {min:[0,-14,-9],max:[16,14,11]},
    ]
    const marks=planSeamNumberPlacements(outer,source,s,b,null)
    expect(marks.map(p=>p.number)).toEqual([1,1])
    expect(marks[0].center[0]).toBeLessThan(0)
    expect(marks[1].center[0]).toBeGreaterThan(0)
    expect(marks.every(p=>p.surface==='y')).toBe(true)
  })
  it('marks threefold part 1 with interfaces 1 and 3, and fourfold with four distinct interfaces',()=>{
    expect(labelsForParts(1)).toEqual([''])
    expect(labelsForParts(2)).toEqual(['1','1'])
    expect(labelsForParts(3)).toEqual(['1-3','1-2','2-3'])
    expect(labelsForParts(4)).toEqual(['1-4','1-2','3-4','2-3'])
  })
})
