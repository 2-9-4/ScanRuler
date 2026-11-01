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
import { BufferAttribute, BufferGeometry, Triangle, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { SolidMesh } from '../../../src/app/solids'
import type { OffsetQuality } from './settings'
import { extentOf } from '../../../src/core/geometry/bounds'
import { signedVolume } from '../../mesh-tools/core/hollow'

export interface SphericalOffsetReport {
  gridMm: number
  gridSamples: number
  toleranceMm: number
}

/** Keep Fast responsive on ordinary consumer hardware. A modest grid also
 * means fewer expensive BVH closest-point callbacks inside Manifold.levelSet.
 * Fine remains an explicit opt-in for tiny source detail.
 */
const QUALITY:Record<OffsetQuality,{minGrid:number;maxGrid:number;maxSamples:number;tolerance:number}>={
  fast:{minGrid:0.65,maxGrid:2.5,maxSamples:200_000,tolerance:0.2},
  balanced:{minGrid:0.32,maxGrid:1.8,maxSamples:850_000,tolerance:0.09},
  fine:{minGrid:0.12,maxGrid:0.8,maxSamples:6_000_000,tolerance:0.035},
}

/** Grid budget trades execution time against geometric detail. 
 * The actual spacing depends on the *whole* model bounding box, not just the
 * offset radius. LevelSet's refinement improves intersections but cannot
 * recover details below the grid spacing.
 */
export function sphericalOffsetGrid(mesh:SolidMesh,d:number,quality:OffsetQuality='balanced'):SphericalOffsetReport {
  if(!(d>0)||!Number.isFinite(d))throw new Error('A spherical clearance must be positive.')
  const preset=QUALITY[quality]
  if(!preset)throw new Error('Unknown spherical offset quality.')
  const {min,max}=extentOf(mesh.positions)
  const pad=d+2
  const span=min.map((v,k)=>max[k]-v+2*pad)
  if(span.some(v=>!Number.isFinite(v)||v<=0))throw new Error('Invalid mesh bounds for spherical offset.')
  const samples=(h:number)=>span.reduce((n,x)=>n*(Math.ceil(x/h)+2),1)
  let h=preset.minGrid
  if(samples(h)>preset.maxSamples){
    let lo=h,hi=preset.maxGrid
    if(samples(hi)>preset.maxSamples)throw new Error(
      `The ${quality} spherical offset on this model needs too many distance-field cells: exceeds its ${preset.maxSamples.toLocaleString()} cell budget even at ${preset.maxGrid} mm grid spacing. Use a smaller model or separate surfaces; the old vertex-normal algorithm will not be used as a fallback.`)
    for(let k=0;k<28;k++){
      const m=(lo+hi)/2
      if(samples(m)>preset.maxSamples)lo=m
      else hi=m
    }
    h=hi
  }
  const toleranceMm=Math.min(preset.tolerance,h*(quality==='fast'?0.35:quality==='balanced'?0.2:0.12))
  return {gridMm:h,gridSamples:Math.ceil(samples(h)),toleranceMm}
}

/** Precompute and retain the BVH, reordered triangle normals, and query
 * scratch buffers for all offsets of the same source (particularly the two
 * offset surfaces of thin negative shells). Dispose when generation ends.
 */
export interface SphericalDistanceField {
  sdf(v:readonly number[]):number
  dispose():void
}
export function createSphericalDistanceField(mesh:SolidMesh,onProgress?:(message:string,fraction?:number)=>void):SphericalDistanceField {
  onProgress?.('Indexing source triangles for spherical clearance…')
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(mesh.positions,3))
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
  const warmTriangle=new Triangle(new Vector3(),new Vector3(),new Vector3())
  const warmPoint=new Vector3()
  let previousFace=-1
  return {
    sdf(v:readonly number[]):number{
      query.set(v[0],v[1],v[2])
      // Level-set calls are spatially coherent: use the previous nearest
      // triangle as a proven upper bound for the next BVH nearest search.
      // This prunes distant branches while remaining EXACT: the true
      // nearest surface distance cannot exceed the candidate's distance.
      let limit=Infinity
      if(previousFace>=0){
        const i=previousFace*3
        const a=index.getX(i)*3,b=index.getX(i+1)*3,c=index.getX(i+2)*3
        warmTriangle.a.set(p[a],p[a+1],p[a+2])
        warmTriangle.b.set(p[b],p[b+1],p[b+2])
        warmTriangle.c.set(p[c],p[c+1],p[c+2])
        warmTriangle.closestPointToPoint(query,warmPoint)
        limit=query.distanceTo(warmPoint)+1e-5
      }
      const nearest=bvh.closestPointToPoint(query,closest,0,limit)
      if(!nearest){
        if(previousFace<0)throw new Error('No closest triangle found while evaluating spherical clearance.')
        // All BVH triangles were farther than the last face. That face
        // itself is in the mesh, so it is an exact closest-point candidate.
        closest.point.copy(warmPoint)
        closest.distance=query.distanceTo(warmPoint)
        closest.faceIndex=previousFace
      }
      previousFace=closest.faceIndex
      const face=closest.faceIndex*3
      const dx=query.x-nearest.point.x
      const dy=query.y-nearest.point.y
      const dz=query.z-nearest.point.z
      const dot=dx*normals[face]+dy*normals[face+1]+dz*normals[face+2]
      return dot<0?nearest.distance:-nearest.distance
    },
    dispose(){geometry.dispose()},
  }
}

export function sphericalOffset(
  wasm:ManifoldToplevel,mesh:SolidMesh,d:number,
  onProgress?:(message:string,fraction?:number)=>void,
  quality:OffsetQuality='balanced',
  sharedField?:SphericalDistanceField,
):{solid:Manifold;report:SphericalOffsetReport} {
  const report=sphericalOffsetGrid(mesh,d,quality)
  const {min,max}=extentOf(mesh.positions)
  const pad=d+2
  const bounds={
    min:[min[0]-pad,min[1]-pad,min[2]-pad] as [number,number,number],
    max:[max[0]+pad,max[1]+pad,max[2]+pad] as [number,number,number],
  }
  // The shared field lets two-shell generation index its triangles once.
  const ownField=!sharedField
  const field=sharedField??createSphericalDistanceField(mesh,onProgress)
  try{
    onProgress?.(`Sampling ${quality} spherical clearance at ${report.gridMm.toFixed(3)} mm spacing (${report.gridSamples.toLocaleString()} cells estimated)…`,0.16)
    // The WASM kernel calls the signed-distance function synchronously.
    // Report coarse, monotonic stages at about 1% intervals. The number
    // of callback evaluations can exceed the nominal grid count because
    // of surface refinement, so this is approximate progress, not an ETA.
    let calls=0,lastBucket=-1
    const sdf=(v:readonly number[]):number=>{
      const result=field.sdf(v)
      calls++
      if((calls&1023)===0&&onProgress){
        const portion=Math.min(0.98,calls/report.gridSamples)
        const bucket=Math.floor(portion*60)
        if(bucket>lastBucket){
          lastBucket=bucket
          onProgress(`Sampling mold clearance — ${calls.toLocaleString()} distance queries…`,0.16+0.63*portion)
        }
      }
      return result
    }
    // Inside is positive. Negative isolevel expands the source solid.
    const solid=wasm.Manifold.levelSet(sdf,bounds,report.gridMm,-d,report.toleranceMm)
    onProgress?.('Finalizing spherical-offset solid…',0.81)
    if(solid.status()!=='NoError'||solid.isEmpty()){
      solid.delete()
      throw new Error('Spherical distance-field offset produced no valid closed solid.')
    }
    const before=signedVolume(mesh.positions,mesh.indices),after=solid.volume()
    if(!(after>before)){
      solid.delete()
      throw new Error(`Spherical offset ${d} mm did not enlarge the master volume (${before.toFixed(3)} → ${after.toFixed(3)} mm³). Check source orientation; no mold exported.`)
    }
    const grown=solid.boundingBox()
    for(let k=0;k<3;k++){
      if(grown.min[k]>min[k]-d+report.gridMm*2 ||
         grown.max[k]<max[k]+d-report.gridMm*2){
        solid.delete()
        throw new Error('Spherical offset did not expand the target on every axis; check source face orientation and topology.')
      }
    }
    return {solid,report}
  }finally{
    if(ownField)field.dispose()
  }
}
