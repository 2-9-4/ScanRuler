// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {DEFAULT_MOLD_SETTINGS,MOLD_MODES,parseMoldSettings,validMoldDimension} from '../core/settings'
import {moldSection} from '../app/projectSection'
import {useMold} from '../state/moldStore'

describe('Mold Making configuration',()=>{
  it('has two processes and complete split tooling defaults',()=>{
    expect(new Set(MOLD_MODES).size).toBe(2)
    expect(DEFAULT_MOLD_SETTINGS.parts).toBe(2)
    expect(DEFAULT_MOLD_SETTINGS.clearance).toBe(0)
    expect(DEFAULT_MOLD_SETTINGS.offsetQuality).toBe('balanced')
  })
  it('preserves quality through project settings and applies the default to legacy projects',()=>{
    const saved={...DEFAULT_MOLD_SETTINGS,offsetQuality:'fast' as const}
    moldSection.prepare(saved,{manifest:{} as never,members:new Map()})()
    expect(moldSection.collect({sources:{} as never,scanSaved:true,addMember(){}})?.offsetQuality).toBe('fast')
    useMold.getState().setOffsetQuality('fine')
    expect(useMold.getState().offsetQuality).toBe('fine')
    expect(()=>parseMoldSettings({...saved,offsetQuality:'ultra'})).toThrow(/quality/)
    const legacy=Object.fromEntries(Object.entries(saved).filter(([key])=>key!=='offsetQuality'))
    expect(parseMoldSettings(legacy).offsetQuality).toBe('balanced')
  })
  it('migrates removed thin-shell projects into direct mold settings',()=>{
    const old={...DEFAULT_MOLD_SETTINGS,mode:'thin-negative-shell'}
    const parsed=parseMoldSettings(old)
    expect(parsed.mode).toBe('direct')
    expect(MOLD_MODES).not.toContain('thin-negative-shell')
    expect(parsed.clearance).toBe(old.clearance)
  })
  it('persists manually editable metal-dowel hole locations',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,keyStyle:'metal-dowel' as const,
      keyPlacement:'manual' as const,keyPositions:[0.2,0.53,0.8]}
    const restore=moldSection.prepare(s,{manifest:{} as never,members:new Map()})
    restore()
    expect(moldSection.collect({sources:{} as never,scanSaved:true,addMember(){}})).toEqual(s)
    expect(moldSection.holdsWork!()).toBe(true)
    useMold.setState({...DEFAULT_MOLD_SETTINGS})
    expect(moldSection.holdsWork!()).toBe(false)
  })
  it('rejects invalid or duplicate manual key fractions',()=>{
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,keyPositions:[0.3,0.3]})).toThrow(/distinct/)
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,keyPositions:[-1]})).toThrow(/1–99/)
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,keyPlacement:'manual',keyPositions:[]})).toThrow(/manual/)
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
