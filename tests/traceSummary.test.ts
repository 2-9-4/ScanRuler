// SPDX-License-Identifier: AGPL-3.0-only
// scripts/trace-summary.mjs on a made-up trace: the run split into
// ScanRuler's time and the agent's, a change answered at once counted as
// ScanRuler's while it ran, batch entries under their own tool, and waits
// with nothing queued behind them found.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain script, no types
import { formatSummary, summarize } from '../scripts/trace-summary.mjs'

const T = 1_000_000
const lines = [
  { ev: 'start', t: T, version: '0.2.0', backend: 'page', tools: 'full', pid: 1, args: false },
  { ev: 'list', t: T, tools: 99, bytes: 150_000 },
  { ev: 'call', call: 1, t: T + 0, tool: 'session_state', ms: 100, in: 2, out: 3000, error: null, hidden: [false, false] },
  // 10 s of the agent thinking.
  { ev: 'call', call: 2, t: T + 10_100, tool: 'element_fit', ms: 2000, in: 400, out: 600, error: null, hidden: [false, false], job: 'j1' },
  { ev: 'call', call: 3, t: T + 15_100, tool: 'scanruler_batch', ms: 1000, in: 300, out: 900, error: null, hidden: [false, true], job: 'j2', calls: 2 },
  { ev: 'entry', call: 3, index: 0, t: T + 15_100, tool: 'section_fit', ms: 600, in: 100, out: 500, error: null, hidden: [false, false] },
  { ev: 'entry', call: 3, index: 1, t: T + 15_700, tool: 'section_fit', ms: 400, in: 100, out: 30, error: 'invalid_input', hidden: [false, true] },
  // A change answered at once, which then runs 8 s while the agent goes on.
  { ev: 'call', call: 4, t: T + 20_100, tool: 'element_fit', ms: 5, in: 400, out: 60, error: null, hidden: [true, true], job: 'j3', queued: true },
  { ev: 'job', job: 'j3', call: 4, tool: 'element_fit', t: T + 20_100, ms: 8000, out: 700, error: null },
  { ev: 'call', call: 5, t: T + 22_100, tool: 'scanruler_wait', ms: 6000, in: 30, out: 700, error: null, hidden: [true, false], wait: 'job', job: 'j3', running: 1 },
  { ev: 'call', call: 6, t: T + 30_100, tool: 'scanruler_wait', ms: 600, in: 20, out: 400, error: null, hidden: [false, false], wait: 'idle' },
  { ev: 'call', call: 7, t: T + 40_000, tool: 'view_render', ms: 1000, in: 2, out: 90_000, images: 1, error: null, hidden: [false, false] },
]

describe('trace summary', () => {
  it('splits the run into ScanRuler and the agent, and counts per tool', () => {
    const s = summarize(lines)
    expect(s.calls).toBe(7)
    expect(s.batchEntries).toBe(2)
    expect(s.queued).toBe(1)
    expect(s.errors).toBe(1)
    expect(s.wallMs).toBe(41_000)
    // 0–0.1, 10.1–12.1, 15.1–16.1, 20.1–28.1 (the job and the wait inside
    // it), 30.1–30.7, 40–41: 0.1 + 2 + 1 + 8 + 0.6 + 1 = 12.7 s.
    expect(s.scanrulerMs).toBe(12_700)
    expect(s.agentMs).toBe(41_000 - 12_700)
    expect(s.agentTurns).toBe(6)
    expect(s.waits).toBe(2)
    expect(s.waitsWithNothingQueued).toBe(1)
    expect(s.hiddenCalls).toBe(3)
    expect(s.images).toBe(1)
    expect(s.lists).toBe(1)
    const fit = s.tools.find((t: { tool: string }) => t.tool === 'section_fit')
    expect(fit).toMatchObject({ calls: 0, batched: 2, errors: 1, errorCodes: { invalid_input: 1 }, totalMs: 1000 })
    const add = s.tools.find((t: { tool: string }) => t.tool === 'element_fit')
    expect(add).toMatchObject({ calls: 2, batched: 0, inBytes: 800 })
    expect(s.longestCall.tool).toBe('scanruler_wait')
  })

  it('reads as text', () => {
    const text = formatSummary('run.jsonl', summarize(lines))
    expect(text).toContain('ScanRuler 0.2 min (31 %), the agent 0.5 min (69 %) over 6 turns')
    expect(text).toContain('scanruler_wait 2× (1 with nothing queued)')
    expect(text).toMatch(/section_fit\s+0\s+2\s+1/)
  })

  it('an empty trace is no calls, not a crash', () => {
    expect(summarize([{ ev: 'start', t: T }]).calls).toBe(0)
    expect(formatSummary('x', summarize([]))).toContain('no calls')
  })
})
