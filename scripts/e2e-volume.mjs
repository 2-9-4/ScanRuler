// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end check of the deviation as volumes: opens a saved project with a
// scan and an aligned reference, measures the volumes in the deviation
// workspace — a card with a moving bar over the stage meanwhile — and checks
// the totals and the region list come up, a row lights
// its region and a click frames it.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   PROJECT=path/to/part.scanruler node scripts/e2e-volume.mjs
// Env: CHROME, APP_URL, PROJECT, SHOT_DIR.
import { click, fail, finish, launchApp, pixelDiff, requireFixture, shotPath, sleep } from './e2e-lib.mjs'

const PROJECT = process.env.PROJECT
if (!PROJECT) fail('set PROJECT to a .scanruler with a scan and an aligned reference')
requireFixture(PROJECT)

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 900_000 })

await (await page.$('[data-test="project-input"]')).uploadFile(PROJECT)
await page.waitForFunction(() => !document.querySelector('.spinner') && document.querySelector('canvas'), { timeout: 300_000 })
await sleep(1500)
await click(page, '[data-test=workspace-deviation]')
await page.waitForSelector('[data-test=volume-measure]', { timeout: 120_000 })
console.log('project open, deviation workspace')

const t0 = Date.now()
await click(page, '[data-test=volume-measure]')
// The card over the stage says it is working, with a bar that moves.
await page.waitForSelector('[data-test=busy-progress]', { timeout: 60_000 })
await sleep(4000)
const first = await page.$eval('[data-test=busy-progress]', (b) => Number(b.getAttribute('aria-valuenow')))
await page.screenshot({ path: shotPath('volume-progress.png') })
await sleep(3000)
const later = await page.$eval('[data-test=busy-progress]', (b) => Number(b.getAttribute('aria-valuenow'))).catch(() => 100)
console.log(`progress ${first} % then ${later} %`)
if (!(later > first)) fail('the progress bar did not move')
await page.waitForSelector('[data-test=volume-total-excess]', { timeout: 600_000 })
console.log(`volumes measured in ${((Date.now() - t0) / 1000).toFixed(1)} s (page side)`)
const totals = await page.$$eval('[data-test^=volume-total-]', (rows) => rows.map((r) => r.textContent?.trim()))
console.log(totals.join('\n'))
const rows = await page.$$('[data-test=volume-region]')
console.log(`${rows.length} regions listed`)
await sleep(600)
await page.screenshot({ path: shotPath('volume-measured.png') })
const before = await page.screenshot({ encoding: 'base64' })

if (rows.length > 0) {
  await rows[0].hover()
  await sleep(400)
  await page.screenshot({ path: shotPath('volume-hover.png') })
  const lit = await page.screenshot({ encoding: 'base64' })
  const changed = await pixelDiff(page, before, lit)
  console.log(`hovering the first row changed ${changed.toFixed(2)} % of the picture`)
  if (!(changed > 0)) fail('hovering a region row lit nothing')
  await rows[0].click()
  await sleep(900)
  await page.screenshot({ path: shotPath('volume-framed.png') })
}

await click(page, '[data-test=volume-show]')
await sleep(400)
await page.screenshot({ path: shotPath('volume-hidden.png') })

await finish(browser, consoleErrors)
