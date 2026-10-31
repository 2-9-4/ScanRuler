// SPDX-License-Identifier: AGPL-3.0-only
// A picture under a sketch: laid in, brought to scale by two points a known
// length apart, moved by a point and where it belongs, levelled by two
// points that should lie level — and kept with the sketch, through the
// sketch editor's clicks.

import { beforeEach, describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import { imageCorners, imagePoint, levelImage, moveImage, placedImage, scaleImage, turnImage } from '../core/sketchImage'
import { useReverse } from '../state/reStore'

const near = (a: Vec2, b: Vec2, digits = 9) => {
  expect(a[0]).toBeCloseTo(b[0], digits)
  expect(a[1]).toBeCloseTo(b[1], digits)
}

describe('the picture under a sketch', () => {
  it('is laid in a hundred millimetres wide about the centre given', () => {
    const img = placedImage('data:', 1000, 500, [10, 20])
    expect(img.mmPerPx).toBeCloseTo(0.1, 12)
    near(imageCorners(img)[0], [-40, -5])
    near(imageCorners(img)[2], [60, 45])
  })

  it('comes to scale by two points a known length apart, the first staying put', () => {
    const img = placedImage('data:', 1000, 500, [0, 0])
    // Two marks on it 30 mm apart on the sheet that are 45 mm on the part.
    const a: Vec2 = [-10, 0]
    const b: Vec2 = [20, 0]
    const scaled = scaleImage(img, a, b, 45)!
    expect(scaled.mmPerPx).toBeCloseTo(0.15, 12)
    // The pixel under a is under it still; the one under b is 45 mm off.
    const pxA: Vec2 = [(a[0] - img.origin[0]) / img.mmPerPx, (a[1] - img.origin[1]) / img.mmPerPx]
    const pxB: Vec2 = [(b[0] - img.origin[0]) / img.mmPerPx, (b[1] - img.origin[1]) / img.mmPerPx]
    near(imagePoint(scaled, pxA), a)
    near(imagePoint(scaled, pxB), [35, 0])
    expect(scaleImage(img, a, a, 10)).toBeNull()
  })

  it('moves by a point and where it belongs, and turns level about the first of two', () => {
    const img = placedImage('data:', 100, 100, [0, 0])
    near(moveImage(img, [3, 4], [0, 0]).origin, [img.origin[0] - 3, img.origin[1] - 4])
    // A line on the picture at 30° made level, picked either way along it.
    const a: Vec2 = [0, 0]
    const b: Vec2 = [Math.cos(Math.PI / 6) * 10, Math.sin(Math.PI / 6) * 10]
    const level = levelImage(img, a, b)!
    expect(level.angleDeg).toBeCloseTo(-30, 9)
    expect(levelImage(img, b, a)!.angleDeg).toBeCloseTo(-30, 9)
    // The corner a quarter turn round about the origin.
    near(turnImage(img, 90, [0, 0]).origin, [-img.origin[1], img.origin[0]])
  })
})

describe('the picture in the sketch editor', () => {
  const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  const s = () => useReverse.getState()
  beforeEach(() => {
    useReverse.setState({ ...useReverse.getInitialState() }, true)
  })

  it('is scaled, moved and levelled by clicks on the sheet, and kept with the sketch', () => {
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    s().setSketchImage(placedImage('data:image/png;base64,AAAA', 200, 100, [0, 0], 'drawing.png'))
    expect(s().sketchModelShown).toBe(true)
    s().startImagePick('scale')
    s().sketchClick([-50, 0], 0.5, false, { off: true })
    s().sketchClick([50, 0], 0.5, false, { off: true })
    expect(s().sketchDraft!.imagePick!.points).toHaveLength(2)
    s().scaleSketchImage(25)
    expect(s().sketchDraft!.image!.mmPerPx).toBeCloseTo(0.125, 12)
    expect(s().sketchDraft!.imagePick).toBeNull()

    // A point of the picture onto the origin: the second click snaps.
    s().startImagePick('move')
    s().sketchClick([-50, 0], 0.5, false, { off: true })
    s().sketchClick([0.2, 0.1], 0.5, false, {})
    near(imagePoint(s().sketchDraft!.image!, [0, 50]), [0, 0], 6)

    s().startImagePick('level')
    s().sketchClick([0, 0], 0.5, false, { off: true })
    s().sketchClick([10, 10], 0.5, false, { off: true })
    expect(s().sketchDraft!.image!.angleDeg).toBeCloseTo(-45, 9)

    // Nothing drawn, and still a sketch: it holds the picture.
    const id = s().commitSketch()
    const f = s().features.find((x) => x.id === id)
    expect(f?.kind === 'sketch' && f.image?.name).toBe('drawing.png')
    s().editSketch(id!)
    expect(s().sketchDraft!.image?.angleDeg).toBeCloseTo(-45, 9)
    s().setSketchImage(null)
    s().commitSketch()
    expect(s().features.find((x) => x.id === id)?.kind === 'sketch' && (s().features.find((x) => x.id === id) as { image?: unknown }).image).toBeFalsy()
  })
})
