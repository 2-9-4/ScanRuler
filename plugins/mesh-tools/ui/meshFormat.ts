// SPDX-License-Identifier: AGPL-3.0-only
// How the Mesh Tools panel writes its numbers: lengths in the display units,
// counts, and a share of the scan.

import { lengthInputText, unitWord, type DisplayUnits } from '../../../src/core/units'
import { HELD_SHARE } from '../core/reduce'

/** A setting's length as its field shows it — "5 mm", "0.2 in" — with no
 *  decimals added, so a sentence repeats the figure typed. Held in mm. */
export const typedLen = (mm: number, units: DisplayUnits = 'mm') => `${lengthInputText(mm, units)} ${unitWord(units)}`

export const count = (n: number) => n.toLocaleString('en-US')

export const SHARE = `${(HELD_SHARE * 100).toFixed(1)} %`
