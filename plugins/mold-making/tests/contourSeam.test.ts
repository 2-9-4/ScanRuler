// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid} from '../core/geometry'
import {contourAround,projectedHull,triangularContourTube} from '../core/contourSeam'
import {closedness} from '../../mesh-tools/core/boolean'
import {signedVolume} from '../../mesh-tools/core/hollow'

const cube=boxSolid({min:[-5,-4,0],max:[5,4,10]})
describe('Continuous V-seam geometry',()=>{
  it('rounds a rough projected silhouette outward without jumping into the cavity',()=>{
    const hull=projectedHull(cube,'x')
    expect(hull).toHaveLength(4)
    const path=contourAround(hull,2.5)
    expect(path.length).toBeGreaterThan(16)
    const ys=path.map(p=>p[0]),zs=path.map(p=>p[1])
    expect(Math.min(...ys)).toBeCloseTo(-6.5,4)
    expect(Math.max(...ys)).toBeCloseTo(6.5,4)
    expect(Math.min(...zs)).toBeCloseTo(-2.5,4)
    expect(Math.max(...zs)).toBeCloseTo(12.5,4)
  })
  it('creates a watertight outward-wound triangular loop on all three planes',()=>{
    for(const axis of ['x','y','z'] as const){
      const hull=projectedHull(cube,axis)
      const path=contourAround(hull,2.5,3)
      const mesh=triangularContourTube(path,axis,0,1,-0.5,3)
      expect(closedness(mesh.indices,mesh.positions.length/3)).toEqual({open:0,bad:0})
      expect(signedVolume(mesh.positions,mesh.indices)).toBeGreaterThan(0)
      for(let i=0;i<mesh.indices.length;i+=3){
        const p=mesh.positions,idx=mesh.indices
        const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3
        const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2]
        const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2]
        expect(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)).toBeGreaterThan(0)
      }
    }
  })
})
