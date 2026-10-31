// SPDX-License-Identifier: AGPL-3.0-only
// Projection into a sketch: a body's edges and another sketch's pieces as
// fixed pieces on the sketch plane — what projects to what, what does not,
// the outline of a face as a closed profile, and the pick on the sheet.

import { describe, expect, it } from 'vitest'
import { projectableAt, projectEdge, projectFaceOutline, projectSketchEntity, retake, retakeMoved, type Projectable } from '../core/project'
import { findRegions } from '../core/regions'
import { addEntity, emptySketch, type SketchEntity } from '../core/sketch'
import type { EdgeFingerprint } from '../core/topo'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'

/** A sketch plane at z = 10, its X along the part's. */
const TOP: SectionFrame = { origin: [0, 0, 10], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
const flat = (points: Vec3[]) => new Float32Array(points.flat())

const lineEdge = (a: Vec3, b: Vec3) => ({
  fingerprint: { kind: 'line', mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], dir: [1, 0, 0], length: 1, faces: [], origin: 2 } as EdgeFingerprint,
  polyline: flat([a, b]),
})

/** A circular edge about `axis` through `centre`, from `from` to `to`
 *  radians, sampled as the kernel would. */
function circleEdge(centre: Vec3, axis: 'z' | 'x', r: number, from: number, to: number, n = 48) {
  const points: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n
    points.push(axis === 'z' ? [centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t), centre[2]] : [centre[0], centre[1] + r * Math.cos(t), centre[2] + r * Math.sin(t)])
  }
  return { fingerprint: { kind: 'circle', mid: points[n >> 1], dir: axis === 'z' ? [0, 0, 1] : [1, 0, 0], length: r * (to - from), radius: r, faces: [], origin: 2 } as EdgeFingerprint, polyline: flat(points) }
}

describe('projecting into a sketch', () => {
  it('lays a straight edge down as a fixed line, and one seen end on as a point', () => {
    const e = projectEdge(lineEdge([0, 0, 0], [40, 0, 0]), TOP)
    expect(e).toMatchObject({ kind: 'line', fixed: true, projected: true })
    if (e?.kind !== 'line') throw new Error('not a line')
    expect([e.a, e.b]).toEqual([[0, 0], [40, 0]])
    // An upright edge of the box, looked down on.
    expect(projectEdge(lineEdge([40, 20, 0], [40, 20, 10]), TOP)).toMatchObject({ kind: 'point', p: [40, 20] })
  })

  it('takes a circle flat to the plane as a circle, an arc as an arc, and refuses one at a slant', () => {
    const c = projectEdge(circleEdge([10, 10, 0], 'z', 3, 0, 2 * Math.PI), TOP)
    if (c?.kind !== 'circle') throw new Error('not a circle')
    expect(c.c[0]).toBeCloseTo(10, 6)
    expect(c.c[1]).toBeCloseTo(10, 6)
    expect(c.r).toBeCloseTo(3, 6)
    const a = projectEdge(circleEdge([0, 0, 10], 'z', 5, 0, Math.PI / 2), TOP)
    if (a?.kind !== 'arc') throw new Error('not an arc')
    expect(a.r).toBeCloseTo(5, 6)
    expect(a.sweep).toBeCloseTo(Math.PI / 2, 6)
    // Square to the plane it is seen as the line it spans.
    const edgeOn = projectEdge(circleEdge([0, 0, 5], 'x', 4, 0, 2 * Math.PI), TOP)
    if (edgeOn?.kind !== 'line') throw new Error('not a line')
    expect(Math.abs(edgeOn.b[1] - edgeOn.a[1])).toBeCloseTo(8, 3)
    // Tilted, it is an ellipse: no piece for that.
    const tilted: SectionFrame = { origin: [0, 0, 0], normal: [0, Math.SQRT1_2, Math.SQRT1_2], basisU: [1, 0, 0], basisV: [0, Math.SQRT1_2, -Math.SQRT1_2] }
    expect(projectEdge(circleEdge([0, 0, 0], 'z', 3, 0, 2 * Math.PI), tilted)).toBeNull()
  })

  it('projects the outline of a face with a hole into a profile that closes, the hole a loop of its own', () => {
    const z = 10
    const edges = [
      lineEdge([0, 0, z], [40, 0, z]),
      lineEdge([40, 0, z], [40, 20, z]),
      lineEdge([40, 20, z], [0, 20, z]),
      lineEdge([0, 20, z], [0, 0, z]),
      circleEdge([10, 10, z], 'z', 3, 0, 2 * Math.PI),
    ]
    const { entities, skipped } = projectFaceOutline(edges, TOP)
    expect(skipped).toBe(0)
    expect(entities).toHaveLength(5)
    expect(entities.every((e) => e.source === undefined)).toBe(true)
    // Given the body, each piece keeps its edge to follow it.
    const linked = projectFaceOutline(edges, TOP, 2).entities
    expect(linked.map((e) => e.source)).toEqual(edges.map((e) => ({ body: 2, edge: e.fingerprint })))
    const sketch = emptySketch()
    for (const e of entities) addEntity(sketch, e)
    const regions = findRegions(sketch)
    const outer = regions.reduce((a, b) => (b.area > a.area ? b : a))
    expect(outer.area).toBeCloseTo(40 * 20 - Math.PI * 9, 1)
    expect(outer.holes).toHaveLength(1)
  })

  it('brings a piece of another sketch across, from its plane onto this one', () => {
    // A sketch on the XZ plane: its line along X projects onto the top as
    // the same line; its circle is seen edge on.
    const side: SectionFrame = { origin: [0, 0, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] }
    const line: SketchEntity = { id: 1, kind: 'line', a: [5, 2], b: [25, 2] }
    const p = projectSketchEntity(line, side, TOP)
    if (p?.kind !== 'line') throw new Error('not a line')
    expect([p.a[0], p.b[0]].sort((x, y) => x - y)).toEqual([5, 25])
    expect(p.projected).toBe(true)
    const circle: SketchEntity = { id: 2, kind: 'circle', c: [10, 5], r: 2 }
    expect(projectSketchEntity(circle, side, TOP)?.kind).toBe('line')
    expect(projectSketchEntity(circle, TOP, TOP)).toMatchObject({ kind: 'circle', r: 2 })
  })

  it('takes a projected piece again where its source is now, keeping the piece and the ends its relations hang on', () => {
    const was: SketchEntity = { id: 7, kind: 'line', a: [0, 0], b: [40, 0], fixed: true, projected: true, source: { sketch: 1, entity: 2 } }
    // The edge found again runs the other way: the ends are kept as they
    // were, so a corner joined to `a` stays joined to the same corner.
    const now = retake(was, { kind: 'line', a: [30, 2], b: [0, 2], fixed: true, projected: true })
    expect(now).toEqual({ ...was, a: [0, 2], b: [30, 2] })
    expect(retakeMoved(was, now!)).toBeCloseTo(Math.hypot(10, 2), 9)
    expect(retakeMoved(was, retake(was, { kind: 'line', a: [0, 0], b: [40, 0] })!)).toBe(0)
    // A source that projects to another kind of piece now is not taken.
    expect(retake(was, { kind: 'point', p: [0, 0] })).toBeNull()
    expect(retake(was, null)).toBeNull()
    // An arc a turn apart in its start is the same arc.
    const arc: SketchEntity = { id: 8, kind: 'arc', c: [0, 0], r: 5, start: Math.PI - 0.1, sweep: 0.5, projected: true, fixed: true }
    expect(retakeMoved(arc, retake(arc, { kind: 'arc', c: [0, 0], r: 5, start: -Math.PI - 0.1, sweep: 0.5 })!)).toBeLessThan(1e-9)
  })

  it('finds what the hand is on, within its reach', () => {
    const candidates: Projectable[] = [
      { entity: { kind: 'line', a: [0, 0], b: [40, 0] }, polyline: [[0, 0], [40, 0]], source: 'an edge' },
      { entity: { kind: 'point', p: [40, 20] }, polyline: [[40, 20]], source: 'an upright edge' },
    ]
    expect(projectableAt(candidates, [20, 0.4], 1)?.source).toBe('an edge')
    expect(projectableAt(candidates, [39.7, 19.8], 1)?.source).toBe('an upright edge')
    expect(projectableAt(candidates, [20, 5], 1)).toBeNull()
  })
})
