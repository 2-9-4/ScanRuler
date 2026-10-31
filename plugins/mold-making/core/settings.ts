// SPDX-License-Identifier: AGPL-3.0-only
// Persisted inputs only; generated meshes and file bytes never live in this store.
export const MOLD_MODES = ['direct', 'silicone-box', 'thin-negative-shell'] as const
export type MoldMode = (typeof MOLD_MODES)[number]
export type MoldSource = 'scan' | 'reference'

export interface MoldSettings {
  source: MoldSource
  mode: MoldMode
  clearance: number
  sideMargin: number
  baseThickness: number
  wallThickness: number
  siliconeThickness: number
}

export const DEFAULT_MOLD_SETTINGS: Readonly<MoldSettings> = Object.freeze({
  source: 'scan',
  mode: 'direct',
  clearance: 0.2,
  sideMargin: 8,
  baseThickness: 4,
  wallThickness: 3,
  siliconeThickness: 12,
})

export type MoldDimension = Exclude<keyof MoldSettings, 'source' | 'mode'>
export const MOLD_DIMENSIONS: readonly MoldDimension[] = [
  'clearance', 'sideMargin', 'baseThickness', 'wallThickness', 'siliconeThickness',
]

/** Invalid inputs are refused rather than rounded, clamped or silently accepted. */
export function validMoldDimension(key: MoldDimension, value: number): boolean {
  return Number.isFinite(value) && value <= 100_000 &&
    (key === 'clearance' || key === 'sideMargin' ? value >= 0 : value > 0)
}

/** Validate project-file data before replacing any live project state. */
export function parseMoldSettings(value: unknown): MoldSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Malformed mold-making settings.')
  }
  const raw = value as Record<string, unknown>
  if (raw.source !== 'scan' && raw.source !== 'reference') {
    throw new Error('Malformed mold-making target source.')
  }
  if (!MOLD_MODES.some((mode) => mode === raw.mode)) {
    throw new Error('Malformed mold-making production mode.')
  }
  for (const key of MOLD_DIMENSIONS) {
    if (typeof raw[key] !== 'number' || !validMoldDimension(key, raw[key])) {
      throw new Error(`Malformed mold-making ${key}.`)
    }
  }
  // A frozen schema: ignore future unknown keys, do not copy them into the store.
  return {
    source: raw.source,
    mode: raw.mode as MoldMode,
    clearance: raw.clearance as number,
    sideMargin: raw.sideMargin as number,
    baseThickness: raw.baseThickness as number,
    wallThickness: raw.wallThickness as number,
    siliconeThickness: raw.siliconeThickness as number,
  }
}

export const MOLD_MODE_LABELS: Readonly<Record<MoldMode, string>> = {
  direct: 'Direct-print mold',
  'silicone-box': 'Silicone mold box',
  'thin-negative-shell': 'Thin negative shell',
}
