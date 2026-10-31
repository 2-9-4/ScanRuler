// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the Reverse engineer workspace used as plain CAD, with
// no scan on the stage: it opens on the blank stage, a rectangle is drawn on
// the XY plane, a line from the middle of one side is held to that middle,
// one click on a line is its length, an end is dimensioned to a coordinate
// plane, the sketch is extruded to a body, the body's keys are live, and the
// project — features and no scan — saves and opens again.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-reverse-blank.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { check, click, finish, launchApp, repoFile, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const DL_DIR = repoFile('e2e-out/reverse-blank-dl')
rmSync(DL_DIR, { recursive: true, force: true })
mkdirSync(DL_DIR, { recursive: true })

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true })

const { re, built, kernelReady } = reverseHelpers(page)

await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await kernelReady()

// ---- straight onto the blank stage ---------------------------------------------------
await sleep(300)
check((await page.$('[data-test=start-pane]')) === null, 'no front door: with no scan the workspace opens on the blank stage')
check(await page.$eval('[data-test=feature-extrude]', (b) => b.disabled), 'Extrude waits for a sketch, not for a scan')

// ---- the coordinate planes ------------------------------------------------------------
// The blank stage shows the XY, XZ and YZ planes at the origin, listed at the
// head of the body list with eyes of their own; a click on one in the
// viewport offers a sketch on it.
const planesDrawn = () => re(() => window.__re.reScene().planes.planes.map((p) => p.axis).join(''))
check((await page.$$('[data-test=plane-row]')).length === 3, 'the coordinate planes head the body list')
check(await planesDrawn() === 'xyz', 'all three are drawn on the blank stage')
await sleep(300)
await page.screenshot({ path: shotPath('reverse-blank-planes.png') })
{
  // A point on the XY plane, inside its square, as client pixels — and
  // which plane the ray through it meets first, whatever the view.
  const at = await re(() => {
    const rs = window.__re.reScene()
    const half = rs.host.modelRadius() * 0.5
    const [x, y] = rs.bodyPicks.screenProjection()(half * 0.5, half * 0.5, 0)
    return { x, y, axis: rs.planes.hitAt(x, y)?.axis ?? null }
  })
  check(at.axis !== null, `the ray through the XY plane's square meets a plane (${at.axis})`)
  await page.mouse.move(at.x, at.y)
  await sleep(250)
  await page.mouse.click(at.x, at.y)
  await sleep(300)
  const sel = await re(() => window.__re.store.getState().selection)
  check(sel?.kind === 'coordinatePlane' && sel.axis === at.axis, `a click on it selects it (${JSON.stringify(sel && { kind: sel.kind, axis: sel.axis })})`)
  check((await page.$('[data-test=chip-sketch-on]')) !== null, 'its chips offer a sketch on it')
  await page.screenshot({ path: shotPath('reverse-blank-plane-picked.png') })
  await click(page, '[data-test=chip-hide-plane]')
  await sleep(200)
  check((await planesDrawn()).length === 2, 'Hide puts that plane away')
  const off = await page.$$eval('[data-test=plane-row]', (rows) => rows.filter((r) => r.classList.contains('ghost')).length)
  check(off === 1, 'its row says so')
  await page.$$eval('[data-test=plane-row].ghost [data-test=plane-visible]', (bs) => bs[0].click())
  await sleep(200)
  check(await planesDrawn() === 'xyz', 'its eye brings it back')
}

// ---- a sketch on the XY plane ----------------------------------------------------------
await re(() => {
  const frame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame)
  s().setSketchTool('rectangle')
  s().sketchClick([10, 5], 0.01, false, { off: true })
  s().sketchClick([50, 25], 0.01, false, { off: true })
})
await sleep(600)
check(await re(() => window.__re.store.getState().chainsStatus) === 'idle', 'no slice is asked for with no scan')
check(await re(() => window.__re.store.getState().sketchDraft.found.length) === 1, 'the rectangle closes a region')

// A line begun near the middle of the bottom side snaps to it and is held there.
const mid = await re(() => {
  const s = () => window.__re.store.getState()
  s().setSketchTool('line')
  s().sketchClick([30.3, 5.2], 1, false, {})
  s().sketchClick([30, -10], 1, false, { off: true })
  s().setSketchTool('select')
  const d = s().sketchDraft
  const join = d.sketch.constraints.find((c) => c.kind === 'coincident' && c.q.at === 'center')
  const line = d.sketch.entities.at(-1)
  return { join: Boolean(join), a: line.a }
})
check(mid.join && Math.abs(mid.a[0] - 30) < 1e-6 && Math.abs(mid.a[1] - 5) < 1e-6, `a line's end lands on the middle of a side and is joined to it (${JSON.stringify(mid)})`)

// One click on a line is its length.
const len = await re(() => {
  const s = () => window.__re.store.getState()
  s().setSketchTool('dimension')
  s().sketchClick([20, 25], 0.5, false)
  const d = s().sketchDraft
  const c = d.sketch.constraints.find((x) => x.kind === 'length')
  return { value: c?.value, selected: d.selectedConstraint === c?.id }
})
check(Math.abs(len.value - 40) < 1e-6 && len.selected, `one click on the top side is its length, 40 mm, selected to be typed over (${JSON.stringify(len)})`)

// An end, then the YZ plane's line (u = 0 on this sheet): the distance to the plane.
const datum = await re(() => {
  const s = () => window.__re.store.getState()
  s().putDownDimension()
  s().sketchClick([10, 25], 0.5, false)
  s().sketchClick([0.1, 60], 0.5, false)
  const d = s().sketchDraft
  const c = d.sketch.constraints.find((x) => x.kind === 'distance' && x.q.datum)
  if (c) s().setDimensionValue(c.id, 12)
  const after = s().sketchDraft
  const xs = after.sketch.entities.filter((e) => e.kind === 'line').flatMap((e) => [e.a[0], e.b[0]])
  s().setSketchTool('select')
  return { plane: c?.q.datum, value: c?.value, left: Math.min(...xs.filter((x) => x > 1)), ok: after.report?.ok }
})
check(datum.plane === 'yz' && Math.abs(datum.value - 10) < 1e-6, `an end is dimensioned to the YZ plane at 10 mm (${JSON.stringify(datum)})`)
check(datum.ok && Math.abs(datum.left - 12) < 1e-4, 'typing 12 moves the rectangle 12 mm off the plane')
const labels = await page.$$eval('.viewport-label', (els) => els.map((e) => e.textContent.trim()))
check(labels.some((t) => /YZ plane/.test(t)) && labels.some((t) => /ZX plane/.test(t)), 'the coordinate planes are named on the sheet')
await page.screenshot({ path: shotPath('reverse-blank-sketch.png') })

// ---- to a body ---------------------------------------------------------------------------
const sketchId = await re(() => window.__re.store.getState().commitSketch())
await re((id) => {
  const s = () => window.__re.store.getState()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().commitExtrude()
}, sketchId)
await built()
const volume = await re(() => window.__re.store.getState().bodies[0].volume)
check(Math.abs(volume - 40 * 20 * 10) < 1, `the extrude is a body of the right volume (${volume.toFixed(1)} mm³)`)
check(!(await page.$eval('[data-test=feature-fillet]', (b) => b.disabled)), 'Fillet is live on a body with no scan')
check(!(await page.$eval('[data-test=feature-shell]', (b) => b.disabled)), 'Shell is live on a body with no scan')
check(await page.$eval('[data-test=feature-surface]', (b) => b.disabled), 'Fit surface still waits for a scan')
const size = await re(() => window.__re.measure.getState().modelSize)
check(size > 10, `the stage is sized by the body (${size.toFixed(1)} mm)`)
await sleep(500)
await page.screenshot({ path: shotPath('reverse-blank-body.png') })

// ---- saved and opened again -------------------------------------------------------------------
check(!(await page.$eval('[data-test=save-project]', (b) => b.disabled)), 'Save is live with features and no scan')
await click(page, '[data-test="save-project"]')
let file = null
for (let i = 0; i < 100 && !file; i++) {
  await sleep(200)
  const done = readdirSync(DL_DIR).filter((f) => f.endsWith('.scanruler'))
  if (done.length) file = join(DL_DIR, done[0])
}
check(!!file, 'a project with no scan in it is saved')
if (file) {
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.panel')
  await (await page.$('[data-test="project-input"]')).uploadFile(file)
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 120_000 })
  await kernelReady()
  await built()
  const back = await re(() => ({ kinds: window.__re.store.getState().features.map((f) => f.kind), volume: window.__re.store.getState().bodies[0].volume, file: window.__re.measure.getState().fileName }))
  check(JSON.stringify(back.kinds) === JSON.stringify(['sketch', 'extrude']) && Math.abs(back.volume - 8000) < 1, `the features come back and build (${JSON.stringify(back)})`)
  check(back.file === null && (await page.$('[data-test=start-pane]')) === null, 'no scan, and no front door over the model')
  await page.screenshot({ path: shotPath('reverse-blank-reopened.png') })
}

await finish(browser, consoleErrors)
