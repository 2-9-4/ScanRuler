// SPDX-License-Identifier: AGPL-3.0-only
import { describe,expect,it } from 'vitest'
import { boxSolid } from '../core/geometry'
import { repairMoldTarget } from '../core/repair'
import { closedness } from '../../mesh-tools/core/boolean'

const cube=boxSolid({min:[0,0,0],max:[10,10,10]})
const closed=(p:ReturnType<typeof repairMoldTarget>)=>
  expect(closedness(p.mesh.indices,p.mesh.positions.length/3)).toEqual({open:0,bad:0})

describe('Mold Making non-destructive source repair',()=>{
  it('removes exactly collapsed faces without changing the original',()=>{
    const malformed={
      positions:cube.positions,
      indices:Uint32Array.from([...cube.indices,0,1,1]),
    }
    const originalIndices=malformed.indices.slice()
    const result=repairMoldTarget(malformed,true,1)
    closed(result)
    expect(result.removedFaces).toBe(1)
    expect(result.filledHoles).toBe(0)
    expect(result.warnings.join(' ')).toMatch(/Original source unchanged/)
    expect(malformed.indices).toEqual(originalIndices)
    expect(result.mesh.indices.length).toBe(cube.indices.length)
  })
  it('does not remove zero-area triangles when repair is switched off',()=>{
    const malformed={
      positions:cube.positions,
      indices:Uint32Array.from([...cube.indices,0,1,1]),
    }
    const result=repairMoldTarget(malformed,false,1)
    expect(result.mesh).toBe(malformed)
    expect(result.removedFaces).toBe(0)
  })
  it('welds face-local duplicate vertex indices of an otherwise solid mesh',()=>{
    const p:number[]=[],idx:number[]=[]
    for(const i of cube.indices){
      p.push(...cube.positions.slice(i*3,i*3+3))
      idx.push(idx.length)
    }
    const unindexed={positions:Float32Array.from(p),indices:Uint32Array.from(idx)}
    expect(closedness(unindexed.indices,unindexed.positions.length/3).open).toBeGreaterThan(0)
    const result=repairMoldTarget(unindexed,true,1)
    closed(result)
    expect(result.weldedVertices).toBeGreaterThan(0)
    expect(result.mesh.indices.length).toBe(cube.indices.length)
    expect(unindexed.positions).toHaveLength(cube.indices.length*3)
  })
  it('patches a tiny rectangular four-edge opening',()=>{
    // Top face of this small upright box has two triangles. Removing both
    // yields four open rim edges, exactly like the user's reduced mesh.
    const tiny=boxSolid({min:[0,0,0],max:[0.2,0.2,1]})
    const hole={positions:tiny.positions,
      indices:Uint32Array.from([...tiny.indices.slice(0,6),...tiny.indices.slice(12)])}
    expect(closedness(hole.indices,hole.positions.length/3).open).toBe(4)
    const result=repairMoldTarget(hole,true,1)
    closed(result)
    expect(result.filledHoles).toBe(1)
    expect(result.warnings.join(' ')).toMatch(/patched 1 small holes/)
  })
  it('never fills large openings without increasing the explicit safety limit',()=>{
    const hole={positions:cube.positions,
      indices:Uint32Array.from([...cube.indices.slice(0,6),...cube.indices.slice(12)])}
    expect(()=>repairMoldTarget(hole,true,1)).toThrow(/Largest open rim/)
    expect(()=>repairMoldTarget(hole,false,20)).toThrow(/Enable Repair small/)
  })
  it('fails instead of guessing if input is nonsensical',()=>{
    expect(()=>repairMoldTarget({positions:cube.positions,
      indices:Uint32Array.from([0,1,99999])},true,1)).toThrow(/out of bounds/)
  })
})
