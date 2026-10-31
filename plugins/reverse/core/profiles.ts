// SPDX-License-Identifier: AGPL-3.0-only
// Sketch profiles lifted into the part: points and pieces taken from a
// sketch's plane to 3D, the regions a feature picked, a loft's sections and
// a sweep's path, and how far a profile reaches — whether it crosses a
// revolve's axis.

import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { addScaled, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { PlaneGeometry } from './buildSteps'
import { openEnds } from './corners'
import type { ExtrudeFeature, RevolveFeature, SketchFeature } from './features'
import { type LoopPiece, piecePoints, type Profile } from './kernel'
import { circleThrough } from './kernelMath'
import { loopGeometry, matchRegions, mergeRegions, type ProfilePiece2, type Region, regionsByPick } from './regions'
import { anchorPoint, arcPoint, type Sketch, type SketchArc, sketchBounds, type SketchLine, type SketchSpline, TOUCH_MM } from './sketch'
import { isClosed, splineCurve, splineDirAt, splineEnd, splineStretch } from './sketchSpline'
import { STATION_MIN_PIECE_MM } from './stations'
import { routePieces, type SweepRoute } from './sweepRoute'

/** Lift a sheet point through the frame into the part. */
export function liftPoint(frame: SectionFrame, p: readonly [number, number]): Vec3 {
  return addScaled(addScaled(frame.origin, frame.basisU, p[0]), frame.basisV, p[1])
}

function liftPiece(frame: SectionFrame, piece: ProfilePiece2): LoopPiece {
  switch (piece.kind) {
    case 'line':
      return { kind: 'line', a: liftPoint(frame, piece.a), b: liftPoint(frame, piece.b) }
    case 'arc':
      return { kind: 'arc', a: liftPoint(frame, piece.a), m: liftPoint(frame, piece.m), b: liftPoint(frame, piece.b) }
    case 'circle':
      return { kind: 'circle', center: liftPoint(frame, piece.c), normal: frame.normal, radius: piece.r }
    case 'spline':
      // A B-spline lifted pole by pole is the curve lifted: the map is affine.
      return { kind: 'spline', poles: piece.poles.map((p) => liftPoint(frame, p)), knots: piece.knots, mults: piece.mults }
  }
}

/** A whole spline of the sketch, or the stretch of it from t0 to t1, lifted
 *  into the part — null where it has no length. */
function liftSpline(frame: SectionFrame, e: SketchSpline, t0?: number, t1?: number): LoopPiece | null {
  const fit = splineCurve(e)
  const stretch = splineStretch(fit, t0 ?? 0, t1 ?? splineEnd(fit))
  return stretch ? liftPiece(frame, { kind: 'spline', ...stretch }) : null
}

/** Every drawn piece of a sketch — lines, arcs, circles, splines, not
 *  construction — lifted into the part, for a sheet: the pieces as they
 *  stand, no region needed, an open chain as good as a closed one. */
export function sketchPieces(sketch: Pick<SketchFeature, 'frame' | 'sketch'>): LoopPiece[] {
  const out: LoopPiece[] = []
  for (const e of sketch.sketch.entities) {
    if (e.construction) continue
    if (e.kind === 'line') out.push({ kind: 'line', a: liftPoint(sketch.frame, e.a), b: liftPoint(sketch.frame, e.b) })
    else if (e.kind === 'circle') out.push({ kind: 'circle', center: liftPoint(sketch.frame, e.c), normal: sketch.frame.normal, radius: e.r })
    else if (e.kind === 'spline') {
      const piece = liftSpline(sketch.frame, e)
      if (piece) out.push(piece)
    }
    else if (e.kind === 'arc') {
      const at = (angle: number): [number, number] => [e.c[0] + e.r * Math.cos(angle), e.c[1] + e.r * Math.sin(angle)]
      out.push({ kind: 'arc', a: liftPoint(sketch.frame, at(e.start)), m: liftPoint(sketch.frame, at(e.start + e.sweep / 2)), b: liftPoint(sketch.frame, at(e.start + e.sweep)) })
    }
  }
  return out
}

/** The rigid map that carries a sketch from one frame to another: a point
 *  keeps its sheet coordinates, a direction its components — what moves
 *  the profiles lifted in a face's old frame to where the face is now. */
export function frameMap(from: SectionFrame, to: SectionFrame): { point: (p: Vec3) => Vec3; dir: (d: Vec3) => Vec3 } {
  const dir = (d: Vec3): Vec3 => {
    const u = dot(d, from.basisU)
    const v = dot(d, from.basisV)
    const w = dot(d, from.normal)
    return addScaled(addScaled(scale(to.basisU, u), to.basisV, v), to.normal, w)
  }
  const point = (p: Vec3): Vec3 => addScaled(dir([p[0] - from.origin[0], p[1] - from.origin[1], p[2] - from.origin[2]]), to.origin, 1)
  return { point, dir }
}

/** Profiles carried through a frame map. */
export function moveProfiles(profiles: readonly Profile[], map: ReturnType<typeof frameMap>): Profile[] {
  const piece = (p: LoopPiece): LoopPiece =>
    p.kind === 'line'
      ? { ...p, a: map.point(p.a), b: map.point(p.b) }
      : p.kind === 'arc'
        ? { ...p, a: map.point(p.a), m: map.point(p.m), b: map.point(p.b) }
        : p.kind === 'spline'
          ? { ...p, poles: p.poles.map(map.point) }
          : { ...p, center: map.point(p.center), normal: map.dir(p.normal) }
  return profiles.map((pr) => ({ outer: pr.outer.map(piece), holes: pr.holes.map((h) => h.map(piece)) }))
}

/** The picked regions of a sketch as profiles in the part — with `merge`,
 *  those that share a stretch of their boundary one profile
 *  (mergeRegions). Not for a tapered extrude: each region's sides lean on
 *  their own there, a groove between two, and a project saved with one
 *  keeps the solid it had. */
export function liftRegions(frame: SectionFrame, sketch: Sketch, picked: readonly Region[], merge = true): Profile[] {
  const regions = merge ? mergeRegions(picked, sketch) : picked
  // Each piece carries the sketch piece it came from, when the loop's
  // geometry is piece for piece — what an answer names a join by.
  const lift = (loop: Region['outer']): LoopPiece[] => {
    const geometry = loopGeometry(loop, sketch)
    const whole = geometry.length === loop.pieces.length
    return geometry.map((p, i) => (whole ? { ...liftPiece(frame, p), entity: loop.pieces[i].entity } : liftPiece(frame, p)))
  }
  return regions.map((r) => ({ outer: lift(r.outer), holes: r.holes.map(lift) }))
}

/** The profiles a feature picked, lifted into the part — or why there are
 *  none: nothing picked, or the sketch changed under the pick. */
export function pickedProfiles(
  f: Pick<ExtrudeFeature | RevolveFeature, 'regions'> & Partial<Pick<ExtrudeFeature, 'regionPick' | 'draftDeg'>>,
  sketch: SketchFeature,
  regionsOf: (sketch: SketchFeature) => Region[],
): Profile[] | string {
  if (f.regions.length === 0) return 'No profile picked — click the sketch’s regions in the viewport.'
  const regions = regionsOf(sketch)
  // A pick kept as it was given, while it stands, is taken as given; the
  // keys are fingerprints otherwise: a sketch edited under the pick still
  // hands back the same faces where they can be told apart — see
  // matchRegion.
  const given = f.regionPick && f.regionPick.keys.length === f.regions.length && f.regionPick.keys.every((k) => f.regions.includes(k)) ? regionsByPick(f.regionPick.given, regions) : null
  const picked = given ?? matchRegions(f.regions, regions)
  if (picked.length === 0) return regions.length > 0 ? lostPickWords(f.regions.length, sketch.name, regions) : `The picked profiles are no longer closed — the sketch changed under them.${openEndsWords(sketch.sketch)}`
  return liftRegions(sketch.frame, sketch.sketch, picked, !f.draftDeg)
}

/** How many regions a lost pick's answer lists. */
const REGIONS_NAMED = 8

/** What a pick that names none of a sketch's closed regions says: the
 *  regions there are, each by its key, its area and a point inside it,
 *  to pick again by. */
export function lostPickWords(picks: number, sketch: string, regions: readonly Region[]): string {
  // units-ok: build message, also the agent's answer.
  const listed = regions.slice(0, REGIONS_NAMED).map((r) => `${r.key} (${mmWords(r.area)} mm², at [${r.inside.map(mmWords).join(', ')}])`)
  const more = regions.length > listed.length ? ` and ${regions.length - listed.length} more` : ''
  return `None of the ${picks === 1 ? 'profile' : `${picks} profiles`} picked is in ${sketch} as it is now — an edit remade the pieces round ${picks === 1 ? 'it' : 'them'}. It has ${regions.length} closed region${regions.length === 1 ? '' : 's'}: ${listed.join('; ')}${more} — pick again: regions "all", "largest", their keys, or a point inside each ({ at: [u, v] }).`
}

/** A length or an area as an answer gives it: to the micron, and to two
 *  figures under a hundredth, where microns are all there is. */
const mmWords = (x: number) => (Math.abs(x) < 0.01 ? Number(x.toPrecision(2)) : Math.round(x * 1000) / 1000)

/** How many open ends a "no longer closed" answer names. */
const OPEN_ENDS_NAMED = 4

/** A sketch's open ends in words, for an answer whose profile is no longer
 *  closed — each end, the end nearest it and the gap, the smallest first:
 *  a miss of a tenth of a millimetre is seen as one. Empty when every end
 *  meets another. */
export function openEndsWords(sketch: Pick<Sketch, 'entities'>): string {
  // Two ends that miss each other are one miss, told once.
  const all = openEnds(sketch)
  const open = all.filter((o, i) => !all.slice(0, i).some((p) => p.piece === o.nearest?.piece && p.end === o.nearest.end && p.nearest?.piece === o.piece && p.nearest.end === o.end))
  if (open.length === 0) return ''
  // units-ok: build message, also the agent's answer
  const named = open.slice(0, OPEN_ENDS_NAMED).map((o) => `piece ${o.piece} end ${o.end}${o.nearest && o.gap !== null ? ` is ${mmWords(o.gap)} mm from piece ${o.nearest.piece} end ${o.nearest.end}` : ' meets nothing'}`)
  return ` Its open ends: ${named.join('; ')}${open.length > named.length ? ` (and ${open.length - named.length} more)` : ''} — put the ends together (a coincident) or redraw the piece to end exactly there.`
}

/** The regions that share pieces with `region`, it among them, round their
 *  outer loops — one chain closing them all, crossing itself or cut
 *  across. A hole's own face, bounded by the hole's pieces only, is no
 *  part of it. */
function regionsOfOneChain(region: Region, regions: readonly Region[]): Region[] {
  const group = [region]
  const ids = new Set(region.outer.pieces.map((p) => p.entity))
  for (let grew = true; grew; ) {
    grew = false
    for (const r of regions) {
      if (group.includes(r) || !r.outer.pieces.some((p) => ids.has(p.entity))) continue
      group.push(r)
      for (const p of r.outer.pieces) ids.add(p.entity)
      grew = true
    }
  }
  return group
}

/** The profile a loft takes from a sketch: its largest region — or why
 *  there is none, or why it would be the wrong one: the chain it is closed
 *  by closes others too, crossing itself (a folded station), and the loft
 *  would take a fragment of the profile without a word. */
export function loftProfile(sketch: Pick<SketchFeature, 'frame' | 'sketch' | 'name'>, regions: readonly Region[], what = 'the loft'): Profile | string {
  if (regions.length === 0) return `${sketch.name} has no closed region for ${what}.${openEndsWords(sketch.sketch)}`
  const region = regions.reduce((a, b) => (b.area > a.area ? b : a))
  const one = regionsOfOneChain(region, regions)
  if (one.length > 1) {
    const areas = one.map((r) => r.area).sort((a, b) => b - a).map(mmWords)
    // units-ok: build message, also the agent's answer.
    return `${sketch.name}'s pieces close ${one.length} regions (areas ${areas.join(', ')} mm²) — the profile crosses itself or is cut across, and ${what} would take the largest alone. Read its pieces (reverse.feature.list) and fit or draw it again so it closes one region.`
  }
  return liftRegions(sketch.frame, sketch.sketch, [region])[0]
}

/** A loft's profile spanning more than this many times its neighbours'
 *  (or, at an end, its neighbour's times the loft's own growth there) has
 *  run off: two pieces met far out, nothing of the part. */
const LOFT_EXTENT_JUMP = 3

/** A profile's extent: the diagonal of the box round its outline. */
function profileExtent(profile: Profile): number {
  const pts = profile.outer.flatMap((p) => piecePoints(p))
  const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])))
  const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])))
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
}

/**
 * What would make a loft through these sketches fail in the kernel, or come
 * out wrong without a word, checked before it is tried, in words — or null:
 * a piece of a section under STATION_MIN_PIECE_MM (the kernel's
 * `NCollection_DataMap::Find`), or a section far larger than its neighbours
 * (a corner met far off — "ok" at many times the volume). A section that
 * crosses itself is loftProfile's to refuse.
 */
export function loftProblem(sketches: readonly Pick<SketchFeature, 'id' | 'sketch' | 'name'>[], profiles: readonly Profile[]): string | null {
  for (const s of sketches) {
    for (const e of s.sketch.entities) {
      if (e.construction || (e.kind !== 'line' && e.kind !== 'arc')) continue
      const length = e.kind === 'line' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) : e.r * Math.abs(e.sweep)
      // units-ok: build message, also the agent's answer
      if (length < STATION_MIN_PIECE_MM) return `${s.name}'s piece ${e.id} (${e.kind === 'arc' ? 'an arc' : 'a line'}) is ${mmWords(length)} mm long — under ${STATION_MIN_PIECE_MM} mm: no piece of a section, and one the kernel can stop on (NCollection_DataMap::Find) or fold at. Take it out (reverse.sketch.edit remove) and join its neighbours, or fit that section again.`
    }
  }
  const extents = profiles.map(profileExtent)
  const n = extents.length
  const round = (x: number) => Math.round(x * 10) / 10
  for (let i = 0; i < n && n >= 3; i++) {
    const near = [extents[i - 1], extents[i + 1]].filter((x): x is number => x !== undefined)
    // At an end, a jump past the loft's own growth into it.
    const growth = i === 0 ? extents[1] / extents[2] : i === n - 1 ? extents[n - 2] / extents[n - 3] : 1
    if (extents[i] > LOFT_EXTENT_JUMP * Math.max(1, growth) * Math.max(...near)) {
      // units-ok: build message, also the agent's answer
      return `${sketches[i].name} spans ${round(extents[i])} mm across, its neighbours ${near.map(round).join(' and ')} mm — a piece of it runs far off, likely two nearly parallel pieces met far out. Read its pieces (reverse.feature.list) and fit it again, pointed with within or facing.`
    }
  }
  return null
}

/** How far off square to the path where it starts a sweep's profile may
 *  stand, degrees. */
const SWEEP_SQUARE_DEG = 1

/** How far off a profile's plane a route may start, mm. */
const ROUTE_ON_PLANE_MM = 0.05

/** The middle of a profile's outline: the mean of the points it is drawn
 *  through — which end of a path a sweep starts from. */
export function profileMiddle(profile: Profile): Vec3 {
  const points = profile.outer.flatMap((p) => piecePoints(p))
  return [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length) as Vec3
}

/**
 * A sweep's path: the one chain of a sketch's lines and arcs, end to end,
 * lifted into the part and run from the end nearest `from` — a closed
 * chain from the end nearest it — with the point it starts at and the way
 * it leaves; or why there is none: no piece, a circle (it has no end to
 * start from), a branch, or more than one chain.
 */
export function sweepPath(sketch: Pick<SketchFeature, 'frame' | 'sketch' | 'name'>, from: Vec3): { pieces: LoopPiece[]; start: Vec3; tangent: Vec3 } | string {
  const own = sketch.sketch.entities.filter((e) => !e.construction && e.kind !== 'point')
  if (own.some((e) => e.kind === 'circle')) return `${sketch.name} has a circle — a sweep's path is lines, arcs and splines end to end; draw a closed path as arcs.`
  if (own.some((e) => e.kind === 'spline' && isClosed(e))) return `${sketch.name} has a closed spline — a sweep's path has a start; draw it open, its ends joined to the rest of the path.`
  const pieces = own.filter((e): e is SketchLine | SketchArc | SketchSpline => e.kind === 'line' || e.kind === 'arc' || e.kind === 'spline')
  if (pieces.length === 0) return `${sketch.name} has no line, arc or spline for the profile to follow.`
  const lift = (p: Vec2) => liftPoint(sketch.frame, p)
  const ends = pieces.flatMap((e, i) => (['a', 'b'] as const).map((end) => ({ piece: i, end, at: anchorPoint(e, end) })))
  const meeting = (p: (typeof ends)[number]) => ends.filter((q) => q.piece !== p.piece && Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) <= TOUCH_MM)
  if (ends.some((p) => meeting(p).length > 1)) return `${sketch.name} branches — three pieces meet at a point; a sweep follows one chain.`
  const loose = ends.filter((p) => meeting(p).length === 0)
  const far = (p: (typeof ends)[number]) => len(sub(lift(p.at), from))
  const first = (loose.length > 0 ? loose : ends).reduce((a, b) => (far(b) < far(a) ? b : a))
  const out: LoopPiece[] = []
  const used = new Set<number>()
  for (let at: (typeof ends)[number] | undefined = first; at && !used.has(at.piece); ) {
    const e = pieces[at.piece]
    used.add(at.piece)
    const other: 'a' | 'b' = at.end === 'a' ? 'b' : 'a'
    if (e.kind === 'spline') {
      // Run the way the path goes: from the end it is come to.
      const end = splineEnd(splineCurve(e))
      const piece = at.end === 'a' ? liftSpline(sketch.frame, e, 0, end) : liftSpline(sketch.frame, e, end, 0)
      if (piece) out.push(piece)
    } else out.push(e.kind === 'line' ? { kind: 'line', a: lift(anchorPoint(e, at.end)), b: lift(anchorPoint(e, other)) } : { kind: 'arc', a: lift(anchorPoint(e, at.end)), m: lift(arcPoint(e, e.start + e.sweep / 2)), b: lift(anchorPoint(e, other)) })
    at = meeting(ends.find((x) => x.piece === at!.piece && x.end === other)!)[0]
  }
  if (used.size < pieces.length) return `${sketch.name} is in ${loose.length > 2 ? loose.length / 2 : 'more than one'} chains — a sweep follows one.`
  // The way the path leaves its start, in the sheet and then in the part.
  const e = pieces[first.piece]
  let d: Vec2
  if (e.kind === 'line') d = first.end === 'a' ? [e.b[0] - e.a[0], e.b[1] - e.a[1]] : [e.a[0] - e.b[0], e.a[1] - e.b[1]]
  else if (e.kind === 'spline') {
    const fit = splineCurve(e)
    const run = splineDirAt(fit, first.end === 'a' ? 0 : splineEnd(fit))
    d = first.end === 'a' ? run : [-run[0], -run[1]]
  } else {
    const angle = first.end === 'a' ? e.start : e.start + e.sweep
    const turn = (first.end === 'a' ? 1 : -1) * Math.sign(e.sweep)
    d = [-Math.sin(angle) * turn, Math.cos(angle) * turn]
  }
  const tangent = normalize(addScaled(scale(sketch.frame.basisU, d[0]), sketch.frame.basisV, d[1]))
  if (!tangent) return `${sketch.name}'s path starts with a piece of no length.`
  return { pieces: out, start: lift(first.at), tangent }
}

/** Where a sweep's path starts and which way it leaves, and the plane to
 *  sketch its profile on: a coordinate plane where the path leaves along
 *  an axis, said whole; else the point and the way, for a measured plane
 *  or a path started along an axis. */
function sweepStartWords(path: string, start: Vec3, tangent: Vec3): string {
  const r = (x: number) => Math.round(x * 1000) / 1000 || 0
  const at = `(${start.map(r).join(', ')})`
  const way = `(${tangent.map(r).join(', ')})`
  const k = [0, 1, 2].reduce((a, b) => (Math.abs(tangent[b]) > Math.abs(tangent[a]) ? b : a))
  const axis = (['x', 'y', 'z'] as const)[k]
  const along = Math.abs(tangent[k]) >= Math.cos((SWEEP_SQUARE_DEG * Math.PI) / 180)
  const plane = along
    ? `the plane { kind: "world", axis: "${axis}", offset: ${r(start[k])} } is square to it there`
    : 'no coordinate plane is square to it there: sketch on a measured plane with that normal through that point, or start the path along a coordinate axis'
  return `${path} starts at ${at} and leaves along ${way}; sketch the profile on a plane through that point square to that way — ${plane}.`
}

/**
 * What a sweep sweeps: the profile sketch's largest region, and the path
 * sketch's one chain run from the end nearest the profile — held to the
 * profile's plane standing square to the path where it starts, within
 * SWEEP_SQUARE_DEG; or why not, the angle said.
 */
export function sweepGeometry(profileSketch: Pick<SketchFeature, 'frame' | 'sketch' | 'name'>, regions: readonly Region[], pathSketch: Pick<SketchFeature, 'frame' | 'sketch' | 'name'>): { profile: Profile; path: LoopPiece[]; from: Vec3 } | string {
  const profile = loftProfile(profileSketch, regions, 'the sweep')
  if (typeof profile === 'string') return profile
  const from = profileMiddle(profile)
  const path = sweepPath(pathSketch, from)
  if (typeof path === 'string') return path
  const off = (Math.acos(Math.min(1, Math.abs(dot(path.tangent, profileSketch.frame.normal)))) * 180) / Math.PI
  if (off > SWEEP_SQUARE_DEG) return `${profileSketch.name}'s plane stands ${off.toFixed(1)}° off square to the path where it starts — ${sweepStartWords(pathSketch.name, path.start, path.tangent)}`
  return { profile, path: path.pieces, from }
}

/**
 * What a sweep along a route sweeps: the profile sketch's largest region, and
 * the route's straights and bends run from the end nearest the profile — held
 * as sweepGeometry holds a path, and the start has to lie on the profile: in
 * its plane within ROUTE_ON_PLANE_MM and inside its reach. The route comes
 * from the scan and the profile is sketched for it, so a miss is a mistake
 * here; it would sweep a tube beside the one measured with no other word.
 */
export function routeSweepGeometry(profileSketch: Pick<SketchFeature, 'frame' | 'sketch' | 'name'>, regions: readonly Region[], route: SweepRoute): { profile: Profile; path: LoopPiece[]; from: Vec3 } | string {
  const profile = loftProfile(profileSketch, regions, 'the sweep')
  if (typeof profile === 'string') return profile
  const from = profileMiddle(profile)
  const path = routePieces(route, from)
  if (typeof path === 'string') return path
  const { frame, name } = profileSketch
  const off = (Math.acos(Math.min(1, Math.abs(dot(path.tangent, frame.normal)))) * 180) / Math.PI
  if (off > SWEEP_SQUARE_DEG) return `${name}'s plane stands ${off.toFixed(1)}° off square to the route where it starts — ${sweepStartWords('The route', path.start, path.tangent)}`
  const aside = Math.abs(dot(sub(path.start, frame.origin), frame.normal))
  // units-ok: build message, also the agent's answer
  if (aside > ROUTE_ON_PLANE_MM) return `${name}'s plane lies ${aside.toFixed(3)} mm off the route's start — ${sweepStartWords('The route', path.start, path.tangent)}`
  const round = profile.outer.flatMap((p) => piecePoints(p)).map((q) => len(sub(q, path.start)))
  const reach = Math.max(...profile.outer.flatMap((p) => piecePoints(p)).map((q) => len(sub(q, from))))
  const apart = len(sub(path.start, from))
  // units-ok: build message, also the agent's answer
  if (apart > reach) return `The route starts ${apart.toFixed(3)} mm from the middle of ${name}'s profile, which reaches ${reach.toFixed(3)} mm — ${sweepStartWords('The route', path.start, path.tangent)}`
  // A bend tighter than the section's nearest wall folds whichever way the
  // section lies: the kernel gives a closed solid of it with no word.
  const near = Math.min(...round)
  const tight = path.bends.find((b) => b.radius <= near)
  // units-ok: build message, also the agent's answer
  if (tight) return `The bend at points[${tight.index}] of radius ${tight.radius} mm is tighter than ${name}'s profile, every side of it at least ${near.toFixed(3)} mm from the route: the inside of the bend would fold through itself.`
  return { profile, path: path.pieces, from }
}

/** How far "far" is for an extrusion limited by a plane: past every plane
 *  and the sketch by a comfortable margin, so the trim always has material
 *  to trim. */
export function farReach(origin: Vec3, dir: Vec3, sketch: Sketch, planes: readonly PlaneGeometry[]): number {
  const b = sketchBounds(sketch)
  let reach = b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) : 10
  for (const p of planes) reach = Math.max(reach, Math.abs(dot([p.origin[0] - origin[0], p.origin[1] - origin[1], p.origin[2] - origin[2]], dir)) * 2)
  return Math.max(reach * 4, 10)
}

/** How far profiles reach along an axis through `origin` along unit `dir`,
 *  from the nearest point to the furthest — what a coil's pitch has to
 *  clear. */
export function profileSpan(profiles: readonly Profile[], origin: Vec3, dir: Vec3): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const p of profiles) {
    for (const loop of [p.outer, ...p.holes]) {
      for (const piece of loop) {
        for (const q of piecePoints(piece)) {
          const along = dot([q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]], dir)
          if (along < min) min = along
          if (along > max) max = along
        }
      }
    }
  }
  return { min, max }
}

/**
 * Whether any of the profiles touches or crosses an axis through `origin`
 * along unit `dir` — what a coil cannot have, every turn of it passing
 * through the axis. An axis in the profile's plane has to keep to one side
 * of the profile, clear of it; one piercing the plane has to pierce it
 * outside the profile, or in a hole of it.
 */
export function profilesMeetAxis(profiles: readonly Profile[], origin: Vec3, dir: Vec3, tol = 1e-6): boolean {
  const pointsOf = (loop: readonly LoopPiece[]) => loop.flatMap((piece) => piecePoints(piece))
  for (const p of profiles) {
    const outer = pointsOf(p.outer)
    // The plane's normal by Newell's sum, sound for any loop in it.
    let n: Vec3 = [0, 0, 0]
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]
      const b = outer[(i + 1) % outer.length]
      n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]
    }
    const normal = normalize(n)
    if (!normal) continue
    const across = dot(normal, dir)
    const off = (q: Vec3): Vec3 => [q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]]
    if (Math.abs(across) < 1e-9) {
      // Along the plane: beside it, clear; in it, on one side of the profile.
      if (Math.abs(dot(off(outer[0]), normal)) > tol) continue
      const side = cross(normal, dir)
      let lo = Infinity
      let hi = -Infinity
      for (const q of outer) {
        const d = dot(off(q), side)
        if (d < lo) lo = d
        if (d > hi) hi = d
      }
      if (lo <= tol && hi >= -tol) return true
      continue
    }
    // Through the plane: where it pierces it, inside the profile or not.
    const pierce = addScaled(origin, dir, dot(off(outer[0]), normal) / across)
    const u = normalize(cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) ?? [1, 0, 0]
    const v = cross(normal, u)
    const flat = (q: Vec3): [number, number] => {
      const d: Vec3 = [q[0] - pierce[0], q[1] - pierce[1], q[2] - pierce[2]]
      return [dot(d, u), dot(d, v)]
    }
    /** Whether the loop runs through the piercing point, winds round it,
     *  or passes it by. */
    const where = (loop: readonly Vec3[]): 'on' | 'in' | 'out' => {
      let inside = false
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const [xi, yi] = flat(loop[i])
        const [xj, yj] = flat(loop[j])
        const ex = xj - xi
        const ey = yj - yi
        const l2 = ex * ex + ey * ey
        const t = l2 > 0 ? Math.max(0, Math.min(1, -(xi * ex + yi * ey) / l2)) : 0
        if (Math.hypot(xi + ex * t, yi + ey * t) <= tol) return 'on'
        if (yi > 0 !== yj > 0 && 0 < xi - (yi * ex) / ey) inside = !inside
      }
      return inside ? 'in' : 'out'
    }
    const rim = where(outer)
    if (rim === 'on') return true
    if (rim === 'out') continue
    const holes = p.holes.map((h) => where(pointsOf(h)))
    if (holes.includes('on') || !holes.includes('in')) return true
  }
  return false
}

/**
 * Where a profile runs across a revolve's axis, or null where every profile
 * keeps to one side of it — what a plain revolve cannot turn (the kernel's
 * "construction failed"). Ending on the axis — a pole, as a sphere's arc
 * does — or running along it is fine. An axis in the profile's plane: how
 * far the profile reaches over it on the side it reaches less (`across`,
 * mm — a hair's overshoot of an arc meant to end on it reads as one) and
 * the point that does; an axis piercing the plane inside the profile: that
 * point, `across` 0.
 */
export function profileAcrossAxis(profiles: readonly Profile[], origin: Vec3, dir: Vec3, tol = 1e-6): { across: number; at: Vec3 } | null {
  const off = (q: Vec3): Vec3 => [q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]]
  for (const p of profiles) {
    const outer = p.outer.flatMap((piece) => piecePoints(piece))
    let n: Vec3 = [0, 0, 0]
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]
      const b = outer[(i + 1) % outer.length]
      n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]
    }
    const normal = normalize(n)
    if (!normal || outer.length === 0) continue
    if (Math.abs(dot(normal, dir)) < 1e-9) {
      if (Math.abs(dot(off(outer[0]), normal)) > tol) continue
      const side = cross(normal, dir)
      let lo = 0, hi = 0
      let loAt = outer[0], hiAt = outer[0]
      for (const q of outer) {
        const d = dot(off(q), side)
        if (d < lo) [lo, loAt] = [d, q]
        if (d > hi) [hi, hiAt] = [d, q]
      }
      if (lo < -tol && hi > tol) return -lo <= hi ? { across: -lo, at: loAt } : { across: hi, at: hiAt }
      continue
    }
    // Piercing the plane: inside the profile, and in none of its holes.
    if (profilesMeetAxis([p], origin, dir, tol)) {
      const pierce = addScaled(origin, dir, dot(off(outer[0]), normal) / dot(normal, dir))
      return { across: 0, at: pierce }
    }
  }
  return null
}

/** Under this an end lies on a revolve's axis and is put on it, mm: a hair
 *  off it is a pole circle of one face, which a STEP reader drops. */
export const POLE_SNAP_MM = 1e-4
/** An arc ending on the axis with its centre this near it, mm — or a
 *  thousandth of its radius, the larger — has its centre put on the axis:
 *  a sphere, not a surface of revolution. */
export const POLE_CENTRE_MM = 1e-3
/** Under this a pole mend moved nothing worth saying, mm: a solver's hair. */
const POLE_QUIET_MM = 1e-6

/** What mendPoles did to a piece: the piece (its sketch id where known),
 *  what was done, and how far it moved. */
export interface PoleMend {
  piece?: number
  what: string
  movedMm: number
}

/**
 * A revolve's profiles with the pieces that end on its axis made to end on
 * it as OCCT turns them whole: ends within POLE_SNAP_MM of the axis put on
 * it (no pole hair), and a line along the axis a little off it at one end
 * laid on it (no cone of no angle); an arc ending there with its centre within
 * POLE_CENTRE_MM (or r/1000) of the axis re-pointed through its ends with
 * the centre on it — a sphere; any other arc or spline ending on the axis
 * turned so it starts there. A surface of revolution whose meridian runs
 * into the pole — base to pole — reads back from STEP as no closed solid,
 * where the same meridian run from the pole reads back whole. Only an axis
 * in the profile's plane has poles; other profiles come back as they were.
 * Turning moves nothing and is not listed; a snap under POLE_QUIET_MM is
 * not either.
 */
export function mendPoles(profiles: readonly Profile[], origin: Vec3, dir: Vec3): { profiles: Profile[]; mends: PoleMend[] } {
  const mends: PoleMend[] = []
  const rel = (p: Vec3) => sub(p, origin)
  const off = (p: Vec3) => len(cross(rel(p), dir))
  const foot = (p: Vec3) => addScaled(origin, dir, dot(rel(p), dir))
  const onAxis = (p: Vec3) => off(p) <= 1e-9
  const ends = (piece: LoopPiece): Vec3[] => (piece.kind === 'line' || piece.kind === 'arc' ? [piece.a, piece.b] : piece.kind === 'spline' ? [piece.poles[0], piece.poles[piece.poles.length - 1]] : [])
  const mendLoop = (loop: readonly LoopPiece[]): LoopPiece[] => {
    // The ends to put on the axis: a hair off it; and the far end of a
    // line run along it from a point on it, which the regions leave a
    // little off where they closed up a closing line shorter than TOUCH_MM
    // (the line, a cone of no angle, is then the axis's own). Every piece's
    // end there moves with it.
    const targets: { at: Vec3; piece?: number }[] = []
    for (const piece of loop) for (const p of ends(piece)) if (off(p) > 0 && off(p) <= POLE_SNAP_MM) targets.push({ at: p, piece: piece.entity })
    for (const piece of loop) {
      if (piece.kind !== 'line') continue
      for (const [p, q] of [[piece.a, piece.b], [piece.b, piece.a]] as const) {
        const d = off(p)
        if (d > POLE_SNAP_MM && d <= TOUCH_MM && off(q) <= POLE_SNAP_MM && len(sub(p, q)) >= 10 * d) targets.push({ at: p, piece: piece.entity })
      }
    }
    const farthest = targets.reduce<{ at: Vec3; piece?: number } | null>((x, t) => (!x || off(t.at) > off(x.at) ? t : x), null)
    if (farthest && off(farthest.at) > POLE_QUIET_MM) {
      const e = farthest.piece
      mends.push({ piece: e, what: `${e !== undefined ? `piece ${e}'s end` : 'an end'} ${Number((off(farthest.at) * 1000).toPrecision(2))} µm off the axis put on it`, movedMm: off(farthest.at) })
    }
    const snap = (p: Vec3): Vec3 => (targets.some((t) => len(sub(t.at, p)) <= 1e-9) ? foot(p) : p)
    return loop.map((piece): LoopPiece => {
      const e = piece.entity
      if (piece.kind === 'line') return { ...piece, a: snap(piece.a), b: snap(piece.b) }
      if (piece.kind === 'spline') {
        const poles = piece.poles.map((p, i) => (i === 0 || i === piece.poles.length - 1 ? snap(p) : p))
        if (!onAxis(poles[poles.length - 1]) || onAxis(poles[0])) return { ...piece, poles }
        const [k0, k1] = [piece.knots[0], piece.knots[piece.knots.length - 1]]
        return { ...piece, poles: poles.reverse(), knots: piece.knots.map((k) => k0 + k1 - k).reverse(), mults: [...piece.mults].reverse() }
      }
      if (piece.kind !== 'arc') return piece
      const a = snap(piece.a)
      const b = snap(piece.b)
      if (!onAxis(a) && !onAxis(b)) return { ...piece, a, b }
      const circle = circleThrough(a, piece.m, b)
      if (circle) {
        const d = off(circle.center)
        if (d > 0 && d <= Math.max(POLE_CENTRE_MM, circle.radius / 1000)) {
          // The centre on the axis where it is as far from both ends: the
          // ends stay, and with them the neighbours.
          const along = dot(dir, sub(rel(b), rel(a)))
          const t = Math.abs(along) > 1e-12 ? (dot(rel(b), rel(b)) - dot(rel(a), rel(a))) / (2 * along) : NaN
          const c = addScaled(origin, dir, t)
          const r = len(sub(a, c))
          const out = normalize(sub(piece.m, c))
          if (Number.isFinite(t) && out && len(sub(c, circle.center)) <= 10 * Math.max(POLE_CENTRE_MM, circle.radius / 1000)) {
            const m = addScaled(c, out, r)
            const movedMm = len(sub(m, piece.m))
            const um = (mm: number) => `${Number((mm * 1000).toPrecision(2))} µm`
            if (d > POLE_QUIET_MM) mends.push({ piece: e, what: `${e !== undefined ? `arc ${e}` : 'an arc'} ending on the axis had its centre ${um(d)} off it — re-pointed through its ends with the centre on the axis, a sphere; its middle moved ${um(movedMm)}`, movedMm })
            return { ...piece, a, m, b }
          }
        }
      }
      return onAxis(b) && !onAxis(a) ? { ...piece, a: b, b: a } : { ...piece, a, b }
    })
  }
  const out = profiles.map((p): Profile => {
    // The axis in the profile's plane, or no pole: the plane's normal by
    // Newell's sum, as profileAcrossAxis has it.
    const pts = p.outer.flatMap((piece) => piecePoints(piece))
    let n: Vec3 = [0, 0, 0]
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]
    }
    const normal = normalize(n)
    if (!normal || pts.length === 0 || Math.abs(dot(normal, dir)) > 1e-9 || Math.abs(dot(rel(pts[0]), normal)) > 1e-6) return p
    return { outer: mendLoop(p.outer), holes: p.holes.map(mendLoop) }
  })
  return { profiles: out, mends }
}

/** The pole mends made before a revolve, as a step's answer says them. */
export function poleWords(mends: readonly PoleMend[]): string {
  return `Made to meet the revolve's axis as a pole a STEP reader keeps: ${mends.map((m) => m.what).join('; ')}.`
}

/** The side of a plane the sketch is on: +1 with its normal, −1 against. */
export function sideOf(plane: PlaneGeometry, point: Vec3): number {
  const d = dot([point[0] - plane.origin[0], point[1] - plane.origin[1], point[2] - plane.origin[2]], plane.normal)
  return d >= 0 ? 1 : -1
}

/** A join of two pieces this far off tangent, and no further, is made
 *  tangent before a drafted extrude: drafted, the two side faces meet at a
 *  grazing angle the kernel's draft cannot join (0.02–0.1° fails; past
 *  about 0.12° it is a corner the kernel takes). */
export const MEND_MAX_DEG = 0.5
const MEND_MAX_RAD = (MEND_MAX_DEG * Math.PI) / 180
/** Under this a join is tangent as drawn — a solver's hair, which the
 *  kernel drafts as it is. */
const MEND_MIN_RAD = 1e-5
/** How far a mend may move an end, a centre or an arc's middle; past it
 *  the join is left as drawn, and named if the draft then fails. */
export const MEND_MAX_MOVE_MM = 0.05
/** Two lines nearly in line are made one when their corner lies this close
 *  to the line between their far ends. */
const MERGE_MAX_MM = 0.01

/** A join a mend made tangent: the pieces about it (sketch ids where
 *  known), how far off tangent it was, what was redrawn, and the most
 *  anything moved. */
export interface ProfileMend {
  pieces: (number | undefined)[]
  deg: number
  what: string
  movedMm: number
}

/** A join left near tangent: the pieces either side, how far off, where. */
export interface NearTangentJoin {
  from?: number
  to?: number
  deg: number
  at: Vec3
}

type P2 = [number, number]
type Arc2 = { kind: 'arc'; a: P2; b: P2; c: P2; r: number; ccw: boolean }
/** A piece in the profile's plane, as a mend works on it. */
type Geo2 = { kind: 'line'; a: P2; b: P2 } | Arc2 | { kind: 'spline'; poles: P2[] } | { kind: 'other' }
interface Slot {
  src: LoopPiece
  g: Geo2
  moved: boolean
}
interface Plane2 {
  to2: (p: Vec3) => P2
  to3: (p: P2) => Vec3
}

const sub2 = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]]
const dot2 = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1]
const cross2 = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0]
const dist2 = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const unit2 = (a: P2): P2 | null => {
  const l = Math.hypot(a[0], a[1])
  return l > 1e-15 ? [a[0] / l, a[1] / l] : null
}
const microns = (mm: number) => `${Math.round(mm * 1000 * 10) / 10} µm`
const degWords = (deg: number) => `${Number(deg.toPrecision(2))}°`

/** The plane a loop lies in, and the maps into it and back. */
function planeOf(pieces: readonly LoopPiece[]): Plane2 | null {
  const pts = pieces.flatMap((p) => piecePoints(p))
  let n: Vec3 = [0, 0, 0]
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]
  }
  const normal = normalize(n)
  if (!normal || pts.length === 0) return null
  const u = normalize(cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
  if (!u) return null
  const v = cross(normal, u)
  const o = pts[0]
  return { to2: (p) => [dot(sub(p, o), u), dot(sub(p, o), v)], to3: (p) => addScaled(addScaled(o, u, p[0]), v, p[1]) }
}

function geo2(p: LoopPiece, plane: Plane2): Geo2 {
  if (p.kind === 'line') return { kind: 'line', a: plane.to2(p.a), b: plane.to2(p.b) }
  if (p.kind === 'spline') return p.poles.length >= 4 ? { kind: 'spline', poles: p.poles.map(plane.to2) } : { kind: 'other' }
  if (p.kind !== 'arc') return { kind: 'other' }
  const a = plane.to2(p.a)
  const m = plane.to2(p.m)
  const b = plane.to2(p.b)
  // The centre, worked from a so the coordinates stay small.
  const m1 = sub2(m, a)
  const b1 = sub2(b, a)
  const d = 2 * cross2(m1, b1)
  if (Math.abs(d) < 1e-14) return { kind: 'other' }
  const mm = dot2(m1, m1)
  const bb = dot2(b1, b1)
  const c: P2 = [a[0] + (b1[1] * mm - m1[1] * bb) / d, a[1] + (m1[0] * bb - b1[0] * mm) / d]
  return { kind: 'arc', a, b, c, r: (dist2(a, c) + dist2(b, c) + dist2(m, c)) / 3, ccw: d > 0 }
}

const startOf = (g: Geo2): P2 | null => (g.kind === 'line' || g.kind === 'arc' ? g.a : g.kind === 'spline' ? g.poles[0] : null)
const endOf = (g: Geo2): P2 | null => (g.kind === 'line' || g.kind === 'arc' ? g.b : g.kind === 'spline' ? g.poles[g.poles.length - 1] : null)

/** A piece's unit tangent at its start or its end, the way the loop runs. */
function tangentOf(g: Geo2, atEnd: boolean): P2 | null {
  if (g.kind === 'line') return unit2(sub2(g.b, g.a))
  if (g.kind === 'spline') {
    const n = g.poles.length
    return atEnd ? unit2(sub2(g.poles[n - 1], g.poles[n - 2])) : unit2(sub2(g.poles[1], g.poles[0]))
  }
  if (g.kind !== 'arc') return null
  const rad = unit2(sub2(atEnd ? g.b : g.a, g.c))
  if (!rad) return null
  return g.ccw ? [-rad[1], rad[0]] : [rad[1], -rad[0]]
}

/** An arc's sweep, signed the way it runs. */
function sweepOf(g: Arc2): number {
  const ta = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0])
  const tb = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0])
  const turn = 2 * Math.PI
  return g.ccw ? (((tb - ta) % turn) + turn) % turn : -((((ta - tb) % turn) + turn) % turn)
}

function midOf(g: Arc2): P2 {
  const t = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]) + sweepOf(g) / 2
  return [g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)]
}

/** How far off tangent piece i meets the next, in radians — null where
 *  either has no tangent there or the two do not meet. */
function creaseAt(slots: readonly Slot[], i: number): number | null {
  const n = slots.length
  const g = slots[((i % n) + n) % n].g
  const h = slots[(((i + 1) % n) + n) % n].g
  const e = endOf(g)
  const s = startOf(h)
  if (!e || !s || dist2(e, s) > 1e-3) return null
  const t1 = tangentOf(g, true)
  const t0 = tangentOf(h, false)
  return t1 && t0 ? Math.atan2(Math.abs(cross2(t1, t0)), dot2(t1, t0)) : null
}

/** An arc at its radius made tangent to both its neighbours, lines or
 *  arcs: its centre where it lies its radius from each (found from where
 *  it is), its ends the feet there — or null. */
function filletArc(arc: Arc2, prev: Geo2, next: Geo2): { arc: Arc2; moved: number } | null {
  interface Bound { gap: (c: P2) => number; grad: (c: P2) => P2; foot: (c: P2) => P2 }
  const bound = (g: Geo2, joinAtEnd: boolean): Bound | null => {
    if (g.kind === 'line') {
      // The line through its far end, which stays.
      const far = joinAtEnd ? g.a : g.b
      const u = unit2(joinAtEnd ? sub2(g.b, g.a) : sub2(g.a, g.b))
      if (!u) return null
      const nrm: P2 = [-u[1], u[0]]
      const side = Math.sign(dot2(nrm, sub2(arc.c, far))) || 1
      return {
        gap: (c) => side * dot2(nrm, sub2(c, far)) - arc.r,
        grad: () => [side * nrm[0], side * nrm[1]],
        foot: (c) => {
          const d = dot2(nrm, sub2(c, far))
          return [c[0] - nrm[0] * d, c[1] - nrm[1] * d]
        },
      }
    }
    if (g.kind === 'arc') {
      // Touching inside or outside, as it nearly does now.
      const d0 = dist2(arc.c, g.c)
      const reach = [g.r + arc.r, g.r - arc.r, arc.r - g.r].filter((t) => t > 0).reduce((x, y) => (Math.abs(y - d0) < Math.abs(x - d0) ? y : x))
      const out = (c: P2): P2 => unit2(sub2(c, g.c)) ?? [1, 0]
      return {
        gap: (c) => dist2(c, g.c) - reach,
        grad: out,
        foot: (c) => {
          const u = out(c)
          return [g.c[0] + u[0] * g.r, g.c[1] + u[1] * g.r]
        },
      }
    }
    return null
  }
  const A = bound(prev, true)
  const B = bound(next, false)
  if (!A || !B) return null
  let c: P2 = [arc.c[0], arc.c[1]]
  for (let it = 0; it < 40; it++) {
    const f1 = A.gap(c)
    const f2 = B.gap(c)
    if (Math.abs(f1) < 1e-12 && Math.abs(f2) < 1e-12) break
    const g1 = A.grad(c)
    const g2 = B.grad(c)
    const det = cross2(g1, g2)
    // Neighbours square to each other's normal — a half-turn slot end:
    // no one centre at this radius.
    if (Math.abs(det) < 1e-6) return null
    c = [c[0] + (-f1 * g2[1] + f2 * g1[1]) / det, c[1] + (-g1[0] * f2 + g2[0] * f1) / det]
  }
  if (Math.abs(A.gap(c)) > 1e-9 || Math.abs(B.gap(c)) > 1e-9) return null
  const made: Arc2 = { ...arc, c, a: A.foot(c), b: B.foot(c) }
  if (Math.abs(sweepOf(made) - sweepOf(arc)) > 0.05) return null
  return { arc: made, moved: Math.max(dist2(c, arc.c), dist2(made.a, arc.a), dist2(made.b, arc.b), dist2(midOf(made), midOf(arc))) }
}

/** An arc redrawn through both its ends, tangent at one of them to `t` —
 *  the neighbour's direction there: its radius gives. */
function tangentAtOneEnd(arc: Arc2, atStart: boolean, t: P2): { arc: Arc2; moved: number } | null {
  const e = atStart ? arc.a : arc.b
  const q = atStart ? arc.b : arc.a
  const n: P2 = arc.ccw ? [-t[1], t[0]] : [t[1], -t[0]]
  const w = sub2(q, e)
  const den = 2 * dot2(n, w)
  if (Math.abs(den) < 1e-12) return null
  const s = dot2(w, w) / den
  if (!(s > 0)) return null
  const made: Arc2 = { ...arc, c: [e[0] + n[0] * s, e[1] + n[1] * s], r: s }
  if (Math.abs(sweepOf(made) - sweepOf(arc)) > 0.05) return null
  return { arc: made, moved: dist2(midOf(made), midOf(arc)) }
}

/** One mend of a near-tangent join, the first that moves nothing past
 *  MEND_MAX_MOVE_MM — false when there is none. Arcs first, the tightest
 *  first; then lines nearly in line; then a spline's pole next to the join. */
function mendOne(slots: Slot[], near: ReadonlyMap<number, number>, mends: ProfileMend[]): boolean {
  const n = slots.length
  const at = (i: number) => ((i % n) + n) % n
  const tangentish = (c: number | null) => c !== null && c < MEND_MAX_RAD
  const id = (i: number) => slots[at(i)].src.entity
  const name = (i: number) => (id(i) !== undefined ? ` ${id(i)}` : '')
  const offOf = (...joins: number[]) => Math.max(...joins.map((j) => near.get(at(j)) ?? 0)) * (180 / Math.PI)
  const arcs = slots
    .map((_, i) => i)
    .filter((i) => slots[i].g.kind === 'arc' && (near.has(at(i - 1)) || near.has(i)))
    .sort((x, y) => (slots[x].g as Arc2).r - (slots[y].g as Arc2).r)
  for (const i of arcs) {
    const arc = slots[i].g as Arc2
    const pi = at(i - 1)
    const ni = at(i + 1)
    const prev = slots[pi].g
    const next = slots[ni].g
    const cPrev = creaseAt(slots, pi)
    const cNext = creaseAt(slots, i)
    // Tangent or near it at both ends: both ends at once, at its radius —
    // one end alone would only move the crease to the other.
    if (pi !== ni && tangentish(cPrev) && tangentish(cNext)) {
      const f = filletArc(arc, prev, next)
      if (f && f.moved <= MEND_MAX_MOVE_MM) {
        slots[i].g = f.arc
        if (prev.kind === 'line' || prev.kind === 'arc') slots[pi].g = { ...prev, b: f.arc.a }
        if (next.kind === 'line' || next.kind === 'arc') slots[ni].g = { ...next, a: f.arc.b }
        slots[i].moved = slots[pi].moved = slots[ni].moved = true
        const joins = [pi, i].filter((j) => near.has(j))
        mends.push({ pieces: joins.length === 2 ? [id(pi), id(i), id(ni)] : joins[0] === pi ? [id(pi), id(i)] : [id(i), id(ni)], deg: offOf(...joins), what: `arc${name(i)} made tangent to both neighbours at its radius`, movedMm: f.moved })
        return true
      }
      if (prev.kind !== 'spline' && next.kind !== 'spline') continue
    }
    // Near at one end, a real corner (or a spline, mended on its own) at
    // the other: the arc through its ends, tangent at the near one.
    for (const [join, atStart] of [[pi, true], [i, false]] as const) {
      const other = atStart ? cNext : cPrev
      const otherPiece = atStart ? next : prev
      if (!near.has(join) || (tangentish(other) && otherPiece.kind !== 'spline')) continue
      const t = atStart ? tangentOf(prev, true) : tangentOf(next, false)
      const f = t && tangentAtOneEnd(arc, atStart, t)
      if (!f || f.moved > MEND_MAX_MOVE_MM) continue
      slots[i].g = f.arc
      slots[i].moved = true
      mends.push({ pieces: atStart ? [id(pi), id(i)] : [id(i), id(ni)], deg: offOf(join), what: `arc${name(i)} redrawn through its ends, tangent to${name(atStart ? pi : ni)}`, movedMm: f.moved })
      return true
    }
  }
  for (const [j] of near) {
    const g = slots[j].g
    const h = slots[at(j + 1)].g
    if (g.kind !== 'line' || h.kind !== 'line' || at(j + 1) === j) continue
    const run = unit2(sub2(h.b, g.a))
    if (!run) continue
    const off = Math.abs(cross2(run, sub2(g.b, g.a)))
    if (off > MERGE_MAX_MM) continue
    mends.push({ pieces: [id(j), id(j + 1)], deg: offOf(j), what: `lines${name(j)} and${name(j + 1)} made one`, movedMm: off })
    slots[j].g = { kind: 'line', a: g.a, b: h.b }
    slots[j].moved = true
    slots.splice(at(j + 1), 1)
    return true
  }
  for (const [j] of near) {
    const g = slots[j].g
    const h = slots[at(j + 1)].g
    // The pole next to the join put in line with the neighbour's tangent.
    const which = h.kind === 'spline' && g.kind !== 'other' ? 'next' : g.kind === 'spline' && h.kind !== 'other' ? 'prev' : null
    if (!which) continue
    const sp = (which === 'next' ? h : g) as { kind: 'spline'; poles: P2[] }
    const t = which === 'next' ? tangentOf(g, true) : tangentOf(h, false)
    if (!t) continue
    const k = which === 'next' ? 1 : sp.poles.length - 2
    const e = sp.poles[which === 'next' ? 0 : sp.poles.length - 1]
    const along = dot2(sub2(sp.poles[k], e), t)
    if (which === 'next' ? along <= 0 : along >= 0) continue
    const pole: P2 = [e[0] + t[0] * along, e[1] + t[1] * along]
    const moved = dist2(pole, sp.poles[k])
    if (moved > MEND_MAX_MOVE_MM) continue
    const poles = sp.poles.slice()
    poles[k] = pole
    const si = which === 'next' ? at(j + 1) : j
    slots[si].g = { kind: 'spline', poles }
    slots[si].moved = true
    mends.push({ pieces: [id(j), id(j + 1)], deg: offOf(j), what: `spline${name(si)}'s ${which === 'next' ? 'first' : 'last'} pole put in line with${name(which === 'next' ? j : j + 1)}`, movedMm: moved })
    return true
  }
  return false
}

function mendLoop(pieces: LoopPiece[], plane: Plane2, mends: ProfileMend[], left: NearTangentJoin[]): LoopPiece[] {
  if (pieces.length < 2) return pieces
  const slots: Slot[] = pieces.map((src) => ({ src, g: geo2(src, plane), moved: false }))
  const nearJoins = () => {
    const out = new Map<number, number>()
    slots.forEach((_, i) => {
      const c = creaseAt(slots, i)
      if (c !== null && c > MEND_MIN_RAD && c < MEND_MAX_RAD) out.set(i, c)
    })
    return out
  }
  for (let round = 0; round < 2 * pieces.length + 2; round++) {
    const near = nearJoins()
    if (near.size === 0 || !mendOne(slots, near, mends)) break
  }
  const n = slots.length
  for (const [i, c] of nearJoins()) left.push({ from: slots[i].src.entity, to: slots[(i + 1) % n].src.entity, deg: (c * 180) / Math.PI, at: plane.to3(endOf(slots[i].g)!) })
  if (n === pieces.length && !slots.some((s) => s.moved)) return pieces
  // A moved piece takes its ends from a neighbour left as it was, so the
  // two still meet exactly; two moved pieces lift the one point they share.
  const srcEnd = (p: LoopPiece, end: 'a' | 'b'): Vec3 | null => (p.kind === 'line' || p.kind === 'arc' ? p[end] : p.kind === 'spline' ? p.poles[end === 'a' ? 0 : p.poles.length - 1] : null)
  return slots.map((s, i): LoopPiece => {
    if (!s.moved) return s.src
    const prev = slots[(i - 1 + n) % n]
    const next = slots[(i + 1) % n]
    const a = (!prev.moved && srcEnd(prev.src, 'b')) || plane.to3(startOf(s.g)!)
    const b = (!next.moved && srcEnd(next.src, 'a')) || plane.to3(endOf(s.g)!)
    const entity = s.src.entity !== undefined ? { entity: s.src.entity } : {}
    const g = s.g
    if (g.kind === 'line') return { kind: 'line', a, b, ...entity }
    if (g.kind === 'arc') return { kind: 'arc', a, m: plane.to3(midOf(g)), b, ...entity }
    if (g.kind === 'spline' && s.src.kind === 'spline') return { ...s.src, poles: g.poles.map((p, k) => (k === 0 ? a : k === g.poles.length - 1 ? b : plane.to3(p))) }
    return s.src
  })
}

/**
 * A drafted extrude's profiles with every join that is near tangent —
 * off by more than a solver's hair and under MEND_MAX_DEG — made tangent:
 * the kernel drafts each side face alone and cannot join two that meet at
 * a grazing angle. An arc tangent or near it at both ends is made tangent
 * to both neighbours at its radius, the neighbours' ends moved to its
 * ends (one end alone only moves the crease to the other); an arc near at
 * one end and cornered at the other is redrawn through its ends, tangent
 * at the near one; two lines nearly in line become one when their corner
 * lies under MERGE_MAX_MM off it; a spline's pole next to the join is put
 * in line. Nothing moves more than MEND_MAX_MOVE_MM: a join that would is
 * left as drawn, and handed back in `left`.
 */
export function mendNearTangent(profiles: readonly Profile[]): { profiles: Profile[]; mends: ProfileMend[]; left: NearTangentJoin[] } {
  const mends: ProfileMend[] = []
  const left: NearTangentJoin[] = []
  const out = profiles.map((p) => {
    const plane = planeOf(p.outer)
    if (!plane) return p
    return { outer: mendLoop(p.outer, plane, mends, left), holes: p.holes.map((h) => mendLoop(h, plane, mends, left)) }
  })
  return { profiles: out, mends, left }
}

/** The mends made before a draft, as a step's answer says them. */
export function mendWords(mends: readonly ProfileMend[]): string {
  const pieces = (ids: readonly (number | undefined)[]) => (ids.every((x) => x !== undefined) ? `pieces ${ids.join(' → ')}` : 'two pieces')
  const said = mends.map((m) => `${pieces(m.pieces)} met ${degWords(m.deg)} off tangent — ${m.what}, moved ${microns(m.movedMm)}`)
  return `Made tangent before the draft, which cannot join faces meeting at a grazing angle: ${said.join('; ')}.`
}

/** A drafted extrude the kernel refused, with joins left near tangent:
 *  the joins, as the answer names them. */
export function grazingJoinsWords(left: readonly NearTangentJoin[]): string {
  const where = (p: Vec3) => `(${p.map((x) => Math.round(x * 100) / 100).join(', ')})`
  const named = [...left].sort((a, b) => a.deg - b.deg).slice(0, 3)
  const one = (j: NearTangentJoin, first: boolean) => `${j.from !== undefined && j.to !== undefined ? `${first ? 'Pieces' : 'pieces'} ${j.from} → ${j.to}` : `${first ? 'Two' : 'two'} pieces`} meet ${degWords(j.deg)} off tangent at ${where(j.at)}`
  const more = left.length > named.length ? ` (and ${left.length - named.length} more)` : ''
  const they = named.length === 1 ? 'their faces meet' : 'the faces there meet'
  // units-ok: build message, also the agent's answer
  return `${named.map((j, i) => one(j, i === 0)).join('; ')}${more}: drafted, ${they} at a grazing angle the kernel cannot join, and making ${named.length === 1 ? 'it' : 'them'} tangent here would move more than ${MEND_MAX_MOVE_MM} mm — make them tangent (reverse.sketch.edit rounds, a tangent relation) or a real corner (≥ 0.2°).`
}
