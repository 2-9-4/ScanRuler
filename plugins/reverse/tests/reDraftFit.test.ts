// SPDX-License-Identifier: AGPL-3.0-only
// A draft's angle read off the scan (app/reFit.ts) where the scan's wall
// leans well off the face picked: a block whose +Y wall leans in 9° and
// whose −Y wall leans in 4.5° as they rise, against a box whose walls stand
// upright a millimetre outside the scan's foot. The points are taken over
// each face's footprint, not in a band about it — a 9° wall crosses that
// band in a strip — and the plane is fitted again about itself; a face
// much taller than the scan is read with a warning; groups take an angle
// each, fitted each.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mulberry32 } from '../../../src/core/fit/ransac'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import plugin from '../plugin'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type P2 = [number, number]

const PLUS_Y_DEG = 9
const MINUS_Y_DEG = 4.5
const STRIPS = 80

/** The block's profile in YZ — its foot ±20 at z = −20, its top at z = 20,
 *  the +Y wall leaning in 9° and the −Y wall 4.5° — sampled every 0.4 with
 *  noise, run along X ±20 in strips and capped. */
function block(): Float32Array {
  const rand = mulberry32(11)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const tan = (deg: number) => Math.tan((deg * Math.PI) / 180)
  const corners: P2[] = [
    [-20, -20],
    [20, -20],
    [20 - 40 * tan(PLUS_Y_DEG), 20],
    [-20 + 40 * tan(MINUS_Y_DEG), 20],
  ]
  const pts: P2[] = []
  for (let c = 0; c < 4; c++) {
    const a = corners[c]
    const b = corners[(c + 1) % 4]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n: P2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len]
    const k = Math.max(1, Math.round(len / 0.4))
    for (let i = 0; i < k; i++) {
      const d = gauss() * 0.02
      pts.push([a[0] + ((b[0] - a[0]) * i) / k + d * n[0], a[1] + ((b[1] - a[1]) * i) / k + d * n[1]])
    }
  }
  const at = (p: P2, k: number) => [-20 + (40 * k) / STRIPS, p[0], p[1]]
  const mid: P2 = [corners.reduce((s, p) => s + p[0], 0) / 4, corners.reduce((s, p) => s + p[1], 0) / 4]
  const tris: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    for (let k = 0; k < STRIPS; k++) tris.push(...at(a, k), ...at(b, k), ...at(b, k + 1), ...at(a, k), ...at(b, k + 1), ...at(a, k + 1))
    tris.push(...at(mid, 0), ...at(b, 0), ...at(a, 0), ...at(mid, STRIPS), ...at(a, STRIPS), ...at(b, STRIPS))
  }
  let vol = 0
  for (let i = 0; i < tris.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(i, i + 9)
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  if (!(vol > 0)) throw new Error(`The test block is wound inside out (${vol}).`)
  return new Float32Array(tris)
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(block()), name: 'leaned.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

type Fitted = { value: number; sigma: number | null; nominal: number; points: number; coverage?: number; warning?: string; readings?: { value: number | null; coverage?: number }[] }
type Answer = { feature: { id: number; status: string; warning?: string }; fitted?: Record<string, Fitted>; bodies: { changed?: { id: number; volume: number }[] } }

const PLUS_Y = { kind: 'plane', between: [[0, 1, 0]] }
const MINUS_Y = { kind: 'plane', between: [[0, -1, 0]] }
const BASE = { kind: 'world', axis: 'z', offset: -20 }

/** A box with upright walls a millimetre outside the scan's foot along Y,
 *  `height` tall from the scan's foot. */
async function uprightBox(height: number): Promise<number> {
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Base', plane: BASE, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 42], fixed: true }] } } })
  const made = await run<Answer>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Base', regions: 'all', extent: { kind: 'distance', from: 0, to: height }, op: 'new' } })
  return made.bodies.changed![0].id
}

describe('a draft’s angle off a scan wall that leans well off the face', () => {
  it('reads 9° off a face standing upright a millimetre outside the wall’s foot, the whole wall covered', async () => {
    const body = await uprightBox(40)
    const draft = await run<Answer>('reverse.feature.add', { feature: { kind: 'draft', name: 'Lean', body, neutral: BASE, faces: [PLUS_Y], angleDeg: 'fit' } })
    const a = draft.fitted!.angleDeg
    expect(Math.abs(a.value - PLUS_Y_DEG)).toBeLessThan(0.2)
    expect(a.nominal).toBe(PLUS_Y_DEG)
    expect(a.coverage).toBeGreaterThan(0.9)
    expect(a.warning).toBeUndefined()
    expect(a.points).toBeGreaterThan(1000)
    expect(draft.feature.status).toBe('ok')
  })

  it('warns where the scan spans under half the face’s height', async () => {
    // 100 tall where the scan stands 40: the wall covers 40 % of the face,
    // 38 % between the 2nd and the 98th percentile.
    const body = await uprightBox(100)
    const draft = await run<Answer>('reverse.feature.add', { feature: { kind: 'draft', name: 'Lean', body, neutral: BASE, faces: [PLUS_Y], angleDeg: 'fit' } })
    const a = draft.fitted!.angleDeg
    expect(Math.abs(a.value - PLUS_Y_DEG)).toBeLessThan(0.2)
    expect(a.coverage).toBeGreaterThan(0.3)
    expect(a.coverage).toBeLessThan(0.5)
    expect(a.warning).toMatch(/under half the face’s height along the pull \(3\d %\)/)
  })

  it('fits each group’s angle off its own faces and builds both in one feature', async () => {
    const body = await uprightBox(40)
    const draft = await run<Answer>('reverse.feature.add', { feature: { kind: 'draft', name: 'Lean', body, neutral: BASE, faces: [PLUS_Y], angleDeg: 'fit', groups: [{ faces: [MINUS_Y], angleDeg: 'fit' }] } })
    expect(Math.abs(draft.fitted!.angleDeg.value - PLUS_Y_DEG)).toBeLessThan(0.2)
    expect(Math.abs(draft.fitted!['groups.0.angleDeg'].value - MINUS_Y_DEG)).toBeLessThan(0.2)
    expect(draft.feature.status).toBe('ok')
    const listed = await run<{ angleDeg: number; groups: { angleDeg: number; faces: unknown[] }[] }>('reverse.feature.list', { feature: 'Lean' })
    expect(listed.angleDeg).toBe(draft.fitted!.angleDeg.value)
    expect(listed.groups.map((g) => [g.angleDeg, g.faces.length])).toEqual([[draft.fitted!['groups.0.angleDeg'].value, 1]])
    // The −Y group set by hand, then fitted again by its path.
    await run('reverse.feature.update', { feature: 'Lean', set: { groups: [{ faces: [MINUS_Y], angleDeg: 3 }] } })
    const again = await run<Answer & { was: Record<string, number> }>('reverse.feature.refit', { feature: 'Lean', fields: ['groups.0.angleDeg'] })
    expect(again.was['groups.0.angleDeg']).toBe(3)
    expect(Math.abs(again.fitted!['groups.0.angleDeg'].value - MINUS_Y_DEG)).toBeLessThan(0.2)
    expect(again.feature.status).toBe('ok')
  })
})
