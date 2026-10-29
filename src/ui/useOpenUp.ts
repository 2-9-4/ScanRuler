// SPDX-License-Identifier: AGPL-3.0-only
// Which way a drop-down list opens: down, under its button, unless what the
// list stands in — a panel that scrolls, or the window — ends before the list
// does and there is more room above. Near the bottom of a short panel a list
// opened down is cut off, and a menu that closes on a scroll cannot be
// scrolled to.

import { useLayoutEffect, useState, type RefObject } from 'react'

/** True when the open list, `list`, should open upward. Measured each time
 *  it opens, before it is painted. */
export function useOpenUp(open: boolean, list: RefObject<HTMLElement | null>): boolean {
  const [up, setUp] = useState(false)
  useLayoutEffect(() => {
    const el = list.current
    const anchor = el?.parentElement
    if (!open || !el || !anchor) return
    let top = 0
    let bottom = window.innerHeight
    for (let p: HTMLElement | null = anchor; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowY === 'visible') continue
      const r = p.getBoundingClientRect()
      top = Math.max(top, r.top + p.clientTop)
      bottom = Math.min(bottom, r.top + p.clientTop + p.clientHeight)
    }
    const a = anchor.getBoundingClientRect()
    const below = bottom - a.bottom
    const above = a.top - top
    setUp(below < el.offsetHeight + 3 && above > below)
  }, [open, list])
  return up
}
