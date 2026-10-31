// SPDX-License-Identifier: AGPL-3.0-only
// The numbers fitted to the scan this session, by feature and field (see
// reFit.ts): what the panel's rows and reverse.feature.list say were fitted,
// and what reverse.feature.refit fits again. Kept for the session only —
// the feature itself holds the number, as one typed.

import { create } from 'zustand'
import type { FitReading } from './reFit'

/** Moves on whenever a number is marked fitted or forgotten — for the
 *  panel's rows to draw again. */
export const useFitMarks = create<{ version: number }>(() => ({ version: 0 }))
const changed = () => useFitMarks.setState((s) => ({ version: s.version + 1 }))

/** What a fitted number was fitted from, for a refit: the input field it
 *  went into and, for an extrude's end, how it was asked for. */
export interface FitMark extends FitReading {
  /** For an extrude's end: the toScan extent asked for. */
  spec?: Record<string, unknown>
}

/** The numbers fitted this session, by feature id, by field. */
export const marks = new Map<number, Record<string, FitMark>>()

/** A field's number on a feature as it stands: `extent.to` a path. */
function numberAt(feature: unknown, field: string): unknown {
  return field.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), feature)
}

/** What was fitted of a feature this session, by field — null for none.
 *  With the feature as it stands, a field whose number is no longer the
 *  one fitted (set by hand, undone, another project's feature under the
 *  same id) is forgotten. */
export function fittedOf(id: number, feature?: unknown): Record<string, FitReading> | null {
  const m = marks.get(id)
  if (!m) return null
  if (feature !== undefined) {
    for (const [field, mark] of Object.entries(m)) {
      const now = numberAt(feature, field)
      if (typeof now !== 'number' || Math.abs(now - mark.value) > 1e-6) delete m[field]
    }
    if (Object.keys(m).length === 0) {
      marks.delete(id)
      return null
    }
  }
  return m
}

/** Remember what a feature's numbers were fitted from. */
export function markFitted(id: number, fitted: Record<string, FitMark>): void {
  if (Object.keys(fitted).length === 0) return
  marks.set(id, { ...(marks.get(id) ?? {}), ...fitted })
  changed()
}

/** Forget a fitted number — the field set by hand since. */
export function unmarkFitted(id: number, fields: readonly string[]): void {
  const m = marks.get(id)
  if (!m) return
  const had = Object.keys(m).length
  for (const f of fields) delete m[f]
  if (Object.keys(m).length === 0) marks.delete(id)
  if (Object.keys(m).length !== had) changed()
}

