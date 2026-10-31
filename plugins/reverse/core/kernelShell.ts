// SPDX-License-Identifier: AGPL-3.0-only
// The ways ReKernel's shellTracked (kernel.ts) hollows a solid: the kernel's
// own thick solid, an offset core cut out, and the core rebuilt with sharp
// inside corners where the kernel's rounds would collapse — each saying
// why it failed. And what an offset that failed is read with: what is
// wrong with the offset the kernel made, and how far each face of the
// body offsets on its own.

import type { Vec3 } from '../../../src/core/types'
import { dot, normalize, sub } from '../../../src/core/vec'
import type { ReKernel } from './kernel'
import { parseHistory, sameSurface, vec } from './kernelMath'
import { bothFaceHashes, HASH_BOUND, KernelError, readFace, tracked, withSubShapes } from './kernelOps'
import type { FaceHistory, RawFace, Shape, Tracked } from './kernelTypes'
import type { OcctLike } from './occtTypes'

/** Run `fn` on a copy of `solid`, the faces it names (by hash) named on
 *  the copy, and its history handed back keyed by `solid`'s faces — a
 *  face the copy carried through untouched is listed under its new hash,
 *  for the copy's hashes are not the solid's. Null or a reason when `fn`
 *  hands back one; what it throws is thrown. */
export function onCopy<T extends Tracked | string | null>(occt: OcctLike, kernel: ReKernel, solid: Shape, faceHashes: readonly number[], fn: (copy: Shape, faceHashes: number[]) => T): T {
  const copy = occt.copy(solid) as Shape
  try {
    const was = kernel.faceHashes(solid)
    const now = kernel.faceHashes(copy)
    if (was.length !== now.length) throw new KernelError('the body could not be copied.')
    const toCopy = new Map(was.map((h, i) => [h, now[i]]))
    const result = fn(copy, faceHashes.map((h) => toCopy.get(h) ?? h))
    if (result === null || typeof result === 'string') return result
    const done = result as Tracked
    const fromCopy = new Map(now.map((h, i) => [h, was[i]]))
    const history: FaceHistory = new Map()
    for (const [h, made] of done.history) history.set(fromCopy.get(h) ?? h, made)
    for (const [h, c] of toCopy) if (!history.has(h)) history.set(h, [c])
    return { ...done, history } as T
  } finally {
    occt.release(copy)
  }
}

/** The shell made by hand where the kernel's thick solid gives up: the
 *  body less its own inward offset is the closed hollow body, and the
 *  wall over each opened face is taken off it — the face pushed in by
 *  the wall, less the walls of the closed faces next to it, which reach
 *  the opened face's plane as a shell's walls do. Null with no face to
 *  open; why not when the body has no inside at that wall, or the cut
 *  leaves no closed solid. Where a
 *  closed face meets an opened one at an inside corner its wall keeps
 *  its foot — the body's own material a wall deep under the corner —
 *  where the thick solid would have run the opening on under the wall. */
export function shellByOffsetCut(occt: OcctLike, kernel: ReKernel, solid: Shape, faceHashes: readonly number[], thickness: number): Tracked | string | null {
  if (faceHashes.length === 0) return null
  const o = occt
  const open = new Set(faceHashes)
  const handles = o.getSubShapes(solid, 'face')
  const made: number[] = []
  try {
    const faces = handles.map((h) => readFace(occt, h))
    if (faceHashes.some((hash) => !faces.some((f) => f.hash === hash))) return 'a face to open is not on the body.'
    // The closed faces sharing an edge with an opened one: their walls
    // are what the wall over an opened face has to leave standing.
    const beside = new Set<number>()
    for (const at of parseHistory(o.edgeToFaceMap(solid, HASH_BOUND)).values()) {
      if (at.some((h) => open.has(h))) for (const h of at) if (!open.has(h)) beside.add(h)
    }
    const core = innerCore(occt, solid, thickness)
    if (typeof core === 'string') return core
    made.push(core)
    const fuseInto = (acc: number | null, s: number): number => {
      if (acc === null) return s
      const f = o.fuse(acc, s)
      made.push(f)
      return f
    }
    let over: number | null = null
    let standing: number | null = null
    for (let i = 0; i < handles.length; i++) {
      const f = faces[i]
      if (!open.has(f.hash) && !beside.has(f.hash)) continue
      const wall = wallUnder(occt, handles[i], f, solid, thickness)
      if (wall === null) return `the wall under a ${f.kind === 'other' ? 'freeform' : f.kind} face at (${f.centroid.map((v) => v.toFixed(1)).join(', ')}) cannot be made.`
      made.push(wall)
      if (open.has(f.hash)) over = fuseInto(over, wall)
      else standing = fuseInto(standing, wall)
    }
    if (over === null) return 'no wall over the opened faces could be made.'
    if (standing !== null) {
      over = o.cut(over, standing)
      made.push(over)
    }
    const cutter = o.fuse(core, over)
    made.push(cutter)
    const result = tracked(occt, o.cutWithHistory(solid, cutter, kernel.faceHashes(solid), HASH_BOUND))
    const closed = kernel.isClosedSolid(result.shape)
    if (!closed || !(o.getVolume(result.shape) < o.getVolume(solid) - o.getVolume(core))) {
      kernel.release(result.shape)
      return closed ? 'the core and the openings cut out took less than the core.' : 'the core and the openings cut out leave no closed solid.'
    }
    return result
  } catch (e) {
    // The kernel refusing a step of the long way is this way failing too;
    // shellTracked weighs its words against the other ways'.
    return refusedStep(e)
  } finally {
    for (const h of handles) o.release(h)
    for (const s of made) o.release(s)
  }
}

/** The body's material a wall deep under one of its faces: the face
 *  pushed straight in when it is flat, thickened into the body otherwise
 *  — a negative thickness goes in on a face of a solid, but the slab is
 *  checked to lie in the body and made the other way if not. Null when
 *  neither way does. */
function wallUnder(occt: OcctLike, face: number, read: RawFace, solid: Shape, thickness: number): number | null {
  const o = occt
  if (read.kind === 'plane') return o.extrude(face, -read.dir[0] * thickness, -read.dir[1] * thickness, -read.dir[2] * thickness)
  for (const sign of [-1, 1]) {
    const slab = o.thicken(face, sign * thickness, 1e-3)
    const inside = o.common(slab, solid)
    const within = o.getVolume(inside)
    o.release(inside)
    if (within > 0.5 * o.getVolume(slab)) return slab
    o.release(slab)
  }
  return null
}

export function shellPlain(occt: OcctLike, kernel: ReKernel, solid: Shape, faceHashes: readonly number[], thickness: number): Tracked {
  const o = occt
  const core = innerCore(occt, solid, thickness)
  try {
    if (faceHashes.length === 0) {
      if (typeof core === 'string') throw new KernelError(core)
      return tracked(occt, o.cutWithHistory(solid, core, kernel.faceHashes(solid), HASH_BOUND))
    }
    // The thick solid can hand the body back as it was, or with no
    // volume at all, and call it done. A face opened only takes more
    // away, so a hollow weighs no more than the closed one — the body
    // less its core — and where there is no core to tell, still less
    // than the body.
    const volume = o.getVolume(solid)
    const most = Math.min(volume * (1 - 1e-6), typeof core === 'string' ? Infinity : volume - o.getVolume(core) + volume * 1e-4)
    const result = withSubShapes(occt, solid, 'face', faceHashes, (faces) =>
      tracked(occt, o.shellWithHistory(solid, faces, thickness, 1e-3, kernel.faceHashes(solid), HASH_BOUND)),
    )
    if (!kernel.isClosedSolid(result.shape) || !(o.getVolume(result.shape) < most)) {
      kernel.release(result.shape)
      throw new KernelError('the thick solid handed the body back without hollowing it.')
    }
    return result
  } finally {
    if (typeof core !== 'string') o.release(core)
  }
}

/** What is left inside a wall of `distance`: the body's inward offset,
 *  or why there is none — see offsetFault. */
function innerCore(occt: OcctLike, solid: Shape, distance: number): Shape | string {
  const o = occt
  let core: number
  try {
    core = o.offset(solid, -distance, 1e-3)
  } catch (e) {
    return `the kernel's offset of the body inward by the wall failed (${rawRefusal(e)}).`
  }
  if (o.isNull(core) || !(o.getVolume(core) > 1e-9)) {
    o.release(core)
    return 'the wall is as thick as the body — nothing is left inside to take away.'
  }
  const fault = offsetFault(occt, solid, core, -distance)
  if (fault === null) return core as Shape
  o.release(core)
  return `the kernel's offset of the body inward by the wall came out broken: ${fault}.`
}

/** The sides of a box, as offsetFault names them. */
const SIDES = ['−x', '−y', '−z', '+x', '+y', '+z']

/**
 * What is wrong with the offset `made` the kernel made of `solid` by
 * `distance` (negative inward), as a sentence ends — null when nothing
 * is. The kernel's offset hands back a broken solid without a word where
 * a face narrower than the distance would vanish under it — a strip of
 * floor between a wall and a round: some of the inner faces in a shell of
 * their own, some never moved in. A true offset has the body's shells,
 * grows or shrinks, and moves each side of the body's box by the distance
 * or more (a quarter of it is allowed: the boxes are the surfaces' own
 * extremes, a loft's and a round's too, and a side on an edge or a slope
 * moves further). What is said is what was found, not why: the diagnosis
 * (diagnose.ts) reads the why off the body.
 */
export function offsetFault(occt: OcctLike, solid: Shape, made: number, distance: number): string | null {
  const o = occt
  if (o.isNull(made) || !(o.getVolume(made) > 1e-9)) return 'it has no volume'
  const grown = distance > 0
  if (grown ? !(o.getVolume(made) > o.getVolume(solid)) : !(o.getVolume(made) < o.getVolume(solid))) return `it is no ${grown ? 'larger' : 'smaller'} than the body`
  const outer = o.getBoundingBox(solid)
  const box = o.getBoundingBox(made)
  // How far each side of the box moved out — in, negative.
  const moved = [outer.xmin - box.xmin, outer.ymin - box.ymin, outer.zmin - box.zmin, box.xmax - outer.xmax, box.ymax - outer.ymax, box.zmax - outer.zmax]
  const short = moved.findIndex((m) => (grown ? m < distance * 0.75 : m > distance * 0.75))
  if (short >= 0) {
    const m = grown ? moved[short] : -moved[short]
    // units-ok: build message, also the agent's answer
    const by = `${Math.round(Math.abs(m) * 100) / 100} mm`
    const way = grown ? 'out' : 'in'
    if (Math.abs(m) < 0.005) return `its box does not move ${way} on the ${SIDES[short]} side`
    return m < 0 ? `its box moves ${grown ? 'in' : 'out'} by ${by} on the ${SIDES[short]} side, not ${way}` : `its box moves ${way} by only ${by} on the ${SIDES[short]} side`
  }
  const shells = o.subShapeCount(made, 'shell')
  const want = o.subShapeCount(solid, 'shell')
  if (shells !== want) return `it comes in ${shells} shell${shells === 1 ? '' : 's'}, where the body has ${want}`
  if (!o.isValid(made)) return "the kernel's own check finds it broken"
  return null
}

/** What the kernel said when it refused, as it said it. */
export function rawRefusal(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\.$/, '')
}

const REFUSED_STEP = 'the kernel refused a step of it ('

/** A way of hollowing failed on a step the kernel refused: its own words,
 *  as a reason shellTracked can tell from the reasons found by looking. */
function refusedStep(e: unknown): string {
  return `${REFUSED_STEP}${rawRefusal(e)}).`
}

/** Of the reasons the ways of hollowing gave, in the order tried, the one
 *  that says most: a fact about the body (a number, a place, nothing left
 *  inside) before the kernel's own words, and those before a reason that
 *  only says a way gave up. The first of the best kind. */
export function mostSpecific(reasons: readonly { why: string; raw: boolean }[]): string {
  const score = (r: { why: string; raw: boolean }) => (r.raw || r.why.includes(REFUSED_STEP) || /failed \(/.test(r.why) ? 2 : /\d|nothing is left|came out broken/.test(r.why) ? 3 : 1)
  let best = reasons[0]
  for (const r of reasons) if (score(r) > score(best)) best = r
  return best.raw ? `the kernel refused (${best.why})` : best.why.replace(/\.$/, '')
}

/** The shell of a body whose convex rounds are no larger than the wall:
 *  null when there are none such; why not when the body does not come
 *  apart and back together cleanly. */
export function shellSharpInside(occt: OcctLike, kernel: ReKernel, solid: Shape, faceHashes: readonly number[], thickness: number): Tracked | string | null {
  const o = occt
  const open = new Set(faceHashes)
  const handles = o.getSubShapes(solid, 'face')
  const made: number[] = []
  try {
    const before = handles.map((h) => readFace(occt, h))
    const rounds = handles.filter((h, i) => !open.has(before[i].hash) && collapsesInward(occt, h, before[i], thickness))
    if (rounds.length === 0) return null
    const sharp = o.defeature(solid, rounds, 0) as Shape
    made.push(sharp)
    if (o.isNull(sharp) || !(o.getVolume(sharp) > 1e-9)) return 'the rounds no larger than the wall cannot be taken off the body.'
    // The faces to open, found again on the body without its rounds: a
    // flat face has grown into the corner the round left, on its plane.
    const after = kernel.faces(sharp)
    const reopened: number[] = []
    for (const hash of faceHashes) {
      const was = before.find((f) => f.hash === hash)
      const now = was ? sameSurface(was, after) : null
      if (!now) return 'a face to open is lost with the rounds taken off.'
      reopened.push(now.hash)
    }
    let wall: Shape
    if (reopened.length === 0) {
      const core = innerCore(occt, sharp, thickness)
      if (typeof core === 'string') return core
      made.push(core)
      wall = o.cut(sharp, core) as Shape
    } else {
      wall = withSubShapes(occt, sharp, 'face', reopened, (faces) => o.shell(sharp, faces, thickness, 1e-3)) as Shape
    }
    made.push(wall)
    const result = tracked(occt, o.intersectWithHistory(solid, wall, bothFaceHashes(kernel, solid, wall), HASH_BOUND))
    // The outside is the body's own and must all be there still: a pin
    // thinner than the wall that went with the rounds is not a corner
    // left sharp, it is a feature lost. And something must have been
    // taken away: the thick solid can hand back the body it was given
    // and call it a wall.
    const left = new Set(kernel.faceHashes(result.shape))
    const kept = (hash: number) => (result.history.has(hash) ? result.history.get(hash)!.some((h) => left.has(h)) : left.has(hash))
    const why = !kernel.isClosedSolid(result.shape)
      ? 'the wall cut back to the body is no closed solid.'
      : !(o.getVolume(result.shape) < o.getVolume(solid) * (1 - 1e-6))
        ? 'the wall cut back to the body took nothing away.'
        : before.some((f) => !open.has(f.hash) && !kept(f.hash))
          ? 'a face of the body went with the rounds — a pin or a strip thinner than the wall.'
          : null
    if (why !== null) {
      kernel.release(result.shape)
      return why
    }
    const n = rounds.length
    return { ...result, note: `Built by cutting back, with booleans: ${n} round${n === 1 ? '' : 's'} no larger than the wall taken off, the wall made on the body without ${n === 1 ? 'it' : 'them'} and cut back to its outside — the inside is left sharp there.` }
  } catch (e) {
    // The kernel refusing a step of the way round: shellTracked tries the
    // next way, and weighs the words.
    return refusedStep(e)
  } finally {
    for (const h of handles) o.release(h)
    for (const s of made) o.release(s)
  }
}

/** Whether a face is a convex round that an inward offset of `distance`
 *  would shrink to nothing: stepping across it, its outward normals fan
 *  apart, about a centre no further behind the face than the distance. A
 *  hole's wall and an inside fillet grow under the same offset and are
 *  left alone. */
export function collapsesInward(occt: OcctLike, face: number, read: RawFace, distance: number): boolean {
  if (read.kind !== 'cylinder' && read.kind !== 'sphere' && read.kind !== 'torus') return false
  const o = occt
  const uv = o.uvBounds(face)
  const um = (uv.uMin + uv.uMax) / 2
  const vm = (uv.vMin + uv.vMax) / 2
  const p0 = vec(o.pointOnSurface(face, um, vm))
  const n0 = normalize(vec(o.surfaceNormal(face, um, vm)))
  if (!n0) return false
  const steps: [number, number][] = [
    [(uv.uMax - uv.uMin) * 0.05, 0],
    [0, (uv.vMax - uv.vMin) * 0.05],
  ]
  for (const [du, dv] of steps) {
    const n1 = normalize(vec(o.surfaceNormal(face, um + du, vm + dv)))
    if (!n1) continue
    const dn = sub(n1, n0)
    const turn = Math.hypot(dn[0], dn[1], dn[2])
    // Straight this way: a cylinder along its axis.
    if (turn < 1e-6) continue
    const dp = sub(vec(o.pointOnSurface(face, um + du, vm + dv)), p0)
    // A chord over the turn of its normals is the radius, for a circle
    // exactly; fanning apart is convex.
    const radius = Math.hypot(dp[0], dp[1], dp[2]) / turn
    if (dot(dp, dn) > 0 && radius <= distance * (1 + 1e-6) + 1e-6) return true
  }
  return false
}

/** How near a diagnosis finds the largest size that works, mm: it halves
 *  until the size that works and the one that does not are this close. */
export const SIZE_WITHIN_MM = 0.1

/** The least number of halvings largestSize makes: six put a small size
 *  within two percent of the size asked. */
const LEAST_HALVINGS = 6

/** The largest size below `size` at which `works` holds, by halving to
 *  within SIZE_WITHIN_MM (and at least six times) — zero when it holds at
 *  none tried. A size of 21 takes eight tries, of 4 six. */
export function largestSize(size: number, works: (at: number) => boolean): number {
  return largestSizeWhile(size, works, () => true).size
}

/** largestSize, asking `goOn` before each try and stopping where it says
 *  no: the largest size found to hold so far (zero for none, or none
 *  tried), and whether the halving was done. With a `floor`, nothing under
 *  it is tried: the halving runs between it and `size`, and the floor
 *  itself is tried last when nothing above it held — zero when it fails
 *  too. */
export function largestSizeWhile(size: number, works: (at: number) => boolean, goOn: () => boolean, floor = 0): { size: number; settled: boolean } {
  if (floor >= size) return { size: 0, settled: true }
  const halvings = Math.max(LEAST_HALVINGS, Math.ceil(Math.log2((size - floor) / SIZE_WITHIN_MM)))
  let lo = floor
  let hi = size
  let held = floor === 0
  for (let i = 0; i < halvings; i++) {
    if (!goOn()) return { size: held ? lo : 0, settled: false }
    const mid = (lo + hi) / 2
    if (works(mid)) {
      lo = mid
      held = true
    } else hi = mid
  }
  if (held) return { size: lo, settled: true }
  if (!goOn()) return { size: 0, settled: false }
  return { size: works(floor) ? floor : 0, settled: true }
}

/** At most this many curved faces are offset alone by faceOffsetLimits —
 *  each costs a few thousand reads of its surface and an offset or two,
 *  and a few more offsets when the kernel refuses it. */
export const FACE_PROBES = 48

/** A face's parameter box is read in this many cells each way for where
 *  it curves tightest, and the tightest few followed down to the point. */
const BEND_GRID = 12
const BEND_SEEDS = 3
const BEND_HALVINGS = 10

/** One face of a body offset on its own — see faceOffsetLimits. */
export interface FaceOffsetLimit {
  hash: number
  /** The kernel's name for the face's surface: 'bspline', 'cylinder' … */
  surface: string
  /** The largest distance the face offsets by alone: the distance asked
   *  where it takes all of it. */
  upTo: number
  /** Where the face curves tightest towards the side the offset goes, and
   *  that radius — an offset further than it folds the face over itself
   *  there. Null where it does not curve that way. */
  bend: { radius: number; at: Vec3 } | null
  /** What the kernel said when it would not offset the face alone by the
   *  distance asked; null when it did. */
  refused: string | null
}

/**
 * Each curved face of a solid offset alone by `distance` (negative inward,
 * as the body's offset and a shell's wall go): how far it goes. A face
 * fails in two ways. It curves tighter than the distance towards the side
 * the offset goes — a convex bend going in, a hollow going out — and its
 * offset folds over itself there: the kernel makes that offset without a
 * word, so the bend is read off the surface, its shape from the kernel's
 * points and normals across a grid of the face and followed down to the
 * tightest point. Or the kernel refuses the face's offset — the face's
 * own handle offset, which is bisected for the largest distance it takes.
 * Flat faces offset by any distance alone and are not tried. Freeform
 * faces go first: a loft's or a fitted sheet's limit is read nowhere
 * else, while a round's is its radius. At most `limit` faces are tried,
 * and none begun past `deadline` (performance.now()'s clock); `curved`
 * says how many there were.
 */
export function faceOffsetLimits(occt: OcctLike, solid: Shape, distance: number, limit = FACE_PROBES, deadline = Infinity): { faces: FaceOffsetLimit[]; curved: number } {
  const o = occt
  const t = Math.abs(distance)
  const sign = distance < 0 ? -1 : 1
  const handles = o.getSubShapes(solid, 'face')
  try {
    const analytic = (k: string) => k === 'cylinder' || k === 'cone' || k === 'sphere' || k === 'torus'
    const curved = handles.map((h) => ({ h, kind: o.surfaceType(h) as string })).filter((f) => f.kind !== 'plane')
    const order = [...curved.filter((f) => !analytic(f.kind)), ...curved.filter((f) => analytic(f.kind))].slice(0, limit)
    const oneFace = (h: number, kind: string): FaceOffsetLimit => {
      const refusal = (at: number): string | null => {
        let made: number
        try {
          made = o.offset(h, sign * at, 1e-3)
        } catch (e) {
          return rawRefusal(e)
        }
        try {
          return o.isNull(made) || o.subShapeCount(made, 'face') === 0 ? 'no face came back' : null
        } finally {
          o.release(made)
        }
      }
      const bend = tightestBend(occt, h, sign)
      const reach = Math.min(t, bend ? bend.radius : Infinity)
      const refused = refusal(t)
      let upTo = reach
      if (refused !== null && (reach === t || refusal(reach) !== null)) upTo = largestSize(reach, (at) => refusal(at) === null)
      return { hash: o.hashCode(h, HASH_BOUND), surface: kind, upTo, bend, refused }
    }
    const faces: FaceOffsetLimit[] = []
    for (const { h, kind } of order) {
      if (performance.now() > deadline) break
      faces.push(oneFace(h, kind))
    }
    return { faces, curved: curved.length }
  } finally {
    for (const h of handles) o.release(h)
  }
}

/**
 * Where a face curves tightest towards the side an offset goes (`sign`
 * negative: in, where it is convex), and that radius; null where it
 * nowhere curves that way. The face's shape at a point comes from the
 * kernel's points and outward normals a little either way along u and v:
 * the shape operator, the first fundamental form's inverse times the
 * second, whose larger eigenvalue is the tightest convex curvature and
 * the smaller, negated, the tightest hollow. It is read at the centres of
 * a grid over the face's parameter box, inside the face only, and from
 * the tightest few the search steps on to a neighbour while one is
 * tighter, halving the step when none is.
 */
function tightestBend(occt: OcctLike, face: number, sign: number): { radius: number; at: Vec3 } | null {
  const o = occt
  const uv = o.uvBounds(face)
  const du = uv.uMax - uv.uMin
  const dv = uv.vMax - uv.vMin
  if (!(du > 0 && dv > 0)) return null
  const hu = du * 1e-4
  const hv = dv * 1e-4
  const clampU = (u: number) => Math.min(uv.uMax, Math.max(uv.uMin, u))
  const clampV = (v: number) => Math.min(uv.vMax, Math.max(uv.vMin, v))
  const point = (u: number, v: number) => vec(o.pointOnSurface(face, u, v))
  const normal = (u: number, v: number) => vec(o.surfaceNormal(face, u, v))
  const inside = (u: number, v: number) => o.classifyPointOnFace(face, u, v) !== 'out'
  const bendAt = (u0: number, v0: number): number => {
    // The differences stay inside the parameter box.
    const u = Math.min(uv.uMax - hu, Math.max(uv.uMin + hu, u0))
    const v = Math.min(uv.vMax - hv, Math.max(uv.vMin + hv, v0))
    const pu = sub(point(u + hu, v), point(u - hu, v))
    const pv = sub(point(u, v + hv), point(u, v - hv))
    const nu = sub(normal(u + hu, v), normal(u - hu, v))
    const nv = sub(normal(u, v + hv), normal(u, v - hv))
    // Both forms over the same steps: the steps cancel in the operator.
    const E = dot(pu, pu)
    const F = dot(pu, pv)
    const G = dot(pv, pv)
    const L = dot(nu, pu)
    const M = (dot(nu, pv) + dot(nv, pu)) / 2
    const N = dot(nv, pv)
    const det = E * G - F * F
    if (!(det > 0)) return -Infinity
    const a = (G * L - F * M) / det
    const b = (G * M - F * N) / det
    const c = (E * M - F * L) / det
    const d = (E * N - F * M) / det
    const half = (a + d) / 2
    const spread = Math.sqrt(Math.max(0, half * half - (a * d - b * c)))
    const k = sign < 0 ? half + spread : -(half - spread)
    return Number.isFinite(k) ? k : -Infinity
  }
  const cu = du / BEND_GRID
  const cv = dv / BEND_GRID
  const seeds: { u: number; v: number; k: number }[] = []
  for (let i = 0; i < BEND_GRID; i++) {
    for (let j = 0; j < BEND_GRID; j++) {
      const u = uv.uMin + (i + 0.5) * cu
      const v = uv.vMin + (j + 0.5) * cv
      if (inside(u, v)) seeds.push({ u, v, k: bendAt(u, v) })
    }
  }
  seeds.sort((x, y) => y.k - x.k)
  let best: { u: number; v: number; k: number } | null = null
  for (const seed of seeds.slice(0, BEND_SEEDS)) {
    if (!(seed.k > 0)) break
    let at = seed
    let su = cu / 2
    let sv = cv / 2
    for (let halved = 0; halved < BEND_HALVINGS; ) {
      let next = at
      for (const [a, b] of [[su, 0], [-su, 0], [0, sv], [0, -sv]] as const) {
        const u = clampU(at.u + a)
        const v = clampV(at.v + b)
        if (!inside(u, v)) continue
        const k = bendAt(u, v)
        if (k > next.k) next = { u, v, k }
      }
      if (next === at) {
        su /= 2
        sv /= 2
        halved++
      } else at = next
    }
    if (!best || at.k > best.k) best = at
  }
  if (!best || !(best.k > 1e-9)) return null
  return { radius: 1 / best.k, at: point(best.u, best.v) }
}
