// SPDX-License-Identifier: AGPL-3.0-only
// Whether the big support card is up (ui/SupportCard's SupportAsk). A save or
// an export asks for it once the file is with the browser (app/exports.saveFile);
// nothing waits on it being closed. Commands build their files without
// saveFile, so an agent's run never puts it up.

import { create } from 'zustand'
import { usePrefs } from './prefsStore'
import { useStore } from './store'

/** Three exports in a row are one sitting, not three occasions to ask. */
export const ASK_EVERY_MS = 10 * 60_000

/** How long the card's "Don't show this again for a week" holds. */
export const ASK_OFF_MS = 7 * 24 * 60 * 60_000

interface SupportAskState {
  open: boolean
  /** When it last came up, by `Date.now()`. */
  lastAsked: number
  ask: (now?: number) => void
  close: () => void
}

export const useSupportAsk = create<SupportAskState>()((set, get) => ({
  open: false,
  lastAsked: -Infinity,
  ask: (now = Date.now()) => {
    const { supportCard, supportAsk, supportAskOffUntil } = usePrefs.getState()
    if (!supportCard || !supportAsk || now < supportAskOffUntil || get().open) return
    if (now - get().lastAsked < ASK_EVERY_MS) return
    // The toast goes away by itself: blurred over, it would go unread.
    if (useStore.getState().errorText) return
    set({ open: true, lastAsked: now })
  },
  close: () => set({ open: false }),
}))
