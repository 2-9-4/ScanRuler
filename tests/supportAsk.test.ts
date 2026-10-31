// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { usePrefs } from '../src/state/prefsStore'
import { useStore } from '../src/state/store'
import { ASK_EVERY_MS, ASK_OFF_MS, useSupportAsk } from '../src/state/supportAskStore'

const ask = (now = 1_000_000_000) => useSupportAsk.getState().ask(now)
const isOpen = () => useSupportAsk.getState().open

describe('the big support card', () => {
  beforeEach(() => {
    useSupportAsk.setState({ open: false, lastAsked: -Infinity })
    usePrefs.setState({ supportCard: true, supportAsk: true, supportAskOffUntil: 0 })
    useStore.setState({ errorText: null })
  })

  it('comes up on the first save', () => {
    ask()
    expect(isOpen()).toBe(true)
  })

  it('stays away when switched off, on its own or with the corner card', () => {
    usePrefs.setState({ supportAsk: false })
    ask()
    expect(isOpen()).toBe(false)
    usePrefs.setState({ supportAsk: true, supportCard: false })
    ask()
    expect(isOpen()).toBe(false)
  })

  it('stays away for the week it was put away for, and comes back after it', () => {
    usePrefs.setState({ supportAskOffUntil: ASK_OFF_MS })
    ask(ASK_OFF_MS - 1)
    expect(isOpen()).toBe(false)
    ask(ASK_OFF_MS)
    expect(isOpen()).toBe(true)
  })

  it('is brought back early by the setting', () => {
    usePrefs.setState({ supportAskOffUntil: ASK_OFF_MS })
    usePrefs.getState().setSupportAsk(true)
    ask(1)
    expect(isOpen()).toBe(true)
  })

  it('comes up once in the interval, and again after it', () => {
    ask(0)
    useSupportAsk.getState().close()
    ask(ASK_EVERY_MS - 1)
    expect(isOpen()).toBe(false)
    ask(ASK_EVERY_MS)
    expect(isOpen()).toBe(true)
  })

  it('does not restart the interval by being asked again while up', () => {
    ask(0)
    ask(ASK_EVERY_MS)
    expect(useSupportAsk.getState().lastAsked).toBe(0)
  })

  it('does not cover an error, and an error does not use up the interval', () => {
    useStore.setState({ errorText: 'Export failed' })
    ask(0)
    expect(isOpen()).toBe(false)
    useStore.setState({ errorText: null })
    ask(1)
    expect(isOpen()).toBe(true)
  })
})
