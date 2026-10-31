// SPDX-License-Identifier: AGPL-3.0-only
// Whether a smooth loft's skin crosses itself between its sections. The
// kernel interpolates every rail through all the sections, so two sections
// close together that disagree make it overshoot further on: a narrow face
// of the skin turns inside out (its width goes through zero) and its
// neighbours cross. The kernel's own check does not test faces crossing:
// the loft is answered valid, with volume — and the boolean after it comes
// out empty or wrong. Read here by cutting the side faces across at one v
// each (all of a smooth loft's faces share their v: the sections lie at the
// same v on every face), a point every 1/8 of u, and looking whether the
// cut, laid in its plane, crosses itself. A ruled loft is a face per span,
// each with a v of its own, and straight between its sections: not read.

import type { Vec3 } from '../../../src/core/types'
import { add, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import { faceKindOf, vec } from './kernelMath'
import { HASH_BOUND } from './kernelOps'
import type { Profile, Shape } from './kernelTypes'
import { piecePoints } from './loops'
import type { OcctLike } from './occtTypes'

/** How many cuts a fold check takes along the loft. */
export const FOLD_CUTS = 40
/** Points along a face in a cut: one every 1/8 of its u. */
const FOLD_STEPS = 8
/** Planes within this of parallel are taken as one way, degrees. */
const PARALLEL_DEG = 1

export interface LoftFoldOptions {
  /** The way across the cuts — the sections' common normal; without it
   *  the cuts' own, when they all agree within PARALLEL_DEG, else each
   *  cut's own plane. */
  normal?: Vec3 | null
  /** Only these faces, by hash — a loft's own on a body. */
  faces?: ReadonlySet<number>
  /** Only the points inside each face — faces a later step trimmed. */
  trimmed?: boolean
}

export interface LoftFold {
  /** Where the first cut that crosses itself does so, mm. */
  at: Vec3
  /** The way the cuts were laid flat, when it was one for all. */
  normal: Vec3 | null
  /** Each cut that crosses itself: its index and its height along
   *  `normal` (null without one). */
  folded: { cut: number; height: number | null }[]
  /** How many cuts were read. */
  of: number
  /** What the check took, ms. */
  ms: number
}

/** The plane's normal of a loop of points: Newell's sum, the loop's area
 *  vector — null for a loop with no area. */
function loopNormal(points: readonly Vec3[]): Vec3 | null {
  const n: Vec3 = [0, 0, 0]
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    n[0] += (a[1] - b[1]) * (a[2] + b[2])
    n[1] += (a[2] - b[2]) * (a[0] + b[0])
    n[2] += (a[0] - b[0]) * (a[1] + b[1])
  }
  return normalize(n)
}

/** A section's outline as points, its middle and its plane's normal. */
function sectionOf(profile: Profile): { middle: Vec3; normal: Vec3 | null } {
  const points = profile.outer.flatMap((p) => piecePoints(p))
  const middle = scale(points.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / Math.max(1, points.length))
  return { middle, normal: loopNormal(points) }
}

const parallel = (a: Vec3, b: Vec3) => Math.abs(dot(a, b)) >= Math.cos((PARALLEL_DEG * Math.PI) / 180)

/** The sections' common normal — null when they do not lie in parallel
 *  planes (radial stations), and the cuts are laid in planes of their
 *  own. */
export function sectionsNormal(profiles: readonly Profile[]): Vec3 | null {
  const normals = profiles.map((p) => sectionOf(p).normal)
  const first = normals[0]
  if (!first || normals.some((n) => !n || !parallel(n, first))) return null
  return first
}

/** The first point where two segments of a cut laid flat cross, not at a
 *  face's end (where neighbours meet), or null. */
function crossing(lines: readonly Vec3[][], normal: Vec3): Vec3 | null {
  const e1 = normalize(cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))!
  const e2 = cross(normal, e1)
  const flat = lines.map((line) => line.map((p) => [dot(p, e1), dot(p, e2)] as [number, number]))
  const all = flat.flat()
  const size = Math.max(1e-9, ...[0, 1].map((k) => Math.max(...all.map((p) => p[k])) - Math.min(...all.map((p) => p[k]))))
  const eps = 1e-12 * size * size
  const endTol = 1e-4 * size
  const ends = flat.flatMap((line) => (line.length > 0 ? [line[0], line[line.length - 1]] : []))
  const orient = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const segments: { line: number; at: number }[] = []
  flat.forEach((line, i) => {
    for (let j = 0; j + 1 < line.length; j++) segments.push({ line: i, at: j })
  })
  for (let s = 0; s < segments.length; s++) {
    const A = segments[s]
    const p1 = flat[A.line][A.at]
    const p2 = flat[A.line][A.at + 1]
    for (let t = s + 1; t < segments.length; t++) {
      const B = segments[t]
      if (A.line === B.line && Math.abs(A.at - B.at) < 2) continue
      const q1 = flat[B.line][B.at]
      const q2 = flat[B.line][B.at + 1]
      const d1 = orient(q1, q2, p1)
      const d2 = orient(q1, q2, p2)
      const d3 = orient(p1, p2, q1)
      const d4 = orient(p1, p2, q2)
      if (!((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps))) continue
      if (!((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) continue
      const f = d1 / (d1 - d2)
      const x: [number, number] = [p1[0] + f * (p2[0] - p1[0]), p1[1] + f * (p2[1] - p1[1])]
      if (ends.some((e) => Math.hypot(e[0] - x[0], e[1] - x[1]) <= endTol)) continue
      const a = lines[A.line][A.at]
      const b = lines[A.line][A.at + 1]
      return add(a, scale(sub(b, a), f))
    }
  }
  return null
}

/**
 * Where a smooth loft's side faces — those not flat, of `faces` when given
 * — cross themselves: FOLD_CUTS cuts across them at one v each, between
 * the ends, each laid flat (see LoftFoldOptions.normal) and looked over
 * for two of its pieces crossing. Null when no cut crosses itself, or
 * there is no curved face to cut.
 */
export function loftFold(o: OcctLike, shape: Shape, options: LoftFoldOptions = {}): LoftFold | null {
  const began = performance.now()
  const handles = o.getSubShapes(shape, 'face')
  try {
    const faces = handles
      .filter((f) => (!options.faces || options.faces.has(o.hashCode(f, HASH_BOUND))) && faceKindOf(o.surfaceType(f)) !== 'plane')
      .map((f) => ({ f, uv: o.uvBounds(f) }))
    if (faces.length === 0) return null
    const vLo = Math.min(...faces.map((x) => x.uv.vMin))
    const vHi = Math.max(...faces.map((x) => x.uv.vMax))
    if (!(vHi > vLo)) return null
    const cuts: Vec3[][][] = []
    for (let i = 0; i < FOLD_CUTS; i++) {
      const v = vLo + ((i + 0.5) / FOLD_CUTS) * (vHi - vLo)
      const lines: Vec3[][] = []
      for (const { f, uv } of faces) {
        if (v < uv.vMin || v > uv.vMax) continue
        let line: Vec3[] = []
        for (let j = 0; j <= FOLD_STEPS; j++) {
          const u = uv.uMin + (j / FOLD_STEPS) * (uv.uMax - uv.uMin)
          if (options.trimmed && o.classifyPointOnFace(f, u, v) === 'out') {
            if (line.length > 1) lines.push(line)
            line = []
            continue
          }
          line.push(vec(o.pointOnSurface(f, u, v)))
        }
        if (line.length > 1) lines.push(line)
      }
      cuts.push(lines)
    }
    // Each cut's own plane: its pieces' area vector about its middle —
    // the side faces run round the loft one way, so the pieces of a cut
    // add up as a loop's do.
    const ownNormal = (lines: readonly Vec3[][]): Vec3 | null => {
      const points = lines.flat()
      if (points.length < 3) return null
      const middle = scale(points.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / points.length)
      let area: Vec3 = [0, 0, 0]
      for (const line of lines) for (let j = 0; j + 1 < line.length; j++) area = add(area, cross(sub(line[j], middle), sub(line[j + 1], middle)))
      return normalize(area)
    }
    let normal = options.normal ?? null
    const own = cuts.map(ownNormal)
    if (!normal) {
      const known = own.filter((n): n is Vec3 => n !== null)
      if (known.length > 0 && known.every((n) => parallel(n, known[0]))) normal = normalize(known.reduce((s, n) => add(s, dot(n, known[0]) < 0 ? scale(n, -1) : n), [0, 0, 0] as Vec3))
    }
    const folded: LoftFold['folded'] = []
    let at: Vec3 | null = null
    cuts.forEach((lines, i) => {
      const n = normal ?? own[i]
      if (!n || lines.length === 0) return
      const x = crossing(lines, n)
      if (!x) return
      at ??= x
      folded.push({ cut: i, height: normal ? dot(x, normal) : null })
    })
    if (!at) return null
    return { at, normal, folded, of: FOLD_CUTS, ms: performance.now() - began }
  } finally {
    for (const f of handles) o.release(f)
  }
}

const one = (x: number) => Number(x.toFixed(1))

/** "z 9.5 near (18.9, -3.2)" across a coordinate axis, else "near (x, y, z)". */
function whereWords(at: Vec3, normal: Vec3 | null): string {
  const axis = normal ? [0, 1, 2].find((k) => Math.abs(normal[k]) > 1 - 1e-6) : undefined
  if (axis === undefined) return `near (${at.map(one).join(', ')})`
  const others = [0, 1, 2].filter((k) => k !== axis)
  return `${'xyz'[axis]} ${one(at[axis])} near (${others.map((k) => one(at[k])).join(', ')})`
}

/** The stretches of the loft that fold, by height — "z 9.3–17.6 and
 *  35.3–36.6" — or by cut, "cuts 2–13 of 40". */
function stretchWords(fold: LoftFold): string {
  const runs: (typeof fold.folded)[] = []
  for (const f of fold.folded) {
    const last = runs.at(-1)
    if (last && last.at(-1)!.cut === f.cut - 1) last.push(f)
    else runs.push([f])
  }
  const axis = fold.normal ? [0, 1, 2].find((k) => Math.abs(fold.normal![k]) > 1 - 1e-6) : undefined
  const sign = axis !== undefined && fold.normal![axis] < 0 ? -1 : 1
  const words = runs.map((r) => {
    const [a, b] = [r[0], r.at(-1)!]
    if (a.height === null || b.height === null) return a === b ? `${a.cut + 1}` : `${a.cut + 1}–${b.cut + 1}`
    const [lo, hi] = [a.height * sign, b.height * sign].sort((x, y) => x - y)
    return a === b ? `${one(lo)}` : `${one(lo)}–${one(hi)}`
  })
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]
  if (fold.folded[0].height === null) return `cut${fold.folded.length === 1 ? '' : 's'} ${list} of ${fold.of}`
  // units-ok: build message, also the agent's answer
  return axis !== undefined ? `${'xyz'[axis]} ${list}` : `${list} mm along the loft`
}

/** Where a loft crosses itself, in words: "crosses itself at z 9.5 near
 *  (18.9, -3.2) (folded over z 9.3–17.6 and 35.3–36.6)". */
export function foldWords(fold: LoftFold): string {
  return `crosses itself at ${whereWords(fold.at, fold.normal)} (folded over ${stretchWords(fold)})`
}

/**
 * A smooth loft refused for folding, naming its sections: the closest
 * pair, when it lies far closer than the rest (under half their middle
 * spacing) — two sections close together that disagree are what makes the
 * rails overshoot — and the pair the fold lies between, when that is
 * another.
 */
export function loftFoldRefusal(fold: LoftFold, sections: readonly { name: string; profile: Profile }[]): string {
  const read = sections.map((s) => sectionOf(s.profile))
  const normal = sectionsNormal(sections.map((s) => s.profile))
  const gaps = read.slice(1).map((s, i) => (normal ? Math.abs(dot(sub(s.middle, read[i].middle), normal)) : len(sub(s.middle, read[i].middle))))
  // The pair the fold lies between: across their planes, or the pair it
  // is nearest.
  let between = 0
  if (normal) {
    const h = dot(fold.at, normal)
    const at = gaps.findIndex((_, i) => (dot(read[i].middle, normal) - h) * (dot(read[i + 1].middle, normal) - h) <= 0)
    between = at >= 0 ? at : 0
  } else {
    const far = (i: number) => len(sub(fold.at, read[i].middle)) + len(sub(fold.at, read[i + 1].middle))
    between = gaps.reduce((best, _, i) => (far(i) < far(best) ? i : best), 0)
  }
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const close = gaps.reduce((best, g, i) => (g < gaps[best] ? i : best), 0)
  const pair = (i: number) => `${sections[i].name} and ${sections[i + 1].name}`
  const head = (lies: string) => `The smooth loft crosses itself at ${whereWords(fold.at, fold.normal)}${lies} (folded over ${stretchWords(fold)})`
  if (gaps.length >= 2 && gaps[close] < 0.5 * median) {
    // units-ok: build message, also the agent's answer
    return `${head(between !== close ? `, between ${pair(between)}` : '')}: ${pair(close)} are ${one(gaps[close])} mm apart and differ — drop or move one, or make the loft ruled.`
  }
  return `${head('')}: the skin between ${pair(between)} overshoots — the sections differ more than one smooth skin through them all can follow; add a section between them, or make the loft ruled.`
}
