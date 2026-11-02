// SPDX-License-Identifier: AGPL-3.0-only
// Shared, exact planar partitions for read-only mold-release diagnostics.
// Region order matches splitThreefold() and the successive splits in buildMold.
// Draft is a local *surface-normal* screen, not a swept-volume release proof.
import type {Triangles} from '../../mesh-tools/core/boolean'
import type {MoldSettings,SplitAxis} from './settings'

export type V3=[number,number,number]
export type DraftPlane={normal:V3;offset:number}
export interface DraftRegionSpec {
  label:string
  release:V3
  planes:DraftPlane[]
}
export interface DraftPartition {
  layout:'impression'|'two-part'|'threefold'|'four-part'
  axis:SplitAxis
  splitAtMm:number
  regions:DraftRegionSpec[]
}
const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const plus=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]]
const unit=(a:V3):V3=>{const m=Math.hypot(...a);return [a[0]/m,a[1]/m,a[2]/m]}
const axisVector=(axis:SplitAxis,sign:1|-1):V3=>axis==='x'?[sign,0,0]:axis==='y'?[0,sign,0]:[0,0,sign]
const axisIndex=(axis:SplitAxis)=>axis==='x'?0:axis==='y'?1:2
const axisPlane=(axis:SplitAxis,at:number,sign:1|-1):DraftPlane=>{
  const normal=axisVector(axis,sign)
  return {normal,offset:sign*at}
}
const axisLabel=(axis:SplitAxis,sign:1|-1)=>
  `${sign<0?'−':'+'}${axis.toUpperCase()}`
function extents(mesh:Triangles):{min:V3;max:V3}{
  const min:V3=[Infinity,Infinity,Infinity],max:V3=[-Infinity,-Infinity,-Infinity]
  for(let i=0;i<mesh.positions.length;i+=3)for(let k=0;k<3;k++){
    min[k]=Math.min(min[k],mesh.positions[i+k])
    max[k]=Math.max(max[k],mesh.positions[i+k])
  }
  if(min.some(v=>!Number.isFinite(v)))throw new Error('Draft screening needs source vertices.')
  return {min,max}
}
export function twoPartDraftRegions(axis:SplitAxis,at:number):DraftPartition{
  return {
    layout:'two-part',axis,splitAtMm:at,
    regions:([-1,1] as const).map(sign=>({
      label:`${axisLabel(axis,sign)} half`,
      release:axisVector(axis,sign),planes:[axisPlane(axis,at,sign)],
    })),
  }
}
export function moldDraftPartition(mesh:Triangles,s:MoldSettings):DraftPartition {
  if(s.mode!=='direct')throw new Error('Draft screening currently requires direct molds.')
  const {min,max}=extents(mesh),k=axisIndex(s.splitAxis)
  const splitAt=min[k]+(max[k]-min[k])*s.splitPosition
  if(s.parts===1){
    const opening=(min[2]+max[2])/2
    return {layout:'impression',axis:'z',splitAtMm:opening,regions:[{
      label:'Lower impression (−Z)',release:[0,0,-1],
      planes:[axisPlane('z',opening,-1)],
    }]}
  }
  if(s.parts===2)return twoPartDraftRegions(s.splitAxis,splitAt)
  if(s.parts===3){
    const cx=(min[0]+max[0])/2,cy=(min[1]+max[1])/2
    const regions:DraftRegionSpec[]=[]
    for(let sector=0;sector<3;sector++){
      const lo=sector*2*Math.PI/3,hi=(sector+1)*2*Math.PI/3
      const left:V3=[-Math.sin(lo),Math.cos(lo),0]
      const right:V3=[Math.sin(hi),-Math.cos(hi),0]
      const mid=(lo+hi)/2
      regions.push({
        label:`Sector ${sector+1} (${Math.round(mid*180/Math.PI)}°)`,
        release:[Math.cos(mid),Math.sin(mid),0],
        planes:[{normal:left,offset:dot(left,[cx,cy,0])},
          {normal:right,offset:dot(right,[cx,cy,0])}],
      })
    }
    return {layout:'threefold',axis:'z',splitAtMm:0,regions}
  }
  // Exactly mirrors buildMold: first split gives negative,positive; each
  // then undergoes negative,positive secondary split, in that order.
  const second:SplitAxis=s.splitAxis==='x'?'y':'x'
  const j=axisIndex(second),secondaryAt=(min[j]+max[j])/2
  const regions:DraftRegionSpec[]=[]
  for(const primary of [-1,1] as const)for(const secondary of [-1,1] as const){
    const a=axisVector(s.splitAxis,primary),b=axisVector(second,secondary)
    regions.push({
      label:`Part ${regions.length+1} (${axisLabel(s.splitAxis,primary)}, ${axisLabel(second,secondary)})`,
      release:unit(plus(a,b)),
      planes:[axisPlane(s.splitAxis,splitAt,primary),axisPlane(second,secondaryAt,secondary)],
    })
  }
  return {layout:'four-part',axis:s.splitAxis,splitAtMm:splitAt,regions}
}
/** Sutherland–Hodgman clipping in source coordinates, matching the planar
 * side selection used by the mold's Boolean splitting operations.
 */
export function clipDraftPolygon(poly:readonly V3[],plane:DraftPlane):V3[]{
  const out:V3[]=[]
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length]
    const da=dot(a,plane.normal)-plane.offset
    const db=dot(b,plane.normal)-plane.offset
    const insideA=da>=-1e-9,insideB=db>=-1e-9
    if(insideA)out.push(a)
    if(insideA!==insideB){
      const t=da/(da-db)
      out.push([a[0]+t*(b[0]-a[0]),
        a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])])
    }
  }
  return out
}
export interface DraftFace {
  a:V3;b:V3;c:V3
  partIndex:number
  angleDeg:number
  areaMm2:number
  sourceTriangle:number
}
/** Visits the clipped triangles in each part, preserving face orientation.
 * The parting plane has zero surface area and is not counted twice.
 */
export function visitDraftFaces(mesh:Triangles,partition:DraftPartition,
  visitor:(face:DraftFace)=>void):number{
  const p=mesh.positions,idx=mesh.indices
  let assessed=0
  for(let i=0;i<idx.length;i+=3){
    const ia=idx[i]*3,ib=idx[i+1]*3,ic=idx[i+2]*3
    if(ia<0||ib<0||ic<0||ia+2>=p.length||ib+2>=p.length||ic+2>=p.length)
      throw new Error('Draft screening received invalid triangle indices.')
    const a:V3=[p[ia],p[ia+1],p[ia+2]]
    const b:V3=[p[ib],p[ib+1],p[ib+2]]
    const c:V3=[p[ic],p[ic+1],p[ic+2]]
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2]
    const vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2]
    const normal:V3=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx]
    const length=Math.hypot(...normal)
    if(!(length>1e-14))continue
    assessed++
    for(let partIndex=0;partIndex<partition.regions.length;partIndex++){
      const region=partition.regions[partIndex]
      let poly:V3[]=[a,b,c]
      for(const plane of region.planes){
        poly=clipDraftPolygon(poly,plane)
        if(poly.length<3)break
      }
      if(poly.length<3)continue
      const cosine=Math.max(-1,Math.min(1,dot(normal,region.release)/length))
      const angleDeg=Math.asin(cosine)*180/Math.PI
      for(let j=1;j+1<poly.length;j++){
        const aa=poly[0],bb=poly[j],cc=poly[j+1]
        const u:V3=[bb[0]-aa[0],bb[1]-aa[1],bb[2]-aa[2]]
        const v:V3=[cc[0]-aa[0],cc[1]-aa[1],cc[2]-aa[2]]
        const area=Math.hypot(
          u[1]*v[2]-u[2]*v[1],
          u[2]*v[0]-u[0]*v[2],
          u[0]*v[1]-u[1]*v[0])/2
        if(area<=1e-12)continue
        visitor({a:aa,b:bb,c:cc,partIndex,angleDeg,areaMm2:area,sourceTriangle:i/3})
      }
    }
  }
  return assessed
}
