// SPDX-License-Identifier: AGPL-3.0-only
// The tab hidden for real: an agent's run in a Chrome window on the screen,
// first in front and then with the window minimised — which Chrome counts
// as hidden: no frames, timers held to one a second, and after five minutes
// hidden to one a minute. The same round of calls each time — the scan
// queried, a sphere fitted, the view turned and pictured, a section cut and
// pictured, the fit taken back — timed call by call and traced. Passes when
// no call hidden takes more than twice as long as in front (or half a
// second more) and none stalls, the status saying hidden meanwhile.
//
// This opens a window on the screen and minimises it for HIDDEN_WAIT
// seconds (330 by default — past Chrome's five minutes) before the hidden
// round: run it while the screen is free.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node scripts/e2e-agent-hidden.mjs
// Env: APP_URL, CHROME, OUT_DIR, HIDDEN_WAIT (seconds), ROUNDS (3).
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile, sleep } from './e2e-lib.mjs'
import { ballPairScan } from './e2e-fixtures.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../mcp/tests/client.js')
const { readTrace, summarize } = await import('./trace-summary.mjs')

const HIDDEN_WAIT = Number(process.env.HIDDEN_WAIT ?? 330)
const ROUNDS = Number(process.env.ROUNDS ?? 3)
mkdirSync(OUT_DIR, { recursive: true })
const traceDir = join(OUT_DIR, 'hidden-trace')
rmSync(traceDir, { recursive: true, force: true })
process.env.SCANRULER_MCP_TRACE = traceDir

const STL = ballPairScan({ distance: 148.64 })
const { agent } = await launchAgent(startAgent)
const { call } = agent
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
const { browser, page, consoleErrors } = await launchApp({ url: link, headless: false, protocolTimeout: 900_000 })
try {
  check((await call('scanruler_wait', { for: 'page', timeoutSeconds: 60 })).json?.connected === true, 'the page connected')
  const opened = await call('scan_open', { path: STL, units: 'mm', discard: true })
  check(!opened.error, `scan_open: ${opened.json?.scan?.vertices} vertices`)
  await call('scanruler_wait', { for: 'idle', timeoutSeconds: 60 })
  const { min, max } = (await call('session_state')).json?.scan?.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] }
  const span = [0, 1, 2].map((k) => max[k] - min[k])
  const axis = span.indexOf(Math.max(...span))
  const toward = (t) => [0, 1, 2].map((k) => (k === axis ? min[k] + t * span[k] : (min[k] + max[k]) / 2))

  /** One round of calls, each timed: the tool and its ms. */
  const round = async () => {
    const times = []
    const timed = async (tool, args) => {
      const at = Date.now()
      const r = await call(tool, args)
      times.push({ tool, ms: Date.now() - at, error: r.error ? r.text.slice(0, 120) : null })
      return r
    }
    await timed('scan_query', { near: { at: { point: toward(0.05) }, radius: 5 }, limit: 500 })
    const fit = await timed('element_fit', { kind: 'sphere', at: { point: toward(0.05) } })
    await timed('view_set', { view: 'iso', fit: true })
    await timed('view_render', {})
    const cut = await timed('section_cut', { across: 'XY', offset: (min[2] + max[2]) / 2 })
    await timed('section_render', { section: cut.json?.section?.id ?? 1, width: 400 })
    await timed('history_undo', {})
    if (!fit.error) await timed('history_undo', {})
    return times
  }

  const front = []
  for (let i = 0; i < ROUNDS; i++) front.push(...(await round()))
  check(front.every((t) => !t.error), `in front: ${front.length} calls${front.filter((t) => t.error).map((t) => ` — ${t.tool}: ${t.error}`).join('')}`)

  // Minimised: hidden to the browser, as a person's window is.
  const cdp = await page.target().createCDPSession()
  const { windowId } = await cdp.send('Browser.getWindowForTarget')
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
  await sleep(1500)
  const visibility = await page.evaluate(() => document.visibilityState)
  check(visibility === 'hidden', `the minimised window's tab is ${visibility}`)
  const status = (await call('scanruler_status')).json
  check(status?.page?.hidden === true && /hidden/.test(status?.hiddenNote ?? ''), 'scanruler_status says the tab is hidden')
  if (HIDDEN_WAIT > 0) {
    console.log(`… hidden for ${HIDDEN_WAIT} s, for Chrome's throttling to set in`)
    await sleep(HIDDEN_WAIT * 1000)
  }
  const hidden = []
  for (let i = 0; i < ROUNDS; i++) hidden.push(...(await round()))
  check(hidden.every((t) => !t.error), `hidden: ${hidden.length} calls${hidden.filter((t) => t.error).map((t) => ` — ${t.tool}: ${t.error}`).join('')}`)
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })

  // Call by call, hidden against in front.
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[s.length >> 1] : 0
  }
  const tools = [...new Set(front.map((t) => t.tool))]
  const rows = tools.map((tool) => {
    const f = median(front.filter((t) => t.tool === tool).map((t) => t.ms))
    const h = median(hidden.filter((t) => t.tool === tool).map((t) => t.ms))
    return { tool, front: f, hidden: h, ok: h <= Math.max(2 * f, f + 500) }
  })
  for (const r of rows) console.log(`   ${r.tool.padEnd(16)} in front ${String(r.front).padStart(6)} ms   hidden ${String(r.hidden).padStart(6)} ms${r.ok ? '' : '   ← slower'}`)
  check(rows.every((r) => r.ok), 'no call hidden more than twice as long as in front (or half a second more)')
  const longest = Math.max(...hidden.map((t) => t.ms))
  check(longest < 10_000, `no hidden call stalls (the longest ${longest} ms)`)

  const files = readdirSync(traceDir).filter((f) => f.endsWith('.jsonl'))
  const s = summarize(readTrace(join(traceDir, files[0])))
  check(s.hiddenCalls >= hidden.length, `the trace marks ${s.hiddenCalls} calls hidden`)
} catch (e) {
  fail(e.message)
} finally {
  await agent.close()
  await finish(browser, consoleErrors)
}
