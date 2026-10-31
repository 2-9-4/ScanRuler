// SPDX-License-Identifier: AGPL-3.0-only
// The lamp run's saved project (RE_LAMP: the path to its
// 16_lamp_02-stuck-split.scanruler; skipped without): the split that kept
// what lies between two fitted skins never came back — the skins, carried
// on over the outline prism's box, swung kilometres wide. Their sheets
// meet inside the prism, and the split says so in seconds.

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
import type { SketchFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import reversePlugin from '../plugin'
import { useReverse } from '../state/reStore'

vi.setConfig({ testTimeout: 600_000 })

const file = process.env.RE_LAMP ?? ''

beforeAll(() => reversePlugin.install?.())

describe.skipIf(!file)('the lamp, 02-stuck-split', () => {
  it('refuses the split between two skins that meet inside the prism, in seconds', async () => {
    const zip = unzipSync(readFileSync(file))
    const manifest = JSON.parse(strFromU8(zip['project.json']))
    applyReversePart(manifest.reverse as ReversePart)
    const graph = buildMeshGraph(parseSTL(zip[manifest.scan.member].slice().buffer))
    if (manifest.scan.appliedAlignment) rigidApplyToPoints(rigidFromJson(manifest.scan.appliedAlignment), graph.positions)
    const features = structuredClone(useReverse.getState().features)
    const split = features.find((f) => f.kind === 'split' && f.keep === 'between')
    expect(split, features.map((f) => `${f.id} ${f.kind} ${f.name}`).join('; ')).toBeDefined()
    const builder = new Builder(await ReKernel.load())
    builder.setScan(new NominalSurface(graph.positions, graph.indices), graph.positions)
    const upTo = features.slice(0, features.indexOf(split!) + 1)
    const elements = manifest.scan.elements.map((e: never) => elementFromJson(e, manifest.scan.settings))
    const steps = resolveFeatures(upTo, { sections: [], elements, modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
    const sketches = new Map(upTo.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
    const t0 = performance.now()
    const out = builder.build(steps, (id) => sketches.get(id))
    const ms = performance.now() - t0
    const r = out.results.find((x) => x.id === split!.id)!
    console.log(`${Math.round(ms)} ms: ${r.status} ${r.message ?? ''}`)
    expect(r.status).toBe('failed')
    expect(r.message).toMatch(/ meet at \(-?[\d.]+, -?[\d.]+, -?[\d.]+\), inside .+ — the wall between them closes there/)
    expect(ms).toBeLessThan(20_000)
    builder.dispose()
  })
})
