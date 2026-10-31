// SPDX-License-Identifier: AGPL-3.0-only
// A line put on an arc with a coincidence: its end lies on the arc, not on
// the chords the region graph samples the arc to, which run inside it by
// tens of microns. The regions have to see the end where the arc is — split
// the arc there and the region beside the line — and a line drawn on past
// the arc has to cut it where the arc is too, or the face lifted from the
// region takes a corner a hair inside the edge the arc came from and steps
// beside it.

import { describe, expect, it } from 'vitest'
import { findRegions, loopGeometry, parseRegionKey, type Region } from '../core/regions'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import type { Vec2 } from '../../../src/core/flat/types'

const C: Vec2 = [-40.93, 0]
const INNER = 29.6
const OUTER = 30.9
const START = 0.9828407376470754

/** The band of a saved project's sketch, on a face of the part: two
 *  projected arcs about one centre, closed by two radial sides, and the
 *  line drawn across it with its ends put on the arcs. The line's ends are
 *  where the solver left them. */
function band(a: Vec2, b: Vec2): { sketch: Sketch; inner: number; outer: number; divider: number } {
  const s = emptySketch()
  const sweep = 3.148278037503994
  const inner = addEntity(s, { kind: 'arc', c: C, r: INNER, start: START, sweep, fixed: true, projected: true })
  const outer = addEntity(s, { kind: 'arc', c: C, r: OUTER, start: START, sweep, fixed: true, projected: true })
  const at = (r: number, t: number): Vec2 => [C[0] + r * Math.cos(t), C[1] + r * Math.sin(t)]
  addEntity(s, { kind: 'line', a: at(INNER, START), b: at(OUTER, START) })
  addEntity(s, { kind: 'line', a: at(INNER, START + sweep), b: at(OUTER, START + sweep) })
  const divider = addEntity(s, { kind: 'line', a, b })
  return { sketch: s, inner, outer, divider }
}

const ON_INNER: Vec2 = [-63.21250768285582, -19.484605496736908]
const ON_OUTER: Vec2 = [-63.01980355035507, -21.60672532122164]

/** How far the region's corners on the arcs lie off them, at most. */
function cornerOff(r: Region, radii: Map<number, number>): number {
  let worst = 0
  for (const p of r.outer.pieces) {
    const radius = radii.get(p.entity)
    if (radius === undefined) continue
    for (const q of [p.p0, p.p1]) worst = Math.max(worst, Math.abs(Math.hypot(q[0] - C[0], q[1] - C[1]) - radius))
  }
  return worst
}

describe('a line ending on an arc', () => {
  it('splits the band where its ends lie on the arcs', () => {
    const { sketch, inner, outer, divider } = band(ON_INNER, ON_OUTER)
    // The ends lie on the arcs, not on their chords.
    expect(Math.hypot(ON_INNER[0] - C[0], ON_INNER[1] - C[1])).toBeCloseTo(INNER, 12)
    expect(Math.hypot(ON_OUTER[0] - C[0], ON_OUTER[1] - C[1])).toBeCloseTo(OUTER, 12)
    const regions = findRegions(sketch)
    expect(regions).toHaveLength(2)
    const radii = new Map([
      [inner, INNER],
      [outer, OUTER],
    ])
    for (const r of regions) {
      expect(parseRegionKey(r.key)?.ids).toContain(divider)
      expect(cornerOff(r, radii)).toBeLessThan(1e-9)
    }
    // Nothing of the band lost to the split — the areas are the sampled
    // polygons', the split points on the arcs and not on their chords.
    const whole = findRegions(band([-80, 0], [-80, 0.5]).sketch)
    expect(whole).toHaveLength(1)
    expect(Math.abs(regions[0].area + regions[1].area - whole[0].area)).toBeLessThan(0.05)
  })

  it('cuts the arcs where they are when the line is drawn on past them', () => {
    const d: Vec2 = [ON_OUTER[0] - ON_INNER[0], ON_OUTER[1] - ON_INNER[1]]
    const n = Math.hypot(d[0], d[1])
    const u: Vec2 = [d[0] / n, d[1] / n]
    const { sketch, inner, outer } = band([ON_INNER[0] - u[0] * 0.5, ON_INNER[1] - u[1] * 0.5], [ON_OUTER[0] + u[0] * 0.5, ON_OUTER[1] + u[1] * 0.5])
    const regions = findRegions(sketch)
    expect(regions).toHaveLength(2)
    const radii = new Map([
      [inner, INNER],
      [outer, OUTER],
    ])
    for (const r of regions) {
      expect(cornerOff(r, radii)).toBeLessThan(1e-9)
      // The profile handed to the kernel: every arc on its own circle, not
      // one a hair off it through a corner a hair inside.
      for (const piece of loopGeometry(r.outer, sketch)) {
        if (piece.kind !== 'arc') continue
        const rs = [piece.a, piece.m, piece.b].map((q) => Math.hypot(q[0] - C[0], q[1] - C[1]))
        const radius = Math.abs(rs[1] - INNER) < Math.abs(rs[1] - OUTER) ? INNER : OUTER
        for (const x of rs) expect(Math.abs(x - radius)).toBeLessThan(1e-9)
      }
    }
  })

  it('splits a circle where a line across it at no sampled angle meets it', () => {
    const s = emptySketch()
    const circle = addEntity(s, { kind: 'circle', c: [0, 0], r: 25 })
    const t = 0.4321
    const line = addEntity(s, { kind: 'line', a: [25 * Math.cos(t), 25 * Math.sin(t)], b: [-25 * Math.cos(t), -25 * Math.sin(t)] })
    const regions = findRegions(s)
    expect(regions).toHaveLength(2)
    for (const r of regions) {
      expect(parseRegionKey(r.key)?.ids).toEqual([circle, line])
      for (const p of r.outer.pieces) for (const q of [p.p0, p.p1]) expect(Math.abs(Math.hypot(q[0], q[1]) - 25)).toBeLessThan(1e-9)
    }
    expect(regions[0].area).toBeCloseTo(regions[1].area, 6)
  })
})

describe('two arcs tangent at a shared end', () => {
  it('bound the thin crescent between them and no slivers', () => {
    // A pie of radius 30 and, inside it, an arc of radius 28 touching the
    // pie's rim where the two start: the two run within a chord's depth
    // of each other for millimetres, and their chords cross.
    const s = emptySketch()
    addEntity(s, { kind: 'arc', c: [0, 0], r: 30, start: 0, sweep: Math.PI / 2 })
    const inner = addEntity(s, { kind: 'arc', c: [2, 0], r: 28, start: 0, sweep: 0.3 })
    const end: Vec2 = [2 + 28 * Math.cos(0.3), 28 * Math.sin(0.3)]
    // From the inner arc's end out to the rim along the radius through it.
    const k = 30 / Math.hypot(end[0], end[1])
    addEntity(s, { kind: 'line', a: end, b: [end[0] * k, end[1] * k] })
    addEntity(s, { kind: 'line', a: [0, 30], b: [0, 0] })
    addEntity(s, { kind: 'line', a: [0, 0], b: [30, 0] })
    const regions = findRegions(s)
    // The pie beside the inner arc, and the crescent between the arcs.
    expect(regions).toHaveLength(2)
    const crescent = regions[1]
    expect(parseRegionKey(crescent.key)?.ids).toContain(inner)
    expect(crescent.area).toBeGreaterThan(0.1)
    expect(crescent.area).toBeLessThan(0.5)
  })
})
