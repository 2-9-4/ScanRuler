// SPDX-License-Identifier: AGPL-3.0-only

import { lengthDecimals, toDisplay, type DisplayUnits } from '../core/units'

/** A signed length the way every deviation is written: an explicit sign
 *  either way — the sign is the point of the number — and a real minus
 *  rather than a hyphen, so the figure reads as a measurement. Held in
 *  millimetres, written bare in `units` (three decimals in millimetres, four
 *  in inches); the unit word is the caller's. */
export function formatSigned(v: number, units: DisplayUnits = 'mm'): string {
  const shown = toDisplay(v, units)
  return `${shown >= 0 ? '+' : '−'}${Math.abs(shown).toFixed(lengthDecimals(3, units))}`
}
