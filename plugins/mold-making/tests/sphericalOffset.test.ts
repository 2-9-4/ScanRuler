// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll,describe,expect,it } from 'vitest'
import Module,{type ManifoldToplevel} from 'manifold-3d'
import { boxSolid } from '../core/geometry'
import { sphericalOffset,sphericalOffsetGrid } from '../core/sphericalOffset'
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
      const output=solid.getMesh()
      expect(closedness(new Uint32Array(output.triVerts),
        output.vertProperties.length/3)).toEqual({open:0,bad:0})
    }finally{solid.delete()}
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
