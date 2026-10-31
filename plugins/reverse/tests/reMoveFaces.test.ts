// SPDX-License-Identifier: AGPL-3.0-only
// Several faces of a body moved by one offset, in the kernel: a cylinder
// made longer and wider at once — what a cylinder fitted into a bore that
// the scanner could not see the bottom of is made into before it is cut
// out of the scan — and a box grown and shrunk on every side, the edges as
// sharp as they were.

import { describe, expect, it } from 'vitest'
import { ReKernel, rectangleLoop, type Shape } from '../core/kernel'

const kernelPromise = ReKernel.load()

async function cylinder(r: number, length: number): Promise<{ k: ReKernel; body: Shape }> {
  const k = await kernelPromise
  const disc = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: r }], holes: [] })
  const body = k.extrude(disc, [0, 0, 1], 0, length)
  k.release(disc)
  return { k, body }
}

async function box(w: number, d: number, h: number): Promise<{ k: ReKernel; body: Shape }> {
  const k = await kernelPromise
  const face = k.face({ outer: rectangleLoop([0, 0, 0], [1, 0, 0], [0, 1, 0], w, d), holes: [] })
  const body = k.extrude(face, [0, 0, 1], 0, h)
  k.release(face)
  return { k, body }
}

describe('moving several faces of a body', () => {
  it('makes a cylinder longer and wider at once, wall and both ends together', async () => {
    const { k, body } = await cylinder(4, 10)
    const all = k.faces(body).map((f) => f.hash)
    expect(all.length).toBe(3)
    const grown = k.offsetFacesTracked(body, all, 0.5)
    expect(k.isClosedSolid(grown.shape)).toBe(true)
    expect(k.volume(grown.shape)).toBeCloseTo(Math.PI * 4.5 ** 2 * 11, 3)
    expect(k.faceCount(grown.shape)).toBe(3)
    const b = k.bounds(grown.shape)
    expect(b.min[2]).toBeCloseTo(-0.5, 6)
    expect(b.max[2]).toBeCloseTo(10.5, 6)
    const shrunk = k.offsetFacesTracked(body, all, -1)
    expect(k.volume(shrunk.shape)).toBeCloseTo(Math.PI * 3 ** 2 * 8, 3)
    expect(k.faceCount(shrunk.shape)).toBe(3)
    k.release(body, grown.shape, shrunk.shape)
  })

  it('takes the faces in any order — the ends first, the wall last', async () => {
    const { k, body } = await cylinder(4, 10)
    const faces = k.faces(body)
    const order = [...faces.filter((f) => f.kind === 'plane'), ...faces.filter((f) => f.kind === 'cylinder')].map((f) => f.hash)
    const grown = k.offsetFacesTracked(body, order, 0.5)
    expect(k.volume(grown.shape)).toBeCloseTo(Math.PI * 4.5 ** 2 * 11, 3)
    expect(k.faceCount(grown.shape)).toBe(3)
    k.release(body, grown.shape)
  })

  it('lengthens a cylinder by one end alone, and grows a box on every side', async () => {
    const { k, body } = await cylinder(4, 10)
    const top = k.faces(body).find((f) => f.kind === 'plane' && f.dir[2] > 0.9)!
    const longer = k.offsetFacesTracked(body, [top.hash], 15)
    expect(k.volume(longer.shape)).toBeCloseTo(Math.PI * 16 * 25, 3)
    k.release(body, longer.shape)

    const cube = await box(40, 20, 10)
    const sides = cube.k.faces(cube.body).map((f) => f.hash)
    const big = cube.k.offsetFacesTracked(cube.body, sides, 1)
    expect(cube.k.volume(big.shape)).toBeCloseTo(42 * 22 * 12, 3)
    expect(cube.k.faceCount(big.shape)).toBe(6)
    const small = cube.k.offsetFacesTracked(cube.body, sides, -2)
    expect(cube.k.volume(small.shape)).toBeCloseTo(36 * 16 * 6, 3)
    expect(cube.k.faceCount(small.shape)).toBe(6)
    cube.k.release(cube.body, big.shape, small.shape)
  })

  it('bores out two holes of a plate together, and refuses a round face that is not a whole cylinder', async () => {
    const { k, body: plate } = await box(40, 20, 10)
    let body = plate
    for (const x of [10, 30]) {
      const disc = k.face({ outer: [{ kind: 'circle', center: [x, 10, 0], normal: [0, 0, 1], radius: 3 }], holes: [] })
      const pin = k.extrude(disc, [0, 0, 1], -1, 11)
      const cut = k.cut(body, pin)
      k.release(disc, pin, body)
      body = cut
    }
    const holed = 40 * 20 * 10 - 2 * Math.PI * 9 * 10
    expect(k.volume(body)).toBeCloseTo(holed, 3)
    const bores = k.faces(body).filter((f) => f.kind === 'cylinder').map((f) => f.hash)
    expect(bores.length).toBe(2)
    const bored = k.offsetFacesTracked(body, bores, 0.5)
    expect(k.volume(bored.shape)).toBeCloseTo(holed - 2 * Math.PI * (3.5 ** 2 - 9) * 10, 3)
    k.release(bored.shape)

    // A round on an edge is a quarter of a cylinder: it has no radius of
    // its own to change.
    const edge = k.edges(body, 1).find((e) => e.kind === 'line' && Math.abs(e.dir[0]) > 0.9)!
    const rounded = k.filletTracked(body, [edge.hash], 2)
    const quarter = k.faces(rounded.shape).find((f) => f.kind === 'cylinder' && Math.abs((f.radius ?? 0) - 2) < 1e-6)!
    const top = k.faces(rounded.shape).find((f) => f.kind === 'plane' && f.dir[2] > 0.9)!
    expect(() => k.offsetFacesTracked(rounded.shape, [top.hash, quarter.hash], 0.5)).toThrow(/whole way round/)
    k.release(body, rounded.shape)
  })

  it('keeps a tilted cylinder three faces through move after move — no ring left on an end, no seam round the wall', async () => {
    // A fitted cylinder's axis is never a coordinate axis. Its wall pushed
    // out twice used to leave a sliver of the old wall and a circle on the
    // end; an end pushed out, a seam round the wall where the end had been.
    const k = await kernelPromise
    const n: [number, number, number] = [0.3007679386167831, 0.20051195907785532, 0.9323806097120273]
    const disc = k.face({ outer: [{ kind: 'circle', center: [1, 2, 3], normal: n, radius: 5.7 }], holes: [] })
    let body = k.extrude(disc, n, -2, 9)
    k.release(disc)
    let r = 5.7
    let length = 11
    const along = (f: { dir: readonly number[] }) => f.dir[0] * n[0] + f.dir[1] * n[1] + f.dir[2] * n[2]
    const moves: ['wall' | 'top' | 'bottom', number][] = [['wall', 1.3], ['wall', 0.7], ['top', 0.6], ['bottom', 0.9], ['wall', -0.4], ['bottom', -0.3]]
    for (const [which, offset] of moves) {
      const faces = k.faces(body)
      const face = which === 'wall' ? faces.find((f) => f.kind === 'cylinder')! : faces.find((f) => f.kind === 'plane' && (which === 'top' ? along(f) > 0 : along(f) < 0))!
      const moved = k.offsetFacesTracked(body, [face.hash], offset)
      k.release(body)
      body = moved.shape
      if (which === 'wall') r += offset
      else length += offset
      expect(k.faceCount(body), `${which} ${offset}`).toBe(3)
      expect(k.volume(body)).toBeCloseTo(Math.PI * r * r * length, 4)
    }
    k.release(body)
  })
})
