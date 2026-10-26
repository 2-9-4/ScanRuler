// SPDX-License-Identifier: AGPL-3.0-only
// What a plugin is busy with, stopped rather than waited for: a change that
// throws the session's work away (Command.discards) stops it first, and runs
// once it has, the plugin's next work held till the change has run; without
// it, the change is refused busy as ever. A command that stops it
// (Command.interrupts) runs at once — beside a change that waits on the work
// it stops, and while the session is busy — its undo step that change's.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerBusy } from '../src/commands/activity'
import { sessionBusy } from '../src/commands/host'
import { registerCommands, runCommand } from '../src/commands/registry'
import { bool, obj } from '../src/commands/schema'
import { type Command } from '../src/commands/types'
import { useHistory } from '../src/state/historyStore'
import { useStore } from '../src/state/store'
import { refused, run, startHeadless, type Headless } from './commandKit'

let headless: Headless
const undo: (() => void)[] = []

/** The work a plugin is at, and what stopping it saw. */
let working = false
let stoppedFor: Promise<unknown> | null = null
let release: (() => void) | null = null

const open: Command<{ discard?: boolean }> = {
  name: 'open',
  title: 'Open something in place of the session',
  description: 'Replaces the session.',
  input: obj({ discard: bool('Let the work go.') }),
  history: false,
  discards: ({ discard }) => discard === true,
  run: async () => ({ opened: true, working }),
}

const change: Command = {
  name: 'change',
  title: 'Change and wait on the work',
  description: 'Changes, then waits for the work to be done.',
  input: obj({}),
  label: () => 'change',
  run: async () => {
    useStore.setState({ nextSectionNumber: 10 })
    working = true
    await new Promise<void>((resolve) => (release = resolve))
    return { changed: true }
  },
}

const stop: Command = {
  name: 'stop',
  title: 'Stop the work',
  description: 'Stops it.',
  input: obj({}),
  interrupts: true,
  label: () => 'stop the work',
  run: async () => {
    const was = working
    working = false
    useStore.setState((s) => ({ nextSectionNumber: s.nextSectionNumber + 1 }))
    release?.()
    return { stopped: was }
  },
}

beforeAll(async () => {
  headless = await startHeadless()
  undo.push(
    registerCommands('test', [open, change, stop] as Command<never>[]),
    registerBusy('test', () => (working ? 'the test machine is at work' : null), [], async (done) => {
      working = false
      stoppedFor = done
    }),
  )
})
afterAll(() => {
  for (const u of undo) u()
  headless.stop()
})

describe('work stopped rather than waited for', () => {
  it('a change that throws the work away stops it, and runs; without discard it is refused busy', async () => {
    working = true
    const busy = await refused('test.open', { discard: false })
    expect(busy.code).toBe('busy')
    expect(busy.message).toContain('the test machine is at work')
    expect(working).toBe(true)
    const opened = await run<{ opened: boolean; working: boolean }>('test.open', { discard: true })
    expect(opened).toEqual({ opened: true, working: false })
    // What the plugin starts again waits for the change: done by now.
    let settled = false
    await stoppedFor!.then(() => (settled = true))
    expect(settled).toBe(true)
  })

  it('a stop runs at once, beside the change waiting on the work and over the busy guard; its undo step is the change’s', async () => {
    working = false
    const steps = useHistory.getState().past.length
    const changing = runCommand('test.change')
    // The change is under way, and the session busy with its work.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(working).toBe(true)
    expect(sessionBusy()).toBe('the test machine is at work')
    const stopped = await run<{ stopped: boolean }>('test.stop')
    expect(stopped.stopped).toBe(true)
    expect(await changing).toEqual({ changed: true })
    expect(useStore.getState().nextSectionNumber).toBe(11)
    // One step: the change's, the stop's edit in it.
    expect(useHistory.getState().past.length).toBe(steps + 1)
    expect(useHistory.getState().past.at(-1)!.label).toBe('Agent: change')
    // Run alone, a stop is a step of its own.
    await run('test.stop')
    expect(useHistory.getState().past.length).toBe(steps + 2)
    expect(useHistory.getState().past.at(-1)!.label).toBe('Agent: stop the work')
  })
})
