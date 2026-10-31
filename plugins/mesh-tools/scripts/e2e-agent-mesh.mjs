// SPDX-License-Identifier: AGPL-3.0-only
// The Mesh Tools workspace driven by an agent, end to end: an MCP client —
// the SDK's own, as Claude Code and the others use it — starts the
// scanruler-mcp server, the app in headless Chrome is paired with it, and a
// generated scan is cleaned up through the tools alone: a cube with a speck
// beside it opened from a file, the speck taken off, the top face marked
// (and looked at), deleted and filled again, the part cut and reduced. The
// person's side is checked too — the marking the Delete button would take,
// the edits listed under Edited copy, the undo key naming the agent's step —
// and what only the browser gives: pictures of the view, the reduced mesh
// as an STL. history_undo walks back past the cut; mesh_use_edited takes
// the copy into use.
//
// Prereqs: dev server running (npm run dev), Chrome, and the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/mesh-tools/scripts/e2e-agent-mesh.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_URL, check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile, sleep } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

/** A box from `min` to `max`, `n` squares a side on every face, two
 *  triangles each, wound outward — as triangles of nine floats. */
function cuboid(min, max, n) {
  const tris = []
  const lerp = (k, t) => min[k] + t * (max[k] - min[k])
  // Each face: the axis it is square to, which end, and its two in-plane
  // axes in the order that winds it outward.
  for (const [axis, end, u, v] of [[2, 1, 0, 1], [2, 0, 1, 0], [0, 1, 1, 2], [0, 0, 2, 1], [1, 1, 2, 0], [1, 0, 0, 2]]) {
    const at = (i, j) => {
      const p = [0, 0, 0]
      p[axis] = end ? max[axis] : min[axis]
      p[u] = lerp(u, i / n)
      p[v] = lerp(v, j / n)
      return p
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        tris.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)])
      }
  }
  return tris
}

/** Triangles as a binary STL. */
function stl(tris) {
  const out = Buffer.alloc(84 + 50 * tris.length)
  out.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => t.flat().forEach((x, k) => out.writeFloatLE(x, 84 + 50 * i + 12 + 4 * k)))
  return out
}

const scanDir = mkdtempSync(join(tmpdir(), 'scanruler-mesh-'))
const SCAN = join(scanDir, 'cube.stl')
const CUBE = 20
writeFileSync(SCAN, stl([...cuboid([-10, -10, -10], [10, 10, 10], CUBE), ...cuboid([30, 0, 0], [30.5, 0.5, 0.5], 1)]))

const { agent } = await launchAgent(startAgent)
const { call } = agent

/** A call that should succeed: its JSON, or a failure with what it said. */
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}

/** A view_render picture: its PNG's size, once it is one. */
function pictured(r) {
  const png = r.images?.[0]
  const bytes = png ? Buffer.from(png.data, 'base64') : Buffer.alloc(0)
  return png?.mimeType === 'image/png' && bytes.subarray(1, 4).toString() === 'PNG' ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : null
}

const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 300_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 60 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('mesh-tools'), `the page connected with its plugins (${waited.json?.page?.plugins})`)
  const tools = (await agent.client.listTools()).tools
  const names = tools.map((t) => t.name)
  const wanted = ['mesh_parts', 'mesh_inspect', 'mesh_mark', 'mesh_remove_islands', 'mesh_delete_marked', 'mesh_cut', 'mesh_fill_holes', 'mesh_smooth', 'mesh_offset', 'mesh_boolean', 'mesh_shell', 'mesh_reduce', 'mesh_trim', 'mesh_use_edited', 'mesh_export']
  check(wanted.every((n) => names.includes(n)), `the workspace’s tools are listed once the page is there (${names.filter((n) => n.startsWith('mesh_')).length} of them)`)
  // What a client takes: Claude Desktop turned a tool down whose schema was
  // 82 kB nested 20 deep. The budget is src/commands/schema.ts SCHEMA_BUDGET.
  const depth = (v) => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0)
  const heavy = tools.filter((t) => JSON.stringify(t.inputSchema).length > 8000 || depth(t.inputSchema) > 12).map((t) => t.name)
  check(heavy.length === 0, `every tool’s schema within 8000 bytes and 12 deep${heavy.length ? ` — not ${heavy.join(', ')}` : ''}`)

  // ---- the scan, and what is on it -------------------------------------------------
  const opened = await ok('scan_open', { path: SCAN, discard: true })
  check(opened.json?.scan?.triangles === 6 * CUBE * CUBE * 2 + 12, `scan_open: ${opened.json?.scan?.triangles} triangles`)
  await ok('workspace_set', { workspace: 'mesh' })
  const seen = await ok('mesh_inspect', { pieceSize: 2 })
  check(seen.json?.islands?.islands === 1 && seen.json.open === 0 && Math.abs(seen.json.volume - 8000 - 0.125) < 0.01, `mesh_inspect: ${seen.json?.islands?.pieces} pieces, ${seen.json?.islands?.islands} an island, closed, ${seen.json?.volume?.toFixed(3)} mm³`)

  const islands = await ok('mesh_remove_islands', { size: 2 })
  check(islands.json?.mesh?.working === 'edited copy' && islands.json.mesh.triangles === 6 * CUBE * CUBE * 2, `mesh_remove_islands: ${islands.json?.edit?.text}, ${islands.json?.mesh?.triangles} triangles left`)

  // ---- the top face, marked and looked at, deleted and filled ------------------------
  const top = { box: { min: [-11, -11, 9.5], max: [11, 11, 11] }, facing: [0, 0, 1] }
  const marked = await ok('mesh_mark', { region: top })
  check(marked.json?.marked > 300, `mesh_mark: ${marked.json?.marked} vertices of the top face marked`)
  await page.waitForFunction(() => !document.querySelector('[data-test="delete-marked"]')?.disabled, { timeout: 10_000 }).catch(() => {})
  const deletable = await page.$eval('[data-test="delete-marked"]', (b) => !b.disabled).catch(() => false)
  check(deletable, 'the person sees it: Delete marked in hand, its button ready to take the marking')
  const look = await ok('view_render', { view: 'iso', fit: true, width: 640, height: 480, path: join(OUT_DIR, 'e2e-agent-mesh-marked.png') })
  check(pictured(look)?.join(' × ') === '640 × 480', `view_render: the marking in a picture, ${pictured(look)?.join(' × ')}`)

  const deleted = await ok('mesh_delete_marked', { region: 'marked' })
  check(deleted.json?.edit?.kind === 'delete' && deleted.json.mesh.open > 0, `mesh_delete_marked: ${deleted.json?.edit?.text} — ${deleted.json?.report?.triangles} triangles, ${deleted.json?.mesh?.open} open edges`)
  const filled = await ok('mesh_fill_holes', { size: 30, patch: 'flat' })
  check(filled.json?.mesh?.open === 0 && Math.abs(filled.json.mesh.volume - 8000) < 1, `mesh_fill_holes: closed again, ${filled.json?.mesh?.volume?.toFixed(2)} mm³`)

  const cut = await ok('mesh_cut', { plane: 'XY', offset: 5, keep: 'minus' })
  check(Math.abs(cut.json?.mesh?.bounds?.max?.[2] - 5) < 1e-3 && cut.json.mesh.open === 0, `mesh_cut: ${cut.json?.edit?.text}, the top at Z ${cut.json?.mesh?.bounds?.max?.[2]}`)

  // What the person sees.
  await page.waitForFunction(() => document.querySelectorAll('[data-test="pending-edit"]').length === 4, { timeout: 10_000 }).catch(() => {})
  const listed = await page.$$eval('[data-test="pending-edit"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
  check(listed.length === 4 && /island/.test(listed[0]) && /Cut at XY plane, Z 5 mm/.test(listed[3]), `the edits under Edited copy: ${JSON.stringify(listed)}`)
  await sleep(200)
  const undoTitle = await page.$eval('[data-test="undo"]', (e) => e.title)
  check(undoTitle.startsWith('Undo: Agent: cut at XY plane, Z 5 mm'), `the undo key names the agent’s step: "${undoTitle}"`)

  // ---- beside it: the reduced mesh -------------------------------------------------------
  const reduced = await ok('mesh_reduce', { tolerance: 0.05, maxTriangles: 2000 })
  check(reduced.json?.reduced?.held === true && reduced.json.reduced.triangles < cut.json.mesh.triangles, `mesh_reduce: ${reduced.json?.reduced?.triangles} triangles from ${reduced.json?.reduced?.fromTriangles}, held`)
  const file = await ok('mesh_export', { part: 'reduced', path: OUT_DIR })
  const written = file.json?.file?.path
  check(Boolean(written) && existsSync(written) && statSync(written).size === 84 + 50 * reduced.json.reduced.triangles && readFileSync(written).readUInt32LE(80) === reduced.json.reduced.triangles, `mesh_export reduced wrote ${written} (${file.json?.file?.size} bytes)`)
  const picture = await ok('view_render', { view: 'iso', fit: true, width: 800, height: 600, path: OUT_DIR })
  check(pictured(picture)?.join(' × ') === '800 × 600' && existsSync(picture.json?.file?.path ?? ''), `view_render: the reduced mesh, ${pictured(picture)?.join(' × ')}`)

  // ---- back past the cut, and into use --------------------------------------------------
  const undone = await ok('history_undo')
  check(undone.json?.undone === 'Agent: reduce the mesh', `history_undo: ${undone.json?.undone}`)
  const undone2 = await ok('history_undo')
  check(undone2.json?.undone === 'Agent: cut at XY plane, Z 5 mm', `history_undo: ${undone2.json?.undone}`)
  const before = await ok('mesh_inspect')
  check(Math.abs(before.json?.bounds?.max?.[2] - 10) < 1e-3 && before.json.triangles === filled.json.mesh.triangles, `the copy is back as it was before the cut — the top at Z ${before.json?.bounds?.max?.[2]}`)

  const refused = await call('mesh_boolean', { op: 'subtract', solids: ['Nothing'] })
  check(refused.error && refused.text.startsWith('not_found:'), `a solid that is not on offer is refused: ${refused.text.slice(0, 80)}`)

  const used = await ok('mesh_use_edited')
  check(used.json?.scan?.triangles === filled.json.mesh.triangles && used.json.scan.edits.length === 3, `mesh_use_edited: the scan in use is the copy, ${used.json?.scan?.triangles} triangles, ${used.json?.scan?.edits?.length} edits`)
  const state = await ok('session_state')
  check(state.json?.plugins?.mesh?.copy === null && state.json.plugins.mesh.scan.edits.length === 3 && state.json.busy === null, 'session_state: no copy, three edits in use, nothing busy')

  await page.screenshot({ path: join(OUT_DIR, 'e2e-agent-mesh.png') })
} catch (e) {
  fail(`unexpected: ${e?.stack ?? e}`)
}
await finish(browser, consoleErrors)
await agent.close()
