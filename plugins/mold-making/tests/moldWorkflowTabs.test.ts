// SPDX-License-Identifier: AGPL-3.0-only
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {
  MoldWorkflowTabs,MOLD_WORKFLOW_TABS,nextMoldWorkflowTab,
} from '../ui/MoldWorkflowTabs'

describe('Mold Making subtabs',()=>{
  it('organizes the workflow into four stable, accessible destinations',()=>{
    expect(MOLD_WORKFLOW_TABS.map(t=>t.id)).toEqual([
      'setup','parting','casting','review',
    ])
    const html=renderToStaticMarkup(createElement(MoldWorkflowTabs,{
      active:'parting',onChange:()=>{},
    }))
    expect(html.match(/role="tab"/g)).toHaveLength(4)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Mold Making workflow"')
    for(const tab of MOLD_WORKFLOW_TABS){
      expect(html).toContain(`id="mold-tab-${tab.id}"`)
      expect(html).toContain(`aria-controls="mold-tab-panel-${tab.id}"`)
    }
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/tabindex="0"/gi)).toHaveLength(1)
    expect(html).toContain('Model &amp; size')
    expect(html).toContain('Inspect &amp; export')
    // Native icon SVGs are decorative: the visible text, tab roles and
    // keyboard focus rules remain the accessible controls.
    expect(html.match(/class="icon"/g)).toHaveLength(4)
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(4)
    const tabs=html.match(/<button[^>]+role="tab"[^>]*>.*?<\/button>/g)??[]
    expect(tabs).toHaveLength(4)
    const artwork=tabs.map(tab=>tab.match(/<svg[^>]*>(.*?)<\/svg>/)?.[1])
    expect(artwork.every(Boolean)).toBe(true)
    expect(new Set(artwork).size).toBe(4)
  })
  it('supports arrow and boundary keys without losing the active tab',()=>{
    expect(nextMoldWorkflowTab('setup','ArrowLeft')).toBe('review')
    expect(nextMoldWorkflowTab('review','ArrowRight')).toBe('setup')
    expect(nextMoldWorkflowTab('parting','ArrowRight')).toBe('casting')
    expect(nextMoldWorkflowTab('casting','ArrowLeft')).toBe('parting')
    expect(nextMoldWorkflowTab('casting','Home')).toBe('setup')
    expect(nextMoldWorkflowTab('parting','End')).toBe('review')
    expect(nextMoldWorkflowTab('parting','Escape')).toBe('parting')
  })
})
