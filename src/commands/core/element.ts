// SPDX-License-Identifier: AGPL-3.0-only
// Elements: fitted on the scan, constructed from others, renamed, removed,
// shown and hidden. Each goes through the 3D Measure panel's own box — the
// draft is opened, filled and created exactly as a person does it, and closed
// again before the command returns.

import { hasDiameter } from '../../core/elements/assumed'
import { methodsForKind } from '../../core/elements/construct'
import { isExtendable, type ExtendSide } from '../../core/elements/extend'
import { isOrientable, type OrientRelation } from '../../core/elements/orient'
import { roleOf } from '../../core/elements/refs'
import type { ScanSpot } from '../../core/geometry/nearest'
import type { ElementKind, PointFit, SigmaPreset } from '../../core/types'
import { forgetSurface } from '../../app/surfaces'
import { useStore } from '../../state/store'
import { commandHost } from '../host'
import {
  elementRefSchema,
  findElement,
  locationSchema,
  measuredElement,
  planeRef,
  requireScan,
  resolveLocation,
  type ElementRef,
  type Location,
} from '../refs'
import { anyObject, arr, bool, enumOf, int, num, obj, oneOf, str, vec3 } from '../schema'
import type { FitGuide } from '../../core/fit/guide'
import { describeElement } from '../state'
import { requireMarked, setMarked } from '../marked'
import { roundTo } from '../../core/round'
import { CommandError, type Command } from '../types'
import { requireMeasureFree, showWorkspace, waitFor } from './common'

/** The kinds a fit on the scan makes: the five fitted ones, a point picked
 *  on it, and a circle through picked points. */
const FIT_KINDS = ['plane', 'sphere', 'cylinder', 'cone', 'torus', 'point', 'circle'] as const
type FitKind = (typeof FIT_KINDS)[number]
const SURFACE_KINDS = ['plane', 'sphere', 'cylinder', 'cone', 'torus'] as const
const ALL_KINDS: readonly ElementKind[] = ['point', 'line', 'plane', 'sphere', 'cylinder', 'cone', 'circle', 'torus']

const sigmaSchema = enumOf(
  [3, 2, 1, 0] as SigmaPreset[],
  'The outlier cut-off: residuals beyond this many sigma are left out of the fit — 3 (the default the panel starts on), 2, 1, or 0 for all points.',
)

const orientSchema = obj(
  {
    to: elementRefSchema('The reference plane: a plane element, or a coordinate plane "XY", "YZ" or "ZX".'),
    relation: enumOf(['normal', 'inPlane'] as OrientRelation[], 'normal (the default): the element’s direction is the plane’s normal — a parallel face, a perpendicular bore. inPlane: it lies in the plane.'),
  },
  ['to'],
  'Align the element’s direction to a reference plane, as designed; the fit as measured is kept beside it and reported.',
)

const extendSchema = obj(
  {
    start: num('Cylinder: millimetres past the start of the measured surface (negative pulls it in).'),
    end: num('Cylinder: millimetres past its end.'),
    uMin: num('Plane: millimetres past one edge of the patch along its first axis.'),
    uMax: num('Plane: past the opposite edge.'),
    vMin: num('Plane: past one edge along its second axis.'),
    vMax: num('Plane: past the opposite edge.'),
  },
  [],
  'How far past the measured surface a cylinder or plane is drawn and exported. What is reported stays what was measured.',
)

const finishing = {
  sigma: sigmaSchema,
  assumed: num('The diameter the feature was designed at, mm — a sphere, cylinder or circle is then drawn and exported at it, and still reported as measured.', { exclusiveMinimum: 0 }),
  orient: orientSchema,
  extend: extendSchema,
  name: str('A name for it; otherwise it is numbered by kind — "Sphere 2".', { minLength: 1 }),
}

interface Finishing {
  sigma?: SigmaPreset
  assumed?: number
  orient?: { to: ElementRef; relation?: OrientRelation }
  extend?: Partial<Record<ExtendSide, number>>
  name?: string
}

/** Close whatever box a command left open — the empty one Create leaves for
 *  the next element, or one a failure stopped half way. */
function closeDraft() {
  if (useStore.getState().draft) commandHost().session.measure.cancelDraft()
}

/** Settle the draft's extras the way the box's fields do, then create it.
 *  Returns the new element's id. */
function finishAndCreate(f: Finishing): number {
  const store = useStore.getState()
  const d = store.draft
  if (!d || d.status !== 'ready' || !d.fit) {
    throw new CommandError('failed', d?.message ?? 'Nothing was measured there.')
  }
  if (f.assumed !== undefined) {
    if (!hasDiameter(d.fit)) throw new CommandError('invalid_input', `A ${d.fit.kind} has no diameter to assume.`)
    store.setDraftAssumed(f.assumed)
  }
  if (f.orient) {
    if (!isOrientable(d.fit)) throw new CommandError('invalid_input', `A ${d.fit.kind} has no direction to align.`)
    store.setDraftOrientRef(planeRef(f.orient.to))
    if (!useStore.getState().draft?.orient) throw new CommandError('invalid_input', 'That plane cannot be aligned to.')
    if (f.orient.relation) store.setDraftOrientRelation(f.orient.relation)
  }
  if (f.extend && Object.keys(f.extend).length) {
    if (!isExtendable(d.fit)) throw new CommandError('invalid_input', `A ${d.fit.kind} cannot be extended — only a cylinder or a plane.`)
    const sides = d.fit.kind === 'cylinder' ? ['start', 'end'] : ['uMin', 'uMax', 'vMin', 'vMax']
    for (const [side, mm] of Object.entries(f.extend)) {
      if (mm === undefined) continue
      if (!sides.includes(side)) throw new CommandError('invalid_input', `A ${d.fit.kind} has no side "${side}" — it has ${sides.join(', ')}.`)
      store.setDraftExtend(side as ExtendSide, mm)
    }
  }
  const id = commandHost().session.measure.confirmDraft()
  if (id === null) throw new CommandError('failed', 'The element could not be created.')
  if (f.name) rename(id, f.name)
  return id
}

/** Rename through the box, as the panel does: open the element, change the
 *  name, save. */
function rename(id: number, name: string) {
  const store = useStore.getState()
  store.editElement(id)
  useStore.getState().setDraftName(name)
  if (commandHost().session.measure.confirmDraft() === null) {
    closeDraft()
    throw new CommandError('failed', 'The element could not be renamed.')
  }
}

const spotJson = (spot: ScanSpot) => ({ vertex: spot.vertex, point: spot.point, distance: spot.distance })

const created = (id: number) => describeElement(useStore.getState().elements.find((e) => e.id === id)!)

// ---- element.fit ----------------------------------------------------------------

/** What a guide may say, by kind: side, radius and axis are a round
 *  surface's; within any surface's. */
const ROUND_KINDS: readonly FitKind[] = ['sphere', 'cylinder', 'cone']

/** The guide the input gives, checked against the kind; undefined when none. */
function guideOf(input: { kind: FitKind } & FitGuide): FitGuide | undefined {
  const { kind, side, radius, axis, within } = input
  if (side === undefined && radius === undefined && axis === undefined && within === undefined) return undefined
  if (kind === 'point' || kind === 'circle') throw new CommandError('invalid_input', `A ${kind} is picked, not grown — side, radius, axis and within do not apply.`)
  if ((side !== undefined || radius !== undefined) && !ROUND_KINDS.includes(kind)) throw new CommandError('invalid_input', `side and radius are for a sphere, cylinder or cone, not a ${kind}.`)
  if (axis !== undefined && kind !== 'cylinder' && kind !== 'cone') throw new CommandError('invalid_input', `axis is for a cylinder or cone, not a ${kind}.`)
  if (axis !== undefined && !(Math.hypot(...axis) > 0)) throw new CommandError('invalid_input', 'axis: give a direction, not a zero vector.')
  if (radius && radius.min !== undefined && radius.max !== undefined && radius.min > radius.max) throw new CommandError('invalid_input', 'radius: min lies past max.')
  if (within) for (let k = 0; k < 3; k++) if (!(within.min[k] <= within.max[k])) throw new CommandError('invalid_input', 'within: the box’s min lies past its max.')
  return { ...(side ? { side } : {}), ...(radius ? { radius } : {}), ...(axis ? { axis } : {}), ...(within ? { within } : {}) }
}

/** What the region a surface grew to holds, and — a plane's — whether it
 *  looks like two surfaces, as the answer puts it. */
async function regionAnswer(kind: FitKind, region: Uint32Array, elementId: number, seed: number) {
  const client = commandHost().session.clientRef.current
  if (!client) return {}
  const el = useStore.getState().elements.find((e) => e.id === elementId)
  const fit = el?.measured ?? el?.fit
  const normal = kind === 'plane' && fit?.kind === 'plane' ? fit.normal : undefined
  const r = await client.planeRegion(region, normal ? { normal, seed } : undefined)
  const v = (p: readonly number[], places: number) => p.map((x) => roundTo(x, places))
  const out: { region: Record<string, unknown>; warning?: string } = {
    region: {
      area: roundTo(r.area, 1),
      box: { min: v(r.min, 2), max: v(r.max, 2) },
      ...(r.normalSpreadDeg !== undefined ? { normalSpreadDeg: roundTo(r.normalSpreadDeg, 2) } : {}),
    },
  }
  const second = r.second
  if (second && fit?.kind === 'plane') {
    out.region.second = {
      share: roundTo(second.share, 3),
      centroid: v(second.centroid, 3),
      box: { min: v(second.min, 2), max: v(second.max, 2) },
      angleDeg: roundTo(second.angleDeg, 2),
      offset: roundTo(second.offset, 3),
      rmsTwo: roundTo(second.rmsTwo, 4),
    }
    const side = second.offset >= 0 ? 'above' : 'below'
    out.warning =
      `two surfaces? ${Math.round(second.share * 100)} % of the region lies on a second plane ${roundTo(second.angleDeg, 2)}° off this one and ${roundTo(Math.abs(second.offset), 3)} mm ${side} it at its centroid [${v(second.centroid, 2).join(', ')}], ` +
      `box [${v(second.min, 1).join(', ')}]–[${v(second.max, 1).join(', ')}] (σ ${roundTo(fit.sigma, 4)} mm${fit.formError !== undefined ? `, form error ${roundTo(fit.formError, 3)}` : ''}; two planes leave ${roundTo(second.rmsTwo, 4)}) — shrink the box or move the seed.`
  }
  return out
}

const fit: Command<{ kind: FitKind; at: Location | Location[]; mark?: boolean } & FitGuide & Finishing> = {
  name: 'fit',
  title: 'Fit an element',
  description:
    'Fit an element on the scan where the panel would take a click: a plane, sphere, cylinder, cone or torus grows its surface from the place given and is best-fitted to it; a point is the place itself; a circle goes through three or more places. `at` is one place, or a list — a feature seen in patches can be seeded on each. A place is { vertex } (a scan vertex), { point: [x, y, z] } (the nearest scan vertex to a point, mm, in the current frame), or { screen } / { candidate } (not available yet). A seed near an edge can land on the wrong surface (a cup’s underside for its inside): say what is sought — side, radius, axis, within — and surfaces that do not match are passed over; a fit that finds none is refused with the radii it saw. Returns the element with its fit and the seed actually used (vertex and point), so a recipe can be replayed on another scan; a surface also the region it grew to — region { area (mm²), box } and, a plane’s, normalSpreadDeg (95 % of its normals lie within it) — and a plane a warning when its points look like two surfaces, with region.second naming where the other lies. mark: true leaves the region’s points marked for element.fit_marked { marked: true }. One undo step.',
  input: obj(
    {
      kind: enumOf(FIT_KINDS, 'What to fit.'),
      at: oneOf([locationSchema('One place.'), arr(locationSchema('A place.'), 'Several places.', { minItems: 1 })], 'Where on the scan.'),
      side: enumOf(['inside', 'outside'], 'Sphere, cylinder, cone: inside — concave, normals toward the axis or centre (a bore, a cup’s inside, a countersink); outside — convex (a shaft, a ball).'),
      radius: obj({ min: num('mm.', { exclusiveMinimum: 0 }), max: num('mm.', { exclusiveMinimum: 0 }) }, [], 'Sphere, cylinder, cone: the radius range the surface lies in.'),
      axis: vec3('Cylinder, cone: the axis direction, roughly (within 20°).'),
      within: obj({ min: vec3('Lowest corner, mm.'), max: vec3('Highest corner, mm.') }, ['min', 'max'], 'The surface stays inside this box.'),
      mark: bool('Leave the region the surface grew to marked, for element.fit_marked { marked: true }.'),
      ...finishing,
    },
    ['kind', 'at'],
  ),
  label: ({ kind }) => `fit ${kind}`,
  run: async (input) => {
    requireScan()
    requireMeasureFree()
    const guide = guideOf(input)
    const places = Array.isArray(input.at) ? input.at : [input.at]
    if (input.kind === 'point' && places.length !== 1) throw new CommandError('invalid_input', 'A point is one place.')
    if (input.kind === 'circle' && places.length < 3) throw new CommandError('invalid_input', 'A circle needs three places or more.')
    if (input.mark && (input.kind === 'point' || input.kind === 'circle')) throw new CommandError('invalid_input', `A ${input.kind} is picked, not grown — it has no region to mark.`)
    const spots: ScanSpot[] = []
    for (const at of places) spots.push(await resolveLocation(at))
    const m = commandHost().session.measure
    showWorkspace('elements')
    try {
      m.startDraft(input.kind)
      if (input.sigma !== undefined) useStore.getState().setDraftSigma(input.sigma)
      const picks = spots.map((s) => s.triangle)
      const points = spots.map((s) => s.point)
      if (input.kind === 'point') {
        // A picked point is the place itself — no worker round-trip.
        useStore.getState().setDraftPicks(picks, points)
        const p: PointFit = { kind: 'point', center: points[0], sigma: 0, usedPoints: 0, regionSize: 0 }
        useStore.getState().resolveDraft({ ...p, region: new Uint32Array(0) })
      } else if (input.kind === 'circle') {
        useStore.getState().setDraftPicks(picks, points)
        m.runPickFit(points)
      } else {
        useStore.getState().setDraftPicks(picks, points)
        await m.runDraftFit(input.kind, picks, guide)
      }
      // The region goes to the element as it is created; it is read first.
      const region = input.kind === 'point' || input.kind === 'circle' ? null : m.draftRegion.current
      const id = finishAndCreate(input)
      if (!region) return { element: created(id), seeds: spots.map(spotJson) }
      const grown = await regionAnswer(input.kind, region, id, spots[0].vertex)
      const marked = input.mark ? setMarked(region, `element.fit ${useStore.getState().elements.find((e) => e.id === id)?.name ?? id}`) : undefined
      return { element: created(id), seeds: spots.map(spotJson), ...grown, ...(marked ? { marked } : {}) }
    } finally {
      closeDraft()
    }
  },
}

// ---- element.fit_marked -------------------------------------------------------

const fitMarked: Command<{ kind: (typeof SURFACE_KINDS)[number]; vertices?: number[]; marked?: boolean } & Finishing> = {
  name: 'fit_marked',
  title: 'Fit an element to a marked surface',
  description:
    'Fit a plane, sphere, cylinder, cone or torus to exactly the scan vertices given — a surface marked by hand in the panel, with no search for the surface — or, with marked: true in place of vertices, to the points the last element.fit { mark: true } or scan.segment { mark } left marked. The element keeps the marking as its recipe. Returns the element. One undo step.',
  input: obj(
    {
      kind: enumOf(SURFACE_KINDS, 'What to fit.'),
      vertices: arr(int(undefined, { minimum: 0 }), 'The scan vertices of the surface.', { minItems: 3 }),
      marked: bool('The points left marked, in place of vertices.'),
      ...finishing,
    },
    ['kind'],
  ),
  label: ({ kind }) => `fit ${kind} to a marked surface`,
  run: async (input) => {
    requireScan()
    requireMeasureFree()
    if ((input.vertices === undefined) === !input.marked) throw new CommandError('invalid_input', 'Give vertices, or marked: true — one of them.')
    const count = useStore.getState().vertexCount
    const bad = input.vertices?.find((v) => v >= count)
    if (bad !== undefined) throw new CommandError('invalid_input', `The scan has no vertex ${bad} — it has ${count}.`)
    const vertices = input.vertices ? Uint32Array.from(input.vertices) : Uint32Array.from(requireMarked().vertices)
    const m = commandHost().session.measure
    showWorkspace('elements')
    try {
      m.startDraft(input.kind)
      if (input.sigma !== undefined) useStore.getState().setDraftSigma(input.sigma)
      await m.runDraftPaintFit(input.kind, vertices)
      const id = finishAndCreate(input)
      return { element: created(id) }
    } finally {
      closeDraft()
    }
  },
}

// ---- element.construct ----------------------------------------------------------

const construct: Command<{
  kind: ElementKind
  method: string
  refs?: ElementRef[]
  params?: number[] | Record<string, number>
  seed?: ElementRef
  vertices?: number[]
} & Omit<Finishing, 'sigma' | 'extend'>> = {
  name: 'construct',
  title: 'Construct an element',
  description:
    'Construct an element from others and typed-in numbers, as the panel’s creation methods do — by kind: point (point-coords, point-centroid, point-midpoint, point-line-plane), line (line-two-points, line-axis, line-plane-plane), plane (plane-three-points, plane-offset, plane-midplane, plane-coords, plane-symmetry), circle (circle-plane-cylinder, circle-plane-sphere, circle-coords). refs fill the method’s slots in order, by element id or name; params are its numbers in order (or by key: x, y, z; offset; nx, ny, nz, px, py, pz; d, cx, cy, cz). point-centroid and plane-symmetry measure the scan themselves: vertices confines them to a marked surface, seed starts the symmetry search from a plane. plane-symmetry finds the scan’s own mirror plane as an element, the alignment left as it is (align.symmetry re-poses the part on it instead), and answers with the search’s residual: symmetry { rms, matched, sampled } and a note. Returns the element. One undo step.',
  input: obj(
    {
      kind: enumOf(ALL_KINDS, 'What to construct.'),
      method: str('The creation method — see the description.', { minLength: 1 }),
      refs: arr(elementRefSchema('A source element.'), 'The method’s source elements, slot by slot.'),
      params: oneOf(
        [
          arr(num(), 'The numbers in the method’s order.'),
          anyObject('The numbers by key.', { additionalProperties: true }),
        ],
        'The method’s typed-in numbers, in millimetres.',
      ),
      seed: elementRefSchema('plane-symmetry: the plane the search starts from — a plane element or "XY", "YZ", "ZX".'),
      vertices: arr(int(undefined, { minimum: 0 }), 'point-centroid, plane-symmetry: confine the search to these scan vertices.', { minItems: 3 }),
      assumed: finishing.assumed,
      orient: orientSchema,
      name: finishing.name,
    },
    ['kind', 'method'],
  ),
  label: ({ method }) => `construct ${method}`,
  run: async (input) => {
    requireScan()
    requireMeasureFree()
    const method = methodsForKind(input.kind).find((m) => m.id === input.method)
    if (!method) {
      const offered = methodsForKind(input.kind).filter((m) => m.mode === 'construct').map((m) => m.id)
      throw new CommandError('invalid_input', `A ${input.kind} has no method "${input.method}" — it has ${offered.join(', ') || 'none to construct'}.`)
    }
    if (method.mode !== 'construct') throw new CommandError('invalid_input', `"${input.method}" works on the scan — use element.fit.`)
    const refs = input.refs ?? []
    if (refs.length !== method.slots.length) {
      throw new CommandError('invalid_input', `${method.label} takes ${method.slots.length} source element${method.slots.length === 1 ? '' : 's'} (${method.slots.map((s) => s.label).join(', ') || 'none'}), not ${refs.length}.`)
    }
    const ids = refs.map((ref, i) => {
      const el = measuredElement(ref)
      const slot = method.slots[i]
      const plays = slot.role === roleOf(el.kind) || (slot.role === 'axis' && el.kind === 'circle')
      if (!plays || (slot.kinds && !slot.kinds.includes(el.kind))) {
        throw new CommandError('invalid_input', `${el.name} cannot be “${slot.label}” — that takes a ${slot.kinds?.join(' or ') ?? slot.role}.`)
      }
      return el.id
    })
    const typed = method.params.filter((p) => !p.hidden)
    const given = input.params ?? []
    const values = Array.isArray(given)
      ? given
      : typed.map((p) => {
          const v = (given as Record<string, unknown>)[p.key]
          if (typeof v !== 'number' || !Number.isFinite(v)) throw new CommandError('invalid_input', `params.${p.key} (${p.label}) is required.`)
          return v
        })
    if (values.length !== typed.length) {
      throw new CommandError('invalid_input', `${method.label} takes ${typed.length} number${typed.length === 1 ? '' : 's'} (${typed.map((p) => p.key).join(', ') || 'none'}), not ${values.length}.`)
    }
    const m = commandHost().session.measure
    showWorkspace('elements')
    let symmetry: { rms: number; matched: number; sampled: number; note?: string } | null = null
    try {
      m.startDraft(input.kind)
      const store = useStore.getState()
      store.setDraftMethod(input.method)
      ids.forEach((id, i) => useStore.getState().setDraftRef(i, id))
      typed.forEach((p, i) => useStore.getState().setDraftParam(method.params.indexOf(p), values[i]))
      const settled = () => {
        const d = useStore.getState().draft
        return d && (d.status === 'ready' || d.status === 'failed') ? d : null
      }
      if (input.method === 'point-centroid') {
        // It measures itself the moment it is opened (measureWorkspace.watch);
        // a marking measures it again, on the marked surface.
        await waitFor(settled, 'the centroid')
        if (input.vertices) {
          useStore.getState().setDraftSelection(Uint32Array.from(input.vertices))
          await waitFor(settled, 'the centroid of the marked surface')
        }
      } else if (input.method === 'plane-symmetry') {
        if (input.seed !== undefined) useStore.getState().setDraftSeed(planeRef(input.seed))
        if (input.vertices) useStore.getState().setDraftSelection(Uint32Array.from(input.vertices))
        await m.findSymmetry()
        // The search's verdict lives on the draft, which confirming closes:
        // read it off first. Its params run normal, point, rms, matched, sampled.
        const d = useStore.getState().draft
        if (d?.method === 'plane-symmetry' && d.params.length >= 9) {
          symmetry = { rms: d.params[6], matched: d.params[7], sampled: d.params[8], ...(d.note ? { note: d.note } : {}) }
        }
      } else if (input.vertices || input.seed !== undefined) {
        throw new CommandError('invalid_input', `${method.label} takes no marked surface and no seed.`)
      }
      const id = finishAndCreate(input)
      return { element: created(id), ...(symmetry ? { symmetry } : {}) }
    } finally {
      closeDraft()
    }
  },
}

// ---- Renaming, removing, showing -----------------------------------------------

const renameCommand: Command<{ element: ElementRef; name: string }> = {
  name: 'rename',
  title: 'Rename an element',
  description: 'Give an element another name; dimensions and constructions on it keep pointing at it. One undo step.',
  input: obj({ element: elementRefSchema('The element.'), name: str('Its new name.', { minLength: 1 }) }, ['element', 'name']),
  label: () => 'rename element',
  run: async ({ element, name }) => {
    requireMeasureFree()
    const el = measuredElement(element)
    try {
      rename(el.id, name)
    } finally {
      closeDraft()
    }
    return { element: created(el.id) }
  },
}

const remove: Command<{ element: ElementRef }> = {
  name: 'remove',
  title: 'Delete an element',
  description:
    'Delete an element, as its row’s delete key does — and with it every construction built on it and every dimension that refers to any of them. Returns what went. One undo step.',
  input: obj({ element: elementRefSchema('The element.') }, ['element']),
  label: () => 'delete element',
  run: async ({ element }) => {
    requireMeasureFree()
    const el = findElement(element)
    const before = useStore.getState()
    const scene = commandHost().session.sceneRef.current
    forgetSurface(el.id)
    scene?.clearElement(el.id)
    useStore.getState().removeElement(el.id)
    const after = useStore.getState()
    const gone = before.elements.filter((e) => !after.elements.some((x) => x.id === e.id))
    for (const e of gone) if (e.id !== el.id) forgetSurface(e.id)
    return {
      removed: gone.map((e) => ({ id: e.id, name: e.name })),
      dimensionsRemoved: before.dimensions.filter((d) => !after.dimensions.some((x) => x.id === d.id)).map((d) => ({ id: d.id, name: d.name })),
    }
  },
}

const setVisible: Command<{ element?: ElementRef; all?: boolean; visible: boolean }> = {
  name: 'set_visible',
  title: 'Show or hide elements',
  description: 'Show or hide one element, or all of them with all: true. A hidden element still measures; only its drawing and surface tint go. One undo step.',
  input: obj(
    {
      element: elementRefSchema('The element.'),
      all: bool('Every element.'),
      visible: bool('Shown (true) or hidden (false).'),
    },
    ['visible'],
  ),
  label: ({ visible }) => (visible ? 'show elements' : 'hide elements'),
  run: async ({ element, all, visible }) => {
    if (all) {
      useStore.getState().setAllElementsVisible(visible)
      return { elements: useStore.getState().elements.map((e) => ({ id: e.id, name: e.name, visible: e.visible })) }
    }
    if (element === undefined) throw new CommandError('invalid_input', 'Name an element, or pass all: true.')
    const el = findElement(element)
    if (el.visible !== visible) useStore.getState().toggleElementVisible(el.id)
    return { element: { id: el.id, name: el.name, visible } }
  },
}

export const elementCommands = [fit, fitMarked, construct, renameCommand, remove, setVisible]
