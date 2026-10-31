// SPDX-License-Identifier: AGPL-3.0-only
// Manifold mold geometry. Each mold component is exported as its own closed
// manifold: mating planes must NEVER be concatenated as one STL.
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import type { SolidMesh } from '../../../src/app/solids'
import { extentOf } from '../../../src/core/geometry/bounds'
import { closedness, type Triangles } from '../../mesh-tools/core/boolean'
import { offsetMesh } from '../../mesh-tools/core/offset'
import { signedVolume } from '../../mesh-tools/core/hollow'
import { parseMoldSettings, type MoldSettings, type SplitAxis } from './settings'

type Vec3 = [number,number,number]
export type Limits = { min:Vec3; max:Vec3 }
export interface MoldPart { name:string; positions:Float32Array; indices:Uint32Array; volumeMm3:number }
export interface MoldBuild {
  parts:MoldPart[]; kind:MoldSettings['mode']; warnings:string[]
  volumeMm3:number; openingZ:number|null
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
    if(area2===0)throw new Error(`${what} has a zero-area triangle at face ${i/3}. No geometry was silently discarded.`)
  }
  const c=closedness(mesh.indices,n)
  if(c.open||c.bad)throw new Error(`${what} is not watertight (${c.open} boundary edges, ${c.bad} nonmanifold edges). Repair it in Mesh Tools.`)
  if(!(signedVolume(mesh.positions,mesh.indices)>EPS))throw new Error(`${what} is inside-out or zero-volume.`)
}
export interface MoldPlan {
  outer:Limits; innerBox:Limits|null; openingZ:number|null
  cylinder:{cx:number;cy:number;outerR:number;innerR:number}|null
}
export function planMold(target:Triangles,settings:MoldSettings):MoldPlan {
  const s=parseMoldSettings(settings)
  if(!target.positions.length||!target.indices.length)throw new Error('Load a solid target.')
  const {min,max}=extentOf(target.positions)
  const size=min.map((v,i)=>max[i]-v)
  if(size.some(x=>!Number.isFinite(x)||x<=EPS))throw new Error('Target has zero extent.')
  const cx=center(min[0],max[0]),cy=center(min[1],max[1])
  if(s.mode==='silicone-box'){
    const bottom=min[2]-s.baseThickness,top=max[2]+s.siliconeThickness+s.wallThickness
    const innerBottom=min[2],innerTop=top+2
    const draft=(innerTop-innerBottom)*Math.tan(s.boxDraftDeg*Math.PI/180)
    if(s.boxShape==='cylindrical'){
      const innerR=Math.hypot(size[0]/2,size[1]/2)+s.siliconeThickness
      const outerR=innerR+draft+s.wallThickness
      return {outer:{min:[cx-outerR,cy-outerR,bottom],max:[cx+outerR,cy+outerR,top]},
        innerBox:{min:[cx-innerR,cy-innerR,innerBottom],max:[cx+innerR,cy+innerR,innerTop]},
        cylinder:{cx,cy,innerR,outerR},openingZ:null}
    }
    const innerBox:Limits={min:[min[0]-s.siliconeThickness,min[1]-s.siliconeThickness,innerBottom],
      max:[max[0]+s.siliconeThickness,max[1]+s.siliconeThickness,innerTop]}
    return {outer:{min:[innerBox.min[0]-s.wallThickness-draft,innerBox.min[1]-s.wallThickness-draft,bottom],
      max:[innerBox.max[0]+s.wallThickness+draft,innerBox.max[1]+s.wallThickness+draft,top]},
      innerBox,cylinder:null,openingZ:null}
  }
  if(s.mode==='direct'){
    if(s.sideMargin<=s.clearance)throw new Error('Outer margin must exceed cavity clearance.')
    if(s.baseThickness<=s.clearance)throw new Error('Cavity clearance must be smaller than base/top thickness, or the cutter breaks through the outside. Increase base thickness.')
    return {outer:{min:[min[0]-s.sideMargin,min[1]-s.sideMargin,min[2]-s.baseThickness],
      max:[max[0]+s.sideMargin,max[1]+s.sideMargin,max[2]+s.baseThickness]},
      innerBox:null,cylinder:null,openingZ:s.parts===1?center(min[2],max[2]):null}
  }
  const m=s.clearance+s.wallThickness+2
  return {outer:{min:[min[0]-m,min[1]-m,min[2]-m],max:[max[0]+m,max[1]+m,max[2]+m]},
    innerBox:null,cylinder:null,openingZ:s.parts===1?center(min[2],max[2]):null}
}
function toManifold(wasm:ManifoldToplevel,mesh:Triangles,keep:(m:Manifold)=>Manifold):Manifold {
  check(mesh,'Target or tooling solid')
  const m=new wasm.Mesh({numProp:3,vertProperties:mesh.positions,triVerts:mesh.indices})
  m.merge()
  const solid=keep(new wasm.Manifold(m))
  if(solid.status()!=='NoError'||solid.isEmpty())throw new Error('Solid was rejected by the geometry kernel.')
  return solid
}
function toPart(solid:Manifold,name:string):MoldPart {
  if(solid.isEmpty()||solid.status()!=='NoError')throw new Error(`${name} was empty after the Boolean.`)
  // A disconnected pin/fragment can be individually watertight yet be an
  // unprintable loose piece. Enforce exactly one solid body per STL.
  const islands=solid.decompose()
  try {
    if(islands.length!==1)throw new Error(`${name} contains ${islands.length} disconnected solids. Move the split or turn off keys.`)
  }finally{for(const island of islands)island.delete()}
  const m=solid.getMesh()
  const positions=new Float32Array(m.vertProperties)
  const indices=new Uint32Array(m.triVerts)
  check({positions,indices},name)
  return {name,positions,indices,volumeMm3:signedVolume(positions,indices)}
}
function offset(mesh:Triangles,d:number,warnings:string[]):Triangles {
  if(d===0)return mesh
  const before=signedVolume(mesh.positions,mesh.indices)
  const m=offsetMesh(mesh.positions,mesh.indices,mesh.positions.length/3,{distance:d})
  // The existing vertex-normal offset can merge folds and delete corners.
  // In mold tooling, this would silently erase fine casting details.
  if(m.report.merged>0){
    throw new Error(`Clearance ${d} mm merged ${m.report.merged} source vertices and would lose cavity details. Reduce clearance, use 0 mm, or use a simplified target. No malformed mold was exported.`)
  }
  const result={positions:m.positions,indices:m.indices}
  check(result,'Clearance-offset target')
  const after=signedVolume(result.positions,result.indices)
  // The cutter should always enlarge for +d; the rigid cavity should
  // therefore grow, never shrink. Compare volumes before subtracting.
  if(!(after>before)){
    throw new Error(`Clearance ${d} mm decreased or failed to enlarge the target volume (${before.toFixed(2)} → ${after.toFixed(2)} mm³). The mesh offset folded over; mold generation was stopped.`)
  }
  if(m.report.relaxed>0){
    warnings.push(`The ${d} mm normal-based clearance offset adjusted ${m.report.relaxed} vertices to mend folds. Verify the resulting cavity against the target; the algorithm is not a true solid dilation.`)
  }
  return result
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
  if(hi-lo<=inset*2)throw new Error('No safe room for alignment features along this seam. Reduce the diameter or use another split.')
  const chosen:number[]=[]
  const options=[...s.keyPositions].sort((a,b)=>a-b)
  for(const fraction of options){
    const x=lo+(hi-lo)*fraction
    if(x<lo+inset||x>hi-inset||chosen.some(y=>Math.abs(x-y)<stride)){
      if(s.keyPlacement==='manual'){
        throw new Error(`Alignment feature at ${Math.round(fraction*100)}% overlaps an edge or another feature on this seam. Move or remove it.`)
      }
      continue
    }
    chosen.push(x)
  }
  if(chosen.length<(s.keyPlacement==='auto'?2:1)){
    throw new Error('Insufficient space for the requested alignment features. Reduce diameter, move keys, or disable alignment.')
  }
  return chosen
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
function addKeys(
  wasm:ManifoldToplevel,negative:Manifold,positive:Manifold,
  axis:SplitAxis,split:number,s:MoldSettings,plan:MoldPlan,keep:(m:Manifold)=>Manifold,
):[Manifold,Manifold] {
  // Key geometry sits in the backing base, not against casting surfaces.
  // Metal dowel mode cuts blind clearance sockets on BOTH mating halves.
  if(s.mode==='thin-negative-shell')return [negative,positive]
  if(s.mode==='silicone-box'&&axis==='z')throw new Error('Z split registration could pierce silicone box walls; choose X/Y or disable keys.')
  if(s.baseThickness<s.keyDiameter+2*s.keyClearance+0.2)throw new Error('Base too thin for registration features. Increase base or reduce dowel diameter.')
  const base=plan.outer,idx=axisIndex(axis),z=base.min[2]+s.baseThickness/2
  const locations:Vec3[]=[]
  if(axis==='z'){
    const cy=center(base.min[1],base.max[1]),cx=center(base.min[0],base.max[0])
    const radius=(plan.cylinder?.outerR??(base.max[0]-base.min[0])/2)
    const rx=radius-s.keyDiameter/2-s.keyClearance-1.2
    if(rx<s.keyDiameter)throw new Error('Not enough exterior wall for Z-parting registration.')
    locations.push([cx-rx,cy,split],[cx+rx,cy,split])
  }else{
    const n:SplitAxis=axis==='x'?'y':'x',t=axisIndex(n)
    const a=negative.boundingBox(),b=positive.boundingBox()
    const lo=Math.max(a.min[t],b.min[t]),hi=Math.min(a.max[t],b.max[t])
    const coords=seamPositions(lo,hi,s)
    for(const x of coords){
      const p:Vec3=[center(base.min[0],base.max[0]),center(base.min[1],base.max[1]),z]
      p[idx]=split
      p[t]=x
      locations.push(p)
    }
  }
  let a=negative,b=positive
  const L=s.keyDepth,embed=Math.min(0.5,L*0.25)
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
  for(const [i,j] of [[0,2],[1,3]]){
    const [low,high]=addKeys(wasm,registered[i],registered[j],first,firstAt,s,plan,keep)
    registered[i]=low;registered[j]=high
  }
  for(const [i,j] of [[0,1],[2,3]]){
    const [low,high]=addKeys(wasm,registered[i],registered[j],second,secondAt,s,plan,keep)
    registered[i]=low;registered[j]=high
  }
  return registered
}
/** Full-height negative, then one or two exact parting operations. */
export function buildMold(wasm:ManifoldToplevel,targetMesh:SolidMesh,settings:MoldSettings,onProgress?:(s:string)=>void):MoldBuild {
  const s=parseMoldSettings(settings)
  check(targetMesh,'Target')
  const plan=planMold(targetMesh,s)
  const heap:Manifold[]=[]
  const keep=(x:Manifold):Manifold=>{heap.push(x);return x}
  const warnings:string[]=[]
  try{
    let solid:Manifold
    onProgress?.('Constructing full-height tooling from the source solid…')
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
      if(s.clearance>0)warnings.push('Mesh offset clearance can merge gaps narrower than twice the clearance. Check fine features.')
      const positive=toManifold(wasm,offset(targetMesh,s.clearance,warnings),keep)
      if(s.mode==='direct'){
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
        solid=keep(toManifold(wasm,boxSolid(plan.outer),keep).subtract(positive))
      }else{
        const skin=toManifold(wasm,offset(targetMesh,s.clearance+s.wallThickness,warnings),keep)
        const outerVolume=skin.volume(),innerVolume=positive.volume()
        if(outerVolume<=innerVolume)throw new Error('Shell offset lost its enclosing material. Increase shell thickness or fix target geometry.')
        solid=keep(skin.subtract(positive))
        warnings.push('Thin shells use normal-based surface offsets. Small features and tight concavities can fail; verify the result before printing.')
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
    }else if(s.parts!==1){
      onProgress?.('Cutting exact parting planes; applying mating pins and pockets…')
      const a=s.splitAxis,k=axisIndex(a)
      if(s.parts===4&&a==='z'&&s.keys&&s.mode!=='thin-negative-shell')throw new Error('Four-part Z-first tooling with pins is not yet supported. Choose X/Y as the primary parting axis, or disable pins.')
      const firstAt=extent.min[k]+(extent.max[k]-extent.min[k])*s.splitPosition
      pieces=split(wasm,pieces,a,firstAt,s,plan,keep,s.parts===2&&s.keys)
      if(s.parts===4){
        const second:SplitAxis=a==='x'?'y':'x',j=axisIndex(second)
        const secondAt=center(extent.min[j],extent.max[j])
        pieces=split(wasm,pieces,second,secondAt,s,plan,keep,false)
        // Secondary split runs on the unkeyed bodies. Add interfaces once
        // every final component exists. Prevents cuts across existing keys.
        if(s.keys&&s.mode!=='thin-negative-shell'){
          pieces=keyFourParts(wasm,pieces,a,firstAt,second,secondAt,s,plan,keep)
        }
      }
      if(s.keys&&s.mode==='thin-negative-shell')warnings.push('Registration on thin conformal shells is not implemented; use an external clamp/jacket.')
      if(s.keys&&s.mode!=='thin-negative-shell'){
        warnings.push(s.keyStyle==='metal-dowel'?
          `Paired blind sockets are sized for ${s.keyDiameter} mm metal dowels, with ${s.keyClearance} mm radial fit clearance. Insert separate dowels during assembly.`:
          `${s.keyStyle==='tapered-key'?'Tapered':'Straight'} printed registration pins and matching clearance sockets.`)
      }
      warnings.push('Splits do not guarantee demoldability: inspect the target for trapped undercuts and add a sprue or vent before casting.')
    }
    const parts=pieces.map((x,i)=>toPart(x,`Mold part ${i+1}`))
    if(parts.length!==s.parts)throw new Error('Part count mismatch: a component disappeared during splitting.')
    return {parts,kind:s.mode,warnings,openingZ:plan.openingZ,
      volumeMm3:parts.reduce((v,p)=>v+p.volumeMm3,0),
      positions:parts[0].positions,indices:parts[0].indices}
  }finally{for(let i=heap.length-1;i>=0;i--)heap[i].delete()}
}
