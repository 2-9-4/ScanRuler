// SPDX-License-Identifier: AGPL-3.0-only
// Parts on a flatbed scan: found by threshold, measured in document units,
// handed back in reading order.
import { describe, expect, it } from 'vitest'
import { findObjects, otsuThreshold } from '../src/core/flat/objects'
import { mulberry32 } from '../src/core/fit/ransac'

type Shape = (x: number, y: number) => boolean

const disc =
  (cx: number, cy: number, r: number): Shape =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r

/** A rectangle `w` long along `angle` (degrees from +X) and `h` across it. */
const rect =
  (cx: number, cy: number, w: number, h: number, angle = 0): Shape =>
  (x, y) => {
    const c = Math.cos((angle * Math.PI) / 180)
    const s = Math.sin((angle * Math.PI) / 180)
    const u = (x - cx) * c + (y - cy) * s
    const v = -(x - cx) * s + (y - cy) * c
    return Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2
  }

const minus =
  (a: Shape, b: Shape): Shape =>
  (x, y) =>
    a(x, y) && !b(x, y)

/** A sheet `width × height`, row 0 at the bottom, every pixel whose centre
 *  lies in a shape inked and the rest paper. */
function sheet(width: number, height: number, shapes: Shape[], ink = 0, paper = 255): Uint8Array {
  const gray = new Uint8Array(width * height).fill(paper)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (shapes.some((s) => s(col + 0.5, row + 0.5))) gray[row * width + col] = ink
    }
  }
  return gray
}

const W = 400
const H = 300
/** Three discs across the top of the sheet; below them a plate with a hole
 *  and a bar laid at 30°. */
const SHAPES: Shape[] = [
  disc(60, 230, 30),
  disc(180, 222, 25),
  disc(320, 235, 35),
  minus(rect(110, 75, 140, 80), disc(110, 75, 15)),
  rect(300, 80, 120, 30, 30),
]
const IMAGE = sheet(W, H, SHAPES)
const PX = { x: 1, y: 1 }

/** Twice the signed area of a closed outline — positive when it runs
 *  counter-clockwise. */
function signedArea(outline: Float64Array): number {
  let a = 0
  const n = outline.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += outline[2 * i] * outline[2 * j + 1] - outline[2 * j] * outline[2 * i + 1]
  }
  return a / 2
}

describe('otsuThreshold', () => {
  it('parts two grey levels in the middle of the empty stretch between them', () => {
    const gray = new Uint8Array(1000)
    gray.fill(50, 0, 400)
    gray.fill(200, 400)
    expect(otsuThreshold(gray)).toBe(124)
  })

  it('parts two noisy classes between their peaks', () => {
    const rand = mulberry32(3)
    const gray = new Uint8Array(20000)
    for (let i = 0; i < gray.length; i++) {
      const centre = i % 3 === 0 ? 190 : 60
      gray[i] = Math.round(centre + (rand() + rand() + rand() - 1.5) * 20)
    }
    const t = otsuThreshold(gray)
    expect(t).toBeGreaterThan(90)
    expect(t).toBeLessThan(160)
  })

  it('returns the one grey of a blank image', () => {
    expect(otsuThreshold(new Uint8Array(100).fill(77))).toBe(77)
  })
})

describe('findObjects', () => {
  const found = findObjects(IMAGE, W, H, { minArea: 20, scale: PX })
  const [d1, d2, d3, plate, bar] = found.objects

  it('decides the polarity from the border and finds every part', () => {
    expect(found.dark).toBe(true)
    expect(found.threshold).toBeGreaterThanOrEqual(0)
    expect(found.threshold).toBeLessThan(255)
    expect(found.objects).toHaveLength(5)
  })

  it('reads the sheet from the top row down, left to right — row 0 is the bottom', () => {
    expect(d1.centroid[0]).toBeCloseTo(60, 0)
    expect(d2.centroid[0]).toBeCloseTo(180, 0)
    expect(d3.centroid[0]).toBeCloseTo(320, 0)
    expect(plate.centroid[1]).toBeLessThan(d1.centroid[1])
    expect(bar.centroid[0]).toBeGreaterThan(plate.centroid[0])
  })

  it('measures discs: area, centroid, equivalent diameter, no holes', () => {
    const discs: [typeof d1, number, number, number][] = [
      [d1, 60, 230, 30],
      [d2, 180, 222, 25],
      [d3, 320, 235, 35],
    ]
    for (const [o, cx, cy, r] of discs) {
      expect(Math.abs(o.area / (Math.PI * r * r) - 1)).toBeLessThan(0.015)
      expect(Math.abs(o.centroid[0] - cx)).toBeLessThan(0.5)
      expect(Math.abs(o.centroid[1] - cy)).toBeLessThan(0.5)
      expect(Math.abs(o.equivalentDiameter / (2 * r) - 1)).toBeLessThan(0.01)
      expect(o.holes).toBe(0)
      // The pixel corners round a disc of radius r span 2r and a pixel's
      // worth at most.
      expect(o.feret.max).toBeGreaterThan(2 * r)
      expect(o.feret.max).toBeLessThan(2 * r + 1.5)
      expect(o.feret.min).toBeGreaterThan(2 * r - 0.5)
    }
  })

  it('counts the hole in the plate and leaves it out of the area', () => {
    expect(plate.holes).toBe(1)
    const expected = 140 * 80 - Math.PI * 15 * 15
    expect(Math.abs(plate.area / expected - 1)).toBeLessThan(0.01)
    expect(plate.box.min).toEqual([40, 35])
    expect(plate.box.max).toEqual([180, 115])
    expect(plate.feret.max).toBeCloseTo(Math.hypot(140, 80), 6)
    expect(plate.feret.min).toBeCloseTo(80, 6)
    expect(plate.feret.minAngle).toBeCloseTo(Math.PI / 2, 6)
  })

  it('measures a bar laid askew: Feret length and width, principal axis', () => {
    expect(Math.abs(bar.area / (120 * 30) - 1)).toBeLessThan(0.01)
    expect(bar.axisAngle).toBeCloseTo(Math.PI / 6, 2)
    // The diagonal is the largest caliper width of a rectangle, its width the
    // smallest — each a pixel's corners wider than the ideal at most.
    expect(Math.abs(bar.feret.max - Math.hypot(120, 30))).toBeLessThan(1.5)
    expect(Math.abs(bar.feret.min - 30)).toBeLessThan(1.5)
    // Measured square to the length: 30° + 90°, folded to -60°.
    expect(bar.feret.minAngle).toBeCloseTo(-Math.PI / 3, 1)
  })

  it('gives an upright bar an axis of +90°, not -90°', () => {
    const tall = findObjects(sheet(60, 160, [rect(30, 80, 20, 100)]), 60, 160, { minArea: 1, scale: PX })
    expect(tall.objects[0].axisAngle).toBe(Math.PI / 2)
    expect(tall.objects[0].feret.minAngle).toBeCloseTo(0, 9)
    // Either diagonal, both being as long.
    expect(Math.abs(tall.objects[0].feret.maxAngle)).toBeCloseTo(Math.atan2(100, 20), 9)
  })

  it('traces the outline closed and counter-clockwise, on pixel centres of the object', () => {
    for (const [index, o] of found.objects.entries()) {
      const n = o.outline.length / 2
      expect(n).toBeGreaterThan(20)
      expect(o.outline[0] !== o.outline[2 * n - 2] || o.outline[1] !== o.outline[2 * n - 1]).toBe(true)
      expect(signedArea(o.outline)).toBeGreaterThan(0)
      for (let i = 0; i < n; i++) {
        expect(o.outline[2 * i] % 1).toBe(0.5)
        expect(found.objectAt(o.outline[2 * i], o.outline[2 * i + 1])).toBe(index)
      }
      // Consecutive points are 8-neighbours.
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        expect(Math.abs(o.outline[2 * j] - o.outline[2 * i])).toBeLessThanOrEqual(1)
        expect(Math.abs(o.outline[2 * j + 1] - o.outline[2 * i + 1])).toBeLessThanOrEqual(1)
      }
    }
    // The disc's outline, through its edge pixels' centres, encloses a little
    // under the disc.
    const enclosed = signedArea(d1.outline)
    expect(enclosed).toBeLessThan(d1.area)
    expect(enclosed / d1.area).toBeGreaterThan(0.95)
  })

  it('answers which object covers a point, and nothing in a hole or off the sheet', () => {
    expect(found.objectAt(60, 230)).toBe(0)
    expect(found.objectAt(320, 235)).toBe(2)
    expect(found.objectAt(50, 75)).toBe(3)
    expect(found.objectAt(300, 80)).toBe(4)
    expect(found.objectAt(110, 75)).toBe(-1)
    expect(found.objectAt(200, 150)).toBe(-1)
    expect(found.objectAt(-5, 10)).toBe(-1)
    expect(found.objectAt(400.5, 10)).toBe(-1)
    expect(found.objectAt(10, 300)).toBe(-1)
    expect(found.objectAt(Number.NaN, 10)).toBe(-1)
  })

  it('finds light parts on a dark background by itself', () => {
    const light = findObjects(sheet(W, H, SHAPES, 255, 0), W, H, { minArea: 20, scale: PX })
    expect(light.dark).toBe(false)
    expect(light.objects.map((o) => o.area)).toEqual(found.objects.map((o) => o.area))
    expect(light.objects[3].holes).toBe(1)
  })

  it('takes a threshold and polarity when given', () => {
    const grey = sheet(W, H, SHAPES, 100, 160)
    const given = findObjects(grey, W, H, { minArea: 20, scale: PX, threshold: 130, dark: true })
    expect(given.threshold).toBe(130)
    expect(given.objects).toHaveLength(5)
    // The other polarity takes the paper for the part: the sheet with five
    // holes, and the island of paper inside the plate's hole.
    const flipped = findObjects(grey, W, H, { minArea: 20, scale: PX, threshold: 130, dark: false })
    expect(flipped.objects.map((o) => o.holes).sort()).toEqual([0, 5])
  })

  it('drops specks under the smallest area', () => {
    const specks = [...SHAPES, rect(11, 11, 2, 2), rect(390.5, 150.5, 3, 3)]
    const image = sheet(W, H, specks)
    expect(findObjects(image, W, H, { minArea: 20, scale: PX }).objects).toHaveLength(5)
    const all = findObjects(image, W, H, { minArea: 1, scale: PX })
    expect(all.objects).toHaveLength(7)
    expect(all.objects.map((o) => o.area).sort((a, b) => a - b).slice(0, 2)).toEqual([4, 9])
  })

  it('measures in document units under a scale that differs along X and Y', () => {
    const scaled = findObjects(IMAGE, W, H, { minArea: 0.4, scale: { x: 0.1, y: 0.2 } })
    expect(scaled.objects).toHaveLength(5)
    const [s1, , , sPlate] = scaled.objects
    expect(sPlate.area).toBeCloseTo(plate.area * 0.02, 9)
    expect(sPlate.box.min[0]).toBeCloseTo(4, 9)
    expect(sPlate.box.min[1]).toBeCloseTo(7, 9)
    expect(sPlate.feret.max).toBeCloseTo(Math.hypot(14, 16), 9)
    expect(sPlate.feret.min).toBeCloseTo(14, 9)
    expect(sPlate.feret.minAngle).toBeCloseTo(0, 9)
    // The disc in pixels is an ellipse on the sheet, twice as tall as wide.
    expect(s1.centroid[0]).toBeCloseTo(d1.centroid[0] * 0.1, 9)
    expect(s1.centroid[1]).toBeCloseTo(d1.centroid[1] * 0.2, 9)
    expect(Math.abs(s1.axisAngle)).toBeCloseTo(Math.PI / 2, 2)
    expect(Math.abs(s1.feret.max - 12)).toBeLessThan(0.35)
    expect(Math.abs(s1.feret.min - 6)).toBeLessThan(0.15)
    // Up the sheet, give or take the tilt of a chord from corner to corner of
    // the flat runs that end a digitised disc.
    expect(Math.abs(s1.feret.maxAngle)).toBeGreaterThan(Math.PI / 2 - 0.12)
    expect(s1.equivalentDiameter).toBeCloseTo(Math.sqrt((4 * s1.area) / Math.PI), 9)
    expect(scaled.objectAt(6, 46)).toBe(0)
    expect(scaled.objectAt(11, 15)).toBe(-1)
  })

  it('counts holes by size, and gives a hole to the object round it, not the one inside it', () => {
    const shapes = [
      // A ring with a disc standing in its hole.
      minus(disc(50, 50, 40), disc(50, 50, 25)),
      disc(50, 50, 12),
      // A disc with two holes and a speck of glare.
      minus(minus(minus(disc(150, 50, 40), disc(135, 50, 8)), disc(165, 50, 8)), rect(150, 75, 1, 1)),
    ]
    const image = sheet(220, 100, shapes)
    const counted = findObjects(image, 220, 100, { minArea: 20, scale: PX })
    expect(counted.objects).toHaveLength(3)
    const ring = counted.objects[counted.objectAt(50, 15)]
    const inner = counted.objects[counted.objectAt(50, 50)]
    const holed = counted.objects[counted.objectAt(150, 30)]
    expect(ring.holes).toBe(1)
    expect(inner.holes).toBe(0)
    expect(holed.holes).toBe(2)
    expect(findObjects(image, 220, 100, { minArea: 20, minHoleArea: 0, scale: PX }).objects.map((o) => o.holes)).toContain(3)
  })

  it('does not call a bay open to the image edge a hole', () => {
    // A frame cut by the left edge of the image.
    const frame = minus(rect(30, 50, 80, 60), rect(20, 50, 80, 30))
    const open = findObjects(sheet(100, 100, [frame]), 100, 100, { minArea: 1, scale: PX })
    expect(open.objects).toHaveLength(1)
    expect(open.objects[0].holes).toBe(0)
  })

  it('keeps a part pressed against the image edge', () => {
    const edge = findObjects(sheet(100, 100, [rect(10, 50, 40, 20)]), 100, 100, { minArea: 1, scale: PX })
    expect(edge.objects).toHaveLength(1)
    expect(edge.objects[0].area).toBe(30 * 20)
    expect(edge.objects[0].box.min).toEqual([0, 40])
  })

  it('joins pixels that touch only at a corner into one object', () => {
    const gray = new Uint8Array(16).fill(255)
    gray[0] = 0
    gray[5] = 0
    gray[10] = 0
    const diagonal = findObjects(gray, 4, 4, { minArea: 1, scale: PX, dark: true, threshold: 128 })
    expect(diagonal.objects).toHaveLength(1)
    expect(diagonal.objects[0].area).toBe(3)
    expect(Array.from(diagonal.objects[0].outline)).toEqual([0.5, 0.5, 1.5, 1.5, 2.5, 2.5, 1.5, 1.5])
  })

  it('finds nothing on a blank sheet', () => {
    const blank = findObjects(new Uint8Array(50 * 40).fill(200), 50, 40, { minArea: 1, scale: PX })
    expect(blank.objects).toHaveLength(0)
    expect(blank.objectAt(10, 10)).toBe(-1)
  })
})
