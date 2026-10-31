// SPDX-License-Identifier: AGPL-3.0-only
// Where a Move puts the bodies it takes: turned about a pivot — about X,
// then about Y, then about Z, each through the pivot — and then carried
// along X, Y and Z, the six numbers its box shows. The pivot is the middle
// of the bodies as they were picked, kept with the feature, so an earlier
// feature that grows a body does not swing it somewhere else.
//
// The gizmo drags the same six numbers: an arrow along each axis for a
// distance, a ring for each angle. Three angles turned one after another
// are a gimbal — the X ring rides on what the Y and Z turns did, the Y ring
// on what the Z turn did — and the rings are drawn so: each about the axis
// its own angle turns about, so the turn under the hand is the turn the
// body makes and a drag changes one number only.
//
// Last, where a face move puts the faces it moves, on a body's mesh: the
// ghost drawn while that move is an edit of the history.

import type { Vec3 } from '../../../src/core/types'
import type { KernelMesh } from './kernel'
import { add, cross, dot, normalize, sub } from '../../../src/core/vec'

/** A Move's numbers: what it turns about, how far it turns about each axis
 *  (degrees, right-handed) and how far it carries the bodies after (mm). */
export interface Placement {
  pivot: Vec3
  translate: Vec3
  rotate: Vec3
}

/** A rigid move as the kernel takes it: row-major 3 × 4, the turn in the
 *  first three columns of each row, the carry in the fourth. */
export type Affine = number[]

const RAD = Math.PI / 180

function rotX(a: number): number[] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}
function rotY(a: number): number[] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}
function rotZ(a: number): number[] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

/** Two row-major 3 × 3 matrices multiplied, a then b applied: a · b. */
function mul3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return out
}

const apply3 = (m: readonly number[], v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]

/** The turn of three angles in degrees — about X first, then Y, then Z,
 *  each about the part's own axis: Rz · Ry · Rx — row-major 3 × 3. */
export function rotationOf(rotate: Vec3): number[] {
  return mul3(rotZ(rotate[2] * RAD), mul3(rotY(rotate[1] * RAD), rotX(rotate[0] * RAD)))
}

/** The whole move, the kernel's way round: p′ = R (p − pivot) + pivot +
 *  translate. */
export function moveMatrix(p: Placement): Affine {
  const r = rotationOf(p.rotate)
  const turned = apply3(r, p.pivot)
  const t: Vec3 = [p.pivot[0] + p.translate[0] - turned[0], p.pivot[1] + p.translate[1] - turned[1], p.pivot[2] + p.translate[2] - turned[2]]
  return [r[0], r[1], r[2], t[0], r[3], r[4], r[5], t[1], r[6], r[7], r[8], t[2]]
}

/** A 3 × 4 move as the viewport takes it: column-major 4 × 4. */
export function matrix4Of(m: Affine): number[] {
  return [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, m[3], m[7], m[11], 1]
}

/** A point carried by a move. */
export function movePoint(m: Affine, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]]
}

/** A direction turned by a move — the carry leaves it alone. */
export function moveDir(m: Affine, d: Vec3): Vec3 {
  return [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]]
}

/** Whether a placement leaves everything where it was. */
export function movesNothing(p: Pick<Placement, 'translate' | 'rotate'>): boolean {
  return p.translate.every((v) => Math.abs(v) < 1e-9) && p.rotate.every((v) => Math.abs(v % 360) < 1e-9)
}

/** The axes the three rings turn about, X's, Y's and Z's: Z the part's own,
 *  Y as the Z turn left it, X as the Z and Y turns left it — the axis each
 *  angle's own change turns the bodies about (Rz·Ry·Rx·Rx(δ) is a turn by δ
 *  about Rz·Ry·X, and so on). */
export function ringAxes(rotate: Vec3): [Vec3, Vec3, Vec3] {
  const z = rotZ(rotate[2] * RAD)
  const zy = mul3(z, rotY(rotate[1] * RAD))
  return [apply3(zy, [1, 0, 0]), apply3(z, [0, 1, 0]), [0, 0, 1]]
}

/** Where the gizmo stands: the pivot, carried with the bodies. */
export function movedPivot(p: Placement): Vec3 {
  return [p.pivot[0] + p.translate[0], p.pivot[1] + p.translate[1], p.pivot[2] + p.translate[2]]
}

/** Meshes as one, in their order: what a ghost of several bodies is drawn
 *  as. A face's hash is kept where every mesh has them. */
export function mergeMeshes(meshes: readonly KernelMesh[]): KernelMesh {
  if (meshes.length === 1) return meshes[0]
  let vertices = 0
  let indices = 0
  for (const m of meshes) {
    vertices += m.positions.length
    indices += m.indices.length
  }
  const hashed = meshes.every((m) => m.faceHash)
  const out: KernelMesh = { positions: new Float32Array(vertices), normals: new Float32Array(vertices), indices: new Uint32Array(indices), ...(hashed ? { faceHash: new Int32Array(indices / 3) } : {}) }
  let v = 0
  let i = 0
  for (const m of meshes) {
    out.positions.set(m.positions, v)
    out.normals.set(m.normals, v)
    const first = v / 3
    for (let k = 0; k < m.indices.length; k++) out.indices[i + k] = m.indices[k] + first
    if (out.faceHash) out.faceHash.set(m.faceHash!, i / 3)
    v += m.positions.length
    i += m.indices.length
  }
  return out
}

/** A mesh carried by a move: a copy, its points moved and its normals
 *  turned. */
export function movedMesh(mesh: KernelMesh, m: Affine): KernelMesh {
  const p = mesh.positions
  const n = mesh.normals
  const positions = new Float32Array(p.length)
  const normals = new Float32Array(n.length)
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    positions[i] = m[0] * x + m[1] * y + m[2] * z + m[3]
    positions[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7]
    positions[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11]
  }
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i], y = n[i + 1], z = n[i + 2]
    normals[i] = m[0] * x + m[1] * y + m[2] * z
    normals[i + 1] = m[4] * x + m[5] * y + m[6] * z
    normals[i + 2] = m[8] * x + m[9] * y + m[10] * z
  }
  return { positions, normals, indices: mesh.indices.slice(), ...(mesh.faceHash ? { faceHash: mesh.faceHash.slice() } : {}) }
}

/** The middle of the boxes round some bodies — what a Move turns them
 *  about — or the origin with none. */
export function pivotOf(boxes: readonly { min: Vec3; max: Vec3 }[]): Vec3 {
  if (boxes.length === 0) return [0, 0, 0]
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i])
      max[i] = Math.max(max[i], b.max[i])
    }
  }
  // Rounded to the micron: the pivot is saved and read back, and a number
  // with sixteen digits says nothing the micron does not.
  const tidy = (v: number) => Math.round(v * 1000) / 1000
  return [tidy((min[0] + max[0]) / 2), tidy((min[1] + max[1]) / 2), tidy((min[2] + max[2]) / 2)]
}

/** Faces of a body's mesh, moved: a flat face along its normal, a round
 *  one out from its axis — where faces being moved will lie, drawn as a
 *  ghost when the move is an edit of the history and there is no one step
 *  for the kernel to preview. Null when the mesh names none of the faces.
 *  A lean is the draft that follows a single snapped face. */
export function movedFaceMesh(mesh: KernelMesh, faces: readonly { hash: number; fingerprint: { kind: string; dir: Vec3; center?: Vec3 } }[], offset: number, lean: { origin: Vec3; pull: Vec3; angleDeg: number } | null = null): KernelMesh | null {
  const owner = mesh.faceHash
  if (!owner) return null
  const positions: number[] = []
  const normals: number[] = []
  const byHash = new Map(faces.map((f) => [f.hash, f.fingerprint]))
  // The draft that follows the move turns the face about the line through
  // the lean's origin, along the face and square to the pull, so that the
  // normal tips towards the pull: Rodrigues about the axis dir × pull.
  const turn = lean && faces.length === 1 && normalize(cross(faces[0].fingerprint.dir, lean.pull))
  const rotate = (v: Vec3): Vec3 => {
    if (!turn) return v
    const t = (lean!.angleDeg * Math.PI) / 180
    const c = Math.cos(t)
    const s = Math.sin(t)
    const k = cross(turn, v)
    const d = dot(turn, v) * (1 - c)
    return [v[0] * c + k[0] * s + turn[0] * d, v[1] * c + k[1] * s + turn[1] * d, v[2] * c + k[2] * s + turn[2] * d]
  }
  for (let t = 0; t < owner.length; t++) {
    const face = byHash.get(owner[t])
    if (!face) continue
    const { dir, center, kind } = face
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t * 3 + k] * 3
      const p: Vec3 = [mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]]
      let along: Vec3 = dir
      if (kind === 'cylinder' && center) {
        const d = sub(p, center)
        const h = dot(d, dir)
        along = normalize([d[0] - dir[0] * h, d[1] - dir[1] * h, d[2] - dir[2] * h]) ?? dir
      }
      const moved: Vec3 = [p[0] + along[0] * offset, p[1] + along[1] * offset, p[2] + along[2] * offset]
      const q = turn ? add(lean!.origin, rotate(sub(moved, lean!.origin))) : moved
      const nrm = rotate([mesh.normals[v], mesh.normals[v + 1], mesh.normals[v + 2]])
      positions.push(q[0], q[1], q[2])
      normals.push(nrm[0], nrm[1], nrm[2])
    }
  }
  if (positions.length === 0) return null
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) }
}
