// SPDX-License-Identifier: AGPL-3.0-only
// Stations checked where they are made (round 15): a volute's channel
// station — a wall, a round, a short floor, a round, a wall, closed across
// the top — and the folded ones a fit like it can give: the floor run
// backwards between its rounds, pulled to nothing, a round cut to a 3°
// sliver. Each is named piece by piece; a station whose wall meets the
// line across the top far off is refused where it is fitted; an inset of
// a folded station is refused naming the fold, and a sound one keeps its
// rounds' sweeps.

import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { addEntity, emptySketch, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { insetKeeps, insetSketch, likeStation, stationFaults, type StationLoop, stationLoop } from '../core/stations'

const deg = Math.PI / 180
/** A fitted piece's slice points: any will do for a station's reading. */
const fitted = { points: [[0, 0]] as Vec2[] }

type Piece = { id: number } & ({ kind: 'line'; a: Vec2; b: Vec2; drawn?: boolean } | { kind: 'arc'; c: Vec2; r: number; start: number; sweep: number })

/** A station of six pieces, ids 7–11 fitted and 40 drawn across the top,
 *  as a channel station is fitted like its template. */
function station(pieces: Piece[]): Sketch {
  const s: Sketch = { entities: [], constraints: [], nextId: 41 }
  for (const p of pieces) {
    if (p.kind === 'line') s.entities.push({ id: p.id, kind: 'line', a: p.a, b: p.b, ...(p.drawn ? {} : fitted) } as SketchLine)
    else s.entities.push({ id: p.id, kind: 'arc', c: p.c, r: p.r, start: p.start * deg, sweep: p.sweep * deg, ...fitted } as SketchArc)
  }
  return s
}

/** A sound channel station: the floor runs on from the first round into
 *  the second, every corner tangent. */
const sound = () =>
  station([
    { id: 7, kind: 'line', a: [29.5081, 2], b: [34.1744, -11.6253] },
    { id: 8, kind: 'arc', c: [36.7455, -10.7447], r: 2.7178, start: 198.905, sweep: 71.2241 },
    { id: 9, kind: 'line', a: [36.7517, -13.4625], b: [37.7577, -13.4602] },
    { id: 10, kind: 'arc', c: [37.7476, -8.9843], r: 4.4759, start: 270.129, sweep: 88.26 },
    { id: 11, kind: 'line', a: [42.2217, -9.1101], b: [42.5342, 2] },
    { id: 40, kind: 'line', a: [29.5081, 2], b: [42.5342, 2], drawn: true },
  ])

/** The same station folded: its floor runs 1.05 mm back between the rounds
 *  — two regions, one of 0.019 mm². */
const backwards = () =>
  station([
    { id: 7, kind: 'line', a: [36.1393, 2], b: [35.5425, -9.9852] },
    { id: 8, kind: 'arc', c: [37.3741, -10.0764], r: 1.8339, start: 177.1493, sweep: 96.5961 },
    { id: 9, kind: 'line', a: [37.4939, -11.9064], b: [36.4499, -11.9747] },
    { id: 10, kind: 'arc', c: [36.2013, -8.1773], r: 3.8055, start: 273.7454, sweep: 85.8917 },
    { id: 11, kind: 'line', a: [40.0068, -8.2014], b: [40.0714, 2] },
    { id: 40, kind: 'line', a: [36.1393, 2], b: [40.0714, 2], drawn: true },
  ])

/** An outlet station whose first round is R1.12 over 3.3°, entered against
 *  the wall coming down into it. */
const sliverRound = () =>
  station([
    { id: 7, kind: 'line', a: [33.0088, 2], b: [33.0088, -10.3777] },
    { id: 8, kind: 'arc', c: [31.887, -10.3777], r: 1.1219, start: 0, sweep: 3.2907 },
    { id: 9, kind: 'line', a: [33.007, -10.3133], b: [33.3512, -16.3008] },
    { id: 10, kind: 'arc', c: [42.3415, -15.7839], r: 9.0051, start: 183.2907, sweep: 174.8001 },
    { id: 11, kind: 'line', a: [51.3415, -16.0839], b: [51.9443, 2] },
    { id: 40, kind: 'line', a: [33.0088, 2], b: [51.9443, 2], drawn: true },
  ])

const loopOf = (s: Sketch): StationLoop => {
  const loop = stationLoop(s, 'Station')
  if (typeof loop === 'string') throw new Error(loop)
  return loop
}

describe('a station’s pieces against its template', () => {
  it('names a floor run backwards, one pulled to nothing and a round under 5°, and passes a sound one', () => {
    const template = sound()
    const loop = loopOf(template)
    expect(stationFaults(template, loop, sound())).toEqual([])
    expect(stationFaults(template, loop, backwards())).toEqual(['piece 9 (a line) runs 1.046 mm backwards against the template’s piece 9'])
    // The floor pulled to half a micron by the solve.
    const pulled = sound()
    const floor = pulled.entities.find((e) => e.id === 9) as SketchLine
    floor.b = [floor.a[0] + 0.0005, floor.a[1]]
    expect(stationFaults(template, loop, pulled)).toEqual(['piece 9 (a line) is 0.0005 mm long — under 0.05 mm'])
    expect(stationFaults(template, loop, sliverRound())).toEqual(['piece 8 (an arc) sweeps 3.3° — under 5°'])
  })

  it('names a piece shorter than touch instead of reading three pieces meeting', () => {
    const s = sound()
    const floor = s.entities.find((e) => e.id === 9) as SketchLine
    floor.b = [floor.a[0] + 0.0005, floor.a[1]]
    expect(stationLoop(s, 'Passage start station 2')).toMatch(/^Passage start station 2's piece 9 \(a line\) is 0\.0005 mm long — shorter than the 0\.002 mm two ends meet within/)
    expect(stationLoop(s, 'Passage start station 2')).not.toMatch(/branches/)
  })
})

describe('a station fitted like another', () => {
  /** A template: a wall down, a floor down and out, a wall up — fitted —
   *  closed by a line across the top. */
  function template(): Sketch {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [0, 10], b: [0, 0], ...fitted })
    addEntity(s, { kind: 'line', a: [0, 0], b: [10, -10], ...fitted })
    addEntity(s, { kind: 'line', a: [10, -10], b: [20, 10], ...fitted })
    addEntity(s, { kind: 'line', a: [20, 10], b: [0, 10] })
    return s
  }
  const along = (a: Vec2, b: Vec2, n: number): Vec2[] => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])

  it('refuses a corner met far past the run, and fits the same run with its wall up', () => {
    const t = template()
    const loop = loopOf(t)
    // The last wall lies nearly flat — the run took in a boss beside the
    // station — and meets the line across the top 380 mm out.
    const flat = [...along([0, 10], [0, 0], 20), ...along([0, 0], [10, -10], 20), ...along([10, -10], [30, -9], 40), [30, -9] as Vec2]
    expect(likeStation(t, loop, flat)).toMatch(/^the corner of pieces 3 and 4 lands \d+(\.\d+)? mm past the run’s ends — over 2× the run’s extent \(\d+(\.\d+)? mm\).*Point it with within or facing\.$/)
    const up = [...along([0, 10], [0, 0], 20), ...along([0, 0], [10, -10], 20), ...along([10, -10], [19, 8], 40), [19, 8] as Vec2]
    const made = likeStation(t, loop, up)
    if (typeof made === 'string') throw new Error(made)
    expect(made.sketch.entities.map((e) => e.id)).toEqual([1, 2, 3, 4])
  })
})

describe('a station moved in or out', () => {
  it('refuses the folded station’s inset naming the round and the fold, and an outlet round swollen from 3°', () => {
    const folded = backwards()
    expect(insetSketch(folded, loopOf(folded), -3, new Set(insetKeeps(loopOf(folded))))).toMatch(
      /^the arc 8 would turn inside out at -3 mm — its sweep goes from 96\.6° to 200\.\d°, more than the corners it meets its neighbours at let it \(15°\): they cross past it\. The source folds back at the corner of pieces 8 and 9 \(it turns 180° there\) — fit that station again/,
    )
    const outlet = sliverRound()
    expect(insetSketch(outlet, loopOf(outlet), -3, new Set(insetKeeps(loopOf(outlet))))).toMatch(/^the arc 8 would turn inside out at -3 mm — its sweep goes from 3\.3° to \d+\.\d°.*folds back at the corner of pieces 7 and 8/)
  })

  it('moves a sound station out by the wall, its rounds sweeping as they did', () => {
    const s = sound()
    const loop = loopOf(s)
    const out = insetSketch(s, loop, -3, new Set(insetKeeps(loop)))
    if (typeof out === 'string') throw new Error(out)
    // Within the tangencies' rounding in the numbers above.
    const sweeps = (k: Sketch) => k.entities.filter((e): e is SketchArc => e.kind === 'arc').map((a) => a.sweep / deg)
    expect(sweeps(out.sketch)).toEqual(sweeps(s).map((x) => expect.closeTo(x, 0)))
    expect(out.dropped).toEqual([])
  })
})
