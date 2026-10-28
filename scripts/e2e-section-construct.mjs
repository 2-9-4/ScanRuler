// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of a section as a plane in a construction: cuts the ball
// bar twice across the XY plane, 6 mm apart, then makes a midplane between
// the two cuts from the slots' dropdowns — it lies halfway — and an offset
// plane whose slot is filled by a click on a cut on the part. Removing a
// section takes the midplane built on it along.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node scripts/e2e-section-construct.mjs
// Env: CHROME (chrome.exe path), APP_URL, STL (scan path), SHOT_DIR.
import {
  canvasRect,
  check,
  click,
  fail,
  finish,
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

const store = (fn, ...args) =>
  page.evaluate(
    async (src, a) => new Function('useStore', 'args', `return (${src})(useStore, ...args)`)((await import('/src/state/store.ts')).useStore, a),
    fn.toString(),
    args,
  )

/** A section across the XY plane, `shift` mm off the part's centre. */
async function cut(shift) {
  await click(page, '[data-test="fit-section"]')
  await selectByLabel(page, '[data-test="section-ref"]', 'XY plane')
  if (shift !== 0) {
    await store((useStore, mm) => {
      const s = useStore.getState()
      s.setSectionDraftOffset(s.sectionDraft.offset + mm)
    }, shift)
  }
  await page.waitForFunction(
    () =>
      /edge chain/.test(document.querySelector('[data-test="section-status"]')?.textContent ?? '') &&
      !document.querySelector('[data-test="create-section"]')?.disabled,
    { timeout: 20_000 },
  )
  await page.keyboard.press('Enter')
  await sleep(400)
}

// ---- two cuts ----------------------------------------------------------------
await cut(0)
await cut(6)
const sections = await store((useStore) => useStore.getState().sections.map((s) => ({ id: s.id, z: s.frame.origin[2], color: s.color })))
console.log('sections:', JSON.stringify(sections))
check(sections.length === 2 && Math.abs(sections[1].z - sections[0].z - 6) < 1e-6, 'two cuts, 6 mm apart')

// ---- a midplane between them, from the dropdowns ---------------------------------
await click(page, '[data-test="fit-plane"]')
await selectByLabel(page, '[data-test="draft-method"]', 'Midplane of two planes')
const offered = await page.$$eval('[data-test="draft-ref-0"] option', (els) => els.map((e) => e.textContent))
console.log('plane A offers:', JSON.stringify(offered))
check(offered.includes('Section 1') && offered.includes('Section 2'), 'the plane slot offers the sections')
await selectByLabel(page, '[data-test="draft-ref-0"]', 'Section 1')
await selectByLabel(page, '[data-test="draft-ref-1"]', 'Section 2')
await sleep(200)
check(!(await page.$eval('[data-test="create-element"]', (el) => el.disabled)), 'the midplane is ready')
await page.screenshot({ path: shotPath('e2e-section-construct-midplane.png') })
await click(page, '[data-test="create-element"]')
await sleep(300)
const mid = await store((useStore) => {
  const el = useStore.getState().elements.find((e) => e.source.type === 'constructed' && e.source.method === 'plane-midplane')
  return el ? { id: el.id, z: el.fit?.center[2], refs: el.source.refs } : null
})
console.log('midplane:', JSON.stringify(mid))
check(mid !== null && Math.abs(mid.z - (sections[0].z + sections[1].z) / 2) < 1e-3, 'the midplane lies halfway between the cuts')

// ---- an offset plane, its slot filled by a click on a cut --------------------------
await selectByLabel(page, '[data-test="draft-method"]', 'Offset from plane')
await store((useStore) => useStore.getState().elements.forEach((e) => e.visible && useStore.getState().toggleElementVisible(e.id)))
await sleep(300)
// Where the second cut is on screen: the pixels in its colour, read off a
// screenshot — the middle one of them, so the click is on the cut's body.
// Its orange stands out on the part, where the first one's blue does not.
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
  sections[1].color,
)
console.log(`section colour ${sections[1].color}:`, JSON.stringify(spot))
if (!spot) fail('the second cut is found on screen')
else {
  await page.mouse.move(rect.x + spot.at[0], rect.y + spot.at[1])
  await sleep(200)
  await page.mouse.click(rect.x + spot.at[0], rect.y + spot.at[1])
  await sleep(400)
  const slot = await page.$eval('[data-test="draft-ref-0"]', (el) => el.options[el.selectedIndex]?.textContent)
  console.log(`after the click: slot "${slot}"`)
  check(slot === 'Section 2', 'a click on the cut fills the plane slot')
  await page.screenshot({ path: shotPath('e2e-section-construct-click.png') })
}

// ---- the section removed -------------------------------------------------------
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
await store((useStore, id) => useStore.getState().removeSection(id), sections[0].id)
await sleep(300)
const left = await store((useStore, id) => useStore.getState().elements.some((e) => e.id === id), mid?.id ?? -1)
check(!left, 'removing a section takes the midplane on it along')

await finish(browser, consoleErrors)
