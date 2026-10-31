// SPDX-License-Identifier: AGPL-3.0-only
// A fillet's round in the STEP file the workspace writes, as a CAD system
// that takes a face's loop at its word reads it. OCCT's writer puts the
// loop of a round on a left-handed torus, all the way round between two
// circles, the wrong way round, and OCCT's reader mends it without a word
// — so only a reader like Onshape's sees the round turned into a cove. The
// rim of a post revolved one way about its axis is rounded on a
// right-handed torus, the other way on a left-handed one.

import { describe, expect, it, vi } from 'vitest'
import { rectangleLoop, ReKernel, type Shape, volumeOff } from '../core/kernel'
import { hasLeftHandedTorus } from '../core/kernelStep'
import type { OcctLike } from '../core/occtTypes'
import { faceLoops } from '../core/stepLoops'

// Kernel builds run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** The package behind the adapter, for what its writer does unaided. */
const occtOf = (k: ReKernel) => (k as unknown as { occt: OcctLike }).occt

/** A post 28 mm in radius and 60 mm tall, revolved a full turn about +Z or
 *  −Z from a sketch on the XZ plane, the rim of its top rounded 0.7 mm —
 *  or of both its ends. */
async function roundedPost(about: 1 | -1, rims: 'top' | 'both' = 'top'): Promise<{ k: ReKernel; post: Shape }> {
  const k = await kernelPromise
  const face = k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 0, 1], 28, 60), holes: [] })
  const plain = k.revolve(face, [0, 0, 0], [0, 0, about], 2 * Math.PI)
  const ends = rims === 'top' ? [60] : [0, 60]
  const edges = k.edges(plain, 0.1).filter((e) => e.kind === 'circle' && ends.some((z) => Math.abs(e.mid[2] - z) < 1e-6))
  expect(edges).toHaveLength(ends.length)
  const post = k.filletTracked(
    plain,
    edges.map((e) => e.hash),
    0.7,
  ).shape
  k.release(face, plain)
  return { k, post }
}

/** The −Z post rounded at both ends, its top then sliced off by a plane
 *  leaning 0.1° through the top round all the way round: that round now
 *  ends in a B-spline, the bottom one still between two circles. */
async function slicedPost(): Promise<{ k: ReKernel; post: Shape }> {
  const { k, post: whole } = await roundedPost(-1, 'both')
  const above = k.halfSpace([0, 0, 59.75], [-0.002, 0, 1])
  const post = k.cut(whole, above)
  k.release(whole, above)
  return { k, post }
}

/** The faces of a file whose loops run the wrong way, by id and surface. */
const wrongWay = (step: string) =>
  faceLoops(step)
    .filter((f) => f.ok === false)
    .map((f) => `#${f.id} ${f.surface}`)

/** Whether each torus face's loops run the right way, in the file's order. */
const tori = (step: string) => faceLoops(step).flatMap((f) => (f.surface === 'TOROIDAL_SURFACE' ? [f.ok] : []))

/** The lines of `b` that are not as in `a`, left out the date the file was
 *  written on and the product's name, which the writer numbers by how
 *  many files it has written. */
const changedLines = (a: string, b: string) => {
  const before = a.split('\n')
  return b.split('\n').filter((line, i) => line !== before[i] && !/FILE_NAME|^\s*'\d{4}-\d\d-\d\dT|STEP translator/.test(line))
}

describe("a fillet's round in the STEP file", () => {
  it('turned about −Z, the round is a left-handed torus, whose loop the writer unaided gets wrong', async () => {
    const { k, post } = await roundedPost(-1)
    expect(hasLeftHandedTorus(occtOf(k), post)).toBe(true)
    // When this fails, OCCT's writer gets the round right by itself, and
    // mendTorusLoops (core/kernelStep.ts) can go.
    expect(wrongWay(occtOf(k).exportStep(post))).toEqual([expect.stringMatching(/TOROIDAL_SURFACE$/)])
    k.release(post)
  })

  it('turned about +Z, the round is right-handed and the writer gets it right', async () => {
    const { k, post } = await roundedPost(1)
    expect(hasLeftHandedTorus(occtOf(k), post)).toBe(false)
    expect(wrongWay(occtOf(k).exportStep(post))).toEqual([])
    k.release(post)
  })

  for (const about of [1, -1] as const) {
    it(`turned about ${about > 0 ? '+' : '−'}Z, every loop runs the right way, in a plain file and a named one, and the body is the same`, async () => {
      const { k, post } = await roundedPost(about)
      for (const step of [k.exportStep([post]), k.exportStep([post], [{ name: 'Post', color: '#8b9096' }])]) {
        const faces = faceLoops(step)
        expect(faces.map((f) => f.surface).sort()).toEqual(['CYLINDRICAL_SURFACE', 'PLANE', 'PLANE', 'TOROIDAL_SURFACE'])
        expect(faces.every((f) => f.ok !== null)).toBe(true)
        expect(wrongWay(step)).toEqual([])
        const back = k.importStep(step)
        expect(k.faceCount(back)).toBe(k.faceCount(post))
        expect(k.volume(back)).toBeCloseTo(k.volume(post), 6)
        expect(k.surfaceArea(back)).toBeCloseTo(k.surfaceArea(post), 6)
        k.release(back)
      }
      k.release(post)
    })
  }

  it('the round the writer gets wrong is mended and the one it gets right left be, nothing else in the file changed', async () => {
    const { k, post } = await slicedPost()
    const raw = occtOf(k).exportStep(post)
    const step = k.exportStep([post])
    expect(raw).toMatch(/B_SPLINE_CURVE_WITH_KNOTS/)
    expect([...tori(raw)].sort()).toEqual([false, true])
    expect(tori(step)).toEqual([true, true])
    expect(wrongWay(step)).toEqual([])
    expect(changedLines(raw, step)).toEqual([expect.stringMatching(/^#\d+ = FACE_BOUND\(.*\.T\.\);$/)])
    k.release(post)
  })
  it('verifyStep passes the file the workspace writes and fails the one the writer leaves unmended, naming the face', async () => {
    const { k, post } = await roundedPost(-1)
    const good = k.verifyStep(k.exportStep([post], [{ name: 'Post', color: '#8b9096' }]), [post])
    expect(good.problems).toEqual([])
    expect(good.ok).toBe(true)
    expect(good.parts).toBe(1)
    expect(good.bodies[0].name).toBe('Post')
    expect(good.bodies[0].closed).toBe(true)
    expect(good.bodies[0].faces[0]).toBe(good.bodies[0].faces[1])
    expect(good.bodies[0].gap.max).toBeLessThan(1e-3)
    expect(good.bodies[0].gap.points).toBeGreaterThan(100)
    expect(good.loops.wrong).toEqual([])
    // OCCT's writer unaided: its reader mends the loop, so the read-back
    // passes — the loop check is what fails it.
    const bad = k.verifyStep(occtOf(k).exportStep(post), [post])
    expect(bad.ok).toBe(false)
    expect(bad.bodies[0].gap.max).toBeLessThan(1e-3)
    expect(bad.loops.wrong).toEqual([expect.objectContaining({ surface: 'TOROIDAL_SURFACE' })])
    expect(bad.problems).toEqual([expect.stringMatching(/TOROIDAL_SURFACE\) has its loop the wrong way round/)])
    // A body the file does not hold.
    const missing = k.verifyStep(k.exportStep([post]), [post, post])
    expect(missing.ok).toBe(false)
    expect(missing.problems[0]).toMatch(/reads back as 1 part, not 2/)
    k.release(post)
  })
})

describe('a volume read back a hair off', () => {
  /** A plain post 28 mm in radius and `height` tall. */
  const post = async (height: number) => {
    const k = await kernelPromise
    const face = k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 0, 1], 28, height), holes: [] })
    const solid = k.revolve(face, [0, 0, 0], [0, 0, 1], 2 * Math.PI)
    k.release(face)
    return { k, solid }
  }

  it('is a note where the surfaces read back in place, a problem past 1e-3 or with the gap failing', async () => {
    // The file of a post 0.04 % taller than the body held against it: its
    // top 0.024 mm off.
    const { k, solid: written } = await post(60.024)
    const { solid: body } = await post(60)
    const text = k.exportStep([written])
    const loose = k.verifyStep(text, [body], { gapMm: 0.05 })
    expect(loose.ok).toBe(true)
    expect(loose.problems).toEqual([])
    expect(loose.notes).toEqual([expect.stringMatching(/off its volume \(0\.040 %\) — within the kernel/)])
    // The same file where the gap fails too: both are problems.
    const strict = k.verifyStep(text, [body])
    expect(strict.ok).toBe(false)
    expect(strict.problems).toEqual([expect.stringMatching(/off its volume \(0\.040 %\), the surfaces off too\.$/), expect.stringMatching(/mm off the body/)])
    expect(strict.notes).toEqual([])
    // Exactly the same: neither.
    expect(k.verifyStep(k.exportStep([body]), [body]).notes).toEqual([])
    k.release(written)
    k.release(body)
  })

  it('judges the share alone: past 1e-3 a problem, gap or not', () => {
    expect(volumeOff('A', [1000, 1000.000001], false)).toBeNull()
    expect(volumeOff('A', [1000, 1000.4], false)).toMatchObject({ problem: false })
    expect(volumeOff('A', [1000, 1000.4], true)).toMatchObject({ problem: true })
    expect(volumeOff('A', [1000, 1002], false)).toMatchObject({ problem: true, text: "A reads back 2.00 mm³ off its volume (0.20 %, over the 0.1 % the kernel's numeric integration accounts for)." })
  })
})
