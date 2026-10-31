// SPDX-License-Identifier: AGPL-3.0-only
// Where a round or a chamfer the kernel crashed on was: its edges read
// before the kernel is asked — a kernel that trapped is asked nothing more —
// and told in the step's failure, so the edge set to change is named, not a
// WebAssembly message alone.

import type { Vec3 } from '../../../src/core/types'
import type { EdgeInfo } from './buildTypes'

/** The edges a round or a chamfer handed the kernel. */
export interface TrapEdges {
  verb: 'round' | 'bevel'
  count: number
  /** The middles of the first few of them. */
  mids: Vec3[]
  /** The features that made the faces either side of them, each pair once
   *  — the older first — with how many of the edges lie between such
   *  faces, the most first. */
  sides: { madeBy: number[]; count: number }[]
  /** The edges handed over that were not picked — the tangent chain run
   *  on from the picked ones — how many, and the features that made their
   *  faces where those are not the picked edges' own (all of them where
   *  every one is). Absent when every edge was picked. */
  runOn?: { count: number; madeBy: number[] }
}

/** How many middles a crash names. */
const MIDS = 6

/** The edges of a round or a chamfer, by hash among the body's edges, with
 *  the makers of their faces (`origins`, by face hash). With `picked`, the
 *  edges of them that were picked: the others ran on from them. */
export function edgesAsked(verb: TrapEdges['verb'], hashes: readonly number[], all: readonly EdgeInfo[], origins: ReadonlyMap<number, number>, picked?: readonly number[]): TrapEdges {
  const byHash = new Map(all.map((e) => [e.hash, e]))
  const pairs = new Map<string, { madeBy: number[]; count: number }>()
  const mids: Vec3[] = []
  const seen = new Set<number>()
  const chosen = picked ? new Set(picked) : null
  const ownMakers = new Set<number>()
  const runOnMakers = new Set<number>()
  let runOn = 0
  for (const h of hashes) {
    if (seen.has(h)) continue
    seen.add(h)
    const e = byHash.get(h)
    if (!e) continue
    if (mids.length < MIDS) mids.push(e.fingerprint.mid)
    const madeBy = [...new Set(e.faces)].map((f) => origins.get(f) ?? -1).sort((a, b) => a - b)
    const key = madeBy.join(',')
    const pair = pairs.get(key)
    if (pair) pair.count++
    else pairs.set(key, { madeBy, count: 1 })
    if (chosen === null) continue
    if (chosen.has(h)) for (const m of madeBy) ownMakers.add(m)
    else {
      runOn++
      for (const m of madeBy) runOnMakers.add(m)
    }
  }
  const out: TrapEdges = { verb, count: seen.size, mids, sides: [...pairs.values()].sort((a, b) => b.count - a.count) }
  if (runOn > 0) {
    const fresh = [...runOnMakers].filter((m) => !ownMakers.has(m))
    out.runOn = { count: runOn, madeBy: (fresh.length > 0 ? fresh : [...runOnMakers]).sort((a, b) => a - b) }
  }
  return out
}

/** The edges said in words: how many, between the faces of which features,
 *  and where the first of them lie — and how many of them were not picked
 *  but ran on tangent from those that were. */
export function trapEdgesText(t: TrapEdges, nameOf: (id: number) => string | undefined): string {
  const name = (id: number) => (id < 0 ? 'nothing known' : (nameOf(id) ?? `feature ${id}`))
  const sides = t.sides.map((s) => `${s.madeBy.length === 1 ? `${name(s.madeBy[0])} alone` : `${name(s.madeBy[0])} and ${name(s.madeBy[1])}`} (${s.count})`)
  const at = t.mids.map((p) => `(${p.map((v) => v.toFixed(2)).join(', ')})`)
  const run = t.runOn
  const ranOn = run ? ` ${run.count} of them, not picked, ${run.count === 1 ? 'runs' : 'run'} on tangent into faces made by ${run.madeBy.map(name).join(', ')}.` : ''
  return `It was to ${t.verb} ${t.count} edge${t.count === 1 ? '' : 's'} between faces made by ${sides.join(', ')}, at ${at.join(', ')}${t.count > t.mids.length ? ' …' : ''}.${ranOn}`
}
