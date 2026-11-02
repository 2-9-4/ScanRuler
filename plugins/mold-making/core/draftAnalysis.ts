// SPDX-License-Identifier: AGPL-3.0-only
// Read-only draft diagnostic for a pair of opposite, axial release directions.
// This is a surface-normal screening tool, NOT a collision-free extraction
// proof: no ray/solid sweep, elastic deformation, shrinkage or tooling
// mechanics are modeled.
import type {Triangles} from '../../mesh-tools/core/boolean'
import type {SplitAxis} from './settings'

type P=[number,number,number]
export interface DraftSide {
  /** Surface area belonging to this side after clipping at the parting plane. */
  areaMm2:number
  /** Area whose outward normal faces against the withdrawal direction. */
  reverseFacingMm2:number
  /** Area below the requested positive draft angle, excluding reverse-facing. */
  lowDraftMm2:number
  adequateDraftMm2:number
  /** Signed local draft angle, with negative indicating a reverse face. */
  worstDraftDeg:number|null
}
export interface DraftAnalysis {
  axis:SplitAxis
  splitAtMm:number
  minimumDraftDeg:number
  /** Negative half withdraws along -axis, positive along +axis. */
  negative:DraftSide
  positive:DraftSide
  totalAreaMm2:number
  reverseFacingMm2:number
  lowDraftMm2:number
  assessedTriangles:number
  /** False: analysis does not prove release/demolding. */
  isExtractionProof:false
}
const emptySide=():DraftSide=>({
  areaMm2:0,reverseFacingMm2:0,lowDraftMm2:0,adequateDraftMm2:0,
  worstDraftDeg:null,
})
const coordinate=(axis:SplitAxis)=>axis==='x'?0:axis==='y'?1:2

/** Clip a triangle polygon against either side of a plane, retaining
 * interpolated intersection vertices. This avoids the large false area
 * errors from assigning entire crossing faces to their centroid's side.
 */
function clip(poly:readonly P[],axis:number,at:number,sign:1|-1):P[]{
  const inside=(p:P)=>sign*(p[axis]-at)>=-1e-10
  const result:P[]=[]
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length]
    const ai=inside(a),bi=inside(b)
    if(ai)result.push(a)
    if(ai!==bi){
      const t=(at-a[axis])/(b[axis]-a[axis])
      result.push([
        a[0]+(b[0]-a[0])*t,
        a[1]+(b[1]-a[1])*t,
        a[2]+(b[2]-a[2])*t,
      ])
    }
  }
  return result
}
function polygonArea(poly:readonly P[]):number {
  if(poly.length<3)return 0
  const [a]=poly
  let sum=0
  for(let i=1;i+1<poly.length;i++){
    const b=poly[i],c=poly[i+1]
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2]
    const vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2]
    sum+=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2
  }
  return sum
}

/** Reports source-surface draft relative to both halves of a planar
 * two-piece mold. Negative normals are only *potential* extraction
 * obstructions; positive draft alone never certifies release.
 */
export function analyzeTwoPartDraft(
  mesh:Triangles,axis:SplitAxis,splitAtMm:number,minimumDraftDeg=2,
):DraftAnalysis {
  if(!Number.isFinite(splitAtMm)||!Number.isFinite(minimumDraftDeg)||
     minimumDraftDeg<0||minimumDraftDeg>30)
    throw new Error('Draft analysis requires a valid split location and 0–30° threshold.')
  const k=coordinate(axis),p=mesh.positions,idx=mesh.indices
  const negative=emptySide(),positive=emptySide()
  let assessedTriangles=0
  const threshold=Math.sin(minimumDraftDeg*Math.PI/180)
  for(let i=0;i<idx.length;i+=3){
    const ia=idx[i]*3,ib=idx[i+1]*3,ic=idx[i+2]*3
    if(ic+2>=p.length||ib+2>=p.length||ia+2>=p.length)
      throw new Error('Draft analysis requires valid triangle indices.')
    const a:P=[p[ia],p[ia+1],p[ia+2]]
    const b:P=[p[ib],p[ib+1],p[ib+2]]
    const c:P=[p[ic],p[ic+1],p[ic+2]]
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2]
    const vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2]
    const normal:P=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx]
    const length=Math.hypot(...normal)
    if(!(length>1e-14))continue
    assessedTriangles++
    for(const [sign,report] of [[-1,negative],[1,positive]] as const){
      const area=polygonArea(clip([a,b,c],k,splitAtMm,sign))
      if(area<=1e-12)continue
      const cosine=Math.max(-1,Math.min(1,normal[k]/length*sign))
      const angle=Math.asin(cosine)*180/Math.PI
      report.areaMm2+=area
      report.worstDraftDeg=report.worstDraftDeg===null
        ?angle:Math.min(report.worstDraftDeg,angle)
      if(cosine < -1e-8)report.reverseFacingMm2+=area
      else if(cosine < threshold)report.lowDraftMm2+=area
      else report.adequateDraftMm2+=area
    }
  }
  return {
    axis,splitAtMm,minimumDraftDeg,negative,positive,
    totalAreaMm2:negative.areaMm2+positive.areaMm2,
    reverseFacingMm2:negative.reverseFacingMm2+positive.reverseFacingMm2,
    lowDraftMm2:negative.lowDraftMm2+positive.lowDraftMm2,
    assessedTriangles,isExtractionProof:false,
  }
}
