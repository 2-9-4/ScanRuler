// SPDX-License-Identifier: AGPL-3.0-only
// The detected edge chains told about one by one — for a caller that cannot
// see the overlay and must name an edge rather than click on it. A chain is
// known by its number in the detection, which holds until the edges are
// detected again; its length, whether it closes on itself and the box round
// it are read in document units, and its points thinned to a tolerance are
// what a polyline over it needs.
//
// Pure over EdgeChains: `unit` is document units per chain unit (millimetres
// per pixel on an image, 1 on a section, whose chains are millimetres).

import type { EdgeChains } from './edges'
import { simplifyRun } from './simplify'
import type { Vec2 } from './types'

export interface ChainSummary {
  id: number
  points: number
  /** Along the path, document units. */
  length: number
  closed: boolean
  box: { min: Vec2; max: Vec2 }
}

/** How many chains there are. */
export const chainTotal = (chains: EdgeChains): number => Math.max(0, chains.offsets.length - 1)

/** Chain `c`'s point indices, [from, to). */
export const chainSpan = (chains: EdgeChains, c: number): [number, number] => [chains.offsets[c], chains.offsets[c + 1]]

/** Chain `c` in numbers. A chain closes when its ends meet within
 *  `closeGap` chain units — two pixels for a traced loop on an image,
 *  nothing for a section's cut, whose loops repeat their first point. */
export function chainSummary(chains: EdgeChains, c: number, unit: { x: number; y: number }, closeGap: number): ChainSummary {
  const [from, to] = chainSpan(chains, c)
  const p = chains.points
  let length = 0
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = from; i < to; i++) {
    const x = p[i * 2] * unit.x
    const y = p[i * 2 + 1] * unit.y
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    if (i > from) length += Math.hypot(x - p[(i - 1) * 2] * unit.x, y - p[(i - 1) * 2 + 1] * unit.y)
  }
  const n = to - from
  const gap = n > 2 ? Math.hypot(p[from * 2] - p[(to - 1) * 2], p[from * 2 + 1] - p[(to - 1) * 2 + 1]) : Infinity
  return {
    id: c,
    points: n,
    length,
    closed: n >= 8 && gap <= closeGap,
    box: { min: [x0, y0], max: [x1, y1] },
  }
}

/** Chain `c`'s points in document units, every one. */
export function chainPoints(chains: EdgeChains, c: number, unit: { x: number; y: number }): Vec2[] {
  const [from, to] = chainSpan(chains, c)
  const out: Vec2[] = new Array(to - from)
  for (let i = from; i < to; i++) out[i - from] = [chains.points[i * 2] * unit.x, chains.points[i * 2 + 1] * unit.y]
  return out
}

/** Chain `c` as a polyline within `tolerance` document units of every point
 *  it drops. Thinned in the chain's own units, at the finer of the two
 *  axes' scales, so an image calibrated per axis strays no further than
 *  asked along either. */
export function chainPolyline(chains: EdgeChains, c: number, unit: { x: number; y: number }, tolerance: number): Vec2[] {
  const [from, to] = chainSpan(chains, c)
  const kept = simplifyRun(chains.points, from, to, tolerance / Math.max(unit.x, unit.y))
  return kept.map((i) => [chains.points[i * 2] * unit.x, chains.points[i * 2 + 1] * unit.y])
}

/** Whether any point of chain `c` lies inside the box (document units). */
export function chainEnters(chains: EdgeChains, c: number, unit: { x: number; y: number }, box: { min: Vec2; max: Vec2 }): boolean {
  const [from, to] = chainSpan(chains, c)
  for (let i = from; i < to; i++) {
    const x = chains.points[i * 2] * unit.x
    const y = chains.points[i * 2 + 1] * unit.y
    if (x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1]) return true
  }
  return false
}

/** The point of chain `c` nearest `at` (document units), and how far. */
export function chainNearest(chains: EdgeChains, c: number, unit: { x: number; y: number }, at: Vec2): { at: Vec2; distance: number } {
  const [from, to] = chainSpan(chains, c)
  let best = -1
  let bestSq = Infinity
  for (let i = from; i < to; i++) {
    const dx = chains.points[i * 2] * unit.x - at[0]
    const dy = chains.points[i * 2 + 1] * unit.y - at[1]
    const d = dx * dx + dy * dy
    if (d < bestSq) {
      bestSq = d
      best = i
    }
  }
  return best < 0
    ? { at: [NaN, NaN], distance: Infinity }
    : { at: [chains.points[best * 2] * unit.x, chains.points[best * 2 + 1] * unit.y], distance: Math.sqrt(bestSq) }
}
