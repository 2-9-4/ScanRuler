// SPDX-License-Identifier: AGPL-3.0-only
// Verify the actual downloadable formats: distinct manifold parts must
// survive the same ScanRuler STL/3MF writers used by Mold Making.
import {beforeAll,describe,expect,it} from 'vitest'
import Module,{type ManifoldToplevel} from 'manifold-3d'
import {unzipSync} from 'fflate'
import {build3mf} from '../../../src/core/export3mf'
import {buildBinaryStl} from '../../../src/core/exportStl'
import {closedness} from '../../mesh-tools/core/boolean'
import {boxSolid,buildMold} from '../core/geometry'
import {DEFAULT_MOLD_SETTINGS,type MoldSettings} from '../core/settings'

let wasm:ManifoldToplevel
beforeAll(async()=>{wasm=await Module();wasm.setup()})

const target=boxSolid({min:[-5,-4,0],max:[5,4,10]})

function expectExportableParts(settings:MoldSettings){
  const inputPositions=target.positions.slice()
  const inputIndices=target.indices.slice()
  const mold=buildMold(wasm,target,settings)
  expect(mold.printable).toBe(true)
  expect(mold.parts).toHaveLength(settings.parts)
  for(const part of mold.parts){
    expect(part.volumeMm3).toBeGreaterThan(0)
    expect(closedness(part.indices,part.positions.length/3)).toEqual({open:0,bad:0})
    const bytes=buildBinaryStl(part.positions,part.indices,null,part.name)
    const view=new DataView(bytes)
    const count=view.getUint32(80,true)
    expect(count).toBe(part.indices.length/3)
    expect(count).toBeGreaterThan(10)
    expect(bytes.byteLength).toBe(84+count*50)
    // Catch NaNs or infinities that would make a slicer discard this STL.
    for(let triangle=0;triangle<count;triangle++){
      const offset=84+triangle*50
      for(let v=0;v<12;v++)
        expect(Number.isFinite(view.getFloat32(offset+v*4,true))).toBe(true)
    }
  }
  const archive=build3mf(mold.parts,null,'Mold export integrity fixture')
  expect(archive).not.toBeNull()
  if(!archive)throw new Error('Expected a multipart 3MF')
  const files=unzipSync(archive.bytes)
  expect(files['[Content_Types].xml']).toBeDefined()
  expect(files['_rels/.rels']).toBeDefined()
  const model=files['3D/3dmodel.model']
  expect(model).toBeDefined()
  const xml=new TextDecoder().decode(model)
  expect(xml).toContain('unit="millimeter"')
  expect((xml.match(/<object id="\\d+" type="model"/g)??[])).toHaveLength(mold.parts.length)
  expect((xml.match(/<item objectid="\\d+"\\/>/g)??[])).toHaveLength(mold.parts.length)
  expect((xml.match(/<triangle v1=/g)??[]).length).toBeGreaterThan(20)
  expect(archive.triangles).toBeGreaterThan(20)
  // Neither build nor export may rewrite the imported master.
  expect(target.positions).toEqual(inputPositions)
  expect(target.indices).toEqual(inputIndices)
}

describe('Mold Making exported assembly integrity',()=>{
  it('writes separate rigid negative mold halves as closed STL and distinct 3MF objects',()=>{
    expectExportableParts({...DEFAULT_MOLD_SETTINGS,mode:'direct',parts:2,keys:false})
  })
  it('writes a cylindrical silicone box as closed STL and distinct 3MF objects',()=>{
    expectExportableParts({...DEFAULT_MOLD_SETTINGS,mode:'silicone-box',parts:2,boxShape:'cylindrical',keys:false})
  })
})
