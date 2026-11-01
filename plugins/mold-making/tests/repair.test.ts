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
  it('preserves indexed watertight topology when a surface triangle is collapsed',()=>{
    // Move an existing corner onto the adjacent edge. Its original index
    // topology remains perfectly closed, but one or more faces become
    // geometrically collinear. Deleting those faces makes holes.
    const positions=cube.positions.slice()
    positions[0]=10
    positions[1]=5
    const input={positions,indices:cube.indices}
    expect(closedness(input.indices,input.positions.length/3)).toEqual({open:0,bad:0})
    const before=positions.slice()
    const repaired=repairMoldTarget(input,true,2)
    expect(repaired.adjustedVertices).toBeGreaterThan(0)
    expect(repaired.removedFaces).toBe(0)
    expect(repaired.mesh.indices).toBe(input.indices)
    // The topology guarantee is asserted structurally above. Do not bind
    // this test to incidental prose in the user-facing repair summary.
    expect(repaired.warnings.join(' ')).toMatch(/adjusted 1 collapsed vertices/)
    closed(repaired)
    expect(input.positions).toEqual(before)
    for(let t=0;t<input.indices.length;t+=3){
      const {positions:p,indices:ix}=repaired.mesh
      const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3
      const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]]
      const v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]]
      expect(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])).toBeGreaterThan(0)
    }
    const moved=Array.from(repaired.mesh.positions).map((x,i)=>Math.abs(x-before[i]))
    expect(Math.max(...moved)).toBeLessThan(0.0011)
  })
  it('repairs a collapsed face on an already open mesh before patching its hole',()=>{
    // Retain the source indices of a collapsed triangle. If we remove that
    // face prematurely, we create an additional opening unrelated to the
    // original top-face gap.
    const positions=cube.positions.slice()
    positions[0]=10
    positions[1]=5
    const open={positions,indices:Uint32Array.from([
      ...cube.indices.slice(0,6),...cube.indices.slice(12),
    ])}
    const sourceIndices=open.indices.slice()
    expect(closedness(open.indices,open.positions.length/3).open).toBe(4)
    const repaired=repairMoldTarget(open,true,20)
    expect(repaired.removedFaces).toBe(0)
    expect(repaired.adjustedVertices).toBeGreaterThan(0)
    expect(repaired.filledHoles).toBe(1)
    closed(repaired)
    expect(open.indices).toEqual(sourceIndices)
    expect(open.positions).toEqual(positions)
    for(let i=0;i<repaired.mesh.indices.length;i+=3){
      const {positions:p,indices:ix}=repaired.mesh
      const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3
      const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]]
      const v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]]
      expect(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])).toBeGreaterThan(0)
    }
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
  it('fills a 1.65 mm-wide complete gap at the new 2 mm default',()=>{
    const narrow=boxSolid({min:[0,0,0],max:[1.65,0.8,4]})
    const open={positions:narrow.positions,
      indices:Uint32Array.from([...narrow.indices.slice(0,6),...narrow.indices.slice(12)])}
    expect(()=>repairMoldTarget(open,true,1)).toThrow(/configured 1 mm patch limit/)
    const repaired=repairMoldTarget(open,true,2)
    closed(repaired)
    expect(repaired.filledHoles).toBe(1)
    expect(open.indices.length).toBe(narrow.indices.length-6)
  })
  it('never fills large openings without increasing the explicit safety limit',()=>{
    const hole={positions:cube.positions,
      indices:Uint32Array.from([...cube.indices.slice(0,6),...cube.indices.slice(12)])}
    expect(()=>repairMoldTarget(hole,true,1)).toThrow(/Largest open rim/)
    // Disabling the optional repair must not reject or edit a target.
    // The caller's validation (buildMold/check) decides whether it is usable.
    const passThrough=repairMoldTarget(hole,false,20)
    expect(passThrough.mesh).toBe(hole)
    expect(passThrough.filledHoles).toBe(0)
    expect(passThrough.warnings).toEqual([])
  })
  it('fails instead of guessing if input is nonsensical',()=>{
    expect(()=>repairMoldTarget({positions:cube.positions,
      indices:Uint32Array.from([0,1,99999])},true,1)).toThrow(/out of bounds/)
  })
})
