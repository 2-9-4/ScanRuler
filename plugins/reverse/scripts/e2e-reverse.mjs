// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the Reverse engineer workspace on a part whose answer is
// known: a 20 mm cube, meshed densely from a STEP B-rep and loaded as the
// scan. The kernel worker has to come up in the browser, the XY plane
// through the cube's middle has to give one square slice chain, the auto-fit
// has to cut it into four lines that corner inference joins into one closed
// region, the extrude has to pick that region on its own and show a preview
// of the body before it is created, the extrude from −10 to +10 has to
// produce a body of 8000 mm³, and the STEP export has to come back through
// meshStep as one closed solid of the cube's size. Also checks the free
// tools: a rectangle drawn by hand — rubber-banded to the cursor between
// its two clicks — goes straight into an extrude from the sketch box, and
// the extrude cutting a body takes volume away. Escape never closes a
// sketch, Ctrl+Z takes a feature back and Ctrl+Shift+Z brings it again,
// and a click on the cube's top face opens no sketch. In the sketch: the
// Line tool's chain and its tangent arc, a click that selects and stays
// selected, D for a dimension typed into, the relation glyphs hidden
// until asked for, Undo in the top bar.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-reverse.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importStep, writeBinarySTL } from 'meshstep'
import { cubeStep } from '../../../tests/stepFixtures.ts'
import { check, click, enterTyper, fail, finish, launchApp, loadScan, pickOption, previewReady, selectByLabel, shotPath, sleep, viewOption } from '../../../scripts/e2e-lib.mjs'

const SIZE = 20

// ---- the scan: a dense cube centred on the origin -----------------------------
const dir = mkdtempSync(join(tmpdir(), 'scanruler-reverse-'))
const dense = importStep(cubeStep(SIZE), { surfaceDeviation: 0.001, maxEdge: 1.0 })
const p = dense.mesh.positions
for (let i = 0; i < p.length; i++) p[i] -= SIZE / 2
const scanPath = join(dir, 'cube-scan.stl')
writeFileSync(scanPath, Buffer.from(writeBinarySTL(dense.mesh)))
console.log(`fixture in ${dir}: ${dense.mesh.indices.length / 3} triangle cube`)

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const cdp = await page.createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })

// ---- the workspace and its kernel -----------------------------------------------
await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
const kernelText = () => page.$eval('[data-test=kernel-status]', (el) => el.textContent)
console.log('kernel:', await kernelText())
await page
  .waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 })
  .catch(() => {})
console.log('kernel:', await kernelText())
check(/ready/.test(await kernelText()), 'the CAD kernel loads in the browser')
check(/OCCT/.test(await kernelText()), 'and names its version')

await loadScan(page, scanPath, { inputSelector: '[data-test=slot-scan] input[type=file]', settle: 500 })
check((await page.$('[data-test=reverse-ready-chip]')) !== null, 'the stage says to choose a plane')

// ---- an element measured in Measure shows on the part here too ------------------
// A plane fitted on the cube's face in the Measure workspace is drawn in
// this one as well, with its name, and the view bar's Elements key puts it
// away.
await page.click('[data-test=workspace-elements]')
await sleep(400)
await click(page, '[data-test=fit-plane]')
const rect3d = await page.$eval('.viewslot canvas', (el) => {
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await page.mouse.click(rect3d.x, rect3d.y)
const planeReady = await previewReady(page)
if (planeReady) await click(page, '[data-test=create-element]')
else console.log('WARN: the plane on the cube face did not fit')
await sleep(400)
await page.click('[data-test=workspace-reverse]')
await sleep(500)
const partLabels = () => page.$$eval('.viewport-label .label-title', (els) => els.map((e) => e.textContent))
console.log('labels in Reverse:', JSON.stringify(await partLabels()))
check(planeReady && (await partLabels()).some((t) => /Plane 1/.test(t)), 'a plane fitted in Measure is drawn on the part in Reverse engineer')
check((await page.$('[data-test=toggle-elements]:not([aria-disabled])')) !== null, 'the view bar offers the Elements key')
await click(page, '[data-test=toggle-elements]')
await sleep(300)
check(!(await partLabels()).some((t) => /Plane 1/.test(t)), 'and the key puts the measured elements away')
await click(page, '[data-test=toggle-elements]')
await sleep(200)

// ---- a sketch on the XY plane -------------------------------------------------------
// The plane list shows the option under the cursor on the part, with its
// name, before it is taken — and the fitted plane is on offer.
await click(page, '[data-test=sketch-plane-select]')
await page.waitForSelector('[data-test=sketch-plane-select-list]')
const planeOptions = await page.$$eval('[data-test=sketch-plane-select-list] [data-test=pick-option]', (els) => els.map((e) => e.textContent))
console.log('planes on offer:', JSON.stringify(planeOptions))
check(planeOptions.some((t) => /Plane 1/.test(t)), 'the fitted plane is on offer as a sketch plane')
await page.keyboard.press('Escape')
await sleep(150)
await click(page, '[data-test=sketch-plane-select]')
await page.waitForSelector('[data-test=sketch-plane-select-list]')
const xyOption = await page.evaluateHandle(() => [...document.querySelectorAll('[data-test=sketch-plane-select-list] [data-test=pick-option]')].find((o) => /XY plane/.test(o.textContent)))
await xyOption.asElement().hover()
await sleep(300)
const hintLabels = await page.$$eval('.viewport-label .label-title', (els) => els.map((e) => e.textContent))
console.log('hint labels while hovering:', JSON.stringify(hintLabels))
check(hintLabels.some((t) => /XY plane/.test(t)), 'hovering a plane in the list shows it on the part with its name')
await page.screenshot({ path: shotPath('reverse-plane-hint.png') })
await xyOption.asElement().click()
await page.waitForSelector('[data-test=sketch-editor]')
await page.waitForFunction(() => /1 slice chain/.test(document.querySelector('[data-test=sketch-plane]')?.textContent ?? ''), { timeout: 20_000 })
console.log('plane:', await page.$eval('[data-test=sketch-plane]', (el) => el.textContent))
check((await page.$('[data-test=sketch-viewport]')) !== null, 'the sketch takes the stage on the 2D sheet')
// The sheet lies over the 3D viewport, which turns to face the sketch
// plane and is cut open at it, since the plane runs through the cube; the
// view bar's keys show the whole part again and put the model away.
const modelShown = () => page.evaluate(() => !document.querySelector('.viewslot').hidden)
check((await modelShown()) && (await page.$('.viewslot.sketch')) !== null, 'the sketch is drawn over the 3D model')
await page.waitForFunction(() => window.__re.scene() && !window.__re.scene().turning(), { timeout: 5_000 }).catch(() => {})
check(await page.evaluate(() => window.__re.scene().sliced()), 'the model is cut open at the sketch plane')
// The two cameras agree: the part is at the sheet's scale, face on to the
// XY plane, so a line on the sheet lies on the part under it.
const agree = await page.evaluate(() => {
  const view = window.__re.scene().viewLink()
  const h = document.querySelector('.viewslot canvas').clientHeight
  const e = view.camera.matrixWorld.elements
  return {
    upp3d: (view.camera.top - view.camera.bottom) / view.camera.zoom / h,
    upp2d: window.__re.sheet().sheetView().unitsPerScreenPx,
    // The camera's own +Z in the world: +Z for a camera looking down −Z.
    axis: [e[8], e[9], e[10]],
  }
})
console.log('scales:', JSON.stringify(agree))
check(Math.abs(agree.upp3d - agree.upp2d) < 1e-6 * agree.upp2d, 'the part under the sheet is at the sheet’s scale')
check(Math.abs(agree.axis[2] - 1) < 1e-3, 'and faces the sketch plane')
await page.screenshot({ path: shotPath('reverse-sketch-model.png') })
await click(page, '[data-test=sketch-part-full]')
await sleep(200)
check(!(await page.evaluate(() => window.__re.scene().sliced())), 'Full part shows the whole part again')
await click(page, '[data-test=sketch-part-cut]')
await sleep(100)
check(await page.evaluate(() => window.__re.scene().sliced()), 'and Section cuts it open again')
await click(page, '[data-test=sketch-part-none]')
await sleep(200)
check(!(await modelShown()), 'No part puts the model away under the sketch')
await click(page, '[data-test=sketch-part-cut]')
await sleep(300)
check(await modelShown(), 'and Section brings it back')
check(/Needs input/.test(await page.$eval('[data-test=sketch-status]', (el) => el.textContent)), 'an empty sketch says it needs input')
check((await page.$('[data-test=sketch-feature-keys]')) === null, 'and offers no feature yet')
await click(page, '[data-test=sketch-fit-all]')
await sleep(300)
const counts = () => page.$eval('[data-test=sketch-counts]', (el) => el.textContent)
console.log('after fit:', await counts())
check(/4 pieces/.test(await counts()), 'the square slice is cut into four lines')
await click(page, '[data-test=sketch-infer]')
await sleep(300)
console.log('after corners:', await counts())
check(/1 region/.test(await counts()), 'corner inference closes them into one region')
check(/Solved/.test(await page.$eval('[data-test=sketch-status]', (el) => el.textContent)), 'the sketch solves')
check((await page.$('[data-test=sketch-extrude]')) !== null && (await page.$('[data-test=sketch-revolve]')) !== null, 'Extrude and Revolve are offered as soon as a region closes')
await page.screenshot({ path: shotPath('reverse-sketch.png') })
const canvas = await page.$eval('[data-test=sketch-viewport] canvas', (el) => {
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
// A middle click on the stage finishes the sketch, as it confirms
// everything else in the tool.
await page.mouse.click(canvas.x, canvas.y, { button: 'middle' })
await sleep(300)
check((await page.$('[data-test=sketch-editor]')) === null, 'a middle click finishes the sketch')
const featureRows = () => page.$$eval('[data-test=feature-row]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
console.log('features:', JSON.stringify(await featureRows()))
check((await featureRows()).length === 1 && /^Sketch 1/.test((await featureRows())[0]), 'the sketch is a feature')
check(/XY plane/.test(await page.$eval('[data-test=feature-row]', (el) => el.title)), 'its row names the plane it lies on in its tooltip')

// ---- extrude between the cube's faces ----------------------------------------------
// The sketch's one region is picked as the extrude opens, and the kernel
// shows the body it would make before it is created.
await click(page, '[data-test=feature-extrude]')
await page.waitForSelector('[data-test=extrude-editor]')
const profiles = () => page.$eval('[data-test=extrude-profiles]', (el) => el.textContent)
console.log('profiles:', await profiles())
check(/1 of 1 picked/.test(await profiles()), 'the sketch’s one region is picked as the extrude opens')
const previewText = () => page.$eval('[data-test=extrude-preview]', (el) => el.textContent)
await page.waitForFunction(() => /Preview:/.test(document.querySelector('[data-test=extrude-preview]')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {})
console.log('preview:', await previewText())
check(/Preview: 4000\.0 mm³/.test(await previewText()), 'the default 10 mm extrude previews at 4000 mm³ before it is created')
// Reverse direction turns the extrude over: the numbers change sign and
// the body is the same size behind the plane.
await click(page, '[data-test=extrude-flip]')
await sleep(150)
check(Number(await page.$eval('[data-test=extrude-to]', (el) => el.value)) === -10, 'Reverse direction turns the extrude the other way (To −10)')
await page.waitForFunction(() => /Preview: 4000\.0/.test(document.querySelector('[data-test=extrude-preview]')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {})
check(/Preview: 4000\.0 mm³/.test(await previewText()), 'and the body behind the plane is the same size')
// Tab walks from one number to the next, not to the ⓘ between them.
// To stands above From in the box.
await page.focus('[data-test=extrude-to]')
await page.keyboard.press('Tab')
check((await page.evaluate(() => document.activeElement?.getAttribute('data-test'))) === 'extrude-from', 'Tab goes from To straight to From')
const typeInto = enterTyper(page)
await typeInto('[data-test=extrude-from]', -SIZE / 2)
await typeInto('[data-test=extrude-to]', SIZE / 2)
await page.waitForFunction(() => /Preview: 8000\.0/.test(document.querySelector('[data-test=extrude-preview]')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {})
console.log('preview:', await previewText())
check(/Preview: 8000\.0 mm³/.test(await previewText()), 'the preview follows the numbers typed')

// ---- the live deviation map ---------------------------------------------------------
// The ghost colours the scan near it by its signed distance on the
// Deviation ramp: green where the scan lies on the ghost, the red cap where
// the scan stands off outside it, the blue cap where the ghost has swallowed
// it. Read at the scan's vertex nearest the middle of the cube's top face.
const GREEN = [0, 200, 0]
const RED_CAP = [130, 0, 0]
const BLUE_CAP = [0, 0, 110]
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const mapTick = () => page.evaluate(() => window.__re.store.getState().mapReport?.tick ?? 0)
const waitMap = async (after) => {
  await page.waitForFunction((t) => (window.__re.store.getState().mapReport?.tick ?? 0) > t, { timeout: 30_000 }, after).catch(() => {})
  return page.evaluate(() => window.__re.store.getState().mapReport)
}
const topColor = () => page.evaluate((z) => window.__re.colorNear([0, 0, z]), SIZE / 2)
check((await page.$('[data-test=extrude-analysis]')) !== null && (await page.$eval('[data-test=re-analysis-on]', (el) => el.checked)), 'the extrude box carries the deviation map, on')
check(Number(await page.$eval('[data-test=re-analysis]', (el) => el.value)) === 0.1, 'at ±0.1 mm')
let report = await waitMap(0)
console.log('map on the cube:', JSON.stringify(report), 'top:', JSON.stringify(await topColor()))
check(report && report.source === 'ghost' && report.points > 1000 && report.within === report.points, 'the ghost of the cube reads every scan point near it within range')
check(/of .* scan points near the ghost lie within/.test(await page.$eval('[data-test=extrude-map]', (el) => el.textContent)), 'and the box says so')
check(same(await topColor(), GREEN), 'the top face of the scan is painted green on the ghost')
check((await page.$('[data-test=re-map-legend]')) !== null, 'the legend beside the viewport shows the ramp')
let tick = await mapTick()
await typeInto('[data-test=extrude-to]', SIZE / 2 - 0.5)
report = await waitMap(tick)
console.log('ghost short of the face:', JSON.stringify(report), 'top:', JSON.stringify(await topColor()))
check(same(await topColor(), RED_CAP), 'with the ghost 0.5 mm short of the face, the face wears the red cap — the scan stands outside the body')
check(report.within < report.points, 'and the box counts those points as out of range')
tick = await mapTick()
await typeInto('[data-test=extrude-to]', SIZE / 2 + 0.5)
await waitMap(tick)
console.log('ghost past the face, top:', JSON.stringify(await topColor()))
check(same(await topColor(), BLUE_CAP), 'with the ghost 0.5 mm past the face, the face wears the blue cap — the scan lies inside the body')
// A wider range reads the same half millimetre on the ramp instead of the cap.
tick = await mapTick()
await typeInto('[data-test=re-analysis]', 1)
await waitMap(tick)
const wide = await topColor()
console.log('at ±1 mm, top:', JSON.stringify(wide))
check(wide && !same(wide, BLUE_CAP) && wide[2] > wide[0], 'at ±1 mm the same half millimetre reads on the blue side of the ramp')
await typeInto('[data-test=re-analysis]', 0.1)
await sleep(300)
// The switch lifts the map: the face is neither green nor a cap, just scan.
await page.click('[data-test=re-analysis-on]')
await page.waitForFunction(() => window.__re.store.getState().mapReport === null, { timeout: 10_000 }).catch(() => {})
const bare = await topColor()
console.log('map off, top:', JSON.stringify(bare))
check(bare && !same(bare, GREEN) && !same(bare, BLUE_CAP) && !same(bare, RED_CAP), 'the switch lifts the map off the scan')
check((await page.$('[data-test=re-analysis]')) === null, 'and puts the range field away')
await page.click('[data-test=re-analysis-on]')
tick = await mapTick()
await typeInto('[data-test=extrude-to]', SIZE / 2)
await waitMap(tick)
check(same(await topColor(), BLUE_CAP) === false && same(await topColor(), GREEN), 'switched back on, the map returns with the ghost')
await page.screenshot({ path: shotPath('reverse-live-map.png') })
// A number off the round is offered its nominal beside the field.
await typeInto('[data-test=extrude-to]', 9.97)
await sleep(150)
check((await page.$('[data-test=extrude-to-nominal]')) !== null && /10 mm/.test(await page.$eval('[data-test=extrude-to-nominal]', (el) => el.textContent)), 'a To of 9.97 offers the nominal 10 mm as a chip')
await click(page, '[data-test=extrude-to-nominal]')
await sleep(150)
check(Number(await page.$eval('[data-test=extrude-to]', (el) => el.value)) === 10, 'and the chip takes it')
check((await page.$('[data-test=extrude-to-nominal]')) === null, 'after which no chip is offered')
// A grip taken hold of wears a field with its number; let go, the field
// takes typing — Enter sets the number, Escape closes the field. The hold
// is made through the store here: a real drag needs the arrow's place on
// screen, and the field is what is under test.
await page.evaluate(() => {
  const re = window.__re.store.getState()
  re.gripDrag('extrudeTo', 0, 'start')
  re.gripDrag('extrudeTo', 0, 'end')
})
await page.waitForSelector('[data-test=grip-field]', { timeout: 5_000 }).catch(() => {})
check((await page.$('[data-test=grip-field]')) !== null, 'a grip taken hold of wears a field with its number')
check(Number(await page.$eval('[data-test=grip-field]', (el) => el.value)) === 10, 'reading the To of 10')
await page.focus('[data-test=grip-field]')
await page.$eval('[data-test=grip-field]', (el) => (el.value = ''))
await page.type('[data-test=grip-field]', '12')
await page.keyboard.press('Enter')
await sleep(200)
check(Number(await page.$eval('[data-test=extrude-to]', (el) => el.value)) === 12, 'a number typed into the field sets To')
await page.focus('[data-test=grip-field]')
await page.$eval('[data-test=grip-field]', (el) => (el.value = ''))
await page.type('[data-test=grip-field]', '10')
await page.keyboard.press('Enter')
await sleep(200)
await page.focus('[data-test=grip-field]')
await page.keyboard.press('Escape')
await sleep(200)
check((await page.$('[data-test=grip-field]')) === null, 'Escape in the field closes it')
check((await page.$('[data-test=extrude-editor]')) !== null && Number(await page.$eval('[data-test=extrude-to]', (el) => el.value)) === 10, 'and leaves the extrude open at the number typed')
await page.screenshot({ path: shotPath('reverse-preview.png') })
await click(page, '[data-test=extrude-create]')
await page.waitForSelector('[data-test=body-row]', { timeout: 60_000 })
await sleep(500)
// The row's reading alone: the name and the figure are separate elements,
// and run together in textContent.
const bodyRows = () => page.$$eval('[data-test=body-row]', (els) => els.map((e) => e.querySelector('b').textContent.trim()))
console.log('bodies:', JSON.stringify(await bodyRows()))
const volume = Number((/([\d.]+) mm³/.exec((await bodyRows())[0]) ?? [])[1])
check(Math.abs(volume - SIZE ** 3) < 1, `the body has the cube's volume (${volume} mm³)`)
await page.screenshot({ path: shotPath('reverse-body.png') })

// The bodies are see-through over the scan; the view bar's Scan key puts
// the scan away.
check((await page.$('[data-test=toggle-scan]:not([aria-disabled])')) !== null, 'the view bar offers the Scan key once there is a body')
await click(page, '[data-test=toggle-scan]')
await sleep(300)
await page.screenshot({ path: shotPath('reverse-body-solid.png') })
await click(page, '[data-test=toggle-scan]')
// The menus over the Scan and Bodies keys turn it round: the scan solid,
// the bodies see-through over it — and back.
await viewOption(page, 'toggle-scan', 'toggle-translucent')
await viewOption(page, 'toggle-bodies', 'toggle-bodies-transparent')
await sleep(300)
const turned = await page.evaluate(() => {
  const body = [...window.__re.reScene().bodyMeshes.values()][0]
  return { scan: window.__re.scene().mesh.material.opacity, body: body.material.transparent, dot: Boolean(document.querySelector('[data-test=toggle-scan] .partdot')) }
})
console.log('turned round:', JSON.stringify(turned))
check(turned.scan === 1 && turned.body && turned.dot, 'the scan solid and the bodies see-through, the Scan key dotted for it')
await page.screenshot({ path: shotPath('reverse-body-see-through.png') })
await viewOption(page, 'toggle-scan', 'toggle-translucent')
await viewOption(page, 'toggle-bodies', 'toggle-bodies-transparent')
// The tangent edges, three ways, in the Bodies key's menu.
await viewOption(page, 'toggle-bodies', 'tangent-edges-removed')
check(await page.evaluate(() => window.__re.store.getState().tangentEdges === 'removed'), 'the menu over the Bodies key leaves the tangent edges out')
await viewOption(page, 'toggle-bodies', 'tangent-edges-visible')
// The Bodies key puts the bodies away as a whole — not drawn, still in
// the model: every body's own eye stays open.
check((await page.$('[data-test=toggle-bodies]:not([aria-disabled])')) !== null, 'the view bar offers the Bodies key once there is a body')
await click(page, '[data-test=toggle-bodies]')
await sleep(300)
const putAway = await page.evaluate(() => ({ hidden: window.__re.store.getState().bodiesHidden, eyes: window.__re.store.getState().bodies.map((b) => b.visible), drawn: window.__re.reScene().bodiesBox() !== null }))
console.log('bodies put away:', JSON.stringify(putAway))
check(putAway.hidden && putAway.eyes.every(Boolean) && !putAway.drawn, 'the Bodies key puts the bodies away without shutting their eyes, and nothing of them is drawn')
await page.screenshot({ path: shotPath('reverse-bodies-away.png') })
await click(page, '[data-test=toggle-bodies]')
await sleep(300)
check(await page.evaluate(() => !window.__re.store.getState().bodiesHidden && window.__re.reScene().bodiesBox() !== null), 'and brings them back')
// The Deviation key reads the scan against the committed bodies the same
// way the ghost's map did, with no editor open.
check((await page.$('[data-test=toggle-body-map]:not([disabled])')) !== null, 'the view bar offers the Deviation key once there is a body')
check((await page.evaluate(() => window.__re.store.getState().mapReport)) === null, 'with the editor closed, no map is up')
tick = await mapTick()
await click(page, '[data-test=toggle-body-map]')
report = await waitMap(tick)
console.log('map on the body:', JSON.stringify(report), 'top:', JSON.stringify(await topColor()))
check(report && report.source === 'bodies' && report.within === report.points && report.points > 1000, 'the key colours the scan against the body: every point near it within range')
check(same(await topColor(), GREEN), 'the top face is green on the body')
await page.screenshot({ path: shotPath('reverse-body-map.png') })
await click(page, '[data-test=toggle-body-map]')
await page.waitForFunction(() => window.__re.store.getState().mapReport === null, { timeout: 10_000 }).catch(() => {})
check(!same(await topColor(), GREEN), 'and the key lifts it again')

// ---- editing the extrude's distance ---------------------------------------------------
// The extrude's row is opened, its To typed over and saved: the features
// rebuild and the body follows. While the box is open the part is rolled
// back to before the extrude — the row after it is drawn set aside.
await page.evaluate(() => [...document.querySelectorAll('[data-test=feature-row]')][1].querySelector('[data-test=edit-element]').click())
await page.waitForSelector('[data-test=extrude-editor]')
check(Number(await page.$eval('[data-test=extrude-to]', (el) => el.value)) === SIZE / 2, 'the extrude opens with its To of 10 mm')
check((await page.$$eval('[data-test=feature-row]', (els) => els.map((e) => e.dataset.rolled === 'true'))).slice(2).every(Boolean), 'and the rows after it are drawn set aside')
await typeInto('[data-test=extrude-to]', SIZE / 2 + 2)
await click(page, '[data-test=extrude-create]')
await page.waitForFunction(() => !document.querySelector('[data-test=extrude-editor]'), { timeout: 10_000 })
await page.waitForFunction((want) => /([\d.]+) mm³/.exec(document.querySelector('[data-test=body-row] b')?.textContent ?? '')?.[1] === want, { timeout: 60_000 }, (SIZE * SIZE * (SIZE + 2)).toFixed(1)).catch(() => {})
console.log('after the edit:', JSON.stringify(await bodyRows()))
check(Math.abs(Number((/([\d.]+) mm³/.exec((await bodyRows())[0]) ?? [])[1]) - SIZE * SIZE * (SIZE + 2)) < 0.5, 'typing 12 into To makes the body 22 mm tall')
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction((want) => /([\d.]+) mm³/.exec(document.querySelector('[data-test=body-row] b')?.textContent ?? '')?.[1] === want, { timeout: 60_000 }, (SIZE ** 3).toFixed(1)).catch(() => {})
check(Math.abs(Number((/([\d.]+) mm³/.exec((await bodyRows())[0]) ?? [])[1]) - SIZE ** 3) < 0.5, 'and Ctrl+Z takes it back to 20')

// ---- a fillet and a shell on the body -------------------------------------------------
// The features on a body pick their faces and edges on the part; here the
// picks go through the store with the body's topology, which the app
// exposes for it. The cube's edges are sharp, so the fillet's reading off
// the scan finds no round and the default radius stands; a shell opened at
// the top face leaves a 2 mm wall. Each is taken back with Ctrl+Z.
const bodyStill = async (want) => {
  await page
    .waitForFunction(
      (v) => {
        const row = document.querySelector('[data-test=body-row] b')?.textContent ?? ''
        const m = /([\d.]+) mm³/.exec(row)
        return m && Math.abs(Number(m[1]) - v) < 0.5 && !window.__re.store.getState().building
      },
      { timeout: 60_000 },
      want,
    )
    .catch(() => {})
  return Number((/([\d.]+) mm³/.exec((await bodyRows())[0]) ?? [])[1])
}
await click(page, '[data-test=feature-fillet]')
await page.waitForSelector('[data-test=fillet-editor]')
const filletPicked = await page.evaluate(() => {
  const re = window.__re.store.getState()
  const body = re.bodies[0].id
  const topo = window.__re.topology(body)
  const e = topo.edges.find((x) => x.fingerprint.kind === 'line' && x.fingerprint.mid[2] > 9.9 && Math.abs(x.fingerprint.mid[1] + 10) < 1e-6)
  if (e) re.toggleDraftEdge(body, e)
  return e ? e.fingerprint.mid : null
})
console.log('fillet edge:', JSON.stringify(filletPicked))
check(filletPicked !== null && /1 edge picked/.test(await page.$eval('[data-test=fillet-edges]', (el) => el.textContent)), 'an edge of the body is picked for the fillet')
await page.waitForFunction(() => /No round found|read off the scan/.test(document.querySelector('[data-test=fillet-estimate]')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {})
console.log('fillet estimate:', await page.$eval('[data-test=fillet-estimate]', (el) => el.textContent))
check(/No round found/.test(await page.$eval('[data-test=fillet-estimate]', (el) => el.textContent)), 'the cube’s sharp edge shows no round on the scan, so the default radius stands')
check(Number(await page.$eval('[data-test=fillet-radius]', (el) => el.value)) === 1, 'at 1 mm')
await page.waitForFunction(() => /Preview:/.test(document.querySelector('[data-test=fillet-preview]')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {})
console.log('fillet preview:', await page.$eval('[data-test=fillet-preview]', (el) => el.textContent))
await page.screenshot({ path: shotPath('reverse-fillet.png') })
await click(page, '[data-test=fillet-create]')
const filletVolume = await bodyStill(SIZE ** 3 - (1 - Math.PI / 4) * SIZE)
console.log('after the fillet:', JSON.stringify(await featureRows()), filletVolume)
check(Math.abs(filletVolume - (SIZE ** 3 - (1 - Math.PI / 4) * SIZE)) < 0.5, `the fillet takes (1 − π/4) r² L off the cube (${filletVolume} mm³)`)
check((await featureRows()).some((r) => /^Fillet 1/.test(r)) && (await page.$$eval('[data-test=feature-row]', (els) => els.filter((e) => /^Fillet 1/.test(e.textContent)).map((e) => e.title))).some((t) => /R 1 mm/.test(t)), 'and its row reads the radius in its tooltip')
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await bodyStill(SIZE ** 3)
check(!(await featureRows()).some((r) => /^Fillet/.test(r)), 'Ctrl+Z takes the fillet back')

await click(page, '[data-test=feature-shell]')
await page.waitForSelector('[data-test=shell-editor]')
await page.evaluate(() => {
  const re = window.__re.store.getState()
  const body = re.bodies[0].id
  const topo = window.__re.topology(body)
  const top = topo.faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.99)
  if (top) re.toggleDraftFace(body, top)
})
check(/1 face picked/.test(await page.$eval('[data-test=shell-faces]', (el) => el.textContent)), 'the top face is picked to open the shell')
check(/2 mm to start/.test(await page.$eval('[data-test=shell-source]', (el) => el.textContent)), 'with no Thickness map the wall starts at 2 mm')
await page.waitForFunction(() => /Preview:/.test(document.querySelector('[data-test=shell-preview]')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {})
console.log('shell preview:', await page.$eval('[data-test=shell-preview]', (el) => el.textContent))
await page.screenshot({ path: shotPath('reverse-shell.png') })
await click(page, '[data-test=shell-create]')
const shellVolume = await bodyStill(SIZE ** 3 - 16 * 16 * 18)
console.log('after the shell:', JSON.stringify(await featureRows()), shellVolume)
check(Math.abs(shellVolume - (SIZE ** 3 - 16 * 16 * 18)) < 0.5, `the shell leaves a 2 mm wall open at the top (${shellVolume} mm³)`)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await bodyStill(SIZE ** 3)
check(!(await featureRows()).some((r) => /^Shell/.test(r)) && Math.abs((await bodyStill(SIZE ** 3)) - SIZE ** 3) < 0.5, 'Ctrl+Z takes the shell back and the cube is whole')

// ---- a pattern of the body ------------------------------------------------------------
// Two cubes side by side along X, standing apart: the body and its copy,
// a body each — one body is one solid; taken back with Ctrl+Z.
await click(page, '[data-test=feature-pattern]')
await page.waitForSelector('[data-test=pattern-editor]')
await selectByLabel(page, '[data-test=pattern-mode]', 'Linear, along a direction')
await pickOption(page, '[data-test=pattern-axis]', 'X axis')
await typeInto('[data-test=pattern-count]', 2)
await typeInto('[data-test=pattern-step]', 25)
await page.waitForFunction(() => /Preview:/.test(document.querySelector('[data-test=pattern-preview]')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {})
console.log('pattern preview:', await page.$eval('[data-test=pattern-preview]', (el) => el.textContent))
await click(page, '[data-test=pattern-create]')
await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 2 && !window.__re.store.getState().building, { timeout: 60_000 }).catch(() => {})
const patterned = (await bodyRows()).map((r) => Number((/([\d.]+) mm³/.exec(r) ?? [])[1]))
console.log('after the pattern:', JSON.stringify(await featureRows()), JSON.stringify(patterned))
check(patterned.length === 2 && patterned.every((v) => Math.abs(v - SIZE ** 3) < 0.5), `a linear pattern of two cubes apart makes two bodies of the cube's volume (${patterned.join(', ')} mm³)`)
check((await featureRows()).some((r) => /^Pattern 1/.test(r)) && (await page.$$eval('[data-test=feature-row]', (els) => els.filter((e) => /^Pattern 1/.test(e.textContent)).map((e) => e.title))).some((t) => /2 × every 25 mm/.test(t)), 'and its row reads the count and the spacing in its tooltip')
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await bodyStill(SIZE ** 3)
check(!(await featureRows()).some((r) => /^Pattern/.test(r)), 'Ctrl+Z takes the pattern back')

// ---- a hand-drawn rectangle, extruded and cut away -------------------------------
await pickOption(page, '[data-test=sketch-plane-select]', 'XY plane through the centre')
await page.waitForSelector('[data-test=sketch-editor]')
await sleep(400)
// A line drawn nearly level is made horizontal, and the relation shows as
// a chip that can be taken off.
await click(page, '[data-test=sketch-tool-line]')
await page.mouse.click(canvas.x - 60, canvas.y + 70)
await sleep(100)
await page.mouse.click(canvas.x + 60, canvas.y + 71)
await sleep(300)
const inferredChips = () => page.$$eval('[data-test=sketch-inferred-chip]', (els) => els.map((e) => e.textContent))
console.log('inferred:', JSON.stringify(await inferredChips()))
check((await inferredChips()).some((t) => /^H /.test(t)), 'a line drawn within 3° of level gets a horizontal relation, shown as a chip')
await page.evaluate(() => document.querySelector('[data-test=sketch-inferred-chip] button').click())
await sleep(200)
check((await inferredChips()).length === 0, 'and the chip’s × takes it off')
await click(page, '[data-test=undo]')
await click(page, '[data-test=undo]')
await sleep(200)
check(/0 pieces/.test(await counts()), 'Undo takes the line away again')

// ---- a chain of lines, a tangent arc, a click that selects, D for a dimension ----
// The Line tool is still in hand. Three clicks are two lines, the second
// from the end of the first; a press on the last end, dragged, swings an
// arc out of it tangent to the line before; Escape ends the chain.
const draftOf = (fn) => page.evaluate(fn)
await page.mouse.click(canvas.x - 80, canvas.y + 70)
await sleep(100)
await page.mouse.click(canvas.x - 20, canvas.y + 40)
await sleep(100)
await page.mouse.click(canvas.x + 40, canvas.y + 70)
await sleep(250)
check(/2 pieces/.test(await counts()), 'the Line tool draws a chain: three clicks, two lines')
check((await draftOf(() => window.__re.store.getState().sketchDraft.sketch.constraints.filter((c) => c.kind === 'coincident').length)) === 1, 'joined where one ends and the next begins')
await page.mouse.move(canvas.x + 40, canvas.y + 70)
await sleep(150)
await page.mouse.down()
await page.mouse.move(canvas.x + 50, canvas.y + 66, { steps: 4 })
await page.mouse.move(canvas.x + 90, canvas.y + 50, { steps: 6 })
await sleep(150)
await page.screenshot({ path: shotPath('reverse-tangent-arc.png') })
await page.mouse.up()
await sleep(300)
const arcMade = await draftOf(() => {
  const s = window.__re.store.getState().sketchDraft.sketch
  return { arcs: s.entities.filter((e) => e.kind === 'arc').length, tangent: s.constraints.some((c) => c.kind === 'tangent') }
})
console.log('tangent arc:', JSON.stringify(arcMade), await counts())
check(arcMade.arcs === 1 && arcMade.tangent, 'a press on the chain’s last end, dragged, draws an arc tangent to the line before it')
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
await sleep(150)
check((await draftOf(() => window.__re.store.getState().sketchDraft.pending.length)) === 0, 'Escape ends the chain')

// The relations are there and not drawn, until asked for.
const glyphs = () => page.$$eval('[data-test=sketch-viewport] .glyph', (els) => els.length)
check((await glyphs()) === 0, 'the relations’ glyphs are hidden by default')
await click(page, '[data-test=sketch-show-relations]')
await sleep(200)
check((await glyphs()) > 0, 'and shown by the key beside the tools')
await click(page, '[data-test=sketch-show-relations]')
await sleep(200)

// A click on a piece selects it, and it stays selected: the press that
// might have been a drag no longer selects what the click then takes off.
await click(page, '[data-test=sketch-tool-select]')
await page.evaluate(() => document.activeElement?.blur())
await page.mouse.click(canvas.x - 50, canvas.y + 55)
await sleep(400)
check((await draftOf(() => window.__re.store.getState().sketchDraft.selection.length)) === 1, 'a click on a piece selects it, and it stays selected')
await page.keyboard.press('Escape')
await sleep(150)

// D takes the Dimension tool: the line clicked is its length, its number
// following the cursor; a click on the bare sheet puts it down there and
// opens it, on the sheet, to be typed into.
await page.keyboard.press('d')
await sleep(150)
check((await draftOf(() => window.__re.store.getState().sketchDraft.tool)) === 'dimension', 'D takes the Dimension tool with nothing selected')
await page.mouse.click(canvas.x - 50, canvas.y + 55)
await sleep(150)
await page.mouse.click(canvas.x, canvas.y - 20)
await sleep(300)
check((await draftOf(() => window.__re.store.getState().sketchDraft.sketch.constraints.filter((c) => c.kind === 'length').length)) === 1, 'a line clicked, then the bare sheet, is dimensioned by its length')
check(
  await page.evaluate(() => document.activeElement instanceof HTMLInputElement && document.activeElement.closest('.sketch-dim') !== null),
  'and its number opens on the sheet where it was put down, with the focus',
)
await page.keyboard.type('30')
await page.keyboard.press('Enter')
await sleep(300)
const typedLength = await draftOf(() => {
  const s = window.__re.store.getState().sketchDraft.sketch
  const c = s.constraints.find((x) => x.kind === 'length')
  const l = s.entities.find((e) => e.id === c.entity)
  return Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])
})
console.log('dimensioned length:', typedLength)
check(Math.abs(typedLength - 30) < 1e-3, 'the value typed there is the line’s length')
await page.screenshot({ path: shotPath('reverse-sketch-tools.png') })
// All of it taken back, for the rectangle below.
for (let i = 0; i < 30 && !/^0 pieces/.test(await counts()); i++) {
  await click(page, '[data-test=undo]')
  await sleep(80)
}
check(/^0 pieces/.test(await counts()), 'Undo in the top bar walks the drawing back to nothing')
await click(page, '[data-test=sketch-tool-rectangle]')
// Two corners a quarter of the canvas apart, inside the square — with the
// cursor moved between them, the way a hand draws, so the rubber band shows.
await page.mouse.click(canvas.x - 40, canvas.y - 40)
await sleep(150)
await page.mouse.move(canvas.x, canvas.y)
await sleep(100)
await page.mouse.move(canvas.x + 40, canvas.y + 40)
await sleep(150)
await page.screenshot({ path: shotPath('reverse-rubber-band.png') })
await page.mouse.click(canvas.x + 40, canvas.y + 40)
await sleep(300)
console.log('rectangle:', await counts())
check(/4 pieces · 1 region/.test(await counts()), 'two clicks draw a rectangle that closes into a region')

// A corner dragged with the Select tool carries both its sides along, and
// the rectangle stays closed.
const rectBefore = await page.evaluate(() => JSON.stringify(window.__re.store.getState().sketchDraft.sketch.entities.map((e) => [e.a, e.b])))
await click(page, '[data-test=sketch-tool-select]')
// The key that was clicked would otherwise take the Enter below.
await page.evaluate(() => document.activeElement?.blur())
await page.mouse.move(canvas.x + 40, canvas.y + 40)
await sleep(150)
await page.mouse.down()
await page.mouse.move(canvas.x + 50, canvas.y + 50, { steps: 4 })
await page.mouse.move(canvas.x + 70, canvas.y + 60, { steps: 6 })
await page.mouse.up()
await sleep(300)
const rectAfter = await page.evaluate(() => JSON.stringify(window.__re.store.getState().sketchDraft.sketch.entities.map((e) => [e.a, e.b])))
console.log('dragged:', await counts())
check(rectAfter !== rectBefore, 'dragging a corner moves the rectangle')
check(/4 pieces · 1 region/.test(await counts()), 'and it is still one closed region')
const closedCorners = await page.evaluate(() => {
  const s = window.__re.store.getState().sketchDraft.sketch
  const pts = s.entities.flatMap((e) => [e.a, e.b])
  // Every end has another end on top of it.
  return pts.every((p) => pts.filter((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6).length >= 2)
})
check(closedCorners, 'the joined corners moved together')

// A line dragged by its body moves square to itself: the hand goes off
// diagonally, the side goes straight out and the rectangle stays one.
const sidesBefore = await page.evaluate(() => window.__re.store.getState().sketchDraft.sketch.entities.map((e) => ({ id: e.id, a: e.a, b: e.b })))
await page.mouse.move(canvas.x + 15, canvas.y - 40)
await sleep(150)
await page.mouse.down()
await page.mouse.move(canvas.x + 25, canvas.y - 50, { steps: 4 })
await page.mouse.move(canvas.x + 45, canvas.y - 70, { steps: 6 })
await page.mouse.up()
await sleep(300)
const sidesAfter = await page.evaluate(() => window.__re.store.getState().sketchDraft.sketch.entities.map((e) => ({ id: e.id, a: e.a, b: e.b })))
const far = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01
const carried = sidesAfter.filter((l) => {
  const b = sidesBefore.find((x) => x.id === l.id)
  return b && far(l.a, b.a) && far(l.b, b.b)
})
const side = carried[0]
const sideBefore = side && sidesBefore.find((x) => x.id === side.id)
console.log('side dragged:', JSON.stringify(sideBefore), '→', JSON.stringify(side))
check(
  carried.length === 1 &&
    Math.abs(side.a[0] - sideBefore.a[0]) < 1e-6 &&
    Math.abs(side.b[0] - sideBefore.b[0]) < 1e-6 &&
    Math.abs(side.a[1] - sideBefore.a[1]) > 0.5,
  'a line dragged by its body moves square to itself, whichever way the hand goes',
)
check(/4 pieces · 1 region/.test(await counts()), 'and the rectangle is still one closed region')

// Escape never closes the sketch: the first clears the selection the drag
// left, and any number more leave the tool in hand and nothing else.
check((await page.evaluate(() => window.__re.store.getState().sketchDraft.selection.length)) > 0, 'the drag left the piece selected')
await page.keyboard.press('Escape')
await sleep(200)
check((await page.evaluate(() => window.__re.store.getState().sketchDraft.selection.length)) === 0, 'Escape clears the selection')
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
await sleep(200)
check((await page.$('[data-test=sketch-editor]')) !== null, 'and does not close the sketch')
check((await page.$('[data-test=sketch-cancel]')) === null, 'there is no Cancel key in the sketch')
check((await page.$('[data-test=sketch-finish-top]')) !== null && (await page.$('[data-test=sketch-finish]')) !== null, 'Finish sketch stands at the top and the bottom of the box')

// Extrude in the sketch box finishes the sketch and opens the extrude on
// it with its one region picked — no visit to the panel's keys.
await click(page, '[data-test=sketch-extrude]')
await page.waitForSelector('[data-test=extrude-editor]')
await sleep(200)
check((await featureRows()).length === 3, 'Extrude in the sketch box finishes the second sketch')
check(/Sketch 2/.test(await page.$eval('[data-test=extrude-sketch]', (el) => el.options[el.selectedIndex].text)), 'and opens the extrude on it')
check(/1 of 1 picked/.test(await profiles()), 'with its one region picked')
await page.select('[data-test=extrude-extent]', 'symmetric')
await typeInto('[data-test=extrude-total]', 30)
await page.select('[data-test=extrude-op]', 'cut')
await sleep(100)
// The cut is made by a middle click on the part, as the sketch was.
await page.mouse.click(rect3d.x, rect3d.y, { button: 'middle' })
await page.waitForFunction(() => !document.querySelector('[data-test=extrude-editor]'), { timeout: 10_000 })
check(true, 'a middle click creates the extrude')
await page.waitForFunction(
  (v) => {
    const row = document.querySelector('[data-test=body-row] b')?.textContent ?? ''
    const m = /([\d.]+) mm³/.exec(row)
    return m && Math.abs(Number(m[1]) - v) > 1
  },
  { timeout: 60_000 },
  volume,
)
const cutVolume = Number((/([\d.]+) mm³/.exec((await bodyRows())[0]) ?? [])[1])
console.log('after the cut:', JSON.stringify(await bodyRows()))
check(cutVolume < volume - 100 && cutVolume > 0, `the cut takes a square hole out of the body (${cutVolume} mm³)`)
await page.screenshot({ path: shotPath('reverse-cut.png') })

// ---- the sketch edited under the extrude --------------------------------------------
// A corner of the square hole is moved and the sketch saved: the cut keeps
// its profile — the pick is a fingerprint of the face, not of where its
// middle happened to be — and the hole is a different size.
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-test=feature-row]')]
  rows[2].querySelector('[data-test=edit-element]').click()
})
await page.waitForSelector('[data-test=sketch-editor]')
await page.evaluate(() => {
  const re = window.__re.store.getState()
  const line = re.sketchDraft.sketch.entities.find((e) => e.kind === 'line')
  re.sketchDragStart(line.a, 0.5)
  window.__re.store.getState().sketchDrag([line.a[0] + 4, line.a[1] + 3], 0.5, { chains: null, grid: null, off: true })
  window.__re.store.getState().sketchDragEnd()
  document.activeElement?.blur()
})
await sleep(200)
console.log('edited hole:', await counts())
check(/4 pieces · 1 region/.test(await counts()), 'the hole is still one closed region after its corner moved')
await page.keyboard.press('Enter')
await page.waitForFunction(() => !document.querySelector('[data-test=sketch-editor]'), { timeout: 10_000 })
await page.waitForFunction(
  (v) => {
    const row = document.querySelector('[data-test=body-row] b')?.textContent ?? ''
    const m = /([\d.]+) mm³/.exec(row)
    return m && Math.abs(Number(m[1]) - v) > 0.5
  },
  { timeout: 60_000 },
  cutVolume,
).catch(() => {})
const rowsAfterEdit = await featureRows()
console.log('after the edit:', JSON.stringify(rowsAfterEdit), JSON.stringify(await bodyRows()))
check(!rowsAfterEdit.some((r) => /no longer closed|⚠/.test(r)), 'the cut keeps its profile through the edit of its sketch')
check(await page.evaluate(() => Object.values(window.__re.store.getState().results).every((r) => r.status === 'ok')), 'every feature builds after the edit')
const editedVolume = Number((/([\d.]+) mm³/.exec((await bodyRows())[0]) ?? [])[1])
check(Math.abs(editedVolume - cutVolume) > 0.5, `and the hole is a different size (${editedVolume} mm³)`)

// ---- a revolve previews too, then is let go ------------------------------------------
// The square turned about one of its own sides is a cylinder of radius 20
// and height 20; the ghost says so before anything is created.
await click(page, '[data-test=feature-revolve]')
await page.waitForSelector('[data-test=revolve-editor]')
await selectByLabel(page, '[data-test=revolve-sketch]', 'Sketch 1')
await sleep(150)
check(/1 of 1 picked/.test(await page.$eval('[data-test=revolve-profiles]', (el) => el.textContent)), 'the revolve picks the square as its profile')
// The axis list shows the hovered line across the part before it is taken.
await pickOption(page, '[data-test=revolve-axis]', /Sketch 1 line/)
await page.waitForFunction(() => /Preview:/.test(document.querySelector('[data-test=revolve-preview]')?.textContent ?? ''), { timeout: 30_000 }).catch(() => {})
const revolvePreview = await page.$eval('[data-test=revolve-preview]', (el) => el.textContent)
console.log('revolve preview:', revolvePreview)
const revolveVolume = Number((/Preview: ([\d.]+) mm³/.exec(revolvePreview) ?? [])[1])
check(Math.abs(revolveVolume - Math.PI * 400 * 20) < 5, `the revolve previews the cylinder the square sweeps (${revolveVolume} mm³)`)
await page.screenshot({ path: shotPath('reverse-revolve-preview.png') })
await click(page, '[data-test=revolve-cancel]')
await page.waitForFunction(() => !document.querySelector('[data-test=revolve-editor]'), { timeout: 10_000 })

// ---- undo and redo over the feature list --------------------------------------------
// The last two changes were the edit of the hole and, before it, the cut:
// Ctrl+Z takes the edit back and the hole is its old size, a second takes
// the cut back and the body is whole; Ctrl+Shift+Z twice brings both back
// with their names.
const rowsBeforeUndo = await featureRows()
await page.evaluate(() => document.activeElement?.blur())
const undoStack = () => page.evaluate(() => ({ past: window.__re.store.getState().past.length, future: window.__re.store.getState().future.length }))
const bodyVolume = async () => Number((/([\d.]+) mm³/.exec((await bodyRows())[0]) ?? [])[1])
const bodySettles = (v) =>
  page
    .waitForFunction(
      (want) => {
        const row = document.querySelector('[data-test=body-row] b')?.textContent ?? ''
        const m = /([\d.]+) mm³/.exec(row)
        return m && Math.abs(Number(m[1]) - want) < 1 && !window.__re.store.getState().building
      },
      { timeout: 60_000 },
      v,
    )
    .catch(() => {})
const undo = async () => {
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await sleep(300)
}
const redo = async () => {
  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('z')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await sleep(300)
}
console.log('before Ctrl+Z:', JSON.stringify(await undoStack()))
await undo()
await bodySettles(cutVolume)
console.log('after one Ctrl+Z:', JSON.stringify(await undoStack()), JSON.stringify(await featureRows()), JSON.stringify(await bodyRows()))
check((await featureRows()).length === rowsBeforeUndo.length && Math.abs((await bodyVolume()) - cutVolume) < 1, 'Ctrl+Z takes the edit of the hole back — same features, the old hole')
await undo()
await bodySettles(volume)
console.log('after two:', JSON.stringify(await featureRows()), JSON.stringify(await bodyRows()))
check((await featureRows()).length === rowsBeforeUndo.length - 1, 'a second Ctrl+Z takes the cut back')
check(Math.abs((await bodyVolume()) - volume) < 1, 'and the body is whole again')
await redo()
await redo()
await bodySettles(editedVolume)
const rowsAfterRedo = await featureRows()
console.log('after Ctrl+Shift+Z twice:', JSON.stringify(rowsAfterRedo), JSON.stringify(await bodyRows()))
check(JSON.stringify(rowsAfterRedo) === JSON.stringify(rowsBeforeUndo), 'Ctrl+Shift+Z twice brings the cut and the edit back, names and all')
check(Math.abs((await bodyVolume()) - editedVolume) < 1, 'with the edited hole')

// ---- a region clicked on the part offers its verbs -----------------------------------
// With no editor open a click on a sketch's region selects it, and chips
// by the click offer Extrude and Revolve. The sketches lie in the cube's
// middle, where the scan hides them from a click — a region is only taken
// where the part does not stand in front of it — so the scan is put away
// first; the plane element on the top face would take the click too.
// A sketch a feature has used is hidden by the commit, as in Fusion; the
// row's eye shows it again, which is what the store call here stands for.
const usedSketches = await page.evaluate(() => {
  const st = window.__re.store.getState()
  const used = new Set(st.features.flatMap((f) => (f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'sheet' ? [f.sketchId] : f.kind === 'loft' ? f.sketches : [])))
  return st.features.filter((f) => f.kind === 'sketch' && used.has(f.id)).map((f) => ({ id: f.id, visible: f.visible }))
})
console.log('used sketches:', JSON.stringify(usedSketches))
check(usedSketches.length > 0 && usedSketches.every((f) => !f.visible), 'a sketch a feature has used is hidden')
await page.evaluate((ids) => ids.forEach((id) => window.__re.store.getState().toggleFeatureVisible(id)), usedSketches.map((f) => f.id))
await click(page, '[data-test=toggle-scan]')
await click(page, '[data-test=toggle-elements]')
await sleep(300)
await page.mouse.click(rect3d.x, rect3d.y)
await sleep(300)
const chips = () => page.$$eval('[data-test=context-chips] button', (els) => els.map((e) => e.textContent))
console.log('chips:', JSON.stringify(await chips()))
check((await chips()).includes('Extrude') && (await chips()).includes('Revolve'), 'a click on a region of the part offers Extrude and Revolve as chips')
await page.screenshot({ path: shotPath('reverse-chips.png') })
await click(page, '[data-test=chip-extrude]')
await page.waitForSelector('[data-test=extrude-editor]')
check(/1 of \d+ picked/.test(await profiles()), 'the Extrude chip opens the extrude with that region picked')
await click(page, '[data-test=extrude-cancel]')
await page.waitForFunction(() => !document.querySelector('[data-test=extrude-editor]'), { timeout: 10_000 })
await click(page, '[data-test=toggle-scan]')
await sleep(300)

// ---- a face of the body clicked offers a sketch on it --------------------------------
// With the scan shown and a body over it, a click on the body's top face
// beside the hole selects that face — the body lies on the scan, so the
// body is what the click takes — and the chip by it starts a sketch on
// the face's own plane.
await page.evaluate(() => window.__re.scene().viewFrom?.('top'))
await page.keyboard.press('1')
await sleep(600)
await page.mouse.click(rect3d.x + 90, rect3d.y)
await sleep(400)
const faceSel = await page.evaluate(() => window.__re.store.getState().selection)
console.log('body face selection:', JSON.stringify(faceSel && { kind: faceSel.kind, face: faceSel.face?.fingerprint }))
check(faceSel?.kind === 'bodyFace' && faceSel.face.fingerprint.kind === 'plane' && Math.abs(faceSel.face.fingerprint.dir[2] - 1) < 1e-6, 'a click on the body\u2019s top face selects that face \u2014 a plane facing +Z')
check((await chips()).includes('Sketch here'), 'and offers Sketch here as a chip')
await page.screenshot({ path: shotPath('reverse-body-face.png') })
await click(page, '[data-test=chip-sketch-here]')
await page.waitForSelector('[data-test=sketch-editor]', { timeout: 20_000 }).catch(() => {})
check((await page.$('[data-test=sketch-editor]')) !== null, 'the chip opens a sketch')
if (await page.$('[data-test=sketch-editor]')) {
  const frame = await page.evaluate(() => window.__re.store.getState().sketchDraft.frame)
  console.log('body face frame:', JSON.stringify(frame))
  check(Math.abs(frame.origin[2] - SIZE / 2) < 1e-6 && Math.abs(frame.normal[2] - 1) < 1e-6, 'on the plane of the body\u2019s top face')
  // The face's own outline comes into the sketch, projected and fixed —
  // the square and the hole cut through it — as a CAD sketch on a face has it.
  const outline = await page.evaluate(() => window.__re.store.getState().sketchDraft.sketch.entities.map((e) => ({ kind: e.kind, projected: Boolean(e.projected), fixed: Boolean(e.fixed) })))
  console.log('projected outline:', JSON.stringify(outline.map((e) => e.kind)))
  check(outline.length >= 4 && outline.every((e) => e.projected && e.fixed), 'with the face\u2019s outline projected into it, fixed')
  await click(page, '[data-test=sketch-finish]')
  await page.waitForFunction(() => !document.querySelector('[data-test=sketch-editor]'), { timeout: 10_000 }).catch(() => {})
  // The outline is a sketch now, and its region would take the click
  // meant for the scan below: taken back.
  await page.evaluate(() => window.__re.store.getState().undoFeatures())
  await sleep(600)
}

// ---- a click on a face of the scan starts nothing -----------------------------------
// The cube's top face at the canvas centre, the elements and the body put
// away so the scan takes the click: no sketch opens under it — a sketch is
// begun from the panel. One opened there and finished empty makes nothing.
await click(page, '[data-test=body-visible]')
await sleep(200)
await page.evaluate(() => window.__re.scene().viewFrom?.('top'))
await page.keyboard.press('1')
await sleep(600)
await page.mouse.click(rect3d.x, rect3d.y)
await sleep(1500)
check((await page.$('[data-test=sketch-editor]')) === null, 'a click on a face of the scan opens no sketch')
await pickOption(page, '[data-test=sketch-plane-select]', 'XY plane through the centre')
await page.waitForSelector('[data-test=sketch-editor]')
await sleep(300)
await click(page, '[data-test=sketch-finish]')
await sleep(300)
check((await page.$('[data-test=sketch-editor]')) === null && (await featureRows()).length === rowsBeforeUndo.length, 'Finish on an empty sketch closes it and makes no feature')
await click(page, '[data-test=body-visible]')
await sleep(200)
await click(page, '[data-test=toggle-elements]')
await sleep(200)

// ---- STEP out, meshStep back in ------------------------------------------------------
await click(page, '[data-test=export-body-step]')
let stepFile = null
for (let i = 0; i < 100 && !stepFile; i++) {
  await sleep(200)
  stepFile = readdirSync(dir).find((f) => f.endsWith('.step'))
}
check(Boolean(stepFile), `a STEP file downloaded (${stepFile ?? 'missing'})`)
if (stepFile) {
  const text = readFileSync(join(dir, stepFile), 'utf8')
  const back = importStep(text, { surfaceDeviation: 0.01, maxEdge: 5 })
  const d = back.diagnostics
  console.log('meshStep:', JSON.stringify({ ok: d.ok, openEdges: d.openEdges, nonManifold: d.nonManifoldEdges, dropped: d.facesDropped, tris: back.mesh.indices.length / 3 }))
  check(d.openEdges === 0 && d.nonManifoldEdges === 0 && d.facesDropped === 0, 'meshStep builds the export back into a closed solid')
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const q = back.mesh.positions
  for (let i = 0; i < q.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], q[i + k])
    max[k] = Math.max(max[k], q[i + k])
  }
  console.log('bounds:', min.map((v) => v.toFixed(3)), max.map((v) => v.toFixed(3)))
  check(max.every((v, k) => Math.abs(v - SIZE / 2) < 0.05 && Math.abs(min[k] + SIZE / 2) < 0.05), 'of the cube’s size, where the scan stands')
  check((text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length === 1, 'as one solid body')
}

await finish(browser, consoleErrors)
