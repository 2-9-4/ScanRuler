// SPDX-License-Identifier: AGPL-3.0-only
// The scan's material, amended: one onBeforeCompile that splices every layer
// the scan is drawn with into the standard shader, in the order they stack.

import type * as THREE from 'three'
import { BACKFACE_GLSL_FRAGMENT, BACKFACE_GLSL_PREAMBLE, type BackfaceUniforms } from './backfaceTint'
import { DEFLECT_GLSL_VERTEX, DEFLECT_GLSL_VERTEX_BODY, type DeflectionUniform } from './deflection'
import { PAINT_GLSL_FRAGMENT, PAINT_GLSL_PREAMBLE, PAINT_GLSL_VERTEX, PAINT_GLSL_VERTEX_BODY, type PaintUniform } from './paintTint'
import { TINT_GLSL_FRAGMENT, TINT_GLSL_PREAMBLE, TINT_GLSL_VERTEX, TINT_GLSL_VERTEX_BODY, type SurfaceUniform } from './regionTint'
import { spliceWireframe, type WireUniforms } from './surfaceModes'

/** The uniform objects the amendments read — the scene's own, held for its
 *  lifetime; their values change, the objects do not. */
export interface ScanShaderUniforms {
  backface: BackfaceUniforms
  paintColor: PaintUniform
  surfaceColor: SurfaceUniform
  deflect: DeflectionUniform
  wire: WireUniforms
}

/**
 * The scan material's shader amendments: the sharp border of the element
 * tints (see regionTint.ts), the hand-marking's tint (see paintTint.ts),
 * back-face flagging (see backfaceTint.ts), the mesh mode's edges (see
 * surfaceModes.ts) and the map played as motion (see deflection.ts).
 * Folded into one patch here because a material has a single
 * onBeforeCompile.
 *
 * Back faces are flagged in the shader rather than by drawing the mesh a
 * second time with the faces flipped, because the second pass would have to
 * be the same million triangles again — and because a front-face-only main
 * pass would take the inside of the part out of reach of the raycaster,
 * which is what picking, hovering and the brush all run on. The order the
 * lines run in is the order the layers stack: the region border is cut
 * first, the flag goes over it — a tinted back face is a warning, not a
 * surface — and the marking has the last word. A gesture that reaches
 * through the part marks the far side of the wall as well, and marking
 * that hid under the flag would be marking the user cannot see.
 */
export function patchScanShader(material: THREE.Material, u: ScanShaderUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBackfaceTint = u.backface.uBackfaceTint
    shader.uniforms.uBackfaceColor = u.backface.uBackfaceColor
    shader.uniforms.uPaintColor = u.paintColor
    shader.uniforms.uSurfaceColor = u.surfaceColor
    shader.uniforms.uDeflect = u.deflect
    shader.vertexShader =
      TINT_GLSL_VERTEX +
      PAINT_GLSL_VERTEX +
      DEFLECT_GLSL_VERTEX +
      shader.vertexShader
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
        ${TINT_GLSL_VERTEX_BODY}
        ${PAINT_GLSL_VERTEX_BODY}`,
        )
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n\t${DEFLECT_GLSL_VERTEX_BODY}`)
    shader.fragmentShader =
      BACKFACE_GLSL_PREAMBLE +
      PAINT_GLSL_PREAMBLE +
      TINT_GLSL_PREAMBLE +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${TINT_GLSL_FRAGMENT}
        ${BACKFACE_GLSL_FRAGMENT}
        ${PAINT_GLSL_FRAGMENT}`,
      )
    spliceWireframe(shader, u.wire)
  }
}
