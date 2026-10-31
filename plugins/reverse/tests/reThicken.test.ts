// SPDX-License-Identifier: AGPL-3.0-only
// The two routes to a freeform thin shell's wall. Thicken: a fitted
// B-spline skin made one valid solid of its thickness, against its normal,
// along it or half each way, each about its area times the thickness; a
// face bending tighter than the thickness towards the side it grows to
// named, with the thickness it takes; the wall along the sheet's edge said;
// joined to a body named. Split between: a block cut by two curved skins
// 2 mm apart — sheets drawn on arcs, or two fitted freeform bowls — keeps
// the one solid between them, its big faces on the skins.

import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { Builder } from '../core/build'
import type { Feature, SketchFeature, ThickenSide } from '../core/features'
import { ReKernel } from '../core/kernel'
import { addEntity, emptySketch } from '../core/sketch'
import { build, extrudeAll, rectangleSketch, XY } from './reKit'

const kernelPromise = ReKernel.load()

/** A scan of z = height(x, y) over x, y in ±half, as a grid of triangles. */
function patchScan(half: number, height: (x: number, y: number) => number) {
  const n = 25
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -half + (2 * half * i) / (n - 1), y = -half + (2 * half * j) / (n - 1)
    positions.push(x, y, height(x, y))
  }
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < n; j++) {
    const a = i * n + j
    indices.push(a, a + n, a + n + 1, a, a + n + 1, a + 1)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), region: Uint32Array.from({ length: n * n }, (_, i) => i) }
}

/** A lamp flange's skin, roughly: a saddle-ish freeform patch 30 mm
 *  across, curving at 15 mm and more — a B-spline face fitted to a scan. */
const flange = (x: number, y: number) => 3 + 0.03 * x * x + 0.01 * x * y - 0.008 * y * y

function withFlange(builder: Builder): Feature {
  const scan = patchScan(15, flange)
  builder.setScan(new NominalSurface(scan.positions, scan.indices), scan.positions)
  return { id: 1, kind: 'surface', name: 'Flange skin', region: scan.region, fit: { net: { u: 5, v: 5 }, degree: 3, expandPct: 5, smoothness: 0.01 }, visible: true }
}

const thicken = (side: ThickenSide, thickness = 1.8, more: Partial<Extract<Feature, { kind: 'thicken' }>> = {}): Feature => ({ id: 2, kind: 'thicken', name: 'Flange', sheet: 1, thickness, side, op: 'new', visible: true, ...more })

describe('thicken a sheet', () => {
  it('makes a fitted B-spline skin one valid solid of 1.8 mm, each way about its area times the thickness', async () => {
    const kernel = await kernelPromise
    const builder = new Builder(kernel)
    const skin = withFlange(builder)
    const sheet = await build(builder, [skin])
    expect(sheet.results[0].status, JSON.stringify(sheet.results)).toBe('ok')
    const shape = builder.body(1)!
    expect(kernel.faces(shape).map((f) => f.kind)).toEqual(['other'])
    const area = kernel.surfaceArea(shape)
    const middle = kernel.faces(shape)[0]
    const sheetBox = kernel.bounds(shape)
    // Along the face's normal at its middle, as reverse.body.describe gives it.
    const up = Math.sign(middle.dir[2])
    for (const side of ['in', 'out', 'both'] as const) {
      const t0 = performance.now()
      const out = await build(builder, [skin, thicken(side)])
      const r = out.results.find((x) => x.id === 2)!
      expect(r.status, `${side}: ${r.message}`).toBe('ok')
      const body = out.bodies.find((b) => b.id === 2)!
      expect(body.closed).toBe(true)
      expect(body.surface).toBe(false)
      expect(builder.check(2, 0.01)?.valid).toBe(true)
      expect(builder.check(2, 0.01)?.solids).toBe(1)
      expect(Math.abs(body.volume / (area * 1.8) - 1), `${side}: ${body.volume} against ${area * 1.8}`).toBeLessThan(0.03)
      // The wall along the sheet's edge, said.
      expect(r.note).toMatch(/The wall along the sheet's edge is 1\.8 mm at its thinnest, measured at \d+ points/)
      // Out grows along the normal, in against it, both half each way.
      const box = kernel.bounds(builder.body(2)!)
      const above = up > 0 ? box.max[2] - sheetBox.max[2] : sheetBox.min[2] - box.min[2]
      const below = up > 0 ? sheetBox.min[2] - box.min[2] : box.max[2] - sheetBox.max[2]
      if (side === 'out') expect(above).toBeGreaterThan(1)
      if (side === 'out') expect(below).toBeLessThan(0.3)
      if (side === 'in') expect(below).toBeGreaterThan(1)
      if (side === 'in') expect(above).toBeLessThan(0.3)
      if (side === 'both') expect(Math.min(above, below)).toBeGreaterThan(0.4)
      // The sheet stands beside it, a body of its own.
      expect(out.bodies.find((b) => b.id === 1)?.surface).toBe(true)
      console.log(`thicken ${side}: ${Math.round(performance.now() - t0)} ms`)
    }
    builder.dispose()
  })

  it('keeps the skin the surface’s: its face is made by the surface feature', async () => {
    const builder = new Builder(await kernelPromise)
    const skin = withFlange(builder)
    const out = await build(builder, [skin, thicken('in')])
    const faces = out.bodies.find((b) => b.id === 2)!.topology.faces
    expect(faces.filter((f) => f.fingerprint.origin === 1)).toHaveLength(1)
    expect(faces.filter((f) => f.fingerprint.origin === 2).length).toBeGreaterThan(1)
    builder.dispose()
  })

  it('names the face that bends tighter than the thickness, and the thickness it takes', async () => {
    const builder = new Builder(await kernelPromise)
    // A bent strip: a line, a quarter arc of R 2 and a line, as a sheet
    // 20 mm tall — thickened 3 mm towards the arc's centre, its far skin
    // would fold over itself; away from it, it does not.
    const drawn = emptySketch()
    addEntity(drawn, { kind: 'line', a: [-20, 0], b: [0, 0] })
    addEntity(drawn, { kind: 'arc', c: [0, 2], r: 2, start: -Math.PI / 2, sweep: Math.PI / 2 })
    addEntity(drawn, { kind: 'line', a: [2, 2], b: [2, 20] })
    const sketch: SketchFeature = { id: 3, kind: 'sketch', name: 'Bend', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: drawn, visible: true }
    const strip: Feature = { id: 1, kind: 'sheet', name: 'Strip', sketchId: 3, from: 0, to: 20, visible: true }
    const outcomes = []
    for (const side of ['in', 'out'] as const) {
      const out = await build(builder, [sketch, strip, thicken(side, 3)])
      outcomes.push(out.results.find((x) => x.id === 2)!)
    }
    const failed = outcomes.filter((r) => r.status === 'failed')
    expect(failed, JSON.stringify(outcomes.map((r) => r.message))).toHaveLength(1)
    expect(outcomes.filter((r) => r.status === 'ok')).toHaveLength(1)
    const message = failed[0].message ?? ''
    expect(message, message).toMatch(/^The sheet does not thicken (against|along) its normal by 3 mm: a face of it takes less alone: face \d+ \(cylinder, made by feature 1\) by [\d.]+ mm at most — it bends at a radius of 2 mm towards the side (its normal points to|against its normal) at \(/)
    // The kernel's offset of the face alone stops at its radius, or a hair short.
    const upTo = Number(/by ([\d.]+) mm at most/.exec(message)?.[1])
    expect(upTo).toBeGreaterThan(1.9)
    expect(upTo).toBeLessThanOrEqual(2)
    expect(message).toMatch(/It thickens (against|along) its normal by up to [\d.]+ mm; or thicken it the other way, or both ways\./)
    expect(failed[0].where?.length).toBeGreaterThan(0)
    builder.dispose()
  })

  it('refuses a solid for a sheet, by name', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 10, 10)
    const out = await build(builder, [s, extrudeAll(4, s, 0, 5), { id: 2, kind: 'thicken', name: 'T', sheet: 4, thickness: 1, side: 'in', op: 'new', visible: true }])
    expect(out.results.find((x) => x.id === 2)?.message).toMatch(/is a solid, not a sheet/)
    builder.dispose()
  })

  it('joins the wall to the body it names', async () => {
    const builder = new Builder(await kernelPromise)
    // A flat skin at z = 10, 33 mm square, half each way into and above a
    // 40 × 40 × 10 block.
    const scan = patchScan(15, () => 10)
    builder.setScan(new NominalSurface(scan.positions, scan.indices), scan.positions)
    const skin: Feature = { id: 1, kind: 'surface', name: 'Lid skin', region: scan.region, fit: { net: { u: 4, v: 4 }, degree: 3, expandPct: 10, smoothness: 0.01 }, visible: true }
    const s = rectangleSketch(5, 40, 40, [-20, -20])
    await build(builder, [skin])
    const area = (await kernelPromise).surfaceArea(builder.body(1)!)
    const out = await build(builder, [skin, s, extrudeAll(6, s, 0, 10), thicken('both', 2, { op: 'join', target: 6 })])
    const r = out.results.find((x) => x.id === 2)!
    expect(r.status, r.message).toBe('ok')
    expect(r.bodies).toEqual([6])
    const block = out.bodies.find((b) => b.id === 6)!
    expect(block.closed).toBe(true)
    // The block, and the half of the slab above it.
    expect(block.volume).toBeCloseTo(40 * 40 * 10 + area * 1, 0)
    expect(out.bodies.some((b) => b.id === 2)).toBe(false)
    builder.dispose()
  })
})

describe('a solid between two skins', () => {
  /** Two sheets on arcs of R 30 and R 32 about the Z axis, ±40° about +X,
   *  20 mm tall: two curved skins 2 mm apart. */
  function skins(): Feature[] {
    const skin = (id: number, sketchId: number, r: number): Feature[] => {
      const drawn = emptySketch()
      addEntity(drawn, { kind: 'arc', c: [0, 0], r, start: (-40 * Math.PI) / 180, sweep: (80 * Math.PI) / 180 })
      return [
        { id: sketchId, kind: 'sketch', name: `Arc ${r}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: drawn, visible: true },
        { id, kind: 'sheet', name: `Skin ${r}`, sketchId, from: -5, to: 15, visible: true },
      ]
    }
    return [...skin(2, 1, 30), ...skin(4, 3, 32)]
  }

  it('keeps the one solid between them, its two big faces on the skins', async () => {
    const builder = new Builder(await kernelPromise)
    // A block through both skins: x 25 to 40, y ±8, z 0 to 10.
    const s = rectangleSketch(5, 15, 16, [25, -8])
    const features: Feature[] = [...skins(), s, extrudeAll(6, s, 0, 10), { id: 7, kind: 'split', name: 'Wall', body: 6, tools: [4, 2], keep: 'between', tolerance: 0.3, overlap: 0.5, visible: true }]
    const out = await build(builder, features)
    expect(out.results.map((r) => r.status + (r.message ? `: ${r.message}` : '')), JSON.stringify(out.results)).toEqual(['ok', 'ok', 'ok', 'ok'])
    const wall = out.bodies.find((b) => b.id === 6)!
    expect(wall.closed).toBe(true)
    expect(builder.check(6, 0.01)?.solids).toBe(1)
    // Between the arcs over |y| ≤ 8, 10 mm tall: ∫ √(32² − y²) − √(30² − y²) dy.
    let area = 0
    const n = 4000
    for (let i = 0; i < n; i++) {
      const y = -8 + (16 * (i + 0.5)) / n
      area += (Math.sqrt(32 * 32 - y * y) - Math.sqrt(30 * 30 - y * y)) * (16 / n)
    }
    expect(wall.volume).toBeCloseTo(area * 10, 1)
    // About the skins' area times the 2 mm between them.
    expect(Math.abs(wall.volume / (16 * 10 * 2) - 1)).toBeLessThan(0.05)
    // Its two big faces are the skins: cylinders of R 30 and R 32 about Z.
    const rounds = wall.topology.faces.filter((f) => f.fingerprint.kind === 'cylinder').map((f) => Math.round((f.fingerprint.radius ?? 0) * 1000) / 1000)
    expect(rounds.sort()).toEqual([30, 32])
    builder.dispose()
  })

  it('keeps the wall between two fitted freeform skins', async () => {
    const kernel = await kernelPromise
    const builder = new Builder(kernel)
    // One scan of two bowls 2 mm apart, each skin fitted to its own.
    const bowl = (z0: number) => patchScan(15, (x, y) => z0 + 0.01 * (x * x + y * y))
    const outer = bowl(7)
    const inner = bowl(5)
    const n = outer.positions.length / 3
    const positions = Float32Array.from([...outer.positions, ...inner.positions])
    const indices = Uint32Array.from([...outer.indices, ...Array.from(inner.indices, (i) => i + n)])
    builder.setScan(new NominalSurface(positions, indices), positions)
    const fit = { net: { u: 5, v: 5 }, degree: 3, expandPct: 10, smoothness: 0.01 }
    const s = rectangleSketch(5, 20, 20, [-10, -10])
    const out = await build(builder, [
      { id: 2, kind: 'surface', name: 'Outer skin', region: outer.region, fit, visible: true },
      { id: 4, kind: 'surface', name: 'Inner skin', region: Uint32Array.from(inner.region, (i) => i + n), fit, visible: true },
      s,
      extrudeAll(6, s, 0, 12),
      { id: 7, kind: 'split', name: 'Wall', body: 6, tools: [2, 4], keep: 'between', tolerance: 0.3, overlap: 0.5, visible: true },
    ])
    expect(out.results.map((r) => r.status + (r.message ? `: ${r.message}` : ''))).toEqual(['ok', 'ok', 'ok', 'ok'])
    const wall = out.bodies.find((b) => b.id === 6)!
    expect(wall.closed).toBe(true)
    expect(builder.check(6, 0.01)?.solids).toBe(1)
    // 2 mm apart straight up over 20 × 20.
    expect(Math.abs(wall.volume / 800 - 1)).toBeLessThan(0.01)
    // Its top lies on the outer skin, its bottom on the inner.
    const p = wall.mesh.positions
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2]
      const off = Math.min(Math.abs(z - (7 + 0.01 * (x * x + y * y))), Math.abs(z - (5 + 0.01 * (x * x + y * y))))
      if (Math.abs(Math.abs(x) - 10) > 1e-3 && Math.abs(Math.abs(y) - 10) > 1e-3) expect(off).toBeLessThan(0.02)
    }
    builder.dispose()
  })

  it('says so when no fragment has a face on every skin', async () => {
    const builder = new Builder(await kernelPromise)
    // A block that crosses the outer skin only.
    const s = rectangleSketch(5, 10, 16, [31, -8])
    const out = await build(builder, [...skins(), s, extrudeAll(6, s, 0, 10), { id: 7, kind: 'split', name: 'Wall', body: 6, tools: [2, 4], keep: 'between', tolerance: 0.3, overlap: 0.5, visible: true }])
    expect(out.results.find((r) => r.id === 7)?.message).toMatch(/No fragment lies between the sheets/)
    builder.dispose()
  })
})
