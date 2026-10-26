// SPDX-License-Identifier: AGPL-3.0-only
// Where a seed lies against the surface a fit found from it and others: how
// far off the surface, along its normal there, and how far the seed's own
// normal turns from that one — what tells a click on another surface, which
// grew nothing, from one at the rim of the region the fit grew.

import type { FitData, Vec3 } from '../types'
import { coneNormalAlign, coneResidual } from './cone'
import { torusNormalAlign, torusResidual } from './torus'

/** The angle a |cos| stands for, degrees. */
const degOf = (cos: number) => (Math.acos(Math.min(1, Math.abs(cos))) * 180) / Math.PI

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** `offMm`: the seed's distance off the surface, along the surface's normal
 *  — a plane's as the fit gives it, a round surface's outward from its axis
 *  or centre. `deg`: the turn between the seed's normal and the surface's
 *  there, 0 to 90, either way round. Null for a kind with no surface, and
 *  on an axis or a centre, where the surface has no normal to say. */
export function seedOff(fit: FitData, point: Vec3, normal: Vec3): { offMm: number; deg: number } | null {
  const len = Math.hypot(normal[0], normal[1], normal[2])
  if (!(len > 0)) return null
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len]
  const [x, y, z] = point
  if (fit.kind === 'plane') return { offMm: dot([x - fit.center[0], y - fit.center[1], z - fit.center[2]], fit.normal), deg: degOf(dot(n, fit.normal)) }
  if (fit.kind === 'sphere') {
    const d = [x - fit.center[0], y - fit.center[1], z - fit.center[2]]
    const r = Math.hypot(d[0], d[1], d[2])
    return r > 1e-12 ? { offMm: r - fit.radius, deg: degOf(dot(d, n) / r) } : null
  }
  if (fit.kind === 'cylinder') {
    const d = [x - fit.center[0], y - fit.center[1], z - fit.center[2]]
    const t = dot(d, fit.axis)
    const w = [d[0] - t * fit.axis[0], d[1] - t * fit.axis[1], d[2] - t * fit.axis[2]]
    const rho = Math.hypot(w[0], w[1], w[2])
    return rho > 1e-12 ? { offMm: rho - fit.radius, deg: degOf(dot(w, n) / rho) } : null
  }
  if (fit.kind === 'cone') {
    const c = { px: fit.center[0], py: fit.center[1], pz: fit.center[2], ax: fit.axis[0], ay: fit.axis[1], az: fit.axis[2], r: fit.radius, phi: (fit.halfAngle * Math.PI) / 180 }
    const off = coneResidual(c, x, y, z)
    return Number.isFinite(off) ? { offMm: off, deg: degOf(coneNormalAlign(c, x, y, z, n[0], n[1], n[2])) } : null
  }
  if (fit.kind === 'torus') {
    const t = { cx: fit.center[0], cy: fit.center[1], cz: fit.center[2], ax: fit.axis[0], ay: fit.axis[1], az: fit.axis[2], R: fit.majorRadius, r: fit.minorRadius }
    return { offMm: torusResidual(t, x, y, z), deg: degOf(torusNormalAlign(t, x, y, z, n[0], n[1], n[2])) }
  }
  return null
}
