// SPDX-License-Identifier: AGPL-3.0-only
// The app run headless (src/headless/engine.ts), as scanruler-mcp runs it
// with --engine: started in this process with no page, it offers only the
// commands marked to run so, runs them, and turns any other away as
// needing the page — whatever plugins the build has.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HeadlessEngine } from '../src/headless/engine'
import { listCommands, runsHeadless } from '../src/commands/registry'
import { CommandError } from '../src/commands/types'

vi.setConfig({ testTimeout: 60_000 })

let engine: HeadlessEngine

beforeAll(async () => {
  engine = await (await import('../src/headless/engine')).startEngine()
}, 120_000)
afterAll(() => engine?.stop())

describe('the app headless', () => {
  it('offers the commands marked to run without a page, and those alone', () => {
    const offered = engine.listCommands().map((c) => c.name)
    expect(offered).toEqual(expect.arrayContaining(['session.state', 'history.undo', 'history.redo']))
    expect(offered.every((name) => runsHeadless(name))).toBe(true)
    expect(offered).not.toContain('view.render')
    expect(offered).not.toContain('scan.open')
    // Every command is one or the other.
    expect(new Set([...offered, ...engine.pageCommands()])).toEqual(new Set(listCommands().map((c) => c.name)))
    expect(engine.app).toBe('ScanRuler')
  })

  it('runs them, and turns a command that needs the page away, naming it', async () => {
    const state = (await engine.run('session.state', {})) as { app: { viewport: boolean }; scan: unknown }
    expect(state.app.viewport).toBe(false)
    expect(state.scan).toBeNull()
    const refused = await engine.run('view.render', {}).then(
      () => null,
      (e: unknown) => e,
    )
    expect(refused).toBeInstanceOf(CommandError)
    expect((refused as CommandError).code).toBe('unavailable')
    expect((refused as CommandError).message).toMatch(/^view\.render needs the ScanRuler page .*headless/)
    const unknown = await engine.run('no.such', {}).then(
      () => null,
      (e: unknown) => e,
    )
    expect((unknown as CommandError).code).toBe('unknown_command')
  })

  it('is one engine a process', async () => {
    expect(await (await import('../src/headless/engine')).startEngine()).toBe(engine)
  })
})
