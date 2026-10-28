// SPDX-License-Identifier: AGPL-3.0-only
// 3MF export: the mesh as a 3D Manufacturing Format package — a zip holding
// one XML model in millimetres, which the slicers and most mesh editors open
// without asking what unit the numbers are in, as they must for an STL.
//
// A 3MF mesh is indexed and has to be closed where the part is: every edge
// shared by exactly two triangles. The meshes handed out here are not always
// laid out that way — the scan's render mesh splits a vertex wherever a sharp
// edge is shaded, a CAD body comes as a mesh per face — so the vertices are
// welded where they coincide exactly before they are written, and a triangle
// the weld collapses is left out (the format allows none with a repeated
// corner).
//
// Each part is an object of its own in the one model; a part with its own
// colours — a textured scan's — carries them as a colour group, one colour
// per corner (the materials extension, which a reader without it passes
// over).

import { zipSync } from 'fflate'
import { rigidApplyToPoints, type Rigid } from './deviation/rigid'

/** A mesh to write: `positions` xyz per vertex in millimetres, `indices`
 *  three per triangle — or null when the positions run one triangle after
 *  another — and, if it has them, its colours, three sRGB bytes per
 *  vertex. */
export interface MeshPart {
  name: string
  positions: Float32Array
  indices: Uint32Array | Uint16Array | null
  colors?: Uint8Array | null
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
  '</Types>\n'

const MODEL_PATH = '3D/3dmodel.model'

const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Target="/${MODEL_PATH}" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
  '</Relationships>\n'

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
const MATERIAL_NS = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02'

export const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/** A coordinate to a hundred-thousandth of a millimetre — far under what a
 *  float32 vertex holds at a part's size — with no trailing zeros. */
const num = (x: number) => String(Math.round(x * 1e5) / 1e5)

/** A part's mesh with coincident vertices made one: the vertices kept, and
 *  for each triangle that still has three distinct corners the three kept
 *  vertices; `first` names, per kept vertex, the vertex of the part it was
 *  first seen as (where its colour is read). */
export function weldExact(positions: Float32Array, indices: Uint32Array | Uint16Array | null): { vertices: Float32Array; triangles: Uint32Array; first: Uint32Array } {
  const count = positions.length / 3
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length)
  // Open addressing on the three coordinates' bits, -0 taken as 0.
  let size = 1
  while (size < count * 2) size <<= 1
  const table = new Int32Array(size).fill(-1)
  const map = new Uint32Array(count)
  const first: number[] = []
  const key = (i: number, k: number) => {
    const b = bits[i * 3 + k]
    return b === 0x80000000 ? 0 : b
  }
  for (let i = 0; i < count; i++) {
    const a = key(i, 0)
    const b = key(i, 1)
    const c = key(i, 2)
    let slot = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & (size - 1)
    for (;;) {
      const at = table[slot]
      if (at < 0) {
        table[slot] = first.length
        map[i] = first.length
        first.push(i)
        break
      }
      const j = first[at]
      if (key(j, 0) === a && key(j, 1) === b && key(j, 2) === c) {
        map[i] = at
        break
      }
      slot = (slot + 1) & (size - 1)
    }
  }
  const vertices = new Float32Array(first.length * 3)
  for (let v = 0; v < first.length; v++) {
    vertices[v * 3] = positions[first[v] * 3]
    vertices[v * 3 + 1] = positions[first[v] * 3 + 1]
    vertices[v * 3 + 2] = positions[first[v] * 3 + 2]
  }
  const corners = indices ? indices.length - (indices.length % 3) : count - (count % 3)
  const triangles = new Uint32Array(corners)
  let n = 0
  for (let t = 0; t < corners; t += 3) {
    const a = map[indices ? indices[t] : t]
    const b = map[indices ? indices[t + 1] : t + 1]
    const c = map[indices ? indices[t + 2] : t + 2]
    if (a === b || b === c || a === c) continue
    triangles[n++] = a
    triangles[n++] = b
    triangles[n++] = c
  }
  return { vertices, triangles: triangles.slice(0, n), first: Uint32Array.from(first) }
}

/** Text written a batch of lines at a time, so a scan of millions of
 *  triangles never becomes one string. */
class Chunks {
  private readonly encoder = new TextEncoder()
  private readonly done: Uint8Array[] = []
  private lines: string[] = []
  push(text: string): void {
    this.lines.push(text)
    if (this.lines.length >= 65536) this.flush()
  }
  private flush(): void {
    if (this.lines.length === 0) return
    this.done.push(this.encoder.encode(this.lines.join('')))
    this.lines = []
  }
  bytes(): Uint8Array {
    this.flush()
    const out = new Uint8Array(this.done.reduce((n, d) => n + d.length, 0))
    let at = 0
    for (const d of this.done) {
      out.set(d, at)
      at += d.length
    }
    return out
  }
}

const hex = (r: number, g: number, b: number) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()

/** A 3MF of the parts, each an object of its own, in millimetres.
 *  `transform` is applied to every vertex on the way out, as for the STL
 *  (see exportStl); `title` goes in the model's metadata. With the file,
 *  how many triangles it holds — what is left after the weld. Null when no
 *  part has a triangle left to write. */
export function build3mf(parts: readonly MeshPart[], transform: Rigid | null, title: string): { bytes: Uint8Array; triangles: number } | null {
  const welded = parts
    .map((part) => {
      let xyz = part.positions
      if (transform) {
        xyz = new Float32Array(part.positions)
        rigidApplyToPoints(transform, xyz)
      }
      return { part, ...weldExact(xyz, part.indices) }
    })
    .filter((w) => w.triangles.length > 0)
  if (welded.length === 0) return null
  const coloured = welded.some((w) => w.part.colors && w.part.colors.length >= (w.part.positions.length / 3) * 3)

  const out = new Chunks()
  out.push('<?xml version="1.0" encoding="UTF-8"?>\n')
  out.push(`<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}"${coloured ? ` xmlns:m="${MATERIAL_NS}"` : ''}>\n`)
  out.push(`<metadata name="Title">${escapeXml(title)}</metadata>\n`)
  out.push('<metadata name="Application">ScanRuler</metadata>\n')
  out.push('<resources>\n')
  let nextId = 1
  const objectIds: number[] = []
  for (const w of welded) {
    const colors = w.part.colors && w.part.colors.length >= (w.part.positions.length / 3) * 3 ? w.part.colors : null
    // Each kept vertex's colour, as an entry of the part's colour group —
    // one entry per distinct colour.
    let groupId = 0
    let entry: Uint32Array | null = null
    if (colors) {
      groupId = nextId++
      entry = new Uint32Array(w.first.length)
      const index = new Map<number, number>()
      const table: string[] = []
      for (let v = 0; v < w.first.length; v++) {
        const o = w.first[v] * 3
        const rgb = (colors[o] << 16) | (colors[o + 1] << 8) | colors[o + 2]
        let e = index.get(rgb)
        if (e === undefined) {
          e = table.length
          index.set(rgb, e)
          table.push(`<m:color color="${hex(colors[o], colors[o + 1], colors[o + 2])}"/>`)
        }
        entry[v] = e
      }
      out.push(`<m:colorgroup id="${groupId}">\n`)
      for (const t of table) out.push(t + '\n')
      out.push('</m:colorgroup>\n')
    }
    const id = nextId++
    objectIds.push(id)
    out.push(`<object id="${id}" type="model" name="${escapeXml(w.part.name)}"${entry ? ` pid="${groupId}" pindex="${entry[0]}"` : ''}>\n<mesh>\n<vertices>\n`)
    const v = w.vertices
    for (let i = 0; i < v.length; i += 3) out.push(`<vertex x="${num(v[i])}" y="${num(v[i + 1])}" z="${num(v[i + 2])}"/>\n`)
    out.push('</vertices>\n<triangles>\n')
    const t = w.triangles
    for (let i = 0; i < t.length; i += 3) {
      out.push(
        entry
          ? `<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}" p1="${entry[t[i]]}" p2="${entry[t[i + 1]]}" p3="${entry[t[i + 2]]}"/>\n`
          : `<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>\n`,
      )
    }
    out.push('</triangles>\n</mesh>\n</object>\n')
  }
  out.push('</resources>\n<build>\n')
  for (const id of objectIds) out.push(`<item objectid="${id}"/>\n`)
  out.push('</build>\n</model>\n')

  const encode = (s: string) => new TextEncoder().encode(s)
  // The fastest deflate: on a scan's model a third of the time of the
  // default level, for a file a few per cent larger.
  const bytes = zipSync({
    '[Content_Types].xml': encode(CONTENT_TYPES),
    '_rels/.rels': encode(RELS),
    [MODEL_PATH]: [out.bytes(), { level: 1 }],
  })
  return { bytes, triangles: welded.reduce((n, w) => n + w.triangles.length / 3, 0) }
}
