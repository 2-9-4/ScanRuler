// SPDX-License-Identifier: AGPL-3.0-only
// The worker hands its answers' buffers on rather than copying them. The
// stage of a feature — the body as it stood before it, what an edit picks
// on — came out of the build's kept topology itself, so handing it on left
// the kept one's edges empty: the second stage of that feature could not be
// sent (the request never answered, every change after it held behind it)
// and a build back to before the feature failed whole. Here the answers go
// through a structured clone that transfers, as postMessage does — the
// in-thread transport the other tests use copies nothing and never saw it.

import { describe, expect, it } from 'vitest'
import { ReKernel } from '../core/kernel'
import type { ReAnswer, ReWorkerRequest, ReWorkerResponse } from '../core/reService'
import { createReService } from '../core/reService'
import { requestQueue } from '../core/reQueue'
import { resolveFeatures } from '../core/resolve'
import { findRegions } from '../core/regions'
import type { Feature, FilletFeature, SketchFeature } from '../core/features'
import { Builder } from '../core/build'
import { addRectangle } from '../core/sketch'
import { extrudeAll, sketchOf } from './reKit'
import { loadManifold } from './reLocal'

function request(features: Feature[]) {
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch] as [number, typeof f.sketch])
  return { steps, sketches, byId: new Map(sketches) }
}

/** A plate and a round on one of its upright corners. */
async function plate(): Promise<{ base: Feature[]; all: Feature[] }> {
  const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
  const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new')]
  const probe = new Builder(await ReKernel.load())
  const r = request(base)
  probe.build(r.steps, (id) => r.byId.get(id))
  const corner = probe.topologyOf(2)!.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99)!
  probe.dispose()
  return { base, all: [...base, { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius: 2, visible: true } as FilletFeature] }
}

/** A request before it is numbered. */
type Unasked = ReWorkerRequest extends infer R ? (R extends unknown ? Omit<R, 'requestId'> : never) : never

describe('a stage handed on as the worker hands it', () => {
  it('can be asked for again, and a build back to before its feature still builds', async () => {
    const service = createReService(() => ReKernel.load(), loadManifold)
    // The worker's queue, its answers sent as postMessage sends them.
    const answers = new Map<number, (r: ReWorkerResponse) => void>()
    const queue = requestQueue(
      (msg) => service.handle(msg),
      (msg, transfer) => {
        const sent = structuredClone(msg, { transfer: transfer ?? [] }) as ReWorkerResponse
        answers.get(sent.requestId)?.(sent)
      },
      () => Promise.resolve(),
    )
    let id = 1
    const ask = (msg: Unasked, ms = 20_000): Promise<ReWorkerResponse> =>
      new Promise((resolve, reject) => {
        const requestId = id++
        const timer = setTimeout(() => reject(new Error(`request ${requestId} (${msg.type}) never answered`)), ms)
        answers.set(requestId, (r) => {
          clearTimeout(timer)
          resolve(r)
        })
        queue.push({ ...msg, requestId } as ReWorkerRequest)
      })
    const build = (features: Feature[]) => {
      const r = request(features)
      return ask({ type: 'build', steps: r.steps, sketches: r.sketches })
    }

    const { base, all } = await plate()
    expect((await build(all)).type).toBe('build-ok')
    for (let i = 0; i < 3; i++) {
      const stage = await ask({ type: 'stage', stepId: 3, bodyId: 2 })
      expect(stage.type).toBe('stage-ok')
      const edges = (stage as Extract<ReWorkerResponse, { type: 'stage-ok' }>).stage!.topology.edges
      expect(edges.length).toBe(12)
      expect(edges.every((e) => e.polyline.length > 0)).toBe(true)
    }
    const back = await build(base)
    expect(back.type).toBe('build-ok')
    expect((back as Extract<ReWorkerResponse, { type: 'build-ok' }>).bodies.length).toBe(1)
  })

  it('answers an answer it cannot send as an error, and goes on with the next', async () => {
    const replies: { type: string; requestId: number; message?: string }[] = []
    const gone = new ArrayBuffer(8)
    structuredClone(gone, { transfer: [gone] })
    const queue = requestQueue(
      async (msg): Promise<ReAnswer> => {
        if (msg.requestId === 1) return { response: { type: 'scan-ok', requestId: 1 }, transfer: [gone] }
        if (msg.requestId === 2) throw new Error('the handler fell over')
        return { response: { type: 'scan-ok', requestId: msg.requestId }, transfer: [] }
      },
      (msg, transfer) => replies.push(structuredClone(msg, { transfer: transfer ?? [] }) as (typeof replies)[number]),
      () => Promise.resolve(),
    )
    for (const requestId of [1, 2, 3]) queue.push({ type: 'check', requestId, bodyId: 1, tinyArea: 0 })
    await new Promise((r) => setTimeout(r, 30))
    expect(replies.map((r) => [r.requestId, r.type])).toEqual([
      [1, 'error'],
      [2, 'error'],
      [3, 'scan-ok'],
    ])
    expect(replies[0].message).toMatch(/could not be sent/)
    expect(replies[1].message).toBe('the handler fell over')
  })
})
