// SPDX-License-Identifier: AGPL-3.0-only
// A flat sheet of scan, for Trim to scan's tests: a fracture as simple as one
// gets, so where its break lies, how far it is carried and what a body cut
// with it keeps can be worked out exactly. Its points are scattered a little
// along it, so its triangles are uneven as a scan's are, and it may have a
// round hole in it.

import type { TestMesh } from './brokenRing'

type V3 = [number, number, number]

/**
 * A square sheet `size` mm across about `origin`, in the plane of the unit
 * axes `u` and `v` — facing u × v — scanned every `step` mm, with a hole
 * `hole` mm across in the middle when it is more than zero, and a slot
 * `notch.width` mm wide cut in from its +u edge to `notch.to` along u — a
 * spot the scanner missed, open to the edge.
 */
export function sheet({
  origin = [0, 0, 0] as V3,
  u = [1, 0, 0] as V3,
  v = [0, 1, 0] as V3,
  size = 40,
  step = 0.5,
  hole = 0,
  notch = null as { to: number; width: number } | null,
  seed = 3,
} = {}): TestMesh {
  let s = seed >>> 0
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
  const n = Math.round(size / step)
  const pos: number[] = []
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const border = i === 0 || j === 0 || i === n || j === n
      const a = -size / 2 + i * step + (border ? 0 : (rand() - 0.5) * 0.4 * step)
      const b = -size / 2 + j * step + (border ? 0 : (rand() - 0.5) * 0.4 * step)
      pos.push(origin[0] + a * u[0] + b * v[0], origin[1] + a * u[1] + b * v[1], origin[2] + a * u[2] + b * v[2])
    }
  }
  const at = (i: number, j: number) => j * (n + 1) + i
  const idx: number[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ca = -size / 2 + (i + 0.5) * step
      const cb = -size / 2 + (j + 0.5) * step
      if (hole > 0 && Math.hypot(ca, cb) < hole / 2) continue
      if (notch && ca > notch.to && Math.abs(cb) < notch.width / 2) continue
      idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1))
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), vertexCount: pos.length / 3 }
}

/** Two meshes as one, the second's vertices numbered after the first's. */
export function joined(a: TestMesh, b: TestMesh): TestMesh {
  const positions = new Float32Array(a.positions.length + b.positions.length)
  positions.set(a.positions)
  positions.set(b.positions, a.positions.length)
  const indices = new Uint32Array(a.indices.length + b.indices.length)
  indices.set(a.indices)
  for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + a.vertexCount
  return { positions, indices, vertexCount: a.vertexCount + b.vertexCount }
}
