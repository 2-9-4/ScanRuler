// SPDX-License-Identifier: AGPL-3.0-only
// A torus element in the Reverse engineer workspace: the generated fillet
// ring of scripts/e2e-torus.mjs, its torus fitted in Measure, then the
// Curvature switch in the Scan key's menu tells the round from the flats by
// colour, and the element
// extracts as a closed ring body. Needs no scan file.
//
//   npm run dev &  node plugins/reverse/scripts/e2e-torus-body.mjs
import { check, click, finish, launchApp, loadScan, previewReady, shotPath, sleep, viewOption } from '../../../scripts/e2e-lib.mjs'
import { filletRingScan, fitFilletTorus } from '../../../scripts/e2e-fixtures.mjs'

const R = 25, r = 3
const mid = Math.PI / 4
const scanPath = filletRingScan({ R, r })

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
await loadScan(page, scanPath, { inputSelector: '[data-test=start-scan] input[type=file]' })
await page.evaluate(() => document.querySelector('[data-test=support-card] button')?.click())
check(await fitFilletTorus(page, { R, r }, { click, previewReady, sleep }), 'a click on the round fits a torus')

await click(page, '[data-test=workspace-reverse]')
await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 }).catch(() => {})

// ---- the curvature switch: the round is told from the flats by colour ------------------------
check((await page.$('[data-test=toggle-curvature]:not([disabled])')) !== null, 'the Scan key’s menu offers Curvature on a scan')
const before = await page.evaluate((p) => window.__re.colorNear(p), [R + r * Math.sin(mid), 0, r * Math.cos(mid)])
await viewOption(page, 'toggle-scan', 'toggle-curvature')
await page.waitForFunction(() => window.__re.store.getState().curvatureShown, { timeout: 30_000 }).catch(() => {})
await sleep(300)
const curv = await page.evaluate(() => {
  const c = window.__re.store.getState().curvature
  return c && { range: c.range, n: c.values.length }
})
console.log('curvature:', JSON.stringify(curv))
// A quarter round of 3 mm on a ring of 25: 1/2r and a little for the ring.
check(curv && curv.range > 0.12 && curv.range < 0.25, `the scale is the round's own curvature (${curv?.range.toFixed(3)} /mm)`)
const flatRgb = await page.evaluate((p) => window.__re.colorNear(p), [R - r, 0, r])
const roundRgb = await page.evaluate((p) => window.__re.colorNear(p), [R + r * Math.sin(mid), 0, r * Math.cos(mid)])
console.log('flat:', JSON.stringify(flatRgb), 'round:', JSON.stringify(roundRgb))
check(flatRgb && flatRgb[1] > flatRgb[0] + 60 && flatRgb[1] > flatRgb[2] + 60, 'the flat top is the ramp’s green')
check(roundRgb && roundRgb[0] > roundRgb[1] + 60 && roundRgb[0] > roundRgb[2] + 60, 'the convex round is red')
check((await page.$('[data-test=re-curvature-legend]')) !== null, 'the legend beside the viewport shows the ramp')
await page.screenshot({ path: shotPath('torus-curvature.png') })
await viewOption(page, 'toggle-scan', 'toggle-curvature')
await sleep(300)
const bare = await page.evaluate((p) => window.__re.colorNear(p), [R + r * Math.sin(mid), 0, r * Math.cos(mid)])
check(bare && before && bare.every((c, i) => c === before[i]), 'the switch off hands the surface back as it was — the torus element’s tint')

// ---- extracted as a ring body ----------------------------------------------------------------
await click(page, '[data-test=feature-extract]')
await page.waitForSelector('[data-test=extract-editor]')
await page.evaluate(() => {
  const id = window.__re.measure.getState().elements[0].id
  window.__re.store.getState().setFeatureDraft({ element: id })
})
await page.waitForFunction(() => /Preview/.test(document.querySelector('[data-test=extract-preview]')?.textContent ?? ''), { timeout: 60_000 }).catch(() => {})
await click(page, '[data-test=extract-create]')
await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 1 && !window.__re.store.getState().building, { timeout: 60_000 }).catch(() => {})
await sleep(300)
const body = await page.evaluate(() => window.__re.store.getState().bodies[0])
console.log('body:', JSON.stringify(body))
check(body && body.closed && Math.abs(body.volume - 2 * Math.PI * Math.PI * R * r * r) < 2, `the torus extracts as a closed ring body of 2π²Rr² (${body?.volume.toFixed(1)} mm³)`)
await page.screenshot({ path: shotPath('torus-body.png') })

await finish(browser, consoleErrors)
