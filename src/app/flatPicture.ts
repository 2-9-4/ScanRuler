// SPDX-License-Identifier: AGPL-3.0-only
// The 2D sheet as a picture, for whoever cannot look at the stage — an agent
// working through the commands. Drawn afresh on a canvas of its own rather
// than captured off the viewport: the stage may be framed anywhere, turned,
// mirrored or not on screen at all, and its labels are HTML a capture of the
// WebGL canvas never sees. Here the sheet lies as it is measured in — +X to
// the right, +Y up, document units — and the grid is ruled in those units
// with its values written along the top and left margins, so a place seen
// in the picture can be read off it and handed straight back as a place to
// click. One picture pixel is the same length both ways, so the mapping is
// two numbers and a scale (see PictureFrame).
//
// The image is drawn as the stage draws it — pixel i spanning [i, i+1) of
// image pixels — and everything over it in the same document units the
// store's readings are in.

import { gridSpacing } from '../core/flat/datum'
import { DRAWING_EDGE_COLOR, DRAWING_NOTE_COLOR, labelSpot } from '../core/flat/drawing'
import type { EdgeChains } from '../core/flat/edges'
import { splineBezierForm } from '../core/flat/spline'
import type { FlatFit, Vec2 } from '../core/flat/types'
import type { SheetCount, SheetDimension, SheetElement } from './flatSheet'

/** Where the picture lies on the sheet: the sheet place at its top-left
 *  corner and the length one picture pixel spans, both ways. Picture pixel
 *  (column c, row r from the top) covers the sheet from
 *  [left + c·unitsPerPx, top − r·unitsPerPx] to one pixel on. */
export interface PictureFrame {
  left: number
  top: number
  unitsPerPx: number
  width: number
  height: number
}

export const PICTURE_MAX_SIDE = 2048
export const PICTURE_MIN_SIDE = 64
/** Enough to read a coordinate off and to check a step by. */
export const PICTURE_DEFAULT_SIDE = 800

const clampSide = (v: number) => Math.max(PICTURE_MIN_SIDE, Math.min(PICTURE_MAX_SIDE, Math.round(v)))

/** The picture that holds `box` (document units): the box's own shape at
 *  the size asked for — the long side PICTURE_DEFAULT_SIDE when neither is
 *  given, one of them alone keeping the shape — or, with both, the box
 *  centred in that shape with the sheet round it filling the rest. */
export function pictureFrame(box: { min: Vec2; max: Vec2 }, width?: number, height?: number): PictureFrame {
  const bw = Math.max(box.max[0] - box.min[0], 1e-9)
  const bh = Math.max(box.max[1] - box.min[1], 1e-9)
  const aspect = bw / bh
  const [w, h] =
    width && height
      ? [clampSide(width), clampSide(height)]
      : width
        ? [clampSide(width), clampSide(width / aspect)]
        : height
          ? [clampSide(height * aspect), clampSide(height)]
          : aspect >= 1
            ? [PICTURE_DEFAULT_SIDE, clampSide(PICTURE_DEFAULT_SIDE / aspect)]
            : [clampSide(PICTURE_DEFAULT_SIDE * aspect), PICTURE_DEFAULT_SIDE]
  const unitsPerPx = Math.max(bw / w, bh / h)
  const cx = (box.min[0] + box.max[0]) / 2
  const cy = (box.min[1] + box.max[1]) / 2
  return { left: cx - (w * unitsPerPx) / 2, top: cy + (h * unitsPerPx) / 2, unitsPerPx, width: w, height: h }
}

/** The grid's spacing in the picture: a 1-2-5 step that leaves its lines
 *  far enough apart for their values to be written at the margin. */
export function pictureGridStep(frame: PictureFrame): number {
  // gridSpacing's ladder stops at 0.1–100; a picture can be framed far
  // tighter or wider, so the ladder is carried by powers of ten.
  const target = frame.unitsPerPx * 72
  const decade = 10 ** Math.floor(Math.log10(target))
  return gridSpacing(frame.unitsPerPx / decade, 72) * decade
}

export interface SheetPictureInput {
  frame: PictureFrame
  /** The image as the sheet lies — decoded with row 0 at the bottom — and
   *  document units per image pixel; null on a section or with it hidden. */
  image: { bitmap: CanvasImageSource & { width: number; height: number }; scale: { x: number; y: number } } | null
  chains: EdgeChains | null
  /** Document units per chain unit. */
  chainUnit: { x: number; y: number }
  /** Write each chain's number beside it — what flat.edges and flat.fit
   *  name it by. */
  chainIds: boolean
  elements: readonly SheetElement[]
  dimensions: readonly SheetDimension[]
  notes: readonly { text: string; at: Vec2 }[]
  counts: readonly SheetCount[]
  /** The alignment's origin and axes, drawn as a small cross of arrows. */
  datum: { origin: Vec2; xDir: Vec2; yDir: Vec2 } | null
  grid: boolean
  /** The elements' names and readings and the dimensions' values. */
  labels: boolean
}

type Ctx = OffscreenCanvasRenderingContext2D

const CALLOUT = '#666e79'
const GRID = 'rgba(40, 90, 200, 0.28)'
const GRID_ZERO = 'rgba(40, 90, 200, 0.7)'
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/** The sheet drawn into `ctx`, a canvas the frame's size. */
export function drawSheetPicture(ctx: Ctx, r: SheetPictureInput): void {
  const { left, top, unitsPerPx: u, width: W, height: H } = r.frame
  const X = (x: number) => (x - left) / u
  const Y = (y: number) => (top - y) / u
  const P = (p: Vec2): [number, number] => [X(p[0]), Y(p[1])]
  const fontPx = W > 1000 || H > 1000 ? 14 : 12
  const deferred: (() => void)[] = []

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  if (r.image) {
    const { bitmap, scale } = r.image
    // Only the image pixels the frame reaches are handed to drawImage: a
    // 1200 dpi page is a hundred million of them, and a close-up needs a few.
    const c0 = Math.max(0, Math.floor(left / scale.x))
    const c1 = Math.min(bitmap.width, Math.ceil((left + W * u) / scale.x))
    const r0 = Math.max(0, Math.floor((top - H * u) / scale.y))
    const r1 = Math.min(bitmap.height, Math.ceil(top / scale.y))
    if (c1 > c0 && r1 > r0) {
      ctx.save()
      // Image pixel (c, r) to the picture: across by the scale, and up — the
      // bitmap's first row is the bottom of the sheet.
      ctx.setTransform(scale.x / u, 0, 0, -scale.y / u, -left / u, top / u)
      // Shrunk, the pixels are averaged; enlarged, each is shown as the
      // square it is — at that magnification the pixels are the measurement.
      ctx.imageSmoothingEnabled = u > Math.min(scale.x, scale.y)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, c0, r0, c1 - c0, r1 - r0, c0, r0, c1 - c0, r1 - r0)
      ctx.restore()
    }
  }

  const step = pictureGridStep(r.frame)
  if (r.grid) {
    ctx.lineWidth = 1
    const xs = gridValues(left, left + W * u, step)
    const ys = gridValues(top - H * u, top, step)
    for (const x of xs) {
      ctx.strokeStyle = Math.abs(x) < step * 1e-6 ? GRID_ZERO : GRID
      line(ctx, [Math.round(X(x)) + 0.5, 0], [Math.round(X(x)) + 0.5, H])
    }
    for (const y of ys) {
      ctx.strokeStyle = Math.abs(y) < step * 1e-6 ? GRID_ZERO : GRID
      line(ctx, [0, Math.round(Y(y)) + 0.5], [W, Math.round(Y(y)) + 0.5])
    }
    // The values go on last, over everything, in a band along each margin.
    deferred.push(() => {
      const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
      ctx.font = `${fontPx - 1}px ${FONT}`
      ctx.fillStyle = 'rgba(255, 255, 255, 0.82)'
      ctx.fillRect(0, 0, W, fontPx + 6)
      ctx.fillRect(0, 0, ctx.measureText(`-${(top - H * u).toFixed(decimals)}0`).width + 8, H)
      ctx.fillStyle = '#1d3f8f'
      ctx.textBaseline = 'top'
      ctx.textAlign = 'center'
      for (const x of xs) if (X(x) > 30 && X(x) < W - 16) ctx.fillText(x.toFixed(decimals), X(x), 3)
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      for (const y of ys) if (Y(y) > fontPx + 10 && Y(y) < H - 6) ctx.fillText(y.toFixed(decimals), 4, Y(y))
    })
  }

  if (r.chains) {
    const { points, offsets } = r.chains
    const cu = r.chainUnit
    ctx.strokeStyle = DRAWING_EDGE_COLOR
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    const ids: { id: number; at: [number, number]; drawn: number }[] = []
    for (let c = 0; c + 1 < offsets.length; c++) {
      const a = offsets[c]
      const b = offsets[c + 1]
      if (b - a < 2) continue
      ctx.beginPath()
      let last: [number, number] | null = null
      let drawn = 0
      const inside: number[] = []
      for (let i = a; i < b; i++) {
        const px = X(points[i * 2] * cu.x)
        const py = Y(points[i * 2 + 1] * cu.y)
        const onPicture = px >= -2 && px <= W + 2 && py >= -2 && py <= H + 2
        if (onPicture) inside.push(i)
        // A point a fraction of a picture pixel from the last adds nothing
        // but time — a chain at 1200 dpi has one per image pixel.
        if (last && i < b - 1 && Math.abs(px - last[0]) < 0.7 && Math.abs(py - last[1]) < 0.7) continue
        if (last) {
          ctx.lineTo(px, py)
          drawn += Math.hypot(px - last[0], py - last[1])
        } else ctx.moveTo(px, py)
        last = [px, py]
      }
      ctx.stroke()
      if (r.chainIds && inside.length > 0 && drawn >= 24) {
        const i = inside[inside.length >> 1]
        ids.push({ id: c, at: [X(points[i * 2] * cu.x), Y(points[i * 2 + 1] * cu.y)], drawn })
      }
    }
    ids.sort((a, b) => b.drawn - a.drawn)
    // The numbers that would crowd each other out are dropped, the longest
    // chains' first — they are what a caller names an edge by, so one that
    // cannot be read is worse than one left off.
    deferred.push(() => {
      ctx.font = `600 ${fontPx - 1}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const taken: [number, number][] = []
      for (const { id, at } of ids) {
        if (taken.some((t) => Math.abs(t[0] - at[0]) < 22 && Math.abs(t[1] - at[1]) < fontPx)) continue
        taken.push(at)
        halo(ctx, `#${id}`, at[0], at[1], '#0b6f66')
        if (taken.length >= 300) break
      }
    })
  }

  for (const d of r.dimensions) {
    ctx.strokeStyle = CALLOUT
    ctx.lineWidth = 1.5
    let at: [number, number] | null = null
    if (d.segment) {
      const [p, q] = d.segment.map(P)
      line(ctx, p, q)
      // A short tick across each end, so the measured span reads.
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
      const n: [number, number] = [(-(q[1] - p[1]) / len) * 5, ((q[0] - p[0]) / len) * 5]
      for (const e of [p, q]) line(ctx, [e[0] - n[0], e[1] - n[1]], [e[0] + n[0], e[1] + n[1]])
      at = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    } else if (d.arc) {
      const { vertex, dirA, dirB } = d.arc
      const R = Math.min(W, H) * 0.08
      const v = P(vertex)
      // Picture y runs down: a direction's angle on the picture is its
      // sheet angle negated.
      const a0 = -Math.atan2(dirA[1], dirA[0])
      let sweep = -Math.atan2(dirB[1], dirB[0]) - a0
      while (sweep > Math.PI) sweep -= 2 * Math.PI
      while (sweep < -Math.PI) sweep += 2 * Math.PI
      line(ctx, v, [v[0] + Math.cos(a0) * R, v[1] + Math.sin(a0) * R])
      line(ctx, v, [v[0] + Math.cos(a0 + sweep) * R, v[1] + Math.sin(a0 + sweep) * R])
      ctx.beginPath()
      ctx.arc(v[0], v[1], R * 0.72, a0, a0 + sweep, sweep < 0)
      ctx.stroke()
      const mid = a0 + sweep / 2
      at = [v[0] + Math.cos(mid) * R * 0.95, v[1] + Math.sin(mid) * R * 0.95]
    }
    if (at && r.labels) {
      const spot = at
      deferred.push(() => {
        ctx.font = `600 ${fontPx}px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        halo(ctx, `${d.title}: ${d.value}`, spot[0], spot[1], '#333a44')
      })
    }
  }

  const diag = Math.hypot(W, H) * u
  for (const el of r.elements) {
    ctx.strokeStyle = el.color
    ctx.lineWidth = 2
    drawFit(ctx, el.fit, P, u)
    if (r.labels) {
      const [lx, ly] = P(labelSpot(el.fit, diag))
      deferred.push(() => {
        ctx.font = `600 ${fontPx}px ${FONT}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        halo(ctx, el.name, lx + 4, ly - fontPx * 0.25, el.color)
        halo(ctx, el.value, lx + 4, ly + fontPx, el.color)
      })
    }
  }

  for (const c of r.counts) {
    c.picks.forEach((p, i) => {
      const [x, y] = P(p)
      ctx.strokeStyle = c.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, 2 * Math.PI)
      ctx.stroke()
      deferred.push(() => {
        ctx.font = `700 ${fontPx - 1}px ${FONT}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        halo(ctx, String(i + 1), x + 4, y - 3, c.color)
        if (c.name && i === c.picks.length - 1) {
          ctx.textBaseline = 'top'
          halo(ctx, `${c.name}: ${c.picks.length}`, x + 4, y + 4, c.color)
        }
      })
    })
  }

  if (r.datum) {
    const o = P(r.datum.origin)
    const arm = Math.min(W, H) * 0.07
    ctx.strokeStyle = '#d0342c'
    ctx.lineWidth = 2
    const xEnd: [number, number] = [o[0] + r.datum.xDir[0] * arm, o[1] - r.datum.xDir[1] * arm]
    const yEnd: [number, number] = [o[0] + r.datum.yDir[0] * arm, o[1] - r.datum.yDir[1] * arm]
    line(ctx, o, xEnd)
    line(ctx, o, yEnd)
    deferred.push(() => {
      ctx.font = `700 ${fontPx}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      halo(ctx, 'X', xEnd[0] + r.datum!.xDir[0] * 9, xEnd[1] - r.datum!.xDir[1] * 9, '#d0342c')
      halo(ctx, 'Y', yEnd[0] + r.datum!.yDir[0] * 9, yEnd[1] - r.datum!.yDir[1] * 9, '#d0342c')
    })
  }

  // Notes are what was written on the sheet: always shown with the
  // elements, label or not, boxed as the stage boxes them, their spot the
  // box's lower left.
  for (const note of r.notes) {
    const [x, y] = P(note.at)
    deferred.push(() => {
      ctx.font = `600 ${fontPx}px ${FONT}`
      const w = ctx.measureText(note.text).width + 10
      const h = fontPx * 1.25 + 4
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.fillRect(x, y - h, w, h)
      ctx.fillStyle = '#c47a12'
      ctx.fillRect(x, y - h, 3, h)
      ctx.fillStyle = DRAWING_NOTE_COLOR
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(note.text, x + 7, y - h / 2)
    })
  }

  for (const draw of deferred) draw()
}

/** The picture as PNG bytes. Needs OffscreenCanvas — a browser. */
export async function sheetPicturePng(input: SheetPictureInput): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(input.frame.width, input.frame.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser gave no canvas to draw the sheet on.')
  drawSheetPicture(ctx, input)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** The multiples of `step` from `lo` to `hi`. */
function gridValues(lo: number, hi: number, step: number): number[] {
  const out: number[] = []
  for (let k = Math.ceil(lo / step); k * step <= hi && out.length < 400; k++) out.push(k * step)
  return out
}

function line(ctx: Ctx, a: [number, number], b: [number, number]): void {
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.stroke()
}

/** Text with a white rim, readable over the image and the edges alike. */
function halo(ctx: Ctx, text: string, x: number, y: number, color: string): void {
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

/** A fit's shape, stroked in the current style. */
function drawFit(ctx: Ctx, fit: FlatFit, P: (p: Vec2) => [number, number], u: number): void {
  ctx.beginPath()
  switch (fit.kind) {
    case 'point': {
      const [x, y] = P(fit.at)
      ctx.moveTo(x - 6, y)
      ctx.lineTo(x + 6, y)
      ctx.moveTo(x, y - 6)
      ctx.lineTo(x, y + 6)
      break
    }
    case 'line': {
      const half = fit.length / 2
      const a = P([fit.center[0] - fit.dir[0] * half, fit.center[1] - fit.dir[1] * half])
      const b = P([fit.center[0] + fit.dir[0] * half, fit.center[1] + fit.dir[1] * half])
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      break
    }
    case 'circle': {
      const [x, y] = P(fit.center)
      ctx.arc(x, y, fit.radius / u, 0, 2 * Math.PI)
      break
    }
    case 'arc': {
      // Counter-clockwise on the sheet is clockwise on a picture whose y
      // runs down.
      const [x, y] = P(fit.center)
      ctx.arc(x, y, fit.radius / u, -fit.start, -(fit.start + fit.sweep), true)
      break
    }
    case 'spline': {
      const { poles } = splineBezierForm(fit)
      const p0 = P(poles[0])
      ctx.moveTo(p0[0], p0[1])
      for (let k = 1; k + 2 < poles.length; k += 3) {
        const [a, b, c] = [P(poles[k]), P(poles[k + 1]), P(poles[k + 2])]
        ctx.bezierCurveTo(a[0], a[1], b[0], b[1], c[0], c[1])
      }
      if (fit.closed) ctx.closePath()
      break
    }
  }
  ctx.stroke()
}
