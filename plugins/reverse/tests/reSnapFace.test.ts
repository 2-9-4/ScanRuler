// SPDX-License-Identifier: AGPL-3.0-only
// A face snapped onto the scan: the move read off the element fitted where
// the scan was clicked — how far, how tilted, and when the click was on the
// wrong face.

import { describe, expect, it } from 'vitest'
import { snapFitKind, snapReading } from '../core/snapFace'
import type { FaceFingerprint } from '../core/topo'
import type { CylinderFit, PlaneFit } from '../../../src/core/types'

const STATS = { sigma: 0.02, usedPoints: 500, regionSize: 500 }
const top: FaceFingerprint = { kind: 'plane', centroid: [20, 10, 10], dir: [0, 0, 1], area: 800, origin: 2 }
const plane = (center: [number, number, number], normal: [number, number, number]): PlaneFit => ({ kind: 'plane', center, normal, basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 5, extentV: 5, ...STATS })

describe('snapping a face onto the scan', () => {
  it('reads how far a flat face moves, out or in, whichever way the fitted normal points', () => {
    const out = snapReading(top, plane([3, 4, 11.5], [0, 0, 1]))
    expect(out).toMatchObject({ offset: 1.5, tiltDeg: 0, sigma: 0.02 })
    // A plane fitted facing the other way is the same plane.
    expect(snapReading(top, plane([3, 4, 11.5], [0, 0, -1]))).toMatchObject({ offset: 1.5 })
    const inward = snapReading(top, plane([30, 2, 9.2], [0, 0, 1]))
    if (typeof inward === 'string') throw new Error(inward)
    expect(inward.offset).toBeCloseTo(-0.8, 9)
  })

  it('meets a tilted scan face through the middle of the body’s face, and says how tilted', () => {
    // A plane through (20, 10, 12) — above the face's middle — tilted 2°
    // about Y, fitted on a patch away from the middle.
    const t = (2 * Math.PI) / 180
    const n: [number, number, number] = [Math.sin(t), 0, Math.cos(t)]
    const at = 10
    const center: [number, number, number] = [20 + at, 10, 12 - (at * n[0]) / n[2]]
    const r = snapReading(top, plane(center, n))
    if (typeof r === 'string') throw new Error(r)
    expect(r.offset).toBeCloseTo(2, 6)
    expect(r.tiltDeg).toBeCloseTo(2, 6)
  })

  it('refuses a click on a neighbouring face, and the wrong kind of element', () => {
    expect(snapReading(top, plane([40, 10, 5], [1, 0, 0]))).toMatch(/turned 90°/)
    const cyl: CylinderFit = { kind: 'cylinder', center: [0, 0, 0], axis: [0, 0, 1], radius: 3, length: 10, coverage: 360, ...STATS }
    expect(snapReading(top, cyl)).toMatch(/plane/)
  })

  it('reads a round face’s change of radius and how far the scan’s axis stands off', () => {
    const bore: FaceFingerprint = { kind: 'cylinder', centroid: [10, 10, 5], dir: [0, 0, 1], area: 188, radius: 3, center: [10, 10, 5], origin: 5 }
    const fit: CylinderFit = { kind: 'cylinder', center: [10.3, 10.4, 2], axis: [0, 0, -1], radius: 3.4, length: 10, coverage: 360, ...STATS }
    const r = snapReading(bore, fit)
    if (typeof r === 'string') throw new Error(r)
    expect(r.offset).toBeCloseTo(0.4, 9)
    expect(r.tiltDeg).toBeCloseTo(0, 6)
    expect(r.axisShift).toBeCloseTo(0.5, 9)
    expect(snapFitKind(bore)).toBe('cylinder')
    expect(snapFitKind({ ...bore, kind: 'cone' })).toBeNull()
  })
})

describe('the draft a leaning scan face asks for', () => {
  const t = (3 * Math.PI) / 180
  // A plane through (20, 10, 12), 2 mm above the face's middle, dipping
  // 3° as it goes along +X — a moulded wall's top scanned with its draft.
  const dipping = plane([20, 10, 12], [Math.sin(t), 0, Math.cos(t)])

  it('is offered for a tilt the fit’s scatter cannot explain, hinged through the moved middle, leaning in along the dip', () => {
    const r = snapReading(top, dipping)
    if (typeof r === 'string') throw new Error(r)
    expect(r.offset).toBeCloseTo(2, 6)
    expect(r.draft).toBeDefined()
    expect(r.draft!.angleDeg).toBeCloseTo(3, 2)
    expect(r.draft!.origin[0]).toBeCloseTo(20, 9)
    expect(r.draft!.origin[2]).toBeCloseTo(12, 9)
    expect(r.draft!.pull[0]).toBeCloseTo(1, 9)
    expect(r.draft!.pull[2]).toBeCloseTo(0, 9)
    expect(r.draft!.noiseDeg).toBeLessThan(0.1)
    // The same plane fitted facing down is the same offer.
    const flipped = snapReading(top, plane([20, 10, 12], [-Math.sin(t), 0, -Math.cos(t)]))
    if (typeof flipped === 'string') throw new Error(flipped)
    expect(flipped.draft!.pull[0]).toBeCloseTo(1, 9)
    expect(flipped.draft!.angleDeg).toBeCloseTo(3, 2)
  })

  it('is not offered under the floor, nor for a tilt within a small rough patch’s noise, nor for a round face', () => {
    const tiny = (0.05 * Math.PI) / 180
    const flat = snapReading(top, plane([20, 10, 12], [Math.sin(tiny), 0, Math.cos(tiny)]))
    if (typeof flat === 'string') throw new Error(flat)
    expect(flat.draft).toBeUndefined()
    // Half a degree read off 20 rough points 4 mm across: the slope of
    // such a fit is uncertain by more than that.
    const t2 = (0.5 * Math.PI) / 180
    const rough: PlaneFit = { ...plane([20, 10, 12], [Math.sin(t2), 0, Math.cos(t2)]), sigma: 0.5, usedPoints: 20, regionSize: 20, extentU: 2, extentV: 2 }
    const noisy = snapReading(top, rough)
    if (typeof noisy === 'string') throw new Error(noisy)
    expect(noisy.tiltDeg).toBeCloseTo(0.5, 6)
    expect(noisy.draft).toBeUndefined()
    const bore: FaceFingerprint = { kind: 'cylinder', centroid: [10, 10, 5], dir: [0, 0, 1], area: 188, radius: 3, center: [10, 10, 5], origin: 5 }
    const leaning: CylinderFit = { kind: 'cylinder', center: [10, 10, 2], axis: [Math.sin(t), 0, Math.cos(t)], radius: 3.4, length: 10, coverage: 360, ...STATS }
    const r = snapReading(bore, leaning)
    if (typeof r === 'string') throw new Error(r)
    expect(r.tiltDeg).toBeCloseTo(3, 6)
    expect(r.draft).toBeUndefined()
  })
})
