// SPDX-License-Identifier: AGPL-3.0-only
// How many bytes the workspace's commands cost an agent as tool
// definitions, in the shape scanruler-mcp hands them over (toolFor):
// description, schema and the whole, per command and in all. Runs only
// with RE_TOOL_BYTES set — to a folder, where it writes the full dump as
// tools.json beside the table it prints.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
// The schemas first, as the app loads them: the command modules lean on
// them in a circle.
import '../app/reSession'
import '../plugin'
import { reverseCommands } from '../app/reCommands'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain JavaScript, no types.
import { toolFor } from '../../../mcp/src/tools.js'

describe.skipIf(!process.env.RE_TOOL_BYTES)('tool bytes', () => {
  it('prints the size of every reverse.* tool definition', () => {
    const rows = reverseCommands.map((c) => {
      const tool = toolFor({ ...c, name: `reverse.${c.name}` }, { outDir: 'C:/out', cwd: 'C:/cwd' })
      const description = tool.description as string
      const schema = JSON.stringify(tool.inputSchema)
      return { name: tool.name as string, description, schema: tool.inputSchema, d: description.length, s: schema.length, t: JSON.stringify(tool).length }
    })
    rows.sort((a, b) => b.t - a.t)
    const sum = (k: 'd' | 's' | 't') => rows.reduce((a, r) => a + r[k], 0)
    const lines = rows.map((r) => `${r.name.padEnd(40)} ${String(r.t).padStart(6)} ${String(r.d).padStart(6)} ${String(r.s).padStart(6)}`)
    lines.push(`${'reverse total'.padEnd(40)} ${String(sum('t')).padStart(6)} ${String(sum('d')).padStart(6)} ${String(sum('s')).padStart(6)}`)
    console.log(`${'tool'.padEnd(40)}  total   desc schema\n${lines.join('\n')}`)
    const dir = String(process.env.RE_TOOL_BYTES)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tools.json'), JSON.stringify(rows, null, 1))
    writeFileSync(join(dir, 'table.txt'), lines.join('\n'))
  })
})
