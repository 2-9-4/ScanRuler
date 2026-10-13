// SPDX-License-Identifier: AGPL-3.0-only
// The cap that closes the part where a slice cuts it open — see
// SceneManager.setSlicePlane and setSliceCapped.

import * as THREE from 'three'
import type { Vec3 } from '../core/types'
import { applyFinish, setSurfaceColor, type ViewTheme } from './viewThemes'

/** A slice's cap as it stands in the scene: the two stencil passes over the
 *  part, the sheet on the cut plane, and the materials to let go of. */
export interface SliceCap {
  back: THREE.Mesh
  front: THREE.Mesh
  sheet: THREE.Mesh
  dispose: () => void
}

/** What a cap is built in and from: the part's group, which the stencil
 *  passes join, and the scene, which the sheet joins; the unit sheet it is
 *  scaled from, kept for the life of the view; its colour, or null for a
 *  shade under the theme's surface; where the part is and how large. */
export interface SliceCapHost {
  partGroup: THREE.Object3D
  scene: THREE.Scene
  sheetGeometry: THREE.PlaneGeometry
  color: number | null
  theme: ViewTheme
  modelCenter(): Vec3
  modelRadius(): number
  /** Clear the stencil, once the sheet is drawn. */
  clearStencil(): void
}

/**
 * Close the part where the slice cut it open, so the section reads as a
 * solid and not as a shell looked into: the standard stencil cap. The
 * scan's back faces on the kept side count the stencil up and its front
 * faces count it down, so inside the solid — where the eye has passed
 * through one more back face than front — the count is not zero; a
 * sheet on the cut plane is drawn where it is not, in the surface's
 * colour, and writes depth, so the shell's inside behind it stays hidden.
 */
export function buildSliceCap(plane: THREE.Plane, geometry: THREE.BufferGeometry, host: SliceCapHost): SliceCap {
  const stencilMaterial = (side: THREE.Side, op: THREE.StencilOp) => {
    const m = new THREE.MeshBasicMaterial({ side, depthWrite: false, depthTest: false, colorWrite: false })
    m.stencilWrite = true
    m.stencilFunc = THREE.AlwaysStencilFunc
    m.stencilFail = op
    m.stencilZFail = op
    m.stencilZPass = op
    m.clippingPlanes = [plane]
    return m
  }
  const back = new THREE.Mesh(geometry, stencilMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp))
  const front = new THREE.Mesh(geometry, stencilMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp))
  back.renderOrder = -3
  front.renderOrder = -3
  host.partGroup.add(back, front)

  let material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
  if (host.color !== null) material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, color: host.color })
  else {
    material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
    setSurfaceColor(material.color, host.theme)
    // A shade under the surface: a cut face is not the skin of the part.
    material.color.multiplyScalar(0.82)
    applyFinish(material, host.theme)
  }
  material.stencilWrite = true
  material.stencilRef = 0
  material.stencilFunc = THREE.NotEqualStencilFunc
  material.stencilFail = THREE.ReplaceStencilOp
  material.stencilZFail = THREE.ReplaceStencilOp
  material.stencilZPass = THREE.ReplaceStencilOp
  const sheet = new THREE.Mesh(host.sheetGeometry, material)
  // On the cut plane, centred where the part's centre falls on it, wide
  // enough to cross the whole part — the same sheet a plane hint draws.
  host.partGroup.updateMatrixWorld(true)
  const m = host.partGroup.matrixWorld
  const centre = plane.projectPoint(new THREE.Vector3(...host.modelCenter()).applyMatrix4(m), new THREE.Vector3())
  const half = host.modelRadius() * 1.3
  sheet.position.copy(centre)
  sheet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal)
  sheet.scale.set(2 * half, 2 * half, 1)
  sheet.renderOrder = -2
  sheet.onAfterRender = () => host.clearStencil()
  host.scene.add(sheet)
  return {
    back,
    front,
    sheet,
    dispose: () => {
      back.material.dispose()
      front.material.dispose()
      material.dispose()
    },
  }
}

