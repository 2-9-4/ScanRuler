// SPDX-License-Identifier: AGPL-3.0-only
// An outline's profile about a centre or along an axis, and its teeth
// counted by prominence.
import { describe, expect, it } from 'vitest'
import { findObjects } from '../src/core/flat/objects'
import { outlineProfile, type ProfileAbout } from '../src/core/flat/profile'
import type { Vec2 } from '../src/core/flat/types'
import { mulberry32 } from '../src/core/fit/ransac'

/** A knurled outline r(θ) = R + a·cos(Nθ) about `center`, `count` points
 *  evenly round the turn, with uniform noise of ±`noise` on the radius. */
function knurl(teeth: number, R: number, a: number, center: Vec2, count: number, noise: number, seed = 1): number[] {
  const rand = mulberry32(seed)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const t = (2 * Math.PI * i) / count
    const r = R + a * Math.cos(teeth * t) + (rand() - 0.5) * 2 * noise
    out.push(center[0] + r * Math.cos(t), center[1] + r * Math.sin(t))
  }
  return out
}

/** The points in a deterministic shuffled order. */
function shuffled(points: number[], seed = 7): number[] {
  const rand = mulberry32(seed)
  const n = points.length / 2
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order.flatMap((i) => [points[2 * i], points[2 * i + 1]])
}

/** The angle between two directions round the turn, in [0, π]. */
const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

describe('outlineProfile, about a centre', () => {
  for (const teeth of [12, 20, 33]) {
    it(`counts ${teeth} teeth round a knurl, with their tips, roots and pitch`, () => {
      const R = 50
      const a = 1.5
      const profile = outlineProfile(knurl(teeth, R, a, [0, 0], 4000, 0.02), { kind: 'radial', center: [0, 0] }, { floor: 0.1 })
      expect(profile.kind).toBe('radial')
      expect(profile.sides).toHaveLength(1)
      const side = profile.sides[0]
      expect(side.peaks).toHaveLength(teeth)
      expect(side.valleys).toHaveLength(teeth)
      expect(side.pitch).toBeCloseTo((2 * Math.PI) / teeth, 12)
      // Tips at multiples of the pitch, one to each, roots halfway between —
      // the tip at 0° may be read just under a full turn, and come last.
      const pitch = (2 * Math.PI) / teeth
      const tooth = (position: number) => Math.round(position / pitch) % teeth
      expect(new Set(side.peaks.map((p) => tooth(p.position))).size).toBe(teeth)
      side.peaks.forEach((p) => {
        expect(angleGap(p.position, tooth(p.position) * pitch)).toBeLessThan(0.02)
        expect(Math.abs(p.value - (R + a))).toBeLessThan(0.05)
        expect(p.prominence).toBeGreaterThan(1.8 * a)
        expect(Math.hypot(p.at[0], p.at[1])).toBeCloseTo(p.value, 9)
      })
      side.valleys.forEach((v, k) => {
        // Each root follows its tip.
        expect(angleGap(v.position, side.peaks[k].position + pitch / 2)).toBeLessThan(0.02)
        expect(Math.abs(v.value - (R - a))).toBeLessThan(0.05)
        expect(Math.abs(v.prominence - 2 * a)).toBeLessThan(0.1)
      })
      expect(side.peakMean!).toBeCloseTo(R + a, 1)
      expect(side.valleyMean!).toBeCloseTo(R - a, 1)
      expect(side.max).toBeGreaterThanOrEqual(side.peaks[0].value)
      expect(side.min).toBeLessThanOrEqual(side.valleys[0].value)
      expect(profile.prominence).toBeGreaterThan(0.3 * 2 * a * 0.9)
    })
  }

  it('reads an off-centre outline the same whatever order its points come in', () => {
    const center: Vec2 = [123.4, -56.7]
    const points = knurl(20, 30, 0.8, center, 3000, 0.01, 5)
    const about = { kind: 'radial', center } as const
    const inOrder = outlineProfile(points, about, { floor: 0.05 }).sides[0]
    const mixed = outlineProfile(shuffled(points), about, { floor: 0.05 }).sides[0]
    expect(mixed.peaks).toHaveLength(20)
    expect(mixed.peaks.map((p) => p.position)).toEqual(inOrder.peaks.map((p) => p.position))
    expect(mixed.valleys.map((p) => p.value)).toEqual(inOrder.valleys.map((p) => p.value))
    expect(mixed.samples).toEqual(inOrder.samples)
  })

  it('finds no teeth on a smooth circle when the floor is above its noise', () => {
    const profile = outlineProfile(knurl(0, 40, 0, [3, 4], 2000, 0.05), { kind: 'radial', center: [3, 4] }, { floor: 0.2 })
    expect(profile.prominence).toBe(0.2)
    expect(profile.sides[0].peaks).toHaveLength(0)
    expect(profile.sides[0].valleys).toHaveLength(0)
    expect(profile.sides[0].pitch).toBeNull()
    expect(profile.sides[0].peakMean).toBeNull()
    expect(profile.sides[0].max).toBeLessThan(40.06)
    expect(profile.sides[0].min).toBeGreaterThan(39.94)
  })

  it('takes the outside of the silhouette: a hole rim in the same points does not pull it in', () => {
    const outline = knurl(12, 50, 1.5, [0, 0], 3000, 0.02)
    const rim = knurl(0, 20, 0, [0, 0], 1500, 0.02, 9)
    const both = outlineProfile([...rim, ...outline], { kind: 'radial', center: [0, 0] }, { floor: 0.1 }).sides[0]
    expect(both.peaks).toHaveLength(12)
    expect(both.min).toBeGreaterThan(48)
  })

  it('takes fewer, taller teeth at a larger prominence', () => {
    // Sixteen teeth, every other one standing only 0.3 as tall.
    const teeth = 16
    const a = 1
    const points: number[] = []
    for (let i = 0; i < 4000; i++) {
      const t = (2 * Math.PI * i) / 4000
      const k = Math.round((teeth * t) / (2 * Math.PI)) % teeth
      const r = 30 + a * Math.max(0, Math.cos(teeth * t)) * (k % 2 === 0 ? 1 : 0.3)
      points.push(r * Math.cos(t), r * Math.sin(t))
    }
    const at = (prominence: number) =>
      outlineProfile(points, { kind: 'radial', center: [0, 0] }, { floor: 0.01, prominence }).sides[0]
    expect(at(0.2).peaks).toHaveLength(16)
    const tall = at(0.5)
    expect(tall.peaks).toHaveLength(8)
    expect(tall.pitch).toBeCloseTo((2 * Math.PI) / 8, 12)
    expect(at(3).peaks).toHaveLength(0)
    expect(at(0.5).valleys.every((v) => Math.abs(v.value - 30) < 1e-9)).toBe(true)
  })

  it('samples in as many bins as asked, and bridges the empty ones', () => {
    const points = knurl(12, 50, 1.5, [0, 0], 4000, 0.02)
    const about: ProfileAbout = { kind: 'radial', center: [0, 0] }
    const asked = outlineProfile(points, about, { floor: 0.1, samples: 90 }).sides[0]
    expect(asked.samples).toHaveLength(90)
    expect(asked.peaks).toHaveLength(12)
    for (let i = 1; i < asked.samples.length; i++) expect(asked.samples[i][0]).toBeGreaterThan(asked.samples[i - 1][0])
    expect(asked.samples.every(([p]) => p >= 0 && p < 2 * Math.PI)).toBe(true)
    // About two points to a bin by default.
    expect(outlineProfile(points, about, { floor: 0.1 }).sides[0].samples).toHaveLength(2000)
    // More bins than points: half of them empty, the teeth all still there.
    const sparse = outlineProfile(knurl(12, 50, 1.5, [0, 0], 300, 0.02), about, { floor: 0.1, samples: 600 }).sides[0]
    expect(sparse.samples).toHaveLength(300)
    expect(sparse.peaks).toHaveLength(12)
  })

  it('counts a flat-topped tooth on a traced pixel outline once', () => {
    // Twelve teeth with tips at 0°, 90°, 180°, 270°: there the tip falls on a
    // pixel row or column, the traced outline's top is a short flat run, and
    // the run's two ends stand exactly equally far out with a dip between.
    const width = 600
    const height = 500
    const gray = new Uint8Array(width * height).fill(255)
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const dx = col + 0.5 - 300
        const dy = row + 0.5 - 250
        if (Math.hypot(dx, dy) <= 90 + 6 * Math.cos(12 * Math.atan2(dy, dx))) gray[row * width + col] = 0
      }
    }
    const [wheel] = findObjects(gray, width, height, { minArea: 1, scale: { x: 0.1, y: 0.1 } }).objects
    const side = outlineProfile(wheel.outline, { kind: 'radial', center: wheel.centroid }, { floor: 0.15 }).sides[0]
    expect(side.peaks).toHaveLength(12)
    // One tip to each tooth, within a pixel's worth of angle of it.
    const pitch = (2 * Math.PI) / 12
    const tooth = (position: number) => Math.round(position / pitch) % 12
    expect(new Set(side.peaks.map((p) => tooth(p.position))).size).toBe(12)
    side.peaks.forEach((p) => expect(angleGap(p.position, tooth(p.position) * pitch)).toBeLessThan(0.05))
    expect(side.peakMean!).toBeCloseTo(9.6, 1)
    expect(side.valleyMean!).toBeCloseTo(8.4, 1)
  })

  it('returns an empty side for no points', () => {
    const profile = outlineProfile([], { kind: 'radial', center: [0, 0] }, { floor: 0.5 })
    expect(profile.prominence).toBe(0.5)
    expect(profile.sides[0]).toEqual({
      peaks: [],
      valleys: [],
      pitch: null,
      max: 0,
      min: 0,
      peakMean: null,
      valleyMean: null,
      samples: [],
    })
  })
})

/** A toothed bar along `dir` from `start`, `length` long: the left flank
 *  w + a·(1 − cos 2πt/p)/2, tips at (k + ½)p; the right flank
 *  w + a·(1 − sin 2πt/p)/2, tips at (k + ¾)p; the two ends straight across. */
function toothedBar(start: Vec2, dir: Vec2, length: number, teeth: number, w: number, a: number): number[] {
  const p = length / teeth
  const left = (t: number) => w + (a * (1 - Math.cos((2 * Math.PI * t) / p))) / 2
  const right = (t: number) => w + (a * (1 - Math.sin((2 * Math.PI * t) / p))) / 2
  const out: number[] = []
  const put = (t: number, s: number) =>
    out.push(start[0] + t * dir[0] - s * dir[1], start[1] + t * dir[1] + s * dir[0])
  const along = 2000
  for (let i = 0; i <= along; i++) {
    const t = (length * i) / along
    put(t, left(t))
    put(t, -right(t))
  }
  for (let i = 1; i < 50; i++) {
    for (const t of [0, length]) {
      put(t, (left(t) * i) / 50)
      put(t, (-right(t) * i) / 50)
    }
  }
  return out
}

describe('outlineProfile, along an axis', () => {
  const angle = (35 * Math.PI) / 180
  const dir: Vec2 = [Math.cos(angle), Math.sin(angle)]
  const start: Vec2 = [10, 20]
  const L = 40
  const M = 10
  const w = 5
  const a = 0.6
  const points = shuffled(toothedBar(start, dir, L, M, w, a))
  // The axis taken from the bar's middle.
  const origin: Vec2 = [start[0] + (L / 2) * dir[0], start[1] + (L / 2) * dir[1]]
  const profile = outlineProfile(points, { kind: 'axial', origin, dir }, { floor: 0.05 })

  it('counts the teeth on each flank, left of the axis first', () => {
    expect(profile.kind).toBe('axial')
    expect(profile.sides).toHaveLength(2)
    const [left, right] = profile.sides
    expect(left.peaks).toHaveLength(M)
    expect(right.peaks).toHaveLength(M)
    expect(left.valleys).toHaveLength(M - 1)
    expect(left.pitch!).toBeCloseTo(L / M, 1)
    expect(right.pitch!).toBeCloseTo(L / M, 1)
    left.peaks.forEach((p, k) => {
      expect(Math.abs(p.position - ((k + 0.5) * L) / M + L / 2)).toBeLessThan(0.05)
      expect(Math.abs(p.value - (w + a))).toBeLessThan(1e-3)
      // On the left of the axis: a positive cross product with its direction.
      const cross = dir[0] * (p.at[1] - origin[1]) - dir[1] * (p.at[0] - origin[0])
      expect(cross).toBeCloseTo(p.value, 9)
    })
    right.peaks.forEach((p, k) => {
      expect(Math.abs(p.position - ((k + 0.75) * L) / M + L / 2)).toBeLessThan(0.05)
      const cross = dir[0] * (p.at[1] - origin[1]) - dir[1] * (p.at[0] - origin[0])
      expect(cross).toBeCloseTo(-p.value, 9)
    })
    left.valleys.forEach((v) => {
      expect(Math.abs(v.value - w)).toBeLessThan(1e-3)
      expect(Math.abs(v.prominence - a)).toBeLessThan(2e-3)
    })
    // The bins span the flank end to end; each reports where its outermost
    // point lies, within a bin of the end.
    expect(Math.abs(left.samples[0][0] + L / 2)).toBeLessThan(0.05)
    expect(Math.abs(left.samples[left.samples.length - 1][0] - L / 2)).toBeLessThan(0.05)
  })

  it('does not count a maximum at either end of a flank', () => {
    // The left flank tipped at both ends: a tooth's worth further on either
    // side has no valley beyond it.
    const shifted = shuffled(toothedBar(start, dir, L + 0.5 * (L / M), M, w, a))
    const left = outlineProfile(
      shifted,
      { kind: 'axial', origin: start, dir: [-dir[0], -dir[1]] },
      { floor: 0.05 },
    ).sides[1]
    expect(left.peaks.length).toBe(M)
    expect(left.peaks.every((p) => p.position > -L - 0.5 * (L / M) + 0.1 && p.position < -0.1)).toBe(true)
  })

  it('takes a direction of any length and keeps an empty flank as an empty side', () => {
    const oneSided = toothedBar(start, dir, L, M, w, a).filter((_, i, all) => {
      const pair = i - (i % 2)
      return dir[0] * (all[pair + 1] - start[1]) - dir[1] * (all[pair] - start[0]) >= 0
    })
    const profile = outlineProfile(
      oneSided,
      { kind: 'axial', origin: start, dir: [dir[0] * 7, dir[1] * 7] },
      { floor: 0.05, samples: 200 },
    )
    expect(profile.sides[0].peaks).toHaveLength(M)
    expect(profile.sides[0].samples).toHaveLength(200)
    expect(profile.sides[1].peaks).toHaveLength(0)
    expect(profile.sides[1].samples).toHaveLength(0)
    expect(profile.sides[1].pitch).toBeNull()
    expect(() => outlineProfile(oneSided, { kind: 'axial', origin: start, dir: [0, 0] }, { floor: 0.05 })).toThrow()
  })
})

describe('the pitch along a row of pixel-traced teeth', () => {
  it('is read to within half a percent, though each spacing is a bin out', () => {
    // A part lying at 15° on a 600 dpi scan, eight teeth of 1.25 a side.
    const ppm = 23.622
    const [W, H, cx, cy, angle] = [400, 260, 8, 5, (15 * Math.PI) / 180]
    const d: Vec2 = [Math.cos(angle), Math.sin(angle)]
    const gray = new Uint8Array(W * H).fill(225)
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const [x, y] = [(c + 0.5) / ppm - cx, (r + 0.5) / ppm - cy]
        const s = x * d[0] + y * d[1]
        const t = -x * d[1] + y * d[0]
        const flank = 2.75 + 0.25 * Math.cos((2 * Math.PI * (s + 5 - 0.625)) / 1.25)
        if (Math.abs(s) <= 5 && Math.abs(t) <= flank) gray[r * W + c] = 30
      }
    }
    const [o] = findObjects(gray, W, H, { minArea: 1, scale: { x: 1 / ppm, y: 1 / ppm } }).objects
    const about: ProfileAbout = { kind: 'axial', origin: o.centroid, dir: [Math.cos(o.axisAngle), Math.sin(o.axisAngle)] }
    for (const side of outlineProfile(o.outline, about, { floor: 1.5 / ppm }).sides) {
      expect(side.peaks).toHaveLength(8)
      expect(Math.abs(side.pitch! / 1.25 - 1)).toBeLessThan(0.005)
    }
  })
})
