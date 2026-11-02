// SPDX-License-Identifier: AGPL-3.0-only
// Separate glue-on fixture for suspending a source part in a silicone bucket.
// No geometry is added to (or subtracted from) the master itself.
// Foot and stem support a tilted face-matched glue pad, as a single
// watertight printable mesh; all distances are in the source model's mm.
import type {Triangles} from '../../mesh-tools/core/boolean'
import type {MoldSettings} from './settings'

type V3=[number,number,number]
type Bounds={min:V3;max:V3}
const add=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]]
const scale=(a:V3,k:number):V3=>[a[0]*k,a[1]*k,a[2]*k]
const cross=(a:V3,b:V3):V3=>[
  a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0],
]
const normalize=(a:V3):V3=>{
  const m=Math.hypot(...a)
  if(m<1e-9)throw new Error('Invalid mounting-face normal.')
  return scale(a,1/m)
}
interface Ring {center:V3;radius:number;up:V3}
export function planMasterMount(bounds:Bounds,s:MoldSettings):{rings:Ring[];floorZ:number}|null{
  if(!s.mountEnabled)return null
  const p=s.mountPoint
  if(!p||s.mode!=='silicone-box')throw new Error('Pick a model base face in silicone-box mode.')
  const n=normalize(s.mountNormal)
  if(n[2]>-0.5)throw new Error('Pick a downward-facing, reasonably flat underside for a glue-on mounting pad.')
  if(p.some((v,i)=>v<bounds.min[i]-1e-4||v>bounds.max[i]+1e-4))
    throw new Error('The selected mounting point lies outside the source model bounds.')
  const floorZ=bounds.min[2]-s.mountHeight
  const contactZ=p[2]+n[2]*0.2
  if(contactZ-floorZ<4)throw new Error('Mount is too short for a foot, stem and glue pad. Increase support height.')
  if(s.mountFootDiameter<s.mountStemDiameter||s.mountPadDiameter<s.mountStemDiameter)
    throw new Error('Mount pad and foot must be at least the stem diameter.')
  const footR=s.mountFootDiameter/2,stemR=s.mountStemDiameter/2,padR=s.mountPadDiameter/2
  // The support must sit INSIDE the box, not poke through its side wall.
  // Rectangular XY clearance is a conservative bound for circular boxes.
  const available=Math.min(
    p[0]-bounds.min[0]+s.siliconeThickness,
    bounds.max[0]-p[0]+s.siliconeThickness,
    p[1]-bounds.min[1]+s.siliconeThickness,
    bounds.max[1]-p[1]+s.siliconeThickness)
  if(Math.max(footR,padR)+0.5>available)
    throw new Error('Master mounting foot or pad would intersect a silicone box side wall. Choose an interior contact point or reduce its diameter.')
  const rings:Ring[]=[
    {center:[p[0],p[1],floorZ+0.25],radius:footR,up:[0,0,1]},
    {center:[p[0],p[1],floorZ+1.5],radius:footR,up:[0,0,1]},
    {center:[p[0],p[1],floorZ+2.5],radius:stemR,up:[0,0,1]},
    {center:[p[0],p[1],p[2]+n[2]*3],radius:stemR,up:[0,0,1]},
    {center:add(p,scale(n,2)),radius:padR,up:scale(n,-1)},
    {center:add(p,scale(n,0.2)),radius:padR,up:scale(n,-1)},
  ]
  if(rings[3].center[2] < rings[2].center[2]+0.3)
    throw new Error('Mount contact is too close to the bucket floor for this pad size.')
  return {rings,floorZ}
}
/** Winding is consistent along every circular cross section. The top cap
 * conforms to the picked face's tangent plane (not the bounding-box plane).
 */
export function masterMountMesh(bounds:Bounds,s:MoldSettings):Triangles|null{
  const plan=planMasterMount(bounds,s)
  if(!plan)return null
  const sides=48,vertices:number[]=[],indices:number[]=[]
  for(const ring of plan.rings){
    const up=normalize(ring.up)
    const u=normalize(cross(Math.abs(up[1])<0.9?[0,1,0]:[1,0,0],up))
    const v=cross(up,u)
    for(let j=0;j<sides;j++){
      const theta=j*2*Math.PI/sides
      const point=add(ring.center,add(scale(u,ring.radius*Math.cos(theta)),
        scale(v,ring.radius*Math.sin(theta))))
      vertices.push(...point)
    }
  }
  for(let ring=0;ring<plan.rings.length-1;ring++){
    const from=ring*sides,to=(ring+1)*sides
    for(let j=0;j<sides;j++){
      const next=(j+1)%sides
      indices.push(from+j,from+next,to+next,from+j,to+next,to+j)
    }
  }
  const bottom=vertices.length/3
  vertices.push(...plan.rings[0].center)
  const top=vertices.length/3
  vertices.push(...plan.rings[plan.rings.length-1].center)
  const last=(plan.rings.length-1)*sides
  for(let j=0;j<sides;j++){
    const next=(j+1)%sides
    indices.push(bottom,next,j)
    indices.push(top,last+j,last+next)
  }
  return {positions:Float32Array.from(vertices),indices:Uint32Array.from(indices)}
}
