// SPDX-License-Identifier: AGPL-3.0-only
// A smooth loft whose skin crosses itself between its sections (round 16,
// S2): the rumble pak's hump lofted through z 8/21/24/33/38 with a front
// half-width of 1.4/1.82/2.7/0.55/0.47 — the close pair at 21 and 24
// disagrees, the rails overshoot and the narrow front face turns inside
// out at z 9–17.6 and 35–37. The kernel answers it valid with volume; the
// fold check refuses it at the loft naming the close pair, and leaves the
// ruled loft and the loft without the z 24 section be. An intersect that
// comes out empty says "do not overlap" only when the boxes are apart, and
// the body check reads a loft's faces for a fold.

import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec2 } from '../../../src/core/flat/types'
import type { Vec3 } from '../../../src/core/types'
import { applyReversePart, type ReversePart } from '../app/projectSection'
import { Builder } from '../core/build'
import type { BooleanFeature, Feature, LoftFeature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import type { LoopPiece, Profile } from '../core/kernelTypes'
import { sectionsNormal } from '../core/loftFold'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, addRectangle, type Sketch } from '../core/sketch'
import { useReverse } from '../state/reStore'
import reversePlugin from '../plugin'
import { build, extrudeAll, sketchOf } from './reKit'

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** The sections' heights and front half-widths. */
const HUMP: [number, number][] = [[8, 1.4], [21, 1.82], [24, 2.7], [33, 0.55], [38, 0.47]]

/** A sketch on the XY plane at height z, drawn by `draw`. */
function sketchAt(id: number, name: string, z: number, draw: (s: Sketch) => void): SketchFeature {
  const s = sketchOf(id, draw)
  const frame: SectionFrame = { ...s.frame, origin: [0, 0, z] }
  return { ...s, name, plane: { kind: 'world', axis: 'z', offset: z }, frame }
}

/** The hump's outline: a front edge of half-width w at y 12, slanting
 *  sides to an upright rectangle's, an arc round the back. */
function humpAt(id: number, z: number, w: number): SketchFeature {
  return sketchAt(id, `Hump z${z}`, z, (s) => {
    const corners: Vec2[] = [[-10, 0], [-10, 6], [-w, 12], [w, 12], [10, 6], [10, 0]]
    for (let i = 0; i + 1 < corners.length; i++) addEntity(s, { kind: 'line', a: corners[i], b: corners[i + 1] })
    addEntity(s, { kind: 'arc', c: [0, 0], r: 10, start: Math.PI, sweep: Math.PI })
  })
}

/** The hump's outline as a profile, for the kernel alone. */
function humpProfile(z: number, w: number): Profile {
  const p = (x: number, y: number): Vec3 => [x, y, z]
  const outer: LoopPiece[] = [
    { kind: 'line', a: p(-w, 12), b: p(w, 12) },
    { kind: 'line', a: p(w, 12), b: p(10, 6) },
    { kind: 'line', a: p(10, 6), b: p(10, 0) },
    { kind: 'arc', a: p(10, 0), m: p(0, -10), b: p(-10, 0) },
    { kind: 'line', a: p(-10, 0), b: p(-10, 6) },
    { kind: 'line', a: p(-10, 6), b: p(-w, 12) },
  ]
  return { outer, holes: [] }
}

const loft = (id: number, sketches: number[], ruled = false): LoftFeature => ({ id, kind: 'loft', name: `Loft ${id}`, sketches, ruled, op: 'new', visible: true })
const intersect = (id: number, body: number, tool: number): BooleanFeature => ({ id, kind: 'boolean', name: `Intersect ${id}`, op: 'intersect', body, tool, visible: true })

/** A block over the loft's middle and front: x −20…20, y −20…5, z 10…30. */
function block(sketchId: number, extrudeId: number): Feature[] {
  const s = sketchAt(sketchId, 'Block', 10, (sk) => addRectangle(sk, [-20, -20], [20, 5]))
  return [s, extrudeAll(extrudeId, s, 0, 20)]
}

describe('a smooth loft that folds', () => {
  it('is refused at the loft, naming the close pair and where it folds', async () => {
    const humps = HUMP.map(([z, w], i) => humpAt(i + 1, z, w))
    const out = await build(new Builder(await kernelPromise), [...humps, loft(6, [1, 2, 3, 4, 5])])
    const r = out.results.find((x) => x.id === 6)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/^The smooth loft crosses itself at z 9\.\d near \(-?0(\.\d)?, 1\d\.\d\), between Hump z8 and Hump z21 \(folded over z 9\.\d–1\d\.\d and 3\d\.\d–3\d\.\d\): Hump z21 and Hump z24 are 3 mm apart and differ — drop or move one, or make the loft ruled\.$/)
  })

  it('builds ruled, and without the z 24 section, and each intersects a block with volume', async () => {
    const k = await kernelPromise
    const humps = HUMP.map(([z, w], i) => humpAt(i + 1, z, w))
    for (const [what, made] of [['ruled', loft(6, [1, 2, 3, 4, 5], true)], ['4 sections', loft(6, [1, 2, 4, 5])]] as const) {
      const builder = new Builder(k)
      const out = await build(builder, [...humps, made, ...block(7, 8), intersect(9, 6, 8)])
      expect(out.results.filter((x) => x.status === 'failed'), what).toEqual([])
      const check = builder.check(6, 0.01)!
      expect(check.volume, what).toBeGreaterThan(3000)
      expect(check.volume, what).toBeLessThan(8000)
      // The body check reads a smooth loft's faces, trimmed by the block,
      // and finds no fold; a ruled loft's it leaves out.
      expect(check.folds, what).toEqual(what === 'ruled' ? undefined : [])
      builder.dispose()
    }
  })

  it('is found on the kernel’s loft alone, in a few ms, also on its faces as a body holds them', async () => {
    const k = await kernelPromise
    const profiles = HUMP.map(([z, w]) => humpProfile(z, w))
    const folded = k.loft(profiles, false)
    // The kernel's check passes it, and it has volume.
    expect(k.isValid(folded)).toBe(true)
    expect(k.volume(folded)).toBeGreaterThan(9000)
    const fold = k.loftFold(folded, { normal: sectionsNormal(profiles) })!
    expect(fold.folded.length).toBeGreaterThan(5)
    expect(fold.at[2]).toBeGreaterThan(8)
    expect(fold.at[2]).toBeLessThan(21)
    expect(fold.ms).toBeLessThan(200)
    // Its own faces, inside them, the cuts laid in their own plane.
    expect(k.loftFold(folded, { faces: new Set(k.faceHashes(folded)), trimmed: true })?.folded.length).toBeGreaterThan(5)
    const sound = k.loft([0, 1, 3, 4].map((i) => profiles[i]), false)
    expect(k.loftFold(sound, { normal: sectionsNormal(profiles) })).toBeNull()
    k.release(folded, sound)
  })
})

describe('an intersect that leaves nothing', () => {
  /** An L, 20 × 20 with a 10 × 10 notch, 10 high. */
  const ell = (): Feature[] => {
    const s = sketchAt(1, 'L', 0, (sk) => {
      const corners: Vec2[] = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]
      corners.forEach((p, i) => addEntity(sk, { kind: 'line', a: p, b: corners[(i + 1) % corners.length] }))
    })
    return [s, extrudeAll(2, s, 0, 10)]
  }
  const cube = (from: Vec2, to: Vec2): Feature[] => {
    const s = sketchAt(3, 'Cube', 2, (sk) => addRectangle(sk, from, to))
    return [s, extrudeAll(4, s, 0, 6)]
  }

  it('says the bodies do not overlap only when their boxes are apart', async () => {
    const k = await kernelPromise
    const apart = await build(new Builder(k), [...ell(), ...cube([40, 40], [46, 46]), intersect(5, 2, 4)])
    expect(apart.results.find((x) => x.id === 5)?.message).toBe('The bodies do not overlap.')
    // In the L's notch: the boxes meet, the solids do not.
    const notch = await build(new Builder(k), [...ell(), ...cube([12, 12], [18, 18]), intersect(5, 2, 4)])
    expect(notch.results.find((x) => x.id === 5)?.message).toMatch(/^The bounds overlap but the kernel found no common volume — a body may fold over itself — tried exact, .*\. Fold check: Extrude 2: no faces of a smooth loft; Extrude 4: no faces of a smooth loft\.$/)
  })
})

// The rumble pak's _05 with loft 73 through [69, 79, 70, 71, 72] — the z 24
// sketch added — refused at the loft rather than at the intersect after it.
const PROJECT = process.env.RE_FOLD_PROJECT ?? ''

describe.skipIf(!PROJECT)('the rumble pak’s folded hump', () => {
  beforeAll(() => reversePlugin.install?.())

  for (const added of [false, true]) {
    it(added ? 'with the z 24 sketch added, fails at the loft' : 'as saved, builds the loft', async () => {
      const zip = unzipSync(readFileSync(PROJECT))
      applyReversePart(JSON.parse(strFromU8(zip['project.json'])).reverse as ReversePart)
      const features = useReverse.getState().features.map((f) => (added && f.id === 73 && f.kind === 'loft' ? { ...f, sketches: [69, 79, 70, 71, 72] } : f))
      const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
      const sketches = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
      const k = await kernelPromise
      // The check's own time, loft by loft.
      const took: number[] = []
      const loftFold = k.loftFold.bind(k)
      const timed = Object.assign(Object.create(k) as ReKernel, {
        loftFold: (...a: Parameters<ReKernel['loftFold']>) => {
          const t = performance.now()
          try {
            return loftFold(...a)
          } finally {
            took.push(performance.now() - t)
          }
        },
      })
      const builder = new Builder(timed)
      const out = builder.build(steps, (id) => sketches.get(id))
      console.log('fold checks', took.map((t) => t.toFixed(1)).join(', '), 'ms')
      const failed = out.results.filter((r) => r.status === 'failed')
      for (const f of failed) console.log('FAILED', f.id, features.find((x) => x.id === f.id)?.name, f.message)
      if (added) {
        expect(failed[0]?.id).toBe(73)
        expect(failed[0]?.message).toMatch(/^The smooth loft crosses itself at z 9\.\d .*: Hump z21 sk and Hump z24 sk are 3 mm apart and differ/)
      } else expect(failed.find((f) => f.id === 73)).toBeUndefined()
      builder.dispose()
    }, 1_800_000)
  }
})
