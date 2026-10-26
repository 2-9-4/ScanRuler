// SPDX-License-Identifier: AGPL-3.0-only
// The reads a guide prescribes, as guide.read takes them — every
// `guide_read { … }` it writes in backticks, and every `topic: …` it names
// on its own — and the most an answer to one may run to before the MCP
// server writes it to a file instead: its cap for guide.read, read off
// mcp/src/mcp.js so the two cannot drift apart.

import { readFileSync } from 'node:fs'

export const GUIDE_ANSWER_CAP: number = (() => {
  const mcp = readFileSync(new URL('../mcp/src/mcp.js', import.meta.url), 'utf8')
  const m = /ANSWER_CAPS = \{ 'guide\.read': ([\d_]+) \}/.exec(mcp)
  if (!m) throw new Error('mcp/src/mcp.js names no cap for guide.read.')
  return Number(m[1].split('_').join(''))
})()

/** The object a guide writes, its keys bare, as JSON. */
const parsed = (written: string): Record<string, unknown> => JSON.parse(written.replace(/([{,]\s*)([A-Za-z]+)\s*:/g, '$1"$2":'))

/** Each read the text prescribes: as it is written, and as input. */
export function quotedReads(text: string): { quoted: string; input: Record<string, unknown> }[] {
  const calls = [...text.matchAll(/`guide_read (\{[^`]*\})`/g)].map((m) => ({ quoted: m[0], input: parsed(m[1]) }))
  const topics = [...text.matchAll(/`topic: ((?:"[^"`]+")|(?:\[[^\]`]+\]))`/g)].map((m) => ({ quoted: m[0], input: { topic: JSON.parse(m[1]) } }))
  return [...calls, ...topics]
}
