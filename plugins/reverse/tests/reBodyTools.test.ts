// SPDX-License-Identifier: AGPL-3.0-only
// The tools for laying bodies out against one another, through the kernel:
// a pattern repeated in a grid; a body grown or shrunk all round, kept
// beside it or in its place; the clearance between two bodies; a blind
// hole drilled into a flat face for a heat-set insert; bodies written to
// STEP as parts under their names and in their colours.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { islandId, type ExtrudeFeature, type Feature, type ResolveContext, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import { insertHole, insertSize } from '../core/inserts'
import { rectangleSketch, XY } from './reKit'
import { loadManifold } from './reLocal'

const kernelPromise = ReKernel.load()
const manifoldPromise = loadManifold()

function extrudeAll(id: number, sketch: SketchFeature, from: number, to: number, op: ExtrudeFeature['op'] = 'new'): ExtrudeFeature {
  return { id, kind: 'extrude', name: `Extrude ${id}`, sketchId: sketch.id, regions: findRegions(sketch.sketch).map((r) => r.key), extent: { kind: 'distance', from, to }, op, visible: true }
}

const ctx = (): ResolveContext => ({ sections: [], elements: [], modelCenter: [0, 0, 0] })

async function build(builder: Builder, features: Feature[]) {
  const steps = resolveFeatures(features, ctx(), (f) => findRegions(f.sketch))
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return builder.build(steps, (id) => sketches.get(id))
}

describe('a pattern in a grid', () => {
  it('repeats a row along a second direction: copies apart are bodies of their own', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 4, 2)
    const grid: Feature = { id: 3, kind: 'pattern', name: 'Pattern 1', body: 2, mode: 'linear', axis: { kind: 'world', axis: 'x' }, count: 4, step: 10, axis2: { kind: 'world', axis: 'y' }, count2: 3, step2: 5, visible: true }
    const out = await build(builder, [s, extrudeAll(2, s, 0, 1), grid])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(out.bodies).toHaveLength(12)
    for (const b of out.bodies) expect(b.volume).toBeCloseTo(8, 6)
    expect(out.bodies[0].id).toBe(2)
    expect(out.bodies.map((b) => b.id)).toContain(islandId(3, 10))
    // The far corner of the grid: three spacings along X, two along Y.
    const far = Math.max(...out.bodies.flatMap((b) => Array.from(b.mesh.positions).filter((_, i) => i % 3 === 1)))
    expect(far).toBeCloseTo(2 * 5 + 2, 6)
    builder.dispose()
  })

  it('is one row with a count of one along the second direction, and refuses two directions alike', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 4, 2)
    const row: Feature = { id: 3, kind: 'pattern', name: 'Pattern 1', body: 2, mode: 'linear', axis: { kind: 'world', axis: 'x' }, count: 3, step: 10, axis2: { kind: 'world', axis: 'y' }, count2: 1, step2: 5, visible: true }
    expect((await build(builder, [s, extrudeAll(2, s, 0, 1), row])).bodies).toHaveLength(3)
    const alike: Feature = { ...row, axis2: { kind: 'world', axis: 'x' }, count2: 2 } as Feature
    const refused = await build(builder, [s, extrudeAll(2, s, 0, 1), alike])
    expect(refused.results.find((r) => r.id === 3)?.message).toMatch(/run the same way/)
    builder.dispose()
  })
})

describe('a STEP file of named, coloured parts', () => {
  it('writes each body as a part under its name and in its colour, sheets left out', async () => {
    const kernel = await kernelPromise
    const builder = new Builder(kernel)
    const a = rectangleSketch(1, 10, 10)
    const b = rectangleSketch(3, 4, 4, [20, 0])
    const out = await build(builder, [a, extrudeAll(2, a, 0, 2), b, extrudeAll(4, b, 0, 6)])
    expect(out.bodies.map((x) => x.id)).toEqual([2, 4])
    const text = builder.exportStep([2, 4], [
      { name: 'PCB', color: '#1d3f7a' },
      { name: 'Header J1', color: '#1e1f22' },
    ])
    expect(text.startsWith('ISO-10303-21;')).toBe(true)
    expect(text).toContain("'PCB'")
    expect(kernel.readStepNames(text)).toEqual(['PCB', 'Header J1'])
    // The colours as the file holds them — sRGB, the #rrggbb given.
    const colours = [...text.matchAll(/COLOUR_RGB\('[^']*',([\d.]+),([\d.]+),([\d.]+)\)/g)].map((m) => `#${m.slice(1, 4).map((c) => Math.round(Number(c) * 255).toString(16).padStart(2, '0')).join('')}`)
    expect(colours).toEqual(expect.arrayContaining(['#1d3f7a', '#1e1f22']))
    // Without labels: one compound, as before.
    expect(kernel.readStepNames(builder.exportStep([2, 4]))).toHaveLength(1)
    builder.dispose()
  })
})

describe('a body offset all round', () => {
  it('grows a box by a distance into a body of its own, rounded over its edges, the box kept', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 10, 6)
    const grown: Feature = { id: 3, kind: 'offsetBody', name: 'Offset 1', body: 2, distance: 1, keep: true, visible: true }
    const out = await build(builder, [s, extrudeAll(2, s, 0, 4), grown])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(out.bodies.map((b) => b.id)).toEqual([2, 3])
    expect(out.bodies[0].volume).toBeCloseTo(240, 6)
    // A box grown by r: the box, its faces pushed out, quarter-cylinders
    // along its edges and eighth-spheres at its corners.
    const [a, b, c, r] = [10, 6, 4, 1]
    const want = a * b * c + 2 * r * (a * b + b * c + a * c) + Math.PI * r * r * (a + b + c) + (4 / 3) * Math.PI * r ** 3
    expect(out.bodies[1].volume).toBeCloseTo(want, 2)
    expect(out.bodies[1].closed).toBe(true)
    builder.dispose()
  })

  it('shrinks a body in place, and refuses an inward offset through it', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 10, 6)
    const shrunk: Feature = { id: 3, kind: 'offsetBody', name: 'Offset 1', body: 2, distance: -1, keep: false, visible: true }
    const out = await build(builder, [s, extrudeAll(2, s, 0, 4), shrunk])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(out.bodies).toHaveLength(1)
    expect(out.bodies[0].volume).toBeCloseTo(8 * 4 * 2, 3)
    const through: Feature = { ...shrunk, distance: -3.5 } as Feature
    const refused = await build(builder, [s, extrudeAll(2, s, 0, 4), through])
    expect(refused.results.find((r) => r.id === 3)?.status).toBe('failed')
    builder.dispose()
  })

  it('cut from a case with the tool kept, leaves a pocket with the clearance', async () => {
    const builder = new Builder(await kernelPromise)
    const caseSketch = rectangleSketch(1, 30, 20, [-5, -5])
    const part = rectangleSketch(3, 10, 6)
    const features: Feature[] = [
      caseSketch,
      extrudeAll(2, caseSketch, 0, 8),
      part,
      extrudeAll(4, part, 2, 12),
      { id: 5, kind: 'offsetBody', name: 'Keep-out', body: 4, distance: 0.5, keep: true, visible: true },
      { id: 6, kind: 'boolean', name: 'Pocket', op: 'cut', body: 2, tool: 5, visible: true },
    ]
    const out = await build(builder, features)
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    // The keep-out went into the cut; the part and the case remain.
    expect(out.bodies.map((b) => b.id)).toEqual([2, 4])
    // The part sits in its pocket half a millimetre clear of the case.
    expect(builder.clearance(4, 2).gap).toBeCloseTo(0.5, 3)
    builder.dispose()
  })
})

describe('the clearance between two bodies', () => {
  it('reads the gap between bodies apart, and the volume they share where they run into each other', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rectangleSketch(1, 10, 10)
    const b = rectangleSketch(3, 10, 10, [12.5, 0])
    const c = rectangleSketch(5, 10, 10, [5, 5])
    await build(builder, [a, extrudeAll(2, a, 0, 5), b, extrudeAll(4, b, 0, 5), c, extrudeAll(6, c, 0, 5)])
    expect(builder.clearance(2, 4)).toEqual({ gap: expect.closeTo(2.5, 6), overlap: 0 })
    const into = builder.clearance(2, 6)
    expect(into.gap).toBe(0)
    expect(into.overlap).toBeCloseTo(5 * 5 * 5, 3)
    expect(() => builder.clearance(2, 99)).toThrow(/no body 99/)
    builder.dispose()
  })
})

describe('where bodies run into each other', () => {
  it('meshes what two bodies share, and leaves out those that only touch', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rectangleSketch(1, 10, 10)
    const t = rectangleSketch(3, 10, 10, [10, 0])
    const c = rectangleSketch(5, 10, 10, [5, 5])
    // t touches a along a side; c runs into both, its top flush with theirs.
    await build(builder, [a, extrudeAll(2, a, 0, 5), t, extrudeAll(4, t, 0, 5), c, extrudeAll(6, c, 0, 5)])
    const { overlaps, done } = builder.overlaps([2, 4, 6, 99], await manifoldPromise)
    expect(done).toBe(true)
    expect(overlaps.map((o) => [o.a, o.b])).toEqual([
      [2, 6],
      [4, 6],
    ])
    expect(overlaps[0].volume).toBeCloseTo(125, 3)
    const p = overlaps[0].mesh.positions
    for (let k = 0; k < 3; k++) {
      const along = Array.from(p).filter((_, i) => i % 3 === k)
      expect(Math.min(...along)).toBeCloseTo([5, 5, 0][k], 6)
      expect(Math.max(...along)).toBeCloseTo([10, 10, 5][k], 6)
    }
    builder.dispose()
  })

  it('follows a round face on its own facets, the normals the body’s', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rectangleSketch(1, 10, 10)
    const round = emptySketch()
    addEntity(round, { kind: 'circle', c: [10, 5], r: 4 })
    const pin: SketchFeature = { id: 3, kind: 'sketch', name: 'Pin', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: round, visible: true }
    const out = await build(builder, [a, extrudeAll(2, a, 0, 5), pin, extrudeAll(4, pin, -2, 8)])
    const { overlaps } = builder.overlaps([2, 4], await manifoldPromise)
    expect(overlaps).toHaveLength(1)
    // Half the pin's section, 5 deep — less the chords' sag, a hair.
    expect(overlaps[0].volume).toBeCloseTo((Math.PI * 16 * 5) / 2, -1)
    const pinMesh = out.bodies.find((b) => b.id === 4)!.mesh
    const onPin = new Set<string>()
    for (let i = 0; i < pinMesh.positions.length; i += 3) onPin.add(`${pinMesh.positions[i]},${pinMesh.positions[i + 1]}`)
    const { positions, normals } = overlaps[0].mesh
    let round_ = 0
    for (let i = 0; i < positions.length; i += 3) {
      expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 5)
      // A corner on the round face is one of the pin's own.
      const r = Math.hypot(positions[i] - 10, positions[i + 1] - 5)
      if (Math.abs(r - 4) < 1e-3 && positions[i] < 10 - 1e-3) {
        round_++
        expect(onPin.has(`${positions[i]},${positions[i + 1]}`)).toBe(true)
      }
    }
    expect(round_).toBeGreaterThan(8)
    builder.dispose()
  })

  it('works a pair out once for the two bodies as they stand, and begins none past its time', async () => {
    const builder = new Builder(await kernelPromise)
    const a = rectangleSketch(1, 10, 10)
    const c = rectangleSketch(5, 10, 10, [5, 5])
    await build(builder, [a, extrudeAll(2, a, 0, 5), c, extrudeAll(6, c, 0, 5)])
    const m = await manifoldPromise
    expect(builder.overlaps([2, 6], m, -1)).toEqual({ overlaps: [], done: false })
    expect(builder.overlaps([2, 6], m).overlaps).toHaveLength(1)
    const known = builder.overlaps([6, 2], m, -1)
    expect(known.done).toBe(true)
    expect(known.overlaps[0].volume).toBeCloseTo(125, 3)
    // c built again away from a: the pair is worked out anew.
    const apart = rectangleSketch(5, 10, 10, [30, 30])
    await build(builder, [a, extrudeAll(2, a, 0, 5), apart, extrudeAll(6, apart, 0, 5)])
    expect(builder.overlaps([2, 6], m)).toEqual({ overlaps: [], done: true })
    // Known to share nothing is known too: nothing left to begin.
    expect(builder.overlaps([2, 6], m, -1)).toEqual({ overlaps: [], done: true })
    builder.dispose()
  })
})

describe('a hole drilled into a flat face', () => {
  it('goes into the body alone, as deep as an insert asks, from the face’s centre', async () => {
    const builder = new Builder(await kernelPromise)
    // A standoff: a Ø7 boss 8 tall.
    const sketch = emptySketch()
    addEntity(sketch, { kind: 'circle', c: [0, 0], r: 3.5 })
    const s: SketchFeature = { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true }
    const boss = await build(builder, [s, extrudeAll(2, s, 0, 8)])
    const top = boss.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9)!.fingerprint
    const m3 = insertHole(insertSize('m3')!)
    expect(m3).toEqual({ radius: 2, depth: 6.7 })
    const hole: Feature = { id: 3, kind: 'hole', name: 'Hole 1', body: 2, axis: { kind: 'point', face: top, at: top.centroid }, ...m3, insert: 'M3', visible: true }
    const out = await build(builder, [s, extrudeAll(2, s, 0, 8), hole])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(out.bodies[0].volume).toBeCloseTo(Math.PI * (3.5 ** 2 * 8 - 2 ** 2 * 6.7), 3)
    // Down from the top only: the bottom stays closed.
    const bottom = out.bodies[0].topology.faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] < -0.9)!.fingerprint
    expect(bottom.area).toBeCloseTo(Math.PI * 3.5 ** 2, 3)
    builder.dispose()
  })
})
