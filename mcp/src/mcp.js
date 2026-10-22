// SPDX-License-Identifier: AGPL-3.0-only
// The MCP side: the tools an agent lists and calls. Each of the page's
// commands is a tool (tools.js); five more are this server's own —
// scanruler_status, to see whether a ScanRuler page is connected and how to
// connect one; scanruler_open, to open one in the user's browser, paired;
// scanruler_wait, to wait for it or for it to be idle; scanruler_batch, to
// run several of the page's tools in one call; and scanruler_write, to
// write a text file — a report — next to the scan. In compact mode, for a
// model with a small context window, the page's tools are not listed but
// for those that return a picture, which a batch cannot show — it writes
// the picture to a file and gives its text: a
// fifth of the server's own, scanruler_tools, lists them a line each and
// gives the definitions of those asked for, and scanruler_batch runs them.
// Headless (engine.js), the tools are the commands ScanRuler runs in this
// process with no page, listed in either mode.

import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { absolute, agentJson, batchedPicture, imageContent, inputFor, replacesSession, saveFileResult, toolFor, toolName, waitIn } from './tools.js'
import { jsonBytes, replyMeasure } from './trace.js'

/** The app's own commands as of this release, so the tools are there before
 *  a page connects — unless a page has connected before, whose list was
 *  kept (`remembered`); a connected page's own list replaces either, its
 *  plugins' commands included. Kept in step by the app's tests
 *  (tests/mcpCommands.test.ts). */
export const SNAPSHOT = JSON.parse(readFileSync(new URL('./commands.json', import.meta.url), 'utf8'))

/** How the page's commands are listed: `full`, each its own tool, or
 *  `compact`, read through scanruler_tools. */
export const TOOL_MODES = ['full', 'compact']

/** The most definitions scanruler_tools gives in one answer: twenty are
 *  some ten thousand tokens, a small window's fair share. */
const MAX_DEFINITIONS = 20

const ABOUT = [
  'These tools drive ScanRuler, a measuring app for 3D scans, in the browser tab the user has open: the user watches every step in the viewport and can undo it there.',
  'Start with scanruler_status. If no ScanRuler page is connected, call scanruler_open: it opens ScanRuler in the user’s browser, paired with this server, and waits for it. If that leaves it unconnected, tell the user what howToConnect says, then call scanruler_wait.',
]
const WORKING = [
  'Read session_state before acting and after: the scan’s bounding box says where the part lies, the elements and dimensions what is measured. Lengths are millimetres, angles degrees; answers give numbers to six significant digits.',
  'A place on the scan is { point: [x, y, z] } (the nearest scan vertex is taken) or { vertex: n }. To fit a feature, aim at its middle, not at an edge.',
  'Every tool that changes the session is one step of the undo history; history_undo takes the last back. report_get gives the report as JSON (format "json") or as the text the panel copies (format "text").',
]
const INSTRUCTIONS = {
  full: [
    ...ABOUT,
    ...WORKING,
    'view_render shows you the 3D view as a picture; view_set turns it to a standard view or fits it.',
    'scanruler_batch runs several tools in one call, in order — many scan_nearest or element_fit calls, say — and stops at the first that is refused unless told to go on.',
  ].join(' '),
  compact: [
    ...ABOUT,
    'ScanRuler’s own tools are not listed one by one, but for those that return a picture. scanruler_tools lists them all, a name and a line each; scanruler_tools with names gives those tools’ full definitions. Read a tool’s definition before its first use, and give it the arguments its inputSchema asks for.',
    'Run the tools through scanruler_batch — { "calls": [{ "tool": "session_state", "arguments": {} }] }; a single tool is a batch of one, and several run in order. Each result is { tool, ok, result } or { tool, ok: false, error: { code, message } }: the code is the page’s own (invalid_input, no_scan, busy, invalid_state, not_found …) and the message says what was wrong, so retry a refused call with its arguments corrected.',
    ...WORKING,
    'The tools that return a picture — view_render, which pictures the 3D view, among them — are listed as tools of their own: call them directly to see the picture. In a batch a picture is not shown: it is written to a file — the call’s path, or a new file in the server’s output folder — and its result says where (file.path). view_set turns the view.',
  ].join(' '),
}

/** A command in a line, for scanruler_tools' list: its title, or the first
 *  sentence of its description. */
function summary(command) {
  if (command.title) return command.title
  const description = String(command.description ?? '').replace(/\s+/g, ' ').trim()
  return /^.*?[.!?](?= |$)/.exec(description)?.[0] ?? description
}

/** What the server says it is when it runs ScanRuler itself, headless. */
const HEADLESS_ABOUT = [
  'These tools drive ScanRuler headless: the app runs inside this server, with no browser, no scan and no viewport — nobody watches it, and nothing is drawn. scanruler_status says so (backend: "headless").',
]
const HEADLESS_WORKING = [
  'Lengths are millimetres, angles degrees; answers give numbers to six significant digits. Every tool that changes the session is one step of the undo history; history_undo takes the last back. Read session_state before acting and after.',
]
const HEADLESS_INSTRUCTIONS = {
  full: [
    ...HEADLESS_ABOUT,
    'The tools listed are those that run so: modelling solids feature by feature with parameters, describing and checking the bodies, notes, and STEP and STL files read and written on this computer. A tool that needs the page — a scan, a picture, the browser — is not listed, and answers unavailable if called; it needs this server started in page mode, paired with a ScanRuler tab.',
    ...HEADLESS_WORKING,
    'scanruler_batch runs several tools in one call, in order, and stops at the first that is refused unless told to go on.',
  ].join(' '),
  compact: [
    ...HEADLESS_ABOUT,
    'ScanRuler’s tools are those that run so — modelling solids feature by feature with parameters, describing and checking the bodies, notes, and STEP and STL files read and written on this computer — and are not listed one by one. scanruler_tools lists them, a name and a line each; scanruler_tools with names gives those tools’ full definitions. Read a tool’s definition before its first use, and give it the arguments its inputSchema asks for. A tool that needs the page — a scan, a picture, the browser — is not among them, and answers unavailable if called; it needs this server started in page mode, paired with a ScanRuler tab.',
    'Run the tools through scanruler_batch — { "calls": [{ "tool": "session_state", "arguments": {} }] }; a single tool is a batch of one, and several run in order. Each result is { tool, ok, result } or { tool, ok: false, error: { code, message } }: the message says what was wrong, so retry a refused call with its arguments corrected.',
    ...HEADLESS_WORKING,
  ].join(' '),
}

/** How many jobs the server keeps answers of, the oldest finished let go
 *  first. */
const JOBS_KEPT = 50

/** How long the status waits for the page to say what its session holds,
 *  ms; past it the status goes without. */
const SESSION_WITHIN_MS = 3_000

/** The kinds of file scanruler_write writes: text, for a report. */
const TEXT_KINDS = ['.md', '.txt', '.csv', '.json']

/** A change answered directly that took longer than this has likely
 *  outlived its client's wait (Claude Desktop's is a minute): its answer
 *  counts as not yet seen, for scanruler_wait { for: "idle" } to give. */
const SEEN_WITHIN_MS = 55_000

const text = (value, exact = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : agentJson(value, exact) }] })
const failure = (e) => {
  const code = e?.code ?? 'failed'
  const message = e?.message ?? String(e)
  return { ...text(`${code}: ${message}`), isError: true }
}

/**
 * @param {{
 *   link: import('./relay.js').SharedLink | import('./link.js').PageLink,
 *   version: string,
 *   cwd: string,
 *   outDir: string,
 *   connectHelp: () => string,
 *   serverInfo: () => Record<string, unknown>,
 *   pageTimeoutMs?: number,
 *   remembered?: { load(): unknown[] | null, save(commands: unknown[]): void } | null,
 *   openPage?: () => Promise<boolean>,
 *   openGraceMs?: number,
 *   openWaitMs?: number,
 *   tools?: 'full' | 'compact',
 *   trace?: ReturnType<typeof import('./trace.js').createTrace>,
 * }} options — `tools` is how the page's commands are listed (TOOL_MODES).
 *   `trace`, when given, gets a line per call (trace.js).
 *   `openPage` opens the pairing link in the user's browser
 *   (browser.js), true when it could; scanruler_open first gives a tab that
 *   is already paired `openGraceMs` to connect by itself — the page tries
 *   again at most ten seconds apart — and then waits `openWaitMs` for the
 *   one it opened, the user's answer to the browser's question included.
 *   Both together stay under the minute some clients give a tool call.
 */
export function createMcpServer({
  link,
  version,
  cwd,
  outDir,
  connectHelp,
  serverInfo,
  pageTimeoutMs = 15_000,
  remembered = null,
  openPage = async () => false,
  openGraceMs = 11_000,
  openWaitMs = 40_000,
  tools: toolMode = 'full',
  trace = null,
}) {
  const headless = link.backend === 'headless'
  const compact = toolMode === 'compact'
  const server = new Server(
    { name: 'scanruler', title: 'ScanRuler', version },
    { capabilities: { tools: { listChanged: true } }, instructions: (headless ? HEADLESS_INSTRUCTIONS : INSTRUCTIONS)[compact ? 'compact' : 'full'] },
  )

  // The last connected page's commands, for listing before a page is back:
  // a client that lists the tools once — at its start, before the tab has
  // reconnected — and does not list them again when told they changed
  // still sees every tool the tab offers.
  let lastPage = remembered?.load() ?? null
  const commands = () => (link.page?.commands?.length ? link.page.commands : lastPage ?? SNAPSHOT)
  const remember = () => {
    const list = link.page?.commands
    if (!list?.length) return
    lastPage = list
    try {
      remembered?.save(list)
    } catch {
      // Not kept: the next run lists the app's own until the page is back.
    }
  }

  // ---- jobs ---------------------------------------------------------------
  // Every call that changes the session is a job, its answer kept: one
  // started with wait: false answers at once with the job, and one the
  // client gave up waiting for keeps running and keeps its reply — the
  // status lists both, and scanruler_wait { for: "job" } gives the answer.
  const jobs = new Map()
  let nextJob = 1
  // `ctx` is the call's own, for the trace: the job is named on the call's
  // line, and one answered at once (queued) gets a line when it is done.
  const startJob = (tool, run, ctx = null, queued = false) => {
    const job = { job: `j${nextJob++}`, tool, state: 'running', started: Date.now(), ms: null, reply: null }
    if (ctx) Object.assign(ctx.fields, { job: job.job, ...(queued ? { queued: true } : {}) })
    const finished = (reply) => {
      job.state = reply.isError ? 'failed' : 'done'
      job.ms = Date.now() - job.started
      job.reply = reply
      // Answered to the client: seen, unless queued or likely timed out.
      job.told = !queued && job.ms < SEEN_WITHIN_MS
      if (queued && trace) trace.write({ ev: 'job', job: job.job, call: ctx?.call ?? null, tool, t: job.started, ms: job.ms, ...replyMeasure(reply) })
      return reply
    }
    job.done = run().then(finished, (e) => finished(failure(e)))
    jobs.set(job.job, job)
    // The newest kept, but never one still running.
    for (const [id, j] of jobs) {
      if (jobs.size <= JOBS_KEPT) break
      if (j.state !== 'running') jobs.delete(id)
    }
    return job
  }
  const jobBrief = (j) => ({ job: j.job, tool: j.tool, state: j.state, ...(j.ms !== null ? { ms: j.ms } : { runningMs: Date.now() - j.started }) })
  /** A job's answer as scanruler_wait gives it: the tool's own answer
   *  under result, or its refusal under error. */
  const jobAnswer = (j) => {
    if (!j.reply) return jobBrief(j)
    const body = j.reply.content.find((x) => x.type === 'text')?.text ?? ''
    if (j.reply.isError) {
      const m = /^([a-z_]+): ([\s\S]*)$/.exec(body)
      return { ...jobBrief(j), error: m ? { code: m[1], message: m[2] } : { code: 'failed', message: body } }
    }
    let result
    try {
      result = JSON.parse(body)
    } catch {
      result = body
    }
    return { ...jobBrief(j), result }
  }

  /** Whether the tab is hidden now — null with no page, or headless. */
  const hiddenNow = () => (link.connected && link.page && !headless ? (link.page.hidden ?? false) : null)
  const runningJobs = () => [...jobs.values()].filter((j) => j.state === 'running').length

  /** A finished job as scanruler_wait { for: "idle" } lists it: a failed
   *  one with its error, a batch with the call it stopped at. */
  const finishedOut = (j) => {
    const answer = jobAnswer(j)
    if (j.state === 'failed') return { ...jobBrief(j), error: answer.error }
    const failed = j.tool === 'scanruler_batch' ? answer.result?.failed : undefined
    return { ...jobBrief(j), ...(failed ? { failed } : {}) }
  }

  // Since when this copy of the server keeps jobs: one asked of a copy
  // before it — another process, or this one restarted — is not known here.
  const startedAt = new Date().toISOString()
  const noJobs = `None asked of this server copy, which started at ${startedAt}. A change asked of an earlier copy is not known here: session_state says what the page holds.`

  /** What the page's session holds, in brief, for the status: the scan,
   *  the project's name, whether it has unsaved changes, and its work
   *  counted — read off session.state, and left out when the page does not
   *  answer soon. */
  const sessionBrief = async () => {
    if (!link.connected) return {}
    let timer
    const state = await Promise.race([
      link.run('session.state', {}).catch(() => null),
      new Promise((r) => (timer = setTimeout(() => r(null), SESSION_WITHIN_MS))),
    ])
    clearTimeout(timer)
    if (!state || typeof state !== 'object') return {}
    const project = state.project ?? {}
    return {
      session: {
        scan: state.scan?.fileName ?? null,
        ...(project.name ? { project: project.name } : {}),
        unsaved: project.unsaved ?? null,
        ...(project.holds ?? {}),
      },
    }
  }

  // ---- folders -------------------------------------------------------------
  // The folders this server opened a scan or a project from, or saved one
  // into, the latest first: where scanruler_write may write.
  const folders = []
  const rememberFolder = (file) => {
    const folder = dirname(file)
    const at = folders.indexOf(folder)
    if (at >= 0) folders.splice(at, 1)
    folders.unshift(folder)
  }

  const status = () => ({
    backend: headless ? 'headless' : 'page',
    connected: link.connected,
    page: link.page
      ? {
          app: link.page.app,
          version: link.page.version,
          origin: link.page.origin,
          plugins: link.page.plugins ?? [],
          viewport: link.page.viewport ?? null,
          hidden: link.page.hidden ?? null,
          commands: link.page.commands.length,
        }
      : null,
    server: serverInfo(),
    ...(link.connected || headless ? {} : { howToConnect: connectHelp() }),
    ...(link.page?.hidden ? { hiddenNote: 'The ScanRuler tab is hidden — in the background, its window covered or minimised, or the screen locked. Changes still run; pictures and anything that waits on the screen are slower, and a browser that unloads background tabs (Chrome’s Memory Saver) may close it: add the site to "Always keep these sites active".' } : {}),
    ...(jobs.size > 0 ? { jobs: [...jobs.values()].reverse().map(jobBrief) } : { jobsNote: noJobs }),
    ...staleTools(),
  })

  const own = [
    {
      name: 'scanruler_status',
      title: 'ScanRuler connection status',
      description: 'Whether a ScanRuler page is connected to this agent, which version and plugins it has, whether its tab is hidden (page.hidden), and — when none is — how the user connects one. session, with a page, says what it holds: the scan, the project’s name, whether it has changes not saved (unsaved), and its work counted — elements, features, notes … — so a session someone else left is seen before it is replaced (scan_open with saveTo keeps it). backend says whether ScanRuler runs in a tab (page) or in this server (headless). jobs lists the latest calls that change the session, newest first, each running, done or failed — a call whose answer you did not get is among them; scanruler_wait { for: "job", job } gives its answer. tools, when there, says the tools you were given are not the ones the page offers now (stale).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
      call: async () => text({ ...status(), ...(await sessionBrief()) }),
    },
    {
      name: 'scanruler_open',
      title: 'Open ScanRuler',
      description: 'Open ScanRuler in the user’s default browser, paired with this server, and wait for the page to connect — for when scanruler_status says none is. The first time, the browser asks the user whether the site may reach apps on this computer; they must allow it. Returns the status, with opened: whether the browser was asked to open it. If connected is still false, tell the user what howToConnect says.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, openWorldHint: false },
      call: async () => {
        if (headless) return text({ ...status(), opened: false, note: 'This server runs ScanRuler headless, in this process: there is no page to open.' })
        // A tab that was paired before is likely open and on its way back.
        if (link.connected || (await link.waitForPage(openGraceMs))) return text({ ...status(), opened: false })
        const opened = await openPage().catch(() => false)
        if (opened) await link.waitForPage(openWaitMs)
        return text({ ...status(), opened })
      },
    },
    {
      name: 'scanruler_wait',
      title: 'Wait for ScanRuler',
      description: 'Wait until a ScanRuler page is connected (for: "page", the default), or until it is also done with what it is busy with and every change still running has finished (for: "idle" — then finished lists the changes done or failed since the last such answer, a failed one with its error), or until a job is done (for: "job" with job — a call started with wait: false, or one whose answer did not come; scanruler_status lists them). Returns the status, or for a job its answer: { job, tool, state, ms, result } or { …, error: { code, message } } — state running if the time ran out first. connected is false if the time ran out waiting for a page.',
      inputSchema: {
        type: 'object',
        properties: {
          for: { type: 'string', enum: ['page', 'idle', 'job'], description: 'page (the default), idle, or job.' },
          job: { type: 'string', minLength: 1, description: 'The job to wait for, with for: "job" — as a call with wait: false or scanruler_status gave it.' },
          timeoutSeconds: { type: 'number', exclusiveMinimum: 0, maximum: 600, description: 'How long to wait at most, seconds — 120 by default.' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      call: async (args, ctx) => {
        if (ctx) ctx.fields.wait = args?.for ?? (args?.job !== undefined ? 'job' : 'page')
        const until = Date.now() + 1000 * (args?.timeoutSeconds ?? 120)
        if (args?.for === 'job' || args?.job !== undefined) {
          const j = jobs.get(String(args?.job ?? ''))
          if (!j) return failure({ code: 'not_found', message: `There is no job "${args?.job ?? ''}" — scanruler_status lists the latest. This server copy started at ${startedAt}; a job of an earlier one is not known here, and session_state says whether its change was made.` })
          let timer
          await Promise.race([j.done, new Promise((r) => (timer = setTimeout(r, Math.max(0, until - Date.now()))))])
          clearTimeout(timer)
          if (j.state !== 'running') j.told = true
          return text(jobAnswer(j))
        }
        if (!(await link.waitForPage(Math.max(0, until - Date.now())))) return text(status())
        if (args?.for === 'idle') {
          // The changes still running first — their answers are what idle
          // waits for — then the page's own work.
          for (const j of [...jobs.values()].filter((x) => x.state === 'running')) {
            let timer
            await Promise.race([j.done, new Promise((r) => (timer = setTimeout(r, Math.max(0, until - Date.now()))))])
            clearTimeout(timer)
          }
          while (Date.now() < until) {
            const state = await link.run('session.state', {}).catch(() => null)
            if (state && state.busy === null && state.running === null) break
            await new Promise((r) => setTimeout(r, 500))
          }
          // What finished since it was last said: each job once, a failed
          // one with its error.
          const finished = [...jobs.values()].filter((j) => j.state !== 'running' && !j.told)
          for (const j of finished) j.told = true
          return text({ ...status(), finished: finished.map(finishedOut) })
        }
        return text(status())
      },
    },
  ]

  // A report beside the scan, written by this server: no grant of the
  // browser's to save a file, and nowhere but the scan's folder.
  if (!headless) {
    own.push({
      name: 'scanruler_write',
      title: 'Write a text file beside the scan',
      description: `Write a text file — a report, notes, a table of readings — next to the scan, as UTF-8: ${TEXT_KINDS.join(', ')} only, and only inside the folder this server last opened a scan or a project from (scan_open, project_load) or saved one into (saveTo), or a folder under it. A relative path is taken in that folder; an absolute one must lie in one of those folders, and a path may not climb out with "..". A file already there is replaced. Returns its path and size in bytes. Refused while this server has opened no scan or project from a folder — then open the scan with scan_open first, or write the file yourself.`,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1, description: `The file: a name in the scan’s folder ("report.md"), a path under it ("report/sigma.md"), or an absolute path in it — ${TEXT_KINDS.join(', ')}.` },
          text: { type: 'string', description: 'What the file holds, as text.' },
        },
        required: ['path', 'text'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
      call: async (args) => {
        try {
          return text(await writeText(args?.path, args?.text))
        } catch (e) {
          return failure(e)
        }
      },
    })
  }

  /** scanruler_write's file, kept to the folders a scan or a project came
   *  from — see its description. */
  const writeText = async (path, body) => {
    if (typeof path !== 'string' || path.length === 0) throw { code: 'invalid_input', message: 'path: give the file to write.' }
    if (typeof body !== 'string') throw { code: 'invalid_input', message: 'text: give what the file holds, as a string.' }
    const kind = extname(path).toLowerCase()
    if (!TEXT_KINDS.includes(kind)) throw { code: 'invalid_input', message: `path: only ${TEXT_KINDS.join(', ')} files are written — not "${kind || 'no extension'}".` }
    if (path.split(/[\\/]/).includes('..')) throw { code: 'invalid_input', message: 'path: ".." is not taken — give a path in the scan’s folder or under it.' }
    if (folders.length === 0) {
      throw { code: 'invalid_state', message: 'This server copy has opened no scan or project from a folder, so it has none to write into. Open the scan with scan_open (or a project with project_load) by its path first — its folder is where the file goes — or write the file yourself.' }
    }
    const target = isAbsolute(path) ? resolve(path) : resolve(folders[0], path)
    const inside = (folder) => {
      const r = relative(folder, target)
      return r !== '' && !r.startsWith('..') && !isAbsolute(r)
    }
    if (!folders.some(inside)) {
      throw { code: 'invalid_input', message: `path: ${target} is outside the folders a scan or a project was opened from — ${folders.join(', ')}. Give a path in one of them.` }
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body, 'utf8')
    return { path: target, size: Buffer.byteLength(body, 'utf8') }
  }

  let listed = ''
  let listedNames = []
  const definition = ({ call: _call, ...tool }) => tool
  // Compact, the list is the server's own tools and the page's that return
  // a picture — a batch gives a picture as its text and a file, so those are called
  // directly; scanruler_tools reads commands() when it is called.
  const shown = (c) => !compact || Boolean(c.returnsImage)
  const listNow = () => [...own.map(definition), ...commands().filter(shown).map((c) => toolFor(c, { outDir }))]

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = listNow()
    listed = JSON.stringify(tools)
    listedNames = tools.map((t) => t.name)
    trace?.write({ ev: 'list', t: trace.now(), tools: tools.length, bytes: Buffer.byteLength(listed, 'utf8') })
    return { tools }
  })

  // A page with other commands than were listed — plugins, another version,
  // a command whose input or description changed — has the client list them
  // again.
  const relist = () => {
    if (!listed) return
    if (JSON.stringify(listNow()) !== listed) server.sendToolListChanged().catch(() => {})
  }
  // A client told the list changed may not list it again — Claude Desktop
  // runs two copies of the server, and the chat's may keep the list it got
  // at its start: the status says so, with what was added and taken away.
  function staleTools() {
    if (!listed) return {}
    const now = listNow()
    if (JSON.stringify(now) === listed) return {}
    const names = now.map((t) => t.name)
    const added = names.filter((n) => !listedNames.includes(n))
    const removed = listedNames.filter((n) => !names.includes(n))
    return {
      tools: {
        stale: true,
        listed: listedNames.length,
        now: names.length,
        ...(added.length ? { added } : {}),
        ...(removed.length ? { removed } : {}),
        note: 'The tools this chat was given are not the ones the ScanRuler page offers now — it changed since they were listed, and the client did not list them again. A tool or field missing from them may be there now: start a new chat to get the current tools; meanwhile scanruler_batch runs any of the page’s tools by name.',
      },
    }
  }
  for (const event of ['connected', 'commands']) {
    link.on(event, () => {
      remember()
      relist()
    })
  }

  /** One of the page's tools run on the page: the result as MCP content,
   *  or a failure. `batched`: a picture is written to a file — the call's
   *  path or a new one in outDir — and given as its text, not shown. */
  const runPageTool = async (name, args, onProgress, { timings = false, ms = false, batched = false } = {}) => {
    const command = commands().find((c) => toolName(c) === name)
    const needsPage = !command && headless ? link.pageCommand(name) : null
    if (needsPage) return failure({ code: 'unavailable', message: `${name} needs the ScanRuler page — a scan, the viewport or the browser — and this server runs ScanRuler headless, with none. Start scanruler-mcp in page mode (without --engine or --headless) and pair it with a ScanRuler tab for it.` })
    if (!command) return failure({ code: 'unknown_command', message: `There is no tool ${name}.` })
    if (!link.connected && !(await link.waitForPage(pageTimeoutMs))) {
      return failure({ code: 'unavailable', message: `No ScanRuler page is connected; scanruler_open opens one. ${connectHelp()}` })
    }
    try {
      const { input, binaryKey } = await inputFor(command, args, { cwd })
      // A session kept before it is replaced: saved, then let go.
      const savedTo = replacesSession(command) && args?.saveTo !== undefined ? await saveSession(String(args.saveTo)) : undefined
      if (savedTo !== undefined) input.discard = true
      const started = Date.now()
      let result = await link.run(command.name, input, binaryKey, onProgress)
      // The folder a scan or a project was opened from, for scanruler_write.
      if (binaryKey && replacesSession(command) && args?.path !== undefined) rememberFolder(absolute(String(args.path), cwd))
      if (savedTo !== undefined && result && typeof result === 'object' && !Array.isArray(result)) result = { ...result, savedTo }
      if (ms && result && typeof result === 'object' && !Array.isArray(result)) result = { ...result, ms: Date.now() - started }
      const image = command.returnsImage && !batched ? await imageContent(result, args, { cwd, outDir }) : null
      if (image) return { content: image }
      // Which steps a change's build played, and how long each took, only
      // for a batch asked for its timings.
      if (!timings && result?.steps?.played) {
        const { played: _played, ...steps } = result.steps
        result = { ...result, steps }
      }
      const saved = command.returnsImage && batched ? await batchedPicture(result, args, { cwd, outDir }) : await saveFileResult(result, args, { cwd, outDir })
      return text(saved, Boolean(command.exact))
    } catch (e) {
      return failure(e)
    }
  }

  /** The session saved as a project file at `path` (a file, or a folder
   *  for its own name): where it went, or null when the session held
   *  nothing to save. Throws, saving nothing, when the save fails. */
  const saveSession = async (path) => {
    let result
    try {
      result = await link.run('project.save', {})
    } catch (e) {
      if (/nothing to save/i.test(e?.message ?? '')) return null
      throw { code: e?.code ?? 'failed', message: `Nothing was replaced: the session could not be saved first — ${e?.message ?? String(e)}` }
    }
    const written = await saveFileResult(result, { path }, { cwd, outDir })
    if (!written?.file?.path) throw { code: 'failed', message: 'Nothing was replaced: project.save gave no file to save.' }
    rememberFolder(written.file.path)
    return written.file.path
  }

  // Several of the page's tools in one call — what cuts a run of twenty
  // scan_nearest calls to one round trip. Each answer is the tool's own; a
  // picture comes back as the text beside it, not as an image, and is
  // written to a file — the call's path, or a new one in outDir — which the
  // text names.
  own.push({
    name: 'scanruler_batch',
    title: 'Run several ScanRuler tools',
    description:
      `Run several of the ScanRuler tools in one call, in order, each with its own arguments — a run of scan_nearest, element_fit or section_get calls, say. Returns results, one per call in order: { tool, ok, result } or { tool, ok: false, error: { code, message } }. The first refused stops the rest (stopped says which index) unless stopOnError is false — and then, with rollback (the default), every change the batch made before it is undone, so the batch stands or falls whole: the answer names failed: { index, tool, error } and undone (the steps taken back, newest first). Each call that changes the session is still its own undo step. timings: true gives each call its ms and the batch total_ms, and a change\'s build the steps it played with their ms (result.steps.played). wait: false answers at once with { queued, job }; scanruler_wait { for: "job", job } gives the batch\'s answer. A tool that returns a picture is not shown here: the picture is written to a file — its call’s path, or a new file in ${outDir} — and its result gives that file.path; call the tool directly to see the picture. The server’s own tools (scanruler_status, _open, _wait, _batch, _write) cannot be batched.`,
    inputSchema: {
      type: 'object',
      properties: {
        calls: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'The calls, in order — or give file instead.',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', minLength: 1, description: 'A tool’s name, as listed — scan_nearest, element_fit.' },
              arguments: { type: 'object', description: 'Its arguments, as the tool takes them; {} for none.' },
            },
            required: ['tool'],
            additionalProperties: false,
          },
        },
        file: { type: 'string', minLength: 1, description: `A JSON file of the calls, read here in place of calls: [{ tool, arguments }], or [{ name, input }] by the command's own name (scan.open), or either under "calls" or "steps". For a long run a script wrote, which then need not pass through the conversation. A relative path is taken from ${cwd}.` },
        stopOnError: { type: 'boolean', description: 'Stop at the first refused call (the default), or run every call and report each.' },
        rollback: { type: 'boolean', description: 'When the batch stops at a refused call, undo what it changed before it (the default) — or leave those changes standing (false).' },
        timings: { type: 'boolean', description: 'Each call’s ms, the batch’s total_ms, and the steps a change’s build played with their ms.' },
        wait: waitIn,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    call: async (args, ctx) => {
      let calls = Array.isArray(args?.calls) ? args.calls : []
      if (args?.file !== undefined) {
        if (calls.length > 0) return failure({ code: 'invalid_input', message: 'Give calls or file, not both.' })
        const read = await callsFromFile(String(args.file))
        if (read.error) return failure({ code: 'invalid_input', message: read.error })
        calls = read.calls
      }
      if (calls.length === 0) return failure({ code: 'invalid_input', message: 'calls: give at least one call (or a file of them).' })
      if (ctx) ctx.fields.calls = calls.length
      const job = startJob('scanruler_batch', () => runBatch(calls, args, ctx), ctx, args?.wait === false)
      return args?.wait === false ? text({ queued: true, job: job.job, tool: 'scanruler_batch' }) : job.done
    },
  })

  /** A batch's calls read from a JSON file — { tool, arguments } as the
   *  batch takes them, or { name, input } by the command's own name, a
   *  list or one under "calls" or "steps". */
  const callsFromFile = async (file) => {
    const path = absolute(file, cwd)
    let data
    try {
      data = JSON.parse(await readFile(path, 'utf8'))
    } catch (e) {
      return { error: `file: ${path} could not be read as JSON (${e instanceof Error ? e.message : String(e)}).` }
    }
    const list = Array.isArray(data) ? data : Array.isArray(data?.calls) ? data.calls : Array.isArray(data?.steps) ? data.steps : null
    if (!list) return { error: `file: ${path} holds no list of calls — a list, or one under "calls" or "steps".` }
    const calls = list.map((c) => (c && typeof c === 'object' && typeof c.name === 'string' && c.tool === undefined ? { tool: toolName({ name: c.name }), arguments: c.input ?? {} } : c))
    if (calls.some((c) => !c || typeof c !== 'object' || typeof c.tool !== 'string')) return { error: `file: every call in ${path} needs a tool (or a name).` }
    return { calls }
  }

  /** The batch's calls run in order — see scanruler_batch. */
  const runBatch = async (calls, args, ctx = null) => {
    const stopOnError = args?.stopOnError !== false
    const timings = args?.timings === true
    const commandOf = (tool) => commands().find((x) => toolName(x) === tool)
    // Where the history stood, to go back to when a call is refused — only
    // when a call may change something, and a page that cannot mark its
    // history simply has its batch left as it went.
    let checkpoint = null
    if (args?.rollback !== false && stopOnError && calls.some((c) => commandOf(String(c?.tool ?? '')) && !commandOf(String(c?.tool ?? '')).readOnly)) {
      checkpoint = await link
        .run('history.checkpoint', {})
        .then((r) => r?.checkpoint ?? null)
        .catch(() => null)
    }
    const results = []
    let stopped
    let failed
    // A batch holding an exact answer (a plane's frame, say) keeps
    // every answer exact: the rounding is one pass over the whole.
    let exact = false
    const started = Date.now()
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i] ?? {}
      const tool = String(c.tool ?? '')
      const at = Date.now()
      const { wait: _wait, timings: _timings, ...callArgs } = c.arguments ?? {}
      const hiddenAt = hiddenNow()
      const one = own.some((t) => t.name === tool)
        ? failure({ code: 'invalid_input', message: `${tool} is the server’s own and is not batched — call it on its own.` })
        : await runPageTool(tool, callArgs, undefined, { timings, batched: true })
      if (ctx && trace) {
        trace.write({ ev: 'entry', call: ctx.call, index: i, t: at, tool, ms: Date.now() - at, in: jsonBytes(callArgs), ...replyMeasure(one), hidden: [hiddenAt, hiddenNow()], ...(trace.args ? { args: callArgs } : {}) })
      }
      const ms = timings ? { ms: Date.now() - at } : {}
      if (!one.isError && commandOf(tool)?.exact) exact = true
      const body = one.content.find((x) => x.type === 'text')?.text ?? ''
      if (one.isError) {
        const m = /^([a-z_]+): ([\s\S]*)$/.exec(body)
        const error = m ? { code: m[1], message: m[2] } : { code: 'failed', message: body }
        results.push({ tool, ok: false, error, ...ms })
        if (stopOnError) {
          stopped = i
          failed = { index: i, tool, error }
          break
        }
      } else {
        let parsed
        try {
          parsed = JSON.parse(body)
        } catch {
          parsed = body
        }
        results.push({ tool, ok: true, result: parsed, ...ms })
      }
    }
    // Refused: what the batch did before it taken back, newest first.
    let undone
    let rollbackError
    if (failed && checkpoint) {
      try {
        undone = (await link.run('history.restore', { checkpoint }))?.undone ?? []
      } catch (e) {
        rollbackError = `${e?.code ?? 'failed'}: ${e?.message ?? String(e)}`
      }
    }
    return text(
      {
        results,
        ran: results.length,
        of: calls.length,
        ...(stopped !== undefined ? { stopped } : {}),
        ...(failed ? { failed, ...(checkpoint ? { undone: undone ?? [] } : {}), ...(rollbackError ? { rollbackError } : {}) } : {}),
        ...(timings ? { total_ms: Date.now() - started } : {}),
      },
      exact,
    )
  }

  // The page's tools for a client that does not list them: a line each,
  // or the definitions of some — each as the full list would give it.
  if (compact) {
    own.push({
      name: 'scanruler_tools',
      title: 'List the ScanRuler tools',
      description: `The ScanRuler tools, which this server lists one by one only when they return a picture. With no arguments: every tool’s name and what it does, a line each. With names: those tools’ full definitions — description and inputSchema — up to ${MAX_DEFINITIONS} at a time; read a tool’s before its first use. Run them with scanruler_batch, a single tool as a batch of one. Names it does not know come back in unknown. The list is the connected page’s, so it can change when a page connects.`,
      inputSchema: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            maxItems: MAX_DEFINITIONS,
            description: 'Tool names, as the list gives them — element_fit, scan_nearest. Leave out for the list.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      call: async (args) => {
        const asked = typeof args?.names === 'string' ? args.names.split(/[\s,]+/) : Array.isArray(args?.names) ? args.names.map(String) : []
        const names = [...new Set(asked.filter(Boolean))]
        const list = commands()
        if (names.length === 0) {
          return text({
            count: list.length,
            tools: Object.fromEntries(list.map((c) => [toolName(c), summary(c)])),
            next: 'scanruler_tools with names gives a tool’s definition; scanruler_batch runs it.',
          })
        }
        if (names.length > MAX_DEFINITIONS) {
          return failure({ code: 'invalid_input', message: `names: at most ${MAX_DEFINITIONS} at a time — ask for the rest in another call.` })
        }
        const found = []
        const unknown = []
        for (const name of names) {
          const command = list.find((c) => toolName(c) === name)
          const mine = own.find((t) => t.name === name)
          if (command) found.push(toolFor(command, { outDir }))
          else if (mine) found.push(definition(mine))
          else unknown.push(name)
        }
        // Exact: a schema's numbers are limits and defaults, not readings.
        return text({ tools: found, unknown }, true)
      },
    })
  }

  // Each call traced as one line when it is answered — what the client
  // waited for — with the tab's hidden state at its start and end and the
  // jobs running when it came; a batch's entries and a queued job's end get
  // lines of their own.
  let callNo = 0
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!trace) return dispatch(request, extra, null)
    const { name, arguments: args } = request.params
    const ctx = { call: ++callNo, fields: {} }
    const t = trace.now()
    const hiddenAt = hiddenNow()
    const running = runningJobs()
    const reply = await dispatch(request, extra, ctx)
    trace.write({
      ev: 'call',
      call: ctx.call,
      t,
      tool: name,
      ms: trace.now() - t,
      in: jsonBytes(args ?? {}),
      ...replyMeasure(reply),
      hidden: [hiddenAt, hiddenNow()],
      ...(running ? { running } : {}),
      ...ctx.fields,
      ...(trace.args ? { args: args ?? {} } : {}),
    })
    return reply
  })

  /** A tool call answered — see the handler above. */
  const dispatch = async (request, extra, ctx) => {
    const { name, arguments: args } = request.params
    const mine = own.find((t) => t.name === name)
    if (mine) return mine.call(args, ctx)
    // Progress lines from the page, for a client that asked for them.
    const token = request.params._meta?.progressToken
    let step = 0
    const onProgress =
      token === undefined
        ? undefined
        : (line) => {
            extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++step, message: line } }).catch(() => {})
          }
    // A change runs as a job: answered when done, or at once with the job
    // for wait: false — and kept either way, for a client that stops
    // waiting before it is done.
    const command = commands().find((c) => toolName(c) === name)
    if (!command || command.readOnly) return runPageTool(name, args, onProgress)
    const { wait, timings, ...rest } = args ?? {}
    const job = startJob(name, () => runPageTool(name, rest, onProgress, { timings: timings === true, ms: timings === true }), ctx, wait === false)
    return wait === false ? text({ queued: true, job: job.job, tool: name }) : job.done
  }

  trace?.write({ ev: 'start', t: trace.now(), version, backend: headless ? 'headless' : 'page', tools: toolMode, pid: process.pid, args: trace.args })
  link.on?.('visibility', (hidden) => trace?.write({ ev: 'visibility', t: trace.now(), hidden }))

  return server
}
