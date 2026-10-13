// SPDX-License-Identifier: AGPL-3.0-only
// A frame in the part — a plane's or a fitted patch's basisU, basisV and
// normal — as the pose three.js puts an object in: what stands the unit quad,
// which lies in XY, up in the plane, its X along basisU and its Y along
// basisV.

import * as THREE from 'three'
import type { Vec3 } from '../core/types'

export interface FrameAxes {
  basisU: Vec3
  basisV: Vec3
  normal: Vec3
}

/** The rotation that takes x, y and z onto basisU, basisV and the normal. */
export function frameQuaternion(frame: FrameAxes): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(...frame.basisU), new THREE.Vector3(...frame.basisV), new THREE.Vector3(...frame.normal)),
  )
}

/** The same rotation as a matrix, moved to the frame's origin. */
export function frameMatrix(frame: FrameAxes & { origin: Vec3 }): THREE.Matrix4 {
  const u = new THREE.Vector3(...frame.basisU)
  const v = new THREE.Vector3(...frame.basisV)
  const n = new THREE.Vector3(...frame.normal)
  return new THREE.Matrix4().makeBasis(u, v, n).setPosition(new THREE.Vector3(...frame.origin))
}

/** Where `point` falls on the frame's plane — the part's centre there is the
 *  middle of a sheet that is to cross the whole part. */
export function onFramePlane(frame: FrameAxes & { origin: Vec3 }, point: Vec3): THREE.Vector3 {
  const n = new THREE.Vector3(...frame.normal)
  const c = new THREE.Vector3(...point)
  const o = new THREE.Vector3(...frame.origin)
  return c.clone().addScaledVector(n, -c.clone().sub(o).dot(n))
}

/** A plane's sheet: the unit quad stood up in the frame at `centre`,
 *  `2 · half` across. The material stays the caller's to dispose. */
export function planeSheet(unitQuad: THREE.BufferGeometry, material: THREE.Material, frame: FrameAxes, centre: THREE.Vector3, half: number): THREE.Mesh {
  const sheet = new THREE.Mesh(unitQuad, material)
  sheet.position.copy(centre)
  sheet.quaternion.copy(frameQuaternion(frame))
  sheet.scale.set(2 * half, 2 * half, 1)
  return sheet
}
