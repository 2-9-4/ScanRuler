// SPDX-License-Identifier: AGPL-3.0-only
// reverse.body.review: the design loop in one call — the volume error and
// the comparison with the scan read together, merged into places on the
// part ranked by how much material is wrong there (core/reviewPlaces.ts),
// the deviation map on the scan pictured from the views that best see them
// with each place's number pinned on it, how this review stands to the
// last and to the first, the plan's target, and the place to work on next
// with a first step. A run iterates on what it answers — the map is looked
// at every loop, not only handed over at the end.

import { invalid } from '../../../src/commands/core/common'
import { sceneOf } from '../../../src/commands/host'
import { runCommand } from '../../../src/commands/registry'
import { arr, bool, int, num, obj, vec3 } from '../../../src/commands/schema'
import { errorMessage } from '../../../src/commands/types'
import type { Vec3 } from '../../../src/core/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useShell } from '../../../src/state/shellStore'
import { useStore } from '../../../src/state/store'
import { STANDARD_VIEWS } from '../../../src/viewer/orthoViewport'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { chooseViews, mergePlaces, type FaceName, type PatchSpot, type Place, type ReviewMark, trendOf, type VolumeSpot } from '../core/reviewPlaces'
import { useRePrefs } from '../state/rePrefs'
import { ReviewPins } from '../viewer/reviewPins'
import { compareBodies, type BodiesCompared } from './reBodyCommands'
import { bodyNamed, re, ready, type Ref } from './reCommandCore'
import { mapMark, mapRead } from './reMapRead'
import { keepReview, planRegionAt, planVerdict, setAsideInferred, usePlan } from './rePlan'
import { idleParametersOut } from './reReadout'
import { bodyRef } from './reSchemas'
import type { ReverseSession } from './reSession'
import { measureVolume, type VolumeMeasured } from './reVolumeCompare'

/** How many places a review names unless told otherwise, and at most. */
const REVIEW_PLACES = 6
const MAX_PLACES = 20

/** How many volume regions and patches a side are read to merge — more
 *  than are named, so a small region a large patch lies on is not lost. */
const REVIEW_REGIONS = 16
const REVIEW_PATCHES = 12

/** How many of the worst features the review names. */
const REVIEW_FEATURES = 3

/** How long the picture waits for the map to be read at T, ms. */
const MAP_WAIT_MS = 60_000

const round1 = (v: number) => Math.round(v * 10) / 10
const round2 = (v: number) => Math.round(v * 100) / 100
const r2 = (p: readonly number[]): Vec3 => [round2(p[0]), round2(p[1]), round2(p[2])]
const r1 = (p: readonly number[]): Vec3 => [round1(p[0]), round1(p[1]), round1(p[2])]

// ---- the places -------------------------------------------------------------------

type FaceRef = { index: number; madeBy: { name: string | null } } | null

const faceName = (body: { name: string } | null | undefined, face: FaceRef): FaceName | null => (face && body ? { body: body.name, index: face.index, madeBy: face.madeBy.name } : null)

/** The volume error's regions and the comparison's patches, as the merge
 *  takes them. */
function spotsOf(volume: VolumeMeasured, compared: BodiesCompared): { regions: VolumeSpot[]; patches: PatchSpot[] } {
  const regions: VolumeSpot[] = volume.regions.flatMap((r) => (r.kind === 'unsure' ? [] : [{ kind: r.kind, volume: r.volume, maxDepth: r.maxDepth, centroid: r.centroid, box: r.box, face: faceName(r.body, r.face) }]))
  type Read = (typeof compared.patches)[number]
  const spot = (p: Omit<Read, 'body' | 'face'> & { body: { name: string } | null; face: FaceRef }, far: boolean): PatchSpot => ({
    side: p.extreme > 0 ? 'outside' : 'inside',
    far,
    kind: p.kind,
    area: p.area,
    volume: p.volume,
    extreme: p.extreme,
    mean: p.mean,
    centroid: p.centroid as Vec3,
    at: p.at as Vec3,
    vertex: p.vertex,
    box: p.box as PatchSpot['box'],
    face: faceName(p.body, p.face),
  })
  const patches = [...compared.patches.map((p) => spot(p, false)), ...(compared.far ? [...compared.far.inside.patches, ...compared.far.outside.patches].map((p) => spot(p, true)) : [])]
  return { regions, patches }
}

/** A place as the answer names it. */
function placeOut(s: ReverseSession, p: Place, several: boolean) {
  const region = planRegionAt(s, [p.centroid[0], p.centroid[1], p.centroid[2]])
  return {
    n: p.n,
    kind: p.kind,
    mm3: Math.round(p.mm3),
    maxDepth: round2(p.maxDepth),
    ...(p.area !== undefined ? { area: round1(p.area) } : {}),
    ...(p.mean !== undefined ? { mean: round2(p.mean) } : {}),
    at: r2(p.centroid),
    box: { min: r1(p.box.min), max: r1(p.box.max) },
    face: p.face ? { ...(several ? { body: p.face.body } : {}), index: p.face.index, madeBy: p.face.madeBy } : null,
    by: p.by,
    ...(region ? { region } : {}),
  }
}

/** The plane a first section across a place lies in: through its centre,
 *  square to the longest side of its box — across its length — unless that
 *  runs along the normal of the flat face it lies on, then the next; and
 *  the square to frame, half again the box across the plane. */
function acrossPlace(s: ReverseSession, p: Place): { origin: Vec3; normal: Vec3; size: number } {
  const side = [0, 1, 2].map((k) => p.box.max[k] - p.box.min[k])
  const order = [0, 1, 2].sort((a, b) => side[b] - side[a])
  const body = p.face ? re().bodies.find((b) => b.name === p.face!.body) : undefined
  const fp = body && p.face ? s.topologies.get(body.id)?.faces[p.face.index]?.fingerprint : undefined
  const along = order.find((k) => !(fp?.kind === 'plane' && Math.abs(fp.dir[k]) > 0.7)) ?? order[0]
  const normal: Vec3 = [0, 0, 0]
  normal[along] = 1
  const size = Math.round(Math.min(120, Math.max(10, 1.5 * Math.max(...side.filter((_, k) => k !== along)))))
  return { origin: r1(p.centroid), normal, size }
}

/** The place to work on next and a first step there, in a sentence. */
function nextStep(s: ReverseSession, p: Place, tolerance: number): string {
  const at = `(${r1(p.centroid).join(', ')})`
  const face = p.face ? `, nearest face ${p.face.index} of ${p.face.body}${p.face.madeBy ? ` (${p.face.madeBy})` : ''}` : ''
  // units-ok: the agent's answer — in millimetres always.
  const head = `${p.n}: ${p.kind} ${Math.round(p.mm3).toLocaleString('en-US')} mm³ at ${at}${face}`
  const cut = acrossPlace(s, p)
  const section = `section.render { plane: { origin: [${cut.origin.join(', ')}], normal: [${cut.normal.join(', ')}] }, frame: { at: [${cut.origin.join(', ')}], size: ${cut.size} }, tolerance: ${tolerance} }`
  if (p.kind === 'off') {
    // units-ok: as above.
    const how = (p.mean ?? 0) > 0 ? `lies ${round2(p.mean ?? 0)} mm inside the scan` : `stands ${round2(-(p.mean ?? 0))} mm proud of it`
    const maker = p.face?.madeBy
    return `${head} — the face ${how}: ${maker ? `reverse.body.compare { feature: "${maker}" } reads its numbers against the scan — refit the one off, or move the sketch piece behind it` : `read a section across it — ${section}`}`
  }
  const what = p.kind === 'missing' ? 'material the part has and the model has not (a boss, a rib, a flange, a swage, a blend too small)' : 'material the model has and the part has not (a hole or a pocket not cut, a wall too thick, a blend too large, a helper body’s face left on)'
  return `${head} — ${what}: read a section across it — ${section} — and model what it shows`
}

// ---- the picture ------------------------------------------------------------------

const VIEW_DIRS = (Object.keys(STANDARD_VIEWS) as (keyof typeof STANDARD_VIEWS)[]).map((name) => {
  const d = STANDARD_VIEWS[name].dir
  return { name, dir: [d.x, d.y, d.z] as Vec3 }
})

/** The scan vertex nearest a point, by brute force — a few places over a
 *  million vertices is a few tens of milliseconds. */
function nearestVertex(positions: Float32Array, p: readonly number[]): number {
  let best = -1, bestD = Infinity
  for (let i = 0, v = 0; i + 2 < positions.length; i += 3, v++) {
    const dx = positions[i] - p[0], dy = positions[i + 1] - p[1], dz = positions[i + 2] - p[2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  return best
}

/** Where each place's pin goes — a point of the scan there — and which
 *  way the scan faces at it, turned into the world as the part stands. */
function pinsOn(scene: SceneManager, places: readonly Place[]): { at: Vec3; normal: Vec3 | null }[] {
  const positions = scene.scanPositions()
  const normals = scene.scanGeometry()?.getAttribute('normal')
  const turn = scene.layerHost().partGroup.matrixWorld.elements
  return places.map((p) => {
    const v = positions ? (p.vertex !== undefined && p.vertex * 3 + 2 < positions.length ? p.vertex : nearestVertex(positions, p.centroid)) : -1
    const at: Vec3 = v >= 0 && positions ? [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]] : (p.scanAt ?? p.centroid)
    if (v < 0 || !normals) return { at, normal: null }
    const n = [normals.getX(v), normals.getY(v), normals.getZ(v)]
    // The part's turn (a column-major 4×4) on the normal.
    const w: Vec3 = [turn[0] * n[0] + turn[4] * n[1] + turn[8] * n[2], turn[1] * n[0] + turn[5] * n[1] + turn[9] * n[2], turn[2] * n[0] + turn[6] * n[1] + turn[10] * n[2]]
    const l = Math.hypot(...w)
    return { at, normal: l > 0 ? [w[0] / l, w[1] / l, w[2] / l] : null }
  })
}

type Pictured = { file?: { name: string; mimeType: string; bytes: Uint8Array }; picture: Record<string, unknown> | null; pictureWhy?: string }

/**
 * The deviation map on the scan, read against the bodies at ±T, from the
 * views that best see the places, with each place's number pinned on it —
 * a sheet of views as view.render draws one, the bodies put away so the
 * map is seen. The map's range is set to T for the picture and the pins put
 * up; both, and the map key, are as they were after it.
 */
async function pictureOf(places: readonly Place[], tolerance: number): Promise<Pictured> {
  const scene = sceneOf()
  if (!scene) return { picture: null, pictureWhy: 'no viewport — the session runs headless; the places stand without a picture' }
  if (places.length === 0) return { picture: null, pictureWhy: 'no place over T to point at' }
  if (useShell.getState().workspace !== 'reverse') useShell.getState().setWorkspace('reverse')
  const pins = pinsOn(scene, places)
  const views = chooseViews(
    pins.map((p) => p.normal),
    places.map((_, i) => 1 / (i + 1)),
    VIEW_DIRS,
  )
  // Read at T: red is past the tolerance.
  const prefs = useRePrefs.getState()
  const wasRange = prefs.liveMapRange
  const wasMap = { bodyMap: re().bodyMap, curvatureMap: re().curvatureMap }
  const before = mapMark()
  if (Math.abs(wasRange - tolerance) > 1e-9) prefs.setLiveMapRange(tolerance)
  if (!wasMap.bodyMap) re().setBodyMap(true)
  const range = useRePrefs.getState().liveMapRange
  const changed = range !== wasRange || !wasMap.bodyMap
  let layer: ReviewPins | null = null
  try {
    await mapRead(range, changed ? before : null, MAP_WAIT_MS)
    layer = new ReviewPins(
      scene.layerHost(),
      places.map((p, i) => ({ n: p.n, at: pins[i].at, kind: p.kind, normal: pins[i].normal })),
    )
    // The map alone under the pins: the elements, sections, sketches and
    // notes a project carries drawn over it hid most of the mirror holder's.
    const show = { scan: true, map: true, bodies: false, elements: false, sections: false, labels: false, sketches: false, notes: false }
    const out = (await runCommand('view.render', { views, show })) as Record<string, unknown> & { file: Pictured['file'] }
    const { file, width, height, map, mapWhy, mapNote } = out
    return { file, picture: { views, width, height, pins: places.length, ...(map !== undefined ? { map } : {}), ...(mapWhy ? { mapWhy } : {}), ...(mapNote ? { mapNote } : {}) } }
  } catch (e) {
    return { picture: null, pictureWhy: `the picture failed: ${errorMessage(e)}` }
  } finally {
    layer?.dispose()
    if (Math.abs(useRePrefs.getState().liveMapRange - wasRange) > 1e-9) useRePrefs.getState().setLiveMapRange(wasRange)
    if (!wasMap.bodyMap) {
      re().setBodyMap(false)
      re().setCurvatureMap(wasMap.curvatureMap)
    }
  }
}

// ---- the command ------------------------------------------------------------------

type ReviewIn = { tolerance?: number; bodies?: Ref[]; within?: { min: Vec3; max: Vec3 }; places?: number; picture?: boolean; cell?: number }

export const review: Command<ReviewIn> = {
  name: 'review',
  title: 'Review the model against the scan',
  // units-ok: the command's description, for the agent — in millimetres always.
  description: `The design loop in one call — after every step that changes the part, from the first feature on: the volume compare and the comparison with the scan (detail "score") read at T together and merged into the places most wrong, with the plan's verdict and the place to work on next. Answers tolerance (T, ± mm: tolerance, else the plan's T, else the live map's range); score (withinT, % of the scan read or far within ±T; read, far, rms, p95); volume (excess, missing, cell); byFeature (the ${REVIEW_FEATURES} worst); places (${REVIEW_PLACES} by default, ${MAX_PLACES} at most; placesFound counts them all), each with n, kind (missing, excess, off), mm3, maxDepth, area, at, box, the nearest face and its maker, by (volume, map, both, far) and the plan's region there; inferred (the missing mm³ set aside in regions the plan marks inferred, by region; the totals keep them); trend (loop, vsLast, vsFirst — went better, worse, mixed or same); target (the plan's verdict, with next when not done); next (the place to work on and a first step). And the picture, inline: the map on the scan at ±T from the 2–4 views that best see the places, each place's number pinned (red missing, blue excess, amber off) — look at it every loop; picture: false leaves it out, and headless there is none (pictureWhy). within: a box only. The bodies: the visible solids by default. 15–25 s on a million vertices. Needs a scan. Changes nothing. The scan-to-cad guide's §5 reads each field.`,
  input: obj({
    // units-ok: the command's schema, for the agent — in millimetres always.
    tolerance: num('T, ± mm; the plan’s T by default, else the live map’s range.', { exclusiveMinimum: 0 }),
    bodies: arr(bodyRef, 'The solid bodies; the visible ones by default.', { minItems: 1 }),
    // units-ok: as above.
    within: obj({ min: vec3('The lowest corner, mm.'), max: vec3('The highest corner, mm.') }, ['min', 'max'], 'Only this box, in the scan’s frame.'),
    places: int(`How many places to name; ${REVIEW_PLACES} by default.`, { minimum: 1, maximum: MAX_PLACES }),
    picture: bool('The picture of the map with the places pinned (true, the default); false leaves it out.'),
    // units-ok: as above.
    cell: num('The volume compare’s cell, mm; as reverse.body.volume_compare takes it by default.', { exclusiveMinimum: 0 }),
  }),
  readOnly: true,
  long: true,
  returnsImage: true,
  timeoutMs: 600_000,
  run: async ({ tolerance, bodies, within, places: placeCount = REVIEW_PLACES, picture = true, cell }, ctx) => {
    if (!useStore.getState().fileName) throw new CommandError('no_scan', 'There is no scan to review the bodies against.')
    if (within) for (let k = 0; k < 3; k++) if (!(within.min[k] < within.max[k])) invalid('within: min must lie below max on every axis.')
    const s = await ready()
    const picked = bodies ? bodies.map(bodyNamed) : re().bodies.filter((b) => b.visible && !b.surface)
    if (picked.length === 0) throw new CommandError('invalid_state', 'There is no solid body to review — build one first.')
    const sheet = picked.find((b) => b.surface)
    if (sheet) invalid(`bodies: ${sheet.name} is a sheet — a review reads the volume error, which needs solids.`)
    const T = tolerance ?? usePlan.getState().plan?.target.tolerance ?? useRePrefs.getState().liveMapRange
    const started = Date.now()
    const ids = picked.map((b) => b.id)

    const volume = await measureVolume(s, picked, { tolerance: T, regions: REVIEW_REGIONS, kinds: ['excess', 'missing'], ...(cell !== undefined ? { cell } : {}), ...(within ? { within } : {}) }, ctx.progress)
    ctx.progress('Comparing with the scan…')
    const compared = await compareBodies(s, { bodies: ids, range: T, tolerance: T, spots: 0, faces: 0, patches: REVIEW_PATCHES, features: REVIEW_FEATURES, ...(within ? { within } : {}) })

    const { regions, patches } = spotsOf(volume, compared)
    // What the plan says was inferred where the scan saw nothing is told
    // apart, below; the rest ranked, numbered as it stands.
    const { ranked, inferred } = setAsideInferred(s, mergePlaces(regions, patches, T))
    const all = ranked.map((p, i) => ({ ...p, n: i + 1 }))
    const places = all.slice(0, placeCount)
    const several = picked.length > 1
    const seen = compared.read + (compared.far?.count ?? 0)
    const withinT = seen > 0 ? round1((100 * compared.within) / seen) : null

    // The trend: this review kept, against the last and the first. Volume
    // the plan calls inferred is left out, or modelling the bore the scan
    // never saw reads as the part getting worse.
    const last = re().features.at(-1)
    const inferredMissing = inferred.reduce((sum, r) => sum + r.mm3, 0)
    const mark: ReviewMark = { at: Date.now(), features: re().features.length, feature: last?.name ?? null, tolerance: T, withinT, excess: volume.totals.excess.volume, missing: Math.max(0, volume.totals.missing.volume - inferredMissing) }
    const marks = keepReview(s, mark)

    // The feature patches over T on the scan, far ones too, held against
    // the plan: a share within T with a blade 0.5 mm off is not met.
    const featurePatches = patches.filter((p) => p.kind === 'feature').map((p) => ({ at: p.at, depth: Math.abs(p.extreme), madeBy: p.face?.madeBy ?? null, outside: p.side === 'outside' }))
    const verdict = planVerdict(s, withinT === null ? null : { withinT, tolerance: T, featurePatches })
    const top = places[0]
    const met = verdict?.met === true && ((verdict.regions as { open?: unknown[] } | undefined)?.open?.length ?? 0) === 0
    const next = top ? nextStep(s, top, T) : `no place over T${met ? ' — the target is met' : ''}: compare_in_deviation for the model side, then the handover`

    ctx.progress('Picturing the map…')
    const pictured: Pictured = picture ? await pictureOf(places, T) : { picture: null, pictureWhy: 'picture: false' }

    return {
      ...(several ? { bodies: picked.map((b) => ({ id: b.id, name: b.name })) } : {}),
      tolerance: T,
      ...(within ? { within } : {}),
      score: {
        withinT,
        read: compared.read,
        ...(compared.far ? { far: { inside: compared.far.inside.count, outside: compared.far.outside.count } } : {}),
        rms: compared.rms === null ? null : round2(compared.rms),
        p95: compared.p95 === null ? null : round2(compared.p95),
      },
      volume: { excess: volume.totals.excess, missing: volume.totals.missing, cell: volume.cell },
      ...(volume.warnings ? { warnings: volume.warnings } : {}),
      ...(inferred.length > 0
        ? {
            inferred: {
              missing: inferred.reduce((sum, r) => sum + r.mm3, 0),
              regions: inferred,
              // units-ok: the agent's answer — in millimetres always.
              say: 'mm³ of volume.missing in regions the plan marks inferred, where the scan saw nothing: not ranked among places, not held against target — name them in the chat',
            },
          }
        : {}),
      ...(compared.byFeature ? { byFeature: compared.byFeature.map((f) => ({ name: f.name, withinT: f.read ? round1((100 * f.within) / f.read) : null, rms: round2(f.rms) })) } : {}),
      places: places.map((p) => placeOut(s, p, several)),
      placesFound: all.length,
      trend: trendOf(marks),
      target: verdict ?? null,
      ...(verdict ? {} : { targetWhy: 'no plan set — reverse.plan.set gives the archetype, the regions and the target the loop runs to' }),
      ...idleParametersOut(),
      next,
      ...(pictured.picture ? { picture: pictured.picture } : { pictureWhy: pictured.pictureWhy }),
      seconds: round1((Date.now() - started) / 1000),
      ...(pictured.file ? { file: pictured.file } : {}),
    }
  },
}
