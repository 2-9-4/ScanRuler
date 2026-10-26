// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registerCoreCommands } from '../src/commands/core'
import { listCommands } from '../src/commands/registry'

/** The MCP server (mcp/) lists the app's commands as tools before a page
 *  has connected, from its own copy of the list — with the app's version
 *  and when the copy was written, so the server can tell whether a list it
 *  kept from a page is older than its own. This keeps the copy the app's:
 *  run with UPDATE_MCP_COMMANDS=1 to write it after a command changes. */
const FILE = new URL('../mcp/src/commands.json', import.meta.url)
const APP = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string

describe('the MCP server’s copy of the command list', () => {
  it('is the app’s own', () => {
    registerCoreCommands()
    const commands = listCommands()
    const read = () => JSON.parse(readFileSync(FILE, 'utf8')) as { app?: string; saved?: string; commands?: unknown } | unknown[]
    const current = (kept: ReturnType<typeof read>) => !Array.isArray(kept) && kept.app === APP && JSON.stringify(kept.commands) === JSON.stringify(commands)
    // Written only when it changed: `saved` dates the list, not the run.
    if (process.env.UPDATE_MCP_COMMANDS && !current(read())) {
      writeFileSync(FILE, JSON.stringify({ app: APP, saved: new Date().toISOString(), commands }, null, 2) + '\n')
    }
    const kept = read()
    const hint = 'mcp/src/commands.json is out of date — run UPDATE_MCP_COMMANDS=1 npx vitest run tests/mcpCommands.test.ts'
    expect(Array.isArray(kept) ? null : kept.app, hint).toBe(APP)
    expect(Array.isArray(kept) ? null : typeof kept.saved, hint).toBe('string')
    expect(Array.isArray(kept) ? kept : kept.commands, hint).toEqual(commands)
  })
})
