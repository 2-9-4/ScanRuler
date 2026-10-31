// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of overlapping bodies: two blocks made as bodies of their
// own, run into each other with their tops flush, are drawn with what they
// share in hatched red over both — where the two tops would otherwise fight for the
// same pixels — and a block beside them that only touches shares nothing.
// The red goes with either body put away, shows inside see-through bodies,
// is the cut colour where the section view cuts it, goes with the Bodies
// key's Overlaps switch, and goes when the bodies are apart.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-reverse-overlap.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, click, finish, launchApp, shotPath, sleep, viewOption } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1400, height: 900, protocolTimeout: 600_000 })
const { re, kernelReady } = reverseHelpers(page)

await page.click('[data-test=workspace-reverse]')
await kernelReady()
await sleep(300)

/** A block of its own on the XY plane, from corner to corner, `h` tall. */
const block = (a, b, h) =>
  re(
    ({ a, b, h }) => {
      const s = () => window.__re.store.getState()
      s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
      s().setSketchTool('rectangle')
      s().sketchClick(a, 0.01, false, { off: true })
      s().sketchClick(b, 0.01, false, { off: true })
      const id = s().commitSketch()
      s().startExtrude(id)
      if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
      s().setExtrude({ extent: { kind: 'distance', from: 0, to: h }, op: 'new' })
      s().commitExtrude()
      return id + 1
    },
    { a, b, h },
  )
const settledBodies = (n) => page.waitForFunction((n) => !window.__re.store.getState().building && window.__re.store.getState().bodies.length === n, { timeout: 60_000 }, n)
/** The overlaps drawn, once the kernel has answered for the bodies as they
 *  stand: [a, b, shown] each. */
const overlaps = () => re(() => window.__re.reScene().overlaps.map((o) => [o.a, o.b, o.mesh.visible]))
const waitOverlaps = (n) => page.waitForFunction((n) => window.__re.reScene().overlaps.length === n, { timeout: 30_000 }, n)

/** What is drawn round a point of the part, over a dozen pixels square:
 *  the mean colour, and how far apart the brightest and darkest reds are —
 *  a hatch's stripes, where a flat face is one shade. */
const colourAt = (p) =>
  re(async (p) => {
    const rs = window.__re.reScene()
    const [x, y] = rs.bodyPicks.screenProjection()(p[0], p[1], p[2])
    const r = document.querySelector('.viewport canvas').getBoundingClientRect()
    const bytes = await window.__re.scene().capture()
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const g = canvas.getContext('2d')
    g.drawImage(bitmap, 0, 0)
    const sx = bitmap.width / r.width
    const sy = bitmap.height / r.height
    const n = 12
    const d = g.getImageData(Math.round((x - r.left) * sx) - n / 2, Math.round((y - r.top) * sy) - n / 2, n, n).data
    const mean = [0, 0, 0]
    let lo = 255
    let hi = 0
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) mean[k] += d[i + k] / (n * n)
      lo = Math.min(lo, d[i])
      hi = Math.max(hi, d[i])
    }
    return { mean: mean.map(Math.round), spread: hi - lo }
  }, p)
const hatchedRed = (c) => c.spread > 30 && c.mean[0] > c.mean[1] + 40 && c.mean[0] > c.mean[2] + 40
const plain = (c) => c.spread < 12
const say = (c) => `${c.mean} ±${c.spread}`

// ---- two blocks run into each other, a third touching ---------------------------------
const A = await block([0, 0], [40, 30], 10)
await settledBodies(1)
const B = await block([20, 10], [60, 40], 10)
await settledBodies(2)
const T = await block([-20, 0], [0, 30], 10)
await settledBodies(3)
await waitOverlaps(1)
const found = await overlaps()
check(found.length === 1 && found[0][0] === A && found[0][1] === B && found[0][2], `the two blocks run into each other, the one beside them only touches (${JSON.stringify(found)})`)
await re(() => {
  window.__re.scene().frameAll()
  window.__re.scene().viewFrom('top')
})
await sleep(600)
await page.screenshot({ path: shotPath('reverse-overlap-top.png') })
{
  const shared = await colourAt([30, 20, 10])
  const ownA = await colourAt([10, 5, 10])
  const ownB = await colourAt([50, 35, 10])
  check(hatchedRed(shared), `what they share is hatched red on their flush tops (${say(shared)})`)
  check(plain(ownA) && plain(ownB), `the rest of each block is its own colour, unhatched (${say(ownA)}; ${say(ownB)})`)
}
await re(() => {
  window.__re.scene().frameAll()
  window.__re.scene().viewFrom('iso')
})
await sleep(600)
await page.screenshot({ path: shotPath('reverse-overlap-iso.png') })
{
  const shared = await colourAt([30, 20, 10])
  check(hatchedRed(shared), `and from a corner, where the tops are seen aslant (${say(shared)})`)
}

// ---- put away, see-through ---------------------------------------------------------------
await re((B) => window.__re.store.getState().setBodiesVisible([B], false), B)
await sleep(500)
check(!(await overlaps()).some((o) => o[2]), 'with one block put away the red goes')
await re((B) => window.__re.store.getState().setBodiesVisible([B], true), B)
await waitOverlaps(1)
check((await overlaps())[0][2], 'and comes back with it')
await re(() => window.__re.store.getState().setBodiesSeeThrough(true))
await sleep(400)
await page.screenshot({ path: shotPath('reverse-overlap-see-through.png') })
check((await overlaps())[0][2], 'the red stays inside see-through bodies')
await re(() => window.__re.store.getState().setBodiesSeeThrough(false))
await sleep(300)

// ---- the section view --------------------------------------------------------------------
await re(() => window.__re.scene().viewFrom('front'))
await sleep(300)
await click(page, '[data-test="toggle-section-view"]')
await sleep(600)
const capped = await re(() => [...window.__re.reScene().caps.held.values()].map((h) => h.color))
check(capped.length === 4 && capped.includes(0xe0564f), `the section view closes the three blocks and what two share, that in red (${capped.map((c) => c.toString(16))})`)
await sleep(300)
await page.screenshot({ path: shotPath('reverse-overlap-section.png') })
{
  // The cut runs through the middle, across Y; the near half is away.
  const y = await re(() => window.__re.scene().sectionClip().constant * -Math.sign(window.__re.scene().sectionClip().normal.y))
  const shared = await colourAt([30, y, 5])
  const ownA = await colourAt([10, y, 5])
  check(hatchedRed(shared), `the cut through what they share is hatched red, over both blocks' cut faces (${say(shared)})`)
  check(plain(ownA), `the cut through one block alone is that block's cut colour (${say(ownA)})`)
}
await click(page, '[data-test="toggle-section-view"]')
await sleep(300)

// ---- the Bodies key's switch ----------------------------------------------------------------
const overlapsOn = () => page.$eval('[data-test="toggle-body-overlaps"]', (e) => e.getAttribute('aria-checked') === 'true')
check(await overlapsOn(), 'the Overlaps switch is on as the part opens')
await click(page, '[data-test="toggle-bodies-menu"]')
await page.waitForSelector('[data-test="toggle-bodies-options"]:not([hidden])', { timeout: 3000 })
await page.screenshot({ path: shotPath('reverse-overlap-menu.png') })
await click(page, '[data-test="toggle-body-overlaps"]')
await page.mouse.move(1, 1)
await page.waitForSelector('[data-test="toggle-bodies-options"][hidden]', { timeout: 3000 })
await waitOverlaps(0)
check(!(await overlapsOn()) && (await re(() => window.__re.store.getState().overlapsShown)) === false, 'switched off, nothing is red')
await viewOption(page, 'toggle-bodies', 'toggle-body-overlaps')
await waitOverlaps(1)
check(await overlapsOn(), 'and on again, the red is back')

// ---- apart -------------------------------------------------------------------------------
await re((B) => window.__re.store.getState().removeFeature(B), B)
await settledBodies(2)
await waitOverlaps(0)
check((await overlaps()).length === 0, 'with the second block gone, nothing is red')

await finish(browser, consoleErrors)
