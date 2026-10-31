// SPDX-License-Identifier: AGPL-3.0-only
// Benchmark: an agent's edits on saved projects, through the commands as an
// agent runs them, the kernel in this thread behind the worker's own service
// (reLocal.ts). Each project named in RE_SPEED (paths to .scanruler files,
// ';'-separated) is opened and then, RE_SPEED_REPS times over: a fillet
// appended on the part's longest straight edge that takes one, its radius
// edited, set back, the fillet removed, the rollback bar moved ten features
// up and back down. For every one: the command's milliseconds, the builds
// asked of the kernel, and what the builds' answers weigh — the bytes the
// worker hands the page. One JSON line per project to RE_SPEED_OUT, or the
// console. Run the same file in two trees alternately to compare them.

import { appendFileSync, readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { applyReversePart, type ReversePart } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient, type ReTransport } from '../core/reClient'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { localKernel } from './reLocal'

const files = (process.env.RE_SPEED ?? '').split(';').filter(Boolean)
const REPS = Number(process.env.RE_SPEED_REPS ?? 5)

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 600_000 })

/** What a structured clone of the value carries: every buffer once, and
 *  the rest about as JSON writes it. */
function weigh(v: unknown, seen = new Set<ArrayBufferLike>()): { buffers: number; rest: number } {
  const out = { buffers: 0, rest: 0 }
  const walk = (x: unknown) => {
    if (x === null || x === undefined) return void (out.rest += 4)
    if (typeof x === 'number' || typeof x === 'boolean') return void (out.rest += 8)
    if (typeof x === 'string') return void (out.rest += x.length + 2)
    if (ArrayBuffer.isView(x)) {
      if (!seen.has(x.buffer)) {
        seen.add(x.buffer)
        out.buffers += x.buffer.byteLength
      }
      return
    }
    if (Array.isArray(x)) return x.forEach(walk)
    if (typeof x === 'object') for (const [k, y] of Object.entries(x)) {
      out.rest += k.length + 3
      walk(y)
    }
  }
  walk(v)
  return out
}

/** The kernel's transport, every build answer weighed on its way out. */
function counted(inner: ReTransport) {
  const tally = { builds: 0, bodies: 0, buffers: 0, rest: 0 }
  const transport: ReTransport = {
    get onFailure() { return inner.onFailure },
    set onFailure(f) { inner.onFailure = f },
    dispose: () => inner.dispose(),
    async request<T>(msg: { requestId: number }, transfer: Transferable[]): Promise<T> {
      const res = await inner.request<T>(msg, transfer)
      const r = res as { type?: string; bodies?: unknown[] }
      if (r.type === 'build-ok') {
        const w = weigh(res)
        tally.builds++
        tally.bodies += r.bodies?.length ?? 0
        tally.buffers += w.buffers
        tally.rest += w.rest
      }
      return res
    },
  }
  return { transport, tally }
}

let headless: Headless
let session: ReverseSession
let tally: ReturnType<typeof counted>['tally']
const stops: (() => void)[] = []

beforeAll(async () => {
  if (files.length === 0) return
  plugin.install?.()
  headless = await startHeadless()
  const c = counted(localKernel())
  tally = c.tally
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(c.transport) })
  stops.push(installReverseSession(session), session.watch())
  await session.startKernel()
})
afterAll(() => {
  for (const stop of stops) stop()
  headless?.stop()
})

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

describe.skipIf(files.length === 0)('agent edits benchmark', () => {
  for (const file of files) {
    it(file, async () => {
      const zip = unzipSync(readFileSync(file), { filter: (f) => f.name === 'project.json' })
      const manifest = JSON.parse(strFromU8(zip['project.json']))
      const samples: Record<string, { ms: number; builds: number; bodies: number; buffers: number; rest: number; answer: unknown }[]> = {}
      const timed = async (op: string, name: string, input: unknown) => {
        const before = { ...tally }
        const t = performance.now()
        const answer = await run(name, input)
        const ms = performance.now() - t
        ;(samples[op] ??= []).push({ ms, builds: tally.builds - before.builds, bodies: tally.bodies - before.bodies, buffers: tally.buffers - before.buffers, rest: tally.rest - before.rest, answer })
        return answer as Record<string, unknown>
      }
      const t0 = performance.now()
      applyReversePart(manifest.reverse as ReversePart)
      await session.settled(3_000_000)
      const openMs = performance.now() - t0
      const count = useReverse.getState().features.length
      // The part's longest straight edge that a fillet of 0.4 takes.
      const bodies = useReverse.getState().bodies.filter((b) => !b.surface).sort((a, b) => b.volume - a.volume)
      const body = bodies[0]
      const described = (await run('reverse.body.describe', { body: body.id, sort: 'largest' })) as { bodies: { edgeList: { index: number; kind: string }[] }[] }
      const lines = described.bodies[0].edgeList.filter((e) => e.kind === 'line').slice(0, 15)
      let edge: number | null = null
      for (const e of lines) {
        const a = (await run('reverse.feature.add', { feature: { kind: 'fillet', body: body.id, edges: [e.index], radius: 0.4 }, detail: 'none' })) as { status: string }
        await run('history.undo')
        await session.settled()
        if (a.status === 'ok') {
          edge = e.index
          break
        }
      }
      if (edge === null) throw new Error('No straight edge took a fillet of 0.4.')
      for (let rep = 0; rep < REPS; rep++) {
        // A radius of each round's own, so no append is one built before.
        const radius = 0.41 + rep * 0.01
        const added = await timed('append fillet', 'reverse.feature.add', { feature: { kind: 'fillet', body: body.id, edges: [edge], radius }, detail: 'none' })
        const id = added.id as number
        await timed('edit at end', 'reverse.feature.update', { feature: id, set: { radius: radius + 0.1 }, detail: 'none' })
        await timed('set back', 'reverse.feature.update', { feature: id, set: { radius }, detail: 'none' })
        await timed('remove at end', 'reverse.feature.remove', { feature: id, detail: 'none' })
        await timed('rollback up 10', 'reverse.feature.rollback', { to: count - 10, detail: 'none' })
        await timed('rollback down', 'reverse.feature.rollback', { to: null, detail: 'none' })
      }
      const summary = Object.fromEntries(
        Object.entries(samples).map(([op, xs]) => [
          op,
          { ms: median(xs.map((x) => x.ms)), msAll: xs.map((x) => Math.round(x.ms)), builds: median(xs.map((x) => x.builds)), bodies: median(xs.map((x) => x.bodies)), bytes: median(xs.map((x) => x.buffers + x.rest)), answer: xs.at(-1)!.answer },
        ]),
      )
      const line = JSON.stringify({ file, tree: process.cwd(), features: count, bodies: useReverse.getState().bodies.length, openMs: Math.round(openMs), edge, summary })
      if (process.env.RE_SPEED_OUT) appendFileSync(process.env.RE_SPEED_OUT, line + '\n')
      console.log(line)
    })
  }
})
