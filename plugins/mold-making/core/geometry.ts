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
function offset(mesh:Triangles,d:number):Triangles {
  if(d===0)return mesh
  const m=offsetMesh(mesh.positions,mesh.indices,mesh.positions.length/3,{distance:d})
  const result={positions:m.positions,indices:m.indices}
  check(result,'Offset target')
  return result
}
function pinSolid(
  wasm:ManifoldToplevel,axis:SplitAxis,centre:Vec3,length:number,radius:number,
  keep:(m:Manifold)=>Manifold,
):Manifold {
  const raw=keep(wasm.Manifold.cylinder(length,radius,radius,32,true))
  const rotation:Vec3=axis==='x'?[0,90,0]:axis==='y'?[-90,0,0]:[0,0,0]
  return keep(keep(raw.rotate(rotation)).translate(centre))
}
function addKeys(
  wasm:ManifoldToplevel,negative:Manifold,positive:Manifold,
  axis:SplitAxis,split:number,s:MoldSettings,plan:MoldPlan,keep:(m:Manifold)=>Manifold,
):[Manifold,Manifold] {
  // Keys are located in the solid floor below the target. They cannot
  // pierce fine cavity features. For Z parting, use the outer wall.
  if(s.mode==='thin-negative-shell')return [negative,positive]
  if(s.baseThickness<s.keyDiameter+2*s.keyClearance+0.2)throw new Error('Base is too thin for the registration pins. Increase it or turn pins off.')
  const base=plan.outer,idx=axisIndex(axis),z=base.min[2]+s.baseThickness/2
  const locs:Vec3[]=[]
  if(axis==='z'){
    const cy=center(base.min[1],base.max[1])
    const cx=center(base.min[0],base.max[0])
    const radius=(plan.cylinder?.outerR??(base.max[0]-base.min[0])/2)
    const rx=radius-s.keyDiameter/2-s.keyClearance-0.35
    if(rx<s.keyDiameter)throw new Error('Mold too narrow for Z-parting keys.')
    locs.push([cx-rx,cy,split],[cx+rx,cy,split])
  }else{
    const n:SplitAxis=axis==='x'?'y':'x',t=axisIndex(n)
    const a=negative.boundingBox(),b=positive.boundingBox()
    const lo=Math.max(a.min[t],b.min[t]),hi=Math.min(a.max[t],b.max[t])
    if(hi-lo<2.5*s.keyDiameter+2*s.keyClearance)throw new Error('Mold too narrow for paired keys; reduce pin diameter.')
    const mid=center(lo,hi),spread=(hi-lo)*0.24
    for(const x of [mid-spread,mid+spread]){
      const p:Vec3=[center(base.min[0],base.max[0]),center(base.min[1],base.max[1]),z]
      p[idx]=split
      p[t]=x
      locs.push(p)
    }
  }
  let a=negative,b=positive
  const L=s.keyDepth,embed=Math.min(0.5,L*0.25)
  for(const p of locs){
    const male:Vec3=[...p],female:Vec3=[...p]
    male[idx]+=(L-embed)/2
    female[idx]+=(L+2*s.keyClearance+0.3)/2-0.15
    a=keep(a.add(pinSolid(wasm,axis,male,L+embed,s.keyDiameter/2,keep)))
    b=keep(b.subtract(pinSolid(wasm,axis,female,L+2*s.keyClearance+0.3,s.keyDiameter/2+s.keyClearance,keep)))
    if(a.isEmpty()||b.isEmpty())throw new Error('Registration keys removed a mold component.')
  }
  return [a,b]
}
function split(
  wasm:ManifoldToplevel,solids:Manifold[],axis:SplitAxis,at:number,
  s:MoldSettings,plan:MoldPlan,keep:(m:Manifold)=>Manifold,
):Manifold[] {
  const out:Manifold[]=[]
  for(const solid of solids){
    const [pos,neg]=solid.splitByPlane(normal(axis),at)
    keep(pos);keep(neg)
    if(pos.isEmpty()||neg.isEmpty())throw new Error(`The ${axis.toUpperCase()} parting plane misses one of the mold sections. Adjust the plane.`)
    const [a,b]=s.keys?addKeys(wasm,neg,pos,axis,at,s,plan,keep):[neg,pos]
    out.push(a,b)
  }
  return out
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
      const positive=toManifold(wasm,offset(targetMesh,s.clearance),keep)
      if(s.mode==='direct')solid=keep(toManifold(wasm,boxSolid(plan.outer),keep).subtract(positive))
      else{
        const skin=toManifold(wasm,offset(targetMesh,s.clearance+s.wallThickness),keep)
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
      if(s.parts===4&&a==='z'&&s.keys)throw new Error('Four-part Z-first tooling with pins is not yet supported. Choose X/Y as the primary parting axis, or disable pins.')
      pieces=split(wasm,pieces,a,extent.min[k]+(extent.max[k]-extent.min[k])*s.splitPosition,s,plan,keep)
      if(s.parts===4){
        const second:SplitAxis=a==='x'?'y':'x',j=axisIndex(second)
        pieces=split(wasm,pieces,second,center(extent.min[j],extent.max[j]),s,plan,keep)
      }
      if(s.keys&&s.mode==='thin-negative-shell')warnings.push('Pins on thin conformal shells are not yet implemented; use an external clamp/jacket.')
      warnings.push('Splits do not guarantee demoldability: inspect the target for trapped undercuts and add a sprue or vent before casting.')
    }
    const parts=pieces.map((x,i)=>toPart(x,`Mold part ${i+1}`))
    if(parts.length!==s.parts)throw new Error('Part count mismatch: a component disappeared during splitting.')
    return {parts,kind:s.mode,warnings,openingZ:plan.openingZ,
      volumeMm3:parts.reduce((v,p)=>v+p.volumeMm3,0),
      positions:parts[0].positions,indices:parts[0].indices}
  }finally{for(let i=heap.length-1;i>=0;i--)heap[i].delete()}
}
