// SPDX-License-Identifier: AGPL-3.0-only
// A shadow section in the workspace: extracted as the block it stands as —
// its lines, arcs and holes through the part's thickness, a known volume —
// and sketched on, the sketch starting with the same pieces, closed and
// solved where they lie.

import { afterEach, describe, expect, it } from 'vitest'
import type { ShadowShape } from '../../../src/core/section/shadow'
import { useStore } from '../../../src/state/store'
import { Builder } from '../core/build'
import type { Feature, ResolveContext } from '../core/features'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { resolveFeatures } from '../core/resolve'
import { shadowPrimitive, shadowSketch } from '../core/shadowPieces'
import { featureDraftReady, useReverse } from '../state/reStore'
import { XY } from './reKit'

const kernelPromise = ReKernel.load()

/** A 40 × 20 outline with its corners rounded to 3 mm, run counter-
 *  clockwise, round a Ø8 hole — 10 mm thick, from z = −5 to 5. */
function roundedShadow(): ShadowShape {
  const r = 3
  const q = Math.PI / 2
  const arc = (cx: number, cy: number, a0: number) => ({ kind: 'arc' as const, from: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)] as [number, number], to: [cx + r * Math.cos(a0 + q), cy + r * Math.sin(a0 + q)] as [number, number], center: [cx, cy] as [number, number], radius: r, sweep: q })
  return {
    loops: [
      {
        hole: false,
        pieces: [
          { kind: 'line', from: [-17, -10], to: [17, -10] },
          arc(17, -7, -q),
          { kind: 'line', from: [20, -7], to: [20, 7] },
          arc(17, 7, 0),
          { kind: 'line', from: [17, 10], to: [-17, 10] },
          arc(-17, 7, q),
          { kind: 'line', from: [-20, 7], to: [-20, -7] },
          arc(-17, -7, 2 * q),
        ],
      },
      { hole: true, pieces: [{ kind: 'circle', center: [0, 0], radius: 4 }] },
    ],
    area: AREA,
    play: 1,
    tolerance: 0.1,
    smoothDeg: 30,
    margin: { min: 1, max: 1.1 },
    cell: 0.05,
    widened: false,
    extent: { min: -5, max: 5 },
    frame: XY,
  }
}

const AREA = 40 * 20 - (4 - Math.PI) * 9 - Math.PI * 16

describe('a shadow section in the workspace', () => {
  afterEach(() => {
    useStore.setState({ sections: [] })
    useReverse.getState().reset()
  })

  it('stands as its block through the part, and says why not for a cut or one not taken yet', async () => {
    expect(shadowPrimitive(undefined)).toMatch(/gone/)
    expect(shadowPrimitive({ name: 'Plan', kind: 'cut' })).toMatch(/Plan is a cut/)
    expect(shadowPrimitive({ name: 'Outline', kind: 'shadow' })).toMatch(/still being taken/)
    const sections: ResolveContext['sections'] = [{ id: 7, name: 'Outline', kind: 'shadow', frame: XY, cut: { shadow: roundedShadow() } }]
    const features: Feature[] = [{ id: 1, kind: 'extract', name: 'Body 1', section: 7, thickness: 2, op: 'new', visible: true }]
    const steps = resolveFeatures(features, { sections, elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
    expect(steps[0].kind).toBe('extract')
    const builder = new Builder(await kernelPromise)
    const result = await builder.build(steps, () => undefined)
    expect(result.results[0].status).toBe('ok')
    expect(result.bodies[0].closed).toBe(true)
    expect(result.bodies[0].volume).toBeCloseTo(AREA * 10, 2)
    // Its sides are the outline's own pieces: four flat, four rounds and
    // the hole's wall, a face each, and the two ends.
    const kinds = result.bodies[0].topology.faces.map((f) => f.fingerprint.kind)
    expect(kinds.filter((k) => k === 'cylinder').length).toBe(5)
    expect(kinds.filter((k) => k === 'plane').length).toBe(6)
    builder.dispose()
  })

  it('starts a sketch on it with its lines and arcs, held closed and tangent, a region round the hole', () => {
    const sketch = shadowSketch(roundedShadow(), XY)
    expect(sketch.entities.map((e) => e.kind).sort()).toEqual(['arc', 'arc', 'arc', 'arc', 'circle', 'line', 'line', 'line', 'line'])
    expect(sketch.constraints.filter((c) => c.kind === 'coincident').length).toBe(8)
    expect(sketch.constraints.filter((c) => c.kind === 'tangent').length).toBe(8)
    // The outline round the hole, and the hole's disc as a region of its
    // own, as any sketch has them; areas read off the drawn polygon.
    const regions = findRegions(sketch)
    expect(regions.map((r) => r.holes.length)).toEqual([1, 0])
    expect(regions[0].area).toBeCloseTo(AREA, 0)
  })

  it('is offered to Extract and to Sketch on: the box takes it, the sketch opens on its outline solved', () => {
    const sec = { id: 7, name: 'Outline', color: '#f80', visible: true, kind: 'shadow', frame: XY, ref: null, offset: 0, cut: { points: new Float32Array(0), offsets: new Uint32Array(1), normals: new Float32Array(0), shadow: roundedShadow() } }
    useStore.setState({ sections: [sec] as unknown as ReturnType<typeof useStore.getState>['sections'] })
    const re = useReverse.getState()
    re.startFeature('extract')
    re.setFeatureDraft({ section: 7 })
    expect(featureDraftReady(useReverse.getState().featureDraft!)).toBe(true)
    const id = useReverse.getState().commitFeature()!
    const made = useReverse.getState().features.find((f) => f.id === id)
    expect(made?.kind === 'extract' && made.section === 7 && made.element === undefined).toBe(true)
    // Put out of view, as an extracted element is: the body is its block.
    expect(useStore.getState().sections[0].visible).toBe(false)

    expect(useReverse.getState().startSketchOn({ kind: 'section', id: 7 })).toBe(true)
    const d = useReverse.getState().sketchDraft!
    expect(d.sketch.entities.length).toBe(9)
    expect(d.report?.ok).toBe(true)
    // Solved where the shadow put them: the bottom line still at v = −10.
    const bottom = d.sketch.entities.find((e) => e.kind === 'line' && Math.abs(e.a[1] - e.b[1]) < 1e-9 && e.a[1] < 0)
    expect(bottom?.kind === 'line' && Math.abs(Math.abs(bottom.a[0] - bottom.b[0]) - 34)).toBeLessThan(1e-6)
    // Every piece where the shadow has it: the solve met the relations
    // without moving anything — an arc's start read a turn round at most.
    const seeded = shadowSketch(roundedShadow(), d.frame).entities
    const turn = 2 * Math.PI
    d.sketch.entities.forEach((e, i) => {
      for (const [key, v] of Object.entries(e)) {
        const w = (seeded[i] as unknown as Record<string, unknown>)[key]
        const pairs = Array.isArray(v) ? v.map((x, k) => [x, (w as number[])[k]]) : typeof v === 'number' ? [[v, w as number]] : []
        for (const [a, b] of pairs) {
          const off = a - b
          expect(Math.abs(key === 'start' ? off - turn * Math.round(off / turn) : off)).toBeLessThan(1e-6)
        }
      }
    })
  })
})
