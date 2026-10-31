// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the rounds and chamfers set up in their boxes and of
// Delete face, on a block modelled with no scan: a fillet turned Variable,
// its edge clicked on the part and given a start and an end radius, its
// Start and End named on the part by its ends; a chamfer by two distances, then flipped; and the
// round taken off again by Delete face from one click on it, the block as
// it was but for the chamfer.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-reverse-round-delete.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, click, enterTyper, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const W = 40, D = 20, H = 10

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
await openReverse(page)
const { re, built, clickAt } = reverseHelpers(page)
const type = enterTyper(page)
const volume = () => re(() => window.__re.store.getState().bodies[0]?.volume ?? 0)
/** What the last row of the list reads: its tooltip, the row being the
 *  kind's icon and the name. */
const lastRow = () => page.$$eval('[data-test=feature-row]', (els) => {
  const row = els.at(-1)
  return row?.getAttribute('title') ?? row?.querySelector('[title]')?.getAttribute('title') ?? ''
})
/** Wait for the open box's preview to land, ok or not. */
const previewed = async () => {
  await page.waitForFunction(() => ['ok', 'failed'].includes(window.__re.store.getState().preview.status), { timeout: 60_000 })
  await sleep(300)
  return re(() => window.__re.store.getState().preview)
}

// ---- the block, through the store ----------------------------------------------------
await re((w, d, h) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('rectangle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([w, d], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().setExtrude({ extent: { kind: 'distance', from: 0, to: h } })
  s().commitExtrude()
}, W, D, H)
await built()
await re(() => window.__re.scene().viewFrom('iso'))
await sleep(600)
const block = await volume()
check(Math.abs(block - W * D * H) < 0.5, `the block is built (${block.toFixed(1)} mm³)`)

// ---- a fillet at a varying radius: the edge clicked on the part ----------------------
await click(page, '[data-test=feature-fillet]')
await page.waitForSelector('[data-test=fillet-editor]')
await page.select('[data-test=fillet-mode]', 'variable')
await sleep(200)
check(!(await page.$('[data-test=fillet-chain]')), 'Variable puts the tangent switch away')
await clickAt(W / 2, 0, H)
const rows = await page.$$('[data-test=fillet-varying-edge]')
check(rows.length === 1, `the edge clicked is listed with its two radii (${rows.length})`)
await type('[data-test=fillet-varying-start-0]', 1)
await type('[data-test=fillet-varying-end-0]', 4)
const draft = await re(() => {
  const d = window.__re.store.getState().featureDraft
  return { radius: d.variable?.[0]?.radius, start: d.variable?.[0]?.edge.ends[0], end: d.variable?.[0]?.edge.ends[1], dots: window.__re.reScene().bodyPicks.pickedVertices.length }
})
check(JSON.stringify(draft.radius) === '[1,4]', `the radii as typed (${JSON.stringify(draft.radius)})`)
check(draft.dots === 2, 'a dot on each end of the edge')
/** The Start and End labels on the part: what each says, and how far its
 *  chip stands from where its end is drawn, in pixels. */
const endLabels = () =>
  page.evaluate((ends) => {
    const at = window.__re.reScene().bodyPicks.screenProjection()
    return ['start', 'end'].map((k, i) => {
      const el = document.querySelector(`[data-test=fillet-varying-${k}-label]`)
      if (!el) return null
      const chip = el.firstElementChild.getBoundingClientRect()
      const [x, y] = at(...ends[i])
      const dx = Math.max(chip.left - x, 0, x - chip.right)
      const dy = Math.max(chip.top - y, 0, y - chip.bottom)
      return { text: el.textContent.replace(/\s+/g, ' ').trim(), off: Math.hypot(dx, dy) }
    })
  }, [draft.start, draft.end])
let labels = await endLabels()
console.log('end labels:', JSON.stringify(labels))
check(labels[0] && /^Start ?R 1 mm$/i.test(labels[0].text) && labels[1] && /^End ?R 4 mm$/i.test(labels[1].text), 'the part names the edge’s Start and End with the radius at each')
check(labels.every((l) => l && l.off > 0 && l.off < 20), 'each label stands just off its own end')
const round = await previewed()
check(round.status === 'ok' && round.closed, `the varying round previews as a closed body (${round.status}${round.message ? `: ${round.message}` : ''})`)
await page.screenshot({ path: shotPath('reverse-round-variable.png') })
// Swapped, the radii change ends.
await click(page, '[data-test=fillet-varying-swap-0]')
check((await re(() => JSON.stringify(window.__re.store.getState().featureDraft.variable[0].radius))) === '[4,1]', '⇄ swaps the two radii')
await sleep(200)
labels = await endLabels()
check(/R 4 mm/.test(labels[0]?.text ?? '') && /R 1 mm/.test(labels[1]?.text ?? ''), `and the labels follow (${labels.map((l) => l?.text).join(' / ')})`)
// Turned to look along the other way, the labels still stand off their ends.
await re(() => window.__re.scene().viewFrom('front'))
await sleep(600)
labels = await endLabels()
check(labels.every((l) => l && l.off > 0 && l.off < 20), `from the front too (${JSON.stringify(labels.map((l) => l?.off.toFixed(1)))})`)
await page.screenshot({ path: shotPath('reverse-round-variable-front.png') })
await re(() => window.__re.scene().viewFrom('iso'))
await sleep(600)
await click(page, '[data-test=fillet-create]')
await sleep(200)
check(!(await page.$('[data-test=fillet-varying-start-label]')), 'the labels go with the box')
await built()
await sleep(300)
// The round swells from 4 to 1 along 40: the corner it takes is, on
// average, of a radius-2.5 round's area — less than the sharp block.
const rounded = await volume()
const quarter = (r) => (1 - Math.PI / 4) * r * r
check(rounded < block - 0.9 * W * quarter(1) && rounded > block - W * quarter(4), `the varying round is cut (${(block - rounded).toFixed(2)} mm³ off)`)
check(/R 4 → 1 mm/.test(await lastRow()), `the row reads the round’s two radii (${await lastRow()})`)

// ---- a chamfer by two distances, then flipped ----------------------------------------
await click(page, '[data-test=feature-chamfer]')
await page.waitForSelector('[data-test=chamfer-editor]')
await page.select('[data-test=chamfer-mode]', 'twoDistances')
await sleep(200)
check(Boolean(await page.$('[data-test=chamfer-distance2]')) && Boolean(await page.$('[data-test=chamfer-flip]')), 'Two distances shows its second distance and Flip')
await re((w, d, h) => {
  const s = window.__re.store.getState()
  const id = s.bodies[0].id
  const edge = window.__re.topology(id).edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.mid[2] - h) < 1e-6 && Math.abs(e.fingerprint.mid[1] - d) < 1e-6)
  s.toggleDraftEdge(id, edge)
}, W, D, H)
await type('[data-test=chamfer-distance]', 1)
await type('[data-test=chamfer-distance2]', 3)
const bevel = await previewed()
check(bevel.status === 'ok' && Math.abs(bevel.volume - (rounded - 0.5 * 1 * 3 * W)) < 0.5, `the two-distance chamfer previews 1.5 × ${W} mm³ off (${bevel.status}, ${bevel.volume?.toFixed(1)})`)
await page.screenshot({ path: shotPath('reverse-chamfer-two.png') })
await click(page, '[data-test=chamfer-flip]')
const flipped = await previewed()
check(flipped.status === 'ok' && Math.abs(flipped.volume - bevel.volume) < 1e-3, 'flipped, the same chamfer the other way round')
await page.screenshot({ path: shotPath('reverse-chamfer-flipped.png') })
await click(page, '[data-test=chamfer-create]')
await built()
await sleep(300)
const chamfered = await volume()
check(/1 × 3 mm/.test(await lastRow()), `the row reads both distances (${await lastRow()})`)

// ---- Delete face: one click on the round takes it off ----------------------------------
await click(page, '[data-test=feature-delete-face]')
await page.waitForSelector('[data-test=delete-face-editor]')
check(await page.$eval('[data-test=delete-face-tangent]', (el) => el.checked), 'Delete face opens with Tangent faces on')
// On the round, at its middle: radius 2.5 there, its middle at 45°.
await clickAt(W / 2, 2.5 - 2.5 * Math.SQRT1_2, H - 2.5 + 2.5 * Math.SQRT1_2)
const picked = await re(() => window.__re.store.getState().featureDraft.faces.map((f) => f.fingerprint.kind))
check(picked.length >= 1 && picked.every((k) => k !== 'plane'), `a click on the round takes the round (${JSON.stringify(picked)})`)
const healed = await previewed()
check(healed.status === 'ok' && healed.closed, `the round taken off previews as a closed body (${healed.status}${healed.message ? `: ${healed.message}` : ''})`)
await page.screenshot({ path: shotPath('reverse-delete-face.png') })
await click(page, '[data-test=delete-face-create]')
await built()
await sleep(300)
const after = await volume()
check(Math.abs(after - (chamfered + (block - rounded))) < 0.05, `the block is sharp again where the round was (${after.toFixed(2)} of ${(chamfered + block - rounded).toFixed(2)} mm³)`)
await page.screenshot({ path: shotPath('reverse-delete-face-done.png') })

await finish(browser, consoleErrors)
