// SPDX-License-Identifier: AGPL-3.0-only
// Sections: the scan cut with a plane, for measuring in 2D.

import { canCutAlong, type SectionRef, type WorldAxis } from '../../core/section/frame'
import { projectCut } from '../../core/section/slice'
import { useDeviation } from '../../state/deviationStore'
import { useFlat } from '../../state/flatStore'
import { sectionDraftReady, useStore, type Section } from '../../state/store'
import { commandHost } from '../host'
import { elementRefSchema, findElement, requireScan, type ElementRef } from '../refs'
import { arr, enumOf, int, num, obj, oneOf, str, vec3 } from '../schema'
import { describeSection } from '../state'
import { CommandError, type Command } from '../types'
import { sectionLayers, type SectionOutline, type SectionPiece, type SectionSheet } from '../sectionLayers'
import { orthoBasis } from '../../core/fit/linalg'
import { EDGE_MIN_FEATURE_MM } from '../../core/flat/edges'
import type { Vec3 } from '../../core/types'
import { normalize } from '../../core/vec'
import { requireMeasureFree, showWorkspace, waitFor } from './common'
import { round4 } from '../../core/round'

/** A coordinate plane by name, as the axis it is square to. */
export function worldAxisOf(name: string): WorldAxis | null {
  const key = name.trim().toUpperCase().replace(/\s*PLANE$/, '')
  return key === 'XY' ? 'z' : key === 'YZ' ? 'x' : key === 'ZX' || key === 'XZ' ? 'y' : null
}

const cut: Command<{ across: ElementRef; offset?: number; name?: string }> = {
  name: 'cut',
  title: 'Cut a section',
  description:
    'Cut the scan with a plane and keep the cut as a section, measured in the 2D workspace (flat) — where it is put on the sheet. across is what the plane is taken across: an element with a direction (a plane, cylinder, cone, line or circle) by id or name, or a coordinate plane "XY", "YZ" or "ZX", which is laid through the part’s centre. offset slides the plane along its normal, mm — from the element, or for a coordinate plane the coordinate itself. Returns the section: its plane and how many chains the cut has. One undo step.',
  input: obj(
    {
      across: elementRefSchema('An element with a direction, or a coordinate plane "XY", "YZ", "ZX".'),
      offset: num('Where along the normal the plane lies, mm.'),
      name: str('A name for it; otherwise it is numbered — "Section 2".', { minLength: 1 }),
    },
    ['across'],
  ),
  label: () => 'cut section',
  run: async ({ across, offset, name }) => {
    requireScan()
    requireMeasureFree()
    let ref: SectionRef
    const world = typeof across === 'string' ? worldAxisOf(across) : null
    if (world) ref = world
    else {
      const el = findElement(across)
      if (!el.fit || !canCutAlong(el.kind)) {
        throw new CommandError('invalid_input', `${el.name} has no direction to cut across — choose a plane, cylinder, cone, line or circle.`)
      }
      ref = el.id
    }
    showWorkspace('elements')
    const sections = commandHost().session.sections
    try {
      useStore.getState().startSection()
      useStore.getState().setSectionDraftRef(ref)
      if (!useStore.getState().sectionDraft?.axis) throw new CommandError('invalid_input', 'That cannot be cut across.')
      if (offset !== undefined) useStore.getState().setSectionDraftOffset(offset)
      await sections.pumpDraft()
      const d = useStore.getState().sectionDraft
      if (!sectionDraftReady(d)) {
        throw new CommandError('failed', d?.message ?? 'The plane misses the scan — there is nothing to cut there.')
      }
      const id = useStore.getState().commitSection()
      if (id === null) throw new CommandError('failed', 'The section could not be made.')
      // What Create does: the new section goes on the 2D sheet.
      useFlat.getState().setSubject({ kind: 'section', id })
      if (name) {
        // Renamed as its row's edit box does it: re-opened on its own plane,
        // which may want its cut taken again before it saves.
        useStore.getState().editSection(id)
        useStore.getState().setSectionDraftName(name)
        await sections.pumpDraft()
        if (useStore.getState().commitSection() === null) throw new CommandError('failed', 'The section could not be renamed.')
      }
      return { section: describeSection(useStore.getState().sections.find((x) => x.id === id)!) }
    } finally {
      if (useStore.getState().sectionDraft) useStore.getState().cancelSection()
    }
  },
}

/** The section an id or a name stands for — whole names, case aside; a
 *  name two sections share is refused rather than guessed. */
export function findSection(ref: number | string): Section {
  const { sections } = useStore.getState()
  if (typeof ref === 'number') {
    const sec = sections.find((x) => x.id === ref)
    if (!sec) throw new CommandError('not_found', `There is no section ${ref} — there are ${sections.map((x) => `${x.id} (${x.name})`).join(', ') || 'none'}.`)
    return sec
  }
  const want = ref.trim().toLowerCase()
  const hits = sections.filter((x) => x.name.trim().toLowerCase() === want)
  if (hits.length === 0) throw new CommandError('not_found', `There is no section named "${ref}" — there are ${sections.map((x) => `"${x.name}"`).join(', ') || 'none'}.`)
  if (hits.length > 1) throw new CommandError('invalid_input', `${hits.length} sections are named "${ref}" — name it by its id.`)
  return hits[0]
}

/** How many points a section's answer holds unless told otherwise, and at
 *  most — past it every k-th point of each chain is kept. */
const GET_LIMIT = 4000
const GET_MAX = 50_000

const get: Command<{ section: number | string; chains?: number[]; space?: 'sheet' | 'world' | 'both'; limit?: number }> = {
  name: 'get',
  title: 'Read a section’s polylines',
  description:
    'A section’s cut as the polylines it is: each chain’s points in order, as the 2D sheet lays them flat — [u, v] millimetres in the section’s plane, what flat.fit and a sketch on the section take — and, with space "world" or "both", as [x, y, z] in the frame the part is measured in now. With them the plane (origin, normal, basisU, basisV: a sheet point is origin + u·basisU + v·basisV), and for each chain whether it is closed (a loop; its first point is repeated at the end), its length along the path, how many points it has and the box round it on the sheet. At most limit points come back over all the chains (4000 by default, 50000 at most): past it every k-th point of a chain is kept, its ends always, and step says which k. chains picks chains by their index. Changes nothing.',
  input: obj(
    {
      section: oneOf([int('The section’s id.', { minimum: 1 }), str('The section’s name, as the list shows it — "Section 1".', { minLength: 1 })], 'The section, by id or name.'),
      chains: arr(int('A chain’s index.', { minimum: 0 }), 'Which chains; every one when left out.', { minItems: 1 }),
      space: enumOf(['sheet', 'world', 'both'], 'sheet (the default): [u, v] on the section’s plane; world: [x, y, z]; both.'),
      limit: int(`How many points at most, over every chain asked for; ${GET_LIMIT} by default, ${GET_MAX} at most.`, { minimum: 2, maximum: GET_MAX }),
    },
    ['section'],
  ),
  readOnly: true,
  run: async ({ section, chains: which, space = 'sheet', limit = GET_LIMIT }) => {
    requireScan()
    const id = findSection(section).id
    // A section loaded from a project, or whose plane was just moved, is cut
    // again by the worker a moment later: wait for the cut.
    const sec = await waitFor(() => {
      const s = useStore.getState().sections.find((x) => x.id === id)
      return s?.cut || s?.message ? s : null
    }, 'the section to be cut', 60_000)
    if (!sec.cut) throw new CommandError('failed', sec.message ?? 'The section has no cut.')
    const cut = sec.cut
    const flat = projectCut(cut, sec.frame)
    const count = cut.offsets.length - 1
    const picked = which ?? Array.from({ length: count }, (_, i) => i)
    for (const c of picked) if (c >= count) throw new CommandError('not_found', `${sec.name} has no chain ${c} — it has ${count}${count > 0 ? ` (0 to ${count - 1})` : ''}.`)
    const total = picked.reduce((n, c) => n + (cut.offsets[c + 1] - cut.offsets[c]), 0)
    const step = total > limit ? Math.ceil(total / limit) : 1
    const chains = picked.map((c) => {
      const from = cut.offsets[c]
      const to = cut.offsets[c + 1]
      const n = to - from
      let length = 0
      let lo: [number, number] = [Infinity, Infinity]
      let hi: [number, number] = [-Infinity, -Infinity]
      for (let i = from; i < to; i++) {
        const u = flat.points[i * 2]
        const v = flat.points[i * 2 + 1]
        lo = [Math.min(lo[0], u), Math.min(lo[1], v)]
        hi = [Math.max(hi[0], u), Math.max(hi[1], v)]
        if (i > from) length += Math.hypot(cut.points[i * 3] - cut.points[i * 3 - 3], cut.points[i * 3 + 1] - cut.points[i * 3 - 2], cut.points[i * 3 + 2] - cut.points[i * 3 - 1])
      }
      const closed = n > 2 && cut.points[from * 3] === cut.points[(to - 1) * 3] && cut.points[from * 3 + 1] === cut.points[(to - 1) * 3 + 1] && cut.points[from * 3 + 2] === cut.points[(to - 1) * 3 + 2]
      const kept: number[] = []
      for (let i = from; i < to; i += step) kept.push(i)
      if (kept[kept.length - 1] !== to - 1) kept.push(to - 1)
      return {
        index: c,
        closed,
        points: n,
        kept: kept.length,
        length: round4(length),
        bounds: { min: [round4(lo[0]), round4(lo[1])], max: [round4(hi[0]), round4(hi[1])] },
        ...(space !== 'world' ? { sheet: kept.map((i) => [round4(flat.points[i * 2]), round4(flat.points[i * 2 + 1])]) } : {}),
        ...(space !== 'sheet' ? { world: kept.map((i) => [round4(cut.points[i * 3]), round4(cut.points[i * 3 + 1]), round4(cut.points[i * 3 + 2])]) } : {}),
      }
    })
    return {
      section: describeSection(sec),
      plane: { origin: sec.frame.origin, normal: sec.frame.normal, basisU: sec.frame.basisU, basisV: sec.frame.basisV },
      step,
      chains,
    }
  },
}

/** The picture's side when neither width nor height is given, as the
 *  other pictures. */
const RENDER_SIDE = 800

/** A picture of a sheet of the scan: the layers drawn on it, the scan's
 *  cut read against their outlines — section.render's, and a workspace's
 *  own picture of a plane it chooses, such as one across a feature.
 *  `flat` is the scan's cut as [u, v] pairs on the sheet. */
export async function pictureOfSheet(
  sheet: SectionSheet,
  flat: Float32Array,
  options: { frame?: { at: [number, number]; size: number }; tolerance?: number; layers?: string[]; width?: number; height?: number; name?: string },
) {
  if (typeof OffscreenCanvas === 'undefined') throw new CommandError('unavailable', 'A picture of a section needs the browser.')
  const all = sectionLayers()
  const keys = options.layers
  for (const k of keys ?? []) if (!all.some((l) => l.key === k)) throw new CommandError('not_found', `There is no layer "${k}" — ${all.length > 0 ? `there are ${all.map((l) => `"${l.key}"`).join(', ')}` : 'this build has none'}.`)
  const chosen = keys ? all.filter((l) => keys.includes(l.key)) : all
  const outlines: SectionOutline[] = []
  const pieces: SectionPiece[] = []
  const counted: { key: string; outlines: number; pieces: number }[] = []
  for (const layer of chosen) {
    const drawn = await layer.draw(sheet)
    outlines.push(...(drawn?.outlines ?? []))
    pieces.push(...(drawn?.pieces ?? []))
    counted.push({ key: layer.key, outlines: drawn?.outlines?.length ?? 0, pieces: drawn?.pieces?.length ?? 0 })
  }
  const tol = options.tolerance ?? useDeviation.getState().tolerance
  const { sectionPicturePng } = await import('../../app/sectionPicture')
  const { bytes, model } = await sectionPicturePng(
    { scan: flat, outlines, pieces, tolerance: tol, ...(options.frame ? { frame: options.frame } : {}), width: options.width ?? (options.height ? undefined : RENDER_SIDE), height: options.height },
    options.name ?? sheet.name,
  )
  const g = model.gap
  return {
    file: { name: `${(options.name ?? sheet.name).replace(/[^\w.-]+/g, '-')}.png`, mimeType: 'image/png', bytes },
    width: model.frame.width,
    height: model.frame.height,
    map: { left: model.frame.left, top: model.frame.top, unitsPerPx: model.frame.unitsPerPx },
    tolerance: tol,
    gap: { points: g.points, read: g.read, over: g.over, outside: g.outside, inside: g.inside, max: round4(g.max), rms: round4(g.rms), overBox: g.overBox ? { min: g.overBox.min.map(round4), max: g.overBox.max.map(round4) } : null },
    layers: counted,
  }
}

/** The scan cut by a plane through `origin` square to `normal`, laid on a
 *  sheet of its own (+u, +v any pair square to the normal, u × v = normal),
 *  for a picture of a plane no section stands on. */
export async function sheetThrough(origin: Vec3, normal: Vec3, name: string): Promise<{ sheet: SectionSheet; flat: Float32Array }> {
  requireScan()
  const n = normalize(normal)
  if (!n) throw new CommandError('invalid_input', 'plane.normal: give a direction, not a zero vector.')
  const worker = commandHost().session.clientRef.current
  if (!worker) throw new CommandError('unavailable', 'The mesh worker is not running.')
  const [basisU, basisV] = orthoBasis(n)
  const frame = { origin, normal: n, basisU, basisV }
  const cut = await worker.section(origin, n, EDGE_MIN_FEATURE_MM)
  return { sheet: { id: 0, name, ...frame }, flat: projectCut(cut, frame).points }
}

const render: Command<{ section?: number | string; plane?: { origin: Vec3; normal: Vec3 }; frame?: { at: [number, number]; size: number }; tolerance?: number; layers?: string[]; width?: number; height?: number }> = {
  name: 'render',
  title: 'Picture a section',
  description:
    'A picture of a section as a PNG, for checking a slice against what was built on it: the scan’s cut as points on the section’s sheet ([u, v] mm as section.get gives them, +u right, +v up), a grid ruled in millimetres with its values at the top and left margins, a scale bar, and over it what the workspaces’ layers draw — a model’s cut by the section’s plane as outlines, a sketch’s pieces on the section with their ids. Every scan point within ten tolerances of an outline is read against it: on it within ± tolerance (grey), or off it (red), outside the outline or inside it; points with no outline near are pale. The answer gives gap: points (the cut’s), read, over (red), outside and inside (of a closed outline — inside is scan within the model’s material, so the model stands proud there; outside, the model is short), max and rms (mm) and overBox (the sheet box round the red, to frame the next look); layers: each layer drawn by key, its outlines and pieces counted; map: picture pixel (column c, row r from the top) is the sheet place [left + c·unitsPerPx, top − r·unitsPerPx]. section names a section; or plane { origin, normal } cuts the scan there for the picture alone — no section is made, the sheet’s u and v any pair square to the normal (the answer’s sheet gives them). frame { at: [u, v], size } looks at a square of the sheet; everything by default. tolerance: the Deviation workspace’s by default. layers: the keys to draw; every one by default, [] for the scan alone. 800 px on the long side by default, up to 2048. Needs the browser. Changes nothing.',
  input: obj({
    section: oneOf([int('The section’s id.', { minimum: 1 }), str('The section’s name — "Section 1".', { minLength: 1 })], 'The section, by id or name.'),
    plane: obj({ origin: vec3('A point on the plane, mm.'), normal: vec3('Its normal.') }, ['origin', 'normal'], 'A plane to cut the scan by for the picture alone, in place of a section.'),
    frame: obj({ at: arr(num(), 'The sheet place in the middle, [u, v] mm.', { minItems: 2, maxItems: 2 }), size: num('The side of the square looked at, mm.', { exclusiveMinimum: 0 }) }, ['at', 'size'], 'Look at a square of the sheet.'),
    tolerance: num('± mm a scan point may lie off the outlines and still be on them.', { exclusiveMinimum: 0 }),
    layers: arr(str(undefined, { minLength: 1 }), 'The layers to draw, by key; every one by default.'),
    width: int('Pixels across, 64 to 2048.', { minimum: 64, maximum: 2048 }),
    height: int('Pixels down, 64 to 2048.', { minimum: 64, maximum: 2048 }),
  }),
  readOnly: true,
  returnsFile: true,
  returnsImage: true,
  run: async ({ section, plane, frame, tolerance, layers, width, height }) => {
    if (typeof OffscreenCanvas === 'undefined') throw new CommandError('unavailable', 'A picture of a section needs the browser.')
    if ((section === undefined) === (plane === undefined)) throw new CommandError('invalid_input', 'Give section, or plane — one of them.')
    requireScan()
    let sheet: SectionSheet
    let flat: Float32Array
    if (plane) {
      ;({ sheet, flat } = await sheetThrough(plane.origin, plane.normal, 'Cut'))
    } else {
      const id = findSection(section!).id
      const sec = await waitFor(() => {
        const s = useStore.getState().sections.find((x) => x.id === id)
        return s?.cut || s?.message ? s : null
      }, 'the section to be cut', 60_000)
      if (!sec.cut) throw new CommandError('failed', sec.message ?? 'The section has no cut.')
      sheet = { id: sec.id, name: sec.name, origin: sec.frame.origin, normal: sec.frame.normal, basisU: sec.frame.basisU, basisV: sec.frame.basisV }
      flat = projectCut(sec.cut, sec.frame).points
    }
    const picture = await pictureOfSheet(sheet, flat, { ...(frame ? { frame } : {}), ...(tolerance !== undefined ? { tolerance } : {}), ...(layers ? { layers } : {}), width, height })
    return {
      ...picture,
      ...(plane ? { sheet: { origin: sheet.origin.map(round4), normal: sheet.normal.map(round4), basisU: sheet.basisU.map(round4), basisV: sheet.basisV.map(round4) } } : { section: { id: sheet.id, name: sheet.name } }),
    }
  },
}

export const sectionCommands = [cut, get, render]
