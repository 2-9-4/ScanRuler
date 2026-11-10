// SPDX-License-Identifier: AGPL-3.0-only
// Part visibility is a viewport-only state. Keep it out of MoldSettings
// (and out of the generated mesh/export pipeline).
export function visibleMoldParts(current:readonly boolean[],count:number):boolean[]{
  if(!Number.isSafeInteger(count)||count<0)throw new Error('Invalid mold part count.')
  return Array.from({length:count},(_,i)=>current[i]??true)
}

export function toggleMoldPart(
  current:readonly boolean[],count:number,index:number,
):boolean[]{
  if(!Number.isInteger(index)||index<0||index>=count)
    throw new Error('Invalid mold part index.')
  const next=visibleMoldParts(current,count)
  next[index]=!next[index]
  return next
}

/** Click once to isolate the requested part, click again to restore all.
 * Works regardless of any prior hide/show combination and never changes
 * generated parts or the selected source mesh.
 */
export function isolateMoldPart(
  current:readonly boolean[],count:number,index:number,
):boolean[]{
  if(!Number.isInteger(index)||index<0||index>=count)
    throw new Error('Invalid mold part index.')
  const now=visibleMoldParts(current,count)
  const isolated=now.every((v,i)=>v===(i===index))
  return Array.from({length:count},(_,i)=>isolated||i===index)
}
