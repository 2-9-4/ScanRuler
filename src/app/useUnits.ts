// SPDX-License-Identifier: AGPL-3.0-only
// The display units, bound to the preference, for React code. Core functions
// take the units as an argument; a component reads them here and gets the
// formatters already bound, so it writes len.fmt(fit.radius * 2) instead of
// threading the units through every call.

import { useMemo } from 'react'
import { usePrefs } from '../state/prefsStore'
import {
  fmtArea,
  fmtLen,
  fmtVol,
  fromDisplay,
  lengthDecimals,
  lengthStep,
  presetsMm,
  toDisplay,
  unitWord,
  type DisplayUnits,
  type FmtOptions,
  type LengthPresets,
} from '../core/units'

/** What lengths are shown and typed in right now. */
export function useUnits(): DisplayUnits {
  return usePrefs((s) => s.units)
}

export interface BoundLength {
  units: DisplayUnits
  /** A length held in millimetres, as text with its unit. */
  fmt: (mm: number, mmDecimals?: number, opts?: FmtOptions) => string
  area: (mm2: number, mmDecimals?: number, opts?: FmtOptions) => string
  vol: (mm3: number, mmDecimals?: number, opts?: FmtOptions) => string
  toDisplay: (mm: number) => number
  fromDisplay: (v: number) => number
  decimals: (mmDecimals: number) => number
  step: (mmStep: number) => number
  presets: (presets: LengthPresets) => number[]
  word: (power?: 1 | 2 | 3) => string
}

/** The units module bound to the units shown. */
export function useLength(): BoundLength {
  const units = useUnits()
  return useMemo(() => boundLength(units), [units])
}

/** The same, outside React — for a callback that reads the preference when
 *  it runs. */
export function boundLength(units: DisplayUnits): BoundLength {
  return {
    units,
    fmt: (mm, d, o) => fmtLen(mm, units, d, o),
    area: (mm2, d, o) => fmtArea(mm2, units, d, o),
    vol: (mm3, d, o) => fmtVol(mm3, units, d, o),
    toDisplay: (mm) => toDisplay(mm, units),
    fromDisplay: (v) => fromDisplay(v, units),
    decimals: (d) => lengthDecimals(d, units),
    step: (s) => lengthStep(s, units),
    presets: (p) => presetsMm(p, units),
    word: (p) => unitWord(units, p),
  }
}
