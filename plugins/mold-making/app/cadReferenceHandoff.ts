// SPDX-License-Identifier: AGPL-3.0-only
/** Non-destructive visual reference handoff. This deliberately has NO
 * import/openScan function available: neither the original source nor any
 * of the generated mold parts can be replaced as part of this operation.
 * CAD edits still belong to Reverse Engineering's existing feature model.
 */
export interface MoldCadReferencePort {
  showAllMoldParts:(visible:boolean[])=>void
  showOriginalMaster:()=>void
  assemblePreview:()=>void
  focusPart:(index:number)=>void
  showPreview:()=>void
  openReverseWorkspace:()=>void
  report:(message:string)=>void
}
export function showMoldInCadReference(
  partNames:readonly string[],index:number,port:MoldCadReferencePort,
):void{
  if(!Number.isSafeInteger(index)||index<0||index>=partNames.length)
    throw new Error('Invalid CAD reference mold-part index.')
  const name=partNames[index]
  if(!name)throw new Error('Missing CAD reference part name.')
  // Preserve all pieces including the selected one, independent mounting
  // posts, and the source master. Geometry stays in its original frame.
  port.showAllMoldParts(partNames.map(()=>true))
  port.showOriginalMaster()
  port.assemblePreview()
  port.focusPart(index)
  port.showPreview()
  port.openReverseWorkspace()
  port.report(
    `${name} is highlighted as a view-only CAD reference alongside the original model and every generated mold part. No scan was replaced. Return to Mold Making to change tooling; Edit copy is the separate scan-replacing operation.`
  )
}
