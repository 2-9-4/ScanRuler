// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import {
  DEFAULT_MOLD_SETTINGS, validMoldDimension,
  type MoldDimension, type MoldMode, type MoldSettings, type MoldSource,
} from '../core/settings'

interface MoldState extends MoldSettings {
  setSource(source: MoldSource): void
  setMode(mode: MoldMode): void
  setDimension(key: MoldDimension, value: number): void
}

export const useMold = create<MoldState>()((set) => ({
  ...DEFAULT_MOLD_SETTINGS,
  setSource: (source) => set({ source }),
  setMode: (mode) => set({ mode }),
  setDimension: (key, value) => {
    if (!validMoldDimension(key, value)) return
    set({ [key]: value } as Pick<MoldState, MoldDimension>)
  },
}))

export function moldSettings(): MoldSettings {
  const s = useMold.getState()
  return {
    source: s.source,
    mode: s.mode,
    clearance: s.clearance,
    sideMargin: s.sideMargin,
    baseThickness: s.baseThickness,
    wallThickness: s.wallThickness,
    siliconeThickness: s.siliconeThickness,
  }
}
