// SPDX-License-Identifier: AGPL-3.0-only
// A freeform skin fitted without a vertex list going out or back in: a
// surface's region asked for as a box facing a way, with boxes left out,
// or as the points a scan.query marked; a robust fit that leaves a boss
// standing on the skin out and names the points it misses most; and a
// net past the largest refused before anything is built. On a curved
// sheet scanned in the in-process worker, the kernel in this thread — as
// reCommands.test.ts runs it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec3 = [number, number, number]

/** The skin: z = 0.004·x² + 0.006·y² over 50 × 40 mm. */
const skin = (x: number, y: number) => 0.004 * x * x + 0.006 * y * y

/** The skin as an open sheet, its vertices 1 mm apart and a few microns
 *  off it, with a boss 6 × 6 mm standing 3 mm proud on it at (10, 8): its
 *  top faces the way the skin does, and a fit through all the points
 *  facing that way is pulled toward it. */
function sheetWithBoss(): Float32Array {
  const tris: number[] = []
  const at = (x: number, y: number): Vec3 => [x, y, skin(x, y) + 0.003 * Math.sin(3.1 * x + 1.7 * y)]
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => tris.push(...a, ...b, ...c, ...a, ...c, ...d)
  for (let x = -25; x < 25; x++) for (let y = -20; y < 20; y++) quad(at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1))
  // The boss: a box from just under the skin to 3 mm over it, top and sides.
  const z0 = skin(10, 8) - 0.5
  const z1 = skin(10, 8) + 3
  const c = (x: number, y: number, z: number): Vec3 => [x, y, z]
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) quad(c(7 + i, 5 + j, z1), c(8 + i, 5 + j, z1), c(8 + i, 6 + j, z1), c(7 + i, 6 + j, z1))
  quad(c(7, 5, z0), c(13, 5, z0), c(13, 5, z1), c(7, 5, z1))
  quad(c(13, 5, z0), c(13, 11, z0), c(13, 11, z1), c(13, 5, z1))
  quad(c(13, 11, z0), c(7, 11, z0), c(7, 11, z1), c(13, 11, z1))
  quad(c(7, 11, z0), c(7, 5, z0), c(7, 5, z1), c(7, 11, z1))
  return Float32Array.from(tris)
}

interface Added {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string; surface?: { rms: number; max: number; net: { u: number; v: number }; points: number; dropped?: number; worst?: { at: Vec3; off: number }[] } } | null
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(sheetWithBoss()), name: 'skin.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const BOX = { min: [-25, -20, -1], max: [25, 20, 10] }
/** The way the skin faces as the scan has it: an open sheet's normals are
 *  turned away from the side it curls round, down here. */
const FACING = { dir: [0, 0, -1], withinDeg: 40 }

describe('a surface’s region by query', () => {
  it('fits the skin through a box facing up, the boss left out, with no vertex list in or out', async () => {
    const out = await run<Added>('reverse.feature.add', { feature: { kind: 'surface', name: 'Skin', region: { box: BOX, normal: FACING, exclude: [{ min: [6, 4, -1], max: [14, 12, 10] }] } } })
    expect(out.result?.status, out.result?.message).toBe('ok')
    const s = out.result!.surface!
    expect(s.rms).toBeLessThan(0.01)
    expect(s.points).toBeGreaterThan(1500)
    expect(s.worst!.length).toBeGreaterThan(0)
    // The answer names the region by its size, never by its vertices.
    expect(JSON.stringify(out).length).toBeLessThan(4000)
    const stored = useReverse.getState().features.find((f) => f.id === out.feature.id)!
    expect(stored.kind === 'surface' && stored.region instanceof Uint32Array && stored.region.length === s.points).toBe(true)
    const listed = await run<{ region: unknown; fit: { robust?: boolean } }>('reverse.feature.list', { feature: 'Skin' })
    expect(listed.region).toEqual({ points: s.points })
  })

  it('a robust fit leaves the boss out by itself, and says how many points it dropped', async () => {
    const plain = await run<Added>('reverse.feature.add', { feature: { kind: 'surface', name: 'Plain', region: { box: BOX, normal: FACING } } })
    expect(plain.result?.status, plain.result?.message).toBe('ok')
    expect(plain.result!.surface!.dropped).toBeUndefined()
    const robust = await run<Added>('reverse.feature.add', { feature: { kind: 'surface', name: 'Robust', region: { box: BOX, normal: FACING }, fit: { robust: true } } })
    expect(robust.result?.status, robust.result?.message).toBe('ok')
    const r = robust.result!.surface!
    // The boss's top, 36 points or so, goes; the skin stays.
    expect(r.dropped).toBeGreaterThanOrEqual(30)
    expect(r.rms).toBeLessThan(plain.result!.surface!.rms / 5)
    expect(r.rms).toBeLessThan(0.01)
    for (const w of r.worst!) expect(Math.abs(w.off)).toBeLessThan(0.05)
  })

  it('takes the points a scan.query marked', async () => {
    const q = await run<{ returned: number; vertices?: unknown }>('scan.query', { box: { min: [-20, -15, -1], max: [0, 0, 10] }, normal: FACING, fields: 'count', mark: true, limit: 20000 })
    expect(q.vertices).toBeUndefined()
    const out = await run<Added>('reverse.feature.add', { feature: { kind: 'surface', name: 'Corner', region: { marked: true } } })
    expect(out.result?.status, out.result?.message).toBe('ok')
    expect(out.result!.surface!.points).toBe(q.returned)
  })

  it('refuses a region too small, and a net past the largest, before building', async () => {
    expect((await refused('reverse.feature.add', { feature: { kind: 'surface', region: { box: { min: [0, 0, -1], max: [1, 1, 10] }, normal: FACING } } })).message).toMatch(/needs 16 at least/)
    expect((await refused('reverse.feature.add', { feature: { kind: 'surface', region: { box: BOX }, fit: { net: { u: 30, v: 24 } } } })).message).toMatch(/20 × 20 at most/)
    expect((await refused('reverse.feature.add', { feature: { kind: 'surface', region: { box: BOX, marked: true } } })).code).toBe('invalid_input')
    expect(useReverse.getState().features).toHaveLength(0)
  })

  it('takes a region query on an edit too', async () => {
    const out = await run<Added>('reverse.feature.add', { feature: { kind: 'surface', name: 'Edited', region: { box: BOX, normal: FACING, limit: 500 } } })
    expect(out.result!.surface!.points).toBeLessThanOrEqual(500)
    const edited = await run<Added>('reverse.feature.update', { feature: 'Edited', set: { region: { box: { min: [-25, -20, -1], max: [0, 20, 10] }, normal: FACING } } })
    expect(edited.result?.status, edited.result?.message).toBe('ok')
    expect(edited.result!.surface!.points).toBeGreaterThan(500)
  })
})
