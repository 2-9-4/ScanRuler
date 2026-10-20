// SPDX-License-Identifier: AGPL-3.0-only
// Sections: the scan cut with a plane, for measuring in 2D.

import { canCutAlong, type SectionRef, sketchFrameOn, type WorldAxis } from '../../core/section/frame'
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
import { EDGE_MIN_FEATURE_MM } from '../../core/flat/edges'
import type { Vec3 } from '../../core/types'
import { requireMeasureFree, showWorkspace, waitFor } from './common'
import { round4 } from '../../core/round'
import type { SectionPictureInput, SectionPictureModel, SheetAxis } from '../../app/sectionPicture'

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
  const { input, counted, tol, axes } = await sheetDrawing(sheet, flat, options)
  const { sectionPicturePng } = await import('../../app/sectionPicture')
  const { bytes, model } = await sectionPicturePng(
    { ...input, width: options.width ?? (options.height ? undefined : RENDER_SIDE), height: options.height },
    options.name ?? sheet.name,
  )
  return {
    file: { name: `${(options.name ?? sheet.name).replace(/[^\w.-]+/g, '-')}.png`, mimeType: 'image/png', bytes },
    width: model.frame.width,
    height: model.frame.height,
    map: { left: model.frame.left, top: model.frame.top, unitsPerPx: model.frame.unitsPerPx },
    tolerance: tol,
    axes,
    gap: gapJson(model.gap),
    layers: counted,
  }
}

/** A picture's gap reading, rounded for the answer. */
const gapJson = (g: SectionPictureModel['gap']) => ({ points: g.points, read: g.read, over: g.over, outside: g.outside, inside: g.inside, max: round4(g.max), rms: round4(g.rms), overBox: g.overBox ? { min: g.overBox.min.map(round4), max: g.overBox.max.map(round4) } : null })

/** What a sheet's picture is drawn from: the scan's cut, what the chosen
 *  layers draw on the sheet, the tolerance and the sheet's world axes. */
async function sheetDrawing(
  sheet: SectionSheet,
  flat: Float32Array,
  options: { frame?: { at: [number, number]; size: number }; tolerance?: number; layers?: string[] },
): Promise<{ input: SectionPictureInput; counted: { key: string; outlines: number; pieces: number }[]; tol: number; axes: { u: SheetAxis; v: SheetAxis } }> {
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
  const { sheetAxes } = await import('../../app/sectionPicture')
  const axes = sheetAxes(sheet.origin, sheet.basisU, sheet.basisV)
  return { input: { scan: flat, outlines, pieces, tolerance: tol, axes, ...(options.frame ? { frame: options.frame } : {}) }, counted, tol, axes }
}

/** The most cuts one picture of parallel sections holds, and its width
 *  unless told. */
const OFFSETS_MAX = 9
const SHEET_WIDTH = 1200
const SHEET_MAX = 2048

/** Parallel cuts as one picture: each sheet the base one slid along its
 *  normal by an offset, every tile framed on the same square of the sheet
 *  (the box round all the cuts, or the frame asked for) at the same scale,
 *  so a step from one to the next reads off the grid. Layers draw on each
 *  sheet. */
async function pictureOfOffsets(
  base: SectionSheet,
  offsets: number[],
  options: { frame?: { at: [number, number]; size: number }; tolerance?: number; layers?: string[]; width?: number; height?: number },
) {
  const worker = commandHost().session.clientRef.current
  if (!worker) throw new CommandError('unavailable', 'The mesh worker is not running.')
  const n = base.normal
  const nl = Math.hypot(n[0], n[1], n[2])
  const drawn: { offset: number; sheet: SectionSheet; drawing: Awaited<ReturnType<typeof sheetDrawing>> }[] = []
  for (const offset of offsets) {
    const origin: Vec3 = [base.origin[0] + (n[0] / nl) * offset, base.origin[1] + (n[1] / nl) * offset, base.origin[2] + (n[2] / nl) * offset]
    const sheet: SectionSheet = { ...base, origin }
    const cut = await worker.section(origin, base.normal, EDGE_MIN_FEATURE_MM)
    drawn.push({ offset, sheet, drawing: await sheetDrawing(sheet, projectCut(cut, sheet).points, options) })
  }
  // One frame for all: the square round every cut and outline.
  let frame = options.frame
  if (!frame) {
    let lo = [Infinity, Infinity]
    let hi = [-Infinity, -Infinity]
    const take = (u: number, v: number) => {
      lo = [Math.min(lo[0], u), Math.min(lo[1], v)]
      hi = [Math.max(hi[0], u), Math.max(hi[1], v)]
    }
    for (const d of drawn) {
      const s = d.drawing.input.scan
      for (let i = 0; i + 1 < s.length; i += 2) take(s[i], s[i + 1])
      for (const o of d.drawing.input.outlines) for (const q of o.points) take(q[0], q[1])
    }
    if (!Number.isFinite(lo[0])) throw new CommandError('failed', 'None of the planes cuts the scan.')
    const size = 1.12 * Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
    frame = { at: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2], size }
  }
  const cols = [0, 1, 2, 3, 2, 3, 3, 4, 4, 3][offsets.length]
  const rows = Math.ceil(offsets.length / cols)
  const W = Math.min(SHEET_MAX, options.width ?? (options.height ? Math.round((options.height / rows) * cols) : SHEET_WIDTH))
  const H = Math.min(SHEET_MAX, options.height ?? Math.round((W / cols) * rows))
  const side = Math.max(64, Math.min(Math.floor(W / cols), Math.floor(H / rows)))
  const { sectionSheetsPng } = await import('../../app/sectionPicture')
  const { bytes, models, width, height } = await sectionSheetsPng(
    drawn.map((d) => {
      // On a coordinate plane the tile says where it lies in the world too.
      const k = [0, 1, 2].find((i) => Math.abs(n[i] / nl) > 1 - 1e-9)
      const world = k === undefined ? '' : ` (${'XYZ'[k]} ${round4(d.sheet.origin[k])})`
      return { input: { ...d.drawing.input, frame: frame!, width: side, height: side }, title: `offset ${d.offset} mm${world}` }
    }),
    cols,
  )
  const m = models[0].frame
  return {
    file: { name: `${base.name.replace(/[^\w.-]+/g, '-')}-offsets.png`, mimeType: 'image/png', bytes },
    width,
    height,
    map: { left: m.left, top: m.top, unitsPerPx: m.unitsPerPx, tile: [m.width, m.height], cols },
    tolerance: drawn[0].drawing.tol,
    axes: drawn[0].drawing.axes,
    tiles: drawn.map((d, i) => ({
      offset: d.offset,
      origin: d.sheet.origin.map(round4),
      gap: gapJson(models[i].gap),
      ...(d.drawing.counted.some((c) => c.outlines || c.pieces) ? { layers: d.drawing.counted } : {}),
    })),
  }
}

/** The scan cut by a plane through `origin` square to `normal`, laid on a
 *  sheet as a sketch on that plane has it (sketchFrameOn): its zero the
 *  world origin's foot, +u the coordinate axis next round from the normal
 *  — so on a coordinate plane [u, v] are world coordinates — for a picture
 *  of a plane no section stands on. */
export async function sheetThrough(origin: Vec3, normal: Vec3, name: string): Promise<{ sheet: SectionSheet; flat: Float32Array }> {
  requireScan()
  const frame = sketchFrameOn({ origin, normal })
  if (!frame) throw new CommandError('invalid_input', 'plane.normal: give a direction, not a zero vector.')
  const worker = commandHost().session.clientRef.current
  if (!worker) throw new CommandError('unavailable', 'The mesh worker is not running.')
  const cut = await worker.section(origin, frame.normal, EDGE_MIN_FEATURE_MM)
  return { sheet: { id: 0, name, ...frame }, flat: projectCut(cut, frame).points }
}

const render: Command<{ section?: number | string; plane?: { origin: Vec3; normal: Vec3 }; offsets?: number[]; frame?: { at: [number, number]; size: number }; tolerance?: number; layers?: string[]; width?: number; height?: number }> = {
  name: 'render',
  title: 'Picture a section',
  description:
    'A picture of a section as a PNG, for checking a slice against what was built on it: the scan’s cut as points on the section’s sheet ([u, v] mm as section.get gives them, +u right, +v up), a grid ruled in millimetres with its values at the top and left margins — world coordinates where the sheet’s u or v runs along a world axis, sheet mm otherwise — the world direction across and up named in the margins (axes in the answer: per sheet axis the world axis it runs nearest, offDeg and, along it, at0, the world coordinate at the sheet’s 0), a scale bar, and over it what the workspaces’ layers draw — a model’s cut by the section’s plane as outlines, a sketch’s pieces on the section with their ids. Every scan point within ten tolerances of an outline is read against it: on it within ± tolerance (grey), or off it (red), outside the outline or inside it; points with no outline near are pale. The answer gives gap: points (the cut’s), read, over (red), outside and inside (of a closed outline — inside is scan within the model’s material, so the model stands proud there; outside, the model is short), max and rms (mm) and overBox (the sheet box round the red, to frame the next look); layers: each layer drawn by key, its outlines and pieces counted; map: picture pixel (column c, row r from the top) is the sheet place [left + c·unitsPerPx, top − r·unitsPerPx]. section names a section; or plane { origin, normal } cuts the scan there for the picture alone — no section is made, and the sheet is a sketch’s on that plane: zero at the world origin’s foot, u along the coordinate axis next round from the normal (YZ: u = Y, v = Z; ZX: u = Z, v = X; XY: u = X, v = Y), so on a coordinate plane [u, v] are world coordinates (the answer’s sheet gives them). A section’s own sheet counts from the part’s centre instead. offsets: 2 to 9 cuts in one picture — the section’s or plane’s slid along its normal by each, mm — side by side, each tile labelled with its offset, all on one frame and scale (the square round every cut unless frame is given); the answer gives per tile its offset, origin and gap, and map.tile and map.cols (map holds for each tile from its own corner). frame { at: [u, v], size } looks at a square of the sheet; everything by default. tolerance: the Deviation workspace’s by default. layers: the keys to draw; every one by default, [] for the scan alone. 800 px on the long side by default, up to 2048. Needs the browser. Changes nothing.',
  input: obj({
    section: oneOf([int('The section’s id.', { minimum: 1 }), str('The section’s name — "Section 1".', { minLength: 1 })], 'The section, by id or name.'),
    plane: obj({ origin: vec3('A point on the plane, mm.'), normal: vec3('Its normal.') }, ['origin', 'normal'], 'A plane to cut the scan by for the picture alone, in place of a section.'),
    offsets: arr(num(), 'Several parallel cuts in one picture: mm along the normal from the section or plane.', { minItems: 2, maxItems: OFFSETS_MAX }),
    frame: obj({ at: arr(num(), 'The sheet place in the middle, [u, v] mm.', { minItems: 2, maxItems: 2 }), size: num('The side of the square looked at, mm.', { exclusiveMinimum: 0 }) }, ['at', 'size'], 'Look at a square of the sheet.'),
    tolerance: num('± mm a scan point may lie off the outlines and still be on them.', { exclusiveMinimum: 0 }),
    layers: arr(str(undefined, { minLength: 1 }), 'The layers to draw, by key; every one by default.'),
    width: int('Pixels across, 64 to 2048.', { minimum: 64, maximum: 2048 }),
    height: int('Pixels down, 64 to 2048.', { minimum: 64, maximum: 2048 }),
  }),
  readOnly: true,
  returnsFile: true,
  returnsImage: true,
  run: async ({ section, plane, offsets, frame, tolerance, layers, width, height }) => {
    if (typeof OffscreenCanvas === 'undefined') throw new CommandError('unavailable', 'A picture of a section needs the browser.')
    if ((section === undefined) === (plane === undefined)) throw new CommandError('invalid_input', 'Give section, or plane — one of them.')
    requireScan()
    if (offsets) {
      let base: SectionSheet
      if (plane) {
        const f = sketchFrameOn({ origin: plane.origin, normal: plane.normal })
        if (!f) throw new CommandError('invalid_input', 'plane.normal: give a direction, not a zero vector.')
        base = { id: 0, name: 'Cut', ...f }
      } else {
        const sec = findSection(section!)
        base = { id: sec.id, name: sec.name, origin: sec.frame.origin, normal: sec.frame.normal, basisU: sec.frame.basisU, basisV: sec.frame.basisV }
      }
      const picture = await pictureOfOffsets(base, offsets, { ...(frame ? { frame } : {}), ...(tolerance !== undefined ? { tolerance } : {}), ...(layers ? { layers } : {}), width, height })
      return {
        ...picture,
        ...(plane ? { sheet: { normal: base.normal.map(round4), basisU: base.basisU.map(round4), basisV: base.basisV.map(round4) } } : { section: { id: base.id, name: base.name } }),
      }
    }
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
