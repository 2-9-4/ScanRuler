// SPDX-License-Identifier: AGPL-3.0-only
// The page's commands as MCP tools. A command's name becomes the tool's,
// dots to underscores — element.fit is element_fit — and its JSON Schema
// passes through, but for files: a command that takes a file's bytes takes a
// path on this computer instead, and this server reads the file and streams
// it to the page; a command that hands a file back takes an optional path,
// and this server writes the file there. The agent never sees the bytes —
// but for a picture (a command marked returnsImage), which it is shown as an
// image, and which is written to a file only when it gives a path — or, in
// a batch, where it cannot be shown, always.

import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export const toolName = (command) => command.name.replace(/\./g, '_')

/** The input property that carries a file's bytes, if the command has one. */
export function bytesProperty(command) {
  const props = command.input?.properties ?? {}
  return Object.keys(props).find((key) => props[key]?.type === 'string' && props[key]?.format === 'binary') ?? null
}

const inPath = {
  type: 'string',
  minLength: 1,
  description: 'The file to read, on this computer: an absolute path, or one relative to the folder the agent works in.',
}

const outPath = (outDir) => ({
  type: 'string',
  minLength: 1,
  description: `Where to write the file: a file path, or a folder to write it into under the name ScanRuler gives it. Without it, it goes into ${outDir}.`,
})

const imagePath = (outDir) => ({
  type: 'string',
  minLength: 1,
  description: `Also write the picture to a file: a file path, or a folder to write it into under the name ScanRuler gives it. Without it, it is only shown — but in scanruler_batch, which shows no picture, it is written into ${outDir} under a new name.`,
})

const inlineIn = {
  type: 'boolean',
  description: 'false, with path: the picture is written to the file and not shown — the answer says where. A picture costs far more context than its text; save the ones you only deliver.',
}

/** How many significant digits a number keeps in an answer, and the finest
 *  step it is given to: six digits is a micrometre on a part under a metre
 *  and a millionth of a unit vector; past them the page's doubles are
 *  noise the agent pays for — 0.9483828176573491 in place of 0.948383. */
const DIGITS = 6
const STEP = 1e6

const tidy = (v) => {
  const r = Number(v.toPrecision(DIGITS))
  return Math.abs(r) < 9e9 ? Math.round(r * STEP) / STEP || 0 : r
}

/** An answer as the agent reads it: JSON, every number that is not whole
 *  kept to DIGITS significant digits and no finer than a millionth — 1e-17,
 *  a zero's rounding error, is 0. Whole numbers — ids, indices, counts —
 *  are as they were. An `exact` answer is one whose numbers are handed
 *  back as inputs — a plane's frame, say — and keeps every digit:
 *  shortened, what is built on them is a hair off what it was meant to
 *  meet. */
export const agentJson = (value, exact = false) =>
  exact ? JSON.stringify(value) : JSON.stringify(value, (_key, v) => (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? tidy(v) : v))

/** A command as the MCP tool an agent sees. */
/** The `wait` a tool that changes the session takes: the server runs every
 *  such call as a job (mcp.js), and false answers with the job at once. */
export const waitIn = {
  type: 'boolean',
  description: 'false: answer at once with { queued: true, job } while the change runs on; scanruler_wait { for: "job", job } gives its answer. true (the default): answer once it is done.',
}

/** The `timings` a tool that changes the session takes: the server keeps
 *  what the page's answer carries of the build's steps (mcp.js). */
export const timingsIn = {
  type: 'boolean',
  description: 'true: the answer adds ms (the call, start to answer) and, where the change built, steps.played — each step the build played with its ms (steps.restored counts those taken up from a kept state, not played).',
}

export function toolFor(command, { outDir }) {
  const input = structuredClone(command.input ?? { type: 'object' })
  input.properties = { ...(input.properties ?? {}) }
  let required = [...(input.required ?? [])]
  const bytesKey = bytesProperty(command)
  let description = command.description
  if (bytesKey) {
    delete input.properties[bytesKey]
    input.properties.path = inPath
    required = required.filter((key) => key !== bytesKey && key !== 'name')
    if (!required.includes('path')) required.unshift('path')
    if (input.properties.name) {
      input.properties.name = { ...input.properties.name, description: `${input.properties.name.description ?? ''} Defaults to the file's own name.`.trim() }
    }
    description += ' The file is read from `path` on this computer and streamed to the page.'
  }
  if (command.returnsImage) {
    input.properties.path = imagePath(outDir)
    input.properties.inline = inlineIn
    description += ' The picture comes back as an image; with `path` it is written to a file too, and with `inline: false` only there.'
  } else if (command.returnsFile) {
    input.properties.path = outPath(outDir)
    description += ' The file is written to `path`; the result says where and how large it is, not its bytes.'
  }
  if (!command.readOnly) {
    input.properties.wait = waitIn
    input.properties.timings = timingsIn
  }
  if (required.length) input.required = required
  else delete input.required
  return {
    name: toolName(command),
    title: command.title,
    description,
    inputSchema: input,
    annotations: { title: command.title, readOnlyHint: Boolean(command.readOnly) && (!command.returnsFile || Boolean(command.returnsImage)), openWorldHint: false },
  }
}

/** A path as the agent gave it, made absolute against `base`. */
export const absolute = (path, base) => (isAbsolute(path) ? path : resolve(base, path))

/** The tool call's arguments as the command's input: a path read into the
 *  bytes it names. Returns the input and the input field the bytes go in. */
export async function inputFor(command, args, { cwd }) {
  const input = { ...(args ?? {}) }
  const bytesKey = bytesProperty(command)
  if (bytesKey) {
    const file = absolute(String(input.path ?? ''), cwd)
    delete input.path
    let bytes
    try {
      bytes = new Uint8Array(await readFile(file))
    } catch (e) {
      throw { code: 'invalid_input', message: `Could not read ${file}: ${e.code === 'ENOENT' ? 'there is no such file' : e.message}.` }
    }
    input[bytesKey] = bytes
    if (command.input?.properties?.name && input.name === undefined) input.name = basename(file)
    return { input, binaryKey: bytesKey }
  }
  if (command.returnsFile || command.returnsImage) delete input.path
  if (command.returnsImage) delete input.inline
  return { input, binaryKey: null }
}

/** A picture a command handed back, as MCP content: the image, and the rest
 *  of the result as text — where the picture was written, if the call gave
 *  a path, in place of its bytes; written and not shown with `inline:
 *  false`. Null for a result with no picture in it. */
export async function imageContent(result, args, { cwd, outDir }) {
  const file = result?.file
  if (!file || !(file.bytes instanceof Uint8Array) || !String(file.mimeType ?? '').startsWith('image/')) return null
  const saved = args?.path ? await saveFileResult(result, args, { cwd, outDir }) : { ...result, file: { name: file.name, mimeType: file.mimeType, size: file.bytes.byteLength } }
  if (args?.path && args?.inline === false) return [{ type: 'text', text: agentJson(saved) }]
  return [
    { type: 'text', text: agentJson(saved) },
    { type: 'image', data: Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength).toString('base64'), mimeType: file.mimeType },
  ]
}

/** A picture a batched call handed back, which a batch cannot show:
 *  written where the call asked, or into `outDir` under the name ScanRuler
 *  gave it — numbered past one already there, so a batch of renders, or a
 *  render from an earlier batch, is not written over. The result says
 *  where, in place of the bytes. A result with no picture in it is as
 *  saveFileResult leaves it. */
export async function batchedPicture(result, args, { cwd, outDir }) {
  const file = result?.file
  if (args?.path || !file || !(file.bytes instanceof Uint8Array)) return saveFileResult(result, args, { cwd, outDir })
  const name = String(file.name ?? 'picture.png')
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let target = join(outDir, name)
  for (let n = 2; await stat(target).catch(() => null); n++) target = join(outDir, `${stem}-${n}${ext}`)
  return saveFileResult(result, { path: target }, { cwd, outDir })
}

/** Write a returned file where the call asked, or into `outDir`; the result
 *  then says where, in place of the bytes. */
export async function saveFileResult(result, args, { cwd, outDir }) {
  const file = result?.file
  if (!file || !(file.bytes instanceof Uint8Array)) return result
  let target = args?.path ? absolute(String(args.path), cwd) : join(outDir, file.name)
  const existing = await stat(target).catch(() => null)
  if (existing?.isDirectory()) target = join(target, file.name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, file.bytes)
  return { ...result, file: { name: file.name, mimeType: file.mimeType, size: file.bytes.byteLength, path: target } }
}
