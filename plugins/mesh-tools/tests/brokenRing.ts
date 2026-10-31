// SPDX-License-Identifier: AGPL-3.0-only
// A broken part and the piece modelled to mend it, for Trim to scan: a ring —
// a mug's wall — with a U-shaped chip out of its rim, scanned closed, and the
// chip as CAD would model it.
//
// The fracture is rough the way a break in ceramic is: a few waves across it
// and along it, the scanner's scatter, and a groove leaning over so far that
// it undercuts its own mean surface — a fracture no height field over it
// could hold.
// The body fills the chip to its nominal U, grown 2 mm into the material
// that is still there and 0.2 mm oversize on every skin: larger than the
// part by more than a glue gap, the case that leaves a body minus the scan
// with flaps.
//
// Both are built with Manifold, as the ring and a prism in the chip's own
// unrolled coordinates — along the ring at the wall's middle radius, up, and
// out — whose side is the fracture.

import type { Manifold, ManifoldToplevel } from 'manifold-3d'

export interface TestMesh {
  positions: Float32Array
  indices: Uint32Array
  vertexCount: number
}

/** The ring, mm: its wall's radii and height, standing on z = 0, and the
 *  radius the chip is laid out along. */
export const RING = { inner: 26, outer: 30, height: 30, mid: 28 }

/** The chip's nominal U, centred on +X: half its width along the ring at the
 *  middle radius, the height of its bottom, and its rounded corners. */
const CHIP = { halfWidth: 12, bottom: 18, round: 4 }

/** How far the body reaches past the nominal U into the material, and how
 *  much larger than the part each of its skins is. */
const OVERLAP = 2
export const OVERSIZE = 0.2

/** The leaning groove's angle from the fracture's normal. */
const LEAN = (55 * Math.PI) / 180

function stream(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** A closed tube, its four faces each a grid of about `step`, wound outward;
 *  the scan's scatter of `noise` mm square to each face, the rims kept. */
function tube(inner: number, outer: number, z0: number, z1: number, step: number, noise: number, rand: () => number): TestMesh {
  const nt = Math.round((2 * Math.PI * outer) / step)
  const nz = Math.max(2, Math.round((z1 - z0) / step))
  const nr = Math.max(2, Math.round((outer - inner) / step))
  const gauss = () => (rand() + rand() + rand() + rand() - 2) * Math.sqrt(3)
  const pos: number[] = []
  const put = (r: number, t: number, z: number) => {
    const a = (2 * Math.PI * t) / nt
    pos.push(r * Math.cos(a), r * Math.sin(a), z)
    return pos.length / 3 - 1
  }
  // The section's outline, walked once: up the outside, in across the top,
  // down the inside, out across the bottom — each point a ring of nt.
  const outline: { r: number; z: number; dr: number; dz: number }[] = []
  for (let j = 0; j < nz; j++) outline.push({ r: outer, z: z0 + ((z1 - z0) * j) / nz, dr: j === 0 ? 0 : 1, dz: 0 })
  for (let k = 0; k < nr; k++) outline.push({ r: outer - ((outer - inner) * k) / nr, z: z1, dr: 0, dz: k === 0 ? 0 : 1 })
  for (let j = 0; j < nz; j++) outline.push({ r: inner, z: z1 - ((z1 - z0) * j) / nz, dr: j === 0 ? 0 : -1, dz: 0 })
  for (let k = 0; k < nr; k++) outline.push({ r: inner + ((outer - inner) * k) / nr, z: z0, dr: 0, dz: k === 0 ? 0 : -1 })
  const rings = outline.map(({ r, z, dr, dz }) => {
    const ids: number[] = []
    for (let t = 0; t < nt; t++) {
      const off = dr !== 0 || dz !== 0 ? gauss() * noise : 0
      ids.push(put(r + dr * off, t, z + dz * off))
    }
    return ids
  })
  const idx: number[] = []
  for (let s = 0; s < rings.length; s++) {
    const a = rings[s]
    const b = rings[(s + 1) % rings.length]
    for (let t = 0; t < nt; t++) {
      const t1 = (t + 1) % nt
      // Along the outline and round the ring: outward for an outline walked
      // anticlockwise in (r, z).
      idx.push(a[t], a[t1], b[t1], a[t], b[t1], b[t])
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), vertexCount: pos.length / 3 }
}

interface LoopPoint {
  x: number
  z: number
  /** The direction the loop runs, and the arc length along the U — −1 on
   *  the line across its top. */
  tx: number
  tz: number
  u: number
}

/** A U open at the top, by arc length from the top of its left arm down
 *  round its bottom and up to the top of its right arm, then back across
 *  the top: anticlockwise in (x, z), so its outward normal (tz, −tx) points
 *  out of the U, into the material. */
function uLoop(halfWidth: number, bottom: number, round: number, top: number, du: number): LoopPoint[] {
  const w = halfWidth
  const arm = top - bottom - round
  const arc = (Math.PI * round) / 2
  const flat = 2 * (w - round)
  const length = 2 * arm + 2 * arc + flat
  const at = (u: number): Omit<LoopPoint, 'u'> => {
    if (u < arm) return { x: -w, z: top - u, tx: 0, tz: -1 }
    u -= arm
    if (u < arc) {
      const a = Math.PI + u / round
      return { x: -w + round + round * Math.cos(a), z: bottom + round + round * Math.sin(a), tx: -Math.sin(a), tz: Math.cos(a) }
    }
    u -= arc
    if (u < flat) return { x: -w + round + u, z: bottom, tx: 1, tz: 0 }
    u -= flat
    if (u < arc) {
      const a = 1.5 * Math.PI + u / round
      return { x: w - round + round * Math.cos(a), z: bottom + round + round * Math.sin(a), tx: -Math.sin(a), tz: Math.cos(a) }
    }
    u -= arc
    return { x: w, z: bottom + round + Math.min(u, arm), tx: 0, tz: 1 }
  }
  const steps = Math.ceil(length / du)
  const loop: LoopPoint[] = []
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * length
    loop.push({ ...at(u), u })
  }
  const across = Math.ceil(2 * w)
  for (let i = 1; i < across; i++) loop.push({ x: w - (2 * w * i) / across, z: top, tx: -1, tz: 0, u: -1 })
  return loop
}

/**
 * A prism over the closed loop in the chip's unrolled coordinates — x along
 * the ring at the middle radius, z up — through the radii `rs`, mapped onto
 * the ring: the loop's point at radius r moved to `shape(point, r)`. The two
 * ends, far inside and outside the wall, are fans from the loop's middle:
 * the loop must be convex there.
 */
function prism(loop: LoopPoint[], rs: readonly number[], shape: (p: LoopPoint, r: number) => [number, number]): TestMesh {
  const n = loop.length
  const pos: number[] = []
  const put = (x: number, z: number, r: number) => {
    const a = x / RING.mid
    pos.push(r * Math.cos(a), r * Math.sin(a), z)
  }
  for (const r of rs) {
    for (const p of loop) {
      const [x, z] = shape(p, r)
      put(x, z, r)
    }
  }
  const id = (i: number, j: number) => j * n + (i % n)
  const idx: number[] = []
  // The side, outward: (x, z, r) maps onto the ring keeping its handedness.
  for (let j = 0; j + 1 < rs.length; j++) {
    for (let i = 0; i < n; i++) idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1))
  }
  // The ends: facing in towards the axis, and out from it.
  let mx = 0
  let mz = 0
  for (const p of loop) {
    mx += p.x / n
    mz += p.z / n
  }
  for (const j of [0, rs.length - 1]) {
    const c = pos.length / 3
    put(mx, mz, rs[j])
    for (let i = 0; i < n; i++) {
      if (j === 0) idx.push(c, id(i + 1, j), id(i, j))
      else idx.push(c, id(i, j), id(i + 1, j))
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), vertexCount: pos.length / 3 }
}

function manifoldOf(wasm: ManifoldToplevel, m: TestMesh): Manifold {
  const out = new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices }))
  if (out.status() !== 'NoError') throw new Error(`Not a closed mesh: ${out.status()}`)
  return out
}

function meshOf(m: Manifold): TestMesh {
  const mesh = m.getMesh()
  const np = mesh.numProp
  const count = mesh.vertProperties.length / np
  const positions = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) for (let k = 0; k < 3; k++) positions[v * 3 + k] = mesh.vertProperties[v * np + k]
  return { positions, indices: Uint32Array.from(mesh.triVerts), vertexCount: count }
}

export interface BrokenRing {
  /** The broken ring as scanned, closed, wound outward. */
  scan: TestMesh
  /** The body modelled to fill the chip. */
  body: TestMesh
  /** How far the fracture strays from the nominal U, at the most, mm. */
  fractureSpan: number
  /** How far a point lies past the nominal U into the material, mm — more
   *  than the fracture span, and it is past the break. */
  beyond(x: number, y: number, z: number): number
}

/**
 * The broken ring and its body. The ring's faces are a grid of `step`; the
 * fracture is sampled every `fractureStep` along the U and every quarter
 * millimetre across the wall, with `noise` mm of scatter.
 */
export function brokenRing(
  wasm: ManifoldToplevel,
  { step = 0.5, fractureStep = 0.1, noise = 0.02, waves = 1, groove = 0.9, seed = 7 } = {},
): BrokenRing {
  const rand = stream(seed)
  const gauss = () => (rand() + rand() + rand() + rand() - 2) * Math.sqrt(3)
  const { inner, outer, height, mid } = RING
  const top = height + 3
  // Fine across the wall, coarse where the prism only reaches past it; no
  // row on a skin, where the boolean would leave slivers no scan has.
  const rs: number[] = [6, 14, 20, 23, 24.5]
  for (let r = inner - 0.875; r < outer + 1; r += 0.25) rs.push(r)
  rs.push(32.5, 36, 42, 50)

  const loop = uLoop(CHIP.halfWidth, CHIP.bottom, CHIP.round, top, fractureStep)
  const ridgeAt = top - CHIP.bottom - CHIP.round + (Math.PI * CHIP.round) / 2 + (CHIP.halfWidth - CHIP.round) + 3
  let fractureSpan = 0
  const rough = (p: LoopPoint, r: number): [number, number] => {
    if (p.u < 0) return [p.x, p.z]
    const rc = Math.min(outer + 1, Math.max(inner - 1, r))
    // Calm at the top of the arms, where the U meets the line across, and
    // a millimetre past the wall, so the prism's ends are the plain U.
    const past = Math.max(inner - 0.5 - r, r - outer - 0.5, 0)
    const taper = Math.min(1, Math.max(0, height + 1.5 - p.z)) * Math.max(0, 1 - past)
    const u = p.u
    const wave =
      waves *
      (0.25 * Math.sin((2 * Math.PI * u) / 7.3 + 0.7) +
        0.15 * Math.sin((2 * Math.PI * u) / 3.1 + 2.1 + 0.9 * rc) +
        0.12 * Math.sin((2 * Math.PI * rc) / 2.7 + 1.3 + 0.4 * u))
    const g = u - ridgeAt - 0.3 * (rc - mid)
    const ridge = groove * Math.exp(-(g * g) / (2 * 0.35 * 0.35))
    const inWall = r > inner - 0.5 && r < outer + 0.5
    const scatter = inWall && taper > 0 ? gauss() * noise : 0
    // All of it along one leaning direction: a height field sheared over,
    // which overhangs where it is steep but never passes through itself,
    // as no fracture does.
    const h = taper * (wave + ridge) + scatter
    const along = h * Math.cos(LEAN)
    const aside = h * Math.sin(LEAN)
    const nx = p.tz
    const nz = -p.tx
    if (inWall) fractureSpan = Math.max(fractureSpan, Math.abs(along))
    return [p.x + along * nx + aside * p.tx, p.z + along * nz + aside * p.tz]
  }
  const notch = prism(loop, rs, rough)

  // The body's U: the nominal one grown by the overlap, smooth.
  const grown = uLoop(CHIP.halfWidth + OVERLAP, CHIP.bottom - OVERLAP, CHIP.round + OVERLAP, top, 0.5)
  const bodyRs: number[] = [6, 14, 20]
  for (let r = 23; r <= 33; r += 1) bodyRs.push(r)
  bodyRs.push(36, 42, 50)
  const chip = prism(grown, bodyRs, (p) => [p.x, p.z])

  const made: Manifold[] = []
  const keep = (m: Manifold) => {
    made.push(m)
    return m
  }
  try {
    const ring = keep(manifoldOf(wasm, tube(inner, outer, 0, height, step, noise, rand)))
    const scan = meshOf(keep(ring.subtract(keep(manifoldOf(wasm, notch)))))
    const cad = keep(manifoldOf(wasm, tube(inner - OVERSIZE, outer + OVERSIZE, -1, height + OVERSIZE, step, 0, rand)))
    const body = meshOf(keep(cad.intersect(keep(manifoldOf(wasm, chip)))))
    const { halfWidth: w, bottom: zb, round: rho } = CHIP
    const beyond = (x: number, y: number, z: number) => {
      // The rounded U's signed distance in (x, z), open upward.
      const qx = Math.abs(mid * Math.atan2(y, x)) - (w - rho)
      const qz = zb + rho - z
      return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rho
    }
    return { scan, body, fractureSpan, beyond }
  } finally {
    for (const m of made) m.delete()
  }
}
