// SPDX-License-Identifier: AGPL-3.0-only
// Stripes across a material, fixed to the screen — the hatching a drawing
// puts on a section, here to set a surface apart from the plainly coloured
// ones round it, whatever their colours.

import type * as THREE from 'three'

/** The stripes' pitch, device pixels, and how much darker every other one
 *  is drawn. */
const PITCH_PX = 12
const SHADE = 0.45

/**
 * Hatch a material: diagonal stripes across the screen, every other one a
 * shade darker, under the lighting — fixed to the screen rather than the
 * surface, so they read the same at any distance and on any slope. Goes
 * on top of whatever else the material's onBeforeCompile does.
 */
export function hatch(material: THREE.Material): void {
  const before = material.onBeforeCompile.bind(material)
  const key = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.rgb *= 1.0 - ${SHADE.toFixed(2)} * step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / ${PITCH_PX.toFixed(1)}));`,
    )
  }
  material.customProgramCacheKey = () => `${key()}|hatch`
}
