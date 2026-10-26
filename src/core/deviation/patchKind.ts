// SPDX-License-Identifier: AGPL-3.0-only
// Feature or texture: what a patch of a deviation map past its tolerance
// is (hotspots.ts). Every patch lies past tolerance by definition, so the
// question a patch leaves is not whether it is noise but what it is: a
// feature — material missing or misplaced, a pad not modelled, a wall
// standing off — or the part's texture, a casting's skin or a print's
// lines poking past the tolerance here and there. A feature is broad and
// deep; texture is either small or shallow. Apart from the gathering so
// that the commands can say the rule without loading it.

/** A feature patch is at least this many mm² … */
export const FEATURE_MIN_AREA = 4
/** … and at least this many point spacings² — this many vertices, at
 *  count × spacing² each — so a coarse scan's few vertices are no feature … */
export const FEATURE_MIN_SPACINGS = 25
/** … and its median reading at least this many tolerances off. */
export const FEATURE_DEPTH = 2

export type PatchKind = 'feature' | 'texture'

/** Whether a patch of this area (mm²) and depth (median |reading|) is a
 *  feature, at this point spacing and the depth a feature reaches. */
export function patchKind(area: number, depth: number, spacing: number, featureDepth: number): PatchKind {
  return area >= Math.max(FEATURE_MIN_AREA, FEATURE_MIN_SPACINGS * spacing * spacing) && depth >= featureDepth ? 'feature' : 'texture'
}
