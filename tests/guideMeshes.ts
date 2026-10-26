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

/** A block `side` square with a bore down z from its top face at z = 0:
 *  radius `r1` for `l1`, then radius `r2` for `l2` — a bore stepping wider
 *  below a flange, `offset` moving the wider one's axis along x. With
 *  `plug`, a solid that thick closes the bore at the step instead, capped
 *  flat on both sides, as a wrapped scan leaves a hole it did not see
 *  through. `taper` runs the step as a cone that long down the bore rather
 *  than a flat shoulder — a cast step's draft, which a region grows into.
 *  Radial noise on the bore walls. */
export function steppedBore(o: { r1: number; l1: number; r2: number; l2: number; noise?: number; offset?: number; plug?: number; taper?: number; side?: number }): Float32Array {
  const rand = mulberry32(13)
  const PHI = 144
  const RINGS = 12
  const noise = o.noise ?? 0.004
  const off = o.offset ?? 0
  const plug = o.plug ?? 0
  const half = (o.side ?? 30) / 2
  const z1 = -o.l1
  const z2 = z1 - (plug || (o.taper ?? 0))
  const z3 = z2 - o.l2
  const ang = (j: number) => (j / PHI) * 2 * Math.PI
  const edge = (j: number): [number, number] => {
    const ph = ang(j)
    const rho = half / Math.max(Math.abs(Math.cos(ph)), Math.abs(Math.sin(ph)))
    return [rho * Math.cos(ph), rho * Math.sin(ph)]
  }
  const circle = (cx: number, r: number) => (j: number): [number, number] => [cx + r * Math.cos(ang(j)), r * Math.sin(ang(j))]
  /** Rings from one loop to another at one height. */
  const between = (from: (j: number) => [number, number], to: (j: number) => [number, number], z: number, rings: number): P3[][] =>
    Array.from({ length: rings + 1 }, (_, i) =>
      Array.from({ length: PHI }, (_, j): P3 => {
        const a = from(j), b = to(j)
        return [a[0] + ((b[0] - a[0]) * i) / rings, a[1] + ((b[1] - a[1]) * i) / rings, z]
      }),
    )
  /** A wall down a loop from one height to another, rows `dz` apart. */
  const wall = (loop: (j: number) => [number, number], cx: number, top: number, bottom: number, wobble: boolean): P3[][] => {
    const rows = Math.max(1, Math.round((top - bottom) / 0.25))
    return Array.from({ length: rows + 1 }, (_, i) => {
      const z = top + ((bottom - top) * i) / rows
      const end = i === 0 || i === rows
      return Array.from({ length: PHI }, (_, j): P3 => {
        const [x, y] = loop(j)
        const k = wobble && !end ? 1 + (gaussian(rand) * noise) / Math.hypot(x - cx, y) : 1
        return [cx + (x - cx) * k, y * k, z]
      })
    })
  }
  const upper = circle(0, o.r1)
  const lower = circle(off, o.r2)
  const centre = (cx: number) => () => [cx, 0] as [number, number]
  const tris: number[] = []
  gridSoup(tris, between(upper, edge, 0, RINGS), true, false)
  gridSoup(tris, wall(upper, 0, 0, z1, true), true, false)
  if (plug > 0) {
    gridSoup(tris, between(upper, centre(0), z1, 8), true, true)
    gridSoup(tris, between(lower, centre(off), z2, 8), true, false)
  } else if (o.taper) {
    // Down the cone, the loop moving from the narrow one to the wide one.
    const rows = Math.max(2, Math.round(o.taper / 0.25))
    gridSoup(
      tris,
      Array.from({ length: rows + 1 }, (_, i) =>
        Array.from({ length: PHI }, (_, j): P3 => {
          const a = upper(j), b = lower(j)
          const f = i / rows
          const end = i === 0 || i === rows
          const [x, y] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
          const cx = off * f
          const k = end ? 1 : 1 + (gaussian(rand) * noise) / Math.hypot(x - cx, y)
          return [cx + (x - cx) * k, y * k, z1 + (z2 - z1) * f]
        }),
      ),
      true,
      false,
    )
  } else {
    gridSoup(tris, between(upper, lower, z1, 2), true, true)
  }
  gridSoup(tris, wall(lower, off, z2, z3, true), true, false)
  gridSoup(tris, between(lower, edge, z3, RINGS), true, true)
  gridSoup(tris, wall(edge, 0, 0, z3, false), true, true)
  return Float32Array.from(tris)
}
