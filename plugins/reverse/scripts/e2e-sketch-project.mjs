// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of a sketch on a face of a body, its outline projected,
// over a scan the body was modelled a hair inside of — as a body modelled
// on a scan is: the slice of the scan runs a tenth of a millimetre off the
// projected edges. Checks that a line drawn with the mouse onto a projected
// edge is held on it, though a point of the slice lies within reach; that
// the Project tool's piece keeps the edge it came from; and that when an
// earlier feature moves the edge — the block made narrower — the build
// takes the outline again and the line's end goes with it.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-sketch-project.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBinarySTL } from 'meshstep'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'
import { blockScan } from '../../../scripts/e2e-fixtures.mjs'

const W = 40, D = 20, H = 12
/** How far inside the scan the block is modelled. */
const IN = 0.1

// ---- the scan: a dense block on the XY plane -------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'scanruler-sketch-project-'))
/** A block from the origin, every face a 1 mm grid of triangles wound
 *  outward. */
const scanPath = join(dir, 'block-scan.stl')
writeFileSync(scanPath, Buffer.from(writeBinarySTL(blockScan(W, D, H))))

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 })
await loadScan(page, scanPath, { inputSelector: '[data-test=slot-scan] input[type=file]', settle: 500 })

const { re, built } = reverseHelpers(page)

// ---- the model: a block a tenth inside the scan, 10 tall -------------------------
const baseId = await re(
  (w, d, inset) => {
    const s = window.__re.store.getState()
    s.startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.getState().setSketchTool('rectangle')
    window.__re.store.getState().sketchClick([inset, inset], 0.01, false, { off: true })
    window.__re.store.getState().sketchClick([w - inset, d - inset], 0.01, false, { off: true })
    const id = window.__re.store.getState().commitSketch()
    window.__re.store.getState().startExtrude(id)
    window.__re.store.getState().setExtrude({ extent: { kind: 'distance', from: 0, to: 10 } })
    window.__re.store.getState().commitExtrude()
    return id
  },
  W,
  D,
  IN,
)
await built()

// ---- a sketch on the top face, its outline projected -----------------------------
await re(() => {
  const s = window.__re.store.getState()
  const id = s.bodies[0].id
  const t = window.__re.topology(id)
  const top = t.faces.find((f) => f.fingerprint.dir[2] > 0.9)
  s.setSelection({ kind: 'bodyFace', bodyId: id, face: top, edges: t.edges.filter((e) => e.faces.includes(top.hash)), at: { x: 700, y: 300 } })
})
await click(page, '[data-test=chip-sketch-here]')
await page.waitForSelector('[data-test=sketch-editor]')
await page.waitForFunction(() => (window.__re.chains()?.chains.length ?? 0) > 0, { timeout: 30_000 })
await sleep(800)
const outline = await re(() => {
  const s = window.__re.store.getState()
  const d = s.sketchDraft
  const body = s.bodies[0].id
  const right = d.sketch.entities.find((e) => e.kind === 'line' && Math.abs(e.a[0] - e.b[0]) < 1e-6 && e.a[0] > 20)
  return { pieces: d.sketch.entities.length, linked: d.sketch.entities.every((e) => e.projected && e.source?.body === body), right: right?.id ?? null, x: right?.a[0] ?? null }
})
console.log('outline:', JSON.stringify(outline))
check(outline.pieces === 4 && outline.linked, 'the face’s outline is projected in, each edge kept as its source')
check(outline.right !== null && Math.abs(outline.x - (W - IN)) < 1e-6, 'its right side lies where the block’s is')

/** A sheet point on the screen: the sheet's view centre is the canvas's. */
const toClient = (p) =>
  re(([x, y]) => {
    const v = window.__re.sheet().sheetView()
    const r = document.querySelector('[data-test=sketch-viewport] canvas').getBoundingClientRect()
    return [r.x + r.width / 2 + (x - v.centre[0]) / v.unitsPerScreenPx, r.y + r.height / 2 - (y - v.centre[1]) / v.unitsPerScreenPx]
  }, p)

// ---- a line drawn onto the projected side, where the slice runs beside it --------
// Clicked a few hundredths inside the side, which the scan's wall runs a
// tenth outside of: a slice point within the hand's reach.
const onSide = [W - IN - 0.03, 7]
const reach = await re(([x, y]) => {
  const upp = window.__re.sheet().sheetView().unitsPerScreenPx
  let near = Infinity
  for (const chain of window.__re.chains().chains) for (const p of chain) near = Math.min(near, Math.hypot(p[0] - x, p[1] - y))
  return { reach: 8 * upp, slice: near }
}, onSide)
console.log('reach:', JSON.stringify(reach))
check(reach.slice < reach.reach, `a point of the slice lies within reach of the click (${reach.slice.toFixed(3)} of ${reach.reach.toFixed(3)} mm)`)
await re(() => window.__re.store.getState().setSketchTool('line'))
for (const p of [[20, 10], onSide]) {
  const [x, y] = await toClient(p)
  await page.mouse.move(x, y)
  await sleep(150)
  await page.mouse.click(x, y)
  await sleep(250)
}
await page.keyboard.press('Escape')
await sleep(200)
const drawn = await re((right) => {
  const d = window.__re.store.getState().sketchDraft
  const line = d.sketch.entities.find((e) => e.kind === 'line' && !e.projected)
  const held = d.sketch.constraints.find((c) => c.kind === 'pointOn' && c.p.entity === line?.id && c.on.line === right)
  return { line: line?.id ?? null, b: line?.b ?? null, held: held ? held.p.at : null }
}, outline.right)
console.log('drawn:', JSON.stringify(drawn))
check(drawn.line !== null && drawn.held === 'b', 'the line’s end is held on the projected side, not left on the scan')
check(drawn.b !== null && Math.abs(drawn.b[0] - (W - IN)) < 1e-6, `and lies on it (x = ${drawn.b?.[0]})`)
await page.screenshot({ path: shotPath('sketch-project-held.png') })

// ---- the Project tool keeps the edge it takes ------------------------------------
// The block's bottom front edge, seen from above, on the top's front side.
await re(() => window.__re.store.getState().setSketchTool('project'))
{
  const [x, y] = await toClient([12, IN])
  await page.mouse.move(x, y)
  await sleep(150)
  await page.mouse.click(x, y)
  await sleep(250)
}
const projected = await re(() => {
  const s = window.__re.store.getState()
  const d = s.sketchDraft
  const extra = d.sketch.entities.filter((e) => e.projected).slice(4)
  return extra.map((e) => ({ kind: e.kind, body: e.source?.body ?? null, edge: Boolean(e.source?.edge), z: e.source?.edge?.mid[2] ?? null }))
})
console.log('projected:', JSON.stringify(projected))
check(projected.length === 1 && projected[0].edge && projected[0].body !== null, 'a piece the Project tool brings in keeps its edge')
await click(page, '[data-test=sketch-finish]')
await built()
const faceSketchId = await re(() => window.__re.store.getState().features.filter((f) => f.kind === 'sketch').at(-1).id)

// ---- the block made narrower: the outline is taken again, the line follows -------
await re(
  ({ id, from, to }) => {
    const store = window.__re.store
    const s = store.getState()
    const f = s.features.find((x) => x.id === id)
    const sketch = JSON.parse(JSON.stringify(f.sketch))
    for (const e of sketch.entities) {
      if (e.kind !== 'line') continue
      for (const k of ['a', 'b']) if (Math.abs(e[k][0] - from) < 1e-9) e[k] = [to, e[k][1]]
    }
    store.setState({ features: s.features.map((x) => (x.id === id ? { ...x, sketch } : x)), buildVersion: s.buildVersion + 1 })
  },
  { id: baseId, from: W - IN, to: W - 10 - IN },
)
await sleep(300)
await built()
await sleep(300)
const followed = await re(
  ({ id, right, line }) => {
    const s = window.__re.store.getState()
    const f = s.features.find((x) => x.id === id)
    const at = (e) => f.sketch.entities.find((x) => x.id === e)
    return { right: at(right), line: at(line), note: s.results[id]?.note ?? null, status: s.results[id]?.status ?? null }
  },
  { id: faceSketchId, right: outline.right, line: drawn.line },
)
console.log('followed:', JSON.stringify(followed))
check(followed.status === 'ok' && followed.note === null, 'the sketch on the face is placed again without a word')
check(Math.abs(followed.right.a[0] - (W - 10 - IN)) < 1e-6 && Math.abs(followed.right.b[0] - (W - 10 - IN)) < 1e-6, `its projected side has come 10 mm in with the block’s (x = ${followed.right.a[0]})`)
check(Math.abs(followed.line.b[0] - (W - 10 - IN)) < 1e-6, `the line’s end held on it came along (x = ${followed.line.b[0]})`)
await re(() => window.__re.scene().viewFrom('iso'))
await sleep(600)
await page.screenshot({ path: shotPath('sketch-project-followed.png') })

await finish(browser, consoleErrors)
