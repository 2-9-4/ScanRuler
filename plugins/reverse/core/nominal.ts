// SPDX-License-Identifier: AGPL-3.0-only
// The round number a measured value was probably designed at. A part is
// drawn at 6 mm and scanned at 5.98; a fillet is R2, not R1.97; a face is
// turned 45°, not 44.8°. The sketch and the feature editors offer the
// rounding beside every measured figure — one click to take it — and this
// says what that rounding is, and when the value already is one so no chip
// is shown. The steps are the designer's, not the metrologist's: half
// millimetres under 10 mm where small features are drawn to the half,
// whole millimetres above, radii to the half whatever their size, angles to
// five degrees — but a draft to the half degree (0.5, 1, 1.5, 2, 3°).

import { type DisplayUnits, fmtLen } from '../../../src/core/units'

export type NominalKind = 'length' | 'radius' | 'angle' | 'draft'

/** How close a value has to be to its rounding to count as already nominal,
 *  in the value's own unit — a hair under the tolerance of a good scan, so
 *  a value that was typed is not offered to itself. */
const NOMINAL_TOLERANCE = 0.02

/** The step a value of this kind rounds to. */
export function nominalStep(value: number, kind: NominalKind): number {
  if (kind === 'angle') return 5
  if (kind === 'radius' || kind === 'draft') return 0.5
  return Math.abs(value) < 10 ? 0.5 : 1
}

/**
 * The nominal value nearest to `value`, or null when the value already is
 * nominal (within NOMINAL_TOLERANCE) or is not a finite number. The sign is
 * kept: an extrude reaching to −9.98 is offered −10. Zero is nominal.
 */
export function nominalOf(value: number, kind: NominalKind): number | null {
  if (!Number.isFinite(value)) return null
  const step = nominalStep(value, kind)
  const rounded = Math.round(value / step) * step
  // Away from a step boundary a length under 10 mm rounds to the half, but
  // 9.8 mm rounds up to 10 — a whole — and that is the number offered.
  const tidy = Math.round(rounded * 1000) / 1000
  // A hair of slack on the tolerance itself: 5.98 is 0.02 off 6 and is
  // offered it, whatever floating point makes of the subtraction.
  if (Math.abs(tidy - value) < NOMINAL_TOLERANCE - 1e-9) return null
  return tidy === 0 ? 0 : tidy
}

/** The chip's text for a nominal value: enough decimals to show a half.
 *  A length's nominal is a millimetre figure, so in inches it reads to the
 *  ten-thousandth that tells 6 mm from 6.5 mm. */
export function nominalText(value: number, kind: NominalKind, units: DisplayUnits = 'mm'): string {
  if (kind === 'angle') return `${value.toFixed(0)}°`
  if (kind === 'draft') return `${value.toFixed(value % 1 === 0 ? 0 : 1)}°`
  return fmtLen(value, units, units === 'mm' ? (value % 1 === 0 ? 0 : 1) : 3)
}
