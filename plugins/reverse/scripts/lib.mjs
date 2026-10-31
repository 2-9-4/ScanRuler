// SPDX-License-Identifier: AGPL-3.0-only
// What the browser checks that drive the Reverse engineer workspace share:
// the workspace opened with its CAD kernel ready, and the helpers bound to
// one page that read the workspace through its DEV hook (window.__re). The
// Mesh Tools checks that build bodies here use them too.

import { sleep } from '../../../scripts/e2e-lib.mjs'

/** Put the workspace on screen and wait, up to three minutes, for its
 *  kernel. */
export async function openReverse(page) {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 })
}

/** The helpers for one page. */
export function reverseHelpers(page) {
  /** Run a function in the page, where the store is window.__re.store. */
  const re = (fn, ...args) => page.evaluate(fn, ...args)
  return {
    re,
    /** Wait for a build to end with at least one body. */
    built: () => page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.length > 0, { timeout: 60_000 }),
    /** Wait, up to three minutes, for the kernel. */
    kernelReady: () => page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 }),
    /** A point of the part as the pixel it is drawn at, [x, y]. */
    screen: (p) => re((q) => window.__re.reScene().bodyPicks.screenProjection()(q[0], q[1], q[2]), p),
    /** Hover, then click, the point of the part at x, y, z. */
    clickAt: async (x, y, z) => {
      const [px, py] = await re((p) => window.__re.reScene().bodyPicks.screenProjection()(...p), [x, y, z])
      await page.mouse.move(px, py)
      await sleep(150)
      await page.mouse.click(px, py)
      await sleep(300)
    },
  }
}
