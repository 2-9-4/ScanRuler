// SPDX-License-Identifier: AGPL-3.0-only
// Trim to scan: a body modelled to fill a
// chip out of a ring, 2 mm into the material and 0.2 mm larger than the part
// on every skin, cut to fit the scanned fracture.
//
// First what was rejected, kept as a negative test: the body minus the scan
// expanded by the offset leaves a skin of the body wherever it is larger
// than the part by more than the offset — flaps a few hundredths thick along
// the joint, outside the part. Then the tool: one closed piece on the side
// the scan's normals point to, its skins the body's own, its mating face the
// offset off the fracture, and nothing of it past the break. On a box cut by
// a flat sheet the piece's volume says exactly where the cut went; and what
// goes wrong is said in words.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import Module, { type ManifoldToplevel } from 'manifold-3d'
import { NominalSurface, emptyHit } from '../../../src/core/deviation/surface'
import { boxMesh } from '../../../tests/helpers'
import { booleanMesh, closedness } from '../core/boolean'
import { offsetMesh } from '../core/offset'
import { surveyPieces } from '../core/pieces'
import { prepareBody, trimToScan, type TrimmedPiece } from '../core/trimToScan'
import { brokenRing, OVERSIZE, RING, type BrokenRing } from './brokenRing'
import { sheet } from './sheet'

// Kernel builds and real-scan fits run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

const DEPTH = 0.3

let wasm: ManifoldToplevel
let ring: BrokenRing
let scanSurface: NominalSurface
let bodySurface: NominalSurface
beforeAll(async () => {
  wasm = await Module()
  wasm.setup()
  ring = brokenRing(wasm)
  scanSurface = new NominalSurface(ring.scan.positions, ring.scan.indices)
  bodySurface = new NominalSurface(ring.body.positions, ring.body.indices)
})

/** Quantiles of a list of numbers. */
function spread(values: number[]): { min: number; p05: number; median: number; p95: number; max: number } {
  const s = [...values].sort((a, b) => a - b)
  const q = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]
  return { min: s[0], p05: q(0.05), median: q(0.5), p95: q(0.95), max: s[s.length - 1] }
}

function triangleArea(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}

/** The area of the surface lying past the fracture, in the material the
 *  body overlaps — where nothing of the piece belongs. */
function areaPastBreak(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  const past = ring.fractureSpan + 0.25
  let area = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2]
    const x = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3
    const y = (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3
    const z = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3
    if (ring.beyond(x, y, z) > past) area += triangleArea(positions, a, b, c)
  }
  return area
}

/** A piece closed all round and of genus 0: every edge had twice, and
 *  V − E + F = 2. */
function expectClosedBall(piece: TrimmedPiece) {
  const count = piece.positions.length / 3
  expect(closedness(piece.indices, count)).toEqual({ open: 0, bad: 0 })
  expect(count - piece.indices.length / 6).toBe(2)
}

/** The 20 mm box as a CAD body's mesh comes, every triangle on its own. */
function boxBody(shift = 0) {
  const positions = boxMesh(20, 4)
  for (let i = 0; i < positions.length; i += 3) positions[i] += shift
  return { positions, indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) }
}

describe('the broken ring', () => {
  it('is a closed scan with a rough break, and a closed body oversize all round', () => {
    const { scan, body } = ring
    expect(closedness(scan.indices, scan.vertexCount)).toEqual({ open: 0, bad: 0 })
    expect(closedness(body.indices, body.vertexCount)).toEqual({ open: 0, bad: 0 })
    // The ring's outside, where the body covers it, is the oversize inside
    // the body — 0.19 mm at the median, 0.26 at the most: shallower than the
    // depth, so it never counts as break.
    const hit = emptyHit()
    const skin: number[] = []
    for (let v = 0; v < scan.vertexCount; v++) {
      const x = scan.positions[v * 3], y = scan.positions[v * 3 + 1], z = scan.positions[v * 3 + 2]
      if (Math.abs(Math.hypot(x, y) - RING.outer) > 0.08) continue
      if (!bodySurface.closest(x, y, z, hit, 5) || hit.signed > 0) continue
      if (ring.beyond(x, y, z) < ring.fractureSpan + 0.1) continue
      skin.push(hit.signed)
    }
    expect(skin.length).toBeGreaterThan(100)
    const s = spread(skin)
    expect(s.min).toBeGreaterThan(-DEPTH)
    expect(s.median).toBeCloseTo(-OVERSIZE, 1)
  })
})

describe('the body minus the scan expanded by the offset (rejected)', () => {
  it('leaves flaps of the body’s skin past the break, a few hundredths thick', () => {
    const { scan, body } = ring
    const expanded = offsetMesh(scan.positions, scan.indices, scan.vertexCount, { distance: 0.15 })
    const out = booleanMesh(wasm, body, [{ positions: expanded.positions, indices: expanded.indices }], 'subtract')
    const n = out.positions.length / 3
    // How thick the flaps are: their inner face, the expanded scan's, from
    // the body's skin.
    const hit = emptyHit()
    const thick: number[] = []
    for (let v = 0; v < n; v++) {
      const x = out.positions[v * 3], y = out.positions[v * 3 + 1], z = out.positions[v * 3 + 2]
      if (ring.beyond(x, y, z) < ring.fractureSpan + 0.25) continue
      bodySurface.closest(x, y, z, hit)
      if (hit.distance > 1e-3) thick.push(hit.distance)
    }
    // The documented failure: one piece, but with 228 mm² of surface past
    // the break — skin wrapped round the outside of the part, 0.05 mm thick
    // at the median and a thousandth at the least: the oversize less the
    // offset, scatter and all, thinner than anything prints.
    expect(surveyPieces(out.positions, out.indices, n, 1).pieces).toBe(1)
    expect(areaPastBreak(out.positions, out.indices)).toBeGreaterThan(150)
    const t = spread(thick)
    expect(t.median).toBeGreaterThan(0.02)
    expect(t.median).toBeLessThan(0.1)
  })
})

describe('the body trimmed to the scanned break', () => {
  it.each([0.15, 0])('at an offset of %s mm: one closed piece, its skins the body’s, its mating face the offset off the fracture', (offset) => {
    const body = prepareBody(wasm, ring.body)
    const piece = trimToScan(wasm, ring.scan, body, { depth: DEPTH, offset, flip: false }, undefined, () => scanSurface)
    const r = piece.report
    expect(r.break.pieces).toBe(1)
    expect(r.extend.rims).toBe(1)
    // The chip, about 1230 mm³ (1258 at no offset), and what overlapped the
    // material, about 400, dropped.
    expect(r.pieces).toBe(1)
    expect(r.dropped).toBe(1)
    expect(r.volume).toBeGreaterThan(1200)
    expect(r.slab).toBeCloseTo(Math.max(2 * offset, 0.02), 6)
    expectClosedBall(piece)

    const { positions: p, indices: idx, mating } = piece
    const onMating = new Uint8Array(p.length / 3)
    const onSkin = new Uint8Array(p.length / 3)
    let matingArea = 0
    for (let t = 0; t < mating.length; t++) {
      const mark = mating[t] ? onMating : onSkin
      for (let k = 0; k < 3; k++) mark[idx[t * 3 + k]] = 1
      if (mating[t]) matingArea += triangleArea(p, idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2])
    }
    expect(r.matingArea).toBeCloseTo(matingArea, 3)
    const hit = emptyHit()
    let skinOff = 0
    const inWall: number[] = []
    let nearest = Infinity
    for (let v = 0; v < p.length / 3; v++) {
      const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2]
      scanSurface.closest(x, y, z, hit)
      nearest = Math.min(nearest, hit.signed)
      const rr = Math.hypot(x, y)
      if (onMating[v] && !onSkin[v] && rr > RING.inner + 0.3 && rr < RING.outer - 0.3 && z < RING.height - 0.3) inWall.push(hit.signed - r.slab / 2)
      if (onSkin[v]) {
        bodySurface.closest(x, y, z, hit)
        skinOff = Math.max(skinOff, hit.distance)
      }
    }
    // The skins are the body's own, to the float.
    expect(skinOff).toBeLessThan(1e-4)
    // The mating face, across the wall, the offset off the fracture: 5–95 %
    // within a hundredth, and no nearer than 0.05 mm short of it anywhere —
    // where the leaning groove, tighter than the offset, closed up in the
    // slab.
    const w = spread(inWall)
    expect(w.p05).toBeGreaterThan(-0.01)
    expect(w.p95).toBeLessThan(0.01)
    expect(w.min).toBeGreaterThan(-0.05)
    // Nothing past the break, and nowhere touching the part.
    expect(areaPastBreak(p, idx)).toBe(0)
    expect(nearest).toBeGreaterThan(0)
    // The piece's own reading of it, against the scan, where it lies over
    // the break: at the offset at the median, 5–95 % within −0.008…+0.03
    // (0.15 mm) and ±0.001 (0); the band by the part's skins, where the
    // extension stands in for the last of the fracture, up to 0.24 mm
    // further off, and nowhere 0.04 mm into the gap.
    const fit = r.fit!
    expect(fit.measured).toBeGreaterThan(1000)
    expect(Math.abs(fit.median)).toBeLessThan(0.002)
    expect(fit.p05).toBeGreaterThan(-0.01)
    expect(fit.p95).toBeLessThan(0.05)
    expect(fit.min).toBeGreaterThan(-0.05)
    let read = 0
    for (let v = 0; v < piece.gap.length; v++) if (Number.isFinite(piece.gap[v])) read++
    expect(read).toBe(fit.measured)
    expect(read).toBeLessThan(onMating.reduce((s, x) => s + x, 0))
  })

  it('keeps the other side when flipped: what overlapped the material', () => {
    const piece = trimToScan(wasm, ring.scan, prepareBody(wasm, ring.body), { depth: DEPTH, offset: 0.15, flip: true })
    expect(piece.report.pieces).toBe(1)
    expect(piece.report.volume).toBeGreaterThan(300)
    expect(piece.report.volume).toBeLessThan(500)
    expect(piece.report.matingArea).toBeGreaterThan(150)
    expectClosedBall(piece)
  })
})

describe('a box trimmed to a flat sheet through it', () => {
  // The sheet faces up, so the upper half is kept, cut the offset above the
  // sheet: its volume says exactly where.
  it.each([
    [0.15, false, 20 * 20 * (10 - 0.15)],
    [0.15, true, 20 * 20 * (10 - 0.15)],
    [0, false, 20 * 20 * (10 - 0.01)],
  ])('at an offset of %s mm, flipped %s: the half the offset off the sheet', (offset, flip, volume) => {
    const body = prepareBody(wasm, boxBody(), 'Box')
    expect(body.volume).toBeCloseTo(8000, 3)
    const s = sheet()
    const piece = trimToScan(wasm, s, body, { depth: DEPTH, offset, flip })
    expect(piece.report.volume).toBeCloseTo(volume, 2)
    expect(piece.report.matingArea).toBeCloseTo(400, 2)
    expectClosedBall(piece)
    // On a flat break the mating face reads the offset to the float.
    expect(piece.report.fit!.min).toBeGreaterThan(-1e-4)
    expect(piece.report.fit!.max).toBeLessThan(1e-4)
    const sign = flip ? -1 : 1
    for (let v = 0; v < piece.positions.length / 3; v++) {
      expect(sign * piece.positions[v * 3 + 2]).toBeGreaterThan(piece.report.slab / 2 - 1e-4)
    }
  })

  it('cuts it through where the scan has a gap open to the break’s edge', () => {
    // A slot 1 mm wide in from the sheet's edge to 5 mm inside the box's
    // wall: a spot the scanner missed. The cut still goes through, near
    // enough where the sheet would have put it — the patch across the slot
    // is the sheet's plane, to the scan's scatter.
    const body = prepareBody(wasm, boxBody(), 'Box')
    const piece = trimToScan(wasm, sheet({ notch: { to: 5, width: 1 } }), body, { depth: DEPTH, offset: 0.15, flip: false })
    expect(piece.report.extend.bays).toBe(1)
    expect(piece.report.pieces).toBe(1)
    expect(piece.report.volume).toBeCloseTo(20 * 20 * (10 - 0.15), 0)
    expectClosedBall(piece)
  })

  it('says so when the body misses the scan, or is not a solid', () => {
    const s = sheet()
    expect(() => trimToScan(wasm, s, prepareBody(wasm, boxBody(100)), { depth: DEPTH, offset: 0.15, flip: false })).toThrow(
      /The scan nowhere lies more than 0\.3 mm inside the body/,
    )
    const open = boxBody()
    expect(() => prepareBody(wasm, { positions: open.positions, indices: open.indices.slice(3) }, 'Box')).toThrow(
      /^Box did not come out as a closed mesh — is it a solid body, not a surface\?/,
    )
  })

  it('says so when the break does not cut the body through, or leaves nothing on its side', () => {
    // A square ring cut across one side — the plane y = 0 where x > 2.5,
    // through the right-hand side only: still one piece round the others.
    const outer = wasm.Manifold.cube([20, 20, 6], true)
    const hole = wasm.Manifold.cube([10, 10, 8], true)
    const frame = outer.subtract(hole)
    const mesh = frame.getMesh()
    const body = prepareBody(wasm, { positions: Float32Array.from(mesh.vertProperties), indices: Uint32Array.from(mesh.triVerts) }, 'Frame')
    for (const m of [outer, hole, frame]) m.delete()
    const across = sheet({ origin: [10, 0, 0], u: [0, 0, 1], v: [1, 0, 0], size: 15 })
    expect(() => trimToScan(wasm, across, body, { depth: DEPTH, offset: 0.15, flip: false })).toThrow(/The break does not cut the body through/)
    // A break 0.4 mm under the box's top, with an offset that takes all of
    // what is above it.
    const high = sheet({ origin: [0, 0, 9.6] })
    expect(() => trimToScan(wasm, high, prepareBody(wasm, boxBody()), { depth: DEPTH, offset: 0.45, flip: false })).toThrow(
      /Nothing of the body lies on the missing piece’s side of the break — flip the side/,
    )
  })
})
