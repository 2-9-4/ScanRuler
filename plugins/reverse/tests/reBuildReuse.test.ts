// SPDX-License-Identifier: AGPL-3.0-only
// A build takes up where a kept one leaves off: the state after every step
// is kept, in a tree of steps by their keys, and a build whose first steps
// the tree holds restores the state after them and plays only the rest — an
// appended feature costs its own step, the rollback bar moved is a state
// looked up, a body that came through unchanged is not meshed again. Past
// the byte budget the oldest branches let go of the shapes nothing else
// holds. A build against another scan, or one asked for without reuse,
// plays every step.

import { describe, expect, it, vi } from 'vitest'
import { Builder, stepKeys } from '../core/build'
import { type BuildStep, type Feature, type SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, addRectangle } from '../core/sketch'
import { extrudeAll, sketchOf } from './reKit'

const kernelPromise = ReKernel.load()

/** A plate, and a hole cut through it from a second sketch. */
function plateWithHole(hole = 3): Feature[] {
  const plate = sketchOf(1, (s) => addRectangle(s, [0, 0], [40, 20]))
  const circle = sketchOf(3, (s) => addEntity(s, { kind: 'circle', c: [20, 10], r: hole }))
  return [plate, extrudeAll(2, plate, 0, 5, 'new'), circle, extrudeAll(4, circle, -1, 6, 'cut', 2)]
}

/** The plate with its hole, and a block of its own beside it. */
function plateAndBlock(): Feature[] {
  const block = sketchOf(5, (s) => addRectangle(s, [60, 0], [70, 10]))
  return [...plateWithHole(), block, extrudeAll(6, block, 0, 6, 'new')]
}

/** What the worker is sent for a list of features: the steps, and the
 *  sketches by id. */
function request(features: Feature[]) {
  const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const byId = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  return { steps, sketchOf: (id: number) => byId.get(id) }
}

/** The kernel with every call the builder makes to it counted, and every
 *  shape it releases noted — a shape released twice fails the test. */
function counted(kernel: ReKernel) {
  const calls = new Map<string, number>()
  const released: number[] = []
  const proxy = new Proxy(kernel, {
    get(target, name, receiver) {
      const v = Reflect.get(target, name, receiver) as unknown
      if (typeof v !== 'function') return v
      return (...args: unknown[]) => {
        calls.set(String(name), (calls.get(String(name)) ?? 0) + 1)
        if (name === 'release') {
          for (const s of args as number[]) {
            if (released.includes(s)) throw new Error(`Shape ${s} released twice.`)
            released.push(s)
          }
        }
        return (v as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  })
  return {
    kernel: proxy,
    released,
    /** The calls made while `f` runs, by method. */
    during<T>(f: () => T): { out: T; calls: Record<string, number>; total: number } {
      calls.clear()
      const out = f()
      const record = Object.fromEntries(calls)
      return { out, calls: record, total: Object.values(record).reduce((a, b) => a + b, 0) }
    },
  }
}

/** A fillet of a radius on the plate's upright edge at the origin, the
 *  edge found on the build standing. */
function cornerRound(builder: Builder): (radius: number) => BuildStep {
  const edge = builder.topologyOf(2)!.edges.find((e) => e.fingerprint.kind === 'line' && Math.hypot(e.fingerprint.mid[0], e.fingerprint.mid[1]) < 1e-6)!
  return (radius) => ({ kind: 'fillet', id: 7, name: 'Round', body: 2, edges: [edge.fingerprint], radius, chain: false })
}

describe('a build taken up from a kept one', () => {
  it('hands back the part before a sketch opened and after it closed unchanged, and plays only what changed', async () => {
    const builder = new Builder(await kernelPromise)
    // Every solid a step makes is placed: a build that places nothing
    // played no solid step.
    const place = vi.spyOn(builder as unknown as { place: () => void }, 'place')
    const full = request(plateWithHole())
    // The sketch of the hole opened: the part as it stood before it.
    const before = request(plateWithHole().slice(0, 2))
    const plate = 40 * 20 * 5
    const holed = plate - Math.PI * 9 * 5

    const first = builder.build(full.steps, full.sketchOf, true)
    expect(first.bodies[0].volume).toBeCloseTo(holed, 1)
    expect(place).toHaveBeenCalledTimes(2)
    const triangles = first.bodies[0].mesh.indices.length
    const edges = first.bodies[0].topology.edges.map((e) => e.hash)
    // The worker hands the buffers on, which leaves them empty here: what
    // the builder keeps is its own.
    structuredClone(first.bodies, { transfer: first.bodies.flatMap((b) => [b.mesh.positions.buffer, b.mesh.indices.buffer, ...b.topology.edges.map((e) => e.polyline.buffer)]) })
    expect(first.bodies[0].mesh.indices.length).toBe(0)

    // The part before the hole is the state after the plate: looked up.
    const rolledBack = builder.build(before.steps, before.sketchOf, true)
    expect(rolledBack.bodies[0].volume).toBeCloseTo(plate, 3)
    expect(place).toHaveBeenCalledTimes(2)

    // Closed with nothing changed: the build of before, not a new one.
    const again = builder.build(full.steps, full.sketchOf, true)
    expect(place).toHaveBeenCalledTimes(2)
    expect(again.bodies[0].volume).toBeCloseTo(holed, 1)
    expect(again.results).toEqual(first.results)
    expect(again.bodies[0].mesh.indices.length).toBe(triangles)
    expect(again.bodies[0].topology.edges.map((e) => e.hash)).toEqual(edges)
    expect(again.bodies[0].topology.edges.every((e) => e.polyline.length >= 6)).toBe(true)

    // The build handed back is the one standing in every way: the body as
    // it stood before the cut is there for the cut's editing, and the body
    // is written out.
    expect(builder.stage(4, 2)?.mesh.indices.length).toBeGreaterThan(0)
    expect(builder.exportStep([2])).toContain('MANIFOLD_SOLID_BREP')

    // A changed hole plays the hole's step alone — and taking the change
    // back is the build that was there before it.
    const bigger = request(plateWithHole(4))
    expect(builder.build(bigger.steps, bigger.sketchOf, true).bodies[0].volume).toBeCloseTo(plate - Math.PI * 16 * 5, 1)
    expect(place).toHaveBeenCalledTimes(3)
    expect(builder.build(full.steps, full.sketchOf, true).bodies[0].volume).toBeCloseTo(holed, 1)
    expect(place).toHaveBeenCalledTimes(3)
    // The plate before either hole is a state of both builds kept.
    expect(builder.build(before.steps, before.sketchOf, true).bodies[0].volume).toBeCloseTo(plate, 3)
    expect(place).toHaveBeenCalledTimes(3)
    builder.dispose()
  })

  it('costs an appended round its own step, an edit at the end the last step, and the rollback bar nothing', async () => {
    const k = counted(await kernelPromise)
    const builder = new Builder(k.kernel)
    const base = request(plateAndBlock())
    const built = k.during(() => builder.build(base.steps, base.sketchOf, true))
    expect(built.calls.extrude).toBe(3)
    expect(built.calls.mesh).toBe(2)
    const round = cornerRound(builder)

    // A round appended: the round, and the plate it changed meshed — no
    // extrusion, no boolean, and the block not meshed again.
    const r1 = [...base.steps, round(1)]
    const appended = k.during(() => builder.build(r1, base.sketchOf, true))
    expect(appended.out.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(appended.calls.filletTracked).toBe(1)
    for (const op of ['extrude', 'face', 'fuseTracked', 'cutTracked', 'fuse', 'cut']) expect(appended.calls[op] ?? 0, op).toBe(0)
    expect(appended.calls.mesh).toBe(1)

    // The same tree built from nothing, by a builder of its own, comes out
    // the same — and costs every step.
    const fresh = new Builder(await kernelPromise)
    const scratch = fresh.build(r1, base.sketchOf)
    expect(appended.out.bodies.map((b) => [b.id, b.faces, Math.round(b.volume * 1000)])).toEqual(scratch.bodies.map((b) => [b.id, b.faces, Math.round(b.volume * 1000)]))
    fresh.dispose()

    // Its radius changed: the last step played again, nothing before it.
    const r2 = [...base.steps, round(1.5)]
    const edited = k.during(() => builder.build(r2, base.sketchOf, true))
    expect(edited.calls.filletTracked).toBe(1)
    expect(edited.calls.extrude ?? 0).toBe(0)
    expect(edited.calls.mesh).toBe(1)
    const rounded = edited.out.bodies.find((b) => b.id === 2)!.volume

    // The bar moved above the round and back: states looked up, bodies
    // handed over as they were — not one call to the kernel.
    const down = k.during(() => builder.build(base.steps, base.sketchOf, true))
    expect(down.total).toBe(0)
    expect(down.out.bodies.find((b) => b.id === 2)!.volume).toBeCloseTo(40 * 20 * 5 - Math.PI * 9 * 5, 1)
    const up = k.during(() => builder.build(r2, base.sketchOf, true))
    expect(up.total).toBe(0)
    expect(up.out.bodies.find((b) => b.id === 2)!.volume).toBe(rounded)
    // A look-up keeps no build of its own: the round of 1 mm, the build
    // before, is still there to go back to.
    const back = k.during(() => builder.build(r1, base.sketchOf, true))
    expect(back.total).toBe(0)
    builder.dispose()
  })

  it('takes over the steps past a change that the change did not reach, and plays those it did', async () => {
    const k = counted(await kernelPromise)
    const builder = new Builder(k.kernel)
    // A plate with a hole cut into it alone; a block of its own, rounded at
    // a corner; and a boss joined to whatever it meets — which is the
    // block, but the join looks at every body to find that out.
    const block = sketchOf(5, (s) => addRectangle(s, [60, 0], [70, 10]))
    const boss = sketchOf(8, (s) => addRectangle(s, [62, 2], [64, 4]))
    const tree = (width: number, round?: BuildStep) => {
      const plate = sketchOf(1, (s) => addRectangle(s, [0, 0], [width, 20]))
      const hole = sketchOf(3, (s) => addEntity(s, { kind: 'circle', c: [20, 10], r: 3 }))
      const features = [plate, extrudeAll(2, plate, 0, 5, 'new'), hole, extrudeAll(4, hole, -1, 6, 'cut', 2), block, extrudeAll(6, block, 0, 6, 'new'), boss, extrudeAll(9, boss, 5, 8, 'join')]
      const r = request(features)
      const at = r.steps.findIndex((s) => s.id === 6) + 1
      return { steps: round ? [...r.steps.slice(0, at), round, ...r.steps.slice(at)] : r.steps, sketchOf: r.sketchOf }
    }
    builder.build(tree(40).steps, tree(40).sketchOf, true)
    const corner = builder.topologyOf(6)!.edges.find((e) => e.fingerprint.kind === 'line' && Math.hypot(e.fingerprint.mid[0] - 60, e.fingerprint.mid[1]) < 1e-6)!
    const round: BuildStep = { kind: 'fillet', id: 7, name: 'Round', body: 6, edges: [corner.fingerprint], radius: 1, chain: false }
    const first = tree(40, round)
    k.during(() => builder.build(first.steps, first.sketchOf, true))

    // The plate made wider: its steps and the hole's play again, the block
    // and its round are taken over — no extrusion of it, no round — and the
    // boss's join, which read every body, plays again.
    for (const width of [50, 60]) {
      const wider = tree(width, round)
      const rebuilt = k.during(() => builder.build(wider.steps, wider.sketchOf, true))
      expect(rebuilt.out.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
      expect(rebuilt.calls.filletTracked ?? 0).toBe(0)
      expect(rebuilt.calls.extrude).toBe(3)
      expect(rebuilt.calls.cutTracked).toBe(1)
      expect(rebuilt.calls.fuseTracked).toBe(1)
      // The same tree built from nothing comes out the same.
      const fresh = new Builder(await kernelPromise)
      const scratch = fresh.build(wider.steps, wider.sketchOf)
      expect(rebuilt.out.results).toEqual(scratch.results)
      expect(rebuilt.out.bodies.map((b) => [b.id, b.faces, Math.round(b.volume * 1000)])).toEqual(scratch.bodies.map((b) => [b.id, b.faces, Math.round(b.volume * 1000)]))
      fresh.dispose()
    }
    // The round on the block before it, for its editing, is still there.
    expect(builder.stage(7, 6)?.mesh.indices.length).toBeGreaterThan(0)
    builder.dispose()
  })

  it('keeps every build within its budget, and past it lets the oldest go, each shape once', async () => {
    const k = counted(await kernelPromise)
    const builder = new Builder(k.kernel)
    const plates = [1, 2, 3].map((hole) => request(plateWithHole(hole)))
    builder.build(plates[0].steps, plates[0].sketchOf, true)
    const first = builder.body(2)!
    builder.build(plates[1].steps, plates[1].sketchOf, true)
    const second = builder.body(2)!
    builder.build(plates[2].steps, plates[2].sketchOf, true)
    // Within the budget every build stays: the first is a state looked up.
    expect(k.released).not.toContain(first)
    builder.build(plates[0].steps, plates[0].sketchOf, true)
    expect(builder.lastSteps).toMatchObject({ recomputed: 0, restored: 2, of: 2 })
    // With a budget of nothing the build standing alone is kept: the other
    // holes go, each shape once — but not the plate before them, which the
    // build standing holds too, and is still there to edit the hole on.
    builder.cacheBudget = 0
    builder.build(plates[2].steps, plates[2].sketchOf, true)
    expect(k.released).toContain(first)
    expect(k.released).toContain(second)
    expect(k.released).not.toContain(builder.body(2)!)
    expect(builder.stage(4, 2)?.mesh.indices.length).toBeGreaterThan(0)
    expect(builder.cacheHeld().states).toBe(2)
    expect(builder.build(plates[1].steps, plates[1].sketchOf, true).bodies[0].volume).toBeCloseTo(40 * 20 * 5 - Math.PI * 4 * 5, 1)
    expect(builder.lastSteps).toMatchObject({ recomputed: 1, restored: 1, of: 2 })
    builder.dispose()
    expect(builder.cacheHeld()).toEqual({ bytes: 0, shapes: 0, states: 0 })
  })

  it('plays every step once the scan has changed, and every time without reuse', async () => {
    const builder = new Builder(await kernelPromise)
    const place = vi.spyOn(builder as unknown as { place: () => void }, 'place')
    const full = request(plateWithHole())
    builder.build(full.steps, full.sketchOf, true)
    builder.setScan(null)
    builder.build(full.steps, full.sketchOf, true)
    expect(place).toHaveBeenCalledTimes(4)
    builder.build(full.steps, full.sketchOf)
    builder.build(full.steps, full.sketchOf)
    expect(place).toHaveBeenCalledTimes(8)
    builder.dispose()
  })

  it('tells steps apart that JSON alone would not, and reads the sketches a step names', () => {
    const at = (to: number) => stepKeys([{ kind: 'hole', id: 1, name: 'Hole', body: 1, origin: [0, 0, 0], dir: [0, 0, 1], radius: 1, depth: to }], () => undefined)[0]
    expect(at(Infinity)).not.toBe(at(-Infinity))
    expect(at(Infinity)).not.toBe(at(Number.NaN))
    const region = (r: number[]) =>
      stepKeys([{ kind: 'surface', id: 1, name: 'S', region: new Uint32Array(r), fit: {} as never, shape: 'freeform' as never, constrain: 'auto' as never, refs: [], refSurfaces: [] }], () => undefined)[0]
    expect(region([1, 2, 3])).not.toBe(region([1, 2, 4]))
    expect(region([1, 2, 3])).toBe(region([1, 2, 3]))
    // An extrusion reads its sketch, for the reach to a plane: the sketch
    // changed is the step changed, and the steps before it are not.
    const a = request(plateWithHole())
    const keys = stepKeys(a.steps, a.sketchOf)
    const moved = sketchOf(3, (s) => {
      addEntity(s, { kind: 'circle', c: [20, 10], r: 3 })
      addEntity(s, { kind: 'point', p: [0, 0] })
    })
    const other = stepKeys(a.steps, (id) => (id === 3 ? moved.sketch : a.sketchOf(id)))
    expect(other[0]).toBe(keys[0])
    expect(other[1]).not.toBe(keys[1])
  })
})
