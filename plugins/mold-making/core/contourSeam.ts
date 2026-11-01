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

/** Counterclockwise convex hull of arbitrary 2D points. Also used for the
 * radial/vertical silhouettes of threefold molds, whose projected axes are
 * not one of the three world-aligned parting planes. */
function convexHull(input:readonly P[]):P[]{
  const points=[...input].sort((a,b)=>a[0]-b[0]||a[1]-b[1])
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
  return convexHull([...seen.values()])
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

/** Select the longest connected piece of an outline in the allowed
 * tangent interval. Each of the four-part interfaces receives only its own
 * partial seam; its ends stop short of the perpendicular parting plane.
 * A full outline stays closed. Supports clipped straight segments rather
 * than dropping vertices and leaving large jumps in the new open boundary.
 */
export function contourSegment(
  path:readonly P[],low:number,high:number,closed=true,
):{path:P[];closed:boolean}{
  if(!(high>low))throw new Error('No room for a contour between parting planes.')
  if(path.every(p=>p[0]>=low&&p[0]<=high))return {path:[...path],closed}
  const n=closed?path.length:path.length-1
  const lines:P[][]=[]
  let run:P[]=[]
  const append=(p:P)=>{
    if(!run.length||distance(run[run.length-1],p)>1e-6)run.push(p)
  }
  for(let i=0;i<n;i++){
    const a=path[i],b=path[(i+1)%path.length],dx=b[0]-a[0]
    let t0=0,t1=1
    if(Math.abs(dx)<1e-12){
      if(a[0]<low||a[0]>high){if(run.length>1)lines.push(run);run=[];continue}
    }else{
      const tLo=(low-a[0])/dx,tHi=(high-a[0])/dx
      t0=Math.max(0,Math.min(tLo,tHi))
      t1=Math.min(1,Math.max(tLo,tHi))
    }
    if(t1<t0-1e-8){
      if(run.length>1)lines.push(run)
      run=[];continue
    }
    const point=(t:number):P=>[a[0]+dx*t,a[1]+(b[1]-a[1])*t]
    append(point(t0));append(point(t1))
    if(t1<1-1e-8){if(run.length>1)lines.push(run);run=[]}
  }
  if(run.length>1)lines.push(run)
  // A circular outline can have a run crossing the list boundary.
  if(closed&&lines.length>1){
    const first=lines[0],last=lines[lines.length-1]
    if(distance(last[last.length-1],first[0])<1e-5){
      lines[0]=[...last,...first.slice(1)]
      lines.pop()
    }
  }
  const length=(a:P[])=>a.slice(1).reduce((acc,p,i)=>acc+distance(p,a[i]),0)
  lines.sort((a,b)=>length(b)-length(a))
  const selected=lines[0]
  if(!selected||selected.length<2||length(selected)<1e-3)
    throw new Error('The quarter-seam is too narrow for a continuous ridge.')
  if(selected.length===2){
    selected.splice(1,0,[(selected[0][0]+selected[1][0])/2,
      (selected[0][1]+selected[1][1])/2])
  }
  return {path:selected,closed:false}
}

/** Open C-shaped contour on a threefold radial parting face (radius, Z).
 * Project the model along the radial ray, conservatively enveloping its
 * silhouette, then keep the outward-facing arc of its rounded offset.
 * The open ends stop before the three seams converge at the central hub.
 *
 * Unlike a U-shaped wall seam, the two arms of this C lie ABOVE and BELOW
 * the target and its spine lies OUTSIDE its radial extent. A bare segment
 * across the underside of the outer land would not wrap the casting.
 */
export function radialSeamContour(
  mesh:SolidMesh,angleRadians:number,cx:number,cy:number,
  offset:number,hubSetback:number,spacing=3,
):P[]{
  if(!Number.isFinite(angleRadians)||!(hubSetback>0))
    throw new Error('Invalid radial seam projection or hub setback.')
  const c=Math.cos(angleRadians),s=Math.sin(angleRadians)
  const p=mesh.positions
  const stride=Math.max(1,Math.ceil(p.length/3/30_000))
  const seen=new Map<string,P>()
  for(let i=0;i<p.length/3;i+=stride){
    const r=(p[3*i]-cx)*c+(p[3*i+1]-cy)*s,z=p[3*i+2]
    if(Number.isFinite(r)&&Number.isFinite(z))
      seen.set(`${r},${z}`,[r,z])
  }
  const outline=contourAround(convexHull([...seen.values()]),offset,spacing)
  // A convex outline gives one long outer arc, open toward the shared hub.
  const result=contourSegment(outline,hubSetback,Number.POSITIVE_INFINITY).path
  if(result[0][1]<result[result.length-1][1])result.reverse()
  return result
}

/** Threefold silicone boxes have an open pouring top. Their radial seam
 * crosses the supported cylindrical SIDE WALL and then the solid BASE, not
 * the unsupported outside edge of that wall. Cut the seam short of the hub
 * where three wedges meet, so the three paired features never collide.
 * Coordinates are (outward radius, height) on a radial parting plane. */
export function radialSiliconeLSeam(
  wallRadius:number,hubSetback:number,zFloor:number,zTop:number,
):[number,number][]{
  if(![wallRadius,hubSetback,zFloor,zTop].every(Number.isFinite)||
     hubSetback<=0||wallRadius<=hubSetback||zTop<=zFloor)
    throw new Error('No supported wall/floor L seam fits this silicone box.')
  return [[wallRadius,zTop],[wallRadius,zFloor],[hubSetback,zFloor]]
}

/** Single closed triangular tube following a ring in the parting plane.
 * The ridge is embedded into the negative half and projects into positive.
 * The matching groove uses the same centreline but a wider/deeper profile.
 */
export function triangularContourTube(
  path:readonly P[],axis:SplitAxis,split:number,halfWidth:number,
  back:number,front:number,closed=true,tipFlatFraction=0,
):Triangles {
  if(path.length<3||halfWidth<=0||!(front>back)||tipFlatFraction<0||tipFlatFraction>=1)
    throw new Error('Invalid V-seam geometry.')
  // A clipped V has a flat lead-in at its tip rather than a needle edge.
  // Keep the legacy three-vertex triangular profile when tipFlatFraction=0.
  const count=tipFlatFraction>0?4:3
  // An open ribbon must not finish with square 90-degree end faces. Add a
  // short transition at each end, then taper its V width and protrusion.
  // These stations give the ridge and the matching groove real chamfered
  // end edges without introducing zero-width/degenerate triangles.
  const bevel=Math.min(0.8,halfWidth*0.35,(front-back)*0.25)
  const stations:P[]=[...path]
  if(!closed){
    // Chamfer hard corners in the *path* as well as the open end edges:
    // a vertical wall turning into a flat floor should have a short 45°
    // diagonal transition, not a sharp 90° miter in the V sidewall.
    // Rounded silhouette paths with gentle turns remain unmodified.
    const beveled:P[]=[path[0]]
    for(let i=1;i<path.length-1;i++){
      const a=path[i-1],b=path[i],c=path[i+1]
      const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1]
      const la=Math.hypot(ux,uy),lb=Math.hypot(vx,vy)
      const cosine=la>0&&lb>0?(ux*vx+uy*vy)/(la*lb):1
      if(cosine<0.5&&la>1.5&&lb>1.5){
        const trim=Math.min(1,la*0.2,lb*0.2)
        beveled.push([b[0]-ux/la*trim,b[1]-uy/la*trim],
          [b[0]+vx/lb*trim,b[1]+vy/lb*trim])
      }else beveled.push(b)
    }
    beveled.push(path[path.length-1])
    stations.splice(0,stations.length,...beveled)
    const lead=distance(stations[0],stations[1])
    const tail=distance(stations[stations.length-2],stations[stations.length-1])
    const interpolate=(a:P,b:P,d:number):P=>[
      a[0]+(b[0]-a[0])*d,a[1]+(b[1]-a[1])*d]
    stations.splice(1,0,interpolate(stations[0],stations[1],Math.min(bevel/lead,0.35)))
    const n=stations.length
    stations.splice(n-1,0,interpolate(stations[n-1],stations[n-2],Math.min(bevel/tail,0.35)))
  }
  const [k,u,v]=planeAxes(axis)
  const pos=new Float32Array(stations.length*count*3)
  const ringSegments=closed?stations.length:stations.length-1
  const indexed=new Uint32Array(ringSegments*count*6+(closed?0:(count-2)*6))
  const put=(i:number,slot:number,x:number,y:number,normalPos:number)=>{
    const j=(i*count+slot)*3
    pos[j+k]=normalPos;pos[j+u]=x;pos[j+v]=y
  }
  for(let i=0;i<stations.length;i++){
    const prev=stations[closed?(i+stations.length-1)%stations.length:Math.max(0,i-1)]
    const next=stations[closed?(i+1)%stations.length:Math.min(stations.length-1,i+1)]
    const dx=next[0]-prev[0],dy=next[1]-prev[1]
    const d=Math.hypot(dx,dy)
    if(d<1e-8)throw new Error('V-seam contour contains coincident points.')
    const nx=dy/d,ny=-dx/d
    const p=stations[i]
    const end=!closed&&(i===0||i===stations.length-1)
    const hw=end?halfWidth-bevel:halfWidth
    const tip=end?front-bevel:front
    put(i,0,p[0]+nx*hw,p[1]+ny*hw,split+back)
    put(i,1,p[0]-nx*hw,p[1]-ny*hw,split+back)
    if(count===3)put(i,2,p[0],p[1],split+tip)
    else{
      put(i,2,p[0]-nx*hw*tipFlatFraction,
        p[1]-ny*hw*tipFlatFraction,split+tip)
      put(i,3,p[0]+nx*hw*tipFlatFraction,
        p[1]+ny*hw*tipFlatFraction,split+tip)
    }
  }
  let cursor=0
  for(let i=0;i<ringSegments;i++){
    const j=(i+1)%stations.length
    for(let a=0;a<count;a++){
      const b=(a+1)%count
      const x=i*count+a,y=i*count+b,z=j*count+a,w=j*count+b
      indexed[cursor++]=x;indexed[cursor++]=y;indexed[cursor++]=z
      indexed[cursor++]=z;indexed[cursor++]=y;indexed[cursor++]=w
    }
  }
  if(!closed){
    // Caps across a V/trapezoid cross-section close the printable solid.
    for(let i=1;i<count-1;i++){
      indexed[cursor++]=0;indexed[cursor++]=i+1;indexed[cursor++]=i
      const end=(stations.length-1)*count
      indexed[cursor++]=end;indexed[cursor++]=end+i;indexed[cursor++]=end+i+1
    }
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
