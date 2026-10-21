// SPDX-License-Identifier: AGPL-3.0-only
// The scan points a command left marked for the next one: the region
// element.fit grew (mark: true), a region scan.segment found (mark: id). A
// caller hands them on with `marked: true` — element.fit_marked fits to them
// — instead of sending the vertex list out and back. Kept apart from the
// panels' marking: nothing is drawn and no tool is in the hand, and it lasts
// until the next mark, or until another scan is opened.

import { commandHost } from './host'
import { CommandError } from './types'

interface Marked {
  vertices: Uint32Array
  /** What marked them — "element.fit Plane 2", "scan.segment region 3". */
  from: string
  scanVersion: number
}

let marked: Marked | null = null

const scanVersion = (): number => commandHost().session.clientRef.current?.scanVersion ?? -1

/** Leave these points marked; returns what the answer says of it. */
export function setMarked(vertices: Uint32Array, from: string): { points: number; from: string } {
  marked = { vertices: Uint32Array.from(vertices), from, scanVersion: scanVersion() }
  return { points: vertices.length, from }
}

/** The points marked on the scan as it stands, or null. */
export function markedPoints(): { vertices: Uint32Array; from: string } | null {
  if (!marked) return null
  if (marked.scanVersion !== scanVersion()) {
    marked = null
    return null
  }
  return { vertices: marked.vertices, from: marked.from }
}

/** The marked points, or a refusal saying how to mark some. */
export function requireMarked(): { vertices: Uint32Array; from: string } {
  const m = markedPoints()
  if (!m) throw new CommandError('invalid_state', 'Nothing is marked — element.fit { mark: true } or scan.segment { mark: <region id> } marks a region.')
  return m
}
