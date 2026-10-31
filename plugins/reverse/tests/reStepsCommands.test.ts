// SPDX-License-Identifier: AGPL-3.0-only
// Steps between features through the commands, as an agent meets them: the
// second plan sketch, drawn 0.07 mm off the first's wall, says the near
// miss and the fix when it is added; the join on it says the step on its
// row and in its answer (stepsBetween); the body check lists it first, by the
// pair of features, and counts it (stepsBetweenFeatures). And — behind
// RE_STEPS_CHECKPOINT — what the build and the check say of a saved
// project as it was: round 18's r1, the clamp's checkpoint 03.
import { existsSync, readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { applyReversePart, type ReversePart } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { auditBody } from '../core/audit'
import { Builder } from '../core/build'
import type { SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { ReClient } from '../core/reClient'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { nearMissFix, sketchNearMisses } from '../core/sketchNearMiss'
import { stepsWarning } from '../core/stepWords'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

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
beforeEach(resetReverse)

const planOf = (name: string, z: number, x: number) => ({
  kind: 'sketch',
  name,
  plane: { kind: 'world', axis: 'z', offset: z },
  sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [0, 0], to: [x, 8], fixed: true }] },
})

interface Step { form: string; offMm: number; face: { feature: string; sketch?: string; piece?: number }; other: { feature: string; sketch?: string; piece?: number }; note: string }

describe('steps between features, through the commands', () => {
  it('says the near miss at the second sketch, the step at the join, and lists it first in the check', async () => {
    await run('reverse.feature.add', { feature: planOf('Plan upper', 0, 10.91) })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Upper', sketchId: 'Plan upper', regions: 'all', extent: { kind: 'distance', from: 0, to: 4.35 }, op: 'new' } })
    const wing = await run<{ nearSketches?: { piece: number; sketch: string; other: number; offMm: number }[]; nearSketchesFix?: string }>('reverse.feature.add', { feature: planOf('Plan wing', 4.35, 10.98) })
    expect(wing.nearSketches).toEqual([{ piece: expect.any(Number), sketch: 'Plan upper', other: expect.any(Number), offMm: 0.07 }])
    expect(wing.nearSketchesFix).toMatch(/project: \[\{ sketch: "Plan upper", pieces: \[\d+\] \}\]/)
    expect(wing.nearSketchesFix).toContain('fit: { level: 4.35 }')

    const join = await run<{ stepsBetween?: Step[]; stepsBetweenFound?: number; feature: { warning?: string } }>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Wing', sketchId: 'Plan wing', regions: 'all', extent: { kind: 'distance', from: 0, to: 0.85 }, op: 'join' } })
    expect(join.stepsBetween).toHaveLength(1)
    expect(join.stepsBetween![0]).toMatchObject({ form: 'flat', offMm: 0.07, face: { feature: 'Wing', sketch: 'Plan wing' }, other: { feature: 'Upper', sketch: 'Plan upper' } })
    expect(join.feature.warning).toMatch(/^A step between features: Wing's wall \(x 10\.98, line \d+ of Plan wing\) stands 0\.07 mm off Upper's \(x 10\.91, line \d+ of Plan upper\): one wall drawn twice/)
    // Detail none keeps it.
    const none = await run<{ stepsBetween?: Step[] }>('reverse.feature.update', { feature: 'Wing', set: { extent: { kind: 'distance', from: 0, to: 0.9 } }, detail: 'none' })
    expect(none.stepsBetween?.[0]).toMatchObject({ form: 'flat', offMm: 0.07 })

    const check = await run<{ bodies: { stepsBetweenFeatures: number; valid: boolean; steps?: { between: string[]; count: number; off: number; form: string }[] }[] }>('reverse.body.check', { audit: true })
    const body = check.bodies[0]
    expect(body.stepsBetweenFeatures).toBe(1)
    expect(body.steps?.[0]).toMatchObject({ between: ['Upper', 'Wing'], count: 1, off: 0.07, form: 'flat' })
  })
})

// ---- a saved project as it was ---------------------------------------------------

const checkpoint = process.env.RE_STEPS_CHECKPOINT ?? ''

describe.skipIf(!checkpoint || !existsSync(checkpoint))('a saved project’s steps between features', () => {
  it(`says what ${checkpoint.split(/[\\/]/).pop()} has`, async () => {
    const zip = unzipSync(readFileSync(checkpoint))
    const manifest = JSON.parse(strFromU8(zip['project.json']))
    applyReversePart(manifest.reverse as ReversePart)
    const features = useReverse.getState().features
    const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
    const sketches = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
    // Built once without the steps told, for the time they take.
    const kernel = await ReKernel.load()
    const bare = new Builder(kernel)
    ;(bare as unknown as { noteStepsBetween: () => void }).noteStepsBetween = () => {}
    let started = performance.now()
    bare.build(steps, (id) => sketches.get(id))
    const bareMs = performance.now() - started
    const builder = new Builder(kernel)
    started = performance.now()
    const r = builder.build(steps, (id) => sketches.get(id))
    const ms = performance.now() - started
    const lines: string[] = [`built in ${Math.round(ms)} ms (${Math.round(bareMs)} ms without the steps told)`]
    for (const res of r.results) {
      if (!res.stepsBetween?.length) continue
      const f = features.find((x) => x.id === res.id)
      lines.push(`U5 ${f?.name ?? res.id} (${res.stepsBetween.length}): ${stepsWarning(res.stepsBetween, features)}`)
    }
    for (const b of r.bodies) {
      if (b.surface) continue
      const { findings, stepsBetweenFeatures } = auditBody(b.topology.faces, b.topology.edges)
      lines.push(`U6 ${b.name}: stepsBetweenFeatures ${stepsBetweenFeatures}`)
      for (const s of findings.filter((x) => x.kind === 'step')) {
        const name = (id: number) => features.find((x) => x.id === id)?.name ?? String(id)
        lines.push(`  ${s.between ? s.between.map(name).join(' + ') : '?'} ${s.form} ×${s.count} widest ${s.off} mm at (${s.at.map((v) => Math.round(v * 100) / 100).join(', ')})${s.hair ? ' hair' : ''}`)
      }
    }
    // Each sketch as it was made: against the sketches before it.
    const made: SketchFeature[] = []
    for (const f of features) {
      if (f.kind !== 'sketch') continue
      const { misses, found } = sketchNearMisses(f, made)
      if (found > 0) lines.push(`U7 ${f.name}: ${found} near misses, the nearest ${misses.slice(0, 4).map((m) => `${m.piece}~${m.sketch}:${m.other} ${m.offMm}`).join(', ')} — ${nearMissFix(f, misses, made)}`)
      made.push(f)
    }
    console.log(lines.join('\n'))
    expect(r.results.length).toBeGreaterThan(0)
  })
})
