// SPDX-License-Identifier: AGPL-3.0-only
// Keep the exhaustive undo contract synchronized with user-facing mold store actions.
// A missing name silently changes a working editor control into an undo-less edit.
import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const store=readFileSync(new URL('../state/moldStore.ts',import.meta.url),'utf8')
const plugin=readFileSync(new URL('../plugin.ts',import.meta.url),'utf8')
describe('Mold Making history action registration',()=>{
  it('registers every user-facing store setter for the undo history',()=>{
    const actions=[...store.matchAll(/^\s+(set[A-Z]\w+)\([^)]*\)\s*:\s*void/gm)].map(x=>x[1])
    expect(actions.length).toBeGreaterThan(15)
    for(const name of actions)expect(plugin, name+' is missing from plugin history').toContain("'"+name+"'")
  })
})
