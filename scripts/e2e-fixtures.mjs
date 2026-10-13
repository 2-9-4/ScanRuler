// SPDX-License-Identifier: AGPL-3.0-only
// Generated scans the browser checks share — written to a temporary folder,
// so they need no scan file in the repository.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Binary STL of triangles given as a flat list of corners, three a face. */
function stl(header, corners) {
  const buf = Buffer.alloc(84 + (corners.length / 3) * 50)
  buf.write(header, 0, 'ascii')
  buf.writeUInt32LE(corners.length / 3, 80)
  let at = 84
  for (let t = 0; t < corners.length; t += 3) {
    at += 12
    for (const p of [corners[t], corners[t + 1], corners[t + 2]]) {
      buf.writeFloatLE(p[0], at)
      buf.writeFloatLE(p[1], at + 4)
      buf.writeFloatLE(p[2], at + 8)
      at += 12
    }
    at += 2
  }
  return buf
}

/** The fillet ring: a quarter round of tube radius `r` between a flat top and
 *  a flat side, round a ring of radius `R` about Z — the shape of a fillet on
 *  a boss. Returns the STL's path. */
export function filletRingScan({ R = 25, r = 3, radial = 240, tube = 24 } = {}) {
  const tris = []
  const rows = []
  for (let j = -8; j <= tube + 8; j++) {
    const row = []
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * 2 * Math.PI
      if (j < 0) row.push([(R - (0 - j) * (r / 4)) * Math.cos(a), (R - (0 - j) * (r / 4)) * Math.sin(a), r])
      else if (j > tube) row.push([(R + r) * Math.cos(a), (R + r) * Math.sin(a), -(j - tube) * (r / 4)])
      else {
        const b = (Math.PI / 2) * (j / tube)
        const rho = R + r * Math.sin(b)
        row.push([rho * Math.cos(a), rho * Math.sin(a), r * Math.cos(b)])
      }
    }
    rows.push(row)
  }
  for (let j = 0; j + 1 < rows.length; j++) {
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial
      const a = rows[j][k], b = rows[j][k2], c = rows[j + 1][k2], d = rows[j + 1][k]
      tris.push(a, b, c, a, c, d)
    }
  }
  const path = join(mkdtempSync(join(tmpdir(), 'scanruler-torus-')), 'fillet-ring.stl')
  writeFileSync(path, stl('ScanRuler e2e fillet ring', tris))
  return path
}

/** Fit a torus in Measure from one click on the middle of the fillet ring's
 *  round, seen from the top, and create it. Returns whether the click gave a
 *  preview. Needs the app's development hook, window.__scanruler. */
export async function fitFilletTorus(page, { R = 25, r = 3 } = {}, { click, previewReady, sleep }) {
  await click(page, '[data-test=fit-torus]')
  const rect = await page.$eval('.viewslot canvas', (el) => {
    const b = el.getBoundingClientRect()
    return { left: b.x, top: b.y, w: b.width, h: b.height }
  })
  const screenOf = (p) =>
    page.evaluate(
      (p, rect) => {
        const cam = window.__scanruler.scene().viewport.camera
        cam.updateMatrixWorld()
        const v = cam.position.clone().set(p[0], p[1], p[2]).project(cam)
        return [rect.left + ((v.x + 1) / 2) * rect.w, rect.top + ((1 - v.y) / 2) * rect.h]
      },
      p,
      rect,
    )
  await page.evaluate(() => window.__scanruler.scene().viewFrom?.('top'))
  await sleep(800)
  // The middle of the round, on the side of the ring facing the camera.
  const mid = Math.PI / 4
  await page.mouse.click(...(await screenOf([(R + r * Math.sin(mid)) * Math.cos(0.4), (R + r * Math.sin(mid)) * Math.sin(0.4), r * Math.cos(mid)])))
  const ready = await previewReady(page)
  if (ready) {
    await click(page, '[data-test=create-element]')
    await sleep(500)
  }
  return ready
}

/** A ball bar without its bar: two balls of radius `r`, their centres
 *  `distance` apart along Y — what the agent check measures where the real
 *  scan (ballbar.stl) is not at hand. Returns the STL's path. */
export function ballPairScan({ distance = 148.64, r = 7.96, rings = 48, segments = 96 } = {}) {
  const tris = []
  for (const cy of [-distance / 2, distance / 2]) {
    const at = (i, k) => {
      const theta = (Math.PI * i) / rings
      const phi = (2 * Math.PI * k) / segments
      return [r * Math.sin(theta) * Math.cos(phi), cy + r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi)]
    }
    for (let i = 0; i < rings; i++) {
      for (let k = 0; k < segments; k++) {
        const a = at(i, k), b = at(i + 1, k), c = at(i + 1, k + 1), d = at(i, k + 1)
        if (i > 0) tris.push(a, d, c)
        if (i < rings - 1) tris.push(a, c, b)
      }
    }
  }
  const path = join(mkdtempSync(join(tmpdir(), 'scanruler-balls-')), 'ball-pair.stl')
  writeFileSync(path, stl('ScanRuler e2e ball pair', tris))
  return path
}

/** A block w × d × h gridded at about a millimetre, standing on the XY plane
 *  with its corner at `at`, every face wound out — as { positions, indices }
 *  for meshstep's writeBinarySTL. */
export function blockScan(w, d, h, { at = [0, 0] } = {}) {
  const [x0, y0] = at
  const positions = []
  const indices = []
  // Each face: origin, edge u, edge v, with cross(u, v) pointing out.
  const faces = [
    [[x0, y0, h], [w, 0, 0], [0, d, 0]],
    [[x0, y0, 0], [0, d, 0], [w, 0, 0]],
    [[x0, y0, 0], [w, 0, 0], [0, 0, h]],
    [[x0, y0 + d, 0], [0, 0, h], [w, 0, 0]],
    [[x0, y0, 0], [0, 0, h], [0, d, 0]],
    [[x0 + w, y0, 0], [0, d, 0], [0, 0, h]],
  ]
  for (const [o, u, v] of faces) {
    const nu = Math.round(Math.hypot(...u))
    const nv = Math.round(Math.hypot(...v))
    const base = positions.length / 3
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) positions.push(o[0] + (u[0] * i) / nu + (v[0] * j) / nv, o[1] + (u[1] * i) / nu + (v[1] * j) / nv, o[2] + (u[2] * i) / nu + (v[2] * j) / nv)
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i
        indices.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1)
      }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/** A gridded block 60 × 40 × 10 about the origin, turned about (0.3, −0.5,
 *  0.81) by 0.9 rad and moved by (12, −7, 30): a part with mirror planes
 *  that lie along no axis. The STL's bytes, and the turn and the whole pose
 *  for working out where the block's own frame went. */
export function turnedBlockScan() {
  const SIZE = [60, 40, 10]
  const GRID = 24
  const tris = []
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [-1, 1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3
      const at = (i, j) => {
        const q = [0, 0, 0]
        q[axis] = (side * SIZE[axis]) / 2
        q[u] = (i / GRID - 0.5) * SIZE[u]
        q[v] = (j / GRID - 0.5) * SIZE[v]
        return q
      }
      for (let i = 0; i < GRID; i++)
        for (let j = 0; j < GRID; j++) {
          const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
          // Wound so the normal points out of the block on either side.
          if (side > 0) tris.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3])
          else tris.push(quad[0], quad[2], quad[1], quad[0], quad[3], quad[2])
        }
    }
  }
  const k = [0.3, -0.5, 0.81].map((c) => c / Math.hypot(0.3, 0.5, 0.81))
  const [c, s] = [Math.cos(0.9), Math.sin(0.9)]
  const MOVE = [12, -7, 30]
  const turn = (q) => {
    const d = k[0] * q[0] + k[1] * q[1] + k[2] * q[2]
    const x = [k[1] * q[2] - k[2] * q[1], k[2] * q[0] - k[0] * q[2], k[0] * q[1] - k[1] * q[0]]
    return [0, 1, 2].map((i) => q[i] * c + x[i] * s + k[i] * d * (1 - c))
  }
  const pose = (q) => turn(q).map((v, i) => v + MOVE[i])
  const bytes = Buffer.alloc(84 + (tris.length / 3) * 50)
  bytes.writeUInt32LE(tris.length / 3, 80)
  for (let t = 0; t < tris.length / 3; t++)
    for (let corner = 0; corner < 3; corner++) {
      const q = pose(tris[t * 3 + corner])
      for (let i = 0; i < 3; i++) bytes.writeFloatLE(q[i], 84 + t * 50 + 12 + corner * 12 + i * 4)
    }
  return { bytes, turn, pose }
}

/** A closed box 30 × 30 × 20 on the XY plane gridded at half a millimetre,
 *  its faces off by a little noise (`noise` the spread of three uniform
 *  draws, `seed` where they start) but its edges true; with `holes`, two
 *  3 mm square holes in its top at X −7 and X 7. The STL's bytes and its
 *  triangle count. */
export function noisyBoxScan({ seed = 7, noise: spread = 0.02, holes = false, header = 'ScanRuler e2e closed box' } = {}) {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const noise = () => (rand() + rand() + rand() - 1.5) * spread
  const step = 0.5
  const tris = []
  // Each face as origin, two edge directions and their lengths, wound out.
  const faces = [
    { o: [-15, -15, 20], u: [1, 0, 0], v: [0, 1, 0], nu: 60, nv: 60, n: [0, 0, 1], hole: holes },
    { o: [-15, -15, 0], u: [0, 1, 0], v: [1, 0, 0], nu: 60, nv: 60, n: [0, 0, -1] },
    { o: [-15, -15, 0], u: [1, 0, 0], v: [0, 0, 1], nu: 60, nv: 40, n: [0, -1, 0] },
    { o: [15, -15, 0], u: [0, 1, 0], v: [0, 0, 1], nu: 60, nv: 40, n: [1, 0, 0] },
    { o: [15, 15, 0], u: [-1, 0, 0], v: [0, 0, 1], nu: 60, nv: 40, n: [0, 1, 0] },
    { o: [-15, 15, 0], u: [0, -1, 0], v: [0, 0, 1], nu: 60, nv: 40, n: [-1, 0, 0] },
  ]
  for (const f of faces) {
    const grid = []
    for (let i = 0; i <= f.nu; i++) {
      const row = []
      for (let j = 0; j <= f.nv; j++) {
        const edge = i === 0 || j === 0 || i === f.nu || j === f.nv
        const d = edge ? 0 : noise()
        row.push([0, 1, 2].map((k) => f.o[k] + f.u[k] * i * step + f.v[k] * j * step + f.n[k] * d))
      }
      grid.push(row)
    }
    for (let i = 0; i < f.nu; i++) {
      for (let j = 0; j < f.nv; j++) {
        const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1]
        const mx = (a[0] + c[0]) / 2
        const my = (a[1] + c[1]) / 2
        if (f.hole && Math.abs(Math.abs(mx) - 7) < 1.5 && Math.abs(my) < 1.5) continue
        tris.push([a, b, c], [a, c, d])
      }
    }
  }
  const buf = Buffer.alloc(84 + 50 * tris.length)
  buf.write(header, 0)
  buf.writeUInt32LE(tris.length, 80)
  let o = 84
  for (const t of tris) {
    o += 12
    for (const p of t) for (const x of p) (buf.writeFloatLE(x, o), (o += 4))
    o += 2
  }
  return { bytes: buf, triangles: tris.length }
}
