// SPDX-License-Identifier: AGPL-3.0-only
// What the STEP check could not read: a face's loops are read on planes,
// cylinders, cones and tori, and every other face — a loft's B-spline, a
// sphere — is counted by its surface's type, so a file of freeform faces
// reads as unread, not as wrong.

import { describe, expect, it, vi } from 'vitest'
import { rectangleLoop, ReKernel } from '../core/kernel'
import { primitiveSolid } from '../core/primitives'
import { faceLoops, loopSummary } from '../core/stepLoops'

// Kernel builds run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

describe('the STEP check’s unread faces', () => {
  it('counts a loft’s B-spline faces and a sphere by their surface, apart from the faces read', async () => {
    const k = await kernelPromise
    // A smooth loft from a square to a smaller one turned a little and up:
    // freeform sides, flat ends.
    const loft = k.loft(
      [
        { outer: rectangleLoop([-10, -10, 0], [1, 0, 0], [0, 1, 0], 20, 20), holes: [] },
        { outer: rectangleLoop([-4, -6, 15], [Math.cos(0.3), Math.sin(0.3), 0], [-Math.sin(0.3), Math.cos(0.3), 0], 10, 8), holes: [] },
        { outer: rectangleLoop([-8, -8, 30], [1, 0, 0], [0, 1, 0], 16, 16), holes: [] },
      ],
      false,
    )
    const ball = primitiveSolid(k, { kind: 'sphere', center: [40, 0, 0], radius: 5 })
    const check = k.verifyStep(k.exportStep([loft, ball]), [loft, ball])
    expect(check.loops.wrong).toEqual([])
    const unread = check.loops.unread
    const splines = Object.entries(unread).filter(([type]) => /B_SPLINE_SURFACE/.test(type))
    expect(splines.length).toBeGreaterThan(0)
    expect(splines.reduce((n, [, count]) => n + count, 0)).toBeGreaterThanOrEqual(4)
    expect(unread.SPHERICAL_SURFACE).toBe(1)
    expect(unread.PLANE).toBeUndefined()
    // The ends read; every face either read or counted unread.
    expect(check.loops.read).toBeGreaterThanOrEqual(2)
    expect(check.loops.read + Object.values(unread).reduce((n, c) => n + c, 0)).toBe(check.loops.of)
    k.release(loft, ball)
  })

  it('sums a file’s faces up by what was read', () => {
    const summary = loopSummary([
      { id: 1, surface: 'PLANE', ok: true },
      { id: 2, surface: 'TOROIDAL_SURFACE', ok: false },
      { id: 3, surface: 'B_SPLINE_SURFACE_WITH_KNOTS', ok: null },
      { id: 4, surface: 'B_SPLINE_SURFACE_WITH_KNOTS', ok: null },
      { id: 5, surface: 'RATIONAL_B_SPLINE_SURFACE', ok: null },
    ])
    expect(summary).toEqual({ read: 2, of: 5, wrong: [{ id: 2, surface: 'TOROIDAL_SURFACE' }], unread: { B_SPLINE_SURFACE_WITH_KNOTS: 2, RATIONAL_B_SPLINE_SURFACE: 1 } })
  })

  it('names a complex surface entity by its telling part', () => {
    const step = [
      'DATA;',
      '#1 = CLOSED_SHELL(\'\',(#2));',
      '#2 = ADVANCED_FACE(\'\',(),#3,.T.);',
      "#3 = ( BOUNDED_SURFACE() B_SPLINE_SURFACE(1,1,((#4,#4),(#4,#4)),.UNSPECIFIED.,.F.,.F.,.F.) B_SPLINE_SURFACE_WITH_KNOTS((2),(2),(0.,1.),(0.,1.),.UNSPECIFIED.) GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE(((1.,1.),(1.,1.))) REPRESENTATION_ITEM('') SURFACE() );",
      "#4 = CARTESIAN_POINT('',(0.,0.,0.));",
      'ENDSEC;',
      '',
    ].join('\n')
    expect(faceLoops(step)).toEqual([{ id: 2, surface: 'RATIONAL_B_SPLINE_SURFACE', ok: null }])
  })
})
