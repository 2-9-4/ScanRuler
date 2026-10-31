// SPDX-License-Identifier: AGPL-3.0-only
// The design loop's reading (reverse.body.review), what is pure of it: the
// volume error's regions and the comparison's patches over T merged into
// places on the part, ranked by how much material is wrong there; the
// standard views that best see the first of them; and how one review
// stands to the last and to the first. The volume compare says how much
// and where material is missing or extra, the comparison where a face
// stands off by a few tenths and how the scan lies there — one place
// where they meet, two where only one sees it.

import type { Vec3 } from '../../../src/core/types'

export interface Box {
  min: Vec3
  max: Vec3
}

/** A face as a place names it: its body, its index in
 *  reverse.body.describe and the feature that made it. */
export interface FaceName {
  body: string
  index: number
  madeBy: string | null
}

/** A region of the volume error. */
export interface VolumeSpot {
  kind: 'excess' | 'missing'
  volume: number
  maxDepth: number
  centroid: Vec3
  box: Box
  face: FaceName | null
}

/** A patch of the comparison over T — within reach, or past it (far). */
export interface PatchSpot {
  /** Which side of the bodies the scan lies: outside (the part has
   *  material the model has not) or inside. */
  side: 'outside' | 'inside'
  far: boolean
  kind: 'feature' | 'texture'
  area: number
  /** mm³ past the tolerance. */
  volume: number
  extreme: number
  mean: number
  centroid: Vec3
  /** The scan vertex of the extreme reading, and its index. */
  at: Vec3
  vertex: number
  box: Box
  face: FaceName | null
}

/** A place on the part to work on. */
export interface Place {
  n: number
  /** missing: material the part has and the model has not; excess: the
   *  other way; off: a face standing off the scan, within reach — a few
   *  tenths, which the volume error is too coarse to hold. */
  kind: 'missing' | 'excess' | 'off'
  mm3: number
  maxDepth: number
  /** The scan's area over T there, mm² — where a patch saw it. */
  area?: number
  centroid: Vec3
  box: Box
  /** Off: the comparison's mean, signed as it reads — positive where the
   *  scan stands outside the body (the model short of it). */
  mean?: number
  face: FaceName | null
  /** What saw it: the volume error, the map (the comparison's patches
   *  within reach), both, or the far reading past the reach. */
  by: 'volume' | 'volume+map' | 'map' | 'far'
  /** A point of the scan there and its vertex — the extreme of the
   *  largest patch — where a patch saw it. */
  scanAt?: Vec3
  vertex?: number
}

/** How far past a region's box a patch may lie and still be the same
 *  place, mm: a millimetre, or five tolerances. */
export const placeMargin = (tolerance: number) => Math.max(1, 5 * tolerance)

const grown = (b: Box, by: number): Box => ({ min: [b.min[0] - by, b.min[1] - by, b.min[2] - by], max: [b.max[0] + by, b.max[1] + by, b.max[2] + by] })
const inBox = (b: Box, p: readonly number[]) => p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2]
const meets = (a: Box, b: Box) => a.min[0] <= b.max[0] && b.min[0] <= a.max[0] && a.min[1] <= b.max[1] && b.min[1] <= a.max[1] && a.min[2] <= b.max[2] && b.min[2] <= a.max[2]
const apart = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * The volume error's regions and the comparison's patches as places, the
 * most material wrong first, numbered from 1. A patch joins the region of
 * its kind — scan outside the bodies to missing, inside to excess — whose
 * box, grown by placeMargin, holds its extreme and meets its box; of
 * several, the one whose centre is nearest. One that joins none is a
 * place of its own: past the reach, missing or excess by its side; within
 * it, a face off. A region keeps its own volume (the volume error measures
 * it whole) and takes the patches' area, depth and scan point. Texture
 * patches — the scan's roughness past T — are no place.
 */
export function mergePlaces(regions: readonly VolumeSpot[], patches: readonly PatchSpot[], tolerance: number): Place[] {
  const margin = placeMargin(tolerance)
  type Work = Omit<Place, 'n'> & { scanVolume: number }
  const places: Work[] = regions.map((r) => ({ kind: r.kind, mm3: r.volume, maxDepth: r.maxDepth, centroid: r.centroid, box: r.box, face: r.face, by: 'volume', scanVolume: 0 }))
  for (const p of patches) {
    if (p.kind === 'texture' && !p.far) continue
    const want = p.side === 'outside' ? 'missing' : 'excess'
    let best: { w: Work; d: number } | null = null
    for (let i = 0; i < regions.length; i++) {
      const w = places[i]
      if (w.kind !== want) continue
      const near = grown(regions[i].box, margin)
      if (!inBox(near, p.at) || !meets(near, p.box)) continue
      const d = apart(regions[i].centroid, p.centroid)
      if (!best || d < best.d) best = { w, d }
    }
    if (best) {
      const w = best.w
      w.area = (w.area ?? 0) + p.area
      w.maxDepth = Math.max(w.maxDepth, Math.abs(p.extreme))
      w.by = 'volume+map'
      // The scan point of the largest patch on it.
      if (p.volume > w.scanVolume) {
        w.scanVolume = p.volume
        w.scanAt = p.at
        w.vertex = p.vertex
      }
      continue
    }
    places.push({
      kind: p.far ? want : 'off',
      mm3: p.volume,
      maxDepth: Math.abs(p.extreme),
      area: p.area,
      centroid: p.centroid,
      box: p.box,
      ...(p.far ? {} : { mean: p.mean }),
      face: p.face,
      by: p.far ? 'far' : 'map',
      scanAt: p.at,
      vertex: p.vertex,
      scanVolume: p.volume,
    })
  }
  return places
    .sort((a, b) => b.mm3 - a.mm3 || b.maxDepth - a.maxDepth)
    .map(({ scanVolume: _v, ...p }, i) => {
      void _v
      return { n: i + 1, ...p }
    })
}

// ---- the views that see them ---------------------------------------------------------

/** A standard view as the chooser takes it: its name and the direction
 *  from the part to the camera. */
export interface ViewDir {
  name: string
  dir: Vec3
}

/** How far a view has to face a place to see it: the cosine between the
 *  place's normal and the direction to the camera. */
const SEES = 0.25

/**
 * The views that best see the places, by greed: each next view the one
 * that sees most of what the ones before saw least, every place weighed
 * by `weights` (the first most) and by how square it faces the camera.
 * A place with no normal is left to the views. At least `least` views,
 * at most `most` — fewer once another would add under a tenth of what the
 * first saw.
 */
export function chooseViews(normals: readonly (Vec3 | null)[], weights: readonly number[], views: readonly ViewDir[], most = 4, least = 2): string[] {
  const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const dirs = views.map((v) => unit(v.dir))
  const facing = (i: number, k: number) => {
    const n = normals[i]
    if (!n) return 0
    const c = n[0] * dirs[k][0] + n[1] * dirs[k][1] + n[2] * dirs[k][2]
    return c >= SEES ? c : 0
  }
  const seen = normals.map(() => 0)
  const chosen: number[] = []
  let first = 0
  while (chosen.length < Math.min(most, views.length)) {
    let best = -1, gain = -1
    for (let k = 0; k < views.length; k++) {
      if (chosen.includes(k)) continue
      let g = 0
      for (let i = 0; i < normals.length; i++) g += (weights[i] ?? 0) * Math.max(0, facing(i, k) - seen[i])
      if (g > gain + 1e-9) {
        gain = g
        best = k
      }
    }
    if (best < 0) break
    if (chosen.length === 0) first = gain
    else if (chosen.length >= least && (gain <= 0 || gain < 0.1 * first)) break
    chosen.push(best)
    for (let i = 0; i < normals.length; i++) seen[i] = Math.max(seen[i], facing(i, best))
  }
  return chosen.map((k) => views[k].name)
}

// ---- the trend --------------------------------------------------------------------

/** One review as the session keeps it. */
export interface ReviewMark {
  /** When, ms since the epoch. */
  at: number
  /** How many features the list held, and the last. */
  features: number
  feature: string | null
  tolerance: number
  /** % of the scan within ±T. */
  withinT: number | null
  /** mm³. */
  excess: number
  missing: number
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** One review against an earlier one: features added, points within T
 *  gained, mm³ of excess and missing gone, minutes since, and in a word
 *  whether it went better — more within T and less material wrong. */
export function againstMark(now: ReviewMark, then: ReviewMark): Record<string, unknown> {
  const within = now.withinT !== null && then.withinT !== null ? round1(now.withinT - then.withinT) : null
  const excess = Math.round(now.excess - then.excess)
  const missing = Math.round(now.missing - then.missing)
  const wrong = excess + missing
  // Half a point within T, or a twentieth of what was wrong, is a change.
  const scale = Math.max(1, (then.excess + then.missing) / 20)
  const up = within !== null && within >= 0.5, down = within !== null && within <= -0.5
  const less = wrong <= -scale, more = wrong >= scale
  const word = (up || less) && !(down || more) ? 'better' : (down || more) && !(up || less) ? 'worse' : up || down || less || more ? 'mixed' : 'same'
  return {
    features: now.features - then.features,
    withinT: within,
    excess,
    missing,
    minutes: round1((now.at - then.at) / 60_000),
    went: word,
    ...(Math.abs(now.tolerance - then.tolerance) > 1e-9 ? { note: `read at ±${then.tolerance} then — the shares are not alike` } : {}),
  }
}

/** The trend a review answers: which loop this is, and this one against
 *  the last and against the first. `history` holds this one last. */
export function trendOf(history: readonly ReviewMark[]): Record<string, unknown> {
  const now = history.at(-1)
  if (!now) return { loop: 0 }
  if (history.length === 1) return { loop: 1, note: 'the first review — the next answers how it went since' }
  const last = history[history.length - 2]
  return { loop: history.length, vsLast: againstMark(now, last), ...(history.length > 2 ? { vsFirst: againstMark(now, history[0]) } : {}) }
}
