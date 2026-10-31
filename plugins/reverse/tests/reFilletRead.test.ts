// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.fillet_read: on the scan of a 40 mm box whose one top edge
// is rounded R2.5 (the rest sharp), a sharp box body's edges are read — the
// rounded one gives its radius back within 0.05 mm with a sigma and the
// nominal, a sharp one says no round, an edge running tangent off a round
// says why it cannot be read. The scan in the in-process worker, the kernel in this
// thread, as reCommandsScan.test.ts runs them.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { sectionPictureModel } from '../../../src/app/sectionPicture'
import { frameTurnedUp, sketchFrameOn } from '../../../src/core/section/frame'
import { projectCut } from '../../../src/core/section/slice'
import { useStore } from '../../../src/state/store'
import { sectionLayers } from '../../../src/commands/sectionLayers'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type P2 = [number, number]

/** The profile of the scanned part in XZ: a 40 mm square about the origin,
 *  its top right corner (x = 20, z = 20) rounded `r`, sampled every `step`
 *  along the flats and in `arcSteps` along the round, each point moved off
 *  the surface by Gaussian noise. */
function profile(r: number, step: number, arcSteps: number, noise: number): P2[] {
  const rand = mulberry32(7)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const out: { p: P2; n: P2 }[] = []
  const line = (a: P2, b: P2, n: P2) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const k = Math.max(1, Math.round(len / step))
    for (let i = 0; i < k; i++) out.push({ p: [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k], n })
  }
  // Counter-clockwise in (x, z): bottom, right, the round, top, left.
  line([-20, -20], [20, -20], [0, -1])
  line([20, -20], [20, 20 - r], [1, 0])
  for (let i = 0; i < arcSteps; i++) {
    const a = (Math.PI / 2) * (i / arcSteps)
    out.push({ p: [20 - r + r * Math.cos(a), 20 - r + r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] })
  }
  line([20 - r, 20], [-20, 20], [0, 1])
  line([-20, 20], [-20, -20], [-1, 0])
  return out.map(({ p, n }) => {
    const d = gauss() * noise
    return [p[0] + d * n[0], p[1] + d * n[1]]
  })
}

/** The profile run along Y from −20 to 20, capped: a closed scan. */
function extruded(points: P2[]): Float32Array {
  const tris: number[] = []
  const at = (p: P2, y: number) => [p[0], y, p[1]]
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    // Outward for a counter-clockwise profile in (x, z) with Y into it.
    tris.push(...at(a, -20), ...at(b, -20), ...at(b, 20))
    tris.push(...at(a, -20), ...at(b, 20), ...at(a, 20))
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    tris.push(0, -20, 0, ...at(b, -20), ...at(a, -20))
    tris.push(0, 20, 0, ...at(a, 20), ...at(b, 20))
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
  await run('scan.open', { bytes: stlBytes(extruded(profile(2.5, 0.4, 24, 0.02))), name: 'rounded.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Read {
  body: { id: number; name: string }
  edges: { edge: number; round: boolean | null; radius?: number; sigma?: number; nominal?: number; off?: number; sigmas?: number | null; residual?: { rms: number; points: number }; radii?: (number | null)[]; places?: string[]; why?: string }[]
  sharp?: { edges: number[]; why: string }
  rounds: number
  median?: number
  spread?: number
}

async function sharpBox() {
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Base', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } } })
  const made = await run<{ bodies: { changed: { id: number }[] } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Base', regions: 'all', extent: { kind: 'distance', from: 0, to: 40 }, op: 'new' } })
  return made.bodies.changed[0].id
}

describe('reverse.body.fillet_read', () => {
  it('reads the round the scan has along a sharp edge, and gathers the sharp ones into one row', async () => {
    const body = await sharpBox()
    const read = await run<Read>('reverse.body.fillet_read', {
      body,
      edges: [{ between: [[0, 0, 1], [1, 0, 0]] }, { between: [[0, 0, 1], [-1, 0, 0]] }, { between: [[0, 0, 1], [0, 1, 0]] }, { between: [[0, 0, 1], [0, -1, 0]] }],
    })
    // The rounded edge a row; the three sharp ones one row, the why once.
    expect(read.edges).toHaveLength(1)
    const [rounded] = read.edges
    expect(rounded.round).toBe(true)
    expect(Math.abs(rounded.radius! - 2.5)).toBeLessThan(0.05)
    expect(rounded.sigma).toBeGreaterThan(0)
    expect(rounded.sigma).toBeLessThan(0.1)
    expect(rounded.nominal).toBe(2.5)
    expect(rounded.sigmas).not.toBeNull()
    expect(rounded.residual!.points).toBeGreaterThan(10)
    expect(rounded.radii).toHaveLength(3)
    expect(read.sharp!.edges).toHaveLength(3)
    expect(read.sharp!.edges).not.toContain(rounded.edge)
    expect(read.sharp!.why).toMatch(/^no round/)
    expect(JSON.stringify(read).match(/no round within/g)).toHaveLength(1)
    expect(read.rounds).toBe(1)
    expect(read.median).toBeCloseTo(rounded.radius!, 6)
  })

  it('says why an edge is not read, and refuses with no such body', async () => {
    const body = await sharpBox()
    await run('reverse.feature.add', { feature: { kind: 'fillet', name: 'Round', body, edges: [{ between: [[0, 0, -1], [0, 1, 0]] }], radius: 3 } })
    // The edges the round made: lines against its cylinder, arcs at its ends.
    const made = await run<{ bodies: { edgeList: { index: number; kind: string }[] }[] }>('reverse.body.describe', { body, where: { madeBy: 'Round' } })
    const edges = made.bodies[0].edgeList
    const line = edges.find((e) => e.kind === 'line')!
    const arc = edges.find((e) => e.kind !== 'line')!
    const read = await run<Read>('reverse.body.fillet_read', { body, edges: [line.index, arc.index] })
    // The line runs tangent off the round: no corner. The arc is a circle
    // edge between the end face and the round's cylinder — read, and the
    // scan sharp there: where the cut does not have the cylinder at all,
    // its places say so.
    expect(read.edges.map((e) => e.round)).toEqual([null, false])
    expect(read.edges[0].why).toMatch(/faces meet tangent/)
    expect(read.edges[1]).toMatchObject({ edge: arc.index, why: expect.stringMatching(/^no round/) })
    expect(read.edges[1].places).toContain('the faces not found in the cut')
    expect(read.edges[1].places!.every((p) => ['sharp', 'the faces not found in the cut'].includes(p))).toBe(true)
    expect(read.sharp).toBeUndefined()
    expect(read.rounds).toBe(0)
    expect(read.median).toBeUndefined()
    expect((await refused('reverse.body.fillet_read', { body: 'Nothing', edges: [0] })).code).toBe('not_found')
  })
})

describe('reverse.sketch.edit rounds', () => {
  type Entity = { id: number; kind: string; a?: [number, number]; b?: [number, number]; c?: [number, number]; r?: number }
  type Listed = { sketch: { entities: Entity[] } }
  type Round = { arc: number; a: number; b: number; radius: number; sigma: number | null; nominal: number; off: number; sigmas: number | null; residual?: { rms: number; points: number }; points: number; held: 'given' | 'points' | 'dimension'; warning?: string }

  it('rounds the corner between two fitted lines to the scan, tangent, in one call, and holds a radius given', async () => {
    // Across the block at y = 0: the sheet's u is Z, v is X; the round is
    // at u = 20, v = 20. The fit draws it as an arc of its own, joined to
    // the lines but not tangent to them; rounding the two lines puts a
    // tangent round in its place, fitted to its points. (The round a fit
    // merged into the lines is reRoundCorner.test.ts's.)
    const cut = await run<{ section: { id: number } }>('section.cut', { across: 'ZX', offset: 0, name: 'Across' })
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Profile', plane: { kind: 'section', id: cut.section.id }, sketch: { fit: {} } } })
    const listed = await run<Listed>('reverse.feature.list', { feature: 'Profile' })
    const lines = listed.sketch.entities.filter((e) => e.kind === 'line')
    const nearCorner = (e: Entity) => Math.min(Math.hypot(e.a![0] - 20, e.a![1] - 20), Math.hypot(e.b![0] - 20, e.b![1] - 20))
    const [a, b] = [...lines].sort((x, y) => nearCorner(x) - nearCorner(y))
    const fittedArc = listed.sketch.entities.find((e) => e.kind === 'arc' && Math.hypot(e.c![0] - 17.5, e.c![1] - 17.5) < 1)
    expect(fittedArc, 'the fit found the round').toBeDefined()
    const edited = await run<{ rounds: Round[]; solve: { ok: boolean } }>('reverse.sketch.edit', { sketch: 'Profile', add: { rounds: [{ a: a.id, b: b.id }] } })
    expect(edited.solve.ok).toBe(true)
    const [round] = edited.rounds
    expect(round.held).toBe('points')
    expect(round.sigma).not.toBeNull()
    expect(Math.abs(round.radius - 2.5)).toBeLessThan(Math.max(2 * round.sigma!, 0.05))
    expect(round.nominal).toBe(2.5)
    expect(round.residual!.points).toBeGreaterThan(5)
    const after = await run<Listed>('reverse.feature.list', { feature: 'Profile' })
    expect(after.sketch.entities.some((e) => e.id === fittedArc!.id), 'the fitted arc replaced').toBe(false)
    // The same corner at a radius given: held.
    await run('history.undo')
    const held = await run<{ rounds: Round[] }>('reverse.sketch.edit', { sketch: 'Profile', add: { rounds: [{ a: a.id, b: b.id, radius: 3 }] } })
    expect(held.rounds[0].held).toBe('given')
    expect(held.rounds[0].radius).toBeCloseTo(3, 6)
    expect((await refused('reverse.sketch.edit', { sketch: 'Profile', add: { rounds: [{ a: a.id, b: a.id }] } })).code).toBe('invalid_input')
  })
})

describe('a section’s picture, through the bodies layer', () => {
  it('shows the one wrong fillet’s gap and nothing else red', async () => {
    // The scan's edge is R2.5; the body's is rounded R1 — wrong — and every
    // other edge sharp, as the scan's are.
    const body = await sharpBox()
    await run('reverse.feature.add', { feature: { kind: 'fillet', body, edges: [{ between: [[0, 0, 1], [1, 0, 0]] }], radius: 1 } })
    const cut = await run<{ section: { id: number } }>('section.cut', { across: 'ZX', offset: 0, name: 'Across' })
    const sec = useStore.getState().sections.find((x) => x.id === cut.section.id)!
    const sheet = { id: sec.id, name: sec.name, origin: sec.frame.origin, normal: sec.frame.normal, basisU: sec.frame.basisU, basisV: sec.frame.basisV }
    const layer = sectionLayers().find((l) => l.key === 'bodies')!
    const drawn = await layer.draw(sheet)
    expect(drawn?.outlines?.length).toBeGreaterThan(0)
    expect(drawn!.outlines!.every((o) => o.label === 'Solid 1')).toBe(true)
    const flat = projectCut(sec.cut!, sec.frame)
    const m = sectionPictureModel({ scan: flat.points, outlines: drawn!.outlines!, pieces: drawn!.pieces ?? [], tolerance: 0.1 })
    expect(m.gap.over).toBeGreaterThan(5)
    // R1 against R2.5: the body stands proud of the scan's round.
    expect(m.gap.inside).toBe(m.gap.over)
    // Every red point within the R2.5 round's reach of the corner — the
    // sheet's (u, v) is (Z, X), the corner at (20, 20).
    const box = m.gap.overBox!
    expect(box.min[0]).toBeGreaterThan(20 - 2.6)
    expect(box.min[1]).toBeGreaterThan(20 - 2.6)
    expect(m.gap.max).toBeLessThan(0.7)
    expect(m.gap.read / m.gap.points).toBeGreaterThan(0.95)
  })

  it('draws a sketch on the section where it lies, though the sheet counts from another zero', async () => {
    const cut = await run<{ section: { id: number } }>('section.cut', { across: 'ZX', offset: 0, name: 'Shifted' })
    const sec = useStore.getState().sections.find((x) => x.id === cut.section.id)!
    // A sketch counts from the world origin's foot on its plane; a section's
    // sheet from the part's centre — here moved 5 along Z and 3 along X.
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'On it', plane: { kind: 'section', id: sec.id }, sketch: { entities: [{ id: 1, kind: 'line', a: [1, 2], b: [4, 2] }] } } })
    const shift = [3, 0, 5]
    const sheet = { id: sec.id, name: sec.name, origin: [sec.frame.origin[0] + shift[0], sec.frame.origin[1], sec.frame.origin[2] + shift[2]] as [number, number, number], normal: sec.frame.normal, basisU: sec.frame.basisU, basisV: sec.frame.basisV }
    const drawn = await sectionLayers().find((l) => l.key === 'bodies')!.draw(sheet)
    const piece = drawn!.pieces!.find((p) => p.label === '1')!
    // On the ZX plane u is Z and v is X: the sketch's [1, 2] is Z 1, X 2,
    // which the shifted sheet reads less its zero's Z and X.
    const [ox, , oz] = sheet.origin
    expect(piece.points[0][0]).toBeCloseTo(1 - oz, 9)
    expect(piece.points[0][1]).toBeCloseTo(2 - ox, 9)
    expect(piece.points[piece.points.length - 1][0]).toBeCloseTo(4 - oz, 9)
  })

  it('draws a sketch on a coordinate plane on a sheet of that plane, turned Z up, and not one slid off it', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Side', plane: { kind: 'world', axis: 'y', offset: 0 }, sketch: { entities: [{ id: 1, kind: 'line', a: [1, 2], b: [4, 2] }] } } })
    // A sheet of a picture alone, as section.render { plane, up: "z" } lays
    // it: no section, u along X and v along Z.
    const sheet = { id: 0, name: 'Cut', ...frameTurnedUp(sketchFrameOn({ origin: [0, 0, 0], normal: [0, 1, 0] })!, 'z')! }
    expect(sheet.basisU.map((v) => v + 0)).toEqual([1, 0, 0])
    expect(sheet.basisV.map((v) => v + 0)).toEqual([0, 0, 1])
    const drawn = await sectionLayers().find((l) => l.key === 'bodies')!.draw(sheet)
    const piece = drawn!.pieces!.find((p) => p.label === '1')!
    // The sketch's [1, 2] on the ZX plane is Z 1, X 2: on the turned sheet
    // X 2 across and Z 1 up.
    expect(piece.points[0][0]).toBeCloseTo(2, 9)
    expect(piece.points[0][1]).toBeCloseTo(1, 9)
    expect(piece.points[piece.points.length - 1][1]).toBeCloseTo(4, 9)
    // The same sheet slid 5 along Y, as an offsets tile is: nothing of it.
    const slid = { ...sheet, origin: [0, 5, 0] as [number, number, number] }
    expect((await sectionLayers().find((l) => l.key === 'bodies')!.draw(slid))?.pieces ?? []).toEqual([])
  })

  it('section.render needs the browser', async () => {
    const cut = await run<{ section: { id: number } }>('section.cut', { across: 'ZX', offset: 0 })
    expect((await refused('section.render', { section: cut.section.id })).code).toBe('unavailable')
  })
})


