// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of a section as a plane in a dimension: fits a ball of the
// ball bar, cuts the bar with the XY plane through its centre, then opens a
// dimension, takes the ball from the dropdown and the section by a click on
// its cut on the part — the type turns to Point – Plane and the slot names
// the section. Removing the section takes the dimension along.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node scripts/e2e-section-dimension.mjs
// Env: CHROME (chrome.exe path), APP_URL, STL (scan path), SHOT_DIR.
import {
  canvasRect,
  check,
  click,
  fail,
  finish,
  fitBall,
  launchApp,
  loadScan,
  repoFile,
  selectByLabel,
  shotPath,
  sleep,
} from './e2e-lib.mjs'

const STL = process.env.STL ?? repoFile('ballbar.stl')

const { browser, page, consoleErrors } = await launchApp()
await loadScan(page, STL)
const rect = await canvasRect(page)

if (!(await fitBall(page, rect, false, 1))) {
  fail('a ball fitted')
  await finish(browser, consoleErrors)
  process.exit()
}

// ---- the section ------------------------------------------------------------
await click(page, '[data-test="fit-section"]')
await selectByLabel(page, '[data-test="section-ref"]', 'XY plane')
await page.waitForFunction(
  () =>
    /edge chain/.test(document.querySelector('[data-test="section-status"]')?.textContent ?? '') &&
    !document.querySelector('[data-test="create-section"]')?.disabled,
  { timeout: 20_000 },
)
await page.keyboard.press('Enter')
await sleep(400)
check((await page.$$('[data-test="section-row"]')).length === 1, 'the section is made')
const color = await page.evaluate(async () => (await import('/src/state/store.ts')).useStore.getState().sections[0].color)

// ---- the dimension ----------------------------------------------------------
await click(page, '[data-test="new-dimension"]')
await selectByLabel(page, '[data-test="dim-ref-0"]', 'Sphere 1')
const optionTexts = await page.$$eval('[data-test="dim-ref-1"] option', (els) => els.map((e) => e.textContent))
console.log('slot 2 offers:', JSON.stringify(optionTexts))
await sleep(300)
await page.screenshot({ path: shotPath('e2e-section-dimension-before.png') })

// Where the cut is on screen: the pixels in the section's colour, read off a
// screenshot — the middle one of them, so the click is on the cut's body.
const shot = await page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, encoding: 'base64' })
const spot = await page.evaluate(
  async (b64, hex) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const hits = []
    // Clear of the corner gizmo and the labels' band at the top.
    for (let y = Math.floor(c.height * 0.1); y < c.height * 0.9; y++)
      for (let x = Math.floor(c.width * 0.05); x < c.width * 0.85; x++) {
        const i = (y * c.width + x) * 4
        if (Math.abs(data[i] - want[0]) + Math.abs(data[i + 1] - want[1]) + Math.abs(data[i + 2] - want[2]) < 40) hits.push([x, y])
      }
    if (hits.length === 0) return null
    hits.sort((a, b) => a[0] - b[0])
    return { at: hits[Math.floor(hits.length / 2)], count: hits.length }
  },
  shot,
  color,
)
console.log(`section colour ${color}:`, JSON.stringify(spot))
if (!spot) {
  fail('the section’s cut is found on screen')
  await finish(browser, consoleErrors)
  process.exit()
}
await page.mouse.move(rect.x + spot.at[0], rect.y + spot.at[1])
await sleep(200)
await page.mouse.click(rect.x + spot.at[0], rect.y + spot.at[1])
await sleep(400)
const type = await page.$eval('[data-test="dim-type"]', (el) => el.value)
const slot = await page.$eval('[data-test="dim-ref-1"]', (el) => el.options[el.selectedIndex]?.textContent)
const preview = await page.$eval('[data-test="dim-preview"]', (el) => el.textContent).catch(() => '')
console.log(`after the click: type ${type}, slot "${slot}", preview "${preview}"`)
check(type === 'dist-point-plane', 'the type turns to Point – Plane')
check(slot === 'Section 1', 'a click on the cut takes the section')
check(/mm/i.test(preview), 'and the distance reads')
await page.screenshot({ path: shotPath('e2e-section-dimension.png') })

await click(page, '[data-test="add-dimension"]')
await sleep(300)
const rows = await page.$$eval('[data-test="dimension-row"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
console.log('dimensions:', JSON.stringify(rows))
check(rows.length === 1 && /Sphere 1 → Section 1/.test(rows[0]), 'the dimension is listed from the ball to the section')

// ---- the section removed ----------------------------------------------------
await page.keyboard.press('Escape')
await page.evaluate(async () => {
  const { useStore } = await import('/src/state/store.ts')
  useStore.getState().removeSection(useStore.getState().sections[0].id)
})
await sleep(300)
check((await page.$$('[data-test="dimension-row"]')).length === 0, 'removing the section takes its dimension along')

await finish(browser, consoleErrors)
