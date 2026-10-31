// SPDX-License-Identifier: AGPL-3.0-only
// A face the mesher fails on, and what is made of it: drawn again on its own
// and named; where nothing draws it, a hole the volume error reads no lump
// on. A side closed to a point, which is no free edge. A file with an edge
// going round one face, which is, whatever a reader closes it with.
//
// No small shape makes OCCT's mesher fail or leaves a pole a measurable length
// long: the flange (28_industrialPart) does, with faces 196 and 234 and 17
// corner patches, and what it measured is written in kernelMesh.ts and
// kernelEdges.ts. So here the mesher's failure is put on by hand, on the one
// call that meshes the whole body, and a pole's length likewise: these prove
// what is done with such a face and such an edge, not that OCCT makes them.

import { describe, expect, it, vi } from 'vitest'
import { identityRigid } from '../../../src/core/deviation/rigid'
import { volumeDeviation } from '../../../src/core/deviation/volume'
import { type KernelMesh, ReKernel, type Shape } from '../core/kernel'
import { oddEdges } from '../core/kernelEdges'
import { meshFaultOut } from '../core/kernelMesh'
import { HASH_BOUND } from '../core/kernelOps'
import { filesOpenEdges } from '../core/kernelStep'
import type { OcctLike } from '../core/occtTypes'
import { primitiveSolid } from '../core/primitives'

// Kernel builds run long, and longer on a slow machine.
vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()
const occtOf = (k: ReKernel) => (k as unknown as { occt: OcctLike }).occt

type Raw = ReturnType<OcctLike['meshShape']>

/** The face of a box lying on z = `z`, and its hash. */
function faceAt(o: OcctLike, shape: Shape, z: number): { face: number; hash: number } {
  const face = o.getSubShapes(shape, 'face').find((f) => Math.abs(o.getSurfaceCenterOfMass(f).z - z) < 1e-6)!
  return { face, hash: o.hashCode(face, HASH_BOUND) }
}

/** Meshing with the mesher failing by hand: on the whole of `body` a face
 *  has none of its triangles but `keep` of them, and a copy of the face on
 *  its own (a handle never seen before) gets nothing finer than `chord`. */
function withFailure<T>(o: OcctLike, body: Shape, hash: number, { keep = 0, chord = Infinity }: { keep?: number; chord?: number }, run: () => T): T {
  const real = o.meshShape.bind(o)
  o.meshShape = (shape, options): Raw => {
    const m = real(shape, options)
    if (shape === body) {
      const g = m.faceGroups!
      const kept: number[] = []
      const indices: number[] = []
      for (let r = 0; r + 2 < g.length; r += 3) {
        const count = g[r + 2] === hash ? Math.min(keep * 3, g[r + 1]) : g[r + 1]
        kept.push(indices.length, count, g[r + 2])
        for (let i = 0; i < count; i++) indices.push(m.indices[g[r] + i])
      }
      return { ...m, indices: Uint32Array.from(indices), faceGroups: Int32Array.from(kept) }
    }
    return (options?.linearDeflection ?? 0) < chord ? { ...m, indices: new Uint32Array(0), faceGroups: new Int32Array(0) } : m
  }
  try {
    return run()
  } finally {
    o.meshShape = real
  }
}

/** The box a test meshes: tall, so a column through its top has a long way
 *  to go, with the grid's top well above it. */
function tallBox(k: ReKernel): Shape {
  return k.box([0, 0, 0], [12, 12, 20])
}

/** A column's reading of a mesh against a whole scan of the same box. */
const volumeOf = (reference: KernelMesh, scan: KernelMesh) => volumeDeviation({ reference, scan, toReference: identityRigid(), tolerance: 0.1, cell: 0.5 })

describe('a face the mesher fails on', () => {
  it('leaves a hole where nothing draws it, names it, and the volume error stands no lump on it', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    // A round along a top edge, as the flange's are: narrow, with material
    // going on either side of it.
    const box = k.box([0, 0, 0], [12, 12, 20])
    const top = k.edges(box, 0.05).filter((e) => e.mid[2] > 19.99 && e.faceHashes.length === 2)
    const body = k.filletTracked(box, top.map((e) => e.hash), 1).shape
    const scan = k.mesh(body, 0.05)
    const round = o.copy(body) as Shape
    const face = o.getSubShapes(round, 'face').find((f) => o.surfaceType(f) === 'cylinder')!
    const hash = o.hashCode(face, HASH_BOUND)
    const holed = withFailure(o, round, hash, {}, () => k.mesh(round, 0.05))
    expect(holed.faults).toEqual([expect.objectContaining({ hash, drawn: 0, off: expect.any(Number) })])
    expect(holed.faults![0].chord).toBeUndefined()
    expect(holed.faults![0].off).toBeLessThan(1e-6)
    expect(holed.faceHash!.includes(hash)).toBe(false)
    const v = volumeOf(holed, scan)
    expect(v.referenceOpen!.columns).toBeGreaterThan(5)
    // Nothing up the grid: read as it was, the columns would reach its top.
    for (const r of v.regions) expect(r.box.max[2]).toBeLessThan(20.5)
    expect(v.totals.excess.volume + v.totals.missing.volume).toBeLessThan(5)
  })

  it('draws it again on its own at a coarser chord, in the place of what it had, and names it', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    const box = tallBox(k)
    const { hash } = faceAt(o, box, 20)
    const m = withFailure(o, box, hash, { keep: 1, chord: 0.2 }, () => k.mesh(box, 0.05))
    expect(m.faults).toHaveLength(1)
    expect(m.faults![0]).toMatchObject({ hash, area: 144, chord: 0.2 })
    expect(m.faults![0].drawn).toBeCloseTo(144, 3)
    expect(m.faults![0].at).toEqual([6, 6, 20])
    // Each triangle's face is still the face, and what it had has gone.
    expect(m.faceHash!.length).toBe(m.indices.length / 3)
    let top = 0
    m.faceHash!.forEach((h, t) => {
      if (h !== hash) return
      top++
      for (let q = 0; q < 3; q++) expect(m.positions[m.indices[t * 3 + q] * 3 + 2]).toBeCloseTo(20, 4)
    })
    expect(top).toBeGreaterThan(1)
    // Closed again: nothing borrowed, and no lump.
    const v = volumeOf(m, k.mesh(tallBox(k), 0.05))
    expect(v.referenceOpen).toBeNull()
    expect(v.regions.filter((r) => r.kind !== 'unsure')).toEqual([])
  })

  it('leaves a healthy mesh alone: no faults, no retry', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    const spy = vi.spyOn(o, 'copy')
    for (const shape of [tallBox(k), primitiveSolid(k, { kind: 'sphere', center: [0, 0, 0], radius: 5 }), primitiveSolid(k, { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 3, length: 8 })]) {
      expect(k.mesh(shape, 0.05).faults).toBeUndefined()
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('says which face, where, how it was drawn and how far its edge strays', () => {
    const drawn = meshFaultOut('Flange', { hash: 1, at: [1.4728, 34.311, 8.294], area: 13.42, drawn: 13.5, chord: 0.64, off: 0.161 }, { index: 196, madeBy: { name: 'R1 chain' } })
    expect(drawn).toMatchObject({ index: 196, at: [1.47, 34.31, 8.29], chord: 0.64, off: 0.16 })
    expect(drawn.words).toMatch(/face 196 of Flange, made by R1 chain, at \(1\.47, 34\.31, 8\.29\): drawn on its own at a 0\.64 mm chord — an edge of it lies 0\.16 mm off its surface/)
    const hole = meshFaultOut('Flange', { hash: 1, at: [41, 1, 8], area: 8.69, drawn: 0.28, off: 0 }, null)
    expect(hole.index).toBeNull()
    expect(hole.words).toMatch(/face \? of Flange at \(41, 1, 8\): a hole in the mesh, its triangles covering 0\.28 of 8\.69 mm²/)
    expect(hole.words).not.toMatch(/off its surface/)
  })
})

describe('a side closed to a point', () => {
  /** The occt with the edges of no length given a hair's: a pole measured
   *  as the flange's are. */
  function withLength<T>(o: OcctLike, length: number, run: () => T): T {
    const real = o.curveLength.bind(o)
    o.curveLength = (edge) => {
      const l = real(edge)
      return l < 1e-9 ? length : l
    }
    try {
      return run()
    } finally {
      o.curveLength = real
    }
  }

  it('is a pole while the kernel does not draw it, up to a tenth of a micrometre', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    const ball = primitiveSolid(k, { kind: 'sphere', center: [0, 0, 0], radius: 5 })
    expect(oddEdges(o, ball).poles.count).toBe(0)
    const hair = withLength(o, 1.6e-5, () => oddEdges(o, ball))
    expect(hair.counts).toEqual({ free: 0, inside: 0, nonManifold: 0, knife: 0 })
    expect(hair.poles.count).toBeGreaterThan(0)
    expect(hair.poles.longest).toBeCloseTo(1.6e-5, 8)
    // Longer is no point, whatever the kernel takes it for.
    const long = withLength(o, 1e-3, () => oddEdges(o, ball))
    expect(long.counts.free).toBeGreaterThan(0)
    expect(long.poles.count).toBe(0)
  })

  it('stays a note in the file’s check, and the file is left as written', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    const ball = primitiveSolid(k, { kind: 'sphere', center: [0, 0, 0], radius: 5 })
    const text = k.exportStep([ball], [{ name: 'Ball' }])
    const check = withLength(o, 1.6e-5, () => k.verifyStep(text, [ball]))
    expect(check.ok).toBe(true)
    expect(check.bodies[0].freeEdgeCount).toBe(0)
    expect(check.notes.join(' ')).toMatch(/corner patch(es)? with a side closed to a point, up to 0\.000016 mm across/)
    const out = withLength(o, 1.6e-5, () => k.exportStepMended([ball], [{ name: 'Ball' }]))
    expect(out.mended).toEqual([])
    expect(out.check).toBeUndefined()
  })

  it('read back where the body has none is no pole: the reader marks what it closes a gap with so too', async () => {
    const k = await kernelPromise
    const o = occtOf(k)
    const ball = primitiveSolid(k, { kind: 'sphere', center: [0, 0, 0], radius: 5 })
    const text = k.exportStep([ball], [{ name: 'Ball' }])
    const [alone] = withLength(o, 1.6e-5, () => k.readBackEdges(text))
    expect(alone.length).toBeGreaterThan(0)
    expect(alone.every((e) => e.kind === 'free')).toBe(true)
    const [held] = withLength(o, 1.6e-5, () => k.readBackEdges(text, [ball]))
    expect(held).toEqual([])
    // Elsewhere on the body it is not that pole either.
    const moved = o.translate(ball, 50, 0, 0) as Shape
    const [off] = withLength(o, 1.6e-5, () => k.readBackEdges(text, [moved]))
    expect(off.length).toBeGreaterThan(0)
  })
})

describe('the file’s own edges', () => {
  it('each go round two faces in a solid’s file, seams and all', async () => {
    const k = await kernelPromise
    for (const shape of [tallBox(k), primitiveSolid(k, { kind: 'sphere', center: [0, 0, 0], radius: 5 }), primitiveSolid(k, { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 3, length: 8 }), primitiveSolid(k, { kind: 'torus', center: [0, 0, 0], axis: [0, 0, 1], majorRadius: 8, minorRadius: 2 })]) {
      expect(filesOpenEdges(k.exportStep([shape], [{ name: 'Part' }]))).toEqual([])
    }
  })

  it('say so where one goes round one face, whatever the reader closes it with', async () => {
    const k = await kernelPromise
    const box = tallBox(k)
    const text = k.exportStep([box], [{ name: 'Part' }])
    // One loop's use of an edge pointed at another edge of the file.
    const uses = [...text.matchAll(/ORIENTED_EDGE\('',\*,\*,#(\d+),/g)]
    const other = uses.find((m) => m[1] !== uses[0][1])![1]
    const broken = text.replace(uses[0][0], `ORIENTED_EDGE('',*,*,#${other},`)
    const once = filesOpenEdges(broken)
    expect(once).toHaveLength(1)
    const check = k.verifyStep(broken, [box])
    expect(check.ok).toBe(false)
    expect(check.problems.join(' ')).toMatch(/1 edge going round one face only/)
  })
})
