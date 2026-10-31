// SPDX-License-Identifier: AGPL-3.0-only
// The cutter route end to end on the wheel-cap pattern: a revolved disc with
// four windows through it. The part is first modelled plainly on the blank
// stage — a disc, a window's plug patterned four times round and cut out —
// exported as STEP and meshed: that mesh is the scan. Then it is reversed
// the way the wheel cap is in the QuickSurface study: the disc revolved from
// its section, one window's outline extruded as a **sheet**, the sheet
// **patterned** round the axis into four cutters, the disc **split** by them
// with the fragments **on the scan** kept — the four plugs have a roof and a
// floor the scan does not, and fall out — and the body exported closed.
// Needs no scan file.
//
//   npm run dev &  node plugins/reverse/scripts/e2e-wheel-cap.mjs
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importStep, writeBinarySTL } from 'meshstep'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const R = 40, T = 4 // the disc
const WIN = { x0: 10, x1: 34, y0: -8, y1: 8 } // one window, the others a quarter turn on
const VOLUME = Math.PI * R * R * T - 4 * (WIN.x1 - WIN.x0) * (WIN.y1 - WIN.y0) * T

const dir = mkdtempSync(join(tmpdir(), 'scanruler-wheelcap-'))
const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })

const { re, kernelReady } = reverseHelpers(page)
/** Wait for the build to settle with every feature's verdict in. */
const settled = async () => {
  await sleep(200)
  await page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 180_000 }).catch(() => {})
  await sleep(200)
}
const failures = () => re(() => Object.values(window.__re.store.getState().results).filter((r) => r.status === 'failed').map((r) => r.message))
const XY = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
/** A sketch of one rectangle on a plane, committed; its id. */
const rectangleSketch = (plane, frame, a, b) =>
  re(
    ({ plane, frame, a, b }) => {
      const s = () => window.__re.store.getState()
      s().startSketch(plane, frame)
      s().setSketchTool('rectangle')
      s().sketchClick(a, 0.01, false, { off: true })
      s().sketchClick(b, 0.01, false, { off: true })
      s().setSketchTool('select')
      return s().commitSketch()
    },
    { plane, frame, a, b },
  )
const stepOut = async (name) => {
  const before = new Set(readdirSync(dir))
  await click(page, '[data-test=export-body-step]')
  for (let i = 0; i < 150; i++) {
    await sleep(200)
    const file = readdirSync(dir).find((f) => f.endsWith('.step') && !before.has(f))
    if (file) return readFileSync(join(dir, file), 'utf8')
  }
  check(false, `${name}: a STEP file downloaded`)
  return null
}

// ---- the part, modelled plainly: what will be the scan -------------------------------------
await page.click('[data-test=workspace-reverse]')
await kernelReady()
await sleep(300)
const discSketch = await re((R) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('circle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([R, 0], 0.01, false, { off: true })
  s().setSketchTool('select')
  return s().commitSketch()
}, R)
const disc = await re(
  ({ id, T }) => {
    const s = () => window.__re.store.getState()
    s().startExtrude(id)
    if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
    s().setExtrude({ extent: { kind: 'distance', from: 0, to: T } })
    return s().commitExtrude()
  },
  { id: discSketch, T },
)
const plugSketch = await rectangleSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [WIN.x0, WIN.y0], [WIN.x1, WIN.y1])
const plug = await re(
  ({ id, T }) => {
    const s = () => window.__re.store.getState()
    s().startExtrude(id)
    if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
    s().setExtrude({ extent: { kind: 'distance', from: -1, to: T + 1 }, op: 'new' })
    return s().commitExtrude()
  },
  { id: plugSketch, T },
)
await settled()
await re((plug) => {
  const s = () => window.__re.store.getState()
  s().startFeature('pattern', { body: plug })
  s().setFeatureDraft({ mode: 'circular', axis: { kind: 'world', axis: 'z' }, count: 4, step: 360 })
  s().commitFeature()
}, plug)
await settled()
await re(
  ({ disc, plug }) => {
    const s = () => window.__re.store.getState()
    s().startFeature('boolean', { body: disc })
    s().setFeatureDraft({ op: 'cut', body: disc, tool: plug })
    s().commitFeature()
  },
  { disc, plug },
)
await settled()
console.log('failures, modelling:', JSON.stringify(await failures()))
const modelled = await re(() => window.__re.store.getState().bodies.map((b) => ({ id: b.id, volume: b.volume, closed: b.closed, faces: b.faces })))
console.log('modelled:', JSON.stringify(modelled))
check(modelled.length === 1 && modelled[0].closed && Math.abs(modelled[0].volume - VOLUME) < 1, `the wheel cap is modelled: a disc with four windows, ${modelled[0]?.volume.toFixed(1)} of ${VOLUME.toFixed(1)} mm³`)
await page.screenshot({ path: shotPath('wheel-cap-modelled.png') })
const stepText = await stepOut('the modelled part')
if (!stepText) await finish(browser, consoleErrors)
const scanPath = join(dir, 'wheel-cap.stl')
writeFileSync(scanPath, writeBinarySTL(importStep(stepText, { surfaceDeviation: 0.02, maxEdge: 2 }).mesh))

// ---- reversed: the scan, and the cutter route ----------------------------------------------
// The modelled part is unsaved work: the recovery guard asks before the
// page is left, and the reload would wait on that question forever.
page.on('dialog', (d) => d.accept().catch(() => {}))
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('.panel')
await loadScan(page, scanPath, { inputSelector: '[data-test=start-scan] input[type=file]' })
await page.evaluate(() => document.querySelector('[data-test=support-card] button')?.click())
await click(page, '[data-test=workspace-reverse]')
await kernelReady()
// The scan is over in the kernel worker before anything is kept by it.
await sleep(1500)

// The disc revolved from its section: a rectangle on the ZX plane, from the
// axis out to the rim, turned about Z.
const section = await rectangleSketch({ kind: 'world', axis: 'y', offset: 0 }, { origin: [0, 0, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] }, [0, 0], [R, T])
const body = await re((id) => {
  const s = () => window.__re.store.getState()
  s().startRevolve(id, null, { kind: 'world', axis: 'z' })
  if (s().revolveDraft.regions.length === 0) s().pickAllDraftRegions()
  return s().commitRevolve()
}, section)
await settled()
const revolved = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id), body)
console.log('revolved:', JSON.stringify(revolved))
check(revolved?.closed && Math.abs(revolved.volume - Math.PI * R * R * T) < 1, `the disc is revolved from its section (${revolved?.volume.toFixed(1)} mm³)`)

// One window's outline as a sheet through the disc.
const outline = await rectangleSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [WIN.x0, WIN.y0], [WIN.x1, WIN.y1])
const sheet = await re(
  ({ id, T }) => {
    const s = () => window.__re.store.getState()
    s().startFeature('sheet')
    s().setFeatureDraft({ sketchId: id, from: -2, to: T + 2 })
    return s().commitFeature()
  },
  { id: outline, T },
)
await settled()
const sheetBody = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id), sheet)
console.log('sheet:', JSON.stringify(sheetBody))
check(sheetBody?.surface && sheetBody.faces === 4, 'a window’s outline is a sheet of four faces, a surface body')

// Patterned round the axis — through the box, a sheet chosen as the body.
await click(page, '[data-test=feature-pattern]')
await page.waitForSelector('[data-test=pattern-editor]')
await page.select('[data-test=pattern-body]', String(sheet))
await re(() => window.__re.store.getState().setFeatureDraft({ mode: 'circular', axis: { kind: 'world', axis: 'z' }, count: 4, step: 360 }))
await page.waitForFunction(() => window.__re.store.getState().preview.status === 'ok' || window.__re.store.getState().preview.status === 'failed', { timeout: 60_000 }).catch(() => {})
const patternPreview = await page.$eval('[data-test=pattern-preview]', (el) => el.textContent).catch(() => '')
console.log('pattern preview:', patternPreview)
check(/A sheet of 16 faces/.test(patternPreview), 'the Pattern box takes a sheet for its body and previews the cutters as a sheet')
await click(page, '[data-test=pattern-create]')
await settled()
const cutters = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id), sheet)
console.log('cutters:', JSON.stringify(cutters), JSON.stringify(await failures()))
check(cutters?.surface && cutters.faces === 16, `the sheet patterned four times round is one sheet of sixteen faces (${cutters?.faces})`)
await page.screenshot({ path: shotPath('wheel-cap-cutters.png') })

// Split by the cutters, the fragments on the scan kept.
await re(
  ({ body, sheet }) => {
    const s = () => window.__re.store.getState()
    s().startFeature('split', { body })
    s().setFeatureDraft({ body, tools: [sheet], keep: 'scan', tolerance: 0.1, overlap: 0.5 })
    s().commitFeature()
  },
  { body, sheet },
)
await settled()
console.log('failures, reversing:', JSON.stringify(await failures()))
const cap = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id), body)
console.log('cap:', JSON.stringify(cap))
check(cap?.closed && Math.abs(cap.volume - VOLUME) < 1, `split by the cutters with the fragments on the scan kept, the four plugs fall out: ${cap?.volume.toFixed(1)} of ${VOLUME.toFixed(1)} mm³`)
// The body's map against the scan it was reversed from.
await click(page, '[data-test=toggle-body-map]')
await page.waitForFunction(() => window.__re.store.getState().mapReport !== null, { timeout: 60_000 }).catch(() => {})
const report = await re(() => window.__re.store.getState().mapReport)
console.log('map:', JSON.stringify(report))
check(report && report.within / report.points > 0.99, `and the scan lies on the body: ${report?.within} of ${report?.points} points within ±${report?.range} mm`)
await page.screenshot({ path: shotPath('wheel-cap-reversed.png') })
await click(page, '[data-test=toggle-body-map]')

const out = await stepOut('the reversed part')
if (out) {
  const back = importStep(out, { surfaceDeviation: 0.01, maxEdge: 5 })
  const d = back.diagnostics
  console.log('meshStep:', JSON.stringify({ ok: d.ok, openEdges: d.openEdges, nonManifold: d.nonManifoldEdges, dropped: d.facesDropped }))
  check(d.openEdges === 0 && d.nonManifoldEdges === 0 && d.facesDropped === 0, 'meshStep builds the export back into a closed solid')
  check((out.match(/MANIFOLD_SOLID_BREP/g) ?? []).length === 1, 'as one solid body — the cutters stay behind')
}

await finish(browser, consoleErrors)
