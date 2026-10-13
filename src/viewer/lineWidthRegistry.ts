// SPDX-License-Identifier: AGPL-3.0-only
// The fat lines a scene keeps sized. A screen-space LineMaterial needs the
// canvas size, and the operator's line-width setting scales every one of
// them; each is kept with the width it has at the default setting, so a new
// setting reaches the lines already drawn without a rebuild. A line drawn
// once and thrown away — a hover — can read `resolution` and `scale` without
// being tracked.

import * as THREE from 'three'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'

export class LineWidthRegistry {
  /** The canvas size, the one copy every fat line reads. */
  readonly resolution = new THREE.Vector2(1, 1)
  private materials = new Map<LineMaterial, number>()
  private factor = 1

  /** `defaultPx` is the width setting at which every line is drawn at the
   *  width it was made with. */
  constructor(private readonly defaultPx: number) {}

  /** The factor the setting puts on every width. */
  get scale(): number {
    return this.factor
  }

  /** Keep a material sized, `nominal` being its width at the default
   *  setting. Returns what lets it go again. */
  track(mat: LineMaterial, nominal: number): () => void {
    mat.resolution.copy(this.resolution)
    this.materials.set(mat, nominal)
    return () => {
      this.materials.delete(mat)
    }
  }

  /** The canvas size; false when it is the one already held. */
  setResolution(width: number, height: number): boolean {
    if (this.resolution.x === width && this.resolution.y === height) return false
    this.resolution.set(width, height)
    for (const m of this.materials.keys()) m.resolution.copy(this.resolution)
    return true
  }

  /** The width setting, in pixels; false when it is the one already held. */
  setLineWidth(px: number): boolean {
    const scale = px / this.defaultPx
    if (scale === this.factor) return false
    this.factor = scale
    for (const [m, nominal] of this.materials) m.linewidth = nominal * scale
    return true
  }
}
