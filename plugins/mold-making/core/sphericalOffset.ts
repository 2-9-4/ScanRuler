// SPDX-License-Identifier: AGPL-3.0-only
// A solid spherical offset for mold clearance: the d-isosurface of the
// signed Euclidean distance to the ORIGINAL triangles. Unlike moving mesh
// vertices along normals, this rounds corners and handles the local geometry
// as a dilation; the source mesh is never modified.
//
// Manifold 3.2.1's levelSet reconstructs a closed manifold from samples.
// Querying a MeshBVH avoids scanning every triangle at every sample.
// This is a sampled approximation, not an exact analytical Minkowski sum.
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { SolidMesh } from '../../../src/app/solids'
import { extentOf } from '../../../src/core/geometry/bounds'
import { signedVolume } from '../../mesh-tools/core/hollow'

export interface SphericalOffsetReport {
  gridMm: number
  gridSamples: number
  toleranceMm: number
}

const MAX_GRID_SAMPLES=8_000_000
const MIN_GRID_MM=0.12
const MAX_GRID_MM=0.8

/** Select a sampling grid within a predictable worker memory budget. The
 * vertex positions returned by levelSet are refined to a smaller tolerance,
 * but narrow details smaller than the grid still cannot be guaranteed.
 */
export function sphericalOffsetGrid(mesh:SolidMesh,d:number):SphericalOffsetReport {
  if(!(d>0)||!Number.isFinite(d))throw new Error('A spherical clearance must be positive.')
  const {min,max}=extentOf(mesh.positions)
  const padding=d+2
  const span=min.map((v,k)=>max[k]-v+2*padding)
  if(span.some(v=>!Number.isFinite(v)||v<=0))throw new Error('Invalid mesh bounds for spherical offset.')
  const samples=(h:number)=>span.reduce((n,x)=>n*(Math.ceil(x/h)+2),1)
  // Sampled rounded corners need more than a single cell across the radius.
  // If the model is too large, enlarge the grid only up to the quality cap.
  let h=Math.max(MIN_GRID_MM,Math.min(0.3,d/2))
  if(samples(h)>MAX_GRID_SAMPLES){
    let lo=h,hi=MAX_GRID_MM
    if(samples(hi)>MAX_GRID_SAMPLES)throw new Error(
      `Spherical clearance ${d} mm on this large model needs too many distance-field cells even at ${MAX_GRID_MM} mm resolution. Reduce the model's bounds or use a CAD offset on the original STEP solid; ScanRuler will not substitute the jagged vertex-normal algorithm.`)
    for(let k=0;k<28;k++){
      const m=(lo+hi)/2
      if(samples(m)>MAX_GRID_SAMPLES)lo=m
      else hi=m
    }
    h=hi
  }
  const gridSamples=Math.ceil(samples(h))
  // At modest grid spacing, Manifold refines crossings toward the distance
  // surface; this does not fix features smaller than the sample grid.
  const toleranceMm=Math.min(0.05,h/5,Math.max(0.01,d/8))
  return {gridMm:h,gridSamples,toleranceMm}
}

export function sphericalOffset(
  wasm:ManifoldToplevel,mesh:SolidMesh,d:number,
  onProgress?:(message:string)=>void,
):{solid:Manifold;report:SphericalOffsetReport} {
  const report=sphericalOffsetGrid(mesh,d)
  const {min,max}=extentOf(mesh.positions)
  const pad=d+2
  const bounds={
    min:[min[0]-pad,min[1]-pad,min[2]-pad] as [number,number,number],
    max:[max[0]+pad,max[1]+pad,max[2]+pad] as [number,number,number],
  }
  onProgress?.(`Sampling spherical clearance at ${report.gridMm.toFixed(3)} mm spacing (${report.gridSamples.toLocaleString()} points)…`)
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(mesh.positions,3))
  // BVH reorders triangle indices while building. Keep the user's data
  // untouched, and calculate face normals AFTER reordering.
  geometry.setIndex(new BufferAttribute(mesh.indices.slice(),1))
  const bvh=new MeshBVH(geometry,{maxLeafTris:12})
  const index=geometry.getIndex()!
  const normals=new Float32Array(index.count)
  const p=mesh.positions
  for(let face=0;face<index.count/3;face++){
    const a=index.getX(face*3)*3,b=index.getX(face*3+1)*3,c=index.getX(face*3+2)*3
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2]
    const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2]
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx
    const length=Math.hypot(x,y,z)
    if(!(length>0)){
      geometry.dispose()
      throw new Error(`Spherical offset needs nondegenerate source faces (triangle ${face}).`)
    }
    normals[face*3]=x/length
    normals[face*3+1]=y/length
    normals[face*3+2]=z/length
  }
  const query=new Vector3()
  const closest={point:new Vector3(),distance:0,faceIndex:0}
  // The shortest distance to the actual triangle surface is Euclidean.
  // Its sign comes from the outward triangle orientation at the nearest
  // point. ScanRuler already checks matching winding and positive volume.
  const sdf=(v:readonly number[]):number=>{
    query.set(v[0],v[1],v[2])
    const nearest=bvh.closestPointToPoint(query,closest)
    if(!nearest)throw new Error('No closest triangle found while evaluating spherical clearance.')
    const face=nearest.faceIndex*3
    const dx=query.x-nearest.point.x
    const dy=query.y-nearest.point.y
    const dz=query.z-nearest.point.z
    const dot=dx*normals[face]+dy*normals[face+1]+dz*normals[face+2]
    // Manifold levelSet's convention: positive inside, negative outside.
    return dot<0?nearest.distance:-nearest.distance
  }
  try{
    // Level zero is the original surface. A negative level moves the surface
    // OUT by distance d, i.e. the spherical dilation of the target solid.
    const solid=wasm.Manifold.levelSet(sdf,bounds,report.gridMm,-d,report.toleranceMm)
    if(solid.status()!=='NoError'||solid.isEmpty()){
      solid.delete()
      throw new Error('Spherical distance-field offset produced no valid closed solid.')
    }
    const before=signedVolume(mesh.positions,mesh.indices),after=solid.volume()
    if(!(after>before)){
      solid.delete()
      throw new Error(`Spherical offset ${d} mm did not enlarge the master volume (${before.toFixed(3)} → ${after.toFixed(3)} mm³). Check source face orientation and geometry; no mold was exported.`)
    }
    const grown=solid.boundingBox()
    for(let k=0;k<3;k++){
      // Reconstructed bounds should grow outwards by approximately d.
      // A grossly inconsistent bound indicates wrong sign or a broken SDF.
      if(grown.min[k]>min[k]-d+report.gridMm*2 ||
         grown.max[k]<max[k]+d-report.gridMm*2){
        solid.delete()
        throw new Error('Spherical offset did not expand the target on every axis; check face orientation and input mesh topology.')
      }
    }
    return {solid,report}
  }finally{
    geometry.dispose()
  }
}
