// SPDX-License-Identifier: AGPL-3.0-only
// What the session says it holds, and what a new scan keeps of it: the
// work counted in session.state and named in a refusal to replace it, the
// unsaved flag as the page's watcher gives it, a reference part kept or
// let go with the scan, and a reference made from the session's own work
// leaving the search distance as it was set. On a 40 mm box, in the
// in-process worker — see commandKit.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { referenceSpacing } from '../src/commands/state'
import { watchUnsaved } from '../src/app/project'
import { useDeviation } from '../src/state/deviationStore'
import { useStore } from '../src/state/store'
import { boxMesh } from './helpers'
import { refused, run, startHeadless, stlBytes, type Headless } from './commandKit'

const BOX = stlBytes(boxMesh(40, 40))
const fileOf = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name)

let headless: Headless
beforeAll(async () => {
  headless = await startHeadless()
})
afterAll(() => headless.stop())

const openBox = () => run('scan.open', { bytes: BOX, name: 'box.stl', discard: true })

type Project = { project: { name: string | null; unsaved: boolean | null; holds: Record<string, number> } }

describe('what the session holds', () => {
  beforeEach(async () => {
    await openBox()
    useStore.getState().setProjectName(null)
  })

  it('counts its work in session.state, and names it with the project in a refusal', async () => {
    expect((await run<Project>('session.state')).project).toEqual({ name: null, unsaved: null, holds: {} })
    await run('element.fit', { kind: 'plane', at: { point: [0, 0, 20] } })
    await run('element.fit', { kind: 'plane', at: { point: [20, 0, 0] } })
    useStore.getState().setProjectName('Sigma')
    expect((await run<Project>('session.state')).project).toEqual({ name: 'Sigma', unsaved: null, holds: { elements: 2 } })
    const e = await refused('scan.open', { bytes: BOX, name: 'box.stl' })
    expect(e.code).toBe('invalid_state')
    expect(e.message).toContain('2 elements in the project “Sigma”')
    expect(e.message).toContain('discard: true')
  })

  it('says whether the work is saved, as the page’s watcher has it', async () => {
    let unsaved = true
    const stop = watchUnsaved(() => unsaved)
    try {
      await run('element.fit', { kind: 'plane', at: { point: [0, 0, 20] } })
      expect((await run<Project>('session.state')).project.unsaved).toBe(true)
      expect((await refused('scan.open', { bytes: BOX, name: 'box.stl' })).message).toContain('1 element, with changes not saved,')
      unsaved = false
      expect((await refused('scan.open', { bytes: BOX, name: 'box.stl' })).message).toContain('all of it saved')
    } finally {
      stop()
    }
    expect((await run<Project>('session.state')).project.unsaved).toBeNull()
  })
})

describe('the reference over a new scan', () => {
  beforeEach(async () => {
    await openBox()
  })

  it('a reference opened from a file stays, and scan.open says so', async () => {
    await run('deviation.open_reference', { bytes: BOX, name: 'nominal.stl' })
    const opened = await run<{ referenceKept?: string }>('scan.open', { bytes: BOX, name: 'box.stl', discard: true })
    expect(opened.referenceKept).toBe('nominal.stl')
    expect(useDeviation.getState().nominalName).toBe('nominal.stl')
    await run('deviation.align')
    expect(useDeviation.getState().mapStatus).toBe('ready')
  })

  it('one made from the session’s work goes with the scan', async () => {
    const { session } = headless
    await session.deviation.openNominal(fileOf(BOX, 'Made here.stl'), 'mm', { fromSession: true })
    expect(useDeviation.getState()).toMatchObject({ nominalName: 'Made here.stl', nominalFromSession: true })
    const opened = await run<{ referenceKept?: string; referenceDropped?: string }>('scan.open', { bytes: BOX, name: 'box.stl', discard: true })
    expect(opened).toMatchObject({ referenceDropped: 'Made here.stl' })
    expect(opened.referenceKept).toBeUndefined()
    expect(useDeviation.getState()).toMatchObject({ nominalName: null, nominalFromSession: false })
    expect(session.sources.current.reference).toBeNull()
    // The worker let go of it too: there is nothing to align to.
    expect((await refused('deviation.align')).code).toBe('invalid_state')
  })

  it('one made from the session’s work keeps the search distance; a file opened starts it over', async () => {
    const { session } = headless
    await run('deviation.open_reference', { bytes: BOX, name: 'nominal.stl' })
    await run('deviation.settings', { maxDistance: 1.5 })
    expect(useDeviation.getState()).toMatchObject({ maxDistance: 1.5, maxDistanceAuto: false })
    for (let i = 0; i < 2; i++) {
      await session.deviation.openNominal(fileOf(BOX, 'Made here.stl'), 'mm', { fromSession: true })
      await run('deviation.align')
      expect(useDeviation.getState()).toMatchObject({ nominalName: 'Made here.stl', maxDistance: 1.5, maxDistanceAuto: false, mapStatus: 'ready' })
    }
    await run('deviation.open_reference', { bytes: BOX, name: 'nominal.stl' })
    expect(useDeviation.getState().maxDistanceAuto).toBe(true)
  })

  it('the map on the reference says how far apart its readings lie, and by what rule', async () => {
    await run('deviation.open_reference', { bytes: BOX, name: 'nominal.stl' })
    await run('deviation.align')
    expect(referenceSpacing()).toBeNull()
    await run('deviation.settings', { on: 'reference' })
    // The tolerance of 0.1 wants 0.2, held at the quarter millimetre; a 40 mm
    // box is far too small to open it.
    expect(referenceSpacing()).toEqual({ mm: 0.25, wanted: 0.25, rule: 'twice the tolerance, within 0.25–2 mm' })
    const state = await run<{ deviation: { onReference: { spacing: number; spacingOpened?: string } } }>('session.state')
    expect(state.deviation.onReference.spacing).toBe(0.25)
    expect(state.deviation.onReference.spacingOpened).toBeUndefined()
  })
})
