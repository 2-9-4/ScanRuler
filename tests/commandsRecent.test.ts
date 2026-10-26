// SPDX-License-Identifier: AGPL-3.0-only
// The recent outcomes the page keeps of runs made under a job — what a
// server copy started after the one that asked reads with session.recent.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerCoreCommands } from '../src/commands/core'
import { RECENT_KEPT, RECENT_RESULT_CHARS, recentOutcomes, registerCommands, runCommand } from '../src/commands/registry'
import { bool, int, obj } from '../src/commands/schema'
import { CommandError, type Command } from '../src/commands/types'

let release: (() => void) | null = null
const read: Command<{ size?: number; fail?: boolean; hold?: boolean }> = {
  name: 'read',
  title: 'Read something',
  description: 'Reads.',
  input: obj({ size: int(), fail: bool(), hold: bool() }),
  readOnly: true,
  run: async ({ size = 0, fail, hold }) => {
    if (hold) await new Promise<void>((r) => (release = r))
    if (fail) throw new CommandError('invalid_state', 'Not now.')
    return { text: 'x'.repeat(size), file: { name: 'a.bin', mimeType: 'application/octet-stream', bytes: new Uint8Array(3) } }
  },
}

let unregister: () => void
beforeAll(() => {
  registerCoreCommands()
  unregister = registerCommands('recenttest', [read])
})
afterAll(() => unregister())

const recent = async (input: Record<string, unknown>) =>
  (await runCommand('session.recent', input)) as { outcomes: { job: string; name: string; state: string; ms: number | null; result?: { text: string; file: { bytes: unknown } }; resultOmitted?: string; error?: { code: string; message: string } }[]; more?: number }

describe('the recent outcomes', () => {
  it('keeps a run under a job — done with its result, failed with its error, newest first — and none without one', async () => {
    await runCommand('recenttest.read', { size: 2 }, undefined, 'jA')
    await expect(runCommand('recenttest.read', { fail: true }, undefined, 'jA')).rejects.toThrow('Not now.')
    await expect(runCommand('recenttest.nothing', {}, undefined, 'jA')).rejects.toThrow()
    await runCommand('recenttest.read', { size: 1 })
    const { outcomes } = await recent({ job: 'jA' })
    expect(outcomes.map((o) => [o.name, o.state])).toEqual([
      ['recenttest.nothing', 'failed'],
      ['recenttest.read', 'failed'],
      ['recenttest.read', 'done'],
    ])
    expect(outcomes[0].error?.code).toBe('unknown_command')
    expect(outcomes[1].error).toEqual({ code: 'invalid_state', message: 'Not now.' })
    expect(outcomes[2].result?.text).toBe('xx')
    // A file's bytes are kept as their count.
    expect(outcomes[2].result?.file.bytes).toBe('3 bytes')
    expect(typeof outcomes[2].ms).toBe('number')
    // session.recent itself, run under no job, is not kept.
    expect(recentOutcomes().every((o) => o.job === 'jA')).toBe(true)
  })

  it('says running while a run goes on, and leaves a large result out by its size', async () => {
    const held = runCommand('recenttest.read', { hold: true }, undefined, 'jB')
    expect(recentOutcomes('jB')).toMatchObject([{ state: 'running', ms: null }])
    release?.()
    await held
    expect(recentOutcomes('jB')[0].state).toBe('done')
    await runCommand('recenttest.read', { size: RECENT_RESULT_CHARS }, undefined, 'jB')
    const [big] = recentOutcomes('jB')
    expect(big.result).toBeUndefined()
    expect(big.resultOmitted).toMatch(/^\d+ characters, past the 16000 kept$/)
  })

  it('keeps the last RECENT_KEPT, and session.recent gives a limit and says how many more there are', async () => {
    for (let i = 0; i < RECENT_KEPT + 5; i++) await runCommand('recenttest.read', { size: 0 }, undefined, `jC${i}`)
    expect(recentOutcomes()).toHaveLength(RECENT_KEPT)
    expect(recentOutcomes('jC0')).toEqual([])
    const page = await recent({ limit: 3 })
    expect(page.outcomes.map((o) => o.job)).toEqual([`jC${RECENT_KEPT + 4}`, `jC${RECENT_KEPT + 3}`, `jC${RECENT_KEPT + 2}`])
    expect(page.more).toBe(RECENT_KEPT - 3)
  })
})
