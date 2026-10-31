// SPDX-License-Identifier: AGPL-3.0-only
// Explicit parametric recipe. Unknown legacy project fields get defaults;
// invalid user values are rejected rather than rounded to an unsafe shape.
export const MOLD_MODES = ['direct', 'silicone-box', 'thin-negative-shell'] as const
export type MoldMode = (typeof MOLD_MODES)[number]
export type MoldSource = 'scan' | 'reference'
export type SplitAxis = 'x' | 'y' | 'z'
export type BoxShape = 'rectangular' | 'cylindrical'
export type PartCount = 1 | 2 | 4

export interface MoldSettings {
  source: MoldSource
  mode: MoldMode
  clearance: number
  sideMargin: number
  baseThickness: number
  wallThickness: number
  siliconeThickness: number
  parts: PartCount
  splitAxis: SplitAxis
  /** Fraction of target bounds where the primary split plane cuts. */
  splitPosition: number
  boxShape: BoxShape
  keys: boolean
  keyDiameter: number
  keyDepth: number
  keyClearance: number
  /** Silicone box *interior wall* draft, degrees, widening at the opening. */
  boxDraftDeg: number
  /** Display-only gap between printed components; not applied to STL parts. */
  previewGap: number
}

export const DEFAULT_MOLD_SETTINGS: Readonly<MoldSettings> = Object.freeze({
  source: 'scan',
  mode: 'direct',
  // Do not silently smooth/delete slender model detail on first generation.
  // Clearance is a deliberate opt-in operation.
  clearance: 0,
  sideMargin: 8,
  baseThickness: 4,
  wallThickness: 3,
  siliconeThickness: 12,
  parts: 2,
  splitAxis: 'x',
  splitPosition: 0.5,
  boxShape: 'rectangular',
  keys: true,
  keyDiameter: 3,
  keyDepth: 3,
  keyClearance: 0.2,
  boxDraftDeg: 1,
  previewGap: 3,
})

export type MoldDimension = Exclude<{
  [K in keyof MoldSettings]: MoldSettings[K] extends number ? K : never
}[keyof MoldSettings], 'parts'>
export const MOLD_DIMENSIONS: readonly MoldDimension[] = [
  'clearance', 'sideMargin', 'baseThickness', 'wallThickness', 'siliconeThickness',
  'splitPosition', 'keyDiameter', 'keyDepth', 'keyClearance', 'boxDraftDeg', 'previewGap',
]
export const MOLD_SETTING_KEYS: readonly (keyof MoldSettings)[] = [
  'source', 'mode', ...MOLD_DIMENSIONS, 'parts', 'splitAxis', 'boxShape', 'keys',
]
export function validMoldDimension(key: MoldDimension, value: number): boolean {
  if (!Number.isFinite(value)) return false
  if (key === 'splitPosition') return value >= 0.1 && value <= 0.9
  if (key === 'boxDraftDeg') return value >= 0 && value <= 12
  if (key === 'previewGap' || key === 'clearance' || key === 'sideMargin' || key === 'keyClearance') {
    return value >= 0 && value <= 100_000
  }
  return value > 0 && value <= 100_000
}
export function parseMoldSettings(value: unknown): MoldSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed mold-making settings.')
  const raw = value as Record<string, unknown>
  const parsed = { ...DEFAULT_MOLD_SETTINGS, ...raw } as MoldSettings
  if (parsed.source !== 'scan' && parsed.source !== 'reference') throw new Error('Malformed mold target source.')
  if (!MOLD_MODES.includes(parsed.mode)) throw new Error('Malformed mold mode.')
  if (parsed.parts !== 1 && parsed.parts !== 2 && parsed.parts !== 4) throw new Error('Parts must be 1, 2 or 4.')
  if (!(['x','y','z'] as const).includes(parsed.splitAxis)) throw new Error('Split axis must be X, Y, or Z.')
  if (parsed.boxShape !== 'rectangular' && parsed.boxShape !== 'cylindrical') throw new Error('Invalid box shape.')
  if (typeof parsed.keys !== 'boolean') throw new Error('Invalid alignment keys setting.')
  for (const key of MOLD_DIMENSIONS) {
    if (typeof parsed[key] !== 'number' || !validMoldDimension(key, parsed[key])) {
      throw new Error(`Invalid mold setting: ${key}`)
    }
  }
  // No future/unknown fields leak into the store.
  return Object.fromEntries(MOLD_SETTING_KEYS.map(key => [key, parsed[key]])) as unknown as MoldSettings
}

export const MOLD_MODE_LABELS: Readonly<Record<MoldMode,string>> = {
  direct: 'Direct-print mold',
  'silicone-box': 'Silicone mold box',
  'thin-negative-shell': 'Thin negative shell',
}
