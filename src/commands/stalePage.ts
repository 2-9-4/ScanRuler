// SPDX-License-Identifier: AGPL-3.0-only
// A page older than the app it came from. The page loads its later parts —
// the guides, a workspace's code — when they are first wanted, by a dynamic
// import of a file the server serves. Once the app has been rebuilt since
// the page loaded, those files are not the ones the page knows: the dev
// server serves edited ones under a new `?t=`, a deploy replaces the hashed
// chunks. The import fails ("Failed to fetch dynamically imported module",
// or Vite's `vite:preloadError` in a build), while everything the page
// holds already goes on working. A command that meets one answers
// `stale_page`, and the session's readout says so from then on, so that the
// agent saves the work before the person reloads.

import { CommandError } from './types'

/** What a failed dynamic import says, in Chrome and Edge, Firefox and
 *  Safari, and Vite's preload of a chunk's CSS. */
const IMPORT_FAILED = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i

/** What a stale page answers, and its readout says. */
export const STALE_PAGE =
  'this tab is older than the app it came from (rebuilt since) — save the project (project_save), then ask the person to reload; the work is lost on reload otherwise'

let staleSince: string | null = null

/** When the page found itself older than its app — null while it has not. */
export const pageStale = (): string | null => staleSince

/** Mark the page stale, from now on. */
export function markPageStale(): void {
  staleSince ??= new Date().toISOString()
}

/** Whether `e` is a dynamic import that failed. */
export function isStaleImport(e: unknown): boolean {
  if (e instanceof CommandError) return false
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return IMPORT_FAILED.test(message)
}

/** The answer to a command that met a failed import: `stale_page`, the
 *  page marked stale. */
export function staleError(e: unknown): CommandError {
  markPageStale()
  const said = e instanceof Error ? e.message : String(e)
  return new CommandError('stale_page', `${STALE_PAGE[0].toUpperCase()}${STALE_PAGE.slice(1)}. (${said})`)
}

/** For a test: the page as it loaded. */
export function resetPageStale(): void {
  staleSince = null
}

// In a build, Vite says so before the import is refused.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('vite:preloadError', () => markPageStale())
}
