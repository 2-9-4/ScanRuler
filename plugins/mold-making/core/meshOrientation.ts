// SPDX-License-Identifier: AGPL-3.0-only
// Reorient a CLOSED triangle mesh on a copy before its faces are used to
// assign signed-distance signs. The regular mold preflight checks undirected
// watertightness but a closed mesh can still have locally inverted faces.
// A few flipped triangles in an otherwise valid scan produce arbitrary SDF
// sign inversions and corrupt the offset at every resolution.

export interface WindingReport {
  indices:Uint32Array
  flippedFaces:number
}

/** Orient adjacent triangles oppositely along every shared edge.
 * Minimize flips per connected surface component to preserve the original
 * outward/inward convention (including separately wound inner cavities).
 * The original source arrays are NEVER modified.
 */
export function orientForSignedDistance(indices:Uint32Array,vertexCount:number):WindingReport {
  const faceCount=indices.length/3
  const adjoining=new Int32Array(indices.length).fill(-1)
  const invert=new Uint8Array(indices.length)
  const first=new Map<number,number>()
  const edge=(i:number,j:number)=>Math.min(i,j)*vertexCount+Math.max(i,j)
  for(let f=0;f<faceCount;f++)for(let slot=0;slot<3;slot++){
    const at=f*3+slot
    const a=indices[at],b=indices[f*3+(slot+1)%3]
    if(a>=vertexCount||b>=vertexCount||a===b)throw new Error('Cannot orient the source: invalid triangle indices.')
    const key=edge(a,b),prior=first.get(key)
    if(prior===undefined){first.set(key,at);continue}
    if(adjoining[prior]!==-1)throw new Error('Cannot orient the source: an edge touches more than two triangles.')
    const otherFace=Math.floor(prior/3)
    const otherA=indices[prior],otherB=indices[otherFace*3+(prior%3+1)%3]
    const sameDirection=(a===otherA&&b===otherB)
    adjoining[prior]=at;adjoining[at]=prior
    invert[prior]=sameDirection?1:0;invert[at]=invert[prior]
  }
  first.clear()
  // Mesh might be open: input mesh preflight ordinarily catches that, but
  // don't manufacture a signed field from an open boundary.
  for(const neighbor of adjoining)if(neighbor===-1)
    throw new Error('Cannot build a signed distance field from an open mesh boundary. Repair the source first.')
  const flips=new Int8Array(faceCount).fill(-1)
  const queue=new Int32Array(faceCount)
  let changed=0
  for(let seed=0;seed<faceCount;seed++){
    if(flips[seed]!==-1)continue
    let head=0,tail=1,numberFlipped=0
    queue[0]=seed;flips[seed]=0
    while(head<tail){
      const face=queue[head++]
      for(let side=0;side<3;side++){
        const at=face*3+side
        const next=Math.floor(adjoining[at]/3)
        const expected=flips[face]^invert[at]
        if(flips[next]===-1){
          flips[next]=expected
          if(expected)numberFlipped++
          queue[tail++]=next
        }else if(flips[next]!==expected){
          throw new Error('Cannot orient the source consistently; the surface has contradictory triangle winding.')
        }
      }
    }
    // Reversing the entire surface component is an equally consistent
    // solution; choose the one that modifies the fewest source faces.
    if(numberFlipped>tail/2){
      for(let i=0;i<tail;i++)flips[queue[i]]^=1
      numberFlipped=tail-numberFlipped
    }
    changed+=numberFlipped
  }
  if(!changed)return {indices,flippedFaces:0}
  const fixed=indices.slice()
  for(let f=0;f<faceCount;f++)if(flips[f]){
    const tmp=fixed[f*3+1]
    fixed[f*3+1]=fixed[f*3+2]
    fixed[f*3+2]=tmp
  }
  return {indices:fixed,flippedFaces:changed}
}
