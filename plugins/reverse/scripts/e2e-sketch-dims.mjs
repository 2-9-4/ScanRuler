// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the sketch's dimensions as a drawing carries them and of
// the corner tools beside the drawing tools: Fillet and Chamfer sit in the
// tool row, a chamfer comes out with its two distances, every dimension is a
// number written along its line that a drag moves and a click opens.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-sketch-dims.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, click, drag, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)

await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await sleep(300)

await re(() => {
  const frame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame)
  s().setSketchTool('rectangle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([21, 24], 0.01, false, { off: true })
  s().setSketchTool('line')
  s().sketchClick([21, 0], 0.5, false, {})
  s().sketchClick([32, 14], 0.01, false, { off: true })
  s().setSketchTool('select')
})
await sleep(800)

// ---- the corner tools sit with the drawing tools ---------------------------------------
check(await page.$('[data-test=sketch-tools] [data-test=sketch-tool-fillet]') !== null, 'Fillet is in the tool row')
check(await page.$('[data-test=sketch-tools] [data-test=sketch-tool-chamfer]') !== null, 'Chamfer is in the tool row')
check(await page.$('[data-test=sketch-edit] [data-test=sketch-tool-fillet]') === null, 'and no longer among the edits')

await click(page, '[data-test=sketch-tool-chamfer]')
check(await re(() => window.__re.store.getState().sketchDraft.tool) === 'chamfer', 'the Chamfer key takes the tool in hand')
const chamfer = await re(() => {
  const s = () => window.__re.store.getState()
  s().sketchClick([0, 24], 0.5, false, {})
  const d = s().sketchDraft
  return { error: d.error, lines: d.sketch.entities.length, distances: d.sketch.constraints.filter((c) => c.kind === 'distance').map((c) => c.value) }
})
check(chamfer.error === null && chamfer.lines === 6 && chamfer.distances.length === 2 && chamfer.distances[0] === chamfer.distances[1], `a click on a corner chamfers it, two equal distances out (${JSON.stringify(chamfer)})`)

await click(page, '[data-test=sketch-tool-fillet]')
const fillet = await re(() => {
  const s = () => window.__re.store.getState()
  s().sketchClick([21, 24], 0.5, false, {})
  const d = s().sketchDraft
  return { error: d.error, arcs: d.sketch.entities.filter((e) => e.kind === 'arc').length }
})
check(fillet.error === null && fillet.arcs === 1, `a click on the next corner rounds it (${JSON.stringify(fillet)})`)

// ---- dimensions: a length, a slanted length, an angle ------------------------------------
const ids = await re(() => {
  const s = () => window.__re.store.getState()
  s().setSketchTool('dimension')
  // Each in hand once clicked, put down where the layout has it.
  s().sketchClick([10, 0], 0.5, false, {})
  s().putDownDimension()
  const bottom = s().sketchDraft.selectedConstraint
  s().sketchClick([26.5, 7], 0.5, false, {})
  s().putDownDimension()
  const slant = s().sketchDraft.selectedConstraint
  s().sketchClick([26.5, 7], 0.5, false, {})
  s().sketchClick([10, 0], 0.5, false, {})
  s().putDownDimension()
  const angle = s().sketchDraft.selectedConstraint
  s().setSketchTool('select')
  return { bottom, slant, angle }
})
await sleep(600)
// The last one put down opened for typing; nothing typed, it closes.
check((await page.$(`[data-test=flat-dimension-${ids.angle}] input`)) !== null, 'a dimension put down opens its number on the sheet for typing')
await re(() => document.activeElement?.blur?.())
await sleep(200)
const label = (id) => page.$(`[data-test=flat-dimension-${id}]`)
check((await label(ids.bottom)) !== null && (await label(ids.slant)) !== null && (await label(ids.angle)) !== null, 'each dimension has its number on the sheet')
const text = await page.$eval(`[data-test=flat-dimension-${ids.bottom}] .label-value`, (v) => v.textContent)
check(text === '21', `a whole length is written without zeros behind it (${text})`)
const turned = await page.$eval(`[data-test=flat-dimension-${ids.slant}] .label-value`, (v) => v.style.transform)
check(/rotate\(-5\d/.test(turned), `the slanted length's number is written along its line (${turned})`)
await page.screenshot({ path: shotPath('sketch-dims-1.png') })

// ---- a drag moves the number, a click opens it ---------------------------------------------
const box = await (await label(ids.bottom)).boundingBox()
const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
await drag(page, [from.x, from.y], [from.x + 40, from.y + 70])
const place = await re((id) => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.id === id).place ?? null, ids.bottom)
check(place !== null && Math.abs(place.off) > 1, `a drag on the number moves the dimension off its line (${JSON.stringify(place)})`)
check((await page.$(`[data-test=flat-dimension-${ids.bottom}] input`)) === null, 'and opens no field')
const after = await (await label(ids.bottom)).boundingBox()
check(Math.abs(after.y + after.height / 2 - (from.y + 70)) < 6, 'the number lies where it was dropped')
const moved = await re(() => window.__re.store.getState().sketchDraft.sketch.entities[0])
check(Math.abs(moved.a[1]) < 1e-9 && Math.abs(moved.b[1]) < 1e-9, 'the line it measures has not moved')

const slantBox = await (await label(ids.slant)).boundingBox()
await drag(page, [slantBox.x + slantBox.width / 2, slantBox.y + slantBox.height / 2], [slantBox.x + 90, slantBox.y + 60])
await sleep(300)
await page.screenshot({ path: shotPath('sketch-dims-2.png') })

const b2 = await (await label(ids.bottom)).boundingBox()
await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2)
await sleep(200)
check((await page.$(`[data-test=flat-dimension-${ids.bottom}] input`)) !== null, 'a click on the number opens it for typing')
await page.keyboard.type('25')
await page.keyboard.press('Enter')
await sleep(400)
const value = await re((id) => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.id === id), ids.bottom)
check(value.value === 25 && value.place != null, `the typed value is taken and the number stays where it was put (${JSON.stringify(value)})`)

await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.press('z')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(300)
const undone = await re((id) => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.id === id), ids.bottom)
check(undone.value === 21 && undone.place == null, `undo walks back through the value and the moves (${JSON.stringify(undone)})`)

await page.screenshot({ path: shotPath('sketch-dims-3.png') })
await finish(browser, consoleErrors)
