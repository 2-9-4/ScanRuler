// SPDX-License-Identifier: AGPL-3.0-only
// A section's chain picked by a point in the world: reverse.section.outline
// { chain: { at: [x, y, z] } } takes the point square onto the sketch's
// plane and says where it came out. Two bars along X cut by the YZ plane,
// whose sketch has u = Y and v = Z — the point's X and Y read as [u, v]
// would name the other bar.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { cylinderMesh } from '../../../tests/helpers'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 60_000 })

type Vec2 = [number, number]
type Vec3 = [number, number, number]

/** An R10 bar 60 long along X, from x −60 to 0, its axis through (y, z). */
function bar(y: number, z: number): Float32Array {
  const soup = cylinderMesh(10, 60, 96, 12).positions
  for (let i = 0; i < soup.length; i += 3) soup.set([soup[i + 2] - 30, soup[i] + y, soup[i + 1] + z], i)
  return soup
}

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  const a = bar(25, 10)
  const b = bar(-40, 10)
  const soup = new Float32Array(a.length + b.length)
  soup.set(a)
  soup.set(b, a.length)
  await run('scan.open', { bytes: stlBytes(soup), name: 'bars.stl', discard: true })
}, 60_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Outline { at?: Vec2; offPlane?: number; shape: { points: Vec2[] }; frame: { origin: Vec3; normal: Vec3; basisU: Vec3; basisV: Vec3 } }

describe('a section’s chain picked by a point in the world', () => {
  it('takes the point onto the sketch’s plane and outlines the bar it lies on', async () => {
    const plane = { kind: 'world', axis: 'x', offset: -37 }
    // On the first bar's rim, in the world.
    const o = await run<Outline>('reverse.section.outline', { plane, chain: { at: [-37, 35, 10] } })
    expect(o.at).toEqual([35, 10])
    expect(o.offPlane).toBe(0)
    expect(o.frame.normal).toEqual([1, 0, 0])
    for (const p of o.shape.points) expect(Math.hypot(p[0] - 25, p[1] - 10)).toBeLessThan(10.2)
    // The same place 2 mm off the plane: taken square onto it, and said.
    const off = await run<Outline>('reverse.section.outline', { plane, chain: { at: [-35, 35, 10] } })
    expect(off.at).toEqual([35, 10])
    expect(off.offPlane).toBeCloseTo(2, 6)
    // Its X and Y read as [u, v] name the other bar.
    const misread = await run<Outline>('reverse.section.outline', { plane, chain: { at: [-37, 35] } })
    expect(misread.at).toBeUndefined()
    for (const p of misread.shape.points) expect(Math.hypot(p[0] + 40, p[1] - 10)).toBeLessThan(10.2)
  })
})
