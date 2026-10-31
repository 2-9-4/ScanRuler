// SPDX-License-Identifier: AGPL-3.0-only
// What the part says about what is picked on it (core/re/selectionInfo.ts):
// a face, an edge or a corner in full, what lies between two of them, the
// sums of more — and the store's selection taking one more with Ctrl.

import { beforeEach, describe, expect, it } from 'vitest'
import type { EdgeInfo, FaceInfo } from '../core/build'
import { circleCentre, itemKey, selectionInfo, type PickedItem } from '../core/selectionInfo'
import type { Vec3 } from '../../../src/core/types'
import { selectionItems, useReverse } from '../state/reStore'

let hash = 1
const plane = (centroid: Vec3, normal: Vec3, area = 100): PickedItem => {
  const face: FaceInfo = { hash: hash++, fingerprint: { kind: 'plane', centroid, dir: normal, area, origin: 1 } }
  return { type: 'face', bodyId: 1, face, edges: [] }
}
const cylinder = (center: Vec3, axis: Vec3, radius: number): PickedItem => {
  const face: FaceInfo = { hash: hash++, fingerprint: { kind: 'cylinder', centroid: center, dir: axis, area: 2 * Math.PI * radius * 10, radius, center, origin: 1 } }
  return { type: 'face', bodyId: 1, face, edges: [] }
}
const lineEdge = (a: Vec3, b: Vec3): PickedItem => {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const l = Math.hypot(...d)
  const edge: EdgeInfo = {
    hash: hash++,
    fingerprint: { kind: 'line', mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], dir: [d[0] / l, d[1] / l, d[2] / l], length: l, faces: [], origin: 1 },
    faces: [],
    ends: [a, b],
    endTangents: [d, d],
    polyline: Float32Array.from([...a, ...b]),
  }
  return { type: 'edge', bodyId: 1, edge }
}
const circleEdge = (c: Vec3, r: number): PickedItem => {
  const pts: number[] = []
  for (let i = 0; i <= 32; i++) pts.push(c[0] + r * Math.cos((i * Math.PI) / 16), c[1] + r * Math.sin((i * Math.PI) / 16), c[2])
  const start: Vec3 = [c[0] + r, c[1], c[2]]
  const edge: EdgeInfo = { hash: hash++, fingerprint: { kind: 'circle', mid: [c[0] - r, c[1], c[2]], dir: [0, 0, 1], length: 2 * Math.PI * r, radius: r, faces: [], origin: 1 }, faces: [], ends: [start, start], endTangents: [[0, 1, 0], [0, 1, 0]], polyline: Float32Array.from(pts) }
  return { type: 'edge', bodyId: 1, edge }
}
const corner = (p: Vec3): PickedItem => ({ type: 'vertex', bodyId: 1, point: p })
const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value

describe('what one pick says', () => {
  it('a flat face: its area, its normal and where it is', () => {
    const info = selectionInfo([plane([20, 10, 10], [0, 0, 1], 800)])!
    expect(info.title).toBe('Flat face')
    expect(value(info.rows, 'Area')).toBe('800.00 mm²')
    expect(value(info.rows, 'Normal')).toBe('0.000, 0.000, 1.000')
    expect(value(info.rows, 'Centre')).toBe('20.000, 10.000, 10.000')
  })

  it('a round face its radius and axis, a straight edge its length and ends, a round one its centre', () => {
    const cyl = selectionInfo([cylinder([5, 5, 0], [0, 0, 1], 3)])!
    expect(cyl.title).toBe('Cylindrical face')
    expect(value(cyl.rows, 'Radius')).toBe('3.000 mm')
    expect(value(cyl.rows, 'Diameter')).toBe('6.000 mm')
    const line = selectionInfo([lineEdge([0, 0, 0], [40, 0, 0])])!
    expect(value(line.rows, 'Length')).toBe('40.000 mm')
    expect(value(line.rows, 'To')).toBe('40.000, 0.000, 0.000')
    const round = circleEdge([12, 8, 10], 4)
    expect(circleCentre((round as Extract<PickedItem, { type: 'edge' }>).edge)!.map((v) => +v.toFixed(6))).toEqual([12, 8, 10])
    expect(value(selectionInfo([round])!.rows, 'Centre')).toBe('12.000, 8.000, 10.000')
  })

  it('a corner its coordinates', () => {
    const info = selectionInfo([corner([40, 20, 10])])!
    expect(info.title).toBe('Point')
    expect(info.rows.map((r) => r.value)).toEqual(['40.000 mm', '20.000 mm', '10.000 mm'])
  })
})

describe('what lies between two picks', () => {
  it('two corners: the distance and its parts', () => {
    const info = selectionInfo([corner([0, 0, 0]), corner([40, 20, 10])])!
    expect(info.title).toBe('2 points')
    expect(value(info.rows, 'Distance')).toBe(`${Math.hypot(40, 20, 10).toFixed(3)} mm`)
    expect(value(info.rows, 'ΔY')).toBe('20.000 mm')
  })

  it('parallel faces their distance, others their angle', () => {
    expect(value(selectionInfo([plane([0, 0, 0], [0, 0, -1]), plane([5, 5, 10], [0, 0, 1])])!.rows, 'Distance')).toBe('10.000 mm')
    const s = Math.SQRT1_2
    expect(value(selectionInfo([plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 0], [s, 0, s])])!.rows, 'Angle')).toBe('45.00°')
  })

  it('a corner to a face, to an edge and to an axis', () => {
    expect(value(selectionInfo([corner([3, 4, 7]), plane([0, 0, 0], [0, 0, 1])])!.rows, 'Distance to the face')).toBe('7.000 mm')
    expect(value(selectionInfo([lineEdge([0, 0, 0], [10, 0, 0]), corner([5, 3, 4])])!.rows, 'Distance to the edge')).toBe('5.000 mm')
    expect(value(selectionInfo([corner([8, 9, 2]), cylinder([5, 5, 0], [0, 0, 1], 3)])!.rows, 'Distance to the axis')).toBe('5.000 mm')
  })

  it('edges: parallel a distance, crossing an angle, askew how close they pass; two holes the distance between their axes', () => {
    expect(value(selectionInfo([lineEdge([0, 0, 0], [10, 0, 0]), lineEdge([0, 6, 8], [10, 6, 8])])!.rows, 'Distance')).toBe('10.000 mm')
    const crossing = selectionInfo([lineEdge([0, 0, 0], [10, 0, 0]), lineEdge([0, 0, 0], [0, 10, 0])])!
    expect(value(crossing.rows, 'Angle')).toBe('90.00°')
    expect(value(crossing.rows, 'They cross')).toBe('in one point')
    expect(value(selectionInfo([lineEdge([0, 0, 0], [10, 0, 0]), lineEdge([0, 0, 5], [0, 10, 5])])!.rows, 'Closest')).toBe('5.000 mm')
    expect(value(selectionInfo([cylinder([0, 0, 0], [0, 0, 1], 3), circleEdge([30, 40, 10], 2)])!.rows, 'Distance between the axes')).toBe('50.000 mm')
  })

  it('an edge along a face its distance from it, one through it its angle', () => {
    expect(value(selectionInfo([lineEdge([0, 0, 4], [10, 0, 4]), plane([0, 0, 0], [0, 0, 1])])!.rows, 'Distance')).toBe('4.000 mm')
    expect(value(selectionInfo([lineEdge([0, 0, 0], [0, 0, 10]), plane([0, 0, 0], [0, 0, 1])])!.rows, 'Angle to the face')).toBe('90.00°')
  })

  it('more than two: what they add up to', () => {
    const info = selectionInfo([lineEdge([0, 0, 0], [10, 0, 0]), lineEdge([0, 0, 0], [0, 20, 0]), lineEdge([0, 0, 0], [0, 0, 5]), plane([0, 0, 0], [0, 0, 1], 50)])!
    expect(info.title).toBe('1 face, 3 edges')
    expect(value(info.rows, 'Length, together')).toBe('35.000 mm')
    expect(value(info.rows, 'Area, together')).toBe('50.00 mm²')
  })
})

describe('the selection in the store', () => {
  beforeEach(() => useReverse.setState({ selection: null }))
  const at = { x: 10, y: 10 }

  it('a click replaces, Ctrl+click adds one and takes it off again, a window adds what is new', () => {
    const a = corner([0, 0, 0])
    const b = corner([10, 0, 0])
    const e = lineEdge([0, 0, 0], [10, 0, 0])
    const s = () => useReverse.getState()
    s().pickBodyItem(a, at, false)
    expect(s().selection?.kind).toBe('bodyVertex')
    s().pickBodyItem(b, at, true)
    expect(s().selection?.kind).toBe('bodyItems')
    expect(selectionItems(s().selection).map(itemKey)).toEqual([itemKey(a), itemKey(b)])
    s().pickBodyItem(a, at, true)
    expect(s().selection).toMatchObject({ kind: 'bodyVertex', point: [10, 0, 0] })
    s().addBodyItems([b, e], at)
    expect(selectionItems(s().selection).map((i) => i.type)).toEqual(['vertex', 'edge'])
    s().pickBodyItem(e, at, false)
    expect(s().selection?.kind).toBe('bodyEdge')
    s().pickBodyItem(e, at, true)
    expect(s().selection).toBeNull()
  })
})
