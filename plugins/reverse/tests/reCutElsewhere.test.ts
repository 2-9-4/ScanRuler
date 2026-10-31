// SPDX-License-Identifier: AGPL-3.0-only
// A cut that also takes material where it was not meant, said on its row:
// a bore cut through a plate, its extent run on far enough to nick an arm
// standing over the plate, warns where and how far along the bore's axis;
// cut short of the arm, or through an arm it goes all the way through, it
// does not. On the lamp (RE_LAMP_SHIELD names 16_lamp_06-shield-onepiece),
// the shield's Holes cut ±30 warns, and cut ±6 does not.
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { rigidApplyToPoints } from '../../../src/core/deviation/rigid'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { parseSTL } from '../../../src/core/parsers/stl'
import { elementFromJson, rigidFromJson } from '../../../src/core/project/manifest'
import { applyReversePart, type ReversePart } from '../app/projectSection'
import { Builder } from '../core/build'
import type { Feature, SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { addEntity, addRectangle } from '../core/sketch'
import { useReverse } from '../state/reStore'
import reversePlugin from '../plugin'
import { build, extrudeAll, sketchOf } from './reKit'

vi.setConfig({ testTimeout: 600_000 })

const kernelPromise = ReKernel.load()

/** A plate 40 × 40 × 5 with a wall at its far side and an arm from the
 *  wall's top back over the plate to x `armFrom`, z 25…30; a bore Ø6 at
 *  (20, 20) cut from z −1 to `to`. */
async function bored(to: number, armFrom: number) {
  const builder = new Builder(await kernelPromise)
  const plate = sketchOf(1, (s) => addRectangle(s, [0, 0], [40, 40]))
  const wall = sketchOf(3, (s) => addRectangle(s, [35, 0], [40, 40]))
  const arm = sketchOf(5, (s) => addRectangle(s, [armFrom, 0], [40, 40]))
  const bore = sketchOf(7, (s) => addEntity(s, { kind: 'circle', c: [20, 20], r: 3 }))
  const cut = { ...extrudeAll(8, bore, -1, to, 'cut'), name: 'Bore' }
  const out = await build(builder, [plate, extrudeAll(2, plate, 0, 5, 'new'), wall, extrudeAll(4, wall, 0, 30, 'join'), arm, extrudeAll(6, arm, 25, 30, 'join'), bore, cut])
  builder.dispose()
  return out.results.find((r) => r.id === 8)!
}

describe('a cut that also cuts elsewhere', () => {
  it('warns where an extent run on nicks a far corner, along the bore’s axis', async () => {
    // The arm's edge at x 22.9, a tenth inside the bore's radius.
    const r = await bored(40, 22.9)
    expect(r.status).toBe('ok')
    expect(r.warning).toMatch(/^Bore also cut at \(22\.\d+, 20(\.\d+)?, 27\.5\): [\d.]+ mm², 22\.5 mm along the R3 bore's axis — meant\? Shorten the extent\.$/)
  })

  it('does not where the extent stops short of it, or the bore goes through the arm whole', async () => {
    expect((await bored(10, 22.9)).warning).toBeUndefined()
    // Through the plate and the arm: two bores alike, both meant.
    expect((await bored(40, 10)).warning).toBeUndefined()
  })

  it('reads only the body it cut: a tool kept from a cut that nicked another body does not warn for it again', async () => {
    const builder = new Builder(await kernelPromise)
    const plate = sketchOf(1, (s) => addRectangle(s, [0, 0], [40, 40]))
    const wall = sketchOf(3, (s) => addRectangle(s, [35, 0], [40, 40]))
    const arm = sketchOf(5, (s) => addRectangle(s, [22.9, 0], [40, 40]))
    // A second plate under the first, a body of its own, and the tool: a
    // pin Ø6 through both, kept by each cut.
    const under = sketchOf(7, (s) => addRectangle(s, [10, 10], [30, 30]))
    const pin = sketchOf(9, (s) => addEntity(s, { kind: 'circle', c: [20, 20], r: 3 }))
    const cut = (id: number, name: string, body: number): Feature => ({ id, kind: 'boolean', name, op: 'cut', body, tool: 10, keep: true, visible: true })
    const out = await build(builder, [
      plate, extrudeAll(2, plate, 0, 5, 'new'), wall, extrudeAll(4, wall, 0, 30, 'join'), arm, extrudeAll(6, arm, 25, 30, 'join'),
      under, extrudeAll(8, under, -10, -5, 'new'), pin, extrudeAll(10, pin, -20, 40, 'new'),
      cut(11, 'Cut A', 2), cut(12, 'Cut B', 8),
    ])
    builder.dispose()
    const [a, b] = [11, 12].map((id) => out.results.find((r) => r.id === id)!)
    expect(a.status).toBe('ok')
    expect(a.warning).toMatch(/^Cut A also cut at \(22\.\d+, 20(\.\d+)?, 27\.5\): [\d.]+ mm², 22\.5 mm along the R3 bore's axis — meant\? Trim the tool\.$/)
    expect(b.status).toBe('ok')
    expect(b.warning).toBeUndefined()
  })
})

// ---- the lamp's shield -------------------------------------------------------------

const shield = process.env.RE_LAMP_SHIELD ?? ''

describe.skipIf(!shield)('the lamp’s shield holes', () => {
  beforeAll(() => reversePlugin.install?.())

  it('cut ±30, warn of the nick 10 mm on along the lower bore; cut ±6, do not', async () => {
    const zip = unzipSync(readFileSync(shield))
    const manifest = JSON.parse(strFromU8(zip['project.json']))
    applyReversePart(manifest.reverse as ReversePart)
    const graph = buildMeshGraph(parseSTL(zip[manifest.scan.member].slice().buffer))
    if (manifest.scan.appliedAlignment) rigidApplyToPoints(rigidFromJson(manifest.scan.appliedAlignment), graph.positions)
    const elements = manifest.scan.elements.map((e: never) => elementFromJson(e, manifest.scan.settings))
    const all = useReverse.getState().features
    const holes = all.find((f) => f.name === 'Holes')!
    const upTo = all.slice(0, all.indexOf(holes) + 1)
    const builder = new Builder(await kernelPromise)
    builder.setScan(new NominalSurface(graph.positions, graph.indices), graph.positions)
    const warning = (half: number) => {
      const features = upTo.map((f): Feature => (f === holes && f.kind === 'extrude' ? { ...f, extent: { kind: 'distance', from: -half, to: half } } : f))
      const steps = resolveFeatures(features, { sections: [], elements, modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
      const sketches = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
      const r = builder.build(steps, (id) => sketches.get(id)).results.find((x) => x.id === holes.id)!
      expect(r.status).toBe('ok')
      return r.warning
    }
    expect(warning(30)).toMatch(/^Holes also cut at \(20\.35, -46\.76, -68\.83\): 0\.15 mm², 10\.\d mm along the R2\.25 bore's axis — meant\? Shorten the extent\.$/)
    expect(warning(6)).toBeUndefined()
    builder.dispose()
  })
})
