// SPDX-License-Identifier: AGPL-3.0-only
// Engrave an individual seam number near EACH mating edge. Its neighbor
// receives the SAME number at the other side of that edge. Labels are
// shallow real printable geometry on the OUTER wall, never on the seam,
// key, sprue, cavity or inner mold surface.
import type {Manifold,ManifoldToplevel} from 'manifold-3d'
import type {MoldSettings,SplitAxis} from './settings'
import type {MoldPlan,Limits} from './geometry'

type Vec3=[number,number,number]
type Axis=SplitAxis
type Surface='x'|'y'|'radial'
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
/** The old grouped text remains useful as a legend / testable mapping, but
 * individual physical numbers are no longer engraved together at the center. */
export function labelsForParts(parts:number):string[]{
  const result=Array.from({length:parts},()=>[] as number[])
  for(const mark of matingMarks(parts))for(const i of mark.pair)result[i].push(mark.number)
  return result.map(ns=>ns.sort((a,b)=>a-b).join('-'))
}
const center=(a:number,b:number)=>(a+b)/2
const axisIndex=(axis:Axis):0|1|2=>axis==='x'?0:axis==='y'?1:2
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v))
const digitHeight=4
export interface SeamNumberPlacement {
  number:number
  partIndex:number
  /** Source-coordinate location at the actual outer tooling wall. */
  center:Vec3
  surface:Surface
  /** Flat-face direction, or angle of the outward cylinder normal. */
  sign:1|-1
  angleRad:number
  scale:number
  seamAxis:Axis|'radial'
  seamAt:number
}
/** A small number is set *beside* each parting plane, on the outer wall.
 * This is a geometric, testable planner independent of Manifold's Booleans. */
export function planSeamNumberPlacements(
  outer:Limits,source:Limits,s:MoldSettings,partBounds:readonly Limits[],
  outerRadius:number|null,
):SeamNumberPlacement[]{
  if(s.parts<2)return []
  const cx=center(outer.min[0],outer.max[0])
  const cy=center(outer.min[1],outer.max[1])
  const axisPrimary=s.splitAxis
  const axisSecondary:Axis=axisPrimary==='x'?'y':'x'
  const splitPrimary=source.min[axisIndex(axisPrimary)]+
    (source.max[axisIndex(axisPrimary)]-source.min[axisIndex(axisPrimary)])*s.splitPosition
  const splitSecondary=center(source.min[axisIndex(axisSecondary)],
    source.max[axisIndex(axisSecondary)])
  const result:SeamNumberPlacement[]=[]
  for(const mark of matingMarks(s.parts)){
    const seamAxis:Axis|'radial'=s.parts===3?'radial':
      s.parts===2?axisPrimary:mark.number%2===1?axisSecondary:axisPrimary
    const seamAt=seamAxis==='radial'?((mark.number%3)*2*Math.PI/3):
      seamAxis===axisPrimary?splitPrimary:splitSecondary
    // Radial seams do not have a Cartesian axis; the index is used only
    // in X/Y/Z seam branches. Keep a valid tuple index for TypeScript.
    const k:0|1|2=seamAxis==='radial'?0:axisIndex(seamAxis)
    for(const partIndex of mark.pair){
      const bounds=partBounds[partIndex]
      if(!bounds)continue
      const zspan=bounds.max[2]-bounds.min[2]
      const scale=clamp(zspan/8,0.60,1.05)
      const mid:Vec3=[center(bounds.min[0],bounds.max[0]),
        center(bounds.min[1],bounds.max[1]),
        center(bounds.min[2],bounds.max[2])]
      let surface:Surface='x',sign:1|-1=1,angleRad=0
      const pos:Vec3=[...mid]
      if(outerRadius!==null){
        surface='radial'
        let theta:number
        if(seamAxis==='radial'){
          // A 120° sector has a number at EACH end of its external arc.
          // Move the glyph into its own wedge by at least half a glyph
          // width + margin, away from the seam and adjacent part.
          const offset=clamp((1.2*scale+1.7)/outerRadius,0.035,0.30)
          theta=seamAt+(partIndex===mark.number%3?offset:-offset)
        }else if(seamAxis==='z'){
          theta=Math.atan2(mid[1]-cy,mid[0]-cx)
          // Two horizontal halves share the same circumferential seam;
          // use the same visible side for their matching labels.
          if(Math.hypot(mid[0]-cx,mid[1]-cy)<1e-5)theta=0
        }else{
          // Intersect the actual XY parting line with the outer circle,
          // then move one glyph width into the appropriate adjacent part.
          const other=k===0?1:0
          const side=mid[other]>=center(outer.min[other],outer.max[other])?1:-1
          const radialOffset=seamAt-(k===0?cx:cy)
          const chord=Math.sqrt(Math.max(0,outerRadius**2-radialOffset**2))
          const x=k===0?seamAt:cx+side*chord
          const y=k===1?seamAt:cy+side*chord
          const edge=Math.atan2(y-cy,x-cx)
          const offset=clamp((1.2*scale+1.7)/outerRadius,0.035,0.32)
          const choose=(a:number)=>{
            const coord=(k===0?cx+outerRadius*Math.cos(a):cy+outerRadius*Math.sin(a))
            const partSide=mid[k]<seamAt?-1:1
            return (coord-seamAt)*partSide
          }
          theta=choose(edge+offset)>choose(edge-offset)?edge+offset:edge-offset
        }
        angleRad=theta
        pos[0]=cx+outerRadius*Math.cos(theta)
        pos[1]=cy+outerRadius*Math.sin(theta)
      }else{
        // For a plane X or Y, stamp on a PERPENDICULAR exterior face so
        // both sides of the mating edge are visible from outside.
        surface=seamAxis==='x'?'y':'x'
        const f=axisIndex(surface)
        const outside=center(outer.min[f],outer.max[f])
        sign=mid[f]<outside?-1:1
        if(Math.abs(mid[f]-outside)<1e-5)sign=1
        pos[f]=sign<0?outer.min[f]:outer.max[f]
      }
      if(seamAxis==='z'){
        const side=mid[2]<seamAt?-1:1
        const margin=2.1*scale+0.65
        const desired=seamAt+side*margin
        pos[2]=clamp(desired,bounds.min[2]+digitHeight*scale/2+.25,
          bounds.max[2]-digitHeight*scale/2-.25)
      }else if(seamAxis!=='radial'&&outerRadius===null){
        const side=mid[k]<seamAt?-1:1
        const margin=1.2*scale+1
        const desired=seamAt+side*margin
        pos[k]=clamp(desired,bounds.min[k]+1.1*scale+.15,
          bounds.max[k]-1.1*scale-.15)
      }
      result.push({number:mark.number,partIndex,center:pos,surface,
        sign,angleRad,scale,seamAxis,seamAt})
    }
  }
  return result
}

type Segment='a'|'b'|'c'|'d'|'e'|'f'|'g'
const DIGITS:Record<string,Segment[]>={
  '1':['b','c'],'2':['a','b','g','e','d'],
  '3':['a','b','g','c','d'],'4':['f','g','b','c'],
}
const strokes:Record<Segment,[number,number,number,number]>={
  a:[0.30,3.60,1.70,3.95],g:[0.30,1.83,1.70,2.17],
  d:[0.30,0.05,1.70,0.40],
  b:[1.65,2.10,2.00,3.80],c:[1.65,0.20,2.00,1.90],
  f:[0,2.10,0.35,3.80],e:[0,0.20,0.35,1.90],
}
function numberCutters(
  wasm:ManifoldToplevel,placement:SeamNumberPlacement,outerRadius:number|null,
  cx:number,cy:number,depth:number,keep:(m:Manifold)=>Manifold,
):Manifold[]{
  const pieces:Manifold[]=[]
  const {surface,center:at,scale,number,sign,angleRad}=placement
  for(const seg of DIGITS[String(number)]??[]){
    const [x0,y0,x1,y1]=strokes[seg]
    const u0=(x0-1)*scale,u1=(x1-1)*scale
    const v0=(y0-2)*scale,v1=(y1-2)*scale
    let mn:Vec3,mx:Vec3
    if(surface==='radial'){
      const R=outerRadius!
      mn=[R-depth,u0,at[2]+v0]
      mx=[R+.6,u1,at[2]+v1]
    }else if(surface==='x'){
      const uSign=sign
      const a=at[1]+uSign*u0,b=at[1]+uSign*u1
      mn=[sign<0?at[0]-.6:at[0]-depth,Math.min(a,b),at[2]+v0]
      mx=[sign<0?at[0]+depth:at[0]+.6,Math.max(a,b),at[2]+v1]
    }else{
      const uSign=-sign
      const a=at[0]+uSign*u0,b=at[0]+uSign*u1
      mn=[Math.min(a,b),sign<0?at[1]-.6:at[1]-depth,at[2]+v0]
      mx=[Math.max(a,b),sign<0?at[1]+depth:at[1]+.6,at[2]+v1]
    }
    const size:Vec3=[mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]]
    if(size.some(x=>x<=0))continue
    let stamp=keep(wasm.Manifold.cube(size).translate(mn))
    if(surface==='radial'){
      stamp=keep(stamp.rotate([0,0,angleRad*180/Math.PI]))
      stamp=keep(stamp.translate([cx,cy,0]))
    }
    pieces.push(stamp)
  }
  return pieces
}
export function engraveInterfaceNumbers(
  wasm:ManifoldToplevel,pieces:Manifold[],plan:MoldPlan,s:MoldSettings,
  sourceBounds:Limits,keep:(m:Manifold)=>Manifold,warnings:string[],
):Manifold[]{
  if(!s.interfaceLabels||pieces.length<2)return pieces
  const outer=plan.outer
  const radius=plan.radialOuter?.radius??plan.cylinder?.outerR??null
  const cx=center(outer.min[0],outer.max[0])
  const cy=center(outer.min[1],outer.max[1])
  const placements=planSeamNumberPlacements(
    outer,sourceBounds,s,pieces.map(p=>p.boundingBox() as Limits),radius)
  const output=pieces.slice()
  for(let part=0;part<output.length;part++){
    const mine=placements.filter(p=>p.partIndex===part)
    if(!mine.length)continue
    let solid=output[part]
    for(const place of mine){
      const bounds=solid.boundingBox()
      if(bounds.max[2]-bounds.min[2]<digitHeight*place.scale+0.5){
        warnings.push(`Skipped seam ${place.number} on part ${part+1}: not enough external label height.`)
        continue
      }
      try{
        const cuts=numberCutters(wasm,place,radius,cx,cy,
          Math.max(.6,Math.min(1.1,plan.material.wall*.32)),keep)
        if(!cuts.length)continue
        let cutter=cuts[0]
        for(let j=1;j<cuts.length;j++)cutter=keep(cutter.add(cuts[j]))
        const candidate=keep(solid.subtract(cutter))
        const removed=solid.volume()-candidate.volume()
        if(candidate.isEmpty()||candidate.status()!=='NoError'||removed<1e-5){
          warnings.push(`Could not engrave seam ${place.number} on part ${part+1} near its mating edge; original geometry retained.`)
          continue
        }
        solid=candidate
      }catch{
        warnings.push(`Could not engrave seam ${place.number} on part ${part+1}; original geometry retained.`)
      }
    }
    output[part]=solid
  }
  return output
}
