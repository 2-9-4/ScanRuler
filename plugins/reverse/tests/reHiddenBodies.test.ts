// SPDX-License-Identifier: AGPL-3.0-only
// Bodies out of view stay out of view: the sheet a thicken hides is kept
// hidden through a build that lacks it — one that failed, a panel edit's
// build up to its feature, a rollback above it — and goes into the project
// file all the while. Before, a body's eye carried from the last build
// alone, by id, and each of those brought the sheet back.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature } from '../core/features'
import { collectReversePart } from '../app/projectSection'
import { featuresToBuild, useReverse } from '../state/reStore'
import { rectangleSketch } from './reKit'
import { resetReverse } from './reReset'

type Built = Parameters<ReturnType<typeof useReverse.getState>['finishBuild']>[1][number]
const body = (id: number, surface = false) => ({ id, name: `Body ${id}`, volume: surface ? 0 : 1, area: 1, closed: !surface, valid: true, ...(surface ? { surface: true } : {}) }) as unknown as Built
const s = () => useReverse.getState()
const eyes = () => s().bodies.map((b) => [b.id, b.visible])

const sketch = rectangleSketch(1, 10, 10)
const sheet: Feature = { id: 2, kind: 'sheet', name: 'Sheet 1', sketchId: 1, from: 0, to: 10, visible: true }
/** The part as built with the thicken in: the sheet, and the wall. */
const both = () => s().finishBuild([], [body(2, true), body(3)])

beforeEach(() => {
  resetReverse()
  useReverse.setState({ features: [sketch, sheet], nextFeatureId: 3 })
  s().finishBuild([], [body(2, true)])
  // The thicken made as the box makes it: its commit hides the sheet.
  useReverse.setState({ featureDraft: { kind: 'thicken', sheet: 2, thickness: 1, side: 'out', op: 'new' } })
  expect(s().commitFeature()).toBe(3)
  both()
})
afterEach(resetReverse)

describe('a thickened sheet out of view', () => {
  it('is hidden by the thicken and stays so through the next build', () => {
    expect(s().hiddenBodies).toEqual([2])
    expect(eyes()).toEqual([[2, false], [3, true]])
  })

  it('stays hidden after a failed build', () => {
    s().failBuild('the kernel gave up')
    expect(s().bodies).toEqual([])
    expect(collectReversePart()!.hiddenBodies).toEqual([2])
    both()
    expect(eyes()).toEqual([[2, false], [3, true]])
  })

  it('stays hidden after a panel edit builds up to its feature', () => {
    s().editFeature(2)
    expect(featuresToBuild(s()).map((f) => f.id)).toEqual([1])
    s().finishBuild([], [])
    s().cancelFeature()
    both()
    expect(eyes()).toEqual([[2, false], [3, true]])
  })

  it('stays hidden after a rollback above it, and is saved so meanwhile', () => {
    s().rollTo(1)
    s().finishBuild([], [])
    expect(collectReversePart()!.hiddenBodies).toEqual([2])
    s().rollTo(null)
    both()
    expect(eyes()).toEqual([[2, false], [3, true]])
  })

  it('is shown by its eye — then a build keeps it shown — and Show all reaches one the build lacks', () => {
    s().toggleBodyVisible(2)
    expect(s().hiddenBodies).toEqual([])
    both()
    expect(eyes()).toEqual([[2, true], [3, true]])
    s().setBodiesVisible([2], false)
    s().rollTo(1)
    s().finishBuild([], [])
    s().setAllBodiesVisible(true)
    expect(s().hiddenBodies).toEqual([])
    s().rollTo(null)
    both()
    expect(eyes()).toEqual([[2, true], [3, true]])
  })

  it('lets an id go with the feature that made it', () => {
    s().setBodiesVisible([3], false)
    expect(s().hiddenBodies).toEqual([2, 3])
    // The thicken undone: its id is free for the next feature, whose body
    // must not open hidden.
    s().undoFeatures()
    expect(s().hiddenBodies).toEqual([2])
  })
})

describe('Compare in Deviation’s patches', () => {
  /** One triangle at height z, all of one face. */
  const flat = (z: number, hash: number) => ({
    positions: new Float32Array([0, 0, z, 10, 0, z, 0, 10, z]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faceHash: new Int32Array([hash]),
  })

  it('are told by the compared bodies alone, not by a hidden sheet nearer them', async () => {
    // As the app loads them: the commands sit in an import cycle.
    await import('../plugin')
    const { comparedMeshes } = await import('../app/reBodyCommands')
    const { nearestOnBodies } = await import('../core/notes')
    const meshes = new Map([
      [2, flat(1, 20)],
      [3, flat(0, 30)],
    ])
    const at: [number, number, number] = [1, 1, 1.2]
    expect(nearestOnBodies(meshes, at)?.body).toBe(2)
    expect(nearestOnBodies(comparedMeshes(meshes, [3]), at)).toMatchObject({ body: 3, faceHash: 30 })
  })
})
