// SPDX-License-Identifier: AGPL-3.0-only
// Input as some agents' clients send it — every value a string — taken as
// meant: "false" where a boolean goes, "3" for the thing whose id is 3. And
// what align.datum says about the coordinates it centred and a parallel face
// with more of the scan. On boxes, in the in-process worker — see
// commandKit.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { refOf } from '../src/commands/refs'
import { useStore } from '../src/state/store'
import { boxMesh } from './helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from './commandKit'

type Vec3 = [number, number, number]
interface El { id: number; name: string; visible: boolean }

const shifted = (soup: Float32Array, at: Vec3): Float32Array => soup.map((v, i) => v + at[i % 3])
const joined = (...soups: Float32Array[]): Float32Array => {
  const out = new Float32Array(soups.reduce((n, s) => n + s.length, 0))
  let at = 0
  for (const s of soups) {
    out.set(s, at)
    at += s.length
  }
  return out
}

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

const open = (soup: Float32Array, name = 'part.stl') => run('scan.open', { bytes: stlBytes(soup), name, discard: true })
const fitFace = async (point: Vec3) => (await run<{ element: El }>('element.fit', { kind: 'plane', at: { point } })).element
const elements = () => useStore.getState().elements

describe('values sent as strings', () => {
  it('reads an all-digits string as an id unless something is named so', () => {
    const list = [{ name: 'Sphere 1' }, { name: '12' }]
    expect(refOf(list, '7')).toBe(7)
    expect(refOf(list, ' 7 ')).toBe(7)
    expect(refOf(list, '12')).toBe('12')
    expect(refOf(list, 'Sphere 1')).toBe('Sphere 1')
    expect(refOf(list, '7.5')).toBe('7.5')
    expect(refOf(list, 3)).toBe(3)
  })

  it('takes "false" and "true" for a boolean', async () => {
    await open(boxMesh(40, 20))
    const top = await fitFace([0, 0, 20])
    await run('element.set_visible', { element: top.id, visible: 'false' })
    expect(elements()[0].visible).toBe(false)
    await run('element.set_visible', { all: 'true', visible: 'true' })
    expect(elements()[0].visible).toBe(true)
  })

  it('takes an id sent as a string for elements, sections and dimensions — unless something is named so', async () => {
    await open(boxMesh(40, 20))
    const top = await fitFace([0, 0, 20])
    const bottom = await fitFace([0, 0, -20])
    await run('element.rename', { element: String(top.id), name: 'Top' })
    expect(elements().find((e) => e.id === top.id)?.name).toBe('Top')

    const s = await run<{ section: { id: number } }>('section.cut', { across: 'XY', name: 'Mid' })
    const got = await run<{ chains: unknown[] }>('section.get', { section: String(s.section.id) })
    expect(got.chains.length).toBeGreaterThan(0)
    expect((await refused('section.get', { section: '99' })).message).toMatch(/no section 99/)

    const d = await run<{ dimension: { id: number } }>('dimension.add', { refs: [String(top.id), String(bottom.id)] })
    await run('dimension.set_basic', { dimension: String(d.dimension.id), basic: 40 })
    expect(useStore.getState().dimensions[0].basic).toBe(40)

    // A name made of digits is still the name first.
    await run('element.rename', { element: bottom.id, name: String(top.id) })
    await run('element.rename', { element: String(top.id), name: 'Bottom' })
    expect(elements().find((e) => e.id === bottom.id)?.name).toBe('Bottom')
    expect(elements().find((e) => e.id === top.id)?.name).toBe('Top')
  })
})

describe('align.datum', () => {
  it('says which coordinates the first alignment centred, and keepFree leaves them', async () => {
    await open(shifted(boxMesh(40, 20), [100, 50, 30]))
    const top = await fitFace([100, 50, 50])
    const centred = await run<{ centred?: string[] }>('align.datum', { primary: { element: top.id } })
    expect(centred.centred).toEqual(['x', 'y'])
    const s = await run<{ scan: { bounds: { min: Vec3; max: Vec3 } } }>('session.state')
    expect((s.scan.bounds.min[0] + s.scan.bounds.max[0]) / 2).toBeCloseTo(0, 3)

    await open(shifted(boxMesh(40, 20), [100, 50, 30]))
    const again = await fitFace([100, 50, 50])
    const kept = await run<{ centred?: string[] }>('align.datum', { primary: { element: again.id }, keepFree: true })
    expect(kept.centred).toBeUndefined()
    const k = await run<{ scan: { bounds: { min: Vec3; max: Vec3 } } }>('session.state')
    expect((k.scan.bounds.min[0] + k.scan.bounds.max[0]) / 2).toBeCloseTo(100, 3)

    // Aligned once, the part is where it was put: nothing is centred.
    const second = await run<{ centred?: string[] }>('align.datum', { primary: { element: again.id } })
    expect(second.centred).toBeUndefined()
  })

  it('notes a parallel face a few millimetres off the levelling plane that holds more of the scan', async () => {
    // A 40 mm block with a 20 mm pad standing 4 mm proud of its bottom.
    await open(joined(boxMesh(40, 20), shifted(boxMesh(20, 10), [0, 0, -14])))
    const pad = await fitFace([0, 0, -24])
    type A = { parallelFace?: { offset: number; times: number; note: string } }
    const onPad = await run<A>('align.datum', { primary: { element: pad.id } })
    expect(onPad.parallelFace?.offset).toBeCloseTo(-4, 1)
    expect(onPad.parallelFace?.times).toBeGreaterThan(2)
    expect(onPad.parallelFace?.note).toMatch(/4 mm behind it along its outward normal, has about 4× its area/)
    // The block's own bottom has no larger face near it.
    await run('align.clear')
    const bottom = await fitFace([15, 15, -20])
    const onBottom = await run<A>('align.datum', { primary: { element: bottom.id } })
    expect(onBottom.parallelFace).toBeUndefined()
  })
})
