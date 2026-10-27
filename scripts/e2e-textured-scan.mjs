// SPDX-License-Identifier: AGPL-3.0-only
// A textured scan end to end: the OBJ, its material library and its image
// picked together open as one scan that wears the image's colours; the
// Colours key on the scan's menu puts them away and back; saved as a
// project it comes back in colour; the OBJ alone opens plain and says which
// files it still wants. The fixture is made
// here: a plate whose texture is red on one half and blue on the other.
//
// TEXTURED_DIR=<folder with an OBJ, MTL and image> repeats the load with a
// real scan; STEP_FIXTURE=<file.step> opens a STEP file as the scan.
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { awaitDownload, canvasRect, check, click, downloadsTo, fail, finish, launchApp, shotPath, sleep, viewOption } from './e2e-lib.mjs'

// ---- the fixture -------------------------------------------------------------
const N = 40
const SIZE = 80

function plateObj() {
  const lines = ['# textured plate', 'mtllib plate.mtl']
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) lines.push(`v ${(SIZE * i) / N} ${(SIZE * j) / N} 0`)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) lines.push(`vt ${i / N} ${j / N}`)
  lines.push('usemtl plate')
  const at = (i, j) => j * (N + 1) + i + 1
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
      lines.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`, `f ${a}/${a} ${c}/${c} ${d}/${d}`)
    }
  }
  return lines.join('\n') + '\n'
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
/** A w×h RGB PNG: red on the left half, blue on the right. */
function halvesPng(w = 64, h = 64) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = x < w / 2 ? 230 : 20
      raw[o + 1] = 30
      raw[o + 2] = x < w / 2 ? 20 : 230
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const dir = mkdtempSync(join(tmpdir(), 'scanruler-textured-'))
const obj = join(dir, 'plate.obj')
const mtl = join(dir, 'plate.mtl')
const png = join(dir, 'plate_tex.png')
writeFileSync(obj, plateObj())
writeFileSync(mtl, 'newmtl plate\nKd 1 1 1\nmap_Kd plate_tex.png\n')
writeFileSync(png, halvesPng())

// ---- drive the app -------------------------------------------------------------
const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 600_000 })
const status = () => page.$eval('.strip .msg', (el) => el.textContent ?? '')
const scanInput = async () => (await page.$('[data-test="slot-scan"] input[type=file]')) ?? page.$('[data-test="start-scan"] input[type=file]')

/** Open the scan from `paths` picked together, and wait for it to be in. */
async function open(paths, { timeout = 300_000 } = {}) {
  // Done when the status line has said something new and nothing loads.
  const before = await status()
  const input = await scanInput()
  if (!input) fail('No file input for the scan')
  await input.uploadFile(...paths)
  await page.waitForFunction(
    (was) => {
      const strip = document.querySelector('.strip')
      const now = strip?.querySelector('.msg')?.textContent ?? ''
      return now !== was && /[1-9][\d,]* triangles/.test(document.querySelector('.file-info')?.textContent ?? '') && !/LOADING/.test(strip?.textContent ?? '')
    },
    { timeout },
    before,
  )
  await sleep(800)
}

/** How red and how blue the middle of the stage is: [red pixels, blue pixels]
 *  in a band across the part. */
async function hues() {
  const rect = await canvasRect(page)
  const clip = { x: rect.x + rect.w * 0.3, y: rect.y + rect.h * 0.45, width: rect.w * 0.4, height: rect.h * 0.1 }
  const shot = await page.screenshot({ clip, encoding: 'base64' })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let red = 0, blue = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > d[i + 2] + 60 && d[i] > d[i + 1] + 60) red++
      if (d[i + 2] > d[i] + 60 && d[i + 2] > d[i + 1] + 40) blue++
    }
    return [red, blue]
  }, shot)
}

// The OBJ, its library and its image together.
await open([obj, mtl, png])
check(/Coloured from plate_tex\.png/.test(await status()), `status names the texture: "${await status()}"`)
await page.screenshot({ path: shotPath('textured-plate.png') })
const [red, blue] = await hues()
check(red > 500 && blue > 500, `the plate wears both halves of its texture (red ${red}, blue ${blue} px)`)

// The Colours key puts them away and back.
await viewOption(page, 'toggle-scan', 'toggle-scan-colours')
await sleep(500)
const [redOff, blueOff] = await hues()
check(redOff < 50 && blueOff < 50, `with Colours off the plate is plain (red ${redOff}, blue ${blueOff} px)`)
await viewOption(page, 'toggle-scan', 'toggle-scan-colours')
await sleep(500)
const [redOn] = await hues()
check(redOn > 500, `and back on it wears them again (red ${redOn} px)`)

// Saved as a project — reopened further down, over a plain scan.
const downloads = mkdtempSync(join(tmpdir(), 'scanruler-textured-dl-'))
await downloadsTo(page, downloads)
await click(page, '[data-test="save-project"]')
const project = await awaitDownload(downloads, '.scanruler')
check(Boolean(project), `the textured scan saves as a project: ${project}`)

// The OBJ alone: plain, and the status says what it still wants.
await open([obj])
const alone = await status()
check(/plate\.mtl/.test(alone) && /together/.test(alone), `the OBJ alone asks for its texture: "${alone}"`)
const [redAlone] = await hues()
check(redAlone < 50, `and is drawn plain (red ${redAlone} px)`)
check(!(await page.$('[data-test="toggle-scan-colours"]')), 'with no Colours key on its menu')

if (project) {
  await (await page.$('[data-test="project-input"]')).uploadFile(join(downloads, project))
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 120_000 })
  await sleep(800)
  const [redBack, blueBack] = await hues()
  check(redBack > 500 && blueBack > 500, `the project reopens in colour (red ${redBack}, blue ${blueBack} px)`)
}

if (process.env.TEXTURED_DIR) {
  const real = process.env.TEXTURED_DIR
  const files = readdirSync(real).filter((f) => /\.(obj|mtl|png|jpe?g)$/i.test(f)).map((f) => join(real, f))
  const t0 = Date.now()
  await open(files, { timeout: 600_000 })
  console.log(`real scan loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${await status()}`)
  check(/Coloured from/.test(await status()), 'the real scan wears its texture')
  await page.screenshot({ path: shotPath('textured-real.png') })
}

if (process.env.STEP_FIXTURE) {
  await open([process.env.STEP_FIXTURE])
  const said = await status()
  check(/Cut from STEP/.test(said), `a STEP file opens as the scan: "${said}"`)
  await page.screenshot({ path: shotPath('step-as-scan.png') })
}

await finish(browser, consoleErrors)
