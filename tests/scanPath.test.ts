// SPDX-License-Identifier: AGPL-3.0-only
// A path along the scan: across a cylinder it is the arc of the circle
// round it, over a sphere the great circle, each point on the surface and
// on a triangle edge; across a hole in a sheet the section breaks and the
// path goes round the hole along the edges. The triangles a section is cut
// from are found from the cells the plane passes near, and they are the
// ones, in the order, that every triangle of the box would give.

import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../src/core/fit/ransac'
import { placeOf, ScanPaths, tracePath } from '../src/core/geometry/scanPath'
import type { Vec3 } from '../src/core/types'
import { gaussian, icosphere } from './helpers'

/** A grid of (i, j) over [0, 1]² mapped by `at`, two triangles a cell
 *  wound counter-clockwise in (u, v); cells for which `hole` says so left
 *  out. `wrap` joins the last column to the first. */
function gridMesh(nu: number, nv: number, at: (u: number, v: number) => Vec3, wrap = false, hole?: (u: number, v: number) => boolean) {
  const cols = wrap ? nu : nu + 1
  const positions: number[] = []
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) positions.push(...at(i / nu, j / nv))
  const indices: number[] = []
  const id = (i: number, j: number) => j * cols + (wrap ? i % nu : i)
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (hole?.((i + 0.5) / nu, (j + 0.5) / nv)) continue
      indices.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1))
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** The triangles of the box the plane crosses, as the section took them
 *  before: every triangle of the box, those with all three corners on one
 *  side left out. */
function crossingInBox(scan: ScanPaths, lo: Vec3, hi: Vec3, m: Vec3, d0: number): number[] {
  const p = scan.positions
  const side = (v: number) => m[0] * p[v * 3] + m[1] * p[v * 3 + 1] + m[2] * p[v * 3 + 2] - d0 >= 0
  return scan.trianglesIn(lo, hi).filter((t) => {
    const [a, b, c] = [0, 1, 2].map((k) => side(scan.indices[t * 3 + k]))
    return a !== b || b !== c
  })
}

/** A scan whose sections are cut from every triangle of the box. */
class BoxScan extends ScanPaths {
  override trianglesCrossing(lo: Vec3, hi: Vec3, m: Vec3, d0: number): number[] {
    return crossingInBox(this, lo, hi, m, d0)
  }
}

/** The test meshes: a noisy curved sheet, a noisy ball, a bent sheet with
 *  a round hole, and a sheet with a fin standing on a row of its edges —
 *  edges three triangles share, where the order the triangles come in
 *  tells which way a section goes on. */
function testMeshes(): { name: string; positions: Float32Array; indices: Uint32Array }[] {
  const rand = mulberry32(5)
  const sheet = gridMesh(90, 70, (u, v) => [120 * u, 90 * v, 15 * Math.sin(3 * u) * Math.cos(2 * v) + 0.05 * gaussian(rand)])
  const ball = icosphere(4, 30, 0.05)
  const holed = gridMesh(60, 60, (u, v) => [100 * u, 100 * v, 8 * (u - 0.5) ** 2], false, (u, v) => Math.hypot(u - 0.5, v - 0.5) < 0.15)
  const flat = gridMesh(40, 40, (u, v) => [100 * u, 100 * v, 0])
  const base = flat.positions.length / 3
  const finPositions = Array.from(flat.positions)
  const finIndices = Array.from(flat.indices)
  for (let i = 0; i <= 40; i++) finPositions.push(2.5 * i, 50, 10)
  for (let i = 0; i < 40; i++) {
    const b0 = 20 * 41 + i
    const t0 = base + i
    finIndices.push(b0, b0 + 1, t0 + 1, b0, t0 + 1, t0)
  }
  return [
    { name: 'curved sheet', ...sheet },
    { name: 'ball', ...ball },
    { name: 'holed sheet', ...holed },
    { name: 'finned sheet', positions: Float32Array.from(finPositions), indices: Uint32Array.from(finIndices) },
  ]
}

/** A point on triangle t, at random. */
function pointOn(mesh: { positions: Float32Array; indices: Uint32Array }, t: number, rand: () => number): Vec3 {
  let u = rand()
  let v = rand()
  if (u + v > 1) [u, v] = [1 - u, 1 - v]
  const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[t * 3 + k] * 3)
  return [0, 1, 2].map((k) => (1 - u - v) * mesh.positions[a + k] + u * mesh.positions[b + k] + v * mesh.positions[c + k]) as Vec3
}

/** The edge search as it was: Dijkstra from `from`, the distances and the
 *  way back in Maps, a binary heap on plain arrays — the vertices of the
 *  way, or [] where there is none, and the distances it came to. */
function dijkstraRoute(scan: ScanPaths, from: number, to: number): { route: number[]; dist: Map<number, number> } {
  const p = scan.positions
  const { offsets, list } = scan.neighbours()
  const ids: number[] = []
  const keys: number[] = []
  const push = (id: number, key: number) => {
    let i = ids.length
    ids.push(id)
    keys.push(key)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      ids[i] = ids[parent]
      keys[i] = keys[parent]
      i = parent
    }
    ids[i] = id
    keys[i] = key
  }
  const pop = (): [number, number] => {
    const top: [number, number] = [ids[0], keys[0]]
    const lastId = ids.pop()!
    const lastKey = keys.pop()!
    const n = ids.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && keys[r] < keys[l] ? r : l
        if (keys[c] >= lastKey) break
        ids[i] = ids[c]
        keys[i] = keys[c]
        i = c
      }
      ids[i] = lastId
      keys[i] = lastKey
    }
    return top
  }
  const dist = new Map<number, number>([[from, 0]])
  const back = new Map<number, number>()
  push(from, 0)
  let found = from === to
  while (!found && ids.length > 0) {
    const [v, dv] = pop()
    if (dv > (dist.get(v) ?? Infinity)) continue
    if (v === to) {
      found = true
      break
    }
    for (let k = offsets[v]; k < offsets[v + 1]; k++) {
      const w = list[k]
      const nd = dv + Math.hypot(p[w * 3] - p[v * 3], p[w * 3 + 1] - p[v * 3 + 1], p[w * 3 + 2] - p[v * 3 + 2])
      if (nd < (dist.get(w) ?? Infinity)) {
        dist.set(w, nd)
        back.set(w, v)
        push(w, nd)
      }
    }
  }
  const route: number[] = []
  if (found) {
    for (let v = to; ; v = back.get(v)!) {
      route.push(v)
      if (v === from) break
    }
    route.reverse()
  }
  return { route, dist }
}

/** A way's length, its edges summed from its start as the search sums them. */
function routeLength(scan: ScanPaths, route: readonly number[]): number {
  const p = scan.positions
  let l = 0
  for (let i = 1; i < route.length; i++) {
    const v = route[i - 1]
    const w = route[i]
    l += Math.hypot(p[w * 3] - p[v * 3], p[w * 3 + 1] - p[v * 3 + 1], p[w * 3 + 2] - p[v * 3 + 2])
  }
  return l
}

function randomUnit(rand: () => number): Vec3 {
  const v: Vec3 = [gaussian(rand), gaussian(rand), gaussian(rand)]
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}

describe('scanPath', () => {
  it('runs round a cylinder along the circle', () => {
    const r = 20
    const mesh = gridMesh(120, 40, (u, v) => [r * Math.cos(2 * Math.PI * u), r * Math.sin(2 * Math.PI * u), -20 + 40 * v], true)
    const scan = new ScanPaths(mesh.positions, mesh.indices)
    const a: Vec3 = [r, 0, 3.3]
    const b: Vec3 = [0, r, 3.3]
    const path = tracePath(scan, a, b)
    expect(path.way).toBe('section')
    // The chords' sag at 3° a facet: the arc is about 0.006 % shorter.
    expect(path.length).toBeCloseTo((Math.PI / 2) * r, 1)
    const n = path.points.length / 3
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [path.points[i * 3], path.points[i * 3 + 1], path.points[i * 3 + 2]]
      expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThan(0.02)
      // The ends are taken a hair inside their triangles: 0.1 µm here.
      expect(z).toBeCloseTo(3.3, 3)
    }
    // Every point between the ends lies on an edge.
    for (let i = 1; i < n - 1; i++) expect('edge' in placeOf(path.on, i)).toBe(true)
    expect(placeOf(path.on, 0)).toEqual({ triangle: path.ends[0] })
    // About one crossing per facet the arc passes.
    expect(n).toBeGreaterThan(25)
  })

  it('goes over a sphere on the great circle', () => {
    const r = 30
    const mesh = icosphere(5, r)
    const scan = new ScanPaths(mesh.positions, mesh.indices)
    const a: Vec3 = [r, 0, 0]
    const angle = (100 * Math.PI) / 180
    const b: Vec3 = [r * Math.cos(angle), r * Math.sin(angle) * 0.6, r * Math.sin(angle) * 0.8]
    const path = tracePath(scan, a, b)
    expect(path.way).toBe('section')
    expect(path.length / (r * angle)).toBeGreaterThan(0.995)
    expect(path.length / (r * angle)).toBeLessThan(1.001)
    // On the plane through the centre and both points.
    const pa = Array.from(path.points.subarray(0, 3)) as Vec3
    const n = path.points.length / 3
    const pb = Array.from(path.points.subarray((n - 1) * 3)) as Vec3
    const normal: Vec3 = [pa[1] * pb[2] - pa[2] * pb[1], pa[2] * pb[0] - pa[0] * pb[2], pa[0] * pb[1] - pa[1] * pb[0]]
    const l = Math.hypot(...normal)
    for (let i = 0; i < n; i++) {
      const off = (path.points[i * 3] * normal[0] + path.points[i * 3 + 1] * normal[1] + path.points[i * 3 + 2] * normal[2]) / l
      expect(Math.abs(off)).toBeLessThan(0.05)
    }
  })

  it('goes round a hole along the edges where the section breaks', () => {
    // A 100 × 100 sheet with a 30 mm square hole in the middle; the two
    // points either side of it on a line through it.
    const mesh = gridMesh(50, 50, (u, v) => [100 * u, 100 * v, 0], false, (u, v) => Math.abs(u - 0.5) < 0.15 && Math.abs(v - 0.5) < 0.15)
    const scan = new ScanPaths(mesh.positions, mesh.indices)
    const a: Vec3 = [20, 50.3, 0]
    const b: Vec3 = [80, 50.3, 0]
    const path = tracePath(scan, a, b)
    expect(path.way).toBe('edges')
    // The hole's rim is 14 mm out from its middle; the path may walk it but
    // nothing inside.
    const n = path.points.length / 3
    for (let i = 0; i < n; i++) {
      const [x, y] = [path.points[i * 3], path.points[i * 3 + 1]]
      expect(Math.abs(x - 50) < 13.9 && Math.abs(y - 50) < 13.9).toBe(false)
    }
    // Round the hole: longer than across it, within the detour's corner.
    expect(path.length).toBeGreaterThan(60)
    expect(path.length).toBeLessThan(60 + 2 * 15 + 10)
    for (let i = 1; i < n - 1; i++) expect('vertex' in placeOf(path.on, i)).toBe(true)
    // Beside the hole the section joins them.
    const beside = tracePath(scan, [20, 10.3, 0], [80, 10.3, 0])
    expect(beside.way).toBe('section')
    expect(beside.length).toBeCloseTo(60, 6)
  })

  it('takes points off the surface onto it, and finds the nearest point', () => {
    const r = 20
    const mesh = gridMesh(90, 30, (u, v) => [r * Math.cos(2 * Math.PI * u), r * Math.sin(2 * Math.PI * u), 30 * v], true)
    const scan = new ScanPaths(mesh.positions, mesh.indices)
    const near = scan.closest([25, 0.2, 10])!
    expect(Math.hypot(near.point[0], near.point[1])).toBeCloseTo(r, 1)
    expect(near.distance).toBeCloseTo(5, 1)
    const path = tracePath(scan, [r + 0.5, 0, 10], [0, r + 0.5, 10])
    expect(Math.hypot(path.points[0], path.points[1])).toBeCloseTo(r, 1)
  })

  it('finds the triangles a plane crosses from the cells near it, as every triangle of the box gives them', () => {
    const rand = mulberry32(11)
    // Planes square to the axes too, through vertices (corners on the
    // plane), and boxes running off the grid.
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0], [0.6, 0, -0.8]]
    for (const mesh of testMeshes()) {
      const scan = new ScanPaths(mesh.positions, mesh.indices)
      const vertices = mesh.positions.length / 3
      let crossed = 0
      for (let i = 0; i < 200; i++) {
        const v = Math.floor(rand() * vertices)
        const at: Vec3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]
        const r = 0.5 + 60 * rand() ** 2
        const lo: Vec3 = [at[0] - r * (0.5 + rand()), at[1] - r * (0.5 + rand()), at[2] - r * (0.5 + rand())]
        const hi: Vec3 = [at[0] + r * (0.5 + rand()), at[1] + r * (0.5 + rand()), at[2] + r * (0.5 + rand())]
        const m = i % 4 === 0 ? axes[(i / 4) % axes.length] : randomUnit(rand)
        const through = i % 3 === 0 ? at : pointOn(mesh, Math.floor(rand() * scan.triangleCount), rand)
        const d0 = m[0] * through[0] + m[1] * through[1] + m[2] * through[2]
        const want = crossingInBox(scan, lo, hi, m, d0)
        expect(scan.trianglesCrossing(lo, hi, m, d0), `${mesh.name}, query ${i}`).toEqual(want)
        crossed += want.length
      }
      expect(crossed).toBeGreaterThan(1000)
    }
  })

  it('traces the same paths as when every triangle of the box was cut', () => {
    const rand = mulberry32(23)
    for (const mesh of testMeshes()) {
      const scan = new ScanPaths(mesh.positions, mesh.indices)
      const box = new BoxScan(mesh.positions, mesh.indices)
      const ways = { section: 0, edges: 0 }
      for (let i = 0; i < 150; i++) {
        const a = pointOn(mesh, Math.floor(rand() * scan.triangleCount), rand)
        const b = pointOn(mesh, Math.floor(rand() * scan.triangleCount), rand)
        // Off the surface a little, as the cursor is, and now and then a
        // plane held by a normal given.
        const off = randomUnit(rand)
        for (let k = 0; k < 3; k++) a[k] += 0.3 * rand() * off[k]
        const normal = i % 5 === 0 ? randomUnit(rand) : undefined
        const got = tracePath(scan, a, b, normal)
        const want = tracePath(box, a, b, normal)
        const where = `${mesh.name}, path ${i}`
        expect(got.way, where).toBe(want.way)
        expect(got.ends, where).toEqual(want.ends)
        expect(got.length, where).toBe(want.length)
        expect(Array.from(got.points), where).toEqual(Array.from(want.points))
        expect(Array.from(got.on), where).toEqual(Array.from(want.on))
        ways[got.way]++
      }
      expect(ways.section, mesh.name).toBeGreaterThan(30)
    }
  })

  it('finds the shortest way along the edges as Dijkstra found it', () => {
    // As long to the last bit, and the same way but where a vertex is come
    // to as soon through two vertices themselves as far from the start —
    // which Dijkstra settled by the order its heap held them in. A flat,
    // even grid is full of those; a noisy or curved mesh has none.
    const rand = mulberry32(31)
    const meshes = testMeshes()
    // Two pieces, nothing joining them: no way, told without a search.
    const ball = icosphere(2, 10)
    const far = gridMesh(10, 10, (u, v) => [50 + 20 * u, 20 * v, 0])
    const n = ball.positions.length / 3
    meshes.push({
      name: 'ball and sheet',
      positions: Float32Array.from([...ball.positions, ...far.positions]),
      indices: Uint32Array.from([...ball.indices, ...Array.from(far.indices, (v) => v + n)]),
    })
    for (const mesh of meshes) {
      const scan = new ScanPaths(mesh.positions, mesh.indices)
      const vertices = mesh.positions.length / 3
      let other = 0
      let none = 0
      for (let i = 0; i < 300; i++) {
        const from = Math.floor(rand() * vertices)
        const to = i % 10 === 0 ? from : Math.floor(rand() * vertices)
        const want = dijkstraRoute(scan, from, to)
        const got = scan.edgeRoute(from, to)
        const where = `${mesh.name}, ${from} → ${to}`
        // The holed sheet keeps the vertices of its hole, joined to nothing.
        if (want.route.length === 0) {
          expect(got, where).toBeNull()
          none++
          continue
        }
        expect(got, where).not.toBeNull()
        const route = got!
        expect(routeLength(scan, route), where).toBe(routeLength(scan, want.route))
        if (route.join() === want.route.join()) continue
        other++
        // From the end back, the first vertex the two ways come to from
        // different vertices: those are as far from the start.
        let k = 1
        while (route[route.length - k] === want.route[want.route.length - k]) k++
        const a = route[route.length - k]
        const b = want.route[want.route.length - k]
        expect(want.dist.get(a), where).toBe(want.dist.get(b))
      }
      if (mesh.name === 'curved sheet' || mesh.name === 'ball' || mesh.name === 'holed sheet') expect(other, mesh.name).toBe(0)
      if (mesh.name === 'ball and sheet') expect(none).toBeGreaterThan(100)
    }
  })
})
