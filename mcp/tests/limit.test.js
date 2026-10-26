// SPDX-License-Identifier: AGPL-3.0-only
// The answer limit: no call held past it, for a client or a bridge that cuts
// a call at a minute. A change, a batch or a long read still running there
// answers with its job; scanruler_wait waits no longer than it either; and
// a copy of the server started afresh reads a job of the copy before it from
// the page's record (session.recent). A fake page that keeps that record as
// the app does, behind a real MCP client, with a limit of a fraction of a
// second.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PageLink } from '../src/link.js'
import { createMcpServer } from '../src/mcp.js'
import { httpServer } from '../src/serve.js'
import { fakePage } from './fakePage.js'

const TOKEN = 'a-token-for-the-limit-tests'
const LIMIT_MS = 250
const obj = (properties = {}) => ({ type: 'object', properties, additionalProperties: false })
const COMMANDS = [
  { name: 'session.state', title: 'Read the session', description: 'The session.', input: obj(), readOnly: true, returnsFile: false, returnsImage: false },
  { name: 'session.recent', title: 'What recent jobs did', description: 'The record.', input: obj({ job: { type: 'string' }, limit: { type: 'integer' } }), readOnly: true, returnsFile: false, returnsImage: false },
  { name: 'demo.update', title: 'Update', description: 'Updates.', input: obj({ n: { type: 'number' }, ms: { type: 'number' } }), readOnly: false, returnsFile: false, returnsImage: false },
  { name: 'demo.compare', title: 'Compare', description: 'Compares, slowly.', input: obj({ ms: { type: 'number' } }), readOnly: true, long: true, returnsFile: false, returnsImage: false },
  { name: 'history.checkpoint', title: 'Mark the history', description: 'Marks.', input: obj(), readOnly: true, returnsFile: false, returnsImage: false },
  { name: 'history.restore', title: 'Back to a mark', description: 'Restores.', input: obj({ checkpoint: { type: 'string' } }), readOnly: false, returnsFile: false, returnsImage: false },
]

/** The page's record of the runs made under a job, oldest first — the
 *  page outlives the server copies, so it is the test's, not a copy's. */
const record = []
let running = 0
const answer = async (name, input, _progress, message) => {
  const entry = message.job ? { job: message.job, name, state: 'running', started: new Date().toISOString(), ms: null } : null
  if (entry) record.push(entry)
  const since = Date.now()
  const done = (result) => {
    if (entry) Object.assign(entry, { state: 'done', ms: Date.now() - since, result })
    return result
  }
  if (name === 'session.state') return { busy: null, running: running > 0 ? 'demo.update' : null }
  if (name === 'session.recent') return { outcomes: record.filter((o) => input.job === undefined || o.job === input.job).reverse().slice(0, input.limit ?? 20) }
  if (name === 'history.checkpoint') return done({ checkpoint: 'cp1' })
  if (name === 'demo.update' || name === 'demo.compare') {
    running++
    await new Promise((r) => setTimeout(r, input.ms ?? 30))
    running--
    return done(name === 'demo.update' ? { n: input.n } : { rms: 0.1 })
  }
  throw { code: 'unknown_command', message: name }
}

const closers = []
after(async () => {
  for (const close of closers.reverse()) await close()
})

/** A copy of the server on its own port, the fake page connected to it. */
async function copy({ answerWithinMs = LIMIT_MS } = {}) {
  const link = new PageLink({ token: TOKEN })
  const http = httpServer({})
  link.attach(http)
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  const server = createMcpServer({ link, version: '0.0.0', cwd: '.', outDir: '.', connectHelp: () => 'Pair it.', serverInfo: () => ({}), pageTimeoutMs: 50, answerWithinMs })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
  const { page } = await fakePage(http.address().port, { token: TOKEN, commands: COMMANDS, answer })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await client.close()
    page.close()
    link.close()
    http.close()
  }
  closers.push(close)
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args })
    const text = r.content[0].text
    return { error: r.isError === true, text, json: r.isError ? null : JSON.parse(text) }
  }
  return { client, call, page, close }
}

/** scanruler_wait for a job, called again while it says running. */
async function waitFor(call, job) {
  for (let i = 0; i < 100; i++) {
    const r = await call('scanruler_wait', { for: 'job', job })
    if (r.error || r.json.state !== 'running') return r
  }
  throw new Error(`${job} still running`)
}

test('a 15-update batch answers queued at the limit, scanruler_wait finds it, and a copy started afresh finds it again through session.recent', async () => {
  const first = await copy()
  const calls = Array.from({ length: 15 }, (_, n) => ({ tool: 'demo_update', arguments: { n, ms: 40 } }))
  const started = Date.now()
  const queued = await first.call('scanruler_batch', { calls })
  const took = Date.now() - started
  assert.equal(queued.json.queued, true)
  assert.equal(queued.json.tool, 'scanruler_batch')
  assert.equal(queued.json.after, LIMIT_MS / 1000)
  assert.match(queued.json.note, /scanruler_wait/)
  assert.ok(took >= LIMIT_MS - 20 && took < LIMIT_MS + 400, `answered after ${took} ms`)
  assert.match(queued.json.job, /^j\d+-[0-9a-f]{4}$/)

  // scanruler_wait is held no longer than the limit either: running, then
  // asked again, the batch's answer.
  const at = Date.now()
  const still = await first.call('scanruler_wait', { for: 'job', job: queued.json.job, timeoutSeconds: 60 })
  assert.equal(still.json.state, 'running')
  assert.ok(Date.now() - at < LIMIT_MS + 400)
  const done = await waitFor(first.call, queued.json.job)
  assert.equal(done.json.state, 'done')
  assert.equal(done.json.result.ran, 15)
  assert.deepEqual(done.json.result.results.map((r) => r.result.n), [...Array(15).keys()])
  assert.ok(first.page.runs.filter((m) => m.name === 'demo.update').every((m) => m.job === queued.json.job), 'each call sent under the batch’s job')
  await first.close()

  // A copy started afresh knows no such job; the page does.
  const second = await copy()
  const status = await second.call('scanruler_status')
  assert.equal(status.json.jobs, undefined)
  assert.equal(status.json.server.answerWithin, LIMIT_MS / 1000)
  const found = await second.call('scanruler_wait', { for: 'job', job: queued.json.job })
  assert.equal(found.error, false, found.text)
  assert.equal(found.json.job, queued.json.job)
  assert.equal(found.json.state, 'ended')
  assert.match(found.json.from, /^the page \(session\.recent\): this server copy, started at .* did not start j/)
  assert.deepEqual(found.json.calls.map((c) => c.tool), ['history_checkpoint', ...Array(15).fill('demo_update')])
  assert.ok(found.json.calls.every((c) => c.state === 'done'))
  assert.deepEqual(found.json.calls.at(-1).result, { n: 14 })
  // A job neither knows is not found.
  const missing = await second.call('scanruler_wait', { for: 'job', job: 'j9-ffff' })
  assert.equal(missing.error, true)
  assert.match(missing.text, /^not_found: There is no job "j9-ffff"/)
  // The new copy's own jobs are not the old one's.
  const mine = await second.call('demo_update', { n: 99, ms: 5 })
  assert.equal(mine.json.n, 99)
  assert.notEqual((await second.call('scanruler_status')).json.jobs[0].job, queued.json.job)
  await second.close()
})

test('a single change past the limit answers queued, and a copy started afresh says it is running while it runs', async () => {
  const first = await copy()
  const queued = await first.call('demo_update', { n: 1, ms: 700 })
  assert.equal(queued.json.queued, true)
  assert.equal(queued.json.tool, 'demo_update')
  await first.close()
  const second = await copy()
  const running = await second.call('scanruler_wait', { for: 'job', job: queued.json.job })
  assert.equal(running.json.state, 'running')
  assert.equal(running.json.tool, 'demo_update')
  const done = await waitFor(second.call, queued.json.job)
  assert.equal(done.json.state, 'done')
  assert.deepEqual(done.json.result, { n: 1 })
  // Quick ones answer as they always did.
  assert.deepEqual((await second.call('demo_update', { n: 2, ms: 5 })).json, { n: 2 })
  await second.close()
})

test('a long read takes wait and runs as a job; the idle wait is held to the limit too', async () => {
  const one = await copy()
  const tools = (await one.client.listTools()).tools
  assert.ok(tools.find((t) => t.name === 'demo_compare').inputSchema.properties.wait, 'a long read takes wait')
  assert.equal(tools.find((t) => t.name === 'demo_compare').inputSchema.properties.timings, undefined)
  assert.equal(tools.find((t) => t.name === 'session_state').inputSchema.properties.wait, undefined, 'a quick read does not')
  const queued = await one.call('demo_compare', { ms: 400, wait: false })
  assert.equal(queued.json.queued, true)
  for (let i = 0; i < 100 && !one.page.runs.some((m) => m.name === 'demo.compare'); i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(one.page.runs.find((m) => m.name === 'demo.compare').job, queued.json.job)
  assert.deepEqual(one.page.runs.find((m) => m.name === 'demo.compare').input, { ms: 400 }, 'wait is the server’s')
  const at = Date.now()
  const idle = await one.call('scanruler_wait', { for: 'idle', timeoutSeconds: 30 })
  assert.equal(idle.json.state, 'running')
  assert.ok(Date.now() - at < LIMIT_MS + 600)
  assert.deepEqual((await waitFor(one.call, queued.json.job)).json.result, { rms: 0.1 })
  const later = await one.call('scanruler_wait', { for: 'idle' })
  assert.equal(later.json.state, 'idle')
  // Past the limit without wait: false, queued all the same.
  assert.equal((await one.call('demo_compare', { ms: 500 })).json.queued, true)
  await one.close()
})

test('--answer-within 0 holds a call to its end', async () => {
  const one = await copy({ answerWithinMs: 0 })
  assert.deepEqual((await one.call('demo_update', { n: 3, ms: LIMIT_MS + 100 })).json, { n: 3 })
  assert.equal((await one.call('scanruler_status')).json.server.answerWithin, null)
  await one.close()
})
