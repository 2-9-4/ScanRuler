// SPDX-License-Identifier: AGPL-3.0-only
// A failed round names each edge that fails by where it is and by the
// features that made the faces either side — not "the edge, the edge" —
// and a face a cut's tool body left on the part as a bounding face of
// that helper, with the cut that left it and the ways round: as the
// mirror holder's Left wall tool left its sides at y −11.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { ExtrudeFeature, Feature, ResolveContext, SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addRectangle, emptySketch, type Sketch } from '../core/sketch'
import { XY } from './reKit'

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** A sketch on the XY plane holding a rectangle from `a` to `b`. */
function rect(id: number, a: [number, number], b: [number, number]): SketchFeature {
  const sketch = emptySketch()
  addRectangle(sketch, a, b)
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
}

function extrude(id: number, name: string, sk: SketchFeature, from: number, to: number): ExtrudeFeature {
  return { id, kind: 'extrude', name, sketchId: sk.id, regions: findRegions(sk.sketch).map((r) => r.key), extent: { kind: 'distance', from, to }, op: 'new', visible: true }
}

const ctx = (): ResolveContext => ({ sections: [], elements: [], modelCenter: [0, 0, 0] })

async function build(features: Feature[]) {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, ctx(), (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return { result: builder.build(steps, (id) => sketches.get(id)), builder }
}

describe('a failed round on a helper body’s side', () => {
  // A part 40 × 20 × 10; a block 20 × 10 standing from z 5 to 20 cut from
  // it — a pocket 5 deep whose walls and floor are the block's sides.
  const partSk = rect(1, [0, 0], [40, 20])
  const toolSk = rect(3, [10, 5], [30, 15])
  const part = extrude(2, 'Part', partSk, 0, 10)
  const tool = extrude(4, 'Pocket tool', toolSk, 5, 20)
  const cut: Feature = { id: 5, kind: 'boolean', name: 'Pocket', op: 'cut', body: 2, tool: 4, visible: true }
  const base = [partSk, part, toolSk, tool, cut]

  it('names the failing edge by its faces’ makers and where it is, and the helper with the ways round', async () => {
    const first = await build(base)
    const edges = first.result.bodies.find((b) => b.id === 2)!.topology.edges
    const at = (x: number, y: number, z: number) => edges.find((e) => e.fingerprint.kind === 'line' && Math.hypot(e.fingerprint.mid[0] - x, e.fingerprint.mid[1] - y, e.fingerprint.mid[2] - z) < 1e-6)!.fingerprint
    // The pocket’s rim at y 5 and the part’s outer top edge at x 0: a
    // round of 6 runs down the outer side, not the 5 mm pocket wall.
    const rim = at(20, 5, 10)
    const outer = at(0, 10, 10)
    first.builder.dispose()
    const fillet: Feature = { id: 6, kind: 'fillet', name: 'Fillet', body: 2, edges: [rim, outer], radius: 6, chain: false, visible: true }
    const { result, builder } = await build([...base, fillet])
    const r = result.results.find((x) => x.id === 6)!
    expect(r.status).toBe('failed')
    const message = r.status === 'failed' ? r.message : ''
    expect(message).toMatch(/^1 of the 2 edges do not round: the edge at \(20, 5, 10\) between (a face of Part \(feature 2\) and a bounding face of the helper Pocket tool \(feature 4\)|a bounding face of the helper Pocket tool \(feature 4\) and a face of Part \(feature 2\)) at 6 mm/)
    expect(message).toMatch(/Pocket tool \(feature 4\) is a helper body: its bounding faces stay on the part where Pocket \(feature 5\) left them — move or oversize that side, or round before the cut\./)
    builder.dispose()
  })

  it('says nothing of a helper where the failing edge is the part’s own', async () => {
    const first = await build([partSk, part])
    const edges = first.result.bodies.find((b) => b.id === 2)!.topology.edges
    const top = edges.filter((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.mid[2] - 10) < 1e-6)
    first.builder.dispose()
    // Larger than the part is tall along the short side's edges.
    const fillet: Feature = { id: 3, kind: 'fillet', name: 'Fillet', body: 2, edges: top.map((e) => e.fingerprint), radius: 11, chain: false, visible: true }
    const { result, builder } = await build([partSk, part, fillet])
    const r = result.results.find((x) => x.id === 3)!
    expect(r.status).toBe('failed')
    const message = r.status === 'failed' ? r.message : ''
    expect(message).not.toMatch(/helper/)
    expect(message).not.toMatch(/the edge, the edge/)
    builder.dispose()
  })
})
