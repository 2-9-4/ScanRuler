// SPDX-License-Identifier: AGPL-3.0-only
// The pictures in the README, taken again: the app driven through the agent
// commands (the scanruler-mcp server, as an agent drives it) and each
// workspace photographed with its panel, into docs/images/. Runs the build
// without plugins, as the open-source edition has it. Each picture gets a
// session of its own — a fresh server, browser and page; `session` is
// exported for a plugin's pictures to be taken the same way.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci), the local scan pair at the repository
// root (block-marius.stl and "side bracket left.stl"), and two saved
// projects: a ball bar measured (MEASURE_PROJECT) and a part to measure the
// wall thickness of (THICKNESS_PROJECT), by default in ~/Downloads.
//   APP_URL=http://localhost:5173/ node scripts/readme-shots.mjs
// Env: APP_URL, CHROME, MEASURE_PROJECT, THICKNESS_PROJECT, ONLY (one
// picture by name: measure, deviation, thickness, section, shadow).
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchAgent, launchApp, repoFile, requireFixture, sleep } from './e2e-lib.mjs'

export const SCAN = repoFile('block-marius.stl')
const NOMINAL = repoFile('side bracket left.stl')
const MEASURE_PROJECT = process.env.MEASURE_PROJECT ?? join(homedir(), 'Downloads', 'para-std-03.scanruler')
const THICKNESS_PROJECT = process.env.THICKNESS_PROJECT ?? join(homedir(), 'Downloads', 'prusa_hood (1).scanruler')
const OUT = repoFile('docs/images')

/** A server, a browser paired with it, and the helpers a picture is taken
 *  with; `shot` runs on them, the window is written to docs/images/<name>.png
 *  and everything is closed after. `plugins: false` runs the app as the
 *  open-source edition has it. */
export async function session(name, shot, { plugins = false, idleSeconds = 300 } = {}) {
  if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
    console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })
  const { startAgent } = await import('../mcp/tests/client.js')
  const { agent } = await launchAgent(startAgent)
  const call = async (tool, args = {}) => {
    const r = await agent.call(tool, args)
    if (r.error) throw new Error(`${tool}: ${r.text}`)
    return r.json
  }
  const link = /(\S+#agent=\d+:[\w-]+)/.exec((await agent.call('scanruler_status')).json?.howToConnect ?? '')?.[1]
  const { browser, page } = await launchApp({ url: plugins ? link : link.replace('#', '?plugins=none#'), width: 1440, height: 860 })
  try {
    // The thank-you card and the hint ring stay out of the pictures.
    await page.evaluate(() => {
      localStorage.setItem('scanruler.supportcard', '0')
      localStorage.setItem('scanruler.hints', JSON.stringify({ on: false, runs: {} }))
    })
    await page.reload({ waitUntil: 'networkidle0' })
    await call('scanruler_wait', { for: 'page', timeoutSeconds: 60 })
    const idle = () => call('scanruler_wait', { for: 'idle', timeoutSeconds: idleSeconds })
    await shot({ agent, call, idle, page })
    await idle()
    await page.mouse.move(1, 1)
    await sleep(600)
    await page.screenshot({ path: `${OUT}/${name}.png` })
    console.log(`wrote docs/images/${name}.png`)
  } finally {
    await browser.close()
    await agent.close()
  }
}

/** The scan opened and levelled by Auto-align, and its planar regions. */
async function alignedScan({ call, idle }) {
  await call('workspace_set', { workspace: 'measure' })
  await call('scan_open', { path: SCAN, units: 'mm', discard: true })
  await idle()
  await call('align_auto', {})
  const { regions } = await call('scan_segment', { limit: 8 })
  // The region whose outward normal is n, near enough.
  return (n) => regions.find((r) => r.normal.every((v, k) => Math.abs(v - n[k]) < 0.15))
}

const SHOTS = {
  // The ball bar project, its spheres refitted and the distance measured
  // again on load.
  measure: async ({ call, idle }) => {
    await call('project_load', { path: MEASURE_PROJECT, discard: true })
    await idle()
    await call('workspace_set', { workspace: 'measure' })
    await call('view_set', { view: 'iso', fit: true })
  },

  deviation: async ({ call, idle, page }) => {
    await call('workspace_set', { workspace: 'deviation' })
    await call('scan_open', { path: SCAN, units: 'mm', discard: true })
    await call('deviation_open_reference', { path: NOMINAL, units: 'mm' })
    await idle()
    await call('deviation_align', { mode: 'auto' })
    await idle()
    await call('deviation_measure')
    await idle()
    // A speck of the scan's far off the part leaves it small in the fitted
    // frame: zoomed in on it as a person would, with the wheel.
    await call('view_set', { view: 'iso', fit: true })
    await page.mouse.move(870, 430)
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel({ deltaY: -100 })
      await sleep(150)
    }
  },

  // The project's part, its wall thickness measured again on load.
  thickness: async ({ call, idle }) => {
    await call('project_load', { path: THICKNESS_PROJECT, discard: true })
    await idle()
    await call('workspace_set', { workspace: 'thickness' })
    await call('view_set', { view: 'iso', fit: true })
  },

  // A cut 4 mm under the scan's sloped face, on the 2D sheet: three sides
  // fitted from the edge points along them, the round holes from their
  // chains, and dimensions between them.
  section: async (s) => {
    const { agent, call, idle } = s
    const region = await alignedScan(s)
    const slope = (await call('element_fit', { kind: 'plane', at: { point: region([0.71, 0, 0.7]).point } })).element
    await call('section_cut', { across: slope.name, offset: -4 })
    await call('workspace_set', { workspace: 'flat' })
    await idle()
    const edges = await call('flat_edges', { limit: 50 })
    const [x0, y0] = edges.items[0].box.min
    const [x1, y1] = edges.items[0].box.max
    const fit = async (args) => {
      const r = await agent.call('flat_fit', args)
      if (r.error) console.log(`flat_fit ${JSON.stringify(args)}: ${r.text.slice(0, 200)}`)
      return r.error ? null : r.json.element
    }
    // Each side by the edge points in a band along it, its ends left out.
    const band = (min, max) => fit({ kind: 'line', box: { min, max } })
    const left = await band([x0 - 2, y0 + 15], [x0 + 2, y1 - 15])
    const right = await band([x1 - 2, y0 + 25], [x1 + 2, y1 - 15])
    const top = await band([x0 + 15, y1 - 2], [x1 - 15, y1 + 2])
    // The round holes: chains about as wide as high (a slot is not).
    const round = []
    for (const c of edges.items.slice(1)) {
      const [w, h] = [0, 1].map((k) => c.box.max[k] - c.box.min[k])
      if (Math.max(w, h) / Math.min(w, h) > 1.5) continue
      const el = await fit({ kind: 'circle', chains: [c.id] })
      if (el) round.push(el)
    }
    const dim = (a, b) => a && b && agent.call('flat_dimension_add', { refs: [a.name, b.name] })
    await dim(left, right)
    await dim(round[0], left)
    await dim(round[1], top)
  },

  // The CAD part's shadow straight down, stood up through it as a block.
  shadow: async ({ call, idle }) => {
    await call('workspace_set', { workspace: 'measure' })
    await call('scan_open', { path: NOMINAL, units: 'mm', discard: true })
    await idle()
    await call('section_cut', { across: 'XY', kind: 'shadow' })
    await call('view_set', { view: 'iso', fit: true })
  },
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const f of [SCAN, NOMINAL, MEASURE_PROJECT, THICKNESS_PROJECT]) requireFixture(f)
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (!process.env.ONLY || process.env.ONLY === name) await session(name, shot)
  }
}
