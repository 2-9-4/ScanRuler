// SPDX-License-Identifier: AGPL-3.0-only
// The patch network's draft edits the box and the layer make: a patch placed
// by its corners — new ones, the network's nodes, points on its curves and
// its grips — joined to its neighbours by the curves they share, filled at
// its seed, in one step of the undo; a line of two corners; the corners a
// patch keeps when a node goes; a patch deleted with the edges only it has;
// a grip a bend puts in, no step of its own; and suggested creases taken
// one by one and all at once, sharing their ends with each other and with
// the network's nodes.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { acceptCreases, addCurve, addPatch, commitPlacing, emptyNetworkDraft, insertGrip, moveGrip, placeCorner, recordDrag, removeNode, removeReportedPatch, setSuggested, undoNetwork, unplaceCorner } from '../state/reNetworkDraft'
import type { NetworkDraft, SuggestedCrease } from '../state/reTypes'

const crease = (from: Vec3, to: Vec3): SuggestedCrease => ({ from, to, via: [[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]], points: new Float32Array([...from, ...to]), length: Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]), angle: 90 })

/** The node at a point, by its id. */
const nodeAt = (d: NetworkDraft, at: Vec3) => d.nodes.find((n) => Math.hypot(n.at[0] - at[0], n.at[1] - at[1], n.at[2] - at[2]) < 1e-9)?.id

/** Whether two nodes are joined by a curve. */
const joins = (d: NetworkDraft, a: number, b: number) => d.curves.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))

/** A square patch placed at x0 by its four corners on the scan. */
function square(d: NetworkDraft, x0: number): NetworkDraft {
  return addPatch(d, [{ at: [x0, 0, 0] }, { at: [x0 + 10, 0, 0] }, { at: [x0 + 10, 10, 0] }, { at: [x0, 10, 0] }], { closed: true, seed: [x0 + 5, 5, 0] })
}

describe('a patch placed by its corners', () => {
  it('makes four nodes, four curves and a cell keeping its corners, in one undo step', () => {
    const d = square(emptyNetworkDraft(), 0)
    expect(d.nodes).toHaveLength(4)
    expect(d.curves).toHaveLength(4)
    expect(d.cells).toEqual([{ seed: [5, 5, 0], corners: d.nodes.map((n) => n.id) }])
    expect(d.history).toHaveLength(1)
    expect(undoNetwork(d).curves).toHaveLength(0)
  })

  it('places corners one by one, takes one back, and closes', () => {
    let d = emptyNetworkDraft()
    for (const at of [[0, 0, 0], [10, 0, 0], [99, 99, 0]] as Vec3[]) d = placeCorner(d, { at })
    d = unplaceCorner(d)
    d = placeCorner(placeCorner(d, { at: [10, 10, 0] }), { at: [0, 10, 0] })
    expect(d.placing?.corners).toHaveLength(4)
    expect(d.history).toHaveLength(0)
    const made = commitPlacing(d, { closed: true, seed: [5, 5, 0] })
    expect(made.placing).toBeNull()
    expect(made.cells).toHaveLength(1)
    expect(nodeAt(made, [99, 99, 0])).toBeUndefined()
  })

  it('shares the edge with the patch beside it: a neighbour on two of its corners adds three curves', () => {
    const a = square(emptyNetworkDraft(), 0)
    const right = nodeAt(a, [10, 0, 0])!
    const top = nodeAt(a, [10, 10, 0])!
    const b = addPatch(a, [{ node: right }, { at: [20, 0, 0] }, { at: [20, 10, 0] }, { node: top }], { closed: true, seed: [15, 5, 0] })
    expect(b.nodes).toHaveLength(6)
    expect(b.curves).toHaveLength(7)
    expect(b.cells[1].corners).toEqual([right, nodeAt(b, [20, 0, 0]), nodeAt(b, [20, 10, 0]), top])
    // The same corners again fill nothing more.
    expect(addPatch(b, [{ node: right }, { node: nodeAt(b, [20, 0, 0])! }, { node: nodeAt(b, [20, 10, 0])! }, { node: top }], { closed: true, seed: [15, 5, 0] }).cells).toHaveLength(2)
  })

  it('takes a side split by a neighbour’s corner as it is, not drawing it again', () => {
    // Two small patches on the right of a wide one's edge: their corner
    // splits nothing of the wide one's, which then runs from (10,0) to (10,20)
    // along the two small ones' sides.
    let d = addPatch(emptyNetworkDraft(), [{ at: [10, 0, 0] }, { at: [20, 0, 0] }, { at: [20, 10, 0] }, { at: [10, 10, 0] }], { closed: true, seed: [15, 5, 0] })
    const mid = nodeAt(d, [10, 10, 0])!
    d = addPatch(d, [{ node: mid }, { node: nodeAt(d, [20, 10, 0])! }, { at: [20, 20, 0] }, { at: [10, 20, 0] }], { closed: true, seed: [15, 15, 0] })
    const curves = d.curves.length
    const low = nodeAt(d, [10, 0, 0])!
    const high = nodeAt(d, [10, 20, 0])!
    d = addPatch(d, [{ at: [0, 0, 0] }, { node: low }, { node: high }, { at: [0, 20, 0] }], { closed: true, seed: [5, 10, 0] })
    // Three new curves: the chain low–mid–high is the wide patch's side.
    expect(d.curves.length).toBe(curves + 3)
    expect(joins(d, low, high)).toBe(false)
    expect(d.cells[2].corners).toEqual([nodeAt(d, [0, 0, 0]), low, high, nodeAt(d, [0, 20, 0])])
  })

  it('splits a curve where a corner is put on it, and on two points of one curve', () => {
    let d = addCurve(emptyNetworkDraft(), { at: [0, 0, 0] }, [], { at: [30, 0, 0] })
    const id = d.curves[0].id
    d = addPatch(d, [{ curve: id, at: [10, 0, 0] }, { curve: id, at: [20, 0, 0] }, { at: [20, 10, 0] }, { at: [10, 10, 0] }], { closed: true, seed: [15, 5, 0] })
    const a = nodeAt(d, [10, 0, 0])!
    const b = nodeAt(d, [20, 0, 0])!
    expect(joins(d, nodeAt(d, [0, 0, 0])!, a)).toBe(true)
    expect(joins(d, a, b)).toBe(true)
    expect(joins(d, b, nodeAt(d, [30, 0, 0])!)).toBe(true)
    // The three pieces of the line and the patch's three new sides.
    expect(d.curves).toHaveLength(6)
    expect(d.cells[0].corners).toEqual([a, b, nodeAt(d, [20, 10, 0]), nodeAt(d, [10, 10, 0])])
  })

  it('makes a grip clicked a corner: the curve split there, the grip gone', () => {
    let d = addCurve(emptyNetworkDraft(), { at: [0, 0, 0] }, [[5, 1, 0], [10, 0, 0], [15, 1, 0]], { at: [20, 0, 0] })
    const id = d.curves[0].id
    d = addPatch(d, [{ curve: id, grip: 1, at: [10, 0, 0] }, { at: [10, 10, 0] }, { at: [0, 10, 0] }, { node: nodeAt(d, [0, 0, 0])! }], { closed: true, seed: [5, 5, 0] })
    const g = nodeAt(d, [10, 0, 0])!
    const halves = d.curves.filter((c) => c.from === g || c.to === g)
    expect(halves.map((c) => c.via.length).sort()).toEqual([0, 1, 1])
    expect(d.curves.flatMap((c) => c.via).some((p) => p[0] === 10 && p[1] === 0)).toBe(false)
  })

  it('makes a line of two corners, open, with no cell', () => {
    let d = placeCorner(placeCorner(emptyNetworkDraft(), { at: [0, 0, 0] }), { at: [10, 0, 0] })
    d = commitPlacing(d, { closed: false, seed: null })
    expect(d.curves).toHaveLength(1)
    expect(d.cells).toHaveLength(0)
  })

  it('keeps a patch’s corners to the nodes there are, and leaves it to the rule with fewer than three', () => {
    const d = square(emptyNetworkDraft(), 0)
    const one = removeNode(d, nodeAt(d, [10, 10, 0])!)
    expect(one.cells[0].corners).toEqual([nodeAt(d, [0, 0, 0]), nodeAt(d, [10, 0, 0]), nodeAt(d, [0, 10, 0])])
    expect(removeNode(one, nodeAt(d, [0, 10, 0])!).cells[0].corners).toBeUndefined()
  })
})

describe('a patch changed after it was made', () => {
  /** Two squares side by side, sharing the curve at x = 10, and a report of
   *  them as a build would give it: a patch a cell, its sides' curves. */
  function pair() {
    const a = square(emptyNetworkDraft(), 0)
    const d = addPatch(a, [{ node: nodeAt(a, [10, 0, 0])! }, { at: [20, 0, 0] }, { at: [20, 10, 0] }, { node: nodeAt(a, [10, 10, 0])! }], { closed: true, seed: [15, 5, 0] })
    const sidesOf = (cell: number) => {
      const corners = d.cells[cell].corners!
      return corners.map((n, i) => [d.curves.find((c) => (c.from === n && c.to === corners[(i + 1) % 4]) || (c.to === n && c.from === corners[(i + 1) % 4]))!.id])
    }
    const report = {
      patches: [0, 1].map((i) => ({ sides: sidesOf(i) })),
      cells: [0, 1].map((i) => ({ seed: d.cells[i].seed, sides: 4, patch: i, patches: [i] })),
    } as unknown as Parameters<typeof removeReportedPatch>[1]
    return { d, report }
  }

  it('deletes a patch with the edges only it has, keeping the one it shares, in one undo step', () => {
    const { d, report } = pair()
    const shared = d.curves.find((c) => [c.from, c.to].every((n) => [nodeAt(d, [10, 0, 0]), nodeAt(d, [10, 10, 0])].includes(n)))!.id
    const gone = removeReportedPatch(d, report, 1)
    expect(gone.cells).toHaveLength(1)
    expect(gone.curves).toHaveLength(4)
    expect(gone.curves.some((c) => c.id === shared)).toBe(true)
    expect(gone.nodes).toHaveLength(4)
    expect(nodeAt(gone, [20, 0, 0])).toBeUndefined()
    expect(gone.picked).toBeNull()
    expect(undoNetwork(gone).cells).toHaveLength(2)
    // The other one leaves the shared curve to the patch still there.
    const first = removeReportedPatch(d, report, 0)
    expect(first.curves).toHaveLength(4)
    expect(first.cells[0].seed).toEqual([15, 5, 0])
  })

  it('bends an edge in one undo step: the grip put in and dragged are one', () => {
    const { d } = pair()
    const before = { nodes: d.nodes, curves: d.curves, cells: d.cells, spans: d.spans, fit: d.fit }
    const id = d.curves[0].id
    let x = insertGrip(d, id, 0, [5, 0, 0], false)
    expect(x.history).toHaveLength(d.history.length)
    x = moveGrip(x, id, 0, [5, -2, 0], false)
    x = recordDrag(x, before)
    expect(x.curves[0].via).toEqual([[5, -2, 0]])
    expect(x.history).toHaveLength(d.history.length + 1)
    expect(undoNetwork(x).curves[0].via).toEqual([])
  })
})

describe('suggested creases in the draft', () => {
  it('takes all of an L as two crease curves meeting at one node, in one undo step', () => {
    const d = setSuggested(emptyNetworkDraft(), [crease([0, 0, 0], [10, 0, 0]), crease([10, 0, 0], [10, 10, 0])])
    expect(d.history).toHaveLength(0)
    const taken = acceptCreases(d, [0, 1])
    expect(taken.curves).toHaveLength(2)
    expect(taken.curves.every((c) => c.crease === true)).toBe(true)
    expect(taken.nodes).toHaveLength(3)
    expect(taken.curves[0].to).toBe(taken.curves[1].from)
    expect(taken.suggested).toBeNull()
    expect(taken.history).toHaveLength(1)
    const undone = undoNetwork(taken)
    expect(undone.curves).toHaveLength(0)
  })

  it('takes one, leaves the rest offered, and ends it on a node already there', () => {
    let d = emptyNetworkDraft()
    d = addCurve(d, { at: [0, 0, 0] }, [], { at: [0, 20, 0] })
    expect(d.nodes).toHaveLength(2)
    d = setSuggested(d, [crease([0.3, 0, 0], [20, 0, 0]), crease([20, 0, 0], [20, 20, 0])])
    const taken = acceptCreases(d, [0])
    expect(taken.nodes).toHaveLength(3)
    expect(taken.curves[1].from).toBe(d.nodes[0].id)
    expect(taken.suggested).toHaveLength(1)
    expect(taken.suggested![0].from).toEqual([20, 0, 0])
    // An index past those offered takes nothing.
    expect(acceptCreases(taken, [5])).toBe(taken)
  })
})
