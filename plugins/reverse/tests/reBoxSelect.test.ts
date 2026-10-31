// SPDX-License-Identifier: AGPL-3.0-only
// What a selection box takes: a window only what lies wholly inside it, a
// crossing box whatever it touches — an arc bulging out of a window is left
// out, an arc reaching into a crossing box is taken though both its ends lie
// outside — and a box laid turned on the sheet the same.

import { describe, expect, it } from 'vitest'
import { piecesInBox } from '../core/boxSelect'
import { addEntity, emptySketch } from '../core/sketch'
import type { Vec2 } from '../../../src/core/flat/types'

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

describe('a selection box', () => {
  const sketch = emptySketch()
  const inner = addEntity(sketch, { kind: 'line', a: [1, 1], b: [4, 4] })
  const across = addEntity(sketch, { kind: 'line', a: [5, 5], b: [20, 5] })
  const through = addEntity(sketch, { kind: 'line', a: [-5, 8], b: [15, 8] })
  const away = addEntity(sketch, { kind: 'line', a: [20, 20], b: [30, 20] })
  // Ends at (2, 2) and (8, 2), bulging down to y = -1: out of a window
  // from y = 0, wholly in one from y = -2.
  const bulge = addEntity(sketch, { kind: 'arc', c: [5, 2], r: 3, start: Math.PI, sweep: Math.PI })
  // Ends far outside the box, its top reaching in at (5, 11.5).
  const reach = addEntity(sketch, { kind: 'arc', c: [5, 20], r: 8.5, start: Math.PI + 0.3, sweep: Math.PI - 0.6 })
  const ring = addEntity(sketch, { kind: 'circle', c: [5, 5], r: 2 })
  const round = addEntity(sketch, { kind: 'circle', c: [5, 5], r: 50 })
  const dot = addEntity(sketch, { kind: 'point', p: [9, 9] })

  it('dragged rightward, a window, takes only what lies wholly inside', () => {
    expect(piecesInBox(sketch, rect(0, 0, 10, 12), false)).toEqual([inner, ring, dot])
    expect(piecesInBox(sketch, rect(0, -2, 10, 12), false)).toEqual([inner, bulge, ring, dot])
  })

  it('dragged leftward, a crossing box, takes whatever it touches', () => {
    expect(piecesInBox(sketch, rect(0, 0, 10, 12), true)).toEqual([inner, across, through, bulge, reach, ring, dot])
  })

  it('leaves a circle the box lies inside of, which it does not touch', () => {
    expect(piecesInBox(sketch, rect(0, 0, 10, 12), true)).not.toContain(round)
    expect(piecesInBox(sketch, rect(-60, -60, 60, 60), false)).toContain(round)
  })

  it('reads a turned box the same, whichever way round its corners run', () => {
    // A diamond about (5, 5): the ring of radius 2 pokes out of one reaching
    // 2.5 each way — its sides lie 1.77 from the centre — though it fits
    // the square box of the same reach; one reaching 3 holds it.
    const diamond = (k: number): Vec2[] => [
      [5, 5 - k],
      [5 + k, 5],
      [5, 5 + k],
      [5 - k, 5],
    ]
    expect(piecesInBox(sketch, rect(2.5, 2.5, 7.5, 7.5), false)).toEqual([ring])
    expect(piecesInBox(sketch, diamond(2.5), false)).toEqual([])
    expect(piecesInBox(sketch, diamond(3), false)).toEqual([ring])
    expect(piecesInBox(sketch, [...diamond(3)].reverse(), false)).toEqual([ring])
    // Reaching 8.5 it holds the inner line, the bulge and the point too.
    expect(piecesInBox(sketch, diamond(8.5), false)).toEqual([inner, bulge, ring, dot])
    // The inner line's end (4, 4) lies in the small diamond, the start of
    // the line across on its tip; the bulge stays below it.
    expect(piecesInBox(sketch, diamond(2.5), true)).toEqual([inner, across, ring])
    expect(piecesInBox(sketch, diamond(8.5), true)).not.toContain(away)
  })

  it('takes nothing for a box with no area', () => {
    expect(piecesInBox(sketch, rect(3, 3, 3, 9), true)).toEqual([])
  })
})
