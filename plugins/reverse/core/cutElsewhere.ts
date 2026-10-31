// SPDX-License-Identifier: AGPL-3.0-only
// A cut that also takes material where it was not meant: an extent run on
// past the part, which goes through the walls it was drawn for and then
// nicks a far corner of the body — on the lamp, the shield's holes cut ±30
// made the two bores and a 0.15 mm² cylinder 11.4 mm on along the lower
// bore's axis, and the build said nothing: the body checks out, the face
// is over the check's tiny area.
//
// Read off the topology alone, as stepsBetween.ts reads a join: the faces
// the cut made, joined into groups by the edges they share — each place the
// cut went through — and a group under CUT_SHARE of the largest, or a
// cylinder's group on the axis of a larger one, named on the row. The build
// asks it after every cut (Builder.noteCutsElsewhere).

import type { Vec3 } from '../../../src/core/types'
import { dot, len, sub } from '../../../src/core/vec'
import type { EdgeInfo, FaceInfo } from './buildTypes'

/** A place a cut took material under this share of the largest place's
 *  area is likely not meant. */
const CUT_SHARE = 0.02
/** A cylinder's place on the axis of another place's cylinder of the same
 *  radius is likely not meant under this share of the other's area — two
 *  walls a bore goes through both are meant, of any sizes near enough. */
const COAXIAL_SHARE = 0.25
/** How far off parallel two cylinders' axes may lean, radians, and how far
 *  apart they may lie, mm, and still be one axis. */
const COAXIAL_ANGLE = Math.PI / 180
const COAXIAL_MM = 0.05
/** How many places are named, the smallest first. */
const NAMED = 3

/** A place a cut took material: its faces, by index, their area, and a
 *  point of it — the area-weighted middle of the faces' centroids. */
interface Place {
  faces: number[]
  area: number
  at: Vec3
}

/** A place the cut likely did not mean, with what says so: its area, and
 *  how far it lies from the rest of the cut — along the axis of the bore
 *  it is on, where it is on one. */
export interface CutElsewhere {
  at: Vec3
  area: number
  /** mm from the nearest face of the largest place, or along the bore's
   *  axis past its end. */
  off: number
  bore?: { radius: number }
}

/** The places among the faces the cut made (`made`) that it likely did
 *  not mean (see the head of this file), the smallest first. */
export function cutsElsewhere(faces: readonly FaceInfo[], edges: readonly EdgeInfo[], made: (face: FaceInfo) => boolean): CutElsewhere[] {
  const own = faces.map((f, i) => (made(f) ? i : -1)).filter((i) => i >= 0)
  if (own.length < 2) return []
  const index = new Map(own.map((i, j) => [faces[i].hash, j]))
  const parent = own.map((_, j) => j)
  const find = (j: number): number => (parent[j] === j ? j : (parent[j] = find(parent[j])))
  for (const e of edges) {
    const js = e.faces.map((h) => index.get(h)).filter((j): j is number => j !== undefined)
    for (let a = 1; a < js.length; a++) parent[find(js[a])] = find(js[0])
  }
  const byRoot = new Map<number, number[]>()
  own.forEach((i, j) => byRoot.set(find(j), [...(byRoot.get(find(j)) ?? []), i]))
  const places: Place[] = [...byRoot.values()].map((members) => {
    let area = 0
    const at: Vec3 = [0, 0, 0]
    for (const i of members) {
      const fp = faces[i].fingerprint
      area += fp.area
      for (let k = 0; k < 3; k++) at[k] += fp.area * fp.centroid[k]
    }
    return { faces: members, area, at: area > 0 ? (at.map((x) => x / area) as Vec3) : faces[members[0]].fingerprint.centroid }
  })
  if (places.length < 2) return []
  const largest = places.reduce((a, b) => (b.area > a.area ? b : a))
  const cylinders = (p: Place) => p.faces.map((i) => faces[i]).filter((f) => f.fingerprint.kind === 'cylinder' && f.fingerprint.radius !== undefined && f.fingerprint.center !== undefined)
  const out: CutElsewhere[] = []
  for (const p of places) {
    if (p === largest) continue
    // On the axis of a larger place's bore, of its radius: how far on
    // past the bore's end — a full turn's length is its area over its
    // girth, about its centroid on the axis.
    let bore: { radius: number; off: number } | null = null
    for (const c of cylinders(p)) {
      for (const q of places) {
        if (q === p || !(p.area < COAXIAL_SHARE * q.area)) continue
        for (const d of cylinders(q)) {
          const [cf, df] = [c.fingerprint, d.fingerprint]
          const r = df.radius!
          if (Math.abs(cf.radius! - r) > 1e-3 * Math.max(1, r)) continue
          const cos = Math.abs(dot(cf.dir, df.dir)) / (len(cf.dir) * len(df.dir) || 1)
          if (Math.acos(Math.min(1, cos)) > COAXIAL_ANGLE || offLine(cf.center!, df.center!, df.dir) > COAXIAL_MM) continue
          const t = Math.abs(dot(sub(p.at, df.centroid), df.dir)) / (len(df.dir) || 1)
          const half = d.fullTurn ? df.area / (2 * Math.PI * r) / 2 : 0
          bore = { radius: r, off: Math.max(0, t - half) }
        }
      }
    }
    if (bore) {
      out.push({ at: p.at, area: p.area, off: bore.off, bore: { radius: bore.radius } })
      continue
    }
    if (!(p.area < CUT_SHARE * largest.area)) continue
    let off = Infinity
    for (const i of largest.faces) off = Math.min(off, len(sub(p.at, faces[i].fingerprint.centroid)))
    out.push({ at: p.at, area: p.area, off })
  }
  return out.sort((a, b) => a.area - b.area)
}

/** How far a point lies from the line through `at` along `dir`. */
function offLine(p: Vec3, at: Vec3, dir: Vec3): number {
  const l = len(dir) || 1
  const d = sub(p, at)
  const along = dot(d, dir) / l
  return Math.sqrt(Math.max(0, dot(d, d) - along * along))
}

/** The places a cut likely did not mean as its row says them, or null for
 *  none: "Holes also cut at (20.35, −46.76, −68.83): 0.15 mm², 11.4 mm
 *  along the R2.25 bore's axis — meant? Shorten the extent." */
export function cutElsewhereWords(name: string, places: readonly CutElsewhere[], todo: string): string | null {
  if (places.length === 0) return null
  const r2 = (x: number) => Math.round(x * 100) / 100
  const area = (a: number) => (a < 0.01 ? a.toPrecision(2) : `${r2(a)}`)
  const said = places.slice(0, NAMED).map((p) => {
    // units-ok: build message, also the agent's answer
    const where = p.bore ? `${Math.round(p.off * 10) / 10} mm along the R${r2(p.bore.radius)} bore's axis` : `${Math.round(p.off * 10) / 10} mm from the rest of the cut`
    // units-ok: build message, also the agent's answer.
    return `(${p.at.map(r2).join(', ')}): ${area(p.area)} mm², ${where}`
  })
  const more = places.length > NAMED ? `, and ${places.length - NAMED} more` : ''
  return `${name} also cut at ${said.join('; ')}${more} — meant? ${todo}.`
}
