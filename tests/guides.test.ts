// SPDX-License-Identifier: AGPL-3.0-only
// guide.read: the index, a guide whole or several in order while they fit
// one answer, one section, and what it says when a name is wrong — and the
// guides it lists are the ones registered, in its description too; every
// read the app's guides prescribe answers within what the server carries.

import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerCoreCommands } from '../src/commands/core'
import { GUIDES_READ_MOST } from '../src/commands/core/guide'
import { registerGuide } from '../src/commands/guides'
import { listCommands, runCommand } from '../src/commands/registry'
import { CommandError } from '../src/commands/types'
import { GUIDE_ANSWER_CAP, quotedReads } from './guideReads'

const TEXT = [
  '<!-- SPDX-License-Identifier: AGPL-3.0-only -->',
  '',
  '# Test guide',
  '',
  'Read the measure guide first.',
  '',
  '## 1. Datums',
  'Fit the mating face.',
  '',
  '### Small angles',
  'Round what moves the far end by less than T.',
  '',
  '## 2. Datum check',
  'Check the frame.',
].join('\r\n')

/** A guide of about `chars` characters. */
const long = (chars: number) => ['# A long guide', '', '## 1. All of it', 'x'.repeat(chars)].join('\n')

let unregister: (() => void)[] = []
beforeAll(() => {
  registerCoreCommands()
  unregister = [
    registerGuide({ id: 'test-guide', title: 'A test guide', when: 'testing the guides', with: ['measure'], text: async () => TEXT }),
    registerGuide({ id: 'test-long-a', title: 'A long guide', when: 'testing what fits', text: async () => long(50_000) }),
    registerGuide({ id: 'test-long-b', title: 'Another long guide', when: 'testing what fits', text: async () => long(50_000) }),
    registerGuide({ id: 'test-huge', title: 'A huge guide', when: 'testing what fits', text: async () => long(85_000) }),
  ]
})
afterAll(() => unregister.forEach((off) => off()))

const read = (input: unknown) => runCommand('guide.read', input) as Promise<Record<string, any>>
const refusal = (input: unknown) => read(input).then(
  () => {
    throw new Error('not refused')
  },
  (e: CommandError) => e,
)

describe('guide.read', () => {
  it('lists the guides in its description, with what each is read with', () => {
    const d = listCommands().find((c) => c.name === 'guide.read')!.description
    expect(d).toContain('measure — measuring a 3D scan')
    expect(d).toContain('test-guide — testing the guides (read with measure, first)')
  })

  it('answers the index without a topic: each guide, its sections and their cost', async () => {
    const { guides } = await read({})
    const g = guides.find((x: any) => x.topic === 'test-guide')
    expect(g).toMatchObject({ title: 'A test guide', when: 'testing the guides', with: ['measure'] })
    expect(g.sections.map((s: any) => s.heading)).toEqual(['1. Datums', 'Small angles', '2. Datum check'])
    expect(g.sections[1].level).toBe(3)
    expect(guides.map((x: any) => x.topic)).toContain('measure-reference')
    expect(guides.every((x: any) => x.tokens > 0)).toBe(true)
  })

  it('gives a guide whole, without its licence comment, and names what it is read with', async () => {
    const one = await read({ topic: 'test-guide' })
    expect(one.guides).toHaveLength(1)
    expect(one.guides[0].text.startsWith('# Test guide')).toBe(true)
    expect(one.guides[0].text).not.toContain('\r')
    expect(one.with).toEqual(['measure'])
    const both = await read({ topic: ['measure', 'test-guide'] })
    expect(both.guides.map((g: any) => g.topic)).toEqual(['measure', 'test-guide'])
    expect(both.with).toBeUndefined()
    expect(both.guides[0].text).toContain('# Measuring a 3D scan')
  })

  it('gives several in order while they fit in one answer, and names the rest in next', async () => {
    const first = await read({ topic: ['test-long-a', 'test-long-b', 'test-guide'] })
    expect(first.guides.map((g: any) => g.topic)).toEqual(['test-long-a'])
    // In order: the small one after a long one that did not fit waits too.
    expect(first.next).toEqual(['test-long-b', 'test-guide'])
    expect(first.note).toMatch(/^test-long-b and test-guide did not fit in this answer with test-long-a \(50 k characters\): read them next — guide_read \{ topic: \["test-long-b", "test-guide"\] \}\./)
    expect(JSON.stringify(first).length).toBeLessThan(GUIDES_READ_MOST)
    // The next call, as the note gives it: both fit.
    const second = await read({ topic: first.next })
    expect(second.guides.map((g: any) => g.topic)).toEqual(['test-long-b', 'test-guide'])
    expect(second.next).toBeUndefined()
    expect(second.with).toEqual(['measure'])
    // One guide is answered whole, whatever its size; one too many after it waits.
    const huge = await read({ topic: ['test-huge', 'test-guide'] })
    expect(huge.guides.map((g: any) => g.topic)).toEqual(['test-huge'])
    expect(huge.guides[0].text.length).toBeGreaterThan(85_000)
    expect(huge.next).toEqual(['test-guide'])
    expect(huge.note).toMatch(/read it next — guide_read \{ topic: "test-guide" \}/)
    // What the description says.
    expect(listCommands().find((c) => c.name === 'guide.read')!.description).toContain('as many as fit in about 80 k characters, the rest named in next')
  })

  it('answers every read the app’s guides prescribe within what the server carries', async () => {
    const dir = new URL('../src/commands/guides/', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThan(1)
    const asks = files.flatMap((f) => quotedReads(readFileSync(new URL(f, dir), 'utf8')).map((a) => ({ ...a, file: f })))
    expect(asks.length).toBeGreaterThan(0)
    for (const { quoted, input, file } of asks) {
      const answer = await read(input)
      expect(JSON.stringify(answer).length, `${file}: ${quoted}`).toBeLessThanOrEqual(GUIDE_ANSWER_CAP)
    }
    // Each guide whole, too.
    for (const g of ['measure', 'measure-reference']) expect(JSON.stringify(await read({ topic: g })).length, g).toBeLessThanOrEqual(GUIDE_ANSWER_CAP)
    // The budget leaves room under the cap.
    expect(GUIDES_READ_MOST).toBeLessThan(GUIDE_ANSWER_CAP)
  })

  it('gives one section by its heading, with or without its number, or a part that names one', async () => {
    const datums = await read({ topic: 'test-guide', section: 'Datums' })
    expect(datums.section).toBe('1. Datums')
    // A section runs to the next heading of its level: its subsections in it.
    expect(datums.text).toContain('Small angles')
    expect(datums.text).not.toContain('Check the frame')
    expect((await read({ topic: 'test-guide', section: 'small' })).section).toBe('Small angles')
    expect((await read({ topic: 'test-guide', section: '2. Datum check' })).text).toContain('Check the frame')
  })

  it('says what is wrong with a name, and what there is', async () => {
    const guide = await refusal({ topic: 'nope' })
    expect(guide.code).toBe('not_found')
    expect(guide.message).toContain('measure')
    const section = await refusal({ topic: 'test-guide', section: 'thickness' })
    expect(section.code).toBe('not_found')
    expect(section.message).toContain('"1. Datums"')
    const two = await refusal({ topic: 'test-guide', section: 'datum' })
    expect(two.code).toBe('invalid_input')
    expect(two.message).toContain('more than one section')
    expect((await refusal({ topic: ['measure', 'test-guide'], section: 'Datums' })).code).toBe('invalid_input')
    expect((await refusal({ section: 'Datums' })).code).toBe('invalid_input')
  })
})
