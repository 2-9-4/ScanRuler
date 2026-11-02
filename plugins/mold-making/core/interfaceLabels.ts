// SPDX-License-Identifier: AGPL-3.0-only
// Shallow seven-segment numeric engraving on the outside of each printable
// mold piece. Every shared interface has the SAME number on both neighbors.
// No labels are stamped on the mating face or through the cavity.
import type {Manifold,ManifoldToplevel} from 'manifold-3d'
import type {MoldSettings,SplitAxis} from './settings'
import type {MoldPlan,Limits} from './geometry'

type V3=[number,number,number]
export interface MatingMark {pair:[number,number];number:number}
export const matingMarks=(parts:number):MatingMark[]=>{
  if(parts===2)return [{pair:[0,1],number:1}]
  if(parts===3)return [
    {pair:[0,1],number:1},{pair:[1,2],number:2},{pair:[2,0],number:3},
  ]
  if(parts===4)return [
    {pair:[0,1],number:1},{pair:[1,3],number:2},
    {pair:[3,2],number:3},{pair:[2,0],number:4},
  ]
  return []
}
export function labelsForParts(parts:number):string[]{
  const result=Array.from({length:parts},()=>[] as number[])
  for(const mark of matingMarks(parts))for(const i of mark.pair)result[i].push(mark.number)
  return result.map(ns=>ns.sort((a,b)=>a-b).join('-'))
}
type Segment='a'|'b'|'c'|'d'|'e'|'f'|'g'
const DIGITS:Record<string,Segment[]>={
  '1':['b','c'],'2':['a','b','g','e','d'],
  '3':['a','b','g','c','d'],'4':['f','g','b','c'],
  '-':['g'],
}
const strokes:Record<Segment,[number,number,number,number]>={
  a:[0.3,3.6,1.7,3.95],g:[0.3,1.83,1.7,2.17],
  d:[0.3,.05,1.7,.4],
  b:[1.65,2.1,2,3.8],c:[1.65,.2,2,1.9],
  f:[0,2.1,.35,3.8],e:[0,.2,.35,1.9],
}
const center=(a:number,b:number)=>(a+b)/2
const shapeBox=(min:V3,max:V3)=>({min,max})
/** Use the six basic strokes (plus a middle bar) as shallow, robust solid
 * cutters; no fonts/text shaping system or raster Boolean is required.
 */
export function engraveInterfaceNumbers(
  wasm:ManifoldToplevel,pieces:Manifold[],plan:MoldPlan,s:MoldSettings,
  keep:(m:Manifold)=>Manifold,warnings:string[],
):Manifold[]{
  if(!s.interfaceLabels||pieces.length<2)return pieces
  const labels=labelsForParts(s.parts),outer=plan.outer
  const out=pieces.slice(),cx=center(outer.min[0],outer.max[0])
  const cy=center(outer.min[1],outer.max[1])
  const outerRadius=plan.radialOuter?.radius??plan.cylinder?.outerR??null
  const secondary:SplitAxis=s.splitAxis==='x'?'y':'x'
  const faceAxis:SplitAxis=s.parts===3?'x':
    s.splitAxis==='z'?'x':s.splitAxis
  const normalIndex=faceAxis==='x'?0:1
  const tangentIndex=normalIndex===0?1:0
  const bnd=(m:Manifold):Limits=>m.boundingBox() as Limits
  for(let i=0;i<Math.min(out.length,labels.length);i++){
    const label=labels[i]
    if(!label)continue
    const bounds=bnd(out[i])
    const height=bounds.max[2]-bounds.min[2]
    const scale=Math.min(1.1,Math.max(0.5,height/8))
    const glyphWidth=3.0*scale
    const width=label.length*glyphWidth
    const depth=Math.min(1.1,Math.max(0.5,plan.material.wall*.32))
    // Place both interface indices on one outside face of each mold part.
    // For a round body, a tangent cutter hits the curved exterior at the
    // part's outward bisector (not at the XY bounding-box corner).
    let angle=0,radial=outerRadius??0
    if(outerRadius!==null){
      if(s.parts===3)angle=(i+.5)*2*Math.PI/3
      else if(s.parts===2){
        angle=s.splitAxis==='x'?(i===0?Math.PI:0):
          s.splitAxis==='y'?(i===0?-Math.PI/2:Math.PI/2):0
      }else{
        const mid=bnd(out[i])
        const x=center(mid.min[0],mid.max[0])-cx
        const y=center(mid.min[1],mid.max[1])-cy
        angle=Math.atan2(y,x)
      }
    }
    // For flat bodies select an actual outside wall belonging to the part.
    const splitCenter=normalIndex===0?cx:cy
    const side=center(bounds.min[normalIndex],bounds.max[normalIndex])<splitCenter?-1:1
    const plane=side<0?outer.min[normalIndex]:outer.max[normalIndex]
    const tangent=center(bounds.min[tangentIndex],bounds.max[tangentIndex])
    const z=center(bounds.min[2],bounds.max[2])
    // Skip illegibly tiny parts rather than rejecting a working mold.
    if(height<3||outer.max[tangentIndex]-outer.min[tangentIndex]<width+1){
      warnings.push('Interface number engraving skipped on a tiny mold part; use physical part labels during assembly.')
      continue
    }
    const cutters:Manifold[]=[]
    try{
      for(let g=0;g<label.length;g++)for(const seg of DIGITS[label[g]]??[]){
        const [left,bottom,right,top]=strokes[seg]
        const u0=(g*glyphWidth+left*scale-width/2)
        const u1=(g*glyphWidth+right*scale-width/2)
        const v0=(bottom-2)*scale,v1=(top-2)*scale
        let min:V3,max:V3
        if(outerRadius!==null){
          min=[radial-depth,u0,z+v0]
          max=[radial+.4,u1,z+v1]
        }else if(normalIndex===0){
          min=[side<0?plane-.4:plane-depth,tangent+u0,z+v0]
          max=[side<0?plane+depth:plane+.4,tangent+u1,z+v1]
        }else{
          min=[tangent+u0,side<0?plane-.4:plane-depth,z+v0]
          max=[tangent+u1,side<0?plane+depth:plane+.4,z+v1]
        }
        const mesh=shapeBox(min,max)
        // Actual boxSolid-to-Manifold conversion is kept local to avoid
        // coupling this module to the geometry generator's private helper.
        const x=max[0]-min[0],y=max[1]-min[1],zz=max[2]-min[2]
        if(x<=0||y<=0||zz<=0)continue
        let stamp=keep(wasm.Manifold.cube([x,y,zz]))
        stamp=keep(stamp.translate(min))
        if(outerRadius!==null){
          stamp=keep(stamp.rotate([0,0,angle*180/Math.PI]))
          stamp=keep(stamp.translate([cx,cy,0]))
        }
        cutters.push(stamp)
      }
      if(!cutters.length)continue
      let merged=cutters[0]
      for(let j=1;j<cutters.length;j++)merged=keep(merged.add(cutters[j]))
      const result=keep(out[i].subtract(merged))
      if(result.isEmpty()||result.status()!=='NoError'){
        warnings.push(`Interface marking failed on mold part ${i+1}; original part preserved.`)
        continue
      }
      out[i]=result
    }catch{
      warnings.push(`Interface marking was not possible on mold part ${i+1}; original part preserved.`)
    }
  }
  void secondary
  return out
}
