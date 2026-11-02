// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid} from '../core/geometry'
import {
  buildDraftOverlay,draftClass,draftFaceRgb,draftVisibleFaces,
  DEFAULT_DRAFT_DISPLAY,
} from '../core/draftOverlay'

describe('Source-surface draft/undercut face overlay',()=>{
  it('colors the actual analyzed model, not the mold output, with independent halves',()=>{
    const mesh=boxSolid({min:[-2,-2,-2],max:[2,2,2]})
    const result=buildDraftOverlay(mesh,'x',0)
    expect(result.positions.length).toBe(result.angleDeg.length*9)
    expect(result.half.length).toBe(result.angleDeg.length)
    expect(result.sourceTriangle.length).toBe(result.angleDeg.length)
    expect(result.angleDeg.length).toBeGreaterThan(mesh.indices.length/3)
    expect(result.half).toContain(0)
    expect(result.half).toContain(1)
    expect(result.angleDeg.some(angle=>angle===0)).toBe(true)
    expect(result.angleDeg.every(angle=>angle>=-90&&angle<=90)).toBe(true)
    const all=draftVisibleFaces(result,{...DEFAULT_DRAFT_DISPLAY})
    const neg=draftVisibleFaces(result,{...DEFAULT_DRAFT_DISPLAY,view:'negative'})
    const pos=draftVisibleFaces(result,{...DEFAULT_DRAFT_DISPLAY,view:'positive'})
    expect(neg.length+pos.length).toBe(all.length)
    expect(neg.every(i=>result.half[i]===0)).toBe(true)
    expect(pos.every(i=>result.half[i]===1)).toBe(true)
  })
  it('clips crossing triangles exactly and preserves original source triangle number',()=>{
    const mesh={positions:Float32Array.from([
      -1,0,0,1,0,0,1,2,0,
    ]),indices:Uint32Array.from([0,1,2])}
    const overlay=buildDraftOverlay(mesh,'x',0)
    const negatives=Array.from(overlay.half).filter(x=>x===0)
    const positives=Array.from(overlay.half).filter(x=>x===1)
    expect(negatives).toHaveLength(1)
    expect(positives).toHaveLength(2)
    expect(Array.from(overlay.sourceTriangle)).toEqual([0,0,0])
    for(let t=0;t<overlay.angleDeg.length;t++){
      const x=Array.from(overlay.positions.slice(t*9,t*9+9))
        .filter((_,i)=>i%3===0)
      if(overlay.half[t]===0)expect(x.every(v=>v<=1e-6)).toBe(true)
      else expect(x.every(v=>v>=-1e-6)).toBe(true)
    }
  })
  it('uses each half\'s withdrawal direction for the same source normal',()=>{
    const face={positions:Float32Array.from([
      -1,0,0,1,0,0,1,1,0,
    ]),indices:Uint32Array.from([0,1,2])}
    const overlay=buildDraftOverlay(face,'z',0)
    // A face lying exactly in a split plane can contribute on both sides,
    // with opposite signed angles. The overlay must preserve the sign.
    expect(Array.from(overlay.half)).toEqual([0,1])
    expect(overlay.angleDeg[0]).toBeCloseTo(-90)
    expect(overlay.angleDeg[1]).toBeCloseTo(90)
  })
  it('reclassifies instantly with display threshold and hides adequate faces only',()=>{
    expect(draftClass(-0.1,2)).toBe('reverse')
    expect(draftClass(0,2)).toBe('low')
    expect(draftClass(1,2)).toBe('low')
    expect(draftClass(2,2)).toBe('adequate')
    expect(draftClass(1,0)).toBe('adequate')
    const data={
      positions:new Float32Array(27),half:Uint8Array.from([0,1,1]),
      angleDeg:Float32Array.from([-5,1,12]),
      sourceTriangle:Uint32Array.from([0,1,2]),
    }
    expect(Array.from(draftVisibleFaces(data,{
      ...DEFAULT_DRAFT_DISPLAY,thresholdDeg:2,problemsOnly:true,
    }))).toEqual([0,1])
    expect(Array.from(draftVisibleFaces(data,{
      ...DEFAULT_DRAFT_DISPLAY,thresholdDeg:15,problemsOnly:true,view:'positive',
    }))).toEqual([1,2])
    expect(Array.from(draftVisibleFaces(data,{
      ...DEFAULT_DRAFT_DISPLAY,thresholdDeg:0,problemsOnly:true,
    }))).toEqual([0])
    const red=draftFaceRgb(-10,2,'classes')
    const amber=draftFaceRgb(1,2,'classes')
    const green=draftFaceRgb(5,2,'classes')
    expect(red[0]).toBeGreaterThan(red[1])
    expect(amber[0]).toBeGreaterThan(amber[2])
    expect(green[1]).toBeGreaterThan(green[0])
    expect(draftFaceRgb(-10,2,'heatmap')).not.toEqual(
      draftFaceRgb(-40,2,'heatmap'))
  })
})
