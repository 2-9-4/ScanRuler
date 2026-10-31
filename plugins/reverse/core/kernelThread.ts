// SPDX-License-Identifier: AGPL-3.0-only
// A thread cut into a cylindrical face: ReKernel's threadTracked (kernel.ts).

import type { Vec3 } from '../../../src/core/types'
import { addScaled, cross, normalize } from '../../../src/core/vec'
import type { ReKernel } from './kernel'
import { composeHistory } from './kernelMath'
import { KernelError, loneSolid, readFace, readRound, run, withSubShapes } from './kernelOps'
import type { FaceHistory, LoopPiece, Shape, Tracked } from './kernelTypes'
import { polygonLoop } from './loops'
import type { OcctLike } from './occtTypes'
import { chamferRadius, faceAgainstThread, fillRadius, minorDiameter, type ThreadCut, threadSpan, toothOutline } from './thread'

/** The most turns a thread is cut with: every turn is a face a side of the
 *  tooth, and a long fine thread a long boolean. */
const MAX_THREAD_TURNS = 400

// units-ok: build message, also the agent's answer
const mmText = (v: number) => `${Math.round(v * 1000) / 1000} mm`

/** What a thread did that was not asked for in so many words, for the
 *  feature's row: a face wider or narrower than the thread, brought to it;
 *  the crests come to a point under the offset; a face that wanted bringing
 *  to the crests left as drawn (`unfilled`). Null when it did none. */
function threadNote(t: ThreadCut, internal: boolean, faceR: number, tooth: { pointed: boolean }, unfilled: boolean): string | null {
  const notes: string[] = []
  const against = faceAgainstThread(t, internal, 2 * faceR)
  const face = `Ø${mmText(2 * faceR)}`
  if (unfilled) {
    const crests = internal ? `minor Ø${mmText(minorDiameter(t.diameter, t.pitch, t.standard))}` : `Ø${mmText(t.diameter)}`
    notes.push(`The ${internal ? 'bore' : 'boss'} is ${face}, not the thread's ${crests}, and it does not run between square ends: it is left as drawn and the crests lie on it.`)
  } else if (!internal) {
    if (against === 'wider') notes.push(`The boss is ${face}, wider than the thread's Ø${mmText(t.diameter)}: what stood past the crests is cut away.`)
    else if (against === 'narrower') notes.push(`The boss is ${face}, under the thread's Ø${mmText(t.diameter)}: it is built up to it along the thread.`)
  } else {
    const minor = `minor Ø${mmText(minorDiameter(t.diameter, t.pitch, t.standard))}`
    if (against === 'wider') notes.push(`The bore is ${face}, wider than the thread's ${minor}: it is filled in to it along the thread.`)
    else if (against === 'narrower') notes.push(`The bore is ${face}, narrower than the thread's ${minor}: it is bored out to it along the thread.`)
  }
  if (tooth.pointed) notes.push('At this offset the crests come to a point.')
  return notes.length > 0 ? notes.join(' ') : null
}

/** ReKernel.threadTracked (kernel.ts), whose comment says what it does. */
export function threadTracked(occt: OcctLike, kernel: ReKernel, solid: Shape, faceHash: number, t: ThreadCut): Tracked {
  return run('Cutting the thread', () =>
    withSubShapes(occt, solid, 'face', [faceHash], ([handle]) => {
      const f = readFace(occt, handle)
      if (f.kind !== 'cylinder' || f.radius === undefined || !f.center) throw new KernelError('a thread is cut on a round face — this one is not a cylinder.')
      const center = f.center
      const drawn = f.radius
      const { axis, convex, lo, hi } = readRound(occt, handle, f.dir, center, 'a thread is cut on a full cylinder')
      const internal = !convex
      const span = threadSpan({ lo, hi }, t.length, t.start, t.flip)
      if (!span) throw new KernelError(`the thread runs past the end of the face — ${mmText(t.start)} in and ${mmText(t.length ?? 0)} long, on a face ${mmText(hi - lo)} long.`)
      const P = t.pitch
      // A bore wider than the crests is filled in to them along the thread,
      // a boss under them built up; from there on the face is where the
      // fill leaves it.
      const wanted = fillRadius(t, internal, drawn)
      // The fill runs between the face's furthest ends. Where the face is
      // not a plain cylinder between square ends — a hole drilled into a
      // curved wall — it would stand past them into the open, and its teeth
      // with it: a nut's thread is cut and then kept to the body with the
      // bore closed up, its neighbours run on across it (cutting a fill
      // already kept to it, along those neighbours, broke the shell). Short
      // of that the face is left as drawn, the crests on it.
      const square = Math.abs(occt.getSurfaceArea(handle) - 2 * Math.PI * drawn * (hi - lo)) <= 1e-6 * 2 * Math.PI * drawn * (hi - lo)
      let hull: Shape | null = null
      if (wanted !== null && !square && internal) {
        try {
          hull = kernel.deleteFaces(solid, [faceHash])
        } catch (e) {
          if (!(e instanceof KernelError)) throw e
        }
      }
      const fill = wanted !== null && (square || hull !== null) ? wanted : null
      const faceR = fill ?? drawn
      const root = toothOutline(t, internal, 0).root
      if (wanted !== null && fill === null && (internal ? drawn >= root : drawn <= root)) {
        const what = internal ? `bore is Ø${mmText(2 * drawn)}, past the thread's major Ø${mmText(2 * root)}` : `boss is Ø${mmText(2 * drawn)}, under the thread's minor Ø${mmText(2 * root)}`
        throw new KernelError(`the ${what}, and it does not run between square ends, so it cannot be ${internal ? 'filled in' : 'built up'} to the thread — draw it at the thread's size.`)
      }
      // The tooth reaches into what stands behind it by half a pitch — a
      // bolt's not so far that it nears the axis.
      const tooth = toothOutline(t, internal, internal ? P / 2 : Math.min(P / 2, root / 2), faceR)
      // The band, radially: past the face on the side away from the
      // material by a margin, to the root on the other.
      const margin = P / 2
      const inner = internal ? Math.min(faceR, tooth.crest) - margin : tooth.root
      const outer = internal ? tooth.root : Math.max(faceR, t.diameter / 2) + margin
      // And along the axis: on past an end of the thread that nothing
      // stands beyond, within the band's reach.
      const run = P / 2
      const radial = normalize(cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) ?? [1, 0, 0]
      const across = cross(axis, radial)
      const circle = (r: number): LoopPiece => ({ kind: 'circle', center, normal: axis, radius: r })
      let sleeve: Shape | null = null
      let ring: Shape | null = null
      let band: Shape | null = null
      let screwed: Shape | null = null
      let cutter: Shape | null = null
      let shape = solid
      let history: FaceHistory = new Map()
      try {
        if (fill !== null) {
          const section = kernel.face({ outer: [circle(Math.max(drawn, fill))], holes: [[circle(Math.min(drawn, fill))]] })
          try {
            sleeve = kernel.extrude(section, axis, span.from, span.to)
          } finally {
            kernel.release(section)
          }
          const step = kernel.fuseTracked(shape, sleeve)
          history = composeHistory(history, step.history)
          shape = step.shape
        }
        /** Whether nothing of the body lies past the end at `at`, the way
         *  `way` points, between the radii, as far as `reach`. */
        const clear = (at: number, way: 1 | -1, near: number, far: number, reach: number): boolean => {
          const rIn = Math.max(near, 1e-3)
          for (const along of [reach / 2, reach]) {
            for (const share of [0.1, 0.5, 0.9]) {
              const r = rIn + (far - rIn) * share
              for (const turn of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
                const p = addScaled(addScaled(addScaled(center, axis, at + way * along), radial, r * Math.cos(turn)), across, r * Math.sin(turn))
                if (kernel.containsPoint(shape, p)) return false
              }
            }
          }
          return true
        }
        // An end of the face, or of a fill short of it where the face as
        // drawn stands clear of the band — an M4's in a Ø5 bore, not an
        // M5's, whose root is the bore: run on, the band's root would lie
        // on the bore past the fill, or with an offset cut into it.
        const endLo = Math.abs(span.from - lo) < 1e-6
        const endHi = Math.abs(span.to - hi) < 1e-6
        const open = fill !== null && (internal ? drawn > outer + P / 20 : drawn < inner - P / 20)
        const freeLo = (endLo || open) && clear(span.from, -1, inner, outer, run)
        const freeHi = (endHi || open) && clear(span.to, 1, inner, outer, run)
        const from = freeLo ? span.from - run : span.from
        const to = freeHi ? span.to + run : span.to
        // The chamfer, at each end of the face the thread runs out of
        // free: a cone at 45° through chamferRadius on the end face, from a
        // margin past the end face — so the cut does not end on it — to a
        // margin past the crests, or into the bore past them. In (r, s), s
        // into the body.
        const edge = P / 8
        const rc = chamferRadius(t, internal)
        const bore = Math.min(faceR, tooth.crest)
        const cFar = internal ? Math.max(bore - edge, bore / 2) : Math.max(faceR, t.diameter / 2) + edge
        const cNear = internal ? rc + edge : rc - edge
        const chamferAt: { at: number; out: 1 | -1 }[] = []
        if (t.chamfer) {
          const [rIn, rOut] = [Math.min(cNear, cFar), Math.max(cNear, cFar)]
          const loOpen = clear(lo, -1, rIn, rOut, edge)
          const hiOpen = clear(hi, 1, rIn, rOut, edge)
          if (endLo && freeLo && loOpen) chamferAt.push({ at: lo, out: -1 })
          if (endHi && freeHi && hiOpen) chamferAt.push({ at: hi, out: 1 })
          if (chamferAt.length === 0) throw new KernelError(`there is no end to chamfer — a chamfer goes where the thread comes out of the body free, a bolt’s tip or a bore’s mouth, and this one ${t.length === null ? '' : 'stops short of the face’s ends or '}runs up to more of the body.`)
          const length = hi - lo
          // How far in the cone leaves the thread — at a bolt's crests, a
          // nut's — and how far the cut runs on, a margin past them: past
          // the face's other end it would cut into whatever stands there.
          const reach = internal ? rc - Math.max(faceR, tooth.crest) : Math.min(faceR, tooth.crest) - rc
          const deep = Math.abs(cFar - rc)
          if (chamferAt.length === 2 && 2 * reach >= length) throw new KernelError(`the face is ${mmText(length)} long — too short for a chamfer at each end, each ${mmText(reach)} deep.`)
          if (chamferAt.length === 1 && deep > length && !(chamferAt[0].at === lo ? hiOpen : loOpen)) throw new KernelError(`the face is ${mmText(length)} long — too short for a chamfer ${mmText(deep)} deep.`)
        }
        const chamferRing = (at: number, out: 1 | -1): Shape => {
          const tri: [number, number][] = internal
            ? [
                [cNear, -edge],
                [cFar, rc - cFar],
                [cFar, -edge],
              ]
            : [
                [cNear, -edge],
                [cFar, cFar - rc],
                [cFar, -edge],
              ]
          const section = kernel.face({ outer: polygonLoop(tri.map(([r, s]) => addScaled(addScaled(center, axis, at - out * s), radial, r))), holes: [] })
          try {
            return kernel.revolve(section, center, axis, 2 * Math.PI)
          } finally {
            kernel.release(section)
          }
        }
        // Whole turns, so each of the sweep's faces is a turn of it.
        const turns = Math.ceil((to - from) / P - 1e-9) + 2
        if (turns > MAX_THREAD_TURNS) throw new KernelError(`the thread would take ${Math.round(turns)} turns — at most ${MAX_THREAD_TURNS}; give it a coarser pitch or a shorter length.`)
        const lift = (q: readonly [number, number]): Vec3 => addScaled(addScaled(center, axis, from - P + q[1]), radial, q[0])
        ring = kernel.face({ outer: [circle(outer)], holes: inner > 1e-3 ? [[circle(inner)]] : [] })
        band = kernel.extrude(ring, axis, from, to)
        screwed = kernel.screw({ outer: polygonLoop(tooth.points.map(lift)), holes: [] }, center, axis, 2 * Math.PI * turns, P, t.leftHanded, true)
        // The cutter's faces are left as the cut makes them: merged where
        // they lie on one surface, the helical ones came apart — a nut's
        // cutter lost faces and stood open.
        cutter = loneSolid(occt, occt.cut(band, screwed))
        // The chamfers first, on the plain face; the thread is cut through
        // them.
        for (const { at, out } of chamferAt) {
          const tool = chamferRing(at, out)
          try {
            const step = kernel.cutTracked(shape, tool)
            history = composeHistory(history, step.history)
            if (shape !== solid) kernel.release(shape)
            shape = step.shape
          } finally {
            kernel.release(tool)
          }
        }
        const cut = kernel.cutTracked(shape, cutter)
        history = composeHistory(history, cut.history)
        let threaded = cut.shape
        if (hull !== null && sleeve !== null) {
          // What it takes off is the fill past the ends, never more than
          // the fill: a hull the kernel closed up wrong is not trusted.
          const kept = kernel.commonTracked(cut.shape, hull)
          if (kernel.volume(cut.shape) - kernel.volume(kept.shape) <= kernel.volume(sleeve) + 1e-9) {
            history = composeHistory(history, kept.history)
            threaded = kept.shape
            kernel.release(cut.shape)
          } else kernel.release(kept.shape)
        }
        const note = threadNote(t, internal, drawn, tooth, wanted !== null && fill === null)
        return note ? { shape: threaded, history, note } : { shape: threaded, history }
      } finally {
        if (shape !== solid) kernel.release(shape)
        for (const s of [hull, sleeve, ring, band, screwed, cutter]) if (s !== null) kernel.release(s)
      }
    }),
  )
}
