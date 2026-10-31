// SPDX-License-Identifier: AGPL-3.0-only
// A scan-like test surface: one side of a sheet-metal bracket as a scanner
// sees it — two plates at a right angle with a round between them and a
// hole through one, its triangles irregular and scattered across the
// surface, a spike here and there, and the border ragged where the scan
// stops.

/** A deterministic random stream. */
function stream(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * The outside of an L bracket, `size` mm each way and `round` mm round at
 * the bend, scanned at `step` mm with `noise` mm of scatter and a spike of
 * `spike` mm on one point in `spikeEvery`. The plates are the XY plane
 * (x from the round to `size`) and the YZ plane, facing out of the L —
 * down and back — so the sheet lies behind them, towards +X and +Z. A hole
 * `hole` mm across goes through the upright plate.
 */
export function lBracket({
  size = 40,
  round = 3,
  step = 0.3,
  noise = 0.02,
  spike = 0.1,
  spikeEvery = 200,
  hole = 8,
  seed = 5,
} = {}): { positions: Float32Array; indices: Uint32Array; vertexCount: number } {
  const rand = stream(seed)
  const gauss = () => (rand() + rand() + rand() + rand() - 2) * 0.866
  // The profile across the bend, by arc length: the floor plate from x =
  // size in to the round, the quarter round, and up the upright plate.
  const flat = size - round
  const arc = (Math.PI / 2) * round
  const length = 2 * flat + arc
  const profile = (s: number): { x: number; z: number; nx: number; nz: number } => {
    if (s < flat) return { x: size - s, z: 0, nx: 0, nz: -1 }
    if (s < flat + arc) {
      const a = (s - flat) / round
      // Round about (round, round), from straight down to straight back.
      return { x: round - round * Math.sin(a), z: round - round * Math.cos(a), nx: -Math.sin(a), nz: -Math.cos(a) }
    }
    return { x: 0, z: round + (s - flat - arc), nx: -1, nz: 0 }
  }
  const nu = Math.round(length / step)
  const nv = Math.round(size / step)
  const pos: number[] = []
  const id: number[] = []
  const at = (i: number, j: number) => j * (nu + 1) + i
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      // Scattered along the surface a little, so the triangles are uneven,
      // and across it by the scanner's noise; the border ragged.
      const border = i === 0 || j === 0 || i === nu || j === nv
      const du = border ? 0 : (rand() - 0.5) * 0.5 * step
      const dv = border ? (rand() - 0.5) * 0.8 * step : (rand() - 0.5) * 0.5 * step
      const p = profile(Math.min(length, Math.max(0, i * step + du)))
      const y = j * step + (j === 0 || j === nv ? 0 : dv)
      let off = gauss() * noise
      if (rand() < 1 / spikeEvery) off += (rand() < 0.5 ? -1 : 1) * spike
      pos.push(p.x + p.nx * off, y, p.z + p.nz * off)
      id.push(pos.length / 3 - 1)
    }
  }
  const idx: number[] = []
  const holeAt = { y: size / 2, z: round + (size - round) / 2 }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1)
      // The hole through the upright plate: quads with their middle in it go.
      const my = (pos[a * 3 + 1] + pos[c * 3 + 1]) / 2
      const mz = (pos[a * 3 + 2] + pos[c * 3 + 2]) / 2
      const mx = (pos[a * 3] + pos[c * 3]) / 2
      if (mx < 0.5 && Math.hypot(my - holeAt.y, mz - holeAt.z) < hole / 2) continue
      // Wound to face out of the L: down on the floor, back on the upright.
      if (rand() < 0.5) idx.push(a, b, c, a, c, d)
      else idx.push(a, b, d, b, c, d)
    }
  }
  void id
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), vertexCount: pos.length / 3 }
}
