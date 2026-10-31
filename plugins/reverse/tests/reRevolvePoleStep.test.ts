// SPDX-License-Identifier: AGPL-3.0-only
// A revolve with a piece ending on its axis comes back whole from STEP. A
// dome's arc drawn a hair off the axis, or with its centre a hair off it,
// or off it by half a millimetre and run from its base to the pole, or a
// closing line at the pole shorter than the regions keep, all once made a
// face a STEP reader loses (mendPoles puts them right before the face is
// made, and the step's warning says what moved). And the plain body check
// flags a dome left unmended: the part read back is no closed solid though
// no edge of it is open, and the round trip names the face it lost.

import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { Feature, RevolveFeature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import type { LoopPiece } from '../core/kernelTypes'
import { mendPoles } from '../core/profiles'
import { findRegions } from '../core/regions'
import { addEntity, emptySketch } from '../core/sketch'
import type { SectionFrame } from '../../../src/core/section/frame'
import { build } from './reKit'

// The mend, switched off for the check of a dome left as drawn.
const mending = vi.hoisted(() => ({ on: true }))
vi.mock('../core/profiles', async (importOriginal) => {
  const m = await importOriginal<typeof import('../core/profiles')>()
  return { ...m, mendPoles: (...a: Parameters<typeof m.mendPoles>) => (mending.on ? m.mendPoles(...a) : { profiles: a[0], mends: [] }) }
})

vi.setConfig({ testTimeout: 180_000 })

const kernelPromise = ReKernel.load()

/** The XZ plane as a world-y sketch has it: u is Z (the axis), v is X. */
const ZX: SectionFrame = { origin: [0, 0, 0], normal: [0, 1, 0], basisU: [0, 0, 1], basisV: [1, 0, 0] }

type Piece = { kind: 'line'; a: [number, number]; b: [number, number] } | { kind: 'arc'; c: [number, number]; r: number; start: number; sweep: number } | { kind: 'spline'; pts: [number, number][] }

const R = 5

/** A dome of base radius 5 on z 0, up (+Z) or down: the base line, the
 *  arc from (z 0, x 5) to the axis with its centre at (z 0, x d) — d < 0
 *  across the axis — and the axis line back down. */
function dome(d: number, up: 1 | -1): Piece[] {
  const r = R - d
  const h = Math.sqrt(r * r - d * d)
  const pole = Math.atan2(-d, up * h)
  const sweep = up > 0 ? Math.PI / 2 - pole : (pole < 0 ? pole + 2 * Math.PI : pole) - Math.PI / 2
  return [
    { kind: 'line', a: [0, 0], b: [0, R] },
    up > 0 ? { kind: 'arc', c: [0, d], r, start: pole, sweep } : { kind: 'arc', c: [0, d], r, start: Math.PI / 2, sweep },
    { kind: 'line', a: [up * h, 0], b: [0, 0] },
  ]
}

/** The dome centred on the axis, its arc ending `short` off it and a
 *  closing line from there square to the axis. */
function closedShort(short: number, up: 1 | -1): Piece[] {
  const t = Math.asin(short / R)
  const end: [number, number] = [up * R * Math.cos(t), short]
  return [
    { kind: 'line', a: [0, 0], b: [0, R] },
    up > 0 ? { kind: 'arc', c: [0, 0], r: R, start: t, sweep: Math.PI / 2 - t } : { kind: 'arc', c: [0, 0], r: R, start: Math.PI / 2, sweep: Math.PI / 2 - t },
    { kind: 'line', a: end, b: [end[0], 0] },
    { kind: 'line', a: [end[0], 0], b: [0, 0] },
  ]
}

/** A dome whose meridian is a spline through four points to the axis. */
const splineDome = (up: 1 | -1): Piece[] => [
  { kind: 'line', a: [0, 0], b: [0, R] },
  { kind: 'spline', pts: [[0, R], [up * 2, R * 0.9], [up * 3.8, R * 0.55], [up * 4.6, 0]] },
  { kind: 'line', a: [up * 4.6, 0], b: [0, 0] },
]

async function turned(pieces: Piece[]) {
  const sketch = emptySketch()
  for (const p of pieces) addEntity(sketch, p as never)
  const s: SketchFeature = { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'y', offset: 0 }, frame: ZX, sketch, visible: true }
  const rev: RevolveFeature = { id: 2, kind: 'revolve', name: 'Dome', sketchId: 1, regions: findRegions(sketch).map((r) => r.key), axis: { kind: 'world', axis: 'z' }, angleDeg: 360, pitch: 0, op: 'new', visible: true }
  const builder = new Builder(await kernelPromise)
  const out = await build(builder, [s, rev] as Feature[])
  const r = out.results.find((x) => x.id === 2)!
  const body = out.bodies[0]
  const plain = body ? builder.check(body.id, 0.01) : null
  const trip = body ? builder.check(body.id, 0.01, undefined, true)?.roundTrip : undefined
  builder.dispose()
  return { r, body, plain, trip }
}

describe('a revolve ending on its axis', () => {
  it('comes back whole from STEP, every way a dome is drawn', async () => {
    const cases: Record<string, Piece[]> = {}
    for (const up of [1, -1] as const) {
      const way = up > 0 ? 'up' : 'down'
      for (const d of [0, 1e-7, 1e-4, 0.5, -0.5]) cases[`${way}, centre ${d} off`] = dome(d, up)
      cases[`${way}, end 1.6e-8 off`] = closedShort(1.6e-8, up)
      cases[`${way}, closing line 0.001`] = closedShort(0.001, up)
      cases[`${way}, spline`] = splineDome(up)
    }
    const bad: string[] = []
    for (const [name, pieces] of Object.entries(cases)) {
      const { r, plain, trip } = await turned(pieces)
      if (r.status !== 'ok') bad.push(`${name}: ${r.message}`)
      else if (!trip?.ok) bad.push(`${name}: ${trip?.problems.join(' ')}`)
      else if (plain?.readBack?.length || !plain?.readBackSolid?.closed || !plain.readBackSolid.valid) bad.push(`${name}: the plain check's read-back is not whole`)
    }
    expect(bad).toEqual([])
  })

  it('says what moved, and nothing where nothing did', async () => {
    const sphere = await turned(dome(1e-4, -1))
    expect(sphere.r.warning).toMatch(/^Made to meet the revolve's axis as a pole a STEP reader keeps: arc 2 ending on the axis had its centre 0\.1 µm off it — re-pointed through its ends with the centre on the axis, a sphere; its middle moved [\d.]+ µm\.$/)
    expect(sphere.body!.topology.faces.map((f) => f.fingerprint.kind).sort()).toEqual(['plane', 'sphere'])
    const closing = await turned(closedShort(0.001, -1))
    expect(closing.r.warning).toContain("piece 4's end 1 µm off the axis put on it")
    for (const pieces of [dome(0, -1), dome(0.5, -1), closedShort(1.6e-8, -1)]) expect((await turned(pieces)).r.warning).toBeUndefined()
  })

  it('turns an off-centre arc, run either way, to start on the axis', async () => {
    const k = await kernelPromise
    type V = [number, number, number]
    for (const d of [0.5, 0.05]) {
      for (const up of [1, -1]) {
        const r = R - d
        const h = Math.sqrt(r * r - d * d)
        const base: V = [R, 0, 0], pole: V = [0, 0, up * h], o: V = [0, 0, 0]
        const t = Math.atan2(up * h, -d) / 2
        const mid: V = [d + r * Math.cos(t), 0, r * Math.sin(t)]
        const toPole: LoopPiece[] = [{ kind: 'line', a: o, b: base }, { kind: 'arc', a: base, m: mid, b: pole }, { kind: 'line', a: pole, b: o }]
        const fromPole: LoopPiece[] = [{ kind: 'line', a: o, b: pole }, { kind: 'arc', a: pole, m: mid, b: base }, { kind: 'line', a: base, b: o }]
        for (const loop of [toPole, fromPole]) {
          const mended = mendPoles([{ outer: loop, holes: [] }], [0, 0, 0], [0, 0, 1])
          const arc = mended.profiles[0].outer[1] as Extract<LoopPiece, { kind: 'arc' }>
          expect(arc.a).toEqual(pole)
          const face = k.face(mended.profiles[0])
          const solid = k.revolve(face, [0, 0, 0], [0, 0, 1], 2 * Math.PI)
          const check = k.verifyStep(k.exportStep([solid], [{ name: 'Dome' }]), [solid])
          k.release(face, solid)
          expect(check.problems, `d ${d}, ${up > 0 ? 'up' : 'down'}`).toEqual([])
        }
      }
    }
  })

  it('is flagged by the plain check where left unmended, and the round trip names the face lost', async () => {
    mending.on = false
    try {
      const { r, plain, trip } = await turned(dome(0.5, -1))
      expect(r.status).toBe('ok')
      // No edge of what is read back is open: the dome's face is gone whole.
      expect(plain!.readBack).toEqual([])
      expect(plain!.readBackSolid).toEqual({ closed: false, valid: expect.any(Boolean) })
      expect(trip!.ok).toBe(false)
      expect(trip!.problems[0]).toMatch(/^Dome reads back as no closed solid with no edge open — a face lost whole: the body lies [\d.]+ mm off what was read back about \(/)
      expect(trip!.body!.farthest!.near).toEqual([{ hash: expect.any(Number), origin: 2 }])
    } finally {
      mending.on = true
    }
  })
})
