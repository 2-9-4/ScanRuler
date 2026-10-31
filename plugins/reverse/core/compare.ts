// SPDX-License-Identifier: AGPL-3.0-only
// Compare in Deviation: the bodies handed to the Deviation workspace as its
// reference, for the report.
//
// The live map inside the workspace is for steering; the Deviation
// workspace is where a map gets its scale, its histogram, its pins and its
// clipboard report. The bodies go there as a mesh, written as a binary STL
// and read back through the door every reference part comes in by — so the
// reference is welded, signed and drawn as any other, and a saved project
// carries it as the file it is. No best fit is run: the bodies were built
// on this scan, in its frame, and a best fit would hide exactly the offset
// the comparison is there to show. The alignment is the identity, and says
// so under its own name.

import { buildBinaryStl } from '../../../src/core/exportStl'
import { wantedSpacing } from '../../../src/core/deviation/onReference'
import { meshDeflection } from './buildTypes'
import type { KernelMesh } from './kernel'

/** The name the reference carries in the Deviation workspace and in the
 *  report. */
export const COMPARE_REFERENCE_NAME = 'Bodies from Reverse engineer.stl'

/** The chord the bodies are meshed to for the comparison, millimetres. The
 *  viewport's own meshes follow the body's size up to a tenth of a
 *  millimetre, which is fine to look at and too coarse to measure against:
 *  the chord is a systematic term in every reading on a curved face. */
export const COMPARE_CHORD_MM = 0.01

/** The map the other way round — the bodies read against the scan — cuts
 *  them into readings about its spacing apart (twice the tolerance, at least
 *  a quarter of a millimetre) whatever mesh it is given: a mesh as fine as
 *  COMPARE_CHORD_MM only adds readings where its triangles are smaller than
 *  that, every one of them read against the scan. Its own mesh may be
 *  coarser: a chord of a fifth of the tolerance, and no more than a quarter
 *  of the spacing, is a term of the readings well within the tolerance. */
export const MAP_CHORD_PER_TOLERANCE = 0.2

/** The chord the bodies may be meshed to for the map on them at a
 *  tolerance, mm. */
export function mapChord(tolerance: number): number {
  return Math.max(COMPARE_CHORD_MM, Math.min(wantedSpacing(tolerance) / 4, tolerance * MAP_CHORD_PER_TOLERANCE))
}

/** The tolerance from which the viewport's meshes of the bodies — never
 *  coarser than a chord of meshDeflection's cap — serve as the mesh of the
 *  map on them, and the map spacing that tolerance asks for: maps at that
 *  spacing or a coarser one read those meshes as they are, no meshing; a
 *  finer one reads the comparison's own mesh. */
export const VIEW_MESH_MAP_TOLERANCE = meshDeflection(Infinity) / MAP_CHORD_PER_TOLERANCE
export const VIEW_MESH_MAP_SPACING = wantedSpacing(VIEW_MESH_MAP_TOLERANCE)

/** Several meshes as one, the indices moved along. */
export function mergeMeshes(meshes: readonly Pick<KernelMesh, 'positions' | 'indices'>[]): { positions: Float32Array; indices: Uint32Array } {
  let vertices = 0
  let corners = 0
  for (const m of meshes) {
    vertices += m.positions.length / 3
    corners += m.indices.length
  }
  const positions = new Float32Array(vertices * 3)
  const indices = new Uint32Array(corners)
  let v = 0
  let c = 0
  for (const m of meshes) {
    positions.set(m.positions, v * 3)
    for (let i = 0; i < m.indices.length; i++) indices[c + i] = m.indices[i] + v
    v += m.positions.length / 3
    c += m.indices.length
  }
  return { positions, indices }
}

/** The bodies' meshes as the bytes of a binary STL, or null with no
 *  triangle among them. */
export function compareReferenceStl(meshes: readonly Pick<KernelMesh, 'positions' | 'indices'>[]): ArrayBuffer | null {
  const merged = mergeMeshes(meshes)
  if (merged.indices.length < 3) return null
  return buildBinaryStl(merged.positions, merged.indices, null, 'ScanRuler - bodies from Reverse engineer')
}

export { builtAlignment } from '../../../src/core/deviation/align'
