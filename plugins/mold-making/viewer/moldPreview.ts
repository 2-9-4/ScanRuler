// SPDX-License-Identifier: AGPL-3.0-only
// A generated component in ScanRuler's existing viewport. The preview is
// explicitly separate from the imported scan/reference and never mutates it.
import * as THREE from 'three'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import type { SceneLayer } from '../../../src/viewer/sceneLayers'
import type { MoldBuild } from '../core/geometry'
import type { MoldSource } from '../core/settings'

export class MoldPreview {
  private scene: SceneManager
  private mesh: THREE.Mesh | null = null
  private remove: () => void
  private source: MoldSource = 'scan'
  private changed: () => void
  constructor(scene: SceneManager, changed: () => void) {
    this.scene = scene
    this.changed = changed
    const layer: SceneLayer = {
      order: 80,
      clippingChanged: (planes) => {
        const material = this.mesh?.material
        if (material instanceof THREE.MeshStandardMaterial) {
          material.clippingPlanes = planes ?? []
          material.needsUpdate = true
        }
      },
      partMoved: () => this.changed(),
      scanReplaced: () => { if (this.source === 'scan') this.changed() },
      frameBox: () => this.mesh ? new THREE.Box3().setFromObject(this.mesh) : null,
      dispose: () => this.clear(),
    }
    this.remove = scene.addLayer(layer)
  }

  set(mold: MoldBuild, source: MoldSource): void {
    this.clear()
    this.source = source
    const host = this.scene.layerHost()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(mold.positions, 3))
    geometry.setIndex(new THREE.BufferAttribute(mold.indices, 1))
    geometry.computeVertexNormals()
    const material = new THREE.MeshStandardMaterial({
      color: 0x48a9a0, roughness: 0.55, metalness: 0,
      transparent: true, opacity: 0.88, side: THREE.DoubleSide,
      clippingPlanes: host.clipPlanes() ?? [],
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = 'Generated mold preview'
    if (source === 'scan') host.partGroup.add(this.mesh)
    else host.scene.add(this.mesh)
    host.invalidate()
  }

  clear(): void {
    if (!this.mesh) return
    this.mesh.parent?.remove(this.mesh)
    this.mesh.geometry.dispose()
    const material = this.mesh.material
    if (Array.isArray(material)) material.forEach((x) => x.dispose())
    else material.dispose()
    this.mesh = null
    this.scene.layerHost().invalidate()
  }

  dispose(): void { this.remove() }
}
