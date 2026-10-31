// SPDX-License-Identifier: AGPL-3.0-only
// The sketch's Symmetric relation as CAD has it: two pieces that are mirror
// images of each other about a line of the sketch — a centre line, usually a
// construction one — or about one of the part's coordinate planes, on the
// line it cuts the sheet in (datums.ts). The solver's equation holds two anchors symmetric; a
// piece is more than one anchor, so the relation between two pieces is the
// set of those equations that pins one to the other's image: a line by both
// of its ends, a circle by its centre, an arc by its ends and its centre.
// Which end mirrors which is read off where the pieces lie — the pairing
// under which they are nearest to being mirror images already — so that the
// relation moves them the least.

import type { Vec2 } from '../../../src/core/flat/types'
import { dot2, len2, normalize2, sub2 } from '../../../src/core/flat/vec2'
import { traceLine, type DatumTrace } from './datums'
import { anchorPoint, type Anchor, type AnchorAt, type SketchEntity } from './sketch'

/** A point's image in the line through `a` along the unit direction `d`. */
export function mirrorPoint(p: Vec2, a: Vec2, d: Vec2): Vec2 {
  const v = sub2(p, a)
  const along = dot2(v, d)
  return [a[0] + 2 * along * d[0] - v[0], a[1] + 2 * along * d[1] - v[1]]
}

/**
 * The anchor pairs that make `a` and `b` mirror images about `axis` — a
 * line of the sketch, or a coordinate plane's trace in the sheet — or why
 * there are none: the pieces are of different kinds, the axis is one of
 * them, or it has no length.
 */
export function symmetricPairs(a: SketchEntity, b: SketchEntity, axis: SketchEntity | DatumTrace): { p: Anchor; q: Anchor }[] | string {
  if (!('plane' in axis)) {
    if (axis.kind !== 'line') return 'The third piece is what the two mirror about — it has to be a line.'
    if (axis.id === a.id || axis.id === b.id) return 'The mirror line cannot be one of the two pieces.'
  }
  if (a.id === b.id) return 'Symmetric takes two different pieces.'
  const line = 'plane' in axis ? traceLine(axis) : axis.kind === 'line' ? { a: axis.a, d: normalize2(sub2(axis.b, axis.a)) } : null
  const d = line?.d
  if (!line || !d) return 'The mirror line has no length.'
  if (a.kind !== b.kind) return `A ${a.kind} and a ${b.kind} are not mirror images of each other — pick two pieces of one kind.`
  const pair = (pa: AnchorAt, qa: AnchorAt) => ({ p: { entity: a.id, at: pa }, q: { entity: b.id, at: qa } })
  if (a.kind === 'circle' || a.kind === 'point') return [pair('center', 'center')]
  // A line or an arc: its two ends, paired the way that mirrors them best.
  const miss = (pa: AnchorAt, qa: AnchorAt) => len2(sub2(mirrorPoint(anchorPoint(a, pa), line.a, d), anchorPoint(b, qa)))
  const straight = miss('a', 'a') + miss('b', 'b') <= miss('a', 'b') + miss('b', 'a')
  const ends = straight ? [pair('a', 'a'), pair('b', 'b')] : [pair('a', 'b'), pair('b', 'a')]
  return a.kind === 'arc' ? [...ends, pair('center', 'center')] : ends
}
