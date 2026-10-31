// SPDX-License-Identifier: AGPL-3.0-only
// A build shared out between kernels: the steps grouped by the bodies they
// work on, a helper kernel building one group while the main one builds
// the other, and the build of the whole list taking both over — the same
// bodies and results as a build on one kernel, by every step played once.

import { describe, expect, it } from 'vitest'
import { groupSteps } from '../core/buildGroups'
import type { BuildStep, Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { createReService, type ReWorkerResponse } from '../core/reService'
import type { HelperPool } from '../core/reParallel'
import { addRectangle } from '../core/sketch'
import { extrudeAll, sketchOf } from './reKit'
import { loadManifold, localHelpers } from './reLocal'

/** What the kernel worker is sent for a list of features. */
function request(features: Feature[], extra: BuildStep[] = []) {
  const steps = [...resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch)), ...extra]
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch] as [number, typeof f.sketch])
  return { steps, sketches }
}

/** A plate and a block, each a body of its own and each rounded on an
 *  upright edge — two groups with a round each, worth sharing out. */
function twoParts(plateWidth = 40, blockWidth = 10) {
  const plate = sketchOf(1, (s) => addRectangle(s, [0, 0], [plateWidth, 20]))
  const block = sketchOf(5, (s) => addRectangle(s, [60, 0], [60 + blockWidth, 10]))
  const corner = (id: number, body: number, x: number, h: number): BuildStep => ({
    kind: 'fillet',
    id,
    name: `Round ${id}`,
    body,
    edges: [{ kind: 'line', mid: [x, 0, h / 2], dir: [0, 0, 1], length: h, faces: [{ kind: 'plane', dir: [0, -1, 0] }, { kind: 'plane', dir: [-1, 0, 0] }], origin: body }],
    radius: 1,
    chain: false,
  })
  return request([plate, extrudeAll(2, plate, 0, 5, 'new'), block, extrudeAll(6, block, 0, 6, 'new')], [corner(7, 2, 0, 5), corner(8, 6, 60, 6)])
}

/** The kernel with its rounds counted. */
async function countedKernel() {
  const kernel = await ReKernel.load()
  const rounds = { n: 0 }
  const original = kernel.filletTracked.bind(kernel)
  kernel.filletTracked = (...args) => {
    rounds.n++
    return original(...args)
  }
  return { kernel, rounds }
}

async function built(service: ReturnType<typeof createReService>, req: ReturnType<typeof request>, requestId: number) {
  const { response } = await service.handle({ type: 'build', requestId, steps: req.steps, sketches: req.sketches })
  if (response.type !== 'build-ok') throw new Error(response.type === 'error' ? response.message : response.type)
  return response as Extract<ReWorkerResponse, { type: 'build-ok' }>
}

const signature = (r: Extract<ReWorkerResponse, { type: 'build-ok' }>) => ({
  results: r.results,
  bodies: r.bodies.map((b) => [b.id, b.name, b.faces, Math.round(b.volume * 1000), b.closed]),
})

describe('the steps in groups', () => {
  it('puts steps on bodies of their own apart, and steps that read every body with all of them', () => {
    const r = twoParts()
    const ids = (g: { steps: number[] }) => g.steps.map((i) => r.steps[i].id)
    const sketches = new Map(r.sketches)
    const { groups, dirty } = groupSteps(r.steps, (id) => sketches.get(id), r.steps.map((s) => s.id === 2))
    expect(groups.map(ids)).toEqual([
      [2, 7],
      [6, 8],
    ])
    // The plate changed: the plate and its round to play, the block and
    // its round not.
    expect(r.steps.filter((_, i) => dirty[i]).map((s) => s.id)).toEqual([2, 7])

    // A boss joined to whatever it meets reads every body: one group.
    const boss: BuildStep = { kind: 'extrude', id: 9, name: 'Boss', sketchId: 99, profiles: [], dir: [0, 0, 1], origin: [0, 0, 0], from: 0, to: 1, draftDeg: 0, op: 'join', regions: [] }
    expect(groupSteps([...r.steps, boss], (id) => sketches.get(id)).groups.map((g) => g.steps.length)).toEqual([5])
    // A Combine of the two: one group; the block gone into the plate, a
    // round on it later is in it too.
    const combine: BuildStep = { kind: 'boolean', id: 9, name: 'Combine', op: 'join', body: 2, tool: 6 }
    const later: BuildStep = { kind: 'shell', id: 10, name: 'Shell', body: 6, faces: [], thickness: 1 }
    expect(groupSteps([...r.steps, combine, later], (id) => sketches.get(id)).groups.map((g) => g.steps.length)).toEqual([6])
    // A split that keeps what lies on the scan reads the scan.
    const split: BuildStep = { kind: 'split', id: 9, name: 'Split', body: 6, tools: [], keep: 'scan', tolerance: 0.1, overlap: 0.5 }
    expect(groupSteps([...r.steps, split], (id) => sketches.get(id)).groups.map((g) => g.scan)).toEqual([false, true])
  })
})

describe('a build shared out between kernels', () => {
  it('builds a group on a helper, takes its steps over, and comes out as a build on one kernel', async () => {
    const serial = createReService(() => ReKernel.load(), loadManifold)
    const main = await countedKernel()
    // Shared out whatever the work: these parts build in milliseconds.
    const helpers = localHelpers(1, { minMs: 0 })
    const shared = createReService(async () => main.kernel, loadManifold, helpers)

    const first = twoParts()
    const alone = await built(serial, first, 1)
    const both = await built(shared, first, 1)
    expect(signature(both)).toEqual(signature(alone))
    expect(both.results.every((r) => r.status === 'ok')).toBe(true)
    // The helper built one part, round and all; the main kernel the other,
    // and took the helper's over without playing it again.
    expect(helpers.asked).toEqual([1])
    expect(main.rounds.n).toBe(1)

    // The body a helper built, as it stood before its round, for editing
    // the round.
    const stage = await shared.handle({ type: 'stage', requestId: 2, stepId: 8, bodyId: 6 })
    expect(stage.response.type === 'stage-ok' && stage.response.stage?.mesh.indices.length).toBeGreaterThan(0)

    // The plate changed alone: one group to build, built here.
    const wider = twoParts(50)
    expect(signature(await built(shared, wider, 3))).toEqual(signature(await built(serial, wider, 3)))
    expect(helpers.asked).toEqual([1])
    expect(main.rounds.n).toBe(2)

    // Both changed: the block goes back to the helper that built it, the
    // plate is built here.
    const bigger = twoParts(60, 14)
    expect(signature(await built(shared, bigger, 4))).toEqual(signature(await built(serial, bigger, 4)))
    expect(helpers.asked).toEqual([1, 1])
    expect(main.rounds.n).toBe(3)

    // The plate of the build before, the block of this one: every step
    // taken over from one kept build or the other, nothing played anywhere.
    const mixed = twoParts(50, 14)
    expect(signature(await built(shared, mixed, 5))).toEqual(signature(await built(serial, mixed, 5)))
    expect(helpers.asked).toEqual([1, 1])
    expect(main.rounds.n).toBe(3)
  })

  it('builds what a failed helper did not, here', async () => {
    const failing: HelperPool = {
      size: 1,
      request: () => Promise.reject(new Error('The helper is gone.')),
    }
    const serial = createReService(() => ReKernel.load(), loadManifold)
    const shared = createReService(() => ReKernel.load(), loadManifold, failing)
    const parts = twoParts()
    expect(signature(await built(shared, parts, 1))).toEqual(signature(await built(serial, parts, 1)))
    const changed = twoParts(45, 12)
    expect(signature(await built(shared, changed, 2))).toEqual(signature(await built(serial, changed, 2)))
  })
})
