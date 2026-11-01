// SPDX-License-Identifier: AGPL-3.0-only
// Explicit parametric recipe. Unknown legacy project fields get defaults;
// invalid user values are rejected rather than rounded to an unsafe shape.
export const MOLD_MODES = ['direct', 'silicone-box'] as const
export type MoldMode = (typeof MOLD_MODES)[number]
export type MoldSource = 'scan' | 'reference'
export type SplitAxis = 'x' | 'y' | 'z'
export type BoxShape = 'rectangular' | 'cylindrical'
export type KeyStyle = 'v-seam' | 'printed-pin' | 'tapered-key' | 'metal-dowel'
export type KeyPlacement = 'auto' | 'manual'
export type OffsetQuality = 'fast' | 'balanced' | 'fine'
export type PartCount = 1 | 2 | 3 | 4

export interface MoldSettings {
  source: MoldSource
  mode: MoldMode
  clearance: number
  /** Sampling resolution for spherical mold clearance (and shell wall). */
  offsetQuality: OffsetQuality
  /** Automatically repair exact zero-area faces and very small open rims on a copy. */
  repairTarget: boolean
  /** Maximum edge-to-edge span of an open rim allowed for automatic patching. */
  repairHoleSize: number
  /** Extra side material over calculated minimum (mm). */
  sideMargin: number
  /** Extra top/bottom material over calculated minimum (mm). */
  baseThickness: number
  /** Extra silicone-box wall material over calculated minimum (mm). */
  wallThickness: number
  siliconeThickness: number
  parts: PartCount
  splitAxis: SplitAxis
  /** Fraction of target bounds where the primary split plane cuts. */
  splitPosition: number
  boxShape: BoxShape
  keys: boolean
  /** Shape of the two matching interfaces. Metal dowels use twin empty sockets. */
  keyStyle: KeyStyle
  /** Auto candidates span a seam. Manual positions are fractions 0..1. */
  keyPlacement: KeyPlacement
  keyPositions: number[]
  /** Direct molds: 2D normalized (horizontal,vertical) positions in the parting plane. */
  keyPoints: [number,number][]
  keyDiameter: number
  keyDepth: number
  keyClearance: number
  /** V-ridge full base width and protruding height, millimetres. */
  vSeamWidth: number
  vSeamHeight: number
  /** Minimum distance from the projected cavity outline to the ridge's nearer edge. */
  vSeamSpacing: number
  /** Independent V-groove fit clearance (not pin clearance). */
  vSeamClearance: number
  /** Number of clamp ears per outside edge of the seam. */
  clampTabCount: number
  clampTabWidth: number
  clampTabProjection: number
  clampTabThickness: number
  /** Additional ears on the top and bottom outside edges of a parting plane. */
  topBottomTabs: boolean
  topBottomTabCount: number
  /** Drilled through each registered pair of tabs, along the separation axis. */
  tabBoltHoles: boolean
  tabBoltDiameter: number
  /** A six-sided recess on the underside of each negative-half tab. */
  tabCapturedNuts: boolean
  tabNutAcrossFlats: number
  tabNutDepth: number
  /** Optional vertical casting channels for closed multipart direct molds. */
  pourEnabled:boolean
  pourDiameter:number
  pourFunnelDiameter:number
  pourFunnelDepth:number
  /** Normalized XY target bounds; explicit points never move automatically. */
  pourPoint:[number,number]
  ventsEnabled:boolean
  ventDiameter:number
  ventPoints:[number,number][]
  /** Silicone box *interior wall* draft, degrees, widening at the opening. */
  boxDraftDeg: number
  /** Display-only gap between printed components; not applied to STL parts. */
  previewGap: number
}

export const DEFAULT_MOLD_SETTINGS: Readonly<MoldSettings> = Object.freeze({
  source: 'scan',
  mode: 'direct',
  // Do not silently smooth/delete slender model detail on first generation.
  // A positive clearance grows the target cutter, enlarging the void.
  // Clearance is a deliberate opt-in operation.
  clearance: 0,
  offsetQuality: 'balanced',
  repairTarget: true,
  repairHoleSize: 2,
  sideMargin: 0,
  baseThickness: 0,
  wallThickness: 0,
  siliconeThickness: 12,
  parts: 2,
  splitAxis: 'x',
  splitPosition: 0.5,
  boxShape: 'rectangular',
  keys: true,
  keyStyle: 'v-seam',
  keyPlacement: 'auto',
  keyPositions: [0.22, 0.78],
  keyPoints: [[0.12,0.15],[0.88,0.15],[0.12,0.85],[0.88,0.85]] as [number,number][],
  keyDiameter: 3,
  keyDepth: 3,
  keyClearance: 0.2,
  vSeamWidth: 4.8,
  vSeamHeight: 2.4,
  vSeamSpacing: 1.5,
  vSeamClearance: 0.2,
  clampTabCount: 3,
  clampTabWidth: 16,
  clampTabProjection: 12,
  clampTabThickness: 8,
  topBottomTabs: false,
  topBottomTabCount: 2,
  tabBoltHoles: false,
  tabBoltDiameter: 4.3,
  tabCapturedNuts: false,
  tabNutAcrossFlats: 7.2,
  tabNutDepth: 3.5,
  pourEnabled:false,
  pourDiameter:3,
  pourFunnelDiameter:5,
  pourFunnelDepth:3,
  pourPoint:[0.15,0.25] as [number,number],
  ventsEnabled:false,
  ventDiameter:1.2,
  ventPoints:[[0.75,0.75]] as [number,number][],
  boxDraftDeg: 1,
  previewGap: 10,
})

export type MoldDimension = Exclude<{
  [K in keyof MoldSettings]: MoldSettings[K] extends number ? K : never
}[keyof MoldSettings], 'parts'>
export const MOLD_DIMENSIONS: readonly MoldDimension[] = [
  'clearance', 'repairHoleSize', 'sideMargin', 'baseThickness', 'wallThickness', 'siliconeThickness',
  'splitPosition', 'keyDiameter', 'keyDepth', 'keyClearance',
  'vSeamWidth', 'vSeamHeight', 'vSeamSpacing', 'vSeamClearance',
  'clampTabCount', 'clampTabWidth', 'clampTabProjection', 'clampTabThickness',
  'topBottomTabCount', 'tabBoltDiameter', 'tabNutAcrossFlats', 'tabNutDepth',
  'pourDiameter','pourFunnelDiameter','pourFunnelDepth','ventDiameter',
  'boxDraftDeg', 'previewGap',
]
export const MOLD_SETTING_KEYS: readonly (keyof MoldSettings)[] = [
  'source', 'mode', ...MOLD_DIMENSIONS, 'offsetQuality', 'repairTarget', 'parts', 'splitAxis', 'boxShape', 'keys',
  'keyStyle', 'keyPlacement', 'keyPositions', 'keyPoints',
  'topBottomTabs','tabBoltHoles','tabCapturedNuts',
  'pourEnabled','pourPoint','ventsEnabled','ventPoints',
]
export function validMoldDimension(key: MoldDimension, value: number): boolean {
  if (!Number.isFinite(value)) return false
  if (key === 'splitPosition') return value >= 0.1 && value <= 0.9
  if (key === 'clampTabCount' || key==='topBottomTabCount') return Number.isInteger(value) && value>=0 && value<=12
  if (key === 'boxDraftDeg') return value >= 0 && value <= 12
  if (key === 'previewGap' || key === 'clearance' || key === 'sideMargin' || key === 'baseThickness' ||
      key === 'wallThickness' || key === 'keyClearance' || key === 'vSeamClearance' || key === 'vSeamSpacing') {
    return value >= 0 && value <= 100_000
  }
  return value > 0 && value <= 100_000
}
export function parseMoldSettings(value: unknown): MoldSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed mold-making settings.')
  const raw = value as Record<string, unknown>
  const parsed = { ...DEFAULT_MOLD_SETTINGS, ...raw } as MoldSettings
  if (!(['fast','balanced','fine'] as const).includes(parsed.offsetQuality)) throw new Error('Invalid spherical offset quality.')
  if (parsed.source !== 'scan' && parsed.source !== 'reference') throw new Error('Malformed mold target source.')
  // Existing projects saved with the removed shell mode still load and
  // default to direct tooling. Geometry and clearance are not reused.
  if ((raw as Record<string,unknown>).mode === 'thin-negative-shell') parsed.mode='direct'
  if (!MOLD_MODES.includes(parsed.mode)) throw new Error('Malformed mold mode.')
  if (parsed.parts !== 1 && parsed.parts !== 2 && parsed.parts !== 3 && parsed.parts !== 4) throw new Error('Parts must be 1, 2, 3 or 4.')
  if (!(['x','y','z'] as const).includes(parsed.splitAxis)) throw new Error('Split axis must be X, Y, or Z.')
  if (parsed.boxShape !== 'rectangular' && parsed.boxShape !== 'cylindrical') throw new Error('Invalid box shape.')
  if (typeof parsed.repairTarget !== 'boolean') throw new Error('Invalid mesh repair setting.')
  if (typeof parsed.keys !== 'boolean') throw new Error('Invalid alignment keys setting.')
  if(typeof parsed.pourEnabled!=='boolean'||typeof parsed.ventsEnabled!=='boolean')
    throw new Error('Invalid casting channel enable setting.')
  const validPoint=(point:unknown):point is [number,number]=>Array.isArray(point)&&
    point.length===2&&point.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0.01&&x<=0.99)
  if(!validPoint(parsed.pourPoint))throw new Error('Pour XY position must contain two 1–99% fractions.')
  if(!Array.isArray(parsed.ventPoints)||parsed.ventPoints.length>8||
    parsed.ventPoints.some(p=>!validPoint(p)))
    throw new Error('Vent XY positions must be 1–99% fractions (at most eight).')
  if(parsed.ventsEnabled&&parsed.ventPoints.length===0)
    throw new Error('Add at least one vent position or disable air vents.')
  if(parsed.pourEnabled&&parsed.pourFunnelDiameter<parsed.pourDiameter)
    throw new Error('Pour funnel diameter must be at least the sprue diameter.')
  if((parsed.pourEnabled||parsed.ventsEnabled)&&
    (parsed.mode!=='direct'||parsed.parts===1))
    throw new Error('Casting channels currently require a multipart direct-print mold. Disable them for silicone boxes and one-piece impressions.')
  if (typeof parsed.topBottomTabs !== 'boolean' || typeof parsed.tabBoltHoles !== 'boolean' || typeof parsed.tabCapturedNuts !== 'boolean') throw new Error('Invalid clamp-fastener options.')
  if (!(['v-seam','printed-pin', 'tapered-key', 'metal-dowel'] as const).includes(parsed.keyStyle)) throw new Error('Invalid registration feature shape.')
  if (parsed.keyPlacement !== 'auto' && parsed.keyPlacement !== 'manual') throw new Error('Invalid registration placement mode.')
  if (!Array.isArray(parsed.keyPositions) || parsed.keyPositions.length>12 ||
      parsed.keyPositions.some(v => typeof v!=='number' || !Number.isFinite(v) || v<0.01 || v>0.99)) {
    throw new Error('Alignment key positions must be 1–99% along the seam, up to twelve entries.')
  }
  if (new Set(parsed.keyPositions).size !== parsed.keyPositions.length) throw new Error('Alignment positions must be distinct.')
  if(!Array.isArray(parsed.keyPoints)||parsed.keyPoints.length>16||parsed.keyPoints.some(
    point=>!Array.isArray(point)||point.length!==2||point.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0.01||v>0.99)
  ))throw new Error('Alignment points must be pairs of fractions between 1% and 99%.')
  if(new Set(parsed.keyPoints.map(p=>p.join(','))).size!==parsed.keyPoints.length)
    throw new Error('Alignment points must have distinct coordinates.')
  if(parsed.keys&&parsed.parts!==3&&(parsed.keyStyle!=='v-seam'||parsed.parts===4)&&parsed.keyPlacement==='manual'&&parsed.mode==='direct'&&parsed.keyPoints.length===0)
    throw new Error('Add manual alignment points or disable registration.')
  if(parsed.keys&&parsed.parts!==3&&(parsed.keyStyle!=='v-seam'||parsed.parts===4)&&parsed.keyPlacement==='manual'&&parsed.mode==='silicone-box'&&parsed.keyPositions.length===0)
    throw new Error('Add manual registration heights or disable registration.')
  for (const key of MOLD_DIMENSIONS) {
    if (typeof parsed[key] !== 'number' || !validMoldDimension(key, parsed[key])) {
      throw new Error(`Invalid mold setting: ${key}`)
    }
  }
  // No future/unknown fields leak into the store.
  return Object.fromEntries(MOLD_SETTING_KEYS.map(key => [key, key==='keyPositions'?[...parsed.keyPositions]:key==='keyPoints'?parsed.keyPoints.map(p=>[...p]):
    key==='pourPoint'?[...parsed.pourPoint]:
    key==='ventPoints'?parsed.ventPoints.map(p=>[...p]):parsed[key]])) as unknown as MoldSettings
}

export const MOLD_MODE_LABELS: Readonly<Record<MoldMode,string>> = {
  direct: 'Direct-print mold',
  'silicone-box': 'Silicone mold box',
}
