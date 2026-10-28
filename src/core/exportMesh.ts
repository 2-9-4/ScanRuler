// SPDX-License-Identifier: AGPL-3.0-only
// A mesh out of the tool in the format asked for: a binary STL (exportStl),
// which every program reads but which says nothing of its units, or a 3MF
// (export3mf), which says millimetres and keeps a part's colours and its
// parts apart.

import { build3mf, type MeshPart } from './export3mf'
import { buildBinaryStl } from './exportStl'
import type { Rigid } from './deviation/rigid'

export type MeshFormat = 'stl' | '3mf'
export const MESH_FORMATS: readonly MeshFormat[] = ['stl', '3mf']

export const MESH_FORMAT_LABEL: Record<MeshFormat, string> = { stl: 'STL', '3mf': '3MF' }

export interface MeshFile {
  bytes: Uint8Array
  mimeType: string
  /** The file name's ending, without the dot. */
  extension: MeshFormat
  triangles: number
}

/** The parts in one file. An STL has no parts: theirs are written one after
 *  another, as one mesh, and their colours are dropped. `transform` is
 *  applied on the way out; `title` is the STL's header, the 3MF's title.
 *  Null with no triangle to write. */
export function buildMeshFile(format: MeshFormat, parts: readonly MeshPart[], transform: Rigid | null, title: string): MeshFile | null {
  if (format === '3mf') {
    const built = build3mf(parts, transform, title)
    return built && { bytes: built.bytes, mimeType: 'model/3mf', extension: '3mf', triangles: built.triangles }
  }
  const one = parts.length === 1 ? parts[0] : mergeParts(parts)
  const triangles = Math.floor((one.indices ? one.indices.length : one.positions.length / 3) / 3)
  if (triangles === 0) return null
  return {
    bytes: new Uint8Array(buildBinaryStl(one.positions, one.indices, transform, title)),
    mimeType: 'model/stl',
    extension: 'stl',
    triangles,
  }
}

/** Several parts as one indexed mesh. */
function mergeParts(parts: readonly MeshPart[]): MeshPart {
  const vertexCount = parts.reduce((n, p) => n + p.positions.length / 3, 0)
  const cornerCount = parts.reduce((n, p) => n + (p.indices ? p.indices.length : p.positions.length / 3), 0)
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(cornerCount)
  let v = 0
  let c = 0
  for (const p of parts) {
    positions.set(p.positions, v * 3)
    const corners = p.indices ? p.indices.length : p.positions.length / 3
    for (let i = 0; i < corners; i++) indices[c + i] = v + (p.indices ? p.indices[i] : i)
    v += p.positions.length / 3
    c += corners
  }
  return { name: 'merged', positions, indices }
}
