// SPDX-License-Identifier: AGPL-3.0-only
// A failed round or shell names the feature behind the trouble and the way
// round it: the wall a round's chain runs into at a T, with the feature
// that made it, and the lip thinner than two walls a shell cannot hollow,
// with the feature that made the lip.

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

function extrude(id: number, name: string, sk: SketchFeature, from: number, to: number, op: ExtrudeFeature['op'] = 'new', target?: number): ExtrudeFeature {
  return { id, kind: 'extrude', name, sketchId: sk.id, regions: findRegions(sk.sketch).map((r) => r.key), extent: { kind: 'distance', from, to }, op, target, visible: true }
}

const ctx = (): ResolveContext => ({ sections: [], elements: [], modelCenter: [0, 0, 0] })

async function build(features: Feature[]) {
  const k = await kernelPromise
  const builder = new Builder(k)
  const steps = resolveFeatures(features, ctx(), (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return { result: builder.build(steps, (id) => sketches.get(id)), builder }
}

describe('a failed round names the wall its chain runs into', () => {
  // A wall 40 wide, 5 thick (y 0…5), 30 tall; an arm 10 × 10 standing off
  // its face at y = 5 out to y = 30. The arm's top edge at x = 15 runs
  // from the wall's face to the arm's free end.
  const wallSk = rect(1, [0, 0], [40, 5])
  const armSk = rect(3, [15, 5], [25, 30])
  const armEdge = async (features: Feature[], body: number) => {
    const first = await build(features)
    const b = first.result.bodies.find((x) => x.id === body)!
    const edge = b.topology.edges.find((e) => {
      const m = e.fingerprint.mid
      return e.fingerprint.kind === 'line' && Math.abs(m[0] - 15) < 1e-6 && Math.abs(m[2] - 10) < 1e-6 && m[1] > 5
    })
    expect(edge).toBeDefined()
    first.builder.dispose()
    return edge!.fingerprint
  }

  it('names the wall face and the feature that made it, and the sketch as the way round', async () => {
    const wall = extrude(2, 'Wall', wallSk, 0, 30)
    const arm = extrude(4, 'Arm', armSk, 0, 10, 'join', 2)
    const edge = await armEdge([wallSk, wall, armSk, arm], 2)
    // Larger than the arm is tall or wide: it fails, and the chain's end
    // at the wall is named.
    const fillet: Feature = { id: 5, kind: 'fillet', name: 'Fillet', body: 2, edges: [edge], radius: 12, chain: false, visible: true }
    const { result, builder } = await build([wallSk, wall, armSk, arm, fillet])
    const r = result.results.find((x) => x.id === 5)!
    expect(r.status).toBe('failed')
    // The reasons it gave before stay.
    expect(r.message).toMatch(/^The edge does not round at 12 mm — drawn red on the part\. It rounds at up to \d+(\.\d+)? mm\./)
    // The wall it runs into, at the arm's root, not the arm's free end.
    expect(r.message).toMatch(/The edge runs into face \d+ \(plane, made by Wall \(feature 2\)\) at \(15, 5, 10\) — a round that ends against a wall often fails there: end it at a sharp corner, round it in the sketch \(reverse\.sketch\.edit add\.rounds\) instead\./)
    expect(r.message).not.toMatch(/runs into face \d+ \(plane, made by Arm/)
    // The wall came first: rounding before it is no route.
    expect(r.message).not.toMatch(/round before/)
    builder.dispose()
  })

  it('offers rounding before the wall when the wall came after the arm', async () => {
    // The arm first, the wall joined onto it afterwards.
    const arm = extrude(2, 'Arm', armSk, 0, 10)
    const wall = extrude(4, 'Wall', wallSk, 0, 30, 'join', 2)
    const sks = [armSk, wallSk]
    const edge = await armEdge([sks[0], arm, sks[1], wall], 2)
    const fillet: Feature = { id: 5, kind: 'fillet', name: 'Fillet', body: 2, edges: [edge], radius: 12, chain: false, visible: true }
    const { result, builder } = await build([sks[0], arm, sks[1], wall, fillet])
    const r = result.results.find((x) => x.id === 5)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/The edge runs into face \d+ \(plane, made by Wall \(feature 4\)\) at \(15, 5, 10\)/)
    expect(r.message).toMatch(/, or round before Wall \(feature 4\)\./)
    builder.dispose()
  })

  it('names nothing at a bar’s free corner, which the round turns rather than runs into', async () => {
    const sk = rect(1, [0, 0], [40, 20])
    const box = extrude(2, 'Box', sk, 0, 10)
    const first = await build([sk, box])
    const top = first.result.bodies[0].topology.edges.filter((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.mid[2] - 10) < 1e-6 && e.fingerprint.length > 30)
    first.builder.dispose()
    const fillet: Feature = { id: 3, kind: 'fillet', name: 'Fillet', body: 2, edges: [top[0].fingerprint], radius: 15, chain: false, visible: true }
    const { result, builder } = await build([sk, box, fillet])
    const r = result.results.find((x) => x.id === 3)!
    expect(r.status).toBe('failed')
    expect(r.message).not.toMatch(/runs into/)
    builder.dispose()
  })
})

describe('a failed shell names the feature that made the thin place', () => {
  it('names the lip thinner than two walls, its feature, and shelling before it or an inner body', async () => {
    // A box 40 × 40 × 20 with a lip 2 mm thick standing off its side at
    // mid height: a 1.5 mm wall each side needs 3 mm there.
    const boxSk = rect(1, [0, 0], [40, 40])
    const box = extrude(2, 'Box', boxSk, 0, 20)
    const lipSk = rect(3, [40, 0], [50, 40])
    const lip = extrude(4, 'Lip', lipSk, 9, 11, 'join', 2)
    const shell: Feature = { id: 5, kind: 'shell', name: 'Shell', body: 2, faces: [], thickness: 1.5, visible: true }
    const { result, builder } = await build([boxSk, box, lipSk, lip, shell])
    const r = result.results.find((x) => x.id === 5)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/the body is thinner than two walls \(3 mm\) at \([-\d., ]+\), 2 mm thick on face \d+ \(plane, made by Lip \(feature 4\)\)/)
    expect(r.message).toMatch(/No wall of 1\.5 mm fits where the body is under 3 mm: shell before Lip \(feature 4\), or cut an inner body \(a sketch's inset, offsetBody\) from it instead\./)
    builder.dispose()
  })
})
