// SPDX-License-Identifier: AGPL-3.0-only
// A sheet made a solid of a thickness — ReKernel's thickenTracked
// (kernel.ts): the kernel's own thickening, one way or half each way, and
// the wall it came to, measured along the sheet's edge.

import type { Vec3 } from '../../../src/core/types'
import { parseHistory, vec } from './kernelMath'
import { HASH_BOUND, isTrap, KernelError, tracked } from './kernelOps'
import { rawRefusal } from './kernelShell'
import type { Shape, Tracked } from './kernelTypes'
import type { OcctLike } from './occtTypes'
import type { ReKernel } from './kernel'

/** Which way a sheet is thickened — see ThickenFeature. */
export type ThickenWay = 'in' | 'out' | 'both'

/** The tolerance a thickening refused at a hair's is tried again at, mm. */
const RETRY_TOLERANCE = 1e-4

/** How many points along a sheet's edge its solid's wall is measured at. */
const WALL_POINTS = 48

/** The wall a thickened sheet came to along its edge: the thinnest of the
 *  points measured, and where. */
export interface ThickenWall {
  least: number
  at: Vec3
  points: number
}

/** A thickened sheet: the solid, and which of its faces are the sheet's
 *  own — the skin it was thickened from, by its hash in the solid to its
 *  hash on the sheet (none for a sheet thickened both ways, whose two skins
 *  are both new) — and its wall along the sheet's edge. */
export interface Thickened extends Tracked {
  skin: Map<number, number>
  wall: ThickenWall | null
}

/**
 * The sheet thickened by `thickness`: along its faces' normals (out),
 * against them (in), or half each way — the sheet offset back by half the
 * thickness first and that thickened by all of it, so the solid is one
 * thickening and not two joined along the sheet. The kernel's own words
 * where it refuses. It folds a face that curves tighter than the thickness
 * towards the side it grows to without a word; that is the caller's to
 * look for first (faceOffsetLimits). The sheet stays the caller's.
 */
export function thickenSheet(occt: OcctLike, kernel: ReKernel, sheet: Shape, thickness: number, way: ThickenWay): Thickened {
  const o = occt
  if (!(thickness > 0)) throw new KernelError('the thickness must be positive.')
  // units-ok: build message, also the agent's answer
  const said = `the kernel's thickening of the sheet ${way === 'both' ? 'both ways' : way === 'out' ? 'along its normal' : 'against its normal'} by ${thickness} mm`
  let base = sheet
  if (way === 'both') {
    try {
      base = o.offset(sheet, -thickness / 2, 1e-3) as Shape
    } catch (e) {
      if (isTrap(e)) throw e
      throw new KernelError(`${said} failed: the sheet does not offset back by half of it (${rawRefusal(e)}).`)
    }
    if (o.isNull(base) || o.subShapeCount(base, 'face') === 0) {
      if (!o.isNull(base)) o.release(base)
      throw new KernelError(`${said} failed: the sheet does not offset back by half of it.`)
    }
  }
  try {
    const hashes = kernel.faceHashes(base)
    const attempt = (tolerance: number): Tracked => {
      let made: Tracked
      try {
        made = tracked(o, o.thickenWithHistory(base, way === 'in' ? -thickness : thickness, tolerance, hashes, HASH_BOUND))
      } catch (e) {
        if (isTrap(e)) throw e
        throw new KernelError(`${said} failed (${rawRefusal(e)}).`)
      }
      const solids = o.subShapeCount(made.shape, 'solid')
      if (solids !== 1 || !kernel.isClosedSolid(made.shape)) {
        o.release(made.shape)
        throw new KernelError(`${said} came out broken: ${solids === 1 ? "the kernel's own check finds it no closed solid" : `it is ${solids} solids, not one`}.`)
      }
      return made
    }
    // A sheet sewn of faces that meet within a micron or two, not on one
    // edge curve — a patch network's — offsets them apart at a hair's
    // tolerance: a 2 × 2 network on a sphere thickened inwards came out as
    // no solid at 1e-6 and whole at 1e-4, both ways. So a refusal at 1e-6
    // is tried once more at RETRY_TOLERANCE; the first refusal is the one
    // said.
    let made: Tracked
    try {
      made = attempt(1e-6)
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      try {
        made = attempt(RETRY_TOLERANCE)
      } catch (again) {
        if (!(again instanceof KernelError)) throw again
        throw e
      }
    }
    // The faces thickened from, as they stand in the solid: the kernel
    // keeps them as they were, or says what each became.
    const after = new Set(kernel.faceHashes(made.shape))
    const from = new Map<number, number>()
    for (const h of hashes) {
      if (after.has(h)) from.set(h, h)
      for (const n of made.history.get(h) ?? []) if (after.has(n)) from.set(n, h)
    }
    const wall = wallAlongEdge(occt, base, made.shape, new Set(from.keys()))
    return { ...made, skin: way === 'both' ? new Map() : from, wall }
  } finally {
    if (base !== sheet) o.release(base)
  }
}

/**
 * The wall of a thickened sheet along the edge of what was thickened
 * (`base`): from points spaced evenly along its open edges, the distance
 * to the solid's other skin — its faces neither thickened from (`from`)
 * nor meeting those along an edge, which are the walls round its edge. A
 * thickening that runs true is the thickness everywhere; less is where the
 * kernel trimmed the wall short or the far skin comes back near, so a thin
 * edge is not hidden by a sound middle. Null where no edge or no far skin
 * is found.
 */
function wallAlongEdge(occt: OcctLike, base: Shape, solid: Shape, from: ReadonlySet<number>): ThickenWall | null {
  const o = occt
  // The base's open edges: those with one face of the base.
  const baseFaces = parseHistory(o.edgeToFaceMap(base, HASH_BOUND))
  const edges = o.getSubShapes(base, 'edge').filter((e) => {
    const faces = baseFaces.get(o.hashCode(e, HASH_BOUND)) ?? []
    if (new Set(faces).size === 1) return true
    o.release(e)
    return false
  })
  const faces = o.getSubShapes(solid, 'face')
  const made: number[] = []
  try {
    if (edges.length === 0) return null
    const meets = new Set<number>()
    for (const hs of parseHistory(o.edgeToFaceMap(solid, HASH_BOUND)).values()) if (hs.some((h) => from.has(h))) for (const h of hs) meets.add(h)
    const far = faces.filter((f) => !meets.has(o.hashCode(f, HASH_BOUND)))
    if (far.length === 0) return null
    const skin = o.makeCompound(far)
    made.push(skin)
    const lengths = edges.map((e) => o.curveLength(e))
    const total = lengths.reduce((a, b) => a + b, 0)
    if (!(total > 0)) return null
    let least = Infinity
    let at: Vec3 = [0, 0, 0]
    let points = 0
    edges.forEach((e, i) => {
      const n = Math.max(1, Math.round((WALL_POINTS * lengths[i]) / total))
      const { first, last } = o.curveParameters(e)
      for (let j = 0; j < n; j++) {
        const p = vec(o.curvePointAtParam(e, first + ((last - first) * (j + 0.5)) / n))
        const v = o.makeVertex(p[0], p[1], p[2])
        try {
          const d = o.distanceBetween(v, skin)
          points++
          if (d < least) {
            least = d
            at = p
          }
        } finally {
          o.release(v)
        }
      }
    })
    return points > 0 ? { least, at, points } : null
  } finally {
    for (const e of edges) o.release(e)
    for (const f of faces) o.release(f)
    for (const s of made) o.release(s)
  }
}
