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
    expect(DEFAULT_MOLD_SETTINGS.keyStyle).toBe('v-seam')
    expect(DEFAULT_MOLD_SETTINGS.vSeamWidth).toBe(4.8)
    expect(DEFAULT_MOLD_SETTINGS.vSeamHeight).toBe(2.4)
    expect(DEFAULT_MOLD_SETTINGS.vSeamWidth/2).toBe(DEFAULT_MOLD_SETTINGS.vSeamHeight)
    expect(DEFAULT_MOLD_SETTINGS.sideMargin).toBe(0)
    expect(DEFAULT_MOLD_SETTINGS.baseThickness).toBe(0)
    expect(DEFAULT_MOLD_SETTINGS.wallThickness).toBe(0)
    expect(parseMoldSettings({...DEFAULT_MOLD_SETTINGS,parts:3}).parts).toBe(3)
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
  it('preserves two-axis registration coordinates through project save and restore',()=>{
    const s={...DEFAULT_MOLD_SETTINGS,keyPlacement:'manual' as const,
      keyPoints:[[0.13,0.25],[0.82,0.77]] as [number,number][]}
    moldSection.prepare(s,{manifest:{} as never,members:new Map()})()
    expect(moldSection.collect({sources:{} as never,scanSaved:true,addMember(){}})?.keyPoints).toEqual(s.keyPoints)
    expect(moldSection.holdsWork!()).toBe(true)
    useMold.getState().setKeyPoints([[0.22,0.18],[0.8,0.9]])
    expect(useMold.getState().keyPoints).toEqual([[0.22,0.18],[0.8,0.9]])
    expect(()=>parseMoldSettings({...s,keyPoints:[[0.5,0.5],[0.5,0.5]]})).toThrow(/distinct/)
    useMold.setState({...DEFAULT_MOLD_SETTINGS})
    expect(moldSection.holdsWork!()).toBe(false)
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
  it('rejects invalid registration coordinates and empty manual coordinates for the active mode',()=>{
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,keyPositions:[0.3,0.3]})).toThrow(/distinct/)
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,keyPositions:[-1]})).toThrow(/1–99/)
    // Direct molds use 2D keyPoints; silicone boxes use 1D height keyPositions.
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,mode:'direct',keyStyle:'tapered-key',keyPlacement:'manual',keyPoints:[]})).toThrow(/manual/)
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,mode:'silicone-box',keyStyle:'metal-dowel',keyPlacement:'manual',keyPositions:[]})).toThrow(/manual/)
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,mode:'direct',keyStyle:'tapered-key',keyPlacement:'manual',keyPositions:[]})).not.toThrow()
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,mode:'direct',keyStyle:'v-seam',keyPlacement:'manual',keyPoints:[]})).not.toThrow()
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,mode:'silicone-box',keyStyle:'metal-dowel',keyPlacement:'manual',keyPoints:[]})).not.toThrow()
    expect(()=>parseMoldSettings({...DEFAULT_MOLD_SETTINGS,mode:'silicone-box',keyPlacement:'manual',keyPositions:[]})).not.toThrow()
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
      {...DEFAULT_MOLD_SETTINGS,parts:5},{...DEFAULT_MOLD_SETTINGS,boxShape:'triangle'},
      {...DEFAULT_MOLD_SETTINGS,boxDraftDeg:25},{...DEFAULT_MOLD_SETTINGS,clampTabCount:-1},
      {...DEFAULT_MOLD_SETTINGS,clearance:-1},{...DEFAULT_MOLD_SETTINGS,sideMargin:Infinity}]){
        expect(()=>parseMoldSettings(bad)).toThrow()
      }
    expect(validMoldDimension('clearance',0)).toBe(true)
    expect(validMoldDimension('wallThickness',NaN)).toBe(false)
    expect(validMoldDimension('wallThickness',0)).toBe(true)
    expect(validMoldDimension('baseThickness',0)).toBe(true)
    expect(validMoldDimension('vSeamSpacing',0)).toBe(true)
    expect(validMoldDimension('clampTabCount',3.5)).toBe(false)
    const saved={...DEFAULT_MOLD_SETTINGS,vSeamWidth:3.8,vSeamSpacing:2.2,
      clampTabCount:5,clampTabProjection:18}
    expect(parseMoldSettings(saved)).toEqual(saved)
  })
  it('round-trips optional clamp tabs, through bolts and hex-nut recess settings',()=>{
    const configured={...DEFAULT_MOLD_SETTINGS,
      topBottomTabs:true,topBottomTabCount:3,
      tabBoltHoles:true,tabBoltDiameter:5.4,
      tabCapturedNuts:true,tabNutAcrossFlats:8.1,tabNutDepth:5.2}
    expect(parseMoldSettings(configured)).toEqual(configured)
    moldSection.prepare(configured,{manifest:{} as never,members:new Map()})()
    expect(moldSection.collect({sources:{} as never,scanSaved:true,addMember(){}})).toEqual(configured)
    expect(()=>parseMoldSettings({...configured,tabNutDepth:-1})).toThrow()
    expect(()=>parseMoldSettings({...configured,topBottomTabCount:1.5})).toThrow()
    expect(()=>parseMoldSettings({...configured,tabBoltHoles:'yes'})).toThrow()
    useMold.setState({...DEFAULT_MOLD_SETTINGS})
  })
  it('resets a project lacking settings',()=>{
    useMold.getState().setMode('silicone-box')
    moldSection.prepare(undefined,{manifest:{} as never,members:new Map()})()
    expect(useMold.getState().mode).toBe('direct')
  })
})
