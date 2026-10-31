// SPDX-License-Identifier: AGPL-3.0-only
// A shadow section's outline taken into the workspace as the lines, arcs and
// circles the section keeps (src/core/section/shadow.ts), not as its sampled
// polylines: the profiles an Extract stands up through the part, and the
// pieces a sketch on the shadow starts with.

import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import { type ShadowPiece, type ShadowShape, shadowRegions } from '../../../src/core/section/shadow'
import type { Vec3 } from '../../../src/core/types'
import { dot, sub } from '../../../src/core/vec'
import type { Primitive } from './features'
import type { LoopPiece, Profile } from './kernelTypes'
import { liftPoint } from './profiles'
import { type AnchorAt, addConstraint, addEntity, arcThrough, emptySketch, type Sketch } from './sketch'

/** What a section is to an Extract or a sketch: its kind and, once the
 *  worker has taken it, the shadow's shape. */
export interface ShadowSource {
  name?: string
  kind?: 'cut' | 'shadow'
  cut?: { shadow?: ShadowShape }
}

/** Thinner than this along the normal, mm, a shadow stands as no block. */
const MIN_THICKNESS_MM = 1e-3

/** Two pieces meeting turn by less than this, radians, and are held
 *  tangent where the sketch joins them — a corner the shadow rounded. */
const TANGENT_RAD = (0.5 * Math.PI) / 180

/** A piece's middle point, on the sheet. */
function midOf(p: Exclude<ShadowPiece, { kind: 'circle' }>): Vec2 {
  if (p.kind === 'line') return [(p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2]
  const a = Math.atan2(p.from[1] - p.center[1], p.from[0] - p.center[0]) + p.sweep / 2
  return [p.center[0] + p.radius * Math.cos(a), p.center[1] + p.radius * Math.sin(a)]
}

function loopIn(frame: SectionFrame, pieces: readonly ShadowPiece[]): LoopPiece[] {
  return pieces.map((p): LoopPiece => {
    if (p.kind === 'circle') return { kind: 'circle', center: liftPoint(frame, p.center), normal: frame.normal, radius: p.radius }
    if (p.kind === 'line') return { kind: 'line', a: liftPoint(frame, p.from), b: liftPoint(frame, p.to) }
    return { kind: 'arc', a: liftPoint(frame, p.from), m: liftPoint(frame, midOf(p)), b: liftPoint(frame, p.to) }
  })
}

/** The shadow as the solid an Extract makes: each outer loop with its
 *  holes, standing along the normal through the part's thickness — the
 *  block the section draws and writes to STEP — or why there is none. */
export function shadowPrimitive(sec: ShadowSource | undefined): Primitive | string {
  if (!sec) return 'The section this body is taken from is gone.'
  if (sec.kind !== 'shadow') return `${sec.name ?? 'That section'} is a cut — only a shadow section stands as a body.`
  const sh = sec.cut?.shadow
  if (!sh) return `${sec.name ?? 'The shadow'} is still being taken — the body is built once it is.`
  const regions = shadowRegions(sh)
  if (regions.length === 0) return `${sec.name ?? 'The shadow'} has no outline.`
  if (!(sh.extent.max - sh.extent.min > MIN_THICKNESS_MM)) return `${sec.name ?? 'The shadow'} has no thickness to stand through.`
  const profiles: Profile[] = regions.map((r) => ({ outer: loopIn(sh.frame, r.outer.pieces), holes: r.holes.map((h) => loopIn(sh.frame, h.pieces)) }))
  return { kind: 'prism', profiles, dir: sh.frame.normal, from: sh.extent.min, to: sh.extent.max }
}

function toSheet(frame: SectionFrame, p: Vec3): Vec2 {
  const d = sub(p, frame.origin)
  return [dot(d, frame.basisU), dot(d, frame.basisV)]
}

/** Which way a piece runs at its loop's start and end, on the sketch's
 *  sheet: what tells a rounded corner from a sharp one. */
function headings(a: Vec2, b: Vec2, arc: { c: Vec2; ccw: boolean } | null): [Vec2, Vec2] {
  if (!arc) {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
    return [d, d]
  }
  const along = (p: Vec2): Vec2 => {
    const r: Vec2 = [p[0] - arc.c[0], p[1] - arc.c[1]]
    const l = Math.hypot(r[0], r[1]) || 1
    return arc.ccw ? [-r[1] / l, r[0] / l] : [r[1] / l, -r[0] / l]
  }
  return [along(a), along(b)]
}

/**
 * The shadow's outline as the pieces of a sketch on `frame` — every line,
 * arc and circle it is read to, where it lies, free to be edited, each
 * end held to the next piece's and a corner the shadow rounded held
 * tangent, so the loops stay closed as they are moved. The frame is the
 * sketch's: a shadow is the same outline wherever its plane lies along the
 * normal, so a sketch stood off it starts with it too. Its ids run from
 * `firstId`, clear of ones a sketch handed in names.
 */
export function shadowSketch(sh: ShadowShape, frame: SectionFrame, firstId = 1): Sketch {
  const sketch = { ...emptySketch(), nextId: firstId }
  for (const loop of sh.loops) {
    // Each piece's id, the anchor at its loop's start and at its end, and
    // the way it runs there.
    const placed: { id: number; start: AnchorAt; end: AnchorAt; dirs: [Vec2, Vec2] }[] = []
    for (const p of loop.pieces) {
      if (p.kind === 'circle') {
        addEntity(sketch, { kind: 'circle', c: toSheet(frame, liftPoint(sh.frame, p.center)), r: p.radius })
        continue
      }
      const a = toSheet(frame, liftPoint(sh.frame, p.from))
      const b = toSheet(frame, liftPoint(sh.frame, p.to))
      if (p.kind === 'line') {
        placed.push({ id: addEntity(sketch, { kind: 'line', a, b }), start: 'a', end: 'b', dirs: headings(a, b, null) })
        continue
      }
      const arc = arcThrough(a, b, toSheet(frame, liftPoint(sh.frame, midOf(p))))
      if (!arc) {
        // An arc too flat to tell from its chord is that chord.
        placed.push({ id: addEntity(sketch, { kind: 'line', a, b }), start: 'a', end: 'b', dirs: headings(a, b, null) })
        continue
      }
      const id = addEntity(sketch, { kind: 'arc', c: arc.c, r: arc.r, start: arc.start, sweep: arc.sweep })
      // The sketch's arc runs counter-clockwise; one the loop runs the
      // other way starts at the loop's end.
      placed.push({ id, start: arc.startsAtP ? 'a' : 'b', end: arc.startsAtP ? 'b' : 'a', dirs: headings(a, b, { c: arc.c, ccw: arc.startsAtP }) })
    }
    for (let i = 0; i < placed.length && placed.length > 1; i++) {
      const p = placed[i]
      const q = placed[(i + 1) % placed.length]
      addConstraint(sketch, { kind: 'coincident', p: { entity: p.id, at: p.end }, q: { entity: q.id, at: q.start } })
      const turn = Math.atan2(p.dirs[1][0] * q.dirs[0][1] - p.dirs[1][1] * q.dirs[0][0], p.dirs[1][0] * q.dirs[0][0] + p.dirs[1][1] * q.dirs[0][1])
      const curved = (id: number) => sketch.entities.find((e) => e.id === id)?.kind === 'arc'
      if (Math.abs(turn) < TANGENT_RAD && (curved(p.id) || curved(q.id))) addConstraint(sketch, { kind: 'tangent', a: p.id, b: q.id })
    }
  }
  return sketch
}

/** How many pieces a shadow's outline makes in a sketch. */
export function shadowPieceCount(sh: ShadowShape): number {
  return sh.loops.reduce((n, l) => n + l.pieces.length, 0)
}
