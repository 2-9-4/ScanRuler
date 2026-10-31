// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of an extrude's taper and a revolve's coil on the blank
// stage, through the boxes and the grips as the operator has them: a block
// extruded 30 mm with a 10° taper typed in, its arrow on the far edge
// pulled out to lean it further; a spring — a circle coiled about one of
// its sketch's lines, five turns typed as turns; and a thread cut into a
// bar, twelve turns at a 1.5 mm pitch. Screenshots of each go to e2e-out.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-coil-taper.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const { page, browser, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })

const { re, kernelReady } = reverseHelpers(page)
const settled = () => page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 120_000 })
const ghost = () => page.waitForFunction(() => /ok|failed/.test(window.__re.store.getState().preview.status), { timeout: 120_000 })
/** Type a number into a box's field and commit it, as the operator does. */
async function type(testId, value) {
  // A number field takes no select-all from a triple click: emptied first.
  await page.$eval(`[data-test=${testId}]`, (el) => {
    el.focus()
    el.value = ''
  })
  await page.keyboard.type(String(value))
  await page.keyboard.press('Enter')
  await sleep(150)
}
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

// ---- a block with a taper -------------------------------------------------------------
const block = await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('rectangle')
  s().sketchClick([-20, -10], 0.01, false, { off: true })
  s().sketchClick([20, 10], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  return id
})
await page.waitForSelector('[data-test=extrude-taper]')
await type('extrude-to', 30)
await type('extrude-taper', 10)
check(await re(() => window.__re.store.getState().extrudeDraft.draftDeg) === -10, 'a taper of 10° typed in leans the sides out — the draft the feature keeps is −10°')
await ghost()
check(await re(() => window.__re.store.getState().preview.status) === 'ok', 'the tapered ghost builds')
const sides = await re(() => window.__re.scene().grips.handles.map((h) => h.side))
check(sides.includes('taper') && sides.includes('extrudeTo'), `the ghost wears a taper arrow beside the distance arrows (${sides.join(', ')})`)
await re(() => {
  window.__re.scene().viewFrom('iso')
  window.__re.scene().frameAll()
})
await sleep(600)
await page.screenshot({ path: shotPath('coil-taper-1-taper-ghost.png') })

// The arrow on the far edge, pulled 5 mm out along itself.
{
  const at = await re(() => {
    const h = window.__re.scene().grips.handles.find((x) => x.side === 'taper')
    const project = window.__re.reScene().bodyPicks.screenProjection()
    const along = (mm) => project(h.position.x + h.dir.x * mm, h.position.y + h.dir.y * mm, h.position.z + h.dir.z * mm)
    const size = h.mesh.scale.x
    return { grip: along(size * 0.45), out: along(size * 0.45 + 5) }
  })
  await page.mouse.move(at.grip[0], at.grip[1])
  await sleep(250)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(at.grip[0] + ((at.out[0] - at.grip[0]) * i) / 8, at.grip[1] + ((at.out[1] - at.grip[1]) * i) / 8)
    await sleep(40)
  }
  await page.mouse.up()
  await sleep(300)
  const dragged = await re(() => -window.__re.store.getState().extrudeDraft.draftDeg)
  // 30 mm up, the edge 5.29 mm out at 10°; 5 mm more is 18.4°.
  check(dragged > 15 && dragged < 22, `pulling the arrow out leans the sides further (${dragged}°)`)
  const field = await page.$eval('[data-test=grip-field]', (i) => i.value).catch(() => null)
  check(field !== null && Math.abs(Number(field) - dragged) < 1e-6, `the grip's field reads the taper (${field})`)
  await ghost()
  await page.screenshot({ path: shotPath('coil-taper-2-taper-dragged.png') })
}
await type('extrude-taper', 10)
await click(page, '[data-test=extrude-create]')
await settled()
{
  const body = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id + 1), block)
  const t = 30 * Math.tan((10 * Math.PI) / 180)
  const a1 = 40 * 20
  const a2 = (40 + 2 * t) * (20 + 2 * t)
  const frustum = (30 / 3) * (a1 + a2 + Math.sqrt(a1 * a2))
  check(body && body.closed && Math.abs(body.volume - frustum) / frustum < 5e-3, `the block is a closed frustum of the right volume (${body?.volume.toFixed(1)} of ${frustum.toFixed(1)} mm³)`)
  // The sketch's 40 × 20 at the bottom, the top as wide as the lean puts it.
  const caps = await re((id) => window.__re.topology(id).faces.filter((f) => f.fingerprint.kind === 'plane' && Math.abs(f.fingerprint.dir[2]) > 0.999).map((f) => ({ z: f.fingerprint.centroid[2], area: f.fingerprint.area })), block + 1)
  const bottom = caps.find((c) => Math.abs(c.z) < 1e-6)
  const top = caps.find((c) => Math.abs(c.z - 30) < 1e-6)
  check(bottom && Math.abs(bottom.area - a1) < 1e-3 && top && Math.abs(top.area - a2) / a2 < 5e-3, `the sketch is the bottom, the top leans out to it (${bottom?.area.toFixed(1)} → ${top?.area.toFixed(1)} of ${a2.toFixed(1)} mm²)`)
  await showOnly(block + 1)
  await page.screenshot({ path: shotPath('coil-taper-3-taper-body.png') })
  await re(() => window.__re.scene().viewFrom('front'))
  await sleep(500)
  await page.screenshot({ path: shotPath('coil-taper-3b-taper-front.png') })
}

// ---- a spring ---------------------------------------------------------------------------
// On the XZ plane: a circle 12 mm off a line standing up the sheet at x = 60.
const XZ = { origin: [0, 0, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] }
const spring = await re((frame) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'y', offset: 0 }, frame)
  s().setSketchTool('circle')
  s().sketchClick([72, 0], 0.01, false, { off: true })
  s().sketchClick([73.5, 0], 0.01, false, { off: true })
  s().setSketchTool('line')
  s().sketchClick([60, -5], 0.01, false, { off: true })
  s().sketchClick([60, 30], 0.01, false, { off: true })
  s().setSketchTool('select')
  const line = s().sketchDraft.sketch.entities.find((e) => e.kind === 'line').id
  const id = s().commitSketch()
  s().startRevolve(id, null, { kind: 'sketchLine', entity: line })
  return id
}, XZ)
await page.waitForSelector('[data-test=revolve-coil]')
check((await page.$('[data-test=revolve-pitch]')) === null, 'a plain revolve shows no pitch')
await click(page, '[data-test=revolve-coil]')
await page.waitForSelector('[data-test=revolve-pitch]')
const started = await re(() => {
  const d = window.__re.store.getState().revolveDraft
  return { pitch: d.pitch, angle: d.angleDeg }
})
// A Ø3 section: half again its 3 mm is 4.5 mm a turn.
check(started.pitch === 4.5 && started.angle === 1080, `ticked Coil starts at three turns, the pitch clear of the section (${JSON.stringify(started)})`)
check(/New coil/.test(await page.$eval('[data-test=revolve-editor] .sec-head', (e) => e.textContent)), 'the box calls it a coil')
await type('revolve-turns', 5)
await type('revolve-pitch', 5)
const set = await re(() => {
  const d = window.__re.store.getState().revolveDraft
  return { pitch: d.pitch, angle: d.angleDeg }
})
check(set.angle === 1800 && set.pitch === 5, `five turns typed are 1800° (${JSON.stringify(set)})`)
check(Number(await page.$eval('[data-test=revolve-height]', (i) => i.value)) === 25, 'the height reads five turns of 5 mm')
await ghost()
check(await re(() => window.__re.store.getState().preview.status) === 'ok', 'the coil ghost builds')
await re(() => {
  window.__re.scene().viewFrom('iso')
  window.__re.scene().frameAll()
})
await sleep(600)
await page.screenshot({ path: shotPath('coil-taper-4-spring-ghost.png') })
await click(page, '[data-test=revolve-create]')
await settled()
{
  const coilFeature = await re(() => window.__re.store.getState().features.at(-1))
  check(coilFeature.kind === 'revolve' && coilFeature.name === 'Coil 1' && coilFeature.pitch === 5 && coilFeature.angleDeg === 1800, `the feature is Coil 1, 1800° at 5 mm (${coilFeature.name})`)
  const body = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id), coilFeature.id)
  const want = Math.PI * 1.5 ** 2 * 2 * Math.PI * 12 * 5
  check(body && body.closed && Math.abs(body.volume - want) / want < 1e-3, `the spring is a closed solid of the right volume (${body?.volume.toFixed(1)} of ${want.toFixed(1)} mm³)`)
  await showOnly(coilFeature.id)
  await page.screenshot({ path: shotPath('coil-taper-5-spring-body.png') })
}

// ---- a thread cut into a bar -------------------------------------------------------------
// A Ø10 bar 20 long standing at y = 60, and on the plane through its axis a
// 60° vee reaching past its surface, the axis a line of the sketch.
const bar = await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  s().setSketchTool('circle')
  s().sketchClick([0, 60], 0.01, false, { off: true })
  s().sketchClick([5, 60], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().setExtrude({ extent: { kind: 'distance', from: 0, to: 20 }, op: 'new' })
  s().commitExtrude()
  return id + 1
})
await settled()
const vee = await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'y', offset: 60 }, { origin: [0, 60, 0], normal: [0, -1, 0], basisU: [1, 0, 0], basisV: [0, 0, 1] })
  s().setSketchTool('line')
  const h = 0.65
  s().sketchClick([5.3, 1 - h], 0.01, false, { off: true })
  s().sketchClick([5.3, 1 + h], 0.01, false, { off: true })
  s().sketchClick([4.1, 1], 0.01, false, { off: true })
  s().sketchClick([5.3, 1 - h], 0.01, false, { off: true })
  s().setSketchTool('select')
  s().setSketchTool('line')
  s().sketchClick([0, -2], 0.01, false, { off: true })
  s().sketchClick([0, 25], 0.01, false, { off: true })
  s().setSketchTool('select')
  const axis = s().sketchDraft.sketch.entities.filter((e) => e.kind === 'line').find((e) => e.a[0] === 0 && e.b[0] === 0)
  const id = s().commitSketch()
  s().startRevolve(id, null, axis ? { kind: 'sketchLine', entity: axis.id } : null)
  return { id, axis: axis?.id ?? null, regions: s().revolveDraft.regions.length }
})
check(vee.axis !== null && vee.regions === 1, `the vee closes one region and the axis is its line (${JSON.stringify(vee)})`)
await click(page, '[data-test=revolve-coil]')
await page.waitForSelector('[data-test=revolve-pitch]')
await type('revolve-pitch', 1.5)
await type('revolve-turns', 12)
await page.select('[data-test=revolve-op]', 'cut')
await ghost()
await click(page, '[data-test=revolve-create]')
await settled()
{
  const result = await re(() => {
    const s = window.__re.store.getState()
    const f = s.features.at(-1)
    return { name: f.name, status: s.results[f.id]?.status, message: s.results[f.id]?.message }
  })
  check(result.status === 'ok', `the thread is cut (${JSON.stringify(result)})`)
  const body = await re((id) => window.__re.store.getState().bodies.find((b) => b.id === id), bar)
  const cylinder = Math.PI * 25 * 20
  check(body && body.closed && body.volume < cylinder * 0.95 && body.volume > cylinder * 0.7, `the bar is threaded, closed, and lighter by the groove (${body?.volume.toFixed(1)} of ${cylinder.toFixed(1)} mm³)`)
  await showOnly(bar)
  await page.screenshot({ path: shotPath('coil-taper-6-thread.png') })
}

await finish(browser, consoleErrors)
