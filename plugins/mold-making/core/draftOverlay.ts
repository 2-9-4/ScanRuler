// SPDX-License-Identifier: AGPL-3.0-only
// Read-only colored source triangles, clipped exactly as the report's
// one-, two-, three- or four-part release regions.
import type {Triangles} from '../../mesh-tools/core/boolean'
import type {MoldSettings,SplitAxis} from './settings'
import {
  moldDraftPartition,twoPartDraftRegions,visitDraftFaces,type DraftPartition,
} from './draftPartitions'

export type DraftView='both'|'negative'|'positive'|`part-${number}`
export type DraftColorMode='classes'|'heatmap'
export type DraftClass='reverse'|'low'|'adequate'
export interface DraftOverlayData {
  positions:Float32Array
  /** Part/sector index per output triangle (kept as 'half' for 2-part compatibility). */
  half:Uint8Array
  angleDeg:Float32Array
  sourceTriangle:Uint32Array
}
export interface DraftDisplayOptions {
  show:boolean
  view:DraftView
  mode:DraftColorMode
  problemsOnly:boolean
  opacity:number
  thresholdDeg:number
}
export const DEFAULT_DRAFT_DISPLAY:Readonly<DraftDisplayOptions>=Object.freeze({
  show:true,view:'both',mode:'classes',problemsOnly:false,opacity:0.94,thresholdDeg:2,
})
export function buildPartitionDraftOverlay(
  mesh:Triangles,partition:DraftPartition,
):DraftOverlayData{
  const vertices:number[]=[],partIndices:number[]=[],angles:number[]=[],ids:number[]=[]
  visitDraftFaces(mesh,partition,face=>{
    vertices.push(...face.a,...face.b,...face.c)
    partIndices.push(face.partIndex)
    angles.push(face.angleDeg)
    ids.push(face.sourceTriangle)
  })
  return {
    positions:Float32Array.from(vertices),half:Uint8Array.from(partIndices),
    angleDeg:Float32Array.from(angles),sourceTriangle:Uint32Array.from(ids),
  }
}
/** Compatibility API for consumers that explicitly request two halves. */
export function buildDraftOverlay(mesh:Triangles,axis:SplitAxis,splitAtMm:number):DraftOverlayData {
  if(!Number.isFinite(splitAtMm))throw new Error('Draft overlay requires a finite split location.')
  return buildPartitionDraftOverlay(mesh,twoPartDraftRegions(axis,splitAtMm))
}
export function buildMoldDraftOverlay(mesh:Triangles,s:MoldSettings):DraftOverlayData {
  return buildPartitionDraftOverlay(mesh,moldDraftPartition(mesh,s))
}
export function draftClass(angle:number,threshold:number):DraftClass{
  return angle< -1e-6?'reverse':angle<threshold?'low':'adequate'
}
/** The colors are deliberately perceptually distinct, not interpolated
 * across neighboring source triangles or across opposite mold halves. */
export function draftFaceRgb(angle:number,threshold:number,mode:DraftColorMode):[number,number,number]{
  if(mode==='classes'){
    const cls=draftClass(angle,threshold)
    return cls==='reverse'?[0.91,0.14,0.15]:cls==='low'?[1,0.66,0.1]:[0.16,0.76,0.46]
  }
  // Continuous signed-angle map: negative angles red, near-zero orange,
  // insufficient positive yellow, sufficient positive green.
  if(angle<0){
    const t=Math.min(1,Math.max(0,(angle+45)/45))
    return [0.88+0.12*t,0.12+0.35*t,0.17]
  }
  if(angle<threshold){
    const t=threshold>0?angle/threshold:1
    return [1,0.5+0.27*t,0.06+0.06*t]
  }
  const t=Math.min(1,(angle-threshold)/Math.max(1,45-threshold))
  return [0.64-0.47*t,0.79-0.04*t,0.19+0.28*t]
}
export function draftVisibleFaces(data:DraftOverlayData,opts:DraftDisplayOptions):Uint32Array{
  const result:number[]=[]
  for(let i=0;i<data.angleDeg.length;i++){
    const selected=opts.view==='both'?null:
      opts.view==='negative'?0:opts.view==='positive'?1:
      Number(opts.view.slice(5))
    if(selected!==null&&data.half[i]!==selected)continue
    if(opts.problemsOnly&&draftClass(data.angleDeg[i],opts.thresholdDeg)==='adequate')continue
    result.push(i)
  }
  return Uint32Array.from(result)
}
