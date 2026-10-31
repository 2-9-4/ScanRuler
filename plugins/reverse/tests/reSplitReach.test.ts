// SPDX-License-Identifier: AGPL-3.0-only
// A split by a fitted surface whose region is a small patch in the middle
// of a block: the surface as fitted ends far short of the block's sides,
// and the split carries it on to them — a plane as itself, a freeform
// along its slope at the edge — so the margin needs no guessing. A sheet
// drawn short from a sketch is still refused.

import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
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

/** The block 40 × 40 × 10 about the z axis, split by surface 3. */
function blockSplit(surface: Feature): Feature[] {
  const s = rectangleSketch(1, 40, 40, [-20, -20])
  return [s, extrudeAll(2, s, 0, 10), surface, { id: 4, kind: 'split', name: 'Split 1', body: 2, tools: [3], keep: 'largest', tolerance: 0.3, overlap: 0.5, visible: true }]
}

describe('a split by a fitted surface that stops short of the body', () => {
  it('carries a plane on to the body’s sides', async () => {
    const builder = new Builder(await kernelPromise)
    const scan = patchScan(3, (x) => 4 + 0.1 * x)
    builder.setScan(new NominalSurface(scan.positions, scan.indices), scan.positions)
    const out = await build(builder, blockSplit({ id: 3, kind: 'surface', name: 'Surface 1', region: scan.region, fit: { net: null, degree: 3, expandPct: 10, smoothness: 0.01 }, shape: 'plane', visible: true }))
    expect(out.results.map((r) => r.status), JSON.stringify(out.results)).toEqual(['ok', 'ok', 'ok'])
    const block = out.bodies.find((b) => b.id === 2)!
    expect(block.closed).toBe(true)
    // Above z = 4 + 0.1 x over the block: 40 × 40 × 6, the larger part.
    expect(block.volume).toBeCloseTo(9600, 0)
    builder.dispose()
  })

  it('carries a freeform surface on along its slope at the edge, not its polynomial', async () => {
    const builder = new Builder(await kernelPromise)
    const height = (x: number, y: number) => 5 + 0.01 * (x * x + y * y)
    const scan = patchScan(3, height)
    builder.setScan(new NominalSurface(scan.positions, scan.indices), scan.positions)
    const out = await build(builder, blockSplit({ id: 3, kind: 'surface', name: 'Surface 1', region: scan.region, fit: { net: { u: 4, v: 4 }, degree: 3, expandPct: 10, smoothness: 0.01 }, visible: true }))
    expect(out.results.map((r) => r.status), JSON.stringify(out.results)).toEqual(['ok', 'ok', 'ok'])
    const block = out.bodies.find((b) => b.id === 2)!
    expect(block.closed).toBe(true)
    // The bowl carried on flat from x, y = ±3.3 at its slope there: the
    // part under it, the larger, is under 40 × 40 × 10 and over 40 × 40 × 5.
    const top = Math.max(...Array.from({ length: block.mesh.positions.length / 3 }, (_, i) => block.mesh.positions[i * 3 + 2]))
    expect(top).toBeLessThan(10)
    expect(block.volume).toBeGreaterThan(8000)
    expect(block.volume).toBeLessThan(13000)
    // At the block's side the cut stands where the slope takes it, about
    // 6.2 mm up — the bowl itself would be at 9 there.
    const p = block.mesh.positions
    const side = Array.from({ length: p.length / 3 }, (_, i) => i).filter((i) => Math.abs(p[i * 3] - 20) < 1e-3 && Math.abs(p[i * 3 + 1]) < 1)
    const atSide = Math.max(...side.map((i) => p[i * 3 + 2]))
    expect(Math.abs(atSide - 6.2)).toBeLessThan(0.15)
    // Over the patch the cut is the fitted surface itself.
    const near = Array.from({ length: block.mesh.positions.length / 3 }, (_, i) => i).filter((i) => Math.hypot(block.mesh.positions[i * 3], block.mesh.positions[i * 3 + 1]) < 2.5 && block.mesh.positions[i * 3 + 2] > 1)
    expect(near.length).toBeGreaterThan(0)
    for (const i of near) expect(Math.abs(block.mesh.positions[i * 3 + 2] - height(block.mesh.positions[i * 3], block.mesh.positions[i * 3 + 1]))).toBeLessThan(0.01)
    builder.dispose()
  })

  it('still refuses a sheet drawn short from a sketch', async () => {
    const builder = new Builder(await kernelPromise)
    const short = emptySketch()
    addEntity(short, { kind: 'line', a: [-5, 0], b: [5, 0] })
    const sheet: Feature[] = [{ id: 5, kind: 'sketch', name: 'Sketch 5', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: short, visible: true }, { id: 3, kind: 'sheet', name: 'Sheet 1', sketchId: 5, from: -1, to: 11, visible: true }]
    const [s, extrude, , split] = blockSplit(sheet[1])
    const out = await build(builder, [s, extrude, sheet[0], sheet[1], split])
    const r = out.results.find((x) => x.id === 4)!
    expect(r.status).toBe('failed')
    expect((r as { message: string }).message).toMatch(/cross the body from side to side/)
    builder.dispose()
  })
})
