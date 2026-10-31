// SPDX-License-Identifier: AGPL-3.0-only
// What a step of a build read of the builder's state, so a later build can
// take the step's outcome over instead of playing it again — see
// Builder.build. The builder's state is a handful of maps (and a set) whose
// values are never changed in place: a body changed is a new body. A step
// that reads the same entries and finds the very same values there does the
// very same thing, so what it did — the entries it set and deleted, the
// results it gave — can be laid on another build's state as it stands.
// The maps note every lookup while a step plays: a key looked up, or the
// whole map gone through.

import type { FeatureResult, Snapshot } from './buildTypes'

/** The builder's state, by the names of its maps. */
export type StateName = Exclude<keyof Snapshot, 'results'>

/** Every one of them, in one order. */
export const STATE_NAMES: readonly StateName[] = ['bodies', 'aliases', 'issued', 'pieces', 'stages', 'fitted', 'placed', 'looks']

/** What a step read, map by map: the keys it looked up, or `all` where it
 *  went through the whole map. A map it never looked at is not there. */
export type StepReads = Map<StateName, Set<unknown> | 'all'>

/** Where a map notes a lookup: the key, or `all`. */
export type Note = (key: unknown) => void

export const ALL = Symbol('all')

/** A map of the builder's state that notes what is looked up in it. */
export class ReadMap<K, V> extends Map<K, V> {
  constructor(
    private readonly note: Note,
    entries?: Iterable<readonly [K, V]> | null,
  ) {
    super(entries)
  }
  override get(key: K): V | undefined {
    this.note(key)
    return super.get(key)
  }
  override has(key: K): boolean {
    this.note(key)
    return super.has(key)
  }
  override entries(): MapIterator<[K, V]> {
    this.note(ALL)
    return super.entries()
  }
  override keys(): MapIterator<K> {
    this.note(ALL)
    return super.keys()
  }
  override values(): MapIterator<V> {
    this.note(ALL)
    return super.values()
  }
  override forEach(fn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    this.note(ALL)
    super.forEach(fn, thisArg)
  }
  override [Symbol.iterator](): MapIterator<[K, V]> {
    this.note(ALL)
    return super[Symbol.iterator]()
  }
}

/** A set of the builder's state that notes what is looked up in it. */
export class ReadSet<T> extends Set<T> {
  constructor(
    private readonly note: Note,
    values?: Iterable<T> | null,
  ) {
    super(values)
  }
  override has(value: T): boolean {
    this.note(value)
    return super.has(value)
  }
  override values(): SetIterator<T> {
    this.note(ALL)
    return super.values()
  }
  override keys(): SetIterator<T> {
    this.note(ALL)
    return super.keys()
  }
  override entries(): SetIterator<[T, T]> {
    this.note(ALL)
    return super.entries()
  }
  override forEach(fn: (value: T, key: T, set: Set<T>) => void, thisArg?: unknown): void {
    this.note(ALL)
    super.forEach(fn, thisArg)
  }
  override [Symbol.iterator](): SetIterator<T> {
    this.note(ALL)
    return super[Symbol.iterator]()
  }
}

/** A lookup noted into `reads`, under the map's name. */
export function noteRead(reads: StepReads, name: StateName, key: unknown): void {
  if (key === ALL) {
    reads.set(name, 'all')
    return
  }
  let keys = reads.get(name)
  if (keys === 'all') return
  if (!keys) reads.set(name, (keys = new Set()))
  keys.add(key)
}

/** The state before any step: what a build's first step is played on. */
export const NOTHING: Snapshot = {
  results: [],
  bodies: new Map(),
  aliases: new Map(),
  issued: new Set(),
  pieces: new Map(),
  stages: new Map(),
  fitted: new Map(),
  placed: new Map(),
  looks: new Map(),
}

type Lookup = ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>

/** Whether a key stands the same in two maps — there in both with the very
 *  same value, or in neither — or a member in two sets. */
function sameAt(now: Lookup, then: Lookup, key: unknown): boolean {
  const there = now.has(key)
  if (there !== then.has(key)) return false
  return !there || !(now instanceof Map) || now.get(key) === (then as ReadonlyMap<unknown, unknown>).get(key)
}

/** Whether two maps or sets hold the very same entries, in the same order. */
function sameWhole(now: Lookup, then: Lookup): boolean {
  if (now.size !== then.size) return false
  const a = now.entries()
  const b = then.entries()
  for (let x = a.next(), y = b.next(); !x.done && !y.done; x = a.next(), y = b.next()) {
    if (x.value[0] !== y.value[0] || x.value[1] !== y.value[1]) return false
  }
  return true
}

/** Whether what a step read stands as it did when the step played on
 *  `then`: every key it looked up holding the same value now, every map
 *  it went through the same throughout. `now` is the builder's state. */
export function readsStand(reads: StepReads, now: Record<StateName, Lookup>, then: Snapshot): boolean {
  for (const [name, keys] of reads) {
    if (keys === 'all') {
      if (!sameWhole(now[name], then[name])) return false
    } else for (const key of keys) if (!sameAt(now[name], then[name], key)) return false
  }
  return true
}

/** What a step did, from the state before it to the state after it, laid on
 *  `now` — entries set where they changed, deleted where they went — and
 *  the results it gave. */
export function replay(before: Snapshot, after: Snapshot, now: Record<StateName, Map<unknown, unknown> | Set<unknown>>, results: FeatureResult[]): void {
  for (const name of STATE_NAMES) {
    const was = before[name] as ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
    const is = after[name] as ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
    const into = now[name]
    for (const key of was.keys()) if (!is.has(key)) into.delete(key)
    if (into instanceof Map) {
      for (const [key, value] of (is as ReadonlyMap<unknown, unknown>).entries()) if (!was.has(key) || (was as ReadonlyMap<unknown, unknown>).get(key) !== value) into.set(key, value)
    } else for (const key of is.keys()) if (!was.has(key)) into.add(key)
  }
  results.push(...after.results.slice(before.results.length))
}
