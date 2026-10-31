// SPDX-License-Identifier: AGPL-3.0-only
// accept stays local (round 11, K4). A fan wheel's dish profile cut at a
// slant: a long, near-flat underside arc between an inner wall and a rim,
// and pieces about it that touch none of them — a pad's floor just under
// the arc, a lip as round as a corner far off, two lines near 60° with a
// gap between. On the run, accept took a tangent, an equal radius and an
// angle between such pieces, and the solve dragged one 2.3 mm off its
// points; the flat arc's centre went 77 mm while its curve hardly moved.
// Here: those relations are not offered, a trial that moves a piece past
// maxMoveMm is taken back (why "moved"), and an arc's move is read on its
// curve.
import { describe, expect, it } from 'vitest'
import { acceptCandidates, fitScatter, MOVE_SCATTERS } from '../core/accept'
import { candidatesOf, type Candidate } from '../core/intent'
import { retakeMoved } from '../core/project'
import { addConstraint, addEntity, arcThrough, cloneSketch, emptySketch, entityOf, type Sketch, type SketchArc } from '../core/sketch'
import { solveSketch } from '../core/solver'

type Vec2 = [number, number]

/** Deterministic noise in ±half. */
function noise(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296 - 0.5
  }
}

function linePoints(a: Vec2, b: Vec2, n: number, spread: number, seed: number): Vec2[] {
  const rand = noise(seed)
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const L = Math.hypot(dx, dy)
  return Array.from({ length: n }, (_, i): Vec2 => {
    const t = i / (n - 1)
    const e = rand() * 2 * spread
    return [a[0] + dx * t - (dy / L) * e, a[1] + dy * t + (dx / L) * e]
  })
}

function arcPoints(c: Vec2, r: number, start: number, sweep: number, n: number, spread: number, seed: number): Vec2[] {
  const rand = noise(seed)
  return Array.from({ length: n }, (_, i): Vec2 => {
    const t = start + (sweep * i) / (n - 1)
    const rr = r + rand() * 2 * spread
    return [c[0] + rr * Math.cos(t), c[1] + rr * Math.sin(t)]
  })
}

const SCATTER = 0.02
const line = (sk: Sketch, a: Vec2, b: Vec2, seed: number, n = 40, spread = SCATTER) => addEntity(sk, { kind: 'line', a, b, points: linePoints(a, b, n, spread, seed), scatter: spread })
const arc = (sk: Sketch, c: Vec2, r: number, start: number, sweep: number, seed: number, n = 40) =>
  addEntity(sk, { kind: 'arc', c, r, start, sweep, points: arcPoints(c, r, start, sweep, n, SCATTER, seed), scatter: SCATTER })
const join = (sk: Sketch, p: number, pa: 'a' | 'b', q: number, qa: 'a' | 'b') => addConstraint(sk, { kind: 'coincident', p: { entity: p, at: pa }, q: { entity: q, at: qa } })
const find = (cs: readonly Candidate[], kind: Candidate['kind'], ...pieces: number[]) => cs.find((c) => c.kind === kind && pieces.every((p) => c.pieces.includes(p)))

/** The dish half-profile in [r, z]: an inner wall at r 10, the underside a
 *  R300 arc from (10, 0) to (50, 0) sagging 0.67 mm, a rim at r 50 and a
 *  top sloping back to the wall, joined end to end. */
function dish() {
  const sk = emptySketch()
  const R = 300
  const c: Vec2 = [30, Math.sqrt(R * R - 20 * 20)]
  const start = Math.atan2(-c[1], -20)
  const sweep = Math.atan2(-c[1], 20) - start
  const wall = line(sk, [10, 8], [10, 0], 1)
  const under = arc(sk, c, R, start, sweep, 2, 80)
  const rim = line(sk, [50, 0], [50, 10], 3)
  const top = line(sk, [50, 10], [10, 8], 4)
  join(sk, wall, 'b', under, 'a')
  join(sk, under, 'b', rim, 'a')
  join(sk, rim, 'b', top, 'a')
  join(sk, top, 'b', wall, 'a')
  return { sk, wall, under, rim, top }
}

describe('accept stays local', () => {
  it('offers no tangent, equal radius or angle between pieces that do not touch', () => {
    const { sk, wall, under, top } = dish()
    // A pad's floor just under the flat arc's middle: its carrier grazes
    // the arc's circle, its ends nowhere near the arc's.
    const pad = line(sk, [25, -0.9], [35, -0.9], 5, 30)
    // A lip round at the rim and a corner as round far off.
    const lip = arc(sk, [60, 12], 1, 0, Math.PI / 2, 6, 20)
    const corner = arc(sk, [0, -5], 1.02, Math.PI, Math.PI / 2, 7, 20)
    // Two lines near 60° with a 2 mm gap between their ends.
    const t = (60.3 * Math.PI) / 180
    const flat = line(sk, [70, 0], [80, 0], 8)
    const leaning = line(sk, [82, 1], [82 + 5 * Math.cos(t), 1 + 5 * Math.sin(t)], 9)
    const cs = candidatesOf(sk.entities, [], undefined, sk.constraints, 400)
    expect(find(cs, 'tangent', pad, under)).toBeUndefined()
    expect(find(cs, 'equal', lip, corner)).toBeUndefined()
    expect(find(cs, 'angle', flat, leaning)).toBeUndefined()
    // Each is within the net all the same — the floor 0.23 mm off touching
    // the arc's circle, the radii 0.02 apart, the angle 0.3° off 60 — and
    // so was offered, and taken, before.
    const u = entityOf(sk, under) as SketchArc
    expect(Math.abs(Math.abs(-0.9 - u.c[1]) - u.r)).toBeLessThan(1)
    // Nothing offered relates the wall to a piece it does not meet.
    for (const c of cs) if (c.kind === 'tangent' || c.kind === 'angle') expect(c.pieces.includes(wall) ? c.pieces.every((p) => [wall, under, top].includes(p)) : true).toBe(true)
    // Brought within a few scatters, the pair is offered again.
    const near = emptySketch()
    const f2 = line(near, [70, 0], [80, 0], 8)
    const l2 = line(near, [80.03, 0], [80.03 + 5 * Math.cos(t), 5 * Math.sin(t)], 9)
    expect(find(candidatesOf(near.entities, []), 'angle', f2, l2)).toMatchObject({ nominal: 60 })
  })

  it('reads a near-flat arc’s move on its curve, not by its centre', () => {
    const { sk, under } = dish()
    const was = entityOf(sk, under) as SketchArc
    const at = (e: SketchArc, s: number): Vec2 => [e.c[0] + e.r * Math.cos(e.start + s * e.sweep), e.c[1] + e.r * Math.sin(e.start + s * e.sweep)]
    // The same ends, the middle 0.02 mm lower: the centre swings far.
    const mid = at(was, 0.5)
    const through = arcThrough(at(was, 0), at(was, 1), [mid[0], mid[1] - 0.02])!
    const now: SketchArc = { ...was, c: through.c, r: through.r, start: through.start, sweep: through.sweep }
    expect(Math.hypot(now.c[0] - was.c[0], now.c[1] - was.c[1])).toBeGreaterThan(5)
    expect(retakeMoved(was, now)).toBeCloseTo(0.02, 6)
  })

  it('takes the profile’s relations without moving any piece past its fit', () => {
    const { sk } = dish()
    const pad = line(sk, [25, -0.9], [35, -0.9], 5, 30)
    solveSketch(sk)
    const before = cloneSketch(sk)
    const { accepted, left, maxMoveMm } = acceptCandidates(sk, [], { sigmas: 2 })
    expect(maxMoveMm).toBeCloseTo(MOVE_SCATTERS * fitScatter(before), 9)
    expect(maxMoveMm).toBeCloseTo(0.06, 9)
    expect(accepted.length).toBeGreaterThan(0)
    expect(accepted.some((a) => ['tangent', 'angle', 'equal'].includes(a.kind) && a.what !== 'length' && a.pieces.includes(pad))).toBe(false)
    expect(solveSketch(sk).ok).toBe(true)
    for (const e of sk.entities) expect(retakeMoved(entityOf(before, e.id)!, e)).toBeLessThanOrEqual(maxMoveMm + 1e-9)
    for (const l of left.filter((x) => x.why === 'moved')) expect(l.moves!.mm).toBeGreaterThan(maxMoveMm)
  })

  it('takes back a trial that moves a piece past maxMoveMm, with why "moved"', () => {
    // A side fitted a third of a degree off level among noisy points: level
    // within three sigmas, but made level it swings its ends some
    // hundredths.
    const make = () => {
      const sk = emptySketch()
      const side = line(sk, [0, 0], [20, 0.1], 11, 40, 0.1)
      const post = line(sk, [20, 0.1], [20, 10], 12, 40, 0.1)
      join(sk, side, 'b', post, 'a')
      solveSketch(sk)
      return { sk, side }
    }
    const loose = make()
    const taken = acceptCandidates(loose.sk, [], { sigmas: 3, kinds: ['horizontal'] })
    expect(taken.maxMoveMm).toBeCloseTo(0.3, 9)
    expect(taken.accepted.map((a) => a.pieces)).toContainEqual([loose.side])

    const tight = make()
    const was = cloneSketch(tight.sk)
    const refused = acceptCandidates(tight.sk, [], { sigmas: 3, kinds: ['horizontal'], maxMoveMm: 0.005 })
    expect(refused.maxMoveMm).toBe(0.005)
    const why = refused.left.find((l) => l.kind === 'horizontal' && l.pieces[0] === tight.side)!
    expect(why.why).toBe('moved')
    expect(why.moves!.mm).toBeGreaterThan(0.005)
    expect(refused.accepted.some((a) => a.pieces[0] === tight.side)).toBe(false)
    // Taken back: the sketch is as it was.
    expect(tight.sk.constraints).toEqual(was.constraints)
    expect(retakeMoved(entityOf(was, tight.side)!, entityOf(tight.sk, tight.side)!)).toBeLessThan(1e-5)
  })
})
