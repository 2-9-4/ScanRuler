// SPDX-License-Identifier: AGPL-3.0-only
// Rounds read on short faces, and a verdict for every place (round 17, T8
// and T9). The Joy-Con's D-pad keys stand 1.7 mm above the housing, their
// top edges rounded about R1.1. The corner window walked the whole reach,
// down the key's side onto the housing; those points, capped as they are,
// outweighed the round's own and every key read "no round within 3 mm".
// Here, on a swept key: the window ends where the chain runs off both
// faces, the reach is held to 0.9 of the side's height, and the round
// reads; a sharp key says why it read none. And an edge whose places read
// differently — a round, a sharp corner, a step, a gap in the scan — says
// what each place read.
import { describe, expect, it } from 'vitest'
import { sliceMesh } from '../../../src/core/section/slice'
import type { Vec3 } from '../../../src/core/types'
// The plugin first: its modules import one another in that order.
import '../plugin'
import { readEdgeRound, type ReadEdge } from '../app/reFilletRead'
import { curvedStations } from '../core/curvedEdge'
import { cornerWindow, cutChains, estimateFilletRadius, faceWindow, type ScanCut } from '../core/filletEstimate'
import { arc, circleOutline, line, type Prof, sweep } from './sweptScan'

type Mesh = { positions: Float32Array; indices: Uint32Array }
const sectionOf = (mesh: Mesh) => async (origin: Vec3, normal: Vec3) => sliceMesh(mesh.positions, mesh.indices, origin, normal)

const Z: Vec3 = [0, 0, 1]
const STEP = 0.05
/** The key's radius, and how high it stands above the housing. */
const KEY = 4
const HEIGHT = 1.7

/** The key's top edge: a full circle at z 0 between the top and the key's
 *  side, a cylinder about Z. */
function keyEdge(R = KEY): ReadEdge {
  const seam: Vec3 = [-R, 0, 0]
  return {
    fingerprint: { kind: 'circle', mid: [R, 0, 0], dir: Z, length: 2 * Math.PI * R, radius: R, faces: [{ kind: 'plane', dir: Z }, { kind: 'cylinder', dir: Z }], origin: 1 },
    ends: [seam, seam],
    surfaces: [{ kind: 'plane', dir: Z }, { kind: 'cylinder', dir: Z, radius: R, center: [0, 0, -1] }],
  }
}

/** A key's profile in (out from its side, up): the top, a round of `r`
 *  (none at 0) onto the side, the side down HEIGHT, and the housing
 *  running out from its foot. */
function key(r: number): Prof[] {
  return [
    ...line([-3.5, 0], [-r, 0], [0, 1], STEP),
    ...(r > 0 ? arc([-r, -r], r, Math.PI / 2, 0, false, STEP / 2) : []),
    ...line([0, -r], [0, -HEIGHT], [1, 0], STEP),
    ...line([0, -HEIGHT], [6, -HEIGHT], [0, 1], STEP),
  ]
}

describe('a round on a short face', () => {
  it('reads the R1.1 round on a key standing 1.7 mm above the housing', async () => {
    const scan = sweep(circleOutline(KEY), key(1.1), 0.01)
    const read = await readEdgeRound(sectionOf(scan), keyEdge(), { reach: 3 })
    expect(read.why).toBeUndefined()
    expect(Math.abs(read.round!.radius - 1.1)).toBeLessThan(0.05)
    expect(read.radii.every((x) => x !== null && Math.abs(x - 1.1) < 0.08)).toBe(true)
  })

  it('ends the window where the side meets the housing, and holds the reach to 0.9 of the side', async () => {
    const scan = sweep(circleOutline(KEY), key(1.1), 0.01)
    const st = curvedStations(keyEdge(), 1, 0.6)![0]
    const cut: ScanCut = await sectionOf(scan)(st.at, st.normal)
    const to2 = (p: Vec3): [number, number] => {
      const d = [p[0] - st.at[0], p[1] - st.at[1], p[2] - st.at[2]]
      return [d[0] * st.x[0] + d[1] * st.x[1] + d[2] * st.x[2], d[0] * st.y[0] + d[1] * st.y[1] + d[2] * st.y[2]]
    }
    const chains = cutChains(cut, to2)
    // In the station's plane: x out from the key's axis, y up. The side's
    // outward normal is +x, the top's +y; the side runs down from the
    // corner, the top in towards the axis.
    const n: [[number, number], [number, number]] = [[0, 1], [1, 0]]
    const w = faceWindow(chains, 3, n, [[-1, 0], [0, -1]])
    expect(w.end).toMatchObject({ face: 1, what: 'another face 1.7 mm off' })
    expect(w.end!.at).toBeCloseTo(HEIGHT, 1)
    expect(w.reach).toBeCloseTo(0.9 * w.end!.at, 9)
    expect(w.points.every((p) => p[1] > -HEIGHT + 0.05)).toBe(true)
    // Over the whole reach the housing's points outweigh the round's: the
    // plain window reads no round; the face window reads it.
    expect(estimateFilletRadius(cornerWindow(chains, 3), n[0], n[1], 3)).toBeNull()
    expect(Math.abs(estimateFilletRadius(w.points, n[0], n[1], w.reach)!.radius - 1.1)).toBeLessThan(0.05)
  })

  it('says why a sharp key reads none', async () => {
    const scan = sweep(circleOutline(KEY), key(0), 0.01)
    const read = await readEdgeRound(sectionOf(scan), keyEdge(), { reach: 3 })
    expect(read.round).toBeNull()
    expect(read.why).toBe('no round within 3 mm (reach): another face 1.7 mm off within the reach — reach ≤ 1.5')
  })

  it('leaves a face that runs past the reach as it was', async () => {
    // The same round on a key standing 6 mm: no face ends, the window and
    // the reach are the plain ones.
    const tall: Prof[] = [...line([-3.5, 0], [-1.1, 0], [0, 1], STEP), ...arc([-1.1, -1.1], 1.1, Math.PI / 2, 0, false, STEP / 2), ...line([0, -1.1], [0, -6], [1, 0], STEP)]
    const scan = sweep(circleOutline(KEY), tall, 0.01)
    const st = curvedStations(keyEdge(), 1, 0.6)![0]
    const cut = await sectionOf(scan)(st.at, st.normal)
    const to2 = (p: Vec3): [number, number] => {
      const d = [p[0] - st.at[0], p[1] - st.at[1], p[2] - st.at[2]]
      return [d[0] * st.x[0] + d[1] * st.x[1] + d[2] * st.x[2], d[0] * st.y[0] + d[1] * st.y[1] + d[2] * st.y[2]]
    }
    const chains = cutChains(cut, to2)
    const w = faceWindow(chains, 3, [[0, 1], [1, 0]], [[-1, 0], [0, -1]])
    expect(w.end).toBeNull()
    expect(w.reach).toBe(3)
    expect(w.points.length).toBe(cornerWindow(chains, 3).length)
  })
})

describe('a fillet read’s places', () => {
  it('gives one verdict a place: a round, a sharp corner, a step, no scan', async () => {
    const round = sweep(circleOutline(5), [...line([-4, 0], [-0.8, 0], [0, 1], STEP), ...arc([-0.8, -0.8], 0.8, Math.PI / 2, 0, false, STEP / 2), ...line([0, -0.8], [0, -5], [1, 0], STEP)], 0.01)
    const sharp = sweep(circleOutline(5), [...line([-4, 0], [0, 0], [0, 1], STEP), ...line([0, 0], [0, -5], [1, 0], STEP)], 0.01)
    // Sharp, the side stepping out 0.8 mm a millimetre and a bit down.
    const step = sweep(
      circleOutline(5),
      [...line([-4, 0], [0, 0], [0, 1], STEP), ...line([0, 0], [0, -1.2], [1, 0], STEP), ...line([0, -1.2], [0.8, -1.2], [0, -1], STEP), ...line([0.8, -1.2], [0.8, -5], [1, 0], STEP)],
      0.01,
    )
    const scans = [round, sharp, step]
    // Each place cut off its own scan, the last off none at all.
    let place = 0
    const section = async (origin: Vec3, normal: Vec3): Promise<ScanCut> => {
      const scan = scans[place++]
      return scan ? sliceMesh(scan.positions, scan.indices, origin, normal) : { points: new Float32Array(0), offsets: new Uint32Array([0]) }
    }
    const read = await readEdgeRound(section, keyEdge(5), { reach: 3, stations: 4 })
    expect(read.round).toBeNull()
    expect(read.why).toBe('a round at 1 of 4 places only — not one along the edge')
    expect(read.places).toEqual(['R0.8', 'sharp', 'step 0.8 mm on face 2', 'no scan'])
    expect(read.radii.map((r) => r !== null)).toEqual([true, false, false, false])
  })
})
