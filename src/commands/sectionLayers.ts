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

/** Every layer registered, in the order the plugins put them. */
export function sectionLayers(): SectionLayer[] {
  return [...own.values()].flat()
}
