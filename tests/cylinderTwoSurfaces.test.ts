// SPDX-License-Identifier: AGPL-3.0-only
// One cylinder or two: an opening whose upper half is a cylinder tilted 22°
// and whose lower half stands vertical fits as one cylinder leaning between
// them, its σ saying neither. The region read as two cylinders names the
// half the seed is not on — its share, its band along the axis, the angle
// between the axes and how far each half's normals lean. A plain cylinder,
// and a drafted one (a cone), are one surface.

import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { fitCylinderOnSelection } from '../src/core/fit/fitCylinderFromSeed'
import { planeRegionReport, secondCylinder, wallTaper } from '../src/core/fit/segment'
import type { Vec3 } from '../src/core/types'

const R = 40
const SETTINGS = { method: 'gaussian', sigma: 3 } as const

/** A band of a cylinder of radius r about `axis` through `base`, `length`
 *  long, its radius growing by `flare` per mm along it, as a triangle grid
 *  with a little radial noise. */
function band(base: Vec3, axis: Vec3, length: number, out: number[], seed: number, flare = 0, r = R) {
  const l = Math.hypot(...axis)
  const a: Vec3 = [axis[0] / l, axis[1] / l, axis[2] / l]
  const h: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u0: Vec3 = [a[1] * h[2] - a[2] * h[1], a[2] * h[0] - a[0] * h[2], a[0] * h[1] - a[1] * h[0]]
  const ul = Math.hypot(...u0)
  const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul]
  const v: Vec3 = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]]
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  const NU = 240, NV = Math.round(length / 0.5)
  const grid: Vec3[][] = []
  for (let i = 0; i <= NV; i++) {
    const row: Vec3[] = []
    const t = (length * i) / NV
    for (let k = 0; k < NU; k++) {
      const q = (2 * Math.PI * k) / NU
      const rr = r + flare * t + 0.02 * rnd()
      row.push([0, 1, 2].map((d) => base[d] + t * a[d] + rr * (Math.cos(q) * u[d] + Math.sin(q) * v[d])) as Vec3)
    }
    grid.push(row)
  }
  for (let i = 0; i < NV; i++)
    for (let k = 0; k < NU; k++) {
      const k2 = (k + 1) % NU
      out.push(...grid[i][k], ...grid[i][k2], ...grid[i + 1][k2], ...grid[i][k], ...grid[i + 1][k2], ...grid[i + 1][k])
    }
}

function graphOf(build: (out: number[]) => void) {
  const out: number[] = []
  build(out)
  const graph = buildMeshGraph({ kind: 'soup', positions: Float32Array.from(out) })
  const all = new Uint32Array(graph.vertexCount)
  for (let i = 0; i < all.length; i++) all[i] = i
  return { graph, all }
}

const nearest = (g: ReturnType<typeof graphOf>['graph'], p: Vec3) => {
  let best = 0, bestD = Infinity
  for (let i = 0; i < g.vertexCount; i++) {
    const d = (g.positions[i * 3] - p[0]) ** 2 + (g.positions[i * 3 + 1] - p[1]) ** 2 + (g.positions[i * 3 + 2] - p[2]) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

describe('a cylinder that is two', () => {
  it('warns of the tilted half, with its share, band and lean', () => {
    const tilt = (22 * Math.PI) / 180
    const { graph, all } = graphOf((out) => {
      band([0, 0, 0], [0, 0, 1], 20, out, 3)
      band([0, 0, 20], [0, Math.sin(tilt), Math.cos(tilt)], 20, out, 5)
    })
    const fit = fitCylinderOnSelection(graph, all, SETTINGS)
    // The seed on the vertical half, low down.
    const seed = nearest(graph, [R, 0, 3])
    const two = secondCylinder(graph, all, { center: fit.center, axis: fit.axis, radius: fit.radius, seed })!
    expect(two).not.toBeNull()
    expect(two.share).toBeGreaterThan(0.4)
    expect(two.share).toBeLessThan(0.6)
    expect(two.angleDeg).toBeGreaterThan(21)
    expect(two.angleDeg).toBeLessThan(23)
    expect(Math.abs(two.radius - R)).toBeLessThan(0.2)
    expect(Math.abs(two.radiusSecond - R)).toBeLessThan(0.2)
    // The second is the tilted half: up the axis, above the centre.
    const up = Math.sign(fit.axis[2])
    expect(up * (two.band[0] + two.band[1]) / 2).toBeGreaterThan(2)
    expect(two.centroid[2]).toBeGreaterThan(20)
    // Its normals lean off square to the one axis more than the seed half's.
    expect(two.leanDeg[1]).toBeGreaterThan(two.leanDeg[0])
    // As the region report has it.
    const report = planeRegionReport(graph, all, undefined, { center: fit.center, axis: fit.axis, radius: fit.radius, seed })
    expect(report.secondCylinder?.share).toBeCloseTo(two.share, 6)
  })

  it('reads a plain cylinder, and a drafted one, as one surface', () => {
    const plain = graphOf((out) => band([0, 0, 0], [0, 0, 1], 40, out, 7))
    const f1 = fitCylinderOnSelection(plain.graph, plain.all, SETTINGS)
    expect(secondCylinder(plain.graph, plain.all, { center: f1.center, axis: f1.axis, radius: f1.radius })).toBeNull()
    // 1° of draft: the radius grows 0.7 mm over the 40.
    const cone = graphOf((out) => band([0, 0, 0], [0, 0, 1], 40, out, 9, Math.tan(Math.PI / 180)))
    const f2 = fitCylinderOnSelection(cone.graph, cone.all, SETTINGS)
    expect(secondCylinder(cone.graph, cone.all, { center: f2.center, axis: f2.axis, radius: f2.radius })).toBeNull()
  })

  // A casting's ring: 3° down and 3° up from a parting line at z 14, as a
  // triple clamp's rings stand. A cylinder fit reads it as two cylinders; what
  // it is has to be said.
  const draft = Math.tan((3 * Math.PI) / 180)
  const doubleCone = (way: 1 | -1) =>
    graphOf((out) => {
      band([0, 0, 0], [0, 0, 1], 14, out, 11, way * draft, 22 - way * 14 * draft)
      band([0, 0, 14], [0, 0, 1], 14, out, 13, -way * draft, 22)
    })
  const taperOf = ({ graph, all }: ReturnType<typeof graphOf>) => {
    const fit = fitCylinderOnSelection(graph, all, SETTINGS)
    return wallTaper(graph.positions, graph.normals, all, fit.center, fit.axis)
  }

  it('names a double cone, its parting line and each part’s draft', () => {
    const taper = taperOf(doubleCone(1))!
    expect(taper.double).toBe(true)
    expect(taper.parts).toHaveLength(2)
    for (const part of taper.parts) expect(Math.abs(Math.abs(part.draftDeg) - 3)).toBeLessThan(0.4)
    expect(Math.abs(taper.parting!.at[2] - 14)).toBeLessThan(1)
    expect(Math.abs(taper.parting!.radius - 22)).toBeLessThan(0.2)
    // The boxes keep to their sides of the line, for a fit to take as within.
    const [a, b] = [...taper.parts].sort((x, y) => x.min[2] - y.min[2])
    expect(a.max[2]).toBeLessThan(15.5)
    expect(b.min[2]).toBeGreaterThan(12.5)
  })

  it('tells a wall waisted at its parting line from one standing proud', () => {
    const proud = taperOf(doubleCone(1))!
    const waisted = taperOf(doubleCone(-1))!
    expect(waisted.double).toBe(true)
    expect(Math.sign(waisted.parts[0].draftDeg)).toBe(-Math.sign(proud.parts[0].draftDeg))
  })

  it('reads a single taper on part of a turn, where the fit leans to take it up', () => {
    // A third of the turn of a 3° cone: a cylinder fits it closely, tilted.
    const out: number[] = []
    band([0, 0, 0], [0, 0, 1], 12, out, 17, draft, 22)
    const kept: number[] = []
    for (let i = 0; i < out.length; i += 9) if (out[i] > 11 && out[i + 3] > 11 && out[i + 6] > 11) kept.push(...out.slice(i, i + 9))
    const graph = buildMeshGraph({ kind: 'soup', positions: Float32Array.from(kept) })
    const all = Uint32Array.from({ length: graph.vertexCount }, (_, i) => i)
    const fit = fitCylinderOnSelection(graph, all, SETTINGS)
    const taper = wallTaper(graph.positions, graph.normals, all, fit.center, fit.axis)!
    expect(taper.parts).toHaveLength(1)
    expect(taper.double).toBe(false)
    expect(Math.abs(Math.abs(taper.parts[0].draftDeg) - 3)).toBeLessThan(0.4)
    expect(Math.abs(taper.axis[2])).toBe(1)
  })

  it('reads a plain cylinder as standing square, and two tilted ones as no taper', () => {
    expect(taperOf(graphOf((out) => band([0, 0, 0], [0, 0, 1], 40, out, 7)))).toBeNull()
    const tilt = (22 * Math.PI) / 180
    const twoTilted = graphOf((out) => {
      band([0, 0, 0], [0, 0, 1], 20, out, 3)
      band([0, 0, 20], [0, Math.sin(tilt), Math.cos(tilt)], 20, out, 5)
    })
    expect(taperOf(twoTilted)).toBeNull()
  })
})
