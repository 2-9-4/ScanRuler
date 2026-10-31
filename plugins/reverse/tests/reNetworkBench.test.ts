// SPDX-License-Identifier: AGPL-3.0-only
// The patch network's timing bench (PN14): thirty patches at Auto — a 5 × 6
// network over a 300 × 200 mm freeform sheet scanned at a 0.5 mm edge, half
// a million triangles with 0.02 mm of noise — traced, read into cells,
// mapped, fitted together and made a body through the kernel, under ten
// seconds. What each stage took is printed. Like the other benches it runs
// only when asked —
//   RE_NETWORK_BENCH=1 npx vitest run plugins/reverse/tests/reNetworkBench.test.ts
// (5 s; 7.8 before the fit's inner loops stopped allocating) — since in the whole suite, its files side by side, it took
// 10.7 s, and its eleven seconds of work there kept other files from the
// test runner long enough for its calls to them to time out.

import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import { build } from './reKit'
import { gridNetwork, gridScan } from './networkMeshes'

const kernelPromise = ReKernel.load()

/** A gently waved panel, 300 × 200 mm. */
const panel = (u: number, v: number): Vec3 => {
  const x = 300 * u - 150
  const y = 200 * v - 100
  return [x, y, 12 * Math.sin(x / 60) * Math.cos(y / 50) + 0.0004 * x * x]
}

describe.skipIf(!process.env.RE_NETWORK_BENCH)('patch network bench', () => {
  it('fits and builds thirty patches at Auto in under ten seconds', async () => {
    const k = await kernelPromise
    const m = gridScan(600, 400, panel, { noise: 0.02 })
    const b = new Builder(k)
    b.setScan(new NominalSurface(m.positions, m.indices), m.positions)
    const f = gridNetwork(1, 5, 6, panel, 1, [0.02, 0.98, 0.03, 0.97])
    const began = performance.now()
    const out = await build(b, [f])
    const ms = performance.now() - began
    const r = out.results[0]
    expect(r.status).toBe('ok')
    const report = r.network!
    console.log(`30 patches, ${(m.indices.length / 3).toLocaleString('en-US')} triangles: ${(ms / 1000).toFixed(2)} s in all; ${Object.entries(report.ms).map(([s, t]) => `${s} ${(t / 1000).toFixed(2)} s`).join(', ')}; nets ${report.patches[0].net.u} × ${report.patches[0].net.v}; worst edge ${report.worstAngle.toFixed(3)}°, worst gap ${(report.worstGap * 1000).toFixed(2)} µm, RMS ${Math.min(...report.patches.map((p) => p.rms)).toFixed(4)}–${Math.max(...report.patches.map((p) => p.rms)).toFixed(4)} mm`)
    expect(report.patches.length).toBe(30)
    expect(report.worstAngle).toBeLessThan(0.5)
    expect(ms).toBeLessThan(10_000)
  }, 120_000)
})
