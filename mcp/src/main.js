// SPDX-License-Identifier: AGPL-3.0-only
// scanruler-mcp: an MCP server on stdio for an agent (Claude Code, Claude
// Desktop, Cursor …), and a WebSocket server on 127.0.0.1 for the ScanRuler
// page. The agent's tool calls go to the page and run there, in front of the
// user; the scan goes from this computer to the browser on it and nowhere
// else. Everything this prints goes to stderr — stdout is the MCP channel.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { format, parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { openInBrowser } from './browser.js'
import { configDir, loadConfig, loadRemembered, saveRemembered } from './config.js'
import { CHECKOUT_ENGINE, EngineLink, loadEngine } from './engine.js'
import { originAllowed } from './link.js'
import { createMcpServer, TOOL_MODES } from './mcp.js'
import { SharedLink } from './relay.js'
import { createTrace } from './trace.js'
import { httpServer } from './serve.js'

const DEFAULT_PORT = 7317
const HOSTED_APP = 'https://scanruler.com/'

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const HELP = `scanruler-mcp ${VERSION} — drive ScanRuler from an AI agent

Usage: scanruler-mcp [options]

  --port <n>             the port the ScanRuler page connects to (default ${DEFAULT_PORT})
  --out <dir>            where exported files go when a tool call names no path
                         (default: the folder the agent starts this in)
  --serve <dir>          also serve a built ScanRuler from <dir> at http://127.0.0.1:<port>/
  --allow-origin <url>   let a ScanRuler page from another origin connect (repeatable)
  --app <url>            the ScanRuler address the pairing link opens (default ${HOSTED_APP})
  --engine <file>        run ScanRuler headless in this process, from an engine built
                         with "npm run build:engine" (SCANRULER_ENGINE) — no browser,
                         no page: modelling and files only
  --headless             the same, with the engine built in the ScanRuler checkout
                         this server is part of
  --tools <mode>         full (the default) lists each of ScanRuler's commands as a tool;
                         compact lists five and the commands that return a picture, the
                         rest read through scanruler_tools and run through scanruler_batch
                         — for a small context window
  --trace <dir>          write a line per tool call — tool, ms, bytes each way, error,
                         whether the tab was hidden — to a new file in <dir>, for
                         measuring a run (scripts/trace-summary.mjs in the ScanRuler
                         repository sums it up); off by default
  --trace-args           with --trace, also write each call's arguments (otherwise
                         only their size)
  --pair                 print the pairing token and link, and exit
  --help                 this

The pairing token is made on the first run and kept in ${join2(configDir(), 'config.json')};
SCANRULER_MCP_TOKEN overrides it. SCANRULER_MCP_PORT, SCANRULER_MCP_TOOLS and
SCANRULER_MCP_TRACE stand in for --port, --tools and --trace. The agent's scanruler_open tool opens ScanRuler
in the default browser, paired. By hand: open the pairing link once, or in
ScanRuler go to Settings → Agents → Local agent connection and enter the port
and the token.
`

/** ScanRuler run in this process from the engine at `file`, in place of
 *  the page — no port, no pairing. */
async function headless(file, { cwd, outDir, tools, trace }) {
  // stdout is the MCP channel, the transport's alone: whatever else writes
  // to it — the app's logging, the kernel's own reports — goes to stderr.
  const stdout = process.stdout
  const write = stdout.write.bind(stdout)
  const channel = { write, once: (event, listener) => stdout.once(event, listener) }
  stdout.write = (...args) => process.stderr.write(...args)
  for (const name of ['log', 'info', 'warn', 'debug']) console[name] = (...args) => process.stderr.write(`${format(...args)}\n`)
  const engine = await loadEngine(file)
  const link = new EngineLink(engine, file)
  log(`Running ScanRuler ${engine.version} headless from ${file}, with ${link.page.commands.length} commands.`)
  const server = createMcpServer({
    link,
    version: VERSION,
    cwd,
    outDir,
    connectHelp: () => 'This server runs ScanRuler headless, in its own process; no page connects to it.',
    serverInfo: () => ({ name: 'scanruler-mcp', version: VERSION, backend: 'headless', engine: file, tools, outDir, ...(trace ? { trace: trace.file } : {}) }),
    remembered: null,
    tools,
    trace,
  })
  server.onclose = () => {
    link.close()
    process.exit(0)
  }
  await server.connect(new StdioServerTransport(process.stdin, channel))
  log('Ready, headless.')
}

function join2(a, b) {
  return `${a}${a.includes('\\') ? '\\' : '/'}${b}`
}

const log = (line) => process.stderr.write(`[scanruler-mcp] ${line}\n`)

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      out: { type: 'string' },
      serve: { type: 'string' },
      'allow-origin': { type: 'string', multiple: true },
      app: { type: 'string' },
      engine: { type: 'string' },
      headless: { type: 'boolean' },
      tools: { type: 'string' },
      trace: { type: 'string' },
      'trace-args': { type: 'boolean' },
      pair: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    strict: true,
  })
  if (values.help) {
    process.stderr.write(HELP)
    return
  }
  const port = Number(values.port ?? process.env.SCANRULER_MCP_PORT ?? DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port ${values.port} is not a port.`)
  const tools = values.tools ?? (process.env.SCANRULER_MCP_TOOLS || 'full')
  if (!TOOL_MODES.includes(tools)) {
    throw new Error(`${values.tools === undefined ? 'SCANRULER_MCP_TOOLS' : '--tools'} ${tools} is not one of ${TOOL_MODES.join(', ')}.`)
  }
  const config = loadConfig()
  const token = process.env.SCANRULER_MCP_TOKEN || config.token
  const app = values.app ?? (values.serve ? `http://127.0.0.1:${port}/` : HOSTED_APP)
  const pairing = `${app.replace(/#.*$/, '')}#agent=${port}:${token}`
  const connectHelp = () =>
    `Open ScanRuler — ${app} — in Chrome, Edge or Firefox and either open this pairing link once: ${pairing} — or in ScanRuler go to Settings → Agents, switch on "Local agent connection", and enter port ${port} and token ${token}.`
  if (values.pair) {
    process.stdout.write(`Port:  ${port}\nToken: ${token}\nLink:  ${pairing}\n`)
    return
  }

  const cwd = process.cwd()
  const outDir = values.out ? (values.out.match(/^([A-Za-z]:)?[\\/]/) ? values.out : `${cwd}/${values.out}`) : cwd
  const traceDir = values.trace ?? process.env.SCANRULER_MCP_TRACE
  const trace = traceDir ? createTrace(resolve(cwd, traceDir), { args: values['trace-args'] === true }) : null
  if (trace) log(`Tracing every call to ${trace.file}${trace.args ? ', arguments too' : ''}.`)
  const engineFile = values.engine ?? process.env.SCANRULER_ENGINE ?? (values.headless ? CHECKOUT_ENGINE : null)
  if (engineFile) return headless(resolve(cwd, engineFile), { cwd, outDir, tools, trace })
  const origins = values['allow-origin'] ?? []
  const http = httpServer({ serve: values.serve, allowOrigin: (origin) => originAllowed(origin, origins), version: VERSION })
  // The port, or — when another copy holds it — the relay through that one.
  const link = new SharedLink({ http, port, token, version: VERSION, origins, log })
  link.on('role', (role) =>
    log(role === 'holder'
      ? `Listening for the ScanRuler page on ws://127.0.0.1:${port}/${values.serve ? `, serving ${values.serve} at http://127.0.0.1:${port}/` : ''}.`
      : `Port ${port} is held by another scanruler-mcp; this one sends its calls through it.`),
  )
  link.start()

  const server = createMcpServer({
    link,
    version: VERSION,
    cwd,
    outDir,
    connectHelp: () => (link.error ? `${link.error} ` : '') + connectHelp(),
    serverInfo: () => ({ name: 'scanruler-mcp', version: VERSION, port, role: link.role, tools, outDir, config: config.file, ...(trace ? { trace: trace.file } : {}), ...(link.error ? { error: link.error } : {}) }),
    remembered: { load: () => loadRemembered(), save: (commands) => saveRemembered(commands) },
    openPage: () => openInBrowser(pairing),
    tools,
    trace,
  })
  const transport = new StdioServerTransport()
  server.onclose = () => {
    link.close()
    process.exit(0)
  }
  await server.connect(transport)
  log(`Ready. ${connectHelp()}`)
}
