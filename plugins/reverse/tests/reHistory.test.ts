// SPDX-License-Identifier: AGPL-3.0-only
// Reverse engineer in the undo history: its features as a step beside the
// app's workspaces, and an open sketch's own history walked first.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../src/state/store'
import { useFlat } from '../../../src/state/flatStore'
import { useDeviation } from '../../../src/state/deviationStore'
import { useThickness } from '../../../src/state/thicknessStore'
import { useShell } from '../../../src/state/shellStore'
import { clearHistory, configureHistory, installHistory, undo, redo, useHistory } from '../../../src/state/historyStore'
import { useReverse } from '../state/reStore'
import reversePlugin from '../plugin'
import { XY } from './reKit'

const m = () => useStore.getState(), f = () => useFlat.getState(), d = () => useDeviation.getState()
const t = () => useThickness.getState(), r = () => useReverse.getState(), h = () => useHistory.getState()
let uninstall: () => void
let unconfigure: () => void
beforeAll(() => reversePlugin.install?.())
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  useFlat.setState(useFlat.getInitialState(), true)
  useDeviation.setState(useDeviation.getInitialState(), true)
  useThickness.setState(useThickness.getInitialState(), true)
  useReverse.setState(useReverse.getInitialState(), true)
  useShell.getState().setWorkspace('elements')
  clearHistory()
  unconfigure = configureHistory({})
  uninstall = installHistory()
})
afterEach(() => { uninstall(); unconfigure() })

function plane() {
  m().startDraft('plane')
  m().resolveDraft({ kind: 'plane', center: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 10, extentV: 10,
    sigma: 0, usedPoints: 3, regionSize: 3, region: new Uint32Array([0, 1, 2]) })
  return m().commitDraft()!
}
function square(commit = true) {
  r().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  r().setSketchTool('rectangle')
  r().sketchClick([0, 0], 0.5, false, { off: true })
  r().sketchClick([10, 10], 0.5, false, { off: true })
  return commit ? r().commitSketch() : null
}
function flatPoint() {
  f().startDraft('point', 'flat-point-pick')
  f().addDraftPick([100, 200])
  return f().commitDraft()!
}

describe('project history', () => {
  it('undoes and redoes chronologically across all five workspaces with stable IDs', async () => {
    plane()
    useShell.getState().setWorkspace('flat')
    f().finishImageLoad('image.png', 1000, 800, { x: 10, y: 10 })
    flatPoint()
    useShell.getState().setWorkspace('deviation')
    d().addProbe([1, 2, 3], 0.1)
    useShell.getState().setWorkspace('thickness')
    t().addProbe([3, 2, 1], 2)
    useShell.getState().setWorkspace('reverse')
    square()
    expect(h().past).toHaveLength(5)
    for (const workspace of ['reverse', 'thickness', 'deviation', 'flat', 'elements']) {
      await undo()
      expect(useShell.getState().workspace).toBe(workspace)
    }
    expect([m().elements.length, f().elements.length, d().probes.length, t().probes.length, r().features.length]).toEqual([0, 0, 0, 0, 0])
    for (let i = 0; i < 5; i++) await redo()
    expect([m().elements[0].id, f().elements[0].id, d().probes[0].id, t().probes[0].id, r().features[0].id]).toEqual([1, 1, 1, 1, 1])
  })

  it('does not record an empty sketch commit', () => {
    r().commitSketch()
    expect(h().past).toHaveLength(0)
  })
})

describe('sketch history within project history', () => {
  it('redos sketch edits, clears the branch on new drawing, and preserves project history', async () => {
    t().setLimit(5)
    square(false)
    const sketch = structuredClone(r().sketchDraft!.sketch)
    await undo()
    expect(r().sketchDraft!.sketch.entities).toHaveLength(0)
    expect(h().past).toHaveLength(1)
    await redo()
    expect(r().sketchDraft!.sketch).toEqual(sketch)
    await undo()
    r().setSketchTool('rectangle')
    r().sketchClick([20, 20], 0.5, false, { off: true })
    r().sketchClick([30, 30], 0.5, false, { off: true })
    expect(r().sketchDraft!.future).toHaveLength(0)
    r().commitSketch()
    expect(h().past).toHaveLength(2)
    await undo()
    expect(r().features).toHaveLength(0)
    await redo()
    expect(r().features).toHaveLength(1)
  })

  it('restores feature rollback and parameters and requests a CAD rebuild', async () => {
    const sketch = square()!
    r().startExtrude(sketch)
    const extrude = r().commitExtrude()!
    clearHistory()
    r().setKeyParameter(extrude, 25)
    const changed = r().features
    await undo()
    expect(r().features).not.toBe(changed)
    const buildVersion = r().buildVersion
    await redo()
    expect(r().features).toBe(changed)
    expect(r().buildVersion).toBeGreaterThan(buildVersion)
    r().rollTo(1)
    expect(r().rolledBack).toHaveLength(1)
    await undo()
    expect(r().features).toHaveLength(2)
    expect(r().rolledBack).toHaveLength(0)
  })
})
