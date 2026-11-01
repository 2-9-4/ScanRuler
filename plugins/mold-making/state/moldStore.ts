// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import {
  DEFAULT_MOLD_SETTINGS, MOLD_SETTING_KEYS, validMoldDimension,
  type BoxShape, type KeyStyle, type KeyPlacement, type MoldDimension, type MoldMode, type MoldSettings, type OffsetQuality,
  type MoldSource, type PartCount, type SplitAxis,
} from '../core/settings'

interface MoldState extends MoldSettings {
  setSource(source: MoldSource): void
  setRepairTarget(repairTarget: boolean): void
  setOffsetQuality(offsetQuality: OffsetQuality): void
  setMode(mode: MoldMode): void
  setParts(parts: PartCount): void
  setSplitAxis(splitAxis: SplitAxis): void
  setBoxShape(boxShape: BoxShape): void
  setKeys(keys: boolean): void
  setKeyStyle(keyStyle: KeyStyle): void
  setTopBottomTabs(value:boolean):void
  setTabBoltHoles(value:boolean):void
  setTabCapturedNuts(value:boolean):void
  setKeyPlacement(keyPlacement: KeyPlacement): void
  setKeyPositions(keyPositions: number[]): void
  setKeyPoints(keyPoints: [number,number][]): void
  setDimension(key: MoldDimension, value: number): void
}
export const useMold = create<MoldState>()((set)=>({
  ...DEFAULT_MOLD_SETTINGS,
  setSource: (source) => set({source}),
  setRepairTarget: (repairTarget) => set({repairTarget}),
  setOffsetQuality: (offsetQuality) => set({offsetQuality}),
  setMode: (mode) => set({mode}),
  setParts: (parts) => set({parts}),
  setSplitAxis: (splitAxis) => set({splitAxis}),
  setBoxShape: (boxShape) => set({boxShape}),
  setKeys: (keys) => set({keys}),
  setKeyStyle: (keyStyle) => set({keyStyle}),
  setTopBottomTabs:(topBottomTabs)=>set({topBottomTabs}),
  setTabBoltHoles:(tabBoltHoles)=>set({tabBoltHoles,tabCapturedNuts:tabBoltHoles?useMold.getState().tabCapturedNuts:false}),
  setTabCapturedNuts:(tabCapturedNuts)=>set({tabCapturedNuts}),
  setKeyPlacement: (keyPlacement) => set({keyPlacement}),
  setKeyPositions: (keyPositions) => {
    if (keyPositions.length>12 || keyPositions.some(x=>!Number.isFinite(x)||x<0.01||x>0.99) ||
      new Set(keyPositions).size!==keyPositions.length) return
    set({keyPositions:[...keyPositions]})
  },
  setKeyPoints: (keyPoints) => {
    if(keyPoints.length>16||keyPoints.some(point=>point.length!==2||
       point.some(v=>!Number.isFinite(v)||v<0.01||v>0.99))||
       new Set(keyPoints.map(point=>point.join(','))).size!==keyPoints.length)return
    set({keyPoints:keyPoints.map(p=>[...p] as [number,number])})
  },
  setDimension: (key,value) => {
    if (!validMoldDimension(key,value)) return
    set({[key]:value} as Pick<MoldState,MoldDimension>)
  },
}))
export function moldSettings(): MoldSettings {
  const s = useMold.getState()
  return Object.fromEntries(MOLD_SETTING_KEYS.map(key => [key,key==='keyPositions'?[...s.keyPositions]:key==='keyPoints'?s.keyPoints.map(p=>[...p]):s[key]])) as unknown as MoldSettings
}
