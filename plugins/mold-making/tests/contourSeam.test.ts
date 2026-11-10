// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {boxSolid} from '../core/geometry'
import {contourAround,contourSegment,projectedHull,radialSeamContour,radialSiliconeLSeam,triangularContourTube} from '../core/contourSeam'
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
  it('wraps all three radial direct-mold interfaces in a C above, outside and below the master',()=>{
    const target=boxSolid({min:[-5,-5,-5],max:[5,5,5]})
    const offset=3.7,hub=2.9
    for(const degrees of [0,120,240]){
      const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle)
      const extent=Math.max(...Array.from({length:target.positions.length/3},(_,i)=>
        target.positions[3*i]*c+target.positions[3*i+1]*s))
      const path=radialSeamContour(target,angle,0,0,offset,hub,3)
      expect(path.length).toBeGreaterThan(12)
      // A C opens toward the central hub at TWO different elevations.
      // The prior U ended twice above the model, at different radii.
      expect(path[0][0]).toBeCloseTo(hub,4)
      expect(path[path.length-1][0]).toBeCloseTo(hub,4)
      expect(path[0][1]).toBeGreaterThan(7)
      expect(path[path.length-1][1]).toBeLessThan(-7)
      // One curved spine must run radially OUTSIDE the target midway up.
      expect(path.some(([r,z])=>r>extent+2&&Math.abs(z)<1)).toBe(true)
      // No intermediate part of the ridge may cross the master projection.
      expect(path.every(([r,z])=>z>5||z< -5||r>extent)).toBe(true)
      const tube=triangularContourTube(path,'y',0,1.2,-0.6,2.4,false,0.24)
      expect(closedness(tube.indices,tube.positions.length/3)).toEqual({open:0,bad:0})
      expect(signedVolume(tube.positions,tube.indices)).toBeGreaterThan(0)
      // Open V-ribbons have finite end chamfers, not square-cut endcaps.
      // The two short transition stations retain the nominal profile.
      const n=tube.positions.length/12
      for(let i=0;i<n;i++){
        const p=tube.positions,j=i*12
        const width=Math.hypot(p[j]-p[j+3],p[j+1]-p[j+4],p[j+2]-p[j+5])
        expect(width).toBeGreaterThan(1.2)
        if(i>0&&i<n-1)expect(width).toBeCloseTo(2.4,4)
        else expect(width).toBeLessThan(2.4)
      }
    }
  })
  it('forms a wall-and-floor L seam in a radial silicone box, not a U outside the master',()=>{
    const wall=24,hub=4.2,floor=-11,top=22
    const path=radialSiliconeLSeam(wall,hub,floor,top)
    expect(path).toEqual([[wall,top],[wall,floor],[hub,floor]])
    expect(path.filter(([r])=>r===wall)).toHaveLength(2)
    expect(path[0][1]).toBe(top)
    expect(path[path.length-1][1]).toBe(floor)
    const ridge=triangularContourTube(path,'y',0,2.4,-0.6,2.4,false,0.24)
    const socket=triangularContourTube(path,'y',0,2.6,-0.18,2.9,false)
    for(const mesh of [ridge,socket]){
      expect(closedness(mesh.indices,mesh.positions.length/3)).toEqual({open:0,bad:0})
      expect(signedVolume(mesh.positions,mesh.indices)).toBeGreaterThan(0)
      const count=mesh.positions.length/(mesh===ridge?12:9)
      const first=mesh.positions,step=mesh===ridge?12:9
      const widthAt=(i:number)=>{
        const j=i*step
        return Math.hypot(first[j]-first[j+3],first[j+1]-first[j+4],first[j+2]-first[j+5])
      }
      expect(widthAt(0)).toBeLessThan(widthAt(1))
      expect(widthAt(count-1)).toBeLessThan(widthAt(count-2))
      expect(widthAt(0)).toBeGreaterThan(0)
    }
  })
  it('caps an open U-shaped wall seam into one watertight printable ridge',()=>{
    for(const axis of ['x','y'] as const){
      const path:[number,number][]=[[-12,20],[-12,-8],[12,-8],[12,20]]
      const mesh=triangularContourTube(path,axis,0,1.2,-0.5,3,true)
      expect(closedness(mesh.indices,mesh.positions.length/3)).toEqual({open:0,bad:0})
      const open=triangularContourTube(path,axis,0,1.2,-0.5,3,false)
      expect(closedness(open.indices,open.positions.length/3)).toEqual({open:0,bad:0})
      expect(signedVolume(open.positions,open.indices)).toBeGreaterThan(0)
    }
  })
  it('truncates the V tip into a watertight flat assembly lead-in',()=>{
    for(const axis of ['x','y','z'] as const){
      const path=contourAround(projectedHull(cube,axis),2.5)
      const sharp=triangularContourTube(path,axis,0,1.2,-0.4,2.8)
      const flat=triangularContourTube(path,axis,0,1.2,-0.4,2.8,true,0.24)
      expect(closedness(flat.indices,flat.positions.length/3)).toEqual({open:0,bad:0})
      expect(signedVolume(flat.positions,flat.indices)).toBeGreaterThan(0)
      expect(flat.positions.length).toBeGreaterThan(sharp.positions.length)
    }
  })
  it('clips an outline to a single quarter interface without crossing the perpendicular seam',()=>{
    const path=contourAround(projectedHull(cube,'x'),2.5)
    const half=contourSegment(path,-7,-1.7)
    expect(half.closed).toBe(false)
    expect(half.path.length).toBeGreaterThanOrEqual(3)
    expect(half.path.every(p=>p[0]>=-7-1e-6&&p[0]<=-1.7+1e-6)).toBe(true)
    const v=triangularContourTube(half.path,'x',0,1,-0.4,2.8,false,0.24)
    expect(closedness(v.indices,v.positions.length/3)).toEqual({open:0,bad:0})
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
