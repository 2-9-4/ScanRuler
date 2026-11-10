// SPDX-License-Identifier: AGPL-3.0-only
// Read-only, area-weighted normal screening for each physical mold part.
// Not a proof of collision-free extraction; see draftPartitions.ts.
import type {Triangles} from '../../mesh-tools/core/boolean'
import type {MoldSettings,SplitAxis} from './settings'
import {
  moldDraftPartition,twoPartDraftRegions,visitDraftFaces,
  type DraftPartition,type V3,
} from './draftPartitions'

export interface DraftSide {
  areaMm2:number
  reverseFacingMm2:number
  lowDraftMm2:number
  adequateDraftMm2:number
  worstDraftDeg:number|null
}
export interface DraftPart extends DraftSide {
  label:string
  /** Direction the corresponding tooling part is assumed to move outward. */
  release:V3
}
export interface DraftAnalysis {
  layout:DraftPartition['layout']
  axis:SplitAxis
  splitAtMm:number
  minimumDraftDeg:number
  /** Ordered exactly as printable parts (excluding additional detached islands). */
  regions:DraftPart[]
  /** Compatibility aliases for two-part consumers. Use regions for other layouts. */
  negative:DraftSide
  positive:DraftSide
  totalAreaMm2:number
  reverseFacingMm2:number
  lowDraftMm2:number
  assessedTriangles:number
  isExtractionProof:false
}
const emptySide=():DraftSide=>({
  areaMm2:0,reverseFacingMm2:0,lowDraftMm2:0,adequateDraftMm2:0,worstDraftDeg:null,
})
export function analyzeDraftPartition(
  mesh:Triangles,partition:DraftPartition,minimumDraftDeg=2,
):DraftAnalysis{
  if(!Number.isFinite(minimumDraftDeg)||minimumDraftDeg<0||minimumDraftDeg>30)
    throw new Error('Draft analysis requires a valid split location and 0–30° threshold.')
  const regions:DraftPart[]=partition.regions.map(spec=>({
    ...emptySide(),label:spec.label,release:spec.release,
  }))
  const assessedTriangles=visitDraftFaces(mesh,partition,face=>{
    const report=regions[face.partIndex],area=face.areaMm2,angle=face.angleDeg
    report.areaMm2+=area
    report.worstDraftDeg=report.worstDraftDeg===null
      ?angle:Math.min(report.worstDraftDeg,angle)
    if(angle< -1e-6)report.reverseFacingMm2+=area
    else if(angle<minimumDraftDeg)report.lowDraftMm2+=area
    else report.adequateDraftMm2+=area
  })
  return {
    layout:partition.layout,axis:partition.axis,splitAtMm:partition.splitAtMm,
    minimumDraftDeg,regions,
    negative:regions[0]??emptySide(),positive:regions[1]??emptySide(),
    totalAreaMm2:regions.reduce((n,r)=>n+r.areaMm2,0),
    reverseFacingMm2:regions.reduce((n,r)=>n+r.reverseFacingMm2,0),
    lowDraftMm2:regions.reduce((n,r)=>n+r.lowDraftMm2,0),
    assessedTriangles,isExtractionProof:false,
  }
}
/** Retained for callers analyzing two opposing planar half molds. */
export function analyzeTwoPartDraft(
  mesh:Triangles,axis:SplitAxis,splitAtMm:number,minimumDraftDeg=2,
):DraftAnalysis {
  if(!Number.isFinite(splitAtMm))
    throw new Error('Draft analysis requires a valid split location and 0–30° threshold.')
  return analyzeDraftPartition(mesh,twoPartDraftRegions(axis,splitAtMm),minimumDraftDeg)
}
/** All direct-print mold layouts: one-sided impression, two planar halves,
 * 120-degree threefold sectors and orthogonal four-part tooling.
 */
export function analyzeMoldDraft(mesh:Triangles,s:MoldSettings):DraftAnalysis {
  return analyzeDraftPartition(mesh,moldDraftPartition(mesh,s),s.minimumDraftDeg)
}
