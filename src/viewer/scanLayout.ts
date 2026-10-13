// SPDX-License-Identifier: AGPL-3.0-only
// How a scan lies: the direction it is longest along, which the camera
// frames the part broadside to.

import * as THREE from 'three'

/** Dominant direction of the vertex cloud (power iteration on the
 *  covariance of a subsample) — used to frame elongated parts broadside. */
export function principalAxis(positions: Float32Array): THREE.Vector3 {
  const n = positions.length / 3
  const step = Math.max(1, Math.floor(n / 50_000))
  let mx = 0, my = 0, mz = 0, m = 0
  for (let v = 0; v < n; v += step) {
    mx += positions[v * 3]
    my += positions[v * 3 + 1]
    mz += positions[v * 3 + 2]
    m++
  }
  mx /= m; my /= m; mz /= m
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0
  for (let v = 0; v < n; v += step) {
    const x = positions[v * 3] - mx
    const y = positions[v * 3 + 1] - my
    const z = positions[v * 3 + 2] - mz
    cxx += x * x; cxy += x * y; cxz += x * z
    cyy += y * y; cyz += y * z; czz += z * z
  }
  const a = new THREE.Vector3(1, 1, 1).normalize()
  for (let i = 0; i < 50; i++) {
    a.set(
      cxx * a.x + cxy * a.y + cxz * a.z,
      cxy * a.x + cyy * a.y + cyz * a.z,
      cxz * a.x + cyz * a.y + czz * a.z,
    )
    const len = a.length()
    if (len < 1e-20) return new THREE.Vector3(1, 0, 0)
    a.divideScalar(len)
  }
  return a
}
