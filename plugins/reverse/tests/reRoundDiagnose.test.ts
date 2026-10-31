// SPDX-License-Identifier: AGPL-3.0-only
// A round's diagnosis reads the sizes it takes both ways from the size
// asked, never under a floor, within its time, and stops at a kernel that
// traps — here on a plate whose corner round a stand-in check decides,
// and a crash's edges told with those that ran on from the picked ones.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { Body, EdgeInfo } from '../core/buildTypes'
import { diagnoseRound } from '../core/diagnose'
import type { BuildStep, Feature, FilletFeature } from '../core/features'
import { ReKernel, type Shape } from '../core/kernel'
import { KernelTrap } from '../core/kernelOps'
import { largestSizeWhile } from '../core/kernelShell'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addRectangle } from '../core/sketch'
import { edgesAsked, trapEdgesText } from '../core/trapEdges'
import { build, ctx, extrudeAll, sketchOf } from './reKit'

vi.setConfig({ testTimeout: 120_000 })

type Fillet = Extract<BuildStep, { kind: 'fillet' }>

/** A 30 × 20 × 5 plate built, and a round of `radius` on one of its
 *  upright corners as a step, not built: the builder, its kernel, the step
 *  and the plate's body. */
async function plateAndRound(radius: number) {
  const k = await ReKernel.load()
  const builder = new Builder(k)
  const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
  const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new')]
  await build(builder, base)
  const corner = builder.topologyOf(2)!.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99)!
  const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius, chain: false, visible: true }
  const step = resolveFeatures([...base, round], ctx, (f) => findRegions(f.sketch)).find((s) => s.id === 3) as Fillet
  const body = (builder as unknown as { bodyFor(s: BuildStep): Body }).bodyFor(step)
  return { k, builder, step, body }
}

/** The kernel's round replaced by `check`, which says at a radius whether
 *  the round builds (the kernel's own round then) or is refused; the radii
 *  asked, in order. */
function standIn(k: ReKernel, check: (r: number) => boolean | 'trap', wait = 0): number[] {
  const asked: number[] = []
  const real = k.filletTracked.bind(k)
  k.filletTracked = (solid: Shape, hashes: readonly number[], r: number) => {
    asked.push(r)
    const until = performance.now() + wait
    while (performance.now() < until) {
      // A round that takes its time.
    }
    const says = check(r)
    if (says === 'trap') throw new KernelTrap('Filleting: null function or function signature mismatch')
    if (!says) throw new Error('Filleting: BRep_API: command not done')
    return real(solid, hashes, r)
  }
  return asked
}

describe('a round that fails, read both ways', () => {
  it('builds at r ≥ 1.38 or r < 0.81: answers the sizes that build and those that fail — not a size limit', async () => {
    const { k, builder, step } = await plateAndRound(1.3)
    const asked = standIn(k, (r) => r >= 1.38 || r < 0.81)
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/^The edge does not round at 1\.3 mm — drawn red on the part\. /)
    // The corner's other four edges, at its two ends, are not in the
    // fillet: rounded with it, or the size nearest the one asked.
    expect(d?.message).toMatch(/It builds at 0\.8\d?, (?:[\d.]+, )*1\.43, 1\.56; fails at (?:[\d.]+, )*1\.3, 1\.37 mm — not a size limit: the corner where the rounds meet; round the 4 edges there not in this fillet with it, every edge at that corner in one fillet — or take 1\.43 mm, the nearest size that builds\./)
    // Not too narrow beside it: that is not said.
    expect(d?.message).not.toMatch(/too narrow/)
    // Nothing tried under the floor: an eighth of the radius.
    expect(Math.min(...asked)).toBeGreaterThanOrEqual(1.3 / 8 - 1e-9)
    builder.dispose()
  })

  it('one that fails at every size tries nothing under the floor and says so', async () => {
    const { k, builder, step } = await plateAndRound(1.3)
    const asked = standIn(k, () => false)
    const d = builder.diagnose(step)
    // Not the size: the edge, with how far its faces stand apart.
    expect(d?.message).toMatch(/It does not round even at 0\.16 mm, an eighth of the size asked — it is the edge, not the size: its two faces stand 90° apart along it \(0° is flat\), closest to flat at \(/)
    expect(Math.min(...asked)).toBeGreaterThanOrEqual(1.3 / 8 - 1e-9)
    expect(asked).toContain(1.3 / 8)
    builder.dispose()
  })

  it('a small round is not tried under 0.1 mm', async () => {
    const { k, builder, step } = await plateAndRound(0.4)
    const asked = standIn(k, () => false)
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/It does not round even at 0\.1 mm, the least tried — it is the edge, not the size/)
    expect(Math.min(...asked)).toBeGreaterThanOrEqual(0.1 - 1e-9)
    builder.dispose()
  })

  it('keeps its deadline: tries stop when the next would not fit, and the answer says so', async () => {
    const { k, builder, step, body } = await plateAndRound(1.3)
    const asked = standIn(k, () => false, 60)
    const began = performance.now()
    const d = diagnoseRound(k, builder, step, body, { ms: 400, perTry: 0 })
    const took = performance.now() - began
    // Fourteen tries without a limit; here a handful, none past the time.
    expect(asked.length).toBeLessThanOrEqual(7)
    expect(took).toBeLessThan(400 + 60 + 1000)
    expect(d?.message).toMatch(/The size it takes was not found: over budget \(a try takes about \d+ ms, the diagnosis 400 ms at most\)\./)
    expect(Math.min(...asked)).toBeGreaterThanOrEqual(1.3 / 8 - 1e-9)
    builder.dispose()
  })

  it('a monotone round still answers the size it takes', async () => {
    const { k, builder, step } = await plateAndRound(3)
    standIn(k, (r) => r < 2)
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/It rounds at up to 1\.9\d? mm\./)
    expect(d?.message).not.toMatch(/not a size limit/)
    builder.dispose()
  })
})

describe('a round of every edge at a corner that fails together', () => {
  it('does not ask for the corner’s edges in one fillet when they are, and names the nearest size that builds', async () => {
    const k = await ReKernel.load()
    const builder = new Builder(k)
    const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
    const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new')]
    await build(builder, base)
    const all = builder.topologyOf(2)!.edges.map((e) => e.fingerprint)
    const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: all, radius: 0.8, chain: false, visible: true }
    const step = resolveFeatures([...base, round], ctx, (f) => findRegions(f.sketch)).find((s) => s.id === 3) as Fillet
    // Each edge rounds alone; all twelve together only at 0.88 and up, or
    // under 0.53.
    const real = k.filletTracked.bind(k)
    k.filletTracked = (solid: Shape, hashes: readonly number[], r: number) => {
      if (hashes.length > 1 && !(r >= 0.88 || r < 0.53)) throw new Error('Filleting: BRep_API: command not done')
      return real(solid, hashes, r)
    }
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/^Each of the 12 edges rounds alone at 0\.8 mm; together they do not/)
    expect(d?.message).toMatch(/— not a size limit: the corner where the rounds meet; every edge there is in this fillet already; take 0\.88 mm, the nearest size that builds\./)
    expect(d?.message).not.toMatch(/in one fillet/)
    builder.dispose()
  })
})

describe('a round on several chains', () => {
  /** The plate's edges by `which`, in a round of `radius` as a step, not
   *  built, with the kernel's round replaced by `check` — given the edges
   *  asked and the radius — and each try noted. */
  async function roundOf(radius: number, which: (e: EdgeInfo) => boolean, check: (hashes: readonly number[], r: number) => boolean, wait = 0) {
    const k = await ReKernel.load()
    const builder = new Builder(k)
    const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
    const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new')]
    await build(builder, base)
    const edges = builder.topologyOf(2)!.edges.filter(which)
    const round: FilletFeature = { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: edges.map((e) => e.fingerprint), radius, chain: false, visible: true }
    const step = resolveFeatures([...base, round], ctx, (f) => findRegions(f.sketch)).find((s) => s.id === 3) as Fillet
    const body = (builder as unknown as { bodyFor(s: BuildStep): Body }).bodyFor(step)
    const tries: { hashes: number; r: number }[] = []
    const real = k.filletTracked.bind(k)
    k.filletTracked = (solid: Shape, hashes: readonly number[], r: number) => {
      tries.push({ hashes: hashes.length, r })
      const until = performance.now() + wait
      while (performance.now() < until) {
        // A round that takes its time.
      }
      if (!check(hashes, r)) throw new Error('Filleting: BRep_API: command not done')
      return real(solid, hashes, r)
    }
    return { k, builder, step, body, tries }
  }
  const upright = (e: EdgeInfo) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99
  /** One upright, and a long edge of the top: not alike. */
  const unlike = (e: EdgeInfo) => (upright(e) && Math.hypot(e.fingerprint.mid[0], e.fingerprint.mid[1]) < 1e-6) || (Math.abs(e.fingerprint.length - 30) < 1e-6 && Math.abs(e.fingerprint.mid[2] - 5) < 1e-6 && Math.abs(e.fingerprint.mid[1]) < 1e-6)

  it('reads the sizes on one of the chains alike, says so, and tries the answer on them all', async () => {
    const { builder, step, tries } = await roundOf(3, upright, (_, r) => r < 2)
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/^None of the 4 edges rounds at 3 mm — drawn red on the part\. They round at up to 1\.9\d? mm\. Read on 1 of the 4 edges: the others are alike/)
    expect(d?.message).toMatch(/All 4 together build at 1\.9\d? mm\./)
    // One probe, one chain's sizes, and them all once.
    expect(tries.filter((t) => t.r === 3)).toHaveLength(1)
    expect(tries.filter((t) => t.hashes === 4)).toHaveLength(1)
    expect(d?.where).toHaveLength(4)
    builder.dispose()
  })

  it('does not take a chain the budget did not reach for a zero', async () => {
    const { builder, step, body, tries } = await roundOf(3, unlike, (_, r) => r < 2, 40)
    const d = diagnoseRound(builder.kernel, builder, step, body, { ms: 400, perTry: 0 })
    expect(tries.length).toBeLessThan(12)
    expect(d?.message).not.toMatch(/was not found/)
    expect(d?.message).toMatch(/They round at up to [\d.]+ mm/)
    expect(d?.message).toMatch(/That holds for the 1 of the 2 edges read and those alike; the rest were not read/)
    expect(d?.message).toMatch(/reverse\.body\.fillet_try/)
    builder.dispose()
  })

  it('goes by the tries timed, not by a slow step’s time', async () => {
    const { builder, step, body, tries } = await roundOf(3, (e) => upright(e) && Math.hypot(e.fingerprint.mid[0], e.fingerprint.mid[1]) < 1e-6, (_, r) => r < 2, 2)
    // The step took 150 of the 400 ms: kept as the guess, two tries.
    const d = diagnoseRound(builder.kernel, builder, step, body, { ms: 400, perTry: 150 })
    expect(tries.length).toBeGreaterThan(6)
    expect(d?.message).toMatch(/It rounds at up to 1\.9\d? mm\./)
    builder.dispose()
  })

  it('reads a size that fails with the others on them together', async () => {
    const { builder, step } = await roundOf(3, upright, (hashes, r) => (hashes.length > 1 ? r < 1 : r < 2))
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/They round at up to 1\.9\d? mm\./)
    expect(d?.message).toMatch(/All 4 together do not build at 1\.9\d? mm\. Together they round at up to 0\.9\d? mm\./)
    builder.dispose()
  })

  it('does not call it the edge when chains that fail alone build together', async () => {
    const { builder, step } = await roundOf(3, unlike, (hashes, r) => hashes.length > 1 && r < 2)
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/Alone they do not round even at 0\.38 mm, but they do with the rest of the feature\. Together they round at up to 1\.9\d? mm\./)
    expect(d?.message).not.toMatch(/it is the edge/)
    expect(d?.message).not.toMatch(/too narrow/)
    builder.dispose()
  })

  it('says some fail alone where one takes a size and another none, and reads them together', async () => {
    let first: number | null = null
    const { builder, step } = await roundOf(3, unlike, (hashes, r) => {
      first ??= hashes[0]
      return hashes.length > 1 ? r < 2 : hashes[0] === first && r < 1
    })
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/Alone some do not round even at 0\.38 mm, but they do with the rest of the feature\. Together they round at up to 1\.9\d? mm\./)
    builder.dispose()
  })

  it('calls it the edge when they fail alone and together', async () => {
    const { builder, step } = await roundOf(3, unlike, () => false)
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/They do not round even at 0\.38 mm, an eighth of the size asked, alone or together — it is the edge, not the size/)
    builder.dispose()
  })

  it('tries one of the chains alike before saying each rounds alone', async () => {
    const { builder, step, tries } = await roundOf(3, upright, (hashes, r) => hashes.length === 1 || r < 2)
    const d = builder.diagnose(step)
    expect(d?.message).toMatch(/^Each of the 4 edges rounds alone at 3 mm; together they do not/)
    expect(d?.message).toMatch(/1 of the 4 were tried alone, the others alike\.$/)
    expect(tries.filter((t) => t.hashes === 1)).toHaveLength(1)
    builder.dispose()
  })
})

describe('a round the kernel refuses', () => {
  it('quotes the kernel without the name of its own call', async () => {
    const { k, builder } = await plateAndRound(1.3)
    k.filletTracked = () => {
      throw new Error('Filleting: filletWithHistory: produced an invalid solid')
    }
    const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
    const base: Feature[] = [outline, extrudeAll(2, outline, 0, 5, 'new')]
    const plate = await build(builder, base)
    const corner = plate.bodies[0].topology.edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.dir[2]) > 0.99)!
    const out = await build(builder, [...base, { id: 3, kind: 'fillet', name: 'Round', body: 2, edges: [corner.fingerprint], radius: 1.3, chain: false, visible: true } as FilletFeature])
    const failed = out.results.find((r) => r.id === 3)!
    expect(failed.status).toBe('failed')
    expect(failed.message).toMatch(/\(Filleting: produced an invalid solid\)$/)
    expect(failed.message).not.toMatch(/WithHistory/)
    builder.dispose()
  })
})

describe('a round that crashes the kernel', () => {
  it('stops at the first trap: nothing more is asked of the kernel', async () => {
    const { k, builder, step, body } = await plateAndRound(1.3)
    const asked = standIn(k, () => 'trap')
    expect(() => diagnoseRound(k, builder, step, body)).toThrow(KernelTrap)
    expect(asked).toHaveLength(1)
    // The Builder's diagnosis lets it go with the trap.
    asked.length = 0
    expect(builder.diagnose(step)).toBeNull()
    expect(asked).toHaveLength(1)
    builder.dispose()
  })

  it("after a crash, the round that crashed is not tried again, and the rest within the crash's limit", async () => {
    const { k, builder, step } = await plateAndRound(1.3)
    const asked = standIn(k, (r) => r < 0.9)
    const d = builder.diagnoseCrashed(step, 10_000)
    expect(asked).not.toContain(1.3)
    expect(asked.length).toBeGreaterThan(0)
    expect(d?.message).toMatch(/^The edge does not round at 1\.3 mm — drawn red on the part\. It rounds at up to 0\.8\d? mm\./)
    // A trap on the fresh kernel stops it at once.
    const trapped = standIn(k, () => 'trap')
    expect(builder.diagnoseCrashed(step, 10_000)).toBeNull()
    expect(trapped).toHaveLength(1)
    builder.dispose()
  })
})

describe('the halving with a floor', () => {
  it('tries nothing under the floor, and the floor itself last', () => {
    const asked: number[] = []
    const r = largestSizeWhile(
      4,
      (at) => {
        asked.push(at)
        return false
      },
      () => true,
      0.5,
    )
    expect(r).toEqual({ size: 0, settled: true })
    expect(Math.min(...asked)).toBe(0.5)
    expect(asked[asked.length - 1]).toBe(0.5)
    // With no floor, as before.
    expect(largestSizeWhile(4, (at) => at < 1, () => true).size).toBeCloseTo(0.9375, 6)
  })
})

describe("a crash's edges", () => {
  it('says how many were not picked and the faces they run on into', () => {
    const edge = (hash: number, faces: number[]): EdgeInfo => ({ hash, faces, fingerprint: { mid: [hash, 0, 0] } }) as unknown as EdgeInfo
    const all = [edge(1, [10, 11]), edge(2, [10, 11]), edge(3, [11, 12]), edge(4, [12, 10])]
    const origins = new Map([
      [10, 2],
      [11, 2],
      [12, 5],
    ])
    const names = new Map([
      [2, 'Body'],
      [5, 'Hump'],
    ])
    const t = edgesAsked('round', [1, 2, 3, 4], all, origins, [1, 2])
    expect(t.count).toBe(4)
    expect(t.runOn).toEqual({ count: 2, madeBy: [5] })
    expect(trapEdgesText(t, (id) => names.get(id))).toMatch(/\. 2 of them, not picked, run on tangent into faces made by Hump\.$/)
    // Every edge picked: nothing ran on, nothing said.
    const picked = edgesAsked('round', [1, 2], all, origins, [1, 2])
    expect(picked.runOn).toBeUndefined()
    expect(trapEdgesText(picked, (id) => names.get(id))).not.toMatch(/not picked/)
  })
})
