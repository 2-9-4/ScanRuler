// SPDX-License-Identifier: AGPL-3.0-only
// guide.read: the guides (../guides.ts) as an agent reads them — the index,
// one guide or several whole (as many as one answer carries, the rest named
// to read next), or one section of one. The description lists
// the guides there are, so an agent that sees the tool sees what to read for
// its task; it is read when the tools are listed, after the plugins have
// registered theirs.

import { guideById, listGuides, markGuideRead, type Guide } from '../guides'
import { arr, obj, oneOf, str } from '../schema'
import { CommandError, type Command } from '../types'

/** About what a text costs an agent: four characters a token. */
const tokens = (text: string) => Math.max(10, Math.round(text.length / 40) * 10)

/** The most characters, as JSON, of guides one read answers whole when
 *  several are asked for: those that fit, in order — the first always —
 *  and the rest named in `next`, to read in the next call. An agent's
 *  client takes some 100 k characters of an answer (the server's cap for a
 *  guide is 90 k); a read past that is written to a file, which an agent
 *  starting a task may not open. */
export const GUIDES_READ_MOST = 80_000

interface Section {
  heading: string
  level: number
  text: string
}

/** A guide's text as served: the licence comment before it left out. */
const served = (text: string) =>
  text
    .split('\r\n')
    .join('\n')
    .replace(/^(\s*<!--[\s\S]*?-->\s*)+/, '')
    .trim()

/** Its `##` and `###` sections, each running to the next heading of its
 *  level or above. */
function sections(text: string): Section[] {
  const lines = text.split('\n')
  const heads = lines.flatMap((line, i) => {
    const m = /^(#{2,3}) (.+)$/.exec(line)
    return m ? [{ i, level: m[1].length, heading: m[2].trim() }] : []
  })
  return heads.map((h, k) => {
    const end = heads.slice(k + 1).find((n) => n.level <= h.level)?.i ?? lines.length
    return { heading: h.heading, level: h.level, text: lines.slice(h.i, end).join('\n').trim() }
  })
}

const loaded = new Map<string, Promise<string>>()
const textOf = (g: Guide) => {
  let t = loaded.get(g.id)
  if (!t) {
    t = g.text().then(served)
    loaded.set(g.id, t)
    t.catch(() => loaded.delete(g.id))
  }
  return t
}

const known = () => listGuides().map((g) => g.id).join(', ')

function guideNamed(id: string): Guide {
  const g = guideById(id)
  if (!g) throw new CommandError('not_found', `There is no guide "${id}" — the guides are ${known()}.`)
  return g
}

/** The section a name means: the heading itself, or the one heading it is
 *  part of, either without its number ("Datums" for "2. Datums"). */
function sectionNamed(g: Guide, all: Section[], name: string): Section {
  const bare = (s: string) => s.toLowerCase().replace(/^[0-9]+[a-z]?\.\s*/, '').trim()
  const want = bare(name)
  const exact = all.filter((s) => bare(s.heading) === want || s.heading.toLowerCase() === name.toLowerCase())
  if (exact.length === 1) return exact[0]
  const part = exact.length ? exact : all.filter((s) => bare(s.heading).includes(want))
  if (part.length === 1) return part[0]
  const list = (part.length ? part : all).map((s) => `"${s.heading}"`).join(', ')
  throw new CommandError(part.length ? 'invalid_input' : 'not_found', `${part.length ? `"${name}" is more than one section` : `The guide "${g.id}" has no section "${name}"`} — ${part.length ? 'which of' : 'its sections are'} ${list}?`)
}

function describe(): string {
  const index = listGuides()
    .map((g) => `${g.id} — ${g.when}${g.with?.length ? ` (read with ${g.with.join(' and ')}, first)` : ''}`)
    .join('; ')
  return [
    'How to do a task with ScanRuler: the workflow, the judgement and the traps the tools’ own descriptions do not carry, written for this build — read the guide for your task, whole, before its first step, and a section again when you need it.',
    index ? `The guides: ${index}.` : 'This build has no guides.',
    `topic: a guide, or several read in order (a guide and the ones it is read with, in one call) — as many as fit in about ${Math.round(GUIDES_READ_MOST / 1000)} k characters, the rest named in next, to read in the next call.`,
    'section: one section of one guide, by its heading — the index lists them. A long section with ### parts under it — a reference’s list of command shapes — is best read by those parts: section takes a ### heading too, the one part you need. With no topic, the index: each guide with its sections and what each costs in tokens. Changes nothing.',
  ].join(' ')
}

const read: Command<{ topic?: string | string[]; section?: string }> = {
  name: 'read',
  title: 'Read a guide',
  get description() {
    return describe()
  },
  input: obj({
    topic: oneOf([str(), arr(str(), undefined, { minItems: 1, maxItems: 8 })], 'A guide by its id, or several to read in order — as many as fit in one answer, the rest named in next. Leave it out for the index.'),
    section: str('One section of the guide, by its heading — a ## section or a ### part of one (without its number, or a part of it that names one section). Only with one topic.', { minLength: 1 }),
  }),
  readOnly: true,
  headless: true,
  run: async ({ topic, section }) => {
    if (topic === undefined) {
      if (section !== undefined) throw new CommandError('invalid_input', 'section needs the topic it is in.')
      const guides = await Promise.all(
        listGuides().map(async (g) => {
          const text = await textOf(g)
          return {
            topic: g.id,
            title: g.title,
            when: g.when,
            ...(g.with?.length ? { with: g.with } : {}),
            tokens: tokens(text),
            sections: sections(text).map((s) => ({ heading: s.heading, ...(s.level === 3 ? { level: 3 } : {}), tokens: tokens(s.text) })),
          }
        }),
      )
      return { guides }
    }
    const ids = typeof topic === 'string' ? [topic] : topic
    const named = ids.map(guideNamed)
    if (section !== undefined) {
      if (named.length !== 1) throw new CommandError('invalid_input', 'section is one section of one guide: give one topic with it.')
      const g = named[0]
      const s = sectionNamed(g, sections(await textOf(g)), section)
      markGuideRead()
      return { topic: g.id, section: s.heading, tokens: tokens(s.text), text: s.text }
    }
    const all = await Promise.all(named.map(async (g) => ({ topic: g.id, title: g.title, text: await textOf(g) })))
    // In order while they fit, the first whatever its size; the rest for
    // the next call — never past what an answer carries.
    let size = 0
    let fit = 0
    while (fit < all.length && (fit === 0 || size + JSON.stringify(all[fit]).length <= GUIDES_READ_MOST)) size += JSON.stringify(all[fit++]).length
    const guides = all.slice(0, fit)
    const next = all.slice(fit).map((g) => g.topic)
    markGuideRead()
    // What the guides read build on and this call did not take: named, for
    // the agent to read too unless it has.
    const missing = [...new Set(named.flatMap((g) => g.with ?? []))].filter((id) => !ids.includes(id))
    const nextNote = next.length
      ? `${next.join(' and ')} did not fit in this answer with ${guides.map((g) => g.topic).join(' and ')} (${Math.round(size / 1000)} k characters): read ${next.length > 1 ? 'them' : 'it'} next — guide_read { topic: ${next.length > 1 ? JSON.stringify(next).split(',').join(', ') : `"${next[0]}"`} }.`
      : ''
    const withNote = missing.length ? `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} read with ${named.length > 1 ? 'these' : 'this one'}: read ${missing.length > 1 ? 'them' : 'it'} too, unless you have in this task.` : ''
    const note = [nextNote, withNote].filter(Boolean).join(' ')
    return {
      guides,
      ...(next.length ? { next } : {}),
      ...(missing.length ? { with: missing } : {}),
      ...(note ? { note } : {}),
    }
  },
}

export const guideCommands = [read]
