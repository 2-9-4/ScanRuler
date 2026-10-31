// SPDX-License-Identifier: AGPL-3.0-only
// A body's BVH answers what the plain raycast answers, triangle for
// triangle: the picks name a face by the index of the triangle hit, and the
// silhouettes walk the faces' runs of the index buffer, so the tree must
// neither renumber the triangles nor sort the buffer.
import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh'
import { describe, expect, it } from 'vitest'
import { ReKernel } from '../core/kernel'
import { withBoundsTree } from '../viewer/bodyPicks'

// What the viewport installs (src/viewer/SceneManager.ts); a mesh without a
// tree is cast at triangle by triangle, as three.js does.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

describe('a body cast at through its BVH', () => {
  it('meets the triangles the plain raycast meets, in their own order', async () => {
    const k = await ReKernel.load()
    const box = k.box([0, 0, 0], [40, 30, 20])
    const pin = k.extrude(k.face({ outer: [{ kind: 'circle', center: [20, 15, -1], normal: [0, 0, 1], radius: 6 }], holes: [] }), [0, 0, 1], 0, 22)
    const bored = k.cut(box, pin)
    const body = k.filletTracked(bored, k.edges(bored, 0.05).map((e) => e.hash), 2).shape
    const m = k.mesh(body, 0.02)
    k.release(box, pin, bored, body)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    geometry.setIndex(new THREE.BufferAttribute(m.indices, 1))
    // Double-sided, as the bodies are drawn: a ray meets the far walls too.
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    mesh.updateMatrixWorld()
    const raycaster = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean }
    // Down onto the block and slantwise through it, the bore included; a
    // fixed scatter, so a failure is the same failure every run.
    const rays: [THREE.Vector3, THREE.Vector3][] = []
    for (let i = 0; i < 300; i++) {
      const s = Math.sin(i * 12.9898) * 43758.5453
      const r = s - Math.floor(s)
      const t = (Math.sin(i * 78.233) * 12345.678) % 1
      rays.push([new THREE.Vector3(-5 + 50 * r, -5 + 40 * Math.abs(t), 40), new THREE.Vector3(0.3 * (r - 0.5), 0.3 * t, -1).normalize()])
    }
    const cast = (all: boolean) =>
      rays.map(([o, d]) => {
        raycaster.set(o, d)
        raycaster.firstHitOnly = !all
        return raycaster.intersectObject(mesh, false).map((h) => h.faceIndex)
      })
    const plain = cast(true)
    expect(plain.filter((h) => h.length >= 2).length).toBeGreaterThan(100)

    const before = m.indices.slice()
    withBoundsTree(mesh)
    expect(geometry.boundsTree).toBeDefined()
    expect(Array.from(geometry.index!.array as Uint32Array)).toEqual(Array.from(before))
    // Every surface along the ray, as stepping to the faces behind wants.
    expect(cast(true)).toEqual(plain)
    // And the nearest alone, as a pick and a test of what hides a point want.
    expect(cast(false)).toEqual(plain.map((h) => h.slice(0, 1)))
  })
})
