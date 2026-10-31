// SPDX-License-Identifier: AGPL-3.0-only
// A build of some of the steps carried from one kernel to another — a
// helper's group (buildGroups.ts) to the kernel that builds the whole list
// and takes those steps over from it (Builder.offer). What goes is the
// build as it was kept: each step's key, what it read, and the state after
// it — every map of it, the bodies as binary BREP and their faces' makers
// by the faces' order (a face's hash is its kernel's own; the order comes
// back the same). Every object in the state goes by a token that stays its
// own while it lives, and only once: a body the other kernel read in an
// earlier part is named, not sent again — which also keeps it the very
// object it was there, so a step that read it then reads the same now.

import type { Body, FeatureResult, KeptBuild, Snapshot } from './buildTypes'
import type { ReKernel, Shape } from './kernel'
import { STATE_NAMES, type StateName, type StepReads } from './buildReads'
import { copyMarkOf, markCopy, type CopyMark } from './patternCopies'
import type { SurfaceFitResult } from './surfaceFit'

/** A number for each object of a kernel's state, the same for as long as
 *  the object lives. */
export class Tokens {
  private tokens = new WeakMap<object, number>()
  private next = 1
  of(o: object): number {
    let t = this.tokens.get(o)
    if (t === undefined) this.tokens.set(o, (t = this.next++))
    return t
  }
}

export type PartObject =
  | { token: number; kind: 'body'; name: string; brep: Uint8Array; origins: (number | null)[]; copies?: (CopyMark | null)[]; surface?: true; reshaped?: 'trimmed' | 'joined'; fit?: SurfaceFitResult }
  /** The bodies a step kept for its editing, by id, as tokens. */
  | { token: number; kind: 'stage'; entries: [number, number][] }
  /** Anything else a map holds — a placed sketch, a body's pieces, a
   *  fitted primitive, a look: plain data. */
  | { token: number; kind: 'value'; value: unknown }

/** A state, map by map: the values as tokens, but for the ids and the
 *  aliases, which are numbers. `results`: how many of the part's results
 *  stood then. */
export interface PartState {
  results: number
  bodies: [number, number][]
  aliases: [number, number][]
  issued: number[]
  pieces: [number, number][]
  stages: [number, number][]
  fitted: [number, number][]
  placed: [number, number][]
  looks: [number, number][]
}

export interface PartExport {
  keys: string[]
  states: PartState[]
  /** By step: what it read, map by map — the keys, or null for all of it. */
  reads: [StateName, unknown[] | null][][]
  results: FeatureResult[]
  /** The objects the states name that the kernel it goes to has not got. */
  objects: PartObject[]
  /** By step: how long it took the last time it was played, ms, or 0. */
  times: number[]
}

/** The maps whose values are objects, each written out as a token. */
const BY_TOKEN = ['bodies', 'pieces', 'stages', 'fitted', 'placed', 'looks'] as const

/** A kept build written out; `have`: the tokens the kernel it goes to
 *  holds already. */
export function writePart(kernel: ReKernel, build: KeptBuild, tokens: Tokens, have: ReadonlySet<number>, times: readonly number[]): PartExport {
  const objects: PartObject[] = []
  const sent = new Set<number>()
  const send = (o: object, write: (token: number) => PartObject): number => {
    const token = tokens.of(o)
    if (!have.has(token) && !sent.has(token)) {
      sent.add(token)
      objects.push(write(token))
    }
    return token
  }
  const body = (b: Body) =>
    send(b, (token) => {
      const hashes = kernel.faceHashes(b.shape)
      // A pattern's copies go with their marks, face by face as the makers.
      const copies = hashes.map((h) => copyMarkOf(b.origins, h))
      return { token, kind: 'body', name: b.name, brep: kernel.toBrep(b.shape), origins: hashes.map((h) => b.origins.get(h) ?? null), ...(copies.some((c) => c !== null) ? { copies } : {}), ...(b.surface ? { surface: true as const } : {}), ...(b.reshaped ? { reshaped: b.reshaped } : {}), ...(b.fit ? { fit: b.fit } : {}) }
    })
  const stage = (m: Map<number, Body>) => send(m, (token) => ({ token, kind: 'stage', entries: [...m].map(([id, b]) => [id, body(b)]) }))
  const value = (v: object) => send(v, (token) => ({ token, kind: 'value', value: v }))
  const states = build.states.map((s): PartState => {
    const out = {
      results: s.results.length,
      aliases: [...s.aliases],
      issued: [...s.issued],
    } as PartState
    for (const name of BY_TOKEN) {
      const m = s[name] as Map<number, object>
      out[name] = [...m].map(([id, v]) => [id, name === 'bodies' ? body(v as Body) : name === 'stages' ? stage(v as Map<number, Body>) : value(v)])
    }
    return out
  })
  return {
    keys: build.keys,
    states,
    reads: build.reads.map((r) => [...r].map(([name, keys]) => [name, keys === 'all' ? null : [...keys]])),
    results: build.states.at(-1)?.results ?? [],
    objects,
    times: [...times],
  }
}

/** A part read in: the build it stands for, every token resolved through
 *  `known` — the objects read in from the same kernel before, by token —
 *  to which the part's own objects are added. Throws on a token it names
 *  that is neither, and on a body it cannot read; `made` then holds what
 *  it read in so far, for the caller to let go of. */
export function readPart(kernel: ReKernel, part: PartExport, known: Map<number, unknown>, made: Shape[]): KeptBuild {
  for (const o of part.objects) {
    if (o.kind !== 'body') continue
    const shape = kernel.fromBrep(o.brep)
    made.push(shape)
    const hashes = kernel.faceHashes(shape)
    if (hashes.length !== o.origins.length) throw new Error('A body came back with another number of faces.')
    const origins = new Map<number, number>()
    hashes.forEach((h, i) => {
      const at = o.origins[i]
      if (at !== null) origins.set(h, at)
      markCopy(origins, h, o.copies?.[i] ?? null)
    })
    // A fitted sheet keeps its fit: a split on this kernel carries it on,
    // and keeps its cut within the region, from it.
    known.set(o.token, { name: o.name, shape, origins, ...(o.surface ? { surface: true } : {}), ...(o.reshaped ? { reshaped: o.reshaped } : {}), ...(o.fit ? { fit: o.fit } : {}) } satisfies Body)
  }
  const get = (token: number): unknown => {
    if (!known.has(token)) throw new Error(`The part names an object ${token} that is not here.`)
    return known.get(token)
  }
  for (const o of part.objects) {
    if (o.kind === 'stage') known.set(o.token, new Map(o.entries.map(([id, t]) => [id, get(t) as Body])))
    else if (o.kind === 'value') known.set(o.token, o.value)
  }
  const states = part.states.map((s): Snapshot => {
    const state = {
      results: part.results.slice(0, s.results),
      aliases: new Map(s.aliases),
      issued: new Set(s.issued),
    } as Snapshot
    for (const name of BY_TOKEN) (state as unknown as Record<string, Map<number, unknown>>)[name] = new Map(s[name].map(([id, t]) => [id, get(t)]))
    return state
  })
  const reads = part.reads.map((r): StepReads => new Map(r.map(([name, keys]) => [name, keys === null ? 'all' : new Set(keys)])))
  return { keys: part.keys, states, reads }
}

/** Every object a state holds, into `into`: its maps' values, and the
 *  bodies a step kept for its editing. */
export function objectsOf(state: Snapshot, into: Set<unknown>): void {
  for (const name of STATE_NAMES) {
    if (name === 'aliases' || name === 'issued') continue
    for (const v of (state[name] as Map<unknown, unknown>).values()) {
      into.add(v)
      if (name === 'stages') for (const b of (v as Map<number, Body>).values()) into.add(b)
    }
  }
}
