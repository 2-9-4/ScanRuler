// SPDX-License-Identifier: AGPL-3.0-only
// The scan's flat faces found all at once: scan.segment grows planar regions
// over it in the mesh worker (core/fit/segment) and answers each region's
// plane, σ, area, box and neighbours — no vertex lists, which cost more to
// read than they say. One region's points can be left marked for
// element.fit_marked instead. Mirror twins are paired across a plane given.

import { BASE_PLANES } from '../../core/basePlanes'
import type { Segmentation, SegmentedPlane } from '../../core/fit/segment'
import { roundTo } from '../../core/round'
import type { Vec3 } from '../../core/types'
import { useStore } from '../../state/store'
import { commandHost } from '../host'
import { setMarked } from '../marked'
import { elementRefSchema, measuredElement, requireScan, type ElementRef } from '../refs'
import { enumOf, int, num, obj, vec3 } from '../schema'
import { CommandError, type Command } from '../types'

/** Unless told otherwise: the angle a vertex normal may lean off its
 *  region's plane, degrees; the RMS a region may have off it, mm; how many
 *  regions are listed. The smallest region kept is a square 2 % of the
 *  scan's diagonal on a side. */
const SEGMENT_DEG = 15
const SEGMENT_RMS = 0.05
const SEGMENT_LIMIT = 20
const SEGMENT_LIMIT_MAX = 200
const MIN_SIDE_SHARE = 0.02
/** Mirror twins: their planes within this many degrees once one is
 *  mirrored, their centroids within half the larger one's side (as the
 *  square root of its area) and a millimetre, and neither more than twice
 *  the other's area. */
const MIRROR_DEG = 3
const MIRROR_AREA_RATIO = 2

interface SegmentIn {
  kind?: 'plane'
  box?: { min: Vec3; max: Vec3 }
  minArea?: number
  maxRms?: number
  maxDeg?: number
  limit?: number
  symmetric?: ElementRef
  mark?: number
}

/** The last segmentation, kept for a follow-up `mark` with the same
 *  options on the scan as it stood. */
let last: { key: string; result: Segmentation } | null = null

/** What the result depends on: the options, the scan, and where the
 *  alignment has put it. */
function cacheKey(options: object): string {
  const s = useStore.getState()
  const version = commandHost().session.clientRef.current?.scanVersion ?? -1
  return JSON.stringify({ options, version, pose: s.appliedAlignment })
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The plane mirror twins are paired across: a plane element, or a
 *  coordinate plane through the origin. */
function mirrorPlane(ref: ElementRef): { point: Vec3; normal: Vec3 } {
  if (typeof ref === 'string') {
    const key = ref.trim().toUpperCase().replace(/\s*PLANE$/, '')
    const base = BASE_PLANES.find((p) => p.name.toUpperCase() === `${key === 'XZ' ? 'ZX' : key} PLANE`)
    if (base) return { point: [0, 0, 0], normal: base.normal }
  }
  const fit = measuredElement(ref, ['plane']).fit
  if (fit?.kind !== 'plane') throw new CommandError('invalid_input', 'symmetric takes a plane.')
  return { point: fit.center, normal: fit.normal }
}

/** Each region's mirror twin across the plane: the region its mirror image
 *  matches best, when the match goes both ways — the region itself when it
 *  straddles the plane. */
function pairMirrors(regions: SegmentedPlane[], plane: { point: Vec3; normal: Vec3 }) {
  const m = plane.normal
  const ml = Math.hypot(m[0], m[1], m[2])
  const u: Vec3 = [m[0] / ml, m[1] / ml, m[2] / ml]
  const mirrored = regions.map((r) => {
    const dn = 2 * dot(r.normal, u)
    const dc = 2 * (dot(r.point, u) - dot(plane.point, u))
    return {
      normal: [r.normal[0] - dn * u[0], r.normal[1] - dn * u[1], r.normal[2] - dn * u[2]] as Vec3,
      point: [r.point[0] - dc * u[0], r.point[1] - dc * u[1], r.point[2] - dc * u[2]] as Vec3,
    }
  })
  const cosMax = Math.cos((MIRROR_DEG * Math.PI) / 180)
  const best = regions.map((a, i) => {
    let pick = -1
    let score = Infinity
    regions.forEach((b, k) => {
      if (Math.max(a.area, b.area) > MIRROR_AREA_RATIO * Math.min(a.area, b.area)) return
      if (dot(mirrored[i].normal, b.normal) < cosMax) return
      const p = mirrored[i].point
      const d = Math.hypot(p[0] - b.point[0], p[1] - b.point[1], p[2] - b.point[2])
      if (d > 0.5 * Math.sqrt(Math.max(a.area, b.area)) + 1) return
      if (d < score) {
        score = d
        pick = k
      }
    })
    return pick
  })
  return regions.map((b, i) => {
    const k = best[i]
    if (k < 0 || best[k] !== i) return null
    const mp = mirrored[k]
    return {
      id: k === i ? ('self' as const) : k + 1,
      deg: roundTo((Math.acos(Math.min(1, dot(mp.normal, b.normal))) * 180) / Math.PI, 2),
      // How far this region's plane lies from its twin's mirrored, at its
      // own centroid.
      mm: roundTo(Math.abs(dot([b.point[0] - mp.point[0], b.point[1] - mp.point[1], b.point[2] - mp.point[2]], b.normal)), 3),
    }
  })
}

const segment: Command<SegmentIn> = {
  name: 'segment',
  title: 'Find the scan’s flat regions',
  description:
    `The scan’s planar regions, found all at once: grown from the flattest places outward, a vertex joining while its normal lies within maxDeg of the region’s plane (${SEGMENT_DEG}° by default) and it lies inside the region’s noise band; each vertex goes to one region; a region rougher than maxRms off its plane (mm, ${SEGMENT_RMS} by default) or smaller than minArea (mm², by default a square 2 % of the scan’s diagonal on a side) is given back. box: only the scan inside it. The largest first, at most limit (${SEGMENT_LIMIT}); each with id (1 is the largest), normal (out of the part), point (its centroid, on the plane), sigma (RMS off the plane, mm), area (mm²), box, vertices (a count) and neighbours: the regions it meets across an edge or its rounding, each { id, deg } with the angle between their normals. symmetric: a plane element, or "XY", "YZ", "ZX" — each region gets mirror { id, deg, mm }: its twin across that plane ("self" when it straddles it), how far their planes differ in angle once mirrored and in place. mark: a region’s id leaves its points marked — element.fit_marked { marked: true } fits to them; with the same options it reuses the last run. Returns found (regions in all), considered and claimed (vertices looked at and held by regions). Changes nothing.`,
  input: obj({
    kind: enumOf(['plane'], 'What to find; plane, the default and for now the only one.'),
    box: obj({ min: vec3('The lowest corner, mm.'), max: vec3('The highest corner, mm.') }, ['min', 'max'], 'Only the scan inside this box.'),
    minArea: num('mm².', { minimum: 0 }),
    maxRms: num('mm.', { exclusiveMinimum: 0 }),
    maxDeg: num('Degrees.', { exclusiveMinimum: 0, maximum: 60 }),
    limit: int(`How many regions are listed; ${SEGMENT_LIMIT} by default.`, { minimum: 1, maximum: SEGMENT_LIMIT_MAX }),
    symmetric: elementRefSchema('Pair regions mirrored across this plane: a plane element, or "XY", "YZ", "ZX".'),
    mark: int('Leave this region’s points marked, by its id.', { minimum: 1 }),
  }),
  readOnly: true,
  run: async ({ box, minArea, maxRms = SEGMENT_RMS, maxDeg = SEGMENT_DEG, limit = SEGMENT_LIMIT, symmetric, mark }, ctx) => {
    requireScan()
    const client = commandHost().session.clientRef.current
    if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
    if (box) for (let k = 0; k < 3; k++) if (!(box.min[k] <= box.max[k])) throw new CommandError('invalid_input', 'The box’s min lies past its max.')
    const mirror = symmetric !== undefined ? mirrorPlane(symmetric) : null
    const diag = 2 * useStore.getState().modelSize
    const options = { ...(box ? { box } : {}), minArea: minArea ?? (MIN_SIDE_SHARE * diag) ** 2, maxRms, maxDeg }
    const key = cacheKey(options)
    let result: Segmentation
    if (last && last.key === key) result = last.result
    else {
      ctx.progress('Growing planar regions over the scan…')
      result = await client.segment(options)
      last = { key, result }
    }
    const { regions } = result
    let marked: { points: number; from: string } | undefined
    if (mark !== undefined) {
      if (mark > regions.length) throw new CommandError('invalid_input', `There is no region ${mark} — ${regions.length} were found.`)
      marked = setMarked(result.vertices.subarray(result.offsets[mark - 1], result.offsets[mark]), `scan.segment region ${mark}`)
    }
    const shown = Math.min(limit, regions.length)
    const twins = mirror ? pairMirrors(regions, mirror) : null
    const v = (p: readonly number[], places: number) => p.map((x) => roundTo(x, places))
    return {
      found: regions.length,
      ...(shown < regions.length ? { shown } : {}),
      considered: result.considered,
      claimed: result.claimed,
      ...(marked ? { marked } : {}),
      regions: regions.slice(0, shown).map((r, i) => ({
        id: i + 1,
        normal: v(r.normal, 5),
        point: v(r.point, 4),
        sigma: roundTo(r.sigma, 4),
        area: roundTo(r.area, 1),
        box: { min: v(r.min, 2), max: v(r.max, 2) },
        vertices: r.count,
        neighbours: r.neighbours.filter((n) => n.id <= shown).map((n) => ({ id: n.id, deg: roundTo(n.deg, 1) })),
        ...(twins?.[i] ? { mirror: twins[i] } : {}),
      })),
    }
  },
}

export const segmentCommands = [segment]
