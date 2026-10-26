// SPDX-License-Identifier: AGPL-3.0-only
// The guides an agent reads before a task — how to go about measuring a
// scan, say: the workflow and the judgement its tools do not carry. They
// are served with the commands (guide.read, core/guide.ts), so an agent
// works from the text written for the build it drives, never from an older
// copy kept somewhere else. The app registers its own (core.ts); a plugin
// registers its from install(). Each is Markdown, loaded when first read —
// a page no agent asks carries none of it.

export interface Guide {
  /** Its name in guide.read: lower case, words joined by hyphens. */
  id: string
  title: string
  /** The task it is for, as the index says it — one line. */
  when: string
  /** Guides to read before this one, by id: the ground it builds on. */
  with?: readonly string[]
  /** The text, Markdown: `##` and `###` headings are the sections
   *  guide.read gives one at a time. */
  text: () => Promise<string>
}

const guides = new Map<string, Guide>()

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

/** Add a guide. Two of one id throw, as two commands of one name do. The
 *  returned function takes it out again. */
export function registerGuide(guide: Guide): () => void {
  if (!ID.test(guide.id)) throw new Error(`"${guide.id}" is not a guide id — lower case, words joined by hyphens.`)
  if (guides.has(guide.id)) throw new Error(`Two guides share the id "${guide.id}".`)
  guides.set(guide.id, guide)
  return () => {
    if (guides.get(guide.id) === guide) guides.delete(guide.id)
  }
}

/** Every guide, by id. */
export function listGuides(): Guide[] {
  return [...guides.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function guideById(id: string): Guide | undefined {
  return guides.get(id)
}

let read = false

/** Whether an agent has read a guide since the page started — until one
 *  has, the session's readout says where they are. */
export const guideRead = (): boolean => read
export const markGuideRead = (): void => {
  read = true
}
