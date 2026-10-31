// SPDX-License-Identifier: AGPL-3.0-only
// The parts of an extrude that need only the kernel: the prism trimmed to
// the planes it runs between, the tapered prism, how far a taper can lean
// before it closes the profile, and how far the bodies reach along a
// direction. The Builder's extrude and extrudeUntil (build.ts), which read
// the bodies built so far, put them together.

import type { Vec3 } from '../../../src/core/types'
import { addScaled, cross, dot, normalize, sub } from '../../../src/core/vec'
import { diagonalOf, meshDeflection } from './buildTypes'
import { type BuildStep, type PlaneGeometry, sideOf } from './features'
import type { ReKernel, Shape } from './kernel'
import { type EdgeLoop, faceOutline, type TaperReach, taperLimit } from './taper'

/** A limiting plane trims what reached past it: the half of space on the
 *  far side of each plane, seen from the sketch, is cut away. */
export function trimByPlanes(kernel: ReKernel, solid: Shape, planes: readonly PlaneGeometry[], origin: Vec3): Shape {
  const k = kernel
  for (const plane of planes) {
    const side = sideOf(plane, origin)
    const away: Vec3 = [-side * plane.normal[0], -side * plane.normal[1], -side * plane.normal[2]]
    const half = k.halfSpace(plane.origin, away)
    const trimmed = k.cut(solid, half)
    k.release(solid, half)
    solid = trimmed
  }
  return solid
}

/**
 * The prism of an extrude with a taper, before its limiting planes trim
 * it. The profile is the section at the sketch plane — at the end of the
 * extent nearest the plane, for one standing off it — and the sides lean
 * from there as the prism goes away from it: both ways, for an extent
 * reaching both ways, two prisms joined at the profile. An end that is a
 * plane is reached by a prism just long enough to pass it everywhere —
 * the profile's outline run out to it, and further where sides leaning
 * out meet a plane tilted back from them; a prism to the extrude's far
 * reach would close a leaning-in profile on the way. A taper that closes
 * the profile, or a hole of it, before the end is refused, saying where.
 */
export function taperedPrism(kernel: ReKernel, step: Extract<BuildStep, { kind: 'extrude' }>, faces: readonly Shape[], toFace: PlaneGeometry | null): Shape {
  const k = kernel
  const dir = normalize(step.dir)
  if (!dir) throw new Error('The extrusion has no direction.')
  const outlines = faces.map((f) => outlineOf(kernel, f, step.origin, dir))
  const corners = outlines.flatMap((o) => o.loops.flatMap((l) => l.points.map(([x, y]) => addScaled(addScaled(step.origin, o.u, x), o.v, y))))
  const leanOut = Math.tan((Math.max(0, -step.draftDeg) * Math.PI) / 180)
  /** Where the outline meets a plane, as offsets along the normal. */
  const hits = (plane: PlaneGeometry): { min: number; max: number; stretch: number } => {
    const c = dot(dir, plane.normal)
    if (Math.abs(c) < 1e-9) throw new Error('A plane this extrusion reaches to runs along it, so it never ends it.')
    let min = Infinity
    let max = -Infinity
    for (const p of corners) {
      const t = dot(sub(plane.origin, p), plane.normal) / c
      if (t < min) min = t
      if (t > max) max = t
    }
    // A side leaning out meets a plane tilted back from it further on.
    const tilt = Math.sqrt(Math.max(0, 1 - c * c)) / Math.abs(c)
    if (leanOut * tilt >= 1 - 1e-9) throw new Error('The sides lean out further than the plane they reach to tilts away — they never meet it. Ease the taper.')
    return { min, max, stretch: 1 / (1 - leanOut * tilt) }
  }
  // The two ends as offsets along the normal, and whether each is found on
  // a plane — the prism then runs a hair past it, for the trim to cut.
  let lo: number
  let hi: number
  let loOnPlane = false
  let hiOnPlane = false
  let stretch = 1
  if (toFace || (typeof step.from === 'number' && typeof step.to !== 'number')) {
    // To a plane or a face: as far as the outline has to go to pass it,
    // the way it lies from the start.
    const h = hits(toFace ?? (step.to as PlaneGeometry))
    lo = step.from as number
    hi = (h.min + h.max) / 2 >= lo ? h.max : h.min
    hiOnPlane = true
    stretch = h.stretch
  } else if (typeof step.from === 'number' && typeof step.to === 'number') {
    lo = step.from
    hi = step.to
  } else {
    // Between two planes: over everything between them.
    const a = hits(step.from as PlaneGeometry)
    const b = hits(step.to as PlaneGeometry)
    lo = Math.min(a.min, b.min)
    hi = Math.max(a.max, b.max)
    loOnPlane = hiOnPlane = true
    stretch = Math.max(a.stretch, b.stretch)
  }
  // The profile's own section: at the sketch plane, or at the end of the
  // extent nearest it.
  const start = Math.min(Math.max(0, Math.min(lo, hi)), Math.max(lo, hi))
  const past = (e: number) => start + (e - start) * stretch + Math.sign(e - start) * (1e-3 * Math.abs(e - start) + 1e-3)
  const ends = [loOnPlane ? past(lo) : lo, hiOnPlane ? past(hi) : hi].filter((e) => Math.abs(e - start) > 1e-9)
  if (ends.length === 0) throw new Error('The extrusion has no length.')
  for (const end of ends) {
    const length = Math.abs(end - start)
    const limit = taperLimitOf(outlines, step.draftDeg, length)
    if (limit.reach < length - 1e-9) throw taperRefusal(step.draftDeg, limit.reach, length, limit.broke)
  }
  return fuseAll(kernel, faces.flatMap((f) => ends.map((end) => k.extrude(f, dir, start, end, step.draftDeg))))
}

/** A flat face's outline in its plane, through `origin` square to `dir`,
 *  edge by edge — what a taper is checked against (see taper.ts). Each
 *  edge is sampled much finer than a body is drawn: a round's chords stand
 *  inside it by that much, and close that much early. */
export function outlineOf(kernel: ReKernel, face: Shape, origin: Vec3, dir: Vec3): Outline {
  const u = normalize(cross(dir, Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) ?? [1, 0, 0]
  const v = cross(dir, u)
  const edges = kernel.edges(face, meshDeflection(diagonalOf(kernel, face)) / 20)
  return { loops: faceOutline(edges, origin, u, v), origin, u, v }
}

/** A face's outline in its plane: its loops, and the plane's origin and
 *  axes they are measured in. */
export interface Outline {
  loops: EdgeLoop[]
  origin: Vec3
  u: Vec3
  v: Vec3
}

/** How far the outlines can run with the taper before one of them breaks
 *  — `length` when they hold all the way. */
export function taperReachOf(outlines: readonly EdgeLoop[][], draftDeg: number, length: number): number {
  const leanIn = Math.tan((draftDeg * Math.PI) / 180)
  let reach = length
  for (const loops of outlines) reach = Math.min(reach, taperLimit(loops, leanIn, reach).reach)
  return reach
}

/** How far the outlines can run with the taper, and where the first to
 *  break broke, in the outlines' space. */
export function taperLimitOf(outlines: readonly Outline[], draftDeg: number, length: number): { reach: number; broke?: { why: NonNullable<TaperReach['broke']>['why']; at: Vec3[] } } {
  const leanIn = Math.tan((draftDeg * Math.PI) / 180)
  let out: ReturnType<typeof taperLimitOf> = { reach: length }
  for (const o of outlines) {
    const limit = taperLimit(o.loops, leanIn, out.reach)
    if (limit.reach < out.reach) out = { reach: limit.reach, broke: limit.broke && { why: limit.broke.why, at: limit.broke.at.map(([x, y]) => addScaled(addScaled(o.origin, o.u, x), o.v, y)) } }
  }
  return out
}

/** A taper refused: how far it can run against how far the extrude does,
 *  and — when it is known — what breaks there and where. */
export function taperRefusal(draftDeg: number, reach: number, length: number, broke?: { why: 'vanishes' | 'folds' | 'crosses'; at: Vec3[] }): Error {
  const where = (p: Vec3) => `(${p.map((x) => x.toFixed(2)).join(', ')})`
  const what = !broke
    ? ''
    : broke.why === 'crosses'
      ? `: the edges through ${where(broke.at[0])} and ${where(broke.at[1])} run into each other there`
      : broke.why === 'vanishes'
        ? `: the edge through ${where(broke.at[0])} shrinks to nothing there`
        : `: the edge through ${where(broke.at[0])} folds over itself there`
  // units-ok: build message, also the agent's answer
  return new Error(`The taper ${draftDeg > 0 ? 'closes the profile' : 'closes a hole or a notch of the profile'} ${reach.toFixed(2)} mm from where it starts, and the extrude runs ${length.toFixed(2)} mm that way${what} — ease the taper, or shorten the extrude.`)
}

/** How far shapes reach along a direction from a point, off their
 *  tessellation — a bounding box is too long on a body that lies askew. */
export function reachAlong(kernel: ReKernel, shapes: readonly Shape[], origin: Vec3, dir: Vec3): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const s of shapes) {
    const m = kernel.mesh(s, meshDeflection(diagonalOf(kernel, s)) * 4)
    for (let i = 0; i < m.positions.length; i += 3) {
      const t = dot(sub([m.positions[i], m.positions[i + 1], m.positions[i + 2]], origin), dir)
      if (t < min) min = t
      if (t > max) max = t
    }
  }
  return { min, max }
}

/**
 * An extrude up to a shape the kernel has no plane of — a curved face, a
 * body's skin (`limit`, named `what` in a refusal): each region of the
 * profile (`faces`) run from `start` right through the shape, `toward` the
 * way it lies along `dir`, and split by it; of the pieces, those that start
 * at the profile are kept — along every line of the profile, from the
 * sketch to where it first meets the shape. A kept piece that still reaches
 * the far end never met it there: the shape does not cover the whole
 * profile, and that is refused, saying where, rather than left sticking
 * out of the part. A taper leans from the start; one that closes the
 * profile before the far end is refused as for any extrude.
 */
/** How far a face stops short of a prism, square to the extrude: the largest
 *  the prism's box runs past the face's on the two axes most square to it, in
 *  mm and as a share of the face's width there — what a fitted surface's
 *  expandPct has to grow by. Empty where the boxes do not show it. */
function shortOfProfile(kernel: ReKernel, prism: Shape, limit: Shape, dir: Vec3): string {
  const p = kernel.bounds(prism), f = kernel.bounds(limit)
  let mm = 0, axis = 0
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) > 0.7) continue
    const past = Math.max(f.min[i] - p.min[i], p.max[i] - f.max[i])
    if (past > mm) {
      mm = past
      axis = i
    }
  }
  if (!(mm > 1e-3)) return ''
  const width = f.max[axis] - f.min[axis]
  const share = width > 0 ? ` — about ${Math.ceil((100 * mm) / width)} % of its width, which a fitted surface's expandPct adds` : ''
  // units-ok: build message, also the agent's answer
  return ` The face stops up to ${mm.toFixed(2)} mm short along ${'xyz'[axis]}${share}.`
}

export function extrudeUpTo(kernel: ReKernel, faces: readonly Shape[], origin: Vec3, dir: Vec3, start: number, draftDeg: number, limit: Shape, toward: 1 | -1, what: string): Shape {
  const k = kernel
  const reach = reachAlong(kernel, [limit], origin, dir)
  if (!Number.isFinite(reach.min)) throw new Error(`${upper(what)} has nothing to reach to.`)
  if (toward > 0 ? !(reach.max > start + 1e-6) : !(reach.min < start - 1e-6)) throw new Error(`${upper(what)} lies ${toward > 0 ? 'behind' : 'ahead of'} the sketch — nothing meets it that way.`)
  const margin = Math.max(1, 0.01 * (reach.max - reach.min))
  const far = toward > 0 ? Math.max(reach.max, start) + margin : Math.min(reach.min, start) - margin
  const length = Math.abs(far - start)
  const unit = normalize(dir) ?? dir
  if (Math.abs(draftDeg) > 1e-9) {
    const limitOf = taperLimitOf(faces.map((f) => outlineOf(kernel, f, origin, unit)), draftDeg, length)
    if (limitOf.reach < length - 1e-9) throw taperRefusal(draftDeg, limitOf.reach, length, limitOf.broke)
  }
  // How near the start a piece has to begin, and the far end to reach, to
  // count as there.
  const hair = 1e-3 * length + 1e-4
  const kept: Shape[] = []
  try {
    for (const f of faces) {
      const prism = k.extrude(f, dir, start, far, draftDeg)
      const pieces: Shape[] = []
      try {
        pieces.push(...k.split(prism, [limit]))
        if (pieces.length < 2) {
          throw new Error(k.distanceBetween(prism, limit) > 1e-6 ? `The profile never meets ${what} that way — it passes beside it.` : `${upper(what)} does not cover the whole profile: the extrude runs past its edge and never ends on it. Draw the profile within what the face covers, or extrude up to the body.${shortOfProfile(kernel, prism, limit, dir)}`)
        }
        for (let i = pieces.length - 1; i >= 0; i--) {
          const r = reachAlong(kernel, [pieces[i]], origin, dir)
          const begins = toward > 0 ? r.min - start <= hair : start - r.max <= hair
          if (!begins) continue
          if (toward > 0 ? r.max >= far - hair : r.min <= far + hair) {
            const at = k.centroid(pieces[i])
            throw new Error(`${upper(what)} does not cover the whole profile: about (${at.map((x) => x.toFixed(2)).join(', ')}) the extrude runs past its edge and never ends on it. Draw the profile within what the face covers, or extrude up to the body.${shortOfProfile(kernel, prism, limit, dir)}`)
          }
          kept.push(pieces[i])
          pieces.splice(i, 1)
        }
      } finally {
        k.release(prism, ...pieces)
      }
    }
  } catch (e) {
    k.release(...kept)
    throw e
  }
  if (kept.length === 0) throw new Error(`Nothing of the profile reaches ${what}.`)
  return fuseAll(kernel, kept)
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The parts fused into one shape, which is handed back; the parts are
 *  used up. */
export function fuseAll(kernel: ReKernel, parts: Shape[]): Shape {
  if (parts.length === 1) return parts[0]
  try {
    return kernel.fuseAll(parts)
  } finally {
    kernel.release(...parts)
  }
}
