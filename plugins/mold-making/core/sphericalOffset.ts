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
import { orientForSignedDistance } from './meshOrientation'

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
  fast:{minGrid:0.9,maxGrid:4,maxSamples:80_000,tolerance:0.25},
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
 * edge/vertex pseudonormals and query scratch buffers for one offset.
 * Dispose when generation ends.
 */
export interface SphericalDistanceField {
  sdf(v:readonly number[]):number
  dispose():void
}
export function createSphericalDistanceField(mesh:SolidMesh,onProgress?:(message:string,fraction?:number)=>void):SphericalDistanceField {
  onProgress?.('Indexing source triangles for spherical clearance…')
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(mesh.positions,3))
  const oriented=orientForSignedDistance(mesh.indices,mesh.positions.length/3)
  if(oriented.flippedFaces)onProgress?.(`Corrected ${oriented.flippedFaces} reversed triangle faces in the temporary distance field…`)
  geometry.setIndex(new BufferAttribute(oriented.indices.slice(),1))
  const bvh=new MeshBVH(geometry,{maxLeafTris:12})
  const index=geometry.getIndex()!
  // A face normal alone is NOT a valid sign test when the nearest point
  // lies on an edge or corner. Around a sharp concave edge, either incident
  // face can return the wrong inside/outside sign, creating disconnected
  // level-set islands regardless of grid resolution.
  //
  // Use angle-weighted pseudonormals at vertices and the sum of both
  // incident face normals at edges. On an oriented closed 2-manifold, the
  // dot with the nearest point's feature pseudonormal gives the correct
  // local sign even for nonconvex sharp features.
  const faces=index.count/3
  const vertexCount=mesh.positions.length/3
  const normals=new Float32Array(index.count)
  const vertexNormals=new Float64Array(mesh.positions.length)
  // Three edge normals (a-b, b-c, c-a) per triangle.
  const edgeNormals=new Float32Array(index.count*3)
  const firstEdge=new Map<number,number>()
  const p=mesh.positions
  const angle=(u0:number,u1:number,u2:number,v0:number,v1:number,v2:number):number=>{
    const l=Math.hypot(u0,u1,u2)*Math.hypot(v0,v1,v2)
    return l>0?Math.acos(Math.max(-1,Math.min(1,(u0*v0+u1*v1+u2*v2)/l))):0
  }
  for(let face=0;face<faces;face++){
    const ia=index.getX(face*3),ib=index.getX(face*3+1),ic=index.getX(face*3+2)
    const a=ia*3,b=ib*3,c=ic*3
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2]
    const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2]
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx
    const length=Math.hypot(x,y,z)
    if(!(length>0)){
      geometry.dispose()
      throw new Error(`Spherical offset needs nondegenerate source faces (triangle ${face}).`)
    }
    const nx=x/length,ny=y/length,nz=z/length
    normals[face*3]=nx;normals[face*3+1]=ny;normals[face*3+2]=nz
    const weights=[
      angle(ux,uy,uz,vx,vy,vz),
      angle(p[a]-p[b],p[a+1]-p[b+1],p[a+2]-p[b+2],
        p[c]-p[b],p[c+1]-p[b+1],p[c+2]-p[b+2]),
      angle(p[a]-p[c],p[a+1]-p[c+1],p[a+2]-p[c+2],
        p[b]-p[c],p[b+1]-p[c+1],p[b+2]-p[c+2]),
    ]
    for(const [corner,id] of [ia,ib,ic].entries()){
      vertexNormals[id*3]+=weights[corner]*nx
      vertexNormals[id*3+1]+=weights[corner]*ny
      vertexNormals[id*3+2]+=weights[corner]*nz
    }
    for(const [slot,pair] of [[ia,ib],[ib,ic],[ic,ia]].entries()){
      const e=face*3+slot,ptr=e*3
      edgeNormals[ptr]=nx;edgeNormals[ptr+1]=ny;edgeNormals[ptr+2]=nz
      // Numeric key is exact for practical meshes (<~95 million vertices).
      const lo=Math.min(pair[0],pair[1]),hi=Math.max(pair[0],pair[1])
      const key=lo*vertexCount+hi
      const other=firstEdge.get(key)
      if(other===undefined)firstEdge.set(key,e)
      else {
        const o=other*3
        edgeNormals[ptr]+=edgeNormals[o]
        edgeNormals[ptr+1]+=edgeNormals[o+1]
        edgeNormals[ptr+2]+=edgeNormals[o+2]
        edgeNormals[o]+=nx;edgeNormals[o+1]+=ny;edgeNormals[o+2]+=nz
      }
    }
  }
  firstEdge.clear()
  const query=new Vector3()
  const closest={point:new Vector3(),distance:0,faceIndex:0}
  const warmTriangle=new Triangle(new Vector3(),new Vector3(),new Vector3())
  const warmPoint=new Vector3()
  const bary=new Vector3()
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
      const ia=index.getX(face),ib=index.getX(face+1),ic=index.getX(face+2)
      const a=ia*3,b=ib*3,c=ic*3
      warmTriangle.a.set(p[a],p[a+1],p[a+2])
      warmTriangle.b.set(p[b],p[b+1],p[b+2])
      warmTriangle.c.set(p[c],p[c+1],p[c+2])
      warmTriangle.getBarycoord(closest.point,bary)
      const threshold=1e-6
      const onA=bary.x<=threshold,onB=bary.y<=threshold,onC=bary.z<=threshold
      let nx=normals[face],ny=normals[face+1],nz=normals[face+2]
      if((onA?1:0)+(onB?1:0)+(onC?1:0)>=2){
        // Nearest point is a mesh vertex: angle-weighted pseudonormal.
        const vertex=bary.x>=bary.y&&bary.x>=bary.z?ia:bary.y>=bary.z?ib:ic
        const v=vertex*3
        if(Math.hypot(vertexNormals[v],vertexNormals[v+1],vertexNormals[v+2])>1e-10){
          nx=vertexNormals[v];ny=vertexNormals[v+1];nz=vertexNormals[v+2]
        }
      }else if(onA||onB||onC){
        // Edge slots are (a,b), (b,c), (c,a), respectively.
        const edge=closest.faceIndex*9+(onC?0:onA?3:6)
        if(Math.hypot(edgeNormals[edge],edgeNormals[edge+1],edgeNormals[edge+2])>1e-10){
          nx=edgeNormals[edge];ny=edgeNormals[edge+1];nz=edgeNormals[edge+2]
        }
      }
      const dx=query.x-closest.point.x
      const dy=query.y-closest.point.y
      const dz=query.z-closest.point.z
      const dot=dx*nx+dy*ny+dz*nz
      return dot<0?closest.distance:-closest.distance
    },
    dispose(){geometry.dispose()},
  }
}

/** A proper outward morphological dilation cannot have MORE connected
 * components than its source: thickening can join pieces, never split one.
 * Verify this without creating an extra Manifold just to count components.
 */
function sourceComponentCount(mesh:SolidMesh):number {
  const n=mesh.positions.length/3
  const parent=new Int32Array(n)
  const used=new Uint8Array(n)
  for(let i=0;i<n;i++)parent[i]=i
  const root=(i:number):number=>{
    while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}
    return i
  }
  const join=(a:number,b:number)=>{
    const x=root(a),y=root(b)
    if(x!==y)parent[y]=x
  }
  for(let t=0;t<mesh.indices.length;t+=3){
    const a=mesh.indices[t],b=mesh.indices[t+1],c=mesh.indices[t+2]
    used[a]=1;used[b]=1;used[c]=1
    join(a,b);join(b,c)
  }
  const roots=new Set<number>()
  for(let i=0;i<n;i++)if(used[i])roots.add(root(i))
  return roots.size
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
  // A supplied field avoids rebuilding the BVH for repeated queries.
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
    // Topological invariant: the d-neighborhood of an original connected
    // solid is connected. Floating islands here are a BAD offset, not
    // legitimate extra printable mold pieces. Reject it before subtracting
    // it from the mold block or applying registration.
    const components=solid.decompose()
    let count=0
    try{count=components.length}
    finally{for(const component of components)component.delete()}
    const sourceCount=sourceComponentCount(mesh)
    if(count>sourceCount){
      solid.delete()
      throw new Error(`Spherical offset generated ${count} disconnected solids from ${sourceCount} input component(s). This is a corrupted distance-field result, not printable tooling; no mold was exported. Try a different offset quality or supply this model as a regression fixture.`)
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
