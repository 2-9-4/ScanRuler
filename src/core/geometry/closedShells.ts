// SPDX-License-Identifier: AGPL-3.0-only
// Which of a mesh's shells are closed: the pieces whose triangles meet edge
// for edge in pairs, so that every line through the piece crosses its
// surface an even number of times — which is what lets a cut through it be
// closed by counting those crossings (viewer/sliceCap). A shell with a hole
// in it, or a sheet, is open: a cap counted over it would fill the hole
// along with the cut.
//
// Corners are matched on their exact float bits, as weld.ts matches them: a
// mesh split for shading — a scan's sharp edges, a reference's faces —
// repeats each corner bit for bit, and is closed when its welded form is.
// Each edge is counted by parity: a hash of its pair of corners is XOR-ed
// into its shell's tally, so an edge two triangles share cancels out, and a
// shell whose tally ends at zero has every edge an even number of times —
// closed, but for a 2⁻⁶⁴ chance of an unlucky cancellation.

import { makeUnionFind } from './unionFind'

export interface ClosedShells {
  /** 1 for each triangle of a closed shell, 0 for the others. */
  closed: Uint8Array
  /** How many triangles lie in closed shells. */
  count: number
}

/** The closed shells of a triangle mesh — `indices` null for a soup, its
 *  triangles three vertices after another. */
export function closedShells(positions: Float32Array, indices: ArrayLike<number> | null): ClosedShells {
  const vertexCount = Math.floor(positions.length / 3)
  const triangles = Math.floor((indices ? indices.length : vertexCount) / 3)
  const corner = indices ? (i: number) => indices[i] : (i: number) => i
  const { id, count: welded } = weldIds(positions)

  const sets = makeUnionFind(welded)
  for (let t = 0; t < triangles; t++) {
    const a = id[corner(3 * t)]
    sets.union(id[corner(3 * t + 1)], a)
    sets.union(id[corner(3 * t + 2)], a)
  }

  // Two independent 32-bit tallies per shell, kept at its root.
  const lo = new Int32Array(welded)
  const hi = new Int32Array(welded)
  const tally = (r: number, p: number, q: number) => {
    if (p === q) return
    const x = p < q ? p : q
    const y = p < q ? q : p
    lo[r] ^= edgeHash(x, y, 0x9e3779b1)
    hi[r] ^= edgeHash(x, y, 0x85ebca77)
  }
  for (let t = 0; t < triangles; t++) {
    const c0 = id[corner(3 * t)]
    const c1 = id[corner(3 * t + 1)]
    const c2 = id[corner(3 * t + 2)]
    const r = sets.find(c0)
    tally(r, c0, c1)
    tally(r, c1, c2)
    tally(r, c2, c0)
  }

  const closed = new Uint8Array(triangles)
  let count = 0
  for (let t = 0; t < triangles; t++) {
    const r = sets.find(id[corner(3 * t)])
    if (lo[r] === 0 && hi[r] === 0) {
      closed[t] = 1
      count++
    }
  }
  return { closed, count }
}

/** Each vertex's welded id: the first vertex with its exact bits — −0 read
 *  as 0 — through an open-addressing table, as weldTriangleSoup does. */
function weldIds(positions: Float32Array): { id: Int32Array; count: number } {
  const n = Math.floor(positions.length / 3)
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, n * 3)
  const bit = (i: number) => (bits[i] === 0x80000000 ? 0 : bits[i])
  let cap = 16
  while (cap < n * 2) cap <<= 1
  const mask = cap - 1
  const table = new Int32Array(cap).fill(-1)
  const first = new Int32Array(n)
  const id = new Int32Array(n)
  let count = 0
  for (let v = 0; v < n; v++) {
    const bx = bit(3 * v)
    const by = bit(3 * v + 1)
    const bz = bit(3 * v + 2)
    let h = hash3(bx, by, bz) & mask
    for (;;) {
      const slot = table[h]
      if (slot === -1) {
        table[h] = count
        first[count] = v
        id[v] = count++
        break
      }
      const w = first[slot]
      if (bit(3 * w) === bx && bit(3 * w + 1) === by && bit(3 * w + 2) === bz) {
        id[v] = slot
        break
      }
      h = (h + 1) & mask
    }
  }
  return { id, count }
}

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a, 0x9e3779b1)
  h ^= b
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h ^= c
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** An edge's corners, lower first, mixed to 32 bits under `seed`. */
function edgeHash(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ seed, 0xcc9e2d51)
  h = (h << 15) | (h >>> 17)
  h = Math.imul(h, 0x1b873593)
  h ^= y
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h | 0
}
