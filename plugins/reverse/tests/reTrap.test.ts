// SPDX-License-Identifier: AGPL-3.0-only
// The kernel trapping inside its WebAssembly — an `unreachable` mid-round,
// as OCCT does now and then — leaves it broken: the worker's service must
// let it go, start a fresh one, and build the part again on it without the
// step it trapped on, that step saying so; the next build must not play it
// again until it is changed. Here a kernel whose round traps once stands
// in for the real thing.

import { describe, expect, it } from 'vitest'
import { OcctError } from 'occt-wasm'
import { ReKernel } from '../core/kernel'
import { KernelTrap } from '../core/kernelOps'
import type { ReWorkerResponse } from '../core/reService'
import { createReService } from '../core/reService'
import { resolveFeatures } from '../core/resolve'
import { findRegions } from '../core/regions'
import type { Feature, FilletFeature, OffsetBodyFeature, SketchFeature } from '../core/features'
import { Builder } from '../core/build'
import { addRectangle } from '../core/sketch'
import { extrudeAll, sketchOf } from './reKit'
import { loadManifold } from './reLocal'

/** A plate and a round on one of its upright corners. */
async function plate(radius: number): Promise<Feature[]> {
  const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
  const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new')]
  const probe = new Builder(await ReKernel.load())
  const r = request(base)
  probe.build(r.steps, r.sketchOf)
  const corner = probe.topologyOf(2)!.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99)!
  probe.dispose()
  return [...base, { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius, visible: true } as FilletFeature]
}

function request(features: Feature[]) {
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch] as [number, typeof f.sketch])
  const byId = new Map(sketches)
  return { steps, sketches, sketchOf: (id: number) => byId.get(id) }
}

describe('a kernel that traps', () => {
  it('is started again, the part built without the step it trapped on, which says so', async () => {
    let loads = 0
    let traps = 1
    const kernels: ReKernel[] = []
    // Each load a kernel of its own; the first round on the first traps.
    const load = async () => {
      loads++
      const k = await ReKernel.load()
      const raw = (k as unknown as { occt: Record<string, (...a: unknown[]) => unknown> }).occt
      const fillet = raw.filletWithHistory.bind(raw)
      raw.filletWithHistory = (...a: unknown[]) => {
        if (traps > 0 && kernels.length === 1) {
          traps--
          throw new WebAssembly.RuntimeError('unreachable')
        }
        return fillet(...a)
      }
      kernels.push(k)
      return k
    }
    const service = createReService(load, loadManifold)
    const build = async (features: Feature[]) => {
      const r = request(features)
      const { response } = await service.handle({ type: 'build', requestId: 1, steps: r.steps, sketches: r.sketches })
      return response as Extract<ReWorkerResponse, { type: 'build-ok' }>
    }

    const first = await build(await plate(2))
    expect(first.type).toBe('build-ok')
    expect(loads).toBe(2)
    const round = first.results.find((x) => x.id === 3)!
    expect(round.status).toBe('failed')
    expect(round.message).toMatch(/^The CAD kernel crashed on this step \(.*unreachable.*\) and was started again/)
    // The plate itself built on the fresh kernel, whole.
    expect(first.results.find((x) => x.id === 2)?.status).toBe('ok')
    expect(first.all).toHaveLength(1)
    expect(first.bodies[0].volume).toBeCloseTo(30 * 20 * 5, 6)

    // The same list again: the step left out, not played — no trap, no
    // restart.
    const again = await build(await plate(2))
    expect(loads).toBe(2)
    expect(again.results.find((x) => x.id === 3)?.message).toMatch(/crashed on this step/)

    // Changed, it is played again, and builds.
    const changed = await build(await plate(2.5))
    expect(loads).toBe(2)
    expect(changed.results.find((x) => x.id === 3)?.status).toBe('ok')
    expect(changed.bodies[0].volume).toBeLessThan(30 * 20 * 5)
  })
})

describe('a trap occt-wasm hands on in its own error', () => {
  it('is a trap: "null function or function signature mismatch" inside an OcctError restarts the kernel', async () => {
    let loads = 0
    const load = async () => {
      loads++
      const k = await ReKernel.load()
      if (loads === 1) {
        const raw = (k as unknown as { occt: Record<string, (...a: unknown[]) => unknown> }).occt
        raw.filletWithHistory = () => {
          throw new OcctError('filletWithHistory', 'null function or function signature mismatch')
        }
      }
      return k
    }
    const service = createReService(load, loadManifold)
    const r = request(await plate(2))
    const { response } = await service.handle({ type: 'build', requestId: 1, steps: r.steps, sketches: r.sketches })
    const built = response as Extract<ReWorkerResponse, { type: 'build-ok' }>
    expect(built.type).toBe('build-ok')
    expect(loads).toBe(2)
    expect(built.results.find((x) => x.id === 3)?.message).toMatch(/^The CAD kernel crashed on this step \(.*null function.*\) and was started again/)
  })

  it('says why after the crash: the step diagnosed on the fresh kernel', async () => {
    let loads = 0
    const load = async () => {
      loads++
      const k = await ReKernel.load()
      if (loads === 1) {
        k.offsetSolid = () => {
          throw new KernelTrap('Offsetting: memory access out of bounds')
        }
      }
      return k
    }
    const service = createReService(load, loadManifold)
    // The plate's round of 1 mm, offset inward by 2: the round shrinks to
    // nothing, which the diagnosis finds without offsetting the body.
    const features: Feature[] = [...(await plate(1)), { id: 4, kind: 'offsetBody', name: 'Wall', body: 2, distance: -2, keep: false, visible: true } as OffsetBodyFeature]
    const build = async () => {
      const r = request(features)
      const { response } = await service.handle({ type: 'build', requestId: 1, steps: r.steps, sketches: r.sketches })
      return response as Extract<ReWorkerResponse, { type: 'build-ok' }>
    }
    const first = await build()
    expect(loads).toBe(2)
    const offset = first.results.find((x) => x.id === 4)!
    expect(offset.status).toBe('failed')
    expect(offset.message).toMatch(/^The CAD kernel crashed on this step \(.*memory access out of bounds.*\) and was started again; the part was built again without it\. The body does not offset inward by 2 mm: an outside round is no larger than that — face \d+/)
    expect(offset.message).toMatch(/Change the step to try it again\.$/)
    // The round itself built on the fresh kernel.
    expect(first.results.find((x) => x.id === 3)?.status).toBe('ok')
    // The next build keeps the words, without playing the step.
    const again = await build()
    expect(loads).toBe(2)
    expect(again.results.find((x) => x.id === 4)?.message).toBe(offset.message)
  })
})
