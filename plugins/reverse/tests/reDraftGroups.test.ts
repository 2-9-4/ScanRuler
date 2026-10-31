// SPDX-License-Identifier: AGPL-3.0-only
// A draft's faces at angles of their own (groups), in one feature; a face
// the kernel already leaned along with a tangent neighbour passed over and
// said, one leaned at another angle refused; and a draft that fails names
// the tangent neighbour left out of the pick.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import type { FaceFingerprint } from '../core/topo'
import { build, extrudeAll, rectangleSketch } from './reKit'

const kernelPromise = ReKernel.load()

const BOX = 40 * 20 * 10
const rad = (deg: number) => (deg * Math.PI) / 180
/** What a wall 10 high and 20 long leaned in by `deg` about its foot
 *  takes off the box. */
const wedge = (deg: number) => 0.5 * 10 * (10 * Math.tan(rad(deg))) * 20

describe('a draft at several angles', () => {
  it('leans two walls at 1.8° and 2.7° in one feature', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 40, 20)
    const first = await build(builder, [s, extrudeAll(2, s, 0, 10)])
    const faces = first.bodies[0].topology.faces.map((f) => f.fingerprint)
    const bottom = faces.find((f) => f.dir[2] < -0.9)!
    const right = faces.find((f) => f.dir[0] > 0.9)!
    const left = faces.find((f) => f.dir[0] < -0.9)!
    const draft: Feature = { id: 3, kind: 'draft', name: 'Draft 1', body: 2, neutral: { kind: 'face', face: bottom }, faces: [right], angleDeg: 1.8, groups: [{ faces: [left], angleDeg: 2.7 }], visible: true }
    const out = await build(builder, [s, extrudeAll(2, s, 0, 10), draft])
    expect(out.results.find((r) => r.id === 3)?.status).toBe('ok')
    expect(out.bodies[0].volume).toBeCloseTo(BOX - wedge(1.8) - wedge(2.7), 3)
    // Each wall leans by its own angle: its normal rises by the sine.
    const after = out.bodies[0].topology.faces.map((f) => f.fingerprint)
    expect(after.find((f) => f.dir[0] > 0.9)!.dir[2]).toBeCloseTo(Math.sin(rad(1.8)), 6)
    expect(after.find((f) => f.dir[0] < -0.9)!.dir[2]).toBeCloseTo(Math.sin(rad(2.7)), 6)
    // A feature saved before groups builds as it did.
    const plain: Feature = { id: 3, kind: 'draft', name: 'Draft 1', body: 2, neutral: { kind: 'face', face: bottom }, faces: [right, left], angleDeg: 1.8, visible: true }
    const old = await build(builder, [s, extrudeAll(2, s, 0, 10), plain])
    expect(old.bodies[0].volume).toBeCloseTo(BOX - 2 * wedge(1.8), 3)
    builder.dispose()
  })

  it('passes over a face leaned with its tangent neighbour, refuses it at another angle, and names a neighbour left out', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 40, 20)
    const first = await build(builder, [s, extrudeAll(2, s, 0, 10)])
    const vertical = first.bodies[0].topology.edges.filter((e) => Math.abs(e.fingerprint.dir[2]) > 0.9)
    // One upright corner rounded R5: a cylinder tangent to the two walls
    // either side.
    const fillet: Feature = { id: 3, kind: 'fillet', name: 'Fillet', body: 2, edges: [vertical[0].fingerprint], radius: 5, chain: false, visible: true }
    const rounded = await build(builder, [s, extrudeAll(2, s, 0, 10), fillet])
    const faces = rounded.bodies[0].topology.faces.map((f) => f.fingerprint)
    const bottom = faces.find((f) => f.dir[2] < -0.9)!
    const round = faces.find((f) => f.kind === 'cylinder')!
    const walls = faces.filter((f) => f.kind === 'plane' && Math.abs(f.dir[2]) < 0.1)
    // The two walls the round runs into, and the two it does not.
    const beside = walls.filter((f) => f.area < (Math.abs(f.dir[0]) > 0.5 ? 20 : 40) * 10 - 1)
    expect(beside.length).toBe(2)
    const draft = (picked: FaceFingerprint[], angleDeg: number, groups?: { faces: FaceFingerprint[]; angleDeg: number }[]): Feature => ({ id: 4, kind: 'draft', name: 'Draft 1', body: 2, neutral: { kind: 'face', face: bottom }, faces: picked, angleDeg, ...(groups ? { groups } : {}), visible: true })
    const tried = async (f: Feature) => (await build(builder, [s, extrudeAll(2, s, 0, 10), fillet, f])).results.find((x) => x.id === 4)!

    // Every wall and the round at 5°: the first wall the kernel leans
    // takes the round and the wall beyond along — those are passed over.
    const all = await tried(draft([beside[0], round, beside[1], ...walls.filter((w) => !beside.includes(w))], 5))
    expect(all.status).toBe('ok')
    expect(all.warning).toMatch(/2 faces picked already leaned by their angle — drafted along with a tangent neighbour before them — and were passed over: .*cylinder Ø10/)
    // The round in a group of its own at another angle: refused, saying so.
    const other = await tried(draft([beside[0]], 5, [{ faces: [round], angleDeg: 3 }]))
    expect(other.status).toBe('failed')
    expect(other.message).toMatch(/^Face \d+ \(plane\) and face \d+ \(cylinder of 5 mm radius\) meet at a tangent edge, or through faces that do, and are asked to lean at 5° and 3°/)

    // A wall alone leaned past what the box takes: the diagnosis names the
    // round it meets at a tangent edge, which the kernel leans with it.
    const far = await tried(draft([beside[0]], 80))
    expect(far.status).toBe('failed')
    expect(far.message).toMatch(/meet those picked at a tangent edge and are not picked — face \d+ \(cylinder of 5 mm radius\)/)
    builder.dispose()
  })
})
