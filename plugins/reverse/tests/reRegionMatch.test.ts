// SPDX-License-Identifier: AGPL-3.0-only
// A picked profile is a fingerprint of a face, not a pointer into the
// sketch: the sketch is edited under an extrude — a corner dragged, a side
// swapped for another, a piece deleted — and the extrude has to find the
// same face again, or say plainly that it is gone.

import { describe, expect, it } from 'vitest'
import { pickedProfiles, type ExtrudeFeature, type SketchFeature } from '../core/features'
import { findRegions, matchRegion, matchRegions, parseRegionKey } from '../core/regions'
import { addEntity, addRectangle, cloneSketch, emptySketch, entityOf, type Sketch, type SketchLine } from '../core/sketch'

const frame = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }

function sketchFeature(sketch: Sketch): SketchFeature {
  return { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame, sketch, visible: true }
}

function extrudeOf(regions: string[]): ExtrudeFeature {
  return { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions, extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true }
}

describe('region fingerprints', () => {
  it('reads its own key back', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [20, 10])
    const [r] = findRegions(s)
    const parsed = parseRegionKey(r.key)
    expect(parsed?.ids).toEqual([1, 2, 3, 4])
    expect(parsed?.centroid[0]).toBeCloseTo(10, 1)
    expect(parsed?.centroid[1]).toBeCloseTo(5, 1)
    expect(parseRegionKey('nonsense')).toBeNull()
  })

  it('survives a corner being dragged — the same pieces, a middle that moved', () => {
    const s = emptySketch()
    const ids = addRectangle(s, [0, 0], [20, 10])
    const key = findRegions(s)[0].key
    // The top-right corner pulled out to (30, 18): the two lines that meet
    // there follow, the loop is the same four pieces.
    const edited = cloneSketch(s)
    const right = entityOf(edited, ids[1]) as SketchLine
    const top = entityOf(edited, ids[2]) as SketchLine
    right.b = [30, 18]
    top.a = [30, 18]
    const now = findRegions(edited)
    expect(now).toHaveLength(1)
    expect(now[0].key).not.toBe(key)
    expect(matchRegion(key, now)).toBe(now[0])
  })

  it('survives a side being replaced — the face the old middle lies in, sharing its pieces', () => {
    const s = emptySketch()
    const ids = addRectangle(s, [0, 0], [20, 10])
    const key = findRegions(s)[0].key
    // The top side deleted and drawn again as a new line: three of the four
    // pieces are the ones the pick named, and its middle is still inside.
    const edited = cloneSketch(s)
    edited.entities = edited.entities.filter((e) => e.id !== ids[2])
    edited.constraints = edited.constraints.filter((c) => !JSON.stringify(c).includes(`"entity":${ids[2]}`))
    addEntity(edited, { kind: 'line', a: [20, 10], b: [0, 10] })
    const now = findRegions(edited)
    expect(now).toHaveLength(1)
    expect(matchRegion(key, now)).toBe(now[0])
  })

  it('tells two faces apart after both moved, by where each middle was', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [20, 10])
    addRectangle(s, [30, 0], [50, 10])
    const [a, b] = findRegions(s)
    // Both boxes stretched: every key changes, every face is still there.
    const edited = cloneSketch(s)
    for (const e of edited.entities) {
      if (e.kind !== 'line') continue
      e.a = [e.a[0] * 1.3, e.a[1] * 1.3]
      e.b = [e.b[0] * 1.3, e.b[1] * 1.3]
    }
    const now = findRegions(edited)
    expect(now).toHaveLength(2)
    const ma = matchRegion(a.key, now)!
    const mb = matchRegion(b.key, now)!
    expect(ma).not.toBe(mb)
    expect(parseRegionKey(ma.key)!.ids).toEqual(parseRegionKey(a.key)!.ids)
    expect(parseRegionKey(mb.key)!.ids).toEqual(parseRegionKey(b.key)!.ids)
  })

  it('gives a face up once too little of it is left', () => {
    const s = emptySketch()
    const ids = addRectangle(s, [0, 0], [20, 10])
    const key = findRegions(s)[0].key
    // Three sides deleted and a new box drawn below the one that stays: one
    // piece in four is the pick's, and its middle lies outside the new face.
    const other = cloneSketch(s)
    other.entities = other.entities.filter((e) => e.id === ids[0])
    other.constraints = []
    addEntity(other, { kind: 'line', a: [20, 0], b: [20, -10] })
    addEntity(other, { kind: 'line', a: [20, -10], b: [0, -10] })
    addEntity(other, { kind: 'line', a: [0, -10], b: [0, 0] })
    expect(findRegions(other)).toHaveLength(1)
    expect(matchRegion(key, findRegions(other))).toBeNull()
    expect(matchRegions([key, key], findRegions(s))).toHaveLength(1)
  })

  it('lets an extrude keep its profile through an edit of its sketch', () => {
    const s = emptySketch()
    const ids = addRectangle(s, [0, 0], [20, 10])
    const key = findRegions(s)[0].key
    const edited = cloneSketch(s)
    const right = entityOf(edited, ids[1]) as SketchLine
    const top = entityOf(edited, ids[2]) as SketchLine
    right.b = [25, 12]
    top.a = [25, 12]
    const profiles = pickedProfiles(extrudeOf([key]), sketchFeature(edited), (f) => findRegions(f.sketch))
    expect(typeof profiles).not.toBe('string')
    expect(profiles).toHaveLength(1)
    // And says so when the face really is gone.
    const emptied = emptySketch()
    expect(pickedProfiles(extrudeOf([key]), sketchFeature(emptied), (f) => findRegions(f.sketch))).toMatch(/no longer closed/)
  })
})
