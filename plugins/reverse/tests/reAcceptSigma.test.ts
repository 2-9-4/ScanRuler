// SPDX-License-Identifier: AGPL-3.0-only
// accept's move limit from the fit's own sigma (round 17, T7). The Joy-Con's
// Path outline fitted with an rms of 0.017 while its chain's scatter — the
// point-to-point noise, from second differences — was 0.002: a moulded
// surface's waviness is not in the scatter. The limit was 3 × the scatter,
// floored at 0.01, so every tangent within two sigmas was refused for
// moving a piece some hundredths. Here: an outline like the Path's whose
// points stand 0.017 off its pieces, each join a little off tangent. By
// default its seven tangents are taken, the limit three of the pieces' own
// sigmas, and a move is read off the pieces' curves — a join sliding along
// them is not one. Held to 0.01 they are all left, and one note says how
// far they went and the limit that takes them. A real corner, whose
// tangent moves a piece a quarter of a millimetre off its points, is still
// refused.
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { acceptCandidates, fitScatter, offCurve } from '../core/accept'
import { pointSigma } from '../core/intent'
import { retakeMoved } from '../core/project'
import { addConstraint, addEntity, cloneSketch, emptySketch, entityOf, type Sketch } from '../core/sketch'
import { solveSketch } from '../core/solver'

type Vec2 = [number, number]

/** The scan's point-to-point scatter, as the fit's chain carries it. */
const SCATTER = 0.002
/** How far the points stand off their pieces, rms, mm — a moulded
 *  surface's waviness, which the scatter does not see. */
const RMS = 0.017
/** How far off tangent the outline's corners are, radians. */
const KINK = 0.05

/** Points along a piece, `at(t)` its place and `normal(t)` its outward
 *  normal for t in 0…1, off it by gaussian noise of RMS. */
function scanned(at: (t: number) => Vec2, normal: (t: number) => Vec2, n: number, seed: number): Vec2[] {
  const rand = mulberry32(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  return Array.from({ length: n }, (_, i): Vec2 => {
    const t = i / (n - 1)
    const p = at(t), q = normal(t)
    const d = gauss() * RMS
    return [p[0] + d * q[0], p[1] + d * q[1]]
  })
}

function line(sk: Sketch, a: Vec2, b: Vec2, seed: number, n = 80): number {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const nrm: Vec2 = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]
  const points = scanned((t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], () => nrm, n, seed)
  return addEntity(sk, { kind: 'line', a, b, points, scatter: SCATTER })
}

function arc(sk: Sketch, c: Vec2, r: number, start: number, sweep: number, seed: number, n = 60): number {
  const at = (t: number): Vec2 => [c[0] + r * Math.cos(start + sweep * t), c[1] + r * Math.sin(start + sweep * t)]
  const nrm = (t: number): Vec2 => [Math.cos(start + sweep * t), Math.sin(start + sweep * t)]
  return addEntity(sk, { kind: 'arc', c, r, start, sweep, points: scanned(at, nrm, n, seed), scatter: SCATTER })
}

const join = (sk: Sketch, p: number, pa: 'a' | 'b', q: number, qa: 'a' | 'b') => addConstraint(sk, { kind: 'coincident', p: { entity: p, at: pa }, q: { entity: q, at: qa } })

/** The pieces of an outline like the Path's: one side of a rounded
 *  housing, arcs of R16 to R60 and a straight run, bending one way. */
const PATH: ({ r: number; sweep: number } | { length: number })[] = [
  { r: 38, sweep: 0.5 },
  { r: 18, sweep: 0.6 },
  { r: 60, sweep: 0.3 },
  { r: 20, sweep: 0.5 },
  { length: 40 },
  { r: 50, sweep: 0.4 },
  { r: 16, sweep: 0.6 },
  { r: 45, sweep: 0.5 },
]

/** The outline laid end to end, each piece turned `kink` radians off the
 *  one before at their join, as a fit can leave them, and joined. */
function outline(kink: number) {
  const sk = emptySketch()
  let p: Vec2 = [0, 0]
  let heading = 0
  const ids: number[] = []
  PATH.forEach((piece, i) => {
    if (i > 0) heading += i % 2 === 0 ? kink : -kink
    if ('length' in piece) {
      const b: Vec2 = [p[0] + piece.length * Math.cos(heading), p[1] + piece.length * Math.sin(heading)]
      ids.push(line(sk, p, b, i + 1))
      p = b
      return
    }
    const c: Vec2 = [p[0] - piece.r * Math.sin(heading), p[1] + piece.r * Math.cos(heading)]
    const start = heading - Math.PI / 2
    ids.push(arc(sk, c, piece.r, start, piece.sweep, i + 1))
    p = [c[0] + piece.r * Math.cos(start + piece.sweep), c[1] + piece.r * Math.sin(start + piece.sweep)]
    heading += piece.sweep
  })
  for (let i = 1; i < ids.length; i++) join(sk, ids[i - 1], 'b', ids[i], 'a')
  solveSketch(sk)
  return { sk, ids }
}

describe('accept by the fit’s own sigma', () => {
  it('reads the pieces’ sigma well above the chain’s scatter', () => {
    const { sk } = outline(KINK)
    expect(fitScatter(sk)).toBeCloseTo(SCATTER, 9)
    for (const e of sk.entities) expect(pointSigma(e)!).toBeGreaterThan(0.012)
  })

  it('takes the tangents of a fit whose rms is well above its scatter', () => {
    const { sk } = outline(KINK)
    const before = cloneSketch(sk)
    const { accepted, left, maxMoveMm, note } = acceptCandidates(sk, [], { sigmas: 2, kinds: ['tangent'] })
    expect(accepted.filter((a) => a.kind === 'tangent')).toHaveLength(7)
    expect(left.filter((l) => l.kind === 'tangent')).toEqual([])
    expect(note).toBeUndefined()
    // The limit is three of the pieces' own sigmas, not of the scatter.
    expect(maxMoveMm).toBeGreaterThan(0.04)
    expect(maxMoveMm).toBeLessThan(0.07)
    let off = 0, along = 0
    for (const e of sk.entities) {
      const was = entityOf(before, e.id)!
      off = Math.max(off, offCurve(was, e))
      along = Math.max(along, retakeMoved(was, e))
    }
    expect(off).toBeGreaterThan(0.01)
    expect(off).toBeLessThanOrEqual(maxMoveMm + 1e-9)
    // The joins slid along the pieces further than that: not a move.
    expect(along).toBeGreaterThan(2 * maxMoveMm)
  })

  it('says how far a whole kind moved, and the limit that takes it', () => {
    const { sk } = outline(KINK)
    const { accepted, left, maxMoveMm, note } = acceptCandidates(sk, [], { sigmas: 2, kinds: ['tangent'], maxMoveMm: 0.01 })
    expect(maxMoveMm).toBe(0.01)
    expect(accepted).toEqual([])
    const moved = left.filter((l) => l.why === 'moved')
    expect(moved).toHaveLength(7)
    for (const l of moved) expect(l.moves!.limitMm).toBe(0.01)
    const mms = moved.map((l) => l.moves!.mm)
    const takes = Math.ceil(Math.max(...mms) * 100 + 1e-9) / 100
    expect(note).toBe(`all 7 tangents moved ${Math.min(...mms).toFixed(2)}–${Math.max(...mms).toFixed(2)} mm; \`maxMoveMm: ${takes}\` takes them — compare with T`)
    // And that limit does take them.
    expect(acceptCandidates(outline(KINK).sk, [], { sigmas: 2, kinds: ['tangent'], maxMoveMm: takes }).accepted).toHaveLength(7)
  })

  it('reads a join that slides along two arcs as no move', () => {
    // An R40 arc whose end ran 0.16 mm back along it, as a join made
    // tangent slides: by its ends that is a move, off its curve none.
    const sk = emptySketch()
    const first = arc(sk, [0, 40], 40, -Math.PI / 2, 0.5, 21)
    const was = cloneSketch(sk)
    const e = entityOf(sk, first)!
    const slid = { ...e, sweep: (e as { sweep: number }).sweep - 0.004 }
    expect(retakeMoved(entityOf(was, first)!, slid as typeof e)).toBeGreaterThan(0.1)
    expect(offCurve(entityOf(was, first)!, slid as typeof e)).toBeLessThan(1e-9)
  })

  it('still refuses a tangent that moves a piece 0.26 mm', () => {
    // A side and an R20 arc meeting at a real 14° corner: made tangent, the
    // pieces leave their points by about a quarter of a millimetre. Taken
    // at any sigmas, the move limit refuses it.
    const sk = emptySketch()
    const side = line(sk, [-30, 0], [0, 0], 11)
    const kink = 0.25
    const r = 20
    const c: Vec2 = [-r * Math.sin(kink), r * Math.cos(kink)]
    const bend = arc(sk, c, r, kink - Math.PI / 2, 0.8, 12)
    join(sk, side, 'b', bend, 'a')
    solveSketch(sk)
    const { accepted, left, note } = acceptCandidates(sk, [], { sigmas: 1000, kinds: ['tangent'] })
    const tangent = left.find((l) => l.kind === 'tangent')!
    expect(accepted).toEqual([])
    expect(tangent.why).toBe('moved')
    expect(tangent.moves!.mm).toBeGreaterThan(0.2)
    expect(tangent.moves!.limitMm).toBeLessThan(0.07)
    expect(note).toMatch(/^the one tangent moved 0\.\d\d mm; `maxMoveMm: 0\.\d\d?` takes it — compare with T$/)
  })
})
