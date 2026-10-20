// SPDX-License-Identifier: AGPL-3.0-only
// Where the commands are kept, listed and run. The app registers its own at
// start-up (core.ts); a plugin registers its under its id from its install()
// — the app never names a plugin, so the list a build offers is the app's
// commands plus whatever its plugins added.
//
// Running one: the input is checked against the command's schema; a command
// that changes the session waits for the one before it, is refused while
// the session is busy with something else, and runs as one step of the
// undo history under its label. Read-only commands run at once. One that
// runs past its time is given up on — its caller answered `timeout` — and
// the next runs.

import { historyAsync } from '../state/historyStore'
import { commandGuard, useCommandActivity } from './activity'
import { SCHEMA_BUDGET, schemaWeight, validate } from './schema'
import { CommandError, type Command, type CommandContext, type CommandInfo } from './types'

const commands = new Map<string, Command>()

/** Command names: namespace and verb, dotted, lower case. */
const NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

/**
 * Add commands under a namespace — `registerCommands('element', [fit])`
 * makes `element.fit`. A plugin's namespace is its id. Two commands of one
 * name throw, as two project sections of one key do, and so does a command
 * whose input schema is past SCHEMA_BUDGET — an agent's client would drop
 * it. The returned function takes them out again.
 */
export function registerCommands(namespace: string, list: readonly Command<never>[]): () => void {
  const added: string[] = []
  for (const command of list as readonly Command[]) {
    const name = `${namespace}.${command.name}`
    if (!NAME.test(name)) throw new Error(`"${name}" is not a command name — namespace and verb, dotted, lower case.`)
    if (commands.has(name)) throw new Error(`Two commands share the name "${name}".`)
    if (command.input.type !== 'object') throw new Error(`Command "${name}" must take an object.`)
    const weight = schemaWeight(command.input)
    if (weight.bytes > SCHEMA_BUDGET.bytes || weight.depth > SCHEMA_BUDGET.depth) {
      throw new Error(
        `Command "${name}" has an input schema of ${weight.bytes} bytes nested ${weight.depth} deep — past ${SCHEMA_BUDGET.bytes} bytes and ${SCHEMA_BUDGET.depth} deep an agent's client may drop it. List the shape loosely and check it when the command runs.`,
      )
    }
    commands.set(name, command)
    added.push(name)
  }
  return () => {
    for (const name of added) commands.delete(name)
  }
}

/** Every command, by name, as a caller sees it. */
export function listCommands(): CommandInfo[] {
  return [...commands.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, c]) => ({
      name,
      title: c.title,
      description: c.description,
      input: c.input,
      readOnly: Boolean(c.readOnly),
      returnsFile: Boolean(c.returnsFile),
      returnsImage: Boolean(c.returnsImage),
      ...(c.exact ? { exact: true } : {}),
    }))
}

/** Whether a command runs without the page — see Command.headless. */
export function runsHeadless(name: string): boolean {
  return commands.get(name)?.headless === true
}

// ---- Running ----------------------------------------------------------------

/** How long a command may run, unless it says otherwise (Command.timeoutMs),
 *  before its caller is answered `timeout` and the queue moves on — longer
 *  than any build or measurement that is going well takes. */
export const COMMAND_TIMEOUT_MS = 10 * 60_000

let queue: Promise<unknown> = Promise.resolve()

const asCommandError = (e: unknown): CommandError =>
  e instanceof CommandError
    ? e
    : new CommandError('failed', e instanceof Error ? e.message : String(e))

/** A command's run raced against its time. Past it, the run is told to stop
 *  (ctx.signal) and let go — whatever it does after is nobody's answer —
 *  and the caller is answered `timeout`, so that what waits on it, the
 *  history step and the queue, moves on. */
function limited<T>(name: string, ms: number, abort: AbortController, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new CommandError(
        'timeout',
        `${name} did not finish in ${ms / 1000} s and was given up on. It may have changed the session in part — read session.state (history.undo says the last step) before running it again.`,
      )
      abort.abort(e)
      reject(e)
    }, ms)
  })
  let ran: Promise<T>
  try {
    ran = run()
  } catch (e) {
    ran = Promise.reject(e)
  }
  // Let go past its time, it may still fail later: heard here, not as an
  // unhandled rejection.
  ran.catch(() => {})
  return Promise.race([ran, late]).finally(() => clearTimeout(timer))
}

/**
 * Run a command by name. Resolves with its result; rejects with a
 * CommandError — never anything else — saying why it did not run or did not
 * succeed. `onProgress` hears the command's progress lines.
 */
export function runCommand(
  name: string,
  input: unknown = {},
  onProgress?: (text: string) => void,
): Promise<unknown> {
  const command = commands.get(name)
  if (!command) return Promise.reject(new CommandError('unknown_command', `There is no command "${name}".`))
  const errors = validate(command.input, input ?? {})
  if (errors.length) return Promise.reject(new CommandError('invalid_input', errors.join('; ')))
  const args = (input ?? {}) as Record<string, unknown>
  if (command.readOnly) {
    const abort = new AbortController()
    const ctx: CommandContext = { progress: (text) => onProgress?.(text), signal: abort.signal }
    return limited(name, command.timeoutMs ?? COMMAND_TIMEOUT_MS, abort, () => command.run(args, ctx)).catch((e) => Promise.reject(asCommandError(e)))
  }
  const job = queue.then(() => execute(name, command, args, onProgress))
  queue = job.catch(() => {})
  return job
}

async function execute(
  name: string,
  command: Command,
  input: Record<string, unknown>,
  onProgress?: (text: string) => void,
): Promise<unknown> {
  const busy = commandGuard().busy()
  if (busy) throw new CommandError('busy', `The session is busy — ${busy}. Try again once it has finished.`)
  const abort = new AbortController()
  const ctx: CommandContext = {
    progress: (text) => {
      // A run let go past its time says nothing more to the strip.
      if (!abort.signal.aborted) useCommandActivity.setState({ progress: text })
      onProgress?.(text)
    },
    signal: abort.signal,
  }
  // Raced inside the history step, so that the step ends — and the history
  // takes changes again — when the command is given up on.
  const run = () => limited(name, command.timeoutMs ?? COMMAND_TIMEOUT_MS, abort, () => command.run(input, ctx))
  useCommandActivity.setState({ running: { name, title: command.title, since: Date.now() }, progress: null })
  try {
    if (command.history === false) return await run()
    let result: unknown
    await historyAsync(`Agent: ${command.label?.(input) ?? command.title.toLowerCase()}`, async () => {
      result = await run()
    })
    return result
  } catch (e) {
    throw asCommandError(e)
  } finally {
    useCommandActivity.setState({ running: null, progress: null })
  }
}
