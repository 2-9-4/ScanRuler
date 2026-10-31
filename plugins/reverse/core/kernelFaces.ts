// SPDX-License-Identifier: AGPL-3.0-only
// Faces of a solid moved or tilted where they lie: ReKernel's draftFaces,
// offsetFaceTracked and offsetFacesTracked (kernel.ts).

import type { Vec3 } from '../../../src/core/types'
import { dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { ReKernel } from './kernel'
import { composeHistory, rotateVec, sameSurface, turnOntoZ, vec, xyz } from './kernelMath'
import { asSolid, HASH_BOUND, KernelError, readFace, readRound, run, tracked, withSubShapes } from './kernelOps'
import type { FaceHistory, LoopPiece, Shape, Tracked } from './kernelTypes'
import type { OcctLike } from './occtTypes'

/** How a face leans against the pull, radians: the angle its outward
 *  normal at the middle of its parameters makes with the plane square to
 *  `up` — none for a wall standing along the pull, the draft for one
 *  leaned by it. A cone's normal leans by its half-angle. */
function leanOf(occt: OcctLike, handle: number, up: Vec3): number {
  const uv = occt.uvBounds(handle)
  const n = normalize(vec(occt.surfaceNormal(handle, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)))
  return n ? Math.asin(Math.max(-1, Math.min(1, dot(n, up)))) : 0
}

/** A face's normal less its part along `up`, unit — the way a wall faces
 *  across the pull, which a draft about a plane square to `up` keeps. */
function across(v: Vec3, up: Vec3): Vec3 | null {
  return normalize(sub(v, scale(up, dot(v, up))))
}

/** ReKernel.draftFaces (kernel.ts), whose comment says what it does. */
export function draftFaces(occt: OcctLike, kernel: ReKernel, solid: Shape, faceHashes: readonly number[], origin: Vec3, pull: Vec3, angleRad: number | readonly number[], skipped?: number[]): Shape {
  return run('Drafting', () => {
    const dir = normalize(pull)
    if (!dir) throw new KernelError('the pull direction has no length.')
    const turn = turnOntoZ(dir)
    // Where a point or a direction of the solid as it stands lies once
    // the solid is carried to the kernel's neutral plane.
    const place = (p: Vec3): Vec3 => (turn ? rotateVec(sub(p, origin), turn) : sub(p, origin))
    const aim = (v: Vec3): Vec3 => (turn ? rotateVec(v, turn) : v)
    const angles = faceHashes.map((_, i) => (typeof angleRad === 'number' ? angleRad : angleRad[i]))
    if (angles.some((a) => !(Math.abs(a) > 1e-9))) throw new KernelError('the draft has no angle.')
    if (faceHashes.length === 0) throw new KernelError('no face given.')
    const all = kernel.faces(solid)
    const wanted = faceHashes.map((h) => {
      const f = all.find((x) => x.hash === h)
      if (!f) throw new KernelError('the face is not on the body.')
      if (f.kind === 'plane' && Math.abs(dot(f.dir, dir)) > 0.999) throw new KernelError('a face square to the pull direction cannot be drafted — it is the kind of face the neutral plane is.')
      return f
    })
    // How each face leans before any is drafted: a face found leaning so
    // is drafted, one found leaning by its angle more was drafted already
    // — along with a tangent neighbour, which the kernel leans with the
    // face it is given.
    const leans = withSubShapes(occt, solid, 'face', faceHashes, (handles) => handles.map((h) => leanOf(occt, h, dir)))
    const Z: Vec3 = [0, 0, 1]
    const o = occt
    let current = o.translate(solid, -origin[0], -origin[1], -origin[2])
    try {
      if (turn) {
        const turned = o.rotate(current, { point: xyz([0, 0, 0]), direction: xyz(turn.axis) }, turn.angle)
        o.release(current)
        current = turned
      }
      for (let i = 0; i < wanted.length; i++) {
        const w = wanted[i]
        if (wanted.findIndex((x) => x.hash === w.hash) < i) continue
        const handles = o.getSubShapes(current, 'face')
        try {
          const at = place(w.centroid)
          const along = aim(w.dir)
          const round = w.kind === 'cylinder' || w.kind === 'cone'
          const wall = w.kind === 'plane' ? across(along, Z) : null
          // The face found again by what it is: a flat facing the same way
          // across the pull (a draft keeps that), a round about the same
          // axis (a drafted cylinder is a cone), any other face of its
          // kind facing as it did — the nearest.
          let best = -1
          let bestD = Infinity
          handles.forEach((h, k) => {
            const f = readFace(occt, h)
            if (w.kind === 'plane' && wall) {
              const a = f.kind === 'plane' ? across(f.dir, Z) : null
              if (!a || dot(a, wall) < 0.9999) return
            } else if (round) {
              if ((f.kind !== 'cylinder' && f.kind !== 'cone') || Math.abs(dot(f.dir, along)) < 0.9999) return
            } else {
              if (f.kind !== w.kind || Math.abs(dot(f.dir, along)) < 0.9999) return
              if (f.kind === 'plane' && dot(f.dir, along) < 0) return
            }
            const d = len(sub(f.centroid, at))
            if (d < bestD) {
              bestD = d
              best = k
            }
          })
          if (best < 0) throw new KernelError('a face to draft was lost after the one before it was drafted.')
          if (w.kind === 'plane' || round) {
            const lean = leanOf(occt, handles[best], Z) - leans[i]
            const tol = Math.min(1e-3, Math.abs(angles[i]) / 3)
            if (Math.abs(lean) > tol) {
              // Leaned already: by its own angle, along with a tangent
              // neighbour drafted before it — nothing more to do; by
              // another, the faces either side of a tangent edge lean
              // together and cannot take two angles.
              if (Math.abs(Math.abs(lean) - Math.abs(angles[i])) <= tol) {
                skipped?.push(i)
                continue
              }
              const deg = (x: number) => `${Math.round(((Math.abs(x) * 180) / Math.PI) * 100) / 100}°`
              throw new KernelError(`pick #${i + 1} was leaned already, by ${deg(lean)}, with a tangent neighbour drafted before it — faces that meet tangent lean together, at one angle; give them the same angle (${deg(angles[i])} is asked).`)
            }
          }
          const next = o.draft(current, handles[best], angles[i], xyz([0, 0, 1]))
          o.release(current)
          current = next
        } finally {
          for (const h of handles) o.release(h)
        }
      }
      if (turn) {
        const unturned = o.rotate(current, { point: xyz([0, 0, 0]), direction: xyz(turn.axis) }, -turn.angle)
        o.release(current)
        current = unturned
      }
      const back = o.translate(current, origin[0], origin[1], origin[2])
      return asSolid(occt, back)
    } finally {
      o.release(current)
    }
  })
}

export function moveFace(occt: OcctLike, kernel: ReKernel, solid: Shape, faceHash: number, offset: number): Tracked {
  if (!(Math.abs(offset) > 1e-9)) throw new KernelError('the face has nowhere to move — the offset is zero.')
  return withSubShapes(occt, solid, 'face', [faceHash], ([handle]) => {
    const o = occt
    const f = readFace(occt, handle)
    const faces = kernel.faceHashes(solid)
    if (f.kind === 'plane') {
      const v = scale(f.dir, offset)
      // Swept back from where the face goes to, not out from where it
      // is: out from the end of a tilted cylinder, the prism's wall came
      // out as a surface the kernel would not make one with the wall it
      // carries on — a seam round the cylinder where its end had been.
      const there = o.translate(handle, v[0], v[1], v[2])
      let prism: number
      try {
        prism = o.extrude(there, -v[0], -v[1], -v[2])
      } finally {
        o.release(there)
      }
      try {
        const hashes = [...faces, ...o.subShapeHashes(prism, 'face', HASH_BOUND)]
        return tracked(occt, offset > 0 ? o.fuseWithHistory(solid, prism, hashes, HASH_BOUND) : o.cutWithHistory(solid, prism, hashes, HASH_BOUND))
      } finally {
        o.release(prism)
      }
    }
    if (f.kind !== 'cylinder' || f.radius === undefined || !f.center) throw new KernelError('only a flat or a cylindrical face can be moved.')
    const { axis, convex, lo, hi } = readRound(occt, handle, f.dir, f.center, 'only a full cylinder can be resized')
    const radius = f.radius + offset
    if (!(radius > 1e-6)) throw new KernelError('the radius would not be positive.')
    const circle = (r: number): LoopPiece => ({ kind: 'circle', center: f.center!, normal: axis, radius: r })
    // A hole bored out is cut with the whole cylinder — nothing is in
    // it to mind; every other case is a tube between the two radii, so
    // a boss with a bore keeps its bore.
    const grow = offset > 0
    const profile = kernel.face(!convex && grow ? { outer: [circle(radius)], holes: [] } : { outer: [circle(Math.max(radius, f.radius))], holes: [[circle(Math.min(radius, f.radius))]] })
    let tool: Shape | null = null
    try {
      tool = kernel.extrude(profile, axis, lo, hi)
      const hashes = [...faces, ...o.subShapeHashes(tool, 'face', HASH_BOUND)]
      return tracked(occt, convex === grow ? o.fuseWithHistory(solid, tool, hashes, HASH_BOUND) : o.cutWithHistory(solid, tool, hashes, HASH_BOUND))
    } finally {
      kernel.release(profile)
      if (tool !== null) kernel.release(tool)
    }
  })
}

/** ReKernel.offsetFacesTracked (kernel.ts), whose comment says what it does. */
export function offsetFacesTracked(occt: OcctLike, kernel: ReKernel, solid: Shape, faceHashes: readonly number[], offset: number): Tracked {
  return run('Moving the faces', () => {
    if (faceHashes.length === 0) throw new KernelError('no face given.')
    if (faceHashes.length === 1) return moveFace(occt, kernel, solid, faceHashes[0], offset)
    const before = kernel.faces(solid)
    const wanted = faceHashes.map((h) => {
      const f = before.find((x) => x.hash === h)
      if (!f) throw new KernelError('the face is not on the body.')
      return f
    })
    let shape = solid
    let history: FaceHistory = new Map()
    try {
      for (let i = 0; i < wanted.length; i++) {
        let hash = wanted[i].hash
        if (i > 0) {
          const now = kernel.faces(shape)
          if (!now.some((f) => f.hash === hash)) {
            const found = sameSurface(wanted[i], now)
            if (!found) throw new KernelError('a face to move was lost after the one before it was moved.')
            hash = found.hash
          }
        }
        const moved = moveFace(occt, kernel, shape, hash, offset)
        history = composeHistory(history, moved.history)
        if (shape !== solid) kernel.release(shape)
        shape = moved.shape
      }
    } catch (e) {
      if (shape !== solid) kernel.release(shape)
      throw e
    }
    return { shape, history }
  })
}
