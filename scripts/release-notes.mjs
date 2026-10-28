// SPDX-License-Identifier: AGPL-3.0-only
// The notes of one release: its section of CHANGELOG.md, from its
// `## x.y.z — date` heading to the next heading of that level, heading left
// out. The changelog is wrapped at 80 columns, which a GitHub release would
// show as broken lines, so the lines of each paragraph and list item are
// joined; code blocks are left as they are.
//
//   node scripts/release-notes.mjs <version> [changelog]   # version as 0.8.4 or v0.8.4
//
// Prints the notes, or exits non-zero when the changelog has no such section.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The section of `version` in `changelog`, unwrapped; null when it has none. */
export function releaseNotes(changelog, version) {
  const v = version.replace(/^v/, '')
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((l) => l === `## ${v}` || l.startsWith(`## ${v} `))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  if (end < 0) end = lines.length

  const out = []
  let fence = false
  for (const line of lines.slice(start + 1, end)) {
    if (/^\s*```/.test(line)) fence = !fence
    const prev = out.length ? out[out.length - 1] : ''
    const startsBlock = /^\s*([-*+]\s|\d+[.)]\s|#|>|\||```)/.test(line)
    if (!fence && line.trim() && prev.trim() && !startsBlock && !/^\s*```/.test(prev)) {
      out[out.length - 1] = `${prev} ${line.trim()}`
    } else {
      out.push(line)
    }
  }
  return out.join('\n').trim()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, file = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))] = process.argv.slice(2)
  if (!version) {
    console.error('usage: node scripts/release-notes.mjs <version> [changelog]')
    process.exit(2)
  }
  const notes = releaseNotes(readFileSync(file, 'utf8'), version)
  if (!notes) {
    console.error(`${file} has no section for ${version}`)
    process.exit(1)
  }
  console.log(notes)
}
