// SPDX-License-Identifier: AGPL-3.0-only
// The Joy-Con run's two reads on the real scan (round 17, T7 and T8), run
// only with JOYCON_DIR set to the folder that holds joycon_left.stl and the
// run's projects (14_joycon_01-datums.scanruler, _04-details): the scan is
// 128 MB. The projects give the scan's alignment.
// - T7: the Path outline fitted on y 2.14 with accept (tangent, horizontal,
//   vertical within 2 sigmas): its fit's rms is some eight times the chain's
//   scatter, and the tangents the joins left are taken — but the one at the
//   notch, which moves its arc off its points, is still refused.
// - T8: the four D-pad keys' top edges, 1.7 mm above the housing, read a
//   round at the default reach.
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { run, startHeadless, stlBytes } from '../../../tests/commandKit'
// The plugin first: its modules import one another in that order.
import plugin from '../plugin'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { parseSTL } from '../../../src/core/parsers/stl'
import { sliceMesh } from '../../../src/core/section/slice'
import type { Vec3 } from '../../../src/core/types'
import { readEdgeRound, type ReadEdge } from '../app/reFilletRead'
import { createReverseSession, installReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'

vi.setConfig({ testTimeout: 1_800_000 })

const DIR = process.env.JOYCON_DIR ?? ''

/** The scan as the project has it: the STL moved by the project's
 *  alignment. */
function alignedScan(project: string) {
  const buf = readFileSync(`${DIR}/joycon_left.stl`)
  const parsed = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const zip = unzipSync(readFileSync(`${DIR}/${project}`), { filter: (f) => f.name === 'project.json' })
  const { r, t } = JSON.parse(strFromU8(zip['project.json'])).scan.appliedAlignment as { r: number[]; t: number[] }
  const p = parsed.positions
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    p[i] = r[0] * x + r[1] * y + r[2] * z + t[0]
    p[i + 1] = r[3] * x + r[4] * y + r[5] * z + t[1]
    p[i + 2] = r[6] * x + r[7] * y + r[8] * z + t[2]
  }
  return parsed
}

type Left = { kind: string; pieces: number[]; sigmas: number | null; why: string; moves?: { piece: number; mm: number; limitMm: number } }
type Fitted = { accept: { accepted: { kind: string; pieces: number[]; sigmas: number }[]; left: Left[]; maxMoveMm: number; note?: string } }

describe.skipIf(!DIR)('the Joy-Con’s reads on the real scan', () => {
  it('accepts the Path’s tangents by the fit’s own sigma, and refuses the notch’s', async () => {
    plugin.install?.()
    const headless = await startHeadless()
    const session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
    const stops = [installReverseSession(session), session.watch()]
    try {
      const scan = alignedScan('14_joycon_01-datums.scanruler')
      await run('scan.open', { bytes: stlBytes(scan.positions), name: 'joycon.stl', discard: true })
      const fit = (name: string, extra: Record<string, unknown>) =>
        run<Fitted>('reverse.feature.add', {
          feature: { kind: 'sketch', name, plane: { kind: 'world', axis: 'y', offset: 2.14 }, sketch: { fit: { within: { min: [10.5, -60], max: [45, 60] }, ...extra, accept: { sigmas: 2, kinds: ['tangent', 'horizontal', 'vertical'] } } } },
        })
      const show = (name: string, a: Fitted['accept']) =>
        console.log(name, 'limit', a.maxMoveMm, 'accepted', JSON.stringify(a.accepted.map((x) => [x.kind, x.pieces, x.sigmas])), 'moved', JSON.stringify(a.left.filter((l) => l.why === 'moved').map((l) => [l.kind, l.pieces, l.sigmas, l.moves])), a.note ?? '')
      // As fitted, the notch splits the outline in two; the joins leave one
      // tangent open, at the notch's R0.4 arc, and taking it moves the arc.
      const split = (await fit('Path', {})).accept
      show('Path', split)
      const notch = split.left.find((l) => l.kind === 'tangent' && l.why === 'moved')!
      expect(notch.moves!.mm).toBeGreaterThan(notch.moves!.limitMm)
      expect(split.maxMoveMm).toBeGreaterThan(0.04)
      // The notch bridged: every tangent within the sigmas is taken.
      const bridged = (await fit('Path bridged', { closeGaps: 3 })).accept
      show('Path bridged', bridged)
      expect(bridged.accepted.filter((a) => a.kind === 'tangent').length).toBeGreaterThan(0)
      expect(bridged.left.filter((l) => l.kind === 'tangent' && l.sigmas !== null && l.sigmas <= 2 && l.why === 'moved')).toEqual([])
    } finally {
      for (const s of stops) s()
      headless.stop()
    }
  })

  it('reads the D-pad keys’ top rounds at the default reach', async () => {
    const g = buildMeshGraph(alignedScan('14_joycon_04-details.scanruler'))
    const section = async (o: Vec3, n: Vec3, minLength: number) => sliceMesh(g.positions, g.indices, o, n, { minLength })
    // The keys' centres in x and z, their tops at y 8.82, each R4.13.
    const keys: [number, number][] = [[1.34, 14.04], [1.34, 31.02], [-6.87, 22.54], [9.54, 22.54]]
    const R = 4.13
    const radii: number[] = []
    for (const [cx, cz] of keys) {
      const seam: Vec3 = [cx, 8.82, cz + R]
      const edge: ReadEdge = {
        fingerprint: { kind: 'circle', mid: [cx, 8.82, cz - R], dir: [0, 1, 0], length: 2 * Math.PI * R, radius: R, faces: [{ kind: 'cylinder', dir: [0, 1, 0] }, { kind: 'plane', dir: [0, 1, 0] }], origin: 1 },
        ends: [seam, seam],
        surfaces: [{ kind: 'cylinder', dir: [0, 1, 0], radius: R, center: [cx, 8.82, cz] }, { kind: 'plane', dir: [0, 1, 0] }],
      }
      const read = await readEdgeRound(section, edge, { reach: 3, widen: true })
      console.log(`key (${cx}, ${cz}):`, read.round ? `R${read.round.radius} ± ${read.round.sigma}` : read.why, 'places', JSON.stringify(read.radii))
      expect(read.round).not.toBeNull()
      radii.push(read.round!.radius)
    }
    for (const r of radii) expect(r).toBeGreaterThan(1.05)
    for (const r of radii) expect(r).toBeLessThan(1.3)
  })
})
