// SPDX-License-Identifier: AGPL-3.0-only
// A mesh as a binary PLY — how a scan changed in the Mesh Tools workspace is
// kept, in place of the file it came from. Indexed rather than an STL on
// purpose: a PLY is read back with its vertices in the order they were
// written (see parsers/ply), where an STL is a soup welded afresh on every
// reading. Everything marked on the scan by vertex — a hand-marked surface,
// a deviation map's scope, a fitted surface's region — names the vertices by
// that order, and has to find the same ones after a project is reopened or
// the worker restarted.
//
// Its winding is read back as written, too. The scan's was settled when the
// scan was opened, and every edit keeps it; guessed afresh, what is left of a
// scan after a delete — the top of a round wall with its inner face, open on
// every side — can look inside-out, and would be turned.

import { PLY_KEEP_WINDING } from '../../../src/core/parsers/ply'

/**
 * Little-endian, float coordinates, triangles as lists of three unsigned
 * ints. The comment goes into the header as one line, anything but
 * printable ASCII replaced, followed by the one that keeps the winding.
 */
export function buildBinaryPly(positions: Float32Array, indices: Uint32Array, comment?: string): Uint8Array {
  const vertexCount = positions.length / 3
  const faceCount = indices.length / 3
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    (comment ? `comment ${comment.replace(/[^\x20-\x7e]/g, '?')}\n` : '') +
    `comment ${PLY_KEEP_WINDING}\n` +
    `element vertex ${vertexCount}\n` +
    'property float x\n' +
    'property float y\n' +
    'property float z\n' +
    `element face ${faceCount}\n` +
    'property list uchar uint vertex_indices\n' +
    'end_header\n'
  const head = new TextEncoder().encode(header)
  const out = new Uint8Array(head.length + vertexCount * 12 + faceCount * 13)
  out.set(head)
  const dv = new DataView(out.buffer)
  let o = head.length
  for (let i = 0; i < positions.length; i++, o += 4) dv.setFloat32(o, positions[i], true)
  for (let t = 0; t < indices.length; t += 3) {
    out[o] = 3
    dv.setUint32(o + 1, indices[t], true)
    dv.setUint32(o + 5, indices[t + 1], true)
    dv.setUint32(o + 9, indices[t + 2], true)
    o += 13
  }
  return out
}
