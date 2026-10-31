// SPDX-License-Identifier: AGPL-3.0-only
// The scan's own symmetry plane as the plane a Mirror starts on.
//
// Half of a symmetric part is modelled and mirrored, and the plane it is
// mirrored about decides whether the two halves meet: a hand-picked face or
// a coordinate plane is off by whatever the alignment was off by, while the
// plane found by mirror registration (core/symmetry.ts) is the part's own.
// So the Mirror box opens with that plane already in — when the scan has
// one. This file is the judgement and the conversion; the search itself
// runs in the mesh worker, where the scan is.

import { sketchFrameOn } from '../../../src/core/section/frame'
import { symmetryAccepted, type SymmetryPlane } from '../../../src/core/symmetry'
import type { PlaneRef } from './features'

export { SYMMETRY_MAX_RMS_MM, SYMMETRY_MIN_MATCHED, symmetryAccepted } from '../../../src/core/symmetry'

/** The name a plane taken from the search carries in rows and boxes. */
export const SYMMETRY_LABEL = 'the scan’s symmetry plane'

/** The found plane as a reference a feature can stand on: a fitted plane,
 *  belonging to no element, moving with the part. Null when the search did
 *  not find a symmetry. */
export function symmetryPlaneRef(r: SymmetryPlane): PlaneRef | null {
  if (!symmetryAccepted(r)) return null
  const frame = sketchFrameOn({ origin: r.point, normal: r.normal })
  return frame ? { kind: 'fitted', frame, label: SYMMETRY_LABEL } : null
}
