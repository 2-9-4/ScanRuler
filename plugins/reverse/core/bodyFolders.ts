// SPDX-License-Identifier: AGPL-3.0-only
// The components of the body list: named folders the bodies are sorted
// into, one inside another, so an assembly's parts can be kept apart — a
// motor's in one, a housing's in another. A component holds its bodies by
// id and names the component it is in; a body in none stands at the head
// of the list. They are the list's alone: nothing is built from them, and a
// body keeps its id wherever it is put. Rows picked in the list — several
// with Ctrl or Shift — move together. Plain data in and out, for the store.

export interface BodyFolder {
  id: number
  name: string
  /** The component it is in, or null at the head of the list. */
  parent: number | null
  /** The bodies put in it, by id — those not built at the moment too, so
   *  a body brought back by an undo is where it was. */
  bodies: number[]
}

/** What is moved between components: bodies, components, or both. */
export interface FolderMove {
  bodies?: readonly number[]
  folders?: readonly number[]
}

/** Rows picked in the body list: bodies and components, by id. */
export interface ListPick {
  bodies: number[]
  folders: number[]
}

export const NO_PICK: ListPick = { bodies: [], folders: [] }

/** A pick as it moves: a component inside another picked one, or a body
 *  in one, goes along with it rather than on its own. */
export function outermost(folders: readonly BodyFolder[], pick: ListPick): ListPick {
  const inside = new Set<number>()
  for (const id of pick.folders) for (const f of foldersWithin(folders, id)) if (f !== id) inside.add(f)
  const kept = pick.folders.filter((id) => !inside.has(id))
  const carried = new Set(kept.flatMap((id) => [...bodiesWithin(folders, id)]))
  return { bodies: pick.bodies.filter((b) => !carried.has(b)), folders: kept }
}

/** Every body a pick holds: its own, and every body in its components at
 *  any depth. */
export function bodiesOfPick(folders: readonly BodyFolder[], pick: ListPick): Set<number> {
  const out = new Set(pick.bodies)
  for (const id of pick.folders) for (const b of bodiesWithin(folders, id)) out.add(b)
  return out
}

/** The component a body is in, or null. */
export function folderOf(folders: readonly BodyFolder[], bodyId: number): BodyFolder | null {
  return folders.find((f) => f.bodies.includes(bodyId)) ?? null
}

/** The components from the head of the list down to this one, it last;
 *  empty for none. */
export function folderPath(folders: readonly BodyFolder[], id: number | null): BodyFolder[] {
  const path: BodyFolder[] = []
  const seen = new Set<number>()
  let at = id === null ? undefined : folders.find((f) => f.id === id)
  while (at && !seen.has(at.id)) {
    seen.add(at.id)
    path.unshift(at)
    const parent = at.parent
    at = parent === null ? undefined : folders.find((f) => f.id === parent)
  }
  return path
}

/** A component and every one inside it, at any depth. */
export function foldersWithin(folders: readonly BodyFolder[], id: number): Set<number> {
  const out = new Set<number>([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const f of folders) {
      if (f.parent !== null && out.has(f.parent) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }
  return out
}

/** Every body in a component and in those inside it. */
export function bodiesWithin(folders: readonly BodyFolder[], id: number): Set<number> {
  const within = foldersWithin(folders, id)
  return new Set(folders.filter((f) => within.has(f.id)).flatMap((f) => f.bodies))
}

/** The name a new component takes: Component n, one past the highest n. */
export function nextFolderName(folders: readonly BodyFolder[]): string {
  const n = folders.reduce((m, f) => Math.max(m, Number(/^Component (\d+)$/.exec(f.name)?.[1] ?? 0)), 0)
  return `Component ${n + 1}`
}

export function nextFolderId(folders: readonly BodyFolder[]): number {
  return folders.reduce((m, f) => Math.max(m, f.id), 0) + 1
}

/** The component the things moved share, or null when they stand in
 *  different places — where a component made of them goes. */
export function commonFolder(folders: readonly BodyFolder[], what: FolderMove): number | null {
  const places = [...(what.bodies ?? []).map((b) => folderOf(folders, b)?.id ?? null), ...(what.folders ?? []).map((id) => folders.find((f) => f.id === id)?.parent ?? null)]
  return places.length > 0 && places.every((p) => p === places[0]) ? places[0] : null
}

/**
 * Bodies and components put into a component — or, with null, at the head
 * of the list — out of wherever they were. The same array when nothing
 * moves; null when it cannot be: into a component that is not there, or a
 * component into itself or into one inside it.
 */
export function moveInto(folders: readonly BodyFolder[], what: FolderMove, target: number | null): BodyFolder[] | null {
  if (target !== null && !folders.some((f) => f.id === target)) return null
  const moved = new Set(what.folders ?? [])
  for (const id of moved) if (target !== null && foldersWithin(folders, id).has(target)) return null
  const bodies = new Set(what.bodies ?? [])
  let changed = false
  const next = folders.map((f) => {
    let out = f
    if (moved.has(f.id) && f.parent !== target) {
      out = { ...out, parent: target }
      changed = true
    }
    const kept = out.bodies.filter((b) => !bodies.has(b) || f.id === target)
    const added = f.id === target ? [...bodies].filter((b) => !out.bodies.includes(b)) : []
    if (kept.length !== out.bodies.length || added.length > 0) {
      out = { ...out, bodies: [...kept, ...added] }
      changed = true
    }
    return out
  })
  return changed ? next : (folders as BodyFolder[])
}

/** A component taken away: the bodies and components it held go up to
 *  where it stood. */
export function withoutFolder(folders: readonly BodyFolder[], id: number): BodyFolder[] {
  const gone = folders.find((f) => f.id === id)
  if (!gone) return folders as BodyFolder[]
  return folders
    .filter((f) => f.id !== id)
    .map((f) => {
      if (f.parent === id) f = { ...f, parent: gone.parent }
      if (f.id === gone.parent) f = { ...f, bodies: [...f.bodies, ...gone.bodies.filter((b) => !f.bodies.includes(b))] }
      return f
    })
}

/** The components as a file holds them, checked: each an id, a name, a
 *  parent among them (or none) and a list of body ids. Throws a message
 *  naming what is wrong. */
export function validateFolders(raw: unknown): BodyFolder[] {
  if (!Array.isArray(raw)) throw new Error('reverse.bodyFolders')
  const ids = new Set<number>()
  for (const f of raw as Record<string, unknown>[]) {
    if (typeof f !== 'object' || f === null) throw new Error('reverse.bodyFolders')
    if (!Number.isSafeInteger(f.id) || typeof f.name !== 'string' || !(f.parent === null || Number.isSafeInteger(f.parent))) throw new Error('reverse.bodyFolders')
    if (!Array.isArray(f.bodies) || !f.bodies.every((b) => typeof b === 'number' && Number.isFinite(b))) throw new Error('reverse.bodyFolders')
    if (ids.has(f.id as number)) throw new Error('reverse.bodyFolders')
    ids.add(f.id as number)
  }
  for (const f of raw as BodyFolder[]) if (f.parent !== null && (!ids.has(f.parent) || folderPath(raw as BodyFolder[], f.id).length === 0 || folderPath(raw as BodyFolder[], f.id)[0].parent !== null)) throw new Error('reverse.bodyFolders')
  return raw as BodyFolder[]
}
