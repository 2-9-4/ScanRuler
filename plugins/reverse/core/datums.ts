// SPDX-License-Identifier: AGPL-3.0-only
// The part's three coordinate planes as a sketch sees them.
//
// A sketch lies on a plane of its own, and its sheet's zero is wherever that
// plane's frame put it — under the part's centre for a coordinate plane,
// on the clicked face for a fitted one — so the sheet's axes are not the
// part's. What a drawing is dimensioned from are the part's own planes: the
// XY, YZ and XZ planes through the origin the alignment set. Each of them
// cuts the sketch plane in a line (or runs parallel to it and cuts it
// nowhere); that line is the plane's *trace*, and a dimension to the plane
// is the distance of a point from the trace, measured in the sheet.
//
// The traces are never stored: they follow from the sketch's frame, which
// moves with the part under an alignment while the planes stay, so whoever
// solves or draws a sketch works them out from the frame it has.

import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'

export type DatumPlane = 'xy' | 'yz' | 'zx'

export const DATUM_PLANES: readonly { plane: DatumPlane; name: string; normal: Vec3 }[] = [
  { plane: 'xy', name: 'XY plane', normal: [0, 0, 1] },
  { plane: 'yz', name: 'YZ plane', normal: [1, 0, 0] },
  { plane: 'zx', name: 'XZ plane', normal: [0, 1, 0] },
]

export function datumName(plane: DatumPlane): string {
  return DATUM_PLANES.find((p) => p.plane === plane)?.name ?? plane
}

/** A coordinate plane's line in the sheet: the points with n · p + d = 0,
 *  `n` a unit vector, so n · p + d is a point's signed distance from it. */
export interface DatumTrace {
  plane: DatumPlane
  n: Vec2
  d: number
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The traces of the coordinate planes in a sketch's sheet. A plane the
 *  sketch lies parallel to has none. */
export function datumTraces(frame: SectionFrame): DatumTrace[] {
  const out: DatumTrace[] = []
  // A frame that is not whole has no planes to show — and is not this
  // function's to fail on: it is asked on every solve.
  if (!frame?.origin || !frame.basisU || !frame.basisV) return out
  for (const { plane, normal } of DATUM_PLANES) {
    // A sheet point (u, v) stands at origin + u·U + v·V; on the plane where
    // that has no component along the plane's normal.
    const a = dot3(frame.basisU, normal)
    const b = dot3(frame.basisV, normal)
    const l = Math.hypot(a, b)
    if (l < 1e-6) continue
    out.push({ plane, n: [a / l, b / l], d: dot3(frame.origin, normal) / l })
  }
  return out
}

export function traceOf(traces: readonly DatumTrace[] | undefined, plane: DatumPlane): DatumTrace | null {
  return traces?.find((t) => t.plane === plane) ?? null
}

/** A point's signed distance from a trace. */
export function traceOffset(t: DatumTrace, p: Vec2): number {
  return t.n[0] * p[0] + t.n[1] * p[1] + t.d
}

/** The foot of a point on a trace. */
export function traceFoot(t: DatumTrace, p: Vec2): Vec2 {
  const off = traceOffset(t, p)
  return [p[0] - off * t.n[0], p[1] - off * t.n[1]]
}

/** The trace within reach of a spot, the nearest where several are —
 *  what a click on the bare sheet picks, a dimension's or a mirror line. */
export function traceNear(traces: readonly DatumTrace[], spot: Vec2, radius: number): DatumTrace | null {
  let best: DatumTrace | null = null
  let bestD = radius
  for (const t of traces) {
    const d = Math.abs(traceOffset(t, spot))
    if (d <= bestD) {
      bestD = d
      best = t
    }
  }
  return best
}

/** The trace as a line is given elsewhere in the sketch: a point on it and
 *  its unit direction. */
export function traceLine(t: DatumTrace): { a: Vec2; d: Vec2 } {
  return { a: [-t.d * t.n[0], -t.d * t.n[1]], d: [-t.n[1], t.n[0]] }
}

/** A stretch of the trace to draw: `half` either way of the foot of `near`. */
export function traceSegment(t: DatumTrace, near: Vec2, half: number): [Vec2, Vec2] {
  const foot = traceFoot(t, near)
  const dir: Vec2 = [-t.n[1], t.n[0]]
  return [
    [foot[0] - dir[0] * half, foot[1] - dir[1] * half],
    [foot[0] + dir[0] * half, foot[1] + dir[1] * half],
  ]
}
