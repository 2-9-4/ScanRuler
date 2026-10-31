// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import {
  DEFAULT_MOLD_SETTINGS, MOLD_SETTING_KEYS, validMoldDimension,
  type BoxShape, type KeyStyle, type KeyPlacement, type MoldDimension, type MoldMode, type MoldSettings,
  type MoldSource, type PartCount, type SplitAxis,
} from '../core/settings'

interface MoldState extends MoldSettings {
  setSource(source: MoldSource): void
  setMode(mode: MoldMode): void
  setParts(parts: PartCount): void
  setSplitAxis(splitAxis: SplitAxis): void
  setBoxShape(boxShape: BoxShape): void
  setKeys(keys: boolean): void
  setKeyStyle(keyStyle: KeyStyle): void
  setKeyPlacement(keyPlacement: KeyPlacement): void
  setKeyPositions(keyPositions: number[]): void
  setDimension(key: MoldDimension, value: number): void
}
export const useMold = create<MoldState>()((set)=>({
  ...DEFAULT_MOLD_SETTINGS,
  setSource: (source) => set({source}),
  setMode: (mode) => set({mode}),
  setParts: (parts) => set({parts}),
  setSplitAxis: (splitAxis) => set({splitAxis}),
  setBoxShape: (boxShape) => set({boxShape}),
  setKeys: (keys) => set({keys}),
  setKeyStyle: (keyStyle) => set({keyStyle}),
  setKeyPlacement: (keyPlacement) => set({keyPlacement}),
  setKeyPositions: (keyPositions) => {
    if (keyPositions.length>12 || keyPositions.some(x=>!Number.isFinite(x)||x<0.01||x>0.99) ||
      new Set(keyPositions).size!==keyPositions.length) return
    set({keyPositions:[...keyPositions]})
  },
  setDimension: (key,value) => {
    if (!validMoldDimension(key,value)) return
    set({[key]:value} as Pick<MoldState,MoldDimension>)
  },
}))
export function moldSettings(): MoldSettings {
  const s = useMold.getState()
  return Object.fromEntries(MOLD_SETTING_KEYS.map(key => [key,key==='keyPositions'?[...s.keyPositions]:s[key]])) as unknown as MoldSettings
}
