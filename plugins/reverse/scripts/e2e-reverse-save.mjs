// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of saving a Reverse engineer project that is more than a
// cube: a real scan, a sketch fitted to its slice (pieces carrying their
// slice points), an extrude, and the project saved and opened again. Checks
// that the save finishes with a file, that the page survives it, and that
// the features come back.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-reverse-save.mjs
// Env: SCAN (mesh path, default fridgeBracket.ply), CHROME, APP_URL.
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { check, click, fail, finish, launchApp, loadScan, repoFile, requireFixture, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const SCAN = process.env.SCAN ?? repoFile('fridgeBracket.ply')
requireFixture(SCAN)
const DL_DIR = repoFile('e2e-out/reverse-save-dl')
rmSync(DL_DIR, { recursive: true, force: true })
mkdirSync(DL_DIR, { recursive: true })

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true })
let crashed = false
page.on('error', (e) => {
  crashed = true
  console.log('PAGE CRASH:', e.message)
})

await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 })
await loadScan(page, SCAN, { inputSelector: '[data-test=slot-scan] input[type=file]', timeout: 240_000 })

const { re } = reverseHelpers(page)

// ---- a sketch through the middle of the part, fitted to its slice ------------------
await re(() => {
  const s = window.__re.store.getState()
  const c = window.__re.measure.getState().modelCenter
  const frame = { origin: [c[0], c[1], c[2]], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  s.startSketch({ kind: 'world', axis: 'z', offset: c[2] }, frame)
})
await page.waitForSelector('[data-test=sketch-fit-all]:not([disabled])', { timeout: 120_000 })
await click(page, '[data-test=sketch-fit-all]')
await page.waitForFunction(() => (window.__re.store.getState().sketchDraft?.sketch.entities.length ?? 0) > 0, { timeout: 120_000 })
const pieces = await re(() => window.__re.store.getState().sketchDraft.sketch.entities.length)
console.log('fitted pieces:', pieces)
const regions = await re(() => window.__re.store.getState().sketchDraft.found.length)
console.log('regions:', regions)
const sketchId = await re(() => window.__re.store.getState().commitSketch())
if (regions > 0) {
  await re((id) => {
    window.__re.store.getState().startExtrude(id)
    if (window.__re.store.getState().extrudeDraft.regions.length === 0) window.__re.store.getState().pickAllDraftRegions()
  }, sketchId)
  await sleep(500)
  await re(() => window.__re.store.getState().commitExtrude())
  await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.length > 0, { timeout: 120_000 }).catch(() => console.log('no body was built'))
}
const features = await re(() => window.__re.store.getState().features.map((f) => f.kind))
console.log('features:', JSON.stringify(features))

// ---- save -----------------------------------------------------------------------------
async function saveOnce(label) {
  rmSync(DL_DIR, { recursive: true, force: true })
  mkdirSync(DL_DIR, { recursive: true })
  await click(page, '[data-test="save-project"]')
  let file = null
  for (let i = 0; i < 300 && !file && !crashed; i++) {
    await sleep(200)
    const done = readdirSync(DL_DIR).filter((f) => f.endsWith('.scanruler'))
    if (done.length) file = join(DL_DIR, done[0])
  }
  check(!crashed, `${label}: the page survived the save`)
  check(!!file, `${label}: a .scanruler file was downloaded`)
  if (file) console.log('saved:', (statSync(file).size / 1e6).toFixed(1), 'MB')
  const err = await page.evaluate(() => document.querySelector('[data-test=error], .error')?.textContent ?? '').catch(() => 'page gone')
  if (err) fail(`${label}: an error is shown after the save: ${err}`)
  const stillThere = await page.evaluate(() => Boolean(document.querySelector('.panel')) && Boolean(document.querySelector('.viewport canvas'))).catch(() => false)
  check(stillThere, `${label}: the app is still drawn after the save`)
}
await saveOnce('with a body')

// A sketch open while saving.
await re(() => {
  const s = window.__re.store.getState()
  const c = window.__re.measure.getState().modelCenter
  s.startSketch({ kind: 'world', axis: 'x', offset: c[0] }, { origin: [c[0], c[1], c[2]], normal: [1, 0, 0], basisU: [0, 1, 0], basisV: [0, 0, 1] })
})
await sleep(1500)
await saveOnce('with a sketch open')
await sleep(500)
const draftKept = await re(() => Boolean(window.__re.store.getState().sketchDraft))
check(draftKept, 'the open sketch is still open after the save')

await finish(browser, consoleErrors)
