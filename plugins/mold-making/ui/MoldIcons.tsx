// SPDX-License-Identifier: AGPL-3.0-only
// Small set of Mold Making-specific key pictures. Reuse the repository's
// existing 24-unit icon grid and ink/accent/dashed vocabulary, not a
// separate icon library. Shared operations delegate to src/ui/icons.tsx.
import type {ReactNode} from 'react'
import {Icon,IconFrame,type IconName} from '../../../src/ui/icons'

const MOLD_ICONS={
  // Two pieces of a mold, the blue internal casting void they enclose.
  moldTool: (
    <>
      <path className="i-g" d="M2.5 5h8v14h-8Z M13.5 5h8v14h-8Z"/>
      <path className="i-a" d="M10.5 8.5q-4 3.5 0 7M13.5 8.5q4 3.5 0 7"/>
      <path className="i-th i-ds" d="M12 3v18"/>
    </>
  ),
  // Blue liquid descends from the funnel into the hollow impression.
  moldPour: (
    <>
      <path className="i-g" d="M3 12.5h18V21H3Z"/>
      <path className="i-f" d="M7 12.5q5 7 10 0"/>
      <path d="M4 3h16l-6 5v3.5h-4V8Z"/>
      <path className="i-a" d="M12 8v7m-2-2.4 2 2.4 2-2.4"/>
    </>
  ),
  // Small vent channel rising out of the tooling; not the pour funnel.
  moldVent: (
    <>
      <path className="i-g" d="M3 11h18v10H3Z"/>
      <path className="i-th" d="M9 17q3-4 6 0"/>
      <path d="M11 11V5h2v6"/>
      <path className="i-a" d="M12 8V2.5m-2.2 2 2.2-2.5 2.2 2.5"/>
    </>
  ),
  // A post with foot and pad holding a master from below.
  moldMount: (
    <>
      <path className="i-g" d="M4 4h16v6H4Z"/>
      <path className="i-f" d="M8.5 12h7v3h-7Z"/>
      <path d="M10.5 15v5h3v-5M6 21h12"/>
      <path className="i-a" d="M12 13.5V8m-2 2 2-2 2 2"/>
    </>
  ),
  // The selected component is solid, the other piece only referenced.
  moldIsolate: (
    <>
      <path className="i-f" d="M3 6.5h8v11H3Z"/>
      <path className="i-th i-ds" d="M13 6.5h8v11h-8Z"/>
      <path className="i-a" d="M3 20.5h8"/>
      <circle className="i-adt" cx="7" cy="12" r="1.6"/>
    </>
  ),
  // Both shell halves touch at the seam.
  moldAssembled: (
    <>
      <path className="i-g" d="M3 5h9v14H3Z M12 5h9v14h-9Z"/>
      <path className="i-a" d="M12 4v16"/>
      <path className="i-th i-ds" d="M8 9q4 3 0 6M16 9q-4 3 0 6"/>
    </>
  ),
  // The two parts separated along their seam.
  moldExploded: (
    <>
      <path className="i-g" d="M2 5h7v14H2Z M15 5h7v14h-7Z"/>
      <path className="i-th i-ds" d="M12 3v18"/>
      <path className="i-a" d="M10 12H4m2.2-2.2L4 12l2.2 2.2M14 12h6m-2.2-2.2L20 12l-2.2 2.2"/>
    </>
  ),
  // A tessellated solid leaving the workspace as an independent mesh file.
  moldExport: (
    <>
      <path className="i-g" d="M3 7.5 10 4l7 3.5V14l-7 3.5L3 14Z"/>
      <path className="i-th" d="m3 7.5 7 3.5 7-3.5M10 11v6.5"/>
      <path className="i-a" d="M15 18h6m-3-3 3 3-3 3"/>
    </>
  ),
} satisfies Record<string,ReactNode>

export type MoldIconName=IconName|keyof typeof MOLD_ICONS
const isMoldIcon=(name:MoldIconName):name is keyof typeof MOLD_ICONS=>name in MOLD_ICONS

/** Decoration only. Each action retains its visible text and ARIA label. */
export function MoldIcon({name,size=16}:{name:MoldIconName;size?:number}){
  return isMoldIcon(name)
    ?<IconFrame size={size}>{MOLD_ICONS[name]}</IconFrame>
    :<Icon name={name} size={size}/>
}
