// SPDX-License-Identifier: AGPL-3.0-only
// Manifold mold geometry. Each mold component is exported as its own closed
// manifold: mating planes must NEVER be concatenated as one STL.
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import type { SolidMesh } from '../../../src/app/solids'
import { extentOf } from '../../../src/core/geometry/bounds'
import { closedness, type Triangles } from '../../mesh-tools/core/boolean'
import { repairMoldTarget, liftCollapsedClosedMesh } from './repair'
import { createSphericalDistanceField, sphericalOffset, type SphericalDistanceField } from './sphericalOffset'
import { parseMoldSettings, type MoldSettings, type SplitAxis } from './settings'
import { projectedHull,contourAround,triangularContourTube,planeAxes } from './contourSeam'

type Vec3 = [number,number,number]
export type Limits = { min:Vec3; max:Vec3 }
export interface MoldPart { name:string; positions:Float32Array; indices:Uint32Array; volumeMm3:number }
export interface MoldBuild {
  parts:MoldPart[]; kind:MoldSettings['mode']; warnings:string[]
  volumeMm3:number; openingZ:number|null
  /** False if disconnected or invalid output material was found. Export is blocked. */
  printable:boolean
  targetBounds:Limits
  /** First component only. Never join touching parts into an invalid mesh. */
  positions:Float32Array; indices:Uint32Array
}
const EPS=1e-6
const axisIndex=(a:SplitAxis)=>a==='x'?0:a==='y'?1:2
const normal=(a:SplitAxis):Vec3=>a==='x'?[1,0,0]:a==='y'?[0,1,0]:[0,0,1]
const center=(a:number,b:number)=>(a+b)/2

/** Outward-wound closed block; shared vertices preserve strict topology. */
export function boxSolid({min:a,max:b}:Limits):Triangles {
  for(let i=0;i<3;i++)if(!Number.isFinite(a[i])||!Number.isFinite(b[i])||b[i]-a[i]<=EPS)throw new Error('Invalid mold block size.')
  return {positions:new Float32Array([
    a[0],a[1],a[2],b[0],a[1],a[2],b[0],b[1],a[2],a[0],b[1],a[2],
    a[0],a[1],b[2],b[0],a[1],b[2],b[0],b[1],b[2],a[0],b[1],b[2],
  ]),indices:new Uint32Array([
    0,2,1,0,3,2,4,5,6,4,6,7,
    0,1,5,0,5,4,1,2,6,1,6,5,
    2,3,7,2,7,6,3,0,4,3,4,7,
  ])}
}
/** Drafted box inner wall, expanding towards +Z (pour/release direction). */
export function draftedBox(limits:Limits,topExpansion:number):Triangles {
  const m=boxSolid(limits)
  for(let i=4;i<8;i++){
    const j=i*3
    m.positions[j]+=(i===4||i===7?-1:1)*topExpansion
    m.positions[j+1]+=(i===4||i===5?-1:1)*topExpansion
  }
  return m
}
/** Origin-relative signed volume avoids cancellation for tiny islands
 * far from the world origin: tetrahedra are measured from a nearby vertex.
 */
function stableVolume(mesh:Triangles):number {
  const p=mesh.positions,idx=mesh.indices
  if(p.length<3||idx.length===0)return 0
  const ox=p[0],oy=p[1],oz=p[2]
  let volume6=0
  for(let t=0;t<idx.length;t+=3){
    const a=idx[t]*3,b=idx[t+1]*3,c=idx[t+2]*3
    const ax=p[a]-ox,ay=p[a+1]-oy,az=p[a+2]-oz
    const bx=p[b]-ox,by=p[b+1]-oy,bz=p[b+2]-oz
    const cx=p[c]-ox,cy=p[c+1]-oy,cz=p[c+2]-oz
    volume6+=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx)
  }
  return volume6/6
}
function check(mesh:Triangles,what:string):void {
  const n=mesh.positions.length/3
  if(!n||!Number.isInteger(n)||mesh.indices.length===0||mesh.indices.length%3)throw new Error(`${what}: invalid triangles.`)
  // Manifold often triangulates planar intersections into very thin but
  // NONZERO-area slivers. A tiny aspect ratio is not a collapsed face. Do
  // not discard those triangles or erroneously block a four-piece mold.
  for(let i=0;i<mesh.positions.length;i++){
    if(!Number.isFinite(mesh.positions[i]))throw new Error(`${what} contains non-finite vertices.`)
  }
  for(let i=0;i<mesh.indices.length;i+=3){
    const ia=mesh.indices[i],ib=mesh.indices[i+1],ic=mesh.indices[i+2]
    if(ia>=n||ib>=n||ic>=n||ia===ib||ib===ic||ic===ia)throw new Error(`${what} has degenerate triangle indices.`)
    const p=mesh.positions
    const a=ia*3,b=ib*3,c=ic*3
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2]
    const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2]
    const crossX=uy*vz-uz*vy,crossY=uz*vx-ux*vz,crossZ=ux*vy-uy*vx
    const area2=Math.hypot(crossX,crossY,crossZ)
    if(area2===0)throw new Error(`${what} has a zero-area triangle at face ${i/3}. ${what.startsWith('Mold part')?'This triangle was produced by the geometry kernel during level-set/Boolean operations, not by the source.':'Enable Repair small mesh defects in Mold Making, or repair the source mesh.'}`)
  }
  const c=closedness(mesh.indices,n)
  if(c.open||c.bad)throw new Error(`${what} is not watertight (${c.open} boundary edges, ${c.bad} nonmanifold edges). Use Mesh Tools → Fill holes, then 'Use for analysis' (or enable Mold Making's small-defect repair).`)
  if(!(stableVolume(mesh)>EPS))throw new Error(`${what} is inside-out or zero-volume.`)
}
export interface MoldPlan {
  outer:Limits; innerBox:Limits|null; openingZ:number|null
  cylinder:{cx:number;cy:number;outerR:number;innerR:number}|null
  /** Effective calculated wall/backing material including user extra margin. */
  material:{side:number;base:number;wall:number}
  /** The repaired input, read only while computing direct-mold contours. */
  target?:Triangles
  radialOuter?:{cx:number;cy:number;radius:number}
}
/** Required printable structure PLUS optional additional material. Never
 * interpret the extra inputs as the minimum total backing dimension.
 */
export function moldMaterial(s:MoldSettings,targetHeight?:number):{side:number;base:number;wall:number}{
  const v=s.keys&&s.parts===2&&s.keyStyle==='v-seam'
  const pinLand=s.keys&&s.parts!==3&&!(s.parts===2&&s.keyStyle==='v-seam')
    ?s.keyDiameter+2*s.keyClearance+2.5:0
  // Margin includes space from target to the V-ridge's inner flank,
  // full profile width, groove fit, and at least 1.25 mm outside the groove.
  const vLand=v?s.vSeamSpacing+s.vSeamWidth+s.vSeamClearance+1.8:0
  const clearance=s.mode==='direct'?s.clearance:0
  const direct=Math.max(2,clearance+2,pinLand+clearance,vLand+clearance)
  const wallMin=v?Math.max(2,s.vSeamWidth+2*s.vSeamClearance+s.vSeamSpacing+2.5):
    s.keys&&s.parts!==3?Math.max(2,s.keyDiameter+2*s.keyClearance+2):2
  const material={
    side:direct+s.sideMargin,
    base:(s.mode==='direct'?direct:Math.max(2,wallMin+0.5))+s.baseThickness,
    wall:wallMin+s.wallThickness,
  }
  if(v&&targetHeight!==undefined&&Number.isFinite(targetHeight)){
    const pitch=s.clampTabWidth+Math.max(2,s.clampTabWidth*0.25)
    const needed=s.clampTabCount*pitch+4
    const span=targetHeight+(s.mode==='direct'?2*material.base:
      s.siliconeThickness+material.wall+material.base)
    if(span<needed)material.base+=(needed-span)/(s.mode==='direct'?2:1)
  }
  return material
}
export function planMold(target:Triangles,settings:MoldSettings):MoldPlan {
  const s=parseMoldSettings(settings)
  // A containment box is sized from model bounds, not its topology: even
  // an open/non-manifold scan can be used as a reference for the container.
  if(!target.positions.length||(s.mode!=='silicone-box'&&!target.indices.length))throw new Error('Load a target mesh.')
  const {min,max}=extentOf(target.positions)
  const size=min.map((v,i)=>max[i]-v)
  if(size.some(x=>!Number.isFinite(x)||x<=EPS))throw new Error('Target has zero extent.')
  const cx=center(min[0],max[0]),cy=center(min[1],max[1])
  const material=moldMaterial(s,size[2])
  if(s.mode==='silicone-box'){
    const bottom=min[2]-material.base,top=max[2]+s.siliconeThickness+material.wall
    const innerBottom=min[2],innerTop=top+2
    const draft=(innerTop-innerBottom)*Math.tan(s.boxDraftDeg*Math.PI/180)
    if(s.boxShape==='cylindrical'||s.parts===3){
      const innerR=Math.hypot(size[0]/2,size[1]/2)+s.siliconeThickness
      const outerR=innerR+draft+material.wall
      return {outer:{min:[cx-outerR,cy-outerR,bottom],max:[cx+outerR,cy+outerR,top]},
        innerBox:{min:[cx-innerR,cy-innerR,innerBottom],max:[cx+innerR,cy+innerR,innerTop]},
        cylinder:{cx,cy,innerR,outerR},openingZ:null,material}
    }
    const innerBox:Limits={min:[min[0]-s.siliconeThickness,min[1]-s.siliconeThickness,innerBottom],
      max:[max[0]+s.siliconeThickness,max[1]+s.siliconeThickness,innerTop]}
    return {outer:{min:[innerBox.min[0]-material.wall-draft,innerBox.min[1]-material.wall-draft,bottom],
      max:[innerBox.max[0]+material.wall+draft,innerBox.max[1]+material.wall+draft,top]},
      innerBox,cylinder:null,openingZ:null,material}
  }
  if(s.mode==='direct'){
    if(s.parts===3){
      // Round outside makes the three 120° sectors rotationally equivalent
      // in their outer tooling, unlike cutting an ordinary XY rectangle.
      const radius=Math.hypot(size[0]/2,size[1]/2)+material.side
      return {outer:{min:[cx-radius,cy-radius,min[2]-material.base],
        max:[cx+radius,cy+radius,max[2]+material.base]},
        innerBox:null,cylinder:null,openingZ:null,target,material,
        radialOuter:{cx,cy,radius}}
    }
    return {outer:{min:[min[0]-material.side,min[1]-material.side,min[2]-material.base],
      max:[max[0]+material.side,max[1]+material.side,max[2]+material.base]},
      innerBox:null,cylinder:null,openingZ:s.parts===1?center(min[2],max[2]):null,target,material}
  }
  throw new Error('Unrecognized mold type.')
}
function toManifold(wasm:ManifoldToplevel,mesh:Triangles,keep:(m:Manifold)=>Manifold):Manifold {
  check(mesh,'Target or tooling solid')
  const m=new wasm.Mesh({numProp:3,vertProperties:mesh.positions,triVerts:mesh.indices})
  m.merge()
  const solid=keep(new wasm.Manifold(m))
  if(solid.status()!=='NoError'||solid.isEmpty())throw new Error('Solid was rejected by the geometry kernel.')
  return solid
}
/** Convert a Boolean result to a printable mesh. Some valid kernel
 * solids acquire exactly collinear triangles at tessellation / Float32
 * precision. Validate before and after any correction. We NEVER omit a
 * triangle or ignore a failed watertightness/volume check.
 *
 * First try a <=1 µm vertex adjustment preserving all faces. When that
 * cannot work, ask Manifold to simplify sub-micron edges, then recheck
 * every exported triangle. Source-mesh repair settings do not apply here.
 */
function validatedPartMesh(solid:Manifold,name:string,warnings:string[]):Triangles {
  const read=(part:Manifold):Triangles=>{
    const m=part.getMesh()
    return {positions:new Float32Array(m.vertProperties),indices:new Uint32Array(m.triVerts)}
  }
  const base=read(solid)
  try{
    check(base,name)
    return base
  }catch(error){
    const message=error instanceof Error?error.message:String(error)
    if(!/zero-area triangle|degenerate triangle indices/.test(message))throw error
  }
  const originalVolume=Math.abs(solid.volume())
  const maxVolumeChange=Math.max(0.01,originalVolume*1e-4)
  const accept=(candidate:Triangles,reason:string):Triangles=>{
    check(candidate,name)
    const difference=Math.abs(stableVolume(candidate)-originalVolume)
    if(difference>maxVolumeChange){
      throw new Error(`${name} output cleanup would change material volume by ${difference.toPrecision(4)} mm³ (limit ${maxVolumeChange.toPrecision(4)} mm³).`)
    }
    warnings.push(`${name}: corrected numerical zero-area triangles in the kernel's exported mesh (${reason}); verified closed topology and volume within ${maxVolumeChange.toPrecision(4)} mm³. Source mesh unchanged.`)
    return candidate
  }
  let lastFailure='no compatible correction found'
  const tryLift=(mesh:Triangles,description:string):Triangles|null=>{
    const repaired=liftCollapsedClosedMesh(mesh)
    if(!repaired||repaired.adjustedVertices===0)return null
    try{
      return accept(repaired.mesh,`${description}, nudged ${repaired.adjustedVertices} vertices ≤0.001 mm`)
    }catch(error){
      lastFailure=error instanceof Error?error.message:String(error)
      return null
    }
  }
  const direct=tryLift(base,'preserved original faces')
  if(direct)return direct
  for(const tolerance of [0.00001,0.0001]){
    const simplified=solid.simplify(tolerance)
    try{
      if(simplified.isEmpty()||simplified.status()!=='NoError')continue
      const mesh=read(simplified)
      try{
        return accept(mesh,`Manifold simplify tolerance ${tolerance} mm`)
      }catch(error){
        lastFailure=error instanceof Error?error.message:String(error)
      }
      const lifted=tryLift(mesh,`Manifold simplify ${tolerance} mm`)
      if(lifted)return lifted
    }finally{simplified.delete()}
  }
  throw new Error(`${name} has zero-area triangles after the geometry kernel's Boolean/level-set operations. Safe output cleanup (≤0.0001 mm simplification or ≤0.001 mm vertex adjustment) could not restore a watertight part without changing material volume. ${lastFailure}`)
}
/** Export only one physically connected solid per STL. Manifold Boolean
 * operations can leave tiny isolated slivers after complex intersections.
 * Trim ONLY sub-millimetre dust below a very small volume budget, explicitly
 * reporting it; substantial components remain an actionable error.
 */
export function toPart(solid:Manifold,name:string,warnings:string[]=[],detachedParts:MoldPart[]=[]):MoldPart {
  if(solid.isEmpty()||solid.status()!=='NoError')throw new Error(`${name} was empty after the Boolean.`)
  const islands=solid.decompose()
  try {
    if(!islands.length)throw new Error(`${name} has no printable connected body.`)
    const sorted=islands.map(part=>({part,volume:Math.abs(part.volume())}))
      .sort((a,b)=>b.volume-a.volume)
    const primary=sorted[0],others=sorted.slice(1)
    // Anything large enough to be a real printed feature or that changes
    // measurable tooling volume must remain a visible, actionable error.
    const perIslandLimit=Math.min(0.5,primary.volume*1e-5)
    // Do not discard valuable material or block the entire mold on loose
    // Boolean islands. Export each nontrivial island as a separate named
    // solid and make it visibly clear that manual cleanup is required.
    // Tiny numerical debris alone is filtered within the old tight budget.
    const detachedBefore=detachedParts.length
    let discardedDust=0,dustCount=0
    for(const island of others){
      const trivial=island.volume<=perIslandLimit&&
        discardedDust+island.volume<=Math.min(1,primary.volume*2e-5)
      if(trivial){discardedDust+=island.volume;dustCount++;continue}
      const label=`${name} — detached ${detachedParts.length-detachedBefore+1}`
      // Detached slivers are frequently zero-volume at Float32 export
      // precision even when the Manifold kernel reports positive volume.
      // Such fragments must NEVER abort an otherwise valid main mold, but
      // also must not be silently exported as printable geometry.
      try {
        const standalone=validatedPartMesh(island.part,label,warnings)
        detachedParts.push({name:label,...standalone,
          volumeMm3:stableVolume(standalone)})
      }catch(error){
        // A disconnected kernel island can arrive with reversed triangle
        // winding. Try only an orientation flip; the triangle topology and
        // surface positions stay unchanged.
        let oriented:Triangles|null=null
        const m=island.part.getMesh()
        const raw:Triangles={positions:new Float32Array(m.vertProperties),indices:new Uint32Array(m.triVerts)}
        if(stableVolume(raw)<-EPS){
          for(let i=0;i<raw.indices.length;i+=3){
            const tmp=raw.indices[i+1]
            raw.indices[i+1]=raw.indices[i+2]
            raw.indices[i+2]=tmp
          }
          try{check(raw,label);oriented=raw}
          catch{ /* An actual degenerate fragment remains unsafe. */ }
        }
        if(oriented){
          detachedParts.push({name:label,...oriented,volumeMm3:stableVolume(oriented)})
          warnings.push(`${label}: reversed inside-out island winding on export and revalidated all faces and topology.`)
        }else{
          const reason=error instanceof Error?error.message:String(error)
          warnings.push(`${label}: excluded an invalid detached artifact (kernel volume ${island.volume.toPrecision(4)} mm³; ${reason}). Main mold preserved; inspect cavity and registration before printing.`)
        }
      }
    }
    const added=detachedParts.slice(detachedBefore)
    if(added.length){
      warnings.push(`${name}: ${added.length} disconnected printable islands (${added.map(p=>p.volumeMm3.toPrecision(4)).join(', ')} mm³) were preserved as individually exported loose parts. They may be unwanted Boolean fragments, detached pins or real tooling features. Inspect/delete them in the slicer before printing; the assembly is NOT guaranteed.`)
    }
    // The Manifold kernel can produce tiny collapsed triangles when
    // converting a valid CSG/level-set result into Float32 mesh output.
    // These are OUTPUT artifacts: repairing the imported source again
    // cannot fix them. Preserve connectivity and keep the correction
    // below a strict manufacturing-scale tolerance.
    const exported=validatedPartMesh(primary.part,name,warnings)
    if(dustCount)warnings.push(`${name}: excluded ${dustCount} microscopic Boolean dust islands totalling ${discardedDust.toPrecision(3)} mm³ (each ≤${perIslandLimit.toPrecision(3)} mm³).`)
    return {name,...exported,volumeMm3:stableVolume(exported)}
  }finally{for(const island of islands)island.delete()}
}
/** Select seam coordinates, excluding too-close edges and collisions.
 * Auto dynamically fits as many keys as the seam supports. Manual entries
 * are honored exactly or rejected with the offending percent. */
export function seamPositions(
  lo:number,hi:number,s:Pick<MoldSettings,
  'keyPlacement'|'keyPositions'|'keyDiameter'|'keyClearance'>,
):number[] {
  const r=s.keyDiameter/2+s.keyClearance
  const inset=r+0.75
  const stride=2*r+0.75
  const width=hi-lo
  if(width<=2*inset)throw new Error('No safe room for alignment features along this seam. Reduce the diameter or use another split.')
  if(s.keyPlacement==='auto'){
    // Two widely separated keys restrain rotation and cost far fewer CSG
    // operations than the previous 5-key pattern. On a short seam, fit a
    // single centered registration feature instead of creating collisions.
    const a=Math.max(lo+inset,lo+width*0.22)
    const b=Math.min(hi-inset,lo+width*0.78)
    return b-a>=stride?[a,b]:[center(lo+inset,hi-inset)]
  }
  const chosen:number[]=[]
  for(const fraction of [...s.keyPositions].sort((a,b)=>a-b)){
    const x=lo+width*fraction
    if(x<lo+inset||x>hi-inset||chosen.some(y=>Math.abs(x-y)<stride)){
      throw new Error(`Alignment key at ${Math.round(fraction*100)}% overlaps an edge or another feature. Drag the pin further away, reduce diameter, or remove it.`)
    }
    chosen.push(x)
  }
  if(!chosen.length)throw new Error('Add at least one manual alignment pin.')
  return chosen
}
/** Registration sites in the parting PLANE, not in one bottom-Z row.
 * Direct molds get keys in the solid backing surrounding the projected
 * target's conservative bounding rectangle. That prevents keys crossing
 * the casting cavity, even on an undercut mesh.
 */
export function registrationSites(
  axis:SplitAxis,split:number,s:MoldSettings,plan:MoldPlan,
  seamSpan?:readonly [number,number],
):Vec3[] {
  const k=axisIndex(axis),u=axis==='x'?1:0,v=axis==='z'?1:2
  const outer=plan.outer
  const u0=seamSpan?.[0]??outer.min[u],u1=seamSpan?.[1]??outer.max[u]
  const v0=outer.min[v],v1=outer.max[v]
  const radius=s.keyDiameter/2+s.keyClearance
  const inset=radius+0.75
  if(u1-u0<=2*inset||v1-v0<=2*inset)
    throw new Error('No room for registration keys in the selected parting plane. Increase the outer margin or reduce the key diameter.')
  const limits=plan.target?extentOf(plan.target.positions):plan.innerBox!
  const targetLo=limits.min,targetHi=limits.max
  const safe=(a:number,b:number)=>{
    if(a<u0+inset-1e-6||a>u1-inset+1e-6||b<v0+inset-1e-6||b>v1-inset+1e-6)return false
    const du=Math.max(targetLo[u]-a,0,a-targetHi[u])
    const dv=Math.max(targetLo[v]-b,0,b-targetHi[v])
    // No pin/socket cylinder may penetrate the projected master. An extra
    // 0.5mm land protects the cavity from Boolean edge coincidences.
    return Math.hypot(du,dv)>radius+s.clearance+0.5
  }
  const spanU=u1-u0,spanV=v1-v0
  const coords=s.keyPlacement==='manual'
    ? s.keyPoints.map(([a,b])=>[u0+a*spanU,v0+b*spanV] as [number,number])
    : [
        [u0+inset,v0+inset],[u1-inset,v0+inset],
        [u0+inset,v1-inset],[u1-inset,v1-inset],
      ] as [number,number][]
  const chosen:[number,number][]=[]
  const separation=2*radius+0.75
  for(const [a,b] of coords){
    if(!safe(a,b)){
      if(s.keyPlacement==='manual')throw new Error(
        'Registration point is outside safe solid backing or overlaps the projected casting cavity. Move it toward an outer corner, reduce its diameter, or increase mold margins.')
      continue
    }
    if(chosen.some(([x,y])=>Math.hypot(x-a,y-b)<separation)){
      if(s.keyPlacement==='manual')throw new Error('Registration points overlap. Spread them farther apart in the 2D editor.')
      continue
    }
    chosen.push([a,b])
  }
  if(!chosen.length)throw new Error('No safe registration location on this seam. Increase the backing or outer margin, or adjust the parting axis.')
  return chosen.map(([a,b])=>{
    const p:Vec3=[center(outer.min[0],outer.max[0]),center(outer.min[1],outer.max[1]),center(outer.min[2],outer.max[2])]
    p[k]=split;p[u]=a;p[v]=b
    return p
  })
}
function pinSolid(
  wasm:ManifoldToplevel,axis:SplitAxis,centre:Vec3,length:number,
  radiusLow:number,radiusHigh:number,
  keep:(m:Manifold)=>Manifold,
):Manifold {
  const raw=keep(wasm.Manifold.cylinder(length,radiusLow,radiusHigh,32,true))
  const rotation:Vec3=axis==='x'?[0,90,0]:axis==='y'?[-90,0,0]:[0,0,0]
  return keep(keep(raw.rotate(rotation)).translate(centre))
}
/**
 * A containment bucket is mostly hollow. Placing keys in a line across its
 * bottom plate (as rigid molds do) neither aligns the tall walls nor provides
 * enough material for reliable pins and sockets. Instead, make matched
 * EXTERIOR mounting bosses at the two ends of each wall seam, at multiple
 * heights. Both halves gain solid bosses before any sockets are subtracted.
 *
 * For a four-part bucket, seamSpan selects the end of each quadrant's seam,
 * avoiding keys across the interior and the perpendicular parting line.
 */
function addBoxWallKeys(
  wasm:ManifoldToplevel,negative:Manifold,positive:Manifold,
  axis:SplitAxis,split:number,s:MoldSettings,plan:MoldPlan,
  keep:(m:Manifold)=>Manifold,seamSpan?:readonly [number,number],
):[Manifold,Manifold] {
  if(axis==='z')throw new Error('Z split registration on a silicone box needs a separate flange; choose X/Y or turn off keys.')
  const idx=axisIndex(axis),t=axis==='x'?1:0
  const base=plan.outer
  const mid=[center(base.min[0],base.max[0]),center(base.min[1],base.max[1])]
  const r=s.keyDiameter/2,radial=s.keyClearance
  const bossRadius=r+radial+1.25 // ≥1.25 mm material around every socket
  const bossDepth=Math.max(s.keyDepth+0.8,bossRadius*1.6)
  const innerBottom=plan.innerBox!.min[2],top=base.max[2]
  const available=top-innerBottom
  const zInset=bossRadius+0.5
  if(available<=2*zInset)throw new Error('Silicone box wall too short for registration bosses; increase its height or reduce registration diameter.')
  const candidates=s.keyPlacement==='manual'?[...s.keyPositions].sort((a,b)=>a-b):[0.24,0.76]
  const heights:number[]=[]
  const minZ=innerBottom+zInset,maxZ=top-zInset
  for(const fraction of candidates){
    const z=innerBottom+available*fraction
    if(z<minZ||z>maxZ||heights.some(x=>Math.abs(x-z)<2*bossRadius+0.6)){
      if(s.keyPlacement==='manual')
        throw new Error(`Registration height ${Math.round(100*fraction)}% is too close to an edge or another boss. Adjust manual positions or decrease diameter.`)
      continue
    }
    heights.push(z)
  }
  if(!heights.length&&s.keyPlacement==='auto')heights.push(center(minZ,maxZ))
  if(!heights.length)throw new Error('No safe registration heights on this silicone box.')
  // Move the boss centre out beyond the actual wall surface, leaving a
  // substantial intersection with the wall but no intrusion into the cavity.
  const wallPenetration=Math.min(bossRadius*0.75,plan.material.wall*0.7)
  const overhang=bossRadius-wallPenetration
  const sites:Vec3[]=[]
  for(const sign of [-1,1]){
    let edge:number
    if(plan.cylinder){
      const d=split-mid[idx]
      const outer=plan.cylinder.outerR+overhang
      if(Math.abs(d)>=outer)continue
      edge=mid[t]+sign*Math.sqrt(outer*outer-d*d)
    }else edge=sign<0?base.min[t]-overhang:base.max[t]+overhang
    // A four-part seam ends at one outside wall; a two-part seam has both.
    if(seamSpan&&(edge<seamSpan[0]-bossRadius-1||edge>seamSpan[1]+bossRadius+1))continue
    for(const z of heights){
      const p:Vec3=[mid[0],mid[1],z]
      p[idx]=split
      p[t]=edge
      sites.push(p)
    }
  }
  if(!sites.length)throw new Error('No external wall edge available for this silicone-box registration seam.')
  let a=negative,b=positive
  const bossHalf=bossDepth/2
  for(const p of sites){
    const negBoss:Vec3=[...p],posBoss:Vec3=[...p]
    negBoss[idx]-=bossHalf
    posBoss[idx]+=bossHalf
    a=keep(a.add(pinSolid(wasm,axis,negBoss,bossDepth,bossRadius,bossRadius,keep)))
    b=keep(b.add(pinSolid(wasm,axis,posBoss,bossDepth,bossRadius,bossRadius,keep)))
    const L=s.keyDepth
    if(s.keyStyle==='metal-dowel'){
      const nc:Vec3=[...p],pc:Vec3=[...p]
      nc[idx]-=L/2-0.15
      pc[idx]+=L/2-0.15
      a=keep(a.subtract(pinSolid(wasm,axis,nc,L+0.3,r+radial,r+radial,keep)))
      b=keep(b.subtract(pinSolid(wasm,axis,pc,L+0.3,r+radial,r+radial,keep)))
    }else{
      const embed=Math.min(0.5,L*0.25)
      const male:Vec3=[...p],female:Vec3=[...p]
      male[idx]+=(L-embed)/2
      female[idx]+=(L+2*radial+0.3)/2-0.15
      const tapered=s.keyStyle==='tapered-key'
      a=keep(a.add(pinSolid(wasm,axis,male,L+embed,r,tapered?r*0.7:r,keep)))
      b=keep(b.subtract(pinSolid(wasm,axis,female,L+2*radial+0.3,
        r+radial,tapered?r*0.7+radial:r+radial,keep)))
    }
    if(a.isEmpty()||b.isEmpty())throw new Error('Exterior registration boss failed. Reduce the dowel diameter/depth.')
  }
  return [a,b]
}
/** The continuous seam is a closed V-profile tongue and a wider/deeper
 * matching groove, both following a rounded approximate silhouette instead
 * of disconnected pins. Two substantial ears at the outside edge permit
 * clamping without touching the casting cavity.
 */
/** A V-ridge backed by continuous material on the parting plane.
 * Direct tooling follows a coarse outward silhouette. Silicone boxes
 * instead have an OPEN U seam supported by their two exterior walls and
 * floor: a closed silhouette ring would run through the empty silicone
 * cavity and create disconnected plastic.
 */
function addContourVSeam(
  wasm:ManifoldToplevel,negative:Manifold,positive:Manifold,
  axis:SplitAxis,split:number,s:MoldSettings,plan:MoldPlan,
  keep:(m:Manifold)=>Manifold,
):[Manifold,Manifold] {
  const halfWidth=s.vSeamWidth/2,fit=s.vSeamClearance
  const [,u,v]=planeAxes(axis)
  const outer=plan.outer
  let path:[number,number][]
  let closed:boolean
  if(s.mode==='direct'){
    if(!plan.target)throw new Error('Contour mating requires a model.')
    path=contourAround(projectedHull(plan.target,axis),
      s.vSeamSpacing+s.clearance+halfWidth+0.5,Math.max(2,s.vSeamWidth*2))
    closed=true
  }else if(axis==='z'){
    const inner=plan.innerBox!
    const inset=halfWidth+fit+1.2+s.vSeamSpacing
    if(plan.cylinder){
      const {cx,cy,innerR}=plan.cylinder
      const zDistance=Math.max(0,split-inner.min[2])
      const radius=innerR+zDistance*Math.tan(s.boxDraftDeg*Math.PI/180)+inset
      const segments=96
      path=Array.from({length:segments},(_,i)=>{
        const angle=2*Math.PI*i/segments
        return [cx+radius*Math.cos(angle),cy+radius*Math.sin(angle)] as [number,number]
      })
    }else{
      // A horizontal parting plane crosses the bucket's four walls.
      // Follow the inner wall at a safe outward offset, not the empty
      // region that is to be filled with silicone.
      path=contourAround(projectedHull(boxSolid(inner),'z'),inset,
        Math.max(2,s.vSeamWidth*2))
    }
    closed=true
  }else{
    const k=axisIndex(axis),t=axis==='x'?1:0
    const mid=[center(outer.min[0],outer.max[0]),center(outer.min[1],outer.max[1])]
    const inset=halfWidth+fit+1.2+s.vSeamSpacing
    let edgeLo=outer.min[t],edgeHi=outer.max[t]
    if(plan.cylinder){
      const dx=split-mid[k]
      const radius=plan.cylinder.outerR
      const chord=Math.sqrt(Math.max(0,radius*radius-dx*dx))
      edgeLo=mid[t]-chord;edgeHi=mid[t]+chord
    }
    const bottom=outer.min[2]+inset
    const top=outer.max[2]-inset
    if(edgeHi-edgeLo<=inset*2||top-bottom<=s.vSeamWidth){
      throw new Error('The mold box is too small for a wall-supported seam.')
    }
    // Two walls and a floor, with capped ends at the open pouring rim.
    path=[[edgeLo+inset,top],[edgeLo+inset,bottom],
      [edgeHi-inset,bottom],[edgeHi-inset,top]]
    closed=false
  }
  const safety=halfWidth+fit+0.65
  for(const [a,b] of path){
    if(a-safety<outer.min[u]-1e-6||a+safety>outer.max[u]+1e-6||
       b-safety<outer.min[v]-1e-6||b+safety>outer.max[v]+1e-6){
      throw new Error('The computed V-seam lies outside the tooling. This indicates a geometry planning bug; no mold was exported.')
    }
  }
  const embed=Math.min(0.6,s.vSeamHeight*0.25)
  const tongue=toManifold(wasm,triangularContourTube(
    path,axis,split,halfWidth,-embed,s.vSeamHeight,closed),keep)
  const groove=toManifold(wasm,triangularContourTube(
    path,axis,split,halfWidth+fit,-0.18,
    s.vSeamHeight+fit+0.3,closed),keep)
  let neg=keep(negative.add(tongue))
  let pos=keep(positive.subtract(groove))
  const k=axisIndex(axis),t=axis==='x'?1:0
  const mid=[center(outer.min[0],outer.max[0]),center(outer.min[1],outer.max[1])]
  const sideTangent=axis==='z'?0:t
  const totalHeight=outer.max[2]-outer.min[2]
  const zPitch=totalHeight/s.clampTabCount
  for(const sign of [-1,1])for(let i=0;i<s.clampTabCount;i++){
    let edge=sign<0?outer.min[sideTangent]:outer.max[sideTangent]
    if(plan.cylinder&&axis!=='z'){
      const dx=split-mid[k],r=plan.cylinder.outerR
      edge=mid[sideTangent]+sign*Math.sqrt(Math.max(0,r*r-dx*dx))
    }
    const z=outer.min[2]+zPitch*(i+0.5)
    const tabWidth=s.clampTabWidth
    const thickness=Math.max(2,s.clampTabThickness)
    const makeTab=(upper:boolean):Manifold=>{
      const lo:Vec3=[...outer.min],hi:Vec3=[...outer.max]
      lo[k]=upper?split:split-thickness
      hi[k]=upper?split+thickness:split
      const overlap=Math.max(2.5,Math.min(6,s.clampTabThickness*0.6))
      lo[sideTangent]=sign<0?edge-s.clampTabProjection:edge-overlap
      hi[sideTangent]=sign<0?edge+overlap:edge+s.clampTabProjection
      if(axis==='z'){
        // Top/bottom halves: tabs spread along Y, on both X edges.
        // For a cylinder, use the local circle intersection rather than
        // the maximal X extent (which would detach ears away from Y=0).
        const span=outer.max[1]-outer.min[1]
        const y=outer.min[1]+span*(i+0.5)/s.clampTabCount
        if(plan.cylinder){
          const dy=y-mid[1],r=plan.cylinder.outerR
          const chord=Math.sqrt(Math.max(0,r*r-dy*dy))
          edge=mid[0]+sign*chord
          lo[sideTangent]=sign<0?edge-s.clampTabProjection:edge-overlap
          hi[sideTangent]=sign<0?edge+overlap:edge+s.clampTabProjection
        }
        lo[1]=y-tabWidth/2;hi[1]=y+tabWidth/2
      }else{
        lo[2]=z-tabWidth/2;hi[2]=z+tabWidth/2
      }
      return toManifold(wasm,boxSolid({min:lo,max:hi}),keep)
    }
    neg=keep(neg.add(makeTab(false)))
    pos=keep(pos.add(makeTab(true)))
  }
  if(neg.isEmpty()||pos.isEmpty())throw new Error('V seam Boolean returned an empty part.')
  return [neg,pos]
}
function addKeys(
  wasm:ManifoldToplevel,negative:Manifold,positive:Manifold,
  axis:SplitAxis,split:number,s:MoldSettings,plan:MoldPlan,keep:(m:Manifold)=>Manifold,
  seamSpan?:readonly [number,number],
):[Manifold,Manifold] {
  // Registration is placed on material around the projected cavity in both parting-plane axes.
  // Metal dowel mode cuts blind clearance sockets on BOTH mating halves.
  if(s.keyStyle==='v-seam'&&s.parts===2)return addContourVSeam(wasm,negative,positive,axis,split,s,plan,keep)
  if(s.mode==='silicone-box')return addBoxWallKeys(wasm,negative,positive,axis,split,s,plan,keep,seamSpan)
  const idx=axisIndex(axis)
  const locations=registrationSites(axis,split,s,plan,seamSpan)
  let a=negative,b=positive
  const L=s.keyDepth,embed=Math.min(1.0,L*0.4)
  const radial=s.keyClearance,r=s.keyDiameter/2
  for(const p of locations){
    if(s.keyStyle==='metal-dowel'){
      const negCentre:Vec3=[...p],posCentre:Vec3=[...p]
      // Each pocket reaches 0.15 mm across the seam to avoid a paper-thin
      // membrane over the bore; at the exterior only material is removed.
      negCentre[idx]-=L/2-0.15
      posCentre[idx]+=L/2-0.15
      const holeLength=L+0.3
      a=keep(a.subtract(pinSolid(wasm,axis,negCentre,holeLength,r+radial,r+radial,keep)))
      b=keep(b.subtract(pinSolid(wasm,axis,posCentre,holeLength,r+radial,r+radial,keep)))
    }else{
      const maleCentre:Vec3=[...p],femaleCentre:Vec3=[...p]
      maleCentre[idx]+=(L-embed)/2
      femaleCentre[idx]+=(L+2*radial+0.3)/2-0.15
      const taper=s.keyStyle==='tapered-key'
      a=keep(a.add(pinSolid(wasm,axis,maleCentre,L+embed,r,taper?r*0.7:r,keep)))
      b=keep(b.subtract(pinSolid(wasm,axis,femaleCentre,L+2*radial+0.3,
        r+radial,taper?r*0.7+radial:r+radial,keep)))
    }
    if(a.isEmpty()||b.isEmpty())throw new Error('Registration feature destroyed a mold part. Reduce depth or move its position.')
  }
  return [a,b]
}
function split(
  wasm:ManifoldToplevel,solids:Manifold[],axis:SplitAxis,at:number,
  s:MoldSettings,plan:MoldPlan,keep:(m:Manifold)=>Manifold,
  withKeys=s.keys,
):Manifold[] {
  const out:Manifold[]=[]
  for(const solid of solids){
    const [pos,neg]=solid.splitByPlane(normal(axis),at)
    keep(pos);keep(neg)
    if(pos.isEmpty()||neg.isEmpty())throw new Error(`The ${axis.toUpperCase()} parting plane misses one of the mold sections. Adjust the plane.`)
    const [a,b]=withKeys?addKeys(wasm,neg,pos,axis,at,s,plan,keep):[neg,pos]
    out.push(a,b)
  }
  return out
}
/** Three radial 120-degree sectors around the model's XY bounding
 * centre. Intersect two outward-facing half-planes per sector; unlike a
 * 3-way sequence of straight X/Y cuts this gives exact threefold layout.
 * Adjacent sectors share their unsplit radial interfaces, with no overlap.
 */
export function splitThreefold(
  solid:Manifold,plan:MoldPlan,keep:(m:Manifold)=>Manifold,
):Manifold[] {
  const cx=center(plan.outer.min[0],plan.outer.max[0])
  const cy=center(plan.outer.min[1],plan.outer.max[1])
  const result:Manifold[]=[]
  for(let sector=0;sector<3;sector++){
    const lo=sector*2*Math.PI/3,hi=(sector+1)*2*Math.PI/3
    const left:Vec3=[-Math.sin(lo),Math.cos(lo),0]
    const right:Vec3=[Math.sin(hi),-Math.cos(hi),0]
    const [withinLeft,discardLeft]=solid.splitByPlane(left,left[0]*cx+left[1]*cy)
    keep(withinLeft);keep(discardLeft)
    const [wedge,discardRight]=withinLeft.splitByPlane(right,right[0]*cx+right[1]*cy)
    keep(wedge);keep(discardRight)
    if(wedge.isEmpty()||wedge.status()!=='NoError')
      throw new Error(`Threefold radial sector ${sector+1} is empty or invalid. Check model bounds and parting symmetry.`)
    result.push(wedge)
  }
  return result
}
/** Four-part parts are split *before* any pins are added, so the second
 * plane cannot shear a pre-existing pin or socket into degenerate faces.
 * Then pin each adjacent pair on each finished mating interface. */
function keyFourParts(
  wasm:ManifoldToplevel,pieces:Manifold[],first:SplitAxis,firstAt:number,
  second:SplitAxis,secondAt:number,s:MoldSettings,plan:MoldPlan,
  keep:(m:Manifold)=>Manifold,
):Manifold[] {
  if(pieces.length!==4)throw new Error('Four-part registration needs four separate pieces.')
  const registered=pieces.slice()
  // Always measure key locations on the ORIGINAL four parts. Otherwise
  // first-seam pins extend the bounding boxes and move second-seam keys.
  const initial=pieces.map(p=>p.boundingBox())
  const span=(i:number,j:number,axis:SplitAxis):readonly [number,number]=>{
    const tangent=axis==='x'?1:0
    return [Math.max(initial[i].min[tangent],initial[j].min[tangent]),
      Math.min(initial[i].max[tangent],initial[j].max[tangent])]
  }
  for(const [i,j] of [[0,2],[1,3]]){
    const [low,high]=addKeys(wasm,registered[i],registered[j],first,firstAt,s,plan,keep,span(i,j,first))
    registered[i]=low;registered[j]=high
  }
  for(const [i,j] of [[0,1],[2,3]]){
    const [low,high]=addKeys(wasm,registered[i],registered[j],second,secondAt,s,plan,keep,span(i,j,second))
    registered[i]=low;registered[j]=high
  }
  return registered
}
/** Full-height negative, then one or two exact parting operations. */
export function buildMold(wasm:ManifoldToplevel,targetMesh:SolidMesh,settings:MoldSettings,onProgress?:(s:string,fraction?:number)=>void):MoldBuild {
  const s=parseMoldSettings(settings)
  const warnings:string[]=[]
  onProgress?.('Checking source geometry and mold settings…',0.06)
  if(s.mode==='silicone-box'){
    // Unlike a direct-negative cavity, a silicone
    // containment box never uses the target as a Boolean cutter. Only its
    // bounding coordinates are required. Validating/repairing target faces
    // here incorrectly rejects open STL/STEP parts and ordinary scans.
    if(targetMesh.positions.length%3||!targetMesh.positions.length||
       targetMesh.positions.some(x=>!Number.isFinite(x))){
      throw new Error('Cannot calculate silicone-box bounds from invalid target coordinates.')
    }
  }else{
    // Repair ONLY a temporary target for geometry actually using its faces.
    const repaired=repairMoldTarget(targetMesh,s.repairTarget,s.repairHoleSize,onProgress)
    targetMesh=repaired.mesh
    // Make the effective setting unambiguous. A persisted project may have
    // repairTarget=false even though automatic repair defaults to true in
    // fresh projects. When repair is on, the preflight should have handled
    // every exactly collapsed face; a failure here is a repair regression.
    try{
      check(targetMesh,s.repairTarget?'Target':'Target (automatic repair OFF)')
    }catch(error){
      const message=error instanceof Error?error.message:String(error)
      if(s.repairTarget&&/zero-area triangle|degenerate triangle indices/.test(message)){
        throw new Error(`Automatic target repair was ON but validation still failed: ${message} Please report this with the source mesh; the mold was not generated.`)
      }
      throw error
    }
    warnings.push(...repaired.warnings)
  }
  const plan=planMold(targetMesh,s)
  const heap:Manifold[]=[]
  const keep=(x:Manifold):Manifold=>{heap.push(x);return x}
  // One triangle BVH per generation, not once per clearance radius.
  // Thin negative shells compute two concentric offsets from the same input.
  const fieldRef:{current:SphericalDistanceField|null}={current:null}
  try{
    let solid:Manifold
    onProgress?.('Constructing full-height tooling from the source solid…',0.13)
    if(s.mode==='silicone-box'){
      const out=plan.outer,inn=plan.innerBox!
      let body:Manifold,empty:Manifold
      const innerHeight=inn.max[2]-inn.min[2]
      const draft=Math.tan(s.boxDraftDeg*Math.PI/180)*innerHeight
      if(plan.cylinder){
        const {cx,cy,outerR,innerR}=plan.cylinder
        body=keep(wasm.Manifold.cylinder(out.max[2]-out.min[2],outerR,outerR,96).translate([cx,cy,out.min[2]]))
        empty=keep(wasm.Manifold.cylinder(innerHeight,innerR,innerR+draft,96).translate([cx,cy,inn.min[2]]))
      }else{
        body=toManifold(wasm,boxSolid(out),keep)
        empty=toManifold(wasm,draftedBox(inn,draft),keep)
      }
      solid=keep(body.subtract(empty))
      warnings.push('The master still needs a support/attachment and a silicone-tight seal. This is a printable box, not an automatically suspended master.')
      if(s.boxDraftDeg>0)warnings.push('Draft is applied to the silicone BOX interior, not the master/cast cavity.')
    }else{
      // Use a solid-distance isosurface, not vertex-normal movement: a
      // spherical clearance rounds convex corners and avoids per-vertex
      // normal spikes. Zero clearance keeps the original cutter exactly.
      const dilate=(distance:number):Manifold=>{
        fieldRef.current??=createSphericalDistanceField(targetMesh,onProgress)
        const {solid,report}=sphericalOffset(wasm,targetMesh,distance,onProgress,s.offsetQuality,fieldRef.current)
        warnings.push(`Spherical distance-field offset ${distance} mm (${s.offsetQuality}) used a ${report.gridMm.toFixed(3)} mm grid (${report.gridSamples.toLocaleString()} samples; refinement tolerance ${report.toleranceMm.toFixed(3)} mm). Small features below this spacing may be lost; inspect the cavity before printing.`)
        return keep(solid)
      }
      const positive=s.clearance>0?dilate(s.clearance):toManifold(wasm,targetMesh,keep)
      {
        // The offset cutter may move *more* than d at a sharp corner.
        // Check its actual Manifold bounds against every outside wall, not
        // just sideMargin > clearance. Avoid accidental through-holes.
        const b=positive.boundingBox()
        const minimalMaterial=0.1
        for(let axis=0;axis<3;axis++){
          const lower=b.min[axis]-plan.outer.min[axis]
          const upper=plan.outer.max[axis]-b.max[axis]
          if(Math.min(lower,upper)<minimalMaterial){
            throw new Error(`Clearance ${s.clearance} mm breaks through the mold's ${['X','Y','Z'][axis]} wall (${Math.min(lower,upper).toFixed(3)} mm left). Increase outer margin/base thickness or decrease clearance.`)
          }
        }
        const block=plan.radialOuter
          ?keep(wasm.Manifold.cylinder(
            plan.outer.max[2]-plan.outer.min[2],
            plan.radialOuter.radius,plan.radialOuter.radius,192,
          ).translate([plan.radialOuter.cx,plan.radialOuter.cy,plan.outer.min[2]]))
          :toManifold(wasm,boxSolid(plan.outer),keep)
        solid=keep(block.subtract(positive))
      }
    }
    if(solid.isEmpty())throw new Error('The mold is empty. Increase the wall or margins.')
    let pieces:Manifold[]=[solid]
    const extent=extentOf(targetMesh.positions)
    if(s.parts===1&&s.mode!=='silicone-box'){
      // Deliberate single-sided one-piece impression. Multi-part modes
      // retain the entire target volume.
      pieces=[keep(solid.trimByPlane([0,0,-1],-plan.openingZ!))]
      warnings.push('One-piece mode reproduces only the bottom half; select 2 or 4 parts for a complete cavity.')
    }else if(s.parts===3){
      onProgress?.('Cutting three 120° radial mold sectors around the Z axis…',0.84)
      pieces=splitThreefold(solid,plan,keep)
      if(s.keys)warnings.push('Threefold radial tooling currently has NO automatic registration: choose external clamping or disable alignment. It is not the same as a threefold-symmetric master; verify your master geometry separately.')
      warnings.push('Threefold molds are three radial wedges around the XY center. Verify demolding, cavity clearances and corner release before printing.')
    }else if(s.parts!==1){
      onProgress?.('Cutting exact parting planes; applying mating pins and pockets…',0.84)
      const a=s.splitAxis,k=axisIndex(a)
      if(s.parts===4&&a==='z'&&s.keys)throw new Error('Four-part Z-first tooling with pins is not yet supported. Choose X/Y as the primary parting axis, or disable pins.')
      const firstAt=extent.min[k]+(extent.max[k]-extent.min[k])*s.splitPosition
      pieces=split(wasm,pieces,a,firstAt,s,plan,keep,s.parts===2&&s.keys)
      if(s.parts===4){
        const second:SplitAxis=a==='x'?'y':'x',j=axisIndex(second)
        const secondAt=center(extent.min[j],extent.max[j])
        pieces=split(wasm,pieces,second,secondAt,s,plan,keep,false)
        // Secondary split runs on the unkeyed bodies. Add interfaces once
        // every final component exists. Prevents cuts across existing keys.
        if(s.keys){
          pieces=keyFourParts(wasm,pieces,a,firstAt,second,secondAt,s,plan,keep)
        }
      }
        if(s.keys){
        if(s.mode==='silicone-box'&&!(s.keyStyle==='v-seam'&&s.parts===2))warnings.push('Registration is placed on external wall bosses at multiple heights. Printed pins require assembled clearance; metal dowel holes require separate hardware.')
        if(s.keyStyle==='v-seam'&&s.parts===4)warnings.push('Four-part molds currently use discrete pins or bosses instead of a continuous V-seam; use two parts for the V-seam.')
        if(s.keyStyle==='v-seam'&&s.parts===2)warnings.push(s.mode==='direct'?'A continuous contour-following triangular tongue-and-groove with exterior clamp ears provides registration; verify the clamping force and cast release before manufacturing.':'A wall-supported U-shaped triangular tongue-and-groove with exterior clamp ears registers the silicone box while leaving the pouring opening unobstructed.')
        else warnings.push(s.keyStyle==='metal-dowel'?
          `Paired blind sockets are sized for ${s.keyDiameter} mm metal dowels, with ${s.keyClearance} mm radial fit clearance. Insert separate dowels during assembly.`:
          `${s.keyStyle==='tapered-key'?'Tapered':'Straight'} printed registration pins and matching clearance sockets.`)
      }
      warnings.push('Splits do not guarantee demoldability: inspect the target for trapped undercuts and add a sprue or vent before casting.')
    }
    const loose:MoldPart[]=[]
    const mainParts=pieces.map((x,i)=>{
      onProgress?.(`Checking and exporting mold component ${i+1} of ${pieces.length}…`,0.90+0.08*i/pieces.length)
      return toPart(x,`Mold part ${i+1}`,warnings,loose)
    })
    if(mainParts.length!==s.parts)throw new Error('Part count mismatch: a component disappeared during splitting.')
    const parts=[...mainParts,...loose]
    const invalidOutput=warnings.some(w=>w.includes('excluded an invalid detached artifact'))
    const printable=!loose.length&&!invalidOutput
    if(!printable)warnings.unshift(
      'NOT PRINTABLE: the mold contains disconnected tooling material or an invalid generated fragment. These parts are preview-only; export is disabled. This cannot be fixed by increasing SDF resolution alone. Inspect the geometry and revise the cavity/split/registration.'
    )
    onProgress?.('Preparing mold components for inspection…',0.99)
    return {parts,printable,kind:s.mode,warnings,openingZ:plan.openingZ,targetBounds:extentOf(targetMesh.positions),
      volumeMm3:parts.reduce((v,p)=>v+p.volumeMm3,0),
      positions:parts[0].positions,indices:parts[0].indices}
  }finally{
    fieldRef.current?.dispose()
    for(let i=heap.length-1;i>=0;i--)heap[i].delete()
  }
}
