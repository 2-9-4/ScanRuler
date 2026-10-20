// SPDX-License-Identifier: AGPL-3.0-only
// A section as a picture, for whoever cannot look at the 2D sheet — an
// agent checking a slice against what it built: the scan's cut as points,
// the outlines a workspace draws (a model's cut, sectionLayers.ts) as
// lines, a sketch's pieces with their ids, and every scan point further
// than the tolerance from the outlines in red — so a wrong round shows as
// its own red crescent and nothing else does. The sheet lies as the
// section has it, +u right and +v up, a grid ruled in millimetres with its
// values at the margins and a scale bar, so a place seen in the picture
// reads straight back as [u, v].
//
// The model (sectionPictureModel) is plain numbers, tested without a
// browser; the drawing needs OffscreenCanvas.

import type { Vec2 } from '../core/flat/types'
import type { SectionOutline, SectionPiece } from '../commands/sectionLayers'
import { pictureFrame, pictureGridStep, type PictureFrame } from './flatPicture'

export interface SectionPictureInput {
  /** The scan's cut on the sheet: [u, v] pairs, flat. */
  scan: Float32Array | readonly number[]
  outlines: readonly SectionOutline[]
  pieces: readonly SectionPiece[]
  /** ± mm a point may lie off the outlines and still be on them. */
  tolerance: number
  /** What the picture looks at: a place and the size of the square round
   *  it, mm on the sheet — everything there is when left out. */
  frame?: { at: Vec2; size: number }
  width?: number
  height?: number
  /** Which world direction each of the sheet's axes runs along — see
   *  sheetAxes. Drawn in the margins; on an axis that runs along a world
   *  axis, the grid's values are that world coordinate. */
  axes?: { u: SheetAxis; v: SheetAxis }
}

/** One of a sheet's axes against the world's: the world axis it runs
 *  nearest, signed ("+X", "−Z"), how far off that it turns, degrees, and —
 *  when it runs along it — the world coordinate at the sheet's 0. */
export interface SheetAxis {
  axis: string
  offDeg: number
  /** The world coordinate at the sheet's 0, when offDeg is 0. */
  at0?: number
}

/** Turns under this are none: the sheet's axis runs along the world's. */
const ALONG_DEG = 0.01

/** Which world axis each of a sheet's axes runs along, or nearly. */
export function sheetAxes(origin: readonly number[], basisU: readonly number[], basisV: readonly number[]): { u: SheetAxis; v: SheetAxis } {
  const one = (b: readonly number[]): SheetAxis => {
    let k = 0
    for (let i = 1; i < 3; i++) if (Math.abs(b[i]) > Math.abs(b[k])) k = i
    const len = Math.hypot(b[0], b[1], b[2]) || 1
    const offDeg = (Math.acos(Math.min(1, Math.abs(b[k]) / len)) * 180) / Math.PI
    const axis = `${b[k] < 0 ? '−' : '+'}${'XYZ'[k]}`
    return offDeg < ALONG_DEG ? { axis, offDeg: 0, at0: origin[k] } : { axis, offDeg: Math.round(offDeg * 100) / 100 }
  }
  return { u: one(basisU), v: one(basisV) }
}

/** The value a grid line at `t` on a sheet's axis is labelled with: the
 *  world coordinate there when the axis runs along a world axis, the
 *  sheet's own otherwise. */
function tickValue(axis: SheetAxis | undefined, t: number): number {
  const v = !axis || axis.at0 === undefined ? t : axis.at0 + (axis.axis.startsWith('−') ? -t : t)
  // A hair off zero, or −0, prints as −0.
  return Math.abs(v) < 1e-9 ? 0 : v
}

/** How a scan point reads against the outlines: on them within the
 *  tolerance, off them — outside the material, or inside it — or not read,
 *  with no outline within `reach` of it (a part the model has not got
 *  yet, which is no gap of this outline's). */
export const Gap = { Unread: 0, On: 1, Outside: 2, Inside: 3 } as const

export interface SectionPictureModel {
  frame: PictureFrame
  /** Per scan point, its reading (Gap), and its distance to the nearest
   *  outline, mm (NaN unread). */
  reading: Uint8Array
  distance: Float32Array
  gap: {
    points: number
    read: number
    over: number
    outside: number
    inside: number
    max: number
    rms: number
    /** The box round the points over the tolerance on the sheet, null with
     *  none — where to frame the next look. */
    overBox: { min: Vec2; max: Vec2 } | null
  }
}

/** How far from the outlines a scan point is still read against them:
 *  ten tolerances, a millimetre at least. */
const reachOf = (tolerance: number) => Math.max(1, 10 * tolerance)

/** The distance from p to the segment a–b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const ll = dx * dx + dy * dy
  const t = ll > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / ll)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Whether p lies inside a closed outline (even–odd). */
function insideOf(o: SectionOutline, px: number, py: number): boolean {
  let inside = false
  const pts = o.points
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The picture's numbers: its frame, and each scan point read against the
 *  outlines. */
export function sectionPictureModel(input: SectionPictureInput): SectionPictureModel {
  const { scan, outlines, tolerance } = input
  const n = Math.floor(scan.length / 2)
  const reach = reachOf(tolerance)
  // Segments with a box each, so a point is held against the few near it.
  const segs: number[] = []
  for (const o of outlines) {
    const pts = o.points
    const count = o.closed ? pts.length : pts.length - 1
    for (let i = 0; i < count; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      segs.push(a[0], a[1], b[0], b[1])
    }
  }
  // A coarse grid of the segments, a reach to the cell.
  const cell = reach
  const grid = new Map<string, number[]>()
  const key = (i: number, j: number) => `${i},${j}`
  for (let s = 0; s < segs.length; s += 4) {
    const i0 = Math.floor(Math.min(segs[s], segs[s + 2]) / cell)
    const i1 = Math.floor(Math.max(segs[s], segs[s + 2]) / cell)
    const j0 = Math.floor(Math.min(segs[s + 1], segs[s + 3]) / cell)
    const j1 = Math.floor(Math.max(segs[s + 1], segs[s + 3]) / cell)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j)
      const list = grid.get(k)
      if (list) list.push(s)
      else grid.set(k, [s])
    }
  }
  const reading = new Uint8Array(n)
  const distance = new Float32Array(n).fill(Number.NaN)
  let read = 0
  let over = 0
  let outside = 0
  let inside = 0
  let max = 0
  let sum = 0
  let lo: Vec2 = [Infinity, Infinity]
  let hi: Vec2 = [-Infinity, -Infinity]
  const closed = outlines.filter((o) => o.closed && o.points.length > 2)
  for (let p = 0; p < n; p++) {
    const x = scan[p * 2]
    const y = scan[p * 2 + 1]
    const ci = Math.floor(x / cell)
    const cj = Math.floor(y / cell)
    let d = Infinity
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      for (const s of grid.get(key(i, j)) ?? []) d = Math.min(d, segmentDistance(x, y, segs[s], segs[s + 1], segs[s + 2], segs[s + 3]))
    }
    if (!(d <= reach)) continue
    read++
    distance[p] = d
    sum += d * d
    if (d <= tolerance) {
      reading[p] = Gap.On
      continue
    }
    max = Math.max(max, d)
    over++
    const within = closed.some((o) => insideOf(o, x, y))
    reading[p] = within ? Gap.Inside : Gap.Outside
    if (within) inside++
    else outside++
    lo = [Math.min(lo[0], x), Math.min(lo[1], y)]
    hi = [Math.max(hi[0], x), Math.max(hi[1], y)]
  }

  // The frame: what was asked for, or everything — the scan's cut and
  // the outlines — with a margin.
  let box: { min: Vec2; max: Vec2 }
  if (input.frame) {
    const h = input.frame.size / 2
    box = { min: [input.frame.at[0] - h, input.frame.at[1] - h], max: [input.frame.at[0] + h, input.frame.at[1] + h] }
  } else {
    let a: Vec2 = [Infinity, Infinity]
    let b: Vec2 = [-Infinity, -Infinity]
    const take = (x: number, y: number) => {
      a = [Math.min(a[0], x), Math.min(a[1], y)]
      b = [Math.max(b[0], x), Math.max(b[1], y)]
    }
    for (let p = 0; p < n; p++) take(scan[p * 2], scan[p * 2 + 1])
    for (const o of outlines) for (const q of o.points) take(q[0], q[1])
    for (const piece of input.pieces) for (const q of piece.points) take(q[0], q[1])
    if (!Number.isFinite(a[0])) {
      a = [-1, -1]
      b = [1, 1]
    }
    const m = 0.06 * Math.max(b[0] - a[0], b[1] - a[1], 1e-3)
    box = { min: [a[0] - m, a[1] - m], max: [b[0] + m, b[1] + m] }
  }
  return {
    frame: pictureFrame(box, input.width, input.height),
    reading,
    distance,
    gap: { points: n, read, over, outside, inside, max, rms: read > 0 ? Math.sqrt(sum / read) : 0, overBox: over > 0 ? { min: lo, max: hi } : null },
  }
}

type Ctx = OffscreenCanvasRenderingContext2D

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const GRID = 'rgba(40, 90, 200, 0.2)'
const GRID_ZERO = 'rgba(40, 90, 200, 0.6)'
const SCAN_ON = '#8a929c'
const SCAN_UNREAD = '#c4c9cf'
const OVER = '#e0301e'
const OUTLINE = '#1f4fa8'
const PIECE = '#c47a12'

/** The picture drawn into `ctx`, a canvas the frame's size. */
export function drawSectionPicture(ctx: Ctx, input: SectionPictureInput, model: SectionPictureModel, title: string): void {
  const { left, top, unitsPerPx: u, width: W, height: H } = model.frame
  const X = (x: number) => (x - left) / u
  const Y = (y: number) => (top - y) / u
  const fontPx = W > 1000 || H > 1000 ? 14 : 12
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // The grid, its values at the top and left margins.
  const step = pictureGridStep(model.frame)
  ctx.lineWidth = 1
  ctx.font = `${fontPx - 1}px ${FONT}`
  ctx.fillStyle = '#4a5260'
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  for (let k = Math.ceil(left / step); k * step <= left + W * u; k++) {
    const x = Math.round(X(k * step)) + 0.5
    ctx.strokeStyle = k === 0 ? GRID_ZERO : GRID
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(tickValue(input.axes?.u, k * step).toFixed(decimals), x, 2)
  }
  for (let k = Math.ceil((top - H * u) / step); k * step <= top; k++) {
    const y = Math.round(Y(k * step)) + 0.5
    ctx.strokeStyle = k === 0 ? GRID_ZERO : GRID
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(tickValue(input.axes?.v, k * step).toFixed(decimals), 2, y)
  }

  // Which world direction runs across and up, in the margins: the grid's
  // values are that world coordinate where the sheet runs along it.
  if (input.axes) {
    const name = (a: SheetAxis) => (a.offDeg === 0 ? `${a.axis[1]} (world)` : `≈ ${a.axis}, ${a.offDeg}° off — sheet mm`)
    const across = `→ ${input.axes.u.offDeg === 0 ? input.axes.u.axis : name(input.axes.u)}${input.axes.u.offDeg === 0 ? ` — values are ${input.axes.u.axis[1]}` : ''}`
    const up = `↑ ${input.axes.v.offDeg === 0 ? input.axes.v.axis : name(input.axes.v)}${input.axes.v.offDeg === 0 ? ` — values are ${input.axes.v.axis[1]}` : ''}`
    ctx.font = `bold ${fontPx}px ${FONT}`
    for (const [text, x, y, align] of [[across, W - 8, H - 8, 'right'], [up, 8 * fontPx, 2 * fontPx + 12, 'left']] as const) {
      const w = ctx.measureText(text).width
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.fillRect(align === 'right' ? x - w - 4 : x - 4, y - fontPx - 2, w + 8, fontPx + 6)
      ctx.fillStyle = '#20252c'
      ctx.textAlign = align
      ctx.textBaseline = 'bottom'
      ctx.fillText(text, x, y)
    }
  }

  // The outlines, then the scan over them: the points off the outlines
  // last and largest, so nothing hides one.
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 1.5
  for (const o of input.outlines) {
    if (o.points.length < 2) continue
    ctx.beginPath()
    ctx.moveTo(X(o.points[0][0]), Y(o.points[0][1]))
    for (let i = 1; i < o.points.length; i++) ctx.lineTo(X(o.points[i][0]), Y(o.points[i][1]))
    if (o.closed) ctx.closePath()
    ctx.stroke()
  }
  const n = model.reading.length
  const dot = (p: number, r: number) => ctx.fillRect(X(input.scan[p * 2]) - r, Y(input.scan[p * 2 + 1]) - r, 2 * r, 2 * r)
  ctx.fillStyle = SCAN_UNREAD
  for (let p = 0; p < n; p++) if (model.reading[p] === Gap.Unread) dot(p, 1)
  ctx.fillStyle = SCAN_ON
  for (let p = 0; p < n; p++) if (model.reading[p] === Gap.On) dot(p, 1)
  ctx.fillStyle = OVER
  for (let p = 0; p < n; p++) if (model.reading[p] === Gap.Outside || model.reading[p] === Gap.Inside) dot(p, 1.8)

  // The pieces dashed, so the outline under one still shows, each with its
  // label halfway along it.
  ctx.strokeStyle = PIECE
  ctx.lineWidth = 1.5
  ctx.font = `bold ${fontPx}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const piece of input.pieces) {
    if (piece.points.length < 2) continue
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(X(piece.points[0][0]), Y(piece.points[0][1]))
    for (let i = 1; i < piece.points.length; i++) ctx.lineTo(X(piece.points[i][0]), Y(piece.points[i][1]))
    ctx.stroke()
    ctx.setLineDash([])
    const mid = halfway(piece.points)
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.strokeText(piece.label, X(mid[0]), Y(mid[1]))
    ctx.fillStyle = PIECE
    ctx.fillText(piece.label, X(mid[0]), Y(mid[1]))
    ctx.strokeStyle = PIECE
    ctx.lineWidth = 1.5
  }

  // A scale bar at the bottom left, and the title with the reading.
  const bar = pictureGridStep(model.frame)
  const bx = 14
  const by = H - 14
  ctx.fillStyle = '#20252c'
  ctx.fillRect(bx, by - 3, bar / u, 3)
  ctx.font = `${fontPx}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${bar} mm`, bx, by - 5)
  const g = model.gap
  const line = `${title} — ±${input.tolerance} mm: ${g.over} of ${g.read} points over (red)${g.over > 0 ? `, up to ${g.max.toFixed(3)} mm` : ''}`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  const w = ctx.measureText(line).width
  ctx.fillRect(W - w - 16, 2, w + 12, fontPx + 8)
  ctx.fillStyle = '#20252c'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(line, W - 8, 6)
}

/** The point halfway along a polyline. */
export function halfway(points: readonly Vec2[]): Vec2 {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  let left = total / 2
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (d >= left && d > 0) return [a[0] + ((b[0] - a[0]) * left) / d, a[1] + ((b[1] - a[1]) * left) / d]
    left -= d
  }
  return points[points.length - 1]
}

/** The picture as PNG bytes, with its model. Needs OffscreenCanvas — a
 *  browser. */
export async function sectionPicturePng(input: SectionPictureInput, title: string): Promise<{ bytes: Uint8Array; model: SectionPictureModel }> {
  const model = sectionPictureModel(input)
  const canvas = new OffscreenCanvas(model.frame.width, model.frame.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser gave no canvas to draw the section on.')
  drawSectionPicture(ctx, input, model, title)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), model }
}

/** Several pictures side by side as one PNG, `cols` to a row, each tile
 *  drawn at its own input's size (they are meant to share one) and named
 *  by its title in its corner. Needs OffscreenCanvas — a browser. */
export async function sectionSheetsPng(
  tiles: readonly { input: SectionPictureInput; title: string }[],
  cols: number,
): Promise<{ bytes: Uint8Array; models: SectionPictureModel[]; width: number; height: number }> {
  const models = tiles.map((t) => sectionPictureModel(t.input))
  const tw = Math.max(...models.map((m) => m.frame.width))
  const th = Math.max(...models.map((m) => m.frame.height))
  const rows = Math.ceil(tiles.length / cols)
  const canvas = new OffscreenCanvas(tw * cols, th * rows)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser gave no canvas to draw the sections on.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  tiles.forEach((t, i) => {
    const x = (i % cols) * tw
    const y = Math.floor(i / cols) * th
    ctx.save()
    ctx.translate(x, y)
    ctx.beginPath()
    ctx.rect(0, 0, tw, th)
    ctx.clip()
    drawSectionPicture(ctx, t.input, models[i], t.title)
    ctx.restore()
    ctx.strokeStyle = '#8a929c'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1)
  })
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), models, width: canvas.width, height: canvas.height }
}
