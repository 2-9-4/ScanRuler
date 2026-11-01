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
  if(!enabled)return {mesh:input,warnings:[],removedFaces:0,weldedVertices:0,filledHoles:0}
  const sourceTopology=closedness(idx,p.length/3)
  let removedFaces=0,weldedVertices=0,filledHoles=0
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
  return {mesh,warnings,removedFaces,weldedVertices,filledHoles}
}
