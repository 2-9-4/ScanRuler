// SPDX-License-Identifier: AGPL-3.0-only
// A height map read further: the relief left when the surface round each
// cell is taken off it — icons, grooves, embossed lettering standing out of
// a face that curves or leans — and the heights it holds gathered into levels, a
// pad's tiers or a pocket's floors, each with how much of the map it covers.
// A grid here is row by row, row 0 at the low v, NaN where there is nothing.

/** The grid's sums under a separable kernel, one along u and one along v:
 *  Σ ku(i)·kv(j)·values over the cells round each, with the empty cells
 *  counting nothing. */
function convolve(values: Float64Array, cols: number, rows: number, ku: Float64Array, kv: Float64Array): Float64Array {
  const reach = (ku.length - 1) / 2
  const along = new Float64Array(values.length)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let s = 0
      for (let i = Math.max(-reach, -c); i <= Math.min(reach, cols - 1 - c); i++) s += ku[i + reach] * values[r * cols + c + i]
      along[r * cols + c] = s
    }
  }
  const out = new Float64Array(values.length)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let s = 0
      for (let j = Math.max(-reach, -r); j <= Math.min(reach, rows - 1 - r); j++) s += kv[j + reach] * along[(r + j) * cols + c]
      out[r * cols + c] = s
    }
  }
  return out
}

/** The height less the surface round it: at each cell a plane fitted to
 *  its neighbours by least squares, each weighed by a Gaussian of `sigma`
 *  cells, the empty ones left out — so what stands proud of the surface
 *  (positive) or sinks into it (negative) at about that width stands out,
 *  and a lean, even at the edge of what was hit, leaves nothing. Where the
 *  neighbours give no plane (a line of cells, a cell alone) their mean
 *  stands in for it. */
export function reliefGrid(values: Float32Array, cols: number, rows: number, sigma: number): Float32Array {
  const reach = Math.max(1, Math.ceil(3 * sigma))
  const k0 = new Float64Array(2 * reach + 1)
  const k1 = new Float64Array(2 * reach + 1)
  const k2 = new Float64Array(2 * reach + 1)
  for (let i = -reach; i <= reach; i++) {
    const g = Math.exp(-(i * i) / (2 * sigma * sigma))
    k0[i + reach] = g
    k1[i + reach] = i * g
    k2[i + reach] = i * i * g
  }
  const n = cols * rows
  const mask = new Float64Array(n)
  const h = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(values[i])) continue
    mask[i] = 1
    h[i] = values[i]
  }
  // The weighed moments of the neighbours' places (x along u, y along v,
  // in cells from the one fitted) and of their heights.
  const s00 = convolve(mask, cols, rows, k0, k0)
  const s10 = convolve(mask, cols, rows, k1, k0)
  const s01 = convolve(mask, cols, rows, k0, k1)
  const s20 = convolve(mask, cols, rows, k2, k0)
  const s11 = convolve(mask, cols, rows, k1, k1)
  const s02 = convolve(mask, cols, rows, k0, k2)
  const h00 = convolve(h, cols, rows, k0, k0)
  const h10 = convolve(h, cols, rows, k1, k0)
  const h01 = convolve(h, cols, rows, k0, k1)
  const out = new Float32Array(n).fill(Number.NaN)
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    // [s00 s10 s01; s10 s20 s11; s01 s11 s02]·[a, b, c] = [h00, h10, h01],
    // a the fitted plane's height at the cell — by Cramer's rule.
    const A = s00[i], B = s10[i], C = s01[i], D = s20[i], E = s11[i], F = s02[i]
    const det = A * (D * F - E * E) - B * (B * F - E * C) + C * (B * E - D * C)
    const scale = A * D * F
    const a =
      scale > 0 && Math.abs(det) > 1e-9 * scale
        ? (h00[i] * (D * F - E * E) - B * (h10[i] * F - E * h01[i]) + C * (h10[i] * E - D * h01[i])) / det
        : h00[i] / A
    out[i] = values[i] - a
  }
  return out
}

/** How much a cell's value wanders from its neighbour's on the same
 *  surface, mm: the median step between cells side by side, as a standard
 *  deviation (×1.4826 for a median, ÷√2 for a difference of two). A step
 *  between surfaces is a few cells in many, and the median passes it by. */
export function cellNoise(values: Float32Array, cols: number, rows: number): number {
  const steps: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c]
      if (Number.isNaN(v)) continue
      if (c + 1 < cols && !Number.isNaN(values[r * cols + c + 1])) steps.push(Math.abs(values[r * cols + c + 1] - v))
      if (r + 1 < rows && !Number.isNaN(values[(r + 1) * cols + c])) steps.push(Math.abs(values[(r + 1) * cols + c] - v))
    }
  }
  if (steps.length === 0) return 0
  steps.sort((a, b) => a - b)
  return (1.4826 * steps[Math.floor(steps.length / 2)]) / Math.SQRT2
}

export interface HeightLevel {
  /** The level's median value. */
  height: number
  /** Its spread: the standard deviation of its cells about their mean. */
  sigma: number
  /** Its lowest and highest cell. */
  range: [number, number]
  cells: number
  /** cells × cell², mm². */
  area: number
  /** Of the cells with a value, how many are this level's. */
  share: number
  /** The grid box round its cells, [u, v] mm. */
  box: { min: [number, number]; max: [number, number] }
}

export interface LevelsResult {
  levels: HeightLevel[]
  /** The bin the values were counted in, mm — also the least gap between
   *  two levels. */
  gap: number
  /** The cells with a value that fall in no level — walls, edges, spray. */
  unassigned: number
}

/** The values a grid holds, gathered into levels: counted in bins `gap`
 *  wide, a level is a run of bins that each hold at least a two-hundredth
 *  of the cells (three at least) — a flat face fills a bin or two, a lean
 *  a run of them, and the few cells on a wall between two faces leave the
 *  bins between them thin, so the two stay apart. Each cell then joins the
 *  run its value lies in, or one a bin either side of it. Largest first. */
export function heightLevels(
  values: Float32Array,
  grid: { cols: number; cell: number; u0: number; v0: number },
  gap: number,
): LevelsResult {
  let lo = Infinity
  let hi = -Infinity
  let count = 0
  for (const v of values) {
    if (Number.isNaN(v)) continue
    count++
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (count === 0) return { levels: [], gap, unassigned: 0 }
  // A gap too fine for the spread would want more bins than there are cells.
  let w = Math.max(gap, 1e-6)
  while ((hi - lo) / w > 4 * count + 100) w *= 2
  const bins = Math.floor((hi - lo) / w) + 1
  const counts = new Uint32Array(bins)
  const binOf = (v: number) => Math.min(bins - 1, Math.floor((v - lo) / w))
  for (const v of values) if (!Number.isNaN(v)) counts[binOf(v)]++
  const dense = Math.max(3, Math.ceil(count / 200))
  const runs: [number, number][] = []
  for (let b = 0; b < bins; b++) {
    if (counts[b] < dense) continue
    const last = runs[runs.length - 1]
    if (last && last[1] === b - 1) last[1] = b
    else runs.push([b, b])
  }
  // Each bin to the run it belongs to: its own, or the nearer one a bin
  // away.
  const core = new Int32Array(bins).fill(-1)
  runs.forEach(([a, b], k) => {
    for (let i = a; i <= b; i++) core[i] = k
  })
  const runOf = core.slice()
  for (let b = 0; b < bins; b++) {
    if (core[b] >= 0) continue
    const below = b > 0 ? core[b - 1] : -1
    const above = b + 1 < bins ? core[b + 1] : -1
    if (below >= 0 && above >= 0) runOf[b] = counts[b - 1] >= counts[b + 1] ? below : above
    else runOf[b] = below >= 0 ? below : above
  }
  const members: number[][] = runs.map(() => [])
  let unassigned = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) continue
    const k = runOf[binOf(v)]
    if (k < 0) unassigned++
    else members[k].push(i)
  }
  const { cols, cell, u0, v0 } = grid
  const levels: HeightLevel[] = members
    .filter((m) => m.length > 0)
    .map((m) => {
      const vs = m.map((i) => values[i]).sort((a, b) => a - b)
      const mean = vs.reduce((s, v) => s + v, 0) / vs.length
      const sigma = Math.sqrt(vs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vs.length)
      let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity
      for (const i of m) {
        const c = i % cols
        const r = (i - c) / cols
        c0 = Math.min(c0, c); c1 = Math.max(c1, c)
        r0 = Math.min(r0, r); r1 = Math.max(r1, r)
      }
      return {
        height: vs[Math.floor(vs.length / 2)],
        sigma,
        range: [vs[0], vs[vs.length - 1]] as [number, number],
        cells: m.length,
        area: m.length * cell * cell,
        share: m.length / count,
        box: { min: [u0 + c0 * cell, v0 + r0 * cell] as [number, number], max: [u0 + (c1 + 1) * cell, v0 + (r1 + 1) * cell] as [number, number] },
      }
    })
  levels.sort((a, b) => b.cells - a.cells)
  return { levels, gap: w, unassigned }
}
