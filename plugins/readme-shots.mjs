// SPDX-License-Identifier: AGPL-3.0-only
// The README's pictures of the Reverse engineer and Mesh Tools workspaces,
// taken the way scripts/readme-shots.mjs takes the others — with the plugins on.
//
// Prereqs: as scripts/readme-shots.mjs, and a modelled project
// (RE_PROJECT, by default the Joy-Con's on the Desktop).
//   APP_URL=http://localhost:5173/ node plugins/readme-shots.mjs
// Env: APP_URL, CHROME, RE_PROJECT, ONLY (reverse-engineer or mesh).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { requireFixture } from '../scripts/e2e-lib.mjs'
import { SCAN, session } from '../scripts/readme-shots.mjs'

const RE_PROJECT = process.env.RE_PROJECT ?? join(homedir(), 'Desktop', 'reverseengineer', '14_joycon', '14_joycon_CAD.scanruler')
for (const f of [SCAN, RE_PROJECT]) requireFixture(f)

const SHOTS = {
  // The project's bodies built again on load, over the scan; its notes to
  // and from the agent put away.
  'reverse-engineer': async ({ call, idle }) => {
    await call('project_load', { path: RE_PROJECT, discard: true })
    await idle()
    await call('workspace_set', { workspace: 'reverse' })
    await idle()
    await call('view_set', { view: 'iso', fit: true, show: { notes: false } })
  },

  // The bracket scan, levelled, with the holes the scanner left filled —
  // the edited copy painted with how far it lies off the scan, so the
  // patches are what shows.
  mesh: async ({ call, idle, page }) => {
    await call('workspace_set', { workspace: 'mesh' })
    await call('scan_open', { path: SCAN, units: 'mm', discard: true })
    await idle()
    await call('align_auto', {})
    await call('mesh_fill_holes', {})
    await idle()
    await page.click('[data-test="toggle-copy-deviation"]')
    await idle()
    await call('view_set', { view: 'iso', fit: true })
  },
}

for (const [name, shot] of Object.entries(SHOTS)) {
  if (!process.env.ONLY || process.env.ONLY === name) await session(name, shot, { plugins: true, idleSeconds: 900 })
}
