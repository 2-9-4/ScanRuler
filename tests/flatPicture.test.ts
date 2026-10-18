// SPDX-License-Identifier: AGPL-3.0-only
// Where a picture of the 2D sheet lies on the sheet: its frame holds the box
// asked for at one length per pixel both ways, and its grid is a 1-2-5 step
// wide enough to write values at.
import { describe, expect, it } from 'vitest'
import { pictureFrame, pictureGridStep } from '../src/app/flatPicture'

describe('the picture of the sheet', () => {
  it('takes the box’s own shape, 800 pixels on the long side by default', () => {
    const f = pictureFrame({ min: [0, 0], max: [200, 100] })
    expect([f.width, f.height]).toEqual([800, 400])
    expect(f.unitsPerPx).toBeCloseTo(0.25)
    expect([f.left, f.top]).toEqual([0, 100])
  })

  it('keeps the shape with one side asked for, and centres the box in two', () => {
    expect(pictureFrame({ min: [0, 0], max: [100, 200] }, undefined, 1000)).toMatchObject({ width: 500, height: 1000 })
    const f = pictureFrame({ min: [10, 10], max: [20, 20] }, 400, 200)
    expect(f.unitsPerPx).toBeCloseTo(0.05)
    // 400 × 0.05 = 20 across: the box's 10 in the middle, 5 either side.
    expect(f.left).toBeCloseTo(5)
    expect(f.top).toBeCloseTo(20)
    // A picture pixel's place: [left + c·u, top − r·u].
    expect(f.left + 200 * f.unitsPerPx).toBeCloseTo(15)
    expect(f.top - 100 * f.unitsPerPx).toBeCloseTo(15)
  })

  it('stays within 64 to 2048 pixels a side', () => {
    const thin = pictureFrame({ min: [0, 0], max: [1000, 1] })
    expect([thin.width, thin.height]).toEqual([800, 64])
    expect(thin.unitsPerPx).toBeCloseTo(1.25)
    expect(pictureFrame({ min: [0, 0], max: [1, 1] }, 5000).width).toBe(2048)
  })

  it('rules the grid on a 1-2-5 step at least 72 pixels apart, however far in', () => {
    const step = (u: number) => pictureGridStep({ left: 0, top: 0, width: 800, height: 800, unitsPerPx: u })
    expect(step(0.25)).toBe(20)
    expect(step(0.01)).toBe(1)
    expect(step(0.0004)).toBeCloseTo(0.05)
    expect(step(30)).toBe(5000)
  })
})
