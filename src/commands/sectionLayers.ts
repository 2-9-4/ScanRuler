// SPDX-License-Identifier: AGPL-3.0-only
// What a workspace draws into a picture of a section (section.render) beside
// the scan's own cut: outlines the scan's gap is read against — a model's
// cut by the section's plane — and labelled pieces, a sketch's lines and
// arcs with their ids. The app draws the scan and the frame; a plugin that
// has a model registers its layers here, under its id, from its install().

import type { Vec2 } from '../core/flat/types'
import type { Vec3 } from '../core/types'

/** The section a picture is of: its plane, and the sheet the picture lies
 *  on — a sheet point [u, v] is origin + u·basisU + v·basisV. */
export interface SectionSheet {
  id: number
  name: string
  origin: Vec3
  normal: Vec3
  basisU: Vec3
  basisV: Vec3
}

/** A closed or open line on the sheet the scan's gap is measured to,
 *  under a label (a body's name). */
export interface SectionOutline {
  label: string
  points: Vec2[]
  closed: boolean
  /** The cut of a surface with no inside — an open sheet, not a solid: the
   *  scan's gap is measured to it as to any outline, but it is drawn in a
   *  style of its own and has no material on either side, closed or not. */
  surface?: boolean
}

/** A piece drawn over the picture with its label (a sketch piece's id). */
export interface SectionPiece {
  label: string
  points: Vec2[]
}

export interface SectionLayerDrawing {
  outlines?: SectionOutline[]
  pieces?: SectionPiece[]
}

export interface SectionLayer {
  /** The key section.render's layers names it by. */
  key: string
  /** A few words on what it draws, for the command's description. */
  description: string
  /** What it draws on the section's sheet, mm, or null for nothing. */
  draw(sheet: SectionSheet): Promise<SectionLayerDrawing | null>
}

const own = new Map<string, SectionLayer[]>()

/** A plugin's layers, under its id. Called from the plugin's install(); the
 *  returned function takes them out again. Two sets under one id throw. */
export function registerSectionLayers(id: string, layers: readonly SectionLayer[]): () => void {
  if (own.has(id)) throw new Error(`Two sets of section layers share the id "${id}".`)
  const kept = [...layers]
  own.set(id, kept)
  return () => {
    if (own.get(id) === kept) own.delete(id)
  }
}

/** A plane a workspace keeps that a picture of a section may lie on — a
 *  sketch's — found by id or name, with the frame the workspace gives it:
 *  the picture's [u, v] are then the sketch's own. */
export interface SheetPlanes {
  /** What they are, for a refusal: "the sketches". */
  description: string
  /** The plane by id or name with its name and frame; null where none
   *  goes by it. A name two share is refused (CommandError). */
  find(given: number | string): Omit<SectionSheet, 'id'> | null
}

const planes = new Map<string, SheetPlanes>()

/** A plugin's planes, under its id, as registerSectionLayers. */
export function registerSheetPlanes(id: string, kept: SheetPlanes): () => void {
  if (planes.has(id)) throw new Error(`Two sets of sheet planes share the id "${id}".`)
  planes.set(id, kept)
  return () => {
    if (planes.get(id) === kept) planes.delete(id)
  }
}

/** The plane a workspace keeps under an id or a name, the first that has
 *  one; null where none does — with what the workspaces keep, for the
 *  refusal (empty where none registers any). */
export function findSheetPlane(given: number | string): { plane: Omit<SectionSheet, 'id'> | null; kinds: string[] } {
  for (const p of planes.values()) {
    const plane = p.find(given)
    if (plane) return { plane, kinds: [] }
  }
  return { plane: null, kinds: [...planes.values()].map((p) => p.description) }
}

/** Every layer registered, in the order the plugins put them. */
export function sectionLayers(): SectionLayer[] {
  return [...own.values()].flat()
}
