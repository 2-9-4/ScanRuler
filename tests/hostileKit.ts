// SPDX-License-Identifier: AGPL-3.0-only
// Commands fed junk: every registered command, every input property in turn
// replaced by each of a fixed set of bad values — null, NaN, ±Infinity, -1,
// 1e308, the empty string, a megabyte of text, an empty list and object, an
// object nested thousands deep, values of the wrong type — on an input that
// is otherwise the least the command takes, and each bad value as the whole
// input too. A command must refuse with a CommandError or answer; it must
// never throw anything else, never hang, and never refuse with a fault of
// its own dressed as one (the registry wraps whatever a command throws). What
// the sweep found is handed back for the test to fail on.

import { listCommands, runCommand } from '../src/commands/registry'
import type { JsonSchema } from '../src/commands/schema'
import { CommandError } from '../src/commands/types'

/** An object nested `n` deep. */
function nested(n: number): Record<string, unknown> {
  let v: Record<string, unknown> = {}
  for (let i = 0; i < n; i++) v = { a: v }
  return v
}

/** The bad values, by name. */
export const JUNK: readonly [string, unknown][] = [
  ['null', null],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['-1', -1],
  ['1e308', 1e308],
  ['the empty string', ''],
  ['a megabyte of text', 'x'.repeat(1 << 20)],
  ['[]', []],
  ['{}', {}],
  ['an object 5000 deep', nested(5000)],
  ['true', true],
  ['42.5', 42.5],
  ['"text"', 'text'],
  ['a list of nulls', [null, null, null]],
]

/** The least a schema takes: what it requires, each at its smallest. */
export function least(schema: JsonSchema): unknown {
  if (schema.oneOf) return least(schema.oneOf[0])
  if (schema.enum) return schema.enum[0]
  switch (schema.type) {
    case 'string':
      return schema.format === 'binary' ? new Uint8Array(0) : 'x'.repeat(Math.max(1, schema.minLength ?? 1))
    case 'number':
    case 'integer': {
      const low = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 1)
      return Math.min(schema.type === 'integer' ? Math.ceil(low) : low, schema.maximum ?? Infinity)
    }
    case 'boolean':
      return false
    case 'null':
      return null
    case 'array':
      return Array.from({ length: schema.minItems ?? 0 }, () => (schema.items ? least(schema.items) : null))
    case 'object':
      return Object.fromEntries((schema.required ?? []).map((key) => [key, schema.properties?.[key] ? least(schema.properties[key]) : {}]))
    default:
      return {}
  }
}

/** A refusal that is no refusal: the registry hands on whatever a command
 *  threw as a CommandError, so a fault of the app's own — a property read
 *  off nothing, a stack run out — comes back as `failed` with the fault's
 *  words. */
const FAULT = /Cannot read propert|Cannot set propert|is not a function|is not iterable|is not defined|Maximum call stack|Invalid array length|Invalid string length|out of memory|(TypeError|RangeError|ReferenceError|SyntaxError)|undefined \(reading|of undefined|of null/

export interface HostileFinding {
  command: string
  input: string
  what: string
}

/**
 * Feed every command whose name `include` takes the junk, one property at a
 * time, `perCallMs` at most a call; `before(name)` runs ahead of each
 * command's sweep (to put a scan back, say). Stops at the first call that
 * hangs — a command that never settles holds the queue every change waits
 * in — and hands back every finding.
 */
export async function hostileSweep({ include = () => true, before = async () => {}, perCallMs = 20_000 }: { include?: (name: string) => boolean; before?: (name: string) => Promise<void>; perCallMs?: number } = {}): Promise<{ findings: HostileFinding[]; calls: number; answered: number; slowest: { command: string; input: string; ms: number }[] }> {
  const findings: HostileFinding[] = []
  const times: { command: string; input: string; ms: number }[] = []
  let calls = 0
  let answered = 0
  for (const command of listCommands()) {
    if (!include(command.name)) continue
    await before(command.name)
    const base = least(command.input) as Record<string, unknown>
    const inputs: [string, unknown][] = JUNK.map(([name, value]) => [`the whole input ${name}`, value])
    for (const key of Object.keys(command.input.properties ?? {})) for (const [name, value] of JUNK) inputs.push([`${key}: ${name}`, { ...base, [key]: value }])
    for (const [label, input] of inputs) {
      calls++
      const started = performance.now()
      let timer: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        runCommand(command.name, input).then(
          () => 'answered' as const,
          (e: unknown) => e,
        ),
        new Promise<'hung'>((resolve) => (timer = setTimeout(() => resolve('hung'), perCallMs))),
      ])
      clearTimeout(timer)
      times.push({ command: command.name, input: label, ms: Math.round(performance.now() - started) })
      if (outcome === 'answered') answered++
      else if (outcome === 'hung') {
        findings.push({ command: command.name, input: label, what: `no answer in ${perCallMs / 1000} s` })
        return { findings, calls, answered, slowest: slowest(times) }
      } else if (!(outcome instanceof CommandError)) findings.push({ command: command.name, input: label, what: `threw ${outcome instanceof Error ? `${outcome.name}: ${outcome.message}` : String(outcome)}` })
      else if (FAULT.test(outcome.message)) findings.push({ command: command.name, input: label, what: `${outcome.code}: ${outcome.message.slice(0, 200)}` })
    }
  }
  return { findings, calls, answered, slowest: slowest(times) }
}

/** The ten slowest calls. */
const slowest = (times: { command: string; input: string; ms: number }[]) => [...times].sort((a, b) => b.ms - a.ms).slice(0, 10)
