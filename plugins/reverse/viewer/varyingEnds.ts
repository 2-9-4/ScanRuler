// SPDX-License-Identifier: AGPL-3.0-only
// The ends of the edges a fillet rounds at a varying radius, named on the
// part while its box is open: Start and End by each end with the radius
// there, each label standing off past its end the way the edge runs on the
// screen — turned with the view — so it covers neither the edge nor the
// dot on the end.

import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Vec3 } from '../../../src/core/types'
import { pinLabel } from '../../../src/viewer/overlays'
import { lengthDecimals, toDisplay, unitWord, type DisplayUnits } from '../../../src/core/units'

/** One edge at a varying radius, as the box lists it: its place in the
 *  list — a number on its labels when there are several — its two ends
 *  and the way it leaves each, and the radius at each. */
export interface VaryingEdgeEnds {
  index: number
  ends: [Vec3, Vec3]
  endTangents: [Vec3, Vec3]
  radius: [number, number]
}

export interface VaryingEndsContext {
  partGroup: THREE.Group
  camera(): THREE.Camera
  invalidate(): void
}

interface EndLabel {
  label: CSS2DObject
  /** Away from the edge along it, in the part's frame. */
  out: THREE.Vector3
}

/** A radius held in millimetres as its chip writes it in `units`: two
 *  decimals in millimetres, as many more in inches as lengthDecimals gives,
 *  no zeros carried behind. */
const radiusText = (mm: number, units: DisplayUnits) => {
  const k = 10 ** lengthDecimals(2, units)
  return `R ${Math.round(toDisplay(mm, units) * k) / k} ${unitWord(units)}`
}

export class VaryingEnds {
  private group = new THREE.Group()
  private labels: EndLabel[] = []
  /** The camera's turn the labels were last stood off for. */
  private viewTurn = new THREE.Quaternion(NaN, NaN, NaN, NaN)

  constructor(private ctx: VaryingEndsContext) {
    ctx.partGroup.add(this.group)
  }

  /** Name the ends of these edges — none with an empty list — with the
   *  radius at each in `units`. */
  set(edges: readonly VaryingEdgeEnds[], units: DisplayUnits = 'mm'): void {
    this.clear()
    const several = edges.length > 1
    for (const e of edges) {
      for (const k of [0, 1] as const) {
        const word = k === 0 ? 'Start' : 'End'
        // The chip in a padded frame: the frame's corner is put on the end,
        // so the chip stands a few pixels off it.
        const chip = pinLabel(`varying-end ${k === 0 ? 'start' : 'end'}`, several ? `${word} ${e.index + 1}` : word, radiusText(e.radius[k], units)).element
        chip.style.position = ''
        const frame = document.createElement('div')
        frame.className = 'varying-end-frame'
        frame.dataset.test = `fillet-varying-${k === 0 ? 'start' : 'end'}-label`
        frame.append(chip)
        const label = new CSS2DObject(frame)
        label.position.set(...e.ends[k])
        // The tangent at the start runs into the edge, at the end out of it.
        const t = new THREE.Vector3(...e.endTangents[k])
        this.labels.push({ label, out: k === 0 ? t.negate() : t })
        this.group.add(label)
      }
    }
    this.viewTurn.set(NaN, NaN, NaN, NaN)
    this.followView()
  }

  /** Stand each label off its end the way the edge leaves it on the
   *  screen. Called every frame; a no-op unless the view has turned. */
  followView(): void {
    if (this.labels.length === 0) return
    const camera = this.ctx.camera()
    if (this.viewTurn.equals(camera.quaternion)) return
    this.viewTurn.copy(camera.quaternion)
    this.ctx.partGroup.updateWorldMatrix(true, false)
    const toView = camera.quaternion.clone().invert()
    for (const l of this.labels) {
      const onScreen = l.out.clone().transformDirection(this.ctx.partGroup.matrixWorld).applyQuaternion(toView)
      // Scaled so the larger part is 1: a label off a slanting edge puts
      // its corner there. Seen end on, the edge leaves nowhere on the
      // screen, and the label stands above its end.
      const m = Math.max(Math.abs(onScreen.x), Math.abs(onScreen.y))
      const [x, y] = m < 0.2 ? [0, 1] : [onScreen.x / m, onScreen.y / m]
      l.label.center.set(0.5 - x / 2, 0.5 + y / 2)
    }
    this.ctx.invalidate()
  }

  private clear(): void {
    for (const l of this.labels) {
      this.group.remove(l.label)
      l.label.element.remove()
    }
    this.labels = []
    this.ctx.invalidate()
  }

  dispose(): void {
    this.clear()
    this.ctx.partGroup.remove(this.group)
  }
}
