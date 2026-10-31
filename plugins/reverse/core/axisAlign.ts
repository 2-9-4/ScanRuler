// SPDX-License-Identifier: AGPL-3.0-only
// Fitted lines laid along the sheet's axes. A scan's side is never level:
// the part lay a fraction of a degree off on the table, the wall bows, the
// fit follows both — and a profile whose sides read 0.2° and 89.6° extrudes
// into a body no drawing would dimension. Where a fitted line runs within a
// few degrees of the sheet's X or Y it is meant to run along it, the same
// reading the drawing tools make of a line drawn by hand (axisRelationOf),
// and it is given the same inferred relation, a chip the operator can take
// off. Lines near 45° are held at it against one of the lines made level or
// upright, as an angle, since the sketch has no relation for a diagonal.
//
// This reads the sheet's axes, so it is only as good as the sheet's frame:
// on a part not yet aligned the Align command lays the sheet along a side
// first.

import type { Vec2 } from '../../../src/core/flat/types'
import type { PlacedSegment } from './segment'
import { addConstraint, axisRelationOf, entityOf, INFER_AXIS_DEG, removeEntities, type Sketch, type SketchLine } from './sketch'
import { measureDimension } from './solver'

export interface AxisAlignOptions {
  /** How far off an axis a line may run and still be laid along it, degrees. */
  degrees?: number
  /** Whether lines near 45° are held there too. */
  diagonals?: boolean
}

export interface AxisAlignReport {
  horizontal: number
  vertical: number
  diagonal: number
}

/**
 * Turn a line about its middle onto a direction, its length kept — so the
 * solver starts from the relation already met and only the corners move.
 * The slice points behind it turn with it: they say where the side lies and
 * how far it runs, which the turn keeps, and at what angle, which the
 * relation now overrules — left as they were, five hundred points a degree
 * off would pull against the relation at every solve, the corners would be
 * held a few microns open by the fight, and the sketch would read as not
 * solved. The slice itself is drawn from the chain and does not move.
 */
function turnTo(line: SketchLine, dx: number, dy: number): void {
  const mx = (line.a[0] + line.b[0]) / 2
  const my = (line.a[1] + line.b[1]) / 2
  const ux = line.b[0] - line.a[0]
  const uy = line.b[1] - line.a[1]
  const length = Math.hypot(ux, uy)
  const sign = ux * dx + uy * dy < 0 ? -1 : 1
  const tx = dx * sign
  const ty = dy * sign
  // The rotation that takes the line's direction to (tx, ty).
  const cos = (ux * tx + uy * ty) / length
  const sin = (ux * ty - uy * tx) / length
  line.a = [mx - (tx * length) / 2, my - (ty * length) / 2]
  line.b = [mx + (tx * length) / 2, my + (ty * length) / 2]
  if (line.points) {
    line.points = line.points.map((p): Vec2 => {
      const px = p[0] - mx
      const py = p[1] - my
      return [mx + px * cos - py * sin, my + px * sin + py * cos]
    })
  }
}

/**
 * Give every listed line that runs within `degrees` of a sheet axis the
 * horizontal or vertical relation, inferred; with `diagonals`, hold those
 * within `degrees` of 45° at it against the longest aligned line. Lines that
 * already carry such a relation are left alone.
 */
export function alignToAxes(sketch: Sketch, ids: readonly number[], opts: AxisAlignOptions = {}): AxisAlignReport {
  const degrees = opts.degrees ?? INFER_AXIS_DEG
  const report: AxisAlignReport = { horizontal: 0, vertical: 0, diagonal: 0 }
  const held = new Set<number>()
  for (const c of sketch.constraints) if (c.kind === 'horizontal' || c.kind === 'vertical') held.add(c.entity)
  const lines = ids.map((id) => entityOf(sketch, id)).filter((e): e is SketchLine => e?.kind === 'line')
  for (const line of lines) {
    if (held.has(line.id) || line.fixed) continue
    const relation = axisRelationOf(line.a, line.b, degrees)
    if (!relation) continue
    if (relation === 'horizontal') turnTo(line, 1, 0)
    else turnTo(line, 0, 1)
    addConstraint(sketch, { kind: relation, entity: line.id, inferred: true })
    held.add(line.id)
    report[relation]++
  }
  if (!opts.diagonals) return report
  // The reference: the longest line lying along an axis.
  let reference: SketchLine | null = null
  let longest = 0
  for (const id of held) {
    const e = entityOf(sketch, id)
    if (e?.kind !== 'line') continue
    const l = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])
    if (l > longest) {
      longest = l
      reference = e
    }
  }
  if (!reference) return report
  const angled = new Set<number>()
  for (const c of sketch.constraints) {
    if (c.kind === 'angle' || c.kind === 'parallel' || c.kind === 'perpendicular') {
      angled.add(c.a)
      angled.add(c.b)
    }
  }
  for (const line of lines) {
    if (held.has(line.id) || angled.has(line.id) || line.fixed) continue
    const measured = measureDimension(sketch, 'angle', line, reference)
    if (measured === null) continue
    const value = [45, 135].find((v) => Math.abs(measured - v) <= degrees)
    if (value === undefined) continue
    addConstraint(sketch, { kind: 'angle', a: line.id, b: reference.id, value, inferred: true })
    report.diagonal++
  }
  return report
}

/**
 * Make one line of every run of neighbouring fitted lines that were laid
 * along the same axis and lie within `within` of one line. A wall that
 * wanders comes out of a fine fit as a row of pieces, each level once
 * aligned, each at its own height by a tenth of a millimetre — and joined
 * end to end they cannot all be level and meet, so the sketch would not
 * solve. Level and in line, they are the one wall. The merged line keeps
 * the first piece's id and every piece's slice points; the pieces merged
 * away go, with what was on them. Returns the order as it stands after.
 */
export function mergeAlignedLines(sketch: Sketch, order: readonly PlacedSegment[], closed: boolean, within: number): PlacedSegment[] {
  const axisOf = (id: number): 'horizontal' | 'vertical' | null => {
    for (const c of sketch.constraints) if ((c.kind === 'horizontal' || c.kind === 'vertical') && c.entity === id) return c.kind
    return null
  }
  const out = order.map((p) => ({ ...p }))
  /** Merge out[j] into out[i], which it follows; false when they are not
   *  two pieces of one aligned wall. */
  const merge = (i: number, j: number): boolean => {
    const a = entityOf(sketch, out[i].id)
    const b = entityOf(sketch, out[j].id)
    if (a?.kind !== 'line' || b?.kind !== 'line' || a.id === b.id) return false
    const axis = axisOf(a.id)
    if (!axis || axis !== axisOf(b.id)) return false
    // Across the axis: how far apart the two lie.
    const k = axis === 'horizontal' ? 1 : 0
    const offA = (a.a[k] + a.b[k]) / 2
    const offB = (b.a[k] + b.b[k]) / 2
    if (Math.abs(offA - offB) > within) return false
    // They have to run the same way, one after the other.
    const along = 1 - k
    if ((a.b[along] - a.a[along]) * (b.b[along] - b.a[along]) <= 0) return false
    const la = Math.abs(a.b[along] - a.a[along])
    const lb = Math.abs(b.b[along] - b.a[along])
    const off = (offA * la + offB * lb) / (la + lb)
    const end: Vec2 = [b.b[0], b.b[1]]
    a.a[k] = off
    end[k] = off
    a.b = end
    if (a.points || b.points) a.points = [...(a.points ?? []), ...(b.points ?? [])]
    removeEntities(sketch, [b.id])
    if (out[j].joinNext) out[i].joinNext = true
    else delete out[i].joinNext
    out.splice(j, 1)
    return true
  }
  for (let i = 0; i + 1 < out.length; ) if (!merge(i, i + 1)) i++
  if (closed && out.length > 2) merge(out.length - 1, 0)
  return out
}
