// SPDX-License-Identifier: AGPL-3.0-only
// A patch network in a project file: read back through the check a project
// is opened with — its cells, which have no id of their own, with their
// corners and a split cell's centre — and a cell without its seed refused
// by name. A network of patches saved could not be opened again: the cells
// were checked for ids like the nodes and the curves.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { validateReversePart } from '../app/projectSection'
import { network } from './networkMeshes'

describe('a patch network in a project file', () => {
  const nodes: Record<number, Vec3> = { 1: [0, 0, 0], 2: [10, 0, 0], 3: [10, 10, 0], 4: [0, 10, 0], 5: [20, 0, 0] }
  const f = network(1, nodes, [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 1 }, { from: 2, to: 5 }, { from: 5, to: 3 }], [[5, 5, 0], [13, 3, 0]])
  f.cells[0].corners = [1, 2, 3, 4]
  f.cells[1] = { ...f.cells[1], corners: [2, 5, 3], centre: [13, 3, 0] }
  const part = (features: unknown[]) => JSON.parse(JSON.stringify({ version: 3, nextFeatureId: 2, nextOfKind: {}, features }))

  it('opens with its cells, their corners and a centre', () => {
    const read = validateReversePart(part([f]))
    expect(read.features[0]).toEqual(f)
  })

  it('refuses a cell without its seed, or with corners that are no ids', () => {
    expect(() => validateReversePart(part([{ ...f, cells: [{ corners: [1, 2, 3] }] }]))).toThrow(/network\.cell\.seed/)
    expect(() => validateReversePart(part([{ ...f, cells: [{ seed: [0, 0, 0], corners: [1.5] }] }]))).toThrow(/network\.cell\.corners/)
  })
})
