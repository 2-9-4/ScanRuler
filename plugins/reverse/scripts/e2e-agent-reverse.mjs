// SPDX-License-Identifier: AGPL-3.0-only
// The Reverse engineer workspace driven by an agent, end to end: an MCP
// client — the SDK's own, as Claude Code and the others use it — starts the
// scanruler-mcp server, the app in headless Chrome is paired with it, and a
// pin is modelled through the tools alone: a parameter l1 = 12 mm, a sketch
// dimensioned by it, a revolve, an M3 thread on the round face; then l1 = 20
// and the part is 8 mm longer. The person's side is checked too — the
// feature tree and the parameter in the panel, the undo key naming the
// agent's step — and what only the browser gives: a picture of the view as
// a PNG (view_render) and the body as STEP. history_undo puts l1 back.
//
// With --headless the same pin is modelled through scanruler-mcp running
// ScanRuler itself, headless (--engine, built here first): no browser, no
// page. What only the page gives answers unavailable, naming the page mode;
// a second headless server started beside the first shares nothing with it.
//
// Prereqs: dev server running (npm run dev), Chrome, and the server's
// dependencies (npm --prefix mcp ci); headless, the server's dependencies.
//   node plugins/reverse/scripts/e2e-agent-reverse.mjs [--headless]
// Env: APP_URL, CHROME, OUT_DIR.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_URL, check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile, sleep } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

/** The pin's half-profile on the YZ plane: a rectangle from the Z axis out
 *  to r 1.5, as long as the parameter l1. */
const PIN_SKETCH = {
  kind: 'sketch',
  name: 'Pin profile',
  plane: { kind: 'world', axis: 'x' },
  sketch: {
    entities: [
      { id: 1, kind: 'line', a: [0, 0], b: [1.5, 0] },
      { id: 2, kind: 'line', a: [1.5, 0], b: [1.5, 10] },
      { id: 3, kind: 'line', a: [1.5, 10], b: [0, 10] },
      { id: 4, kind: 'line', a: [0, 10], b: [0, 0] },
    ],
    constraints: [
      { kind: 'coincident', p: { entity: 1, at: 'b' }, q: { entity: 2, at: 'a' } },
      { kind: 'coincident', p: { entity: 2, at: 'b' }, q: { entity: 3, at: 'a' } },
      { kind: 'coincident', p: { entity: 3, at: 'b' }, q: { entity: 4, at: 'a' } },
      { kind: 'coincident', p: { entity: 4, at: 'b' }, q: { entity: 1, at: 'a' } },
      { kind: 'horizontal', entity: 1 },
      { kind: 'horizontal', entity: 3 },
      { kind: 'vertical', entity: 2 },
      { kind: 'collinear', line: 4, on: { datum: 'zx' } },
      { kind: 'collinear', line: 1, on: { datum: 'xy' } },
      { kind: 'length', entity: 1, value: 1.5 },
      { kind: 'length', entity: 2, expr: 'l1' },
    ],
  },
}

/** A call that should succeed: its JSON, or a failure with what it said. */
const okOn = (call) => async (name, input, what) => {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}

if (process.argv.includes('--headless')) {
  await headless()
  process.exit(process.exitCode ?? 0)
}

const { agent } = await launchAgent(startAgent)
const { call } = agent
const ok = okOn(call)

const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 300_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 60 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('reverse'), `the page connected with its plugins (${waited.json?.page?.plugins})`)
  const tools = (await agent.client.listTools()).tools
  const names = tools.map((t) => t.name)
  const wanted = ['reverse_feature_add', 'reverse_feature_schema', 'reverse_feature_update', 'reverse_parameter_set', 'reverse_body_describe', 'reverse_body_compare_in_deviation', 'reverse_export_step', 'view_render', 'view_set']
  check(wanted.every((n) => names.includes(n)), `the workspace’s tools are listed once the page is there (${names.filter((n) => n.startsWith('reverse_')).length} of them)`)
  // What a client takes: Claude Desktop turned a tool down whose schema was
  // 82 kB nested 20 deep. The budget is src/commands/schema.ts SCHEMA_BUDGET.
  const depth = (v) => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0)
  const heavy = tools.filter((t) => JSON.stringify(t.inputSchema).length > 8000 || depth(t.inputSchema) > 12).map((t) => t.name)
  const add = tools.find((t) => t.name === 'reverse_feature_add')
  check(heavy.length === 0, `every tool’s schema within 8000 bytes and 12 deep${heavy.length ? ` — not ${heavy.join(', ')}` : ''} (reverse_feature_add: ${JSON.stringify(add?.inputSchema ?? {}).length} bytes, ${depth(add?.inputSchema)} deep)`)
  const shape = await ok('reverse_feature_schema', { kind: 'thread' })
  check(shape.json?.schema?.properties?.size && shape.json?.example?.size === 'M3', 'reverse_feature_schema: the thread’s fields and an example')

  // ---- the pin, through the tools ------------------------------------------------
  const param = await ok('reverse_parameter_add', { name: 'l1', expression: '12' })
  check(param.json?.parameter?.value === 12, `reverse_parameter_add: l1 = ${param.json?.parameter?.value} mm`)

  const sketch = await ok('reverse_feature_add', { feature: PIN_SKETCH })
  check(sketch.json?.solve?.ok === true && sketch.json.solve.underConstrained.length === 0 && sketch.json.regions?.length === 1, `reverse_feature_add sketch: solved, fully defined, one region`)

  const revolve = await ok('reverse_feature_add', { feature: { kind: 'revolve', sketchId: 'Pin profile', axis: { kind: 'sketchLine', entity: 4 }, op: 'new' } })
  const body = revolve.json?.bodies?.changed?.[0]
  check(revolve.json?.result?.status === 'ok' && body?.closed && Math.abs(body.bounds.size[2] - 12) < 1e-3, `reverse_feature_add revolve: ${body?.name}, ${body?.bounds?.size?.[2]?.toFixed(3)} mm long`)

  const described = await ok('reverse_body_describe', { body: body?.id ?? 0, edges: false })
  const round = described.json?.bodies?.[0]?.faceList?.find((f) => f.kind === 'cylinder')
  check(round?.side === 'boss' && Math.abs(round.diameter - 3) < 1e-6, `reverse_body_describe: the round face is a Ø${round?.diameter} boss, face ${round?.index}`)

  const thread = await ok('reverse_feature_add', { feature: { kind: 'thread', body: body?.name, face: round?.index ?? 0, size: 'M3' }, detail: 'full' })
  check(thread.json?.result?.status === 'ok' && thread.json.feature.pitch === 0.5, `reverse_feature_add thread: M3×${thread.json?.feature?.pitch}, ${thread.json?.result?.status}`)

  // What the person sees.
  await page.waitForFunction(() => document.querySelectorAll('[data-test="feature-row"]').length === 3, { timeout: 30_000 }).catch(() => {})
  const rows = await page.$$eval('[data-test="feature-row"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
  check(rows.length === 3 && rows[0].includes('Pin profile') && rows[1].includes('Revolve 1') && rows[2].includes('Thread 1'), `the feature tree in the panel: ${JSON.stringify(rows)}`)
  // The Parameters section opens folded; unfolded as a person would.
  if ((await page.$eval('[data-test="parameters-fold"]', (e) => e.getAttribute('aria-expanded'))) !== 'true') await page.click('[data-test="parameters-fold"]')
  await page.waitForSelector('[data-test="parameter-row"]', { timeout: 10_000 }).catch(() => {})
  const params = await page.$$eval('[data-test="parameter-row"] [data-test="parameter-value"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
  check(params.length === 1 && /^12(\.0+)?\s*mm$/.test(params[0]), `the parameter in the panel: l1 ${JSON.stringify(params)}`)
  const failedRows = await page.$$('[data-test="feature-failed"]')
  check(failedRows.length === 0, 'no feature row says it failed')

  // ---- the parameter changed -----------------------------------------------------
  const set = await ok('reverse_parameter_set', { parameter: 'l1', expression: '20' })
  const longer = set.json?.bodies?.changed?.[0]?.bounds?.size?.[2]
  check(Math.abs(longer - 20) < 1e-3 && Math.abs(longer - body?.bounds?.size?.[2] - 8) < 1e-3 && !set.json?.failed, `reverse_parameter_set l1 = 20: the part is ${(longer - body?.bounds?.size?.[2]).toFixed(3)} mm longer, every feature built`)
  await sleep(300)
  const undoTitle = await page.$eval('[data-test="undo"]', (e) => e.title)
  check(undoTitle.startsWith('Undo: Agent: set l1 = 20'), `the undo key names the agent’s step: "${undoTitle}"`)

  // ---- what the browser gives ----------------------------------------------------
  const picture = await ok('view_render', { view: 'iso', fit: true, width: 800, height: 600, path: OUT_DIR })
  const png = picture.images?.[0]
  const bytes = png ? Buffer.from(png.data, 'base64') : Buffer.alloc(0)
  const size = bytes.length > 24 ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : null
  check(png?.mimeType === 'image/png' && bytes.subarray(1, 4).toString() === 'PNG' && size?.[0] === 800 && size?.[1] === 600, `view_render: an image block, PNG ${size?.join(' × ')} (${bytes.length} bytes)`)
  check(Boolean(picture.json?.file?.path) && existsSync(picture.json.file.path), `view_render wrote the picture where asked: ${picture.json?.file?.path}`)
  const set2 = await ok('view_set', { view: 'front' })
  check(set2.json?.view === 'front', 'view_set turns the view')
  // The bodies put away for a picture of the scan alone stay in the model.
  const away = await ok('view_set', { show: { bodies: false } })
  const awayState = await page.evaluate(() => ({ hidden: window.__re.store.getState().bodiesHidden, eyes: window.__re.store.getState().bodies.map((b) => b.visible) }))
  check(away.json?.shown?.bodies === false && awayState.hidden && awayState.eyes.every(Boolean), `view_set { show: { bodies: false } } puts the bodies away, their eyes open: ${JSON.stringify(awayState)}`)
  const shown = await ok('view_set', { show: { bodies: true } })
  check(shown.json?.shown?.bodies === true && (await page.evaluate(() => !window.__re.store.getState().bodiesHidden)), 'and show: { bodies: true } brings them back')
  // Compare in Deviation needs a scan; the blank stage has none.
  const noScan = await call('reverse_body_compare_in_deviation', {})
  check(noScan.error && noScan.text.startsWith('no_scan:'), `reverse_body_compare_in_deviation with no scan is refused: ${noScan.text.slice(0, 80)}`)

  const step = await ok('reverse_export_step', { path: OUT_DIR })
  const stepFile = step.json?.file?.path
  check(Boolean(stepFile) && existsSync(stepFile) && readFileSync(stepFile, 'utf8').startsWith('ISO-10303-21;') && /MANIFOLD_SOLID_BREP/.test(readFileSync(stepFile, 'utf8')), `reverse_export_step wrote ${stepFile} (${step.json?.file?.size} bytes)`)

  // ---- undo ------------------------------------------------------------------------
  const undone = await ok('history_undo')
  check(undone.json?.undone === 'Agent: set l1 = 20', `history_undo: ${undone.json?.undone}`)
  const back = await ok('reverse_build')
  check(Math.abs(back.json?.bodies?.[0]?.bounds?.size?.[2] - 12) < 1e-3, `the part is back at ${back.json?.bodies?.[0]?.bounds?.size?.[2]?.toFixed(3)} mm`)
  const state = await ok('session_state')
  check(state.json?.plugins?.reverse?.parameters?.[0]?.value === 12 && state.json.busy === null, 'session_state: l1 is 12 again, nothing busy')

  const refused = await call('reverse_feature_add', { feature: { kind: 'thread', body: 'Solid 1', face: 0, standard: 'acme' } })
  check(refused.error && refused.text.startsWith('invalid_input:'), `a thread form the workspace does not cut is refused: ${refused.text.slice(0, 90)}`)

  await batchChecks(call, ok)

  // ---- the tab hidden ------------------------------------------------------------
  // As Chrome has it in a background tab: the page says so, and a picture
  // still comes — its frames drawn by hand, the browser drawing none.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await sleep(200)
  const hiddenStatus = (await ok('scanruler_status')).json
  check(hiddenStatus?.page?.hidden === true && /hidden/.test(hiddenStatus.hiddenNote ?? ''), `scanruler_status: page.hidden ${hiddenStatus?.page?.hidden}, with a note`)
  const hiddenPicture = await ok('view_render', { view: 'iso', fit: true, width: 400, height: 300 })
  check(hiddenPicture.images?.[0]?.mimeType === 'image/png', 'view_render answers while the tab is hidden')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await sleep(200)
  check((await ok('scanruler_status')).json?.page?.hidden === false, 'and page.hidden false once shown again')

  await page.screenshot({ path: join(OUT_DIR, 'e2e-agent-reverse.png') })
} catch (e) {
  fail(`unexpected: ${e?.stack ?? e}`)
}
await finish(browser, consoleErrors)
await agent.close()

/** Twenty fillets in one batch answered at once as a job, then built; a
 *  batch refused part way, undone back to where it began; a batch timed. */
async function batchChecks(call, ok) {
  const listed = async () => (await ok('reverse_feature_list')).json?.features ?? []
  const prism = await ok('reverse_feature_add', {
    features: [
      { kind: 'sketch', name: 'Prism outline', plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'polygon', id: 1, center: [40, 0], sides: 20, radius: 15, fixed: true }] } },
      { kind: 'extrude', sketchId: 'Prism outline', regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' },
    ],
    detail: 'none',
  })
  // A body goes by the id of the feature that made it.
  const prismBody = prism.json?.added?.[1]?.id
  const described = await ok('reverse_body_describe', { body: prismBody, fingerprints: true })
  const upright = (described.json?.bodies?.[0]?.edgeList ?? []).filter((e) => e.kind === 'line' && Math.abs(Math.abs(e.dir?.[2] ?? 0) - 1) < 1e-6)
  check(upright.length === 20, `a 20-sided prism: ${upright.length} upright edges`)
  const before = (await listed()).length
  const started = Date.now()
  const queued = await ok('scanruler_batch', { calls: upright.map((e) => ({ tool: 'reverse_feature_add', arguments: { feature: { kind: 'fillet', body: prismBody, edges: [e.fingerprint], radius: 0.6 }, detail: 'none' } })), wait: false })
  const answeredMs = Date.now() - started
  check(queued.json?.queued === true && typeof queued.json.job === 'string' && answeredMs < 3000, `scanruler_batch with twenty fillets and wait: false answers at once (${answeredMs} ms): job ${queued.json?.job}`)
  const state = await ok('session_state')
  check(state.json && typeof state.json === 'object', `session_state answers while the batch runs (running: ${state.json?.running?.name ?? 'nothing'})`)
  const waited = await ok('scanruler_wait', { for: 'job', job: queued.json?.job, timeoutSeconds: 600 })
  const results = waited.json?.result?.results ?? []
  check(waited.json?.state === 'done' && results.length === 20 && results.every((r) => r.ok && r.result?.status === 'ok'), `scanruler_wait { for: "job" }: the batch done in ${waited.json?.ms} ms, ${results.filter((r) => r.result?.status === 'ok').length} of 20 fillets built`)
  const rows = await listed()
  check(rows.length === before + 20 && rows.slice(-20).every((r) => r.kind === 'fillet' && r.status === 'ok'), `the feature list: ${rows.length - before} fillets added, all ok`)

  // Refused part way: what went before is undone.
  const rolled = await ok('scanruler_batch', {
    calls: [
      { tool: 'reverse_parameter_add', arguments: { name: 'zz', expression: '2' } },
      { tool: 'reverse_feature_add', arguments: { feature: { kind: 'chamfer', body: prismBody, edges: [0], distance: 0.3 }, detail: 'none' } },
      { tool: 'reverse_feature_add', arguments: { feature: { kind: 'thread', body: prismBody, face: 0, standard: 'acme' } } },
    ],
  })
  const undone = rolled.json?.undone ?? []
  check(rolled.json?.failed?.index === 2 && rolled.json.failed.tool === 'reverse_feature_add' && rolled.json.failed.error?.code === 'invalid_input' && undone.length === 2, `a batch refused at its third call undoes the two before: ${JSON.stringify(undone)}`)
  const after = await listed()
  const params = (await ok('reverse_parameter_list')).json?.parameters ?? []
  check(after.length === rows.length && !params.some((p) => p.name === 'zz'), `the features and parameters as they were: ${after.length} features, no zz`)

  // Timed: each call, the batch, and the steps the build played.
  const timed = await ok('scanruler_batch', { calls: [{ tool: 'reverse_feature_update', arguments: { feature: rows.at(-1).id, set: { radius: 0.7 }, detail: 'none' } }, { tool: 'reverse_feature_list', arguments: {} }], timings: true })
  const played = timed.json?.results?.[0]?.result?.steps?.played ?? []
  check(typeof timed.json?.total_ms === 'number' && typeof timed.json.results[0].ms === 'number' && played.length >= 1 && played.every((p) => typeof p.ms === 'number'), `timings: ${timed.json?.results?.[0]?.ms} ms and ${timed.json?.total_ms} ms in all; the build played ${played.map((p) => `${p.feature} ${p.ms} ms`).join(', ')}`)
  const plain = await ok('reverse_feature_update', { feature: rows.at(-1).id, set: { radius: 0.6 }, detail: 'none' })
  check(plain.json?.steps?.recomputed >= 0 && plain.json.steps.played === undefined, `without timings a change says how many steps it played, not which (${JSON.stringify(plain.json?.steps)})`)
}

/** The pin modelled through a server running ScanRuler headless — and a
 *  second such server beside it, sharing nothing. */
async function headless() {
  execFileSync(process.execPath, [repoFile('scripts/build-engine.mjs')], { stdio: 'inherit' })
  const engine = repoFile('dist-engine/engine.mjs')
  const start = () => startAgent({ args: ['--engine', engine, '--out', OUT_DIR], env: { SCANRULER_MCP_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'scanruler-mcp-')) } })
  const first = await start()
  const ok = okOn(first.call)
  try {
    const status = (await ok('scanruler_status')).json
    check(status?.backend === 'headless' && status.connected === true && status.server?.engine === engine && !status.howToConnect, `scanruler_status: backend headless, ScanRuler ${status?.page?.version} with ${status?.page?.plugins} (${status?.page?.commands} commands)`)
    const instructions = first.client.getInstructions() ?? ''
    check(/headless/.test(instructions) && !/browser tab the user has open/.test(instructions), 'the server’s instructions say it runs headless')
    const names = (await first.client.listTools()).tools.map((t) => t.name)
    const wanted = ['reverse_feature_add', 'reverse_feature_update', 'reverse_feature_rollback', 'reverse_parameter_set', 'reverse_body_describe', 'reverse_body_check', 'reverse_export_step', 'reverse_export_stl', 'reverse_import_step', 'reverse_plane_describe', 'reverse_note_add', 'session_state', 'history_undo']
    const pageOnly = ['view_render', 'view_set', 'scan_open', 'reverse_body_compare', 'reverse_section_fit', 'project_save']
    check(wanted.every((n) => names.includes(n)) && pageOnly.every((n) => !names.includes(n)), `the tools listed are the headless ones (${names.length}): no ${pageOnly.filter((n) => names.includes(n)).join(', ') || 'page tool'}`)

    const param = await ok('reverse_parameter_add', { name: 'l1', expression: '12' })
    check(param.json?.parameter?.value === 12, `reverse_parameter_add: l1 = ${param.json?.parameter?.value} mm`)
    const sketch = await ok('reverse_feature_add', { feature: PIN_SKETCH })
    check(sketch.json?.solve?.ok === true && sketch.json.regions?.length === 1, 'reverse_feature_add sketch: solved, one region')
    const revolve = await ok('reverse_feature_add', { feature: { kind: 'revolve', sketchId: 'Pin profile', axis: { kind: 'sketchLine', entity: 4 }, op: 'new' } })
    const body = revolve.json?.bodies?.changed?.[0]
    check(revolve.json?.result?.status === 'ok' && body?.closed && Math.abs(body.bounds.size[2] - 12) < 1e-3, `reverse_feature_add revolve: ${body?.name}, ${body?.bounds?.size?.[2]} mm long`)
    const described = await ok('reverse_body_describe', { body: body?.id ?? 0, edges: false })
    const round = described.json?.bodies?.[0]?.faceList?.find((f) => f.kind === 'cylinder')
    check(round?.side === 'boss' && Math.abs(round.diameter - 3) < 1e-6, `reverse_body_describe: the round face is a Ø${round?.diameter} boss`)
    const thread = await ok('reverse_feature_add', { feature: { kind: 'thread', body: body?.name, face: round?.index ?? 0, size: 'M3' }, detail: 'full' })
    check(thread.json?.result?.status === 'ok' && thread.json.feature.pitch === 0.5, `reverse_feature_add thread: M3×${thread.json?.feature?.pitch}`)
    const checked = await ok('reverse_body_check', { body: body?.id ?? 0, audit: false })
    check(checked.json?.bodies?.[0]?.closed === true || checked.json?.closed === true || checked.json?.ok === true, 'reverse_body_check: one closed solid')
    const set = await ok('reverse_parameter_set', { parameter: 'l1', expression: '20' })
    const longer = set.json?.bodies?.changed?.[0]?.bounds?.size?.[2]
    check(Math.abs(longer - 20) < 1e-3 && !set.json?.failed && set.json?.steps?.recomputed > 0, `reverse_parameter_set l1 = 20: the part is ${longer} mm long, ${set.json?.steps?.recomputed} steps recomputed`)
    const state = await ok('session_state')
    check(state.json?.history?.undo === 'Agent: set l1 = 20' && state.json?.app?.viewport === false, `session_state: the undo step is the agent’s (“${state.json?.history?.undo}”), no viewport`)

    const picture = await first.call('view_render', { view: 'iso' })
    check(picture.error && picture.text.startsWith('unavailable:') && /page mode/.test(picture.text), `view_render needs the page: ${picture.text.slice(0, 110)}`)
    const compare = await first.call('reverse_body_compare_in_deviation', {})
    check(compare.error && compare.text.startsWith('unavailable:'), `reverse_body_compare_in_deviation needs the page: ${compare.text.slice(0, 80)}`)

    const step = await ok('reverse_export_step', { path: OUT_DIR })
    const stepFile = step.json?.file?.path
    const stepText = stepFile && existsSync(stepFile) ? readFileSync(stepFile, 'utf8') : ''
    check(stepText.startsWith('ISO-10303-21;') && /MANIFOLD_SOLID_BREP/.test(stepText), `reverse_export_step wrote ${stepFile} (${step.json?.file?.size} bytes)`)
    const stl = await ok('reverse_export_stl', { path: OUT_DIR })
    check(Boolean(stl.json?.file?.path) && existsSync(stl.json.file.path), `reverse_export_stl wrote ${stl.json?.file?.path}`)

    const undone = await ok('history_undo')
    check(undone.json?.undone === 'Agent: set l1 = 20', `history_undo: ${undone.json?.undone}`)
    const back = await ok('reverse_build')
    check(Math.abs(back.json?.bodies?.[0]?.bounds?.size?.[2] - 12) < 1e-3, `the part is back at ${back.json?.bodies?.[0]?.bounds?.size?.[2]} mm`)
    const refused = await first.call('reverse_feature_add', { feature: { kind: 'thread', body: 'Solid 1', face: 0, standard: 'acme' } })
    check(refused.error && refused.text.startsWith('invalid_input:'), `a thread form the workspace does not cut is refused: ${refused.text.slice(0, 90)}`)
    await batchChecks(first.call, ok)

    // A second server, headless too: a session of its own.
    const second = await start()
    try {
      const ok2 = okOn(second.call)
      const empty = await ok2('reverse_parameter_list')
      check(Array.isArray(empty.json?.parameters) && empty.json.parameters.length === 0, `a second headless server starts empty (${empty.json?.parameters?.length} parameters)`)
      await ok2('reverse_parameter_add', { name: 'q', expression: '3' })
      const [mine, theirs] = await Promise.all([ok('reverse_parameter_list'), ok2('reverse_parameter_list')])
      const of = (r) => r.json?.parameters?.map((p) => p.name).join(',')
      check(of(mine) === 'l1' && of(theirs) === 'q', `two headless servers side by side share nothing: ${of(mine)} | ${of(theirs)}`)
      const [a, b] = await Promise.all([ok('reverse_feature_list'), ok2('reverse_feature_list')])
      check(a.json?.features?.length > 3 && b.json?.features?.length === 0, `each its own features: ${a.json?.features?.length} and ${b.json?.features?.length}`)
    } finally {
      await second.close()
    }
  } catch (e) {
    fail(`unexpected: ${e?.stack ?? e}`)
  }
  await first.close()
  await finish({ pages: async () => [], close: async () => {} }, [])
}
