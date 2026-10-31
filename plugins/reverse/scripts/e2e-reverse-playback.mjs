// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the feature list's playback in the Reverse engineer
// workspace, on the blank stage: a block, a boss joined on top and a hole
// cut through both, played back from nothing — each step built in turn, the
// sketch it comes to drawn though its commit hid it, the caption on the
// stage naming it — held with the key, stepped with the arrows, carried on
// with Space, and the list, the undo history and the bar as they were after.
// Then again with the sketches skipped: only the steps that change the part.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-reverse-playback.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const state = () => re(() => {
  const s = window.__re.store.getState()
  return { at: s.playback?.at ?? null, playing: s.playback?.playing ?? null, features: s.features.length, rolled: s.rolledBack.length, bodies: s.bodies.length, building: s.building }
})
const caption = () => page.$eval('[data-test=playback-caption-card]', (el) => el.innerText.replace(/\s+/g, ' ').trim()).catch(() => null)
const drawnSketches = () => re(() => window.__re.reScene().sketches.items.map((i) => i.id))
const undoSteps = () => page.$eval('[data-test=undo]', (el) => el.title).catch(() => '')
const XY = (z) => ({ origin: [0, 0, z], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })

await openReverse(page)

// ---- the part: a block, a boss on top, a hole through both -------------------------------
await re((frames) => {
  const s = () => window.__re.store.getState()
  const sketch = (frame, offset, draw) => {
    s().startSketch({ kind: 'world', axis: 'z', offset }, frame)
    draw()
    return s().commitSketch()
  }
  const extrude = (id, extent, op) => {
    s().startExtrude(id)
    if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
    s().setExtrude({ extent, op })
    s().commitExtrude()
  }
  const rect = (a, b) => () => {
    s().setSketchTool('rectangle')
    s().sketchClick(a, 0.01, false, { off: true })
    s().sketchClick(b, 0.01, false, { off: true })
  }
  extrude(sketch(frames[0], 0, rect([0, 0], [40, 30])), { kind: 'distance', from: 0, to: 8 }, 'new')
  extrude(sketch(frames[1], 8, rect([12, 8], [28, 22])), { kind: 'distance', from: 0, to: 10 }, 'join')
  extrude(sketch(frames[1], 8, () => {
    s().setSketchTool('circle')
    s().sketchClick([20, 15], 0.01, false, { off: true })
    s().sketchClick([23, 15], 0.01, false, { off: true })
  }), { kind: 'distance', from: -20, to: 20 }, 'cut')
}, [XY(0), XY(8)])
await page.waitForFunction(() => { const s = window.__re.store.getState(); return !s.building && s.features.length === 6 && s.bodies.length === 1 }, { timeout: 60_000 })
await re(() => window.__re.scene().frameAll())
await sleep(800)
const before = await state()
const hiddenSketches = await re(() => window.__re.store.getState().features.filter((f) => f.kind === 'sketch' && !f.visible).length)
check(before.features === 6 && before.bodies === 1 && hiddenSketches === 3, `the part stands: six features, one body, the three sketches hidden by the extrudes that used them (${JSON.stringify(before)})`)
const undoBefore = await undoSteps()

// ---- played back ------------------------------------------------------------------------
check(await page.$('[data-test=playback-start]') !== null, 'the feature list heading carries a Play key')
await page.click('[data-test=playback-start]')
await page.waitForSelector('[data-test=playback-bar]')
await page.select('[data-test=playback-hold]', '1000')
let s = await state()
check(s.at === 0 && s.playing === true && s.features === 0 && s.rolled === 6, `Play puts the bar over the first feature and plays (${JSON.stringify(s)})`)
await page.waitForFunction(() => window.__re.store.getState().bodies.length === 0, { timeout: 20_000 })
let text = await caption()
check(/Step 0 \/ 6/i.test(text ?? '') && /empty stage/i.test(text ?? ''), `the caption names the start: ${text}`)
await page.screenshot({ path: shotPath('reverse-playback-0.png') })

// The first sketch: drawn on the part though its commit hid it.
await page.waitForFunction(() => window.__re.store.getState().playback?.at === 1, { timeout: 20_000 })
await sleep(200)
text = await caption()
const sketch1 = await re(() => window.__re.store.getState().features[0].id)
check(/Step 1 \/ 6/i.test(text ?? '') && /Sketch/.test(text ?? '') && /on XY/i.test(text ?? ''), `step 1 is the block's sketch, on the XY plane: ${text}`)
check((await drawnSketches()).includes(sketch1), 'the sketch the playback has come to is drawn on the stage')
await page.screenshot({ path: shotPath('reverse-playback-1-sketch.png') })

await page.waitForFunction(() => { const s = window.__re.store.getState(); return s.playback?.at === 2 && !s.building && s.bodies.length === 1 }, { timeout: 20_000 })
await sleep(200)
text = await caption()
check(/Step 2 \/ 6/i.test(text ?? '') && /New body · 8 mm/.test(text ?? ''), `step 2 is the block, a new body 8 mm high: ${text}`)
check(!(await drawnSketches()).includes(sketch1), 'the extrude that used the sketch puts it away again')
const lit = await page.$$eval('[data-test=feature-row]', (rows) => rows.map((r) => r.classList.contains('sel')))
check(lit.length === 2 && lit[1] && !lit[0], `the row the playback has come to is lit (${JSON.stringify(lit)})`)
const rolledText = await page.$$eval('[data-test=feature-row-rolled]', (rows) => rows.map((r) => r.innerText))
check(rolledText.length === 4 && rolledText.every((t) => /to come/.test(t)), `the rows still to come say so (${rolledText.length})`)
await page.screenshot({ path: shotPath('reverse-playback-2-block.png') })

// Held with its key, stepped with the arrows.
await page.click('[data-test=playback-pause]')
s = await state()
check(s.playing === false && s.at === 2, `the pause key holds it at step 2 (${JSON.stringify(s)})`)
await page.$eval('[data-test=playback-play]', (el) => el.blur())
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
s = await state()
check(s.at === 4 && s.playing === false && s.features === 4, `→ twice steps it to the boss (${JSON.stringify(s)})`)
await page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 20_000 })
await sleep(300)
text = await caption()
check(/Step 4 \/ 6/i.test(text ?? '') && /Join · 10 mm/.test(text ?? ''), `the caption follows the step by hand: ${text}`)
await page.screenshot({ path: shotPath('reverse-playback-4-boss.png') })
await page.keyboard.press('ArrowLeft')
s = await state()
check(s.at === 3, `← steps it back (${JSON.stringify(s)})`)

// Carried on with Space to the end, and the bar where it stood.
await page.keyboard.press('Space')
s = await state()
check(s.playing === true, `Space carries it on (${JSON.stringify(s)})`)
await page.waitForFunction(() => { const s = window.__re.store.getState(); return s.playback?.at === 6 && !s.building }, { timeout: 30_000 })
await sleep(200)
text = await caption()
check(/Step 6 \/ 6/i.test(text ?? '') && /Cut · 40 mm/.test(text ?? ''), `the last step is the hole: ${text}`)
await page.screenshot({ path: shotPath('reverse-playback-6-hole.png') })
await page.waitForFunction(() => window.__re.store.getState().playback === null, { timeout: 20_000 })
s = await state()
check(s.features === 6 && s.rolled === 0 && s.bodies === 1, `at the end the part stands whole and the bar is back at the end (${JSON.stringify(s)})`)
check((await caption()) === null && (await page.$('[data-test=playback-bar]')) === null, 'the caption and the keys go with the playback')
check((await undoSteps()) === undoBefore, `the playback left no step in the undo history (${await undoSteps()})`)
check((await drawnSketches()).length === 0, 'the hidden sketches stay hidden afterwards')

// Escape ends a playback at once, the bar back where it stood.
await page.click('[data-test=playback-start]')
await page.waitForSelector('[data-test=playback-bar]')
await page.keyboard.press('Escape')
s = await state()
check(s.at === null && s.features === 6 && s.rolled === 0, `Escape stops it, the bar at the end again (${JSON.stringify(s)})`)
await page.screenshot({ path: shotPath('reverse-playback-idle.png') })

// ---- the sketches skipped ---------------------------------------------------------------
await page.waitForFunction(() => { const s = window.__re.store.getState(); return !s.building && s.bodies.length === 1 }, { timeout: 30_000 })
await page.click('[data-test=playback-start]')
await page.waitForSelector('[data-test=playback-skip-sketches]')
await page.click('[data-test=playback-skip-sketches]')
await page.click('[data-test=playback-pause]')
await page.click('[data-test=playback-stop]')
await re(() => {
  window.__shown = []
  window.__unshown = window.__re.store.subscribe((s, prev) => {
    if (s.playback && s.playback.at !== prev.playback?.at) window.__shown.push(s.playback.at)
  })
})
await page.click('[data-test=playback-start]')
await page.waitForFunction(() => window.__re.store.getState().playback?.at === 2 && !window.__re.store.getState().building, { timeout: 20_000 })
await sleep(200)
text = await caption()
check(/Step 1 \/ 3/i.test(text ?? '') && /Extrude 1/.test(text ?? ''), `with the sketches skipped the block is the first step of three: ${text}`)
check((await drawnSketches()).length === 0, 'no sketch is drawn on the way')
await page.screenshot({ path: shotPath('reverse-playback-skip.png') })
await page.waitForFunction(() => window.__re.store.getState().playback === null, { timeout: 30_000 })
const shown = await re(() => {
  window.__unshown()
  return window.__shown
})
check(JSON.stringify(shown) === JSON.stringify([0, 2, 4, 6]), `only the steps that change the geometry are shown (${JSON.stringify(shown)})`)
s = await state()
check(s.features === 6 && s.rolled === 0, `and the bar is back at the end (${JSON.stringify(s)})`)

await finish(browser, consoleErrors)
