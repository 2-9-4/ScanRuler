// SPDX-License-Identifier: AGPL-3.0-only
// The scan and a solid made one: the solid taken out of the scan, added to
// it, or only what the two have in common kept — a bore the scanner could not
// see to the bottom of cut out with a cylinder fitted where it could, a boss
// put back, a part trimmed to a box. Several solids go as one, their union:
// every bore of a flange taken out in one edit, the part trimmed to what any
// of two boxes holds.
//
// The boolean itself is Manifold's (Apache-2.0): exact on closed meshes, and
// quick on a scan of millions of triangles where a B-rep kernel would turn
// every triangle into a face. It needs both meshes closed — every edge had by
// exactly two triangles, walked once each way — and says so up front, rim by
// rim, rather than failing somewhere inside.
//
// What comes back is an edit like any other (see edit.ts): the scan's own
// vertices that are left keep their order and come first, the new ones — the
// solid's surface, and the line where the two surfaces cross — after them.
// Which of the result's vertices were the scan's is carried through Manifold
// as two extra properties per vertex, the low and the high half of the
// scan's vertex number, and believed only where the position came back
// exactly: Manifold interpolates properties across a triangle it cuts, so a
// new vertex on the crossing line carries a number that is no vertex's, at
// a place that is not that vertex's place.

import type { ManifoldToplevel, Manifold, Mesh } from 'manifold-3d'
import { compactEdit, type EditedMesh } from './edit'
import { halfEdges } from './boundary'

/** What is done with the solid: taken out of the scan, added to it, or the
 *  two cut down to what they share. */
export type BooleanOp = 'subtract' | 'add' | 'intersect'

export interface BooleanReport {
  op: BooleanOp
  /** The scan's triangles that are not in the result as they were: taken
   *  away, or cut across where the solid's surface meets them. */
  removed: number
  /** Triangles in the result that are not the scan's: the solid's surface,
   *  and the scan's own cut along the crossing. */
  added: number
  /** Enclosed volume before and after, mm³. */
  volumeBefore: number
  volumeAfter: number
}

export interface Triangles {
  positions: Float32Array
  indices: Uint32Array
}

/** A solid to make one with the mesh, and its name for what is said about
 *  it — an error names the one at fault. */
export interface BooleanTool extends Triangles {
  name?: string
}

/** How far a mesh is from closed: edges only one triangle has, and edges
 *  that more than two have, or two that walk it the same way. */
export interface Closedness {
  open: number
  bad: number
}

/** Count the edges that keep a mesh from being closed. Each is counted
 *  once, from the half-edge that has no partner, or one too many. */
export function closedness(indices: Uint32Array, vertexCount: number): Closedness {
  const he = halfEdges(indices, vertexCount)
  const { offsets, to } = he
  let open = 0
  let bad = 0
  for (let a = 0; a < vertexCount; a++) {
    for (let h = offsets[a]; h < offsets[a + 1]; h++) {
      const b = to[h]
      let same = 0
      for (let k = offsets[a]; k < offsets[a + 1]; k++) if (to[k] === b) same++
      let back = 0
      for (let k = offsets[b]; k < offsets[b + 1]; k++) if (to[k] === a) back++
      if (back === 0) open++
      // Counted from the smaller end only, so an edge is one count.
      else if ((same > 1 || back > 1) && a < b) bad++
    }
  }
  return { open, bad }
}

/** Two halves of a vertex number, each exact in a float — a scan of more
 *  than sixteen million vertices would not be, in one. */
const HALF = 65536

const PROPS = 5

function withNumbers(positions: Float32Array, number: (v: number) => number): Float32Array {
  const n = positions.length / 3
  const out = new Float32Array(n * PROPS)
  for (let v = 0; v < n; v++) {
    out[v * PROPS] = positions[v * 3]
    out[v * PROPS + 1] = positions[v * 3 + 1]
    out[v * PROPS + 2] = positions[v * 3 + 2]
    const id = number(v)
    out[v * PROPS + 3] = id < 0 ? -1 : id % HALF
    out[v * PROPS + 4] = id < 0 ? -1 : Math.floor(id / HALF)
  }
  return out
}

/** The tools a piece of their union is made of, as a sentence's subject:
 *  "The solid" when they have no names, "Cylinder 1", "Cylinder 1 and
 *  Cylinder 2" — and whether the verb takes the plural. */
function subjectOf(names: readonly string[]): { who: string; many: boolean } {
  if (names.length === 0) return { who: 'The solid', many: false }
  if (names.length === 1) return { who: names[0], many: false }
  return { who: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`, many: true }
}

/** The area of the triangles each original a mesh's runs came from left in
 *  it. */
function areaByOriginal(mesh: Mesh): Map<number, number> {
  const out = new Map<number, number>()
  const p = mesh.vertProperties
  const np = mesh.numProp
  const tri = mesh.triVerts
  for (let r = 0; r < mesh.runOriginalID.length; r++) {
    let area = 0
    for (let t = mesh.runIndex[r]; t < mesh.runIndex[r + 1]; t += 3) {
      const a = tri[t] * np, b = tri[t + 1] * np, c = tri[t + 2] * np
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
    }
    const id = mesh.runOriginalID[r]
    out.set(id, (out.get(id) ?? 0) + area)
  }
  return out
}

/** Under this share of its surface in the result a solid meets nothing;
 *  over one less it is all there — the surface is read back in floats, a
 *  part in ten thousand off at the most. */
const SHARE_NONE = 1e-4

function describeOpen(c: Closedness, what: string, fix: string): string | null {
  if (c.open === 0 && c.bad === 0) return null
  const parts: string[] = []
  if (c.open > 0) parts.push(`${c.open.toLocaleString('en-US')} open edge${c.open === 1 ? '' : 's'}`)
  if (c.bad > 0) parts.push(`${c.bad.toLocaleString('en-US')} edge${c.bad === 1 ? '' : 's'} shared by more than two triangles`)
  return `${what} is not closed — ${parts.join(' and ')}. A boolean needs a closed mesh: ${fix}`
}

/**
 * The subject — the scan or its edited copy, `vertexCount` vertices — and
 * the tool solids made one by `op`: their union taken away, added, or kept
 * where the mesh is. The subject must be closed; each tool is welded first,
 * as a CAD body's mesh comes face by face with its edges' vertices once per
 * face. Throws with what is wrong, in words and naming the solid, when one
 * is not closed or the boolean does with one nothing anyone would want: a
 * solid taken away that never reaches the mesh, or lies wholly inside it
 * and would seal a hollow there; one added wholly inside it.
 */
export function booleanMesh(
  wasm: ManifoldToplevel,
  subject: Triangles & { vertexCount: number },
  tools: readonly BooleanTool[],
  op: BooleanOp,
): EditedMesh & { report: BooleanReport } {
  if (tools.length === 0) throw new Error('No solid to make one with the mesh.')
  const { vertexCount } = subject
  const open = describeOpen(closedness(subject.indices, vertexCount), 'The mesh', 'close its holes with Fill holes first.')
  if (open) throw new Error(open)

  // Manifolds live in the WebAssembly heap and are let go by hand; a Mesh
  // is plain arrays.
  const made: Manifold[] = []
  const keep = (x: Manifold): Manifold => {
    made.push(x)
    return x
  }
  try {
    let a: Manifold
    try {
      a = keep(new wasm.Manifold(new wasm.Mesh({ numProp: PROPS, vertProperties: withNumbers(subject.positions, (v) => v), triVerts: subject.indices })))
    } catch (e) {
      throw new Error(`The mesh could not be read as a closed solid (${e instanceof Error ? e.message : String(e)}) — its triangles may cross each other. Fill holes and Smooth can help; so can a cut that takes off a damaged patch.`)
    }
    if (a.status() !== 'NoError') throw new Error(`The mesh could not be read as a closed solid (${a.status()}).`)

    const solids = tools.map((tool) => {
      const notClosed = `${subjectOf(tool.name ? [tool.name] : []).who} did not come out as a closed mesh — is it a solid body, not a surface?`
      const toolMesh = new wasm.Mesh({ numProp: PROPS, vertProperties: withNumbers(tool.positions, () => -1), triVerts: tool.indices })
      toolMesh.merge()
      let b: Manifold
      try {
        b = keep(new wasm.Manifold(toolMesh))
      } catch {
        throw new Error(notClosed)
      }
      if (b.status() !== 'NoError' || b.isEmpty()) throw new Error(notClosed)
      return b
    })
    // The tools as one, in the pieces of it that stand apart — each an
    // original of its own, so what of its surface the result holds can be
    // read back.
    const union = solids.length === 1 ? solids[0] : keep(wasm.Manifold.union(solids))
    const pieces = union.decompose().map((piece) => {
      keep(piece)
      return keep(piece.asOriginal())
    })
    const b = pieces.length === 1 ? pieces[0] : keep(wasm.Manifold.compose(pieces))

    const result = keep(op === 'subtract' ? a.subtract(b) : op === 'add' ? a.add(b) : a.intersect(b))
    if (result.status() !== 'NoError') throw new Error(`The boolean failed (${result.status()}).`)
    if (result.isEmpty()) throw new Error(op === 'intersect' ? 'The solid and the mesh do not overlap — nothing would be left.' : 'Nothing would be left of the mesh.')

    const out: Mesh = result.getMesh()
    const props = out.vertProperties
    const np = out.numProp
    const outCount = props.length / np
    // Manifold hands a vertex back once per side where the properties part
    // ways along the crossing; the merge vectors say which are one point.
    const rep = new Int32Array(outCount)
    for (let v = 0; v < outCount; v++) rep[v] = v
    const from = out.mergeFromVert
    const toVert = out.mergeToVert
    for (let i = 0; i < from.length; i++) rep[from[i]] = toVert[i]
    for (let v = 0; v < outCount; v++) {
      let r = rep[v]
      while (rep[r] !== r) r = rep[r]
      rep[v] = r
    }

    // Each result vertex as a vertex of the subject, where it was one, or a
    // new one numbered on after them.
    const index = new Int32Array(outCount).fill(-1)
    const taken = new Uint8Array(vertexCount)
    const fresh: number[] = []
    const sp = subject.positions
    for (let v = 0; v < outCount; v++) {
      if (rep[v] !== v) continue
      const lo = props[v * np + 3]
      const hi = props[v * np + 4]
      const id = lo + hi * HALF
      const x = props[v * np]
      const y = props[v * np + 1]
      const z = props[v * np + 2]
      if (lo >= 0 && hi >= 0 && Number.isInteger(lo) && Number.isInteger(hi) && id < vertexCount && !taken[id] && sp[id * 3] === x && sp[id * 3 + 1] === y && sp[id * 3 + 2] === z) {
        taken[id] = 1
        index[v] = id
      } else {
        index[v] = vertexCount + fresh.length / 3
        fresh.push(x, y, z)
      }
    }
    const all = new Float32Array(sp.length + fresh.length)
    all.set(sp)
    all.set(fresh, sp.length)
    const tri = out.triVerts
    const indices = new Uint32Array(tri.length)
    let kept = 0
    for (let t = 0; t < tri.length; t += 3) {
      let old = 0
      for (let k = 0; k < 3; k++) {
        const i = index[rep[tri[t + k]]]
        indices[t + k] = i
        if (i < vertexCount) old++
      }
      if (old === 3) kept++
    }

    const removed = subject.indices.length / 3 - kept
    const volumeBefore = a.volume()
    const volumeAfter = result.volume()
    // A piece of the tools that never meets the surface: wholly outside it,
    // or wholly inside — where taking it away would leave a hollow sealed
    // in the part rather than open a hole in it. Read off how much of its
    // surface is in the result: none of a piece taken away that missed or
    // of one added inside, all of one taken away from inside.
    if (op !== 'intersect') {
      const areas = areaByOriginal(out)
      for (const piece of pieces) {
        const share = (areas.get(piece.originalID()) ?? 0) / piece.surfaceArea()
        const none = share < SHARE_NONE
        const all = share > 1 - SHARE_NONE
        if (!(none || (op === 'subtract' && all))) continue
        const names = tools.length === 1 ? (tools[0].name ? [tools[0].name] : []) : tools.flatMap((tool, i) => (tool.name && overlaps(wasm, solids[i], piece) ? [tool.name] : []))
        const { who, many } = subjectOf(names)
        if (op === 'subtract' && all) throw new Error(`${who} ${many ? 'lie' : 'lies'} wholly inside the mesh — taking ${many ? 'them' : 'it'} away would seal a hollow inside the part, not open a hole. Move ${many ? 'their' : 'its'} end out through the surface first.`)
        if (op === 'subtract') throw new Error(`${who} ${many ? 'do' : 'does'} not reach the mesh — there is nothing to take away.`)
        throw new Error(`${who} ${many ? 'lie' : 'lies'} wholly inside the mesh — there is nothing to add.`)
      }
    }
    const edited = compactEdit(all, indices, vertexCount)
    return { ...edited, report: { op, removed, added: tri.length / 3 - kept, volumeBefore, volumeAfter } }
  } finally {
    for (const x of made) x.delete()
  }
}

/** Whether one solid has volume in another — which of the tools a piece of
 *  their union is made of. Only asked when a piece is to be named. */
function overlaps(wasm: ManifoldToplevel, solid: Manifold, piece: Manifold): boolean {
  const common = wasm.Manifold.intersection(solid, piece)
  try {
    return common.volume() > 1e-9
  } finally {
    common.delete()
  }
}
