// SPDX-License-Identifier: AGPL-3.0-only
// Conservative, non-destructive preflight for mold targets. Work on a COPY:
// a zero-area triangle encloses no surface, exact duplicate vertices can be
// welded, and small closed boundary loops may be patched by Mesh Tools.
// Never perform fuzzy welding, decimation or broad surface reconstruction.
import type { SolidMesh } from '../../../src/app/solids'
import { closedness } from '../../mesh-tools/core/boolean'
import { boundaryLoops, loopSize } from '../../mesh-tools/core/boundary'
import { compactEdit } from '../../mesh-tools/core/edit'
import { fillHoles } from '../../mesh-tools/core/fillHoles'

export interface MoldRepairReport {
  mesh: SolidMesh
  warnings: string[]
  removedFaces: number
  adjustedVertices: number
  weldedVertices: number
  filledHoles: number
}
function collapsed(p:Float32Array,ia:number,ib:number,ic:number):boolean {
  if(ia===ib||ia===ic||ib===ic)return true
  const a=ia*3,b=ib*3,c=ic*3
  const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2]
  const vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2]
  return (uy*vz-uz*vy)===0&&(uz*vx-ux*vz)===0&&(ux*vy-uy*vx)===0
}
/**
 * A mesh can be topologically watertight while a few of its triangles have
 * exactly zero area (a collapsed vertex in the source tessellation).
 * Deleting those faces OPENS the previously closed surface. Instead make the
 * smallest Float32-representable change needed to lift the affected vertex
 * away from its edge, approximately in the neighboring surface tangent plane.
 *
 * This only runs for an otherwise CLOSED indexed mesh, never for an open
 * sheet or repeated-index triangle. Keep the original vertex/face numbering.
 * If we cannot mend every face with a submicron adjustment, return null:
 * don't silently carve a hole in a previously watertight source.
 */
export function liftCollapsedClosedMesh(input:SolidMesh):{mesh:SolidMesh;adjustedVertices:number}|null {
  const original=input.positions,idx=input.indices
  const badFaces:number[]=[]
  for(let t=0;t<idx.length;t+=3){
    const a=idx[t],b=idx[t+1],c=idx[t+2]
    if(a===b||a===c||b===c)return null
    if(collapsed(original,a,b,c))badFaces.push(t)
  }
  if(badFaces.length===0)return {mesh:input,adjustedVertices:0}
  const pos=new Float32Array(original)
  const moved=new Set<number>()
  // Gather only the adjacency needed by faces that may require adjustment.
  const affected=new Set<number>()
  for(const t of badFaces)for(let k=0;k<3;k++)affected.add(idx[t+k])
  const neighbors=new Map<number,number[]>()
  for(const v of affected)neighbors.set(v,[])
  for(let t=0;t<idx.length;t+=3)for(let k=0;k<3;k++)
    neighbors.get(idx[t+k])?.push(t)
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
  for(let i=0;i<pos.length;i+=3)for(let k=0;k<3;k++){
    min[k]=Math.min(min[k],pos[i+k]);max[k]=Math.max(max[k],pos[i+k])
  }
  const extent=Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2])
  // Float32 spacing can be ~1e-5 mm on a 100 mm object. Use enough for
  // rounding while remaining far below ordinary printing tolerance.
  const step=Math.max(1e-6,extent*1e-6)
  const unit=(v:number[]):number[]|null=>{
    const l=Math.hypot(v[0],v[1],v[2])
    return l>0?v.map(x=>x/l):null
  }
  for(const t of badFaces){
    const tri=[idx[t],idx[t+1],idx[t+2]]
    if(!collapsed(pos,tri[0],tri[1],tri[2]))continue
    // Move the vertex opposite the longest edge: for a collinear triangle
    // this is the vertex between the endpoints, minimizing distortion.
    let best=0,distance=-1
    for(let k=0;k<3;k++){
      const a=tri[(k+1)%3]*3,b=tri[(k+2)%3]*3
      const d=(pos[a]-pos[b])**2+(pos[a+1]-pos[b+1])**2+(pos[a+2]-pos[b+2])**2
      if(d>distance){distance=d;best=k}
    }
    if(distance<=0)return null // all corners coincide: cannot lift one vertex
    const v=tri[best],a=tri[(best+1)%3],b=tri[(best+2)%3]
    const edge=unit([pos[b*3]-pos[a*3],pos[b*3+1]-pos[a*3+1],pos[b*3+2]-pos[a*3+2]])
    if(!edge)return null
    // Average nonzero neighboring triangle normals to infer the surface
    // tangent. If their sum cancels, choose any perpendicular to the edge.
    const avg=[0,0,0],around=neighbors.get(v)??[]
    for(const face of around){
      const x=idx[face]*3,y=idx[face+1]*3,z=idx[face+2]*3
      const u=[pos[y]-pos[x],pos[y+1]-pos[x+1],pos[y+2]-pos[x+2]]
      const w=[pos[z]-pos[x],pos[z+1]-pos[x+1],pos[z+2]-pos[x+2]]
      const normal=unit([u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]])
      if(normal)for(let k=0;k<3;k++)avg[k]+=normal[k]
    }
    const cross=(x:number[],y:number[])=>[
      x[1]*y[2]-x[2]*y[1],
      x[2]*y[0]-x[0]*y[2],
      x[0]*y[1]-x[1]*y[0]]
    const tangent=unit(cross(avg,edge))??unit(cross(
      Math.abs(edge[0])<0.8?[1,0,0]:[0,1,0],edge))
    if(!tangent)return null
    const start=[pos[v*3],pos[v*3+1],pos[v*3+2]]
    let solved=false
    tryDirections:
    for(const sign of [1,-1])for(const scale of [1,2,4,8,16]){
      const delta=Math.min(step*scale,0.001) // at most one micron in mm
      for(let k=0;k<3;k++)pos[v*3+k]=start[k]+sign*delta*tangent[k]
      // Do not create any new zero-area neighboring faces or fail to fix
      // this face. Topology remains identical; only one coordinate moves.
      if(!collapsed(pos,tri[0],tri[1],tri[2]) &&
         around.every(face=>!collapsed(pos,idx[face],idx[face+1],idx[face+2])||
            badFaces.includes(face))){
        solved=true
        break tryDirections
      }
    }
    if(!solved)return null
    moved.add(v)
  }
  for(let t=0;t<idx.length;t+=3)
    if(collapsed(pos,idx[t],idx[t+1],idx[t+2]))return null
  return {mesh:{positions:pos,indices:idx},adjustedVertices:moved.size}
}
/** Reindex exactly coincident vertices, but do not move or smooth anything.
 * Reject the candidate if it creates non-manifold edges or fails to improve
 * the original boundary. Nonmanifold self-contact must not be guessed away.
 */
function exactWeld(mesh:SolidMesh):{mesh:SolidMesh;welded:number} {
  const keyToIndex=new Map<string,number>()
  const oldToNew=new Uint32Array(mesh.positions.length/3)
  const positions:number[]=[]
  let welded=0
  for(let i=0;i<oldToNew.length;i++){
    const k=i*3,p=mesh.positions
    const key=`${p[k]},${p[k+1]},${p[k+2]}`
    const existing=keyToIndex.get(key)
    if(existing!==undefined){oldToNew[i]=existing;welded++;continue}
    const next=positions.length/3
    keyToIndex.set(key,next)
    oldToNew[i]=next
    positions.push(p[k],p[k+1],p[k+2])
  }
  if(!welded)return {mesh,welded:0}
  const indices=new Uint32Array(mesh.indices.length)
  for(let i=0;i<indices.length;i++)indices[i]=oldToNew[mesh.indices[i]]
  return {mesh:{positions:new Float32Array(positions),indices},welded}
}

/** Clean defects common in imported or simplified mesh tessellations.
 * An unrecoverable target always throws rather than silently changing shape.
 */
export function repairMoldTarget(
  input:SolidMesh,enabled:boolean,maxHoleMm:number,
  onProgress?:(status:string)=>void,
):MoldRepairReport {
  if(!Number.isFinite(maxHoleMm)||maxHoleMm<=0)throw new Error('Repair hole size must be greater than zero.')
  const p=input.positions,idx=input.indices
  if(p.length%3||idx.length%3||idx.length===0)throw new Error('Target mesh has invalid coordinate/triangle arrays.')
  for(let i=0;i<p.length;i++)if(!Number.isFinite(p[i]))throw new Error(`Target contains non-finite coordinate ${i}.`)
  for(let i=0;i<idx.length;i++)if(idx[i]>=p.length/3)throw new Error(`Target triangle index ${i} is out of bounds.`)
  // When repair is disabled, leave both geometry and topology diagnostics
  // to the caller's normal validation. Checking connectivity here would
  // mask a more specific error (e.g. an exactly zero-area face also makes
  // some edge counts appear nonmanifold) and make the toggle nonfunctional.
  if(!enabled)return {mesh:input,warnings:[],removedFaces:0,adjustedVertices:0,weldedVertices:0,filledHoles:0}
  const sourceTopology=closedness(idx,p.length/3)
  let removedFaces=0,adjustedVertices=0,weldedVertices=0,filledHoles=0
  if(sourceTopology.open===0&&sourceTopology.bad===0){
    const lifted=liftCollapsedClosedMesh(input)
    if(!lifted)throw new Error('The target is indexed watertight but contains collapsed triangles that cannot safely be lifted by at most 0.001 mm. The source was left unchanged; inspect the affected faces or use an external mesh repair tool.')
    if(lifted.adjustedVertices){
      onProgress?.(`Lifted ${lifted.adjustedVertices} collapsed target vertices by at most 0.001 mm without opening the closed mesh.`)
      return {mesh:lifted.mesh,
        warnings:[`Temporary target repair: nudged ${lifted.adjustedVertices} vertices by at most 0.001 mm to fix zero-area faces while preserving all triangles and watertight topology. Original source unchanged; inspect the cavity.`],
        removedFaces:0,adjustedVertices:lifted.adjustedVertices,weldedVertices:0,filledHoles:0}
    }
  }
  let mesh=input
  if(enabled){
    const kept:number[]=[]
    for(let i=0;i<idx.length;i+=3){
      if(collapsed(p,idx[i],idx[i+1],idx[i+2]))removedFaces++
      else kept.push(idx[i],idx[i+1],idx[i+2])
    }
    if(!kept.length)throw new Error('The target has no nonzero-area triangles to form a mold.')
    if(removedFaces){
      onProgress?.(`Removing ${removedFaces} exactly zero-area triangles from a temporary mold target…`)
      const cleaned=compactEdit(p,new Uint32Array(kept),p.length/3)
      mesh={positions:cleaned.positions,indices:cleaned.indices}
    }
  }
  let topology=closedness(mesh.indices,mesh.positions.length/3)
  if(enabled && topology.open>0 && topology.bad===0){
    onProgress?.('Checking for exact duplicate vertices along open mesh edges…')
    const trial=exactWeld(mesh)
    if(trial.welded){
      const c=closedness(trial.mesh.indices,trial.mesh.positions.length/3)
      if(c.bad===0&&c.open<topology.open){
        mesh=trial.mesh
        topology=c
        weldedVertices=trial.welded
      }
    }
  }
  let patchFailure:string|null=null
  if(enabled && topology.open>0 && topology.bad===0){
    const border=boundaryLoops(mesh.indices,mesh.positions.length/3)
    const sizes=border.loops.map(loop=>loopSize(mesh.positions,loop.vertices))
    // Only patch if every remaining boundary is a complete, sufficiently
    // small loop. A partial open rim or large area might be an intentional
    // opening and must be repaired manually.
    if(border.stray===0&&sizes.length>0&&sizes.every(size=>size<maxHoleMm)){
      onProgress?.(`Patching ${sizes.length} tiny boundary loops on the temporary mold target…`)
      try{
        const patch=fillHoles(mesh.positions,mesh.indices,mesh.positions.length/3,maxHoleMm,'flat',onProgress)
        if(patch.report.failed===0&&patch.report.left===0){
          const candidate={positions:patch.positions,indices:patch.indices}
          const c=closedness(candidate.indices,candidate.positions.length/3)
          if(!c.open&&!c.bad){
            mesh=candidate
            topology=c
            filledHoles=patch.report.filled
          }else patchFailure=`Generated patches still have ${c.open} open and ${c.bad} nonmanifold edges.`
        }else patchFailure=`${patch.report.failed} hole patches failed and ${patch.report.left} rims were left open.`
      }catch(error){
        patchFailure=error instanceof Error?error.message:String(error)
      }
    }
  }
  if(topology.open||topology.bad){
    const border=topology.bad===0?boundaryLoops(mesh.indices,mesh.positions.length/3):null
    const sizes=border?.loops.map(loop=>loopSize(mesh.positions,loop.vertices))??[]
    const largest=sizes.length?Math.max(...sizes):null
    const detail=largest===null?'':` Largest open rim: ${largest.toPrecision(3)} mm across.`
    const reason=topology.bad>0?' Nonmanifold edges require manual repair.':
      border&&border.stray>0?` ${border.stray} unmatched boundary edges do not form complete, fillable loops.`:
      sizes.some(size=>size>=maxHoleMm)?` At least one boundary rim exceeds the configured ${maxHoleMm} mm patch limit.`:
      patchFailure?` Patch solver failed: ${patchFailure}.`:
      ' These edges could not be filled safely.'
    const cleanupDetail=removedFaces>0&&topology.open>sourceTopology.open
      ?` Mesh Tools may report the original as closed because removing ${removedFaces} zero-area triangles in the temporary mold copy exposed ${topology.open-sourceTopology.open} additional open edges.`
      :''
    throw new Error(`Target is not watertight (${topology.open} boundary edges, ${topology.bad} nonmanifold edges).${detail}${reason}${cleanupDetail} ${enabled?'Auto-repair could not safely close the mesh. Increase Mold Making\'s maximum small-hole size only if the missing surface really belongs there; otherwise use Mesh Tools → Fill holes → Use for analysis.':'Enable Repair small mesh defects in Mold Making, or use Mesh Tools → Fill holes → Use for analysis.'}`)
  }
  const warnings:string[]=[]
  if(removedFaces||weldedVertices||filledHoles){
    warnings.push(`Temporary target mesh repair: removed ${removedFaces} exactly zero-area triangles, welded ${weldedVertices} exactly coincident vertices, patched ${filledHoles} small holes. Original source unchanged. Inspect the cavity near repaired regions before printing.`)
  }
  return {mesh,warnings,removedFaces,adjustedVertices,weldedVertices,filledHoles}
}
