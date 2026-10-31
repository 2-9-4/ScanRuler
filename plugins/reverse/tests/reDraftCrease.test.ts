// SPDX-License-Identifier: AGPL-3.0-only
// A drafted extrude over a join a hair off tangent: drafted, the two side
// faces meet at a grazing angle the kernel cannot join, so the join is made
// tangent first — line–arc, arc–line, line–line and an R615 rear meeting
// its corner rounds, at 0.02/0.05/0.1° — and builds at the volume of the
// profile drawn tangent. A real corner (1°) is left as drawn; a join too
// far off to mend is refused naming its pieces; the draft feature over such
// a join names it too.

import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import type { Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { mendNearTangent } from '../core/profiles'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'

const kernelPromise = ReKernel.load()
const deg = Math.PI / 180

// The rumble pak's body plan: a front line, two sides, two R6.24 corners
// and a rear — a line, or an R615 arc tangent to the corners inside.
const Y0 = 29.0358
const R = 6.2409
const CX = -32.5091
const CY = 22.193969020137104

type Ent = Record<string, unknown>
type P = [number, number]
const onCircle = (c: P, r: number, a: number): P => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]

/** Line rear; each join turned off tangent by its kink (rad): the sides
 *  into the corners (k1t, k1b), the corners into the rear (k2t, k2b). The
 *  lines end on the arcs' ends. */
function lineRear(k1t: number, k1b: number, k2t: number, k2b: number, front: Ent[] = [{ kind: 'line', a: [3, -Y0], b: [3, Y0], id: 40 }]): Ent[] {
  const s = Math.atan2(Y0 - 28.433978168653738, 3 + 32.61454494501266)
  const t0 = Math.PI / 2 + s + k1t
  const t1 = Math.PI + k2t
  const b0 = Math.PI - k2b
  const b1 = (3 * Math.PI) / 2 - s - k1b
  const ct: P = [CX, CY]
  const cb: P = [CX, -CY]
  return [
    ...front,
    { kind: 'line', a: [3, Y0], b: onCircle(ct, R, t0), id: 41 },
    { kind: 'arc', c: ct, r: R, start: t0, sweep: t1 - t0, id: 52 },
    { kind: 'line', a: onCircle(ct, R, t1), b: onCircle(cb, R, b0), id: 42 },
    { kind: 'arc', c: cb, r: R, start: b0, sweep: b1 - b0, id: 58 },
    { kind: 'line', a: onCircle(cb, R, b1), b: [3, -Y0], id: 43 },
  ]
}

/** The front line broken at y `at` and kinked outward by `kink` (rad). */
function kinkedFront(kink: number, at: number): Ent[] {
  const bulge = kink / (1 / (at + Y0) + 1 / (Y0 - at))
  const m: P = [3 + bulge, at]
  return [
    { kind: 'line', a: [3, -Y0], b: m, id: 44 },
    { kind: 'line', a: m, b: [3, Y0], id: 45 },
  ]
}

/** An R615 rear and corners that cross it at `crease` (rad) instead of
 *  touching it — a corner's centre placed a few nanometres off. */
function r615Rear(crease: number): Ent[] {
  const RR = 615
  const rc: P = [-39.15 + RR, 0]
  const placed = (phi: number) => {
    // The corner's centre as far from the rear's as puts the crossing
    // phi round from the touching point.
    const d = -R * Math.cos(phi) + Math.sqrt(R * R * Math.cos(phi) ** 2 - R * R + RR * RR)
    const c: P = [rc[0] - Math.sqrt(d * d - CY * CY), CY]
    const ray = Math.atan2(c[1] - rc[1], c[0] - rc[0])
    const cross = onCircle(c, R, ray - phi)
    const n1 = [cross[0] - c[0], cross[1] - c[1]]
    const n2 = [cross[0] - rc[0], cross[1] - rc[1]]
    const off = Math.atan2(Math.abs(n1[0] * n2[1] - n1[1] * n2[0]), n1[0] * n2[0] + n1[1] * n2[1])
    return { c, ray, cross, off }
  }
  let lo = 0
  let hi = 0.3
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (placed(mid).off < crease) lo = mid
    else hi = mid
  }
  const phi = (lo + hi) / 2
  const { c, ray, cross } = placed(phi)
  // The side's tangent point on the corner, from the front's top end.
  const w = [3 - c[0], Y0 - c[1]]
  const a0 = Math.atan2(w[1], w[0]) + Math.acos(R / Math.hypot(w[0], w[1]))
  const a1 = ray - phi
  const top = onCircle(c, R, a0)
  const rearAt = Math.atan2(cross[1] - rc[1], cross[0] - rc[0])
  const cb: P = [c[0], -c[1]]
  return [
    { kind: 'line', a: [3, -Y0], b: [3, Y0], id: 40 },
    { kind: 'line', a: [3, Y0], b: top, id: 41 },
    { kind: 'arc', c, r: R, start: a0, sweep: a1 - a0, id: 52 },
    { kind: 'arc', c: rc, r: RR, start: rearAt, sweep: 2 * (Math.PI - rearAt), id: 42 },
    { kind: 'arc', c: cb, r: R, start: 2 * Math.PI - a1, sweep: a1 - a0, id: 58 },
    { kind: 'line', a: [top[0], -top[1]], b: [3, -Y0], id: 43 },
  ]
}

function features(entities: Ent[], draftDeg: number, to: number): { features: Feature[]; sketch: SketchFeature['sketch'] } {
  const sketch = { entities: entities.map((e) => ({ ...e, fixed: true })), constraints: [], nextId: 100 } as unknown as SketchFeature['sketch']
  const regions = findRegions(sketch)
  const sk = { id: 1, kind: 'sketch', name: 'Body plan sk', plane: { kind: 'world', axis: 'z', offset: -12 }, frame: { origin: [0, 0, -12], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, visible: false, sketch } as unknown as Feature
  const ex = { id: 2, kind: 'extrude', name: 'Body plan', sketchId: 1, regions: [regions[0].key], extent: { from: 0, kind: 'distance', to }, draftDeg, op: 'new', visible: true } as unknown as Feature
  return { features: [sk, ex], sketch }
}

async function build(entities: Ent[], draftDeg: number, to: number, more: Feature[] = []) {
  const { features: fs, sketch } = features(entities, draftDeg, to)
  const steps = resolveFeatures([...fs, ...more], { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const builder = new Builder(await kernelPromise)
  try {
    return builder.build(steps, () => sketch, false)
  } finally {
    builder.dispose()
  }
}

/** The profiles the extrude is made of, mended as the build mends them. */
function mendOf(entities: Ent[]) {
  const { features: fs } = features(entities, -3.2, 10)
  const steps = resolveFeatures(fs, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
  const ex = steps.find((s) => s.kind === 'extrude') as Extract<(typeof steps)[number], { kind: 'extrude' }>
  return mendNearTangent(ex.profiles)
}

const JOINS = {
  'line–arc': { drawn: (k: number) => lineRear(k, 0, 0, 0), exact: () => lineRear(0, 0, 0, 0) },
  'arc–line': { drawn: (k: number) => lineRear(0, 0, k, 0), exact: () => lineRear(0, 0, 0, 0) },
  'line–line': { drawn: (k: number) => lineRear(0, 0, 0, 0, kinkedFront(k, Y0 - 4)), exact: () => lineRear(0, 0, 0, 0) },
  'R615 arc–arc': { drawn: (k: number) => r615Rear(k), exact: () => r615Rear(0) },
} as const


describe('a drafted extrude over a join near tangent', () => {
  it('is made tangent first, and builds at the volume of the profile drawn tangent', async () => {
    const kernel = await kernelPromise
    for (const [name, join] of Object.entries(JOINS)) {
      // As drawn, the kernel's draft leaves the solid open.
      const { features: fs } = features(join.drawn(0.05 * deg), -3.2, 52)
      const steps = resolveFeatures(fs, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
      const ex = steps.find((s) => s.kind === 'extrude') as Extract<(typeof steps)[number], { kind: 'extrude' }>
      const face = kernel.face(ex.profiles[0])
      let open: boolean
      try {
        const raw = kernel.extrude(face, [0, 0, 1], 0, 52, -3.2)
        open = !kernel.isClosedSolid(raw)
        kernel.release(raw)
      } catch {
        open = true
      } finally {
        kernel.release(face)
      }
      expect(open, `${name} as drawn`).toBe(true)
      for (const to of [10, 30, 52]) {
        for (const draft of [-3.2, 3.2]) {
          const exact = await build(join.exact(), draft, to)
          for (const k of [0.02, 0.05, 0.1]) {
            const out = await build(join.drawn(k * deg), draft, to)
            const r = out.results.find((x) => x.id === 2)!
            const what = `${name} ${k}° at ${to} mm, ${draft}°`
            expect(r.status, `${what}: ${r.message}`).toBe('ok')
            // The mend moves microns: the volume is the tangent profile's
            // to under 0.02 mm³ of 20,000–120,000 — what is left is the
            // side line's own turn, its end drawn a hair round the arc.
            expect(Math.abs(out.bodies[0].volume - exact.bodies[0].volume), what).toBeLessThan(0.02)
            expect(r.warning, what).toMatch(new RegExp(`^Made tangent before the draft.*pieces \\d+ → \\d+ met ${k}° off tangent — .*, moved [\\d.]+ µm`))
          }
        }
      }
    }
  }, 120_000)

  it('leaves a real corner as drawn', async () => {
    for (const drawn of [lineRear(1 * deg, 0, 0, 0), lineRear(0, 0, 0, 0, kinkedFront(1 * deg, Y0 - 4)), r615Rear(1 * deg)]) {
      const { profiles, mends, left } = mendOf(drawn)
      expect(mends).toEqual([])
      expect(left).toEqual([])
      expect(profiles[0].outer.length).toBe(drawn.length)
    }
    // A corner the kernel drafts as it is (the R615 corners crossing it at
    // 1° it does not: not a join near tangent, and not this step's to mend).
    for (const drawn of [lineRear(1 * deg, 0, 0, 0), lineRear(0, 0, 0, 0, kinkedFront(1 * deg, Y0 - 4))]) {
      const out = await build(drawn, -3.2, 30)
      const r = out.results.find((x) => x.id === 2)!
      expect(r.status).toBe('ok')
      expect(r.warning).toBeUndefined()
    }
  })

  it('names the pieces of a join too far off to mend when the kernel refuses it', async () => {
    // Two 29 mm lines kinked 0.06°: their corner lies 15 µm off the line
    // between their far ends — over what a merge may move.
    const drawn = lineRear(0, 0, 0, 0, kinkedFront(0.06 * deg, 0))
    const { mends, left } = mendOf(drawn)
    expect(mends).toEqual([])
    expect(left.map((j) => [j.from, j.to].sort())).toEqual([[44, 45]])
    const out = await build(drawn, -3.2, 52)
    const r = out.results.find((x) => x.id === 2)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/^Pieces (44 → 45|45 → 44) meet 0\.06° off tangent at \(3\.0\d*, 0, -12\): drafted, their faces meet at a grazing angle the kernel cannot join/)
    expect(r.message).toMatch(/reverse\.sketch\.edit rounds, a tangent relation\) or a real corner \(≥ 0\.2°\)/)
  })
})

describe('the draft feature over a join near tangent', () => {
  it('names the join before probing how far the faces lean', async () => {
    const drawn = lineRear(0.05 * deg, 0, 0, 0)
    const first = await build(drawn, 0, 40)
    const faces = first.bodies[0].topology.faces.map((f) => f.fingerprint)
    const bottom = faces.find((f) => f.dir[2] < -0.9)!
    const side = faces.find((f) => f.kind === 'plane' && f.centroid[1] > 25)!
    const draft = { id: 3, kind: 'draft', name: 'Draft 1', body: 2, neutral: { kind: 'face', face: bottom }, faces: [side], angleDeg: 3.2, visible: true } as unknown as Feature
    const out = await build(drawn, 0, 40, [draft])
    const r = out.results.find((x) => x.id === 3)!
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/^Face \d+ \(plane\) and face \d+ \(cylinder of 6\.24 mm radius\) meet 0\.05° off tangent at \(-32\.62, 28\.43, 8\): leaned, they meet at a grazing angle the kernel cannot join/)
    expect(r.message).not.toMatch(/the body's own width/)
    expect(r.where?.length).toBeGreaterThan(0)
  })
})
