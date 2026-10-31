// SPDX-License-Identifier: AGPL-3.0-only
// Why a sheet does not thicken: a face of it that offsets by less than the
// thickness on its own — it bends tighter than that towards the side the
// solid grows to, where the far skin folds over itself, or the kernel
// refuses its offset — named the way a failed offset names its faces
// (diagnose.ts). The kernel's thickening folds such a face without a word,
// so the builder asks this before it thickens, not only after a failure.

import type { Vec3 } from '../../../src/core/types'
import { type Body, type Diagnosis, diagonalOf, meshDeflection } from './buildTypes'
import type { ThickenSide } from './features'
import type { ReKernel } from './kernel'
import { isTrap } from './kernelOps'
import type { FaceOffsetLimit } from './kernelShell'
import type { ThickenWall } from './kernelThicken'

/** At most this many faces are named. */
const NAMED = 3

// units-ok: build message, also the agent's answer
const mm = (v: number) => `${Math.round(v * 100) / 100} mm`
const point = (p: Vec3) => `(${p.map((v) => Math.round(v * 100) / 100).join(', ')})`

/** A surface as a sentence names it. */
function surfaceName(kind: string): string {
  const names: Record<string, string> = { bspline: 'B-spline', bezier: 'Bézier', offset: 'offset surface', revolution: 'surface of revolution', extrusion: 'extruded surface' }
  return names[kind] ?? kind
}

/** How far under the thickness the wall along the sheet's edge may come
 *  and still be said to be the thickness: a fiftieth. */
const WALL_SHORT = 0.02

/** What a thicken's result says of the wall along the sheet's edge: a
 *  note where it is the thickness, a warning where it comes short of it. */
export function wallSaid(wall: ThickenWall, thickness: number): { note: string } | { warning: string } {
  if (wall.least >= thickness * (1 - WALL_SHORT)) return { note: `The wall along the sheet's edge is ${mm(wall.least)} at its thinnest, measured at ${wall.points} points.` }
  return { warning: `The wall along the sheet's edge comes to ${mm(wall.least)} at ${point(wall.at)}, under the ${mm(thickness)} asked (measured at ${wall.points} points): the kernel cut the wall short there, or the far skin comes back near it.` }
}

/** Which way a sheet is thickened, as a sentence says it. */
export function thickenWay(side: ThickenSide): string {
  return side === 'out' ? 'along its normal' : side === 'in' ? 'against its normal' : 'both ways'
}

/**
 * The faces of a sheet that keep it from thickening by `thickness` the
 * way asked: each face offset alone towards the side the solid grows to —
 * by the thickness, or by half of it each way for both — and those that
 * go less far named, the nearest to nothing first, with the thickness
 * each takes, the point where it bends tightest, and its outline and a
 * cross to draw red. Null when every face takes it. `upTo` is the largest
 * thickness all the faces named take.
 */
export function thickenFolds(kernel: ReKernel, sheet: Body, thickness: number, side: ThickenSide): (Diagnosis & { upTo: number }) | null {
  const t = thickness
  const distances = side === 'out' ? [t] : side === 'in' ? [-t] : [t / 2, -t / 2]
  // Each face once, at the side it reaches least far to — as a thickness.
  const worst = new Map<number, { face: FaceOffsetLimit; upTo: number; d: number }>()
  for (const d of distances) {
    let probe: { faces: FaceOffsetLimit[]; curved: number }
    try {
      probe = kernel.faceOffsetLimits(sheet.shape, d)
    } catch (e) {
      // The probe failing itself has nothing to add — but a kernel that
      // trapped is asked nothing more.
      if (isTrap(e)) throw e
      continue
    }
    const scale = t / Math.abs(d)
    for (const f of probe.faces) {
      if (!(f.upTo < Math.abs(d) * (1 - 1e-6))) continue
      const upTo = f.upTo * scale
      const was = worst.get(f.hash)
      if (!was || upTo < was.upTo) worst.set(f.hash, { face: f, upTo, d })
    }
  }
  if (worst.size === 0) return null
  const failing = [...worst.values()].sort((a, b) => a.upTo - b.upTo)
  const faces = kernel.faces(sheet.shape)
  const indexOf = new Map(faces.map((f, i) => [f.hash, i]))
  const name = (f: FaceOffsetLimit) => {
    const made = sheet.origins.get(f.hash)
    return `face ${indexOf.get(f.hash) ?? '?'} (${surfaceName(f.surface)}${made !== undefined ? `, made by feature ${made}` : ''})`
  }
  // A face bending tighter than it is asked to go is named by its bend,
  // whether the kernel's offset of it stops there or a little short.
  const folds = (f: FaceOffsetLimit, d: number) => f.bend !== null && f.bend.radius < Math.abs(d) * (1 - 1e-6)
  const towards = (d: number) => (d > 0 ? 'the side its normal points to' : 'the side against its normal')
  const how = ({ face: f, d }: (typeof failing)[number]) =>
    folds(f, d) ? `it bends at a radius of ${mm(f.bend!.radius)} towards ${towards(d)} at ${point(f.bend!.at)}, where the far skin folds over itself` : `the kernel refuses its offset past that${f.refused ? ` (${f.refused})` : ''}`
  const named = failing.slice(0, NAMED).map((x) => `${name(x.face)} by ${mm(x.upTo)} at most — ${how(x)}`)
  const more = failing.length > named.length ? `; and ${failing.length - named.length} more` : ''
  const n = failing.length
  const upTo = failing[0].upTo
  const can = upTo > 0 ? `It thickens ${thickenWay(side)} by up to ${mm(upTo)}${side === 'both' ? '' : '; or thicken it the other way, or both ways'}.` : `It does not thicken ${thickenWay(side)} at any thickness.`
  const message = `The sheet does not thicken ${thickenWay(side)} by ${mm(t)}: ${n === 1 ? 'a face of it takes' : `${n} faces of it take`} less alone: ${named.join('; ')}${more} — outlined red on the part. ${can}`
  const hashes = new Set(failing.map((x) => x.face.hash))
  const outlines = kernel
    .edges(sheet.shape, meshDeflection(diagonalOf(kernel, sheet.shape)))
    .filter((e) => e.faceHashes.some((h) => hashes.has(h)) && e.polyline.length >= 6)
    .map((e) => e.polyline)
  // A cross through the tightest point, along the axes, as wide as the
  // thickness or a fiftieth of the sheet.
  const r = Math.max(t, diagonalOf(kernel, sheet.shape) * 0.02)
  const crosses = failing
    .filter((x) => folds(x.face, x.d))
    .map(({ face }) => {
      const [x, y, z] = face.bend!.at
      return Float32Array.from([x - r, y, z, x + r, y, z, x, y, z, x, y - r, z, x, y + r, z, x, y, z, x, y, z - r, x, y, z + r])
    })
  return { message, where: [...outlines, ...crosses], upTo }
}
