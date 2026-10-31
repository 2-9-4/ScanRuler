// SPDX-License-Identifier: AGPL-3.0-only
// reverse.thread.read: the thread on a round face read off the scan — its
// pitch, its size, and the standard thread it matches.

import { invalid } from '../../../src/commands/core/common'
import { commandHost } from '../../../src/commands/host'
import { bool, enumOf, int, num, obj, oneOf, validate, vec3 } from '../../../src/commands/schema'
import { round3, round4 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { addScaled, dot, normalize, sub } from '../../../src/core/vec'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import type { FaceInfo } from '../core/build'
import { threadSizes, type ThreadStandard } from '../core/thread'
import { ALL_STANDARDS, basicDepth, isThread, matchThread, readThread, type ThreadReading } from '../core/threadRead'
import { facePasses } from '../core/where'
import { roundFaceLength } from '../state/reStore'
import { bodyNamed, facePicked, facePickIn, type FacePickIn, type Json, ready, type Ref, type Topology, topologyOf } from './reCommandCore'
import { bodyRef, facePick } from './reSchemas'

/** How many scan points a thread is read from at most, and the band about
 *  the radius a point counts in: this many mm, or this share of the radius
 *  when that is more. */
const THREAD_POINTS = 20_000

const THREAD_BAND_MM = 0.6

const THREAD_BAND_SHARE = 0.2

/** How sure a left hand must read for the feature to take it: right is
 *  every thread but a few, and an axis a little aslant blurs the hand. */
const LEFT_SURE = 0.2

/** The faces a round face runs on into along its axis, each reached from
 *  it across an edge: the round faces on the same axis — a hole's wall in
 *  pieces, its countersink — and those whose edges lie all within `band`
 *  of the radius, as a modelled thread's flanks do. Where they reach along
 *  the axis (`dir`, a unit vector), mm from `at`, read off their edges. */
function coaxialRun(t: Topology, face: FaceInfo, at: Vec3, dir: Vec3, radius: number, band: number): { faces: number[]; from: number; to: number } {
  type Edge = Topology['edges'][number]
  const edgesOf = new Map<number, Edge[]>()
  for (const e of t.edges) {
    for (const h of new Set(e.faces)) {
      const list = edgesOf.get(h)
      if (list) list.push(e)
      else edgesOf.set(h, [e])
    }
  }
  const along = (e: Edge, k: number): [number, number] => {
    const q = sub([e.polyline[k], e.polyline[k + 1], e.polyline[k + 2]], at)
    const z = dot(q, dir)
    return [z, Math.hypot(q[0] - dir[0] * z, q[1] - dir[1] * z, q[2] - dir[2] * z)]
  }
  const within = (f: FaceInfo) =>
    (edgesOf.get(f.hash) ?? []).every((e) => {
      for (let k = 0; k < e.polyline.length; k += 3) if (Math.abs(along(e, k)[1] - radius) > band) return false
      return true
    })
  const byHash = new Map(t.faces.map((f) => [f.hash, f]))
  const run = new Set([face.hash])
  const queue = [face.hash]
  while (queue.length > 0) {
    for (const e of edgesOf.get(queue.pop()!) ?? []) {
      for (const h of e.faces) {
        const f = byHash.get(h)
        if (!f || run.has(h) || !(facePasses(f, { coaxial: { at, dir } }, null) || within(f))) continue
        run.add(h)
        queue.push(h)
      }
    }
  }
  let from = Infinity, to = -Infinity
  for (const h of run) {
    for (const e of edgesOf.get(h) ?? []) {
      for (let k = 0; k < e.polyline.length; k += 3) {
        const z = along(e, k)[0]
        from = Math.min(from, z)
        to = Math.max(to, z)
      }
    }
  }
  return { faces: t.faces.flatMap((f, i) => (run.has(f.hash) ? [i] : [])), from, to }
}

/** Which windows read the pitch, for the note: none to say with one. */
const agreeIn = (r: ThreadReading): string =>
  r.windows.length < 2 || !r.threaded ? '' : r.agree > 0 ? `; ${r.agree} of ${r.windows.length} windows agree, from ${r.threaded[0]} to ${r.threaded[1]} mm along the axis` : '; over the whole length, too coarse for a window'

export const threadRead: Command<{ axis: Json; standard?: ThreadStandard | 'any'; band?: number; length?: number; limit?: number; profile?: boolean }> = {
  name: 'read',
  title: 'Read a thread off the scan',
  description:
    'Whether a bore or a boss of the scan carries a thread, and which: the scan’s points in a thin shell about the axis are read for their radius along it, and in that profile the pitch, the crest and root diameters (minor, major), the hand (leftHanded, handConfidence) and whether it is a bore (internal) or a boss. The reading is set against the standard sizes — candidates (the nearest three, with how far off in pitch and diameter) and suggested, the one near enough, with the size string the thread feature takes — and, where axis was a face of a body, feature is the thread ready to add (reverse.feature.add). thread says whether it is one: a pitch found (strength) with teeth (contrast) at least three times the wall’s noise — a plain bore’s own ripple can repeat and reads thread: false. The pitch is read in windows along the axis (windows, agree); threaded is where they lie, and minor and major are read there. axis is a cylinder element, a round face of a body (read along its coaxial run) or an axis given outright with its radius and length. Run it on every small hole: a thread is easy to miss on a scan. Changes nothing.',
  input: obj(
    {
      axis: oneOf(
        [
          { ...obj({ kind: enumOf(['element']), id: int('A cylinder element of 3D Measure.') }, ['kind', 'id'], 'A cylinder fitted in the bore or on the boss (element.fit).'), title: 'element' },
          { ...obj({ kind: enumOf(['face']), body: bodyRef, face: facePickIn() }, ['kind', 'body', 'face'], 'A round face of a body — the bore or the boss as modelled.'), title: 'face' },
          { ...obj({ kind: enumOf(['line']), origin: vec3('A point on the axis, mm — the middle of the length read.'), dir: vec3('The axis’s direction.'), radius: num('The nominal radius, mm.', { exclusiveMinimum: 0 }), length: num('mm along the axis, centred on origin.', { exclusiveMinimum: 0 }) }, ['kind', 'origin', 'dir', 'radius', 'length'], 'An axis given outright.'), title: 'line' },
        ],
        'The axis to read along.',
      ),
      standard: enumOf(['metric', 'unc', 'unf', 'print45', 'any'], 'ISO metric (the default), UNC, UNF, print45 (the 45° form for printing) or any.'),
      band: num('mm either side of the radius a point still counts.', { exclusiveMinimum: 0 }),
      length: num('mm along the axis to read, centred; the element’s length or the face’s coaxial run by default.', { exclusiveMinimum: 0 }),
      limit: int(`How many scan points to read at most; ${THREAD_POINTS} by default.`, { minimum: 100, maximum: THREAD_POINTS }),
      profile: bool('Add the radius along the axis, 200 points (off by default).'),
    },
    ['axis'],
  ),
  readOnly: true,
  run: async ({ axis, standard = 'metric', band, length, limit = THREAD_POINTS, profile = false }) => {
    if (!useStore.getState().fileName) throw new CommandError('no_scan', 'There is no scan to read a thread off.')
    const worker = commandHost().session.clientRef.current
    if (!worker) throw new CommandError('unavailable', 'The mesh worker is not running.')
    let origin: Vec3, dir: Vec3, radius: number, span: number
    let on: Json = {}
    if (axis.kind === 'element') {
      const e = useStore.getState().elements.find((x) => x.id === axis.id)
      if (!e) throw new CommandError('not_found', `There is no element ${axis.id}.`)
      if (e.fit?.kind !== 'cylinder') invalid(`${e.name} is a ${e.kind} — a thread is read along a cylinder fitted in the bore or on the boss.`)
      const fit = e.fit as { center: Vec3; axis: Vec3; radius: number; length: number }
      origin = fit.center
      dir = fit.axis
      radius = fit.radius
      span = fit.length
      on = { element: { id: e.id, name: e.name } }
    } else if (axis.kind === 'face') {
      const s = await ready()
      const body = bodyNamed(axis.body as Ref)
      const pickErrors = validate(facePick, axis.face, 'input.axis.face')
      if (pickErrors.length > 0) invalid(pickErrors.join('; '))
      const face = facePicked(s, body, axis.face as FacePickIn)
      const fp = face.fingerprint
      if (fp.kind !== 'cylinder' || !fp.center || !fp.radius) invalid(`That face of ${body.name} is a ${fp.kind} — a thread is read along a round face.`)
      // Along the face's coaxial run, not the one face: a hole cut in
      // pieces, its countersink and a modelled thread's flanks are one wall
      // to the scan, and a piece a millimetre long holds no pitch.
      const d = normalize(fp.dir)!
      const t = topologyOf(s, body)
      const run = coaxialRun(t, face, fp.center!, d, fp.radius!, band ?? Math.max(THREAD_BAND_MM, THREAD_BAND_SHARE * fp.radius!))
      origin = addScaled(fp.center!, d, (run.from + run.to) / 2)
      dir = d
      radius = fp.radius!
      span = run.to - run.from
      on = { body: { id: body.id, name: body.name }, face: { index: t.faces.indexOf(face), kind: fp.kind, diameter: round4(2 * fp.radius!), length: roundFaceLength(fp) }, ...(run.faces.length > 1 ? { run: { faces: run.faces, length: round3(span) } } : {}) }
    } else {
      origin = axis.origin as Vec3
      dir = axis.dir as Vec3
      radius = axis.radius as number
      span = axis.length as number
    }
    const d = normalize(dir)
    if (!d) invalid('The axis has no direction.')
    const halfLength = (length ?? span) / 2
    const reach = radius + (band ?? Math.max(THREAD_BAND_MM, THREAD_BAND_SHARE * radius))
    const min: Vec3 = [0, 1, 2].map((k) => origin[k] - Math.abs(d![k]) * halfLength - reach) as Vec3
    const max: Vec3 = [0, 1, 2].map((k) => origin[k] + Math.abs(d![k]) * halfLength + reach) as Vec3
    const q = await worker.query({ min, max, limit })
    const used = band ?? Math.max(THREAD_BAND_MM, THREAD_BAND_SHARE * radius)
    const reading = readThread({ points: q.positions, normals: q.normals, origin, dir: d!, radius, band: used, halfLength })
    if (!reading) throw new CommandError('failed', `Too few scan points lie within ${round3(used)} mm of radius ${round3(radius)} along the axis (${q.matched} in the box about it) — check the axis and the radius, or widen band.`)
    const standards = standard === 'any' ? ALL_STANDARDS : [standard]
    const thread = isThread(reading)
    const { profile: radii, ...read } = reading
    // A repeat that stands within the scan's noise suggests no size.
    const { candidates, suggested } = thread ? matchThread(reading, standards) : { candidates: [], suggested: null }
    const feature =
      suggested && axis.kind === 'face'
        ? {
            kind: 'thread',
            body: (on.body as { name: string }).name,
            face: axis.face,
            standard: suggested.standard,
            size: suggested.size,
            ...(suggested.pitch !== threadSizes(suggested.standard).find((z) => z.label === suggested.size)?.pitches[0] ? { pitch: suggested.pitch } : {}),
            ...(reading.leftHanded && reading.handConfidence >= LEFT_SURE ? { leftHanded: true } : {}),
            chamfer: true,
          }
        : undefined
    return {
      axis: { origin: origin.map(round4), dir: d!.map(round4), radius: round4(radius), length: round4(2 * halfLength) },
      ...on,
      band: round3(used),
      inBox: q.matched,
      thread,
      ...read,
      // The depth of the suggested size's form; with none, of the form
      // asked for — the 60° one for any.
      ...(reading.pitch !== null ? { basicDepth: basicDepth(reading.pitch, suggested?.standard ?? (standard === 'any' ? 'metric' : standard)) } : {}),
      standards,
      candidates,
      suggested,
      ...(feature ? { feature } : {}),
      ...(profile ? { profile: radii } : {}),
      note: thread
        ? `The profile repeats every ${reading.pitch} mm (strength ${reading.strength}${agreeIn(reading)}), teeth ${reading.contrast} mm against the scan's noise of ${reading.noise} mm; ${suggested ? `nearest ${suggested.designation} (pitch off ${Math.round(suggested.pitchOff * 100)} %, diameter off ${Math.round(suggested.diameterOff * 100)} %)` : 'no standard size near enough to suggest — see candidates'}. A scan reads a thread shallower than the basic profile cuts it.`
        : reading.pitch !== null
          ? `The radius repeats every ${reading.pitch} mm${agreeIn(reading)}, but by ${reading.contrast} mm — within the scan's noise of ${reading.noise} mm (a thread's teeth stand at least three times it): the scan's own ripple on a plain ${reading.internal === true ? 'bore' : reading.internal === false ? 'boss' : 'round'}, not a thread.`
          : `The radius does not repeat along the axis (strength ${reading.strength}) — a plain ${reading.internal === true ? 'bore' : reading.internal === false ? 'boss' : 'round'}, or a thread finer than the scan resolves.`,
    }
  },
}
