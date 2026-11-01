// SPDX-License-Identifier: AGPL-3.0-only
// Conservative 2D silhouette in the mold's parting plane. The convex hull
// deliberately ignores small concavities so the ridge never enters the
// casting cavity. A rounded outward parallel curve follows that rough
// silhouette instead of putting registration into the corners of the block.
import type { SolidMesh } from '../../../src/app/solids'
import type { SplitAxis } from './settings'
import type { Triangles } from '../../mesh-tools/core/boolean'

type P=[number,number]
const cross=(o:P,a:P,b:P)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
const distance=(a:P,b:P)=>Math.hypot(a[0]-b[0],a[1]-b[1])
export const planeAxes=(axis:SplitAxis):[number,number,number]=>axis==='x'?[0,1,2]:axis==='y'?[1,0,2]:[2,0,1]

/** Convex projected boundary, counterclockwise. Samples a capped number of
 * vertices because this is only the coarse outline, not a precision cavity.
 */
export function projectedHull(mesh:SolidMesh,axis:SplitAxis):P[]{
  const [,u,v]=planeAxes(axis),p=mesh.positions
  const stride=Math.max(1,Math.ceil(p.length/3/30_000))
  const seen=new Map<string,P>()
  for(let i=0;i<p.length/3;i+=stride){
    const a=p[3*i+u],b=p[3*i+v]
    if(Number.isFinite(a)&&Number.isFinite(b))seen.set(`${a},${b}`,[a,b])
  }
  const points=[...seen.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1])
  if(points.length<3)throw new Error('Cannot follow the silhouette: projected target has fewer than three distinct points.')
  const lower:P[]=[],upper:P[]=[]
  for(const p of points){
    while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=1e-9)lower.pop()
    lower.push(p)
  }
  for(let i=points.length-1;i>=0;i--){
    const p=points[i]
    while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=1e-9)upper.pop()
    upper.push(p)
  }
  lower.pop();upper.pop()
  const hull=[...lower,...upper]
  if(hull.length<3)throw new Error('Cannot build a contour registration seam from a flat projection.')
  return hull
}

/** Rounded outward parallel curve of a convex silhouette. No miter spikes at
 * box corners; the maximum offset in either axis is precisely the radius.
 * Individual samples are separated by the target resolution along long edges.
 */
export function contourAround(hull:readonly P[],offset:number,spacing=3):P[]{
  if(!(offset>0))throw new Error('Contour offset must be positive.')
  const n=hull.length
  const result:P[]=[]
  for(let i=0;i<n;i++){
    const before=hull[(i+n-1)%n],at=hull[i],after=hull[(i+1)%n]
    const lenBefore=distance(before,at),lenAfter=distance(at,after)
    if(lenBefore<1e-8||lenAfter<1e-8)continue
    const start=Math.atan2(-(at[0]-before[0]),at[1]-before[1])
    const finish=Math.atan2(-(after[0]-at[0]),after[1]-at[1])
    const span=(finish-start+2*Math.PI)%(2*Math.PI)
    const steps=Math.max(1,Math.ceil(span/(Math.PI/12)))
    for(let j=0;j<=steps;j++){
      const t=start+span*j/steps
      const point:P=[at[0]+Math.cos(t)*offset,at[1]+Math.sin(t)*offset]
      if(!result.length||distance(result[result.length-1],point)>1e-5)result.push(point)
    }
    // Subdivide straight portions as well. The resulting polygonal tube
    // follows the long edge without introducing changes in normal.
    const normal:P=[(after[1]-at[1])/lenAfter,-(after[0]-at[0])/lenAfter]
    const sub=Math.max(1,Math.ceil(lenAfter/Math.max(1,spacing)))
    for(let j=1;j<sub;j++){
      const t=j/sub
      result.push([at[0]+(after[0]-at[0])*t+normal[0]*offset,
        at[1]+(after[1]-at[1])*t+normal[1]*offset])
    }
  }
  if(result.length>1&&distance(result[0],result[result.length-1])<1e-5)result.pop()
  if(result.length<3)throw new Error('Contour registration seam has too few usable points.')
  return result
}

/** Single closed triangular tube following a ring in the parting plane.
 * The ridge is embedded into the negative half and projects into positive.
 * The matching groove uses the same centreline but a wider/deeper profile.
 */
export function triangularContourTube(
  path:readonly P[],axis:SplitAxis,split:number,halfWidth:number,
  back:number,front:number,closed=true,
):Triangles {
  if(path.length<3||halfWidth<=0||!(front>back))throw new Error('Invalid V-seam geometry.')
  const [k,u,v]=planeAxes(axis)
  const pos=new Float32Array(path.length*9)
  const indexed=new Uint32Array((closed?path.length:path.length-1)*18+(closed?0:6))
  const put=(i:number,slot:number,x:number,y:number,normalPos:number)=>{
    const j=(i*3+slot)*3
    pos[j+k]=normalPos;pos[j+u]=x;pos[j+v]=y
  }
  for(let i=0;i<path.length;i++){
    const prev=path[closed?(i+path.length-1)%path.length:Math.max(0,i-1)]
    const next=path[closed?(i+1)%path.length:Math.min(path.length-1,i+1)]
    const dx=next[0]-prev[0],dy=next[1]-prev[1]
    const d=Math.hypot(dx,dy)
    if(d<1e-8)throw new Error('V-seam contour contains coincident points.')
    const nx=dy/d,ny=-dx/d
    const p=path[i]
    put(i,0,p[0]+nx*halfWidth,p[1]+ny*halfWidth,split+back)
    put(i,1,p[0]-nx*halfWidth,p[1]-ny*halfWidth,split+back)
    put(i,2,p[0],p[1],split+front)
  }
  let cursor=0
  for(let i=0;i<(closed?path.length:path.length-1);i++){
    const j=(i+1)%path.length
    for(const [a,b] of [[0,1],[1,2],[2,0]]){
      const x=i*3+a,y=i*3+b,z=j*3+a,w=j*3+b
      indexed[cursor++]=x;indexed[cursor++]=y;indexed[cursor++]=z
      indexed[cursor++]=z;indexed[cursor++]=y;indexed[cursor++]=w
    }
  }
  if(!closed){
    // An open U-profile on a silicone box has solid caps at both ends.
    indexed[cursor++]=0;indexed[cursor++]=2;indexed[cursor++]=1
    const end=(path.length-1)*3
    indexed[cursor++]=end;indexed[cursor++]=end+1;indexed[cursor++]=end+2
  }
  // Ring direction and its 3D axis can flip the mesh's handedness.
  // Select outward winding from the exact signed volume.
  const origin=[pos[0],pos[1],pos[2]]
  let vol6=0
  for(let i=0;i<indexed.length;i+=3){
    const a=indexed[i]*3,b=indexed[i+1]*3,c=indexed[i+2]*3
    const ax=pos[a]-origin[0],ay=pos[a+1]-origin[1],az=pos[a+2]-origin[2]
    const bx=pos[b]-origin[0],by=pos[b+1]-origin[1],bz=pos[b+2]-origin[2]
    const cx=pos[c]-origin[0],cy=pos[c+1]-origin[1],cz=pos[c+2]-origin[2]
    vol6+=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx)
  }
  if(!(Math.abs(vol6)>1e-8))throw new Error('V-seam volume vanished; increase its width.')
  if(vol6<0)for(let i=0;i<indexed.length;i+=3){
    const x=indexed[i+1];indexed[i+1]=indexed[i+2];indexed[i+2]=x
  }
  return {positions:pos,indices:indexed}
}
