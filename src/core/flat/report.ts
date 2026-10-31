// SPDX-License-Identifier: AGPL-3.0-only
// How a flat measuring session leaves the tool as text: a clipboard report a
// person pastes somewhere, and a CSV a spreadsheet ingests. Both say what the
// numbers rest on — the scale, where it came from, and whether coordinates
// are in the part's frame — because a figure without its traceability line is
// how wrong numbers get trusted.

import type { FlatDatum, FlatFrame } from './datum'
import { fitInFrame, frameMirrored } from './datum'
import type { FlatDimensionValue } from './dimensions'
import type { FlatElement } from './elements'
import type { PixelsPerMm } from './image'
import { formatFlatDetail, formatFlatPrimary, sheetUnits, sheetWord } from './summary'
import type { FlatFit } from './types'
import { MM_PER_INCH, toDisplay, type DisplayUnits } from '../units'

export interface EvaluatedFlatDimension {
  title: string
  value: FlatDimensionValue
}

export interface FlatReportInput {
  imageName: string
  imageWidth: number
  imageHeight: number
  calSource: 'none' | 'metadata' | 'measured' | 'section'
  /** Present when the sheet is a section through the 3D scan rather than an
   *  image: what it is called, which scan it cuts, and where — the image
   *  fields above are then not what the sheet is. */
  section?: { name: string; scanName: string; cut: string; kind?: 'cut' | 'shadow' }
  pxPerMm: PixelsPerMm | null
  datum: FlatDatum | null
  frame: FlatFrame | null
  unit: string
  /** What a sheet in millimetres is written in — millimetres unless the
   *  screen shows inches. The dimensions come evaluated in it already. */
  units?: DisplayUnits
  elements: readonly FlatElement[]
  dimensions: readonly EvaluatedFlatDimension[]
  counts?: readonly { name: string; picks: readonly unknown[] }[]
  /** The text notes written on the sheet, as written. */
  notes?: readonly { text: string }[]
}

export function scaleLine(r: FlatReportInput): string {
  const inches = r.units === 'in'
  if (r.section || r.calSource === 'section') {
    return inches
      ? 'Scale: the 3D scan’s own, written in inches (a section, not an image)'
      : 'Scale: millimetres of the 3D scan (a section, not an image)'
  }
  if (r.calSource === 'measured' && r.pxPerMm) {
    // Pixels to the unit shown: per millimetre to four decimals, per inch
    // (the scan's own dpi) to two.
    const per = (v: number): string => (inches ? (v * MM_PER_INCH).toFixed(2) : v.toFixed(4))
    const word = `px/${sheetWord(sheetUnits('mm', r.units ?? 'mm'))}` // units-ok: the sheet's unit and the default units, ids
    return r.pxPerMm.x === r.pxPerMm.y
      ? `Scale: CALIBRATED, ${per(r.pxPerMm.x)} ${word}`
      : `Scale: CALIBRATED, X ${per(r.pxPerMm.x)} / Y ${per(r.pxPerMm.y)} ${word}`
  }
  if (r.calSource === 'metadata' && r.pxPerMm) {
    return `Scale: UNCALIBRATED — nominal ${(r.pxPerMm.x * 25.4).toFixed(0)} dpi from file metadata`
  }
  return 'Scale: UNCALIBRATED — no scale, all values in PIXELS'
}

/** The first line: what the sheet is. */
export function titleLine(r: FlatReportInput): string {
  return r.section
    ? `ScanRuler 2D measurement — ${r.section.name}: ${r.section.scanName} ${r.section.kind === 'shadow' ? '' : 'cut '}${r.section.cut}`
    : `ScanRuler 2D measurement — ${r.imageName} (${r.imageWidth} × ${r.imageHeight} px)`
}

function frameLine(r: FlatReportInput): string {
  // A mirrored sheet's frame is right-handed as shown: +Y up the screen,
  // which is down the scan — worth a word beside numbers that will be
  // compared with a drawing.
  if (r.frame) {
    return frameMirrored(r.frame)
      ? 'Coordinates: aligned part frame (origin and +X as picked, +Y up on the sheet as shown mirrored)'
      : 'Coordinates: aligned part frame (origin and +X as picked)'
  }
  return r.section
    ? `Coordinates: section frame, origin at the ${r.section.kind === 'shadow' ? 'projection' : 'cutting'} plane’s centre, y up`
    : 'Coordinates: image frame, origin bottom-left, y up'
}

export function buildFlatReport(r: FlatReportInput): string {
  const lines: string[] = []
  lines.push(titleLine(r))
  lines.push(scaleLine(r))
  lines.push(frameLine(r))
  if (r.elements.length > 0) {
    lines.push('')
    lines.push('Elements')
    for (const el of r.elements) {
      if (!el.fit) {
        lines.push(`  ${el.name}: no fit — ${el.error ?? 'unavailable'}`)
        continue
      }
      const shown = fitInFrame(el.fit, r.frame)
      const detail = formatFlatDetail(shown, r.unit, r.units)
      lines.push(`  ${el.name}: ${formatFlatPrimary(shown, r.unit, r.units)}${detail ? ` (${detail})` : ''}`)
    }
  }
  if (r.dimensions.length > 0) {
    lines.push('')
    lines.push('Dimensions')
    for (const d of r.dimensions) {
      if (d.value.invalid) {
        lines.push(`  ${d.title} — ${d.value.label}: invalid (${d.value.invalid})`)
        continue
      }
      const extras = [d.value.detail, d.value.warning && `⚠ ${d.value.warning}`]
        .filter(Boolean)
        .join(' — ')
      lines.push(`  ${d.title} — ${d.value.label}: ${d.value.value}${extras ? ` (${extras})` : ''}`)
    }
  }
  if (r.counts && r.counts.length > 0) {
    lines.push('')
    lines.push('Counts')
    for (const c of r.counts) lines.push(`  ${c.name}: ${c.picks.length}`)
  }
  const notes = (r.notes ?? []).filter((n) => n.text.trim() !== '')
  if (notes.length > 0) {
    lines.push('')
    lines.push('Notes')
    for (const n of notes) lines.push(`  ${n.text.trim()}`)
  }
  return lines.join('\n')
}

const csv = (v: string | number | undefined | null): string => {
  if (v === undefined || v === null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function fitColumns(fit: FlatFit): (number | '')[] {
  const deg = (rad: number) => (rad * 180) / Math.PI
  switch (fit.kind) {
    case 'point':
      return [fit.at[0], fit.at[1], '', '', '', '']
    case 'line':
      return [fit.center[0], fit.center[1], '', fit.length, deg(Math.atan2(fit.dir[1], fit.dir[0])), '']
    case 'circle':
      return [fit.center[0], fit.center[1], 2 * fit.radius, '', '', '']
    case 'arc':
      return [fit.center[0], fit.center[1], 2 * fit.radius, '', deg(fit.start), deg(fit.sweep)]
    // A spline's position is where it starts; its length is the curve's.
    case 'spline':
      return [fit.points[0][0], fit.points[0][1], '', fit.length, '', '']
  }
}

/** One CSV with two sections: elements, then dimensions. Numeric columns stay
 *  raw (no unit suffixes) — the header row carries the unit once. */
export function buildFlatCsv(r: FlatReportInput): string {
  const rows: string[] = []
  // The columns' unit: the sheet's pixels, or the units shown on a sheet in
  // millimetres, the figures converted with one more decimal in inches.
  const su = sheetUnits(r.unit, r.units ?? 'mm') // units-ok: the default units, an id
  const unit = sheetWord(su)
  const shown = (v: number, mmDecimals: number): string =>
    su === 'in' ? toDisplay(v, su).toFixed(mmDecimals + 1) : v.toFixed(mmDecimals)
  rows.push(
    `# ${r.section ? `${r.section.name} of ${r.section.scanName}, ${r.section.cut}` : r.imageName} — ${scaleLine(r)} — ${
      r.frame ? 'aligned part frame' : r.section ? 'section frame' : 'image frame'
    }`,
  )
  rows.push(
    ['name', 'kind', `x_${unit}`, `y_${unit}`, `diameter_${unit}`, `length_${unit}`, 'angle_deg', 'sweep_deg', `sigma_${unit}`, `form_${unit}`, 'points', 'note']
      .map(csv)
      .join(','),
  )
  for (const el of r.elements) {
    if (!el.fit) {
      rows.push([el.name, el.kind, '', '', '', '', '', '', '', '', '', el.error ?? 'no fit'].map(csv).join(','))
      continue
    }
    const fit = fitInFrame(el.fit, r.frame)
    const cols = fitColumns(fit)
    rows.push(
      [
        el.name,
        el.kind,
        // x, y, diameter and length are lengths; the two angles are not.
        ...cols.map((c, i) => (c === '' ? '' : i < 4 ? shown(c, 4) : c.toFixed(4))),
        shown(fit.sigma, 5),
        fit.formError !== undefined ? shown(fit.formError, 5) : '',
        fit.usedPoints,
        '',
      ]
        .map(csv)
        .join(','),
    )
  }
  if (r.dimensions.length > 0) {
    rows.push('')
    rows.push(['dimension', 'label', `value_${unit}_or_deg`, 'note'].map(csv).join(','))
    for (const d of r.dimensions) {
      // An angle's value is in degrees whatever the lengths are in.
      const angle = d.value.arc !== undefined
      rows.push(
        [
          d.title,
          d.value.label,
          d.value.raw !== undefined ? (angle ? d.value.raw.toFixed(4) : shown(d.value.raw, 4)) : '',
          d.value.invalid ?? d.value.warning ?? '',
        ]
          .map(csv)
          .join(','),
      )
    }
  }
  if (r.counts && r.counts.length > 0) {
    rows.push('')
    rows.push(['count', 'features'].map(csv).join(','))
    for (const c of r.counts) rows.push([c.name, c.picks.length].map(csv).join(','))
  }
  return rows.join('\n')
}
