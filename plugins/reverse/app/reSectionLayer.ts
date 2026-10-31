// SPDX-License-Identifier: AGPL-3.0-only
// What the Reverse engineer draws into a picture of a section
// (section.render): the visible bodies cut by the section's plane — the
// kernel's own section, exact edges sampled fine — each an outline under
// the body's name, which the scan's gap is read against, a sheet's an open
// line drawn as a surface's; and the sketches
// drawn in that section's plane, each piece labelled by its id, as
// reverse.sketch.edit names them.

import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import { cross, dot, normalize, sub } from '../../../src/core/vec'
import type { SectionLayer, SectionOutline, SectionPiece, SectionSheet } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import type { SketchFeature } from '../core/features'
import { entityPolyline } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { ready } from './reCommandCore'

/** How finely a body's cut is sampled, mm: well under any tolerance a
 *  gap is read at. */
const CUT_CHORD_MM = 0.005

/** A sheet point of a world point. */
function onSheet(sheet: SectionSheet, x: number, y: number, z: number): Vec2 {
  const dx = x - sheet.origin[0]
  const dy = y - sheet.origin[1]
  const dz = z - sheet.origin[2]
  return [dx * sheet.basisU[0] + dy * sheet.basisU[1] + dz * sheet.basisU[2], dx * sheet.basisV[0] + dy * sheet.basisV[1] + dz * sheet.basisV[2]]
}

/** How near two ends lie to be one point of a loop, mm. */
const JOIN_MM = 1e-4

/** Polylines joined end to end into the longest chains they make — the
 *  edges of a body's cut into its loops — each closed when it comes back
 *  to its start. */
export function joinPolylines(lines: readonly Vec2[][]): { points: Vec2[]; closed: boolean }[] {
  const left = lines.filter((l) => l.length >= 2).map((l) => [...l])
  const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= JOIN_MM
  const out: { points: Vec2[]; closed: boolean }[] = []
  while (left.length > 0) {
    const chain = left.pop()!
    for (let grew = true; grew && !near(chain[0], chain[chain.length - 1]); ) {
      grew = false
      for (let i = 0; i < left.length; i++) {
        const l = left[i]
        const end = chain[chain.length - 1]
        const start = chain[0]
        if (near(end, l[0])) chain.push(...l.slice(1))
        else if (near(end, l[l.length - 1])) chain.push(...[...l].reverse().slice(1))
        else if (near(start, l[l.length - 1])) chain.unshift(...l.slice(0, -1))
        else if (near(start, l[0])) chain.unshift(...[...l].reverse().slice(0, -1))
        else continue
        left.splice(i, 1)
        grew = true
        break
      }
    }
    out.push({ points: chain, closed: chain.length > 2 && near(chain[0], chain[chain.length - 1]) })
  }
  return out
}

/** The visible bodies' cut, a loop of it an outline, under the body's
 *  name — a sheet's cut marked as a surface's, a line with no inside. */
async function bodyOutlines(sheet: SectionSheet): Promise<SectionOutline[]> {
  const re = useReverse.getState()
  const bodies = re.bodies.filter((b) => b.visible)
  if (bodies.length === 0) return []
  let s
  try {
    s = await ready()
  } catch {
    return []
  }
  const client = s.client()
  if (!client) return []
  const cut = await client.sectionCut(bodies.map((b) => b.id), sheet.origin, sheet.normal, CUT_CHORD_MM)
  const out: SectionOutline[] = []
  for (const { id, polylines } of cut) {
    const body = bodies.find((b) => b.id === id)
    const name = body?.name ?? `Body ${id}`
    const lines = polylines.map((p) => {
      const points: Vec2[] = []
      for (let i = 0; i + 2 < p.length; i += 3) points.push(onSheet(sheet, p[i], p[i + 1], p[i + 2]))
      return points
    })
    for (const loop of joinPolylines(lines)) out.push({ label: name, ...loop, ...(body?.surface ? { surface: true } : {}) })
  }
  return out
}

/** How far a sketch's normal may turn off the sheet's, radians, and still
 *  be drawn on it — answers give directions to four places. */
const SAME_PLANE_RAD = 1e-4

/** Whether a sketch's plane is the sheet's, whatever it was made on — a
 *  section, a coordinate plane, a measured plane, a face: its normal along
 *  the sheet's, either way round, and its zero on the sheet's plane within
 *  `mm`. So a sheet of a picture alone (section.render { plane }), which
 *  has no section to name, shows the sketch on it, and a section's sketch
 *  is not drawn on the plane an offset away. */
export function liesOnSheet(frame: SectionFrame, sheet: SectionSheet, mm: number): boolean {
  const n = normalize(sheet.normal)
  const m = normalize(frame.normal)
  if (!n || !m) return false
  const turn = cross(n, m)
  if (Math.hypot(turn[0], turn[1], turn[2]) > SAME_PLANE_RAD) return false
  return Math.abs(dot(sub(frame.origin, sheet.origin), n)) <= mm
}

/** The pieces of the sketches drawn in the sheet's plane, each labelled by
 *  its id — and the sketch's name too where there are several. */
function sketchPieces(sheet: SectionSheet): SectionPiece[] {
  const re = useReverse.getState()
  const mm = Math.max(1e-3, 1e-6 * useStore.getState().modelSize)
  const sketches = re.features.filter((f): f is SketchFeature => f.kind === 'sketch' && liesOnSheet(f.frame, sheet, mm))
  return sketches.flatMap((f) => {
    // A sketch counts from its own zero (the sketch rule's), not the
    // sheet's: its pieces go through the world onto the sheet, from the
    // frame it is drawn and built in.
    const frame = f.frame
    const toSheet = (q: Vec2): Vec2 => {
      const o = frame.origin
      const u = frame.basisU
      const v = frame.basisV
      return onSheet(sheet, o[0] + q[0] * u[0] + q[1] * v[0], o[1] + q[0] * u[1] + q[1] * v[1], o[2] + q[0] * u[2] + q[1] * v[2])
    }
    return f.sketch.entities
      .filter((e) => !e.construction && e.kind !== 'point')
      .map((e) => ({ label: sketches.length > 1 ? `${f.name} ${e.id}` : String(e.id), points: entityPolyline(e).map((q) => toSheet([q[0], q[1]])) }))
  })
}

export const bodiesLayer: SectionLayer = {
  key: 'bodies',
  description: 'the visible bodies cut by the section’s plane, an outline each (a sheet’s an open line in a colour of its own, ends marked, with no inside), and the sketches in that plane — on the section, a coordinate plane, a measured plane or a face — with their pieces’ ids',
  draw: async (sheet) => {
    const outlines = await bodyOutlines(sheet)
    const pieces = sketchPieces(sheet)
    return outlines.length + pieces.length > 0 ? { outlines, pieces } : null
  },
}
