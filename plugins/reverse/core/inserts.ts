// SPDX-License-Identifier: AGPL-3.0-only
// Heat-set threaded inserts, as the Hole feature sizes a hole for one: the
// CNC Kitchen range, by the dimensions its tables give — the hole's
// diameter (D3), the insert's length and the least wall (W) to leave round
// it. The hole is made a millimetre deeper than the insert is long, for the
// plastic it pushes ahead of it.

export interface InsertSize {
  /** As the range names it: "M3", "M3 short". */
  label: string
  /** The insert's length, mm. */
  length: number
  /** The hole it is pressed into, mm. */
  hole: number
  /** The least wall round the hole, mm. */
  wall: number
}

export const INSERT_SIZES: readonly InsertSize[] = [
  { label: 'M2', length: 3.0, hole: 3.2, wall: 1.3 },
  { label: 'M2.5', length: 4.0, hole: 4.0, wall: 1.6 },
  { label: 'M3', length: 5.7, hole: 4.0, wall: 1.6 },
  { label: 'M3 short', length: 3.0, hole: 4.0, wall: 1.6 },
  { label: 'M3 Voron', length: 4.0, hole: 4.4, wall: 1.3 },
  { label: 'M4', length: 8.1, hole: 5.6, wall: 2.1 },
  { label: 'M4 short', length: 4.0, hole: 5.6, wall: 2.1 },
  { label: 'M5', length: 9.5, hole: 6.4, wall: 2.6 },
  { label: 'M5 short', length: 5.8, hole: 6.4, wall: 2.6 },
  { label: 'M6', length: 12.7, hole: 8.0, wall: 3.3 },
  { label: 'M8', length: 12.7, hole: 9.7, wall: 3.3 },
  { label: '1/4"-20', length: 12.7, hole: 8.0, wall: 3.3 },
]

/** How much deeper than the insert the hole is made, mm. */
const INSERT_EXTRA_DEPTH_MM = 1

/** An insert by its label, case and spaces aside. */
export function insertSize(label: string): InsertSize | undefined {
  const want = label.trim().toLowerCase().replace(/\s+/g, ' ')
  return INSERT_SIZES.find((s) => s.label.toLowerCase() === want)
}

/** The hole an insert takes: its radius and its depth. */
export function insertHole(size: InsertSize): { radius: number; depth: number } {
  return { radius: size.hole / 2, depth: Math.round((size.length + INSERT_EXTRA_DEPTH_MM) * 100) / 100 }
}
