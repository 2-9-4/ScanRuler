// SPDX-License-Identifier: AGPL-3.0-only
// The Patch network through the commands (PN13): a 2 × 2 grid written as an
// agent writes it — three lines one way, three the other through their
// points — on a gently curved noisy sheet, joined into nine nodes and twelve
// curves, every region filled, built into four patches tangent within half
// a degree and read back; edited (a curve made a crease, a strip given its
// span count) in one undo step each, each command's shape within what an
// agent's client lists; the stored form taken back by
// reverse.feature.update; what closes nothing refused by name; and on a
// folded sheet the fold suggested as a crease, a network across it keeping
// its fold. In the in-process worker, the kernel in this thread, the
// viewport's scan stood in for by the mesh drawn on.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listCommands } from '../../../src/commands/registry'
import { SCHEMA_BUDGET, schemaWeight } from '../../../src/commands/schema'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { gridScan } from './networkMeshes'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 300_000 })

const NOISE = 0.01
const sheet = (u: number, v: number): Vec3 => [100 * u, 80 * v, 3 * Math.sin(2 * u) * Math.cos(v)]
/** Two flat faces meeting at 30° along x = 0. */
const fold = (u: number, v: number): Vec3 => {
  const x = 80 * u - 40
  return [x, 60 * v, Math.abs(x) * Math.tan((15 * Math.PI) / 180)]
}
const sheetMesh = gridScan(120, 96, sheet, { noise: NOISE })
const foldMesh = gridScan(160, 120, fold, { noise: 0.02 })

/** The scan the viewport holds — what the commands draw on: its vertices
 *  and, fresh each time, its triangles, as SceneManager hands them out. */
let shown = sheetMesh
const scene = { scanPositions: () => shown.positions, scanIndices: () => Uint32Array.from(shown.indices) } as unknown as SceneManager

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

async function open(mesh: typeof sheetMesh, name: string) {
  shown = mesh
  await run('scan.open', { bytes: stlBytes(soupOf(mesh)), name, discard: true })
}

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: scene }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await open(sheetMesh, 'sheet.stl')
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Made {
  id?: number
  status?: string
  line: string
  curves: number[][]
  joined?: { given: number; point: number; node: number; on: string; of?: number }[]
  result?: { status: string; message?: string }
  patches?: { patch: number; rms: number; max: number; net: [number, number] }[]
  openEnds?: unknown[]
  bodies?: { changed?: { id: number; surface?: boolean; faces: number }[] }
}
interface Read {
  status: string
  line: string
  counts: { nodes: number; curves: number; cells: number; patches: number; unfilled: number; refused: number }
  closed: boolean
  worstAngle: number
  worstGap: number
  patches: { patch: number; cell: number; rms: number; max: number; net: [number, number]; sides: number[][]; corners: number[] }[]
  cells: { cell: number; sides?: number; patches?: number[]; refused?: string }[]
  curves: { id: number; from: number; to: number; via: Vec3[]; crease?: true; strip?: number; gap?: number; angle?: number; fold?: number }[]
  nodes: { id: number; at: Vec3 }[]
  strips: { strip: number; spans: number; auto: boolean; curves: number[] }[]
  openEnds?: unknown[]
}

const U = [0.15, 0.5, 0.85]
const V = [0.15, 0.5, 0.85]
/** A 2 × 2 grid as an agent writes it: the three lines along u, then the
 *  three along v through their points. */
const grid = () => [...V.map((v) => ({ points: U.map((u) => sheet(u, v)) })), ...U.map((u) => ({ points: V.map((v) => sheet(u, v)) }))]

describe('patch network commands', () => {
  it('lists each command within what an agent’s client takes', () => {
    const network = listCommands().filter((c) => c.name.startsWith('reverse.network.'))
    expect(network.map((c) => c.name).sort()).toEqual(['reverse.network.create', 'reverse.network.edit', 'reverse.network.read', 'reverse.network.suggest_creases'])
    for (const c of network) {
      const w = schemaWeight(c.input)
      expect(w.bytes, c.name).toBeLessThanOrEqual(SCHEMA_BUDGET.bytes)
      expect(w.depth, c.name).toBeLessThanOrEqual(SCHEMA_BUDGET.depth)
    }
  })

  it('joins a grid written line by line into a 2 × 2 network, fills it and reads four tangent patches', async () => {
    const made = await run<Made>('reverse.network.create', { name: 'Hood', curves: grid(), fill: 'all' })
    expect(made.result?.status, made.result?.message).toBe('ok')
    expect(made.line).toMatch(/^4 patches · worst edge [\d.]+° · worst gap [\d.]+ µm/)
    // Every line cut once where the lines the other way cross it: two
    // pieces each, twelve curves; the grid's other lines joined at nodes.
    expect(made.curves.map((ids) => ids.length)).toEqual([2, 2, 2, 2, 2, 2])
    expect(new Set(made.curves.flat()).size).toBe(12)
    // The lines along v land on the lines along u: at their ends' nodes,
    // and at their grips, which become nodes.
    expect(made.joined?.filter((j) => j.on === 'grip').map((j) => [j.given, j.point])).toEqual([[4, 0], [4, 1], [4, 2]])
    expect(made.joined?.filter((j) => j.on === 'node').length).toBe(6)
    expect(made.openEnds).toBeUndefined()
    expect(made.patches?.length).toBe(4)
    expect(made.bodies?.changed?.[0]).toMatchObject({ surface: true, faces: 4 })
    expect(undoLabels().at(-1)).toBe('Agent: add patch network “Hood”')

    const read = await run<Read>('reverse.network.read', { feature: 'Hood' })
    expect(read.status).toBe('ok')
    expect(read.counts).toMatchObject({ nodes: 9, curves: 12, cells: 4, patches: 4, unfilled: 0, refused: 0 })
    expect(read.closed).toBe(false)
    expect(read.worstAngle).toBeLessThan(0.5)
    expect(read.worstGap).toBeLessThan(0.005)
    for (const p of read.patches) {
      expect(p.rms).toBeLessThan(3 * NOISE)
      expect(p.sides.length).toBe(4)
      expect(p.corners.length).toBe(4)
    }
    expect(read.cells.map((c) => c.sides)).toEqual([4, 4, 4, 4])
    // The four inner curves are shared by two patches, tangent across.
    const inner = read.curves.filter((c) => c.angle !== undefined)
    expect(inner.length).toBe(4)
    for (const c of inner) expect(c.angle).toBeLessThan(0.5)
    expect(read.openEnds).toBeUndefined()
    // Brief: the line and the patches in short.
    const brief = await run<{ patches: { cell: number }[]; curves?: unknown }>('reverse.network.read', { feature: 'Hood', detail: 'brief' })
    expect(brief.patches.length).toBe(4)
    expect(brief.curves).toBeUndefined()
  })

  it('edits a network in one undo step each: a crease, a strip’s spans, a curve taken out and the region emptied', async () => {
    const made = await run<Made>('reverse.network.create', { name: 'Hood', curves: grid() })
    // The middle line along u, both its pieces, made a crease.
    const middle = made.curves[1]
    const steps = undoLabels().length
    const creased = await run<Made>('reverse.network.edit', { feature: 'Hood', set: middle.map((curve) => ({ curve, crease: true })) })
    expect(creased.result?.status, creased.result?.message).toBe('ok')
    expect(undoLabels().length).toBe(steps + 1)
    expect(undoLabels().at(-1)).toBe('Agent: edit Hood')
    let read = await run<Read>('reverse.network.read', { feature: 'Hood' })
    for (const id of middle) {
      const c = read.curves.find((x) => x.id === id)!
      expect(c.crease).toBe(true)
      // A crease is read by its fold, not as an angle across a tangent curve.
      expect(c.fold).toBeDefined()
      expect(c.angle).toBeUndefined()
    }
    // A strip's span count, by a curve in it: the first line's first piece.
    const first = made.curves[0][0]
    await run('reverse.network.edit', { feature: 'Hood', set: [{ curve: first, spans: 6 }] })
    read = await run<Read>('reverse.network.read', { feature: 'Hood' })
    const strip = read.strips.find((s) => s.curves.includes(first))!
    expect(strip).toMatchObject({ spans: 6, auto: false })
    // The patches on that strip have six spans across the curve's way.
    const along = read.patches.filter((p) => p.sides.some((side) => side.includes(first)))
    expect(along.length).toBeGreaterThan(0)
    for (const p of along) expect(p.net).toContain(6)
    // Back to Auto.
    await run('reverse.network.edit', { feature: 'Hood', set: [{ curve: first, spans: null }] })
    read = await run<Read>('reverse.network.read', { feature: 'Hood' })
    expect(read.strips.find((s) => s.curves.includes(first))!.auto).toBe(true)
    // A boundary curve taken out: its cell opens, and is said so.
    const out = await run<Made & { refused?: { cell: number; refused: string }[] }>('reverse.network.edit', { feature: 'Hood', remove: { curves: [made.curves[0][0]] } })
    expect(out.refused?.length).toBe(1)
    expect(out.refused?.[0].refused).toMatch(/not closed|open/)
    expect(out.patches?.length).toBe(3)
    // Emptying every region is refused: a network keeps one.
    expect((await refused('reverse.network.edit', { feature: 'Hood', unfill: 'all' })).message).toMatch(/keeps one at least/)
  })

  it('adds a curve that joins the network where it lands, fills what it closes, and moves and puts in points', async () => {
    // The grid less its middle line along u: two cells, side by side.
    const lines = grid()
    const made = await run<Made>('reverse.network.create', { name: 'Hood', curves: [lines[0], lines[2], ...lines.slice(3)] })
    expect(made.patches?.length).toBe(2)
    const added = await run<Made & { added: number[][] }>('reverse.network.edit', { feature: 'Hood', add: [lines[1]], fill: 'all' })
    expect(added.result?.status, added.result?.message).toBe('ok')
    // It ends on the outer lines' grips, crosses the middle one at its grip:
    // three nodes made of grips, the new line cut in two there.
    expect(added.added[0].length).toBe(2)
    expect(added.joined?.map((j) => j.on)).toEqual(['grip', 'grip', 'grip'])
    expect(added.patches?.length).toBe(4)
    let read = await run<Read>('reverse.network.read', { feature: 'Hood' })
    expect(read.counts).toMatchObject({ nodes: 9, curves: 12, cells: 4, patches: 4 })
    // A corner node moved along the scan, and a grip put into a curve.
    const corner = read.nodes.find((n) => Math.hypot(n.at[0] - 15, n.at[1] - 12) < 1)!
    // The bottom line's piece from it, along u.
    const nodeAt = (id: number) => read.nodes.find((n) => n.id === id)!.at
    const outer = read.curves.find((c) => (c.from === corner.id || c.to === corner.id) && Math.abs(nodeAt(c.from === corner.id ? c.to : c.from)[1] - 12) < 1)!
    const moved = await run<Made>('reverse.network.edit', { feature: 'Hood', move: [{ node: corner.id, to: sheet(0.13, 0.14) }], grips: [{ curve: outer.id, at: sheet(0.3, 0.15) }] })
    expect(moved.result?.status, moved.result?.message).toBe('ok')
    read = await run<Read>('reverse.network.read', { feature: 'Hood' })
    expect(read.nodes.find((n) => n.id === corner.id)!.at[0]).toBeCloseTo(13, 0)
    expect(read.curves.find((c) => c.id === outer.id)!.via.length).toBe(outer.via.length + 1)
    expect(read.counts.patches).toBe(4)
  })

  it('takes the stored form through reverse.feature.update, and refuses what closes nothing by name', async () => {
    await run<Made>('reverse.network.create', { name: 'Hood', curves: grid() })
    const stored = await run<{ kind: string; nodes: unknown[]; curves: unknown[]; cells: unknown[]; fit: { smoothness: number } }>('reverse.feature.list', { feature: 'Hood' })
    expect(stored.kind).toBe('network')
    expect(stored.curves.length).toBe(12)
    const smoother = await run<{ result: { status: string } }>('reverse.feature.update', { feature: 'Hood', set: { fit: { smoothness: 0.05 } } })
    expect(smoother.result.status).toBe('ok')
    expect((await run<{ fit: { smoothness: number } }>('reverse.feature.list', { feature: 'Hood' })).fit.smoothness).toBe(0.05)
    expect((await refused('reverse.feature.update', { feature: 'Hood', set: { curves: [{ id: 1, from: 1, to: 99, via: [] }] } })).message).toMatch(/no node 99/)

    // One open curve closes nothing.
    const open = await refused('reverse.network.create', { curves: [{ points: [sheet(0.2, 0.2), sheet(0.5, 0.3), sheet(0.8, 0.2)] }] })
    expect(open.code).toBe('invalid_input')
    expect(open.message).toMatch(/close no region .* 2 curve ends meet no other/)
    expect((await refused('reverse.network.edit', { feature: 'Hood', set: [{ curve: 999, crease: true }] })).code).toBe('not_found')
    expect((await refused('reverse.network.read', { feature: 'Nope' })).code).toBe('not_found')
  })
})

describe('creases suggested', () => {
  beforeAll(async () => {
    await open(foldMesh, 'fold.stl')
  })
  afterAll(async () => {
    await open(sheetMesh, 'sheet.stl')
  })

  it('offers the fold as a crease, and a network across it keeps its fold', async () => {
    const found = await run<{ count: number; candidates: { curve: { points: Vec3[]; crease: true }; length: number; angle: number }[] }>('reverse.network.suggest_creases', {})
    expect(found.count).toBeGreaterThan(0)
    const crest = found.candidates[0]
    expect(crest.curve.crease).toBe(true)
    for (const p of crest.curve.points) expect(Math.abs(p[0])).toBeLessThan(1)
    expect(crest.length).toBeGreaterThan(40)
    expect(crest.angle).toBeGreaterThan(20)
    expect(crest.angle).toBeLessThan(40)
    // A candidate alone closes nothing — but it is a curve create takes.
    expect((await refused('reverse.network.create', { curves: [crest.curve] })).message).toMatch(/close no region/)

    // A 1 × 2 network across the fold, its middle curve a crease — where
    // reNetworkFit.test.ts draws it.
    const p = (x: number, y: number): Vec3 => [x, y, Math.abs(x) * Math.tan((15 * Math.PI) / 180)]
    const made = await run<Made>('reverse.network.create', {
      name: 'Fold',
      curves: [
        { points: [p(-32, 6), p(0, 6), p(32, 6)] },
        { points: [p(-32, 54), p(0, 54), p(32, 54)] },
        { points: [p(-32, 6), p(-32, 54)] },
        { points: [p(32, 6), p(32, 54)] },
        { points: [p(0, 6), p(0, 30), p(0, 54)], crease: true },
      ],
    })
    expect(made.result?.status, made.result?.message).toBe('ok')
    expect(made.patches?.length).toBe(2)
    const read = await run<Read>('reverse.network.read', { feature: 'Fold' })
    const crease = read.curves.find((c) => c.id === made.curves[4][0])!
    expect(crease.crease).toBe(true)
    expect(crease.fold).toBeGreaterThan(25)
    expect(crease.fold).toBeLessThan(35)
  })
})
