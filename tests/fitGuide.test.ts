// SPDX-License-Identifier: AGPL-3.0-only
// A fit told what it is after: the side of the surface, its size, its axis,
// a box. A seed on a cup's rim sits between the inside and the outside; a
// seed at a hole's middle snaps to its mouth, between the wall and the face.
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { fitCylinderFromSeed } from '../src/core/fit/fitCylinderFromSeed'
import { fitSphereFromSeed } from '../src/core/fit/fitSphereFromSeed'
import type { MeshGraph } from '../src/core/types'
import { cupMesh, platedHole } from './guideMeshes'

const SETTINGS = { method: 'gaussian', sigma: 3 } as const
type P3 = [number, number, number]

function seedNear(g: MeshGraph, p: P3): number {
  let best = 0
  let bestD = Infinity
  for (let v = 0; v < g.vertexCount; v++) {
    const d = (g.positions[v * 3] - p[0]) ** 2 + (g.positions[v * 3 + 1] - p[1]) ** 2 + (g.positions[v * 3 + 2] - p[2]) ** 2
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  return best
}

describe('a fit told which side', () => {
  const graph = buildMeshGraph({ kind: 'soup', positions: cupMesh(6.5, 10) })
  const seed = seedNear(graph, [8.25, 0, 0])

  it('takes the cup’s inside from a seed on its rim', () => {
    const out = fitSphereFromSeed(graph, [seed], SETTINGS, undefined, { side: 'inside' })
    expect(out.radius).toBeCloseTo(6.5, 1)
  })

  it('and its outside when asked for that', () => {
    const out = fitSphereFromSeed(graph, [seed], SETTINGS, undefined, { side: 'outside' })
    expect(out.radius).toBeCloseTo(10, 1)
  })

  it('takes the size asked for over the other', () => {
    expect(fitSphereFromSeed(graph, [seed], SETTINGS, undefined, { radius: { max: 8 } }).radius).toBeCloseTo(6.5, 1)
    expect(fitSphereFromSeed(graph, [seed], SETTINGS, undefined, { radius: { min: 8 } }).radius).toBeCloseTo(10, 1)
  })

  it('refuses a size nothing there has, naming what it found', () => {
    expect(() => fitSphereFromSeed(graph, [seed], SETTINGS, undefined, { radius: { min: 20, max: 30 } })).toThrow(/radius R20–R30.*Found R/)
  })

  it('keeps the region inside a box', () => {
    const out = fitSphereFromSeed(graph, [seed], SETTINGS, undefined, { side: 'inside', within: { min: [0, -20, -20], max: [20, 20, 1] } })
    expect(out.radius).toBeCloseTo(6.5, 1)
    for (const v of out.region) expect(graph.positions[v * 3]).toBeGreaterThanOrEqual(0)
  })
})

describe('a fit told the axis', () => {
  const graph = buildMeshGraph({ kind: 'soup', positions: platedHole(3, 30, 6) })
  // The hole's middle at the top face: the nearest vertex is on its mouth.
  const seed = seedNear(graph, [0, 0, 3])

  it('finds the bore from its mouth', () => {
    const out = fitCylinderFromSeed(graph, [seed], SETTINGS, undefined, { axis: [0, 0, 1] })
    expect(out.radius).toBeCloseTo(3, 1)
    expect(Math.abs(out.axis[2])).toBeGreaterThan(0.999)
  })

  it('with the side as well', () => {
    const out = fitCylinderFromSeed(graph, [seed], SETTINGS, undefined, { axis: [0, 0, 1], side: 'inside' })
    expect(out.radius).toBeCloseTo(3, 1)
  })

  it('refuses a bore on another axis', () => {
    expect(() => fitCylinderFromSeed(graph, [seed], SETTINGS, undefined, { axis: [1, 0, 0] })).toThrow(/No cylinder there/)
  })
})
