// SPDX-License-Identifier: AGPL-3.0-only
// The boxes of the features on a body, at the store: what opens with what,
// a pick toggled on and off, the feature a draft becomes, and an edit that
// reopens it with its fingerprints.
import { beforeEach, describe, expect, it } from 'vitest'
import type { EdgeInfo, FaceInfo } from '../core/build'
import { findRegions } from '../core/regions'
import { addRectangle, emptySketch } from '../core/sketch'
import { useStore } from '../../../src/state/store'
import { DEFAULT_FILLET_MM, DEFAULT_WALL_MM, editingFeatureId, featureDraftReady, featureOfDraft, historyEditOf, openFeatureEditor, reEditorOpen, snapFaceOf, snapPlanOf, trimToleranceFor, useReverse } from '../state/reStore'

const face = (hash: number, dir: [number, number, number]): FaceInfo => ({ hash, fingerprint: { kind: 'plane', centroid: [0, 0, 5], dir, area: 100, origin: 2 } })
const edge = (hash: number): EdgeInfo => ({ hash, fingerprint: { kind: 'line', mid: [20, 0, 10], dir: [1, 0, 0], length: 40, faces: [{ kind: 'plane', dir: [0, -1, 0] }, { kind: 'plane', dir: [0, 0, 1] }], origin: 2 }, faces: [], ends: [[0, 0, 10], [40, 0, 10]], endTangents: [[1, 0, 0], [1, 0, 0]], polyline: new Float32Array(0) })

describe('the feature drafts', () => {
  beforeEach(() => {
    useReverse.getState().reset()
    useReverse.setState({ bodies: [{ id: 2, name: 'Extrude 1', visible: true, volume: 1, faces: 6, closed: true, triangles: 12 }], nextFeatureId: 3, nextOfKind: {} })
  })

  it('puts the element an extract was taken from out of view, so the two are not drawn over each other', () => {
    useStore.setState({ elements: [{ id: 4, visible: true }, { id: 5, visible: true }] as unknown as ReturnType<typeof useStore.getState>['elements'] })
    useReverse.getState().startFeature('extract', { element: 4 })
    const d = useReverse.getState().featureDraft!
    expect(d.kind === 'extract' && d.op).toBe('new')
    expect(useReverse.getState().commitFeature()).toBe(3)
    expect(useStore.getState().elements.map((e) => [e.id, e.visible])).toEqual([[4, false], [5, true]])
    // Reopened and saved, the element stays as the operator left it.
    useStore.getState().toggleElementVisible(4)
    useReverse.getState().editFeature(3)
    useReverse.getState().commitFeature()
    expect(useStore.getState().elements.find((e) => e.id === 4)?.visible).toBe(true)
    useStore.setState({ elements: [] })
  })

  it('opens a shell on the last body and is ready once a face is picked', () => {
    const re = useReverse.getState()
    re.startFeature('shell')
    let d = useReverse.getState().featureDraft!
    expect(d.kind === 'shell' && d.body === 2 && d.thickness === DEFAULT_WALL_MM && d.faces.length === 0).toBe(true)
    expect(reEditorOpen(useReverse.getState())).toBe(true)
    // Ready with no face: a closed hollow body.
    expect(featureDraftReady(d)).toBe(true)
    useReverse.getState().toggleDraftFace(2, face(7, [0, 0, 1]))
    d = useReverse.getState().featureDraft!
    expect(featureDraftReady(d)).toBe(true)
    // The same face again is let go; a face of another body moves the
    // shell to that body.
    useReverse.getState().toggleDraftFace(2, face(7, [0, 0, 1]))
    expect((useReverse.getState().featureDraft as { faces: FaceInfo[] }).faces.length).toBe(0)
    useReverse.getState().toggleDraftFace(9, face(8, [0, 0, -1]))
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'shell' && d.body === 9 && d.faces.length === 1).toBe(true)
  })

  it('commits a fillet as a feature carrying fingerprints, named in order, and reopens it', () => {
    const re = useReverse.getState()
    re.startFeature('fillet', { body: 2, edges: [edge(11)] })
    const d = useReverse.getState().featureDraft!
    expect(d.kind === 'fillet' && d.radius === DEFAULT_FILLET_MM && d.chain && d.estimate.status === 'idle').toBe(true)
    expect(featureDraftReady(d)).toBe(true)
    const id = useReverse.getState().commitFeature()
    expect(id).toBe(3)
    const s = useReverse.getState()
    expect(s.featureDraft).toBeNull()
    const f = s.features[0]
    expect(f.kind === 'fillet' && f.name === 'Fillet 1' && f.body === 2 && f.edges.length === 1 && f.edges[0].kind === 'line').toBe(true)
    expect(s.past.length).toBe(1)
    // Reopened: the picks come back as fingerprints without a hash.
    s.editFeature(3)
    const e = useReverse.getState().featureDraft!
    expect(e.kind === 'fillet' && e.featureId === 3 && e.edges[0].hash === -1 && e.radiusTyped).toBe(true)
    useReverse.getState().setFeatureDraft({ radius: 2.5 })
    expect(useReverse.getState().commitFeature()).toBe(3)
    const g = useReverse.getState().features[0]
    expect(g.kind === 'fillet' && g.radius === 2.5 && g.name === 'Fillet 1').toBe(true)
  })

  it('opens the editor of whichever feature made a face: a sketch its own, a body feature its box', () => {
    const sketch = emptySketch()
    addRectangle(sketch, [0, 0], [40, 20])
    useReverse.setState({
      features: [
        { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, sketch, visible: true },
        { id: 3, kind: 'fillet', name: 'Fillet 1', body: 2, edges: [edge(11).fingerprint], radius: 2, chain: true, visible: true },
      ],
    })
    openFeatureEditor(3)
    expect(editingFeatureId(useReverse.getState())).toBe(3)
    expect(useReverse.getState().featureDraft?.kind).toBe('fillet')
    useReverse.getState().cancelFeature()
    openFeatureEditor(1)
    expect(editingFeatureId(useReverse.getState())).toBe(1)
    expect(useReverse.getState().sketchDraft).not.toBeNull()
    useReverse.getState().discardSketch()
    // A face whose maker is gone opens nothing.
    openFeatureEditor(99)
    expect(reEditorOpen(useReverse.getState())).toBe(false)
  })

  it('makes the feature of every kind of draft once it is ready, and none before', () => {
    expect(featureOfDraft({ kind: 'hole', body: 2, axis: null, radius: 3, depth: null }, 5, 'Hole 1')).toBeNull()
    const hole = featureOfDraft({ kind: 'hole', body: 2, axis: { kind: 'element', id: 4 }, radius: 3, depth: null }, 5, 'Hole 1')
    expect(hole?.kind === 'hole' && hole.radius === 3 && hole.depth === null).toBe(true)
    const cut = featureOfDraft({ kind: 'cutPlane', body: 2, plane: { kind: 'world', axis: 'x', offset: 1 }, keep: -1 }, 6, 'Cut 1')
    expect(cut?.kind === 'cutPlane' && cut.keep === -1).toBe(true)
    expect(featureOfDraft({ kind: 'boolean', op: 'join', body: 2, tool: 2, keep: false }, 7, 'Combine 1')).toBeNull()
    const combine = featureOfDraft({ kind: 'boolean', op: 'cut', body: 2, tool: 5, keep: false }, 7, 'Combine 1')
    expect(combine?.kind === 'boolean' && combine.tool === 5 && combine.keep === undefined).toBe(true)
    const kept = featureOfDraft({ kind: 'boolean', op: 'join', body: 2, tool: 5, keep: true }, 7, 'Combine 1')
    expect(kept?.kind === 'boolean' && kept.keep).toBe(true)
    const extract = featureOfDraft({ kind: 'extract', element: 4, section: null, thickness: 2, op: 'new' }, 8, 'Body 1')
    expect(extract?.kind === 'extract' && extract.target === undefined).toBe(true)
    const mirror = featureOfDraft({ kind: 'mirror', body: 2, plane: { kind: 'face', face: face(1, [1, 0, 0]).fingerprint }, join: false, symmetry: { status: 'idle' } }, 9, 'Mirror 1')
    expect(mirror?.kind === 'mirror' && mirror.plane.kind === 'face' && !mirror.join).toBe(true)
  })

  it('a hole takes a round face of the body for its axis and its radius, or a flat one to drill into at its centre; a mirror a flat one', () => {
    const re = useReverse.getState()
    re.startFeature('hole')
    const flat = face(3, [0, 0, 1])
    useReverse.getState().toggleDraftFace(2, flat)
    const into = useReverse.getState().featureDraft!
    expect(into.kind === 'hole' && into.axis).toEqual({ kind: 'point', face: flat.fingerprint, at: flat.fingerprint.centroid })
    expect(into.kind === 'hole' && into.depth).toBe(10)
    useReverse.getState().toggleDraftFace(2, { hash: 4, fingerprint: { kind: 'cylinder', centroid: [10, 10, 5], dir: [0, 0, 1], area: 94, radius: 3, center: [10, 10, 5], origin: 2 } })
    const h = useReverse.getState().featureDraft!
    expect(h.kind === 'hole' && h.axis?.kind === 'face' && h.radius === 3).toBe(true)
    useReverse.getState().startFeature('mirror')
    useReverse.getState().toggleDraftFace(2, face(3, [0, 0, 1]))
    const m = useReverse.getState().featureDraft!
    expect(m.kind === 'mirror' && m.plane?.kind === 'face').toBe(true)
  })

  it('a feature others build on cannot be removed', () => {
    useReverse.setState({
      features: [
        { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, sketch: { entities: [], constraints: [], nextId: 1 }, visible: true },
        { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: [], extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true },
        { id: 3, kind: 'shell', name: 'Shell 1', body: 2, faces: [], thickness: 1, visible: true },
      ],
    })
    useReverse.getState().removeFeature(2)
    expect(useReverse.getState().features.length).toBe(3)
    useReverse.getState().removeFeature(3)
    expect(useReverse.getState().features.length).toBe(2)
  })

  it('a surface gathers its region by floods, in and out, and by the tools, and is ready at sixteen points', () => {
    const re = useReverse.getState()
    re.startFeature('surface')
    let d = useReverse.getState().featureDraft!
    expect(d.kind === 'surface' && d.region.length === 0 && d.fit.net === null && d.fit.expandPct === 35 && !d.paint).toBe(true)
    expect(featureDraftReady(d)).toBe(false)
    // A flood adds what is new; a second of the same adds nothing; Ctrl
    // takes away.
    useReverse.getState().addToRegion(Uint32Array.from([1, 2, 3, 4]))
    useReverse.getState().addToRegion(Uint32Array.from([3, 4, 5]))
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'surface' && Array.from(d.region)).toEqual([1, 2, 3, 4, 5])
    useReverse.getState().addToRegion(Uint32Array.from([2, 5]), true)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'surface' && Array.from(d.region)).toEqual([1, 3, 4])
    // The tools hand the region over whole.
    const marked = new Uint32Array(20)
    for (let i = 0; i < 20; i++) marked[i] = 100 + i
    useReverse.getState().setRegion(marked)
    d = useReverse.getState().featureDraft!
    expect(featureDraftReady(d)).toBe(true)
    const f = featureOfDraft(d, 9, 'Surface 1')
    expect(f?.kind === 'surface' && f.region === marked && f.fit.degree === 3).toBe(true)
    // Committed and reopened, it carries its region and its parameters.
    useReverse.getState().setFeatureDraft({ fit: { net: { u: 6, v: 4 }, degree: 3, expandPct: 20, smoothness: 0 } })
    const id = useReverse.getState().commitFeature()!
    expect(useReverse.getState().features.find((x) => x.id === id)?.kind).toBe('surface')
    useReverse.getState().editFeature(id)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'surface' && d.region.length === 20 && d.fit.net?.u === 6 && d.fit.expandPct === 20).toBe(true)
  })

  it('a trim opens with every surface body in the set and its tolerance read off their fits', () => {
    useReverse.setState({
      bodies: [
        { id: 2, name: 'Extrude 1', visible: true, volume: 1, faces: 6, closed: true, triangles: 12 },
        { id: 5, name: 'Surface 1', visible: true, volume: 0, faces: 1, closed: false, triangles: 2, surface: true },
        { id: 6, name: 'Surface 2', visible: true, volume: 0, faces: 1, closed: false, triangles: 2, surface: true },
      ],
      results: { 5: { id: 5, status: 'ok', surface: { rms: 0.03, max: 0.1, net: { u: 5, v: 5 }, points: 100 } }, 6: { id: 6, status: 'ok', surface: { rms: 0.01, max: 0.05, net: { u: 5, v: 5 }, points: 100 } } },
    })
    useReverse.getState().startFeature('trim')
    let d = useReverse.getState().featureDraft!
    expect(d.kind === 'trim' && d.tools).toEqual([{ kind: 'body', id: 5 }, { kind: 'body', id: 6 }])
    // Three times the median σ (the upper of two), floored at 0.05.
    expect(d.kind === 'trim' && d.tolerance).toBe(0.09)
    expect(featureDraftReady(d)).toBe(true)
    expect(trimToleranceFor([{ kind: 'element', id: 9 }], {})).toBe(0.3)
    expect(trimToleranceFor([{ kind: 'body', id: 6 }], useReverse.getState().results)).toBe(0.05)
    expect(trimToleranceFor([{ kind: 'body', id: 5 }], { 5: { id: 5, status: 'ok', surface: { rms: 1, max: 2, net: { u: 3, v: 3 }, points: 50 } } })).toBe(0.5)
    const f = featureOfDraft(d, 7, 'Trim 1')
    expect(f?.kind === 'trim' && f.tools.length === 2 && f.overlap === 0.5).toBe(true)
    useReverse.getState().setFeatureDraft({ tools: [] })
    d = useReverse.getState().featureDraft!
    expect(featureDraftReady(d)).toBe(false)
  })

  it('a draft takes the first flat face as its neutral plane and the faces after it as the ones leaned', () => {
    useReverse.getState().startFeature('draft')
    const round: FaceInfo = { hash: 9, fingerprint: { kind: 'cylinder', centroid: [0, 0, 5], dir: [0, 0, 1], area: 50, radius: 3, center: [0, 0, 5], origin: 2 } }
    // A round face cannot be the neutral plane.
    useReverse.getState().toggleDraftFace(2, round)
    let d = useReverse.getState().featureDraft!
    expect(d.kind === 'draft' && d.neutral).toBe(null)
    useReverse.getState().toggleDraftFace(2, face(1, [0, 0, -1]))
    useReverse.getState().toggleDraftFace(2, face(3, [1, 0, 0]))
    useReverse.getState().toggleDraftFace(2, round)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'draft' && d.neutral?.kind === 'face' && d.faces.map((f) => f.hash)).toEqual([3, 9])
    expect(featureDraftReady(d)).toBe(true)
    // Clicked again, a face is let go.
    useReverse.getState().toggleDraftFace(2, round)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'draft' && d.faces.map((f) => f.hash)).toEqual([3])
    const id = useReverse.getState().commitFeature()
    const f = useReverse.getState().features.find((x) => x.id === id)
    expect(f?.kind === 'draft' && f.angleDeg === 2 && f.faces.length === 1 && f.name === 'Draft 1').toBe(true)
    // The row's number is the angle, and takes a sign.
    useReverse.getState().setKeyParameter(id!, -3)
    const again = useReverse.getState().features.find((x) => x.id === id)
    expect(again?.kind === 'draft' && again.angleDeg).toBe(-3)
    useReverse.getState().editFeature(id!)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'draft' && d.faces[0].hash === -1 && d.angleDeg === -3).toBe(true)
  })

  it('a moved face is ready once it has a face and somewhere to go, from the scan or typed', () => {
    useReverse.getState().startFeature('moveFace', { body: 2, faces: [face(7, [0, 0, 1])], snap: true })
    let d = useReverse.getState().featureDraft!
    expect(featureDraftReady(d)).toBe(false)
    useReverse.getState().setFeatureDraft({ offset: 1.25, reading: { offset: 1.25, tiltDeg: 0.4, sigma: 0.03 } })
    d = useReverse.getState().featureDraft!
    expect(featureDraftReady(d)).toBe(true)
    // Dragged or typed, the number is the operator's and the reading goes.
    useReverse.getState().setGripValue('move', -2)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'moveFace' && d.offset === -2 && d.reading === null).toBe(true)
    // A cone is not a face this moves.
    useReverse.getState().clearDraftPicks()
    useReverse.getState().toggleDraftFace(2, { hash: 4, fingerprint: { kind: 'cone', centroid: [0, 0, 0], dir: [0, 0, 1], area: 10, origin: 2 } })
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'moveFace' && d.faces.length === 0 && d.error).toMatch(/flat or a cylindrical/)
    // Nor a fillet's part of a cylinder, clicked or in a window: its
    // radius changes only the whole way round.
    const fillet: FaceInfo = { hash: 5, fingerprint: { kind: 'cylinder', centroid: [1, 1, 9], dir: [1, 0, 0], area: 60, radius: 2, center: [0, 0, 8], origin: 3 }, fullTurn: false }
    useReverse.getState().toggleDraftFace(2, fillet)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'moveFace' && d.faces.length === 0 && d.error).toMatch(/full turn/)
    useReverse.getState().addDraftFaces(2, [fillet])
    expect((useReverse.getState().featureDraft as { faces: FaceInfo[] }).faces).toHaveLength(0)
    useReverse.getState().toggleDraftFace(2, face(7, [0, 0, 1]))
    useReverse.getState().setFeatureDraft({ offset: 0.5 })
    const id = useReverse.getState().commitFeature()
    const f = useReverse.getState().features.find((x) => x.id === id)
    expect(f?.kind === 'moveFace' && f.offset === 0.5 && f.name === 'Move face 1' && f.faces.length === 1).toBe(true)
  })

  it('moves several faces by one offset: clicks add and let go, a window adds, and the scan is read for one face only', () => {
    const top = face(7, [0, 0, 1])
    const bottom = face(8, [0, 0, -1])
    const wall: FaceInfo = { hash: 9, fingerprint: { kind: 'cylinder', centroid: [0, 0, 5], dir: [0, 0, 1], area: 250, radius: 4, center: [0, 0, 5], origin: 2 } }
    useReverse.getState().startFeature('moveFace', { body: 2, faces: [top], snap: true })
    useReverse.getState().setFeatureDraft({ offset: 0.75, reading: { offset: 0.75, tiltDeg: 0, sigma: 0.02 } })
    expect(snapFaceOf(useReverse.getState().featureDraft!)?.hash).toBe(7)
    // A second face: the move is of both, the reading and the snap go,
    // the number stays.
    useReverse.getState().toggleDraftFace(2, wall)
    let d = useReverse.getState().featureDraft!
    expect(d.kind === 'moveFace' && d.faces.map((f) => f.hash)).toEqual([7, 9])
    expect(d.kind === 'moveFace' && !d.snap && d.reading === null && d.offset === 0.75).toBe(true)
    expect(snapFaceOf(d)).toBe(null)
    // A window adds what is not there yet, and never a cone.
    useReverse.getState().addDraftFaces(2, [wall, bottom, { hash: 4, fingerprint: { kind: 'cone', centroid: [0, 0, 0], dir: [0, 0, 1], area: 10, origin: 2 } }])
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'moveFace' && d.faces.map((f) => f.hash)).toEqual([7, 9, 8])
    // A click on a picked face lets it go.
    useReverse.getState().toggleDraftFace(2, top)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'moveFace' && d.faces.map((f) => f.hash)).toEqual([9, 8])
    useReverse.getState().toggleDraftFace(2, top)
    // Faces nothing traces back from move on the body, as one feature.
    expect(snapPlanOf(useReverse.getState().featureDraft!, [])?.route).toBe('direct')
    const id = useReverse.getState().commitFeature()
    const f = useReverse.getState().features.find((x) => x.id === id)
    expect(f?.kind === 'moveFace' && f.faces.length === 3 && f.offset === 0.75).toBe(true)
    // Reopened, the picks come back as fingerprints to be found again.
    useReverse.getState().editFeature(id!)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'moveFace' && d.faces.length === 3 && d.faces.every((x) => x.hash === -1)).toBe(true)
    useReverse.getState().cancelFeature()
  })

  it('a moved face is a Move face in the list — or, ticked, goes into the extrude that made it: the list is edited, nothing is added, and Ctrl+Z takes it back', () => {
    const sketch = emptySketch()
    addRectangle(sketch, [0, 0], [40, 20])
    const frame = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }
    useReverse.setState({
      features: [
        { id: 1, kind: 'sketch', name: 'Sketch 1', plane: { kind: 'world', axis: 'z', offset: 0 }, frame, sketch, visible: true },
        { id: 2, kind: 'extrude', name: 'Extrude 1', sketchId: 1, regions: findRegions(sketch).map((r) => r.key), extent: { kind: 'distance', from: 0, to: 10 }, op: 'new', visible: true },
      ],
    })
    const top: FaceInfo = { hash: 7, fingerprint: { kind: 'plane', centroid: [20, 10, 10], dir: [0, 0, 1], area: 800, origin: 2 } }
    useReverse.getState().startFeature('moveFace', { body: 2, faces: [top] })
    useReverse.getState().setFeatureDraft({ offset: 2 })
    const plan = snapPlanOf(useReverse.getState().featureDraft!, useReverse.getState().features)
    expect(plan?.route).toBe('extent')
    // Unticked, the move is a feature of its own, as any other.
    expect(historyEditOf(useReverse.getState().featureDraft!, useReverse.getState().features)).toBeNull()
    expect(useReverse.getState().commitFeature()).toBe(3)
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['sketch', 'extrude', 'moveFace'])
    useReverse.getState().undoFeatures()
    expect(useReverse.getState().features).toHaveLength(2)
    useReverse.getState().startFeature('moveFace', { body: 2, faces: [top] })
    useReverse.getState().setFeatureDraft({ offset: 2, history: true })
    expect(historyEditOf(useReverse.getState().featureDraft!, useReverse.getState().features)?.route).toBe('extent')
    useReverse.getState().commitFeature()
    let s = useReverse.getState()
    expect(s.featureDraft).toBe(null)
    expect(s.features).toHaveLength(2)
    const e = s.features[1]
    expect(e.kind === 'extrude' && e.extent).toEqual({ kind: 'distance', from: 0, to: 12 })
    s.undoFeatures()
    s = useReverse.getState()
    const back = s.features[1]
    expect(back.kind === 'extrude' && back.extent).toEqual({ kind: 'distance', from: 0, to: 10 })
    // A face nothing traces back from is moved on the body: a Move face.
    useReverse.getState().startFeature('moveFace', { body: 2, faces: [{ ...top, fingerprint: { ...top.fingerprint, origin: 99 } }] })
    useReverse.getState().setFeatureDraft({ offset: 2, history: true })
    expect(historyEditOf(useReverse.getState().featureDraft!, useReverse.getState().features)).toBeNull()
    expect(snapPlanOf(useReverse.getState().featureDraft!, useReverse.getState().features)?.route).toBe('direct')
    useReverse.getState().commitFeature()
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['sketch', 'extrude', 'moveFace'])
  })

  it('pulls a flat face as the profile itself — no sketch made — out joining and in cutting, and the feature carries the face', () => {
    const top: FaceInfo = { hash: 7, fingerprint: { kind: 'plane', centroid: [20, 10, 10], dir: [0, 0, 1], area: 800, origin: 2 } }
    const before = useReverse.getState().features.length
    const sketchesBefore = useReverse.getState().features.filter((f) => f.kind === 'sketch').length
    expect(useReverse.getState().extrudeFace(2, top)).toBe(null)
    let s = useReverse.getState()
    expect(s.features.length).toBe(before)
    expect(s.extrudeDraft?.face).toEqual({ body: 2, face: top.fingerprint })
    expect(s.extrudeDraft?.sketchId === null && s.extrudeDraft.regions.length === 0 && s.extrudeDraft.op === 'join').toBe(true)
    // Pushed into the body it cuts; pulled back out it joins again.
    s.setExtrude({ extent: { kind: 'distance', from: 0, to: -3 } })
    expect(useReverse.getState().extrudeDraft?.op).toBe('cut')
    useReverse.getState().flipExtrude()
    expect(useReverse.getState().extrudeDraft?.op).toBe('join')
    // A result chosen by hand stays chosen.
    useReverse.getState().setExtrude({ op: 'new' })
    useReverse.getState().setExtrude({ extent: { kind: 'distance', from: 0, to: -3 } })
    expect(useReverse.getState().extrudeDraft?.op).toBe('new')
    // A click on the part measures from the face's plane.
    expect(useReverse.getState().extrudeToPoint([5, 5, 14])).toMatch(/To = 4.00 mm/)
    // Created, the feature carries the face and no sketch; reopened, the
    // box carries it again.
    useReverse.getState().setExtrude({ op: 'join' })
    const id = useReverse.getState().commitExtrude()!
    s = useReverse.getState()
    const made = s.features.find((f) => f.id === id)
    expect(made?.kind === 'extrude' && made.face?.body === 2 && made.regions.length === 0 && made.sketchId === 0).toBe(true)
    expect(s.features.filter((f) => f.kind === 'sketch').length).toBe(sketchesBefore)
    s.editExtrude(id)
    expect(useReverse.getState().extrudeDraft?.face).toEqual({ body: 2, face: top.fingerprint })
    useReverse.getState().cancelExtrude()
    expect(useReverse.getState().extrudeFace(2, { hash: 9, fingerprint: { ...top.fingerprint, kind: 'cylinder' } })).toMatch(/flat/)
  })

  it('opens a sketch with pieces projected into it, and projects more with the tool', () => {
    const frame = { origin: [0, 0, 10] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }
    useReverse.getState().startSketch({ kind: 'fitted', frame }, frame, [{ kind: 'line', a: [0, 0], b: [40, 0], fixed: true, projected: true }])
    let d = useReverse.getState().sketchDraft!
    expect(d.sketch.entities).toHaveLength(1)
    useReverse.getState().setSketchTool('project')
    // The tool's click is the app's to resolve; the store draws nothing.
    useReverse.getState().sketchClick([5, 5], 1, false)
    expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(1)
    useReverse.getState().projectInto([{ kind: 'circle', c: [10, 10], r: 3, fixed: true, projected: true }])
    d = useReverse.getState().sketchDraft!
    expect(d.sketch.entities).toHaveLength(2)
    expect(d.found).toHaveLength(1)
    // A projected piece is not unfixed, and is not dragged.
    useReverse.setState({ sketchDraft: { ...d, selection: [d.sketch.entities[1].id], tool: 'select' } })
    useReverse.getState().toggleFixedSelected()
    expect(useReverse.getState().sketchDraft!.sketch.entities[1].fixed).toBe(true)
    expect(useReverse.getState().sketchDragStart([13, 10], 1)).toBe(false)
    // One undo takes the projection back.
    useReverse.getState().undoSketch()
    useReverse.getState().undoSketch()
    expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(1)
  })
})
