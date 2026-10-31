// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {DEFAULT_MOLD_SETTINGS,MOLD_MODES,parseMoldSettings,validMoldDimension} from '../core/settings'
import {moldSection} from '../app/projectSection'
import {useMold} from '../state/moldStore'

describe('Mold Making configuration',()=>{
  it('has three processes and complete split tooling defaults',()=>{
    expect(new Set(MOLD_MODES).size).toBe(3)
    expect(DEFAULT_MOLD_SETTINGS.parts).toBe(2)
    expect(DEFAULT_MOLD_SETTINGS.clearance).toBe(0)
  })
  it('saves all newer settings in project/undo recipes',()=>{
    const state={...DEFAULT_MOLD_SETTINGS,mode:'silicone-box' as const,
      boxShape:'cylindrical' as const,parts:4 as const,boxDraftDeg:2.4,splitAxis:'y' as const}
    moldSection.prepare(state,{manifest:{} as never,members:new Map()})()
    expect(moldSection.collect({sources:{} as never,scanSaved:true,addMember(){}})).toEqual(state)
    useMold.setState({...DEFAULT_MOLD_SETTINGS})
  })
  it('migrates older persisted settings without losing prior measurements',()=>{
    const legacy={source:'scan',mode:'direct',clearance:0.2,sideMargin:8,baseThickness:4,wallThickness:3,siliconeThickness:12}
    const s=parseMoldSettings(legacy)
    expect(s.clearance).toBe(0.2)
    expect(s.parts).toBe(2)
    expect(s.boxShape).toBe('rectangular')
  })
  it('rejects invalid modes, part counts, angles, clearances and dimensions',()=>{
    for(const bad of [null,{...DEFAULT_MOLD_SETTINGS,mode:'other'},
      {...DEFAULT_MOLD_SETTINGS,parts:3},{...DEFAULT_MOLD_SETTINGS,boxShape:'triangle'},
      {...DEFAULT_MOLD_SETTINGS,boxDraftDeg:25},{...DEFAULT_MOLD_SETTINGS,wallThickness:0},
      {...DEFAULT_MOLD_SETTINGS,clearance:-1},{...DEFAULT_MOLD_SETTINGS,sideMargin:Infinity}]){
        expect(()=>parseMoldSettings(bad)).toThrow()
      }
    expect(validMoldDimension('clearance',0)).toBe(true)
    expect(validMoldDimension('wallThickness',NaN)).toBe(false)
  })
  it('resets a project lacking settings',()=>{
    useMold.getState().setMode('silicone-box')
    moldSection.prepare(undefined,{manifest:{} as never,members:new Map()})()
    expect(useMold.getState().mode).toBe('direct')
  })
})
