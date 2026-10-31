// SPDX-License-Identifier: AGPL-3.0-only
// A sweep's route: a centreline in 3D given by its corner points and a bend
// radius, made a chain of straight lines and tangent arcs. A bent tube's
// bends lie in planes of their own, which no one sketch's path can hold. Pure
// numbers: the kernel takes the pieces (kernel.sweep), the profile is checked
// against the start in profiles.ts (routeSweepGeometry).

import type { Vec3 } from '../../../src/core/types'
import { addScaled, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { LoopPiece } from './kernelTypes'

/** A centreline in the part's frame, mm. Each inner point is a corner the
 *  route rounds with a tangent arc: where the straights either side would
 *  meet, not a point on the arc. */
export interface SweepRoute {
  /** In order, either end first: the sweep starts from the end nearest the
   *  profile. */
  points: Vec3[]
  /** The radius of every bend `radii` does not name, on the centreline. */
  bendRadius: number
  /** One per inner point in order (points.length − 2): that bend's own
   *  radius, or null for bendRadius. */
  radii?: (number | null)[]
}

/** Points nearer than this are one point, mm. */
const SAME_POINT_MM = 1e-3
/** A corner turned by less than this is no bend, degrees: its arc would be
 *  a hair at any radius a tube has. */
const STRAIGHT_DEG = 0.1
/** A corner turned by more than this folds back on itself, degrees. */
const FOLD_DEG = 179.9
/** What is left of a straight between two arcs under this is none: the arcs
 *  meet, mm. */
const NO_STRAIGHT_MM = 1e-3

const r3 = (x: number) => Math.round(x * 1000) / 1000 || 0
const pointWords = (i: number, p: Vec3) => `points[${i}] (${p.map(r3).join(', ')})`
const turnOf = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))))

/**
 * A route as the pieces a sweep follows: straights and tangent arcs, run from
 * the end nearest `from`, with the point it starts at and the way it leaves;
 * or why not. Repeated points and corners with no turn are passed over. A
 * bend that does not fit its straights is refused, with the most it takes.
 */
export function routePieces(route: SweepRoute, from: Vec3): { pieces: LoopPiece[]; start: Vec3; tangent: Vec3; bends: { index: number; radius: number }[] } | string {
  const { points, bendRadius, radii } = route
  if (points.length < 2) return 'The route needs two points at least.'
  if (radii && radii.length !== points.length - 2) return `The route has ${points.length - 2} inner points and ${radii.length} radii — one for each inner point, null for the bend radius.`
  // Repeats go first, then corners with no turn, each read from the points
  // kept: the index a refusal says stays the one given.
  const kept: number[] = [0]
  for (let i = 1; i < points.length; i++) if (len(sub(points[i], points[kept[kept.length - 1]])) >= SAME_POINT_MM) kept.push(i)
  if (kept.length < 2) return 'The route’s points are all one point.'
  if (len(sub(points[0], points[kept[kept.length - 1]])) < SAME_POINT_MM) return 'The route ends where it starts — a route has two ends; a closed path is a sketch’s, drawn as arcs.'
  for (let j = 1; j < kept.length - 1; ) {
    const into = normalize(sub(points[kept[j]], points[kept[j - 1]]))!
    const out = normalize(sub(points[kept[j + 1]], points[kept[j]]))!
    const turn = (turnOf(into, out) * 180) / Math.PI
    if (turn > FOLD_DEG) return `The route folds back on itself at ${pointWords(kept[j], points[kept[j]])}.`
    if (turn < STRAIGHT_DEG) kept.splice(j, 1)
    else j++
  }
  const at = kept.map((i) => points[i])
  const dirs = at.slice(1).map((p, j) => normalize(sub(p, at[j]))!)
  const runs = at.slice(1).map((p, j) => len(sub(p, at[j])))
  // Per corner, how far its arc reaches back along each straight.
  const corners = kept.map((index, j) => {
    if (j === 0 || j === kept.length - 1) return { index, turn: 0, radius: 0, slope: 0, reach: 0 }
    const turn = turnOf(dirs[j - 1], dirs[j])
    const radius = radii?.[index - 1] ?? bendRadius
    return { index, turn, radius, slope: Math.tan(turn / 2), reach: radius * Math.tan(turn / 2) }
  })
  for (let j = 1; j < kept.length - 1; j++) {
    const c = corners[j]
    if (!(c.radius > 0)) return `The bend at ${pointWords(c.index, at[j])} needs a radius above 0 — a route’s corners are rounded, a sharp one has no section to carry round it.`
    const before = runs[j - 1] - corners[j - 1].reach
    const after = runs[j] - corners[j + 1].reach
    if (c.reach <= Math.min(before, after) + NO_STRAIGHT_MM) continue
    const room = Math.max(0, Math.min(before, after))
    const straight = after < before ? `straight to ${pointWords(kept[j + 1], at[j + 1])}` : `straight from ${pointWords(kept[j - 1], at[j - 1])}`
    // units-ok: build message, also the agent's answer
    return `The bend at ${pointWords(c.index, at[j])} does not fit: a radius of ${r3(c.radius)} mm turning ${r3((c.turn * 180) / Math.PI)}° takes ${r3(c.reach)} mm of each straight, and the ${straight} leaves it ${r3(room)} mm. It takes a radius of ${Math.floor((room / c.slope) * 1000) / 1000} mm at most, its neighbours as they are.`
  }
  const pieces: LoopPiece[] = []
  let was = at[0]
  for (let j = 1; j < at.length; j++) {
    const c = corners[j]
    const end = addScaled(at[j], dirs[j - 1], -c.reach)
    if (len(sub(end, was)) > NO_STRAIGHT_MM) {
      pieces.push({ kind: 'line', a: was, b: end })
      was = end
    }
    if (j === at.length - 1) break
    // The arc's middle: from the corner towards the centre along the
    // bisector, as far as the corner stands off the arc.
    const inward = normalize(sub(dirs[j], dirs[j - 1]))!
    const exit = addScaled(at[j], dirs[j], c.reach)
    pieces.push({ kind: 'arc', a: was, m: addScaled(at[j], inward, c.radius * (1 / Math.cos(c.turn / 2) - 1)), b: exit })
    was = exit
  }
  // An arc starts along the straight it rounds, had it any length left: so
  // the way the route leaves is the first straight's, at either end.
  const fromEnd = len(sub(at[at.length - 1], from)) < len(sub(at[0], from))
  const bends = corners.slice(1, -1).map((c) => ({ index: c.index, radius: c.radius }))
  if (fromEnd) {
    const back = pieces.map((p): LoopPiece => (p.kind === 'line' ? { kind: 'line', a: p.b, b: p.a } : p.kind === 'arc' ? { kind: 'arc', a: p.b, m: p.m, b: p.a } : p)).reverse()
    return { pieces: back, start: at[at.length - 1], tangent: scale(dirs[dirs.length - 1], -1), bends }
  }
  return { pieces, start: at[0], tangent: dirs[0], bends }
}
