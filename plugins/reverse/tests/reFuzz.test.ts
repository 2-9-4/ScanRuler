// SPDX-License-Identifier: AGPL-3.0-only
// Parts made up from a seed, as an agent makes them — through the commands,
// one feature at a time: a base extruded or revolved, then joins and cuts of
// boxes and cylinders sketched on the body's own top face, holes, a round
// or a chamfer on an outer edge, a pattern, a shell. After every step each
// body must be one closed solid, and the volume must have moved the way the
// feature moves it: a join or a pattern never less, a cut, a hole, a round,
// a chamfer or a shell never more. What each seed comes to — its steps,
// whether each built, the total volume and area to 1e-6, the faces and
// edges exactly — is kept in reFuzz.goldens.json: a seed that comes out
// otherwise fails, saying what changed. When the change is meant (a new
// occt-wasm, a fix), RE_FUZZ_BLESS="what changed and why" writes the
// goldens anew with that note.

import { readFileSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 600_000 })

const GOLDENS = new URL('./reFuzz.goldens.json', import.meta.url)
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1)
/** How far volume and area may stray from the goldens, of themselves. */
const TOLERANCE = 1e-6
/** What a volume may move the wrong way by: the kernel's tolerance. */
const SLACK = 1e-6

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})

/** mulberry32: the same numbers for the same seed, everywhere. */
function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (lo: number, hi: number) => Math.round((lo + (hi - lo) * next()) * 100) / 100,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
  }
}

type Vec3 = [number, number, number]
interface Face { index: number; kind: string; area: number; centroid: Vec3; normal?: Vec3 }
interface Edge { index: number; kind: string; length: number; mid: Vec3; ends: [Vec3, Vec3]; radius?: number; faces: (number | null)[] }

const solids = () => useReverse.getState().bodies.filter((b) => !b.surface)

/** The main body — the largest — with its top face and its outer top
 *  edges: what a sketch snaps to and a round goes on. */
async function topOf(): Promise<{ body: number; top: Face; outer: Edge[]; min: Vec3; max: Vec3 } | null> {
  const main = [...solids()].sort((a, b) => b.volume - a.volume)[0]
  if (!main?.box) return null
  const d = (await run<{ bodies: { faceList: Face[]; edgeList: Edge[] }[] }>('reverse.body.describe', { body: main.id })).bodies[0]
  const ups = d.faceList.filter((f) => f.kind === 'plane' && f.normal && f.normal[2] > 0.999)
  if (ups.length === 0) return null
  const top = ups.reduce((a, b) => (b.centroid[2] > a.centroid[2] + 1e-6 || (Math.abs(b.centroid[2] - a.centroid[2]) <= 1e-6 && b.area > a.area) ? b : a))
  const { min, max } = main.box
  // An edge of the top face on the body's outline: convex, so a round or
  // a chamfer on it takes material away.
  const near = (v: number, w: number) => Math.abs(v - w) < 1e-4
  const onOutline = (p: Vec3) => near(p[2], max[2]) && (near(p[0], min[0]) || near(p[0], max[0]) || near(p[1], min[1]) || near(p[1], max[1]) || (Math.abs(Math.hypot(p[0], p[1]) - (max[0] - min[0]) / 2) < 1e-3))
  const outer = d.edgeList.filter((e) => e.faces.includes(top.index) && onOutline(e.ends[0]) && onOutline(e.ends[1]) && onOutline(e.mid))
  return { body: main.id, top, outer, min, max }
}

const total = () => solids().reduce((v, b) => v + b.volume, 0)

/** One seed's part: the steps and what they came to, every check of every
 *  step on the way. */
async function part(seed: number) {
  resetReverse()
  const r = random(seed)
  const steps: string[] = []
  const outcome: string[] = []
  const wrong: string[] = []
  const add = async (kind: string, features: unknown[], way: 'more' | 'less' | 'any') => {
    const before = total()
    const out = await run<{ added: { status: string }[]; stopped?: { message: string } }>('reverse.feature.add', { features, detail: 'none' })
    await session.settled()
    steps.push(kind)
    const status = out.stopped ? `refused: ${out.stopped.message}` : out.added.map((a) => a.status).join('+')
    outcome.push(status)
    for (const b of solids()) if (!b.closed) wrong.push(`seed ${seed}, step ${steps.length} (${kind}): ${b.name} is not one closed solid`)
    const after = total()
    if (way === 'more' && after < before - SLACK * Math.max(1, before)) wrong.push(`seed ${seed}, step ${steps.length} (${kind}): the volume went down, ${before} → ${after}`)
    if (way === 'less' && after > before + SLACK * Math.max(1, before)) wrong.push(`seed ${seed}, step ${steps.length} (${kind}): the volume went up, ${before} → ${after}`)
  }
  // The base.
  if (r.next() < 0.5) {
    const [w, h, d] = [r.range(20, 60), r.range(20, 60), r.range(8, 20)]
    await add('extrude', [{ kind: 'sketch', name: 'Base', plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [w, h], fixed: true }] } }, { kind: 'extrude', sketchId: 'Base', regions: 'all', extent: { kind: 'distance', from: 0, to: d }, op: 'new' }], 'more')
  } else {
    const r0 = r.next() < 0.4 ? 0 : r.range(2, 6)
    const [r1, h] = [r0 + r.range(10, 25), r.range(8, 20)]
    await add('revolve', [{ kind: 'sketch', name: 'Base', plane: { kind: 'world', axis: 'x' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [r0, 0], to: [r1, h], fixed: true }] } }, { kind: 'revolve', sketchId: 'Base', axis: { kind: 'world', axis: 'z' }, op: 'new' }], 'more')
  }
  const count = 6 + Math.floor(r.next() * 5)
  let shelled = false
  let patterned = false
  for (let i = 0; i < count; i++) {
    const at = await topOf()
    if (!at) break
    const span = (k: 0 | 1) => [at.min[k] + 0.3 * (at.max[k] - at.min[k]), at.max[k] - 0.3 * (at.max[k] - at.min[k])]
    const inside = (): [number, number] => {
      const [x0, x1] = span(0)
      const [y0, y1] = span(1)
      return [r.range(x0, x1), r.range(y0, y1)]
    }
    const onTop = { kind: 'bodyFace', body: at.body, face: at.top.index }
    const name = `S${seed}.${i}`
    const height = at.max[2] - at.min[2]
    const kind = r.pick(['joinBox', 'cutBox', 'joinCyl', 'cutCyl', 'hole', 'round', 'chamfer', 'pattern', 'shell'] as const)
    if (kind === 'joinBox' || kind === 'cutBox') {
      const size: [number, number] = [r.range(3, 9), r.range(3, 9)]
      const cut = kind === 'cutBox'
      await add(kind, [{ kind: 'sketch', name, plane: onTop, sketch: { project: false, shapes: [{ kind: 'rectangle', id: 1, center: inside(), size, fixed: true }] } }, { kind: 'extrude', sketchId: name, regions: 'all', extent: { kind: 'distance', from: 0, to: cut ? -r.range(1, height * 0.6) : r.range(2, 8) }, op: cut ? 'cut' : 'join' }], cut ? 'less' : 'more')
    } else if (kind === 'joinCyl' || kind === 'cutCyl') {
      const cut = kind === 'cutCyl'
      await add(kind, [{ kind: 'sketch', name, plane: onTop, sketch: { project: false, entities: [{ id: 1, kind: 'circle', c: inside(), r: r.range(1.5, 4.5), fixed: true }] } }, { kind: 'extrude', sketchId: name, regions: 'all', extent: { kind: 'distance', from: 0, to: cut ? -r.range(1, height * 0.6) : r.range(2, 8) }, op: cut ? 'cut' : 'join' }], cut ? 'less' : 'more')
    } else if (kind === 'hole') {
      const [x, y] = inside()
      await add(kind, [{ kind: 'hole', body: at.body, axis: { kind: 'point', face: at.top.index, at: [x, y, at.top.centroid[2]] }, radius: r.range(0.8, 2.5), depth: r.range(2, Math.max(2.5, height * 0.7)) }], 'less')
    } else if ((kind === 'round' || kind === 'chamfer') && at.outer.length > 0) {
      const edge = at.outer.reduce((a, b) => (b.length > a.length ? b : a))
      await add(kind, [kind === 'round' ? { kind: 'fillet', body: at.body, edges: [edge.index], radius: r.range(0.3, 1.2), chain: false } : { kind: 'chamfer', body: at.body, edges: [edge.index], distance: r.range(0.3, 1) }], 'less')
    } else if (kind === 'pattern' && !patterned) {
      patterned = true
      await add(kind, [{ kind: 'pattern', body: at.body, mode: 'linear', axis: { kind: 'world', axis: 'x' }, count: 2, step: at.max[0] - at.min[0] + 5 }], 'more')
    } else if (kind === 'shell' && !shelled && i < 2) {
      // Early, while the walls are the base's: later cuts and holes leave
      // walls thinner than any shell fits, which only says so.
      shelled = true
      await add(kind, [{ kind: 'shell', body: at.body, faces: [at.top.index], thickness: r.range(1, 2) }], 'less')
    }
  }
  // What it came to.
  const checks = await Promise.all(solids().map((b) => run<{ bodies?: { volume: number; area: number; faces: number }[]; volume?: number; area?: number; faces?: number }>('reverse.body.check', { body: b.id, audit: false })))
  const sum = (key: 'volume' | 'area' | 'faces') => checks.reduce((v, c) => v + Number((c.bodies?.[0] ?? c)[key] ?? 0), 0)
  const described = await run<{ bodies: { of: { edges: number } }[] }>('reverse.body.describe', { limit: 1 })
  return {
    steps,
    outcome,
    volume: sum('volume'),
    area: sum('area'),
    faces: sum('faces'),
    edges: described.bodies.reduce((n, b) => n + b.of.edges, 0),
    wrong,
  }
}

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))

describe('parts made up from seeds', () => {
  it('stay closed solids whose volume moves the right way, and come out as they did', async () => {
    const goldens = JSON.parse(readFileSync(GOLDENS, 'utf8')) as Record<string, { note?: string; steps: string[]; outcome: string[]; volume: number; area: number; faces: number; edges: number }>
    const bless = process.env.RE_FUZZ_BLESS
    const changed: string[] = []
    const wrong: string[] = []
    const now: typeof goldens = {}
    for (const seed of SEEDS) {
      const got = await part(seed)
      wrong.push(...got.wrong)
      const { wrong: _w, ...result } = got
      now[`seed ${seed}`] = { ...(bless ? { note: bless } : goldens[`seed ${seed}`]?.note ? { note: goldens[`seed ${seed}`].note } : {}), ...result }
      const want = goldens[`seed ${seed}`]
      if (!want) {
        changed.push(`seed ${seed}: no golden yet`)
        continue
      }
      const why: string[] = []
      if (JSON.stringify(want.steps) !== JSON.stringify(result.steps)) why.push(`steps ${want.steps.join(',')} → ${result.steps.join(',')}`)
      if (JSON.stringify(want.outcome) !== JSON.stringify(result.outcome)) why.push(`outcome ${JSON.stringify(want.outcome)} → ${JSON.stringify(result.outcome)}`)
      if (!near(want.volume, result.volume)) why.push(`volume ${want.volume} → ${result.volume}`)
      if (!near(want.area, result.area)) why.push(`area ${want.area} → ${result.area}`)
      if (want.faces !== result.faces) why.push(`faces ${want.faces} → ${result.faces}`)
      if (want.edges !== result.edges) why.push(`edges ${want.edges} → ${result.edges}`)
      if (why.length > 0) changed.push(`seed ${seed}: ${why.join('; ')}`)
    }
    if (bless) writeFileSync(GOLDENS, JSON.stringify(now, null, 2) + '\n')
    expect(wrong).toEqual([])
    if (!bless) expect(changed, 'a seed came out otherwise — if that is meant, RE_FUZZ_BLESS="why" writes the goldens anew').toEqual([])
  })
})
