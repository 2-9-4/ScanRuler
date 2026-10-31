// SPDX-License-Identifier: AGPL-3.0-only
// The core text builders in inches: every length they write is converted
// and carries its unit, a report says once at the top what its lengths are
// in, and a sheet in pixels stays in pixels. Without units they are the
// millimetre text the agent reads, which the other tests pin down.
import { describe, expect, it } from 'vitest'
import { evaluateDimension, evaluateDimensions, judgeLimit } from '../src/core/dimensions'
import { evaluateTolerance } from '../src/core/tolerances'
import { buildSummary, formatDetail, formatDiameterRange, formatPrimary } from '../src/core/summary'
import { buildDeviationReport, buildElementReport } from '../src/core/deviation/report'
import { describeTarget } from '../src/core/deviation/elementField'
import type { AlignResult } from '../src/core/deviation/align'
import type { DeviationStats } from '../src/core/deviation/deviation'
import { buildThicknessReport } from '../src/core/thickness/report'
import type { ThicknessStats } from '../src/core/thickness/thickness'
import { assumedWarning } from '../src/core/elements/assumed'
import { describeConstruction } from '../src/core/elements/construct'
import { describeCut } from '../src/core/section/frame'
import { describeShadow, type ShadowShape } from '../src/core/section/shadow'
import { evaluateFlatDimension } from '../src/core/flat/dimensions'
import { fitCirclePoints, fitLinePoints, flatPoint } from '../src/core/flat/fit'
import { formatFlatDetail, formatFlatPrimary } from '../src/core/flat/summary'
import { buildFlatCsv, buildFlatReport, scaleLine, type FlatReportInput } from '../src/core/flat/report'
import { pinValue } from '../src/viewer/pinLabel'
import { formatSigned } from '../src/ui/format'
import type { CylinderFit, ElementSource, PlaneFit, PointFit, SphereFit } from '../src/core/types'

const ball: SphereFit = {
  kind: 'sphere',
  center: [25.4, 50.8, 0],
  radius: 12.7,
  sigma: 0.0254,
  usedPoints: 9000,
  regionSize: 9200,
  formError: 0.0508,
  residualMin: -0.0254,
  residualMax: 0.0254,
}

const bore: CylinderFit = {
  kind: 'cylinder',
  center: [0, 0, 0],
  axis: [0, 0, 1],
  radius: 6.35,
  length: 50.8,
  coverage: 358,
  sigma: 0.0254,
  usedPoints: 2075,
  regionSize: 2075,
}

const face = (z: number): PlaneFit => ({
  kind: 'plane',
  center: [0, 0, z],
  normal: [0, 0, 1],
  basisU: [1, 0, 0],
  basisV: [0, 1, 0],
  extentU: 12.7,
  extentV: 25.4,
  sigma: 0.0254,
  usedPoints: 4000,
  regionSize: 4100,
  formError: 0.0254,
})

const point = (at: [number, number, number]): PointFit => ({
  kind: 'point',
  center: at,
  sigma: 0,
  usedPoints: 0,
  regionSize: 0,
})

describe('element text in inches', () => {
  it('writes the headline in inches, four decimals for three', () => {
    expect(formatPrimary(ball, 'in')).toBe('Ø 1.0000 in')
    expect(formatPrimary(bore, 'in')).toBe('Ø 0.5000 in')
    expect(formatPrimary(ball)).toBe('Ø 25.400 mm')
  })

  it('writes the detail line and the diameter range in inches', () => {
    const detail = formatDetail(bore, 'in')
    expect(detail).toContain('σ 0.00100 in')
    expect(detail).toContain('length 2.0000 in')
    expect(detail).not.toMatch(/\bmm\b/)
    expect(formatDiameterRange(ball, 'in')).toBe('Ø min 0.9980 · max 1.0020 in')
  })

  it('says once at the top of the summary that its lengths are inches', () => {
    const source: ElementSource = { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } }
    const text = buildSummary('t.stl', [{ id: 1, name: 'Ball', kind: 'sphere', source, fit: ball }], [], [], 'in')
    const lines = text.split('\n')
    expect(lines[2]).toBe('Lengths and positions in inches')
    expect(text).toContain('  diameter: 1.00000 in')
    expect(text).toContain('  center: (1.00000, 2.00000, 0.00000)')
    expect(text).not.toMatch(/\bmm\b/)
    // In millimetres nothing is added.
    expect(buildSummary('t.stl', [], [])).toBe('ScanRuler — t.stl\nMethod: Gaussian best-fit\n')
  })

  it('writes a construction in inches', () => {
    expect(describeConstruction('plane-offset', ['Plane 1'], [25.4], 'in')).toBe('1.0000 in offset from Plane 1')
    expect(describeConstruction('point-coords', [], [25.4, 0, -12.7], 'in')).toBe('at (1.0000, 0.0000, -0.5000)')
  })

  it('warns of an assumed diameter far off in inches', () => {
    expect(assumedWarning(25.4, 12.7, 'in')).toBe('Assumed Ø 0.5 in is 0.5 in away from the measured Ø 1 in — check for a typo.')
  })

  it('pins a diameter in inches', () => {
    expect(pinValue(ball, 'in')).toBe('Ø 1.0000 in')
    expect(pinValue(ball)).toBe('Ø 25.400 mm')
  })

  it('signs a deviation in inches, bare', () => {
    expect(formatSigned(0.254, 'in')).toBe('+0.0100')
    expect(formatSigned(-0.254, 'in')).toBe('−0.0100')
    expect(formatSigned(0.254)).toBe('+0.254')
  })
})

describe('dimensions in inches', () => {
  it('writes a distance, its deltas and its verdict in inches', () => {
    const v = evaluateDimension('dist-point-point', [point([0, 0, 0]), point([25.4, 0, 0])], { units: 'in' })
    expect(v.value).toBe('1.0000 in')
    expect(v.detail).toBe('ΔX +1.0000 · ΔY +0.0000 · ΔZ +0.0000 in')
    expect(v.raw).toBe(25.4)
    const verdict = judgeLimit(25.4 + 0.254, { kind: 'band', nominal: 25.4, plus: 0.127, minus: 0.127 }, 'mm', 'in')
    expect(verdict.allowance).toBe('nominal 1.0000 in +0.0050 in / −0.0050 in')
    expect(verdict.delta).toBe('Δ +0.0100 in')
    expect(verdict.alarm).toBe('0.0050 in over the upper limit')
  })

  it('leaves an angle in degrees', () => {
    const v = evaluateDimension('angle-plane-plane', [face(0), face(10)], { units: 'in' })
    expect(v.value).toBe('0.00°')
  })

  it('evaluates a stored list in inches, a plane distance with its surface range', () => {
    const rows = evaluateDimensions(
      [{ id: 1, type: 'dist-plane-plane', name: 'Distance 1', refs: [1, 2], limit: { kind: 'max', max: 50.8 } }],
      [
        { id: 1, name: 'A', fit: face(0) },
        { id: 2, name: 'B', fit: face(25.4) },
      ],
      undefined,
      'in',
    )
    expect(rows[0].value.value).toBe('1.0000 in')
    expect(rows[0].verdict?.allowance).toBe('limit 2.0000 in')
  })

  it('writes a tolerance in inches', () => {
    expect(evaluateTolerance('form-flatness', [face(0)], { units: 'in' }).value).toBe('0.0010 in')
    expect(evaluateTolerance('form-flatness', [face(0)]).value).toBe('0.025 mm')
  })
})

const stats: DeviationStats = {
  measured: 100,
  total: 120,
  min: -0.254,
  max: 0.508,
  mean: 0.0254,
  rms: 0.127,
  sigma: 0.0254,
  withinTolerance: 90,
  tolerance: 0.254,
} as DeviationStats

const align: AlignResult = {
  transform: { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] },
  source: 'auto',
  rms: 0.0254,
  meanDistance: 0.0254,
  iterations: 12,
  matched: 1000,
  sampled: 1200,
  ambiguous: false,
} as unknown as AlignResult

describe('reports in inches', () => {
  it('states the unit under the title and writes every length in it', () => {
    const text = buildDeviationReport('scan.stl', 'ref.step', align, stats, 0.508, 2.54, null, 'in')
    const lines = text.split('\n')
    expect(lines[1]).toBe('Lengths in inches')
    expect(text).toContain('  max             +0.02000 in')
    expect(text).toContain('  within ±0.01 in')
    expect(text).toContain('  max search distance  0.1 in')
    expect(text).toContain('  colour scale         ±0.02 in')
    expect(text).not.toMatch(/\bmm\b/)
  })

  it('keeps the millimetre report as it was', () => {
    const text = buildDeviationReport('scan.stl', 'ref.step', align, stats, 0.5, 2, null)
    expect(text.split('\n')[1]).toBe('Scan:      scan.stl')
    expect(text).toContain('  max search distance  2 mm')
  })

  it('writes an element map report in inches', () => {
    const text = buildElementReport('scan.stl', 'Bore', bore, 1, stats, 0.508, 2.54, 60, null, 'in')
    expect(text).toContain('Element: Bore — cylinder, ⌀0.5000 in × 2.000 in as drawn')
    expect(text).not.toMatch(/\bmm\b/)
    expect(describeTarget(bore)).toBe('cylinder, ⌀12.700 mm × 50.8 mm as drawn')
  })

  it('writes a thickness report in inches', () => {
    const wall: ThicknessStats = { measured: 10, total: 10, min: 1.27, max: 2.54, mean: 2.032, rms: 2, sigma: 0.254, belowLimit: 2, limit: 1.524 } as ThicknessStats
    const text = buildThicknessReport('part.stl', wall, { method: 'ray', maxThickness: 25.4, coneRays: 0, coneAngleDeg: 0, normalDeviationDeg: null, low: 0, high: 5.08 }, 'in')
    expect(text.split('\n')[1]).toBe('Lengths in inches')
    expect(text).toContain('  min             0.05000 in')
    expect(text).toContain('  under 0.06 in')
    expect(text).toContain('  max. thickness searched  1 in')
    expect(text).toContain('  colour scale         0 … 0.2 in')
    expect(text).not.toMatch(/\bmm\b/)
  })
})

describe('sections in inches', () => {
  it('writes a cut offset in inches', () => {
    expect(describeCut('Plane 1', 25.4, 0, 'cut', 'in')).toBe('along Plane 1, +1.0000 in')
    expect(describeCut('Plane 1', 2)).toBe('along Plane 1, +2.000 mm')
  })

  it('writes a shadow area in square inches', () => {
    const sh = { loops: [[]], area: 645.16, margin: { min: 0.254, max: 0.508 } } as unknown as ShadowShape
    const words = describeShadow(sh, 'in')
    expect(words.area).toBe('1.000 in²')
    expect(words.band).toBe('0.010 to 0.020 in outside the part')
    expect(describeShadow(sh).area).toBe('645 mm²')
  })
})

describe('the 2D sheet in inches', () => {
  const circle = fitCirclePoints([
    [25.4, 0],
    [0, 25.4],
    [-25.4, 0],
  ])

  it('writes a sheet in millimetres in inches, a sheet in pixels in pixels', () => {
    expect(formatFlatPrimary(circle, 'mm', 'in')).toBe('Ø 2.0000 in')
    expect(formatFlatPrimary(circle, 'px', 'in')).toBe('Ø 50.800 px')
    expect(formatFlatPrimary(circle, 'mm')).toBe('Ø 50.800 mm')
    expect(formatFlatDetail(circle, 'px', 'in')).not.toContain(' in')
  })

  it('measures on a sheet in inches, or in pixels', () => {
    const v = evaluateFlatDimension('flat-dist-point-point', [flatPoint([0, 0]), flatPoint([25.4, 0])], 'in')
    expect(v.value).toBe('1.0000 in')
    expect(v.detail).toBe('ΔX +1.0000 · ΔY +0.0000 in')
    expect(evaluateFlatDimension('flat-dist-point-point', [flatPoint([0, 0]), flatPoint([25.4, 0])], 'px').value).toBe('25.400 px')
  })

  it('reports and exports a calibrated sheet in inches', () => {
    const line = fitLinePoints([
      [0, 0],
      [50.8, 0],
    ])
    const input: FlatReportInput = {
      imageName: 'part.png',
      imageWidth: 1000,
      imageHeight: 800,
      calSource: 'measured',
      pxPerMm: { x: 10, y: 10 },
      datum: null,
      frame: null,
      unit: 'mm',
      units: 'in',
      elements: [
        {
          id: 1,
          kind: 'line',
          name: 'Line 1',
          color: '#000000',
          source: { type: 'picks', method: 'flat-line-pick', picks: [] },
          fit: line,
          error: null,
          visible: true,
        },
      ],
      dimensions: [],
    }
    expect(scaleLine(input)).toBe('Scale: CALIBRATED, 254.00 px/in')
    expect(scaleLine({ ...input, units: undefined })).toBe('Scale: CALIBRATED, 10.0000 px/mm')
    expect(buildFlatReport(input)).toContain('Line 1: L 2.0000 in · 0.00°')
    const csv = buildFlatCsv(input).split('\n')
    expect(csv[1]).toContain('x_in,y_in,diameter_in,length_in')
    expect(csv[2]).toContain(',2.00000,')
  })
})
