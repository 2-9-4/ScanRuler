// SPDX-License-Identifier: AGPL-3.0-only
// Benchmark (temporary): builds the projects named in RE_BENCH (paths to
// .scanruler files, ';'-separated) and times every step and kernel call.

import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { beforeAll, describe, it } from 'vitest'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import { resolveFeatures } from '../core/resolve'
import { findRegions } from '../core/regions'
import type { SketchFeature } from '../core/features'
import { applyReversePart, type ReversePart } from '../app/projectSection'
import { useReverse } from '../state/reStore'
import reversePlugin from '../plugin'

const files = (process.env.RE_BENCH ?? '').split(';').filter(Boolean)

beforeAll(() => reversePlugin.install?.())

function timed<T extends object>(kernel: T, calls: Map<string, { n: number; ms: number }>): T {
  let depth = 0
  return new Proxy(kernel, {
    get(target, name, receiver) {
      const v = Reflect.get(target, name, receiver) as unknown
      if (typeof v !== 'function') return v
      return (...args: unknown[]) => {
        if (depth > 0) return (v as (...a: unknown[]) => unknown).apply(target, args)
        depth++
        const t = performance.now()
        try {
          return (v as (...a: unknown[]) => unknown).apply(target, args)
        } finally {
          depth--
          const c = calls.get(String(name)) ?? { n: 0, ms: 0 }
          c.n++
          c.ms += performance.now() - t
          calls.set(String(name), c)
        }
      }
    },
  })
}

describe.skipIf(files.length === 0)('build benchmark', () => {
  for (const file of files) {
    it(file, async () => {
      const zip = unzipSync(readFileSync(file))
      const manifest = JSON.parse(strFromU8(zip['project.json']))
      applyReversePart(manifest.reverse as ReversePart)
      const re = useReverse.getState()
      const upto = Number(process.env.RE_UPTO ?? Infinity)
      const features = re.features.filter((f) => f.id <= upto)
      const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
      const sketches = new Map(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
      const alt = process.env.RE_OCCT
      const raw = alt ? new (ReKernel as unknown as new (o: unknown, v: string) => ReKernel)(await ((await import(/* @vite-ignore */ alt)) as { OcctKernel: { init(): Promise<unknown> } }).OcctKernel.init(), alt) : await ReKernel.load()
      const occtCalls = new Map<string, { n: number; ms: number }>()
      const r = raw as unknown as { occt: object }
      r.occt = timed(r.occt, occtCalls)
      const calls = new Map<string, { n: number; ms: number }>()
      const kernel = timed(raw, calls)
      const builder = new Builder(kernel)
      const b = builder as unknown as { play: (...a: unknown[]) => void; output: () => unknown }
      const perStep: { id: number; kind: string; name: string; ms: number }[] = []
      const play = b.play.bind(builder)
      b.play = (step, ...rest) => {
        const t = performance.now()
        play(step, ...rest)
        const s = step as { id: number; kind: string; name?: string }
        perStep.push({ id: s.id, kind: s.kind, name: s.name ?? '', ms: performance.now() - t })
      }
      const output = b.output.bind(builder)
      let outMs = 0
      b.output = () => {
        const t = performance.now()
        const o = output()
        outMs += performance.now() - t
        return o
      }
      const t0 = performance.now()
      const out = builder.build(steps, (id) => sketches.get(id), true)
      const total = performance.now() - t0
      const failed = out.results.filter((r) => r.status === 'failed')
      console.log(`\n=== ${file}: ${total.toFixed(0)} ms total, output ${outMs.toFixed(0)} ms, ${out.bodies.length} bodies, ${out.bodies.reduce((a, x) => a + x.mesh.indices.length / 3, 0)} tris, ${failed.length} failed`)
      for (const f of failed) console.log('  FAILED', f.id, f.message)
      for (const s of perStep) if (s.ms > 20) console.log(`  step ${String(s.id).padStart(3)} ${s.kind.padEnd(9)} ${s.name.padEnd(28)} ${s.ms.toFixed(0).padStart(7)} ms`)
      console.log('  kernel calls:')
      for (const [name, c] of [...calls].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25)) console.log(`    ${name.padEnd(22)} ${String(c.n).padStart(5)}x ${c.ms.toFixed(0).padStart(8)} ms`)
      console.log("  occt calls:")
      for (const [name, c] of [...occtCalls].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25)) console.log(`    ${name.padEnd(22)} ${String(c.n).padStart(6)}x ${c.ms.toFixed(0).padStart(8)} ms`)
      // An edit: fields of features changed, e.g. {"10":{"pitch":3.5}}, and
      // the build after it.
      if (process.env.RE_EDIT) {
        const edit = JSON.parse(process.env.RE_EDIT) as Record<string, Record<string, unknown>>
        const edited = features.map((f) => (edit[f.id] ? ({ ...f, ...edit[f.id] } as typeof f) : f))
        const steps2 = resolveFeatures(edited, { sections: [], elements: [], modelCenter: [0, 0, 0] }, (f) => findRegions(f.sketch))
        perStep.length = 0
        const t1 = performance.now()
        const out2 = builder.build(steps2, (id) => sketches.get(id), true)
        const total2 = performance.now() - t1
        console.log(`\n=== edit ${process.env.RE_EDIT}: ${total2.toFixed(0)} ms, ${out2.results.filter((r) => r.status === 'failed').length} failed, played ${perStep.map((s) => s.id).join(',')}`)
        for (const s of perStep) if (s.ms > 20) console.log(`  step ${String(s.id).padStart(3)} ${s.kind.padEnd(9)} ${s.name.padEnd(28)} ${s.ms.toFixed(0).padStart(7)} ms`)
        if (process.env.RE_CHECK) {
          const fresh = new Builder(raw)
          const scratch = fresh.build(steps2, (id) => sketches.get(id))
          const sig = (o: typeof out2) => JSON.stringify(o.bodies.map((x) => [x.id, x.faces, Math.round(x.volume * 1000)]))
          console.log(`  same as a fresh build: ${sig(out2) === sig(scratch) && JSON.stringify(out2.results) === JSON.stringify(scratch.results)}`)
          fresh.dispose()
        }
      }
      builder.dispose()
    }, 1_800_000)
  }
})
