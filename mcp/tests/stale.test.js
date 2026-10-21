// SPDX-License-Identifier: AGPL-3.0-only
// What the status says holds an agent up: a tool list the client got before
// the page changed and never listed again, no jobs in a fresh copy of the
// server, and a change dropped when the page went away before answering —
// which may have been made all the same.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PageLink } from '../src/link.js'
import { createMcpServer } from '../src/mcp.js'
import { httpServer } from '../src/serve.js'
import { fakePage } from './fakePage.js'

const TOKEN = 'a-token-for-the-stale-tests'
const obj = (properties = {}) => ({ type: 'object', properties, additionalProperties: false })
const command = (name, readOnly = true) => ({ name, title: name, description: `${name}.`, input: obj(), readOnly, returnsFile: false, returnsImage: false })
const BEFORE = [command('session.state'), command('demo.change', false)]
const AFTER = [...BEFORE, command('demo.added', false)]

let link
let http
let client

before(async () => {
  link = new PageLink({ token: TOKEN })
  http = httpServer({})
  link.attach(http)
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  const server = createMcpServer({ link, version: '0.0.0', cwd: '.', outDir: '.', connectHelp: () => 'Pair it.', serverInfo: () => ({}), pageTimeoutMs: 2_000 })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
})
after(async () => {
  await client.close()
  link.close()
  http.close()
})

const status = async () => JSON.parse((await client.callTool({ name: 'scanruler_status', arguments: {} })).content[0].text)

test('a fresh server copy says it knows no jobs, and that a job of an earlier copy is not known here', async () => {
  const s = await status()
  assert.equal(s.jobs, undefined)
  assert.match(s.jobsNote, /^None asked of this server copy, which started at \d{4}-\d\d-\d\dT.*A change asked of an earlier copy is not known here/)
  const missing = await client.callTool({ name: 'scanruler_wait', arguments: { for: 'job', job: 'j7' } })
  assert.equal(missing.isError, true)
  assert.match(missing.content[0].text, /^not_found: There is no job "j7".*a job of an earlier one is not known here/)
})

test('the status says the tools the client holds are stale until it lists them again', async () => {
  const port = http.address().port
  const first = await fakePage(port, { token: TOKEN, commands: BEFORE })
  await link.waitForPage(2_000)
  await client.listTools()
  assert.equal((await status()).tools, undefined, 'listed with this page: not stale')
  first.page.close()
  await new Promise((resolve) => link.once('disconnected', resolve))
  // The page comes back updated, with a command more; the client is told
  // and does not list again.
  const second = await fakePage(port, { token: TOKEN, commands: AFTER })
  try {
    const s = await status()
    assert.equal(s.tools.stale, true)
    assert.equal(s.tools.listed, 7)
    assert.equal(s.tools.now, 8)
    assert.deepEqual(s.tools.added, ['demo_added'])
    assert.equal(s.tools.removed, undefined)
    assert.match(s.tools.note, /start a new chat to get the current tools/)
    await client.listTools()
    assert.equal((await status()).tools, undefined, 'listed again: not stale')
  } finally {
    second.page.close()
    await new Promise((resolve) => link.once('disconnected', resolve))
  }
})

test('a change dropped when the page goes away says it may have been made, and how to check', async () => {
  let ran
  const ranOnPage = new Promise((resolve) => (ran = resolve))
  const { page } = await fakePage(http.address().port, {
    token: TOKEN,
    commands: AFTER,
    // Runs, and the page goes before it answers.
    answer: () => {
      ran()
      return new Promise(() => {})
    },
  })
  const call = client.callTool({ name: 'demo_change', arguments: {} })
  await ranOnPage
  page.close()
  const r = await call
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /^unavailable: The ScanRuler page closed the connection before it answered\. If it was a change, it may still have been made on the page: read session_state/)
  const job = (await status()).jobs[0]
  assert.equal(job.state, 'failed')
})
