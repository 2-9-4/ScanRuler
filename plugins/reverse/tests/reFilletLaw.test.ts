// SPDX-License-Identifier: AGPL-3.0-only
// A round read along its edge: on the scan of a 40 mm box whose top right
// edge's round runs from R1.2 at y −20 to R2.8 at y 20, whose top left one
// is R2 all along and whose bottom right one is R2.8 at both ends and R1.2
// in the middle, reverse.body.fillet_read answers where along the edge each
// place lies (t, at) and the line through their radii (linear); a fillet's
// { edge, radius: "fit" } takes the line as a variable radius, one number
// where the places agree, and refuses the V. The scan in the in-process
// worker, the kernel in this thread, as reFilletRead.test.ts runs them.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type P2 = [number, number]

/** The three rounds' radii at y along the box. */
const rising = (y: number) => 1.2 + (1.6 * (y + 20)) / 40
const even = () => 2
const vee = (y: number) => 1.2 + (1.6 * Math.abs(y)) / 20

/** The box's profile in XZ at y, counter-clockwise: the same number of
 *  points at every y, each moved off the surface by Gaussian noise. */
function profileAt(y: number, rand: () => number): P2[] {
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const out: { p: P2; n: P2 }[] = []
  const line = (a: P2, b: P2, n: P2, k = 80) => {
    for (let i = 0; i < k; i++) out.push({ p: [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k], n })
  }
  const arc = (c: P2, r: number, from: number) => {
    for (let i = 0; i < 24; i++) {
      const a = from + (Math.PI / 2) * (i / 24)
      out.push({ p: [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] })
    }
  }
  const [br, tr, tl] = [vee(y), rising(y), even()]
  line([-20, -20], [20 - br, -20], [0, -1])
  arc([20 - br, -20 + br], br, -Math.PI / 2)
  line([20, -20 + br], [20, 20 - tr], [1, 0])
  arc([20 - tr, 20 - tr], tr, 0)
  line([20 - tr, 20], [-20 + tl, 20], [0, 1])
  arc([-20 + tl, 20 - tl], tl, Math.PI / 2)
  line([-20, 20 - tl], [-20, -20], [-1, 0])
  return out.map(({ p, n }) => {
    const d = gauss() * 0.01
    return [p[0] + d * n[0], p[1] + d * n[1]]
  })
}

/** The profiles from y −20 to 20 joined row to row, capped. */
function scan(): Float32Array {
  const rand = mulberry32(11)
  const rows = Array.from({ length: 81 }, (_, j) => -20 + j * 0.5)
  const profiles = rows.map((y) => profileAt(y, rand))
  const tris: number[] = []
  const at = (p: P2, y: number) => [p[0], y, p[1]]
  for (let j = 0; j + 1 < rows.length; j++) {
    const [p, q] = [profiles[j], profiles[j + 1]]
    for (let i = 0; i < p.length; i++) {
      const k = (i + 1) % p.length
      tris.push(...at(p[i], rows[j]), ...at(p[k], rows[j]), ...at(q[k], rows[j + 1]))
      tris.push(...at(p[i], rows[j]), ...at(q[k], rows[j + 1]), ...at(q[i], rows[j + 1]))
    }
  }
  const [first, last] = [profiles[0], profiles[profiles.length - 1]]
  for (let i = 0; i < first.length; i++) {
    const k = (i + 1) % first.length
    tris.push(0, -20, 0, ...at(first[k], -20), ...at(first[i], -20))
    tris.push(0, 20, 0, ...at(last[i], 20), ...at(last[k], 20))
  }
  return new Float32Array(tris)
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(scan()), name: 'varying.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const TOP_RIGHT = { between: [[0, 0, 1], [1, 0, 0]] }
const TOP_LEFT = { between: [[0, 0, 1], [-1, 0, 0]] }
const BOTTOM_RIGHT = { between: [[0, 0, -1], [1, 0, 0]] }

async function sharpBox() {
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Base', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } } })
  const made = await run<{ bodies: { changed: { id: number }[] } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Base', regions: 'all', extent: { kind: 'distance', from: 0, to: 40 }, op: 'new' } })
  return made.bodies.changed[0].id
}

/** The y of an edge's first end, as reverse.body.describe lists its ends. */
async function firstY(body: number, pick: unknown): Promise<number> {
  const d = await run<{ bodies: { edgeList: { ends: [number, number, number][] }[] }[] }>('reverse.body.describe', { body, where: pick })
  return d.bodies[0].edgeList[0].ends[0][1]
}

interface Row {
  round: boolean
  radius: number
  radii: (number | null)[]
  stations: { t: number; at: [number, number, number] }[]
  linear?: { radius: [number, number]; rms: number; medianRms: number }
}

describe('a round read along its edge', () => {
  it('answers where each place lies and the line through the radii, carried to the ends', async () => {
    const body = await sharpBox()
    const y0 = await firstY(body, TOP_RIGHT)
    const read = await run<{ edges: Row[] }>('reverse.body.fillet_read', { body, edges: [TOP_RIGHT, TOP_LEFT], stations: 7, reach: 5 })
    const [tr, tl] = read.edges
    expect(tr.stations).toHaveLength(7)
    // t runs from the first end over the middle 60 %, and at lies there.
    expect(tr.stations[0].t).toBeCloseTo(0.2, 6)
    expect(tr.stations[6].t).toBeCloseTo(0.8, 6)
    for (const s of tr.stations) expect(s.at[1]).toBeCloseTo(y0 + Math.sign(-y0) * 40 * s.t, 3)
    // The line through them: R1.2 to R2.8, the first end's first.
    const ends = y0 < 0 ? [1.2, 2.8] : [2.8, 1.2]
    expect(Math.abs(tr.linear!.radius[0] - ends[0])).toBeLessThan(0.1)
    expect(Math.abs(tr.linear!.radius[1] - ends[1])).toBeLessThan(0.1)
    expect(tr.linear!.rms).toBeLessThan(tr.linear!.medianRms / 4)
    // An even round: a flat line, its rms about the median as small.
    expect(Math.abs(tl.radius - 2)).toBeLessThan(0.05)
    expect(Math.abs(tl.linear!.radius[0] - tl.linear!.radius[1])).toBeLessThan(0.1)
  })

  it('a radius fitted along an edge: a line taken as a variable fillet, one number where the places agree, the V refused', async () => {
    const body = await sharpBox()
    const y0 = await firstY(body, TOP_RIGHT)
    type Added = { result?: { status: string; message?: string }; fitted?: Record<string, { value: number; law: [number, number]; note: string; rms?: number }> }
    const added = await run<Added>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Rising', body, edges: [{ edge: TOP_RIGHT, radius: 'fit' }], reach: 5 } })
    expect(added.result?.status, added.result?.message).toBe('ok')
    const law = added.fitted!['variable.0.radius']
    const ends = y0 < 0 ? [1.2, 2.8] : [2.8, 1.2]
    expect(Math.abs(law.law[0] - ends[0])).toBeLessThan(0.1)
    expect(Math.abs(law.law[1] - ends[1])).toBeLessThan(0.1)
    expect(law.note).toMatch(/taken as a variable fillet/)
    // The feature holds the law as a radius typed [start, end].
    const listed = await run<{ variable: { radius: [number, number] }[] }>('reverse.feature.list', { feature: 'Rising' })
    expect(listed.variable[0].radius).toEqual(law.law)
    // The even edge: one radius at both ends.
    const flat = await run<Added>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Even', body, edges: [{ edge: TOP_LEFT, radius: 'fit' }], reach: 5 } })
    const one = flat.fitted!['variable.0.radius']
    expect(one.law[0]).toBe(one.law[1])
    expect(Math.abs(one.law[0] - 2)).toBeLessThan(0.05)
    expect(one.note).toMatch(/^One radius/)
    // The V follows neither: refused, each place's reading listed.
    const v = await refused('reverse.feature.add', { feature: { kind: 'fillet', name: 'Vee', body, edges: [{ edge: BOTTOM_RIGHT, radius: 'fit' }], reach: 5 } })
    expect(v.code).toBe('failed')
    expect(v.message).toMatch(/follows neither one number nor a line/)
    expect(v.message).toMatch(/t 0\.5: R1\.\d+/)
  })

  it('radius "fit" for the edges together says which one runs along it', async () => {
    const body = await sharpBox()
    type Added = { fitted?: { radius: { value: number; warning?: string } } }
    const added = await run<Added>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Both', body, edges: [TOP_RIGHT], radius: 'fit', reach: 5 } })
    expect(added.fitted!.radius.warning).toMatch(/^#1 runs from R/)
    expect(added.fitted!.radius.warning).toMatch(/\{ edge, radius: "fit" \}/)
  })
})
