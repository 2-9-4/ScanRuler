// SPDX-License-Identifier: AGPL-3.0-only
// Sums up scanruler-mcp's call traces (--trace <dir>): how much of a run
// was ScanRuler working and how much the agent, and per tool the calls,
// refusals, time and bytes each way.
//
//   node scripts/trace-summary.mjs <file.jsonl | dir> … [--json]
//
// A directory is every .jsonl in it, each file a session. ScanRuler's time
// is the union of the calls' spans and of the changes that ran after
// answering at once (wait: false); the agent's is the rest of the run, from
// the first call's start to the last's end — the model thinking, and the
// client between calls. Batch entries are counted under their own tool
// (`batched`) as well as in the batch's call.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The lines of a trace file, parsed; broken lines skipped. */
export function readTrace(file) {
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // A line cut off by the server stopping mid-write.
    }
  }
  return out
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0)

/** Total length of the union of [start, end] spans. */
function unionMs(spans) {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let from = -Infinity
  let to = -Infinity
  for (const [a, b] of s) {
    if (a > to) {
      if (to > from) total += to - from
      from = a
      to = b
    } else if (b > to) to = b
  }
  if (to > from) total += to - from
  return total
}

/** One session's summary from its trace lines. */
export function summarize(lines) {
  const start = lines.find((l) => l.ev === 'start') ?? null
  const calls = lines.filter((l) => l.ev === 'call')
  const entries = lines.filter((l) => l.ev === 'entry')
  const jobs = lines.filter((l) => l.ev === 'job')
  const lists = lines.filter((l) => l.ev === 'list')
  if (calls.length === 0) return { start, calls: 0, wallMs: 0, scanrulerMs: 0, agentMs: 0, tools: [], lists: lists.length }
  const first = Math.min(...calls.map((c) => c.t))
  const last = Math.max(...calls.map((c) => c.t + c.ms), ...jobs.map((j) => j.t + j.ms))
  const wallMs = last - first
  const scanrulerMs = unionMs([...calls.map((c) => [c.t, c.t + c.ms]), ...jobs.map((j) => [j.t, j.t + j.ms])])
  // The agent's turns: the gaps between one call's end and the next's start,
  // where nothing of ScanRuler's ran.
  const sorted = [...calls].sort((a, b) => a.t - b.t)
  const gaps = []
  let busyUntil = sorted[0].t
  for (const c of sorted) {
    if (c.t > busyUntil) gaps.push(c.t - busyUntil)
    busyUntil = Math.max(busyUntil, c.t + c.ms)
  }

  const table = new Map()
  const row = (tool) => {
    let r = table.get(tool)
    if (!r) table.set(tool, (r = { tool, calls: 0, batched: 0, errors: 0, ms: [], inBytes: 0, outBytes: 0, images: 0, errorCodes: {} }))
    return r
  }
  const count = (l, batched) => {
    const r = row(l.tool)
    if (batched) r.batched++
    else r.calls++
    if (l.error) {
      r.errors++
      r.errorCodes[l.error] = (r.errorCodes[l.error] ?? 0) + 1
    }
    r.ms.push(l.ms)
    // Per tool, what its answers cost wherever it ran; the batch's own row
    // holds its entries' too, so the session's totals add calls alone.
    r.inBytes += l.in ?? 0
    r.outBytes += l.out ?? 0
    r.images += l.images ?? 0
  }
  for (const c of calls) count(c, false)
  for (const e of entries) count(e, true)
  const tools = [...table.values()]
    .map((r) => {
      const ms = [...r.ms].sort((a, b) => a - b)
      return {
        tool: r.tool,
        calls: r.calls,
        batched: r.batched,
        errors: r.errors,
        ...(r.errors ? { errorCodes: r.errorCodes } : {}),
        totalMs: Math.round(ms.reduce((a, b) => a + b, 0)),
        p95Ms: Math.round(percentile(ms, 95)),
        inBytes: r.inBytes,
        outBytes: r.outBytes,
        images: r.images,
      }
    })
    .sort((a, b) => b.totalMs - a.totalMs || b.calls + b.batched - (a.calls + a.batched))

  // scanruler_wait with nothing behind it: no job running when it came, for
  // idle or a job — the agent waiting on a change that had already answered.
  const waits = calls.filter((c) => c.tool === 'scanruler_wait')
  const hiddenCalls = calls.filter((c) => Array.isArray(c.hidden) && (c.hidden[0] === true || c.hidden[1] === true))
  return {
    start,
    calls: calls.length,
    batchEntries: entries.length,
    queued: jobs.length,
    errors: calls.filter((c) => c.error).length + entries.filter((e) => e.error).length,
    wallMs,
    scanrulerMs,
    agentMs: wallMs - scanrulerMs,
    agentTurns: gaps.length,
    agentGapP95Ms: Math.round(percentile([...gaps].sort((a, b) => a - b), 95)),
    longestCall: sorted.reduce((m, c) => (c.ms > (m?.ms ?? -1) ? c : m), null),
    inBytes: calls.reduce((a, c) => a + (c.in ?? 0), 0),
    outBytes: calls.reduce((a, c) => a + (c.out ?? 0), 0),
    images: calls.reduce((a, c) => a + (c.images ?? 0), 0),
    lists: lists.length,
    listBytes: lists.reduce((a, l) => a + (l.bytes ?? 0), 0),
    waits: waits.length,
    waitsWithNothingQueued: waits.filter((w) => w.wait !== 'page' && !(w.running > 0)).length,
    hiddenCalls: hiddenCalls.length,
    tools,
  }
}

const min = (ms) => `${(ms / 60000).toFixed(1)} min`
const kb = (b) => `${(b / 1024).toFixed(1)}`
const pct = (a, b) => (b > 0 ? `${Math.round((100 * a) / b)} %` : '—')

/** A session's summary as text. */
export function formatSummary(name, s) {
  const out = []
  out.push(`== ${name}${s.start ? ` — scanruler-mcp ${s.start.version}, ${s.start.backend}, tools ${s.start.tools}, started ${new Date(s.start.t).toISOString()}` : ''}`)
  if (!s.calls) {
    out.push('   no calls')
    return out.join('\n')
  }
  out.push(`   run ${min(s.wallMs)}: ScanRuler ${min(s.scanrulerMs)} (${pct(s.scanrulerMs, s.wallMs)}), the agent ${min(s.agentMs)} (${pct(s.agentMs, s.wallMs)}) over ${s.agentTurns} turns between calls (p95 ${(s.agentGapP95Ms / 1000).toFixed(1)} s)`)
  out.push(`   ${s.calls} calls, ${s.batchEntries} batched, ${s.queued} answered at once, ${s.errors} refused; ${kb(s.inBytes)} kB in, ${kb(s.outBytes)} kB out, ${s.images} pictures; tool list handed out ${s.lists}× (${kb(s.listBytes)} kB)`)
  out.push(`   scanruler_wait ${s.waits}× (${s.waitsWithNothingQueued} with nothing queued); calls with the tab hidden ${s.hiddenCalls}`)
  if (s.longestCall) out.push(`   longest call: ${s.longestCall.tool} ${(s.longestCall.ms / 1000).toFixed(1)} s`)
  out.push('')
  const head = ['tool', 'calls', 'batched', 'refused', 'total s', 'p95 s', 'kB in', 'kB out', 'pics']
  const rows = s.tools.map((t) => [t.tool, t.calls, t.batched, t.errors, (t.totalMs / 1000).toFixed(1), (t.p95Ms / 1000).toFixed(2), kb(t.inBytes), kb(t.outBytes), t.images].map(String))
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells) => `   ${cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')}`
  out.push(line(head))
  for (const r of rows) out.push(line(r))
  return out.join('\n')
}

function filesOf(paths) {
  const files = []
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.endsWith('.jsonl')) files.push(join(p, f))
    } else files.push(p)
  }
  return files
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const paths = args.filter((a) => a !== '--json')
  if (paths.length === 0) {
    process.stderr.write('Usage: node scripts/trace-summary.mjs <trace.jsonl | dir> … [--json]\n')
    process.exit(2)
  }
  const sessions = filesOf(paths).map((file) => ({ file, summary: summarize(readTrace(file)) }))
  if (json) process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`)
  else process.stdout.write(`${sessions.map(({ file, summary }) => formatSummary(basename(file), summary)).join('\n\n')}\n`)
}
