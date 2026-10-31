// SPDX-License-Identifier: AGPL-3.0-only
// The clamp's base as one sketch of four levels, on the real scan: run when
// RE_CLAMP names the project the scan is taken from
// (Desktop/reverseengineer/15_clamp/15_clamp_05-before-master-plan.scanruler).
// The deck fitted at z 5.2, then the wing (z 4.35), the barb (z 4.2) and the
// notch roof (z 4.0) fitted into the same sketch with fit.level; four
// regions extruded to their heights and joined, and the body checked for
// steps between them. Prints what it finds.

import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { rigidApplyToPoints } from '../../../src/core/deviation/rigid'
import { parseOBJ } from '../../../src/core/parsers/obj'
import { rigidFromJson } from '../../../src/core/project/manifest'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'

const file = process.env.RE_CLAMP ?? ''

vi.setConfig({ testTimeout: 1_200_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

type Vec2 = [number, number]

describe.skipIf(!file)('the clamp’s base in one sketch of four levels', () => {
  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    const zip = unzipSync(readFileSync(file))
    const manifest = JSON.parse(strFromU8(zip['project.json']))
    const mesh = parseOBJ(zip[manifest.scan.member].slice().buffer)
    // As a soup, in the frame the project aligned it to.
    const soup = mesh.indices ? Float32Array.from(Array.from(mesh.indices, (v) => [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]]).flat()) : mesh.positions
    if (manifest.scan.appliedAlignment) rigidApplyToPoints(rigidFromJson(manifest.scan.appliedAlignment), soup)
    await run('scan.open', { bytes: stlBytes(soup), name: 'Clamp.stl', discard: true })
  }, 600_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless?.stop()
  })

  it('fits the deck and three levels into one sketch, extruded and joined with no step between them', async () => {
    const say = (what: string, x: unknown) => console.log(`${what}: ${JSON.stringify(x)}`)
    type Answer = { fitted?: { chain: number; level?: number; closed?: boolean; pieces?: { id: number; kind: string }[]; skipped?: string; reaches?: object; drawn?: true }[]; shared?: { piece: number; points: number; offMm: { mean: number; max: number }; level: number }[]; junctions?: unknown[]; corners?: number; regions?: { at: Vec2; area: number }[]; offPiece?: unknown[]; moved?: unknown; solve?: unknown }
    const deck = await run<Answer>('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plan', plane: { kind: 'world', axis: 'z', offset: 5.2 }, sketch: { fit: { chains: 'largest', tolerance: 0.05 } } } })
    say('deck fitted', deck.fitted)
    say('deck regions', deck.regions)
    const levels: Answer[] = []
    // Each level's own feature, in a box round it (the r2 plan's pieces
    // 510–513, 520–523, 530–534): the wing, the barb and the notch roof —
    // shared at the part's T, 0.15 (RE_CLAMP_SHARE), as the guide asks.
    // RE_CLAMP_WHOLE fits each level's whole outline instead.
    const share = Number(process.env.RE_CLAMP_SHARE ?? 0.15)
    const boxes: [number, { min: [number, number]; max: [number, number] }][] = [
      [4.35, { min: [10.4, -9.6], max: [16.5, 8.2] }],
      [4.2, { min: [9.5, -28.8], max: [17.5, -15] }],
      [4.0, { min: [7.4, -26.5], max: [12.6, -17.4] }],
    ]
    for (const [z, box] of boxes) {
      const a = await run<Answer>('reverse.sketch.edit', { sketch: 'Plan', add: { fit: { ...(process.env.RE_CLAMP_WHOLE ? {} : { within: box }), chains: 'largest', tolerance: 0.05, share, level: Number((z - 5.2).toFixed(2)) } } })
      say(`z ${z} fitted`, a.fitted)
      say(`z ${z} shared`, a.shared)
      say(`z ${z} junctions`, a.junctions)
      say(`z ${z} corners`, a.corners)
      say(`z ${z} offPiece`, a.offPiece)
      say(`z ${z} regions`, a.regions)
      say(`z ${z} moved`, a.moved)
      levels.push(a)
    }
    const regions = levels.at(-1)!.regions!
    expect(regions.length).toBeGreaterThan(0)
    // The regions extruded to their heights as the r2 plan's were (z 0…7,
    // the wing 0…4.5, the barb 0…4.2, the notch roof 4…7), each found by a
    // point near where the plan's lay; slivers under 1 mm² left out.
    const near = (p: Vec2) => regions.filter((r) => r.area > 1).sort((a, b) => Math.hypot(a.at[0] - p[0], a.at[1] - p[1]) - Math.hypot(b.at[0] - p[0], b.at[1] - p[1]))[0]
    const deckRegion = regions[0]
    const plan: [string, Vec2, number, number][] = [['Wing pad', [12.4, 0], -5.2, -0.7], ['Barb pad', [14.5, -20.2], -5.2, -1], ['Notch roof', [10.1, -22.2], -1.2, 1.8]]
    const made = await run<{ result: { status: string; message?: string } | null; bodies: { changed?: { id: number }[] } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Upper', sketchId: 'Plan', regions: [{ at: deckRegion.at }], extent: { kind: 'distance', from: -5.2, to: 1.8 }, op: 'new' } })
    say('Upper', made.result)
    const used = new Set([deckRegion])
    for (const [name, at, from, to] of plan) {
      const r = near(at)
      if (!r || used.has(r) || Math.hypot(r.at[0] - at[0], r.at[1] - at[1]) > 4) {
        say(name, 'no region near')
        continue
      }
      used.add(r)
      const x = await run<{ result: { status: string; message?: string; warning?: string } | null }>('reverse.feature.add', { feature: { kind: 'extrude', name, sketchId: 'Plan', regions: [{ at: r.at }], extent: { kind: 'distance', from, to }, op: 'join' } })
      say(name, { region: r, result: x.result })
    }
    const body = made.bodies.changed![0].id
    const check = await run<{ valid: boolean; closed: boolean; steps?: unknown[]; warnings?: string[]; narrow?: unknown[]; tiny?: unknown[] }>('reverse.body.check', { body, stepMm: 0.15 })
    say('check', check)
    say('check warnings', check.warnings)
  })
})
