// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end: a file named in the address is opened as if dropped. A small
// server here hands out ballbar.stl with CORS headers, the way a file store
// would; the app is opened at ?open=<that url> and has to show the scan's
// triangles without a click. Then a link to a file that is not there, which
// has to end in the status strip's error, not in a hung LOADING. A link
// naming a workspace lands there with the file open. With the
// dev server built for a file store at this script's server — FILES_PORT
// fixed, and VITE_FILES_URL=http://127.0.0.1:<FILES_PORT>/ on the dev
// server — the short form /s/<name> is tried too.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node scripts/e2e-open-link.mjs
//   FILES_PORT=8766 node scripts/e2e-open-link.mjs   # dev server started with VITE_FILES_URL=http://127.0.0.1:8766/
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { APP_URL, check, finish, freePort, launchApp, repoFile, requireFixture } from './e2e-lib.mjs'

const STL = process.env.STL ?? repoFile('ballbar.stl')
requireFixture(STL)
const bytes = readFileSync(STL)

const port = process.env.FILES_PORT ? Number(process.env.FILES_PORT) : await freePort()
const server = createServer((req, res) => {
  const headers = { 'Access-Control-Allow-Origin': '*' }
  if (req.url === '/ballbar.stl') {
    res.writeHead(200, { ...headers, 'Content-Type': 'model/stl', 'Content-Length': bytes.length })
    res.end(bytes)
  } else {
    res.writeHead(404, headers)
    res.end('no such file')
  }
})
await new Promise((r) => server.listen(port, '127.0.0.1', r))
const fileUrl = (name) => `http://127.0.0.1:${port}/${name}`

const { browser, page, consoleErrors } = await launchApp({ url: `${APP_URL}?open=${encodeURIComponent(fileUrl('ballbar.stl'))}` })
try {
  await page.waitForFunction(
    () => /[1-9][\d,]* triangles/.test(document.querySelector('.file-info')?.textContent ?? ''),
    { timeout: 120_000 },
  )
  const info = await page.$eval('.file-info', (el) => el.textContent.replace(/\s+/g, ' ').trim())
  console.log('opened:', info)
  check(info.includes('ballbar.stl'), 'the scan from the link is open under its own name')

  // Leaving a session with a scan in it asks first; the answer here is yes.
  page.on('dialog', (d) => void d.accept())
  await page.goto(`${APP_URL}?open=${encodeURIComponent(fileUrl('missing.stl'))}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('.status-strip .warn, .warn')?.textContent?.includes('missing.stl'), { timeout: 20_000 })
  const warn = await page.$eval('.warn', (el) => el.textContent.trim())
  console.log('error:', warn)
  check(/404/.test(warn), 'a missing file is reported with the status')
  const state = await page.evaluate(() => document.body.textContent.includes('LOADING'))
  check(!state, 'the strip is not left loading')

  await page.goto(`${APP_URL}?open=${encodeURIComponent(fileUrl('ballbar.stl'))}&workspace=deviation`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => /[1-9][\d,]* triangles/.test(document.querySelector('.file-info')?.textContent ?? ''),
    { timeout: 120_000 },
  )
  await page.waitForFunction(() => document.querySelector('[data-test="workspace-deviation"]')?.getAttribute('aria-selected') === 'true', { timeout: 10_000 })
  check(true, 'workspace=deviation lands in the deviation workspace with the file open')

  await page.goto(`${APP_URL}?workspace=nowhere`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('.warn')?.textContent?.includes('nowhere'), { timeout: 10_000 })
  check(true, 'an unknown workspace name is reported')

  if (process.env.FILES_PORT) {
    await page.goto(`${APP_URL}s/ballbar.stl`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(
      () => /[1-9][\d,]* triangles/.test(document.querySelector('.file-info')?.textContent ?? ''),
      { timeout: 120_000 },
    )
    check(true, 'the short form /s/<name> opens the file from the store')
  }
} catch (e) {
  check(false, `open-link: ${e.message}`)
} finally {
  server.close()
  // The browser logs the 404 the second case asks for; that one is no error.
  await finish(browser, consoleErrors.filter((e) => !/status of 404/.test(e)))
}
