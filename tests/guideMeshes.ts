// SPDX-License-Identifier: AGPL-3.0-only
// Meshes for the guided fits: a hollow cup, a plate with a hole.
import { mulberry32 } from '../src/core/fit/ransac'
import { gaussian } from './helpers'

type P3 = [number, number, number]

/** A grid of points as a triangle soup, each quad split in two; `flip`
 *  reverses the winding. */
function gridSoup(out: number[], grid: P3[][], wrap: boolean, flip: boolean): void {
  for (let i = 0; i + 1 < grid.length; i++) {
    const n = grid[i].length
    for (let j = 0; j < (wrap ? n : n - 1); j++) {
      const j2 = (j + 1) % n
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j2], d = grid[i][j2]
      if (flip) out.push(...a, ...c, ...b, ...a, ...d, ...c)
      else out.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
}

/** A hollow hemispherical cup, open at the top: outside R `outer`, inside R
 *  `inner`, a flat rim at z = 0 between them. */
export function cupMesh(inner: number, outer: number, noise = 0.004): Float32Array {
  const rand = mulberry32(5)
  const PHI = 72
  const TH = 28
  const jitter = (r: number, rim: boolean) => (rim ? r : r + gaussian(rand) * noise)
  const shell = (R: number): P3[][] => {
    const rows: P3[][] = []
    for (let i = 0; i <= TH; i++) {
      const th = (i / TH) * (Math.PI / 2)
      const row: P3[] = []
      for (let j = 0; j < PHI; j++) {
        const ph = (j / PHI) * 2 * Math.PI
        const r = jitter(R, i === TH)
        row.push([r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), i === TH ? 0 : -r * Math.cos(th)])
      }
      rows.push(row)
    }
    return rows
  }
  const tris: number[] = []
  gridSoup(tris, shell(outer), true, true)
  gridSoup(tris, shell(inner), true, false)
  const rim: P3[][] = []
  for (let i = 0; i <= 6; i++) {
    const rho = inner + ((outer - inner) * i) / 6
    rim.push(Array.from({ length: PHI }, (_, j): P3 => [rho * Math.cos((j / PHI) * 2 * Math.PI), rho * Math.sin((j / PHI) * 2 * Math.PI), 0]))
  }
  gridSoup(tris, rim, true, false)
  return Float32Array.from(tris)
}

/** A square plate, side `side`, `t` thick about z = 0, with a round hole of
 *  radius `r` through its middle along z. */
export function platedHole(r: number, side: number, t: number, noise = 0.004): Float32Array {
  const rand = mulberry32(9)
  const PHI = 64
  const RINGS = 10
  const half = side / 2
  const edge = (ph: number) => half / Math.max(Math.abs(Math.cos(ph)), Math.abs(Math.sin(ph)))
  const face = (z: number): P3[][] => {
    const rows: P3[][] = []
    for (let i = 0; i <= RINGS; i++) {
      rows.push(
        Array.from({ length: PHI }, (_, j): P3 => {
          const ph = (j / PHI) * 2 * Math.PI
          const rho = r + ((edge(ph) - r) * i) / RINGS
          return [rho * Math.cos(ph), rho * Math.sin(ph), z]
        }),
      )
    }
    return rows
  }
  const wall = (rad: (ph: number) => number, wobble: boolean): P3[][] => {
    const rows: P3[][] = []
    const STEPS = 8
    for (let i = 0; i <= STEPS; i++) {
      const z = -t / 2 + (t * i) / STEPS
      const end = i === 0 || i === STEPS
      rows.push(
        Array.from({ length: PHI }, (_, j): P3 => {
          const ph = (j / PHI) * 2 * Math.PI
          const rho = rad(ph) + (wobble && !end ? gaussian(rand) * noise : 0)
          return [rho * Math.cos(ph), rho * Math.sin(ph), z]
        }),
      )
    }
    return rows
  }
  const tris: number[] = []
  gridSoup(tris, face(t / 2), true, false)
  gridSoup(tris, face(-t / 2), true, true)
  gridSoup(tris, wall(() => r, true), true, false)
  gridSoup(tris, wall(edge, false), true, true)
  return Float32Array.from(tris)
}
