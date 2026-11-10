// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid} from '../core/geometry'
import {DEFAULT_MOLD_SETTINGS} from '../core/settings'
import {moldDraftPartition,visitDraftFaces} from '../core/draftPartitions'
import {analyzeMoldDraft} from '../core/draftAnalysis'
import {buildMoldDraftOverlay,draftVisibleFaces,DEFAULT_DRAFT_DISPLAY} from '../core/draftOverlay'

const master=boxSolid({min:[-5,-5,-5],max:[5,5,5]})
describe('Direct-mold 1/3/4-piece release screening',()=>{
  it('screens only the retained lower portion of a single impression along -Z',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,parts:1 as const,analyzeDraft:true}
    const partition=moldDraftPartition(master,s)
    expect(partition.layout).toBe('impression')
    expect(partition.regions).toHaveLength(1)
    expect(partition.regions[0].release).toEqual([0,0,-1])
    const report=analyzeMoldDraft(master,s)
    const overlay=buildMoldDraftOverlay(master,s)
    expect(report.regions).toHaveLength(1)
    expect(report.totalAreaMm2).toBeCloseTo(300,5)
    expect(report.reverseFacingMm2).toBeCloseTo(0,5)
    expect(Array.from(overlay.half).every(index=>index===0)).toBe(true)
    for(let i=0;i<overlay.positions.length;i+=3)
      expect(overlay.positions[i+2]).toBeLessThanOrEqual(1e-6)
  })
  it('maps 120-degree threefold sectors to exactly their exported part order',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,parts:3 as const,analyzeDraft:true}
    const partition=moldDraftPartition(master,s)
    expect(partition.layout).toBe('threefold')
    expect(partition.regions.map(r=>r.label)).toEqual([
      'Sector 1 (60°)','Sector 2 (180°)','Sector 3 (300°)'])
    for(let i=0;i<3;i++){
      const angle=(i+0.5)*Math.PI*2/3
      expect(partition.regions[i].release[0]).toBeCloseTo(Math.cos(angle),8)
      expect(partition.regions[i].release[1]).toBeCloseTo(Math.sin(angle),8)
      expect(partition.regions[i].release[2]).toBe(0)
    }
    const report=analyzeMoldDraft(master,s)
    const overlay=buildMoldDraftOverlay(master,s)
    expect(report.regions).toHaveLength(3)
    expect(report.totalAreaMm2).toBeCloseTo(600,4)
    expect(report.regions.reduce((sum,region)=>sum+region.areaMm2,0))
      .toBeCloseTo(report.totalAreaMm2,6)
    expect(new Set(overlay.half)).toEqual(new Set([0,1,2]))
    for(let i=0;i<3;i++){
      const visible=draftVisibleFaces(overlay,{
        ...DEFAULT_DRAFT_DISPLAY,view:`part-${i}`,
      })
      expect(visible.length).toBeGreaterThan(0)
      for(const index of visible)expect(overlay.half[index]).toBe(i)
    }
  })
  it('four-part release uses two split axes and the exact sequential part order',()=>{
    for(const axis of ['x','y','z'] as const){
      const s={...DEFAULT_MOLD_SETTINGS,parts:4 as const,splitAxis:axis,
        splitPosition:0.35,analyzeDraft:true}
      const partition=moldDraftPartition(master,s)
      const second=axis==='x'?'y':'x'
      expect(partition.layout).toBe('four-part')
      expect(partition.regions).toHaveLength(4)
      expect(partition.regions.map(r=>r.label)).toEqual([
        `Part 1 (−${axis.toUpperCase()}, −${second.toUpperCase()})`,
        `Part 2 (−${axis.toUpperCase()}, +${second.toUpperCase()})`,
        `Part 3 (+${axis.toUpperCase()}, −${second.toUpperCase()})`,
        `Part 4 (+${axis.toUpperCase()}, +${second.toUpperCase()})`,
      ])
      for(const region of partition.regions)
        expect(Math.hypot(...region.release)).toBeCloseTo(1,8)
      const report=analyzeMoldDraft(master,s)
      const overlay=buildMoldDraftOverlay(master,s)
      expect(report.regions).toHaveLength(4)
      expect(report.totalAreaMm2).toBeCloseTo(600,4)
      expect(new Set(overlay.half)).toEqual(new Set([0,1,2,3]))
    }
  })
  it('clipped source faces occupy exactly one radial sector at any interior point',()=>{
    const p=moldDraftPartition(master,{...DEFAULT_MOLD_SETTINGS,parts:3})
    let sum=0
    const seen=new Set<number>()
    const count=visitDraftFaces(master,p,face=>{
      sum+=face.areaMm2
      seen.add(face.partIndex)
      expect(face.partIndex).toBeGreaterThanOrEqual(0)
      expect(face.partIndex).toBeLessThan(3)
      expect(Number.isFinite(face.angleDeg)).toBe(true)
    })
    expect(count).toBe(master.indices.length/3)
    expect(seen).toEqual(new Set([0,1,2]))
    expect(sum).toBeCloseTo(600,4)
  })
})
