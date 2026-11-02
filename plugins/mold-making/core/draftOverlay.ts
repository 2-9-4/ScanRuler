// SPDX-License-Identifier: AGPL-3.0-only
// The diagnostic surface is the triangulated, analyzed source model, NOT a
// rendered mold STL. Cross-split faces are clipped into two separate colored
// surfaces so each side carries the correct signed draft angle.
import type {Triangles} from '../../mesh-tools/core/boolean'
import type {SplitAxis} from './settings'

type V3=[number,number,number]
export type DraftHalf='negative'|'positive'
export type DraftView='both'|DraftHalf
export type DraftColorMode='classes'|'heatmap'
export type DraftClass='reverse'|'low'|'adequate'
export interface DraftOverlayData {
  /** Unindexed triangles in source/model coordinates. */
  positions:Float32Array
  /** One byte per output triangle: 0 negative / 1 positive. */
  half:Uint8Array
  /** Signed per-triangle angle in degrees, measured against half withdrawal. */
  angleDeg:Float32Array
  /** Index into the triangulated source model, for hover inspection. */
  sourceTriangle:Uint32Array
}
export interface DraftDisplayOptions {
  show:boolean
  view:DraftView
  mode:DraftColorMode
  problemsOnly:boolean
  opacity:number
  thresholdDeg:number
}
export const DEFAULT_DRAFT_DISPLAY:Readonly<DraftDisplayOptions>=Object.freeze({
  show:true,view:'both',mode:'classes',problemsOnly:false,opacity:0.94,thresholdDeg:2,
})
const axisIndex=(axis:SplitAxis)=>axis==='x'?0:axis==='y'?1:2

function clip(poly:readonly V3[],k:number,at:number,sign:1|-1):V3[]{
  const inside=(p:V3)=>sign*(p[k]-at)>=-1e-9
  const out:V3[]=[]
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],ai=inside(a),bi=inside(b)
    if(ai)out.push(a)
    if(ai!==bi){
      const denom=b[k]-a[k]
      if(Math.abs(denom)<1e-15)continue
      const t=(at-a[k])/denom
      out.push([
        a[0]+t*(b[0]-a[0]),
        a[1]+t*(b[1]-a[1]),
        a[2]+t*(b[2]-a[2]),
      ])
    }
  }
  return out
}
function area2(a:V3,b:V3,c:V3):number{
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2]
  const vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2]
  return Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)
}
/** All geometry is read-only. A triangle straddling the release plane can
 * yield one polygon/triangle in one half and a quadrilateral/two triangles
 * in the other. Each output face retains its source face id.
 */
export function buildDraftOverlay(
  mesh:Triangles,axis:SplitAxis,splitAtMm:number,
):DraftOverlayData{
  if(!Number.isFinite(splitAtMm))throw new Error('Draft overlay requires a finite split location.')
  const k=axisIndex(axis),p=mesh.positions,idx=mesh.indices
  const vertices:number[]=[],halves:number[]=[],angles:number[]=[],ids:number[]=[]
  for(let i=0;i<idx.length;i+=3){
    const ai=idx[i]*3,bi=idx[i+1]*3,ci=idx[i+2]*3
    if(ai+2>=p.length||bi+2>=p.length||ci+2>=p.length)
      throw new Error('Draft overlay source has invalid triangle indices.')
    const a:V3=[p[ai],p[ai+1],p[ai+2]]
    const b:V3=[p[bi],p[bi+1],p[bi+2]]
    const c:V3=[p[ci],p[ci+1],p[ci+2]]
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2]
    const vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2]
    const n:V3=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx]
    const length=Math.hypot(...n)
    if(!(length>1e-14))continue
    for(const sign of [-1,1] as const){
      const polygon=clip([a,b,c],k,splitAtMm,sign)
      const cosine=Math.max(-1,Math.min(1,sign*n[k]/length))
      const angle=Math.asin(cosine)*180/Math.PI
      for(let j=1;j+1<polygon.length;j++){
        const [aa,bb,cc]=[polygon[0],polygon[j],polygon[j+1]]
        if(area2(aa,bb,cc)<=1e-13)continue
        vertices.push(...aa,...bb,...cc)
        halves.push(sign===-1?0:1)
        angles.push(angle)
        ids.push(i/3)
      }
    }
  }
  return {positions:Float32Array.from(vertices),half:Uint8Array.from(halves),
    angleDeg:Float32Array.from(angles),sourceTriangle:Uint32Array.from(ids)}
}
export function draftClass(angle:number,threshold:number):DraftClass{
  return angle< -1e-6?'reverse':angle<threshold?'low':'adequate'
}
/** The colors are deliberately perceptually distinct, not interpolated
 * across neighboring source triangles or across opposite mold halves. */
export function draftFaceRgb(angle:number,threshold:number,mode:DraftColorMode):[number,number,number]{
  if(mode==='classes'){
    const cls=draftClass(angle,threshold)
    return cls==='reverse'?[0.91,0.14,0.15]:cls==='low'?[1,0.66,0.1]:[0.16,0.76,0.46]
  }
  // Continuous signed-angle map: negative angles red, near-zero orange,
  // insufficient positive yellow, sufficient positive green.
  if(angle<0){
    const t=Math.min(1,Math.max(0,(angle+45)/45))
    return [0.88+0.12*t,0.12+0.35*t,0.17]
  }
  if(angle<threshold){
    const t=threshold>0?angle/threshold:1
    return [1,0.5+0.27*t,0.06+0.06*t]
  }
  const t=Math.min(1,(angle-threshold)/Math.max(1,45-threshold))
  return [0.64-0.47*t,0.79-0.04*t,0.19+0.28*t]
}
export function draftVisibleFaces(data:DraftOverlayData,opts:DraftDisplayOptions):Uint32Array{
  const result:number[]=[]
  for(let i=0;i<data.angleDeg.length;i++){
    if(opts.view==='negative'&&data.half[i]!==0||
       opts.view==='positive'&&data.half[i]!==1)continue
    if(opts.problemsOnly&&draftClass(data.angleDeg[i],opts.thresholdDeg)==='adequate')continue
    result.push(i)
  }
  return Uint32Array.from(result)
}
