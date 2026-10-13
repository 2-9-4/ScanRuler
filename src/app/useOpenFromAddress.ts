// SPDX-License-Identifier: AGPL-3.0-only
// Opens the file the page's address names, once, when the app starts — see
// addressOpen for the two forms — and shows the workspace it names, after
// the file is open, so that it wins over the one a project was saved in. The
// fetch shows as busy in the status bar the way an import does, and what
// fails is said there too.

import { useEffect, useRef } from 'react'
import { internalWorkspace, workspaceNames } from '../commands/state'
import { useShell } from '../state/shellStore'
import { useStore } from '../state/store'
import { fetchAddressFile, openFromAddress, workspaceFromAddress } from './addressOpen'
import { openAnyFile, type OpenHandlers } from './openAny'

export function useOpenFromAddress(handlers: OpenHandlers): void {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    if (typeof location === 'undefined') return
    const workspace = workspaceFromAddress(location)
    const showWorkspace = () => {
      if (!workspace) return
      if (!workspaceNames().includes(workspace)) {
        useStore.setState({ errorText: `There is no workspace "${workspace}" — there are ${workspaceNames().join(', ')}.` })
        return
      }
      useShell.getState().setWorkspace(internalWorkspace(workspace))
    }
    const request = openFromAddress(location, location.href, import.meta.env.VITE_FILES_URL as string | undefined)
    if (!request) {
      showWorkspace()
      return
    }
    if ('error' in request) {
      useStore.setState({ errorText: request.error })
      return
    }
    let dropped = false
    void (async () => {
      useStore.setState({ busy: true, errorText: null, statusText: `Fetching ${request.name}…` })
      let file: File
      try {
        file = await fetchAddressFile(request)
      } catch (e) {
        if (!dropped) useStore.setState({ busy: false, statusText: '', errorText: e instanceof Error ? e.message : String(e) })
        return
      }
      if (dropped) return
      useStore.setState({ busy: false })
      await openAnyFile(file, latest.current)
      if (!dropped) showWorkspace()
    })()
    // Development mounts twice: the first run's file is left unopened.
    return () => {
      dropped = true
    }
  }, [])
}
