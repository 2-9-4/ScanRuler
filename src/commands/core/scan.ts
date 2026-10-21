// SPDX-License-Identifier: AGPL-3.0-only
// The scan: opening one, and finding places on it.

import { MESH_UNITS, type MeshUnits } from '../../core/meshUnits'
import type { Vec3 } from '../../core/types'
import { useStore } from '../../state/store'
import { useDeviation } from '../../state/deviationStore'
import { commandHost } from '../host'
import { locationSchema, requireScan, resolveLocation, type Location } from '../refs'
import { arr, bool, bytes, enumOf, int, num, obj, oneOf, vec3 } from '../schema'
import { acrossAxes, dominantFacing, robustPlane } from '../../core/geometry/scanQa'
import { orthoBasis } from '../../core/fit/linalg'
import { niceCeil } from '../../core/field/stats'
import { scanBounds } from '../state'
import { CommandError, type Command } from '../types'
import { discardSchema, fileNameSchema, fileOf, lastError, requireDiscardable } from './common'
import { roundTo } from '../../core/round'
import { cellNoise, heightLevels, reliefGrid } from '../../core/geometry/heightGrid'
import { basePlaneOf } from '../../core/basePlanes'
import { sketchFrameOn } from '../../core/section/frame'
import type { PlaneFit } from '../../core/types'
import { usePrefs } from '../../state/prefsStore'
import { elementRefSchema, findElement, planeRef, type ElementRef } from '../refs'

export const unitsSchema = enumOf(
  MESH_UNITS.map((u) => u.id),
  'What the file’s coordinates are in: mm (the default), cm, m or in. An STL carries no units of its own; PLY and OBJ are taken in millimetres unless told otherwise. Everything is measured in millimetres once read.',
)

/** The scan as the readout names it. */
async function scanSummary() {
  const bounds = await scanBounds()
  const s = useStore.getState()
  const units = commandHost().session.sources.current.scan?.units ?? 'mm'
  return {
    fileName: s.fileName,
    units,
    vertices: s.vertexCount,
    triangles: s.triangleCount,
    bounds,
    center: s.modelCenter,
    size: 2 * s.modelSize,
  }
}

const open: Command<{ bytes: Uint8Array; name: string; units?: MeshUnits; discard?: boolean }> = {
  name: 'open',
  title: 'Open a scan',
  description:
    'Open a mesh as the scan to measure — STL, PLY or OBJ — in place of the one there is; everything measured on the old one goes with it, so it refuses while the session holds measurements unless discard is true — the refusal names what the session holds. A reference part opened from a file stays, its alignment and maps gone (referenceKept names it); one the app made from the session’s own work goes with that work (referenceDropped). Returns the scan: name, units, vertex and triangle counts, its bounding box (min and max corners), the box’s centre and its diagonal (size), in millimetres. Not undoable: a new scan starts a new history.',
  input: obj(
    {
      bytes: bytes('The file’s contents.'),
      name: fileNameSchema('"ballbar.stl"'),
      units: unitsSchema,
      discard: discardSchema,
    },
    ['bytes', 'name'],
  ),
  history: false,
  run: async ({ bytes: data, name, units, discard }) => {
    requireDiscardable(discard, 'opening another scan')
    const { session } = commandHost()
    const before = session.clientRef.current!.scanVersion
    const reference = useDeviation.getState().nominalName
    await session.scan.openScan(fileOf(data, name), units ?? 'mm')
    if (session.clientRef.current!.scanVersion === before) {
      throw new CommandError('failed', lastError(`${name} could not be opened.`))
    }
    const kept = useDeviation.getState().nominalName
    return {
      scan: await scanSummary(),
      ...(kept ? { referenceKept: kept } : reference ? { referenceDropped: reference } : {}),
    }
  },
}

/** How many vertices a query hands back unless told otherwise, and at most. */
const QUERY_LIMIT = 1000
const QUERY_MAX = 20_000
/** How far round a direction a normal may lie and still face it, degrees,
 *  unless told otherwise. */
const QUERY_WITHIN_DEG = 30

const triples = (a: Float32Array, places: number): [number, number, number][] => {
  const out: [number, number, number][] = []
  for (let i = 0; i + 2 < a.length; i += 3) out.push([roundTo(a[i], places), roundTo(a[i + 1], places), roundTo(a[i + 2], places)])
  return out
}

interface QueryIn {
  box?: { min: Vec3; max: Vec3 }
  near?: { at: Vec3; radius: number }
  normal?: { dir: Vec3; withinDeg?: number }
  limit?: number
}

const query: Command<QueryIn> = {
  name: 'query',
  title: 'Read the scan’s points',
  description:
    'The scan’s vertices inside a box, or within a radius of a point, with their outward normals — the points on a face, to measure a dimension or a draft angle off, or to see what the scan has where a model is being built. normal keeps only the vertices facing a direction (within withinDeg, 30 by default): the top face alone, say. At most limit come back (1000 by default, 20000 at most): past it every k-th matching vertex is kept, spread evenly, and step says which k. Returns how many matched, the vertices kept (their numbers, as scan.nearest and element.fit_marked name them), their points and normals in millimetres, in the frame the part is measured in now, the box round the points kept, their centroid and mean normal. Changes nothing.',
  input: obj({
    box: obj({ min: vec3('The lowest corner, mm.'), max: vec3('The highest corner, mm.') }, ['min', 'max'], 'A box in the frame the part is measured in now.'),
    near: obj({ at: vec3('The centre, mm.'), radius: num('How far from it, mm.', { exclusiveMinimum: 0 }) }, ['at', 'radius'], 'A ball about a point — in place of box.'),
    normal: obj(
      { dir: vec3('The direction, any length.'), withinDeg: num('How far from it a normal may lean, degrees; 30 by default.', { exclusiveMinimum: 0, maximum: 180 }) },
      ['dir'],
      'Keep only the vertices whose outward normal faces this way.',
    ),
    limit: int(`How many vertices at most; ${QUERY_LIMIT} by default, ${QUERY_MAX} at most.`, { minimum: 1, maximum: QUERY_MAX }),
  }),
  readOnly: true,
  run: async ({ box, near, normal, limit = QUERY_LIMIT }) => {
    requireScan()
    if ((box === undefined) === (near === undefined)) throw new CommandError('invalid_input', 'Give box or near — one of them.')
    const client = commandHost().session.clientRef.current
    if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
    const min: Vec3 = box ? box.min : [near!.at[0] - near!.radius, near!.at[1] - near!.radius, near!.at[2] - near!.radius]
    const max: Vec3 = box ? box.max : [near!.at[0] + near!.radius, near!.at[1] + near!.radius, near!.at[2] + near!.radius]
    for (let k = 0; k < 3; k++) if (!(min[k] <= max[k])) throw new CommandError('invalid_input', 'The box’s min lies past its max.')
    const cosLimit = normal ? Math.cos(((normal.withinDeg ?? QUERY_WITHIN_DEG) * Math.PI) / 180) : undefined
    // A ball is asked for as its box and the corners trimmed off here —
    // the limit then counts what is inside the ball.
    const r = await client.query({ min, max, ...(normal && cosLimit !== undefined ? { normal: { dir: normal.dir, cosLimit } } : {}), limit: near ? Math.min(QUERY_MAX, Math.ceil(limit * 1.91)) : limit })
    let vertices = Array.from(r.vertices)
    let positions = r.positions
    let normals = r.normals
    let matched = r.matched
    if (near) {
      const keep: number[] = []
      for (let i = 0; i < vertices.length; i++) {
        const d = Math.hypot(positions[i * 3] - near.at[0], positions[i * 3 + 1] - near.at[1], positions[i * 3 + 2] - near.at[2])
        if (d <= near.radius) keep.push(i)
      }
      // What the ball holds, scaled up from the share of the box's sample
      // that fell inside it.
      matched = r.step > 1 ? Math.round((keep.length / Math.max(1, vertices.length)) * r.matched) : keep.length
      const stride = Math.max(1, Math.ceil(keep.length / limit))
      const kept = keep.filter((_, i) => i % stride === 0)
      positions = Float32Array.from(kept.flatMap((i) => [r.positions[i * 3], r.positions[i * 3 + 1], r.positions[i * 3 + 2]]))
      normals = Float32Array.from(kept.flatMap((i) => [r.normals[i * 3], r.normals[i * 3 + 1], r.normals[i * 3 + 2]]))
      vertices = kept.map((i) => vertices[i])
    }
    const n = vertices.length
    const lo: Vec3 = [Infinity, Infinity, Infinity]
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
    const centroid: Vec3 = [0, 0, 0]
    const meanNormal: Vec3 = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const v = positions[i * 3 + k]
        if (v < lo[k]) lo[k] = v
        if (v > hi[k]) hi[k] = v
        centroid[k] += v / n
        meanNormal[k] += normals[i * 3 + k]
      }
    }
    const nl = Math.hypot(meanNormal[0], meanNormal[1], meanNormal[2])
    return {
      matched,
      returned: n,
      step: near ? Math.max(1, Math.round(matched / Math.max(1, n))) : r.step,
      ...(n > 0
        ? {
            bounds: { min: lo.map((v) => roundTo(v, 4)), max: hi.map((v) => roundTo(v, 4)) },
            centroid: centroid.map((v) => roundTo(v, 4)),
            meanNormal: nl > 0 ? meanNormal.map((v) => roundTo(v / nl, 4)) : null,
          }
        : {}),
      vertices,
      points: triples(positions, 4),
      normals: triples(normals, 3),
    }
  },
}

const nearest: Command<{ at: Location }> = {
  name: 'nearest',
  title: 'Find a place on the scan',
  description:
    'Where a location lands on the scan: the vertex (a point snaps to the nearest one), its coordinates and outward normal, a triangle it is a corner of, and how far it is from the point asked about. Use it to check a point lies on the surface before fitting there.',
  input: obj({ at: locationSchema('The place on the scan.') }, ['at']),
  readOnly: true,
  run: async ({ at }) => resolveLocation(at),
}

/** How many scan points a surface is fitted to at most. */
const SURFACE_LIMIT = 20_000

const fitSurface: Command<{ vertices?: number[]; box?: { min: Vec3; max: Vec3 }; normal?: { dir: Vec3; withinDeg?: number }; model?: 'plane' | 'bilinear' | 'quadric' | 'best'; limit?: number }> = {
  name: 'fit_surface',
  title: 'Fit a sloped or curved patch',
  description:
    'A patch of the scan measured as a surface — a sloped side, a twisted ruled face, a dome, a saddle, a fairing — the points given as vertices (from scan.query or a patch) or as a box (normal keeps those facing a way, within withinDeg, 30 by default). The best plane through them sets the patch’s own frame: origin at their centroid, normal (w) out of it, basisU and basisV in it, all in the frame the part is measured in now. Each model is a height over (u, v) along the normal: plane h = a + b·u + c·v; bilinear + d·u·v (a hyperbolic paraboloid: a straight-lined twisted face); quadric + d·u² + e·u·v + f·v² (a dome, bowl, saddle or a cylinder’s strip). Each answers its coefficients, rms and worst (mm off along the normal); the quadric also curvature: k1 and k2 (1/mm, the larger first), r1 and r2 (their radii, null where flat), axis1 and axis2 (their directions in the world) and shape (flat, cylinder, dome or saddle) at the patch’s middle. model: one of them, or best (the default) — every one, and best names the simplest whose rms is within a tenth of the lowest: the model that holds, plain. At most limit points are fitted (20000), spread evenly. Changes nothing.',
  input: obj({
    vertices: arr(int(undefined, { minimum: 0 }), 'The scan vertices of the patch.', { minItems: 7 }),
    box: obj({ min: vec3('The lowest corner, mm.'), max: vec3('The highest corner, mm.') }, ['min', 'max'], 'The patch as the scan inside a box, in place of vertices.'),
    normal: obj({ dir: vec3('The direction, any length.'), withinDeg: num('Degrees; 30 by default.', { exclusiveMinimum: 0, maximum: 180 }) }, ['dir'], 'With box: only the vertices facing this way.'),
    model: enumOf(['plane', 'bilinear', 'quadric', 'best'], 'Which surface; best (the default) fits each and names the simplest that holds.'),
    limit: int(`How many points at most; ${SURFACE_LIMIT} by default.`, { minimum: 7, maximum: SURFACE_LIMIT }),
  }),
  readOnly: true,
  run: async ({ vertices, box, normal, model = 'best', limit = SURFACE_LIMIT }) => {
    requireScan()
    if ((vertices === undefined) === (box === undefined)) throw new CommandError('invalid_input', 'Give vertices or box — one of them.')
    let points: Float32Array
    if (box) {
      for (let k = 0; k < 3; k++) if (!(box.min[k] <= box.max[k])) throw new CommandError('invalid_input', 'The box’s min lies past its max.')
      const client = commandHost().session.clientRef.current
      if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
      const cosLimit = normal ? Math.cos(((normal.withinDeg ?? QUERY_WITHIN_DEG) * Math.PI) / 180) : undefined
      points = (await client.query({ min: box.min, max: box.max, ...(normal && cosLimit !== undefined ? { normal: { dir: normal.dir, cosLimit } } : {}), limit })).positions
    } else {
      // The vertices by number, as the viewport holds them — in the frame
      // the part is measured in now.
      const all = commandHost().session.sceneRef.current?.scanPositions()
      if (!all) throw new CommandError('unavailable', 'Reading vertices by number needs the viewport — give box instead.')
      const count = all.length / 3
      const bad = vertices!.find((v) => v >= count)
      if (bad !== undefined) throw new CommandError('invalid_input', `vertices: ${bad} is past the scan’s ${count} vertices.`)
      const step = Math.max(1, Math.ceil(vertices!.length / limit))
      const picked = vertices!.filter((_, i) => i % step === 0)
      points = new Float32Array(picked.length * 3)
      picked.forEach((v, i) => points.set([all[v * 3], all[v * 3 + 1], all[v * 3 + 2]], i * 3))
    }
    if (points.length / 3 < 7) throw new CommandError('invalid_input', `Only ${points.length / 3} scan points lie there — a surface needs 7 at least.`)
    const { fitSurfaceModels, SURFACE_MODELS } = await import('../../core/fit/heightSurface')
    const models = model === 'best' ? SURFACE_MODELS : [model]
    const r = fitSurfaceModels(points, models)
    if (!r) throw new CommandError('failed', 'The points lie on a line — no surface is fitted through them.')
    const v4 = (v: Vec3) => v.map((x) => roundTo(x, 4))
    return {
      points: points.length / 3,
      frame: { origin: v4(r.frame.origin), basisU: v4(r.frame.basisU), basisV: v4(r.frame.basisV), normal: v4(r.frame.normal) },
      models: Object.fromEntries(
        r.fits.map((f) => [
          f.model,
          {
            coefficients: f.coefficients,
            rms: f.rms,
            worst: f.worst,
            ...(f.curvature ? { curvature: { ...f.curvature, axis1: v4(f.curvature.axis1), axis2: v4(f.curvature.axis2) } } : {}),
          },
        ]),
      ),
      ...(model === 'best' ? { best: r.best } : {}),
    }
  },
}

/** How many scan points the draft is read off at most, spread evenly. */
const DRAFT_LIMIT = 400_000

const draft: Command<{ pull: Vec3; box?: { min: Vec3; max: Vec3 }; nearDeg?: number; patches?: number; minArea?: number }> = {
  name: 'draft',
  title: 'Read the draft against a pull',
  description:
    'The scan’s walls that run near a pull direction — the sides a mould opens along, a side core slides along — gathered into patches, each with the angle it leans off the pull: draftDeg, positive where the wall faces partly along the pull (it lets go as the tool moves that way), negative where it faces back (a back draft, an undercut to that pull); sigmaDeg its standard error, spreadDeg the points’ own spread (mostly the scan’s normal noise); with centroid, box, area (mm²), count and facing (which way the wall faces across the pull). Neighbouring walls are parted where the way they face jumps, so a box’s four sides are four patches and a boss’s round side one. Read it early on a moulded or cast part, along each direction the tools open: walls that lean half a degree to a few explain fits that miss by the lean. pull: the direction, any length; box: only the scan inside it; nearDeg: how far off square to the pull a wall may lean and still count (10 by default); patches: how many, the largest first (12); minArea: smaller ones left out, mm² (1). Changes nothing.',
  input: obj({
    pull: vec3('The pull direction, any length — the way the tool opens.'),
    box: obj({ min: vec3('The lowest corner, mm.'), max: vec3('The highest corner, mm.') }, ['min', 'max'], 'Only the scan inside this box.'),
    nearDeg: num('Degrees; 10 by default.', { exclusiveMinimum: 0, maximum: 45 }),
    patches: int('How many patches; 12 by default.', { minimum: 1, maximum: 50 }),
    minArea: num('mm²; 1 by default.', { minimum: 0 }),
  }, ['pull']),
  readOnly: true,
  run: async ({ pull, box, nearDeg, patches, minArea }) => {
    requireScan()
    if (!(Math.hypot(...pull) > 0)) throw new CommandError('invalid_input', 'pull: give a direction, not a zero vector.')
    const client = commandHost().session.clientRef.current
    if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
    const inf = Infinity
    const found = await client.query({ min: box?.min ?? [-inf, -inf, -inf], max: box?.max ?? [inf, inf, inf], limit: DRAFT_LIMIT })
    if (!found.normals || found.positions.length < 9) throw new CommandError('invalid_input', 'Too few scan points lie there to read a wall off.')
    const { draftPatches } = await import('../../core/fit/draft')
    const r = draftPatches(found.positions, found.normals, pull, { ...(nearDeg !== undefined ? { nearDeg } : {}), ...(patches !== undefined ? { limit: patches } : {}), ...(minArea !== undefined ? { minArea } : {}) })
    const v3 = (v: readonly number[]) => v.map((x) => roundTo(x, 3))
    return {
      pull: v3(r.pull),
      nearDeg: r.nearDeg,
      points: r.points,
      walls: r.walls,
      found: r.found,
      patches: r.patches.map((p) => ({
        draftDeg: roundTo(p.draftDeg, 3),
        sigmaDeg: roundTo(p.sigmaDeg, 3),
        spreadDeg: roundTo(p.spreadDeg, 2),
        area: roundTo(p.area, 1),
        count: p.count,
        centroid: v3(p.centroid),
        box: { min: v3(p.min), max: v3(p.max) },
        facing: v3(p.facing),
      })),
    }
  },
}

/** The most cells a height map's numbers hold, and how many a side it
 *  aims at unless a cell is given; and the same for one that answers
 *  without its numbers — a picture, or the levels — which may be finer. */
const HEIGHT_CELLS = 1600
const HEIGHT_SIDE = 40
const HEIGHT_CELLS_FINE = 25_600
const HEIGHT_SIDE_FINE = 160
/** How many levels an answer names, the largest first. */
const HEIGHT_LEVELS = 12
/** The least gap between two levels, mm, however clean the scan. */
const LEVEL_GAP_MIN = 0.02
/** How many scan vertices a plane's map looks at for its box and side. */
const PLANE_SAMPLE = 20_000
const AXIS_NAMES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const
type AxisName = (typeof AXIS_NAMES)[number]
type HeightOf = 'height' | 'deviation' | 'relief'
type PlaneIn = ElementRef | { origin: Vec3; normal: Vec3; u?: Vec3 }

/** A grid of cells over the box across axis `k`, centred on it: the cell
 *  asked for, or the round size that makes the longer side `side` cells —
 *  widened until there are no more than `most` cells. */
function gridOver(min: Vec3, max: Vec3, k: 0 | 1 | 2, cell: number | undefined, side: number, most: number) {
  const [ua, va] = acrossAxes(k)
  const du = Math.max(max[ua] - min[ua], 1e-6)
  const dv = Math.max(max[va] - min[va], 1e-6)
  let c = cell ?? niceCeil(Math.max(du, dv) / side)
  let widened = false
  while (Math.ceil(du / c) * Math.ceil(dv / c) > most) {
    c = niceCeil(c * 1.01)
    widened = true
  }
  const cols = Math.max(1, Math.ceil(du / c))
  const rows = Math.max(1, Math.ceil(dv / c))
  const u0 = (min[ua] + max[ua]) / 2 - (cols * c) / 2
  const v0 = (min[va] + max[va]) / 2 - (rows * c) / 2
  return { ua, va, cell: c, cols, rows, u0, v0, widened }
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (i: number, s = 1): Vec3 => [i === 0 ? s : 0, i === 1 ? s : 0, i === 2 ? s : 0]

/** The plane a map is read on, as its frame: a coordinate plane by name, a
 *  plane element (its normal turned to the side the scan is not, so the
 *  map looks at the face it was fitted on), or a plane given by a point and
 *  a normal; laid as a sketch on it is (sketchFrameOn), `flip` turning it
 *  over. */
function planeFrame(plane: PlaneIn, flip: boolean, sample: Float32Array) {
  let point: Vec3
  let normal: Vec3
  let seedU: Vec3 | undefined
  let name: string | undefined
  let element = false
  if (typeof plane === 'object') {
    point = plane.origin
    normal = plane.normal
    seedU = plane.u
  } else {
    const id = planeRef(plane)
    if (id < 0) {
      const base = basePlaneOf(id)!
      point = [0, 0, 0]
      normal = [...base.normal] as Vec3
      name = base.name
    } else {
      const el = findElement(id)
      const fit = el.fit as PlaneFit
      point = fit.center
      normal = fit.normal
      name = el.name
      element = true
    }
  }
  const len = Math.hypot(normal[0], normal[1], normal[2])
  if (!(len > 1e-9)) throw new CommandError('invalid_input', 'plane.normal: give a direction, not a zero vector.')
  normal = [normal[0] / len, normal[1] / len, normal[2] / len]
  if (element) {
    // Most of the scan lies behind the face a plane was fitted on.
    const hs: number[] = []
    for (let i = 0; i + 2 < sample.length; i += 3) hs.push((sample[i] - point[0]) * normal[0] + (sample[i + 1] - point[1]) * normal[1] + (sample[i + 2] - point[2]) * normal[2])
    hs.sort((a, b) => a - b)
    if (hs.length && hs[Math.floor(hs.length / 2)] > 0) normal = [-normal[0], -normal[1], -normal[2]]
  }
  if (flip) normal = [-normal[0], -normal[1], -normal[2]]
  const f = sketchFrameOn({ origin: point, normal }, seedU)
  if (!f) throw new CommandError('invalid_input', 'plane.normal: give a direction, not a zero vector.')
  return { name, origin: f.origin, u: f.basisU, v: f.basisV, normal: f.normal }
}

/** The deviation map in hand, per scan vertex, and the search distance
 *  past which a reading is bare on it. */
function deviationValues() {
  const d = useDeviation.getState()
  const maps = commandHost().session.maps
  const values = d.source === 'element' ? maps.elementField.current : maps.deviation.current
  const ready = d.source === 'element' ? d.elementStatus === 'ready' : d.mapStatus === 'ready'
  if (!ready || !values) throw new CommandError('invalid_state', 'There is no deviation map to read — deviation.align measures one against the reference part, deviation.set_target one against an element.')
  return { values, search: d.maxDistance, source: d.source, range: d.range }
}

const heightmap: Command<{
  box?: { min: Vec3; max: Vec3 }
  axis?: AxisName
  plane?: PlaneIn
  flip?: boolean
  of?: HeightOf
  smooth?: number
  cell?: number
  grid?: boolean
  levels?: boolean
  gap?: number
  picture?: boolean
}> = {
  name: 'heightmap',
  title: 'Map the scan’s heights',
  description:
    `Where the scan is first met looking along an axis, or square onto a plane, over a grid of cells: pocket floors, ledges, a step's height, a face's tilt, a pad's tiers, an icon on a key in one call. axis is the way looked: -z (the default) looks down from above and gives the top surface's z; +z looks up from below and gives the underside's; ±x, ±y likewise. Cells lie on the two other axes in order — x, y for z; y, z for x; x, z for y — as u and v. plane, in place of axis: a plane element (id or name; its normal turned to the side the scan is not, so it looks at the face it was fitted on), a coordinate plane "XY", "YZ", "ZX", or any other — a face of a model, say — as { origin, normal, u? }; the map then looks down the normal onto it, height is the distance from the plane along the normal, and u, v are the plane's own, laid as a sketch on that plane has them (section.render { plane } draws the same sheet) — u seeds its direction; flip turns the plane over. The answer's plane gives its frame in world: a cell's point is origin + u·U + v·V + height·normal. box: the part looked at, the scan's box by default; rays start at its face and stop at the far one. With plane, box is in the plane's frame: min and max are [u, v, height], and by default it takes in the whole scan. of: height (the default); deviation — the scan's signed deviation where each ray lands (the map deviation.align or deviation.set_target measured, read off the triangle met), null where the map has no reading within its search distance; relief — the height less the surface round it (at each cell a plane fitted to its neighbours, weighed by a Gaussian smooth mm wide, three cells by default; make it about the width of what is looked for): icons, grooves, lettering and parting lines stand out of a face that curves or leans, positive proud and negative sunk. cell: mm (by default a round size that makes ${HEIGHT_SIDE} cells on the longer side; widened to keep ${HEIGHT_CELLS} cells at most — and ${HEIGHT_SIDE_FINE} and ${HEIGHT_CELLS_FINE} when the numbers are not returned). Returns along, across, cell, origin [u0, v0] (the grid's low corner), cols, rows and grid: rows of values (mm; heights to 0.01, deviation and relief to 0.001) from the low v up, null where there is none — grid[r][c] stands at u0 + (c + ½)·cell, v0 + (r + ½)·cell — with min, max, hit (cells met) and valued (cells with a value). levels: true returns, in place of the grid, the values gathered into levels — a pad's tiers, a pocket's floor, the face round them — the largest first (${HEIGHT_LEVELS} at most): each its height (the median), sigma, range, cells, area (mm²), sharePct of the cells with a value, and box ([u, v] min and max); two levels lie at least gap apart (mm; three times the cell-to-cell noise by default, ${LEVEL_GAP_MIN} at least), and unassigned counts the cells in none (walls, edges). grid: true keeps the grid as well, false leaves it out and returns the picture. picture: true adds the map coloured by its values with coordinates in the margins and a scale (a deviation in the workspace's colour map over its range); needs the browser. Changes nothing.`,
  input: obj({
    box: obj({ min: vec3('The lowest corner, mm — [u, v, height] with plane.'), max: vec3('The highest corner, mm — [u, v, height] with plane.') }, ['min', 'max'], 'The part looked at; the scan’s box by default. In the plane’s frame with plane.'),
    axis: enumOf(AXIS_NAMES, 'The way looked: -z (the default) from above, +z from below, and so on.'),
    plane: oneOf(
      [
        elementRefSchema('A plane element, or a coordinate plane "XY", "YZ", "ZX".'),
        obj({ origin: vec3('A point on the plane, mm.'), normal: vec3('Its normal: the side looked from.'), u: vec3('A direction for u, flattened into the plane; a sketch’s by default.') }, ['origin', 'normal']),
      ],
      'Look square onto this plane instead of along an axis: heights along its normal, cells in its own u, v.',
    ),
    flip: bool('With plane: look from its other side.'),
    of: enumOf(['height', 'deviation', 'relief'], 'What the cells hold: height (the default), deviation (the map’s, where the ray lands) or relief (height less the surface round it).'),
    smooth: num('relief: the smoothing’s width (a Gaussian’s sigma), mm; three cells by default.', { exclusiveMinimum: 0 }),
    cell: num('The cell’s side, mm.', { exclusiveMinimum: 0 }),
    grid: bool('The grid of numbers: returned unless levels is asked for; false returns the picture alone.'),
    levels: bool('Gather the values into levels with their areas, the largest first, in place of the grid.'),
    gap: num('levels: the least gap between two levels, mm.', { exclusiveMinimum: 0 }),
    picture: bool('Add a picture of the map with a scale.'),
  }),
  readOnly: true,
  returnsFile: true,
  returnsImage: true,
  run: async ({ box, axis, plane, flip = false, of = 'height', smooth, cell, grid, levels = false, gap, picture }) => {
    requireScan()
    const client = commandHost().session.clientRef.current
    if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
    if (plane !== undefined && axis !== undefined) throw new CommandError('invalid_input', 'Give axis, or plane — one of them.')
    if (flip && plane === undefined) throw new CommandError('invalid_input', 'flip turns a plane over — give plane.')
    if (smooth !== undefined && of !== 'relief') throw new CommandError('invalid_input', 'smooth is the relief’s — give of: "relief".')
    const showGrid = grid ?? !levels
    const showPicture = picture || grid === false
    if (box) for (let k = 0; k < 3; k++) if (!(box.min[k] <= box.max[k])) throw new CommandError('invalid_input', 'The box’s min lies past its max.')
    // Read up front, so a map with nothing to read refuses before it rays.
    const dev = of === 'deviation' ? deviationValues() : null
    const side = showGrid ? HEIGHT_SIDE : HEIGHT_SIDE_FINE
    const most = showGrid ? HEIGHT_CELLS : HEIGHT_CELLS_FINE

    // The grid's frame: start corner, the way the rays run, u and v, and
    // the height at the start with the way it counts along a ray.
    let frame: ReturnType<typeof planeFrame> | null = null
    let g: ReturnType<typeof gridOver>
    let start: Vec3
    let dir: Vec3
    let du: Vec3
    let dv: Vec3
    let from: number
    let sign: number
    let far: number
    const names = 'xyz'
    let k: 0 | 1 | 2 = 2
    const look = axis ?? '-z'
    if (plane !== undefined) {
      const sample = (await client.query({ min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity], limit: PLANE_SAMPLE })).positions
      frame = planeFrame(plane, flip, sample)
      let lo: Vec3
      let hi: Vec3
      if (box) {
        lo = box.min
        hi = box.max
      } else {
        lo = [Infinity, Infinity, Infinity]
        hi = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i + 2 < sample.length; i += 3) {
          const d: Vec3 = [sample[i] - frame.origin[0], sample[i + 1] - frame.origin[1], sample[i + 2] - frame.origin[2]]
          const p: Vec3 = [dot3(d, frame.u), dot3(d, frame.v), dot3(d, frame.normal)]
          for (let j = 0; j < 3; j++) {
            lo[j] = Math.min(lo[j], p[j])
            hi[j] = Math.max(hi[j], p[j])
          }
        }
        if (!Number.isFinite(lo[0])) throw new CommandError('invalid_state', 'The scan has no vertices to map.')
        // The sample is every k-th vertex: a little room round it for the
        // ones between.
        const pad = 0.01 * Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + 1e-3
        lo = [lo[0] - pad, lo[1] - pad, lo[2] - pad]
        hi = [hi[0] + pad, hi[1] + pad, hi[2] + pad]
      }
      g = gridOver(lo, hi, 2, cell, side, most)
      const { origin: o, u, v, normal: n } = frame
      start = [0, 1, 2].map((j) => o[j] + g.u0 * u[j] + g.v0 * v[j] + hi[2] * n[j]) as Vec3
      dir = [-n[0], -n[1], -n[2]]
      du = u
      dv = v
      from = hi[2]
      sign = -1
      far = hi[2] - lo[2]
    } else {
      const b = box ?? (await client.bounds())
      k = 'xyz'.indexOf(look[1]) as 0 | 1 | 2
      sign = look[0] === '+' ? 1 : -1
      g = gridOver(b.min, b.max, k, cell, side, most)
      from = sign > 0 ? b.min[k] : b.max[k]
      const to = sign > 0 ? b.max[k] : b.min[k]
      start = unit(k, from)
      start[g.ua] = g.u0
      start[g.va] = g.v0
      dir = unit(k, sign)
      du = unit(g.ua)
      dv = unit(g.va)
      far = Math.abs(to - from)
    }
    const rays = { origin: start, dir, u: du, v: dv, cell: g.cell, cols: g.cols, rows: g.rows, far }
    let values: Float32Array
    let heights: Float32Array
    if (dev) {
      // The deviation where each ray lands: its triangle's corners weighed
      // as the hit lies between them, a corner with no reading within the
      // search distance left out.
      const hits = await client.heightsAt(rays)
      if (dev.values.length !== useStore.getState().vertexCount) throw new CommandError('internal', `The map has ${dev.values.length} readings and the scan ${useStore.getState().vertexCount} vertices.`)
      values = new Float32Array(hits.values.length).fill(Number.NaN)
      for (let i = 0; i < values.length; i++) {
        if (Number.isNaN(hits.values[i])) continue
        let s = 0
        let w = 0
        for (let j = 0; j < 3; j++) {
          const reading = dev.values[hits.corners[3 * i + j]]
          if (!(Math.abs(reading) <= dev.search)) continue
          s += hits.weights[3 * i + j] * reading
          w += hits.weights[3 * i + j]
        }
        if (w > 1e-6) values[i] = s / w
      }
      for (let i = 0; i < hits.values.length; i++) hits.values[i] = from + sign * hits.values[i]
      heights = hits.values
    } else {
      heights = await client.heights(rays)
      for (let i = 0; i < heights.length; i++) heights[i] = from + sign * heights[i]
      values = of === 'relief' ? reliefGrid(heights, g.cols, g.rows, (smooth ?? 3 * g.cell) / g.cell) : heights
    }
    let lo = Infinity
    let hi = -Infinity
    let hit = 0
    let valued = 0
    for (let i = 0; i < values.length; i++) {
      if (!Number.isNaN(heights[i])) hit++
      const v = values[i]
      if (Number.isNaN(v)) continue
      valued++
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    const places = of === 'height' ? 2 : 3
    const out: Record<string, unknown> = {
      ...(frame
        ? {
            plane: {
              ...(frame.name ? { name: frame.name } : {}),
              origin: frame.origin.map((x) => roundTo(x, 4)),
              u: frame.u.map((x) => roundTo(x, 6)),
              v: frame.v.map((x) => roundTo(x, 6)),
              normal: frame.normal.map((x) => roundTo(x, 6)),
            },
            along: 'normal',
            across: ['u', 'v'],
          }
        : { axis: look, along: names[k], across: [names[g.ua], names[g.va]] }),
      of,
      ...(of === 'relief' ? { smooth: roundTo(smooth ?? 3 * g.cell, 4) } : {}),
      ...(dev ? { source: dev.source, searchDistance: dev.search } : {}),
      cell: g.cell,
      ...(g.widened ? { note: `cell widened to ${g.cell} mm to keep ${most} cells at most` } : {}),
      origin: [roundTo(g.u0, 3), roundTo(g.v0, 3)],
      cols: g.cols,
      rows: g.rows,
      hit,
      valued,
      min: valued ? roundTo(lo, 3) : null,
      max: valued ? roundTo(hi, 3) : null,
    }
    if (showGrid) {
      const rowsOut: (number | null)[][] = []
      for (let r = 0; r < g.rows; r++) {
        const row: (number | null)[] = []
        for (let c = 0; c < g.cols; c++) {
          const v = values[r * g.cols + c]
          row.push(Number.isNaN(v) ? null : roundTo(v, places))
        }
        rowsOut.push(row)
      }
      out.grid = rowsOut
    }
    if (levels) {
      const noise = cellNoise(values, g.cols, g.rows)
      const found = heightLevels(values, { cols: g.cols, cell: g.cell, u0: g.u0, v0: g.v0 }, gap ?? Math.max(3 * noise, LEVEL_GAP_MIN))
      out.noise = roundTo(noise, 4)
      out.gap = roundTo(found.gap, 4)
      out.levels = found.levels.slice(0, HEIGHT_LEVELS).map((l) => ({
        height: roundTo(l.height, 3),
        sigma: roundTo(l.sigma, 4),
        range: l.range.map((x) => roundTo(x, 3)),
        cells: l.cells,
        area: roundTo(l.area, 2),
        sharePct: roundTo(100 * l.share, 1),
        box: { min: l.box.min.map((x) => roundTo(x, 3)), max: l.box.max.map((x) => roundTo(x, 3)) },
      }))
      if (found.levels.length > HEIGHT_LEVELS) out.moreLevels = found.levels.length - HEIGHT_LEVELS
      out.unassigned = found.unassigned
    }
    if (!showPicture) return out
    if (typeof OffscreenCanvas === 'undefined') throw new CommandError('unavailable', 'A picture of the height map needs the browser.')
    const { heightPicturePng } = await import('../../app/heightPicture')
    // A deviation in the workspace's own colours over its range; a relief
    // even about zero; a height from its lowest to its highest.
    const reach = Math.max(Math.abs(lo), Math.abs(hi)) || 1
    const [low, high] = !valued ? [0, 1] : dev ? [-dev.range, dev.range] : of === 'relief' ? [-reach, reach] : [lo, hi]
    const what = of === 'height' ? (frame ? 'Height' : names[k].toUpperCase()) : of === 'deviation' ? 'Deviation' : 'Relief'
    const png = await heightPicturePng({
      values,
      cols: g.cols,
      rows: g.rows,
      u0: g.u0,
      v0: g.v0,
      cell: g.cell,
      uName: frame ? 'U' : names[g.ua].toUpperCase(),
      vName: frame ? 'V' : names[g.va].toUpperCase(),
      title: frame
        ? `${what} over ${frame.name ?? 'the plane'}, looking down its normal — cell ${g.cell} mm`
        : `${what} first met looking ${look} — cell ${g.cell} mm`,
      low,
      high,
      ...(dev ? { colormap: usePrefs.getState().colormap, bare: 'no reading' } : {}),
    })
    const stem = frame ? 'plane' : look.replace('+', 'p').replace('-', 'm')
    return { ...out, file: { name: `heightmap-${stem}${of === 'height' ? '' : `-${of}`}.png`, mimeType: 'image/png', bytes: png.bytes }, width: png.width, height: png.height }
  },
}

/** A scan's checks: how many vertices the noise is read on, how many rims
 *  are named, and how many cells a side the thickness is read over. */
const QA_NOISE_SAMPLE = 4000
const QA_RIMS = 4
const QA_SIDE = 60
const QA_SAMPLE = 60_000
/** Faces this far out of parallel are worth a note, degrees. */
const QA_TILT_NOTE = 0.2

const qa: Command<{ axis?: 'x' | 'y' | 'z' | Vec3 }> = {
  name: 'qa',
  title: 'Check the scan before modelling',
  description:
    'One call before modelling, to know what the scan will and will not give: rims — the open edges of its holes (count, total length, the longest few with length, centre and size, mm); noise — the median scatter of small plane fits round a sample of vertices (mm; near 0 is a CAD tessellation) and its 90th percentile; thickness through the part along axis (x, y, z or a direction; by default the alignment’s z when the part is aligned, else the way most of the surface faces — a plate’s faces) over a grid — p5, p50, p95 (mm), and on the cells near the median (the main faces) the thickness’s linear trend as tiltDeg, how far apart faces that should be parallel are, with the way it thickens and its run from end to end; faces gives each face’s own tilt off square to the axis (topDeg, bottomDeg), so a lean of the whole part shows apart from faces out of parallel. notes: what looks wrong, plainly. Changes nothing.',
  input: obj({ axis: oneOf([enumOf(['x', 'y', 'z'], 'A world axis.'), vec3('A direction, any length.')], 'The thickness axis; see above.') }),
  readOnly: true,
  run: async ({ axis }) => {
    requireScan()
    const client = commandHost().session.clientRef.current
    if (!client) throw new CommandError('unavailable', 'The mesh worker is not running.')
    const { rims, noise } = await client.scanQa(QA_NOISE_SAMPLE, QA_RIMS)
    // The scan's points and normals, spread evenly: the box across the axis
    // and the way most of it faces come off them.
    const inf = Infinity
    const sample = await client.query({ min: [-inf, -inf, -inf], max: [inf, inf, inf], limit: QA_SAMPLE })
    let d: Vec3 | null
    let axisFrom: string
    if (Array.isArray(axis)) {
      const l = Math.hypot(...axis)
      if (!(l > 0)) throw new CommandError('invalid_input', 'axis: give a direction, not a zero vector.')
      d = [axis[0] / l, axis[1] / l, axis[2] / l]
      axisFrom = 'given'
    } else if (axis || useStore.getState().appliedAlignment) {
      const k = 'xyz'.indexOf(axis ?? 'z')
      d = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0]
      axisFrom = axis ? 'given' : 'the alignment’s z'
    } else {
      d = dominantFacing(sample.normals)
      axisFrom = 'the way most of the surface faces'
      if (!d) throw new CommandError('failed', 'The scan has too few points to read a thickness axis off — give axis.')
      // Pointing the way of its largest component, so +z stays +z.
      const big = [0, 1, 2].reduce((m, i) => (Math.abs(d![i]) > Math.abs(d![m]) ? i : m), 0)
      if (d[big] < 0) d = [-d[0], -d[1], -d[2]]
    }
    const [u, v] = orthoBasis(d)
    const dot = (p: Float32Array, i: number, a: Vec3) => p[i] * a[0] + p[i + 1] * a[1] + p[i + 2] * a[2]
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i + 2 < sample.positions.length; i += 3) {
      const s = [dot(sample.positions, i, u), dot(sample.positions, i, v), dot(sample.positions, i, d)]
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], s[k])
        hi[k] = Math.max(hi[k], s[k])
      }
    }
    const cell = niceCeil(Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-6) / QA_SIDE)
    const cols = Math.max(1, Math.ceil((hi[0] - lo[0]) / cell))
    const rows = Math.max(1, Math.ceil((hi[1] - lo[1]) / cell))
    const u0 = (lo[0] + hi[0]) / 2 - (cols * cell) / 2
    const v0 = (lo[1] + hi[1]) / 2 - (rows * cell) / 2
    const pad = 0.01 * (hi[2] - lo[2]) + 0.1
    const far = hi[2] - lo[2] + 2 * pad
    const at = (w: number): Vec3 => [u0 * u[0] + v0 * v[0] + w * d![0], u0 * u[1] + v0 * v[1] + w * d![1], u0 * u[2] + v0 * v[2] + w * d![2]]
    const neg: Vec3 = [-d[0], -d[1], -d[2]]
    const top = await client.heights({ origin: at(hi[2] + pad), dir: neg, u, v, cell, cols, rows, far })
    const bottom = await client.heights({ origin: at(lo[2] - pad), dir: d, u, v, cell, cols, rows, far })
    const us: number[] = []
    const vs: number[] = []
    const ts: number[] = []
    const tops: number[] = []
    const bottoms: number[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const tTop = hi[2] + pad - top[i]
        const tBottom = lo[2] - pad + bottom[i]
        const t = tTop - tBottom
        if (!(t > 0)) continue
        us.push(u0 + (c + 0.5) * cell)
        vs.push(v0 + (r + 0.5) * cell)
        ts.push(t)
        tops.push(tTop)
        bottoms.push(tBottom)
      }
    }
    const v3 = (x: readonly number[]) => x.map((y) => roundTo(y, 2))
    const axisName = d[0] === 1 ? 'x' : d[1] === 1 ? 'y' : d[2] === 1 ? 'z' : `[${v3(d).join(', ')}]`
    const notes: string[] = []
    const out: Record<string, unknown> = {
      rims: { count: rims.count, total: roundTo(rims.total, 1), largest: rims.largest.map((r) => ({ length: roundTo(r.length, 1), at: v3(r.at), size: roundTo(r.size, 1) })) },
      noise: { median: roundTo(noise.median, 4), p90: roundTo(noise.p90, 4), sampled: noise.sampled },
    }
    if (rims.count > 0) {
      const l = rims.largest[0]
      notes.push(`${rims.count} open rim${rims.count === 1 ? '' : 's'}, ${roundTo(rims.total, 1)} mm in all — the longest ${roundTo(l.length, 1)} mm round [${v3(l.at).join(', ')}]: the scan has holes there; fits and sections near them see less surface.`)
    }
    if (noise.median > 0.03) notes.push(`Noisy surface: ${roundTo(noise.median, 3)} mm median scatter — read sizes from fits over large patches, not single points.`)
    else if (noise.median < 1e-4) notes.push('The surface has no noise — a CAD tessellation, not a scan: read its numbers exactly.')
    if (ts.length < 12) {
      out.thickness = { axis: d.map((x) => roundTo(x, 4)), axisFrom, cells: ts.length }
      notes.push(`Thickness along ${axisName}: too few rays went through the part to read it.`)
      return { ...out, notes }
    }
    const sorted = [...ts].sort((a, b) => a - b)
    const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    const p50 = pct(0.5)
    // The main faces: the thickness most cells share, and the cells near it
    // — wide enough for a lean of a degree or two across the part, narrow
    // enough to leave a step of another thickness out.
    const near = (t: number) => Math.max(0.3, 0.06 * t)
    let mode = p50
    let most = 0
    for (let i = 0; i < ts.length; i += Math.max(1, Math.floor(ts.length / 400))) {
      const w = near(ts[i]) / 2
      let n = 0
      for (const t of ts) if (Math.abs(t - ts[i]) <= w) n++
      if (n > most) {
        most = n
        mode = ts[i]
      }
    }
    const main = ts.map((t, i) => (Math.abs(t - mode) <= near(mode) ? i : -1)).filter((i) => i >= 0)
    const pick = (a: number[]) => main.map((i) => a[i])
    const trend = robustPlane(pick(us), pick(vs), pick(ts))
    const thickness: Record<string, unknown> = { axis: d.map((x) => roundTo(x, 4)), axisFrom, cells: ts.length, p5: roundTo(pct(0.05), 3), p50: roundTo(p50, 3), p95: roundTo(pct(0.95), 3) }
    if (trend) {
      const slope = Math.hypot(trend.b, trend.c)
      const tiltDeg = (Math.atan(slope) * 180) / Math.PI
      const dir: Vec3 = slope > 0 ? ([0, 1, 2].map((i) => (trend.b * u[i] + trend.c * v[i]) / slope) as Vec3) : [0, 0, 0]
      // The run of the trend across the main cells, along the way it rises.
      const along = main.map((i) => (slope > 0 ? (us[i] * trend.b + vs[i] * trend.c) / slope : 0))
      const lo = Math.min(...along)
      const hi = Math.max(...along)
      const mean = trend.a + (trend.b * pick(us).reduce((s, x) => s + x, 0) + trend.c * pick(vs).reduce((s, x) => s + x, 0)) / main.length
      const midAlong = along.reduce((s, x) => s + x, 0) / along.length
      const from = mean - slope * (midAlong - lo)
      const to = mean + slope * (hi - midAlong)
      Object.assign(thickness, { tiltDeg: roundTo(tiltDeg, 3), thickensToward: v3(dir), run: [roundTo(from, 3), roundTo(to, 3)], over: roundTo(hi - lo, 1) })
      const ft = robustPlane(pick(us), pick(vs), pick(tops))
      const fb = robustPlane(pick(us), pick(vs), pick(bottoms))
      const deg = (f: { b: number; c: number } | null) => (f ? roundTo((Math.atan(Math.hypot(f.b, f.c)) * 180) / Math.PI, 3) : null)
      // The faces fitted each on its own, their worst cells left out apart.
      thickness.faces = { topDeg: deg(ft), bottomDeg: deg(fb) }
      if (tiltDeg >= QA_TILT_NOTE) {
        notes.push(`Faces across ${axisName} that should be parallel are ${roundTo(tiltDeg, 2)}° apart: the part thickens from ${roundTo(from, 2)} to ${roundTo(to, 2)} mm over ${roundTo(hi - lo, 0)} mm toward [${v3(dir).join(', ')}]. A scan merge or alignment error, or a real taper — decide before modelling to one thickness, which misses by up to ${roundTo(Math.abs(to - from) / 2, 2)} mm.`)
      }
    }
    if (pct(0.95) - pct(0.05) > 0.3 * p50) notes.push(`Thickness along ${axisName} varies from ${roundTo(pct(0.05), 2)} to ${roundTo(pct(0.95), 2)} mm (p5–p95): steps, pockets or bosses — scan.heightmap shows where.`)
    out.thickness = thickness
    return { ...out, notes }
  },
}

export const scanCommands = [open, nearest, query, fitSurface, draft, heightmap, qa]
