// SPDX-License-Identifier: AGPL-3.0-only
// The skills in skills/ and the MCP server's instructions name only tools
// that exist: every tool name a skill writes in backticks in one of the
// app's namespaces (scan_, element_, history_ …) or the server's own
// (scanruler_) must be a command the app registers, as the server lists it,
// or one of the server's own tools; the server's instructions likewise. A
// plugin checks its own namespace in its own skill. A renamed or removed
// command that a skill still teaches fails here.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registerCoreCommands } from '../src/commands/core'
import { listCommands } from '../src/commands/registry'

const SKILLS = new URL('../skills/', import.meta.url)
const MCP = readFileSync(new URL('../mcp/src/mcp.js', import.meta.url), 'utf8')

/** The server's own tools, as mcp.js names them. */
const ownTools = () => [...MCP.matchAll(/name: '(scanruler_[a-z_]+)'/g)].map((m) => m[1])

/** The tools the app's commands are, as the server names them. */
function tools(): Set<string> {
  registerCoreCommands()
  return new Set([...listCommands().map((c) => c.name.split('.').join('_')), ...ownTools()])
}

/** The namespaces whose tool names are checked: the app's and the server's. */
function namespaces(): Set<string> {
  registerCoreCommands()
  return new Set([...listCommands().map((c) => c.name.split('.')[0]), 'scanruler'])
}

/** A file's text with its line ends as LF, however it was checked out. */
const textOf = (url: URL) => readFileSync(url, 'utf8').split('\r\n').join('\n')

/** Every skill file: SKILL.md and reference.md of each skill folder. */
function skillFiles(): { path: string; text: string }[] {
  if (!existsSync(SKILLS)) return []
  return readdirSync(SKILLS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      ['SKILL.md', 'reference.md']
        .map((f) => new URL(`${d.name}/${f}`, SKILLS))
        .filter((u) => existsSync(u))
        .map((u) => ({ path: u.pathname.split('/skills/')[1], text: textOf(u) })),
    )
}

/** The tool-like names in backticks: lower case, an underscore in them. */
const backticked = (text: string) => [...new Set([...text.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g)].map((m) => m[1]))]

describe('the names the skills and the server’s instructions teach', () => {
  it('are the server’s own tools in mcp.js', () => {
    expect(ownTools()).toEqual(expect.arrayContaining(['scanruler_status', 'scanruler_open', 'scanruler_wait', 'scanruler_batch']))
  })

  it('in every skill, name only tools that exist', () => {
    const files = skillFiles()
    expect(files.length).toBeGreaterThan(0)
    const known = tools()
    const spaces = namespaces()
    const unknown = files.flatMap((f) => backticked(f.text).filter((name) => spaces.has(name.split('_')[0]) && !known.has(name)).map((name) => `${f.path}: ${name}`))
    expect(unknown).toEqual([])
    // A skill is SKILL.md with a name and a description, and its reference.
    for (const f of files.filter((x) => x.path.endsWith('SKILL.md'))) {
      expect(f.text, f.path).toMatch(/^---\nname: "?[a-z-]+"?\ndescription: .+\n---\n/)
    }
  })

  it('in the server’s instructions, name only tools that exist', () => {
    // The instructions are lists of sentences: shared ones (`const ABOUT =
    // [`) and each mode's (`full: [`, `compact: [`), a list's closing
    // bracket on a line of its own.
    const blocks = [...MCP.split('\r\n').join('\n').matchAll(/^(?:const ([A-Z_]+) = |\s+(?:full|compact): )\[\n([\s\S]*?)\n\s*\]/gm)].map((m) => [m[0], m[1], m[2]])
    expect(blocks.length).toBeGreaterThanOrEqual(4)
    const known = tools()
    const spaces = namespaces()
    const named = blocks.flatMap((b) => [...b[2].matchAll(/\b([a-z][a-z0-9]*_[a-z0-9_]+)\b/g)].map((m) => m[1]).filter((name) => spaces.has(name.split('_')[0])))
    expect(named.length).toBeGreaterThan(5)
    expect(named.filter((name) => !known.has(name))).toEqual([])
  })
})
