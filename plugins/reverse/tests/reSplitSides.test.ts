// SPDX-License-Identifier: AGPL-3.0-only
// A split that keeps what lies between two sheets, and what a split keeps
// of its faces' makers. Two sheets that cross inside the body are refused
// before the kernel is asked, saying where they meet — drawn so, or only
// once carried on to reach the body; the corners two crossing skins cut a
// body into each have a face on both, on different sides, and are never
// kept as the whole. A fitted surface is carried on over the body's own
// points, not its box's corners. A box split at x 4 keeps the faces the
// split cut through as the box's: five of them its extrude's, the one on
// the sheet the split's.

import { describe, expect, it, vi } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReKernel, type Shape } from '../core/kernel'
import { addEntity, emptySketch } from '../core/sketch'
import { reachOver } from '../core/surfaceFit'
import { build, extrudeAll, rectangleSketch, XY } from './reKit'

const kernelPromise = ReKernel.load()

/** A sheet 60 mm tall through the line from a to b on the XY plane. */
function lineSheet(id: number, sketchId: number, a: [number, number], b: [number, number]): Feature[] {
  const drawn = emptySketch()
  addEntity(drawn, { kind: 'line', a, b })
  return [
    { id: sketchId, kind: 'sketch', name: `Line ${id}`, plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: drawn, visible: true },
    { id, kind: 'sheet', name: `Skin ${id}`, sketchId, from: -20, to: 40, visible: true },
  ]
}

/** The block 40 × 40 × 10 about the z axis. */
const block = (): Feature[] => {
  const s = rectangleSketch(5, 40, 40, [-20, -20])
  return [s, extrudeAll(6, s, 0, 10)]
}

const between = (tools: number[]): Feature => ({ id: 7, kind: 'split', name: 'Wall', body: 6, tools, keep: 'between', tolerance: 0.3, overlap: 0.5, visible: true })

/** A scan of z = height(x, y) over a patch, as triangles, from `first`. */
function patch(x0: number, x1: number, y0: number, y1: number, height: (x: number, y: number) => number, first = 0) {
  const n = 15
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1), y = y0 + ((y1 - y0) * j) / (n - 1)
    positions.push(x, y, height(x, y))
  }
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < n; j++) {
    const a = first + i * n + j
    indices.push(a, a + n, a + n + 1, a, a + n + 1, a + 1)
  }
  return { positions, indices, region: Uint32Array.from({ length: n * n }, (_, i) => first + i) }
}

describe('a split between two sheets', () => {
  it('refuses two sheets that cross inside the body, saying where, in no time', async () => {
    const builder = new Builder(await kernelPromise)
    // Two skins crossing in an X at the origin.
    const t0 = performance.now()
    const out = await build(builder, [...lineSheet(2, 1, [-30, -10], [30, 10]), ...lineSheet(4, 3, [-30, 10], [30, -10]), ...block(), between([2, 4])])
    const r = out.results.find((x) => x.id === 7)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/^Skin 2 and Skin 4 meet at \(-?0\.00, -?0\.00, [\d.]+\), inside Extrude 6 — the wall between them closes there/)
    expect(r.message).toMatch(/trim it to shape by Split or Combine \(both take a sheet\), then Thicken\./)
    expect(performance.now() - t0).toBeLessThan(5000)
    // Apart, the wall between them is kept as before.
    const apart = await build(builder, [...lineSheet(2, 1, [-30, -2], [30, -2]), ...lineSheet(4, 3, [-30, 2], [30, 2]), ...block(), between([2, 4])])
    expect(apart.results.find((x) => x.id === 7)?.status).toBe('ok')
    expect(apart.bodies.find((b) => b.id === 6)!.volume).toBeCloseTo(40 * 4 * 10, 3)
    builder.dispose()
  })

  it('never keeps the corners two crossing skins cut a body into: each has a face on both, on different sides', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    await build(builder, [...lineSheet(2, 1, [-30, -10], [30, 10]), ...lineSheet(4, 3, [-30, 10], [30, -10]), ...block()])
    const b = builder as unknown as { betweenFragments(f: readonly Shape[], t: readonly Shape[]): { kept: Shape[]; crossed: boolean } }
    const tools = [builder.body(2)!, builder.body(4)!]
    const fragments = k.split(builder.body(6)!, tools)
    expect(fragments).toHaveLength(4)
    const got = b.betweenFragments(fragments, tools)
    expect(got).toEqual({ kept: [], crossed: true })
    k.release(...fragments)
    builder.dispose()
  })

  it('refuses skins the fragments show crossed at once, reading them once, carrying nothing on', async () => {
    const builder = new Builder(await kernelPromise)
    // Two planes fitted in an X through the block, each wide enough to
    // cross it — a plane is carried on where a cut does not reach. The
    // check before the kernel is passed over, so the fragments tell.
    const a = patch(-30, 30, -30, 30, (x) => 5 + 0.3 * x)
    const c = patch(-30, 30, -30, 30, (x) => 5 - 0.3 * x, a.positions.length / 3)
    const positions = Float32Array.from([...a.positions, ...c.positions])
    builder.setScan(new NominalSurface(positions, Uint32Array.from([...a.indices, ...c.indices])), positions)
    const fit = { net: null, degree: 3, expandPct: 10, smoothness: 0.01 }
    const b = builder as unknown as { sheetsApart(): void; reachingTools(): unknown; betweenFragments(): unknown }
    vi.spyOn(b, 'sheetsApart').mockImplementation(() => {})
    const reach = vi.spyOn(b, 'reachingTools')
    const read = vi.spyOn(b, 'betweenFragments')
    const out = await build(builder, [
      { id: 2, kind: 'surface', name: 'Rising', region: a.region, fit, shape: 'plane', visible: true },
      { id: 4, kind: 'surface', name: 'Falling', region: c.region, fit, shape: 'plane', visible: true },
      ...block(),
      between([2, 4]),
    ])
    const r = out.results.find((x) => x.id === 7)!
    expect(r.message).toMatch(/^The sheets cross inside Extrude 6: the corners they cut it into each have a face on every sheet/)
    expect(reach).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
    builder.dispose()
  })

  it('refuses two fitted skins that meet only once carried on to reach the body', async () => {
    const builder = new Builder(await kernelPromise)
    // Two small patches, 2 mm apart at x −3 and closing in along +x: as
    // fitted they stay apart; carried on along their slopes, they cross at
    // x 10, inside the block.
    const lower = patch(-3, 3, -3, 3, (x) => 4 + 0.1 * x)
    const upper = patch(-3, 3, -3, 3, (x) => 6.6 - 0.16 * x, lower.positions.length / 3)
    const positions = Float32Array.from([...lower.positions, ...upper.positions])
    builder.setScan(new NominalSurface(positions, Uint32Array.from([...lower.indices, ...upper.indices])), positions)
    const fit = { net: { u: 4, v: 4 }, degree: 3, expandPct: 10, smoothness: 0.01 }
    const out = await build(builder, [
      { id: 2, kind: 'surface', name: 'Lower skin', region: lower.region, fit, visible: true },
      { id: 4, kind: 'surface', name: 'Upper skin', region: upper.region, fit, visible: true },
      ...block(),
      between([2, 4]),
    ])
    const r = out.results.find((x) => x.id === 7)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/^Lower skin and Upper skin, carried on to reach Extrude 6, meet at \(10\.0\d, /)
    builder.dispose()
  })

  it('carries a fitted surface on over the body’s points, not its box’s corners', () => {
    // A square 20 across, turned 45° in the plane: its box's corners lie
    // 14.1 past its middle along u, its own corners 10.
    const c = Math.SQRT1_2
    const points = [[10, 0], [0, 10], [-10, 0], [0, -10]].flatMap(([x, y]) => [x, y, 0])
    const turned = { origin: [0, 0, 0] as [number, number, number], axisU: [c, c, 0] as [number, number, number], axisV: [-c, c, 0] as [number, number, number], uRange: [-1, 1] as [number, number], vRange: [-1, 1] as [number, number] }
    const reach = reachOver(turned, points, 0)!
    expect(reach.u[0]).toBeCloseTo(-10 * c, 6)
    expect(reach.u[1]).toBeCloseTo(10 * c, 6)
    expect(reach.v[1]).toBeCloseTo(10 * c, 6)
    expect(reachOver({ ...turned, uRange: [-10, 10], vRange: [-10, 10] }, points, 0)).toBeNull()
  })
})

describe('a split keeps its faces’ makers', () => {
  it('a box split at x 4 keeps five faces as the extrude’s, and the one on the sheet as the split’s', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 20, 20, [-10, -10])
    const out = await build(builder, [s, { ...extrudeAll(2, s, 0, 10), name: 'Raw' }, ...lineSheet(4, 3, [4, -30], [4, 30]), { id: 5, kind: 'split', name: 'Behind', body: 2, tools: [4], keep: 'largest', tolerance: 0.3, overlap: 0.5, visible: true }])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    const box = out.bodies.find((b) => b.id === 2)!
    expect(box.volume).toBeCloseTo(14 * 20 * 10, 3)
    const origins = box.topology.faces.map((f) => f.fingerprint.origin)
    expect(origins.filter((o) => o === 2)).toHaveLength(5)
    expect(origins.filter((o) => o === 5)).toHaveLength(1)
    // The split's own face is the one on the sheet.
    const own = box.topology.faces.find((f) => f.fingerprint.origin === 5)!
    expect(own.fingerprint.centroid[0]).toBeCloseTo(4, 6)
    builder.dispose()
  })
})
