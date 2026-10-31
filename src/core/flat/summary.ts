// SPDX-License-Identifier: AGPL-3.0-only
// How a flat fit reads as text — the one-line headline for the list row and
// the viewport pin, and the residual detail underneath. Mirrors
// core/summary.ts for the 3D elements; `unit` is 'mm', or 'px' while nothing
// has set a scale, and saying which is the whole reason it is a parameter.
// A sheet in millimetres is written in the display units; one in pixels
// stays in pixels whatever they are.

import { fmtLen, unitWord, type DisplayUnits } from '../units'
import type { FlatFit } from './types'

/** What a sheet's lengths are written in: the display units on a sheet in
 *  millimetres, pixels on one nothing has set a scale for. */
export type SheetUnits = DisplayUnits | 'px'

/** The sheet's document unit ('mm' or 'px') and the display units, as what
 *  its lengths are written in. */
export function sheetUnits(unit: string, units: DisplayUnits): SheetUnits {
  return unit === 'px' ? 'px' : units
}

/** A sheet length as text: `mmDecimals` asked in millimetres, and taken as
 *  they are in pixels. */
export function sheetLength(v: number, su: SheetUnits, mmDecimals = 3, opts?: { bare?: boolean; signed?: boolean }): string {
  if (su !== 'px') return fmtLen(v, su, mmDecimals, opts)
  const text = v.toFixed(mmDecimals)
  const signed = opts?.signed && v > 0 ? `+${text}` : text
  return opts?.bare ? signed : `${signed} px`
}

/** The unit word a sheet length is written with. */
export function sheetWord(su: SheetUnits): string {
  return su === 'px' ? 'px' : unitWord(su)
}

/** The headline of a fit, in `units` on a sheet in millimetres. */
export function formatFlatPrimary(fit: FlatFit, unit: string, units: DisplayUnits = 'mm'): string {
  const su = sheetUnits(unit, units)
  const len = (v: number): string => sheetLength(v, su)
  switch (fit.kind) {
    case 'point':
      return `X ${sheetLength(fit.at[0], su, 3, { bare: true })} · Y ${len(fit.at[1])}`
    case 'line': {
      const angle = (Math.atan2(fit.dir[1], fit.dir[0]) * 180) / Math.PI
      return `L ${len(fit.length)} · ${angle.toFixed(2)}°`
    }
    case 'circle':
      return `Ø ${len(2 * fit.radius)}`
    case 'arc':
      return `R ${len(fit.radius)} · ${((fit.sweep * 180) / Math.PI).toFixed(1)}°`
    case 'spline':
      return `L ${len(fit.length)}${fit.closed ? ' · closed' : ''}`
  }
}

/** σ, form error and point count — empty for geometry with no residuals. A
 *  spline runs exactly through its points and has none; what it has to say
 *  is how many points, and how many tangents were set by hand. */
export function formatFlatDetail(fit: FlatFit, unit: string, units: DisplayUnits = 'mm'): string {
  if (fit.kind === 'spline') {
    const set = fit.fixed.filter(Boolean).length
    const parts = [`${fit.points.length} fit points`]
    if (set > 0) parts.push(`${set} tangent${set === 1 ? '' : 's'} set`)
    return parts.join(' · ')
  }
  if (fit.usedPoints === 0) return ''
  const su = sheetUnits(unit, units)
  const parts = [`σ ${sheetLength(fit.sigma, su, 4, { bare: true })}`]
  if (fit.formError !== undefined) parts.push(`form ${sheetLength(fit.formError, su, 4)}`)
  parts.push(`${fit.usedPoints} pts`)
  return parts.join(' · ')
}
