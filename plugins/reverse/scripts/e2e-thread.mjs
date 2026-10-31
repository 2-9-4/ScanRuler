// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the Thread feature on the blank stage, through the box
// as the operator has it: a Ø16 bar's round face clicked on the part takes
// an M16×2 bolt thread, its ghost built, chamfered; the offset typed for
// printing, a left hand, a length from the end — a chamfer refused where
// the thread starts inside the bar; then a block with a bore cut for M16
// takes a nut's thread, countersunk, from the chip on the bore's face.
// Screenshots of each go to e2e-out.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-thread.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const { page, browser, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })

const { re, kernelReady, screen } = reverseHelpers(page)
const settled = () => page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 180_000 })
/** The ghost's answer to the box as it stands now. */
async function ghost() {
  await page.waitForFunction(() => /ok|failed/.test(window.__re.store.getState().preview.status), { timeout: 180_000 })
  return re(() => window.__re.store.getState().preview)
}
/** Type a number into a box's field and commit it, as the operator does. */
async function type(testId, value) {
  await page.$eval(`[data-test=${testId}]`, (el) => {
    el.focus()
    el.value = ''
  })
  await page.keyboard.type(String(value))
  await page.keyboard.press('Enter')
  await sleep(150)
}
const text = (testId) => page.$eval(`[data-test=${testId}]`, (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '')
const draft = () => re(() => window.__re.store.getState().featureDraft)
/** A point of the part as client pixels. */
/** Only the body made by `id` shown, framed from the corner. */
async function showOnly(id) {
  await re((keep) => {
    const s = window.__re.store.getState()
    for (const b of s.bodies) if (b.visible !== (b.id === keep)) s.toggleBodyVisible(b.id)
  }, id)
  await re(() => {
    window.__re.scene().viewFrom('iso')
    window.__re.scene().frameAll()
  })
  await sleep(600)
}

await page.click('[data-test=workspace-reverse]')
await kernelReady()
await sleep(300)

// ---- a bolt's thread on a bar ------------------------------------------------------------
const bar = await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('circle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([8, 0], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().setExtrude({ extent: { kind: 'distance', from: 0, to: 30 }, op: 'new' })
  s().commitExtrude()
  return id + 1
})
await settled()
await re(() => {
  window.__re.scene().viewFrom('front')
  window.__re.scene().frameAll()
})
await sleep(600)

await click(page, '[data-test=feature-thread]')
await page.waitForSelector('[data-test=thread-editor]')
check(/Click a round face/.test(await text('thread-face')), 'the box opens asking for a round face')
// The bar's side, facing the camera, clicked on the part.
{
  const [x, y] = await screen([0, -8, 15])
  await page.mouse.move(x + 4, y)
  await sleep(150)
  await page.mouse.move(x, y)
  await sleep(250)
  await page.mouse.click(x, y)
}
await page.waitForFunction(() => window.__re.store.getState().featureDraft?.internal === false, { timeout: 20_000 }).catch(() => {})
{
  const d = await draft()
  check(d?.face?.fingerprint.kind === 'cylinder' && d.body === bar, `a click on the bar's side takes its round face (${JSON.stringify(d?.face?.fingerprint.kind)} on ${d?.body})`)
  check(d?.internal === false && d.diameter === 16 && d.pitch === 2, `the face is read as a boss and takes M16×2 (internal ${d?.internal}, Ø${d?.diameter} × ${d?.pitch})`)
}
check(/boss/.test(await text('thread-face')), `the box says it is a boss (${await text('thread-face')})`)
check(/M16×2/.test(await text('thread-reading')), `the box reads M16×2 (${await text('thread-reading')})`)
{
  const p = await ghost()
  check(p.status === 'ok' && p.closed, `the threaded ghost builds, closed (${JSON.stringify(p)})`)
}
await page.screenshot({ path: shotPath('thread-1-bolt-ghost.png') })
// The chamfer: both ends of the bar are free, and both take it.
await click(page, '[data-test=thread-chamfer]')
await sleep(300)
{
  check((await draft()).chamfer === true, 'the box takes the chamfer')
  check(/chamfered to Ø13\.435 at the free ends/.test(await text('thread-reading')), `the box reads the chamfer's diameter, just inside the root (${await text('thread-reading')})`)
  const p = await ghost()
  check(p.status === 'ok' && p.closed, `the chamfered ghost builds, closed (${JSON.stringify(p)})`)
}
await page.screenshot({ path: shotPath('thread-1b-bolt-chamfer-ghost.png') })

// A clearance for printing, a left hand, and 12 mm in from 4 mm off the end.
await type('thread-offset', 0.15)
await page.select('[data-test=thread-hand]', 'left')
await click(page, '[data-test=thread-full]')
await page.waitForSelector('[data-test=thread-length]')
await type('thread-length', 12)
await type('thread-start', 4)
{
  const d = await draft()
  check(d.offset === 0.15 && d.leftHanded && !d.fullLength && d.length === 12 && d.start === 4, `the box holds the offset, the hand and the length (${JSON.stringify({ offset: d.offset, lh: d.leftHanded, full: d.fullLength, length: d.length, start: d.start })})`)
  // 4 mm in, the thread comes out of the bar nowhere: no end to chamfer.
  await page.waitForFunction(() => window.__re.store.getState().preview.status === 'failed', { timeout: 180_000 }).catch(() => {})
  const p = await ghost()
  check(p.status === 'failed' && /no end to chamfer/.test(p.message), `a chamfer where the thread does not come out free is refused (${JSON.stringify(p)})`)
  check(/no end to chamfer/.test(await text('thread-preview')), `the box says why (${await text('thread-preview')})`)
}
// From the end itself, it does.
await type('thread-start', 0)
{
  const p = await ghost()
  check(p.status === 'ok' && p.closed, `the ghost builds again, the chamfer at the thread's start (${JSON.stringify(p)})`)
}
// Too much offset for the pitch: the box says so and will not create.
await type('thread-offset', 0.5)
check(/no thickness at the pitch diameter/.test(await text('thread-problem')), `an offset past the pitch's worth is refused in the box (${await text('thread-problem')})`)
check(await page.$eval('[data-test=thread-create]', (el) => el.disabled), 'and Create is off')
await type('thread-offset', 0.15)
await ghost()
await click(page, '[data-test=thread-create]')
await settled()
{
  const result = await re(() => {
    const s = window.__re.store.getState()
    const f = s.features.at(-1)
    return { kind: f.kind, name: f.name, length: f.length, start: f.start, offset: f.offset, leftHanded: f.leftHanded, chamfer: f.chamfer, status: s.results[f.id]?.status, message: s.results[f.id]?.message }
  })
  check(result.kind === 'thread' && result.name === 'Thread 1' && result.status === 'ok' && result.chamfer === true && result.start === 0, `the thread is made, chamfered (${JSON.stringify(result)})`)
  const body = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id), bar)
  const cylinder = Math.PI * 64 * 30
  check(body && body.closed && body.volume < cylinder * 0.99 && body.volume > cylinder * 0.85, `the bar is threaded, closed, and lighter by the groove (${body?.volume.toFixed(1)} of ${cylinder.toFixed(1)} mm³)`)
  // A row is an icon and a name; what the feature reads is its tooltip.
  const row = await page.$$eval('[data-test=feature-row]', (rows) => rows.filter((r) => /Thread 1/.test(r.textContent)).map((r) => [r, ...r.querySelectorAll('[title]')].map((e) => e.getAttribute('title') ?? '').join(' ')).join(' '))
  check(/M16×2 LH/.test(row) && /0\.15 mm/.test(row) && /chamfered at 45°/.test(row), `the row's tooltip reads the thread (${row})`)
  await showOnly(bar)
  await page.screenshot({ path: shotPath('thread-2-bolt.png') })
}

// ---- a nut's thread in a bore ------------------------------------------------------------
// A block beside the bar, a Ø14 bore cut through it — drawn at M14's own
// diameter, as a part is designed, and filled in to its minor by the thread.
const blockBody = await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('rectangle')
  s().sketchClick([30, -15], 0.01, false, { off: true })
  s().sketchClick([60, 15], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().setExtrude({ extent: { kind: 'distance', from: 0, to: 12 }, op: 'new' })
  s().commitExtrude()
  return id + 1
})
await settled()
await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('circle')
  s().sketchClick([45, 0], 0.01, false, { off: true })
  s().sketchClick([52, 0], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().setExtrude({ extent: { kind: 'distance', from: -1, to: 13 }, op: 'cut' })
  s().commitExtrude()
})
await settled()
{
  const bore = await re((id) => window.__re.topology(id)?.faces.find((f) => f.fingerprint.kind === 'cylinder' && Math.abs(f.fingerprint.radius - 7) < 1e-3) ?? null, blockBody)
  check(bore !== null, 'the block has a Ø14 bore')
  // The bore's face picked with no box open, and the chip on it taken.
  await re((b) => window.__re.store.getState().pickBodyItem({ type: 'face', bodyId: b.id, face: b.face, edges: [] }, { x: 700, y: 400 }, false), { id: blockBody, face: bore })
  await page.waitForSelector('[data-test=chip-thread]', { timeout: 10_000 }).catch(() => {})
  const chip = await page.$('[data-test=chip-thread]')
  check(chip !== null, 'a round face offers the Thread chip')
  if (chip) await chip.click()
  await page.waitForSelector('[data-test=thread-editor]')
  await page.waitForFunction(() => window.__re.store.getState().featureDraft?.internal === true, { timeout: 20_000 }).catch(() => {})
  const d = await draft()
  check(d?.internal === true && d.diameter === 14 && d.pitch === 2, `the bore is read as one and takes M14×2, drawn at its diameter (internal ${d?.internal}, Ø${d?.diameter} × ${d?.pitch})`)
  check(/the Ø14 bore filled in to the minor/.test(await text('thread-reading')), `the box says the bore is filled in (${await text('thread-reading')})`)
  check(/bore/.test(await text('thread-face')), `the box says it is a bore (${await text('thread-face')})`)
  // Countersunk at both mouths of the bore.
  await click(page, '[data-test=thread-chamfer]')
  await sleep(300)
  check(/countersunk to Ø14\.4 at the free ends/.test(await text('thread-reading')), `the box reads the countersink, past the major diameter (${await text('thread-reading')})`)
  const p = await ghost()
  check(p.status === 'ok' && p.closed, `the nut's ghost builds, closed (${JSON.stringify(p)})`)
  await click(page, '[data-test=thread-create]')
  await settled()
  const result = await re(() => {
    const s = window.__re.store.getState()
    const f = s.features.at(-1)
    return { kind: f.kind, name: f.name, status: s.results[f.id]?.status, message: s.results[f.id]?.message, note: s.results[f.id]?.note }
  })
  check(result.kind === 'thread' && result.name === 'Thread 2' && result.status === 'ok', `the nut's thread is made (${JSON.stringify(result)})`)
  check(/filled in to it along the thread/.test(result.note ?? ''), `the row says the bore was filled in (${result.note})`)
  const body = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id), blockBody)
  check(body?.closed, `the block stays a closed solid (${body?.volume.toFixed(1)} mm³)`)
  await showOnly(blockBody)
  await page.screenshot({ path: shotPath('thread-3-nut.png') })
}

await finish(browser, consoleErrors)
