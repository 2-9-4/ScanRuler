// SPDX-License-Identifier: AGPL-3.0-only
// The sharp border of the element tints: the shader's half of a trick the
// compositor (regionColors) plays with a mask beside the vertex colours.
//
// Vertex colours are interpolated across every triangle, so a region painted
// into them fades out over the ring of triangles around its border instead of
// stopping at it. The compositor therefore keeps a second byte per vertex: one
// where the vertex wears a colour of its own — an element's tint, the preview,
// a measured map — and zero on bare scan. That mask is interpolated too, and
// thresholded just under one the way the marking's is: only a triangle tinted
// at all three corners keeps its vertex colours, everything else is painted
// the bare surface colour, and the border falls on triangle edges. A measured
// map sets the mask everywhere, which is what keeps a map smooth.
//
// A scan with colours of its own — a textured scan's, see
// core/parsers/objTexture — has bare surface wear those instead: a third
// attribute beside the colours and the mask, the part's own colour per
// vertex, which the shader takes in place of the one surface colour while
// the switch says so. The border is cut the same way either way.
//
// Only the main viewport draws the scan with vertex colours, so unlike the
// marking's tint and the back-face flag this has one material to patch; the
// pieces live here beside their siblings all the same.

import * as THREE from 'three'
import { setSurfaceColor, type ViewTheme } from './viewThemes'

/** The bare surface colour, as the shader paints it where a triangle is not
 *  tinted through. In the working colour space, like the vertex colours it
 *  stands in for — see the note on setSurfaceColor in viewThemes. */
export interface SurfaceUniform {
  value: THREE.Color
}

export function surfaceUniform(theme: ViewTheme): SurfaceUniform {
  const uniform = { value: new THREE.Color() }
  setSurfaceColor(uniform.value, theme)
  return uniform
}

/** 1 while bare surface wears the part's own colours, 0 for the one
 *  surface colour. */
export interface SurfaceOwnUniform {
  value: number
}

/** Vertex-shader declarations, and the lines that carry the mask and the
 *  part's own colour across. */
export const TINT_GLSL_VERTEX = 'attribute float tint;\nattribute vec3 surface;\nvarying float vTint;\nvarying vec3 vSurface;\n'
export const TINT_GLSL_VERTEX_BODY = 'vTint = tint;\nvSurface = surface;'

/** Fragment-shader declarations, and the line that cuts the border. Spliced
 *  in right after the vertex colour lands, ahead of the marking and the
 *  back-face flag, both of which paint over it. The part's own colours are
 *  an image's, sRGB, and are brought into the working space the vertex
 *  colours are in. */
export const TINT_GLSL_PREAMBLE = 'uniform vec3 uSurfaceColor;\nuniform float uSurfaceOwn;\nvarying float vTint;\nvarying vec3 vSurface;\n'
export const TINT_GLSL_FRAGMENT =
  'if ( vTint < 0.998 ) diffuseColor.rgb = uSurfaceOwn > 0.5 ? sRGBTransferEOTF( vec4( vSurface, 1.0 ) ).rgb : uSurfaceColor;'
