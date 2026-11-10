// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid} from '../core/geometry'
import {analyzeTwoPartDraft} from '../core/draftAnalysis'

describe('Read-only two-part surface draft screening (MOLD-013)',()=>{
  it('reports zero reverse-facing area on a convex cube and flags zero-draft walls',()=>{
    const cube=boxSolid({min:[-5,-5,-5],max:[5,5,5]})
    for(const axis of ['x','y','z'] as const){
      const report=analyzeTwoPartDraft(cube,axis,0,2)
      expect(report.isExtractionProof).toBe(false)
      expect(report.totalAreaMm2).toBeCloseTo(600,5)
      expect(report.negative.areaMm2).toBeCloseTo(300,5)
      expect(report.positive.areaMm2).toBeCloseTo(300,5)
      expect(report.reverseFacingMm2).toBeCloseTo(0,5)
      expect(report.lowDraftMm2).toBeGreaterThan(300)
      expect(report.lowDraftMm2).toBeLessThan(500)
    }
  })
  it('clips triangles crossing the parting plane instead of assigning by centroid',()=>{
    const triangle={positions:Float32Array.from([
      -1,0,0, 1,0,0, 1,2,0,
    ]),indices:Uint32Array.from([0,1,2])}
    const report=analyzeTwoPartDraft(triangle,'x',0,2)
    expect(report.totalAreaMm2).toBeCloseTo(2)
    expect(report.negative.areaMm2).toBeCloseTo(0.5)
    expect(report.positive.areaMm2).toBeCloseTo(1.5)
    expect(report.lowDraftMm2).toBeCloseTo(2)
    expect(report.reverseFacingMm2).toBeCloseTo(0)
  })
  it('identifies reverse-facing facets for each half of a nonconvex profile',()=>{
    // An outward -X face on the positive half and outward +X on the
    // negative half represent two opposite overhanging cavity surfaces.
    const mesh={positions:Float32Array.from([
      2,0,0, 2,0,1, 2,1,0,
      -2,0,0, -2,1,0, -2,0,1,
    ]),indices:Uint32Array.from([0,1,2,3,4,5])}
    const report=analyzeTwoPartDraft(mesh,'x',0,2)
    expect(report.reverseFacingMm2).toBeCloseTo(1)
    expect(report.positive.reverseFacingMm2).toBeCloseTo(0.5)
    expect(report.negative.reverseFacingMm2).toBeCloseTo(0.5)
    expect(report.lowDraftMm2).toBeCloseTo(0)
    expect(report.positive.worstDraftDeg).toBeCloseTo(-90)
    expect(report.negative.worstDraftDeg).toBeCloseTo(-90)
  })
  it('treats near-parallel walls as low draft, not as proven undercuts',()=>{
    const face={positions:Float32Array.from([
      2,0,0, 2,1,0, 2,1,1,
    ]),indices:Uint32Array.from([0,1,2])}
    // Positive-X facing normal: adequate draft when releasing toward +X.
    const report=analyzeTwoPartDraft(face,'x',0,2)
    expect(report.positive.adequateDraftMm2).toBeCloseTo(0.5)
    expect(report.positive.reverseFacingMm2).toBe(0)
    expect(report.negative.areaMm2).toBe(0)
    expect(()=>analyzeTwoPartDraft(face,'x',0,-1)).toThrow(/threshold/)
    expect(()=>analyzeTwoPartDraft(face,'x',0,31)).toThrow(/threshold/)
  })
})
