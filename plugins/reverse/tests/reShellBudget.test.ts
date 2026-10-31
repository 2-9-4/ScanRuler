// SPDX-License-Identifier: AGPL-3.0-only
// A shell that fails says why within a budget of twice its own time: the
// outside rounds no larger than the wall are read off the body first and
// named, the smallest first, and the halving goes only as far as the
// budget — past it the answer says "not bisected: over budget" with what
// was found. A shell built another way than the kernel's thick solid says
// which way, and warns of the slivers a shell left.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { Body } from '../core/buildTypes'
import { diagnoseShell, shellDiagnosisBudget, SHELL_DIAGNOSIS_LEAST_MS } from '../core/diagnose'
import type { BuildStep, Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity } from '../core/sketch'
import { build, ctx, extrudeAll, rectangleSketch, sketchOf } from './reKit'

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

type ShellStep = Extract<BuildStep, { kind: 'shell' }>

/** A 40 × 20 × 10 box with a pin of 1 mm radius on its top and its four
 *  upright edges rounded at 2 mm, shelled at a wall of 3 with its bottom
 *  open: the rounds and the pin are no larger than the wall, and the pin
 *  goes with them where the inside is cut back sharp, so every way fails. */
async function pinnedBox(builder: Builder) {
  const s = rectangleSketch(1, 40, 20)
  const pin = sketchOf(3, (sk) => addEntity(sk, { kind: 'circle', c: [20, 10], r: 1 }))
  const base: Feature[] = [s, extrudeAll(2, s, 0, 10), pin, extrudeAll(4, pin, 10, 15, 'join', 2)]
  const first = await build(builder, base)
  const edges = first.bodies[0].topology.edges.map((e) => e.fingerprint)
  const bottom = first.bodies[0].topology.faces.find((f) => f.fingerprint.dir[2] < -0.9)!.fingerprint
  const uprights = edges.filter((e) => e.kind === 'line' && Math.abs(e.mid[2] - 5) < 1e-6)
  const features: Feature[] = [...base, { id: 5, kind: 'fillet', name: 'Rounds', body: 2, edges: uprights, radius: 2, chain: false, visible: true }, { id: 6, kind: 'shell', name: 'Shell', body: 2, faces: [bottom], thickness: 3, visible: true }]
  const step = resolveFeatures(features, ctx, (f) => findRegions(f.sketch)).find((x): x is ShellStep => x.kind === 'shell')!
  return { features, step }
}

/** The body a step works on, as the builder holds it. */
const bodyFor = (builder: Builder, step: ShellStep) => (builder as unknown as { bodyFor(s: ShellStep): Body }).bodyFor(step)

describe('a failed shell diagnosed within its budget', () => {
  it('names the round smaller than the wall, the smallest first, and halves the wall that fits', async () => {
    const builder = new Builder(await kernelPromise)
    const { features } = await pinnedBox(builder)
    const t0 = performance.now()
    const out = await build(builder, features)
    const ms = performance.now() - t0
    const r = out.results.find((x) => x.id === 6)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/A wall of 3 mm does not fit the body even with no face opened: 5 outside rounds of the body are no larger than the wall — face \d+ \(cylinder of 1 mm radius, made by feature 4\), face \d+ \(cylinder of 2 mm radius, made by feature 5\)/)
    expect(r.message).toMatch(/It hollows at a wall of up to 0\.9\d mm\./)
    expect(r.where!.length).toBeGreaterThan(0)
    // A small part's diagnosis takes the floor of the budget at most.
    expect(ms).toBeLessThan(SHELL_DIAGNOSIS_LEAST_MS + 5000)
    builder.dispose()
  })

  it('stays within twice the time of a try, and says how far it got', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    const { features, step } = await pinnedBox(builder)
    await build(builder, features)
    const body = bodyFor(builder, step)
    // One shell the way the step tried it: what a try takes here.
    const t0 = performance.now()
    expect(() => k.shellTracked(body.shape, [], 3)).toThrow()
    const perTry = Math.max(1, performance.now() - t0)
    const limit = { ms: 2 * perTry, perTry }
    const t1 = performance.now()
    const d = diagnoseShell(k, builder, step, body, limit)!
    const spent = performance.now() - t1
    expect(d.message).toMatch(/face \d+ \(cylinder of 1 mm radius, made by feature 4\)/)
    expect(d.message).toMatch(/not bisected( further)?: over budget \(a try takes about \d+ m?s, the diagnosis \d+ m?s at most\)/i)
    // The budget, and the reading of the body before any try.
    expect(spent).toBeLessThan(limit.ms + 1000)
    builder.dispose()
  })

  it('with no time for a try, names the round off the body alone', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    const { features, step } = await pinnedBox(builder)
    await build(builder, features)
    const d = diagnoseShell(k, builder, step, bodyFor(builder, step), { ms: 0, perTry: 1 })!
    // Not tried closed: the rounds say the wall does not fit, no more.
    expect(d.message).toMatch(/^A wall of 3 mm does not fit the body: 5 outside rounds of the body are no larger than the wall — face \d+ \(cylinder of 1 mm radius, made by feature 4\)/)
    expect(d.message).toMatch(/Not bisected: over budget/)
    expect(d.where.length).toBeGreaterThan(0)
    builder.dispose()
  })

  it('takes twice the step, never less than the floor', () => {
    expect(shellDiagnosisBudget(30_000)).toEqual({ ms: 60_000, perTry: 30_000 })
    expect(shellDiagnosisBudget(100).ms).toBe(SHELL_DIAGNOSIS_LEAST_MS)
  })
})

describe('how a shell was built', () => {
  it('names the way when it is not the thick solid, and why the thick solid gave up', async () => {
    const builder = new Builder(await kernelPromise)
    // A bar with a block on its end, three faces opened across the step:
    // the thick solid gives up, offset and cut builds it.
    const bar = rectangleSketch(1, 94.7, 10.29, [-48.65, 0])
    const block = rectangleSketch(3, 6.7, 14.11, [42.09, 0])
    const base: Feature[] = [bar, extrudeAll(2, bar, 0, 7.46), block, extrudeAll(4, block, 0, 20.5, 'join', 2)]
    const first = await build(builder, base)
    const faces = first.bodies[0].topology.faces.map((f) => f.fingerprint).filter((f) => f.kind === 'plane')
    const front = faces.find((f) => f.dir[1] < -0.9)!
    const barTop = faces.find((f) => f.dir[2] > 0.9 && f.centroid[0] < 0)!
    const blockTop = faces.find((f) => f.dir[2] > 0.9 && f.centroid[0] > 40)!
    const cut = await build(builder, [...base, { id: 5, kind: 'shell', name: 'Shell', body: 2, faces: [front, barTop, blockTop], thickness: 2, visible: true }])
    expect(cut.results.at(-1)).toMatchObject({ status: 'ok' })
    expect(cut.results.at(-1)!.note).toMatch(/^Built the long way, by offset and cut, with booleans: .* The kernel's thick solid gave up on it: .+\.$/)
    // Rounds no larger than the wall: cut back, the inside left sharp.
    const s = rectangleSketch(1, 40, 20)
    const box = await build(builder, [s, extrudeAll(2, s, 0, 10)])
    const tops = box.bodies[0].topology.edges.map((e) => e.fingerprint).filter((e) => Math.abs(e.mid[2] - 10) < 1e-6)
    const bottom = box.bodies[0].topology.faces.find((f) => f.fingerprint.dir[2] < -0.9)!.fingerprint
    const sharp = await build(builder, [s, extrudeAll(2, s, 0, 10), { id: 3, kind: 'fillet', name: 'Rounds', body: 2, edges: tops, radius: 2, chain: false, visible: true }, { id: 4, kind: 'shell', name: 'Shell', body: 2, faces: [bottom], thickness: 3, visible: true }])
    expect(sharp.results.at(-1)!.note).toMatch(/^Built by cutting back, with booleans: 4 rounds no larger than the wall .* left sharp there\. The kernel's thick solid gave up on it: /)
    // The thick solid's own: nothing said.
    const plain = await build(builder, [s, extrudeAll(2, s, 0, 10), { id: 3, kind: 'shell', name: 'Shell', body: 2, faces: [bottom], thickness: 1, visible: true }])
    expect(plain.results.at(-1)).toMatchObject({ status: 'ok' })
    expect(plain.results.at(-1)!.note).toBeUndefined()
    expect(plain.results.at(-1)!.warning).toBeUndefined()
    builder.dispose()
  })

  it('warns of a sliver face the shell made, by its index', async () => {
    const k = await kernelPromise
    const builder = new Builder(k)
    // A box joined to one 5 µm wider: a step face 5 µm wide between them.
    const a = rectangleSketch(1, 40, 20)
    const b = rectangleSketch(3, 20, 20.005, [20, 0])
    await build(builder, [a, extrudeAll(2, a, 0, 10), b, extrudeAll(4, b, 0, 10, 'join', 2)])
    const made = builder.body(2)!
    const was: Body = { name: 'Box', shape: k.box([0, 0, 0], [40, 20, 10]), origins: new Map() }
    const inner = builder as unknown as { shellSlivers(shape: number, body: Body): void; stepWarnings: string[] }
    inner.stepWarnings = []
    inner.shellSlivers(made, was)
    expect(inner.stepWarnings).toHaveLength(1)
    expect(inner.stepWarnings[0]).toMatch(/^The shell left 1 sliver face, under 0\.01 mm wide or 0\.01 mm²: face \d+ \(0\.05 mm² at \(20\.0, 20\.0, 5\.0\)\) — a round on the edges beside it will likely fail/)
    // The faces the body had already are not the shell's to warn of.
    inner.stepWarnings = []
    inner.shellSlivers(made, { ...was, shape: made })
    expect(inner.stepWarnings).toHaveLength(0)
    k.release(was.shape)
    builder.dispose()
  })
})
