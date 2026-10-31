// SPDX-License-Identifier: AGPL-3.0-only
// What the operator can set about Fit all chains — the options window's
// fields, kept as a preference so the next sketch fits the way the last did.

export interface FitOptions {
  /** 0 coarse … 1 fine — see segment.ts, detailLevels. */
  detail: number
  /** Whether the fit joins the corners it finds straight away, so a closed
   *  slice comes out a closed profile in one step. */
  joinCorners: boolean
  /** Whether lines near the sheet's axes are laid along them, and how near
   *  is near, degrees — see axisAlign.ts. */
  alignAxes: boolean
  alignDiagonals: boolean
  alignDegrees: number
  /** Each chain as this many arcs end to end (segment.ts, arcsOfChain) in
   *  place of the cut — an agent's ask for one fit, never stored. */
  arcs?: number
  /** Each chain as one spline through this many fit points, settled onto
   *  the slice — the same kind of ask. */
  spline?: number
}

export const DEFAULT_FIT_OPTIONS: FitOptions = {
  detail: 0.5,
  joinCorners: true,
  alignAxes: false,
  alignDiagonals: false,
  alignDegrees: 3,
}

/** Whatever was stored, made a valid set of options. */
export function sanitizeFitOptions(raw: unknown): FitOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof FitOptions, unknown>>
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  return {
    detail: num(r.detail, 0, 1, DEFAULT_FIT_OPTIONS.detail),
    joinCorners: bool(r.joinCorners, DEFAULT_FIT_OPTIONS.joinCorners),
    alignAxes: bool(r.alignAxes, DEFAULT_FIT_OPTIONS.alignAxes),
    alignDiagonals: bool(r.alignDiagonals, DEFAULT_FIT_OPTIONS.alignDiagonals),
    alignDegrees: num(r.alignDegrees, 0.5, 10, DEFAULT_FIT_OPTIONS.alignDegrees),
  }
}
