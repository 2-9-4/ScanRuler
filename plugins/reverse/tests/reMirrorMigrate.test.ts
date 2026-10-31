// SPDX-License-Identifier: AGPL-3.0-only
// A project saved while a mirror not joined put its copy under its source's
// id: what came after it and named that id meant the copy, and opens naming
// the copy by the mirror's id — the source standing beside it now.

import { describe, expect, it } from 'vitest'
import type { Feature } from '../core/features'
import { migrateFeatures, PART_VERSION } from '../app/projectSection'
import { extrudeAll, rectangleSketch } from './reKit'

const s = rectangleSketch(1, 10, 10)
const before: Feature[] = [
  s,
  extrudeAll(2, s, 0, 10),
  { id: 3, kind: 'mirror', name: 'Mirror 1', body: 2, plane: { kind: 'world', axis: 'x', offset: 20 }, join: false, visible: true } as Feature,
  { id: 4, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [], radius: 1, chain: false, visible: true } as Feature,
  { id: 5, kind: 'moveBody', name: 'Move 1', bodies: [2, 7], pivot: [0, 0, 0], translate: [1, 0, 0], rotate: [0, 0, 0], copy: false, visible: true } as Feature,
]

describe('mirror not joined, saved before part version 3', () => {
  it('names the copy by the mirror’s id in what follows it', () => {
    const after = migrateFeatures(before, 2)
    expect((after[2] as { body: number }).body).toBe(2)
    expect((after[3] as { body: number }).body).toBe(3)
    expect((after[4] as { bodies: number[] }).bodies).toEqual([3, 7])
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
  })

  it('leaves a joined mirror, and a part written now, alone', () => {
    const joined = before.map((f) => (f.kind === 'mirror' ? { ...f, join: true } : f))
    expect(migrateFeatures(joined, 2)).toEqual(joined)
    expect(migrateFeatures(before, PART_VERSION)).toEqual(before)
  })
})

describe('bodies out of view, saved with the project', () => {
  it('opens with the same bodies hidden', async () => {
    const { useReverse } = await import('../state/reStore')
    const { applyReversePart, collectReversePart } = await import('../app/projectSection')
    const body = (id: number) => ({ id, name: `Solid ${id}`, volume: 1, area: 1, closed: true, valid: true }) as unknown as Parameters<ReturnType<typeof useReverse.getState>['finishBuild']>[1][number]
    useReverse.getState().reset()
    useReverse.setState({ features: before.slice(0, 3), nextFeatureId: 4 })
    useReverse.getState().finishBuild([], [body(2), body(3)])
    useReverse.getState().setBodiesVisible([2], false)
    const part = collectReversePart()!
    expect(part.hiddenBodies).toEqual([2])
    applyReversePart(part)
    expect(useReverse.getState().hiddenBodies).toEqual([2])
    useReverse.getState().finishBuild([], [body(2), body(3)])
    expect(useReverse.getState().bodies.map((b) => [b.id, b.visible])).toEqual([[2, false], [3, true]])
    expect(useReverse.getState().hiddenBodies).toEqual([2])
    useReverse.getState().reset()
  })
})
