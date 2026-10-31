// SPDX-License-Identifier: AGPL-3.0-only
// The big support card after a save or an export: up over a blurred background,
// and in the way of nothing. The file arrives with the card still open, another
// export behind it goes through, the workspace gets no keys meanwhile, and every
// way of closing it works.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node scripts/e2e-support-ask.mjs
import { mkdirSync, rmSync } from 'node:fs'
import {
  awaitDownload,
  check,
  click,
  downloadsTo,
  finish,
  launchApp,
  loadScan,
  repoFile,
  shotPath,
  sleep,
} from './e2e-lib.mjs'

const STL = process.env.STL ?? repoFile('ballbar.stl')
const DL_DIR = repoFile('e2e-out/support-ask-dl')
rmSync(DL_DIR, { recursive: true, force: true })
mkdirSync(DL_DIR, { recursive: true })

const CARD = '[data-test="support-ask"]'
const isUp = () => page.$(CARD).then(Boolean)
const again = () =>
  page.evaluate(async () => {
    const { useSupportAsk } = await import('/src/state/supportAskStore.ts')
    useSupportAsk.setState({ lastAsked: -Infinity })
  })

const { browser, page, consoleErrors } = await launchApp()
await downloadsTo(page, DL_DIR)
await loadScan(page, STL)

// Off by default in these checks (e2e-lib): saved with it off, no card.
await click(page, '[data-test="save-project"]')
check(Boolean(await awaitDownload(DL_DIR, '.scanruler')), 'with the setting off, the project saves')
check(!(await isUp()), 'with the setting off, no card')
rmSync(DL_DIR, { recursive: true, force: true })
mkdirSync(DL_DIR, { recursive: true })

// ---- switched on in Settings ------------------------------------------------
await click(page, '[data-test="open-settings"]')
await click(page, '[data-test="toggle-support-ask"]')
await click(page, '[data-test="settings-close"]')

// ---- a save: the file comes while the card is up ----------------------------
await click(page, '[data-test="save-project"]')
const saved = await awaitDownload(DL_DIR, '.scanruler')
check(Boolean(saved), `the project is saved without closing anything: ${saved}`)
await page.waitForSelector(CARD, { timeout: 5_000 })
check(await isUp(), 'the card is up after the save')
const blur = await page.$eval('.supportask-back', (el) => getComputedStyle(el).backdropFilter)
check(blur.includes('blur'), `the background is blurred: ${blur}`)
const width = await page.$eval(CARD, (el) => el.getBoundingClientRect().width)
check(width > 400, `bigger than the corner card's 290: ${width}`)
await sleep(300)
await page.screenshot({ path: shotPath('support-ask.png') })

// ---- an export behind it goes through ---------------------------------------
await page.evaluate(() => document.querySelector('[data-test="export-cloud"]').click())
const behind = await awaitDownload(DL_DIR, '.ply')
check(Boolean(behind), `an export behind the card goes through: ${behind}`)
check((await page.$$(CARD)).length === 1, 'still one card')

// ---- the workspace behind sees no keys --------------------------------------
await page.evaluate(() => {
  window.__keysBehind = 0
  document.body.addEventListener('keydown', () => { window.__keysBehind++ })
})
await page.keyboard.press('1')
check((await page.evaluate(() => window.__keysBehind)) === 0, 'a key goes no further than the card')

// ---- the ways out -----------------------------------------------------------
await page.keyboard.press('Escape')
await sleep(100)
check(!(await isUp()), 'Escape closes it')

await click(page, '[data-test="save-project"]')
await sleep(1500)
check(!(await isUp()), 'not again inside the interval')

await again()
await click(page, '[data-test="save-project"]')
await page.waitForSelector(CARD, { timeout: 10_000 })
await page.mouse.click(10, 500)
await sleep(100)
check(!(await isUp()), 'a click beside it closes it')

await again()
await click(page, '[data-test="save-project"]')
await page.waitForSelector(CARD, { timeout: 10_000 })
await page.keyboard.press('Enter')
await sleep(100)
check(!(await isUp()), 'Enter closes it: the close button has the focus')

await again()
await click(page, '[data-test="save-project"]')
await page.waitForSelector(CARD, { timeout: 10_000 })
const storeLinks = await page.$$eval(`${CARD} a`, (links) => links.filter((a) => a.href.includes('geni.us')).map((a) => a.href))
check(storeLinks.length === 2 && storeLinks.every((h) => h === 'https://geni.us/CNCStoreScan'), `both store links are ScanRuler's: ${storeLinks}`)
await click(page, '[data-test="support-ask-off"]')
check(await isUp(), 'ticking the box does not close it')
await click(page, '[data-test="support-ask-close"]')
await sleep(100)
check(!(await isUp()), 'Close & Continue closes it')
const offFor = await page.evaluate(() => Number(localStorage.getItem('scanruler.supportask.offuntil')) - Date.now())
const WEEK = 7 * 24 * 3600_000
check(offFor > WEEK - 60_000 && offFor <= WEEK, `off for a week: ${(offFor / 3600_000).toFixed(1)} h`)
const switchedOff = await page.evaluate(() => localStorage.getItem('scanruler.supportask'))
check(switchedOff === '1', `and not switched off for good: ${switchedOff}`)

await again()
rmSync(DL_DIR, { recursive: true, force: true })
mkdirSync(DL_DIR, { recursive: true })
await click(page, '[data-test="save-project"]')
check(Boolean(await awaitDownload(DL_DIR, '.scanruler')), 'the save still happens')
check(!(await isUp()), 'and the card stays away')

// ---- Settings shows the week, and ends it ------------------------------------
await click(page, '[data-test="open-settings"]')
await page.waitForSelector('[data-test="toggle-support-ask"]')
const ticked = () => page.$eval('[data-test="toggle-support-ask"]', (el) => el.checked)
check(!(await ticked()), 'Settings shows it off during the week')
await click(page, '[data-test="toggle-support-ask"]')
check(await ticked(), 'Settings switches it back on')
await click(page, '[data-test="settings-close"]')
await again()
await click(page, '[data-test="save-project"]')
await page.waitForSelector(CARD, { timeout: 10_000 })
check(await isUp(), 'and it comes up again')
await page.keyboard.press('Escape')

await finish(browser, consoleErrors)
