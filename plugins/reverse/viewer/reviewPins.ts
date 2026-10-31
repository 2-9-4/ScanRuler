// SPDX-License-Identifier: AGPL-3.0-only
// The places a review of the model names (reverse.body.review), as
// numbered pins in the 3D viewport for its picture: a dot on the scan where
// the place is and, up and to the right of it, a dark badge with the
// place's number, ringed by its kind — red where material is missing, blue
// where it is extra, amber where a face stands off. Drawn into the canvas
// as the notes' pins are (notePins.ts), held at their size in pixels and
// over the part, so a picture shows them; put up for the picture and taken
// down after it, never left on the screen.

import * as THREE from 'three'
import type { Vec3 } from '../../../src/core/types'
import type { SceneLayerHost } from '../../../src/viewer/sceneLayers'
import { dotTexture, heldAt, spriteMaterial } from './notePins'

export interface ReviewPinItem {
  n: number
  at: Vec3
  kind: 'missing' | 'excess' | 'off'
  /** Which way the scan faces at the pin, in the world: a pin on a face
   *  turned away from a view is left out of it. */
  normal?: Vec3 | null
}

/** How far past square a face may turn from the camera and keep its pin
 *  (as the cosine) — one seen edge-on still shows it. */
const AWAY_COS = -0.1

const toCamera = new THREE.Vector3()
const pinAt = new THREE.Vector3()

/** Whether a pin's face looks toward the camera drawing it. */
function facing(normal: Vec3, sprite: THREE.Sprite, camera: THREE.Camera): boolean {
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) camera.getWorldDirection(toCamera).negate()
  else toCamera.setFromMatrixPosition(camera.matrixWorld).sub(sprite.getWorldPosition(pinAt)).normalize()
  return normal[0] * toCamera.x + normal[1] * toCamera.y + normal[2] * toCamera.z > AWAY_COS
}

/** The badge's diameter and the dot's, px — a little larger than a note's,
 *  to read on a coloured map. */
const BADGE_PX = 28
const DOT_PX = 9
/** The badge's lower left corner stands off the dot by this share of its
 *  size, up and to the right. */
const BADGE_OFFSET = 0.25

const RING = { missing: '#e0413a', excess: '#2f74d8', off: '#f2a516' }

/** A badge's picture: a dark disc ringed in its kind's colour, the number
 *  white — drawn at four times its size on screen. */
function badgeTexture(n: number, kind: ReviewPinItem['kind']): THREE.CanvasTexture {
  const size = BADGE_PX * 4
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const r = size / 2
  g.beginPath()
  g.arc(r, r, r - 2, 0, Math.PI * 2)
  g.fillStyle = '#ffffff'
  g.fill()
  g.beginPath()
  g.arc(r, r, r - 7, 0, Math.PI * 2)
  g.fillStyle = RING[kind]
  g.fill()
  g.beginPath()
  g.arc(r, r, r - 19, 0, Math.PI * 2)
  g.fillStyle = '#1d2026'
  g.fill()
  const label = String(n)
  g.fillStyle = '#ffffff'
  g.font = `700 ${label.length > 1 ? 44 : 52}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, r, r + 3)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** The pins of one review, in the scan's frame. */
export class ReviewPins {
  private group = new THREE.Group()
  private dot = dotTexture()

  constructor(
    private host: SceneLayerHost,
    items: readonly ReviewPinItem[],
  ) {
    this.group.name = 'review-pins'
    for (const item of items) {
      const badge = new THREE.Sprite(spriteMaterial(badgeTexture(item.n, item.kind)))
      badge.center.set(-BADGE_OFFSET, -BADGE_OFFSET)
      badge.renderOrder = 13
      const dot = new THREE.Sprite(spriteMaterial(this.dot))
      dot.renderOrder = 12
      heldAt(badge, () => BADGE_PX)
      heldAt(dot, () => DOT_PX)
      for (const o of [badge, dot]) {
        o.position.set(item.at[0], item.at[1], item.at[2])
        // Drawn over the part, so a pin on its far side would show through
        // it: in each view of the sheet, one whose face is turned away is
        // drawn clear.
        const normal = item.normal
        if (!normal) continue
        const held = o.onBeforeRender
        o.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
          held.call(o, renderer, scene, camera, geometry, material, group)
          o.material.opacity = facing(normal, o, camera) ? 1 : 0
        }
      }
      this.group.add(dot, badge)
    }
    host.partGroup.add(this.group)
    host.invalidate()
  }

  /** Take the pins down, and what they were drawn with. */
  dispose(): void {
    this.host.partGroup.remove(this.group)
    for (const o of this.group.children) {
      const material = (o as THREE.Sprite).material
      if (material.map !== this.dot) material.map?.dispose()
      material.dispose()
    }
    this.dot.dispose()
    this.host.invalidate()
  }
}
