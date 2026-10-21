// SPDX-License-Identifier: AGPL-3.0-only
// The viewport: which way the part is looked at, what is shown in it, and a
// picture of it — how an agent that cannot see the screen sees what is on
// it, and sees the model on its own when the scan over it is in the way.
// Neither changes the session: the camera and what is shown are no part of
// a project and no step of the history. Both need the viewport, and wait
// for the session to settle and the viewport to draw it first — what a
// workspace puts on the stage follows its stores a frame or two behind.

import { exportStem } from '../../app/exports'
import { round4 } from '../../core/round'
import { canCutAlong, isWorldAxis, tiltOf, worldPlaneName, type SectionRef } from '../../core/section/frame'
import type { Vec3 } from '../../core/types'
import { useDeviation } from '../../state/deviationStore'
import { usePrefs } from '../../state/prefsStore'
import { sectionViewFrames, useSectionView } from '../../state/sectionViewStore'
import { useShell } from '../../state/shellStore'
import { useStore } from '../../state/store'
import type { StandardView } from '../../viewer/orthoViewport'
import type { SceneManager } from '../../viewer/SceneManager'
import { requireScene, sceneOf, sessionBusy } from '../host'
import { elementRefSchema, findElement, type ElementRef } from '../refs'
import { arr, bool, enumOf, int, num, obj, oneOf, vec3, type JsonSchema } from '../schema'
import { CommandError, type Command } from '../types'
import { pluginToggleKeys, viewToggles, type ViewToggle } from '../viewToggles'
import { nextFrame, waitFor } from './common'
import { worldAxisOf } from './section'

const VIEWS: readonly StandardView[] = ['iso', 'top', 'bottom', 'front', 'rear', 'left', 'right']

/** The longest side of a picture, pixels, when none is asked for: enough
 *  to check a step by. An agent pays for a picture by its pixels — one
 *  1280 across costs it two and a half of these — so a larger one is for
 *  a picture to keep, and asked for. */
const DEFAULT_LONG_SIDE = 800
const MAX_SIDE = 2048

const viewSchema = enumOf(
  VIEWS,
  'A standard view, the camera turned about the middle of the screen: iso (from the front, right and above), top (down the Z axis, Y up the screen), bottom, front (from −Y, Z up), rear (from +Y), left (from −X), right (from +X).',
)
const fitSchema = bool('Bring everything shown into the frame, keeping the direction looked from.')

// ---- what is shown ----------------------------------------------------------------

/** The app's own toggles: what the scene draws of the session. The scan
 *  and the reference go through the Deviation workspace's own switches
 *  while it is on screen, so its effects do not put them straight back. */
function baseToggles(scene: SceneManager): ViewToggle[] {
  const onDeviation = () => useShell.getState().workspace === 'deviation'
  return [
    {
      key: 'scan',
      description: 'the scan',
      shown: () => (onDeviation() ? useDeviation.getState().showScan : scene.scanShown()),
      show: (on) => (onDeviation() ? useDeviation.getState().setShowScan(on) : scene.setScanVisible(on)),
    },
    {
      key: 'reference',
      description: 'the reference part of the Deviation workspace',
      shown: () => (onDeviation() ? useDeviation.getState().showNominal : scene.nominalShown()),
      show: (on) => (onDeviation() ? useDeviation.getState().setShowNominal(on) : scene.setNominalVisible(on)),
    },
    { key: 'sections', description: 'the sections cut through the scan', shown: () => scene.sectionsShown(), show: (on) => scene.setSectionsShown(on) },
    { key: 'elements', description: 'the measured elements and dimensions drawn on the part', shown: () => scene.elementsShown(), show: (on) => scene.setElementsShown(on) },
    { key: 'labels', description: 'the name tags and readouts over the part', shown: () => scene.labelsShown(), show: (on) => scene.setLabelsVisible(on) },
  ]
}

const BASE_KEYS = ['scan', 'reference', 'sections', 'elements', 'labels']

const showSchema = (): JsonSchema => ({
  type: 'object',
  description:
    'What to show or put away, by key, true or false: scan, reference (the Deviation workspace’s reference part), sections, elements (the measured elements and dimensions), labels — and the keys a workspace adds (view.set answers with every key standing now and whether it is shown). { scan: false } pictures what was built on the scan on its own.',
  properties: Object.fromEntries(BASE_KEYS.map((k) => [k, bool()])),
})

const frameSchema = oneOf(
  [
    obj({ min: vec3('The lowest corner, mm.'), max: vec3('The highest corner, mm.') }, ['min', 'max'], 'A box, in the frame the part is measured in now.'),
    obj({ at: vec3('The centre, mm.'), size: num('The width of the view there, mm.', { exclusiveMinimum: 0 }) }, ['at', 'size'], 'A place, looked at from `size` mm across.'),
  ],
  'Frame a box or a place instead of everything shown — a corner or a fillet looked at closely; fit is then left alone.',
)

type Frame = { min: Vec3; max: Vec3 } | { at: Vec3; size: number }

// ---- the section view ---------------------------------------------------------------

type SectionAsk = boolean | { across: ElementRef; offset?: number; flip?: boolean }

const sectionSchema = oneOf(
  [
    bool('true opens it as the Section key does — square to the view, through the part’s middle; false puts it away.'),
    obj(
      {
        across: elementRefSchema('A coordinate plane "XY", "YZ", "ZX", or an element with a direction.'),
        offset: num('Where along its normal, mm: for a coordinate plane the coordinate, for an element from its centre.'),
        flip: bool('Take away the half away from the camera instead.'),
      },
      ['across'],
    ),
  ],
  'The section view: everything cut open at a plane, the half toward the camera taken away, closed parts capped — to see inside. Set after any turn.',
)

/** What a section is laid across, by name: a coordinate plane or an element
 *  with a direction. */
function sectionRefOf(across: ElementRef): SectionRef {
  const world = typeof across === 'string' ? worldAxisOf(across) : null
  if (world) return world
  const el = findElement(across)
  if (!el.fit || !canCutAlong(el.kind)) {
    throw new CommandError('invalid_input', `${el.name} has no direction to cut across — choose a plane, cylinder, cone, line or circle, or "XY", "YZ", "ZX".`)
  }
  return el.id
}

/** The section view set as asked — the half toward the camera as it now
 *  looks taken away, unless flipped — and the frames the stage takes to
 *  follow. */
async function sectioned(scene: SceneManager, section: SectionAsk | undefined): Promise<void> {
  if (section === undefined) return
  const view = useSectionView.getState()
  const dir = scene.viewDirection()
  if (section === false) view.close()
  else if (section === true) {
    if (!view.on) view.open(dir, scene.stageCentre())
  } else {
    const ref = sectionRefOf(section.across)
    if (!view.on) view.open(dir, scene.stageCentre())
    view.setRef(ref, dir)
    if (section.offset !== undefined) view.setOffset(section.offset)
    if (section.flip) view.flip()
  }
  for (let i = 0; i < 3; i++) await nextFrame(scene)
}

/** The section view as it stands, for an answer: what it is laid across,
 *  where, the direction of the half taken away, and a tilt the rings gave
 *  it; null while it is off. */
export function describeSectionView(): Record<string, unknown> | null {
  const s = useSectionView.getState()
  const frames = sectionViewFrames(s)
  if (!frames) return null
  const across = isWorldAxis(s.ref) ? worldPlaneName(s.ref) : (useStore.getState().elements.find((e) => e.id === s.ref)?.name ?? null)
  const tilt = tiltOf(s.refDir, frames.gizmo.normal)
  return {
    across,
    offset: round4(s.offset),
    takenAway: frames.cut.normal.map(round4),
    ...(tilt > 0 ? { tilt: Math.round(tilt * 100) / 100 } : {}),
    ...(sceneOf()?.sliced() === false ? { cutsNothing: true } : {}),
  }
}

/** Every toggle standing now, by key. */
const toggles = (scene: SceneManager) => viewToggles(baseToggles(scene))

/** What each toggle shows now. */
const shownNow = (scene: SceneManager): Record<string, boolean> => Object.fromEntries([...toggles(scene)].map(([k, t]) => [k, t.shown()]))

/** Set the toggles as asked, refusing a key none stands under. Returns
 *  what to set to put them back. */
function applyShow(scene: SceneManager, show: Record<string, boolean> | undefined): Record<string, boolean> {
  if (!show) return {}
  const all = toggles(scene)
  const before: Record<string, boolean> = {}
  for (const [key, on] of Object.entries(show)) {
    const t = all.get(key)
    if (!t) {
      const known = [...all.keys()].join(', ')
      const elsewhere = pluginToggleKeys().find((p) => p.key === key)
      throw new CommandError('invalid_input', elsewhere ? `show.${key}: not on screen in this workspace — it is ${elsewhere.description}; the keys standing now are ${known}.` : `show.${key}: no such key — there are ${known}.`)
    }
    if (typeof on !== 'boolean') throw new CommandError('invalid_input', `show.${key}: expected true or false`)
    before[key] = t.shown()
    t.show(on)
  }
  return before
}

function aimAt(scene: SceneManager, frame: Frame | undefined): void {
  if (!frame) return
  if ('at' in frame) {
    const h = frame.size / 2
    scene.fitBox([frame.at[0] - h, frame.at[1] - h, frame.at[2] - h], [frame.at[0] + h, frame.at[1] + h, frame.at[2] + h])
  } else {
    for (let k = 0; k < 3; k++) if (!(frame.min[k] <= frame.max[k])) throw new CommandError('invalid_input', 'frame: min lies past max.')
    scene.fitBox(frame.min, frame.max)
  }
}

/** The viewport once the session has settled and the stage has caught up
 *  with the stores. */
async function settledScene(what: string): Promise<SceneManager> {
  const scene = requireScene(what)
  await waitFor(() => sessionBusy() === null, 'the session to settle', 120_000)
  for (let i = 0; i < 3; i++) await nextFrame(scene)
  return scene
}

/** Turn and fit as asked — a fit alone when nothing is, and no fit where a
 *  frame is asked for instead. */
function aim(scene: SceneManager, view: StandardView | undefined, fit: boolean | undefined, frame: Frame | undefined): void {
  if (view) scene.viewFrom(view)
  if (frame) aimAt(scene, frame)
  else if (fit ?? !view) scene.fitToView()
}

/** What the toggles were set to, then the frames the stage takes to follow
 *  — a toggle that goes through a store is drawn by the workspace's next
 *  effect, not at once. */
async function shown(scene: SceneManager, show: Record<string, boolean> | undefined): Promise<Record<string, boolean>> {
  const before = applyShow(scene, show)
  if (show) for (let i = 0; i < 3; i++) await nextFrame(scene)
  return before
}

const set: Command<{ view?: StandardView; fit?: boolean; show?: Record<string, boolean>; frame?: Frame; section?: SectionAsk }> = {
  name: 'set',
  title: 'Turn the view',
  description:
    'Turn the 3D view to a standard view and/or fit everything shown into the frame — with neither given, it fits — or frame a box or a place (frame). show puts the scan, the reference, the sections, the elements or the labels on screen or away, by key, and leaves them so — { scan: false } to look at what was built on the scan without it. section cuts everything open at a plane to look inside, and leaves it so. It waits for the session to settle first (a fit, a map, a rebuild), so what was just made is in the frame. Not a step of the history. Needs the viewport. Returns the view, the section view (null when off) and, under shown, every key that can be shown now and whether it is.',
  input: obj({ view: viewSchema, fit: fitSchema, show: showSchema(), frame: frameSchema, section: sectionSchema }),
  readOnly: true,
  run: async ({ view, fit, show, frame, section }) => {
    const scene = await settledScene('Turning the view')
    await shown(scene, show)
    aim(scene, view, fit, frame)
    await nextFrame(scene)
    await sectioned(scene, section)
    return { view: view ?? null, fitted: frame ? false : (fit ?? !view), ...(frame ? { framed: frame } : {}), size: scene.viewSize(), section: describeSectionView(), shown: shownNow(scene) }
  },
}

const render: Command<{ width?: number; height?: number; view?: StandardView; views?: StandardView[]; fit?: boolean; show?: Record<string, boolean>; frame?: Frame; section?: SectionAsk }> = {
  name: 'render',
  title: 'Picture the view',
  description:
    'A picture of the 3D view as a PNG — what the person sees in the viewport, without the HTML labels over it (dimension values, names), and lit from a little above and left of the camera with more fill than the screen, so a face square to the camera keeps its shading. Give view and/or fit to turn the view first, as view.set does, or frame to frame a box or a place. show puts the scan, the reference, the sections, the elements or the labels — or what a workspace adds — on screen or away for the picture alone, by key, and back as they were after it — { scan: false } pictures what was built on the scan on its own; view.set lists the keys. section cuts everything open for the picture alone, as view.set does. width and height in pixels: the viewport’s own shape at most 800 pixels on its long side by default, enough to check a step by — ask for more (up to 2048) for a picture to keep; one of them alone keeps the viewport’s shape. views: two to six standard views in one picture, side by side, each fitted and named in its corner — iso, top, bottom and a side as one picture to look at instead of four (width and height are then the whole sheet’s; 1200 px across by default); the view stays at the last. In the Deviation workspace the answer says which map the picture shows — map: { on: "scan" | "reference", colormap, range } — or map: null and mapWhy, why none is painted (the map switch off, no map measured, the surface it is on put away) and what puts it there. With the scan shown, a reference shown with it is drawn over it as a ghost and dulls the colours (mapNote says so): show: { reference: false } gives the clean map. Waits for the session to settle first — a map being measured, on the scan or on the reference, too. Needs the viewport.',
  input: obj({
    width: int('Pixels across, 64 to 2048.', { minimum: 64, maximum: MAX_SIDE }),
    height: int('Pixels down, 64 to 2048.', { minimum: 64, maximum: MAX_SIDE }),
    view: viewSchema,
    views: arr(viewSchema, 'Several standard views in one picture, each fitted, in this order.', { minItems: 2, maxItems: 6 }),
    fit: fitSchema,
    show: showSchema(),
    frame: frameSchema,
    section: sectionSchema,
  }),
  readOnly: true,
  returnsFile: true,
  returnsImage: true,
  run: async ({ width, height, view, views, fit, show, frame, section }) => {
    if (views && (view || frame)) throw new CommandError('invalid_input', 'Give views, or view and frame — views fits each of its own.')
    // The 3D view is not drawn while the 2D sheet has the screen: a picture
    // of it would be an empty frame, which says nothing and looks like an
    // answer.
    if (useShell.getState().workspace === 'flat') {
      throw new CommandError('invalid_state', 'The 2D workspace is on screen, where the 3D view is not drawn — flat.render pictures the 2D sheet; workspace.set measure brings the 3D view back.')
    }
    const scene = await settledScene('A picture of the view')
    const before = await shown(scene, show)
    const { on, ref, axis, refDir, offset, flipped } = useSectionView.getState()
    try {
      if (view || fit || frame) {
        aim(scene, view, fit, frame)
        await nextFrame(scene)
      }
      await sectioned(scene, section)
      const pictured = views ? await sheetOfViews(scene, views, width, height, show) : await picture(scene, width, height, view, show)
      return { ...pictured, ...describeMapPainted(scene.mapPainted()) }
    } finally {
      // What was put away or cut for the picture comes back; the frame stays.
      if (Object.keys(before).length > 0) {
        applyShow(scene, before)
        await nextFrame(scene)
      }
      if (section !== undefined) {
        useSectionView.setState({ on, ref, axis, refDir, offset, flipped })
        await nextFrame(scene)
      }
    }
  },
}

/** How many views a sheet of them puts in a row. */
const SHEET_COLUMNS = [0, 1, 2, 3, 2, 3, 3]
/** A sheet of views is this wide unless told, pixels. */
const SHEET_WIDTH = 1200

/** Several standard views as one picture: each turned to and fitted,
 *  captured at its tile's size, and the tiles laid out in rows, each named
 *  in its corner. */
async function sheetOfViews(scene: SceneManager, views: readonly StandardView[], width: number | undefined, height: number | undefined, show: Record<string, boolean> | undefined) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new CommandError('unavailable', 'A sheet of views needs the browser.')
  const cols = SHEET_COLUMNS[views.length]
  const rows = Math.ceil(views.length / cols)
  const size = scene.viewSize()
  const aspect = size.width / size.height
  const W = Math.min(MAX_SIDE, width ?? (height ? Math.round((height / rows) * aspect * cols) : SHEET_WIDTH))
  const H = Math.min(MAX_SIDE, height ?? Math.round((W / cols / aspect) * rows))
  const tw = Math.max(64, Math.floor(W / cols))
  const th = Math.max(64, Math.floor(H / rows))
  const canvas = new OffscreenCanvas(tw * cols, th * rows)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new CommandError('unavailable', 'The browser gave no canvas to lay the views out on.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < views.length; i++) {
    aim(scene, views[i], true, undefined)
    await nextFrame(scene)
    const bytes = await scene.capture(tw, th)
    const tile = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
    const x = (i % cols) * tw
    const y = Math.floor(i / cols) * th
    ctx.drawImage(tile, x, y, tw, th)
    tile.close()
    ctx.strokeStyle = '#c4c9cf'
    ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1)
    ctx.font = 'bold 14px system-ui, sans-serif'
    const w = ctx.measureText(views[i]).width
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillRect(x + 6, y + 6, w + 12, 22)
    ctx.fillStyle = '#20252c'
    ctx.textBaseline = 'middle'
    ctx.fillText(views[i], x + 12, y + 17)
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const stem = exportStem('scanruler')
  return { file: { name: `${stem}-views.png`, mimeType: 'image/png', bytes }, width: canvas.width, height: canvas.height, views: [...views], ...(show ? { shown: shownNow(scene) } : {}) }
}

/** The picture itself: the viewport's shape at the size asked for. */
async function picture(scene: SceneManager, width: number | undefined, height: number | undefined, view: StandardView | undefined, show: Record<string, boolean> | undefined) {
  const size = scene.viewSize()
  const aspect = size.width / size.height
  const fitIn = (w: number, h: number) => [Math.max(64, Math.min(MAX_SIDE, Math.round(w))), Math.max(64, Math.min(MAX_SIDE, Math.round(h)))]
  const [w, h] =
    width && height
      ? [width, height]
      : width
        ? fitIn(width, width / aspect)
        : height
          ? fitIn(height * aspect, height)
          : fitIn(...((aspect >= 1 ? [DEFAULT_LONG_SIDE, DEFAULT_LONG_SIDE / aspect] : [DEFAULT_LONG_SIDE * aspect, DEFAULT_LONG_SIDE]) as [number, number]))
  const bytes = await scene.capture(w, h)
  const stem = exportStem('scanruler')
  return { file: { name: `${stem}-view.png`, mimeType: 'image/png', bytes }, width: w, height: h, view: view ?? null, ...(show ? { shown: shownNow(scene) } : {}) }
}

/** What the stage has painted a map on — SceneManager.mapPainted. */
export type MapPainted = ReturnType<SceneManager['mapPainted']>

/** Which deviation map a picture shows, for its answer — only while the
 *  Deviation workspace is on screen, where the map is what the part is
 *  coloured by: { map: { on, colormap, range } } when it is painted, or
 *  { map: null, mapWhy } saying why it is not and what puts it there.
 *  Read off the stores for what was asked and off the stage for what was
 *  drawn, so a map that never reached the stage is not taken for one that
 *  did. Empty elsewhere. */
export function describeMapPainted(painted: MapPainted): Record<string, unknown> {
  if (useShell.getState().workspace !== 'deviation') return {}
  const d = useDeviation.getState()
  const none = (mapWhy: string) => ({ map: null, mapWhy })
  if (!d.showMap) return none('the map switch is off — deviation.settings { show: true } puts it on.')
  if (d.source === 'element') {
    if (d.elementStatus !== 'ready') return none('no map against an element is measured — deviation.set_target measures one.')
  } else {
    if (!d.nominalName) return none('no reference part is open — deviation.open_reference, then deviation.align.')
    if (!d.align) return none('the scan is not aligned to the reference — deviation.align aligns it and measures the map.')
    if (d.mapStatus !== 'ready') return none('no deviation map is measured — deviation.measure measures it under the alignment.')
  }
  const onReference = d.source === 'reference' && d.mapOn === 'reference'
  const unfit = (what: string) => `the map’s readings are not one a vertex of the ${what}, so it was left unpainted — deviation.measure measures it again.`
  if (onReference) {
    if (d.referenceStatus !== 'ready') return none(`the map on the reference is not measured${d.alignMessage ? ` (${d.alignMessage})` : ''} — deviation.settings { on: "reference" } measures it.`)
    if (!d.showNominal) return none('the map is on the reference, which is put away — show: { reference: true }, or deviation.settings { on: "scan" }.')
    if (d.split) return none('the view is split, the reference in a viewport of its own, which the picture leaves out — the map on it is not in this one.')
    if (painted.reference === 'unfit') return none(unfit('reference'))
    if (painted.reference !== 'painted' || !painted.referenceShown) return none('the map on the reference is not on the stage yet.')
  } else {
    if (!painted.scanShown) return none(`the map is on the scan, which is put away — show: { scan: true }${d.source === 'reference' ? ', or deviation.settings { on: "reference" }' : ''}.`)
    if (painted.scan === 'unfit') return none(unfit('scan'))
    if (painted.scan !== 'painted') return none('the map is not on the stage yet.')
  }
  return {
    map: { on: onReference ? 'reference' : 'scan', colormap: usePrefs.getState().colormap, range: d.range },
    ...(!onReference && painted.nominalShown && painted.nominalGhost ? { mapNote: 'the reference is drawn over the scan as a ghost, which dulls the colours — show: { reference: false } gives the clean map.' } : {}),
  }
}

/** The toggles standing now and whether each is shown — for the readout,
 *  null without a viewport. */
export function describeView(): Record<string, boolean> | null {
  const scene = sceneOf()
  return scene ? shownNow(scene) : null
}

export const viewCommands = [set, render]
