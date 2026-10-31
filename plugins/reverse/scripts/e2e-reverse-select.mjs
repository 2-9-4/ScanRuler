// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of picking on the bodies in the Reverse engineer
// workspace, with the mouse, on a 40 × 20 × 10 block modelled on a blank
// stage: a corner, an edge and a face each say what they are in the chips;
// Ctrl+click adds a second corner and the chips read the distance between
// the two; the arrow keys step from the top face to the bottom behind it; a
// window dragged with Shift held takes the block's edges into an open
// fillet — to the right those wholly inside, to the left those it
// touches; and a shell with a wall thicker than the rounds it meets builds
// with its inside left sharp, and says so under its row.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-reverse-select.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const { re, built, screen } = reverseHelpers(page)

await openReverse(page)

// ---- the block ------------------------------------------------------------------------
await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('rectangle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([40, 20], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().commitExtrude()
})
await built()
await re(() => window.__re.scene().frameAll())
await sleep(800)

/** A point of the part as client pixels. */
const info = () => page.$eval('[data-test=chip-info]', (el) => el.innerText.replace(/\s+/g, ' ').trim()).catch(() => '')
const clickAt = async (p, mod) => {
  const [x, y] = await screen(p)
  if (mod) await page.keyboard.down(mod)
  await page.mouse.click(x, y)
  if (mod) await page.keyboard.up(mod)
  await sleep(250)
}

// ---- the arrow keys step through what lies under the cursor --------------------------------
// Over the middle of the top face the ray meets the top and then the bottom:
// a plain click takes the top, ArrowDown first lights the bottom through it
// and the click takes that, ArrowUp comes forward again.
{
  const [x, y] = await screen([20, 10, 10])
  const settle = async () => {
    await page.mouse.move(x + 6, y)
    await sleep(150)
    await page.mouse.move(x, y)
    await sleep(250)
  }
  await settle()
  await page.keyboard.press('ArrowDown')
  await sleep(250)
  await page.mouse.click(x, y)
  await sleep(250)
  let read = await info()
  check(/Normal 0\.000, 0\.000, -1\.000/.test(read), `ArrowDown and a click take the face behind the one in front (${read})`)
  await re(() => window.__re.store.getState().setSelection(null))
  await settle()
  await page.keyboard.press('ArrowDown')
  await sleep(150)
  await page.keyboard.press('ArrowUp')
  await sleep(250)
  await page.mouse.click(x, y)
  await sleep(250)
  read = await info()
  check(/Normal 0\.000, 0\.000, 1\.000/.test(read), `ArrowUp steps forward to the front face again (${read})`)
  await re(() => window.__re.store.getState().setSelection(null))
}

// ---- a corner, a second with Ctrl -------------------------------------------------------
await clickAt([40, 20, 10])
let text = await info()
check(/Point/.test(text) && /40\.000 mm/.test(text) && /20\.000 mm/.test(text) && /10\.000 mm/.test(text), `a corner says where it is (${text})`)
// The view looks from +X, +Y and +Z: the far end of the near upright edge is in sight.
await clickAt([40, 20, 0], 'Control')
text = await info()
check(/2 points/.test(text) && /Distance 10\.000 mm/.test(text) && /ΔZ 10\.000 mm/.test(text), `Ctrl+click adds a corner and the two read their distance (${text})`)
await page.screenshot({ path: shotPath('reverse-select-points.png') })

// ---- an edge, a face ------------------------------------------------------------------------
await clickAt([20, 0, 10])
text = await info()
check(/Straight edge/.test(text) && /Length 40\.000 mm/.test(text), `an edge says how long it is (${text})`)
check((await page.$('[data-test=chip-fillet]')) !== null, 'and still offers Fillet')
await clickAt([20, 10, 10])
text = await info()
check(/Flat face/.test(text) && /Area 800\.00 mm²/.test(text) && /Normal 0\.000, 0\.000, 1\.000/.test(text), `a face says its area and normal (${text})`)
check((await page.$('[data-test=chip-shell]')) !== null, 'and still offers Shell')
// A second face with Ctrl — the one facing +Y — and the two read their angle.
await clickAt([20, 20, 5], 'Control')
text = await info()
check(/2 faces/.test(text) && /Angle 90\.00°/.test(text), `two faces read the angle between them (${text})`)

// ---- the selection survives the camera, and goes on a click at nothing ----------------
// An orbit — a plain left drag on empty canvas — turns the part and keeps
// the two faces; so does a zoom. A click on nothing puts them away.
const canvas = await page.$eval('.viewport canvas', (el) => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
})
const empty = [canvas.left + 60, canvas.top + 60]
await page.mouse.move(empty[0], empty[1])
await page.mouse.down()
await page.mouse.move(empty[0] + 80, empty[1] + 60, { steps: 6 })
await page.mouse.move(empty[0] + 160, empty[1] + 120, { steps: 6 })
await page.mouse.up()
await sleep(300)
text = await info()
check(/2 faces/.test(text) && /Angle 90\.00°/.test(text), `an orbit keeps the selection (${text})`)
await page.mouse.move(empty[0], empty[1])
await page.mouse.wheel({ deltaY: -240 })
await sleep(300)
text = await info()
check(/2 faces/.test(text), `a zoom keeps the selection (${text})`)
await page.mouse.click(empty[0], empty[1])
await sleep(300)
check((await info()) === '' && (await re(() => window.__re.store.getState().selection)) === null, 'a click on nothing puts it away')
await page.screenshot({ path: shotPath('reverse-select-orbit.png') })
await page.keyboard.press('Escape')

// ---- a window into an open fillet ---------------------------------------------------------------
await re(() => window.__re.store.getState().setSelection(null))
await re(() => window.__re.store.getState().startFeature('fillet', { body: window.__re.store.getState().bodies[0].id }))
await sleep(400)
const corners = []
for (const x of [0, 40]) for (const y of [0, 20]) for (const z of [0, 10]) corners.push(await screen([x, y, z]))
const left = Math.min(...corners.map((c) => c[0])) - 15
const right = Math.max(...corners.map((c) => c[0])) + 15
const top = Math.min(...corners.map((c) => c[1])) - 15
const bottom = Math.max(...corners.map((c) => c[1])) + 15
const drag = async (x0, y0, x1, y1) => {
  await page.keyboard.down('Shift')
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 })
  await page.mouse.move(x1, y1, { steps: 4 })
  const shown = await page.$eval('.bodywindow', (el) => ({ shown: getComputedStyle(el).display !== 'none', crossing: el.classList.contains('crossing') })).catch(() => null)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await sleep(300)
  return shown
}
const edgeCount = () => re(() => window.__re.store.getState().featureDraft?.edges.length ?? -1)
// To the right, round the top face alone: its four edges lie wholly inside.
const topCorners = [await screen([0, 0, 10]), await screen([40, 0, 10]), await screen([0, 20, 10]), await screen([40, 20, 10])]
const tl = Math.min(...topCorners.map((c) => c[0])) - 10
const tr = Math.max(...topCorners.map((c) => c[0])) + 10
const tt = Math.min(...topCorners.map((c) => c[1])) - 10
const tb = Math.max(...topCorners.map((c) => c[1])) + 10
const box = await drag(left, top, right, bottom)
check(box?.shown && !box.crossing, 'a Shift+drag to the right draws a window')
check((await edgeCount()) === 12, `and takes all twelve edges of the block it encloses (${await edgeCount()})`)
await page.screenshot({ path: shotPath('reverse-select-window.png') })
await re(() => window.__re.store.getState().setFeatureDraft({ edges: [] }))
// To the left, a sliver across the near upright edge: what it touches.
const a = await screen([40, 20, 10])
const b = await screen([40, 20, 0])
const cross = await drag(Math.max(a[0], b[0]) + 12, (a[1] + b[1]) / 2 + 6, Math.min(a[0], b[0]) - 12, (a[1] + b[1]) / 2 - 6)
check(cross?.crossing, 'a Shift+drag to the left draws a crossing window')
const crossed = await edgeCount()
check(crossed >= 1 && crossed < 12, `and takes the edges it touches, not the block (${crossed})`)
void tl, tr, tt, tb
await re(() => window.__re.store.getState().cancelFeature?.())
await page.keyboard.press('Escape')
await sleep(300)

// ---- a shell thicker than the rounds it meets ---------------------------------------------------
await re(() => {
  const s = () => window.__re.store.getState()
  if (s().featureDraft) s().discardFeature?.()
  const body = s().bodies[0].id
  const uprights = window.__re.topology(body).edges.filter((e) => Math.abs(e.fingerprint.dir[2]) > 0.9)
  s().startFeature('fillet', { body, edges: uprights })
  s().setFeatureDraft({ radius: 2, radiusTyped: true })
  s().commitFeature()
})
await built()
await sleep(500)
await re(() => {
  const s = () => window.__re.store.getState()
  const body = s().bodies[0].id
  const top = window.__re.topology(body).faces.find((f) => f.fingerprint.kind === 'plane' && f.fingerprint.dir[2] > 0.9)
  s().startFeature('shell', { body, faces: [top] })
  s().setFeatureDraft({ thickness: 3 })
  s().commitFeature()
})
await built()
await sleep(800)
const kinds = await re(() => window.__re.store.getState().features.map((f) => f.kind))
const results = await re(() => Object.values(window.__re.store.getState().results).map((r) => `${r.status}${r.note ? ' · ' + r.note : ''}${r.message ? ' · ' + r.message : ''}`))
check(kinds.join() === 'sketch,extrude,fillet,shell' && results.every((r) => r.startsWith('ok')), `the fillet and the shell build (${JSON.stringify(results)})`)
const note = await page.$eval('[data-test=feature-note]', (el) => el.textContent.trim()).catch(() => '')
check(/4 rounds no larger than the wall/.test(note), `the shell's row says its inside was left sharp (${note})`)
const volume = await re(() => window.__re.store.getState().bodies[0].volume)
check(Math.abs(volume - (8000 - 4 * (1 - Math.PI / 4) * 4 * 10 - 34 * 14 * 7)) < 0.5, `and the body has the right volume (${volume.toFixed(1)} mm³)`)
await page.screenshot({ path: shotPath('reverse-select-shell.png') })

await finish(browser, consoleErrors)
