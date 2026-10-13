// SPDX-License-Identifier: AGPL-3.0-only
// Disjoint sets, the one way every grouping pass here keeps them: a parent
// per member, the path halved on every find so the trees stay shallow
// without a rank. Which member ends up the root is up to the order of the
// joins; callers that use the root for more than a key say how they join.

/** The root of `i`'s set, halving the path on the way up. */
export function findRoot(parent: Int32Array | Uint32Array | number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]]
    i = parent[i]
  }
  return i
}

export interface UnionFind {
  parent: Int32Array
  find(i: number): number
  /** Join the sets of `a` and `b`: `a`'s root goes under `b`'s. */
  union(a: number, b: number): void
}

/** The members 0 … n − 1, each a set of its own. */
export function makeUnionFind(n: number): UnionFind {
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => findRoot(parent, i)
  return {
    parent,
    find,
    union(a: number, b: number) {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent[ra] = rb
    },
  }
}

/** The connected pieces of a triangle mesh: each triangle joins its three
 *  corners, the second's and third's roots going under the first's. */
export function vertexComponents(indices: Uint32Array, vertexCount: number): UnionFind {
  const sets = makeUnionFind(vertexCount)
  const { parent, find } = sets
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t])
    for (let k = 1; k < 3; k++) {
      const b = find(indices[t + k])
      if (b !== a) parent[b] = a
    }
  }
  return sets
}
