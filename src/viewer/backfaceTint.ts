// SPDX-License-Identifier: AGPL-3.0-only
// Back-face flagging, as one piece of shader shared by every view that draws a
// part.
//
// The switch on the view bar is a statement about a *part*, not about a
// viewport: "show me which way this surface faces". So it has to reach every
// half that shows the part — the reference in the main viewport and standing
// beside the scan in the split view — or the same part answers the question
// differently on the two sides of the screen, which is worse than not asking.
//
// A flag and a colour rather than two materials, so switching it is a uniform
// write instead of a shader recompile mid-session. Each view owns its own pair
// of uniform objects because three.js keeps GPU state per renderer and the two
// halves are two renderers; what is shared here is the GLSL and the wiring.

import * as THREE from 'three'

export interface BackfaceUniforms {
  uBackfaceTint: { value: number }
  uBackfaceColor: { value: THREE.Color }
}

export function backfaceUniforms(color: number): BackfaceUniforms {
  return {
    uBackfaceTint: { value: 0 },
    uBackfaceColor: { value: new THREE.Color(color) },
  }
}

/** Declarations for a fragment shader that wants the flag. */
export const BACKFACE_GLSL_PREAMBLE = 'uniform float uBackfaceTint;\nuniform vec3 uBackfaceColor;\n'

/** The line that does it, to be spliced in after `<color_fragment>`. Over
 *  anything else written into diffuseColor — a tinted back face is a warning,
 *  not a surface — except the hand marking, which goes on top of it: marking
 *  taken through the part has to show on the far wall too. */
export const BACKFACE_GLSL_FRAGMENT =
  'if ( uBackfaceTint > 0.5 && ! gl_FrontFacing ) diffuseColor.rgb = uBackfaceColor;'

/**
 * Amend a material's fragment shader with the flag, from an onBeforeCompile
 * that may have other splices to make as well. The include line it hangs off
 * stays in place, so the order of the splices does not matter.
 *
 * Flagged in the shader rather than by drawing the mesh a second time with the
 * faces flipped, because the second pass would have to be the same million
 * triangles again — and because a front-face-only pass would take the inside
 * of the part out of reach of the raycaster, which is what picking, hovering
 * and the brush all run on.
 */
export function spliceBackfaceTint(
  shader: { uniforms: { [name: string]: THREE.IUniform }; fragmentShader: string },
  uniforms: BackfaceUniforms,
): void {
  shader.uniforms.uBackfaceTint = uniforms.uBackfaceTint
  shader.uniforms.uBackfaceColor = uniforms.uBackfaceColor
  shader.fragmentShader =
    BACKFACE_GLSL_PREAMBLE +
    shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>\n\t${BACKFACE_GLSL_FRAGMENT}`,
    )
}
