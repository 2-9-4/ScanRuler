// SPDX-License-Identifier: AGPL-3.0-only
// The body list's components: bodies and components moved between them, a
// component taken away, rows picked to go together, the store's steps and
// their undo, and the project file that keeps them.

import { beforeEach, describe, expect, it } from 'vitest'
import { bodiesOfPick, bodiesWithin, commonFolder, folderOf, folderPath, foldersWithin, moveInto, nextFolderName, NO_PICK, outermost, validateFolders, withoutFolder, type BodyFolder } from '../core/bodyFolders'
import { applyReversePart, collectReversePart, validateReversePart } from '../app/projectSection'
import { useReverse, type BodyInfo } from '../state/reStore'

const s = () => useReverse.getState()

/** Housing › Motor, and Fasteners beside Housing. */
const TREE: BodyFolder[] = [
  { id: 1, name: 'Housing', parent: null, bodies: [10] },
  { id: 2, name: 'Motor', parent: 1, bodies: [11, 12] },
  { id: 3, name: 'Fasteners', parent: null, bodies: [13] },
]

describe('the components of the body list', () => {
  it('finds where a body is, the path down to a component and what a component holds', () => {
    expect(folderOf(TREE, 12)?.name).toBe('Motor')
    expect(folderOf(TREE, 99)).toBeNull()
    expect(folderPath(TREE, 2).map((f) => f.name)).toEqual(['Housing', 'Motor'])
    expect(folderPath(TREE, null)).toEqual([])
    expect([...foldersWithin(TREE, 1)].sort()).toEqual([1, 2])
    expect([...bodiesWithin(TREE, 1)].sort()).toEqual([10, 11, 12])
    expect(nextFolderName(TREE)).toBe('Component 1')
    expect(nextFolderName([...TREE, { id: 4, name: 'Component 7', parent: null, bodies: [] }])).toBe('Component 8')
  })

  it('moves bodies and components, and refuses a component into itself or into one inside it', () => {
    // A body out of Motor into Fasteners: in one, out of the other.
    const moved = moveInto(TREE, { bodies: [11] }, 3)!
    expect(moved.find((f) => f.id === 2)!.bodies).toEqual([12])
    expect(moved.find((f) => f.id === 3)!.bodies).toEqual([13, 11])
    // To the head of the list: in none.
    expect(folderOf(moveInto(TREE, { bodies: [10] }, null)!, 10)).toBeNull()
    // Motor beside Housing.
    expect(moveInto(TREE, { folders: [2] }, null)!.find((f) => f.id === 2)!.parent).toBeNull()
    // Housing into Motor, which is inside it — or into itself: refused.
    expect(moveInto(TREE, { folders: [1] }, 2)).toBeNull()
    expect(moveInto(TREE, { folders: [1] }, 1)).toBeNull()
    expect(moveInto(TREE, { bodies: [10] }, 42)).toBeNull()
    // Where it is already: nothing moves, the same list comes back.
    expect(moveInto(TREE, { bodies: [11] }, 2)).toBe(TREE)
    expect(moveInto(TREE, { folders: [2] }, 1)).toBe(TREE)
  })

  it('takes a component away with what it held moved up to where it stood', () => {
    const left = withoutFolder(TREE, 1)
    expect(left.map((f) => f.id)).toEqual([2, 3])
    // Motor stands at the head now; Housing's own body is in none.
    expect(left.find((f) => f.id === 2)!.parent).toBeNull()
    expect(folderOf(left, 10)).toBeNull()
    // Motor taken away: its bodies go into Housing.
    expect(withoutFolder(TREE, 2).find((f) => f.id === 1)!.bodies).toEqual([10, 11, 12])
  })

  it('moves rows picked together as their outermost: what a picked component holds goes with it', () => {
    // Housing picked with Motor inside it and a body of each: Housing alone,
    // and Fasteners' body, which no picked component holds.
    expect(outermost(TREE, { bodies: [10, 11, 13], folders: [2, 1] })).toEqual({ bodies: [13], folders: [1] })
    expect(outermost(TREE, { bodies: [11, 13], folders: [] })).toEqual({ bodies: [11, 13], folders: [] })
    expect([...bodiesOfPick(TREE, { bodies: [13], folders: [2] })].sort()).toEqual([11, 12, 13])
    // Several picked rows dragged onto a component go in together.
    const moved = moveInto(TREE, outermost(TREE, { bodies: [10, 13], folders: [] }), 2)!
    expect(moved.find((f) => f.id === 2)!.bodies).toEqual([11, 12, 10, 13])
    expect(moved.find((f) => f.id === 3)!.bodies).toEqual([])
  })

  it('puts a component made of bodies where they all stand, else at the head', () => {
    expect(commonFolder(TREE, { bodies: [11, 12] })).toBe(2)
    expect(commonFolder(TREE, { bodies: [11, 13] })).toBeNull()
    expect(commonFolder(TREE, { bodies: [99, 98] })).toBeNull()
  })

  it('reads a file’s components, refusing a parent that is not there or a ring', () => {
    expect(validateFolders(TREE)).toBe(TREE)
    expect(() => validateFolders([{ id: 1, name: 'A', parent: 5, bodies: [] }])).toThrow()
    expect(() =>
      validateFolders([
        { id: 1, name: 'A', parent: 2, bodies: [] },
        { id: 2, name: 'B', parent: 1, bodies: [] },
      ]),
    ).toThrow()
    expect(() => validateFolders([{ id: 1, name: 'A', parent: null, bodies: ['x'] }])).toThrow()
    expect(() => validateFolders({})).toThrow()
  })
})

const body = (id: number, visible = true): BodyInfo => ({ id, name: `Solid ${id}`, color: '#888888', visible, volume: 1, faces: 6, closed: true, triangles: 12 })

describe('the components in the store', () => {
  beforeEach(() => {
    s().reset()
    useReverse.setState({
      features: [{ id: 1, kind: 'extrude', name: 'Extrude 1', sketchId: 0, regions: [], extent: { kind: 'distance', from: 0, to: 1 }, op: 'new', visible: true }],
      bodies: [body(1), body(2), body(3)],
    })
  })

  it('makes, fills, renames and takes away components, each an undo step', () => {
    const a = s().addBodyFolder(null, { bodies: [1, 2] })
    expect(s().bodyFolders).toEqual([{ id: a, name: 'Component 1', parent: null, bodies: [1, 2] }])
    const b = s().addBodyFolder(a)
    expect(s().bodyFolders.find((f) => f.id === b)).toMatchObject({ name: 'Component 2', parent: a, bodies: [] })
    expect(s().moveToBodyFolder({ bodies: [2] }, b)).toBe(true)
    expect(s().bodyFolders.find((f) => f.id === a)!.bodies).toEqual([1])
    // Into itself: refused, nothing kept on the undo history.
    const steps = s().past.length
    expect(s().moveToBodyFolder({ folders: [a] }, b)).toBe(false)
    expect(s().moveToBodyFolder({ bodies: [2] }, b)).toBe(true)
    expect(s().past.length).toBe(steps)
    s().renameBodyFolder(a, '  Motor ')
    s().renameBodyFolder(a, '   ')
    expect(s().bodyFolders.find((f) => f.id === a)!.name).toBe('Motor')
    s().setFolderOpen(a, false)
    s().removeBodyFolder(a)
    // Its body stands at the head of the list now, Component 2 beside it.
    expect(s().bodyFolders).toEqual([{ id: b, name: 'Component 2', parent: null, bodies: [2] }])
    expect(s().closedFolders).toEqual([])
    // Back through every step to none.
    for (let i = 0; i < 5; i++) s().undoFeatures()
    expect(s().bodyFolders).toEqual([])
    s().redoFeatures()
    expect(s().bodyFolders).toHaveLength(1)
  })

  it('lets the rows picked in the list go as an editor opens, on a plain click on the part and with a new scan', () => {
    s().setListSelection({ bodies: [1, 2], folders: [] })
    expect(s().listSelection.bodies).toEqual([1, 2])
    s().setListSelection({ bodies: [], folders: [] })
    expect(s().listSelection).toBe(NO_PICK)
    s().setListSelection({ bodies: [1, 2], folders: [] })
    const face = { hash: 1, fingerprint: { kind: 'plane', area: 1, centroid: [0, 0, 0], dir: [0, 0, 1] } } as never
    // Ctrl+click on the part adds to what is selected there; the rows stay.
    s().pickBodyItem({ type: 'face', bodyId: 3, face, edges: [] }, { x: 0, y: 0 }, true)
    expect(s().listSelection.bodies).toEqual([1, 2])
    s().pickBodyItem({ type: 'face', bodyId: 3, face, edges: [] }, { x: 0, y: 0 }, false)
    expect(s().listSelection).toBe(NO_PICK)
    // A Move opened on the rows takes all of them; the rows are let go.
    s().setListSelection({ bodies: [1, 3], folders: [] })
    s().startFeature('moveBody', { bodies: [1, 3] })
    expect(s().featureDraft).toMatchObject({ kind: 'moveBody', bodies: [1, 3] })
    expect(s().listSelection).toBe(NO_PICK)
    s().setMoveBodies([1, 3, 2])
    expect(s().featureDraft).toMatchObject({ bodies: [1, 3, 2] })
    s().cancelFeature()
    s().setListSelection({ bodies: [2], folders: [] })
    s().reset()
    expect(s().listSelection).toBe(NO_PICK)
  })

  it('sets a few eyes at once, and lights rows and bodies without a change for the same', () => {
    s().setBodiesVisible([1, 3], false)
    expect(s().bodies.map((b) => b.visible)).toEqual([false, true, false])
    const bodies = s().bodies
    s().setBodiesVisible([1], false)
    expect(s().bodies).toBe(bodies)
    s().setBodyHover({ ids: [2], from: 'view' })
    const hover = s().bodyHover
    s().setBodyHover({ ids: [2], from: 'view' })
    expect(s().bodyHover).toBe(hover)
    s().setBodyHover({ ids: [2], from: 'list' })
    expect(s().bodyHover).toEqual({ ids: [2], from: 'list' })
    s().reset()
    expect(s().bodyHover).toBeNull()
  })

  it('keeps the components in the project file and brings them back', () => {
    const a = s().addBodyFolder(null, { bodies: [3] })
    s().addBodyFolder(a, { bodies: [1] })
    const part = collectReversePart()!
    expect(part.bodyFolders).toEqual(s().bodyFolders)
    const read = validateReversePart(JSON.parse(JSON.stringify(part)))
    s().reset()
    expect(s().bodyFolders).toEqual([])
    applyReversePart(read)
    expect(s().bodyFolders.map((f) => [f.name, f.parent, f.bodies])).toEqual([
      ['Component 1', null, [3]],
      ['Component 2', a, [1]],
    ])
    // None: nothing written; a ring in the file: refused.
    s().reset()
    useReverse.setState({ features: read.features as never })
    expect(collectReversePart()!.bodyFolders).toBeUndefined()
    expect(() => validateReversePart({ ...read, bodyFolders: [{ id: 1, name: 'A', parent: 1, bodies: [] }] })).toThrow(/bodyFolders/)
  })
})
