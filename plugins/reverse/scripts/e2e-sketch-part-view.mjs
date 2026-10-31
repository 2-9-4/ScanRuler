// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test, on the blank stage, of what lies under a sketch and how
// the camera gets there and back: a body built from a rectangle, a sketch
// opened across it on the XZ plane — the view swings round to it and is cut
// open at it, the body closed where it is cut, and the view bar's three keys
// show the whole part or put it away — a circle dimensioned by its
// diameter and typed over as a radius, the sketch put away and the camera
// back where it was. Then a body grown past the screen taken in without the
// view turned, the printing thread on offer in the Thread box, and the
// project named and started over.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-sketch-part-view.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
page.on('dialog', (d) => d.accept())
const { re, built, kernelReady } = reverseHelpers(page)

await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await kernelReady()
await sleep(300)

/** The camera as it stands: where it looks from, what is up, the zoom. */
const pose = () =>
  re(() => {
    const cam = window.__re.scene().viewLink().camera
    const e = cam.matrixWorld.elements
    return { dir: [e[8], e[9], e[10]], up: [e[4], e[5], e[6]], zoom: cam.zoom }
  })
const settled = () => page.waitForFunction(() => !window.__re.scene().turning(), { timeout: 5_000 }).catch(() => {})
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// ---- the blank stage, Z up --------------------------------------------------------------
{
  const p = await pose()
  check(p.up[2] > 0.5, `the blank stage opens Z up, as the iso key has it (${JSON.stringify(p.up.map((v) => +v.toFixed(2)))})`)
}

// ---- a body ----------------------------------------------------------------------------
const xy = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
const first = await re((frame) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame)
  s().setSketchTool('rectangle')
  s().sketchClick([-20, -10], 0.01, false, { off: true })
  s().sketchClick([20, 10], 0.01, false, { off: true })
  s().setSketchTool('select')
  return s().commitSketch()
}, xy)
await re((id) => {
  const s = () => window.__re.store.getState()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().commitExtrude()
}, first)
await built()
await settled()
await sleep(400)

// ---- into a sketch across the body, and the keys under it ---------------------------------
const before = await pose()
await re(() => {
  const s = () => window.__re.store.getState()
  // The XZ plane, through the middle of the block.
  const frame = { origin: [0, 0, 0], normal: [0, 1, 0], basisU: [0, 0, 1], basisV: [1, 0, 0] }
  s().startSketch({ kind: 'world', axis: 'y', offset: 0 }, frame)
})
await page.waitForSelector('[data-test=sketch-editor]')
await sleep(100)
await settled()
await sleep(300)
{
  const p = await pose()
  check(dot(p.dir, [0, 1, 0]) > 0.999, `the view turns face on to the sketch plane (${JSON.stringify(p.dir.map((v) => +v.toFixed(3)))})`)
}
check(await re(() => window.__re.scene().sliced()), 'Section: the body is cut open at the plane, with no scan on the stage')
check(await page.$eval('[data-test=sketch-part-cut]', (b) => b.getAttribute('aria-checked') === 'true'), 'Section is the key that is on')
await page.screenshot({ path: shotPath('sketch-part-section.png') })
await click(page, '[data-test=sketch-part-full]')
await sleep(250)
check(!(await re(() => window.__re.scene().sliced())), 'Full part: nothing is cut away')
await page.screenshot({ path: shotPath('sketch-part-full.png') })
await click(page, '[data-test=sketch-part-none]')
await sleep(250)
check(await page.evaluate(() => document.querySelector('.viewslot').hidden), 'No part: the 3D view is put away under the sheet')
await click(page, '[data-test=sketch-part-cut]')
await sleep(300)
check(!(await page.evaluate(() => document.querySelector('.viewslot').hidden)) && (await re(() => window.__re.scene().sliced())), 'Section brings it back, cut')

// ---- a circle, by its diameter ---------------------------------------------------------------
const circle = await re(() => {
  const s = () => window.__re.store.getState()
  s().setSketchTool('circle')
  s().sketchClick([5, 0], 0.01, false, { off: true })
  s().sketchClick([8, 0], 0.01, false, { off: true })
  s().setSketchTool('dimension')
  s().sketchClick([5, 3], 0.5, false)
  s().putDownDimension()
  const d = s().sketchDraft
  const c = d.sketch.constraints.find((x) => x.kind === 'diameter')
  return c ? { id: c.id, value: c.value } : null
})
check(circle !== null && Math.abs(circle.value - 6) < 1e-6, `a click on a circle gives its diameter, 6 mm (${JSON.stringify(circle)})`)
await sleep(300)
// Put down, it is open for typing; Escape leaves it as it reads.
await page.keyboard.press('Escape')
await sleep(200)
const label = await page.$eval(`[data-test=flat-dimension-${circle.id}]`, (el) => el.textContent.trim()).catch(() => null)
check(/^Ø\s*6$/.test(label ?? ''), `the sheet writes it Ø 6 (${label})`)
await page.screenshot({ path: shotPath('sketch-diameter.png') })
// Typed with its letter, R4 over the Ø: the circle by its radius, 4 mm.
await page.click(`[data-test=flat-dimension-${circle.id}]`)
await sleep(150)
await page.keyboard.down('Control')
await page.keyboard.press('KeyA')
await page.keyboard.up('Control')
await page.keyboard.type('R4')
await page.keyboard.press('Enter')
await sleep(300)
const typed = await re((id) => {
  const d = window.__re.store.getState().sketchDraft
  const c = d.sketch.constraints.find((x) => x.id === id)
  const e = d.sketch.entities.find((x) => x.kind === 'circle')
  return { kind: c?.kind, value: c?.value, r: e?.r }
}, circle.id)
check(typed.kind === 'radius' && typed.value === 4 && Math.abs(typed.r - 4) < 1e-6, `R4 typed over it gives the circle by its radius (${JSON.stringify(typed)})`)
await click(page, '[data-test=sketch-dimension-form]')
await sleep(200)
const turned = await re((id) => window.__re.store.getState().sketchDraft.sketch.constraints.find((x) => x.id === id), circle.id)
check(turned.kind === 'diameter' && turned.value === 8, `the row's → Ø chip turns it back, the size held (${turned.kind} ${turned.value})`)

// ---- out again: the view it was in --------------------------------------------------------
await re(() => window.__re.store.getState().discardSketch())
await sleep(100)
await settled()
await sleep(200)
{
  const p = await pose()
  check(dot(p.dir, before.dir) > 0.999 && dot(p.up, before.up) > 0.999 && Math.abs(p.zoom / before.zoom - 1) < 1e-3, `put away, the camera swings back to the view it was in (dir·dir ${dot(p.dir, before.dir).toFixed(4)}, zoom ${p.zoom.toFixed(3)} / ${before.zoom.toFixed(3)})`)
}

// ---- a body grown past the screen ----------------------------------------------------------
{
  // Turned somewhere of the operator's own, then zoomed in on a corner.
  await re(() => {
    const scene = window.__re.scene()
    scene.viewFrom('right')
  })
  await sleep(200)
  const turnedTo = await pose()
  const big = await re((frame) => {
    const s = () => window.__re.store.getState()
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame)
    s().setSketchTool('rectangle')
    s().sketchClick([-150, -100], 0.01, false, { off: true })
    s().sketchClick([150, 100], 0.01, false, { off: true })
    s().setSketchTool('select')
    return s().commitSketch()
  }, xy)
  await settled()
  await re((id) => {
    const s = () => window.__re.store.getState()
    s().startExtrude(id)
    if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
    s().commitExtrude()
  }, big)
  await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.some((b) => b.volume > 1e5), { timeout: 60_000 })
  await sleep(150)
  await settled()
  await sleep(200)
  const p = await pose()
  check(dot(p.dir, turnedTo.dir) > 0.999 && dot(p.up, turnedTo.up) > 0.999, `the body grown past the screen is taken in looking from where the camera looked (dir·dir ${dot(p.dir, turnedTo.dir).toFixed(4)})`)
  check(p.zoom < turnedTo.zoom, `by zooming out (${turnedTo.zoom.toFixed(3)} → ${p.zoom.toFixed(3)})`)
  await page.screenshot({ path: shotPath('blank-stage-grown.png') })
}

// ---- the printing thread on offer ---------------------------------------------------------
{
  await click(page, '[data-test=feature-thread]')
  await sleep(300)
  const options = await page.$$eval('[data-test=thread-standard] option', (os) => os.map((o) => o.value))
  check(options.includes('print45'), `the Thread box offers the 45° printing form (${options.join(', ')})`)
  await page.select('[data-test=thread-standard]', 'print45')
  await sleep(200)
  check((await page.$('[data-test=thread-print-hint]')) !== null, 'and says what it is for')
  const designations = await page.$$eval('[data-test=thread-designation] option', (os) => os.map((o) => o.textContent))
  console.log('designations:', designations)
  check(designations.some((t) => /print — ISO coarse depth/.test(t)), 'its first pitch cuts as deep as the ISO coarse thread')
  await page.screenshot({ path: shotPath('thread-print45-box.png') })
  await re(() => window.__re.store.getState().cancelFeature?.())
  await page.keyboard.press('Escape')
  await sleep(200)
}

// ---- the project's name, and starting over --------------------------------------------------
await page.click('[data-test=project-name]')
await page.keyboard.type('Bench block v2.1')
await page.keyboard.press('Enter')
await sleep(200)
check(await re(() => window.__re.measure.getState().projectName) === 'Bench block v2.1', 'the name typed in the top bar is the project’s')
check((await page.title()) === 'Bench block v2.1 — ScanRuler', `and the browser tab’s (${await page.title()})`)
const stepName = await re(async () => (await window.__re.session.stepFile(window.__re.store.getState().bodies.map((b) => b.id))).name)
check(stepName === 'Bench block v2.1-body.step', `the bodies’ STEP is named on it (${stepName})`)
await page.click('[data-test=project-name]')
await page.keyboard.type(' draft')
await page.keyboard.press('Escape')
await sleep(150)
check(await re(() => window.__re.measure.getState().projectName) === 'Bench block v2.1', 'Escape puts the name back')
await page.screenshot({ path: shotPath('project-named.png') })
await click(page, '[data-test=new-project]')
await page.waitForFunction(() => !window.__re.measure.getState().busy, { timeout: 20_000 })
await sleep(500)
const fresh = await re(() => ({ features: window.__re.store.getState().features.length, bodies: window.__re.store.getState().bodies.length, name: window.__re.measure.getState().projectName }))
check(fresh.features === 0 && fresh.bodies === 0 && fresh.name === null, `New Project starts over: no features, no bodies, no name (${JSON.stringify(fresh)})`)
check((await page.title()) === 'ScanRuler by CNC Kitchen', 'and the tab has its own title back')
check(await page.$eval('[data-test=workspace-reverse]', (b) => b.getAttribute('aria-selected') === 'true'), 'in the workspace that was on screen')
await page.screenshot({ path: shotPath('project-new.png') })

await finish(browser, consoleErrors)
