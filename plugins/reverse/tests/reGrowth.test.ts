// SPDX-License-Identifier: AGPL-3.0-only
// Benchmark: a design that grows the way an agent grows one — a script
// generated for N bodies (RE_GROWTH=scale, N = 10 × scale), each built a
// feature at a time: a sketch, an extrude, a round, the body moved, and
// every fifth body patterned once — run through the workspace headless, as
// the app's engine runs it, the kernel in this thread. Each command is
// timed as the agent waits for it, and after each the viewport's work for
// it on a stand-in viewport — the bodies handed to the layer as the
// workspace's effect hands them (ReScene.setBodies) — with the buffers it
// made anew. What grows with the design shows: a command or a redraw that
// costs more the more bodies there are. One JSON line to RE_GROWTH_OUT, or
// the console. Run the same file in two trees alternately.

import { appendFileSync } from 'node:fs'
import * as THREE from 'three'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import type { SceneLayerHost } from '../../../src/viewer/sceneLayers'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { DEFAULT_THEME } from '../../../src/viewer/viewThemes'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { bodyColor, useReverse } from '../state/reStore'
import { ReScene } from '../viewer/reScene'
import plugin from '../plugin'
import { localKernel } from './reLocal'

vi.mock('../../../src/viewer/overlays', () => ({
  pinLabel: () => Object.assign(new THREE.Object3D(), { element: { remove() {} } }),
}))

const SCALE = Number(process.env.RE_GROWTH ?? 0)

vi.setConfig({ testTimeout: 3_600_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  if (!SCALE) return
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless?.stop()
})

/** A viewport that draws nothing, as reSceneBlocks.test.ts has it. */
function stage(): { scene: SceneManager; part: THREE.Group } {
  const part = new THREE.Group()
  const camera = new THREE.OrthographicCamera(-200, 200, 200, -200, 0.1, 5000)
  camera.position.set(300, 240, 360)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const host = {
    scene: new THREE.Scene(),
    partGroup: part,
    raycaster: new THREE.Raycaster(),
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) },
    container: {},
    camera: () => camera,
    setPickRay: () => {},
    invalidate: () => {},
    requestHover: () => {},
    setCursor: () => {},
    theme: () => DEFAULT_THEME,
    modelRadius: () => 200,
    modelCenter: () => [0, 0, 0],
    hasScan: () => true,
    pickScan: () => null,
    scanDistanceAt: () => null,
    clipPlanes: () => null,
    scanOpacity: () => 1,
    click: () => {},
    sizeStage: () => {},
    takeIn: () => {},
    framedSphere: () => new THREE.Sphere(new THREE.Vector3(), 400),
  } as unknown as SceneLayerHost
  return { scene: { layerHost: () => host, addLayer: () => () => {} } as unknown as SceneManager, part }
}

/** Every vertex buffer under the part, as the GPU is handed them. */
function buffers(part: THREE.Group): Set<unknown> {
  const out = new Set<unknown>()
  part.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (!g?.attributes) return
    for (const a of Object.values(g.attributes)) out.add((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data : a)
    if (g.index) out.add(g.index)
  })
  return out
}

/** The agent's script: per body, the commands in order. */
function script(n: number): { label: string; name: string; input: (bodyId: number | null) => unknown }[] {
  const steps: { label: string; name: string; input: (bodyId: number | null) => unknown }[] = []
  for (let i = 0; i < n; i++) {
    const [x, y] = [(i % 10) * 30, Math.floor(i / 10) * 30]
    const sketch = `G${i}`
    steps.push({ label: 'sketch', name: 'reverse.feature.add', input: () => ({ feature: { kind: 'sketch', name: sketch, plane: { kind: 'world', axis: 'z' }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [x, y], size: [14, 10], fixed: true }] } }, detail: 'none' }) })
    steps.push({ label: 'extrude', name: 'reverse.feature.add', input: () => ({ feature: { kind: 'extrude', sketchId: sketch, regions: 'all', extent: { kind: 'distance', from: 0, to: 6 + (i % 4) }, op: 'new' }, detail: 'none' }) })
    steps.push({ label: 'fillet', name: 'reverse.feature.add', input: (body) => ({ feature: { kind: 'fillet', body, edges: [{ between: [[0, 0, 1]] }], radius: 1 }, detail: 'none' }) })
    steps.push({ label: 'move', name: 'reverse.feature.add', input: (body) => ({ feature: { kind: 'moveBody', bodies: [body], translate: [0, 0, 2], rotate: [0, 0, 5] }, detail: 'none' }) })
    if (i % 5 === 4) steps.push({ label: 'pattern', name: 'reverse.feature.add', input: (body) => ({ feature: { kind: 'pattern', body, mode: 'linear', axis: { kind: 'world', axis: 'y' }, count: 2, step: 15 }, detail: 'none' }) })
  }
  return steps
}

describe.skipIf(!SCALE)('growth benchmark', () => {
  it(`builds ${10 * SCALE} bodies a feature at a time`, async () => {
    const { scene, part } = stage()
    const rs = new ReScene(scene)
    const draw = () => {
      // As the workspace's effect does after every build.
      const bodies = useReverse.getState().bodies
      rs.setBodies(bodies.flatMap((b) => {
        const mesh = session.meshes.get(b.id)
        return mesh ? [{ id: b.id, mesh, visible: b.visible, color: b.color ?? bodyColor(b.id), topology: session.topologies.get(b.id) }] : []
      }))
      rs.bodyPicks.updateView()
    }
    const rows: { i: number; label: string; bodies: number; ms: number; drawMs: number; made: number }[] = []
    let body: number | null = null
    const t0 = performance.now()
    let shown = buffers(part)
    const steps = script(10 * SCALE)
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const t = performance.now()
      const out = (await run(s.name, s.input(body))) as { id?: number }
      const ms = performance.now() - t
      if (s.label === 'extrude' && out.id !== undefined) body = out.id
      const d = performance.now()
      draw()
      const drawMs = performance.now() - d
      const now = buffers(part)
      let made = 0
      for (const b of now) if (!shown.has(b)) made++
      shown = now
      rows.push({ i, label: s.label, bodies: useReverse.getState().bodies.length, ms: Math.round(ms * 10) / 10, drawMs: Math.round(drawMs * 10) / 10, made })
    }
    const totalMs = Math.round(performance.now() - t0)
    // Per quarter of the run: the median command and redraw, by kind.
    const quarter = (q: number) => rows.slice(Math.floor((q * rows.length) / 4), Math.floor(((q + 1) * rows.length) / 4))
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b)
      return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    }
    const summary = [0, 1, 2, 3].map((q) => {
      const r = quarter(q)
      return { bodies: r.at(-1)?.bodies, fillet: median(r.filter((x) => x.label === 'fillet').map((x) => x.ms)), extrude: median(r.filter((x) => x.label === 'extrude').map((x) => x.ms)), move: median(r.filter((x) => x.label === 'move').map((x) => x.ms)), drawMs: median(r.map((x) => x.drawMs)), made: median(r.map((x) => x.made)) }
    })
    const line = JSON.stringify({ tree: process.cwd(), scale: SCALE, commands: rows.length, bodies: useReverse.getState().bodies.length, totalMs, failed: useReverse.getState().features.filter((f) => useReverse.getState().results[f.id]?.status === 'failed').length, summary })
    if (process.env.RE_GROWTH_OUT) appendFileSync(process.env.RE_GROWTH_OUT, line + '\n')
    console.log(line)
  })
})
