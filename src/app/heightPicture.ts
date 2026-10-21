// SPDX-License-Identifier: AGPL-3.0-only
// A height map as a picture: the grid's cells coloured by the height the
// scan was first met at — or by the deviation or the relief there — cells
// with nothing left pale, the two axes across ruled in millimetres (world
// coordinates, or a plane's own) at the margins, and a scale beside it —
// pocket floors, ledges and a tilt read at a glance.
// The drawing needs OffscreenCanvas — a browser.

import { colormapById, rampColor } from '../core/field/colormap'
import { pictureGridStep } from './flatPicture'

export interface HeightPictureInput {
  /** Heights row by row, row 0 at the low v; NaN where nothing was hit. */
  values: Float32Array
  cols: number
  rows: number
  /** The grid's low corner and its cell, mm. */
  u0: number
  v0: number
  cell: number
  /** The world axes across and up ("X", "Y", "Z"), and along. */
  uName: string
  vName: string
  title: string
  low: number
  high: number
  /** The colour map, viridis unless given — a deviation is drawn in the
   *  workspace's. */
  colormap?: string
  /** What a pale cell means: "no hit" unless given. */
  bare?: string
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
/** The map's side, pixels, before the margins. */
const MAP_SIDE = 640
const MARGIN = { left: 56, right: 96, top: 34, bottom: 40 }

export async function heightPicturePng(p: HeightPictureInput): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const px = Math.max(2, Math.floor(MAP_SIDE / Math.max(p.cols, p.rows)))
  const mw = px * p.cols
  const mh = px * p.rows
  const W = mw + MARGIN.left + MARGIN.right
  const H = mh + MARGIN.top + MARGIN.bottom
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser gave no canvas to draw the height map on.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  const map = colormapById(p.colormap ?? 'viridis')
  const rgb: [number, number, number] = [0, 0, 0]
  const span = p.high - p.low || 1
  // Cells: row 0 at the bottom, as +v runs up.
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const v = p.values[r * p.cols + c]
      const x = MARGIN.left + c * px
      const y = MARGIN.top + mh - (r + 1) * px
      if (Number.isNaN(v)) {
        ctx.fillStyle = '#eceef1'
      } else {
        rampColor(map, (v - p.low) / span, rgb)
        ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
      }
      ctx.fillRect(x, y, px, px)
    }
  }
  ctx.strokeStyle = '#8a929c'
  ctx.strokeRect(MARGIN.left + 0.5, MARGIN.top + 0.5, mw - 1, mh - 1)

  // The world coordinates across and up, ruled over the map.
  const unitsPerPx = p.cell / px
  const step = pictureGridStep({ left: p.u0, top: p.v0 + p.rows * p.cell, unitsPerPx, width: mw, height: mh })
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  ctx.font = `11px ${FONT}`
  ctx.fillStyle = '#4a5260'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.lineWidth = 1
  for (let k = Math.ceil(p.u0 / step); k * step <= p.u0 + p.cols * p.cell + 1e-9; k++) {
    const x = Math.round(MARGIN.left + (k * step - p.u0) / unitsPerPx) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, MARGIN.top)
    ctx.lineTo(x, MARGIN.top + mh)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText((k * step).toFixed(decimals), x, MARGIN.top + mh + 4)
  }
  for (let k = Math.ceil(p.v0 / step); k * step <= p.v0 + p.rows * p.cell + 1e-9; k++) {
    const y = Math.round(MARGIN.top + mh - (k * step - p.v0) / unitsPerPx) + 0.5
    ctx.beginPath()
    ctx.moveTo(MARGIN.left, y)
    ctx.lineTo(MARGIN.left + mw, y)
    ctx.stroke()
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText((k * step).toFixed(decimals), MARGIN.left - 4, y)
  }
  ctx.font = `bold 12px ${FONT}`
  ctx.fillStyle = '#20252c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`→ ${p.uName}`, MARGIN.left + mw / 2, H - 4)
  ctx.save()
  ctx.translate(14, MARGIN.top + mh / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(`→ ${p.vName}`, 0, 0)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(p.title, MARGIN.left, 10)

  // The scale: the ramp from low (bottom) to high (top), with five values.
  const sx = MARGIN.left + mw + 18
  const sw = 16
  for (let y = 0; y < mh; y++) {
    rampColor(map, 1 - y / Math.max(1, mh - 1), rgb)
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    ctx.fillRect(sx, MARGIN.top + y, sw, 1)
  }
  ctx.strokeStyle = '#8a929c'
  ctx.strokeRect(sx + 0.5, MARGIN.top + 0.5, sw - 1, mh - 1)
  ctx.font = `11px ${FONT}`
  ctx.fillStyle = '#20252c'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const places = span < 1 ? 3 : 2
  for (let i = 0; i <= 4; i++) {
    const t = i / 4
    ctx.fillText((p.low + t * (p.high - p.low)).toFixed(places), sx + sw + 4, MARGIN.top + mh - t * (mh - 1))
  }
  ctx.fillStyle = '#eceef1'
  ctx.fillRect(sx, MARGIN.top + mh + 8, sw, 10)
  ctx.fillStyle = '#4a5260'
  ctx.fillText(p.bare ?? 'no hit', sx + sw + 4, MARGIN.top + mh + 13)

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: W, height: H }
}
