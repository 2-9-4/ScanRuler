// SPDX-License-Identifier: AGPL-3.0-only
// A sheet trimmed before it is thickened. Combine intersect keeps a fitted
// skin inside a box: thickened, its walls round the edge are the offset's,
// square to the skin — no plane of the box — and its edges there round
// further than those of the skin thickened first and cut by the box. Split
// by an open chain's sheet, keep scan, the skin loses its overshoot past
// the scan. Two skins in an L, each split by the other and joined, thicken
// as one solid with no notch at the corner. Combine cut keeps the sheet
// outside the solid; a sheet refuses keep "between". Through all of it the
// faces stay the surface's.

import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { Builder } from '../core/build'
import type { Feature, ThickenSide } from '../core/features'
import { ReKernel, type Shape } from '../core/kernel'
import { addEntity, emptySketch } from '../core/sketch'
import { build, extrudeAll, rectangleSketch, XY } from './reKit'

const kernelPromise = ReKernel.load()

/** A scan of the points `at(i, j)` on an n × n grid, as triangles. */
function gridScan(n: number, at: (s: number, t: number) => [number, number, number], first = 0) {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) positions.push(...at(i / (n - 1), j / (n - 1)))
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < n; j++) {
    const a = first + i * n + j
    indices.push(a, a + n, a + n + 1, a, a + n + 1, a + 1)
  }
  return { positions, indices, region: Array.from({ length: n * n }, (_, i) => first + i) }
}

/** The lamp flange's skin of reThicken.test.ts over ±15 mm. */
const flange = (x: number, y: number) => 3 + 0.03 * x * x + 0.01 * x * y - 0.008 * y * y

function withFlange(builder: Builder, expandPct = 5): Feature {
  const scan = gridScan(25, (s, t) => [-15 + 30 * s, -15 + 30 * t, flange(-15 + 30 * s, -15 + 30 * t)])
  const positions = Float32Array.from(scan.positions)
  builder.setScan(new NominalSurface(positions, Uint32Array.from(scan.indices)), positions)
  return { id: 1, kind: 'surface', name: 'Flange face', region: Uint32Array.from(scan.region), fit: { net: { u: 5, v: 5 }, degree: 3, expandPct, smoothness: 0.01 }, visible: true }
}

const thicken = (id: number, sheet: number, side: ThickenSide = 'in', thickness = 1.8): Feature => ({ id, kind: 'thicken', name: `Thicken ${id}`, sheet, thickness, side, op: 'new', visible: true })

/** The 20 mm box round the flange's middle, 60 mm tall. */
const box = () => {
  const s = rectangleSketch(5, 20, 20, [-10, -10])
  return [s, extrudeAll(6, s, -20, 40)]
}

/** The largest radius, to 0.05 mm, the edge rounds at alone — 0 where none. */
function roundsUpTo(k: ReKernel, shape: Shape, edge: number): number {
  const holds = (r: number) => {
    try {
      const t = k.filletTracked(shape, [edge], r)
      const ok = k.isClosedSolid(t.shape)
      k.release(t.shape)
      return ok
    } catch {
      return false
    }
  }
  let lo = 0
  let hi = 3
  if (holds(hi)) return hi
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2
    if (holds(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** The two edges of a slab along its end at x = +10, by hash. */
function endEdges(k: ReKernel, shape: Shape): number[] {
  return k
    .edges(shape, 0.05)
    .filter((e) => e.mid[0] > 8 && Math.abs(e.mid[1]) < 5 && Math.abs(e.dir[1]) > 0.9)
    .map((e) => e.hash)
}

describe('a sheet trimmed before it is thickened', () => {
  it('Combine intersect keeps the skin inside the box: thickened, no plane of the box, and its edges round further than the slab cut', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    const skin = withFlange(builder)
    // Trimmed, then thickened.
    const trimmed = await build(builder, [skin, ...box(), { id: 7, kind: 'boolean', name: 'Flange trimmed', op: 'intersect', body: 1, tool: 6, visible: true }, thicken(8, 1)])
    expect(trimmed.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['1 ok', '6 ok', '7 ok', '8 ok'])
    const sheet = trimmed.bodies.find((b) => b.id === 1)!
    expect(sheet.surface).toBe(true)
    const sb = sheet.box!
    expect(sb.max[0]).toBeLessThan(10 + 1e-3)
    expect(sb.min[1]).toBeGreaterThan(-10 - 1e-3)
    // Its face is still the surface's.
    expect(sheet.topology.faces.map((f) => f.fingerprint.origin)).toEqual([1])
    const wall = trimmed.bodies.find((b) => b.id === 8)!
    expect(wall.closed).toBe(true)
    expect(builder.check(8, 0.01)?.valid).toBe(true)
    expect(builder.check(8, 0.01)?.solids).toBe(1)
    // The walls round the edge are the offset's, square to the skin: no
    // face of it is a plane, as the box's sides are.
    expect(wall.topology.faces.filter((f) => f.fingerprint.kind === 'plane')).toEqual([])
    // The skin is still the surface's.
    expect(wall.topology.faces.filter((f) => f.fingerprint.origin === 1).length).toBeGreaterThanOrEqual(1)
    const trimmedShape = k.copy(builder.body(8)!)
    // Thickened, then cut by the box.
    const cut = await build(builder, [skin, thicken(8, 1), ...box(), { id: 7, kind: 'boolean', name: 'Slab cut', op: 'intersect', body: 8, tool: 6, visible: true }])
    expect(cut.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    const cutWall = cut.bodies.find((b) => b.id === 8)!
    expect(cutWall.topology.faces.filter((f) => f.fingerprint.kind === 'plane').length).toBeGreaterThanOrEqual(4)
    const cutShape = builder.body(8)!
    const a = endEdges(k, cutShape).map((e) => roundsUpTo(k, cutShape, e))
    const b = endEdges(k, trimmedShape).map((e) => roundsUpTo(k, trimmedShape, e))
    console.log(`end edges at x +10 round up to: slab cut ${a.join(', ')}; trimmed first ${b.join(', ')}`)
    expect(a).toHaveLength(2)
    expect(b).toHaveLength(2)
    // The cut's acute edge is the one that rounds least; trimmed first,
    // both edges stand square to the skin and round further than it.
    expect(Math.min(...b)).toBeGreaterThan(Math.min(...a) + 0.2)
    k.release(trimmedShape)
    builder.dispose()
  })

  it('Combine cut keeps the skin outside the box, as one sheet round a hole', async () => {
    const builder = new Builder(await kernelPromise)
    const skin = withFlange(builder)
    const s = rectangleSketch(5, 10, 10, [-5, -5])
    const out = await build(builder, [skin, s, extrudeAll(6, s, -20, 40), { id: 7, kind: 'boolean', name: 'Window', op: 'cut', body: 1, tool: 6, visible: true }, thicken(8, 1)])
    expect(out.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['1 ok', '6 ok', '7 ok', '8 ok'])
    const sheet = out.bodies.find((b) => b.id === 1)!
    expect(sheet.surface).toBe(true)
    // No point of the sheet inside the window.
    const p = sheet.mesh.positions
    for (let i = 0; i < p.length; i += 3) expect(Math.abs(p[i]) < 4.99 && Math.abs(p[i + 1]) < 4.99).toBe(false)
    expect(out.bodies.find((b) => b.id === 8)!.closed).toBe(true)
    builder.dispose()
  })

  it('Split by an open chain’s sheet, keep scan: the overshoot past the scan’s edge goes, the skin stays the surface’s', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    // Fitted 20 % past the scan's ±15 either way.
    const skin = withFlange(builder, 20)
    const chain = emptySketch()
    addEntity(chain, { kind: 'line', a: [13.5, -40], b: [13.5, 0] })
    addEntity(chain, { kind: 'line', a: [13.5, 0], b: [14.5, 40] })
    const features: Feature[] = [
      skin,
      { id: 3, kind: 'sketch', name: 'Tip line', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: chain, visible: true },
      { id: 4, kind: 'sheet', name: 'Tip sheet', sketchId: 3, from: -20, to: 40, visible: true },
      { id: 5, kind: 'split', name: 'Tip trim', body: 1, tools: [4], keep: 'scan', tolerance: 0.3, overlap: 0.5, visible: true },
    ]
    const before = await build(builder, [skin])
    const wide = before.bodies.find((b) => b.id === 1)!.box!
    expect(wide.max[0]).toBeGreaterThan(17)
    const out = await build(builder, [...features, thicken(8, 1)])
    expect(out.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['1 ok', '4 ok', '5 ok', '8 ok'])
    const sheet = out.bodies.find((b) => b.id === 1)!
    expect(sheet.surface).toBe(true)
    // Cut at x 13.5 to 14.5: nothing of it past 14.6; the other side's
    // overshoot, which no tool cut, stays.
    expect(sheet.box!.max[0]).toBeLessThan(14.6)
    expect(sheet.box!.max[0]).toBeGreaterThan(13.4)
    expect(sheet.box!.min[0]).toBeLessThan(-17)
    expect(sheet.topology.faces.map((f) => f.fingerprint.origin)).toEqual([1])
    expect(out.bodies.find((b) => b.id === 8)!.closed).toBe(true)
    // Keep largest by area keeps the same piece; smallest the overshoot.
    const smallest = await build(builder, [...features.slice(0, 3), { ...(features[3] as Extract<Feature, { kind: 'split' }>), keep: 'smallest' }])
    expect(smallest.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(smallest.bodies.find((b) => b.id === 1)!.box!.min[0]).toBeGreaterThan(13.4)
    builder.dispose()
  })

  it('two skins in an L, each split by the other and joined, thicken as one solid with no notch', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    // A flange at z 0 over x 0…20, y ±12, and a wall at x 0 over z 0…20,
    // y ±10: one scan, each skin fitted to its own.
    const flat = gridScan(21, (s, t) => [20 * s, -12 + 24 * t, 0])
    const wall = gridScan(21, (s, t) => [0, -10 + 20 * t, 20 * s], flat.positions.length / 3)
    const positions = Float32Array.from([...flat.positions, ...wall.positions])
    builder.setScan(new NominalSurface(positions, Uint32Array.from([...flat.indices, ...wall.indices])), positions)
    const fit = { net: { u: 4, v: 4 }, degree: 3, expandPct: 10, smoothness: 0.01 }
    const sheets: Feature[] = [
      { id: 1, kind: 'surface', name: 'Flange face', region: Uint32Array.from(flat.region), fit, visible: true },
      { id: 2, kind: 'surface', name: 'Lip face', region: Uint32Array.from(wall.region), fit, visible: true },
    ]
    const trims: Feature[] = [
      { id: 3, kind: 'split', name: 'Lip trimmed', body: 2, tools: [1], keep: 'scan', tolerance: 0.3, overlap: 0.5, visible: true },
      { id: 4, kind: 'split', name: 'Flange trimmed', body: 1, tools: [2], keep: 'scan', tolerance: 0.3, overlap: 0.5, visible: true },
      { id: 5, kind: 'boolean', name: 'Shield', op: 'join', body: 1, tool: 2, visible: true },
    ]
    const joined = await build(builder, [...sheets, ...trims])
    expect(joined.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['1 ok', '2 ok', '3 ok', '4 ok', '5 ok'])
    const shield = joined.bodies.find((b) => b.id === 1)!
    expect(shield.surface).toBe(true)
    expect(joined.bodies.some((b) => b.id === 2)).toBe(false)
    // Each trimmed back to the corner: nothing of either past it.
    expect(shield.box!.min[0]).toBeGreaterThan(-0.01)
    expect(shield.box!.min[2]).toBeGreaterThan(-0.01)
    // Each face still its own surface's.
    expect(shield.topology.faces.map((f) => f.fingerprint.origin).sort()).toEqual([1, 2])
    // Split across the crease, the L comes apart in two pieces of two
    // faces each, held together across the crease, which no tool cut: the
    // larger kept, by area.
    const across = emptySketch()
    addEntity(across, { kind: 'line', a: [-10, 5], b: [30, 5] })
    const halves = await build(builder, [...sheets, ...trims, { id: 13, kind: 'sketch', name: 'Across', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: across, visible: true }, { id: 14, kind: 'sheet', name: 'Across sheet', sketchId: 13, from: -5, to: 30, visible: true }, { id: 15, kind: 'split', name: 'Half', body: 1, tools: [14], keep: 'largest', tolerance: 0.3, overlap: 0.5, visible: true }])
    expect(halves.results.find((r) => r.id === 15)?.status, halves.results.find((r) => r.id === 15)?.message).toBe('ok')
    const half = halves.bodies.find((b) => b.id === 1)!
    expect(half.faces).toBe(2)
    expect(half.topology.faces.map((f) => f.fingerprint.origin).sort()).toEqual([1, 2])
    expect(half.box!.max[1]).toBeCloseTo(5, 3)
    expect(half.box!.min[1]).toBeLessThan(-10)
    // Trimmed by the outline to y ±8, so both end together, and thickened
    // 2 mm: in, the inside corner mitred — the two slabs less the square
    // they share; out, the outside corner rounded by the kernel where the
    // two slabs alone would leave the square empty, a notch.
    const outline = rectangleSketch(9, 40, 16, [-5, -8])
    const trimmed: Feature[] = [outline, extrudeAll(10, outline, -5, 30), { id: 11, kind: 'boolean', name: 'Shield outline', op: 'intersect', body: 1, tool: 10, visible: true }]
    const slabs = 2 * (21 * 16) * 2
    for (const [side, volume] of [['in', slabs - 2 * 2 * 16], ['out', slabs + ((Math.PI * 2 * 2) / 4) * 16]] as const) {
      const out = await build(builder, [...sheets, ...trims, ...trimmed, thicken(12, 1, side, 2)])
      expect(out.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['1 ok', '2 ok', '3 ok', '4 ok', '5 ok', '10 ok', '11 ok', '12 ok'])
      const solid = out.bodies.find((b) => b.id === 12)!
      expect(solid.closed).toBe(true)
      expect(builder.check(12, 0.01)?.solids).toBe(1)
      expect(solid.volume, side).toBeCloseTo(volume, 0)
    }
    builder.dispose()
  })

  it('joins two curved skins trimmed to each other, though their edges there lie a micron apart', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    // The L bent both ways: the flange's cut edge is the lip carried on
    // through its fit's points — a surface of its own, a hair off the fit
    // the lip itself is the kernel's surface through.
    const flat = gridScan(31, (s, t) => {
      const x = 20 * s, y = -12 + 24 * t
      return [x, y, 0.02 * x * x + 0.01 * y * y - 0.3 * Math.sin(x / 4)]
    })
    const wall = gridScan(31, (s, t) => {
      const z = 20 * s, y = -10 + 20 * t
      return [-0.015 * z * z + 0.2 * Math.sin(y / 5) + 0.002 * y * z, y, z]
    }, flat.positions.length / 3)
    const positions = Float32Array.from([...flat.positions, ...wall.positions])
    builder.setScan(new NominalSurface(positions, Uint32Array.from([...flat.indices, ...wall.indices])), positions)
    const fit = { net: { u: 6, v: 6 }, degree: 3, expandPct: 10, smoothness: 0.01 }
    const out = await build(builder, [
      { id: 1, kind: 'surface', name: 'Flange face', region: Uint32Array.from(flat.region), fit, visible: true },
      { id: 2, kind: 'surface', name: 'Lip face', region: Uint32Array.from(wall.region), fit, visible: true },
      { id: 3, kind: 'split', name: 'Lip trimmed', body: 2, tools: [1], keep: 'scan', tolerance: 0.3, overlap: 0.5, visible: true },
      { id: 4, kind: 'split', name: 'Flange trimmed', body: 1, tools: [2], keep: 'scan', tolerance: 0.3, overlap: 0.5, visible: true },
      { id: 5, kind: 'boolean', name: 'Shield', op: 'join', body: 1, tool: 2, visible: true },
      thicken(8, 1, 'out', 1.5),
    ])
    expect(out.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['1 ok', '2 ok', '3 ok', '4 ok', '5 ok', '8 ok'])
    expect(out.bodies.find((b) => b.id === 8)!.closed).toBe(true)
    expect(builder.check(8, 0.01)?.solids).toBe(1)
    builder.dispose()
  })

  it('keeps a piece of several faces whole inside a solid tool: a zigzag split by a box keeps its three faces in it', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    const zigzag = emptySketch()
    addEntity(zigzag, { kind: 'line', a: [0, 0], b: [20, 5] })
    addEntity(zigzag, { kind: 'line', a: [20, 5], b: [40, -5] })
    addEntity(zigzag, { kind: 'line', a: [40, -5], b: [60, 0] })
    const s = rectangleSketch(5, 40, 40, [10, -20])
    const out = await build(builder, [
      { id: 1, kind: 'sketch', name: 'Zigzag', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: zigzag, visible: true },
      { id: 2, kind: 'sheet', name: 'Zigzag sheet', sketchId: 1, from: 0, to: 10, visible: true },
      s,
      extrudeAll(6, s, -5, 15),
      { id: 7, kind: 'split', name: 'Inside', body: 2, tools: [6], keep: 'largest', tolerance: 0.3, overlap: 0.5, visible: true },
    ])
    expect(out.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['2 ok', '6 ok', '7 ok'])
    const piece = out.bodies.find((b) => b.id === 2)!
    // Half of the first, all of the second and half of the third, 10 tall.
    const inside = (Math.hypot(10, 2.5) + Math.hypot(20, 10) + Math.hypot(10, 2.5)) * 10
    expect(piece.faces).toBe(3)
    expect(k.surfaceArea(builder.body(2)!)).toBeCloseTo(inside, 3)
    builder.dispose()
  })

  it('cuts with a plane fitted, once trimmed or joined, as the sheet it is', async () => {
    const builder = new Builder(await kernelPromise)
    const flat = gridScan(21, (s, t) => [-10 + 20 * s, -10 + 20 * t, 4])
    const positions = Float32Array.from(flat.positions)
    builder.setScan(new NominalSurface(positions, Uint32Array.from(flat.indices)), positions)
    const line = emptySketch()
    addEntity(line, { kind: 'line', a: [5, -30], b: [5, 30] })
    const features: Feature[] = [
      { id: 1, kind: 'surface', name: 'Floor', region: Uint32Array.from(flat.region), fit: { net: null, degree: 3, expandPct: 10, smoothness: 0.01 }, shape: 'plane', visible: true },
      { id: 2, kind: 'sketch', name: 'Wall line', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: line, visible: true },
      { id: 3, kind: 'sheet', name: 'Wall', sketchId: 2, from: -10, to: 20, visible: true },
    ]
    const b = builder as unknown as { bodyById(id: number): unknown; fittedFor(id: number, body: unknown, use: 'trim' | 'reach'): unknown }
    const asFitted = (use: 'trim' | 'reach') => b.fittedFor(1, b.bodyById(1), use) !== undefined
    await build(builder, features)
    expect([asFitted('trim'), asFitted('reach')]).toEqual([true, true])
    // Trimmed: a Trim cuts with the sheet as it is; a split it cuts still
    // carries it on as its plane, as a trimmed freeform from its fit.
    const trims: Feature[] = [
      { id: 4, kind: 'split', name: 'Floor trimmed', body: 1, tools: [3], keep: 'largest', tolerance: 0.3, overlap: 0.5, visible: true },
      { id: 5, kind: 'split', name: 'Wall trimmed', body: 3, tools: [1], keep: 'largest', tolerance: 0.3, overlap: 0.5, visible: true },
    ]
    const trimmed = await build(builder, [...features, ...trims])
    expect(trimmed.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['1 ok', '3 ok', '4 ok', '5 ok'])
    expect([asFitted('trim'), asFitted('reach')]).toEqual([false, true])
    // Joined to the wall, it is no plane at all.
    const joined = await build(builder, [...features, ...trims, { id: 6, kind: 'boolean', name: 'Corner', op: 'join', body: 1, tool: 3, visible: true }])
    expect(joined.results.find((r) => r.id === 6)?.status, joined.results.find((r) => r.id === 6)?.message).toBe('ok')
    expect([asFitted('trim'), asFitted('reach')]).toEqual([false, false])
    builder.dispose()
  })

  it('leaves the solid tool a body: one outline prism trims two sheets', async () => {
    const builder = new Builder(await kernelPromise)
    const skin = withFlange(builder)
    const line = emptySketch()
    addEntity(line, { kind: 'line', a: [0, -30], b: [0, 30] })
    const out = await build(builder, [
      skin,
      { id: 2, kind: 'sketch', name: 'Rib line', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: line, visible: true },
      { id: 3, kind: 'sheet', name: 'Rib', sketchId: 2, from: -10, to: 20, visible: true },
      ...box(),
      { id: 7, kind: 'boolean', name: 'Flange trimmed', op: 'intersect', body: 1, tool: 6, visible: true },
      { id: 8, kind: 'boolean', name: 'Rib trimmed', op: 'intersect', body: 3, tool: 6, visible: true },
    ])
    expect(out.results.map((r) => `${r.id} ${r.status}${r.message ? `: ${r.message}` : ''}`)).toEqual(['1 ok', '3 ok', '6 ok', '7 ok', '8 ok'])
    expect(out.bodies.find((b) => b.id === 6)?.closed).toBe(true)
    expect(out.bodies.find((b) => b.id === 3)!.box!.max[1]).toBeLessThan(10 + 1e-3)
    builder.dispose()
  })

  it('refuses keep "between" on a sheet, a sheet joined to a solid, and two sheets that do not meet', async () => {
    const builder = new Builder(await kernelPromise)
    const skin = withFlange(builder)
    const [s, extrude] = box()
    const out = await build(builder, [skin, s, extrude, { id: 7, kind: 'split', name: 'Between', body: 1, tools: [6, 6], keep: 'between', tolerance: 0.3, overlap: 0.5, visible: true }])
    expect(out.results.find((r) => r.id === 7)?.message).toMatch(/Flange face is a sheet: keep "between" takes the wall between two skins out of a solid/)
    const joined = await build(builder, [skin, s, extrude, { id: 7, kind: 'boolean', name: 'Join', op: 'join', body: 1, tool: 6, visible: true }])
    expect(joined.results.find((r) => r.id === 7)?.message).toMatch(/Flange face is a sheet, and .+ a solid — a sheet joins sheets/)
    const far = emptySketch()
    addEntity(far, { kind: 'line', a: [40, -10], b: [40, 10] })
    const apart = await build(builder, [skin, { id: 3, kind: 'sketch', name: 'Far line', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: far, visible: true }, { id: 4, kind: 'sheet', name: 'Far sheet', sketchId: 3, from: 0, to: 10, visible: true }, { id: 7, kind: 'boolean', name: 'Join', op: 'join', body: 1, tool: 4, visible: true }])
    expect(apart.results.find((r) => r.id === 7)?.message).toMatch(/^Flange face and Far sheet do not meet edge to edge — sewn within 0\.05 mm they stay 2 sheets apart\. Trim each by the other first/)
    builder.dispose()
  })
})
