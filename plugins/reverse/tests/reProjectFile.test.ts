// SPDX-License-Identifier: AGPL-3.0-only
// The Reverse engineer workspace's part of a project file.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { validateManifest } from '../../../src/core/project/manifest'
import { collectProject, prepareProjectState, sessionIsDirty } from '../../../src/app/project'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { useThickness } from '../../../src/state/thicknessStore'
import { useFlat } from '../../../src/state/flatStore'
import { useShell } from '../../../src/state/shellStore'
import { useReverse } from '../state/reStore'
import { applyReversePart, type ReversePart } from '../app/projectSection'
import reversePlugin from '../plugin'
import { sources } from '../../../tests/projectKit'

function fresh() {
  useStore.getState().beginLoad('bracket.stl')
  useStore.getState().finishLoad(100, 50, 10, [1, 2, 3])
  useDeviation.setState({ nominalName: null, align: null, globalAlign: null, pairs: [], probes: [] })
  useThickness.getState().clear()
  useFlat.setState({ imageName: null, elements: [], dimensions: [], counts: [], datum: null })
  useShell.getState().setWorkspace('elements')
  useReverse.getState().reset()
}

beforeAll(() => reversePlugin.install?.())

describe('the Reverse engineer part of a project', () => {
  beforeEach(fresh)

  it('saves the reverse engineer features by reference and puts them back for a rebuild', () => {
    const re = useReverse.getState()
    expect(collectProject(sources(), null, '0.1.0').manifest.reverse).toBeUndefined()
    useReverse.setState({
      features: [
        { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'fitted', frame: { origin: [0, 0, 10], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] } }, frame: { origin: [0, 0, 10], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, sketch: { entities: [{ id: 1, kind: 'line', a: [0, 0], b: [10, 0] }], constraints: [{ id: 2, kind: 'horizontal', entity: 1, inferred: true }], nextId: 3 }, visible: true },
        { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: ['r:1'], extent: { kind: 'toPlane', from: 0, plane: { kind: 'plane', id: 9 } }, op: 'new', visible: true },
        { id: 3, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [{ kind: 'line', mid: [5, 0, 10], dir: [1, 0, 0], length: 10, faces: [{ kind: 'plane', dir: [0, -1, 0] }, { kind: 'plane', dir: [0, 0, 1] }], origin: 2 }], radius: 1.5, chain: true, visible: false },
        { id: 4, kind: 'surface', name: 'Surface 1', region: Uint32Array.from([7, 8, 9, 10]), fit: { net: null, degree: 3, expandPct: 35, smoothness: 0.01 }, visible: true },
      ],
      nextFeatureId: 5,
      nextOfKind: { sketch: 1, extrude: 1, fillet: 1, surface: 1 },
      scanSeeThrough: false,
      bodiesSeeThrough: true,
      elementsShown: false,
      extrudeDraft: { sketchId: 1, regions: [], extent: { kind: 'distance', from: 0, to: 1 }, draftDeg: 0, op: 'new' },
    })
    expect(sessionIsDirty()).toBe(true)
    const { manifest } = collectProject(sources(), null, '0.1.0')
    expect((manifest.reverse as ReversePart | undefined)?.features).toHaveLength(4)
    // A surface's region travels as a plain list, not a typed array's
    // keys.
    expect(JSON.parse(JSON.stringify(manifest)).reverse.features[3].region).toEqual([7, 8, 9, 10])
    // Through JSON and back, as the file goes: the drafts do not travel,
    // the features, their fingerprints and the counters do, and a rebuild
    // is asked for.
    const back = validateManifest(JSON.parse(JSON.stringify(manifest)))
    const before = useReverse.getState().buildVersion
    re.reset()
    expect(useReverse.getState().features).toHaveLength(0)
    applyReversePart(back.reverse as ReversePart)
    const s = useReverse.getState()
    expect(s.features.map((f) => f.kind)).toEqual(['sketch', 'extrude', 'fillet', 'surface'])
    expect(s.features[3].kind === 'surface' && s.features[3].region instanceof Uint32Array && Array.from(s.features[3].region)).toEqual([7, 8, 9, 10])
    expect(s.features[2].kind === 'fillet' && s.features[2].edges[0].faces.length === 2 && s.features[2].visible === false).toBe(true)
    expect(s.features[1].kind === 'extrude' && s.features[1].extent.kind === 'toPlane' && s.features[1].extent.plane.kind === 'plane').toBe(true)
    expect(s.nextFeatureId).toBe(5)
    expect(s.nextOfKind).toEqual({ sketch: 1, extrude: 1, fillet: 1, surface: 1 })
    expect(s.scanSeeThrough).toBe(false)
    expect(s.bodiesSeeThrough).toBe(true)
    expect(s.elementsShown).toBe(false)
    expect(s.extrudeDraft).toBeNull()
    expect(s.buildVersion).toBeGreaterThan(before)
    // The rollback bar travels: the whole list is saved, with where the bar
    // stood, and comes back rolled to the same place.
    useReverse.getState().rollTo(2)
    const rolled = collectProject(sources(), null, '0.1.0').manifest
    expect((rolled.reverse as ReversePart | undefined)?.features.map((f) => f.kind)).toEqual(['sketch', 'extrude', 'fillet', 'surface'])
    expect((rolled.reverse as ReversePart | undefined)?.rolledTo).toBe(2)
    re.reset()
    applyReversePart(validateManifest(JSON.parse(JSON.stringify(rolled))).reverse as ReversePart)
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['sketch', 'extrude'])
    expect(useReverse.getState().rolledBack.map((f) => f.kind)).toEqual(['fillet', 'surface'])
    // A project from before the workspace has no part and leaves it empty.
    applyReversePart(undefined)
    expect(useReverse.getState().features).toHaveLength(0)
    expect(useReverse.getState().rolledBack).toHaveLength(0)
  })

  it('reads the one Opaque key of an older project as the two see-through switches', () => {
    const part = { features: [], nextFeatureId: 1, nextOfKind: {}, elementsShown: true }
    const XY0 = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }
    applyReversePart({ ...part, bodyOpaque: false })
    expect(useReverse.getState()).toMatchObject({ scanSeeThrough: false, bodiesSeeThrough: true })
    applyReversePart({ ...part, bodyOpaque: true })
    expect(useReverse.getState()).toMatchObject({ scanSeeThrough: null, bodiesSeeThrough: false })
    // The scan following the bodies, as the workspace opens, is saved as
    // nothing at all.
    useReverse.setState({ features: [{ id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'fitted', frame: XY0 }, frame: XY0, sketch: { entities: [], constraints: [], nextId: 1 }, visible: true }] })
    const saved = collectProject(sources(), null, '0.1.0').manifest.reverse as ReversePart
    expect(saved.scanSeeThrough).toBeUndefined()
    expect(saved.bodiesSeeThrough).toBe(false)
  })

  it('saves the Overlaps switch off with the part, and nothing while it is on', () => {
    const XY0 = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }
    useReverse.setState({ features: [{ id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'fitted', frame: XY0 }, frame: XY0, sketch: { entities: [], constraints: [], nextId: 1 }, visible: true }] })
    useReverse.getState().setOverlapsShown(false)
    const off = validateManifest(JSON.parse(JSON.stringify(collectProject(sources(), null, '0.1.0').manifest))).reverse as ReversePart
    expect(off.overlapsShown).toBe(false)
    // A part opened anew has them on; this one comes back with them off.
    useReverse.getState().reset()
    expect(useReverse.getState().overlapsShown).toBe(true)
    applyReversePart(off)
    expect(useReverse.getState().overlapsShown).toBe(false)
    useReverse.getState().setOverlapsShown(true)
    expect((collectProject(sources(), null, '0.1.0').manifest.reverse as ReversePart).overlapsShown).toBeUndefined()
  })

  it('reads a Move face saved with its one face as a move of that face', () => {
    const top = { kind: 'plane' as const, centroid: [20, 10, 10] as [number, number, number], dir: [0, 0, 1] as [number, number, number], area: 800, origin: 2 }
    applyReversePart({ features: [{ id: 3, kind: 'moveFace', name: 'Move face 1', body: 2, face: top, offset: 0.5, visible: true }], nextFeatureId: 4, nextOfKind: { moveFace: 1 }, bodyOpaque: false, elementsShown: true })
    const f = useReverse.getState().features[0]
    expect(f.kind === 'moveFace' && f.faces).toEqual([top])
    expect(f.kind === 'moveFace' && 'face' in f).toBe(false)
  })

  it('saves the parameters with the expressions the features read them by, and reads them back', () => {
    const XY = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }
    useReverse.setState({
      parameters: [
        { id: 1, name: 'width', kind: 'length', expression: '40' },
        { id: 2, name: 'height', kind: 'length', expression: 'width / 2', comment: 'the boss' },
      ],
      nextParameterId: 3,
      features: [
        { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch: { entities: [{ id: 1, kind: 'line', a: [0, 0], b: [40, 0] }], constraints: [{ id: 2, kind: 'length', entity: 1, value: 40, expr: 'width' }], nextId: 3 }, visible: true },
        { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: ['r:1'], extent: { kind: 'distance', from: 0, to: 20 }, op: 'new', exprs: { 'extent.to': 'height' }, visible: true },
      ],
      nextFeatureId: 3,
      nextOfKind: { sketch: 1, extrude: 1 },
    })
    const { manifest } = collectProject(sources(), null, '0.1.0')
    const part = manifest.reverse as ReversePart
    expect(part.parameters).toHaveLength(2)
    expect(part.nextParameterId).toBe(3)
    const back = validateManifest(JSON.parse(JSON.stringify(manifest)))
    useReverse.getState().reset()
    expect(useReverse.getState().parameters).toEqual([])
    applyReversePart(back.reverse as ReversePart)
    const s = useReverse.getState()
    expect(s.parameters).toEqual([
      { id: 1, name: 'width', kind: 'length', expression: '40' },
      { id: 2, name: 'height', kind: 'length', expression: 'width / 2', comment: 'the boss' },
    ])
    expect(s.nextParameterId).toBe(3)
    expect(s.parameterTable.readings.map((r) => r.value)).toEqual([40, 20])
    expect(s.features[1]).toMatchObject({ exprs: { 'extent.to': 'height' } })
    expect(s.features[0].kind === 'sketch' && s.features[0].sketch.constraints[0]).toMatchObject({ value: 40, expr: 'width' })
    // Still read: a change moves the extrude.
    expect(s.setParameter(1, { expression: '60' })).toBeNull()
    expect(useReverse.getState().features[1]).toMatchObject({ extent: { to: 30 } })
    // A file whose expression no longer evaluates loads with the row saying
    // so and the numbers standing; one with no parameters loads with none.
    applyReversePart({ ...part, parameters: [{ id: 1, name: 'width', kind: 'length', expression: 'nothing' }] })
    expect(useReverse.getState().parameterTable.readings[0]).toMatchObject({ value: null, error: 'there is no parameter “nothing”' })
    expect(useReverse.getState().features[1]).toMatchObject({ extent: { to: 20 } })
    applyReversePart({ ...part, parameters: undefined, nextParameterId: undefined })
    expect(useReverse.getState().parameters).toEqual([])
    expect(useReverse.getState().nextParameterId).toBe(1)
    // A part with a parameter's id but no counter counts on from the ids.
    applyReversePart({ ...part, nextParameterId: undefined })
    expect(useReverse.getState().nextParameterId).toBe(3)
  })

  it('refuses malformed parameters', () => {
    const { manifest } = collectProject(sources(), null, '0.1.0')
    const json = JSON.parse(JSON.stringify(manifest))
    const base = { features: [], nextFeatureId: 1, nextOfKind: {}, bodyOpaque: true, elementsShown: true }
    expect(() => prepareProjectState(validateManifest({ ...json, reverse: { ...base, parameters: 'none' } }))).toThrow(/Malformed/)
    expect(() => prepareProjectState(validateManifest({ ...json, reverse: { ...base, parameters: [{ id: 1, name: 'a', kind: 'weight', expression: '1' }] } }))).toThrow(/parameter.kind/)
    expect(() => prepareProjectState(validateManifest({ ...json, reverse: { ...base, parameters: [{ id: 1, name: 'a', kind: 'length', expression: '1' }, { id: 2, name: 'a', kind: 'length', expression: '2' }] } }))).toThrow(/parameter.name/)
    expect(() => prepareProjectState(validateManifest({ ...json, reverse: { ...base, parameters: [{ id: 1, name: 'a', kind: 'length' }] } }))).toThrow(/Malformed/)
  })

  it('refuses a malformed part before anything changes', () => {
    const { manifest } = collectProject(sources(), null, '0.1.0')
    const json = JSON.parse(JSON.stringify(manifest))
    expect(() => prepareProjectState(validateManifest({ ...json, reverse: { features: 'none' } }))).toThrow('reverse engineer entry')
    expect(() => prepareProjectState(validateManifest({ ...json, reverse: { features: [], nextFeatureId: 1, nextOfKind: {}, rolledTo: 3 } }))).toThrow(/Malformed/)
  })
})
