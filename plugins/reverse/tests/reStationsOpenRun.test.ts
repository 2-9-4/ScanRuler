// SPDX-License-Identifier: AGPL-3.0-only
// A station on an open run, refused with the numbers it decided on: a
// closed square outline fitted whole as the template, and the scan's cut
// of it broken by three gaps — 3, 8 and 19 mm, a hole in the scan and two
// gaps between keys. closeGaps 3.5 bridges the first; the run left is open,
// and the refusal names its ends, the gap bridged and the two still open,
// the widest first. Then the same square cut whole, and a within that kept
// a run of it: that it was within that opened it. And a refusal of another
// kind on a bridged run names the bridges.

import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { joinChainEnds } from '../core/chainOutline'
import type { Sketch, SketchLine } from '../core/sketch'
import { gapsRound, likeStation, runFactsWords, type StationLoop, stationLoop } from '../core/stations'

/** The square 40 × 40, walked from (0, 0) along the bottom, up the right,
 *  back along the top and down the left: the point s mm along it. */
function along(s: number): Vec2 {
  const t = ((s % 160) + 160) % 160
  if (t <= 40) return [t, 0]
  if (t <= 80) return [40, t - 40]
  if (t <= 120) return [120 - t, 40]
  return [0, 160 - t]
}

/** The walk from s0 to s1, a point every half millimetre and both ends. */
function walk(s0: number, s1: number): Vec2[] {
  const out: Vec2[] = []
  for (let s = s0; s < s1; s += 0.5) out.push(along(s))
  out.push(along(s1))
  return out
}

/** The square cut with gaps along its straight sides: 3 mm from 10 on the
 *  bottom, 8 mm from 50 up the right, 19 mm from 90 along the top. */
const broken = () => [walk(13, 50), walk(58, 90), walk(109, 170)]

/** A closed square template of four fitted lines, run counter-clockwise. */
function template(): Sketch {
  const fitted = { points: [[0, 0]] as Vec2[] }
  const line = (id: number, a: Vec2, b: Vec2): SketchLine => ({ id, kind: 'line', a, b, ...fitted })
  return { entities: [line(1, [0, 0], [40, 0]), line(2, [40, 0], [40, 40]), line(3, [40, 40], [0, 40]), line(4, [0, 40], [0, 0])], constraints: [], nextId: 5 }
}

describe('the gaps round a run', () => {
  it('finds the three gaps of the square, those closeGaps bridged and those it left open, widest first', () => {
    expect(gapsRound(broken(), [0])).toEqual({ bridged: [], open: [expect.closeTo(19, 6), expect.closeTo(8, 6), expect.closeTo(3, 6)] })
    const joined = joinChainEnds(broken(), 3.5)
    const run = joined.find((c) => c.from.includes(0))!
    expect(run.from).toEqual([0, 2])
    expect(gapsRound(broken(), run.from, 3.5)).toEqual({ bridged: [expect.closeTo(3, 6)], open: [expect.closeTo(19, 6), expect.closeTo(8, 6)] })
  })
})

describe('a station refused on an open run', () => {
  const tmpl = template()
  const loop = stationLoop(tmpl, 'Square') as StationLoop

  it('names the run’s ends, the closeGaps given, the gap bridged and those still open', () => {
    const chains = broken()
    const joined = joinChainEnds(chains, 3.5)
    const w = joined.reduce((a, b) => (b.chain.length > a.chain.length ? b : a))
    const made = likeStation(tmpl, loop, w.chain)
    expect(made).toMatch(/closed outline fitted whole, and this run is open/)
    const words = runFactsWords(loop, { run: w.chain, joined: w, chains, runs: 1, fit: { closeGaps: 3.5 } })
    // The longest run: from 109 round past 0 to 50, the 3 mm gap bridged —
    // its ends, at 50 and 109, stand 8 and 19 mm of gaps and the corner
    // between them apart.
    const ends = Math.hypot(along(50)[0] - along(109)[0], along(50)[1] - along(109)[1])
    expect(words).toContain(`The run’s ends stand ${Math.round(ends * 1000) / 1000} mm apart`)
    expect(words).toContain('closeGaps 3.5 bridged 1 gap (3 mm); still open: 19, 8 mm')
    expect(words).toMatch(/closeGaps 19\.95 bridges them where they are holes in the scan; where they are the part’s own \(a gap between keys\), close the template with a drawn piece/)
    // Without closeGaps, all three are open.
    const plain = runFactsWords(loop, { run: chains[2], joined: { chain: chains[2], from: [2] }, chains, runs: 1, fit: {} })
    expect(plain).toContain('no closeGaps given, none bridged; still open: 19, 8, 3 mm')
  })

  it('says within split a chain that had closed', () => {
    const whole = walk(0, 160)
    const run = walk(5, 150)
    const words = runFactsWords(loop, { run, joined: { chain: whole, from: [0] }, chains: [whole], runs: 2, fit: { within: { min: [-1, -1], max: [41, 41] } } })
    expect(words).toMatch(/^ The run’s ends stand \d+(\.\d+)? mm apart: its chain closed \(no closeGaps given, none bridged\), and within split it into 2 runs, the longest taken — fit the closed chain without it/)
  })

  it('names the bridges on any other refusal of a bridged run, and adds nothing to one with none', () => {
    const open: StationLoop = { pieces: loop.pieces.map((p, i) => ({ ...p, fitted: i < 3 })), closed: true }
    const chains = broken()
    const joined = joinChainEnds(chains, 3.5)
    const w = joined.find((c) => c.from.includes(0))!
    expect(runFactsWords(open, { run: w.chain, joined: w, chains, runs: 1, fit: { closeGaps: 3.5 } })).toBe(' (closeGaps 3.5 bridged 1 gap (3 mm) — a bridge is a straight run across a hole, and the station’s pieces may not fall on it)')
    expect(runFactsWords(open, { run: chains[1], joined: { chain: chains[1], from: [1] }, chains, runs: 1, fit: {} })).toBe('')
  })
})
