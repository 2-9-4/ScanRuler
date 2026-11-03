// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import type {MoldPart} from '../core/geometry'
import {MoldPartList} from '../ui/MoldPartList'
import {visibleMoldParts,toggleMoldPart,isolateMoldPart} from '../ui/partVisibility'

const parts:Array<MoldPart>=[
  {name:'Mold part 1',positions:new Float32Array(),indices:new Uint32Array(90),volumeMm3:2},
  {name:'Mold part 2',positions:new Float32Array(),indices:new Uint32Array(60),volumeMm3:3},
  {name:'Hex-keyed master mounting post',positions:new Float32Array(),indices:new Uint32Array(18),volumeMm3:1},
]
const render=(visible:readonly boolean[],printable=true)=>renderToStaticMarkup(
  createElement(MoldPartList,{
    parts,visible,printable,onVisibilityChange:()=>{},onExportPart:()=>{},onEditPart:()=>{},
  }),
)

describe('Mold part visibility and unified per-part UI',()=>{
  it('defaults to all visible; permits hides and isolates any mold or fixture',()=>{
    expect(visibleMoldParts([],3)).toEqual([true,true,true])
    expect(toggleMoldPart([],3,1)).toEqual([true,false,true])
    expect(isolateMoldPart([],3,1)).toEqual([false,true,false])
    expect(isolateMoldPart([false,true,false],3,1)).toEqual([true,true,true])
    expect(isolateMoldPart([true,false,true],3,2)).toEqual([false,false,true])
    expect(isolateMoldPart([false,false,true],3,2)).toEqual([true,true,true])
    expect(toggleMoldPart([false,true,true],3,0)).toEqual([true,true,true])
    expect(visibleMoldParts([false],3)).toEqual([false,true,true])
    expect(()=>isolateMoldPart([],3,-1)).toThrow(/index/)
    expect(()=>toggleMoldPart([],3,3)).toThrow(/index/)
    expect(()=>visibleMoldParts([],Number.NaN)).toThrow(/count/)
  })
  it('renders one row and one STL/edit entry per generated part, including separate fixtures',()=>{
    const html=render([true,false,true])
    expect(html.match(/data-test="mold-part-row-\d+"/g)).toHaveLength(3)
    expect(html.match(/data-test="mold-export-part-\d+"/g)).toHaveLength(3)
    expect(html.match(/data-test="mold-edit-mesh-\d+"/g)).toHaveLength(3)
    expect(html.match(/data-test="mold-edit-cad-\d+"/g)).toHaveLength(3)
    expect(html.match(/data-test="mold-part-visible-\d+"/g)).toHaveLength(3)
    expect(html.match(/data-test="mold-part-isolate-\d+"/g)).toHaveLength(3)
    expect(html).toContain('2 of 3 visible')
    expect(html).toContain('Show Mold part 2 in viewport')
    expect(html).toContain('Hex-keyed master mounting post')
    expect(html).toContain('viewport')
  })
  it('disables geometry export when the generated tool is not printable, but keeps viewport controls',()=>{
    const html=render([false,true,true],false)
    expect(html).toContain('data-test="mold-part-visible-0"')
    const stl=html.match(/<button[^>]*data-test="mold-export-part-1"[^>]*>/)?.[0]
    expect(stl).toContain('disabled')
    const hide=html.match(/<button[^>]*data-test="mold-part-visible-0"[^>]*>/)?.[0]
    expect(hide).not.toContain('disabled')
  })
  it('marks isolated state for screen readers and allows restoring every part',()=>{
    const html=render([false,true,false])
    const isolate=html.match(/<button[^>]*data-test="mold-part-isolate-1"[^>]*>/)?.[0]
    expect(isolate).toContain('aria-pressed="true"')
    expect(html).toContain('Unisolate')
    expect(html).toContain('Show all parts')
  })
})
