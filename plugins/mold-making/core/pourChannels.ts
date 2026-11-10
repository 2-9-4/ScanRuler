// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in direct-mold channels. All planning/preflight is deterministic and
// read-only; the source model and successful legacy mold recipes are untouched.
import type {Triangles} from '../../mesh-tools/core/boolean'
import type {MoldSettings,SplitAxis} from './settings'

type V3=[number,number,number]
type Bounds={min:V3;max:V3}
export interface VerticalChannel {
  kind:'pour'|'vent'
  x:number;y:number
  /** Bottom overlaps the actual casting surface by a small safe distance. */
  bottomZ:number
  topZ:number
  diameter:number
  funnelDiameter:number
  funnelDepth:number
}

/** The highest intersection of a +Z ray through a triangulated master.
 * A projected bounding-box test alone would let channels miss hollow,
 * horseshoe or highly concave models. Vertical faces have zero XY area.
 */
export function topSurfaceAt(mesh:Triangles,x:number,y:number):number|null {
  const p=mesh.positions,idx=mesh.indices
  let highest=-Infinity
  for(let i=0;i<idx.length;i+=3){
    const a=3*idx[i],b=3*idx[i+1],c=3*idx[i+2]
    const ax=p[a],ay=p[a+1],bx=p[b],by=p[b+1],cx=p[c],cy=p[c+1]
    const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
    if(Math.abs(den)<1e-12)continue
    const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den
    const v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den
    const w=1-u-v
    if(u < -1e-8||v < -1e-8||w < -1e-8)continue
    const z=u*p[a+2]+v*p[b+2]+w*p[c+2]
    if(Number.isFinite(z)&&z>highest)highest=z
  }
  return Number.isFinite(highest)?highest:null
}

function avoidPartingPlanes(
  x:number,y:number,r:number,s:MoldSettings,b:Bounds,
):void {
  const clearance=r+0.75
  const min=b.min,max=b.max
  if(s.parts===3){
    const cx=(min[0]+max[0])/2,cy=(min[1]+max[1])/2
    const dx=x-cx,dy=y-cy
    const hubDistance=Math.hypot(dx,dy)
    for(const degrees of [0,120,240]){
      const angle=degrees*Math.PI/180
      // Each threefold parting interface is a RAY from the hub, not an
      // infinite line. Behind its origin the closest point on that seam
      // is the hub itself; testing line distance rejects valid channels
      // centered inside the opposite radial sector.
      const along=dx*Math.cos(angle)+dy*Math.sin(angle)
      const distance=along>=0
        ?Math.abs(dx*Math.sin(angle)-dy*Math.cos(angle))
        :hubDistance
      if(distance<=clearance)throw new Error(
        'A casting channel intersects a radial parting interface. Move its XY point farther into one of the three sectors or reduce its diameter.')
    }
    return
  }
  const check=(axis:SplitAxis,at:number)=>{
    if(axis==='x'&&Math.abs(x-at)<=clearance||
       axis==='y'&&Math.abs(y-at)<=clearance)
      throw new Error('A casting channel overlaps a parting plane or registration. Move its XY point away from the seam or reduce its diameter.')
  }
  const k=s.splitAxis==='x'?0:s.splitAxis==='y'?1:2
  check(s.splitAxis,min[k]+(max[k]-min[k])*s.splitPosition)
  if(s.parts===4){
    const other:SplitAxis=s.splitAxis==='x'?'y':'x'
    const j=other==='x'?0:1
    check(other,(min[j]+max[j])/2)
  }
}

/** Preflight each channel against actual surface triangles, neighboring
 * channels, exterior material and parting planes before any Boolean.
 * A failed plan produces no exported mold rather than a blind cavity.
 */
export function planVerticalChannels(
  mesh:Triangles,target:Bounds,outer:Bounds,
  s:MoldSettings,radialOuter?:{cx:number;cy:number;radius:number},
):VerticalChannel[]{
  if(!s.pourEnabled&&!s.ventsEnabled)return []
  if(s.mode!=='direct'||s.parts===1)
    throw new Error('Vertical casting channels currently require multipart direct molds.')
  const result:VerticalChannel[]=[]
  const points:{kind:'pour'|'vent';point:[number,number];diameter:number;funnel:number;depth:number}[]=[]
  if(s.pourEnabled)points.push({kind:'pour',point:s.pourPoint,diameter:s.pourDiameter,
    funnel:s.pourFunnelDiameter,depth:s.pourFunnelDepth})
  if(s.ventsEnabled)for(const point of s.ventPoints)
    points.push({kind:'vent',point,diameter:s.ventDiameter,funnel:s.ventDiameter,depth:0})
  for(const item of points){
    const [fx,fy]=item.point
    const x=target.min[0]+fx*(target.max[0]-target.min[0])
    const y=target.min[1]+fy*(target.max[1]-target.min[1])
    const z=topSurfaceAt(mesh,x,y)
    if(z===null)throw new Error(
      `${item.kind==='pour'?'Pour channel':'Air vent'} at (${Math.round(100*fx)}%, ${Math.round(100*fy)}%) misses the master surface. Move the XY point to a filled area of the model.`)
    const outerRadius=item.funnel/2
    const lip=0.6
    if(radialOuter){
      const d=Math.hypot(x-radialOuter.cx,y-radialOuter.cy)
      if(d+outerRadius+lip>=radialOuter.radius)
        throw new Error('Casting funnel would break through the radial mold side. Move it inward or reduce funnel diameter.')
    }else if(x-outerRadius-lip<=outer.min[0]||x+outerRadius+lip>=outer.max[0]||
             y-outerRadius-lip<=outer.min[1]||y+outerRadius+lip>=outer.max[1])
      throw new Error('Casting funnel would break through the mold side wall. Move it inward or reduce funnel diameter.')
    avoidPartingPlanes(x,y,outerRadius,s,target)
    if(result.some(p=>Math.hypot(p.x-x,p.y-y)<
      (p.funnelDiameter+item.funnel)/2+1))
      throw new Error('Casting channels overlap. Move pour and vent XY positions farther apart.')
    const roof=outer.max[2]-z
    if(roof<item.depth+1.25)throw new Error(
      'Not enough solid roof above the casting for the requested funnel depth. Reduce its depth or add extra top material.')
    result.push({
      kind:item.kind,x,y,diameter:item.diameter,
      bottomZ:z-0.6,topZ:outer.max[2]+0.5,
      funnelDiameter:item.funnel,funnelDepth:item.depth,
    })
  }
  return result
}
