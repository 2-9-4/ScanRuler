// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll,describe,expect,it } from 'vitest'
import Module,{type ManifoldToplevel} from 'manifold-3d'
import { boxSolid } from '../core/geometry'
import { createSphericalDistanceField,sphericalOffset,sphericalOffsetGrid } from '../core/sphericalOffset'
import { closedness } from '../../mesh-tools/core/boolean'

let wasm:ManifoldToplevel
beforeAll(async()=>{wasm=await Module();wasm.setup()})

describe('Spherical solid clearance (Minkowski dilation by a ball)',()=>{
  const cube=boxSolid({min:[0,0,0],max:[10,10,10]})
  it('enlarges a cube by a ball rather than sharpening its outside corners',()=>{
    const {solid,report}=sphericalOffset(wasm,cube,1)
    try{
      expect(report.gridSamples).toBeLessThanOrEqual(8_000_000)
      expect(report.gridMm).toBeGreaterThan(0)
      expect(solid.status()).toBe('NoError')
      const bounds=solid.boundingBox()
      for(let axis=0;axis<3;axis++){
        expect(bounds.min[axis]).toBeCloseTo(-1,0)
        expect(bounds.max[axis]).toBeCloseTo(11,0)
      }
      // Volume of an axis-aligned box dilated by a Euclidean sphere:
      // V + surfaceArea*r + pi*(a+b+c)*r² + (4*pi/3)*r³.
      const expected=1000+600+30*Math.PI+4*Math.PI/3
      expect(solid.volume()).toBeGreaterThan(expected*0.96)
      expect(solid.volume()).toBeLessThan(expected*1.04)
      // A spherical expansion must NOT include the far diagonal of the
      // expanded corner's bounding cube. A vertex-normal / box dilation
      // would create spurious material there.
      const corner=wasm.Manifold.cube([0.1,0.1,0.1]).translate([-0.9,-0.9,-0.9])
      const intersection=solid.intersect(corner)
      try{expect(intersection.isEmpty()||intersection.volume()<1e-6).toBe(true)}
      finally{intersection.delete();corner.delete()}
      const output=solid.getMesh()
      expect(closedness(new Uint32Array(output.triVerts),
        output.vertProperties.length/3)).toEqual({open:0,bad:0})
    }finally{solid.delete()}
  })
  it('classifies edge, vertex, interior and exterior nearest points correctly',()=>{
    const field=createSphericalDistanceField(cube)
    try{
      for(const point of [
        [5,5,5],[0.1,0.1,5],[0.1,0.1,0.1],[5,5,0.01],
      ])expect(field.sdf(point)).toBeGreaterThan(0)
      for(const point of [
        [-0.1,-0.1,5],[-0.1,0.1,5],[-0.1,-0.1,-0.1],
        [10.1,10.1,5],[5,5,-0.01],
      ])expect(field.sdf(point)).toBeLessThan(0)
    }finally{field.dispose()}
  })
  it('retains one solid at concave corners instead of producing loose offset islands',()=>{
    const a=wasm.Manifold.cube([12,4,8])
    const b=wasm.Manifold.cube([4,12,8])
    const l=a.add(b)
    const m=l.getMesh()
    const concave={
      positions:new Float32Array(m.vertProperties),
      indices:new Uint32Array(m.triVerts),
    }
    try{
      const field=createSphericalDistanceField(concave)
      try{
        expect(field.sdf([2,2,4])).toBeGreaterThan(0)
        expect(field.sdf([4.3,4.3,4])).toBeLessThan(0)
        expect(field.sdf([5,2,4])).toBeGreaterThan(0)
        expect(field.sdf([2,5,4])).toBeGreaterThan(0)
      }finally{field.dispose()}
      for(const quality of ['fast','balanced'] as const){
        const result=sphericalOffset(wasm,concave,0.7,undefined,quality)
        try{
          expect(result.solid.status()).toBe('NoError')
          const islands=result.solid.decompose()
          try{expect(islands).toHaveLength(1)}
          finally{for(const island of islands)island.delete()}
          expect(result.solid.volume()).toBeGreaterThan(l.volume())
        }finally{result.solid.delete()}
      }
    }finally{l.delete();a.delete();b.delete()}
  })
  it('uses predictable, increasing cell budgets for Fast/Balanced/Fine',()=>{
    const big=boxSolid({min:[0,0,0],max:[80,70,60]})
    const fast=sphericalOffsetGrid(big,0.5,'fast')
    const balanced=sphericalOffsetGrid(big,0.5,'balanced')
    const fine=sphericalOffsetGrid(big,0.5,'fine')
    expect(fast.gridSamples).toBeLessThanOrEqual(80_000)
    expect(balanced.gridSamples).toBeLessThanOrEqual(850_000)
    expect(fine.gridSamples).toBeLessThanOrEqual(6_000_000)
    expect(fast.gridSamples).toBeLessThan(balanced.gridSamples)
    expect(balanced.gridSamples).toBeLessThan(fine.gridSamples)
    expect(fast.gridMm).toBeGreaterThan(balanced.gridMm)
    expect(balanced.gridMm).toBeGreaterThan(fine.gridMm)
  })
  it('reports stage percentages while sampling an offset',()=>{
    const updates:number[]=[]
    const {solid}=sphericalOffset(wasm,cube,0.5,(_message,fraction)=>{
      if(fraction!==undefined)updates.push(fraction)
    },'fast')
    try{
      expect(updates.length).toBeGreaterThan(1)
      expect(updates[0]).toBeGreaterThan(0)
      expect(updates.at(-1)).toBeGreaterThanOrEqual(0.8)
      for(let i=1;i<updates.length;i++){
        expect(updates[i]).toBeGreaterThanOrEqual(updates[i-1])
      }
    }finally{solid.delete()}
  })
  it('allows multiple offsets to reuse a single prepared triangle field',()=>{
    const field=createSphericalDistanceField(cube)
    try{
      for(const d of [0.5,1]){
        const {solid,report}=sphericalOffset(wasm,cube,d,undefined,'fast',field)
        try{
          expect(solid.volume()).toBeGreaterThan(1000)
          expect(report.gridSamples).toBeLessThanOrEqual(80_000)
          expect(solid.status()).toBe('NoError')
        }finally{solid.delete()}
      }
    }finally{field.dispose()}
  })
  it('never mutates the original mesh while sampling',()=>{
    const pos=cube.positions.slice(),ind=cube.indices.slice()
    const {solid}=sphericalOffset(wasm,cube,0.5)
    try{
      expect(solid.volume()).toBeGreaterThan(1000)
      expect(cube.positions).toEqual(pos)
      expect(cube.indices).toEqual(ind)
    }finally{solid.delete()}
  })
  it('refuses unsupported huge grids rather than silently reverting to vertex normals',()=>{
    const giant=boxSolid({min:[0,0,0],max:[1000,1000,1000]})
    expect(()=>sphericalOffsetGrid(giant,0.2)).toThrow(/too many distance-field cells/)
  })
})
