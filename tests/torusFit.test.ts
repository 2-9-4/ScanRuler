// SPDX-License-Identifier: AGPL-3.0-only
// The torus fit: the residual, the spine-through-shifted-points candidate,
// the geometric refinement, the robust estimate on a patch, and the
// seed-to-torus pipeline on a mesh — a whole ring and a fillet's quarter
// round with flats either side, which is what the fit is for.
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { fitTorusFromSeed, fitTorusOnSelection } from '../src/core/fit/fitTorusFromSeed'
import { mulberry32 } from '../src/core/fit/ransac'
import { fitTorusClipped, ransacTorus, refineTorusGeometric, torusFromShift, torusResidual } from '../src/core/fit/torus'
import type { Torus, Vec3 } from '../src/core/types'
import { gaussian, unit } from './helpers'

const SETTINGS = { method: 'gaussian', sigma: 3 } as const

function basis(d: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = unit([d[1] * helper[2] - d[2] * helper[1], d[2] * helper[0] - d[0] * helper[2], d[0] * helper[1] - d[1] * helper[0]])
  const v = unit([d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]])
  return [u, v]
}

/** Points on a torus with exact outward normals, over a stretch of the
 *  spine (`spineArc`) and of the tube (`tubeFrom`…`tubeTo`), noisy along
 *  the normal. */
function sampleTorus(n: number, t: Torus, noise: number, spineArc = 2 * Math.PI, tubeFrom = -Math.PI, tubeTo = Math.PI, seed = 5): { positions: Float32Array; normals: Float32Array } {
  const rand = mulberry32(seed)
  const d = unit([t.ax, t.ay, t.az])
  const [u, v] = basis(d)
  const positions = new Float32Array(n * 3)
  const normals = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const a = (rand() - 0.5) * spineArc
    const b = tubeFrom + rand() * (tubeTo - tubeFrom)
    const rx = Math.cos(a) * u[0] + Math.sin(a) * v[0]
    const ry = Math.cos(a) * u[1] + Math.sin(a) * v[1]
    const rz = Math.cos(a) * u[2] + Math.sin(a) * v[2]
    const nx = Math.cos(b) * rx + Math.sin(b) * d[0]
    const ny = Math.cos(b) * ry + Math.sin(b) * d[1]
    const nz = Math.cos(b) * rz + Math.sin(b) * d[2]
    const h = t.r + gaussian(rand) * noise
    positions[i * 3] = t.cx + t.R * rx + h * nx
    positions[i * 3 + 1] = t.cy + t.R * ry + h * ny
    positions[i * 3 + 2] = t.cz + t.R * rz + h * nz
    normals[i * 3] = nx
    normals[i * 3 + 1] = ny
    normals[i * 3 + 2] = nz
  }
  return { positions, normals }
}

const all = (n: number) => {
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  return idx
}

// Off-axis on purpose, and off the origin.
const TRUE: Torus = { cx: 3, cy: -2, cz: 5, ...(() => { const d = unit([0.3, 0.5, 0.8]); return { ax: d[0], ay: d[1], az: d[2] } })(), R: 20, r: 4 }

function agrees(t: Torus, truth: Torus, tol: number): void {
  expect(Math.abs(t.R - truth.R)).toBeLessThan(tol)
  expect(Math.abs(t.r - truth.r)).toBeLessThan(tol)
  expect(Math.abs(Math.abs(t.ax * truth.ax + t.ay * truth.ay + t.az * truth.az) - 1)).toBeLessThan(1e-4)
  expect(Math.hypot(t.cx - truth.cx, t.cy - truth.cy, t.cz - truth.cz)).toBeLessThan(tol)
}

describe('the torus fit', () => {
  it('reads a signed distance, and a spine through the shifted points recovers the torus exactly', () => {
    const { positions, normals } = sampleTorus(600, TRUE, 0)
    for (let i = 0; i < 20; i++) expect(Math.abs(torusResidual(TRUE, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))).toBeLessThan(1e-4)
    // A point a millimetre out along the normal reads +1.
    const p: Vec3 = [positions[0] + normals[0], positions[1] + normals[1], positions[2] + normals[2]]
    expect(torusResidual(TRUE, p[0], p[1], p[2])).toBeCloseTo(1, 3)
    const t = torusFromShift(positions, normals, all(600), TRUE.r)!
    agrees(t, TRUE, 1e-3)
    // The wrong shift is not the torus: the residual says so.
    const wrong = torusFromShift(positions, normals, all(600), TRUE.r * 2)!
    let worst = 0
    for (let i = 0; i < 600; i++) worst = Math.max(worst, Math.abs(torusResidual(wrong, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])))
    expect(worst).toBeGreaterThan(1)
  })

  it('refines a rough start to the noise on a whole ring, and the robust estimate needs no start', () => {
    const { positions, normals } = sampleTorus(4000, TRUE, 0.02)
    const rough: Torus = { ...TRUE, cx: TRUE.cx + 0.5, R: TRUE.R * 1.05, r: TRUE.r * 0.9, ...(() => { const d = unit([TRUE.ax + 0.05, TRUE.ay - 0.04, TRUE.az]); return { ax: d[0], ay: d[1], az: d[2] } })() }
    const refined = refineTorusGeometric(positions, all(4000), rough)
    agrees(refined, TRUE, 0.01)
    const clipped = fitTorusClipped(positions, all(4000), 3, rough)!
    expect(clipped.sigma).toBeLessThan(0.025)
    agrees(clipped.torus, TRUE, 0.01)
    const robust = ransacTorus(positions, normals, all(4000), { seed: 3 })!
    agrees(robust.torus, TRUE, 0.02)
  })

  it('finds a fillet’s quarter round from a stretch of it — a concave one too', () => {
    // A quarter of the tube over a sixth of the spine: a fillet on the
    // edge of a round boss.
    const { positions, normals } = sampleTorus(3000, TRUE, 0.01, Math.PI / 3, 0, Math.PI / 2)
    const robust = ransacTorus(positions, normals, all(3000), { seed: 9 })!
    agrees(robust.torus, TRUE, 0.05)
    // The same round scanned from inside: the normals point into the tube.
    const inward = new Float32Array(normals.length)
    for (let i = 0; i < normals.length; i++) inward[i] = -normals[i]
    const concave = ransacTorus(positions, inward, all(3000), { seed: 9 })!
    agrees(concave.torus, TRUE, 0.05)
  })
})

/** A mesh of a ring with a flat either side of its round — a fillet between
 *  two faces, as a scan of a boss's edge has it — as a triangle grid. */
function filletMesh(R: number, r: number, radial = 120, tube = 16): Float32Array {
  const tris: number[] = []
  const ring = (a: number, b: number): [number, number, number] => {
    // A quarter tube from the top flat (b = 0, pointing up) to the side
    // (b = π/2, pointing out), plus flats beyond either end.
    const rho = R + r * Math.sin(b)
    const z = r * Math.cos(b)
    return [rho * Math.cos(a), rho * Math.sin(a), z]
  }
  const rows: [number, number, number][][] = []
  for (let j = -6; j <= tube + 6; j++) {
    const row: [number, number, number][] = []
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * 2 * Math.PI
      if (j < 0) row.push([(R - (0 - j) * (r / 4)) * Math.cos(a), (R - (0 - j) * (r / 4)) * Math.sin(a), r])
      else if (j > tube) row.push([(R + r) * Math.cos(a), (R + r) * Math.sin(a), -(j - tube) * (r / 4)])
      else row.push(ring(a, (Math.PI / 2) * (j / tube)))
    }
    rows.push(row)
  }
  for (let j = 0; j + 1 < rows.length; j++) {
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial
      const a = rows[j][k], b = rows[j][k2], c = rows[j + 1][k2], d = rows[j + 1][k]
      tris.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
  return Float32Array.from(tris)
}

describe('seed-to-torus pipeline on a fillet mesh', () => {
  const R = 25, r = 3
  const graph = buildMeshGraph({ kind: 'soup', positions: filletMesh(R, r) })
  const seedNear = (x: number, y: number, z: number) => {
    let best = 0, bestD = Infinity
    for (let v = 0; v < graph.vertexCount; v++) {
      const d = (graph.positions[v * 3] - x) ** 2 + (graph.positions[v * 3 + 1] - y) ** 2 + (graph.positions[v * 3 + 2] - z) ** 2
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    return best
  }

  it('grows round the ring from a click on the round and stops at the flats', () => {
    const mid = Math.PI / 4
    const seed = seedNear((R + r * Math.sin(mid)) * Math.cos(0.3), (R + r * Math.sin(mid)) * Math.sin(0.3), r * Math.cos(mid))
    const out = fitTorusFromSeed(graph, [seed], SETTINGS)
    expect(Math.abs(out.majorRadius - R)).toBeLessThan(0.05)
    expect(Math.abs(out.minorRadius - r)).toBeLessThan(0.05)
    expect(Math.abs(out.axis[2])).toBeGreaterThan(0.9999)
    expect(Math.hypot(out.center[0], out.center[1], out.center[2])).toBeLessThan(0.05)
    expect(out.sigma).toBeLessThan(0.01)
    expect(out.spineCoverage).toBeGreaterThan(350)
    // A quarter of the tube, and no flat in the region.
    expect(out.tubeCoverage).toBeLessThan(120)
    expect(out.tubeCoverage).toBeGreaterThan(60)
    for (const v of out.region) expect(Math.abs(Math.hypot(graph.positions[v * 3], graph.positions[v * 3 + 1]) - R) <= r + 0.05 && graph.positions[v * 3 + 2] <= r + 0.05).toBe(true)
    // A marked selection of the same round gives the same torus.
    const sel = fitTorusOnSelection(graph, out.region, SETTINGS)
    expect(Math.abs(sel.minorRadius - r)).toBeLessThan(0.05)
  })

  it('fails on the flat instead of inventing a round', () => {
    const seed = seedNear((R - r) * Math.cos(1), (R - r) * Math.sin(1), r)
    expect(() => fitTorusFromSeed(graph, [seed], SETTINGS)).toThrow(/torus/i)
  })
})

/** A patch of a large torus's outer side as a triangle grid: `spineDeg` of
 *  the spine, `tubeDeg` of the tube about its outermost line — a shroud or a
 *  bowed panel, whose spine lies far outside the part. */
function torusPatchMesh(R: number, r: number, spineDeg: number, tubeDeg: number, nu = 140, nv = 60): Float32Array {
  const at = (a: number, b: number): [number, number, number] => [(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)]
  const tris: number[] = []
  const A = (spineDeg * Math.PI) / 180, B = (tubeDeg * Math.PI) / 180
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a0 = -A / 2 + (A * i) / nu, a1 = -A / 2 + (A * (i + 1)) / nu
      const b0 = -B / 2 + (B * j) / nv, b1 = -B / 2 + (B * (j + 1)) / nv
      const p = at(a0, b0), q = at(a1, b0), s = at(a1, b1), t = at(a0, b1)
      tris.push(...p, ...q, ...s, ...p, ...s, ...t)
    }
  }
  return Float32Array.from(tris)
}

describe('a large torus', () => {
  it('fits a shroud whose spine lies well past the part — R600 / r75 on a part a fraction of that across', () => {
    const graph = buildMeshGraph({ kind: 'soup', positions: torusPatchMesh(600, 75, 40, 120) })
    // R is past the old limit of 0.8 × the scan's diagonal.
    expect(600).toBeGreaterThan(0.8 * graph.bboxDiag)
    let seed = 0, bestD = Infinity
    for (let v = 0; v < graph.vertexCount; v++) {
      const d = (graph.positions[v * 3] - 675) ** 2 + graph.positions[v * 3 + 1] ** 2 + graph.positions[v * 3 + 2] ** 2
      if (d < bestD) {
        bestD = d
        seed = v
      }
    }
    const out = fitTorusFromSeed(graph, [seed], SETTINGS)
    expect(Math.abs(out.majorRadius - 600)).toBeLessThan(1)
    expect(Math.abs(out.minorRadius - 75)).toBeLessThan(0.5)
    expect(Math.abs(out.axis[2])).toBeGreaterThan(0.999)
  })

  it('names the limit when the spine lies too far out', () => {
    // A small patch of the same torus: R600 is past 5 × its diagonal.
    const graph = buildMeshGraph({ kind: 'soup', positions: torusPatchMesh(600, 75, 6, 40, 60, 40) })
    expect(600).toBeGreaterThan(5 * graph.bboxDiag)
    const all = new Uint32Array(graph.vertexCount)
    for (let v = 0; v < all.length; v++) all[v] = v
    expect(() => fitTorusOnSelection(graph, all, SETTINGS)).toThrow(/limit of 5 × the scan's diagonal/)
  })
})
