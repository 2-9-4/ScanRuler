// SPDX-License-Identifier: AGPL-3.0-only
// Measured elements and dimensions as text: the headline value and detail
// line an element is shown with, and the plain-text summary of everything
// measured that is copied out — how each element came about, its geometry and
// residuals, each dimension with its verdict, and a tally of passes and
// fails. Where an element departs from its bare fit — extended, given an
// assumed diameter, turned to a reference plane — the summary says so on a
// line of its own.

import type { ElementKind, ElementSource, FitData, SigmaPreset, Vec3 } from './types'
import { diameterRange, verdictLines, type EvaluatedDimension } from './dimensions'
import { hasDiameter } from './elements/assumed'
import { describeConstruction } from './elements/construct'
import {
  extendedSpans,
  fitsInside,
  isExtendable,
  isExtended,
  type Extension,
} from './elements/extend'
import { directionOf, isOrientable, referenceName, relationWord, type Orient } from './elements/orient'
import { acuteAngle } from './vec'
import { fmtLen, unitWord, type DisplayUnits } from './units'

export const SIGMA_LABELS: Record<SigmaPreset, string> = {
  0: 'All points',
  3: '3 sigma',
  2: '2 sigma',
  1: '1 sigma',
}

/** How an element's outlier cut-off reads beside its point count in the
 *  summary — each fitted element carries its own. */
export function cutoffLabel(k: SigmaPreset): string {
  return k === 0 ? 'all points' : `${k} sigma cut-off`
}

/** A finished element: name plus the geometry that was measured for it. */
export interface MeasuredElement {
  id: number
  name: string
  kind: ElementKind
  fit: FitData
}

/** A direction: unit-less, four decimals. */
function formatVec(v: Vec3): string {
  return `(${v[0].toFixed(4)}, ${v[1].toFixed(4)}, ${v[2].toFixed(4)})`
}

/** A position: its coordinates are lengths, written bare in `units` — the
 *  summary says once at the top what they are in. */
function formatPos(v: Vec3, units: DisplayUnits, mmDecimals = 4): string {
  return `(${v.map((c) => fmtLen(c, units, mmDecimals, { bare: true })).join(', ')})`
}

/** Whether a geometry was measured on the scan (fitted) rather than picked or
 *  constructed — the ones whose sigma means something. */
const isFitted = (fit: FitData): boolean => fit.usedPoints > 0

/** The one number that identifies an element in a list, its lengths in
 *  `units`. */
export function formatPrimary(fit: FitData, units: DisplayUnits = 'mm'): string {
  switch (fit.kind) {
    case 'sphere':
    case 'cylinder':
    case 'circle':
      return `Ø ${fmtLen(fit.radius * 2, units, 3)}`
    case 'cone':
      return `∠ ${(fit.halfAngle * 2).toFixed(2)}°`
    case 'torus':
      return `R ${fmtLen(fit.minorRadius, units, 3)}`
    case 'plane':
      return isFitted(fit) ? `σ ${fmtLen(fit.sigma, units, 4)}` : ''
    case 'point':
      return formatPos(fit.center, units, 1)
    case 'line':
      return ''
  }
}

/** What the peak-to-peak form deviation of a kind is called in GD&T — the
 *  name the summary and the report label it with. Null for the kinds that
 *  have no surface form to speak of. */
function formErrorLabel(kind: ElementKind): string | null {
  switch (kind) {
    case 'plane':
      return 'flatness'
    case 'cylinder':
      return 'cylindricity'
    case 'sphere':
      return 'sphericity'
    case 'circle':
      return 'circularity'
    default:
      return null
  }
}

/** The smallest and the largest diameter the measured surface reaches, as
 *  the detail line and the report print it — beside the Gaussian value,
 *  which is the mean and stays the headline. Null where there is none. */
export function formatDiameterRange(fit: FitData, units: DisplayUnits = 'mm'): string | null {
  const r = diameterRange(fit)
  return r && `Ø min ${fmtLen(r[0], units, 3, { bare: true })} · max ${fmtLen(r[1], units, 3)}`
}

const signed4 = (v: number, units: DisplayUnits): string =>
  `${v < 0 ? '−' : '+'}${fmtLen(Math.abs(v), units, 4, { bare: true })}`

/** The supporting numbers, for the panel's detail line and the summary, its
 *  lengths in `units`. */
export function formatDetail(fit: FitData, units: DisplayUnits = 'mm'): string {
  const len = (v: number, mmDecimals: number): string => fmtLen(v, units, mmDecimals)
  const bare = (v: number, mmDecimals: number): string => fmtLen(v, units, mmDecimals, { bare: true })
  const points = `${fit.usedPoints.toLocaleString('en-US')} of ${fit.regionSize.toLocaleString('en-US')} points`
  const form =
    fit.formError !== undefined ? ` · ${formErrorLabel(fit.kind) ?? 'form'} ${len(fit.formError, 4)}` : ''
  const range = formatDiameterRange(fit, units)
  const dia = range ? ` · ${range}` : ''
  switch (fit.kind) {
    case 'sphere':
      return `${fit.held ? `Ø held · free Ø ${len(fit.held.freeDiameter, 3)} · ` : ''}σ ${len(fit.sigma, 4)}${form}${dia} · ${points}`
    case 'cylinder':
      return `σ ${len(fit.sigma, 4)}${form}${dia} · length ${len(fit.length, 3)} · arc ${Math.round(fit.coverage)}° · ${points}`
    case 'cone':
      return `σ ${len(fit.sigma, 4)}${form} · Ø ${bare(fit.radius1 * 2, 3)}–${len(fit.radius2 * 2, 3)} · arc ${Math.round(fit.coverage)}° · ${points}`
    case 'torus':
      return `σ ${len(fit.sigma, 4)}${form} · ring Ø ${len(fit.majorRadius * 2, 3)} · tube ${Math.round(fit.tubeCoverage)}° · round ${Math.round(fit.spineCoverage)}° · ${points}`
    case 'plane':
      return isFitted(fit)
        ? `${bare(fit.extentU * 2, 2)} × ${len(fit.extentV * 2, 2)} patch${form} · ${points}`
        : `${bare(fit.extentU * 2, 2)} × ${len(fit.extentV * 2, 2)} patch`
    case 'circle':
      return isFitted(fit)
        ? `σ ${len(fit.sigma, 4)}${form}${dia} · from ${fit.usedPoints} points`
        : `center ${formatPos(fit.center, units, 3)}`
    case 'point':
      return `at ${formatPos(fit.center, units, 3)}`
    case 'line':
      return `direction (${fit.dir.map((v) => v.toFixed(4)).join(', ')})`
  }
}

/** What buildSummary needs of an element — store elements satisfy this. */
export interface SummaryElement {
  id: number
  name: string
  kind: ElementKind
  source: ElementSource
  fit?: FitData
  /** Only ever reported beside the measurement, never folded into it. */
  extend?: Extension
  /** The assumed design diameter, reported the same way. */
  assumed?: number
  /** The reference plane the direction was taken from, and the fit before
   *  it was turned — so the report can say how far off the measurement was. */
  orient?: Orient
  measured?: FitData
  message?: string
}

export function buildSummary(
  fileName: string,
  elements: readonly SummaryElement[],
  dimensions: readonly EvaluatedDimension[],
  /** The sections, by name — a construction may stand on one. */
  sections: readonly { id: number; name: string }[] = [],
  /** What the lengths are written in. The dimensions come evaluated, so
   *  their values are in whatever they were evaluated in. */
  units: DisplayUnits = 'mm',
): string {
  const nameOf = (id: number): string =>
    (elements.find((e) => e.id === id) ?? sections.find((sec) => sec.id === id))?.name ?? '?'
  const len = (v: number, mmDecimals = 4): string => fmtLen(v, units, mmDecimals)
  const bare = (v: number, mmDecimals = 4): string => fmtLen(v, units, mmDecimals, { bare: true })
  const pos = (v: Vec3): string => formatPos(v, units)
  // The outlier cut-off is each fitted element's own, so it is said beside
  // the element's point count rather than once at the top. The unit is said
  // up there when it is not the millimetre every reading is held in, since a
  // position's coordinates are written bare.
  const lines = [`ScanRuler — ${fileName}`, 'Method: Gaussian best-fit']
  if (units === 'in') lines.push('Lengths and positions in inches')
  lines.push('')
  for (const el of elements) {
    lines.push(`${el.name}`)
    if (el.source.type === 'constructed') {
      lines.push(
        `  constructed: ${describeConstruction(el.source.method, el.source.refs.map(nameOf), el.source.params, units)}`,
      )
      if (el.source.selection) {
        lines.push(`  searched on a marked surface of ${el.source.selection.length} points`)
      }
    }
    const f = el.fit
    if (!f) {
      lines.push(`  no geometry — ${el.message ?? 'unavailable'}`)
      continue
    }
    if (f.kind === 'sphere') {
      lines.push(`  diameter: ${len(f.radius * 2)}${f.held ? ' (known, held by the fit)' : ''}`)
      lines.push(`  center: ${pos(f.center)}`)
      if (f.held) {
        lines.push(
          `  free fit: diameter ${len(f.held.freeDiameter)}, centre ${len(f.held.shift)} from the held one`,
        )
      }
    } else if (f.kind === 'cylinder') {
      lines.push(`  diameter: ${len(f.radius * 2)}`)
      lines.push(`  axis point: ${pos(f.center)}`)
      lines.push(`  axis direction: ${formatVec(f.axis)}`)
      lines.push(`  length: ${len(f.length)}, arc: ${Math.round(f.coverage)}°`)
    } else if (f.kind === 'cone') {
      lines.push(`  apex angle: ${(f.halfAngle * 2).toFixed(3)}° (half-angle ${f.halfAngle.toFixed(3)}°)`)
      lines.push(`  diameter: ${bare(f.radius1 * 2)} → ${len(f.radius2 * 2)}`)
      lines.push(`  axis point: ${pos(f.center)}`)
      lines.push(`  axis direction: ${formatVec(f.axis)}`)
      lines.push(`  length: ${len(f.length)}, arc: ${Math.round(f.coverage)}°`)
    } else if (f.kind === 'torus') {
      lines.push(`  tube radius: ${len(f.minorRadius)}, ring radius: ${len(f.majorRadius)}`)
      lines.push(`  centre: ${pos(f.center)}`)
      lines.push(`  axis direction: ${formatVec(f.axis)}`)
      lines.push(`  tube arc: ${Math.round(f.tubeCoverage)}°, round the ring: ${Math.round(f.spineCoverage)}°`)
    } else if (f.kind === 'plane') {
      lines.push(`  point: ${pos(f.center)}`)
      lines.push(`  normal: ${formatVec(f.normal)}`)
      lines.push(`  patch: ${bare(f.extentU * 2, 2)} × ${len(f.extentV * 2, 2)}`)
    } else if (f.kind === 'circle') {
      lines.push(`  diameter: ${len(f.radius * 2)}`)
      lines.push(`  center: ${pos(f.center)}`)
      lines.push(`  normal: ${formatVec(f.normal)}`)
    } else if (f.kind === 'point') {
      lines.push(`  point: ${pos(f.center)}`)
    } else {
      lines.push(`  point: ${pos(f.center)}`)
      lines.push(`  direction: ${formatVec(f.dir)}`)
    }
    if (isFitted(f)) {
      const cutoff = el.source.type === 'fitted' ? ` (${cutoffLabel(el.source.settings.sigma)})` : ''
      lines.push(
        `  sigma: ${len(f.sigma)}, used points: ${f.usedPoints} of ${f.regionSize}${cutoff}`,
      )
      if (f.formError !== undefined) {
        lines.push(`  ${formErrorLabel(f.kind) ?? 'form'} (peak-to-peak): ${len(f.formError)}`)
      }
      // Where the surface actually reaches about the fit — and, for a round
      // feature, what that makes the smallest and the largest diameter.
      if (f.residualMin !== undefined && f.residualMax !== undefined) {
        lines.push(`  residual min / max: ${signed4(f.residualMin, units)} / ${signed4(f.residualMax, units)} ${unitWord(units)}`)
        const range = diameterRange(f)
        if (range) {
          lines.push(
            `  diameter min / max: ${bare(range[0])} / ${len(range[1])} (radial extremes)`,
          )
        }
      }
    }
    // A direction taken from a reference plane rather than from the fit, and
    // how far the fit was from it.
    if (el.orient && isOrientable(f)) {
      const m = el.measured
      const off =
        m && isOrientable(m) ? `, measured ${acuteAngle(directionOf(m), directionOf(f)).toFixed(3)}° off` : ''
      lines.push(
        `  aligned ${relationWord(f.kind, el.orient.relation)} to ${referenceName(el.orient.ref, elements)}${off}`,
      )
    }
    // The diameter an assumed-dimension export writes, when it is not simply
    // the measurement restated.
    if (el.assumed !== undefined && hasDiameter(f) && el.assumed !== 2 * f.radius) {
      lines.push(`  assumed diameter: ${len(el.assumed)}`)
    }
    // What is on screen and in the STEP file, when that is no longer the same
    // as what was measured.
    if (isExtendable(f) && isExtended(el.extend)) {
      const spans = extendedSpans(f, el.extend)
      lines.push(
        f.kind === 'cylinder'
          ? `  drawn: ${len(spans[0])} long`
          : `  drawn: ${bare(spans[0], 2)} × ${len(spans[1], 2)}`,
      )
      // The one case where the drawing reaches back into the measurement.
      if (fitsInside(el.extend)) lines.push('  fitted to the surface inside that span only')
    }
  }
  if (dimensions.length) lines.push('')
  // Every value held to a limit is judged in its own line, and counted: the
  // tally at the end is what a build log wants first.
  let checked = 0
  let passed = 0
  for (const { dim, title, value, verdict } of dimensions) {
    if (value.invalid) {
      lines.push(`${dim.name} (${title}) — ${value.label}: no value — ${value.invalid}`)
      continue
    }
    lines.push(`${dim.name} (${title}) — ${value.label}: ${value.value}`)
    if (verdict) {
      checked++
      if (verdict.pass) passed++
      lines.push(`  ${verdictLines(verdict).join(' · ')} · ${verdict.pass ? 'PASS' : 'FAIL'}`)
    }
    if (value.detail) lines.push(`  ${value.detail}`)
    if (value.warning) lines.push(`  ⚠ ${value.warning}`)
  }
  if (checked > 0) {
    lines.push('')
    lines.push(`Checked against limits: ${checked} — ${passed} pass, ${checked - passed} fail`)
  }
  return lines.join('\n')
}
