// SPDX-License-Identifier: AGPL-3.0-only
// The 2D sheet worked by an agent that cannot see it: an MCP client starts
// the scanruler-mcp server (mcp/), the app in headless Chrome is paired with
// it, and a flatbed scan of four knurled inserts — three standing upright,
// one lying on its side — is measured through the tools alone. Open the
// image, picture it, find the parts, count each one's teeth round its rim or
// along its flanks, fit a rim by its edge chain, place a pick and read where
// it snapped, miss an edge and be told where it is, write a note beside each
// part, change and remove things, picture one part close up, and export the
// sheet with the notes on it. The pictures land in OUT_DIR to look at.
//
// The scan is generated — exact by construction, so the counts are exact and
// the sizes tight: 600 dpi, dark parts on a white lid, soft-shouldered edges.
//
// Prereqs: dev server running (npm run dev), Chrome, and the server's
// dependencies (npm --prefix mcp ci).
//   node scripts/e2e-agent-flat.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from './e2e-lib.mjs'
import { encodeGrayPng } from './e2e-flat-fixture.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../mcp/tests/client.js')

// ---- the scan ------------------------------------------------------------------
// In sheet millimetres, y up, as ScanRuler reads the image.
const PPM = 23.622 // 600 dpi
const W = 1400
const H = 720
const UPRIGHT = [
  { c: [10, 20], R: 4, a: 0.25, N: 10, bore: 1.5 },
  { c: [25, 20], R: 5, a: 0.25, N: 14, bore: 2 },
  { c: [40, 20], R: 6, a: 0.25, N: 18, bore: 2.5 },
]
// Lying at 15° to the sheet, ten long, eight teeth a side halfway between
// its ends.
const LYING = { c: [28, 7], angle: (15 * Math.PI) / 180, half: 5, h: 2.75, a: 0.25, pitch: 1.25, teeth: 8 }

/** How far inside a part a sheet place lies, mm — negative outside. */
function inside([x, y]) {
  let best = -Infinity
  for (const u of UPRIGHT) {
    const dx = x - u.c[0]
    const dy = y - u.c[1]
    const rho = Math.hypot(dx, dy)
    const rim = u.R + u.a * Math.cos(u.N * Math.atan2(dy, dx))
    best = Math.max(best, Math.min(rim - rho, rho - u.bore))
  }
  const d = [Math.cos(LYING.angle), Math.sin(LYING.angle)]
  const s = (x - LYING.c[0]) * d[0] + (y - LYING.c[1]) * d[1]
  const t = -(x - LYING.c[0]) * d[1] + (y - LYING.c[1]) * d[0]
  const flank = LYING.h + LYING.a * Math.cos((2 * Math.PI * (s + LYING.half - LYING.pitch / 2)) / LYING.pitch)
  return Math.max(best, Math.min(LYING.half - Math.abs(s), flank - Math.abs(t)))
}

function scanPng() {
  const gray = new Uint8Array(W * H)
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      // Row 0 of a PNG is the top of the sheet.
      const d = inside([(col + 0.5) / PPM, (H - row - 0.5) / PPM]) * PPM
      gray[row * W + col] = d >= 1 ? 30 : d <= -1 ? 225 : 30 + (225 - 30) * (0.5 - 0.5 * Math.sin((d * Math.PI) / 2))
    }
  }
  return encodeGrayPng(gray, W, H, PPM)
}

mkdirSync(OUT_DIR, { recursive: true })
const SCAN = join(OUT_DIR, 'inserts.png')
writeFileSync(SCAN, scanPng())
console.log(`scan: ${SCAN}`)

// ---- pairing ------------------------------------------------------------------
const { agent, port, token } = await launchAgent(startAgent)
const { call } = agent
const status = await call('scanruler_status')
const link = /(\S+#agent=\d+:[\w-]+)/.exec(status.json?.howToConnect ?? '')?.[1]
check(Boolean(link) && link.includes(`#agent=${port}:${token}`), 'status hands out the pairing link')
const { browser, page, consoleErrors } = await launchApp({ url: link })
const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 60 })
check(waited.json?.connected === true, 'the page connected')

const { tools } = await agent.client.listTools()
const names = tools.map((t) => t.name)
for (const n of ['flat_render', 'flat_edges', 'flat_objects', 'flat_profile', 'flat_note_add', 'flat_edit', 'flat_remove']) check(names.includes(n), `${n} is listed`)

/** A picture's bytes saved to look at. */
const keep = (r, name) => {
  const img = r.images?.[0]
  if (img) writeFileSync(join(OUT_DIR, name), Buffer.from(img.data, 'base64'))
  return img
}

// ---- the sheet ---------------------------------------------------------------------
const opened = await call('flat_open_image', { path: SCAN })
check(!opened.error && Math.abs(opened.json?.flat?.calibration?.pxPerMm?.x - PPM) < 0.01, `flat_open_image: ${opened.json?.flat?.image?.fileName ?? opened.text}, ${opened.json?.flat?.calibration?.pxPerMm?.x} px/mm`)

const whole = await call('flat_render')
const map = whole.json?.map
check(Boolean(keep(whole, 'e2e-agent-flat-sheet.png')) && whole.json?.width === 800, `flat_render: the whole sheet, ${whole.json?.width} × ${whole.json?.height}, grid ${whole.json?.grid} ${whole.json?.unit}`)
// The picture is whole pixels: the sheet sits centred in it, a fraction of a
// pixel to spare along the side that rounded.
check(Math.abs(map?.left) < map?.unitsPerPx && Math.abs(map?.top - H / PPM) < map?.unitsPerPx && Math.abs(map?.unitsPerPx / (W / PPM / 800) - 1) < 0.003, `flat_render map: left ${map?.left}, top ${map?.top}, ${map?.unitsPerPx} mm a pixel`)

const state = (await call('session_state')).json?.flat
check(state?.sheet?.frame?.includes('bottom-left') && Math.abs(state.sheet.max[0] - W / PPM) < 0.01, `session_state: the sheet ${JSON.stringify(state?.sheet)}`)
check(state?.edges?.status === 'ready' && state.edges.chains > 0, `session_state: ${state?.edges?.chains} edge chains`)

// ---- the parts -------------------------------------------------------------------
const found = await call('flat_objects')
const objects = found.json?.objects ?? []
check(objects.length === 4, `flat_objects: ${objects.length} parts${found.error ? ` — ${found.text}` : ''}`)
UPRIGHT.forEach((u, i) => {
  const o = objects[i]
  check(
    o && Math.hypot(o.centroid[0] - u.c[0], o.centroid[1] - u.c[1]) < 0.05 && o.holes === 1 && Math.abs(o.feret.max - 2 * (u.R + u.a)) < 0.15,
    `object ${i + 1}: centre [${o?.centroid?.map((v) => v.toFixed(2))}], Feret ${o?.feret?.min?.toFixed(2)}–${o?.feret?.max?.toFixed(2)}, ${o?.holes} hole, chains ${JSON.stringify(o?.chains)}`,
  )
})
const lying = objects[3]
check(lying && Math.abs(lying.axisAngle - 15) < 1.5, `object 4 lies at ${lying?.axisAngle?.toFixed(1)}°`)

for (const [i, u] of UPRIGHT.entries()) {
  const p = await call('flat_profile', { object: i + 1 })
  const side = p.json?.sides?.[0]
  check(side?.count === u.N && Math.abs(side.diameter.peaks - 2 * (u.R + u.a)) < 0.1, `flat_profile object ${i + 1}: ${side?.count} teeth (made with ${u.N}), Ø ${side?.diameter?.peaks?.toFixed(3)} over the teeth, ${side?.diameter?.valleys?.toFixed(3)} at the roots${p.error ? ` — ${p.text}` : ''}`)
}
const flanks = await call('flat_profile', { object: 4, axis: 'axial' })
const counts = flanks.json?.sides?.map((s) => s.count)
const pitches = flanks.json?.sides?.map((s) => s.pitch) ?? []
check(counts?.length === 2 && counts.every((n) => n === LYING.teeth) && pitches.every((p) => Math.abs(p / LYING.pitch - 1) < 0.01),`flat_profile object 4 along its axis: ${JSON.stringify(counts)} teeth a side (made with ${LYING.teeth}), pitch ${flanks.json?.sides?.map((s) => s.pitch?.toFixed(3))}`)

const marked = await call('flat_profile', { object: 2, mark: true })
check(marked.json?.counts?.length === 1, `flat_profile mark: ${JSON.stringify(marked.json?.counts)}`)
const undoTitle = await page.$eval('[data-test="undo"]', (e) => e.title).catch(() => '')
check(undoTitle.startsWith('Undo: Agent: mark profile peaks'), `the undo key names the step: "${undoTitle}"`)

// ---- edges by number, picks, misses -------------------------------------------------
const rimChain = objects[0]?.chains?.[0]
const rim = await call('flat_fit', { kind: 'circle', chains: [rimChain], name: 'Rim 1' })
check(!rim.error && Math.abs(rim.json?.element?.fit?.radius - UPRIGHT[0].R) < 0.1, `flat_fit by chain ${rimChain}: r ${rim.json?.element?.fit?.radius?.toFixed(3)}${rim.error ? ` — ${rim.text}` : ''}`)
const nearBore = await call('flat_edges', { near: [UPRIGHT[1].c[0] + UPRIGHT[1].bore + 0.05, UPRIGHT[1].c[1]], reach: 1, tolerance: 0.05, limit: 1 })
const bore = nearBore.json?.items?.[0]
check(bore?.closed === true && Math.abs(bore.length - 2 * Math.PI * UPRIGHT[1].bore) < 0.3 && bore.polyline?.length > 8, `flat_edges near the bore: chain ${bore?.id}, ${bore?.length?.toFixed(2)} mm round, ${bore?.polyline?.length} points thinned`)
const pick = await call('flat_fit', { kind: 'point', points: [[UPRIGHT[1].c[0] + UPRIGHT[1].bore + 0.2, UPRIGHT[1].c[1]]], reach: 0.5 })
const landed = pick.json?.picks?.[0]
check(landed?.chain === bore?.id && Math.abs(landed.moved - 0.2) < 0.05, `a pick 0.2 mm off the bore snapped onto chain ${landed?.chain}, moved ${landed?.moved?.toFixed(3)} mm`)
const miss = await call('flat_fit', { kind: 'circle', method: 'flat-circle-seed', points: [[25, 28]] })
check(miss.error && /nearest is chain \d+, [\d.]+ mm away at \[/.test(miss.text), `a seed off every edge says where the nearest is: ${miss.text.slice(0, 160)}`)

// ---- notes, changes, removals --------------------------------------------------
for (const [i, u] of UPRIGHT.entries()) {
  const n = await call('flat_note_add', { text: `#${i + 1}: ${u.N} teeth\nØ ${(2 * (u.R + u.a)).toFixed(1)}`, at: [u.c[0] - u.R, u.c[1] + u.R + 1.2] })
  check(!n.error && n.json?.note?.id === i + 1, `flat_note_add beside part ${i + 1}`)
}
const changed = await call('flat_edit', { element: 'Rim 1', name: 'Insert 1 rim' })
check(changed.json?.flat?.elements?.some((e) => e.name === 'Insert 1 rim'), 'flat_edit renames an element')
const wrongSide = await call('element_remove', { element: 'Insert 1 rim' })
check(wrongSide.error && wrongSide.text.includes('on the 2D sheet'), `element_remove points at the sheet: ${wrongSide.text.slice(0, 120)}`)
const removed = await call('flat_remove', { elements: ['Point 1'] })
check(JSON.stringify(removed.json?.removed) === '["Point 1"]', `flat_remove: ${JSON.stringify(removed.json?.removed ?? removed.text)}`)
await page.waitForFunction(() => document.querySelectorAll('.note-label').length === 3, { timeout: 5000 }).catch(() => fail('the three notes are on the stage'))

const close = await call('flat_render', { frame: { at: UPRIGHT[1].c, size: 14 }, width: 700, height: 700 })
check(Boolean(keep(close, 'e2e-agent-flat-close.png')) && close.json?.width === 700 && Math.abs(close.json?.map?.unitsPerPx - 0.02) < 1e-6, `flat_render close up on part 2: ${close.json?.map?.unitsPerPx} mm a pixel, grid ${close.json?.grid}`)
const bare = await call('flat_render', { frame: { min: [0, 0], max: [20, 30] }, show: { edges: false, grid: false, labels: false } })
check(Boolean(keep(bare, 'e2e-agent-flat-bare.png')), 'flat_render with layers put away')

const svg = await call('export_svg', { path: OUT_DIR })
const svgText = svg.json?.file?.path ? readFileSync(svg.json.file.path, 'utf8') : ''
check(svgText.includes('#2: 14 teeth') && svgText.includes('class="note"'), `export_svg carries the notes (${svg.json?.file?.name ?? svg.text})`)
const report = await call('flat_report')
check(/Notes\n {2}#1: 10 teeth \/ Ø 8\.5/.test(report.json?.text ?? ''), 'flat_report lists the notes')
console.log(report.json?.text)

const threeD = await call('view_render')
check(threeD.error && /flat[._]render/.test(threeD.text), `view_render refuses while the sheet has the screen: ${threeD.text.slice(0, 100)}`)

await page.screenshot({ path: join(OUT_DIR, 'e2e-agent-flat.png') })
await finish(browser, consoleErrors)
await agent.close()
