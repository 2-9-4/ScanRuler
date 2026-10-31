// SPDX-License-Identifier: AGPL-3.0-only
// The units lengths are shown and typed in. Everything the instrument holds —
// stores, projects, the worker, every reading an agent is given — is in
// millimetres and stays so; this is only the last step to the screen and the
// first from the keyboard. Converting what is held would drift with every
// rounding and break every saved project, so nothing here is ever written
// back except through fromDisplay, on a number someone typed.
//
// Inches are decimal: no fractions, feet or mils. A site that asks for n
// decimals asks in millimetres; in inches it gets one more, and never fewer
// than three, so 0.001 mm reads 0.0001 in and 0.1 mm reads 0.004 in.

export type DisplayUnits = 'mm' | 'in'

export const DISPLAY_UNITS: { id: DisplayUnits; label: string }[] = [
  { id: 'mm', label: 'Millimetres' },
  { id: 'in', label: 'Inches' },
]

export const MM_PER_INCH = 25.4

/** A stored or received value as display units, or null when it is not one. */
export function displayUnitsOf(value: unknown): DisplayUnits | null {
  return value === 'mm' || value === 'in' ? value : null
}

/** A length held in millimetres, in the units shown. */
export function toDisplay(mm: number, units: DisplayUnits): number {
  return units === 'in' ? mm / MM_PER_INCH : mm
}

/** A length typed in the units shown, in millimetres to hold. */
export function fromDisplay(v: number, units: DisplayUnits): number {
  return units === 'in' ? v * MM_PER_INCH : v
}

/** The decimals a site asked for in millimetres, as shown in `units`. */
export function lengthDecimals(mmDecimals: number, units: DisplayUnits): number {
  return units === 'in' ? Math.max(3, mmDecimals + 1) : mmDecimals
}

/** The unit's own word, to a power for areas and volumes. */
export function unitWord(units: DisplayUnits, power: 1 | 2 | 3 = 1): string {
  return units + (power === 2 ? '²' : power === 3 ? '³' : '')
}

export interface FmtOptions {
  /** Leave the unit word off, for a column that carries it in its header. */
  bare?: boolean
  /** A plus on a positive figure, the way a deviation is read. */
  signed?: boolean
}

/** Fixed decimals without the "-0.000" a tiny negative rounds to. */
function fixed(v: number, decimals: number, signed: boolean): string {
  const text = v.toFixed(decimals)
  if (Number(text) === 0) return (0).toFixed(decimals)
  return signed && v > 0 ? `+${text}` : text
}

function fmt(value: number, units: DisplayUnits, mmDecimals: number, power: 1 | 2 | 3, opts?: FmtOptions): string {
  const text = fixed(value / (units === 'in' ? MM_PER_INCH ** power : 1), lengthDecimals(mmDecimals, units), opts?.signed ?? false)
  return opts?.bare ? text : `${text} ${unitWord(units, power)}`
}

/** "12.700 mm" / "0.5000 in". */
export function fmtLen(mm: number, units: DisplayUnits, mmDecimals = 3, opts?: FmtOptions): string {
  return fmt(mm, units, mmDecimals, 1, opts)
}

/** "645.2 mm²" / "1.000 in²". */
export function fmtArea(mm2: number, units: DisplayUnits, mmDecimals = 1, opts?: FmtOptions): string {
  return fmt(mm2, units, mmDecimals, 2, opts)
}

/** "16387.1 mm³" / "1.000 in³". */
export function fmtVol(mm3: number, units: DisplayUnits, mmDecimals = 1, opts?: FmtOptions): string {
  return fmt(mm3, units, mmDecimals, 3, opts)
}

/** The steps in use in millimetres, each with a round inch neighbour — not
 *  the converted figure, which no one would type. */
const INCH_STEPS: [mm: number, inch: number][] = [
  [0.0001, 0.00001],
  [0.001, 0.0001],
  [0.01, 0.001],
  [0.05, 0.005],
  [0.1, 0.005],
  [0.5, 0.02],
  [1, 0.05],
  [5, 0.25],
  [10, 0.5],
]

/** A step or preset for a length field in the units shown: a round figure in
 *  that unit. One not in the table becomes its inch figure to one
 *  significant digit. */
export function lengthStep(mmStep: number, units: DisplayUnits): number {
  if (units === 'mm' || !(mmStep > 0) || !Number.isFinite(mmStep)) return mmStep
  const known = INCH_STEPS.find(([mm]) => mm === mmStep)
  if (known) return known[1]
  return Number((mmStep / MM_PER_INCH).toPrecision(1))
}

/** A length as the text of an input in `units`: rounded far enough below
 *  anything shown that it reads back as typed, with no float noise
 *  ("0.49999999999999994"), and no trailing zeros. */
export function lengthInputText(mm: number, units: DisplayUnits): string {
  if (units === 'mm') return String(mm)
  return String(Number(toDisplay(mm, units).toFixed(6)))
}

/** A preset list for a length: one hand-picked list per unit, never one
 *  computed from the other. */
export interface LengthPresets {
  mm: number[]
  in: number[]
}

/** The presets for `units`, as millimetres to hold. */
export function presetsMm(presets: LengthPresets, units: DisplayUnits): number[] {
  return units === 'in' ? presets.in.map((v) => v * MM_PER_INCH) : presets.mm
}
