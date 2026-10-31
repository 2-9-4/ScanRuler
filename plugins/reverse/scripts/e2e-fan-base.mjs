// SPDX-License-Identifier: AGPL-3.0-only
// The surface route end to end on the fan-base pattern: a box with a round
// boss, scanned a fifth of a degree askew. Every face is fitted as a surface
// — seven planes and the boss's wall as a cylinder, each held square to the
// part's own planes by Auto Constrain — the set is trimmed into a solid, the
// boss's foot is filleted, and the body goes out as a closed STEP solid.
// Needs no scan file: the part is generated here, on a 1 mm grid so that a
// face has vertices of its own for a region to be made of.
//
//   npm run dev &  node plugins/reverse/scripts/e2e-fan-base.mjs
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importStep } from 'meshstep'
import { check, click, downloadsTo, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'

// ---- the part ----------------------------------------------------------------------------
const W = 60, D = 40, H = 15 // the box, centred on the origin in X and Y, standing on z = 0
const R = 10, B = 12 // the boss: its radius and its height above the box
const TILT_DEG = 0.2 // how far the scan lies off the part's frame, about the (1, 1, 0) axis
const VOLUME = W * D * H + Math.PI * R * R * B

function fanBase() {
  const tris = []
  const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d)
  // The box's top outline, counter-clockwise seen from above, a point a
  // millimetre; the boss's circle at the same angles, so the top face is a
  // fan of straight spokes between the two.
  const rim = []
  for (let i = 0; i < W; i++) rim.push([-W / 2 + i, -D / 2])
  for (let i = 0; i < D; i++) rim.push([W / 2, -D / 2 + i])
  for (let i = 0; i < W; i++) rim.push([W / 2 - i, D / 2])
  for (let i = 0; i < D; i++) rim.push([-W / 2, D / 2 - i])
  const K = rim.length
  const circle = rim.map(([x, y]) => {
    const l = Math.hypot(x, y)
    return [(x / l) * R, (y / l) * R]
  })
  const next = (k) => (k + 1) % K
  // The top face round the boss.
  const RINGS = 12
  const top = (i, k) => [circle[k][0] + ((rim[k][0] - circle[k][0]) * i) / RINGS, circle[k][1] + ((rim[k][1] - circle[k][1]) * i) / RINGS, H]
  for (let i = 0; i < RINGS; i++) for (let k = 0; k < K; k++) quad(top(i, k), top(i + 1, k), top(i + 1, next(k)), top(i, next(k)))
  // The boss's wall and its top.
  for (let j = 0; j < B; j++) for (let k = 0; k < K; k++) quad([...circle[k], H + j], [...circle[next(k)], H + j], [...circle[next(k)], H + j + 1], [...circle[k], H + j + 1])
  const lid = (i, k) => [circle[k][0] * (1 - i / R), circle[k][1] * (1 - i / R), H + B]
  for (let i = 0; i + 1 < R; i++) for (let k = 0; k < K; k++) quad(lid(i, k), lid(i, next(k)), lid(i + 1, next(k)), lid(i + 1, k))
  for (let k = 0; k < K; k++) tris.push(lid(R - 1, k), lid(R - 1, next(k)), [0, 0, H + B])
  // The four sides, and the bottom.
  for (let j = 0; j < H; j++) for (let k = 0; k < K; k++) quad([...rim[k], j], [...rim[next(k)], j], [...rim[next(k)], j + 1], [...rim[k], j + 1])
  for (let x = -W / 2; x < W / 2; x++) for (let y = -D / 2; y < D / 2; y++) quad([x, y, 0], [x, y + 1, 0], [x + 1, y + 1, 0], [x + 1, y, 0])
  return tris
}

/** Rodrigues about the unit axis (1, 1, 0)/√2. */
function turned(p, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), u = Math.SQRT1_2
  const dot = (p[0] + p[1]) * u
  const cross = [-u * p[2], u * p[2], u * p[1] - u * p[0]] // axis × p
  return [p[0] * c + cross[0] * s + u * dot * (1 - c), p[1] * c + cross[1] * s + u * dot * (1 - c), p[2] * c + cross[2] * s]
}

function stlOf(tris) {
  const buf = Buffer.alloc(84 + (tris.length / 3) * 50)
  buf.write('ScanRuler e2e fan base', 0, 'ascii')
  buf.writeUInt32LE(tris.length / 3, 80)
  let at = 84
  for (let t = 0; t < tris.length; t += 3) {
    at += 12
    for (const p of [tris[t], tris[t + 1], tris[t + 2]]) {
      const q = turned(p, TILT_DEG)
      buf.writeFloatLE(q[0], at)
      buf.writeFloatLE(q[1], at + 4)
      buf.writeFloatLE(q[2], at + 8)
      at += 12
    }
    at += 2
  }
  return buf
}

const dir = mkdtempSync(join(tmpdir(), 'scanruler-fanbase-'))
const scanPath = join(dir, 'fan-base.stl')
writeFileSync(scanPath, stlOf(fanBase()))

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const cdp = await downloadsTo(page, dir)
await loadScan(page, scanPath, { inputSelector: '[data-test=start-scan] input[type=file]' })
await page.evaluate(() => document.querySelector('[data-test=support-card] button')?.click())
await click(page, '[data-test=workspace-reverse]')
await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 }).catch(() => {})

// ---- every face a surface ----------------------------------------------------------------
// The regions are taken off the scan's vertices by where they lay before the
// part was turned — click-and-flood is e2e-reverse-guide's to prove — and
// fitted through the store; the shapes and what held them are read back
// from the build.
const made = await page.evaluate(
  ({ W, D, H, R, B, TILT_DEG }) => {
    const a = (-TILT_DEG * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), u = Math.SQRT1_2
    const back = (p) => {
      const dot = (p[0] + p[1]) * u
      const cross = [-u * p[2], u * p[2], u * p[1] - u * p[0]]
      return [p[0] * c + cross[0] * s + u * dot * (1 - c), p[1] * c + cross[1] * s + u * dot * (1 - c), p[2] * c + cross[2] * s]
    }
    const near = (v, w) => Math.abs(v - w) < 1e-3
    const faces = [
      { shape: 'plane', on: ([, , z]) => near(z, 0) },
      { shape: 'plane', on: ([x, y, z]) => near(z, H) && Math.hypot(x, y) > R - 1e-3 },
      { shape: 'plane', on: ([x]) => near(x, -W / 2) },
      { shape: 'plane', on: ([x]) => near(x, W / 2) },
      { shape: 'plane', on: ([, y]) => near(y, -D / 2) },
      { shape: 'plane', on: ([, y]) => near(y, D / 2) },
      { shape: 'plane', on: ([, , z]) => near(z, H + B) },
      { shape: 'cylinder', on: ([x, y, z]) => near(Math.hypot(x, y), R) && z > H - 1e-3 && z < H + B + 1e-3 },
    ]
    const p = window.__re.scene().scanPositions()
    const re = window.__re.store
    let made = 0
    for (const f of faces) {
      const region = []
      for (let v = 0; v < p.length / 3; v++) if (f.on(back([p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]))) region.push(v)
      re.getState().startFeature('surface')
      re.getState().setFeatureDraft({ shape: f.shape })
      re.getState().setRegion(Uint32Array.from(region))
      if (re.getState().commitFeature() !== null) made++
    }
    return made
  },
  { W, D, H, R, B, TILT_DEG },
)
check(made === 8, `the fan base’s eight faces are fitted as surfaces (${made})`)
await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 8 && !window.__re.store.getState().building, { timeout: 180_000 }).catch(() => {})
await sleep(300)
const fits = await page.evaluate(() => {
  const s = window.__re.store.getState()
  return s.features.filter((f) => f.kind === 'surface').map((f) => ({ name: f.name, shape: f.shape, result: s.results[f.id] }))
})
for (const f of fits) console.log(f.name, f.shape, f.result?.status, JSON.stringify(f.result?.surface && { rms: +f.result.surface.rms.toFixed(4), free: +(f.result.surface.rmsFree ?? 0).toFixed(4), r: f.result.surface.radius, held: f.result.surface.relations?.map((r) => `${r.relation} ${r.ref} ${r.tiltDeg.toFixed(2)}°`) }))
check(fits.every((f) => f.result?.status === 'ok'), 'every fit built')
check(fits.every((f) => (f.result?.surface?.relations?.length ?? 0) > 0), 'every face, a fifth of a degree off the part’s planes, is held to them')
const boss = fits.find((f) => f.shape === 'cylinder')?.result?.surface
check(boss && Math.abs(boss.radius - R) < 0.01 && boss.relations.some((r) => r.relation === 'along' && r.ref === 'datum:xy'), `the boss is a cylinder of R ${boss?.radius?.toFixed(3)} standing square on the XY plane`)
await page.screenshot({ path: shotPath('fan-base-surfaces.png') })

// ---- trimmed into a solid ----------------------------------------------------------------
await click(page, '[data-test=feature-trim]')
await page.waitForSelector('[data-test=trim-editor]')
check(/8 of 8/.test(await page.$eval('[data-test=trim-count]', (el) => el.textContent)), 'the Trim box opens with the eight surfaces in the set')
await page.waitForFunction(() => /Closed|Not closed|⚠/.test(document.querySelector('[data-test=trim-preview]')?.textContent ?? ''), { timeout: 180_000 }).catch(() => {})
const trimText = await page.$eval('[data-test=trim-preview]', (el) => el.textContent)
console.log('trim:', trimText)
check(/^Closed/.test(trimText), 'the eight surfaces close into a solid')
await click(page, '[data-test=trim-create]')
await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 9 && !window.__re.store.getState().building, { timeout: 180_000 }).catch(() => {})
await sleep(300)
const solid = await page.evaluate(() => window.__re.store.getState().bodies.slice(-1)[0])
console.log('solid:', JSON.stringify(solid))
// Held square, each face at its points' mean distance: the turn took a few
// parts in a million off the box, no more.
check(solid.closed && !solid.surface && Math.abs(solid.volume - VOLUME) < VOLUME * 1e-3, `a closed solid of the fan base’s volume (${solid.volume.toFixed(1)} of ${VOLUME.toFixed(1)} mm³)`)
const kinds = await page.evaluate((id) => window.__re.topology(id).faces.map((f) => ({ kind: f.fingerprint.kind, dir: f.fingerprint.dir })), solid.id)
check(kinds.length === 8 && kinds.filter((f) => f.kind === 'cylinder').length === 1, `of eight faces, one of them the boss’s cylinder (${kinds.length})`)
check(kinds.every((f) => Math.max(...f.dir.map(Math.abs)) > 1 - 1e-9), 'every face square to the part’s axes')
await page.screenshot({ path: shotPath('fan-base-trim.png') })

// ---- the boss's foot filleted ------------------------------------------------------------
const filleted = await page.evaluate(
  ({ id, R, H }) => {
    const re = window.__re.store
    const edges = window.__re.topology(id).edges.filter((e) => Math.abs((e.fingerprint.radius ?? 0) - R) < 0.05 && Math.abs(e.fingerprint.mid[2] - H) < 0.5)
    if (edges.length === 0) return null
    re.getState().startFeature('fillet', { body: id })
    for (const e of edges) re.getState().toggleDraftEdge(id, e)
    re.getState().setFeatureDraft({ radius: 2, radiusTyped: true })
    return { id: re.getState().commitFeature(), edges: edges.length }
  },
  { id: solid.id, R, H },
)
await page.waitForFunction(() => !window.__re.store.getState().building && document.querySelectorAll('[data-test=feature-row]').length === 10, { timeout: 180_000 }).catch(() => {})
await sleep(300)
const rounded = await page.evaluate((id) => window.__re.store.getState().bodies.find((b) => b.id === id), solid.id)
console.log('filleted:', JSON.stringify(filleted), JSON.stringify(rounded))
// A hollow round of 2 mm about the foot: (1 − π/4)·r² of section, swept
// round a circle a little wider than the boss.
const added = rounded.volume - solid.volume
check(filleted?.id != null && rounded.closed && added > 45 && added < 70, `a fillet of R 2 round the boss’s foot fills the corner (${added.toFixed(1)} mm³)`)
await page.screenshot({ path: shotPath('fan-base-fillet.png') })

// ---- out as a closed STEP solid ----------------------------------------------------------
// The surface bodies are cutters and stay behind; the solid alone goes out.
await click(page, '[data-test=export-body-step]')
let stepFile = null
for (let i = 0; i < 150 && !stepFile; i++) {
  await sleep(200)
  stepFile = readdirSync(dir).find((f) => f.endsWith('.step'))
}
check(Boolean(stepFile), `a STEP file downloaded (${stepFile ?? 'missing'})`)
if (stepFile) {
  const text = readFileSync(join(dir, stepFile), 'utf8')
  const back = importStep(text, { surfaceDeviation: 0.01, maxEdge: 5 })
  const d = back.diagnostics
  console.log('meshStep:', JSON.stringify({ ok: d.ok, openEdges: d.openEdges, nonManifold: d.nonManifoldEdges, dropped: d.facesDropped, tris: back.mesh.indices.length / 3 }))
  check(d.openEdges === 0 && d.nonManifoldEdges === 0 && d.facesDropped === 0, 'meshStep builds the export back into a closed solid')
  check((text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length === 1, 'as one solid body — the surfaces it was closed out of stay behind')
  check(/CYLINDRICAL_SURFACE/.test(text) && /TOROIDAL_SURFACE/.test(text), 'with the boss as a cylinder and its foot as a torus, not as splines')
}

await finish(browser, consoleErrors)
