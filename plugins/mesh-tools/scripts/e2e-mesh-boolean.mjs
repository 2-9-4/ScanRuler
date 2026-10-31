// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test for Mesh Tools' Boolean, with the solid modelled in the
// Reverse engineer workspace: drives the real app in headless Chrome on a
// generated closed block, models a cylinder standing in its top, makes it
// wider and longer with one Move face on its wall and both ends, models a
// second solid beside it, picks the cylinder by clicking it on the part in
// Mesh Tools and takes it out of the scan — the tool put away once done —
// draws the copy with Sharp edges as it is set, exports it as an STL and
// reads the file back, steps back with Ctrl+Z, takes the cylinder out again
// together with one fitted in 3D Measure — two solids in one edit, the
// fitted one at its assumed Ø — and puts the tool away with Escape from its
// own list.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/mesh-tools/scripts/e2e-mesh-boolean.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBinarySTL } from 'meshstep'
import { awaitDownload, check, click, downloadsTo, finish, launchApp, loadScan, OUT_DIR, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from '../../reverse/scripts/lib.mjs'
import { blockScan } from '../../../scripts/e2e-fixtures.mjs'

const W = 30, D = 30, H = 20

/** A closed block on the XY plane, centred on Z, every face a 1 mm grid
 *  wound outward. */

mkdirSync(OUT_DIR, { recursive: true })
const SCAN = join(OUT_DIR, 'mesh-boolean-block.stl')
writeFileSync(SCAN, Buffer.from(writeBinarySTL(blockScan(W, D, H, { at: [-W / 2, -D / 2] }))))

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const count = (text) => Number(String(text).replace(/[^\d]/g, ''))
const text = (sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim())
const { re, built, clickAt } = reverseHelpers(page)
const volume = () => re(() => window.__re.store.getState().bodies[0]?.volume ?? 0)
/** The solids on offer in the Boolean's list, and which are ticked. */
const solidRows = () => page.$$eval('[data-test=boolean-solid]', (els) => els.map((e) => ({ name: e.textContent.replace(/\s+/g, ' ').trim(), on: e.querySelector('input').checked })))
const inHand = async () => (await solidRows()).filter((r) => r.on).map((r) => r.name.split(' · ')[0])
/** A click on the part at a point in the scan's frame. */

// ---- Reverse engineer: a cylinder Ø 6 standing in the block's top ---------------------
await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=slot-scan] input[type=file]')
await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 })
await loadScan(page, SCAN, { inputSelector: '[data-test=slot-scan] input[type=file]', settle: 0 })
const scanTriangles = count((await text('.file-info')).split('triangles')[0])
await sleep(500)
await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('circle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([3, 0], 0.01, false, { off: true })
  s().setSketchTool('select')
  const id = s().commitSketch()
  s().startExtrude(id)
  s().setExtrude({ extent: { kind: 'distance', from: 6, to: 24 } })
  s().commitExtrude()
})
await built()
check(Math.abs((await volume()) - Math.PI * 9 * 18) < 0.5, `the cylinder is built (${(await volume()).toFixed(1)} mm³)`)

// ---- Move faces: its wall and both ends, 0.5 mm out ------------------------------------
await re(() => {
  const s = window.__re.store.getState()
  const id = s.bodies[0].id
  const faces = window.__re.topology(id).faces
  s.setSelection({ kind: 'bodyItems', items: faces.map((face) => ({ type: 'face', bodyId: id, face, edges: [] })), at: { x: 700, y: 300 } })
})
await page.waitForSelector('[data-test=chip-move-face]')
check((await text('[data-test=chip-move-face]')) === 'Move faces', 'the cylinder’s three faces offer Move faces')
await click(page, '[data-test=chip-move-face]')
await page.waitForSelector('[data-test=move-face-editor]')
check(/3 faces picked/.test(await text('[data-test=move-face-face]')), 'the box holds the wall and both ends')
await re(() => window.__re.store.getState().setFeatureDraft({ offset: 0.5 }))
await page.waitForSelector('[data-test=move-face-plan]')
const plan = await text('[data-test=move-face-plan]')
console.log('plan:', plan)
check(/Extrude 1/.test(plan) && /radius 3 → 3.5 mm/.test(plan), 'the ends go into the extrude’s distances and the wall into its circle')
await click(page, '[data-test=move-face-create]')
await sleep(200)
await built()
await sleep(300)
const cutter = Math.PI * 3.5 ** 2 * 19
check(Math.abs((await volume()) - cutter) < 0.5, `the cylinder is 1 mm wider and longer (${(await volume()).toFixed(1)} mm³ of ${cutter.toFixed(1)})`)
await page.screenshot({ path: shotPath('mesh-boolean-cutter.png') })

// ---- a second solid beside it, apart: a body of its own -----------------------------
await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('circle')
  s().sketchClick([9, 9], 0.01, false, { off: true })
  s().sketchClick([11, 9], 0.01, false, { off: true })
  s().setSketchTool('select')
  const id = s().commitSketch()
  s().startExtrude(id)
  s().setExtrude({ extent: { kind: 'distance', from: 15, to: 24 } })
  s().commitExtrude()
})
await sleep(200)
await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.length === 2, { timeout: 60_000 })
const solids = await re(() => window.__re.store.getState().bodies.map((b) => ({ id: b.id, name: b.name })))
check(solids.length === 2 && solids[0].name === 'Solid 1' && solids[1].name === 'Solid 2', `a join meeting no body is a body of its own (${JSON.stringify(solids)})`)

// ---- Mesh Tools: the cylinder picked on the part and taken out of the block ---------------
await page.click('[data-test=workspace-mesh]')
await click(page, '[data-test=mesh-tool-boolean]')
await page.waitForSelector('[data-test=boolean-tool]')
await page.waitForFunction(() => /closed\./.test(document.querySelector('[data-test=boolean-closed]')?.textContent ?? ''), { timeout: 60_000 })
check((await text('[data-test=boolean-closed]')) === 'The mesh is closed.', 'the panel says the scan is closed')
const rows = await solidRows()
console.log('solids:', JSON.stringify(rows))
check(rows.length === 2 && rows[0].name === 'Solid 1 · Reverse engineer' && rows[1].name === 'Solid 2 · Reverse engineer' && rows.every((r) => !r.on), 'both solids are on offer, none in hand yet')
check(/2 solids are drawn on the part — click the ones to use/.test(await text('[data-test=boolean-pick-hint]')), 'the panel asks for a click on the part')
check(await page.$eval('[data-test=boolean-run]', (el) => el.disabled), 'nothing to perform with no solid in hand')
check((await text('[data-test=boolean-run]')) === 'Perform operation', 'the button reads Perform operation')
// A click on the cylinder where it stands out of the block's top.
await sleep(800)
await clickAt(0, 0, 22.5)
const chosen = await inHand()
check(chosen.length === 1 && chosen[0] === 'Solid 1', `a click on the cylinder puts it in hand (${chosen})`)
check(!(await page.$eval('[data-test=boolean-run]', (el) => el.disabled)), 'and the operation can be performed')
await page.screenshot({ path: shotPath('mesh-boolean-preview.png') })
await click(page, '[data-test=boolean-run]')
await page.waitForFunction(() => document.querySelectorAll('[data-test=pending-edit]').length === 1, { timeout: 120_000 })
await page.waitForFunction(() => !document.querySelector('.busyoverlay'), { timeout: 120_000 })
await sleep(500)
check(!(await page.$('[data-test=boolean-tool]')) && Boolean(await page.$('[data-test=mesh-no-tool]')), 'done, the tool is put away')
const line = await text('[data-test=pending-edit]')
console.log('edit:', line)
check(/Took Solid 1 out/.test(line) && /−\d+(\.\d)? mm³/.test(line), 'the edit is listed with the volume it took')
const removed = Number(/−([\d.]+) mm³/.exec(line)?.[1] ?? 0)
const bore = Math.PI * 3.5 ** 2 * (H - 5.5)
check(Math.abs(removed - bore) < 0.02 * bore, `a bore 14.5 mm deep went (${removed} mm³ of about ${bore.toFixed(1)})`)
const copyTriangles = count((await text('[data-test=edited-triangles] b')).split('·')[0])
check(copyTriangles > scanTriangles, `the copy has the bore's wall and floor (${copyTriangles} triangles, the scan ${scanTriangles})`)
check((await text('.file-info')).includes(scanTriangles.toLocaleString('en-US')), 'the scan every other workspace measures is as it was')
await page.screenshot({ path: shotPath('mesh-boolean-done.png') })

// ---- the copy follows Sharp edges, as the scan does ------------------------------
// Shown in the scan's place, the copy is what the viewport's shading copies
// are of: none with every edge smooth, the block's and the bore's rims
// split again from 60°.
const shadingCopies = () => re(() => window.__scanruler.scene().copyOf.length)
await re(() => window.__scanruler.measure.getState().setCreaseMode('off'))
await page.waitForFunction(() => window.__scanruler.scene().copyOf.length === 0, { timeout: 15_000 }).catch(() => {})
check((await shadingCopies()) === 0, 'Always smooth, the copy is drawn smooth')
await re(() => {
  const m = window.__scanruler.measure.getState()
  m.setCreaseMode('on')
  m.setCreaseAngle(60)
})
await page.waitForFunction(() => window.__scanruler.scene().copyOf.length > 0, { timeout: 15_000 }).catch(() => {})
const split60 = await shadingCopies()
check(split60 > 0 && (await re(() => window.__scanruler.scene().showingEdited())), `Always sharp from 60°, the copy shown has its rims split (${split60} copies)`)
await page.screenshot({ path: shotPath('mesh-boolean-sharp.png') })
await re(() => {
  const m = window.__scanruler.measure.getState()
  m.setCreaseMode('on')
  m.setCreaseAngle(30)
})
await sleep(600)

// ---- the copy exported as an STL, read back --------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'scanruler-boolean-'))
const cdp = await downloadsTo(page, dir)
await click(page, '[data-test=export-edited]')
const stlFile = await awaitDownload(dir, '.stl')
const stl = stlFile ? { name: stlFile, bytes: readFileSync(join(dir, stlFile)) } : null
check(Boolean(stl), `the edited copy downloaded${stl ? ` as ${stl.name}` : ''}`)
if (stl) {
  const n = stl.bytes.readUInt32LE(80)
  check(n === copyTriangles && stl.bytes.length === 84 + 50 * n, `the STL holds the copy's ${n} triangles`)
  // The bore's floor, at z = 5.5, is in the file.
  let floor = 0
  for (let t = 0; t < n; t++) {
    const o = 84 + 50 * t + 12
    if ([0, 1, 2].every((k) => Math.abs(stl.bytes.readFloatLE(o + k * 12 + 8) - 5.5) < 1e-3)) floor++
  }
  check(floor > 0, `with the bore's floor at z 5.5 (${floor} triangles)`)
}

// ---- Ctrl+Z puts the block back ----------------------------------------------------
await page.keyboard.down('Control')
await page.keyboard.press('KeyZ')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelectorAll('[data-test=pending-edit]').length === 0, { timeout: 60_000 }).catch(() => {})
check((await page.$$('[data-test=pending-edit]')).length === 0, 'Ctrl+Z takes the boolean back')

// ---- two solids at once: the cylinder, and one fitted in 3D Measure as it is ------------
// Measured Ø 4.8 over z 12–18, given an assumed Ø 5 and extended 4 mm up
// out through the top: no body is made of it, and the bore it cuts is
// Ø 5, from z 12 up — in the same edit as the modelled cylinder's.
await re(() => {
  const m = window.__scanruler.measure
  m.setState({
    elements: [
      ...m.getState().elements,
      {
        id: 900,
        kind: 'cylinder',
        name: 'Cylinder 1',
        color: '#e0a030',
        source: { type: 'fitted', seeds: [1], settings: { method: 'gaussian', sigma: 3 } },
        status: 'done',
        visible: true,
        fit: { kind: 'cylinder', center: [-8, -8, 15], axis: [0, 0, 1], radius: 2.4, length: 6, coverage: 360, sigma: 0.01, usedPoints: 100, regionSize: 100 },
        assumed: 5,
        extend: { kind: 'cylinder', start: 0, end: 4 },
      },
    ],
  })
})
await click(page, '[data-test=mesh-tool-boolean]')
await page.waitForSelector('[data-test=boolean-tool]')
await page.waitForFunction(() => /closed\./.test(document.querySelector('[data-test=boolean-closed]')?.textContent ?? ''), { timeout: 60_000 })
const withMeasured = await solidRows()
console.log('solids:', JSON.stringify(withMeasured))
check(withMeasured.length === 3 && withMeasured[2].name === 'Cylinder 1 · 3D Measure', 'the fitted cylinder is on offer beside the bodies, as it is')
check((await inHand()).length === 0, 'the tool opens again with nothing in hand — the last boolean used its solids up')
await click(page, '[data-test=boolean-select-all]')
await sleep(200)
check((await inHand()).length === 3, 'Select all puts every solid in hand')
await click(page, '[data-test=boolean-select-none]')
await sleep(200)
check((await inHand()).length === 0, 'Unselect all takes them all out again')
await sleep(800)
if (!(await inHand()).includes('Solid 1')) await clickAt(0, 0, 22.5)
await clickAt(-8, -8, 21)
const both = await inHand()
check(both.length === 2 && both.includes('Solid 1') && both.includes('Cylinder 1'), `a click on the fitted one puts it in hand beside the first (${both})`)
check(/2 of 3 in hand, as one/.test(await text('[data-test=boolean-pick-hint]')), 'the panel says two are in hand, as one')
await clickAt(-8, -8, 21)
const again = await inHand()
check(again.length === 1 && again[0] === 'Solid 1', `a second click takes it out of hand (${again})`)
await page.$$eval('[data-test=boolean-solid]', (els) => els.find((e) => e.textContent.includes('Cylinder 1')).querySelector('input').click())
await sleep(300)
check((await inHand()).length === 2, 'and its box in the list puts it back')
await page.screenshot({ path: shotPath('mesh-boolean-measured.png') })
await click(page, '[data-test=boolean-run]')
await page.waitForFunction(() => document.querySelectorAll('[data-test=pending-edit]').length === 1, { timeout: 120_000 })
await page.waitForFunction(() => !document.querySelector('.busyoverlay'), { timeout: 120_000 })
await sleep(500)
const measuredLine = await text('[data-test=pending-edit]')
console.log('edit:', measuredLine)
const took = Number(/−([\d.]+) mm³/.exec(measuredLine)?.[1] ?? 0)
const assumedBore = Math.PI * 2.5 ** 2 * (H - 12)
check(/Took Solid 1 and Cylinder 1 out/.test(measuredLine), 'both go in one edit')
check(Math.abs(took - (bore + assumedBore)) < 0.02 * (bore + assumedBore), `both bores went, the fitted one at its assumed Ø 5 and 8 mm deep (${took} mm³ of about ${(bore + assumedBore).toFixed(1)})`)
await page.screenshot({ path: shotPath('mesh-boolean-measured-done.png') })
await page.keyboard.down('Control')
await page.keyboard.press('KeyZ')
await page.keyboard.up('Control')
await page.waitForFunction(() => document.querySelectorAll('[data-test=pending-edit]').length === 0, { timeout: 60_000 }).catch(() => {})
check((await page.$$('[data-test=pending-edit]')).length === 0, 'Ctrl+Z takes that back too')

// ---- Escape puts the tool away, even from its own list ------------------------------
await click(page, '[data-test=mesh-tool-boolean]')
await page.waitForSelector('[data-test=boolean-tool]')
await page.focus('[data-test=boolean-solid] input')
await page.keyboard.press('Escape')
await sleep(200)
check(!(await page.$('[data-test=boolean-tool]')), 'Escape with the solid list focused puts the tool away')
await click(page, '[data-test=mesh-tool-holes]')
await page.keyboard.press('Escape')
await sleep(200)
check(Boolean(await page.$('[data-test=mesh-no-tool]')), 'and any other tool')

await finish(browser, consoleErrors)
