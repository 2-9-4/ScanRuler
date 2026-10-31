// SPDX-License-Identifier: AGPL-3.0-only
// A surface's region asked for as a query, not a list of vertex numbers:
// { marked: true } takes the points a scan read left marked, and { box,
// normal?, exclude?, limit? } the scan's vertices inside a box, facing a
// way, less those in the boxes excluded. It is read off the scan once, as
// the feature is added or edited, and the feature stores the vertices it
// found — a project holds nothing new, and a rebuild fits the same points.
// What it saves is the agent's context: a skin's region is thousands of
// numbers out of scan.query and back in again.

import { commandHost } from '../../../src/commands/host'
import { requireMarked } from '../../../src/commands/marked'
import type { Vec3 } from '../../../src/core/types'
import { CommandError } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import { evaluateFor } from '../core/expression'
import { SURFACE_MIN_REGION } from '../core/features'
import { useReverse } from '../state/reStore'

/** How many points a region read by a box keeps unless told otherwise,
 *  and at most: past it every k-th is kept, spread evenly. A surface fit
 *  takes each point once, so this is what it costs; twenty thousand fit
 *  a net of 20 × 20 in a fraction of a second. */
export const SURFACE_REGION_LIMIT = 20_000
export const SURFACE_REGION_MAX = 200_000
/** How far round a direction a normal may lean and still face it, degrees,
 *  unless told otherwise — as scan.query has it. */
const WITHIN_DEG = 30

type Box = { min: Vec3; max: Vec3 }
type RegionQuery = { marked?: boolean; box?: Box; normal?: { dir: Vec3; withinDeg?: number }; exclude?: Box[]; limit?: number }

/** A region query with its box's numbers read through the expressions
 *  given for them (`region.box.min.x` …) — the rest of the query as it
 *  came. One that does not evaluate is refused. */
export function boxByExprs(asked: RegionQuery, exprs: Record<string, unknown> | undefined): RegionQuery {
  const driven = Object.entries(exprs ?? {}).filter(([k, e]) => k.startsWith('region.box.') && typeof e === 'string')
  if (driven.length === 0) return asked
  if (!asked.box) throw new CommandError('invalid_input', `exprs.${driven[0][0]}: the region’s box is driven by expressions — give region: { box } with them, not a list of points or the marked ones.`)
  const box = { min: [...asked.box.min] as Vec3, max: [...asked.box.max] as Vec3 }
  for (const [path, expr] of driven) {
    const m = /^region\.box\.(min|max)\.([xyz])$/.exec(path)
    if (!m) throw new CommandError('invalid_input', `exprs.${path}: no such field — the box’s numbers are region.box.min.x … region.box.max.z.`)
    const r = evaluateFor(expr as string, 'length', useReverse.getState().parameterTable.scope)
    if (!r.ok) throw new CommandError('invalid_input', `exprs.${path}: “${expr as string}” — ${r.error}`)
    box[m[1] as 'min' | 'max']['xyz'.indexOf(m[2])] = r.value
  }
  return { ...asked, box }
}

/** Whether a surface's input asks for its region by a query. */
export function asksRegion(kind: string, input: Record<string, unknown>): boolean {
  return kind === 'surface' && input.region !== undefined && input.region !== null && !Array.isArray(input.region)
}

const inBox = (p: Float32Array, i: number, b: Box) =>
  p[i * 3] >= b.min[0] && p[i * 3] <= b.max[0] && p[i * 3 + 1] >= b.min[1] && p[i * 3 + 1] <= b.max[1] && p[i * 3 + 2] >= b.min[2] && p[i * 3 + 2] <= b.max[2]

/** The vertices a region query names, on the scan as it is now. */
export async function regionOf(asked: RegionQuery): Promise<number[]> {
  if (!useStore.getState().fileName) throw new CommandError('no_scan', 'A surface is fitted through the scan, and none is open.')
  let vertices: number[]
  let what: string
  if (asked.marked !== undefined) {
    if (asked.marked !== true) throw new CommandError('invalid_input', 'region.marked: true takes the points left marked — give the vertices or a box otherwise.')
    const m = requireMarked()
    vertices = Array.from(m.vertices)
    what = `marked by ${m.from}`
  } else {
    const { box, normal, exclude = [], limit = SURFACE_REGION_LIMIT } = asked
    if (!box) throw new CommandError('invalid_input', 'region: give the vertices, { marked: true } or { box }.')
    for (const b of [box, ...exclude]) for (let k = 0; k < 3; k++) if (!(b.min[k] <= b.max[k])) throw new CommandError('invalid_input', 'region: a box’s min lies past its max.')
    if (normal && !(Math.hypot(...normal.dir) > 0)) throw new CommandError('invalid_input', 'region.normal.dir: give a direction, not a zero vector.')
    const client = commandHost().session.clientRef.current
    if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
    const cosLimit = Math.cos(((normal?.withinDeg ?? WITHIN_DEG) * Math.PI) / 180)
    const found = await client.query({ min: box.min, max: box.max, ...(normal ? { normal: { dir: normal.dir, cosLimit } } : {}), limit: Math.max(1, useStore.getState().vertexCount) })
    const kept: number[] = []
    for (let i = 0; i < found.vertices.length; i++) if (!exclude.some((b) => inBox(found.positions, i, b))) kept.push(found.vertices[i])
    const step = Math.max(1, Math.ceil(kept.length / limit))
    vertices = step > 1 ? kept.filter((_, i) => i % step === 0) : kept
    what = `in the box${normal ? ' facing that way' : ''}${exclude.length > 0 ? ', less the boxes left out' : ''}`
  }
  if (vertices.length < SURFACE_MIN_REGION) throw new CommandError('invalid_input', `region: ${vertices.length} scan point${vertices.length === 1 ? '' : 's'} ${what} — a surface needs ${SURFACE_MIN_REGION} at least.`)
  return vertices
}
