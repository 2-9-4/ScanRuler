// SPDX-License-Identifier: AGPL-3.0-only
// Hairs a STEP reader turns into holes: an edge between two faces a hair
// long, which the body check flags while a pole or an apex stays quiet; a
// curve that ends a hair off its corner, which reads back as a free edge
// and which the export mends by moving the curve's end onto the corner;
// and a body that reads back whole, which the export leaves as it was.

import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { rectangleLoop, ReKernel, type Shape } from '../core/kernel'
import { oddEdges, shortEdges } from '../core/kernelEdges'
import { snapCurveEnds } from '../core/kernelStep'
import type { OcctLike } from '../core/occtTypes'
import { primitiveSolid } from '../core/primitives'

// Kernel builds run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()
const occtOf = (k: ReKernel) => (k as unknown as { occt: OcctLike }).occt

/** A rounded box: a box with its top edges rounded R2. */
function roundedBox(k: ReKernel): Shape {
  const box = k.box([0, 0, 0], [30, 20, 10])
  const top = k.edges(box, 0.05).filter((e) => e.mid[2] > 9.99 && e.faceHashes.length === 2)
  return k.filletTracked(box, top.map((e) => e.hash), 2).shape
}

/** A smooth loft whose side edges are B-splines. */
function loft(k: ReKernel): Shape {
  return k.loft(
    [
      { outer: rectangleLoop([-10, -10, 0], [1, 0, 0], [0, 1, 0], 20, 20), holes: [] },
      { outer: rectangleLoop([-4, -6, 15], [Math.cos(0.3), Math.sin(0.3), 0], [-Math.sin(0.3), Math.cos(0.3), 0], 10, 8), holes: [] },
      { outer: rectangleLoop([-8, -8, 30], [1, 0, 0], [0, 1, 0], 16, 16), holes: [] },
    ],
    false,
  )
}

describe('short edges', () => {
  it('leaves a sphere’s poles and a cone’s apex quiet', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    const ball = primitiveSolid(k, { kind: 'sphere', center: [0, 0, 0], radius: 5 })
    // A cone to a point: a triangle with a side on the axis, turned about
    // it. (The cone primitive keeps a 1e-6 mm circle at its tip — a hair,
    // which is flagged.)
    const triangle = k.face({ outer: [{ kind: 'line', a: [20, 0, 0], b: [24, 0, 8] }, { kind: 'line', a: [24, 0, 8], b: [20, 0, 8] }, { kind: 'line', a: [20, 0, 8], b: [20, 0, 0] }], holes: [] })
    const cone = k.revolve(triangle, [20, 0, 0], [0, 0, 1], 2 * Math.PI)
    const tipped = primitiveSolid(k, { kind: 'cone', origin: [40, 0, 0], axis: [0, 0, 1], radius1: 0, radius2: 4, length: 8 })
    expect(shortEdges(o, tipped).count).toBe(1)
    for (const s of [ball, cone]) {
      expect(shortEdges(o, s).count).toBe(0)
      expect(oddEdges(o, s, { knife: true }).counts).toEqual({ free: 0, inside: 0, nonManifold: 0, knife: 0 })
      expect(k.readBackEdges(k.exportStep([s]))).toEqual([[]])
    }
  })

  it('finds nothing on a box or a rounded one, and their export is the file as written', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    for (const s of [k.box([0, 0, 0], [10, 10, 10]), roundedBox(k)]) {
      expect(shortEdges(o, s).count).toBe(0)
      const text = k.exportStep([s], [{ name: 'Part' }])
      const out = k.exportStepMended([s], [{ name: 'Part' }])
      expect(out.mended).toEqual([])
      expect(out.text.replace(/'\d{4}-\d\d-\d\dT[\d:]+'/, '')).toBe(text.replace(/'\d{4}-\d\d-\d\dT[\d:]+'/, ''))
    }
  })

  it('flags an edge between two faces under 1e-4 mm', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    // Two boxes stacked with one a hair longer: the side faces leave an
    // edge 5e-5 mm long where they step.
    const a = k.box([0, 0, 0], [10, 10, 5])
    const b = k.box([0, 0, 5], [10, 10 + 5e-5, 10])
    const joined = k.fuse(a, b)
    const found = shortEdges(o, joined)
    expect(found.count).toBeGreaterThan(0)
    expect(found.edges[0].length).toBeLessThan(1e-4)
    expect(found.edges[0].faces).toHaveLength(2)
  })
})

describe('a curve ending off its corner', () => {
  /** The file of a body with one B-spline edge's last pole moved `off` mm
   *  off its vertex, and where. */
  function moved(text: string, off: number): { text: string; at: Vec3 } {
    // Follow the curve to its poles: the last pole of a B-spline edge.
    const flat = text.replace(/\r?\n\s*/g, '')
    const entity = (id: string) => new RegExp(`#${id} = ([^;]*);`).exec(flat)![1]
    for (const em of flat.matchAll(/#\d+ = EDGE_CURVE\('',#(\d+),#(\d+),#(\d+),\.([TF])\.\);/g)) {
      let curve = entity(em[3])
      const surface = /^SURFACE_CURVE\('',#(\d+)/.exec(curve)
      if (surface) curve = entity(surface[1])
      const poles = /B_SPLINE_CURVE_WITH_KNOTS\('',\d+,\(([^)]*)\)/.exec(curve) ?? /B_SPLINE_CURVE\(\d+,\(([^)]*)\)/.exec(curve)
      if (!poles) continue
      const ids = poles[1].split(',').map((x) => x.trim().slice(1))
      const last = ids[ids.length - 1]
      const p = /\(([^()]*)\)\)$/.exec(entity(last))![1].split(',').map(Number) as Vec3
      const shifted: Vec3 = [p[0] + off, p[1], p[2]]
      const out = text.replace(new RegExp(`(#${last} = CARTESIAN_POINT\\('',)\\([^)]*\\)`), `$1(${shifted.map((v) => (Number.isInteger(v) ? `${v}.` : String(v))).join(',')})`)
      return { text: out, at: p }
    }
    throw new Error('no B-spline edge')
  }

  it('moves the curve’s end back onto its corner, and only near the places given', async () => {
    const k = await kernelPromise
    const body = loft(k)
    const text = k.exportStep([body])
    const off = moved(text, 4e-3)
    expect(off.text).not.toBe(text)
    // Far from the place: nothing moves.
    expect(snapCurveEnds(off.text, [[500, 500, 500]]).moved).toBe(0)
    // Off by more than allowed: nothing moves.
    expect(snapCurveEnds(off.text, [off.at], { maxMm: 1e-3 }).moved).toBe(0)
    const snapped = snapCurveEnds(off.text, [off.at])
    expect(snapped.moved).toBeGreaterThanOrEqual(1)
    expect(snapped.offMax).toBeGreaterThan(3e-3)
    expect(snapped.offMax).toBeLessThan(5e-3)
    // The file read back holds as the body's own did.
    expect(k.readBackEdges(snapped.text)).toEqual([[]])
    const check = k.verifyStep(snapped.text, [body])
    expect(check.ok).toBe(true)
    expect(check.bodies[0].gap.max).toBeLessThan(1e-3)
  })
})

// The rumble pak's nose corner, as the run had it: in two rounds — R band
// front R1.9 on the band × front-cylinder edge, then R nose sides R1.2 on
// the two flank × front-cylinder edges — it reads back with a free edge
// 7.5 nm long at (14.983, −7.199, 18.447), one curve there ending 8.7 nm
// off its corner; in one round over the three edges at R1.4, 1.5 µm long
// at (15.092, 6.188, 19.143), 3.4 µm off. The project as saved (the crease
// rounded with them) reads back whole and is left as written.
// RE_SHORT_EDGE_PROJECT names 13_rumblePack_07-hump-rework.scanruler.
const project = process.env.RE_SHORT_EDGE_PROJECT ?? ''

type Nose = 'two rounds' | 'one round' | 'saved'
const NOSES: { nose: Nose; at: Vec3 | null }[] = [
  { nose: 'two rounds', at: [14.983, -7.199, 18.447] },
  { nose: 'one round', at: [15.092, 6.188, 19.143] },
  { nose: 'saved', at: null },
]

describe.skipIf(!project)('the rumble pak’s nose corner', () => {
  beforeAll(async () => {
    ;(await import('../plugin')).default.install?.()
  })

  it.each(NOSES)('$nose: the plain body check reads it back, and the export mends only what reads back open', async ({ nose, at }) => {
    const { Builder } = await import('../core/build')
    const { resolveFeatures } = await import('../core/resolve')
    const { findRegions } = await import('../core/regions')
    const { applyReversePart } = await import('../app/projectSection')
    const { useReverse } = await import('../state/reStore')
    type F = { id: number; kind: string; name?: string; radius?: number; edges?: unknown[]; sketch?: unknown }
    const zip = unzipSync(readFileSync(project))
    applyReversePart(JSON.parse(strFromU8(zip['project.json'])).reverse)
    const features = (useReverse.getState().features as unknown as F[]).map((f) => ({ ...f }))
    const i = features.findIndex((f) => f.id === 83)
    const sides = features[i]
    const e = sides.edges!
    if (nose === 'two rounds') {
      features[i] = { ...sides, radius: 1.2, edges: [e[0], e[1]] }
      features.splice(i, 0, { ...sides, id: 999, name: 'R band front', radius: 1.9, edges: [e[2]] })
    } else if (nose === 'one round') features[i] = { ...sides, radius: 1.4, edges: [e[0], e[1], e[2]] }
    const steps = resolveFeatures(features as never, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
    const sketches = new Map(features.filter((f) => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
    const k = await kernelPromise
    const builder = new Builder(k)
    try {
      const out = builder.build(steps, (id) => sketches.get(id) as never)
      expect(out.results.filter((r) => r.status === 'failed')).toEqual([])
      const c = builder.check(2, 0.01)!
      expect(c.valid && c.closed).toBe(true)
      expect(c.odd.counts.free).toBe(0)
      // The plug corners' 9e-17 mm edges are degenerate: no hair.
      expect(c.short.count).toBe(0)
      const written = builder.exportStepMended([2], [{ name: 'Body plan' }])
      if (!at) {
        expect(c.readBack).toEqual([])
        expect(written.mended).toEqual([])
        return
      }
      expect(c.readBack).toHaveLength(1)
      expect(c.readBack![0]).toMatchObject({ kind: 'free' })
      expect(c.readBack![0].length).toBeLessThan(0.01)
      for (let a = 0; a < 3; a++) expect(c.readBack![0].at[a]).toBeCloseTo(at[a], 2)
      expect(written.mended).toHaveLength(1)
      expect(written.mended[0].gap).toBeLessThan(1e-3)
      expect(builder.verifyStep([2], written.text).ok).toBe(true)
      // The round trip says it does not hold, and what the export makes of it.
      const trip = builder.check(2, 0.01, undefined, true)!.roundTrip!
      expect(trip.ok).toBe(false)
      expect(trip.mended).toHaveLength(1)
    } finally {
      builder.dispose()
    }
  }, 900_000)
})
