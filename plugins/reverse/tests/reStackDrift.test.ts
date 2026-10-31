// SPDX-License-Identifier: AGPL-3.0-only
// reverse.section.stack measuring each chain's centre from an axis: a
// conical dish 2.5 mm thick whose centre drifts off the Z axis towards
// 215° by known amounts per height — 0.25 mm at z 12, 0.32 at 18, 0.58 at
// 26, as the fan wheel's did — read height by height in one call, in the
// in-process worker.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 60_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

const TOWARD = (215 * Math.PI) / 180
/** The drift at a height: through the three readings, straight between. */
function drift(z: number): number {
  const at = [[10, 0.2], [12, 0.25], [18, 0.32], [26, 0.58], [28, 0.645]]
  for (let i = 0; i + 1 < at.length; i++) {
    const [z0, d0] = at[i]
    const [z1, d1] = at[i + 1]
    if (z <= z1) return d0 + ((d1 - d0) * (z - z0)) / (z1 - z0)
  }
  return at[at.length - 1][1]
}

/** The dish's two walls as a triangle soup: from z 10 to 28 its outside
 *  widens from radius 40 at half a millimetre a millimetre, its inside 2.5
 *  mm in, each ring of it centred `drift(z)` off the axis. */
function dish(): Float32Array {
  const k = 240
  const out: number[] = []
  const ring = (z: number, r: number) => {
    const d = drift(z)
    return Array.from({ length: k }, (_, i) => {
      const a = (i / k) * 2 * Math.PI
      return [d * Math.cos(TOWARD) + r * Math.cos(a), d * Math.sin(TOWARD) + r * Math.sin(a), z]
    })
  }
  for (let z = 10; z < 28; z += 0.5) {
    for (const inset of [0, 2.5]) {
      const lo = ring(z, 40 + 0.5 * (z - 10) - inset)
      const hi = ring(z + 0.5, 40 + 0.5 * (z + 0.5 - 10) - inset)
      for (let i = 0; i < k; i++) {
        const j = (i + 1) % k
        out.push(...lo[i], ...lo[j], ...hi[j], ...lo[i], ...hi[j], ...hi[i])
      }
    }
  }
  return Float32Array.from(out)
}

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(dish()), name: 'dish.stl', discard: true })
}, 60_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Stack {
  levels: { offset: number; chains: { circle?: { radius: number }; fromAxis?: { mm: number; towardDeg: number } }[] }[]
  tracks: { levels: { offset: number; fromAxis?: { mm: number; towardDeg: number } }[] }[]
}

describe('reverse.section.stack from an axis', () => {
  it('reads the dish’s drift off the axis at each height', async () => {
    const s = await run<Stack>('reverse.section.stack', { plane: { kind: 'world', axis: 'z' }, offsets: [12, 18, 26], axis: { kind: 'world', axis: 'z' } })
    const want: Record<number, number> = { 12: 0.25, 18: 0.32, 26: 0.58 }
    for (const level of s.levels) {
      // The dish's outside and inside, each a circle.
      expect(level.chains).toHaveLength(2)
      for (const c of level.chains) {
        expect(c.circle).toBeDefined()
        expect(c.fromAxis!.mm).toBeCloseTo(want[level.offset], 2)
        expect(c.fromAxis!.towardDeg).toBeCloseTo(215, 0)
      }
    }
    // The tracks carry it per height, so the drift reads in one list.
    const outer = s.tracks.find((t) => t.levels.length === 3)!
    expect(outer.levels.map((l) => l.fromAxis!.mm)).toEqual([expect.closeTo(0.25, 2), expect.closeTo(0.32, 2), expect.closeTo(0.58, 2)])
  })

  it('leaves fromAxis out without an axis, and refuses one that is not there', async () => {
    const s = await run<Stack>('reverse.section.stack', { plane: { kind: 'world', axis: 'z' }, offsets: [12] })
    for (const c of s.levels[0].chains) expect(c.fromAxis).toBeUndefined()
    expect((await refused('reverse.section.stack', { plane: { kind: 'world', axis: 'z' }, offsets: [12], axis: { kind: 'element', id: 999 } })).code).toBe('not_found')
  })
})
