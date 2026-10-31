// SPDX-License-Identifier: AGPL-3.0-only
// A deviation map written out as plain text, for the clipboard: what was
// compared with what, how the two were brought together — or, for a map
// against one fitted element, what bounded it — and the figures. The settings
// a reading depends on go in beside the numbers, so a report pasted into a
// build log still says months later what it measured.

import type { AlignResult, AlignSource } from './align'
import type { DeviationStats } from './deviation'
import { describeTarget, type ElementTarget, type MaterialSide } from './elementField'
import { fmtLen, lengthInputText, unitWord, type DisplayUnits } from '../units'

const SOURCE: Record<AlignSource, string> = {
  auto: 'automatic',
  points: 'from picked points',
  local: 'local fine fit on marked surface',
  built: 'none',
}

/** How a report writes its lengths: a reading to four decimals (five in
 *  inches), a deviation with its sign either way, and a setting as it was
 *  typed. */
export function reportLengths(units: DisplayUnits) {
  return {
    len: (v: number): string => fmtLen(v, units, 4),
    signed: (v: number): string => `${v >= 0 ? '+' : '−'}${fmtLen(Math.abs(v), units, 4)}`,
    setting: (v: number): string => `${lengthInputText(v, units)} ${unitWord(units)}`,
  }
}

/** The line under a report's title that says what its lengths are in, where
 *  that is not the millimetre everything is held in. */
export function unitsHeading(units: DisplayUnits): string[] {
  return units === 'in' ? ['Lengths in inches'] : []
}

/** The figures every deviation map reports, however it was measured. */
function statLines(stats: DeviationStats, units: DisplayUnits): string[] {
  const { len, signed, setting } = reportLengths(units)
  const percent = stats.measured ? (stats.withinTolerance / stats.measured) * 100 : 0
  return [
    `  min             ${signed(stats.min)}`,
    `  max             ${signed(stats.max)}`,
    `  mean            ${signed(stats.mean)}`,
    `  RMS             ${len(stats.rms)}`,
    `  sigma           ${len(stats.sigma)}`,
    `  within ±${setting(stats.tolerance)}   ${percent.toFixed(1)} %`,
    `  matched         ${stats.measured} of ${stats.total} scan points`,
  ]
}

/** Plain-text summary of a deviation measurement, for the clipboard: what was
 *  compared against what, how well it was aligned, and the numbers — enough to
 *  paste into a build log and still know months later what it refers to. */
export function buildDeviationReport(
  scanName: string,
  nominalName: string,
  align: AlignResult,
  stats: DeviationStats,
  range: number,
  maxDistance: number,
  facingDeg: number | null,
  /** What the lengths are written in — millimetres for the agent. */
  units: DisplayUnits = 'mm',
): string {
  const { len, setting } = reportLengths(units)
  return [
    'ScanRuler — deviation from nominal',
    ...unitsHeading(units),
    `Scan:      ${scanName}`,
    `Reference: ${nominalName}`,
    '',
    // A reference modelled on this scan stands in its frame: no fit was run,
    // and the report must not dress the identity up as one.
    ...(align.source === 'built'
      ? [
          'Alignment: none — the reference was modelled on this scan and is',
          '  compared in the scan’s own frame',
        ]
      : [
          `Alignment: rigid best fit (6 DOF, no scale), ${SOURCE[align.source]}`,
          `  fit RMS         ${len(align.rms)} over ${align.matched} of ${align.sampled} sampled points`,
          `  passes          ${align.iterations}${align.ambiguous ? '  (a second starting pose fitted almost as well)' : ''}`,
        ]),
    // Which surface a fit was measured on decides what the whole map means, so
    // a local fit says so here rather than passing for a whole-part best fit.
    ...(align.source === 'local'
      ? [
          `  marked surface  ${align.selected ?? 0} scan points, hand-marked`,
          `  search limit    ${setting(align.searchDistance ?? 0)}`,
          ...(align.underconstrained
            ? ['  NOTE: the marked surface faces one way — the fit is free to slide along it']
            : []),
        ]
      : []),
    // A picked-point fit can be narrowed the same way, in the picker itself.
    ...(align.source === 'points' && align.selected !== undefined
      ? [`  fitted on       ${align.selected} scan points, selected by hand`]
      : []),
    '',
    'Deviation, scan to reference surface, signed outwards:',
    '  positive = outside the reference, negative = inside it',
    ...statLines(stats, units),
    '',
    `  max search distance  ${setting(maxDistance)}`,
    `  facing limit         ${facingDeg === null ? 'off — the nearest surface counts, whatever it faces' : `${facingDeg}°`}`,
    `  colour scale         ±${setting(range)}`,
    '',
  ].join('\n')
}

/** The same summary for a map measured against one fitted element. There is no
 *  alignment to account for — the element was fitted on this scan, in this
 *  frame — but what bounded the measurement takes its place, because the region
 *  and the facing limit are what a reading off this map has to be read against. */
export function buildElementReport(
  scanName: string,
  elementName: string,
  target: ElementTarget,
  side: MaterialSide,
  stats: DeviationStats,
  range: number,
  maxDistance: number,
  facingDeg: number | null,
  /** Scan points in the hand-marked region the map was restricted to, or null
   *  when it covered everything the element bounds. */
  markedPoints: number | null = null,
  /** What the lengths are written in — millimetres for the agent. */
  units: DisplayUnits = 'mm',
): string {
  const { len, setting } = reportLengths(units)
  return [
    'ScanRuler — deviation from a fitted element',
    ...unitsHeading(units),
    `Scan:    ${scanName}`,
    `Element: ${elementName} — ${describeTarget(target, units)}`,
    '',
    'Measured in scan coordinates — the element was fitted on this scan, so',
    'there is no alignment between the two and none has been applied.',
    `  form deviation of the element itself   ${len(target.sigma)} sigma`,
    ...(target.formError !== undefined
      ? [`  form error (peak-to-peak)               ${len(target.formError)}`]
      : []),
    `  measured on                            ${target.usedPoints} of ${target.regionSize} points`,
    `  material side                          ${side === 1 ? "the element's outward side" : 'the inner side — a bore or a shell'}`,
    '',
    'Deviation, scan to element, signed towards the material:',
    '  positive = too much material, negative = too little',
    ...statLines(stats, units),
    '',
    `  region               ${
      markedPoints === null
        ? 'the element as drawn'
        : `a hand-marked surface (${markedPoints} scan points), within the element as drawn`
    }`,
    `  max search distance  ${setting(maxDistance)}`,
    `  facing limit         ${facingDeg === null ? 'off — any surface within the element counts' : `${facingDeg}°`}`,
    `  colour scale         ±${setting(range)}`,
    '',
  ].join('\n')
}
