// SPDX-License-Identifier: AGPL-3.0-only
// What deviation.volume answers, from a measurement: the figures rounded to
// what they are worth, the regions named with their shape. Apart from the
// command so whatever else reports a volume error (a plugin's comparison of
// its bodies, a benchmark) answers alike.

import type { VolumeDeviation, VolumeRegion } from '../core/deviation/volume'
import { round3 } from '../core/round'
import type { Vec3 } from '../core/types'

/** Regions named by default, and at most. */
export const VOLUME_REGIONS = 8
export const MAX_REGIONS = 50

const round1 = (v: number) => Math.round(v * 10) / 10
const round2 = (v: number) => Math.round(v * 100) / 100
const v3 = (v: readonly number[]): Vec3 => [round3(v[0]), round3(v[1]), round3(v[2])]

/** A region as an answer says it. `shape` reads its thickness against the
 *  cell: a layer is a face standing off the part, a lump material there or
 *  not — a boss, a pocket, a rib. */
export function regionOut(r: VolumeRegion, cell: number) {
  return {
    kind: r.kind,
    volume: round1(r.volume),
    maxDepth: round2(r.maxDepth),
    thickness: round2(r.thickness),
    shape: r.thickness < 3 * cell ? 'layer' : 'lump',
    centroid: v3(r.centroid),
    deepest: v3(r.deepest),
    box: { min: v3(r.box.min), max: v3(r.box.max) },
    evidence: round2(r.evidence),
    confidence: round2(r.confidence),
  }
}

/** The figures of a measurement, its largest `regions` regions named and
 *  the unsure among them only as large as the cell makes worth naming. */
export function volumeOut(v: VolumeDeviation, tolerance: number, regions: number, kinds: readonly VolumeRegion['kind'][] = ['excess', 'missing', 'unsure']) {
  const listed = v.regions.filter((r) => kinds.includes(r.kind) && (r.kind !== 'unsure' || r.cells >= 64)).slice(0, regions)
  const totals = Object.fromEntries((['excess', 'missing', 'unsure'] as const).map((k) => [k, { volume: round1(v.totals[k].volume), share: round2(v.totals[k].share) }]))
  return {
    tolerance,
    cell: round3(v.cell),
    smallestSeen: round3(v.smallestSeen),
    modelVolume: round1(v.modelVolume),
    ...(v.referenceOpen
      ? {
          referenceOpen: { columns: v.referenceOpen.columns, box: { min: v3(v.referenceOpen.box.min), max: v3(v.referenceOpen.box.max) } },
          // units-ok: the agent's answer — in millimetres always.
          warnings: [`The reference's mesh has a hole over ${v.referenceOpen.columns} column${v.referenceOpen.columns === 1 ? '' : 's'} of cells, in (${v3(v.referenceOpen.box.min).join(', ')})–(${v3(v.referenceOpen.box.max).join(', ')}): read from the columns beside it, so no lump stands on it, and no finer than that there.`],
        }
      : {}),
    totals,
    found: v.regions.length,
    regions: listed.map((r) => regionOut(r, v.cell)),
    seconds: round1(v.timings.total / 1000),
  }
}

