// SPDX-License-Identifier: AGPL-3.0-only
// The warning before the agent connection first comes on: up for a pairing link
// and for the switch in Settings, with nothing connected until it is accepted.
// Escape leaves it off and asks again next time, and Settings stays open under
// it; accepted, the page connects, the status strip stops saying "local only",
// and a reload does not ask again. A connection left on from before the warning
// existed asks too.
//
// Prereqs: dev server running (npm run dev), Chrome, and the server's
// dependencies (npm --prefix mcp ci).
//   node scripts/e2e-agent-warning.mjs
// Env: APP_URL, CHROME.
import { check, click, finish, launchAgent, launchApp, sleep } from './e2e-lib.mjs'

const { startAgent } = await import('../mcp/tests/client.js')
const { agent } = await launchAgent(startAgent)
const { call } = agent

const WARNING = '[data-test=agent-data-warning]'
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `status hands out the pairing link (${link})`)

const { browser, page, consoleErrors } = await launchApp({ url: link, agentDataOk: false })
const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key)
const shown = async (sel) => Boolean(await page.$(sel))
const note = () => page.$eval('[data-test=local-note]', (e) => e.textContent.trim())
// Long enough for a socket to have opened, had one been started.
const notConnected = async () => {
  await sleep(1500)
  return (await call('scanruler_status')).json?.connected === false
}

// ---- a pairing link ---------------------------------------------------------
await page.waitForSelector(WARNING, { timeout: 10_000 })
check(true, 'a pairing link puts the warning up')
check(/no longer stay on this computer/.test(await page.$eval(WARNING, (e) => e.textContent)), 'it says the data no longer stays on this computer')
check(!(await page.evaluate(() => location.hash)), 'the pairing link is taken out of the address')
check(await notConnected(), 'nothing connects while it is up')
check(!(await shown('[data-test=agent-chip]')), 'no agent chip while it is up')
check(/^LOCAL ONLY/.test(await note()), 'the status strip still says local only')

await page.keyboard.press('Escape')
await page.waitForSelector(WARNING, { hidden: true, timeout: 3000 })
check(await notConnected(), 'Escape leaves it unconnected')
check((await stored('scanruler.agentdataok')) === null, 'and nothing is remembered as accepted')

// ---- the switch in Settings -------------------------------------------------
await page.evaluate(() => document.querySelector('[data-test=open-settings]')?.click())
await click(page, '[data-test=toggle-agent-link]')
await page.waitForSelector(WARNING, { timeout: 3000 })
check(await page.$eval('[data-test=toggle-agent-link]', (e) => !e.checked), 'the switch asks first, and stays off meanwhile')
await page.keyboard.press('Escape')
await page.waitForSelector(WARNING, { hidden: true, timeout: 3000 })
check(await shown('[data-test=settings-modal]'), 'Escape answers the warning and leaves Settings open')
check(await page.$eval('[data-test=toggle-agent-link]', (e) => !e.checked), 'the switch is still off')

await click(page, '[data-test=toggle-agent-link]')
await click(page, '[data-test=agent-data-accept]')
const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 30 })
check(waited.json?.connected === true, 'accepted, the page connects')
check((await stored('scanruler.agentdataok')) === '1', 'the answer is remembered')
await page.waitForFunction(() => /^AGENT CONNECTED/.test(document.querySelector('[data-test=local-note]')?.textContent ?? ''), { timeout: 5000 })
check(true, 'the status strip says an agent is connected')

// ---- asked once ---------------------------------------------------------------
await page.reload({ waitUntil: 'networkidle0' })
const again = await call('scanruler_wait', { for: 'page', timeoutSeconds: 30 })
check(again.json?.connected === true && !(await shown(WARNING)), 'a reload connects without asking again')

// ---- a connection on from before the warning ------------------------------------
await page.evaluate(() => localStorage.removeItem('scanruler.agentdataok'))
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector(WARNING, { timeout: 10_000 })
check(await notConnected(), 'a connection left on from before asks first too')
await click(page, '[data-test=agent-data-decline]')
await page.waitForSelector(WARNING, { hidden: true, timeout: 3000 })
check((await stored('scanruler.agentlink')) === '0', 'Cancel switches it off')

await finish(browser, consoleErrors)
await agent.close()
