// SPDX-License-Identifier: AGPL-3.0-only
// Benchmark: an agent's edits on a saved project in the browser, through
// scanruler-mcp as an agent makes them. The project in BENCH_PROJECT is
// opened, and then, BENCH_REPS times over: a fillet appended on the part's
// longest straight edge that takes one, its radius edited, set back, the
// fillet removed, the rollback bar moved ten features up and back down,
// and a body's eye toggled off and on. For each: the tool's milliseconds as
// the agent waits for it, the bytes the CAD kernel's worker posted to the
// page, the bytes of geometry the page uploaded to the GPU (bufferData and
// bufferSubData), and the milliseconds the viewport's body updates took on
// the page. One JSON line to BENCH_OUT, or the console.
//
// Prereqs: the dev server of the tree measured (APP_URL), Chrome, the MCP
// server's dependencies.
//   APP_URL=http://localhost:5188/ BENCH_PROJECT=… node plugins/reverse/scripts/bench-agent.mjs
import { appendFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { APP_URL, CHROME, OUT_DIR, repoFile, sleep } from '../../../scripts/e2e-lib.mjs'

const PROJECT = process.env.BENCH_PROJECT
const REPS = Number(process.env.BENCH_REPS ?? 5)
if (!PROJECT) throw new Error('BENCH_PROJECT names the .scanruler file.')

const { startAgent } = await import(`file://${repoFile('mcp/tests/client.js').replace(/\\/g, '/')}`)
const { createServer } = await import('node:net')
const port = await new Promise((resolve) => {
  const s = createServer().listen(0, () => {
    const p = s.address().port
    s.close(() => resolve(p))
  })
})
const agent = await startAgent({
  args: ['--port', String(port), '--out', OUT_DIR, '--app', APP_URL],
  env: { SCANRULER_MCP_TOKEN: `bench-${Date.now().toString(36)}`, SCANRULER_MCP_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'scanruler-mcp-')) },
  stderr: 'ignore',
})
const ok = async (name, input) => {
  const r = await agent.call(name, input)
  if (r.error) throw new Error(`${name}: ${r.text}`)
  return r.json
}
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await ok('scanruler_status')).howToConnect ?? '')?.[1]

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1500,950', '--no-sandbox'], defaultViewport: { width: 1500, height: 950 }, protocolTimeout: 3_600_000 })
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('scanruler.askstlunits', '0') } catch { /* no storage */ }
  try { localStorage.setItem('scanruler.agentdataok', '1') } catch { /* no storage */ }
  const tally = (window.__bench = { gpu: 0, gpuCalls: 0, worker: 0, workerMessages: 0, displayMs: 0 })
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue
    const data = C.prototype.bufferData
    C.prototype.bufferData = function (target, src, ...rest) {
      tally.gpuCalls++
      tally.gpu += typeof src === 'number' ? src : (src?.byteLength ?? 0)
      return data.call(this, target, src, ...rest)
    }
    const sub = C.prototype.bufferSubData
    C.prototype.bufferSubData = function (target, offset, src, ...rest) {
      tally.gpuCalls++
      tally.gpu += src?.byteLength ?? 0
      return sub.call(this, target, offset, src, ...rest)
    }
  }
  const weigh = (v, seen) => {
    if (v === null || v === undefined) return 4
    if (typeof v === 'number' || typeof v === 'boolean') return 8
    if (typeof v === 'string') return v.length + 2
    if (ArrayBuffer.isView(v)) {
      if (seen.has(v.buffer)) return 0
      seen.add(v.buffer)
      return v.buffer.byteLength
    }
    if (Array.isArray(v)) return v.reduce((n, x) => n + weigh(x, seen), 0)
    if (typeof v === 'object') return Object.entries(v).reduce((n, [k, x]) => n + k.length + 3 + weigh(x, seen), 0)
    return 0
  }
  const W = window.Worker
  window.Worker = class extends W {
    constructor(url, opts) {
      super(url, opts)
      if (String(url).includes('reWorker')) {
        this.addEventListener('message', (e) => {
          tally.workerMessages++
          tally.worker += weigh(e.data, new Set())
        })
      }
    }
  }
})
await page.goto(link, { waitUntil: 'networkidle0' })
await ok('scanruler_wait', { for: 'page', timeoutSeconds: 120 })

const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 100)))))
const counters = () => page.evaluate(() => ({ ...window.__bench }))

const t0 = Date.now()
await ok('project_load', { path: PROJECT, discard: true })
await ok('scanruler_wait', { for: 'idle', timeoutSeconds: 3600 })
await ok('workspace_set', { workspace: 'reverse' })
await ok('reverse_build', {})
const openMs = Date.now() - t0
await frames()
// The viewport's body updates timed where they run.
await page.evaluate(() => {
  const rs = window.__re.reScene()
  const wrap = (obj, name) => {
    const proto = Object.getPrototypeOf(obj)
    const f = proto[name]
    proto[name] = function (...a) {
      const t = performance.now()
      try { return f.apply(this, a) } finally { window.__bench.displayMs += performance.now() - t }
    }
  }
  wrap(rs, 'setBodies')
  wrap(rs.bodyPicks, 'setBodies')
})

const list = await ok('reverse_feature_list', {})
const count = list.features.filter((f) => !f.rolledBack).length
const state = await page.evaluate(() => window.__re.store.getState().bodies.map((b) => ({ id: b.id, volume: b.volume, surface: b.surface })))
const body = state.filter((b) => !b.surface).sort((a, b) => b.volume - a.volume)[0]
const described = await ok('reverse_body_describe', { body: body.id, sort: 'largest' })
let edge = null
for (const e of described.bodies[0].edgeList.filter((x) => x.kind === 'line').slice(0, 15)) {
  const a = await ok('reverse_feature_add', { feature: { kind: 'fillet', body: body.id, edges: [e.index], radius: 0.4 }, detail: 'none' })
  await ok('history_undo', {})
  await ok('scanruler_wait', { for: 'idle', timeoutSeconds: 600 })
  if (a.status === 'ok') {
    edge = e.index
    break
  }
}
if (edge === null) throw new Error('No straight edge took a fillet of 0.4.')

const samples = {}
const timed = async (op, name, input) => {
  await frames()
  const before = await counters()
  const t = Date.now()
  // No command shows or hides a body: the eye as the panel's row has it.
  const answer = name ? await ok(name, input) : await page.evaluate((id) => window.__re.store.getState().toggleBodyVisible(id), input)
  const ms = Date.now() - t
  await frames()
  const after = await counters()
  ;(samples[op] ??= []).push({ ms, worker: after.worker - before.worker, gpu: after.gpu - before.gpu, displayMs: after.displayMs - before.displayMs })
  return answer
}
for (let rep = 0; rep < REPS; rep++) {
  const radius = 0.41 + rep * 0.01
  const added = await timed('append fillet', 'reverse_feature_add', { feature: { kind: 'fillet', body: body.id, edges: [edge], radius }, detail: 'none' })
  await timed('edit at end', 'reverse_feature_update', { feature: added.id, set: { radius: radius + 0.1 }, detail: 'none' })
  await timed('set back', 'reverse_feature_update', { feature: added.id, set: { radius }, detail: 'none' })
  await timed('remove at end', 'reverse_feature_remove', { feature: added.id, detail: 'none' })
  await timed('rollback up 10', 'reverse_feature_rollback', { to: count - 10, detail: 'none' })
  await timed('rollback down', 'reverse_feature_rollback', { to: null, detail: 'none' })
  await timed('eye off', null, body.id)
  await timed('eye on', null, body.id)
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const summary = Object.fromEntries(Object.entries(samples).map(([op, xs]) => [op, { ms: median(xs.map((x) => x.ms)), msAll: xs.map((x) => x.ms), worker: median(xs.map((x) => x.worker)), gpu: median(xs.map((x) => x.gpu)), displayMs: +median(xs.map((x) => x.displayMs)).toFixed(1) }]))
const line = JSON.stringify({ project: PROJECT, app: APP_URL, features: count, bodies: state.length, openMs, edge, summary })
if (process.env.BENCH_OUT) appendFileSync(process.env.BENCH_OUT, line + '\n')
console.log(line)
await browser.close()
await agent.close()
