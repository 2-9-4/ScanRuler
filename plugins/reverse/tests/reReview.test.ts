// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.review: the volume error's regions and the comparison's
// patches merged into places and ranked, the views that see them, the
// trend from one review to the next — and the command on the 40 mm box
// scan, headless: a body built short reads its top as the first place,
// missing, with a section across it as the first step, no picture and why;
// built taller, the next review says it went better.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { reviewHistory } from '../app/rePlan'
import { ReClient } from '../core/reClient'
import { againstMark, chooseViews, mergePlaces, placeMargin, type PatchSpot, type ReviewMark, trendOf, type VolumeSpot } from '../core/reviewPlaces'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 240_000 })

type Vec3 = [number, number, number]

/** An answer as the MCP server sends it: six significant digits. */
const agentJson = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v))

const box = (min: Vec3, max: Vec3) => ({ min, max })
const face = (madeBy: string) => ({ body: 'Solid 1', index: 0, madeBy })

const region = (kind: 'missing' | 'excess', volume: number, min: Vec3, max: Vec3): VolumeSpot => ({
  kind,
  volume,
  maxDepth: 1,
  centroid: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  box: box(min, max),
  face: face(kind === 'missing' ? 'Top' : 'Side'),
})

const patch = (over: Partial<PatchSpot> & Pick<PatchSpot, 'side' | 'at'>): PatchSpot => ({
  far: false,
  kind: 'feature',
  area: 10,
  volume: 5,
  extreme: over.side === 'outside' ? 0.8 : -0.8,
  mean: over.side === 'outside' ? 0.5 : -0.5,
  centroid: over.at,
  vertex: 7,
  box: box([over.at[0] - 1, over.at[1] - 1, over.at[2] - 1], [over.at[0] + 1, over.at[1] + 1, over.at[2] + 1]),
  face: face('Wall'),
  ...over,
})

describe('places, views and the trend', () => {
  it('merges a patch into the region of its kind it lies on, keeps the rest apart, and ranks by material', () => {
    const regions = [region('missing', 500, [0, 0, 0], [10, 10, 10]), region('excess', 100, [20, 20, 20], [30, 30, 30])]
    const patches = [
      // On the missing region: the scan outside the body there.
      patch({ side: 'outside', at: [5, 5, 10.5], area: 40, extreme: 2.5, volume: 60, vertex: 11 }),
      // On it too, but the scan inside: not the same kind — a face off.
      patch({ side: 'inside', at: [5, 5, 10.2], area: 4, volume: 20 }),
      // Past the reach, far from both: material missing on its own.
      patch({ side: 'outside', far: true, at: [60, 60, 60], volume: 300, extreme: 4 }),
      // The scan's roughness: no place.
      patch({ side: 'outside', kind: 'texture', at: [40, 0, 0], volume: 1000 }),
    ]
    const places = mergePlaces(regions, patches, 0.2)
    expect(places.map((p) => [p.n, p.kind, p.by, p.mm3])).toEqual([
      [1, 'missing', 'volume+map', 500],
      [2, 'missing', 'far', 300],
      [3, 'excess', 'volume', 100],
      [4, 'off', 'map', 20],
    ])
    // The region keeps its volume, takes the patch's area, depth and point.
    expect(places[0]).toMatchObject({ area: 40, maxDepth: 2.5, scanAt: [5, 5, 10.5], vertex: 11, face: { madeBy: 'Top' } })
    expect(places[3]).toMatchObject({ mean: -0.5, face: { madeBy: 'Wall' } })
    expect(places[1].mean).toBeUndefined()
    // Past the margin, a patch is a place of its own.
    const off = mergePlaces(regions, [patch({ side: 'outside', at: [5, 5, 10 + placeMargin(0.2) + 0.5] })], 0.2)
    expect(off.map((p) => p.kind)).toEqual(['missing', 'excess', 'off'])
  })

  it('chooses the views that see the places most, the first place first', () => {
    const views = [
      { name: 'iso', dir: [0.72, -0.95, 0.55] as Vec3 },
      { name: 'top', dir: [0, 0, 1] as Vec3 },
      { name: 'right', dir: [1, 0, 0] as Vec3 },
      { name: 'bottom', dir: [0, 0, -1] as Vec3 },
    ]
    expect(chooseViews([[0, 0, 1], [1, 0, 0]], [1, 0.5], views)).toEqual(['top', 'right'])
    // Two at least, four at most.
    expect(chooseViews([[0, 0, 1]], [1], views)).toHaveLength(2)
    expect(chooseViews([[0, 0, 1], [1, 0, 0], [0, 0, -1], [-0.6, -0.8, 0]], [1, 1, 1, 1], views).length).toBeLessThanOrEqual(4)
  })

  it('tells one review against the last and the first', () => {
    const mark = (at: number, features: number, withinT: number, excess: number, missing: number, tolerance = 0.2): ReviewMark => ({ at: at * 60_000, features, feature: null, tolerance, withinT, excess, missing })
    const a = mark(0, 10, 60, 2000, 3000), b = mark(5, 12, 65, 1800, 2500), c = mark(9, 13, 64, 1900, 2600)
    expect(againstMark(b, a)).toMatchObject({ features: 2, withinT: 5, excess: -200, missing: -500, minutes: 5, went: 'better' })
    expect(againstMark(c, b)).toMatchObject({ went: 'worse' })
    expect(againstMark(mark(1, 10, 63, 2400, 3000), a)).toMatchObject({ went: 'mixed' })
    expect(againstMark(mark(1, 10, 60.2, 2001, 3000), a)).toMatchObject({ went: 'same' })
    expect(againstMark(mark(1, 10, 60, 2000, 3000, 0.1), a).note).toMatch(/read at ±0.2 then/)
    expect(trendOf([a])).toMatchObject({ loop: 1 })
    const t = trendOf([a, b, c])
    expect(t).toMatchObject({ loop: 3, vsLast: { went: 'worse' }, vsFirst: { went: 'better', features: 3 } })
    expect(trendOf([a, b]).vsFirst).toBeUndefined()
  })
})

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

describe('reverse.body.review', () => {
  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box.stl', discard: true })
    await resetReverse()
  }, 120_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless?.stop()
  })

  type Review = {
    tolerance: number
    score: { withinT: number; read: number; far?: { inside: number; outside: number } }
    volume: { excess: { volume: number }; missing: { volume: number } }
    places: { n: number; kind: string; mm3: number; face: { madeBy: string | null } | null; by: string }[]
    placesFound: number
    trend: { loop: number; vsLast?: { went: string; missing: number; withinT: number } }
    target: unknown
    targetWhy?: string
    next: string
    picture?: unknown
    pictureWhy?: string
    file?: unknown
  }

  it('names the top of a body built short as the first place, and the next review says it went better', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plate', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plate', regions: 'all', extent: { kind: 'distance', from: 0, to: 30 }, op: 'new' } })
    const first = await run<Review>('reverse.body.review', { tolerance: 0.5, cell: 1 })
    expect(first.tolerance).toBe(0.5)
    const top = first.places[0]
    expect(top).toMatchObject({ n: 1, kind: 'missing', face: { madeBy: 'Block' } })
    // The top 10 mm of the box, 16 000 mm³, less the band within T of the
    // scan all round it.
    expect(top.mm3).toBeGreaterThan(11_000)
    expect(top.mm3).toBeLessThan(16_500)
    expect(first.score.far?.outside).toBeGreaterThan(0)
    expect(first.score.withinT).toBeLessThan(90)
    expect(first.next).toMatch(/^1: missing 1\d,\d{3} mm³ at \(.*\), nearest face \d+ of .* \(Block\) — material the part has .*section\.render \{ plane: \{ origin: /)
    // Headless: no picture, and why.
    expect(first.picture).toBeUndefined()
    expect(first.file).toBeUndefined()
    expect(first.pictureWhy).toMatch(/headless/)
    expect(first.trend).toMatchObject({ loop: 1 })
    expect(first.target).toBeNull()
    expect(first.targetWhy).toMatch(/reverse\.plan\.set/)
    // Built nearer the scan: less missing, more within T.
    await run('reverse.feature.update', { feature: 'Block', set: { extent: { kind: 'distance', from: 0, to: 37 } } })
    const second = await run<Review>('reverse.body.review', { tolerance: 0.5, cell: 1 })
    expect(second.trend.loop).toBe(2)
    expect(second.trend.vsLast?.went).toBe('better')
    expect(second.trend.vsLast?.missing).toBeLessThan(-5000)
    expect(reviewHistory(session)).toHaveLength(2)
    // The answer's text stays small.
    const { file: _f, ...text } = second
    void _f
    expect(agentJson(text).length).toBeLessThan(4000)
    expect((await refused('reverse.body.review', { within: { min: [0, 0, 0], max: [0, 1, 1] } })).code).toBe('invalid_input')
  })
})
