// SPDX-License-Identifier: AGPL-3.0-only
// Mending what an offset folds: where the moved surface turns over or runs
// into itself, the faces there pushed apart and relaxed until none is
// inside out, within a clearance the caller sets.

import { emptyHit } from '../../../src/core/deviation/surface'
import { buildAdjacency } from '../../../src/core/geometry/adjacency'
import type { DistanceSurface } from './hollow'
import { cornersOf, nextCorner } from './meshCorners'

/** Rounds of finding folded triangles and easing the points around them. */
const RELAX_PASSES = 30

/** Rounds of taking points of turned triangles back out to the distance —
 *  a row of the strip beside an edge each. */
const MEND_ROUNDS = 64

/** Pushes out from the nearest face a point takes at most: one per face at
 *  a corner, and on a scan a few more, the next triangle of the scatter
 *  nearer by a hair each time. */
const PUSH_STEPS = 12

/** A point this share of the distance short of it, or less, is where the
 *  distance puts it. */
const SETTLED = 2e-3

/** A triangle whose area a move takes below this share of what it was has
 *  closed up — a strip beside an edge, gathered into it — rather than
 *  turned over. */
const CLOSED_UP = 1e-4

/** A triangle on the moved surface worn below this share of its area is a
 *  sliver, and closed up with those turned over. */
const WORN = 0.1

/** A sliver's two points are merged only where the move has brought them
 *  together — no further apart than this share of how far apart they were:
 *  across a strip closed up into an edge, not along the edge, which would
 *  run its points together and leave the face beside it a fan of long
 *  slivers. A triangle turned over is closed up along any of its edges. */
const DRAWN_TOGETHER = 0.5

/** What the moved surface keeps clear of: the surface as it was — built
 *  only if something folds — the distance each point is to end from it, and
 *  which points are meant to: those moved the whole distance, not those
 *  sliding along a face beside a marked region. */
export interface Clearance {
  surface: () => DistanceSurface
  distance: number
  points: Uint8Array
  /** How near the surface's own scatter brings a point short of the
   *  distance — a quarter of the mesh's edge: a point no further short is
   *  not looked at for a spike. */
  scatter: number
}

/** What mending the folds a move made did: the triangles left — fewer where
 *  folds and slivers were closed up — how many points were merged doing it,
 *  and how many eased. */
interface Mended {
  indices: Uint32Array
  merged: number
  relaxed: number
}

/**
 * Mend the folds a move made, wherever one of the first `checked` triangles
 * of `indices` comes out turned over against its normal before the move
 * (`before`, a unit normal each), in three steps:
 *
 * 1. Its corners are taken back out to the distance from the surface as it
 *    was (`clearance`): the strip beside an edge the move turned into, onto
 *    the moved edge, row by row.
 * 2. A triangle still turned over, or worn to a sliver, whose corners all
 *    ended the distance from the surface — on the moved surface, where they
 *    should be — is closed up: its shortest edge collapsed, its two points
 *    made one, halfway between or where either was, so long as the mesh
 *    round it stays a surface and fewer triangles there are turned over
 *    than before. On a scan the strip closed into
 *    an edge is its points a scatter's width either side of the edge, and a
 *    second skin moved millimetres has a fold here and there in the middle
 *    of a face; left in, each turned triangle shades as a bright speck and
 *    turns the next move at its corners the wrong way — a dimple.
 * 3. The points of any still turned over that may move (`free`) take the
 *    mean move of their neighbours — with a `clearance`, their mean place,
 *    and are taken back out to the distance — until none is: a bump tighter
 *    than the distance, with no surface to close into, or a knot of folds
 *    no merge would undo.
 *
 * `out` holds the positions after the move, mended in place; `base` before
 * it. Points `locked` — a rim, a point the move leaves — are never merged.
 * `indices` is changed in place; the triangles left come back.
 */
export function mendFolds(
  base: Float32Array,
  out: Float32Array,
  indices: Uint32Array,
  checked: number,
  before: Float32Array,
  free: Uint8Array,
  locked: Uint8Array,
  clearance: Clearance | null = null,
): Mended {
  const n = free.length
  const triangles = indices.length / 3
  const alive = new Uint8Array(triangles).fill(1)
  let dead = 0

  /** Triangle `t`'s normal now, unnormalized, into `nrm`; and twice its
   *  area before the move. */
  const nrm = new Float64Array(3)
  const shape = (t: number): number => {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    const ux = out[b] - out[a], uy = out[b + 1] - out[a + 1], uz = out[b + 2] - out[a + 2]
    const vx = out[c] - out[a], vy = out[c + 1] - out[a + 1], vz = out[c + 2] - out[a + 2]
    nrm[0] = uy * vz - uz * vy
    nrm[1] = uz * vx - ux * vz
    nrm[2] = ux * vy - uy * vx
    const wx = base[b] - base[a], wy = base[b + 1] - base[a + 1], wz = base[b + 2] - base[a + 2]
    const sx = base[c] - base[a], sy = base[c + 1] - base[a + 1], sz = base[c + 2] - base[a + 2]
    return Math.hypot(wy * sz - wz * sy, wz * sx - wx * sz, wx * sy - wy * sx)
  }
  /** Whether triangle `t` is turned over — not closed up into a sliver. */
  const turned = (t: number): boolean => {
    if (t >= checked || !alive[t]) return false
    const ox = before[t * 3], oy = before[t * 3 + 1], oz = before[t * 3 + 2]
    if (ox === 0 && oy === 0 && oz === 0) return false
    const was = shape(t)
    if (nrm[0] * ox + nrm[1] * oy + nrm[2] * oz > 0) return false
    return Math.hypot(nrm[0], nrm[1], nrm[2]) > CLOSED_UP * was
  }
  /** Whether triangle `t` is turned over or worn to a sliver. */
  const worn = (t: number): boolean => {
    if (t >= checked || !alive[t]) return false
    const ox = before[t * 3], oy = before[t * 3 + 1], oz = before[t * 3 + 2]
    if (ox === 0 && oy === 0 && oz === 0) return false
    const was = shape(t)
    return nrm[0] * ox + nrm[1] * oy + nrm[2] * oz <= 0 || Math.hypot(nrm[0], nrm[1], nrm[2]) < WORN * was
  }

  // 1. Back out to the distance from the surface as it was. A point that
  // ends no nearer than that is on the moved surface — `settled`.
  const settled = new Uint8Array(n)
  const hit = emptyHit()
  let surface: DistanceSurface | null = null
  /** Exactly the distance from the surface — out if nearer, in if further:
   *  where an eased point of a fold belongs. */
  const putOn = (v: number) => {
    if (!clearance || !surface) return
    const x = out[v * 3], y = out[v * 3 + 1], z = out[v * 3 + 2]
    surface.closest(x, y, z, hit)
    const dist = Math.hypot(x - hit.px, y - hit.py, z - hit.pz)
    if (dist === 0) return
    const s = clearance.distance / dist
    out[v * 3] = hit.px + (x - hit.px) * s
    out[v * 3 + 1] = hit.py + (y - hit.py) * s
    out[v * 3 + 2] = hit.pz + (z - hit.pz) * s
    pushOut(v)
  }
  const pushOut = (v: number) => {
    if (!clearance || !surface) return
    const reach = clearance.distance
    // Out from the nearest face, and again from the next nearest where that
    // leaves it too close to another — a corner has three — and on a scan a
    // few more, the next triangle of the scatter nearer by a hair each time.
    for (let step = 0; step < PUSH_STEPS; step++) {
      const x = out[v * 3], y = out[v * 3 + 1], z = out[v * 3 + 2]
      const found = surface.closest(x, y, z, hit, reach)
      const dist = found ? Math.hypot(x - hit.px, y - hit.py, z - hit.pz) : Infinity
      if (dist >= reach * (1 - SETTLED)) {
        settled[v] = 1
        return
      }
      if (dist === 0) return
      const s = reach / dist
      out[v * 3] = hit.px + (x - hit.px) * s
      out[v * 3 + 1] = hit.py + (y - hit.py) * s
      out[v * 3 + 2] = hit.pz + (z - hit.pz) * s
    }
  }
  const seen = new Uint8Array(n)
  // 0. A point nearer the surface as it was than the distance — by a point
  // beside it, a spike of scatter or the foot of one — out to it, and every
  // point beside one taken out, until none is nearer: a spike is not copied
  // into the moved surface as a pit, which a later move would fold up in.
  if (clearance) {
    const { offsets: aOff, list: aList } = buildAdjacency(indices, n)
    // Short by more than the scatter: a spike, not the surface's grain —
    // which, taken out point by point, would have every point of a scan
    // looked up, and nothing to show for it.
    const reach = clearance.distance - Math.max(SETTLED * clearance.distance, clearance.scatter)
    const near2 = reach * reach
    const queue: number[] = []
    const queued = new Uint8Array(n)
    for (let v = 0; v < n; v++) {
      if (!clearance.points[v]) continue
      const x = out[v * 3], y = out[v * 3 + 1], z = out[v * 3 + 2]
      for (let k = aOff[v]; k < aOff[v + 1]; k++) {
        const u = aList[k] * 3
        if ((x - base[u]) ** 2 + (y - base[u + 1]) ** 2 + (z - base[u + 2]) ** 2 < near2) {
          queue.push(v)
          queued[v] = 1
          break
        }
      }
    }
    if (queue.length > 0) surface ??= clearance.surface()
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q]
      const x = out[v * 3], y = out[v * 3 + 1], z = out[v * 3 + 2]
      if (!surface || !surface.closest(x, y, z, hit, reach)) continue
      pushOut(v)
      for (let k = aOff[v]; k < aOff[v + 1]; k++) {
        const u = aList[k]
        if (clearance.points[u] && !queued[u]) {
          queued[u] = 1
          queue.push(u)
        }
      }
    }
  }
  if (clearance) {
    // Row by row: only the row next to an edge comes out turned at first,
    // the next once that one is on the edge.
    for (let round = 0; round < MEND_ROUNDS; round++) {
      const near: number[] = []
      for (let t = 0; t < checked; t++) {
        if (!turned(t)) continue
        for (let k = 0; k < 3; k++) {
          const v = indices[t * 3 + k]
          if (clearance.points[v] && !seen[v]) {
            seen[v] = 1
            near.push(v)
          }
        }
      }
      if (near.length === 0) break
      surface ??= clearance.surface()
      for (const v of near) pushOut(v)
    }
  }

  // 2. Close up what is turned over or worn thin on the moved surface.
  let merged = 0
  const wornOnes: number[] = []
  if (clearance) for (let t = 0; t < checked; t++) if (worn(t)) wornOnes.push(t)
  if (clearance && wornOnes.length > 0) {
    surface ??= clearance.surface()
    const { offsets, corners } = cornersOf(indices, n)
    // A point's triangles: from the table as it was, or, for one that
    // gained another's in a merge, its own list.
    const own = new Map<number, number[]>()
    const has = (t: number, x: number) => indices[t * 3] === x || indices[t * 3 + 1] === x || indices[t * 3 + 2] === x
    const fan = (x: number): number[] => {
      const list: number[] = []
      const mine = own.get(x)
      if (mine) {
        for (const t of mine) if (alive[t] && has(t, x)) list.push(t)
      } else {
        for (let k = offsets[x]; k < offsets[x + 1]; k++) {
          const t = (corners[k] / 3) | 0
          if (alive[t] && has(t, x)) list.push(t)
        }
      }
      return list
    }
    const ring = (f: number[], x: number): Set<number> => {
      const s = new Set<number>()
      for (const t of f) for (let k = 0; k < 3; k++) if (indices[t * 3 + k] !== x) s.add(indices[t * 3 + k])
      return s
    }
    // Whether every corner of a triangle is on the moved surface — each
    // looked at the first time it is asked about: a merge reshapes the
    // triangles round it, and wears some thin whose corners no turned
    // triangle touched.
    const onSurface = (t: number) => {
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k]
        if (clearance.points[v] && !seen[v]) {
          seen[v] = 1
          pushOut(v)
        }
        if (settled[v] !== 1) return false
      }
      return true
    }
    const closable = (t: number) => alive[t] === 1 && t < checked && worn(t) && onSurface(t)
    const apart = (a: number, b: number) =>
      (out[a * 3] - out[b * 3]) ** 2 + (out[a * 3 + 1] - out[b * 3 + 1]) ** 2 + (out[a * 3 + 2] - out[b * 3 + 2]) ** 2
    const wasApart = (a: number, b: number) =>
      (base[a * 3] - base[b * 3]) ** 2 + (base[a * 3 + 1] - base[b * 3 + 1]) ** 2 + (base[a * 3 + 2] - base[b * 3 + 2]) ** 2
    const drawnTogether = (a: number, b: number) => apart(a, b) <= DRAWN_TOGETHER * DRAWN_TOGETHER * wasApart(a, b)

    /** Merge `v` into `u` — halfway between, or failing that where either
     *  was, taken out to the distance: false, and nothing changed, if the
     *  mesh round them would stop being a surface — the edge not had by
     *  exactly two triangles, or the two points sharing a neighbour other
     *  than those two triangles' third corners — or would be left no less
     *  turned over than it was. */
    const collapse = (u: number, v: number): boolean => {
      const fu = fan(u)
      const fv = fan(v)
      const shared = fv.filter((t) => has(t, u))
      if (shared.length !== 2) return false
      const ru = ring(fu, u)
      let common = 0
      for (const w of ring(fv, v)) if (ru.has(w)) common++
      if (common !== 2) return false
      const around = [...fu.filter((t) => !shared.includes(t)), ...fv.filter((t) => !shared.includes(t))]
      // Turned over round the two, the two triangles between them included:
      // a merge must leave fewer.
      let before = 0
      for (const t of shared) if (turned(t)) before++
      for (const t of around) if (turned(t)) before++
      // Nor may it wear a sound triangle round them thin: a merge closes up
      // a sliver, it does not start on the face beside it.
      const sound = around.filter((t) => !worn(t))
      const keep = [out[u * 3], out[u * 3 + 1], out[u * 3 + 2]]
      const there = [out[v * 3], out[v * 3 + 1], out[v * 3 + 2]]
      const keptSettled = settled[u]
      const renamed: number[] = []
      for (const t of fv) {
        if (shared.includes(t)) continue
        for (let k = 0; k < 3; k++) {
          if (indices[t * 3 + k] === v) {
            indices[t * 3 + k] = u
            renamed.push(t * 3 + k)
          }
        }
      }
      for (const t of shared) alive[t] = 0
      // Halfway between, or where either of the two was.
      for (const share of [0.5, 0, 1]) {
        out[u * 3] = keep[0] + (there[0] - keep[0]) * share
        out[u * 3 + 1] = keep[1] + (there[1] - keep[1]) * share
        out[u * 3 + 2] = keep[2] + (there[2] - keep[2]) * share
        settled[u] = 0
        pushOut(u)
        if (settled[u] === 1 && around.filter(turned).length < Math.max(1, before) && sound.every((t) => !worn(t))) {
          dead += 2
          own.set(u, around)
          return true
        }
      }
      for (const i of renamed) indices[i] = v
      for (const t of shared) alive[t] = 1
      out[u * 3] = keep[0]
      out[u * 3 + 1] = keep[1]
      out[u * 3 + 2] = keep[2]
      settled[u] = keptSettled
      return false
    }

    const queue = wornOnes.filter(closable)
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q]
      if (!closable(t)) continue
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
      const anyEdge = turned(t)
      const edges: [number, number][] = [[a, b], [b, c], [c, a]]
      edges.sort((e, f) => apart(e[0], e[1]) - apart(f[0], f[1]))
      for (const [x, y] of edges) {
        if (locked[x] || locked[y] || !(anyEdge || drawnTogether(x, y)) || !collapse(x, y)) continue
        merged++
        for (const s of fan(x)) if (closable(s)) queue.push(s)
        break
      }
    }
  }

  // 3. Ease what is still turned over.
  const live = (): Uint32Array => {
    if (dead === 0) return indices
    const kept = new Uint32Array((triangles - dead) * 3)
    for (let t = 0, i = 0; t < triangles; t++) {
      if (!alive[t]) continue
      kept[i++] = indices[t * 3]
      kept[i++] = indices[t * 3 + 1]
      kept[i++] = indices[t * 3 + 2]
    }
    return kept
  }
  // Folded among its neighbours, too: turned against those across its edges
  // as they now are. On a scan a triangle's own normal before the move is
  // off by the scatter, and a crease of the moved surface can turn one
  // against everything round it without turning it against itself.
  const { offsets: cOff, corners: cList } = cornersOf(indices, n)
  const unit = (t: number, out3: Float64Array): number => {
    shape(t)
    const len = Math.hypot(nrm[0], nrm[1], nrm[2])
    out3[0] = len > 0 ? nrm[0] / len : 0
    out3[1] = len > 0 ? nrm[1] / len : 0
    out3[2] = len > 0 ? nrm[2] / len : 0
    return len
  }
  const mine = new Float64Array(3)
  const theirs = new Float64Array(3)
  const foldedAmong = (t: number): boolean => {
    if (t >= checked || !alive[t]) return false
    const was = shape(t)
    if (unit(t, mine) <= CLOSED_UP * was) return false
    let sx = 0, sy = 0, sz = 0
    for (let k = 0; k < 3; k++) {
      const a = indices[t * 3 + k]
      const b = indices[t * 3 + ((k + 1) % 3)]
      for (let j = cOff[b]; j < cOff[b + 1]; j++) {
        const c = cList[j]
        const u = (c / 3) | 0
        if (u === t || !alive[u] || indices[nextCorner(c)] !== a) continue
        unit(u, theirs)
        sx += theirs[0]
        sy += theirs[1]
        sz += theirs[2]
      }
    }
    return mine[0] * sx + mine[1] * sy + mine[2] * sz < 0
  }

  let adjacency: { offsets: Uint32Array; list: Uint32Array } | null = null
  const eased = new Uint8Array(n)
  const list: number[] = []
  const tmp = new Float32Array(n * 3)
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    let flipped = 0
    for (let t = 0; t < checked; t++) {
      if (!turned(t) && !foldedAmong(t)) continue
      flipped++
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k]
        if (free[v] && !eased[v]) {
          eased[v] = 1
          list.push(v)
        }
      }
    }
    if (flipped === 0) break
    adjacency ??= buildAdjacency(live(), n)
    const { offsets, list: around } = adjacency
    // Each takes its neighbours' mean move — or, where the move keeps its
    // distance from the surface, their mean place, and is pushed back out
    // to the distance after: the surface's own scatter, carried in every
    // move, is what keeps a fold folded on a scan.
    const byPlace = clearance !== null
    for (let round = 0; round < 4; round++) {
      for (const v of list) {
        let x = 0, y = 0, z = 0
        const count = offsets[v + 1] - offsets[v]
        for (let k = offsets[v]; k < offsets[v + 1]; k++) {
          const u = around[k] * 3
          x += byPlace ? out[u] : out[u] - base[u]
          y += byPlace ? out[u + 1] : out[u + 1] - base[u + 1]
          z += byPlace ? out[u + 2] : out[u + 2] - base[u + 2]
        }
        tmp[v * 3] = count ? x / count : 0
        tmp[v * 3 + 1] = count ? y / count : 0
        tmp[v * 3 + 2] = count ? z / count : 0
      }
      for (const v of list) {
        out[v * 3] = (byPlace ? 0 : base[v * 3]) + tmp[v * 3]
        out[v * 3 + 1] = (byPlace ? 0 : base[v * 3 + 1]) + tmp[v * 3 + 1]
        out[v * 3 + 2] = (byPlace ? 0 : base[v * 3 + 2]) + tmp[v * 3 + 2]
      }
    }
    // Eased, and put back at the distance from the surface, which their
    // mean place is short of on a round and past in a hollow.
    if (clearance) {
      surface ??= clearance.surface()
      for (const v of list) putOn(v)
    }
  }
  return { indices: live(), merged, relaxed: list.length }
}
