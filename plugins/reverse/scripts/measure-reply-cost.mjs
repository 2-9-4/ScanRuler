// SPDX-License-Identifier: AGPL-3.0-only
// What the tools' answers cost an agent, measured on a real project: the
// project in MEASURE_PROJECT (its scan with it) opened through scanruler-mcp
// in the app in Chrome, and each call the skills' reply-cost tables name made
// as an agent makes it — the answer's text as the client gets it (rounded
// by the server, as it is), in bytes and in tokens at four bytes a token; a
// picture at width × height / 750 tokens, as Claude counts an image. One
// JSON line per call to MEASURE_OUT, or the console.
//   APP_URL=http://localhost:5188/ MEASURE_PROJECT=… node plugins/reverse/scripts/measure-reply-cost.mjs
import { appendFileSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { APP_URL, CHROME, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

const PROJECT = process.env.MEASURE_PROJECT
if (!PROJECT) throw new Error('MEASURE_PROJECT names the .scanruler file.')
const { startAgent } = await import(`file://${repoFile('mcp/tests/client.js').replace(/\\/g, '/')}`)
const port = await new Promise((resolve) => {
  const s = createServer().listen(0, () => {
    const p = s.address().port
    s.close(() => resolve(p))
  })
})
const agent = await startAgent({ args: ['--port', String(port), '--out', OUT_DIR, '--app', APP_URL], env: { SCANRULER_MCP_TOKEN: `cost-${Date.now().toString(36)}`, SCANRULER_MCP_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'scanruler-mcp-')) }, stderr: 'ignore' })
const ok = async (name, input) => {
  const r = await agent.call(name, input)
  if (r.error) throw new Error(`${name}: ${r.text}`)
  return r
}
const rows = []
/** One row: the call made and its answer measured. */
const cost = async (row, name, input) => {
  const r = await agent.call(name, input)
  const bytes = Buffer.byteLength(r.text, 'utf8')
  const image = r.images?.[0]
  let imageTokens = 0
  if (image) {
    const png = Buffer.from(image.data, 'base64')
    imageTokens = Math.round((png.readUInt32BE(16) * png.readUInt32BE(20)) / 750)
  }
  const line = { row, tool: name, bytes, tokens: Math.round(bytes / 4) + imageTokens, ...(image ? { imageTokens } : {}), ...(r.error ? { error: r.text.slice(0, 120) } : {}) }
  rows.push(line)
  if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, JSON.stringify(line) + '\n')
  console.log(JSON.stringify(line))
  return r
}

const link = /(\S+#agent=\d+:[\w-]+)/.exec((await ok('scanruler_status')).json.howToConnect ?? '')?.[1]
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1500,950', '--no-sandbox'], defaultViewport: { width: 1500, height: 950 }, protocolTimeout: 1_800_000 })
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('scanruler.askstlunits', '0') } catch { /* no storage */ }
  try { localStorage.setItem('scanruler.agentdataok', '1') } catch { /* no storage */ }
})
await page.goto(link, { waitUntil: 'networkidle0' })
await ok('scanruler_wait', { for: 'page', timeoutSeconds: 120 })
await ok('project_load', { path: PROJECT, discard: true })
await ok('scanruler_wait', { for: 'idle', timeoutSeconds: 1800 })
await ok('workspace_set', { workspace: 'reverse' })
await ok('reverse_build', {})

// ---- the Reverse engineer's rows -------------------------------------------------
const bodies = await page.evaluate(() => window.__re.store.getState().bodies.map((b) => ({ id: b.id, volume: b.volume, box: b.box })))
const body = bodies.sort((a, b) => b.volume - a.volume)[0]
const edges = (await ok('reverse_body_describe', { body: body.id, sort: 'largest' })).json.bodies[0].edgeList.filter((e) => e.kind === 'line').slice(0, 15)
let edge = null
for (const e of edges) {
  const a = await ok('reverse_feature_add', { feature: { kind: 'fillet', body: body.id, edges: [e.index], radius: 0.4 }, detail: 'none' })
  await ok('history_undo', {})
  await ok('scanruler_wait', { for: 'idle', timeoutSeconds: 600 })
  if (a.json.status === 'ok') {
    edge = e.index
    break
  }
}
const fillet = { kind: 'fillet', body: body.id, edges: [edge], radius: 0.4 }
for (const detail of ['none', 'brief', 'full']) {
  const r = await cost(`reverse_feature_add detail ${detail}, a fillet`, 'reverse_feature_add', { feature: fillet, detail })
  if (!r.error) await ok('history_undo', {})
}
const sketch = await cost('reverse_feature_add detail brief, a sketch', 'reverse_feature_add', { feature: { kind: 'sketch', name: 'Cost probe', plane: { kind: 'world', axis: 'z', offset: body.box.max[2] }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [(body.box.min[0] + body.box.max[0]) / 2, (body.box.min[1] + body.box.max[1]) / 2], size: [5, 5], fixed: true }] } } })
if (!sketch.error) await ok('history_undo', {})
await cost('reverse_feature_list rows', 'reverse_feature_list', {})
const firstSketch = (await ok('reverse_feature_list', {})).json.features.find((f) => f.kind === 'sketch')
await cost('reverse_feature_list one sketch', 'reverse_feature_list', { feature: firstSketch.id })
await cost('reverse_feature_list detail full', 'reverse_feature_list', { detail: 'full' })
await cost('reverse_feature_schema sketch', 'reverse_feature_schema', { kind: 'sketch' })
await cost('reverse_body_describe one body', 'reverse_body_describe', { body: body.id })
await cost('reverse_body_describe edges false', 'reverse_body_describe', { body: body.id, edges: false })
await cost('reverse_body_describe fingerprints', 'reverse_body_describe', { body: body.id, fingerprints: true })
await cost('reverse_body_describe where + limit 5', 'reverse_body_describe', { body: body.id, where: { kind: 'plane' }, limit: 5 })
await cost('reverse_body_compare defaults', 'reverse_body_compare', {})
await cost('reverse_body_check with audit', 'reverse_body_check', { body: body.id })
const z = (k) => body.box.min[2] + (k / 7) * (body.box.max[2] - body.box.min[2])
const offsets = [1, 2, 3, 4, 5, 6].map(z)
await cost('reverse_section_stack 6 offsets', 'reverse_section_stack', { plane: { kind: 'world', axis: 'z' }, offsets })
await cost('reverse_section_stack 6 offsets pieces', 'reverse_section_stack', { plane: { kind: 'world', axis: 'z' }, offsets, pieces: true })
await cost('view_render 800 px', 'view_render', { view: 'iso', fit: true })
await cost('view_render width 1400', 'view_render', { view: 'iso', fit: true, width: 1400 })
const params = (await ok('reverse_parameter_list', {})).json.parameters ?? []
if (params.length === 0) await ok('reverse_parameter_add', { name: 'costProbe', expression: '3' })
const param = params[0] ?? { name: 'costProbe', expression: '3' }
await cost('reverse_parameter_set', 'reverse_parameter_set', { parameter: param.name, expression: String(param.expression) })
await cost('session_state mid-model', 'session_state', {})
const single = await agent.call('reverse_body_check', { body: body.id, audit: false })
const batched = await cost('scanruler_batch one call', 'scanruler_batch', { calls: [{ tool: 'reverse_body_check', arguments: { body: body.id, audit: false } }] })
rows.push({ row: 'scanruler_batch overhead per call', bytes: Buffer.byteLength(batched.text) - Buffer.byteLength(single.text), tokens: Math.round((Buffer.byteLength(batched.text) - Buffer.byteLength(single.text)) / 4) })
console.log(JSON.stringify(rows.at(-1)))
if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, JSON.stringify(rows.at(-1)) + '\n')
const plain = await agent.call('scanruler_batch', { calls: [{ tool: 'reverse_feature_add', arguments: { feature: fillet, detail: 'none' } }] })
await ok('history_undo', {})
const timed = await agent.call('scanruler_batch', { calls: [{ tool: 'reverse_feature_add', arguments: { feature: fillet, detail: 'none' } }], timings: true })
await ok('history_undo', {})
rows.push({ row: 'scanruler_batch timings per change', bytes: Buffer.byteLength(timed.text) - Buffer.byteLength(plain.text), tokens: Math.round((Buffer.byteLength(timed.text) - Buffer.byteLength(plain.text)) / 4) })
console.log(JSON.stringify(rows.at(-1)))
if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, JSON.stringify(rows.at(-1)) + '\n')

// ---- the measuring rows, on the same scan ---------------------------------------
await ok('workspace_set', { workspace: 'measure' })
const state = (await ok('session_state', {})).json
const [min, max] = [state.scan.bounds.min, state.scan.bounds.max]
const mid = min.map((v, i) => (v + max[i]) / 2)
await cost('scan_query limit 1000', 'scan_query', { near: { at: mid, radius: 1e6 }, limit: 1000 })
await cost('scan_query limit 5000', 'scan_query', { near: { at: mid, radius: 1e6 }, limit: 5000 })
// A fit where one takes: the bottom, the top, the sides, as a plane then a
// cylinder — the first that fits is the row.
const places = [[mid[0], mid[1], min[2]], [mid[0], mid[1], max[2]], [max[0], mid[1], mid[2]], [mid[0], max[1], mid[2]], [min[0], mid[1], mid[2]]]
let fitted = false
for (const kind of ['plane', 'cylinder']) {
  for (const point of places) {
    if (fitted) break
    const tried = await agent.call('element_fit', { kind, at: { point } })
    if (tried.error) continue
    await ok('history_undo', {})
    await cost(`element_fit one ${kind}`, 'element_fit', { kind, at: { point } })
    fitted = true
  }
}
const cut = await ok('section_cut', { across: 'XY', offset: mid[2] })
const section = cut.json.section?.id ?? cut.json.id
await cost('section_get limit 4000', 'section_get', { section })
await cost('section_get limit 1000', 'section_get', { section, limit: 1000 })
await cost('session_state a few elements', 'session_state', {})
await cost('report_get json', 'report_get', { format: 'json' })
await cost('report_get text', 'report_get', { format: 'text' })
await browser.close()
await agent.close()
