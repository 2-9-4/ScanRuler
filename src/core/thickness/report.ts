// SPDX-License-Identifier: AGPL-3.0-only
// Wall thickness as plain text for the clipboard. The settings go with the
// numbers: a thinnest wall pasted into a build log means little months later
// without the method, the depth searched and the facing limit it was found
// under.

import type { ThicknessMethod, ThicknessStats } from './thickness'
import { reportLengths, unitsHeading } from '../deviation/report'
import { lengthInputText, type DisplayUnits } from '../units'

/** How the measurement was taken and how it is being read — the settings a
 *  report has to carry, or the numbers in it mean nothing six months later. */
export interface ThicknessSettings {
  method: ThicknessMethod
  maxThickness: number
  coneRays: number
  coneAngleDeg: number
  normalDeviationDeg: number | null
  low: number
  high: number
}

/** Plain-text summary of a wall thickness measurement, for the clipboard:
 *  what was measured, how, and the numbers — enough to paste into a build log
 *  and still know months later what it refers to. */
export function buildThicknessReport(
  scanName: string,
  stats: ThicknessStats,
  settings: ThicknessSettings,
  /** What the lengths are written in — millimetres for the agent. */
  units: DisplayUnits = 'mm',
): string {
  const { len: mm, setting } = reportLengths(units)
  const percent = stats.measured ? (stats.belowLimit / stats.measured) * 100 : 0
  const method =
    settings.method === 'sphere'
      ? 'sphere grown at the midpoint of the ray along the inward normal, measured across'
      : settings.coneRays > 0
        ? `shortest of ${settings.coneRays} rays through a ${settings.coneAngleDeg}° cone about the inward normal`
        : 'ray along the inward surface normal'

  return [
    'ScanRuler — wall thickness',
    ...unitsHeading(units),
    `Part: ${scanName}`,
    '',
    `Method: ${method}`,
    `  max. thickness searched  ${setting(settings.maxThickness)}`,
    `  far surface must face back within  ${
      settings.normalDeviationDeg === null ? 'not checked' : `${settings.normalDeviationDeg}°`
    }`,
    '',
    'Wall thickness at each scan point:',
    `  min             ${mm(stats.min)}`,
    `  max             ${mm(stats.max)}`,
    `  mean            ${mm(stats.mean)}`,
    `  sigma           ${mm(stats.sigma)}`,
    `  under ${setting(stats.limit)}      ${percent.toFixed(1)} %  (${stats.belowLimit} points)`,
    `  measured        ${stats.measured} of ${stats.total} scan points`,
    '',
    `  colour scale         ${lengthInputText(settings.low, units)} … ${setting(settings.high)}`,
    '',
  ].join('\n')
}
