// SPDX-License-Identifier: AGPL-3.0-only
// The Joy-Con run's saved project (RE_JOYCON: the path to its
// 14_joycon_04-details.scanruler; skipped without): the −X end's bottom
// inset — a rectangle swept along the Path, cut at z 9.8 into two end
// pieces the same size, then cut at x −50 — answers which piece kept the
// id and, cut on the empty side, that the cut takes all of it, naming the
// other piece; and the stick's dome comes back whole from STEP with its
// arc's centre on the axis, a hair off it, or off it, and with a closing
// line 0.001 long at the pole.

import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { applyReversePart, type ReversePart } from '../app/projectSection'
import { Builder } from '../core/build'
import type { CutPlaneFeature, Feature, SketchFeature, SweepFeature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addRectangle, emptySketch } from '../core/sketch'
import reversePlugin from '../plugin'
import { useReverse } from '../state/reStore'
import { build } from './reKit'

vi.setConfig({ testTimeout: 1_200_000 })

const file = process.env.RE_JOYCON ?? ''

beforeAll(() => reversePlugin.install?.())

function project(): Feature[] {
  const zip = unzipSync(readFileSync(file))
  applyReversePart(JSON.parse(strFromU8(zip['project.json'])).reverse as ReversePart)
  return structuredClone(useReverse.getState().features)
}

describe.skipIf(!file)('the Joy-Con, 04-details', () => {
  it('answers the inset cut’s split, and the cut that takes all of a piece', async () => {
    const features = project()
    const sketch = emptySketch()
    addRectangle(sketch, [-59.246, -8.5], [-57.246, 8.5])
    const inset: SketchFeature = { id: 80, kind: 'sketch', name: 'Inset sketch', plane: { kind: 'world', axis: 'z', offset: 4 }, frame: { origin: [0, 0, 4], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, sketch, visible: false }
    const sweep: SweepFeature = { id: 81, kind: 'sweep', name: 'Inset', profile: 80, path: 2, op: 'new', visible: true }
    const bottom: CutPlaneFeature = { id: 82, kind: 'cutPlane', name: 'Inset bottom', body: 81, plane: { kind: 'world', axis: 'z', offset: 9.8 }, keep: -1, visible: true }
    const k = await ReKernel.load()
    // The −X end kept (x < −50), as the run meant it; then the other side.
    for (const keep of [-1, 1] as const) {
      const end: CutPlaneFeature = { id: 83, kind: 'cutPlane', name: 'Inset end', body: 81, plane: { kind: 'world', axis: 'x', offset: -50 }, keep, visible: true }
      const builder = new Builder(k)
      const out = await build(builder, [...features, inset, sweep, bottom, end])
      builder.dispose()
      const split = out.results.find((r) => r.id === 82)!
      const cut = out.results.find((r) => r.id === 83)!
      console.log('z 9.8 cut:', split.status, split.warning ?? split.message)
      console.log(`x -50 cut, keep ${keep}:`, cut.status, cut.message ?? cut.warning ?? '')
      expect(split.status).toBe('ok')
      // Two end pieces the same size: 81 stays with the one nearest where
      // the swept band stood, the −X end the profile was drawn at; the
      // other is the cut's own id.
      expect(split.warning).toMatch(/^The cut at z 9\.8 left Inset as two bodies: 81 keeps the id \(x -59\.25…-57\.25, .*\); 82 is new \(x 57\.26…59\.26, /)
      expect(split.warning).toContain('the two the same size within 1 %')
      if (keep === -1) {
        expect(cut.status, cut.message).toBe('ok')
        continue
      }
      expect(cut.status).toBe('failed')
      expect(cut.message).toBe('The cut takes all of Inset (body 81, x -59.25…-57.25, y -8.5…8.5, z 4…9.8): it lies wholly on the side cut away (x < -50). Since Inset bottom (feature 82) it is two bodies: 81 at x -59.25…-57.25 (wholly on the side cut away), 82 at x 57.26…59.26 (on the side kept) — cut 82, or keep -1.')
    }
  })

  it('round-trips the stick’s dome', async () => {
    const features = project()
    const base = features.find((f): f is SketchFeature => f.id === 31 && f.kind === 'sketch')!
    const stick = features.find((f) => f.id === 32)!
    // The dome's arc (60) and the closing line from its end to the axis
    // (61), as the run drew them; the axis is line 1, x −28.18 in the sheet.
    type E = Record<string, unknown> & { id: number; kind: string }
    const entities = base.sketch.entities as unknown as E[]
    const arc = entities.find((e) => e.id === 60)! as E & { c: [number, number]; r: number; start: number; sweep: number }
    const axisX = (entities.find((e) => e.id === 1)! as E & { a: [number, number] }).a[0]
    // The arc redrawn from where it starts (on arc 10) with its centre d
    // off the axis, to where it meets the axis — or `short` before it.
    const start: [number, number] = [arc.c[0] + arc.r * Math.cos(arc.start), arc.c[1] + arc.r * Math.sin(arc.start)]
    const dome = (d: number, short = 0) => {
      const c: [number, number] = [axisX + d, arc.c[1]]
      const r = Math.hypot(start[0] - c[0], start[1] - c[1])
      const t0 = Math.atan2(start[1] - c[1], start[0] - c[0])
      const t1 = Math.acos((axisX + short - c[0]) / r)
      return { arc: { c, r, start: t0, sweep: t1 - t0 }, end: [c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1)] as [number, number] }
    }
    const toPole = (d: number) => (e: E[]) => {
      const m = dome(d)
      return e.filter((x) => x.id !== 61).map((x) => (x.id === 60 ? { ...x, ...m.arc } : x.id === 1 ? { ...x, b: [axisX, m.end[1]] } : x))
    }
    const closed = (short: number) => (e: E[]) => {
      const m = dome(0, short)
      return e.map((x) => (x.id === 60 ? { ...x, ...m.arc } : x.id === 61 ? { ...x, a: m.end, b: [axisX, m.end[1]] } : x.id === 1 ? { ...x, b: [axisX, m.end[1]] } : x))
    }
    const variants: Record<string, (e: E[]) => E[]> = {
      asSaved: (e) => e,
      ...Object.fromEntries([0, 1e-7, 1e-4, 0.5, -0.5].map((d) => [`centre ${d} off, to the pole`, toPole(d)])),
      'end 1.6e-8 off': closed(1.6e-8),
      'closing line 0.001': closed(0.001),
    }
    const k = await ReKernel.load()
    const bad: string[] = []
    for (const [name, edit] of Object.entries(variants)) {
      const sk: SketchFeature = { ...base, sketch: { ...base.sketch, entities: edit(structuredClone(entities)) as never } }
      const rev = { ...stick, op: 'new', regions: findRegions(sk.sketch).map((r) => r.key) } as Feature
      const builder = new Builder(k)
      const out = await build(builder, [sk, rev])
      const r = out.results.find((x) => x.id === 32)!
      const body = out.bodies[0]
      const trip = body ? builder.check(body.id, 0.01, undefined, true)?.roundTrip : undefined
      console.log(`stick ${name}:`, r.status, r.warning ?? r.message ?? '', '— round trip', trip?.ok, JSON.stringify(trip?.problems ?? []))
      builder.dispose()
      if (r.status !== 'ok' || !trip?.ok) bad.push(`${name}: ${r.message ?? trip?.problems.join(' ')}`)
    }
    expect(bad).toEqual([])
  })
})
