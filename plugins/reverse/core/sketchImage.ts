// SPDX-License-Identifier: AGPL-3.0-only
// A picture laid under a sketch to trace: a photo of the part, a page of
// its datasheet — placed on the sheet in millimetres, brought to scale by
// two points on it a known length apart, moved by a point on it and where
// that point belongs, levelled by two points that should lie level. Plain
// data in sheet millimetres (u, v), the picture itself a data URL, so a
// sketch with one saves as it is (see SketchFeature.image).

import type { Vec2 } from '../../../src/core/flat/types'
import { add2, len2, scale2, sub2 } from '../../../src/core/flat/vec2'

export interface SketchImage {
  /** The picture, as a data URL — scaled down to IMAGE_MAX_PX on its longer
   *  side when it was laid in. */
  src: string
  /** Its size in pixels. */
  width: number
  height: number
  /** Where its bottom-left corner lies on the sheet, mm. */
  origin: Vec2
  /** Millimetres per pixel. */
  mmPerPx: number
  /** Turned counter-clockwise about its bottom-left corner, degrees. */
  angleDeg: number
  /** How much of it shows, 0–1: through it, the scan and the pieces. */
  opacity: number
  /** The file it came from. */
  name?: string
}

/** The longest side a picture is kept at, pixels: past this a photo is
 *  sharper than a sketch is traced, and heavier than a project should be. */
export const IMAGE_MAX_PX = 2400

/** How wide a picture is laid in before it is brought to scale, mm. */
const IMAGE_START_WIDTH_MM = 100

/** A picture of the given size laid in `width` millimetres wide, its centre
 *  at `centre`. */
export function placedImage(src: string, width: number, height: number, centre: Vec2, name?: string): SketchImage {
  const mmPerPx = IMAGE_START_WIDTH_MM / Math.max(1, width)
  return { src, width, height, origin: [centre[0] - (width * mmPerPx) / 2, centre[1] - (height * mmPerPx) / 2], mmPerPx, angleDeg: 0, opacity: 0.6, ...(name ? { name } : {}) }
}

const turn = (v: Vec2, deg: number): Vec2 => {
  const a = (deg * Math.PI) / 180
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]
}

/** A point of the picture, in its pixels from the bottom-left, on the
 *  sheet. */
export function imagePoint(img: SketchImage, px: Vec2): Vec2 {
  return add2(img.origin, turn(scale2(px, img.mmPerPx), img.angleDeg))
}

/** The picture's corners on the sheet, bottom-left round counter-
 *  clockwise. */
export function imageCorners(img: SketchImage): [Vec2, Vec2, Vec2, Vec2] {
  return [imagePoint(img, [0, 0]), imagePoint(img, [img.width, 0]), imagePoint(img, [img.width, img.height]), imagePoint(img, [0, img.height])]
}

/** The picture brought to scale: the two sheet points `a` and `b`, picked
 *  on it, are `length` millimetres apart on the part. It grows or shrinks
 *  about `a`, which stays where it is. Null when the points are one. */
export function scaleImage(img: SketchImage, a: Vec2, b: Vec2, length: number): SketchImage | null {
  const now = len2(sub2(b, a))
  if (!(now > 1e-9) || !(length > 0)) return null
  const k = length / now
  return { ...img, mmPerPx: img.mmPerPx * k, origin: add2(a, scale2(sub2(img.origin, a), k)) }
}

/** The picture moved so the point of it at `from` lies at `to`. */
export function moveImage(img: SketchImage, from: Vec2, to: Vec2): SketchImage {
  return { ...img, origin: add2(img.origin, sub2(to, from)) }
}

/** The picture turned about `a` so the line from `a` to `b` runs level —
 *  along the sheet's X, the way it points nearest. Null when the points
 *  are one. */
export function levelImage(img: SketchImage, a: Vec2, b: Vec2): SketchImage | null {
  const d = sub2(b, a)
  if (!(len2(d) > 1e-9)) return null
  let deg = (-Math.atan2(d[1], d[0]) * 180) / Math.PI
  // Picked right to left, the line still lies level, not upside down.
  if (deg > 90) deg -= 180
  if (deg < -90) deg += 180
  return turnImage(img, deg, a)
}

/** The picture turned by `deg` counter-clockwise about the sheet point
 *  `about`. */
export function turnImage(img: SketchImage, deg: number, about: Vec2): SketchImage {
  const angle = (((img.angleDeg + deg) % 360) + 540) % 360 - 180
  return { ...img, angleDeg: Math.abs(angle) < 1e-9 ? 0 : angle, origin: add2(about, turn(sub2(img.origin, about), deg)) }
}
