// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.fillet_read and "fit" on a body's circle edges, through the
// kernel: the scan of a plate with a Ø10 boss rounded R1 at its foot and a
// Ø6 hole countersunk 90° × Ø12; the model the same plate, boss and hole
// with every edge sharp. The foot reads R1, the boss's top no round, the
// hole's mouth a 90° countersink; a fillet's radius and a chamfer's
// distance fitted on them, and fitted again from the stored edges.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'
import { arc, circleOutline, line, soup, sweep } from './sweptScan'

vi.setConfig({ testTimeout: 180_000 })

const STEP = 0.05

function scan(): Float32Array {
  const r = 1
  const boss = sweep(circleOutline(5), [...line([12, 0], [r, 0], [0, 1], STEP), ...arc([r, r], r, -Math.PI / 2, -Math.PI, true, STEP / 2), ...line([0, r], [0, 6], [1, 0], STEP), ...line([0, 6], [-4.5, 6], [0, 1], STEP)], 0.01, 3)
  const hole = sweep(circleOutline(3, 360, [40, 0]), [...line([12, 0], [3, 0], [0, 1], STEP), ...line([3, 0], [0, -3], [-Math.SQRT1_2, Math.SQRT1_2], STEP), ...line([0, -3], [0, -4], [-1, 0], STEP), ...line([0, -4], [12, -4], [0, -1], STEP)], 0.01, 4)
  return soup(boss, hole)
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(scan()), name: 'plate.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const FOOT = { kind: 'circle', box: { min: [-6, -6, -0.2], max: [6, 6, 0.2] } }
const TOP = { kind: 'circle', box: { min: [-6, -6, 5.8], max: [6, 6, 6.2] } }
const MOUTH = { kind: 'circle', box: { min: [36, -4, -0.2], max: [44, 4, 0.2] } }

async function plate(): Promise<number> {
  const at = (offset: number) => ({ kind: 'world', axis: 'z', offset })
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Base', plane: at(-4), sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [20, 0], size: [70, 34], fixed: true }] } } })
  const made = await run<{ bodies: { changed: { id: number }[] } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Plate', sketchId: 'Base', regions: 'all', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' } })
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'BossSketch', plane: at(0), sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 5 }] } } })
  await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Boss', sketchId: 'BossSketch', regions: 'all', extent: { kind: 'distance', from: 0, to: 6 }, op: 'join' } })
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'HoleSketch', plane: at(0), sketch: { entities: [{ id: 1, kind: 'circle', c: [40, 0], r: 3 }] } } })
  await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Hole', sketchId: 'HoleSketch', regions: 'all', extent: { kind: 'distance', from: 0, to: -4 }, op: 'cut' } })
  return made.bodies.changed[0].id
}

type Edge = { edge: number; mid: number[]; round?: boolean | null; chamfer?: boolean | null; radius?: number; distance?: number; sigma?: number; setbacks?: [number, number]; countersink?: { angleDeg: number; diameter: number; depth: number; sigma: Record<string, number> }; why?: string }
type Fitted = { value: number; sigma: number | null; nominal: number }

describe('rounds and countersinks on a body’s circle edges', () => {
  it('reads the boss’s foot R1, its top sharp, and the hole’s mouth a 90° × Ø12 countersink', async () => {
    const body = await plate()
    const rounds = await run<{ edges: Edge[]; rounds: number; sharp?: { edges: number[]; why: string } }>('reverse.body.fillet_read', { body, edges: [FOOT, TOP] })
    expect(rounds.edges).toHaveLength(1)
    const [foot] = rounds.edges
    expect(foot.round, foot.why).toBe(true)
    expect(Math.abs(foot.radius! - 1)).toBeLessThan(0.04)
    // The top sharp: gathered into sharp, not a row of its own.
    expect(rounds.sharp?.edges).toHaveLength(1)
    expect(rounds.sharp!.edges[0]).not.toBe(foot.edge)
    // A row says where its edge is: the foot's middle on the plate, on the
    // boss's rim.
    expect(foot.mid[2]).toBeCloseTo(0, 6)
    expect(Math.hypot(foot.mid[0], foot.mid[1])).toBeCloseTo(5, 4)
    const mouth = await run<{ edges: Edge[]; chamfers: number }>('reverse.body.fillet_read', { body, edges: [MOUTH], shape: 'chamfer' })
    const m = mouth.edges[0]
    expect(m.chamfer, m.why).toBe(true)
    expect(Math.abs(m.distance! - 3)).toBeLessThan(0.1)
    expect(Math.abs(m.countersink!.angleDeg - 90)).toBeLessThan(2)
    expect(Math.abs(m.countersink!.diameter - 12)).toBeLessThan(0.2)
    expect(Math.abs(m.countersink!.depth - 3)).toBeLessThan(0.1)
    expect(mouth.chamfers).toBe(1)
  })

  it('fits a fillet’s radius and a chamfer’s distance on circle edges, and fits them again from the stored edges', async () => {
    const body = await plate()
    const round = await run<{ feature: { status: string }; fitted: Record<string, Fitted> }>('reverse.feature.add', { feature: { kind: 'fillet', name: 'Foot', body, edges: [FOOT], radius: 'fit' } })
    expect(round.feature.status).toBe('ok')
    expect(Math.abs(round.fitted.radius.value - 1)).toBeLessThan(0.04)
    expect(round.fitted.radius.nominal).toBe(1)
    const again = await run<{ fitted: Record<string, Fitted> }>('reverse.feature.refit', { feature: 'Foot', fields: ['radius'] })
    expect(Math.abs(again.fitted.radius.value - round.fitted.radius.value)).toBeLessThan(1e-6)
    const cham = await run<{ feature: { status: string }; fitted: Record<string, Fitted> }>('reverse.feature.add', { feature: { kind: 'chamfer', name: 'Sink', body, edges: [MOUTH], distance: 'fit' } })
    expect(cham.feature.status).toBe('ok')
    expect(Math.abs(cham.fitted.distance.value - 3)).toBeLessThan(0.1)
  })
})
