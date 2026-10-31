// SPDX-License-Identifier: AGPL-3.0-only
// A pin in the 3D view as an HTML label: what it marks on top and the
// measured value under it, so a number can be read off the model without
// going back to the panel.

import type { FitData } from '../core/types'
import { fmtLen, type DisplayUnits } from '../core/units'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

/** What a measurement's pin says beyond its value: small lines under it —
 *  the elements a tolerance is about, the limit and how the value stands to
 *  it — and whether the value is over its limit, which paints it red. */
export interface PinVerdict {
  notes?: string[]
  over?: boolean
}

/** A pin in the 3D view: what it marks on top, the measured value under it, so
 *  the numbers can be read off the model without going back to the panel. An
 *  empty value leaves just the name — nothing is not a number.
 *
 *  A tint is an element's own colour on the title. It goes on as `--tint`
 *  under the stylesheet's `tinted` rule rather than as the colour itself, so
 *  that the dark chassis can lift it toward white before it is used as text:
 *  the palette is tuned to hold on the light instrument, and its deeper tones
 *  sink into a dark chip. */
export function pinLabel(
  kind: string,
  title: string,
  value: string,
  tint?: string,
  verdict?: PinVerdict,
): CSS2DObject {
  const div = document.createElement('div')
  div.className = `viewport-label ${kind}`
  if (verdict?.over) div.classList.add('over')
  const t = document.createElement('div')
  t.className = 'label-title'
  t.textContent = title
  if (tint) {
    t.classList.add('tinted')
    t.style.setProperty('--tint', tint)
  }
  div.append(t)
  if (value) {
    const v = document.createElement('div')
    v.className = 'label-value'
    v.textContent = value
    div.append(v)
  }
  for (const note of verdict?.notes ?? []) {
    const n = document.createElement('div')
    n.className = 'label-note'
    n.textContent = note
    div.append(n)
  }
  return new CSS2DObject(div)
}

/** What an element's viewport pin says under its name: the diameter where
 *  there is one, nothing otherwise — sigma and coordinates stay in the panel.
 *  Written in `units`. */
export function pinValue(fit: FitData, units: DisplayUnits = 'mm'): string {
  if (fit.kind === 'sphere' || fit.kind === 'cylinder' || fit.kind === 'circle')
    return `Ø ${fmtLen(fit.radius * 2, units, 3)}`
  if (fit.kind === 'cone') return `∠ ${(fit.halfAngle * 2).toFixed(2)}°`
  return ''
}
