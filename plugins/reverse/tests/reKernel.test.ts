// SPDX-License-Identifier: AGPL-3.0-only
// The kernel adapter, end to end: a hand-drawn rectangle becomes a body, the
// body leaves as STEP, and meshStep — the importer the Deviation workspace
// trusts reference CAD to, which had no part in writing the file — builds it
// back into a closed mesh of the right size. That is milestone 1's proof
// that what the workspace exports is a solid a CAD system opens as one.

import { describe, expect, it } from 'vitest'
import { arcPiece, rectangleLoop, ReKernel, type Shape } from '../core/kernel'
import { wasmTailCallsSupported } from '../core/wasmSupport'
import { parseSTEP } from '../../../src/core/parsers/step'
import { stepBuffer } from '../../../tests/stepFixtures'

const kernelPromise = ReKernel.load()

/** Edges bounding anything other than two triangles: a hole, a crack, or a
 *  face that came back twice. */
function openEdgeCount(indices: Uint32Array): number {
  const seen = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e]
      const b = indices[t + ((e + 1) % 3)]
      seen.set(a < b ? `${a}_${b}` : `${b}_${a}`, (seen.get(a < b ? `${a}_${b}` : `${b}_${a}`) ?? 0) + 1)
    }
  }
  let open = 0
  for (const n of seen.values()) if (n !== 2) open++
  return open
}

function bounds(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  return { min, max }
}

describe('the CAD kernel', () => {
  it('runs here — Node 22+ has the tail calls it needs', () => {
    expect(wasmTailCallsSupported()).toBe(true)
  })

  it('extrudes a rectangle to a closed solid that survives a STEP round trip', async () => {
    const k = await kernelPromise
    const face = k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], 40, 25), holes: [] })
    const body = k.extrude(face, [0, 0, 1], 0, 10)
    expect(k.isClosedSolid(body)).toBe(true)
    expect(k.volume(body)).toBeCloseTo(40 * 25 * 10, 6)
    expect(k.faceCount(body)).toBe(6)

    const step = k.exportStep([body])
    expect(step.startsWith('ISO-10303-21')).toBe(true)
    const { mesh, info } = parseSTEP(stepBuffer(step))
    expect(info.units).toBe('mm')
    expect(info.unsound).toBe(false)
    expect(openEdgeCount(mesh.indices!)).toBe(0)
    const { min, max } = bounds(mesh.positions)
    expect(min).toEqual([0, 0, 0])
    expect(max[0]).toBeCloseTo(40, 5)
    expect(max[1]).toBeCloseTo(25, 5)
    expect(max[2]).toBeCloseTo(10, 5)

    // And the kernel reads its own file back as one solid of the same volume.
    const back = k.importStep(step)
    expect(k.solidCount(back)).toBe(1)
    expect(k.volume(back)).toBeCloseTo(10_000, 4)
    k.release(face, body, back)
  })

  it('cuts a hole, sweeps an arc and trims with a half-space', async () => {
    const k = await kernelPromise
    // A slot profile: two sides and two semicircular ends, with a round hole.
    const outer = [
      { kind: 'line' as const, a: [0, -5, 0] as [number, number, number], b: [30, -5, 0] as [number, number, number] },
      arcPiece([30, 0, 0], [0, 0, 1], [30, -5, 0], [30, 5, 0], Math.PI),
      { kind: 'line' as const, a: [30, 5, 0] as [number, number, number], b: [0, 5, 0] as [number, number, number] },
      arcPiece([0, 0, 0], [0, 0, 1], [0, 5, 0], [0, -5, 0], Math.PI),
    ]
    const hole = [{ kind: 'circle' as const, center: [15, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], radius: 2 }]
    const face = k.face({ outer, holes: [hole] })
    const body = k.extrude(face, [0, 0, 1], -4, 4)
    expect(k.isClosedSolid(body)).toBe(true)
    const area = 30 * 10 + Math.PI * 25 - Math.PI * 4
    expect(k.volume(body)).toBeCloseTo(area * 8, 3)
    const b = k.bounds(body)
    expect(b.min[2]).toBeCloseTo(-4, 6)
    expect(b.max[2]).toBeCloseTo(4, 6)

    // The half-space keeps the side its normal points to: cutting it away
    // leaves the part below x = 15.
    const half = k.halfSpace([15, 0, 0], [1, 0, 0])
    const left = k.cut(body, half)
    expect(k.isClosedSolid(left)).toBe(true)
    expect(k.bounds(left).max[0]).toBeCloseTo(15, 6)
    expect(k.volume(left)).toBeCloseTo((area * 8) / 2, 3)

    const { mesh, info } = parseSTEP(stepBuffer(k.exportStep([left])))
    expect(info.unsound).toBe(false)
    expect(openEdgeCount(mesh.indices!)).toBe(0)
    k.release(face, body, half, left)
  })

  it('revolves a profile into a ring and joins bodies', async () => {
    const k = await kernelPromise
    // A 2 × 2 square 10 mm off the axis, turned about Z: a square-section ring.
    const face = k.face({ outer: rectangleLoop([10, 0, -1], [1, 0, 0], [0, 0, 1], 2, 2), holes: [] })
    const ring = k.revolve(face, [0, 0, 0], [0, 0, 1], 2 * Math.PI)
    expect(k.isClosedSolid(ring)).toBe(true)
    // Pappus: area × path of the centroid.
    expect(k.volume(ring)).toBeCloseTo(4 * 2 * Math.PI * 11, 3)

    const post = k.extrude(k.face({ outer: rectangleLoop([-1, -1, 0], [1, 0, 0], [0, 1, 0], 2, 2), holes: [] }), [0, 0, 1], -3, 3)
    const both = k.fuse(ring, post)
    expect(k.solidCount(both)).toBe(2)
    const joined = k.fuse(ring, k.extrude(k.face({ outer: rectangleLoop([0, -1, -1], [1, 0, 0], [0, 1, 0], 11, 2), holes: [] }), [0, 0, 1], 0, 2))
    expect(k.solidCount(joined)).toBe(1)
    expect(k.isClosedSolid(joined)).toBe(true)
    k.release(face, ring, post, both, joined)
  })

  it('carries a join’s face history through the faces it merges', async () => {
    const k = await kernelPromise
    const disc = (z: number) => k.face({ outer: [{ kind: 'circle', center: [0, 0, z], normal: [0, 0, 1], radius: 5 }], holes: [] })
    // Two blocks end to end become one of six faces; two rods end to end
    // one rod of a single wall. Every face of either result is one the
    // operands had, or one the history says a face of theirs became.
    for (const [a, b, faces] of [
      [k.box([0, 0, 0], [10, 10, 10]), k.box([10, 0, 0], [20, 10, 10]), 6],
      [k.extrude(disc(0), [0, 0, 1], 0, 10), k.extrude(disc(10), [0, 0, 1], 0, 10), 3],
    ] as const) {
      const before = new Set([...k.faceHashes(a), ...k.faceHashes(b)])
      const joined = k.fuseTracked(a, b)
      const after = k.faceHashes(joined.shape)
      expect(after).toHaveLength(faces)
      const made = new Set([...joined.history.values()].flat())
      expect([...made].filter((h) => !after.includes(h))).toEqual([])
      expect(after.filter((h) => !before.has(h) && !made.has(h))).toEqual([])
      k.release(a, b, joined.shape)
    }
  })

  it('tessellates a body with outward normals', async () => {
    const k = await kernelPromise
    const body = k.extrude(k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], 10, 10), holes: [] }), [0, 0, 1], 0, 10)
    const mesh = k.mesh(body as Shape, 0.05)
    expect(mesh.indices.length).toBeGreaterThanOrEqual(36)
    // The kernel meshes face by face — the vertices along an edge are there
    // once per face, each with its own face's normal, which is exactly the
    // sharp shading a CAD body wants. So no weld check here; every vertex
    // normal pointing away from the cube's centre is the test.
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const out =
        (mesh.positions[i] - 5) * mesh.normals[i] +
        (mesh.positions[i + 1] - 5) * mesh.normals[i + 1] +
        (mesh.positions[i + 2] - 5) * mesh.normals[i + 2]
      expect(out).toBeGreaterThan(0)
    }
    k.release(body)
  })

  it('shades a round by its surface, outward on the faces a cut reversed', async () => {
    const k = await kernelPromise
    // A block bored through, its upright corners and the bore's rim rounded
    // at 3: four quarter cylinders, the bore's wall (a face the cut left
    // reversed) and a torus.
    const box = k.box([0, 0, 0], [40, 30, 20])
    const pin = k.extrude(k.face({ outer: [{ kind: 'circle', center: [20, 15, -1], normal: [0, 0, 1], radius: 6 }], holes: [] }), [0, 0, 1], 0, 22)
    const bored = k.cut(box, pin)
    const rounded = k.edges(bored, 0.05).filter((e) => (e.kind === 'line' && Math.abs(e.dir[2]) > 0.99) || (e.kind === 'circle' && e.mid[2] > 19.99))
    const body = k.filletTracked(bored, rounded.map((e) => e.hash), 3).shape
    const mesh = k.mesh(body, 0.0275)
    const kinds = new Map(k.faces(body).map((f) => [f.hash, f.kind]))
    const kindOf: string[] = []
    for (let i = 0; i < mesh.indices.length; i++) kindOf[mesh.indices[i]] = kinds.get(mesh.faceHash![Math.floor(i / 3)])!

    // The true normal at each node of the round faces. The facets' average
    // was up to 2° off on the corners and 3° on the torus.
    const corners = [[3, 3], [37, 3], [37, 27], [3, 27]]
    let worst = 0
    const seen = { cylinder: 0, torus: 0 }
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const [x, y, z] = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]
      const r = Math.hypot(x - 20, y - 15)
      let want: number[] | null = null
      if (kindOf[v] === 'torus') {
        // Away from its spine: a circle of 9 at z 17 about the bore's axis.
        const d = [x - 20 - ((x - 20) / r) * 9, y - 15 - ((y - 15) / r) * 9, z - 17]
        want = d.map((c) => c / Math.hypot(d[0], d[1], d[2]))
      } else if (kindOf[v] === 'cylinder' && Math.abs(r - 6) < 1e-3) {
        want = [(20 - x) / r, (15 - y) / r, 0] // into the bore
      } else if (kindOf[v] === 'cylinder') {
        const [cx, cy] = corners.find(([cx, cy]) => Math.abs(x - cx) <= 3 + 1e-3 && Math.abs(y - cy) <= 3 + 1e-3)!
        const rc = Math.hypot(x - cx, y - cy)
        expect(rc).toBeCloseTo(3, 3)
        want = [(x - cx) / rc, (y - cy) / rc, 0]
      }
      if (!want) continue
      seen[kindOf[v] as 'cylinder' | 'torus']++
      const cos = mesh.normals[v * 3] * want[0] + mesh.normals[v * 3 + 1] * want[1] + mesh.normals[v * 3 + 2] * want[2]
      worst = Math.max(worst, Math.acos(Math.min(1, cos)))
    }
    expect(seen.cylinder).toBeGreaterThan(100)
    expect(seen.torus).toBeGreaterThan(100)
    expect((worst * 180) / Math.PI).toBeLessThan(0.05)
    k.release(box, pin, bored, body)
  })
})
