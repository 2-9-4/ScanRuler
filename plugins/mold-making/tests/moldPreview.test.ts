// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import {describe,expect,it} from 'vitest'
import {explodedMoldOffsets} from '../viewer/moldPreview'

const box=(x:number,y:number,z:number)=>new THREE.Box3(
  new THREE.Vector3(x,y,z),new THREE.Vector3(x+1,y+1,z+1),
)
describe('Mold exploded preview',()=>{
  it('moves two halves along the actual selected split axis',()=>{
    const boxes=[box(-3,-1,-1),box(2,-1,-1)]
    const x=explodedMoldOffsets(boxes,2,'x',3)
    expect(x[0].x).toBeLessThan(0)
    expect(x[1].x).toBeGreaterThan(0)
    expect(x[0].y).toBe(0)
    expect(x[1].z).toBe(0)
    const z=explodedMoldOffsets([box(0,0,-3),box(0,0,2)],2,'z',3)
    expect(z[0].z).toBeLessThan(0)
    expect(z[1].z).toBeGreaterThan(0)
    expect(z[0].x).toBe(0)
  })
  it('separates four quadrants diagonally in their two actual parting axes',()=>{
    const boxes=[box(-3,-3,0),box(-3,2,0),box(2,-3,0),box(2,2,0)]
    const dirs=explodedMoldOffsets(boxes,4,'x',2)
    expect(dirs).toHaveLength(4)
    for(let i=0;i<4;i++){
      expect(Math.abs(dirs[i].x)).toBeGreaterThan(0)
      expect(Math.abs(dirs[i].y)).toBeGreaterThan(0)
      expect(dirs[i].z).toBe(0)
    }
    const vertical=explodedMoldOffsets([
      box(-3,0,-3),box(2,0,-3),box(-3,0,2),box(2,0,2),
    ],4,'z',2)
    for(const p of vertical){
      expect(p.y).toBe(0)
      expect(Math.abs(p.x)).toBeGreaterThan(0)
      expect(Math.abs(p.z)).toBeGreaterThan(0)
    }
  })
  it('uses each 120 degree sector radial bisector instead of an X-only strip',()=>{
    const boxes=[box(0,0,0),box(0,0,0),box(0,0,0)]
    const offsets=explodedMoldOffsets(boxes,3,'x',3)
    expect(offsets).toHaveLength(3)
    expect(offsets[0].x).toBeGreaterThan(0)
    expect(offsets[0].y).toBeGreaterThan(0)
    expect(offsets[1].x).toBeLessThan(0)
    expect(offsets[1].y).toBeCloseTo(0,8)
    expect(offsets[2].y).toBeLessThan(0)
    expect(offsets.reduce((v,p)=>v.add(p),new THREE.Vector3()).length()).toBeLessThan(1e-8)
    for(const p of explodedMoldOffsets(boxes,3,'x',0))
      expect(p.length()).toBe(0)
  })
})
