// SPDX-License-Identifier: AGPL-3.0-only
// The numbers behind a section's picture (src/app/sectionPicture.ts): a
// scan cut read against an outline — on it, off it outside or inside the
// material, or too far from any outline to be read — and the frame. The
// drawing needs a browser; e2e checks it.

import { describe, expect, it } from 'vitest'
import { Gap, gridLines, sectionPictureModel, sheetAxes } from '../src/app/sectionPicture'
import type { SectionOutline } from '../src/commands/sectionLayers'

/** A 20 × 20 square outline about the origin. */
const square: SectionOutline = { label: 'Body', points: [[-10, -10], [10, -10], [10, 10], [-10, 10]], closed: true }

/** Points along a square's sides, its top right corner rounded r. */
function roundedSquare(r: number, step = 0.1): number[] {
  const out: number[] = []
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.round(Math.hypot(bx - ax, by - ay) / step)
    for (let i = 0; i < n; i++) out.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)
  }
  line(-10, -10, 10, -10)
  line(10, -10, 10, 10 - r)
  for (let a = 0; a < Math.PI / 2; a += step / r) out.push(10 - r + r * Math.cos(a), 10 - r + r * Math.sin(a))
  line(10 - r, 10, -10, 10)
  line(-10, 10, -10, -10)
  return out
}

describe('a section read against an outline', () => {
  it('puts the gap where the scan is round and the outline sharp, and nowhere else', () => {
    const scan = roundedSquare(3)
    const m = sectionPictureModel({ scan, outlines: [square], pieces: [], tolerance: 0.1 })
    expect(m.gap.points).toBe(scan.length / 2)
    expect(m.gap.read).toBe(m.gap.points)
    expect(m.gap.over).toBeGreaterThan(10)
    // The round lies inside the square's corner: the outline stands proud.
    expect(m.gap.inside).toBe(m.gap.over)
    expect(m.gap.outside).toBe(0)
    // Every point over lies in the corner.
    const box = m.gap.overBox!
    expect(box.min[0]).toBeGreaterThan(10 - 3 - 0.01)
    expect(box.min[1]).toBeGreaterThan(10 - 3 - 0.01)
    // The round's middle stands 3(1 − 1/√2) off the two sides it rounds.
    expect(m.gap.max).toBeCloseTo(3 * (1 - Math.SQRT1_2), 1)
    for (let p = 0; p < m.gap.points; p++) {
      const [x, y] = [scan[p * 2], scan[p * 2 + 1]]
      if (m.reading[p] !== Gap.On) expect(x > 6.9 && y > 6.9).toBe(true)
    }
  })

  it('reads the scan outside the outline as outside, and leaves far points unread', () => {
    // A square 0.5 larger all round: every point 0.5 outside; and a speck
    // far from anything.
    const scan = [...roundedSquare(0.001).map((v) => v * 1.05), 40, 40]
    const m = sectionPictureModel({ scan, outlines: [square], pieces: [], tolerance: 0.1 })
    expect(m.gap.outside).toBe(m.gap.over)
    expect(m.gap.over).toBe(m.gap.read)
    expect(m.reading[m.gap.points - 1]).toBe(Gap.Unread)
    expect(m.gap.read).toBe(m.gap.points - 1)
  })

  it('frames everything with a margin, or the square asked for', () => {
    const m = sectionPictureModel({ scan: roundedSquare(3), outlines: [square], pieces: [], tolerance: 0.1 })
    expect(m.frame.left).toBeLessThan(-10)
    expect(m.frame.top).toBeGreaterThan(10)
    expect(Math.max(m.frame.width, m.frame.height)).toBe(800)
    const close = sectionPictureModel({ scan: roundedSquare(3), outlines: [square], pieces: [], tolerance: 0.1, frame: { at: [8, 8], size: 6 }, width: 600 })
    expect(close.frame.width).toBe(600)
    expect(close.frame.left).toBeCloseTo(5, 6)
    expect(close.frame.unitsPerPx).toBeCloseTo(0.01, 6)
  })
})

describe('a piece’s label', () => {
  it('sits halfway along it, a straight piece too', async () => {
    const { halfway } = await import('../src/app/sectionPicture')
    expect(halfway([[0, 0], [10, 0]])).toEqual([5, 0])
    expect(halfway([[0, 0], [2, 0], [2, 8]])).toEqual([2, 3])
  })
})

describe('which world axes a sheet shows', () => {
  it('names a sheet along the world axes, with the world coordinate at its 0', () => {
    // A YZ sheet at x = 10, u along −Y.
    const a = sheetAxes([10, 3, -2], [0, -1, 0], [0, 0, 1])
    expect(a.u).toEqual({ axis: '−Y', offDeg: 0, at0: 3 })
    expect(a.v).toEqual({ axis: '+Z', offDeg: 0, at0: -2 })
  })

  it('names the nearest world axis of a turned sheet, and how far it turns', () => {
    const t = (5 * Math.PI) / 180
    const a = sheetAxes([0, 0, 0], [Math.cos(t), Math.sin(t), 0], [-Math.sin(t), Math.cos(t), 0])
    expect(a.u.axis).toBe('+X')
    expect(a.u.offDeg).toBeCloseTo(5, 2)
    expect(a.u.at0).toBeUndefined()
    expect(a.v.axis).toBe('+Y')
  })
})

describe('the grid’s lines', () => {
  it('fall on round world values on a sheet whose 0 is not one', () => {
    // A section's sheet: its 0 at the part's centre, X 3.7 — u along +X.
    const along = sheetAxes([3.7, 0, 0], [1, 0, 0], [0, 1, 0]).u
    const lines = gridLines(along, -10, 10, 5)
    expect(lines.map((l) => l.value)).toEqual([-5, 0, 5, 10])
    for (const l of lines) expect(l.at + 3.7).toBeCloseTo(l.value, 9)
    // Along −X the sheet runs the other way: the values fall as u grows.
    const back = sheetAxes([3.7, 0, 0], [-1, 0, 0], [0, 1, 0]).u
    for (const l of gridLines(back, -10, 10, 5)) expect(3.7 - l.at).toBeCloseTo(l.value, 9)
    // An axis off the world's counts sheet mm.
    expect(gridLines({ axis: '+X', offDeg: 3 }, -4, 4, 2).map((l) => [l.at, l.value])).toEqual([[-4, -4], [-2, -2], [0, 0], [2, 2], [4, 4]])
  })
})
