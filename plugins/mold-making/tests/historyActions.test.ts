// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {MOLD_HISTORY_ACTIONS} from '../plugin'
import {useMold} from '../state/moldStore'

describe('Mold Making history action registration',()=>{
  it('wraps every user-editable mold store setter for undo and redo',()=>{
    const actions=Object.keys(useMold.getState()).filter(k=>k.startsWith('set')).sort()
    expect([...MOLD_HISTORY_ACTIONS].sort()).toEqual(actions)
    expect(new Set(MOLD_HISTORY_ACTIONS).size).toBe(MOLD_HISTORY_ACTIONS.length)
  })
})
