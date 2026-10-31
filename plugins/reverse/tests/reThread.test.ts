// SPDX-License-Identifier: AGPL-3.0-only
// The Thread feature: the standards' sizes and the basic profile of each
// form — the 60° vee, the 45° one for printing — as a tooth's outline, and
// the thread cut on a round face in the kernel — a
// bolt's on a boss and a nut's in a bore, of the volume the profile screwed
// along the face says (Pappus), right- or left-handed, the whole face or a
// length in from one end, stopping at a shoulder, thinner by the offset,
// chamfered where it comes out of the body — and the threads that cannot be
// cut refused, saying why.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Builder, type FaceInfo } from '../core/build'
import { type Feature, type SketchFeature, type ThreadFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel, type Shape } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import { featureDraftReady, useReverse } from '../state/reStore'
import { chamferRadius, faceAgainstThread, fillRadius, maxThreadOffset, minorDiameter, pitchDiameter, roundFaceIsBoss, sizeForFace, sizeOf, THREAD_STANDARDS, threadDepth, threadDesignation, threadName, threadProblem, threadSizes, threadSpan, toothOutline, type ThreadCut, type ThreadSpec, type ToothPoint } from '../core/thread'
import { polygonLoop } from '../core/loops'
import { tick } from '../../../tests/helpers'
import { ctx, XY } from './reKit'

// Kernel builds and real-scan fits run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

afterEach(tick)

/** The area of a polygon in (r, z) and the radius of its centroid. */
function areaAndRadius(points: readonly ToothPoint[]): { area: number; r: number } {
  let a = 0
  let cr = 0
  for (let i = 0; i < points.length; i++) {
    const [r0, z0] = points[i]
    const [r1, z1] = points[(i + 1) % points.length]
    const cross = r0 * z1 - r1 * z0
    a += cross
    cr += (r0 + r1) * cross
  }
  return { area: Math.abs(a / 2), r: cr / (3 * a) }
}

/** The part of a tooth's outline beyond a radius — a bolt's above its
 *  core, a nut's inside its wall — as a polygon. */
function clipOutline(points: readonly ToothPoint[], at: number, keep: 'above' | 'below'): ToothPoint[] {
  const inside = (p: ToothPoint) => (keep === 'above' ? p[0] >= at - 1e-12 : p[0] <= at + 1e-12)
  const out: ToothPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (inside(a)) out.push(a)
    if (inside(a) !== inside(b)) {
      const t = (at - a[0]) / (b[0] - a[0])
      out.push([at, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

/** The volume a tooth's outline between radii `lo` and `hi` fills when
 *  screwed `length` along the axis at `pitch` — Pappus, the climb adding
 *  nothing. */
function teethVolume(points: readonly ToothPoint[], lo: number, hi: number, pitch: number, length: number): number {
  const { area, r } = areaAndRadius(clipOutline(clipOutline(points, lo, 'above'), hi, 'below'))
  return ((area * 2 * Math.PI * r) / pitch) * length
}

/** How wide a tooth's outline is at a radius. */
function widthAt(points: readonly ToothPoint[], r: number): number {
  const zs = clipOutline(points, r, 'below')
    .filter((p) => Math.abs(p[0] - r) < 1e-9)
    .map((p) => p[1])
  return Math.max(...zs) - Math.min(...zs)
}

const cut = (diameter: number, pitch: number, extra: Partial<ThreadCut> = {}): ThreadCut => ({ standard: 'metric', diameter, pitch, offset: 0, leftHanded: false, length: null, start: 0, flip: false, ...extra })

/** A bar of radius `r` up Z from 0 to `length`. */
async function bar(r: number, length: number): Promise<{ k: ReKernel; body: Shape }> {
  const k = await kernelPromise
  const disc = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: r }], holes: [] })
  const body = k.extrude(disc, [0, 0, 1], 0, length)
  k.release(disc)
  return { k, body }
}

/** The round faces of a shape, by radius. */
function roundFace(k: ReKernel, shape: Shape, radius: number): number {
  const f = k.faces(shape).find((x) => x.kind === 'cylinder' && Math.abs((x.radius ?? 0) - radius) < 1e-6)
  if (!f) throw new Error(`no round face of radius ${radius}`)
  return f.hash
}

/** Where along a line up Z at (x, y) the material is over one pitch from
 *  `z0`: the middle of the stretch inside, modulo the pitch. */
function toothMiddle(k: ReKernel, shape: Shape, x: number, y: number, z0: number, pitch: number): number {
  const n = 16
  const inside: boolean[] = []
  for (let i = 0; i < n; i++) inside.push(k.containsPoint(shape, [x, y, z0 + (pitch * i) / n]))
  // The stretch inside starts where outside turns to inside.
  const start = inside.findIndex((v, i) => v && !inside[(i + n - 1) % n])
  let len = 0
  while (inside[(start + len) % n] && len < n) len++
  return ((((start + len / 2) * pitch) / n) % pitch + pitch) % pitch
}

describe('the thread tables and the basic profile', () => {
  it('knows the standards’ sizes and names them', () => {
    expect(sizeOf('metric', 16)?.pitches[0]).toBe(2)
    expect(threadDesignation('metric', 16, 2)).toBe('M16×2')
    expect(threadDesignation('metric', 16, 1.5)).toBe('M16×1.5')
    expect(threadDesignation('metric', 16, 1.75)).toBeNull()
    expect(threadDesignation('unc', 6.35, 25.4 / 20)).toBe('1/4-20 UNC')
    expect(threadDesignation('unf', 6.35, 25.4 / 28)).toBe('1/4-28 UNF')
    expect(threadDesignation('unc', 4.826, 25.4 / 24)).toBe('#10-24 UNC')
    expect(threadName('metric', 15.5, 1.2)).toBe('Ø15.5 × 1.2')
    // The printing form says so, in a size of its own or not.
    expect(threadDesignation('print45', 10, 2.75)).toBe('Ø10×2.75 print')
    expect(threadDesignation('print45', 10, 1.5)).toBe('Ø10×1.5 print')
    expect(threadDesignation('print45', 10, 2)).toBeNull()
    expect(threadName('print45', 10, 2.4)).toBe('Ø10 × 2.4 print')
    expect(threadName('print45', 3.5, 1)).toBe('Ø3.5×1 print')
    expect(THREAD_STANDARDS.map((s) => s.id)).toEqual(['metric', 'unc', 'unf', 'print45'])
    for (const { id } of THREAD_STANDARDS) {
      const sizes = threadSizes(id)
      for (let i = 1; i < sizes.length; i++) expect(sizes[i].diameter).toBeGreaterThan(sizes[i - 1].diameter)
    }
  })

  it('sizes the printing form on the ISO metric diameters from 3 mm, as deep as their coarse thread', () => {
    // The pitch as deep as the ISO coarse thread first, rounded to a
    // quarter of a millimetre under 3 mm and a half from 3 mm up; then the
    // ISO coarse pitch.
    const table = Object.fromEntries(threadSizes('print45').map((s) => [s.label, s.pitches]))
    expect(table).toEqual({
      'Ø3': [1, 0.5],
      'Ø3.5': [1, 0.6],
      'Ø4': [1.25, 0.7],
      'Ø5': [1.5, 0.8],
      'Ø6': [1.75, 1],
      'Ø7': [1.75, 1],
      'Ø8': [2.25, 1.25],
      'Ø10': [2.75, 1.5],
      'Ø12': [3, 1.75],
      'Ø14': [3.5, 2],
      'Ø16': [3.5, 2],
      'Ø18': [4.5, 2.5],
      'Ø20': [4.5, 2.5],
      'Ø22': [4.5, 2.5],
      'Ø24': [5.5, 3],
      'Ø27': [5.5, 3],
      'Ø30': [6.5, 3.5],
      'Ø33': [6.5, 3.5],
      'Ø36': [7, 4],
      'Ø39': [7, 4],
      'Ø42': [8, 4.5],
      'Ø45': [8, 4.5],
      'Ø48': [9, 5],
      'Ø52': [9, 5],
      'Ø56': [10, 5.5],
      'Ø60': [10, 5.5],
      'Ø64': [11, 6],
    })
    // Each keeps its ISO coarse minor diameter to within the rounding.
    for (const s of threadSizes('print45')) {
      const iso = minorDiameter(s.diameter, sizeOf('metric', s.diameter)!.pitches[0], 'metric')
      expect(Math.abs(minorDiameter(s.diameter, s.pitches[0], 'print45') - iso), s.label).toBeLessThan(0.16)
      expect(threadProblem({ standard: 'print45', diameter: s.diameter, pitch: s.pitches[0], offset: 0 }), s.label).toBeNull()
    }
    // Ø10: 8.35 against M10's 8.376.
    expect(minorDiameter(10, 2.75, 'print45')).toBeCloseTo(minorDiameter(10, 1.5, 'metric'), 1)
    expect(sizeOf('print45', 2.5)).toBeNull()
  })

  it('reads the profile’s diameters off the pitch, as ISO 68-1 has them', () => {
    // M16×2: minor 13.835, pitch diameter 14.701.
    expect(minorDiameter(16, 2, 'metric')).toBeCloseTo(13.835, 3)
    expect(pitchDiameter(16, 2, 'metric')).toBeCloseTo(14.701, 3)
    expect(threadDepth(1, 'metric')).toBeCloseTo(0.5413, 4)
    expect(maxThreadOffset(2, 'metric')).toBeCloseTo((Math.sqrt(3) / 8) * 2, 12)
    // The 45° form: 0.3 of the pitch deep, the pitch diameter halfway down.
    expect(threadDepth(1, 'print45')).toBeCloseTo(0.3, 12)
    expect(minorDiameter(10, 2.75, 'print45')).toBeCloseTo(10 - 0.6 * 2.75, 12)
    expect(pitchDiameter(10, 2.75, 'print45')).toBeCloseTo(10 - 0.3 * 2.75, 12)
    expect(maxThreadOffset(2.75, 'print45')).toBeCloseTo((Math.SQRT2 / 8) * 2.75, 12)
  })

  it('picks the size a boss or a bore most likely carries', () => {
    expect(sizeForFace('metric', 15.9, false)).toEqual({ diameter: 16, pitch: 2 })
    // A bore drilled for M8: the tap drill's 6.8 mm, near the minor of 6.65.
    expect(sizeForFace('metric', 6.8, true)).toEqual({ diameter: 8, pitch: 1.25 })
    const quarter = sizeForFace('unc', 6.3, false)
    expect(quarter.diameter).toBeCloseTo(6.35, 6)
    expect(25.4 / quarter.pitch).toBeCloseTo(20, 6)
    // The printing form keeps ISO's minor diameter, so a bore drilled for
    // M10 — the tap drill's 8.5 mm — is taken for its Ø10.
    expect(sizeForFace('metric', 8.5, true)).toEqual({ diameter: 10, pitch: 1.5 })
    expect(sizeForFace('print45', 8.5, true)).toEqual({ diameter: 10, pitch: 2.75 })
    expect(sizeForFace('print45', 6.8, true)).toEqual({ diameter: 8, pitch: 2.25 })
    expect(sizeForFace('print45', 9.9, false)).toEqual({ diameter: 10, pitch: 2.75 })
    // A bore drawn at a size's own diameter is taken for that size: a Ø5
    // hole for M5, not the M6 its tap drill would be; Ø14 for M14, not M16.
    expect(sizeForFace('metric', 5, true)).toEqual({ diameter: 5, pitch: 0.8 })
    expect(sizeForFace('metric', 14, true)).toEqual({ diameter: 14, pitch: 2 })
    expect(sizeForFace('metric', 4.98, true)).toEqual({ diameter: 6, pitch: 1 })
    expect(sizeForFace('unc', 6.35, true).diameter).toBeCloseTo(6.35, 6)
    expect(sizeForFace('print45', 10, true)).toEqual({ diameter: 10, pitch: 2.75 })
  })

  it('brings a face drawn another size to the crests: a bore filled in, a boss built up, nothing added to one at them or past them', () => {
    const m5: ThreadSpec = { standard: 'metric', diameter: 5, pitch: 0.8, offset: 0 }
    const minor = minorDiameter(5, 0.8, 'metric') / 2
    // A Ø5 bore takes M5 at its minor, M4 at its, M6 at its.
    expect(fillRadius(m5, true, 2.5)).toBeCloseTo(minor, 12)
    expect(fillRadius({ ...m5, diameter: 4, pitch: 0.7 }, true, 2.5)).toBeCloseTo(minorDiameter(4, 0.7, 'metric') / 2, 12)
    expect(fillRadius({ ...m5, diameter: 6, pitch: 1 }, true, 2.5)).toBeCloseTo(minorDiameter(6, 1, 'metric') / 2, 12)
    // A bore at the minor, within a hair of it or narrower: the cut does it.
    expect(fillRadius(m5, true, minor)).toBeNull()
    expect(fillRadius(m5, true, minor + 0.005)).toBeNull()
    expect(fillRadius(m5, true, 1.5)).toBeNull()
    // The offset moves the crests, and the fill with them.
    expect(fillRadius({ ...m5, offset: 0.05 }, true, 2.5)).toBeCloseTo(minor + 0.05, 12)
    // A Ø4 pin is built up to M5's major; a Ø5 or a Ø6 one is not.
    expect(fillRadius(m5, false, 2)).toBe(2.5)
    expect(fillRadius(m5, false, 2.5)).toBeNull()
    expect(fillRadius(m5, false, 3)).toBeNull()
    // A bolt's crests come to a point: the fill runs a quarter pitch past
    // them. A nut's 60° crest, the wide flat, never does short of the
    // offset's limit.
    const sharp = { ...m5, offset: 0.12 }
    const bolt = toothOutline(sharp, false, 0)
    expect(bolt.pointed).toBe(true)
    expect(fillRadius(sharp, false, 2)).toBeCloseTo(bolt.crest + 0.2, 12)
    expect(toothOutline(sharp, true, 0).pointed).toBe(false)
    expect(fillRadius(sharp, true, 2.5)).toBeCloseTo(minor + 0.12, 12)
    // What the row says about the face: off by more than the depth.
    expect(faceAgainstThread(m5, true, 5)).toBe('wider')
    expect(faceAgainstThread(m5, true, 2 * minor + 0.2)).toBeNull()
    expect(faceAgainstThread(m5, false, 4)).toBe('narrower')
    expect(faceAgainstThread(m5, false, 4.9)).toBeNull()
  })

  it('draws a bolt’s tooth and a nut’s, the flats the standard’s, narrower than the pitch', () => {
    const P = 2
    const bolt = toothOutline({ standard: 'metric', diameter: 16, pitch: P, offset: 0 }, false, 0.5)
    // From the minor diameter, three quarters of the pitch wide, to the
    // major, an eighth wide; a nut's the other way round.
    expect(bolt.root).toBeCloseTo(minorDiameter(16, P, 'metric') / 2, 9)
    expect(bolt.crest).toBe(8)
    expect(widthAt(bolt.points, 8)).toBeCloseTo(P / 8, 9)
    expect(widthAt(bolt.points, bolt.root)).toBeCloseTo((3 * P) / 4, 9)
    // Narrower than the pitch all the way into the core, so the turns
    // never meet.
    expect(Math.max(...bolt.points.map((p) => Math.abs(p[1])))).toBeLessThan(P / 2)
    const nut = toothOutline({ standard: 'metric', diameter: 16, pitch: P, offset: 0 }, true, 0.5)
    expect(nut.crest).toBeCloseTo(minorDiameter(16, P, 'metric') / 2, 9)
    expect(nut.root).toBe(8)
    expect(widthAt(nut.points, nut.crest + 1e-12)).toBeCloseTo(P / 4, 6)
    expect(widthAt(nut.points, 8)).toBeCloseTo((7 * P) / 8, 9)
    expect(Math.max(...nut.points.map((p) => Math.abs(p[1])))).toBeLessThan(P / 2)
    // A tooth and a gap make a pitch: the bolt's tooth is the nut's gap.
    const depth = threadDepth(P, 'metric')
    const boltArea = areaAndRadius(clipOutline(bolt.points, bolt.root, 'above')).area
    const nutArea = areaAndRadius(clipOutline(nut.points, 8, 'below')).area
    expect(boltArea + nutArea).toBeCloseTo(depth * P, 9)
  })

  it('takes the tooth up to its point where the crest would lie on the face, so the face is the crest', () => {
    const t: ThreadSpec = { standard: 'metric', diameter: 16, pitch: 2, offset: 0 }
    const onFace = toothOutline(t, false, 0.5, 8)
    expect(Math.max(...onFace.points.map((p) => p[0]))).toBeGreaterThan(8.1)
    expect(widthAt(onFace.points, 8)).toBeCloseTo(2 / 8, 9)
    const inside = toothOutline(t, false, 0.5, 9)
    expect(Math.max(...inside.points.map((p) => p[0]))).toBe(8)
    const bore = toothOutline(t, true, 0.5, minorDiameter(16, 2, 'metric') / 2)
    expect(Math.min(...bore.points.map((p) => p[0]))).toBeLessThan(bore.crest - 0.1)
  })

  it('moves every face in by the offset, the crest to a point past what its flat gives', () => {
    const P = 1
    const plain = toothOutline({ standard: 'metric', diameter: 6, pitch: P, offset: 0 }, false, 0.5)
    const loose = toothOutline({ standard: 'metric', diameter: 6, pitch: P, offset: 0.05 }, false, 0.5)
    expect(loose.crest).toBeCloseTo(plain.crest - 0.05, 9)
    expect(loose.root).toBeCloseTo(plain.root - 0.05, 9)
    expect(loose.pointed).toBe(false)
    // The flanks moved square to themselves: at any radius the tooth is
    // 0.05/cos 30° narrower on each side.
    expect(widthAt(plain.points, 2.7) - widthAt(loose.points, 2.7)).toBeCloseTo((2 * 0.05) / Math.cos(Math.PI / 6), 9)
    const sharp = toothOutline({ standard: 'metric', diameter: 6, pitch: P, offset: 0.15 }, false, 0.5)
    expect(sharp.pointed).toBe(true)
    expect(sharp.points.filter((p) => p[0] === sharp.crest)).toHaveLength(1)
    // A nut's tooth: its crest comes out, its root goes deeper.
    const nut = toothOutline({ standard: 'metric', diameter: 6, pitch: P, offset: 0.05 }, true, 0.5)
    expect(nut.crest).toBeCloseTo(minorDiameter(6, P, 'metric') / 2 + 0.05, 9)
    expect(nut.root).toBeCloseTo(3.05, 9)
  })

  it('refuses an offset that leaves nothing where the threads bear, and other numbers it cannot cut', () => {
    expect(maxThreadOffset(2, 'metric')).toBeCloseTo(0.433, 3)
    expect(threadProblem({ standard: 'metric', diameter: 16, pitch: 2, offset: 0.4 })).toBeNull()
    expect(threadProblem({ standard: 'metric', diameter: 16, pitch: 2, offset: 0.5 })).toMatch(/no thickness at the pitch diameter — under 0\.433 mm/)
    expect(threadProblem({ standard: 'metric', diameter: 16, pitch: 2, offset: -0.1 })).toMatch(/only takes material away/)
    expect(threadProblem({ standard: 'metric', diameter: 16, pitch: 0, offset: 0 })).toMatch(/needs a pitch/)
    expect(threadProblem({ standard: 'metric', diameter: 3, pitch: 2.5, offset: 0 })).toMatch(/too coarse/)
  })

  it('keeps the 60° tooth exactly where the form’s own closed forms put it', () => {
    // The outline as it was drawn before the forms were one: ISO 68-1's
    // numbers written out for the 60° vee.
    const s3 = Math.sqrt(3)
    const before = (t: ThreadSpec, internal: boolean, reach: number, face?: number): ToothPoint[] => {
      const P = t.pitch
      const c = t.offset
      const R = t.diameter / 2
      const depth = (5 / 8) * (s3 / 2) * P
      const past = Math.min(0.05 * P, reach / 2)
      if (!internal) {
        const root = R - depth - c
        const rootHalf = (3 / 8) * P - c / s3
        const crestHalf = P / 16 - c / s3
        const pointed = crestHalf < 1e-4 * P
        const apex = R - 2 * c + (s3 / 16) * P
        const crest = pointed ? apex : R - c
        const toApex = pointed || (face !== undefined && crest >= face - 0.01 * P)
        const top: ToothPoint[] = toApex ? [[apex, 0]] : [[crest, -crestHalf], [crest, crestHalf]]
        const bend = root - past
        const bendHalf = rootHalf + past / s3
        return [[root - reach, -bendHalf], [bend, -bendHalf], ...top, [bend, bendHalf], [root - reach, bendHalf]]
      }
      const minor = R - depth
      const root = R + c
      const rootHalf = (7 / 16) * P - c / s3
      const crestHalf = P / 8 - c / s3
      const pointed = crestHalf < 1e-4 * P
      const apex = minor + 2 * c - (s3 / 8) * P
      const crest = pointed ? apex : minor + c
      const toApex = pointed || (face !== undefined && crest <= face + 0.01 * P)
      const bend = root + past
      const bendHalf = rootHalf + past / s3
      return [...(toApex ? [[apex, 0] as ToothPoint] : [[crest, -crestHalf] as ToothPoint]), [bend, -bendHalf], [root + reach, -bendHalf], [root + reach, bendHalf], [bend, bendHalf], ...(toApex ? [] : [[crest, crestHalf] as ToothPoint])]
    }
    const cases: [number, number, number][] = [
      [16, 2, 0],
      [16, 2, 0.2],
      [16, 2, 0.3],
      [6, 1, 0.05],
      [6, 1, 0.15],
      [3, 0.5, 0.05],
      [6.35, 25.4 / 20, 0.1],
    ]
    for (const [D, P, c] of cases) {
      for (const standard of ['metric', 'unc', 'unf'] as const) {
        const t: ThreadSpec = { standard, diameter: D, pitch: P, offset: c }
        const minor = D / 2 - (5 / 8) * (s3 / 2) * P
        for (const [internal, face] of [[false, undefined], [false, D / 2], [true, undefined], [true, minor]] as const) {
          const got = toothOutline(t, internal, 0.5, face).points
          const want = before(t, internal, 0.5, face)
          const label = `${standard} Ø${D}×${P} −${c} ${internal ? 'nut' : 'bolt'}${face === undefined ? '' : ' on its face'}`
          expect(got.length, label).toBe(want.length)
          got.forEach((p, i) => {
            expect(p[0], label).toBeCloseTo(want[i][0], 12)
            expect(p[1], label).toBeCloseTo(want[i][1], 12)
          })
        }
      }
    }
  })

  it('draws the printing form’s tooth: 45° flanks, a fifth of the pitch flat at the crest and at the root, 0.3 of it deep', () => {
    const P = 2.75
    const t: ThreadSpec = { standard: 'print45', diameter: 10, pitch: P, offset: 0 }
    const bolt = toothOutline(t, false, 0.5)
    expect(bolt.crest).toBe(5)
    expect(bolt.root).toBeCloseTo(5 - 0.3 * P, 12)
    expect(bolt.root).toBeCloseTo(minorDiameter(10, P, 'print45') / 2, 12)
    expect(bolt.pointed).toBe(false)
    // The crest a fifth of the pitch, the gap's floor a fifth — the tooth
    // four fifths wide there — and half the pitch at the pitch diameter.
    expect(widthAt(bolt.points, 5)).toBeCloseTo(P / 5, 12)
    expect(widthAt(bolt.points, bolt.root)).toBeCloseTo((4 * P) / 5, 12)
    expect(widthAt(bolt.points, pitchDiameter(10, P, 'print45') / 2)).toBeCloseTo(P / 2, 12)
    // The flanks at exactly 45°: from the crest's corner to the bend past
    // the root, as far along the axis as across it.
    const slope = (a: ToothPoint, b: ToothPoint) => Math.abs((b[1] - a[1]) / (b[0] - a[0]))
    expect(bolt.points).toHaveLength(6)
    expect(slope(bolt.points[1], bolt.points[2])).toBeCloseTo(1, 12)
    expect(slope(bolt.points[3], bolt.points[4])).toBeCloseTo(1, 12)
    expect(Math.max(...bolt.points.map((p) => Math.abs(p[1])))).toBeLessThan(P / 2)
    // A nut's: the crest a fifth wide at the minor, four fifths at the major.
    const nut = toothOutline(t, true, 0.5)
    expect(nut.root).toBe(5)
    expect(nut.crest).toBeCloseTo(5 - 0.3 * P, 12)
    expect(widthAt(nut.points, nut.crest + 1e-12)).toBeCloseTo(P / 5, 6)
    expect(widthAt(nut.points, 5)).toBeCloseTo((4 * P) / 5, 12)
    expect(slope(nut.points[0], nut.points[1])).toBeCloseTo(1, 12)
    expect(slope(nut.points[4], nut.points[5])).toBeCloseTo(1, 12)
    expect(Math.max(...nut.points.map((p) => Math.abs(p[1])))).toBeLessThan(P / 2)
    // The bolt's tooth is the nut's gap.
    const boltArea = areaAndRadius(clipOutline(bolt.points, bolt.root, 'above')).area
    const nutArea = areaAndRadius(clipOutline(nut.points, 5, 'below')).area
    expect(boltArea + nutArea).toBeCloseTo(0.3 * P * P, 12)
    // The 60° form's flanks, for the difference: tan 30°.
    const vee = toothOutline({ ...t, standard: 'metric' }, false, 0.5)
    expect(slope(vee.points[1], vee.points[2])).toBeCloseTo(1 / Math.sqrt(3), 12)
  })

  it('moves the printing form’s faces in by the offset: the crest’s flat narrower, the gap’s floor wider, by twice (√2 − 1) the offset', () => {
    const P = 2.75
    const c = 0.2
    const t: ThreadSpec = { standard: 'print45', diameter: 10, pitch: P, offset: 0 }
    const plain = toothOutline(t, false, 0.5)
    const loose = toothOutline({ ...t, offset: c }, false, 0.5)
    expect(loose.crest).toBeCloseTo(5 - c, 12)
    expect(loose.root).toBeCloseTo(plain.root - c, 12)
    const k = 2 * c * (Math.SQRT2 - 1)
    expect(widthAt(loose.points, loose.crest)).toBeCloseTo(P / 5 - k, 12)
    expect(P - widthAt(loose.points, loose.root)).toBeCloseTo(P / 5 + k, 12)
    // The flanks moved square to themselves: √2 times the offset narrower
    // on each side at any radius.
    expect(widthAt(plain.points, 4.5) - widthAt(loose.points, 4.5)).toBeCloseTo(2 * c * Math.SQRT2, 12)
    const nut = toothOutline({ ...t, offset: c }, true, 0.5)
    expect(nut.crest).toBeCloseTo(minorDiameter(10, P, 'print45') / 2 + c, 12)
    expect(nut.root).toBeCloseTo(5 + c, 12)
    expect(widthAt(nut.points, nut.crest + 1e-12)).toBeCloseTo(P / 5 - k, 6)
    // The flats outlast the tooth's thickness at the pitch diameter: the
    // crest never comes to a point at an offset the thread takes, and only
    // past what is refused would it.
    const max = maxThreadOffset(P, 'print45')
    expect(max).toBeCloseTo((Math.SQRT2 / 8) * P, 12)
    for (const internal of [false, true]) expect(toothOutline({ ...t, offset: 0.999 * max }, internal, 0.5).pointed).toBe(false)
    expect(threadProblem({ ...t, offset: 0.999 * max })).toBeNull()
    expect(threadProblem({ ...t, offset: max })).toMatch(/no thickness at the pitch diameter — under 0\.486 mm/)
    expect(toothOutline({ ...t, offset: 0.25 * P }, false, 0.5).pointed).toBe(true)
    expect(threadProblem({ ...t, offset: 0.25 * P })).toMatch(/no thickness at the pitch diameter/)
  })

  it('places a length on the face from its far end, or with flip its near one', () => {
    expect(threadSpan({ lo: -15, hi: 15 }, null, 3, false)).toEqual({ from: -15, to: 15 })
    expect(threadSpan({ lo: -15, hi: 15 }, 10, 5, false)).toEqual({ from: 0, to: 10 })
    expect(threadSpan({ lo: -15, hi: 15 }, 10, 5, true)).toEqual({ from: -10, to: 0 })
    expect(threadSpan({ lo: -15, hi: 15 }, 10, 25, false)).toBeNull()
  })
})

describe('a thread cut in the kernel', () => {
  it('cuts a bolt’s thread the whole length of a boss, of the volume the profile says', async () => {
    const { k, body } = await bar(8, 30)
    const t = cut(16, 2)
    const threaded = k.threadTracked(body, roundFace(k, body, 8), t)
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    expect(threaded.note).toBeUndefined()
    const tooth = toothOutline(t, false, 0.5)
    const want = Math.PI * tooth.root ** 2 * 30 + teethVolume(tooth.points, tooth.root, 8, 2, 30)
    expect(Math.abs(k.volume(threaded.shape) - want) / want).toBeLessThan(1e-4)
    // The ends are where they were: the free ends run the thread out.
    const b = k.bounds(threaded.shape)
    expect(b.min[2]).toBeCloseTo(0, 6)
    expect(b.max[2]).toBeCloseTo(30, 6)
    k.release(body, threaded.shape)
  })

  it('turns right-handed, or left-handed when asked', async () => {
    const { k, body } = await bar(8, 30)
    const face = roundFace(k, body, 8)
    const right = k.threadTracked(body, face, cut(16, 2))
    const left = k.threadTracked(body, face, cut(16, 2, { leftHanded: true }))
    // A quarter turn counter-clockwise about +Z, from +X to +Y, a
    // right-hand thread's tooth has climbed a quarter pitch; a left-hand
    // one's has dropped it, and a quarter pitch up is the middle of its gap.
    const r = 8 - 0.2
    for (const [shape, hand] of [[right.shape, 'right'], [left.shape, 'left']] as const) {
      const up = toothMiddle(k, shape, r, 0, 10, 2) + 10 + 0.5
      expect(k.containsPoint(shape, [0, r, up]), hand).toBe(hand === 'right')
      expect(k.containsPoint(shape, [0, r, up - 1]), hand).toBe(hand === 'left')
    }
    expect(Math.abs(k.volume(left.shape) - k.volume(right.shape)) / k.volume(right.shape)).toBeLessThan(1e-5)
    k.release(body, right.shape, left.shape)
  })

  it('cuts a length in from the far end, or from the near one flipped', async () => {
    const { k, body } = await bar(8, 30)
    const face = roundFace(k, body, 8)
    const t = cut(16, 2, { length: 10, start: 5 })
    const top = k.threadTracked(body, face, t)
    expect(k.isClosedSolid(top.shape)).toBe(true)
    const tooth = toothOutline(t, false, 0.5)
    const groove = (Math.PI * 64 - Math.PI * tooth.root ** 2) * 10 - teethVolume(tooth.points, tooth.root, 8, 2, 10)
    expect(Math.abs(k.volume(top.shape) - (Math.PI * 64 * 30 - groove)) / (Math.PI * 64 * 30)).toBeLessThan(1e-5)
    const round = (shape: Shape, z: number) => [0, 1, 2, 3, 4, 5, 6, 7].every((i) => k.containsPoint(shape, [7.9 * Math.cos(i * 0.785), 7.9 * Math.sin(i * 0.785), z]))
    // From z 15 to 25: the top 5 mm and the lower half stay round.
    expect(round(top.shape, 27)).toBe(true)
    expect(round(top.shape, 20)).toBe(false)
    expect(round(top.shape, 10)).toBe(true)
    const flipped = k.threadTracked(body, face, { ...t, flip: true })
    expect(round(flipped.shape, 3)).toBe(true)
    expect(round(flipped.shape, 10)).toBe(false)
    expect(round(flipped.shape, 20)).toBe(true)
    expect(() => k.threadTracked(body, face, { ...t, start: 25 })).toThrow(/runs past the end of the face/)
    k.release(body, top.shape, flipped.shape)
  })

  it('stops at a shoulder, leaving it whole', async () => {
    const k = await kernelPromise
    const pin = await bar(8, 20)
    const disc = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 12 }], holes: [] })
    const head = k.extrude(disc, [0, 0, 1], 20, 30)
    const body = k.fuse(pin.body, head)
    const threaded = k.threadTracked(body, roundFace(k, body, 8), cut(16, 2))
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    // The shoulder's face is untouched: just above it, all the way round,
    // the head is solid out to its rim.
    for (let i = 0; i < 12; i++) expect(k.containsPoint(threaded.shape, [9.5 * Math.cos(i * 0.52), 9.5 * Math.sin(i * 0.52), 20.05])).toBe(true)
    const tooth = toothOutline(cut(16, 2), false, 0.5)
    const want = Math.PI * 144 * 10 + Math.PI * tooth.root ** 2 * 20 + teethVolume(tooth.points, tooth.root, 8, 2, 20)
    expect(Math.abs(k.volume(threaded.shape) - want) / want).toBeLessThan(1e-4)
    k.release(disc, head, body, pin.body, threaded.shape)
  })

  it('cuts a nut’s thread in a bore through a block', async () => {
    const k = await kernelPromise
    const minor = minorDiameter(16, 2, 'metric') / 2
    const block = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 15 }], holes: [[{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: minor }]] })
    const body = k.extrude(block, [0, 0, 1], 0, 12)
    k.release(block)
    const t = cut(16, 2)
    const threaded = k.threadTracked(body, roundFace(k, body, minor), t)
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    expect(threaded.note).toBeUndefined()
    const tooth = toothOutline(t, true, 0.5)
    const removed = Math.PI * (8 ** 2 - minor ** 2) * 12 - teethVolume(tooth.points, minor, 8, 2, 12)
    const before = k.volume(body)
    expect(Math.abs(before - removed - k.volume(threaded.shape)) / before).toBeLessThan(1e-4)
    k.release(body, threaded.shape)
  })

  it('cuts the printing form on a boss and in a bore, of the volume its profile says', async () => {
    const { k, body } = await bar(5, 20)
    const t = cut(10, 2.75, { standard: 'print45' })
    const bolt = k.threadTracked(body, roundFace(k, body, 5), t)
    expect(k.isClosedSolid(bolt.shape)).toBe(true)
    expect(bolt.note).toBeUndefined()
    const tooth = toothOutline(t, false, 0.5)
    const want = Math.PI * tooth.root ** 2 * 20 + teethVolume(tooth.points, tooth.root, 5, 2.75, 20)
    expect(Math.abs(k.volume(bolt.shape) - want) / want).toBeLessThan(1e-4)
    k.release(body, bolt.shape)
    await tick()
    // A nut's, in a bore at the form's minor diameter through a block.
    const minor = minorDiameter(10, 2.75, 'print45') / 2
    const block = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 12 }], holes: [[{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: minor }]] })
    const plate = k.extrude(block, [0, 0, 1], 0, 12)
    k.release(block)
    const nut = k.threadTracked(plate, roundFace(k, plate, minor), t)
    expect(k.isClosedSolid(nut.shape)).toBe(true)
    expect(nut.note).toBeUndefined()
    const nutTooth = toothOutline(t, true, 0.5)
    const removed = Math.PI * (5 ** 2 - minor ** 2) * 12 - teethVolume(nutTooth.points, minor, 5, 2.75, 12)
    const before = k.volume(plate)
    expect(Math.abs(before - removed - k.volume(nut.shape)) / before).toBeLessThan(1e-4)
    k.release(plate, nut.shape)
    await tick()
    // Left-handed, with an offset, chamfered at both free ends.
    const again = await bar(5, 20)
    const loose = k.threadTracked(again.body, roundFace(k, again.body, 5), { ...t, leftHanded: true, offset: 0.2, chamfer: true })
    expect(k.isClosedSolid(loose.shape)).toBe(true)
    k.release(again.body, loose.shape)
  })

  it('takes the offset off every face of the thread', async () => {
    const { k, body } = await bar(8, 30)
    const face = roundFace(k, body, 8)
    const t = cut(16, 2, { offset: 0.2 })
    const loose = k.threadTracked(body, face, t)
    expect(k.isClosedSolid(loose.shape)).toBe(true)
    const tooth = toothOutline(t, false, 0.5)
    const want = Math.PI * tooth.root ** 2 * 30 + teethVolume(tooth.points, tooth.root, 8, 2, 30)
    expect(Math.abs(k.volume(loose.shape) - want) / want).toBeLessThan(1e-4)
    // Past the flat's worth, the crest is a point, and the row says so.
    const sharp = k.threadTracked(body, face, cut(16, 2, { offset: 0.3 }))
    expect(k.isClosedSolid(sharp.shape)).toBe(true)
    expect(sharp.note).toMatch(/crests come to a point/)
    k.release(body, loose.shape, sharp.shape)
  })

  it('cuts the common sizes either hand, a bolt’s and a nut’s, with an offset and without', async () => {
    // The booleans on a screwed tooth are where a thread breaks: a sweep in
    // one face a side failed past a dozen turns, and for a left hand at
    // any length. Each of these is long for its pitch.
    const k = await kernelPromise
    const cases: { d: number; p: number; internal: boolean; lh: boolean; offset: number; length: number }[] = [
      { d: 3, p: 0.5, internal: false, lh: true, offset: 0.05, length: 12 },
      { d: 8, p: 1.25, internal: true, lh: true, offset: 0.1, length: 16 },
      { d: 6.35, p: 25.4 / 20, internal: false, lh: false, offset: 0.1, length: 20 },
      { d: 12, p: 1.75, internal: true, lh: false, offset: 0, length: 25 },
    ]
    for (const c of cases) {
      const t = cut(c.d, c.p, { leftHanded: c.lh, offset: c.offset })
      const minor = minorDiameter(c.d, c.p, 'metric') / 2
      const r = c.internal ? minor : c.d / 2
      const disc = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: c.internal ? c.d : r }], holes: c.internal ? [[{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: r }]] : [] })
      const body = k.extrude(disc, [0, 0, 1], 0, c.length)
      const threaded = k.threadTracked(body, roundFace(k, body, r), t)
      const label = `${c.internal ? 'nut' : 'bolt'} Ø${c.d}×${c.p}${c.lh ? ' LH' : ''}`
      expect(k.isClosedSolid(threaded.shape), label).toBe(true)
      // Something cut, and no more than the band between the diameters.
      const lost = k.volume(body) - k.volume(threaded.shape)
      const band = Math.PI * ((c.d / 2 + c.offset) ** 2 - (minor - c.offset) ** 2) * c.length
      expect(lost, label).toBeGreaterThan(0.2 * band)
      expect(lost, label).toBeLessThan(band)
      k.release(disc, body, threaded.shape)
      await tick()
    }
  })

  it('cuts a boss wider than the thread down to it, and builds one too thin up to it', async () => {
    const { k, body } = await bar(10, 20)
    const wide = k.threadTracked(body, roundFace(k, body, 10), cut(16, 2))
    expect(k.isClosedSolid(wide.shape)).toBe(true)
    expect(wide.note).toMatch(/The boss is Ø20 mm, wider than the thread's Ø16 mm/)
    expect(k.bounds(wide.shape).max[0]).toBeLessThan(8 + 1e-4)
    // Ø12, inside even the root: built up to Ø16 and threaded.
    const thin = await bar(6, 20)
    const t = cut(16, 2)
    const built = k.threadTracked(thin.body, roundFace(k, thin.body, 6), t)
    expect(k.isClosedSolid(built.shape)).toBe(true)
    expect(built.note).toMatch(/The boss is Ø12 mm, under the thread's Ø16 mm: it is built up to it along the thread/)
    const tooth = toothOutline(t, false, 0.5)
    const want = Math.PI * tooth.root ** 2 * 20 + teethVolume(tooth.points, tooth.root, 8, 2, 20)
    expect(Math.abs(k.volume(built.shape) - want) / want).toBeLessThan(1e-4)
    expect(k.bounds(built.shape).max[0]).toBeGreaterThan(7.9)
    k.release(body, wide.shape, thin.body, built.shape)
  })
})

describe('a thread on a face drawn another size', () => {
  /** A Ø30 block `height` thick, a bore of radius `r` through it up Z. */
  async function plate(r: number, height: number): Promise<{ k: ReKernel; body: Shape }> {
    const k = await kernelPromise
    const section = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 15 }], holes: [[{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: r }]] })
    const body = k.extrude(section, [0, 0, 1], 0, height)
    k.release(section)
    return { k, body }
  }
  /** What a nut's thread `length` long changes a bore of radius `r` by:
   *  the teeth between the crest and the root come, what stood between the
   *  bore and the root goes — or, a bore past the root, what lay between
   *  them comes too. */
  const nutChange = (t: ThreadSpec, r: number, length: number) => {
    const tooth = toothOutline(t, true, 0.5)
    return teethVolume(tooth.points, tooth.crest, tooth.root, t.pitch, length) - Math.PI * (tooth.root ** 2 - r ** 2) * length
  }
  /** Whether a ring of 8 points at radius `r`, height `z` is all in the
   *  shape, none of it, or some. */
  const ring = (k: ReKernel, shape: Shape, r: number, z: number): 'all' | 'none' | 'some' => {
    const inside = Array.from({ length: 8 }, (_, i) => k.containsPoint(shape, [r * Math.cos((i * Math.PI) / 4 + 0.1), r * Math.sin((i * Math.PI) / 4 + 0.1), z]))
    return inside.every(Boolean) ? 'all' : inside.some(Boolean) ? 'some' : 'none'
  }

  it('fills a Ø5 bore in to the thread and cuts M5, M4 or M6 in it', async () => {
    const { k, body } = await plate(2.5, 10)
    const face = roundFace(k, body, 2.5)
    const before = k.volume(body)
    for (const [d, p, note] of [
      [5, 0.8, /The bore is Ø5 mm, wider than the thread's minor Ø4\.134 mm: it is filled in to it along the thread/],
      [4, 0.7, /filled in to it along the thread/],
      [6, 1, null],
    ] as const) {
      const t = cut(d, p)
      const threaded = k.threadTracked(body, face, t)
      expect(k.isClosedSolid(threaded.shape), `M${d}`).toBe(true)
      if (note) expect(threaded.note, `M${d}`).toMatch(note)
      else expect(threaded.note, `M${d}`).toBeUndefined()
      const want = before + nutChange(t, 2.5, 10)
      expect(Math.abs(k.volume(threaded.shape) - want) / before, `M${d}`).toBeLessThan(1e-5)
      // The crests at the thread's minor diameter: just outside it the
      // teeth, just inside it nothing.
      const crest = minorDiameter(d, p, 'metric') / 2
      expect(ring(k, threaded.shape, crest + 0.03, 5), `M${d}`).toBe('some')
      expect(ring(k, threaded.shape, crest - 0.03, 5), `M${d}`).toBe('none')
      k.release(threaded.shape)
      await tick()
    }
    k.release(body)
  })

  it('fills the bore only along the thread, leaving the rest as drawn', async () => {
    const { k, body } = await plate(2.5, 20)
    const face = roundFace(k, body, 2.5)
    const before = k.volume(body)
    // M5's root is the bore; M4's stands inside it, so the band runs out
    // past the fill's end into the open bore.
    for (const t of [cut(5, 0.8, { length: 8 }), cut(4, 0.7, { length: 8 }), cut(5, 0.8, { length: 8, flip: true, start: 2 })]) {
      const label = `M${t.diameter}${t.flip ? ' flipped' : ''}`
      const threaded = k.threadTracked(body, face, t)
      expect(k.isClosedSolid(threaded.shape), label).toBe(true)
      const want = before + nutChange(t, 2.5, 8)
      expect(Math.abs(k.volume(threaded.shape) - want) / before, label).toBeLessThan(1e-5)
      const [threadZ, plainZ] = t.flip ? [6, 15] : [16, 6]
      const tooth = toothOutline(t, true, 0)
      expect(ring(k, threaded.shape, (tooth.crest + tooth.root) / 2, threadZ), label).toBe('some')
      if (tooth.root < 2.4) expect(ring(k, threaded.shape, (tooth.root + 2.5) / 2, threadZ), label).toBe('all')
      expect(ring(k, threaded.shape, 2.3, plainZ), label).toBe('none')
      expect(ring(k, threaded.shape, 2.55, plainZ), label).toBe('all')
      k.release(threaded.shape)
      await tick()
    }
    k.release(body)
  })

  it('keeps the fill to the body where a bore comes out of a curved wall', async () => {
    // A Ø5 bore drilled across the wall of a tube up Z, outside R16.8,
    // inside R13.6: both its ends are saddles, not square to it.
    const k = await kernelPromise
    const circle = (center: [number, number, number], normal: [number, number, number], radius: number) => ({ kind: 'circle' as const, center, normal, radius })
    const section = k.face({ outer: [circle([0, 0, 0], [0, 0, 1], 16.8)], holes: [[circle([0, 0, 0], [0, 0, 1], 13.6)]] })
    const tube = k.extrude(section, [0, 0, 1], 0, 20)
    const disc = k.face({ outer: [circle([0, 0, 10], [1, 0, 0], 2.5)], holes: [] })
    const drill = k.extrude(disc, [1, 0, 0], 10, 20)
    const body = k.cut(tube, drill)
    const threaded = k.threadTracked(body, roundFace(k, body, 2.5), cut(5, 0.8))
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    expect(threaded.note).toMatch(/filled in to it along the thread/)
    // What the thread added lies in the bore, none of it past the wall.
    const added = k.cut(threaded.shape, body)
    expect(k.volume(added)).toBeGreaterThan(1)
    const stray = k.cut(added, tube)
    expect(k.volume(stray)).toBeLessThan(1e-6)
    k.release(section, tube, disc, drill, body, threaded.shape, added, stray)
  })

  it('leaves a boss with a slanted end as drawn rather than build it up past the end', async () => {
    // A pin, its tip cut off at 30°: an M5 would build it up, out past the
    // slant.
    const k = await kernelPromise
    const wedge = k.face({ outer: polygonLoop([[-5, -5, 12], [5, -5, 14.5], [5, -5, 20], [-5, -5, 20]]), holes: [] })
    const tool = k.extrude(wedge, [0, 1, 0], 0, 10)
    // Ø4.6, between M5's minor and major: cut as drawn, the crests on it.
    const { body: pin } = await bar(2.3, 15)
    const body = k.cut(pin, tool)
    const threaded = k.threadTracked(body, roundFace(k, body, 2.3), cut(5, 0.8))
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    expect(threaded.note).toMatch(/The boss is Ø4\.6 mm, not the thread's Ø5 mm, and it does not run between square ends: it is left as drawn/)
    const added = k.cut(threaded.shape, body)
    expect(k.volume(added)).toBeLessThan(1e-6)
    expect(k.volume(threaded.shape)).toBeLessThan(k.volume(body) - 1)
    // Ø4, under M5's minor: nothing of the thread would be cut, refused.
    const { body: thin } = await bar(2, 15)
    const short = k.cut(thin, tool)
    expect(() => k.threadTracked(short, roundFace(k, short, 2), cut(5, 0.8))).toThrow(/the boss is Ø4 mm, under the thread's minor Ø4\.134 mm, and it does not run between square ends, so it cannot be built up to the thread/)
    k.release(wedge, tool, pin, body, threaded.shape, added, thin, short)
  })

  it('keeps the wall past a short thread whole under an offset, and fills past pointed crests', async () => {
    const { k, body } = await plate(2.5, 20)
    const face = roundFace(k, body, 2.5)
    // The offset takes the root out past the bore: the wall beyond the
    // thread's end is not cut.
    const loose = k.threadTracked(body, face, cut(5, 0.8, { length: 8, offset: 0.05 }))
    expect(k.isClosedSolid(loose.shape)).toBe(true)
    expect(ring(k, loose.shape, 2.52, 11.9)).toBe('all')
    expect(ring(k, loose.shape, 2.52, 13)).toBe('some')
    k.release(loose.shape)
    await tick()
    // Near the offset's limit, the fill follows the crests out.
    const t = cut(5, 0.8, { offset: 0.16 })
    const deep = k.threadTracked(body, face, t)
    expect(k.isClosedSolid(deep.shape)).toBe(true)
    expect(Math.abs(k.volume(deep.shape) - (k.volume(body) + nutChange(t, 2.5, 20))) / k.volume(body)).toBeLessThan(1e-5)
    k.release(body, deep.shape)
    await tick()
    // At 0.12 mm a bolt's 60° crests are points: a Ø4 pin is built up a
    // quarter pitch past them, and the cut takes that off.
    const pin = await bar(2, 15)
    const bolt = cut(5, 0.8, { offset: 0.12 })
    const sharp = k.threadTracked(pin.body, roundFace(k, pin.body, 2), bolt)
    expect(k.isClosedSolid(sharp.shape)).toBe(true)
    expect(sharp.note).toMatch(/built up to it along the thread\. At this offset the crests come to a point/)
    const tooth = toothOutline(bolt, false, 0.5)
    const want = Math.PI * tooth.root ** 2 * 15 + teethVolume(tooth.points, tooth.root, tooth.crest, 0.8, 15)
    expect(Math.abs(k.volume(sharp.shape) - want) / want).toBeLessThan(1e-4)
    k.release(body, pin.body, sharp.shape)
  })

  it('countersinks a filled bore at both mouths', async () => {
    const { k, body } = await plate(2.5, 10)
    const face = roundFace(k, body, 2.5)
    for (const t of [cut(5, 0.8, { chamfer: true }), cut(4, 0.7, { chamfer: true })]) {
      const threaded = k.threadTracked(body, face, t)
      expect(k.isClosedSolid(threaded.shape), `M${t.diameter}`).toBe(true)
      // On each end face, nothing inside the countersink's radius; a fill
      // wider than it stands round it.
      const rc = chamferRadius(t, true)
      for (const z of [0.02, 9.98]) {
        expect(ring(k, threaded.shape, rc - 0.08, z), `M${t.diameter} at z ${z}`).toBe('none')
        expect(ring(k, threaded.shape, Math.max(rc, 2.5) + 0.1, z), `M${t.diameter} at z ${z}`).toBe('all')
      }
      if (rc < 2.4) expect(ring(k, threaded.shape, (rc + 2.5) / 2, 0.02), `M${t.diameter}`).toBe('all')
      k.release(threaded.shape)
      await tick()
    }
    k.release(body)
  })

  it('builds a Ø4 pin up to an M5 along part of its length', async () => {
    const { k, body } = await bar(2, 15)
    const t = cut(5, 0.8, { length: 8, chamfer: true })
    const threaded = k.threadTracked(body, roundFace(k, body, 2), t)
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    expect(threaded.note).toMatch(/built up to it along the thread/)
    expect(ring(k, threaded.shape, 2.3, 11)).toBe('some')
    expect(ring(k, threaded.shape, 2.1, 4)).toBe('none')
    expect(ring(k, threaded.shape, 1.9, 4)).toBe('all')
    // The tip chamfered, inside the root at the end face.
    expect(ring(k, threaded.shape, chamferRadius(t, false) + 0.08, 14.98)).toBe('none')
    k.release(body, threaded.shape)
  })
})

describe('a thread’s chamfer', () => {
  /** Whether the shape holds the point at radius `r`, height `z`, at every
   *  one of 8 angles round the axis — or at none of them. */
  const ring = (k: ReKernel, shape: Shape, r: number, z: number): 'all' | 'none' | 'some' => {
    const inside = Array.from({ length: 8 }, (_, i) => k.containsPoint(shape, [r * Math.cos((i * Math.PI) / 4), r * Math.sin((i * Math.PI) / 4), z]))
    return inside.every(Boolean) ? 'all' : inside.some(Boolean) ? 'some' : 'none'
  }
  /** The volume a triangle in (r, s) between the 45° cone through `rc` on
   *  the end face and the radius `to` fills turned about the axis. */
  const coneRing = (rc: number, to: number) => (Math.abs(to - rc) ** 2 / 2) * 2 * Math.PI * ((rc + 2 * to) / 3)

  it('chamfers a bolt at both free ends, at 45° from just inside the root, the thread between untouched', async () => {
    const { k, body } = await bar(8, 30)
    const face = roundFace(k, body, 8)
    const t = cut(16, 2)
    const plain = k.threadTracked(body, face, t)
    await tick()
    const chamfered = k.threadTracked(body, face, { ...t, chamfer: true })
    await tick()
    expect(k.isClosedSolid(chamfered.shape)).toBe(true)
    const rc = chamferRadius(t, false)
    const root = toothOutline(t, false, 0).root
    expect(rc).toBeCloseTo(root - 0.2, 9)
    // The ends are where they were; on each end face nothing of the thread
    // is left past the chamfer's radius, and the core is whole inside it.
    const b = k.bounds(chamfered.shape)
    expect(b.min[2]).toBeCloseTo(0, 6)
    expect(b.max[2]).toBeCloseTo(30, 6)
    for (const z of [0.02, 29.98]) {
      expect(ring(k, chamfered.shape, rc + 0.08, z), `past the chamfer at z ${z}`).toBe('none')
      expect(ring(k, chamfered.shape, rc - 0.05, z), `inside it at z ${z}`).toBe('all')
      expect(ring(k, plain.shape, rc + 0.6, z), `the plain thread at z ${z}`).not.toBe('none')
      await tick()
    }
    // Half a millimetre in, the cone is half a millimetre further out.
    expect(ring(k, chamfered.shape, rc + 0.58, 0.5)).toBe('none')
    expect(ring(k, chamfered.shape, rc + 0.58, 29.5)).toBe('none')
    await tick()
    // In the middle, the thread is the plain one's.
    for (let i = 0; i < 8; i++) {
      const p: [number, number, number] = [7.5 * Math.cos(i * 0.8), 7.5 * Math.sin(i * 0.8), 12 + i * 0.73]
      expect(k.containsPoint(chamfered.shape, p)).toBe(k.containsPoint(plain.shape, p))
    }
    // What the chamfers took: at least the core they cut into, at most the
    // whole ring out to the crests, at each end.
    const lost = k.volume(plain.shape) - k.volume(chamfered.shape)
    expect(lost).toBeGreaterThan(2 * coneRing(rc, root))
    expect(lost).toBeLessThan(2 * coneRing(rc, 8))
    k.release(body, plain.shape, chamfered.shape)
  })

  it('chamfers a bolt’s tip and leaves its head’s shoulder whole', async () => {
    const k = await kernelPromise
    const pin = await bar(8, 20)
    const disc = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 12 }], holes: [] })
    const head = k.extrude(disc, [0, 0, 1], 20, 30)
    const body = k.fuse(pin.body, head)
    const t = cut(16, 2, { chamfer: true })
    const threaded = k.threadTracked(body, roundFace(k, body, 8), t)
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    const rc = chamferRadius(t, false)
    expect(ring(k, threaded.shape, rc + 0.08, 0.02)).toBe('none')
    // Against the shoulder the thread runs on at full depth: the crests are
    // there, and the head is solid out to its rim just above.
    expect(ring(k, threaded.shape, 7.9, 19.9)).toBe('some')
    expect(ring(k, threaded.shape, 9.5, 20.05)).toBe('all')
    k.release(disc, head, body, pin.body, threaded.shape)
  })

  it('countersinks a nut’s bore at both mouths, out past the major diameter', async () => {
    const k = await kernelPromise
    const minor = minorDiameter(16, 2, 'metric') / 2
    const block = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 15 }], holes: [[{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: minor }]] })
    const body = k.extrude(block, [0, 0, 1], 0, 12)
    k.release(block)
    const t = cut(16, 2, { chamfer: true })
    const threaded = k.threadTracked(body, roundFace(k, body, minor), t)
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    const rc = chamferRadius(t, true)
    expect(rc).toBeCloseTo(8.2, 9)
    for (const z of [0.02, 11.98]) {
      expect(ring(k, threaded.shape, minor + 0.1, z), `the mouth at z ${z}`).toBe('none')
      expect(ring(k, threaded.shape, rc - 0.08, z), `out to the countersink at z ${z}`).toBe('none')
      expect(ring(k, threaded.shape, rc + 0.05, z), `the block past it at z ${z}`).toBe('all')
    }
    expect(ring(k, threaded.shape, rc - 0.58, 0.5)).toBe('none')
    // Halfway through, the nut's teeth are there.
    expect(ring(k, threaded.shape, minor + 0.1, 6)).toBe('some')
    k.release(body, threaded.shape)
    await tick()
    // A plate 3 mm thick — a turn and a half — takes both, the thread
    // between them.
    const thin = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 15 }], holes: [[{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: minor }]] })
    const plate = k.extrude(thin, [0, 0, 1], 0, 3)
    k.release(thin)
    const nut = k.threadTracked(plate, roundFace(k, plate, minor), t)
    expect(k.isClosedSolid(nut.shape)).toBe(true)
    expect(ring(k, nut.shape, minor + 0.1, 1.5)).toBe('some')
    expect(ring(k, nut.shape, rc - 0.08, 2.98)).toBe('none')
    k.release(plate, nut.shape)
  })

  it('chamfers a fine left-hand thread with an offset', async () => {
    const { k, body } = await bar(1.5, 12)
    const t = cut(3, 0.5, { leftHanded: true, offset: 0.05, chamfer: true })
    const threaded = k.threadTracked(body, roundFace(k, body, 1.5), t)
    expect(k.isClosedSolid(threaded.shape)).toBe(true)
    expect(ring(k, threaded.shape, chamferRadius(t, false) + 0.03, 11.99)).toBe('none')
    k.release(body, threaded.shape)
  })

  it('refuses a chamfer where the thread does not come out of the body free', async () => {
    const { k, body } = await bar(8, 30)
    const face = roundFace(k, body, 8)
    expect(() => k.threadTracked(body, face, cut(16, 2, { length: 10, start: 5, chamfer: true }))).toThrow(/no end to chamfer/)
    const short = await bar(8, 1.5)
    expect(() => k.threadTracked(short.body, roundFace(k, short.body, 8), cut(16, 2, { chamfer: true }))).toThrow(/too short for a chamfer at each end/)
    k.release(body, short.body)
  })
})

describe('the Thread feature', () => {
  /** A Ø16 bar 30 long, built, and a thread feature on its round face. */
  async function threadedBar(thread: Partial<ThreadFeature>) {
    const k = await kernelPromise
    const sketch = emptySketch()
    addEntity(sketch, { kind: 'circle', c: [0, 0], r: 8 })
    const s: SketchFeature = { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
    const bar: Feature = { id: 2, kind: 'extrude', name: 'Bar', sketchId: 1, regions: findRegions(sketch).map((r) => r.key), extent: { kind: 'distance', from: 0, to: 30 }, op: 'new', visible: true }
    const sketches = new Map<number, Sketch>([[1, sketch]])
    const first = new Builder(k)
    const plain = first.build(resolveFeatures([s, bar], ctx, (f) => findRegions(f.sketch)), (id) => sketches.get(id))
    const face = plain.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'cylinder')!.fingerprint
    first.dispose()
    const feature: ThreadFeature = { id: 3, kind: 'thread', name: 'Thread 1', body: 2, face, standard: 'metric', diameter: 16, pitch: 2, leftHanded: false, length: null, start: 0, flip: false, offset: 0, visible: true, ...thread }
    const builder = new Builder(k)
    const steps = resolveFeatures([s, bar, feature], ctx, (f) => findRegions(f.sketch))
    return { result: builder.build(steps, (id) => sketches.get(id)), builder, steps, k }
  }

  it('builds on the body’s round face, by its fingerprint', async () => {
    const { result, builder } = await threadedBar({})
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(result.bodies).toHaveLength(1)
    expect(result.bodies[0].closed).toBe(true)
    const tooth = toothOutline(cut(16, 2), false, 0.5)
    const want = Math.PI * tooth.root ** 2 * 30 + teethVolume(tooth.points, tooth.root, 8, 2, 30)
    expect(Math.abs(result.bodies[0].volume - want) / want).toBeLessThan(1e-4)
    builder.dispose()
  })

  it('cuts the form of its standard: the printing one’s tooth, carried through the build to the kernel', async () => {
    const { result, builder } = await threadedBar({ standard: 'print45', diameter: 16, pitch: 3.5 })
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(result.bodies[0].closed).toBe(true)
    const tooth = toothOutline(cut(16, 3.5, { standard: 'print45' }), false, 0.5)
    const want = Math.PI * tooth.root ** 2 * 30 + teethVolume(tooth.points, tooth.root, 8, 3.5, 30)
    expect(Math.abs(result.bodies[0].volume - want) / want).toBeLessThan(1e-4)
    builder.dispose()
  })

  it('previews the body as the thread leaves it', async () => {
    const { builder, steps } = await threadedBar({})
    const step = steps.find((x) => x.kind === 'thread')!
    if (step.kind !== 'thread') throw new Error('no thread step')
    const shown = builder.preview(step, undefined)
    expect(shown.closed).toBe(true)
    expect(shown.edges).toBe(true)
    builder.dispose()
  })

  it('fails with the reason: an offset too large, a face that is not round, a length past the face', async () => {
    const big = await threadedBar({ offset: 0.6 })
    expect(big.result.results[1].status).toBe('failed')
    expect(big.result.results[1].message).toMatch(/no thickness at the pitch diameter/)
    big.builder.dispose()
    const long = await threadedBar({ length: 40, start: 0 })
    expect(long.result.results[1].status).toBe('failed')
    expect(long.result.results[1].message).toMatch(/runs past the end of the face/)
    long.builder.dispose()
    const flat = resolveFeatures(
      [{ id: 3, kind: 'thread', name: 'Thread 1', body: 2, face: { kind: 'plane', centroid: [0, 0, 30], dir: [0, 0, 1], area: 200, origin: 2 }, standard: 'metric', diameter: 16, pitch: 2, leftHanded: false, length: null, start: 0, flip: false, offset: 0, visible: true }],
      ctx,
      () => [],
    )
    expect(flat[0]).toMatchObject({ kind: 'failed', message: expect.stringMatching(/round face/) })
  })

  it('chamfers the free ends when asked, and fails saying why where there are none', async () => {
    const plain = await threadedBar({})
    const chamfered = await threadedBar({ chamfer: true })
    expect(chamfered.result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(chamfered.result.bodies[0].closed).toBe(true)
    expect(chamfered.result.bodies[0].volume).toBeLessThan(plain.result.bodies[0].volume - 1)
    plain.builder.dispose()
    chamfered.builder.dispose()
    // A thread saved before the chamfer was offered builds without one.
    const step = resolveFeatures([{ id: 3, kind: 'thread', name: 'Thread 1', body: 2, face: { kind: 'cylinder', centroid: [0, 0, 15], dir: [0, 0, 1], area: 1508, radius: 8, center: [0, 0, 15], origin: 2 }, standard: 'metric', diameter: 16, pitch: 2, leftHanded: false, length: null, start: 0, flip: false, offset: 0, visible: true }], ctx, () => [])[0]
    expect(step).toMatchObject({ kind: 'thread', chamfer: false })
    await tick()
    const inside = await threadedBar({ chamfer: true, length: 10, start: 5 })
    expect(inside.result.results[1].status).toBe('failed')
    expect(inside.result.results[1].message).toMatch(/no end to chamfer/)
    inside.builder.dispose()
  })
})

describe('the Thread box', () => {
  const round = (hash: number, radius: number): FaceInfo => ({ hash, fingerprint: { kind: 'cylinder', centroid: [0, 0, 15], dir: [0, 0, 1], area: 2 * Math.PI * radius * 30, radius, center: [0, 0, 15], origin: 2 } })

  beforeEach(() => {
    useReverse.getState().reset()
    useReverse.setState({ bodies: [{ id: 2, name: 'Extrude 1', visible: true, volume: 1, faces: 3, closed: true, triangles: 12 }], nextFeatureId: 3, nextOfKind: {} })
  })

  it('takes a round face and no other, the whole face long to start, and is ready once it has one', () => {
    useReverse.getState().startFeature('thread')
    let d = useReverse.getState().featureDraft!
    expect(d.kind === 'thread' && d.body === 2 && d.face === null && d.fullLength && d.standard === 'metric').toBe(true)
    expect(featureDraftReady(d)).toBe(false)
    useReverse.getState().toggleDraftFace(2, { hash: 3, fingerprint: { kind: 'plane', centroid: [0, 0, 30], dir: [0, 0, 1], area: 200, origin: 2 } })
    expect((useReverse.getState().featureDraft as { face: unknown }).face).toBeNull()
    // A fillet's quarter of a cylinder is round, but not the whole way.
    useReverse.getState().toggleDraftFace(2, { ...round(5, 2), fullTurn: false })
    expect((useReverse.getState().featureDraft as { face: unknown }).face).toBeNull()
    useReverse.getState().toggleDraftFace(2, round(4, 8))
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'thread' && d.face?.hash === 4 && d.internal === null && d.length === 30).toBe(true)
    expect(featureDraftReady(d)).toBe(true)
    useReverse.getState().clearDraftPicks()
    expect((useReverse.getState().featureDraft as { face: unknown }).face).toBeNull()
  })

  it('is not ready with an offset past what the pitch takes, or a length of nothing', () => {
    useReverse.getState().startFeature('thread', { face: round(4, 8), diameter: 16, pitch: 2 })
    useReverse.getState().setFeatureDraft({ offset: 0.5 })
    expect(featureDraftReady(useReverse.getState().featureDraft!)).toBe(false)
    useReverse.getState().setFeatureDraft({ offset: 0.2, fullLength: false, length: 0 })
    expect(featureDraftReady(useReverse.getState().featureDraft!)).toBe(false)
    useReverse.getState().setFeatureDraft({ length: 12 })
    expect(featureDraftReady(useReverse.getState().featureDraft!)).toBe(true)
  })

  it('commits a Thread carrying the face’s fingerprint, named in order, and reopens it as it was', () => {
    useReverse.getState().startFeature('thread', { face: round(4, 8), diameter: 16, pitch: 1.5, leftHanded: true, fullLength: false, length: 12, start: 3, flip: true, offset: 0.15, chamfer: true, sized: true })
    expect(useReverse.getState().commitFeature()).toBe(3)
    const f = useReverse.getState().features.find((x) => x.id === 3)!
    expect(f).toMatchObject({ kind: 'thread', name: 'Thread 1', body: 2, standard: 'metric', diameter: 16, pitch: 1.5, leftHanded: true, length: 12, start: 3, flip: true, offset: 0.15, chamfer: true })
    expect(f.kind === 'thread' && f.face.kind).toBe('cylinder')
    useReverse.getState().editFeature(3)
    const d = useReverse.getState().featureDraft!
    expect(d).toMatchObject({ kind: 'thread', featureId: 3, fullLength: false, length: 12, start: 3, flip: true, offset: 0.15, chamfer: true, sized: true })
    expect(d.kind === 'thread' && d.face?.hash).toBe(-1)
    // The whole face long, the feature holds no length.
    useReverse.getState().setFeatureDraft({ fullLength: true })
    useReverse.getState().commitFeature()
    expect(useReverse.getState().features.find((x) => x.id === 3)).toMatchObject({ length: null, start: 0 })
  })

  it('tells a boss from a bore by the way the face’s triangles look', async () => {
    const k = await kernelPromise
    const minor = minorDiameter(16, 2, 'metric') / 2
    const block = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 15 }], holes: [[{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: minor }]] })
    const body = k.extrude(block, [0, 0, 1], 0, 12)
    const mesh = k.mesh(body, 0.05)
    const faces = k.faces(body)
    const outside = faces.find((f) => f.kind === 'cylinder' && Math.abs((f.radius ?? 0) - 15) < 1e-6)!
    const bore = faces.find((f) => f.kind === 'cylinder' && Math.abs((f.radius ?? 0) - minor) < 1e-6)!
    expect(roundFaceIsBoss(mesh, outside.hash, outside.center!, outside.dir)).toBe(true)
    expect(roundFaceIsBoss(mesh, bore.hash, bore.center!, bore.dir)).toBe(false)
    expect(roundFaceIsBoss(mesh, 12345, bore.center!, bore.dir)).toBeNull()
    k.release(block, body)
  })
})
