// SPDX-License-Identifier: AGPL-3.0-only
// A shell or an offset that fails on a freeform face says which face and
// how far it goes: a lofted hump whose tip curves tighter than the wall
// names its loft face and the largest wall it takes, to within a tenth of
// a millimetre of a bisection of the face's own offset — not "thinner
// than two walls" where nothing is. The shell's ways keep their reasons
// and answer the one that says most, and the largest size a diagnosis
// finds is halved down to a tenth of a millimetre.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import type { Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { largestSize, mostSpecific } from '../core/kernelShell'
import type { OcctLike } from '../core/occtTypes'
import { addEntity, emptySketch } from '../core/sketch'
import { build, XY } from './reKit'

const kernelPromise = ReKernel.load()
const occtOf = (k: ReKernel) => (k as unknown as { occt: OcctLike }).occt

/** An ellipse a by b about (0, 0) at height z, drawn as a closed spline
 *  through sixteen of its points — its tips a little tighter than the
 *  ellipse's own b²/a. */
function station(id: number, a: number, b: number, z: number): SketchFeature {
  const sketch = emptySketch()
  const pts: [number, number][] = []
  for (let i = 0; i < 16; i++) pts.push([a * Math.cos((i / 16) * 2 * Math.PI), b * Math.sin((i / 16) * 2 * Math.PI)])
  addEntity(sketch, { kind: 'spline', pts, closed: true })
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: z }, frame: { ...XY, origin: [0, 0, z] }, sketch, visible: true }
}

/** A hump lofted smooth through three ellipses, 12 wide at the thinnest
 *  and nowhere thinner, its last station's tips curving at about 2.6 mm:
 *  one B-spline face and two flat ends. */
function hump(): Feature[] {
  return [station(1, 15, 8, 0), station(2, 13, 8, 30), station(3, 12, 6, 60), { id: 4, kind: 'loft', name: 'Hump', sketches: [1, 2, 3], ruled: false, op: 'new', visible: true }]
}

const v3 = (p: { x: number; y: number; z: number } | number[]): Vec3 => (Array.isArray(p) ? [p[0], p[1], p[2]] : [p.x, p.y, p.z])

/** The largest distance the kernel offsets the hump's loft face in by, on
 *  its own, before the offset face turns over: its normals, read on a fine
 *  grid, turn against the face's somewhere — bisected to 0.01 mm. */
function foldBisected(kernel: ReKernel, shape: number): number {
  const o = occtOf(kernel)
  const faces = o.getSubShapes(shape, 'face')
  const face = faces.find((f) => o.surfaceType(f) === 'bspline')!
  const uv0 = o.uvBounds(face)
  const turns = (t: number): boolean => {
    const made = o.offset(face, -t, 1e-3)
    const off = o.getSubShapes(made, 'face')[0]
    const uv = o.uvBounds(off)
    const N = 64
    let turned = false
    for (let i = 0; i <= N && !turned; i++) {
      for (let j = 0; j <= N && !turned; j++) {
        const n1 = v3(o.surfaceNormal(off, uv.uMin + ((uv.uMax - uv.uMin) * i) / N, uv.vMin + ((uv.vMax - uv.vMin) * j) / N))
        const n0 = v3(o.surfaceNormal(face, uv0.uMin + ((uv0.uMax - uv0.uMin) * i) / N, uv0.vMin + ((uv0.vMax - uv0.vMin) * j) / N))
        if (n1[0] * n0[0] + n1[1] * n0[1] + n1[2] * n0[2] < 0) turned = true
      }
    }
    o.release(off)
    o.release(made)
    return turned
  }
  let lo = 0
  let hi = 6
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2
    if (turns(mid)) hi = mid
    else lo = mid
  }
  for (const f of faces) o.release(f)
  return lo
}

describe('a freeform face that does not offset', () => {
  it('names the loft face a shell fails on, and the wall it takes, within 0.1 mm of a bisection', async () => {
    const kernel = await kernelPromise
    const builder = new Builder(kernel)
    const t0 = performance.now()
    const out = await build(builder, [...hump(), { id: 5, kind: 'shell', name: 'Shell 1', body: 4, faces: [], thickness: 3, visible: true }])
    const r = out.results.find((x) => x.id === 5)!
    expect(r.status).toBe('failed')
    const message = r.message ?? ''
    expect(message, message).toMatch(/A wall of 3 mm does not fit the body: a face of it offsets inward by less than the wall alone: face \d+ \(B-spline, made by feature 4\) by [\d.]+ mm at most — it curves tighter than that at \(/)
    expect(message).not.toMatch(/thinner than two walls/)
    // "up to" once bisected; on a loaded machine the budget can stop it short,
    // which says "at least" (reShellBudget.test.ts holds that wording).
    expect(message).toMatch(/It hollows at a wall of (up to )?[\d.]+ mm/)
    const upTo = Number(/by ([\d.]+) mm at most/.exec(message)?.[1])
    const bisected = foldBisected(kernel, builder.body(4)!)
    expect(Math.abs(upTo - bisected), `${upTo} against ${bisected}`).toBeLessThan(0.1)
    // The tip it folds at is the last station's, on its long axis.
    const at = /tighter than that at \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/.exec(message)!.slice(1).map(Number)
    expect(Math.abs(Math.abs(at[0]) - 12)).toBeLessThan(0.5)
    expect(Math.abs(at[2] - 60)).toBeLessThan(0.5)
    expect(r.where?.length).toBeGreaterThan(0)
    console.log(`shell failure with diagnosis: ${Math.round(performance.now() - t0)} ms`)
    builder.dispose()
  })

  it('names it for an offset of the body too', async () => {
    const kernel = await kernelPromise
    const builder = new Builder(kernel)
    const out = await build(builder, [...hump(), { id: 5, kind: 'offsetBody', name: 'Offset 1', body: 4, distance: -3, keep: false, visible: true }])
    const r = out.results.find((x) => x.id === 5)!
    expect(r.status).toBe('failed')
    const message = r.message ?? ''
    expect(message, message).toMatch(/The body does not offset inward by 3 mm: a face of it offsets inward by less than the distance alone: face \d+ \(B-spline, made by feature 4\) by 2\.\d+ mm at most — it curves tighter than that at \(/)
    expect(message).not.toMatch(/thinner than/)
    expect(message).toMatch(/It offsets inward by up to [\d.]+ mm/)
    builder.dispose()
  })
})

describe('what a failed shell says', () => {
  it('answers the reason that says most of the ways tried', () => {
    const raw = { why: 'BRep_Tool:: no parameter on edge', raw: true }
    const found = { why: "by offset and cut, the kernel's offset of the body inward by the wall came out broken: it comes in 2 shells, where the body has 1.", raw: false }
    const gaveUp = { why: 'the thick solid handed the body back without hollowing it.', raw: false }
    expect(mostSpecific([raw, found])).toBe(found.why.replace(/\.$/, ''))
    expect(mostSpecific([gaveUp, raw])).toBe('the kernel refused (BRep_Tool:: no parameter on edge)')
    expect(mostSpecific([gaveUp])).toBe('the thick solid handed the body back without hollowing it')
  })

  it('finds the largest size to within a tenth of a millimetre, past six halvings', () => {
    let tries = 0
    const at = largestSize(21, (s) => {
      tries++
      return s <= 5.93
    })
    expect(at).toBeLessThanOrEqual(5.93)
    expect(5.93 - at).toBeLessThan(0.1)
    expect(tries).toBe(8)
    tries = 0
    largestSize(4, (s) => {
      tries++
      return s <= 1
    })
    expect(tries).toBe(6)
  })
})
