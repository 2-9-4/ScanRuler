// SPDX-License-Identifier: AGPL-3.0-only
// Primary Mold Making workflow navigation. Geometry/settings live in the
// separate mold store; changing tabs never regenerates a tool.
import type {KeyboardEvent} from 'react'
import {MoldIcon,type MoldIconName} from './MoldIcons'

export const MOLD_WORKFLOW_TABS=[
  {id:'setup',label:'Model & size',icon:'model'},
  {id:'parting',label:'Split & keys',icon:'split'},
  {id:'casting',label:'Pour & mount',icon:'moldPour'},
  {id:'review',label:'Inspect & export',icon:'eye'},
] as const

export type MoldWorkflowTab=typeof MOLD_WORKFLOW_TABS[number]['id']

export function nextMoldWorkflowTab(
  current:MoldWorkflowTab,key:string,
):MoldWorkflowTab{
  const ids=MOLD_WORKFLOW_TABS.map(item=>item.id)
  const position=ids.indexOf(current)
  const target=key==='Home'?0:key==='End'?ids.length-1:
    key==='ArrowRight'?(position+1)%ids.length:
    key==='ArrowLeft'?(position+ids.length-1)%ids.length:position
  return ids[target]??current
}

export function MoldWorkflowTabs({active,onChange}:{
  active:MoldWorkflowTab
  onChange:(tab:MoldWorkflowTab)=>void
}){
  const onKeyDown=(e:KeyboardEvent<HTMLElement>)=>{
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return
    e.preventDefault()
    const next=nextMoldWorkflowTab(active,e.key)
    onChange(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`#mold-tab-${next}`)?.focus()
  }
  return <nav className="kindrow featurekeys" role="tablist"
    aria-label="Mold Making workflow" data-test="mold-workflow-tabs"
    style={{display:'flex',flexWrap:'wrap',gap:4}}
    onKeyDown={onKeyDown}>
    {MOLD_WORKFLOW_TABS.map(({id,label,icon})=><button
      type="button" key={id} id={`mold-tab-${id}`}
      data-test={`mold-tab-${id}`} role="tab"
      aria-selected={active===id} tabIndex={active===id?0:-1}
      aria-controls={`mold-tab-panel-${id}`}
      className={active===id?'on':undefined}
      onClick={()=>onChange(id)}>
      <MoldIcon name={icon as MoldIconName} size={20}/>
      <span>{label}</span>
    </button>)}
  </nav>
}
