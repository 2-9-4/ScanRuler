// SPDX-License-Identifier: AGPL-3.0-only
// The manipulator a feature wears while it is set up: where an extrude's
// arrows and a revolve's ring sit, and what a drag on them does to the
// numbers — outward is always growth, whichever way the arrow points; the
// taper's arrow riding the ghost's far edge, and a coil's ring wound on
// past a full turn.

import { describe, expect, it } from 'vitest'
import { polygonCentroid2 as polygonCentroid } from '../../../src/core/flat/vec2'
import { ARROW_PX, dragExtrudeExtent, dragRevolveAngle, dragTaper, extentThroughPoint, extrudeGrips, MAX_TAPER_DEG, prismStretch, regionsCentroid, revolveGrip, taperGrip, taperSpan } from '../core/preview'
import { MAX_COIL_DEG } from '../core/features'
import { findRegions } from '../core/regions'
import { addRectangle, emptySketch } from '../core/sketch'
import type { SectionFrame } from '../../../src/core/section/frame'
import { XY } from './reKit'

/** A frame standing at z = 5 with its normal down the part's Y axis. */
const TILTED: SectionFrame = { origin: [1, 2, 5], normal: [0, 1, 0], basisU: [1, 0, 0], basisV: [0, 0, -1] }

function rectangleRegions(w: number, h: number, at: [number, number] = [0, 0]) {
  const sketch = emptySketch()
  addRectangle(sketch, at, [at[0] + w, at[1] + h])
  return findRegions(sketch)
}

describe('profile centroid', () => {
  it('is the middle of a rectangle, and the area-weighted middle of several', () => {
    expect(polygonCentroid([[0, 0], [4, 0], [4, 2], [0, 2]])).toEqual([2, 1])
    const one = rectangleRegions(4, 2)
    expect(regionsCentroid(one)[0]).toBeCloseTo(2, 9)
    expect(regionsCentroid(one)[1]).toBeCloseTo(1, 9)
    // A 4×2 at the origin and a 2×2 at x = 10..12: areas 8 and 4.
    const both = [...one, ...rectangleRegions(2, 2, [10, 0])]
    const [cx] = regionsCentroid(both)
    expect(cx).toBeCloseTo((2 * 8 + 11 * 4) / 12, 9)
  })

  it('falls back to the vertex mean for a sliver with no area', () => {
    expect(polygonCentroid([[0, 0], [2, 0], [4, 0]])).toEqual([2, 0])
    expect(polygonCentroid([])).toEqual([0, 0])
  })
})

describe('extrude grips', () => {
  const regions = rectangleRegions(40, 20)

  it('puts an arrow on each face of a distance, through the centroid, pointing outward', () => {
    const grips = extrudeGrips(XY, regions, { kind: 'distance', from: -2, to: 10 })
    expect(grips.map((g) => g.side)).toEqual(['extrudeFrom', 'extrudeTo'])
    const [from, to] = grips
    expect(from.position).toEqual([20, 10, -2])
    expect(from.dir).toEqual([-0, -0, -1])
    expect(to.position).toEqual([20, 10, 10])
    expect(to.dir).toEqual([0, 0, 1])
    expect(from.shape).toBe('arrow')
    // Held at a size on the screen, not on the part: a small profile's
    // arrows are as long as a large one's.
    expect(from.pixels).toBe(true)
    expect(from.size).toBe(ARROW_PX)
    expect(extrudeGrips(XY, rectangleRegions(0.5, 0.5), { kind: 'distance', from: 0, to: 1 })[1].size).toBe(ARROW_PX)
  })

  it('follows the frame: the arrows run along its normal from its origin', () => {
    const [from, to] = extrudeGrips(TILTED, regions, { kind: 'distance', from: 0, to: 6 })
    // Sheet (20, 10) lifts to origin + 20·U + 10·V = (21, 2, −5).
    expect(from.position).toEqual([21, 2, -5])
    expect(to.position).toEqual([21, 8, -5])
    expect(to.dir).toEqual([0, 1, 0])
  })

  it('turns the arrows round when the distance runs backwards, so outward still grows', () => {
    const [from, to] = extrudeGrips(XY, regions, { kind: 'distance', from: 10, to: -2 })
    expect(from.position[2]).toBe(10)
    expect(from.dir[2]).toBe(1)
    expect(to.position[2]).toBe(-2)
    expect(to.dir[2]).toBe(-1)
  })

  it('gives a symmetric extent two arrows, a to-plane one, between planes none', () => {
    expect(extrudeGrips(XY, regions, { kind: 'symmetric', total: 8 }).map((g) => g.position[2])).toEqual([-4, 4])
    expect(extrudeGrips(XY, regions, { kind: 'toPlane', from: 1, plane: { kind: 'plane', id: 1 } }).map((g) => g.side)).toEqual(['extrudeFrom'])
    expect(extrudeGrips(XY, regions, { kind: 'betweenPlanes', a: { kind: 'plane', id: 1 }, b: { kind: 'plane', id: 2 } })).toEqual([])
    expect(extrudeGrips(XY, [], { kind: 'distance', from: 0, to: 1 })).toEqual([])
  })
})

describe('dragging an extrude grip', () => {
  it('pulls the end out and the start back, growing the body either way', () => {
    const start = { kind: 'distance' as const, from: 0, to: 10 }
    expect(dragExtrudeExtent(start, 'extrudeTo', 5)).toEqual({ kind: 'distance', from: 0, to: 15 })
    expect(dragExtrudeExtent(start, 'extrudeFrom', 5)).toEqual({ kind: 'distance', from: -5, to: 10 })
    // Pushed in past the other face, the numbers simply cross.
    expect(dragExtrudeExtent(start, 'extrudeTo', -12)).toEqual({ kind: 'distance', from: 0, to: -2 })
  })

  it('reads a backwards distance the same way — outward is growth', () => {
    const start = { kind: 'distance' as const, from: 10, to: -2 }
    expect(dragExtrudeExtent(start, 'extrudeTo', 3)).toEqual({ kind: 'distance', from: 10, to: -5 })
    expect(dragExtrudeExtent(start, 'extrudeFrom', 3)).toEqual({ kind: 'distance', from: 13, to: -2 })
  })

  it('grows a symmetric extent by twice the pull and keeps it positive', () => {
    expect(dragExtrudeExtent({ kind: 'symmetric', total: 10 }, 'extrudeTo', 2)).toEqual({ kind: 'symmetric', total: 14 })
    expect(dragExtrudeExtent({ kind: 'symmetric', total: 10 }, 'extrudeFrom', 2)).toEqual({ kind: 'symmetric', total: 14 })
    const shrunk = dragExtrudeExtent({ kind: 'symmetric', total: 10 }, 'extrudeTo', -8)
    expect(shrunk.kind === 'symmetric' ? shrunk.total : NaN).toBeCloseTo(0.01, 9)
  })

  it('moves only the start of a to-plane extent and nothing of one between planes', () => {
    const toPlane = { kind: 'toPlane' as const, from: 1, plane: { kind: 'plane' as const, id: 1 } }
    expect(dragExtrudeExtent(toPlane, 'extrudeFrom', 2)).toEqual({ ...toPlane, from: -1 })
    expect(dragExtrudeExtent(toPlane, 'extrudeTo', 2)).toEqual(toPlane)
    const between = { kind: 'betweenPlanes' as const, a: { kind: 'plane' as const, id: 1 }, b: { kind: 'plane' as const, id: 2 } }
    expect(dragExtrudeExtent(between, 'extrudeFrom', 2)).toEqual(between)
  })
})

describe('an extent through a point clicked on the part', () => {
  it('puts the end asked for at the point’s height, in front of the plane or behind it', () => {
    const start = { kind: 'distance', from: 0, to: 10 } as const
    expect(extentThroughPoint(start, 'to', 24.638)).toEqual({ kind: 'distance', from: 0, to: 24.64 })
    // Behind the sketch plane: the extrude turns round.
    expect(extentThroughPoint(start, 'to', -8)).toEqual({ kind: 'distance', from: 0, to: -8 })
    // One click for each end: a body that reaches both ways.
    const both = extentThroughPoint(extentThroughPoint(start, 'to', 12)!, 'from', -7.5)
    expect(both).toEqual({ kind: 'distance', from: -7.5, to: 12 })
  })

  it('refuses a body of no height and an end that is not a number', () => {
    expect(extentThroughPoint({ kind: 'distance', from: 0, to: 10 }, 'to', 0.001)).toBeNull()
    expect(extentThroughPoint({ kind: 'distance', from: 0, to: 10 }, 'to', NaN)).toBeNull()
    expect(extentThroughPoint({ kind: 'toNext', from: 0 }, 'to', 5)).toBeNull()
    expect(extentThroughPoint({ kind: 'toNext', from: 0 }, 'from', 5)).toEqual({ kind: 'toNext', from: 5 })
  })

  it('reaches the point with either half of a symmetric extent', () => {
    expect(extentThroughPoint({ kind: 'symmetric', total: 10 }, 'to', -6)).toEqual({ kind: 'symmetric', total: 12 })
    expect(extentThroughPoint({ kind: 'symmetric', total: 10 }, 'to', 0)).toBeNull()
  })
})

describe('a prism stretched between the kernel’s answers', () => {
  /** A column-major 4 × 4 on a point. */
  const apply = (m: number[], p: [number, number, number]) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])

  it('carries the heights from one From and To onto another, and nothing across the plane', () => {
    // Built from 0 to 10 over a plane at y = 2 whose normal is +Y.
    const m = prismStretch(TILTED.origin, TILTED.normal, 0, 10, -5, 25)!
    const foot = apply(m, [7, 2, -3])
    const top = apply(m, [7, 12, -3])
    const mid = apply(m, [-1, 7, 4])
    expect(foot[0]).toBeCloseTo(7, 9)
    expect(foot[1]).toBeCloseTo(2 - 5, 9)
    expect(foot[2]).toBeCloseTo(-3, 9)
    expect(top[1]).toBeCloseTo(2 + 25, 9)
    expect(mid).toEqual([expect.closeTo(-1, 9), expect.closeTo(2 + 10, 9), expect.closeTo(4, 9)])
  })

  it('turns the prism over when the new one runs the other way, and has nothing to stretch of none', () => {
    const m = prismStretch(XY.origin, XY.normal, 0, 10, 0, -4)!
    expect(apply(m, [1, 1, 10])[2]).toBeCloseTo(-4, 9)
    expect(apply(m, [1, 1, 0])[2]).toBeCloseTo(0, 9)
    expect(prismStretch(XY.origin, XY.normal, 3, 3, 0, 5)).toBeNull()
  })
})

describe('revolve grip', () => {
  it('rings the axis through the profile, at the centroid’s distance from it', () => {
    // A 5 × 10 rectangle beside the sheet's Y axis, revolved about that axis.
    const regions = rectangleRegions(5, 10)
    const ring = revolveGrip(XY, regions, { origin: [0, 0, 0], dir: [0, 1, 0] })
    expect(ring).not.toBeNull()
    expect(ring!.shape).toBe('ring')
    expect(ring!.side).toBe('turn')
    expect(ring!.position).toEqual([0, 5, 0])
    expect(ring!.size).toBeCloseTo(2.5, 9)
    expect(ring!.dir).toEqual([0, 1, 0])
  })

  it('is null with nothing picked, a bad axis, or the centroid on the axis', () => {
    const regions = rectangleRegions(4, 4, [-2, -2])
    expect(revolveGrip(XY, [], { origin: [0, 0, 0], dir: [0, 1, 0] })).toBeNull()
    expect(revolveGrip(XY, regions, { origin: [0, 0, 0], dir: [0, 0, 0] })).toBeNull()
    expect(revolveGrip(XY, regions, { origin: [0, 0, 0], dir: [0, 1, 0] })).toBeNull()
  })

  it('turns the angle by the degrees dragged, within a full turn', () => {
    expect(dragRevolveAngle(90, 45)).toBe(135)
    expect(dragRevolveAngle(300, 90)).toBe(360)
    expect(dragRevolveAngle(10, -30)).toBe(1)
    expect(dragRevolveAngle(90, 0.04)).toBe(90)
  })

  it('winds a coil on past a full turn, the ring dragged round and round', () => {
    expect(dragRevolveAngle(1080, 400, MAX_COIL_DEG)).toBe(1480)
    expect(dragRevolveAngle(300, 90, MAX_COIL_DEG)).toBe(390)
    expect(dragRevolveAngle(10, -30, MAX_COIL_DEG)).toBe(1)
  })
})

describe('the taper grip', () => {
  it('leans from the sketch plane, or the end nearest it, to the end further away', () => {
    expect(taperSpan({ kind: 'distance', from: 0, to: 10 })).toEqual({ start: 0, end: 10 })
    expect(taperSpan({ kind: 'distance', from: -4, to: 10 })).toEqual({ start: 0, end: 10 })
    expect(taperSpan({ kind: 'distance', from: -12, to: 10 })).toEqual({ start: 0, end: -12 })
    expect(taperSpan({ kind: 'distance', from: 5, to: 15 })).toEqual({ start: 5, end: 15 })
    expect(taperSpan({ kind: 'distance', from: 0, to: -8 })).toEqual({ start: 0, end: -8 })
    expect(taperSpan({ kind: 'symmetric', total: 20 })).toEqual({ start: 0, end: 10 })
    expect(taperSpan({ kind: 'toNext', from: 0 })).toBeNull()
  })

  it('rides the far edge half way along the outline’s furthest side, out by the lean', () => {
    const g = taperGrip(XY, rectangleRegions(40, 20), { kind: 'distance', from: 0, to: 10 }, 10)!
    expect(g.side).toBe('taper')
    expect(g.shape).toBe('arrow')
    expect(g.dir).toEqual([1, 0, 0])
    expect(g.position[0]).toBeCloseTo(40 + 10 * Math.tan((10 * Math.PI) / 180), 9)
    expect(g.position[1]).toBeCloseTo(10, 9)
    expect(g.position[2]).toBeCloseTo(10, 9)
    // Leaning in, it stands in from the side; an extrude reaching down,
    // on the far end below the plane.
    const down = taperGrip(TILTED, rectangleRegions(4, 2), { kind: 'distance', from: 0, to: -6 }, -20)!
    expect(down.position[0]).toBeCloseTo(1 + 4 - 6 * Math.tan((20 * Math.PI) / 180), 9)
    expect(down.position[1]).toBeCloseTo(2 - 6, 9)
    expect(down.position[2]).toBeCloseTo(5 - 1, 9)
    expect(taperGrip(XY, [], { kind: 'distance', from: 0, to: 10 }, 0)).toBeNull()
    expect(taperGrip(XY, rectangleRegions(4, 2), { kind: 'toLast', from: 0 }, 0)).toBeNull()
  })

  it('turns a pull along the arrow into the angle that puts the edge there', () => {
    expect(dragTaper(0, 10, 10)).toBe(45)
    expect(dragTaper(45, 10, -10)).toBe(0)
    expect(dragTaper(0, 10, -10)).toBe(-45)
    expect(dragTaper(0, 10, 1e9)).toBe(MAX_TAPER_DEG)
    expect(dragTaper(12, 0, 5)).toBe(12)
  })
})
