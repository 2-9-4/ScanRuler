// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import {
  DEFAULT_MOLD_SETTINGS, MOLD_SETTING_KEYS, validMoldDimension,
  type BoxShape, type MoldDimension, type MoldMode, type MoldSettings,
  type MoldSource, type PartCount, type SplitAxis,
} from '../core/settings'

interface MoldState extends MoldSettings {
  setSource(source: MoldSource): void
  setMode(mode: MoldMode): void
  setParts(parts: PartCount): void
  setSplitAxis(splitAxis: SplitAxis): void
  setBoxShape(boxShape: BoxShape): void
  setKeys(keys: boolean): void
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
  setDimension: (key,value) => {
    if (!validMoldDimension(key,value)) return
    set({[key]:value} as Pick<MoldState,MoldDimension>)
  },
}))
export function moldSettings(): MoldSettings {
  const s = useMold.getState()
  return Object.fromEntries(MOLD_SETTING_KEYS.map(key => [key,s[key]])) as unknown as MoldSettings
}
