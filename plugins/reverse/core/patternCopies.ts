// SPDX-License-Identifier: AGPL-3.0-only
// What a pattern's copies copy. The kernel tracks no history for a pattern,
// so every face of a copy came out as the pattern's own, and a pick by the
// feature that made it — the edges where a blade meets the dish — found the
// original blade's edges alone, or every edge of every copy. Here each face
// of the result is traced to the face it is a copy of: the faces before the
// pattern carried through each copy's motion, turned or stepped, and found
// again where they land. A copy face then keeps the maker of the face it
// copies, and is marked with the pattern and its number among the copies.
//
// The mark rides in the body's origins map, beside the makers, under keys no
// face hash takes (a hash is never negative): carried wherever the makers
// are — copied, merged, sent to another kernel — with nothing else to keep.

import type { Vec3 } from '../../../src/core/types'
import { normalize, scale, sub } from '../../../src/core/vec'
import { identityRigid, rigidApply, rigidCompose, rigidFromAxisAngle, type Rigid } from '../../../src/core/deviation/rigid'
import { patternPitch } from './features'
import type { FaceHistory, RawFace } from './kernelTypes'
import { faceDistance, transformFingerprint, type FaceFingerprint, type MatchTolerance } from './topo'

/** A face a pattern copied: the pattern's id, and which copy it is on —
 *  1 the first copy, the original being 0. */
export interface CopyMark {
  pattern: number
  instance: number
}

/** The keys a face's mark is kept under in an origins map: the pattern
 *  under −1 − hash, the copy's number under −2³¹ − 1 − hash. A hash is
 *  under 2³¹ (HASH_BOUND), so neither meets a face's key nor the other. */
const patternKey = (hash: number) => -1 - hash
const instanceKey = (hash: number) => -0x80000001 - hash

/** The mark of a face in an origins map, or null when no pattern copied it. */
export function copyMarkOf(origins: ReadonlyMap<number, number>, hash: number): CopyMark | null {
  const pattern = origins.get(patternKey(hash))
  const instance = origins.get(instanceKey(hash))
  return pattern === undefined || instance === undefined ? null : { pattern, instance }
}

/** A face marked in an origins map — or its mark taken off, for null. */
export function markCopy(origins: Map<number, number>, hash: number, mark: CopyMark | null): void {
  if (mark === null) {
    origins.delete(patternKey(hash))
    origins.delete(instanceKey(hash))
    return
  }
  origins.set(patternKey(hash), mark.pattern)
  origins.set(instanceKey(hash), mark.instance)
}

/** Whether a key of an origins map is a face's, not a mark's. */
export const isFaceKey = (key: number): boolean => key >= 0

/** A pattern as the builder plays it (buildSteps.ts). */
export interface PatternMotion {
  mode: 'circular' | 'linear'
  origin: Vec3
  dir: Vec3
  count: number
  step: number
  grid?: { dir: Vec3; count: number; step: number }
}

/** Each copy's motion, by its number: a row's copies first, then each
 *  row of a grid after the one before. The first, the original, stays. */
export function copyMotions(p: PatternMotion): Rigid[] {
  const d = normalize(p.dir) ?? [0, 0, 1]
  const row: Rigid[] = []
  for (let i = 0; i < p.count; i++) {
    if (p.mode === 'linear') {
      const m = identityRigid()
      m.t.set(scale(d, i * p.step))
      row.push(m)
      continue
    }
    // Turned about the axis through the origin: R·p + (o − R·o).
    const m = rigidFromAxisAngle(d, (i * patternPitch(p.step, p.count) * Math.PI) / 180)
    const at = new Float64Array(3)
    rigidApply(m, p.origin[0], p.origin[1], p.origin[2], at)
    m.t.set(sub(p.origin, [at[0], at[1], at[2]]))
    row.push(m)
  }
  if (!p.grid || p.grid.count < 2) return row
  const g = normalize(p.grid.dir) ?? [0, 0, 1]
  const all: Rigid[] = []
  for (let j = 0; j < p.grid.count; j++) {
    const shift = identityRigid()
    shift.t.set(scale(g, j * p.grid.step))
    for (const m of row) all.push(rigidCompose(shift, m))
  }
  return all
}

/** How near a copy face must land on where its original's motion takes
 *  it: a copy is the original moved exactly, so only a hair of rounding —
 *  a face a copy's neighbour cut into lands nowhere near and stays the
 *  pattern's own. `diagonal`: the result's size. */
function copyTolerance(diagonal: number): MatchTolerance {
  return { position: Math.max(1e-4, diagonal * 1e-5), angle: 1e-3, size: 1e-4 }
}

const print = (f: RawFace): FaceFingerprint => ({ kind: f.kind, centroid: f.centroid, dir: f.dir, area: f.area, origin: 0, ...(f.radius !== undefined ? { radius: f.radius } : {}), ...(f.center ? { center: f.center } : {}) })

/**
 * The faces of a pattern's result traced to the faces before it: a history
 * from each face before to the faces that are it moved by a copy's motion
 * (`motions`, copyMotions), and the copies' marks by the result's hash —
 * for the copies only, the original's faces keeping theirs. A face of the
 * result that is no face before moved — cut where two copies overlap — is
 * in neither, and stays the pattern's own.
 */
export function traceCopies(before: readonly RawFace[], after: readonly RawFace[], motions: readonly Rigid[], diagonal: number): { history: FaceHistory; copies: Map<number, number> } {
  const tol = copyTolerance(diagonal)
  const cell = tol.position * 4
  const keyOf = (p: Vec3) => p.map((v) => Math.floor(v / cell))
  const grid = new Map<string, RawFace[]>()
  const kept = new Set(before.map((f) => f.hash))
  for (const f of after) {
    if (kept.has(f.hash)) continue
    const k = keyOf(f.centroid).join(',')
    const list = grid.get(k)
    if (list) list.push(f)
    else grid.set(k, [f])
  }
  const history: FaceHistory = new Map()
  const copies = new Map<number, number>()
  const taken = new Set<number>()
  motions.forEach((m, instance) => {
    for (const b of before) {
      const moved = transformFingerprint(print(b), m)
      const [x, y, z] = keyOf(moved.centroid)
      let best: RawFace | null = null
      let bestD = Infinity
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (let l = -1; l <= 1; l++)
            for (const f of grid.get(`${x + i},${y + j},${z + l}`) ?? []) {
              if (taken.has(f.hash)) continue
              const d = faceDistance(moved, print(f), tol)
              if (d !== null && d < bestD) {
                bestD = d
                best = f
              }
            }
      if (!best) continue
      taken.add(best.hash)
      history.set(b.hash, [...(history.get(b.hash) ?? []), best.hash])
      if (instance > 0) copies.set(best.hash, instance)
    }
  })
  return { history, copies }
}
