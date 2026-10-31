// SPDX-License-Identifier: AGPL-3.0-only
// Round 7 of the agent plan (what the agent could not see) driven by an
// agent, end to end: on the scan of a 40 mm block the model is the block
// with a Ø6 stud 5 mm proud of its +X side that the scan does not have.
// Compare in Deviation reads both maps: on the scan the stud is next to
// nothing, on the bodies its end stands 5 mm proud, told by the face and
// the feature that made it. The map is painted on the bodies and pictured
// — written, not shown — four views in one picture, and a section's
// picture names its world axes.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/reverse/scripts/e2e-agent-round7.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

/** A 40 mm cube about the origin, its faces in half-millimetre strips with a
 *  little noise across them: triangles as a flat list of xyz. */
function block(step = 0.5, noise = 0.02) {
  let seed = 11
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  const tris = []
  const h = 20
  // Each face as (origin, u, v), wound outward: cross(u, v) points out.
  const faces = [
    [[-h, -h, h], [1, 0, 0], [0, 1, 0]],
    [[-h, -h, -h], [0, 1, 0], [1, 0, 0]],
    [[h, -h, -h], [0, 1, 0], [0, 0, 1]],
    [[-h, -h, -h], [0, 0, 1], [0, 1, 0]],
    [[-h, h, -h], [0, 0, 1], [1, 0, 0]],
    [[-h, -h, -h], [1, 0, 0], [0, 0, 1]],
  ]
  for (const [o, u, v] of faces) {
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const at = (a, b) => {
      const edge = a === 0 || b === 0 || a >= 2 * h || b >= 2 * h
      const d = edge ? 0 : noise * rand()
      return [0, 1, 2].map((k) => o[k] + u[k] * a + v[k] * b + n[k] * d)
    }
    for (let a = 0; a < 2 * h; a += step) for (let b = 0; b < 2 * h; b += step) tris.push([at(a, b), at(a + step, b), at(a + step, b + step)], [at(a, b), at(a + step, b + step), at(a, b + step)])
  }
  return tris
}

function stl(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => {
    const o = 84 + i * 50
    t.forEach((p, j) => p.forEach((v, k) => buf.writeFloatLE(v, o + 12 + j * 12 + k * 4)))
  })
  return buf
}

mkdirSync(OUT_DIR, { recursive: true })
const scanPath = join(OUT_DIR, 'round7-block.stl')
writeFileSync(scanPath, stl(block()))
const quietPath = join(OUT_DIR, 'round7-on-bodies.png')
const sheetPath = join(OUT_DIR, 'round7-views.png')
rmSync(quietPath, { force: true })
rmSync(sheetPath, { force: true })

const { agent } = await launchAgent(startAgent)
const { call } = agent
const ok = async (name, input, what) => {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}

const status = await call('scanruler_status')
const link = /(\S+#agent=\d+:[\w-]+)/.exec(status.json?.howToConnect ?? '')?.[1]
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 300_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 60 })
  check(waited.json?.connected === true, 'the page connected')
  await ok('scan_open', { path: scanPath, discard: true })
  await ok('workspace_set', { workspace: 'reverse' })
  await call('scanruler_wait', { for: 'idle', timeoutSeconds: 120 })

  // ---- the model: the block, and a stud the scan has not --------------------------
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Base', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } }, detail: 'none' })
  await ok('reverse_feature_add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Base', regions: 'all', extent: { kind: 'distance', from: 0, to: 40 }, op: 'new' }, detail: 'none' })
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Stud sketch', plane: { kind: 'world', axis: 'x', offset: 20 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 3 }] } }, detail: 'none' })
  const stud = await ok('reverse_feature_add', { feature: { kind: 'extrude', name: 'Stud', sketchId: 'Stud sketch', regions: 'all', extent: { kind: 'distance', from: -0.5, to: 5 }, op: 'join' } })
  check(stud.json?.feature?.status === 'ok', `the stud builds (${stud.json?.feature?.status})`)

  // ---- both maps --------------------------------------------------------------------
  const both = await ok('reverse_body_compare_in_deviation', {})
  const on = both.json?.onReference
  check(on && on.backedPct > 80 && on.backedPct < 100, `the bodies read against the scan: ${on?.backedPct} % backed, ${on?.farPct} % far, ${on?.noScanPct} % no scan`)
  const proud = [...(on?.far?.outside?.patches ?? []), ...(on?.patches ?? []).filter((p) => p.side === 'outside')]
  const end = proud.find((p) => p.centroid[0] > 24)
  check(end && Math.abs(end.extreme - 5) < 0.6 && end.face?.madeBy?.name === 'Stud', `the stud's end stands ${end?.extreme} mm proud, on face ${end?.face?.index} made by ${end?.face?.madeBy?.name}`)
  const bare = (on?.noScan?.patches ?? []).find((p) => p.centroid[0] > 20)
  check(bare && bare.area > 30 && bare.face?.madeBy?.name === 'Stud', `its side has no scan behind it (${bare?.area} mm², made by ${bare?.face?.madeBy?.name})`)
  const scanSide = await ok('deviation_hotspots', { tolerance: 0.1 })
  check(!(scanSide.json?.patches ?? []).some((p) => p.centroid[0] > 22), `on the scan the stud is nowhere past the wall (${scanSide.json?.patches?.length} patches)`)

  // ---- the map on the bodies, pictured: written, not shown -------------------------
  const painted = await ok('deviation_settings', { on: 'reference' })
  check(painted.json?.deviation?.on === 'reference', 'the map is painted on the bodies')
  const shown = await page.$eval('[data-test="toggle-map-on-reference"]', (e) => e.getAttribute('aria-pressed')).catch(() => null)
  check(shown === 'true', `the view bar's On reference key is pressed (${shown})`)
  const quiet = await call('view_render', { view: 'iso', path: quietPath, inline: false })
  check(!quiet.error && quiet.images.length === 0 && existsSync(quietPath) && statSync(quietPath).size > 5000, `view_render inline: false writes ${quietPath} (${existsSync(quietPath) ? statSync(quietPath).size : 0} bytes) and shows nothing`)
  const sheet = await call('view_render', { views: ['iso', 'top', 'front', 'right'], path: sheetPath })
  check(!sheet.error && sheet.images.length === 1 && sheet.json?.views?.length === 4 && sheet.json.width === 1200, `view_render views: one picture of ${sheet.json?.views?.join(', ')}, ${sheet.json?.width} × ${sheet.json?.height}`)
  await ok('deviation_settings', { on: 'scan' })

  // ---- a section's picture names its world axes ------------------------------------
  await ok('workspace_set', { workspace: 'reverse' })
  const cut = await ok('section_cut', { across: 'ZX', offset: 0, name: 'Across' })
  const pic = await ok('section_render', { section: cut.json?.section?.id, path: join(OUT_DIR, 'round7-section.png'), inline: false })
  const axes = pic.json?.axes
  check(axes?.u?.offDeg === 0 && axes?.v?.offDeg === 0 && /[XYZ]/.test(axes.u.axis) && /[XYZ]/.test(axes.v.axis), `section_render names its axes: across ${axes?.u?.axis}, up ${axes?.v?.axis}`)
} finally {
  await agent.close()
  await finish(browser, consoleErrors)
}
